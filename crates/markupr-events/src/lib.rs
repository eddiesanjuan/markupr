//! What the user did: cursor, clicks, scroll, key activity, focus, element under cursor, marks,
//! and the frontmost app's unified log, all on the session clock. macOS only.
mod ax;
mod ffi;
mod keys;
pub mod permissions;
mod syslog;

use ffi::*;
use keys::KeyClass;
use markupr_core::{round_t, Clock, JsonlWriter};
use serde_json::json;
use std::{
    ffi::c_void,
    fmt, io,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

pub struct EventsConfig { pub events_path: PathBuf, pub cursor_path: PathBuf, pub system_log_path: Option<PathBuf> }

#[derive(Clone, Debug, Default)]
pub struct EventsReport {
    pub events: u64,
    pub cursor_samples: u64,
    pub marks: u32,
    pub system_log_lines: u64,
    /// Non-error system-log lines dropped by the 50/s cap (errors and faults are never dropped).
    pub system_log_dropped: u64,
    pub tap_active: bool,
    pub warnings: Vec<String>,
}

impl EventsReport {
    pub fn to_json(&self) -> serde_json::Value {
        json!({ "events": self.events, "cursor_samples": self.cursor_samples, "marks": self.marks,
                "system_log_lines": self.system_log_lines, "system_log_dropped": self.system_log_dropped, "tap_active": self.tap_active, "warnings": self.warnings })
    }
}

#[derive(Debug)]
pub enum EventsError { Io(io::Error) }
impl fmt::Display for EventsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { match self { EventsError::Io(e) => write!(f, "events: {e}") } }
}
impl std::error::Error for EventsError {}
impl From<io::Error> for EventsError { fn from(e: io::Error) -> Self { EventsError::Io(e) } }

/// Current cursor position in global display points (origin top-left of the main display).
pub fn cursor_position() -> Option<(f64, f64)> {
    let ev = unsafe { CGEventCreate(std::ptr::null()) };
    if ev.is_null() { return None; }
    let p = unsafe { CGEventGetLocation(ev) };
    unsafe { CFRelease(ev as CFTypeRef) };
    Some((p.x, p.y))
}

const CURSOR_MIN_GAP_NS: u64 = 1_000_000_000 / 30;
const SCROLL_WINDOW_NS: u64 = 150_000_000;
const TYPING_IDLE_NS: u64 = 1_000_000_000;
const FOCUS_POLL: Duration = Duration::from_millis(250);
/// A CGEvent timestamp further than this from "now" is not trusted.
const TS_SANITY_NS: u64 = 2_000_000_000;

/// What the tap callback hands to the worker. Keys arrive already classified: a printable key is
/// `Typing` with no payload, so no character ever leaves the callback.
enum Raw {
    Move { ns: u64, x: f64, y: f64 },
    Button { ns: u64, down: bool, button: &'static str, x: f64, y: f64 },
    Scroll { ns: u64, x: f64, y: f64, dx: i64, dy: i64 },
    Typing { ns: u64 },
    Key { ns: u64, name: &'static str, mods: keys::Mods },
}

pub struct EventRecorder {
    events: JsonlWriter,
    cursor: JsonlWriter,
    clock: Clock,
    marks: AtomicU32,
    stop: Arc<AtomicBool>,
    tap_active: bool,
    ts_fallbacks: Arc<AtomicU64>,
    warnings: Arc<Mutex<Vec<String>>>,
    tap_thread: Option<JoinHandle<()>>,
    worker: Option<JoinHandle<()>>,
    poller: Option<JoinHandle<Option<(u64, syslog::Stats)>>>,
}

const _: () = { const fn assert_send_sync<T: Send + Sync>() {} assert_send_sync::<EventRecorder>() };

impl EventRecorder {
    pub fn start(cfg: EventsConfig, clock: Clock) -> Result<EventRecorder, EventsError> {
        let events = JsonlWriter::open(&cfg.events_path)?;
        let cursor = JsonlWriter::open(&cfg.cursor_path)?;
        let syslog_writer = cfg.system_log_path.as_ref().map(JsonlWriter::open).transpose()?;
        let stop = Arc::new(AtomicBool::new(false));
        let warnings = Arc::new(Mutex::new(Vec::new()));
        let ts_fallbacks = Arc::new(AtomicU64::new(0));

        // Focus, secure input and system log run in every mode, including without a tap.
        let poller = {
            let (events, stop, warnings) = (events.clone(), stop.clone(), warnings.clone());
            let mut syslog = syslog_writer.map(|w| syslog::SysLog::new(w, clock));
            thread::Builder::new().name("events-focus".into()).spawn(move || {
                poll_focus(&events, &clock, &stop, &warnings, syslog.as_mut());
                syslog.map(|s| s.finish())
            })?
        };

        let (tx, rx) = mpsc::channel::<Raw>();
        let worker = {
            let (events, cursor) = (events.clone(), cursor.clone());
            thread::Builder::new().name("events-worker".into()).spawn(move || run_worker(rx, &events, &cursor, &clock))?
        };

        let (ready_tx, ready_rx) = mpsc::sync_channel::<bool>(1);
        let tap_thread = {
            let (stop, fallbacks) = (stop.clone(), ts_fallbacks.clone());
            thread::Builder::new().name("events-tap".into()).spawn(move || run_tap(tx, ready_tx, stop, fallbacks))?
        };
        let tap_active = ready_rx.recv_timeout(Duration::from_secs(5)).unwrap_or(false);
        if !tap_active {
            warnings.lock().unwrap().push(
                "event tap unavailable (Input Monitoring or Accessibility missing): no cursor, clicks, scroll or keys; focus, marks and system log still recorded".into(),
            );
        }
        Ok(EventRecorder { events, cursor, clock, marks: AtomicU32::new(0), stop, tap_active, ts_fallbacks, warnings, tap_thread: Some(tap_thread), worker: Some(worker), poller: Some(poller) })
    }

    /// Writes a mark at the current cursor position. Safe from any thread. Returns its number (1-based).
    pub fn mark(&self, source: &str, note: Option<String>) -> u32 {
        let n = self.marks.fetch_add(1, Ordering::SeqCst) + 1;
        let t = round_t(self.clock.now());
        let (x, y) = cursor_position().map_or((None, None), |(x, y)| (Some(x), Some(y)));
        let _ = self.events.write(&json!({ "t": t, "type": "mark", "n": n, "x": x, "y": y, "source": source, "note": note }));
        n
    }

    pub fn stop(mut self) -> Result<EventsReport, EventsError> {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(h) = self.tap_thread.take() { let _ = h.join(); } // drops the sender; worker drains and exits
        if let Some(h) = self.worker.take() { let _ = h.join(); }
        let sys = self.poller.take().and_then(|h| h.join().ok()).flatten();
        self.events.flush()?;
        self.cursor.flush()?;
        let mut warnings = std::mem::take(&mut *self.warnings.lock().unwrap());
        let fallbacks = self.ts_fallbacks.load(Ordering::Relaxed);
        if fallbacks > 0 { warnings.push(format!("{fallbacks} input events had no usable host timestamp; stamped on arrival")); }
        let (mut system_log_lines, mut system_log_dropped) = (0, 0);
        if let Some((lines, st)) = sys {
            system_log_lines = lines;
            system_log_dropped = st.dropped;
            if st.t_from_wall > 0 {
                warnings.push(format!("system log: {} of {} lines stamped from wall time (mach timestamp missing or off by more than 0.5 s)", st.t_from_wall, st.t_from_wall + st.t_from_mach));
            }
        }
        Ok(EventsReport {
            events: self.events.lines_written(),
            cursor_samples: self.cursor.lines_written(),
            marks: self.marks.load(Ordering::SeqCst),
            system_log_lines,
            system_log_dropped,
            tap_active: self.tap_active,
            warnings,
        })
    }
}

/// A recorder dropped without `stop()` still ends its threads and its `log stream` child.
impl Drop for EventRecorder {
    fn drop(&mut self) { self.stop.store(true, Ordering::SeqCst); }
}

// ---------- focus, secure input, system log ----------

const SECURE_HOLD_S: f64 = 1.0;

/// Debounces secure-input state samples: a change is reported only once it has held for
/// `SECURE_HOLD_S`, stamped with when it began. Shorter flaps report nothing; a change still
/// pending when sampling stops is dropped.
#[derive(Default)]
struct SecureDebounce { stable: bool, pending: Option<(f64, bool)> }

impl SecureDebounce {
    fn sample(&mut self, t: f64, on: bool) -> Option<(f64, bool)> {
        if on == self.stable {
            self.pending = None;
            return None;
        }
        let (start, _) = *self.pending.get_or_insert((t, on));
        if t - start >= SECURE_HOLD_S {
            self.stable = on;
            self.pending = None;
            return Some((start, on));
        }
        None
    }
}

/// Process-wide count of focus polls whose window title came from [app element, window list].
static TITLE_SOURCES: [AtomicU64; 2] = [AtomicU64::new(0), AtomicU64::new(0)];

/// Diagnostic: (app element, window list) counts for where focus window titles came from.
#[doc(hidden)]
pub fn focus_title_sources() -> (u64, u64) {
    (TITLE_SOURCES[0].load(Ordering::Relaxed), TITLE_SOURCES[1].load(Ordering::Relaxed))
}

fn poll_focus(events: &JsonlWriter, clock: &Clock, stop: &AtomicBool, warnings: &Mutex<Vec<String>>, mut syslog: Option<&mut syslog::SysLog>) {
    let mut last: Option<ax::Focus> = None;
    let mut secure = SecureDebounce::default();
    let (mut polls, mut no_focus) = (0u32, 0u32);
    while !stop.load(Ordering::SeqCst) {
        // Informational line only, debounced. Key privacy does not depend on it: the tap reads
        // the live state on every key event.
        let now_secure = unsafe { IsSecureEventInputEnabled() } != 0;
        if let Some((t, on)) = secure.sample(clock.now(), now_secure) {
            let _ = events.write(&json!({ "t": round_t(t), "type": "secure_input", "on": on }));
        }
        polls += 1;
        let found = ax::focus(unsafe { AXIsProcessTrusted() });
        if found.is_none() { no_focus += 1; }
        if let Some((_, src)) = &found { TITLE_SOURCES[*src as usize].fetch_add(1, Ordering::Relaxed); }
        let found = found.map(|(f, _)| f);
        if let Some(f) = found {
            if last.as_ref() != Some(&f) {
                let _ = events.write(&json!({ "t": round_t(clock.now()), "type": "focus", "app": f.app, "bundle": f.bundle, "pid": f.pid, "window": f.window }));
                if let Some(s) = syslog.as_deref_mut() {
                    if let Err(e) = s.follow(Some(f.pid)) { warnings.lock().unwrap().push(e); }
                }
                last = Some(f);
            }
        }
        thread::sleep(FOCUS_POLL);
    }
    let mut w = warnings.lock().unwrap();
    if no_focus * 2 > polls {
        w.push(format!("focus: no frontmost app could be determined on {no_focus} of {polls} polls"));
    }
}

// ---------- event tap ----------

struct TapCtx { tx: mpsc::Sender<Raw>, tap: CFMachPortRef, fallbacks: Arc<AtomicU64> }

fn run_tap(tx: mpsc::Sender<Raw>, ready: mpsc::SyncSender<bool>, stop: Arc<AtomicBool>, fallbacks: Arc<AtomicU64>) {
    let mask: u64 = [LEFT_DOWN, LEFT_UP, RIGHT_DOWN, RIGHT_UP, MOUSE_MOVED, LEFT_DRAGGED, RIGHT_DRAGGED, KEY_DOWN, SCROLL, OTHER_DOWN, OTHER_UP, OTHER_DRAGGED]
        .iter().fold(0, |m, t| m | 1u64 << t);
    let ctx = Box::into_raw(Box::new(TapCtx { tx, tap: std::ptr::null_mut(), fallbacks }));
    // kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionListenOnly
    let tap = unsafe { CGEventTapCreate(1, 0, 1, mask, tap_callback, ctx.cast()) };
    if tap.is_null() {
        let _ = ready.send(false);
        drop(unsafe { Box::from_raw(ctx) });
        return;
    }
    unsafe { (*ctx).tap = tap };
    let source = unsafe { CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0) };
    let rl = unsafe { CFRunLoopGetCurrent() };
    unsafe {
        CFRunLoopAddSource(rl, source, kCFRunLoopDefaultMode);
        CGEventTapEnable(tap, true);
    }
    let _ = ready.send(true);
    while !stop.load(Ordering::SeqCst) {
        unsafe { CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.2, 0) };
    }
    unsafe {
        CGEventTapEnable(tap, false);
        CFRunLoopRemoveSource(rl, source, kCFRunLoopDefaultMode);
        CFMachPortInvalidate(tap);
        CFRelease(source as CFTypeRef);
        CFRelease(tap as CFTypeRef);
        drop(Box::from_raw(ctx));
    }
}

extern "C" fn tap_callback(_proxy: *mut c_void, ty: u32, event: CGEventRef, user: *mut c_void) -> CGEventRef {
    let ctx = unsafe { &*(user as *const TapCtx) };
    if ty == TAP_DISABLED_BY_TIMEOUT || ty == TAP_DISABLED_BY_USER_INPUT {
        unsafe { CGEventTapEnable(ctx.tap, true) };
        return event;
    }
    if !event.is_null() { unsafe { handle_event(ty, event, &ctx.tx, &ctx.fallbacks) }; }
    event
}

/// The tap's handler. Never blocks: reads fields, classifies keys, sends over an unbounded channel.
/// Safety: `event` must be a valid CGEventRef.
unsafe fn handle_event(ty: u32, event: CGEventRef, tx: &mpsc::Sender<Raw>, fallbacks: &AtomicU64) {
    let now = Clock::host_now_ns();
    // Live tap events carry host-clock nanoseconds (measured 11/16 on M5: ratio to
    // mach_absolute_time scaled by the timebase is 1.0000), not raw mach ticks.
    let ns = match unsafe { CGEventGetTimestamp(event) } {
        0 => None,
        ts => Some(ts).filter(|n| n.abs_diff(now) <= TS_SANITY_NS),
    }
    .unwrap_or_else(|| { fallbacks.fetch_add(1, Ordering::Relaxed); now });
    let p = unsafe { CGEventGetLocation(event) };
    let raw = match ty {
        MOUSE_MOVED | LEFT_DRAGGED | RIGHT_DRAGGED | OTHER_DRAGGED => Raw::Move { ns, x: p.x, y: p.y },
        LEFT_DOWN | LEFT_UP => Raw::Button { ns, down: ty == LEFT_DOWN, button: "left", x: p.x, y: p.y },
        RIGHT_DOWN | RIGHT_UP => Raw::Button { ns, down: ty == RIGHT_DOWN, button: "right", x: p.x, y: p.y },
        OTHER_DOWN | OTHER_UP => Raw::Button { ns, down: ty == OTHER_DOWN, button: "other", x: p.x, y: p.y },
        SCROLL => Raw::Scroll {
            ns, x: p.x, y: p.y,
            dx: unsafe { CGEventGetIntegerValueField(event, FIELD_SCROLL_POINT_DX) },
            dy: unsafe { CGEventGetIntegerValueField(event, FIELD_SCROLL_POINT_DY) },
        },
        KEY_DOWN => {
            let secure = unsafe { IsSecureEventInputEnabled() } != 0;
            let code = unsafe { CGEventGetIntegerValueField(event, FIELD_KEYCODE) } as u16;
            let repeat = unsafe { CGEventGetIntegerValueField(event, FIELD_KEY_AUTOREPEAT) } != 0;
            match keys::classify(code, unsafe { CGEventGetFlags(event) }, repeat, secure) {
                KeyClass::Ignore => return,
                KeyClass::Printable => Raw::Typing { ns },
                KeyClass::Named { name, mods } => Raw::Key { ns, name, mods },
            }
        }
        _ => return,
    };
    let _ = tx.send(raw);
}

/// Offline harness for checks without touching the live input stream: feed constructed CGEvents
/// through the same handler and worker the tap uses. Nothing is posted to the system.
#[cfg(test)]
mod tests {
    use super::SecureDebounce;

    /// Bug guarded: secure input flapping once a second filled events.jsonl with a line per flip.
    #[test]
    fn secure_input_flapping_once_a_second_fills_the_event_log() {
        let run = |samples: &[(f64, bool)]| {
            let mut d = SecureDebounce::default();
            samples.iter().filter_map(|&(t, on)| d.sample(t, on)).collect::<Vec<_>>()
        };
        // 4 Hz polling; on for 0.5 s, off for 0.5 s, for 10 s: nothing written.
        let flap: Vec<_> = (0..40).map(|i| (i as f64 * 0.25, (i / 2) % 2 == 0)).collect();
        assert!(run(&flap).is_empty());
        // On from t=2.0, held: one line at 2.0, written once it has held 1 s. Off from 6.0: one line at 6.0.
        let held: Vec<_> = (0..40).map(|i| { let t = i as f64 * 0.25; (t, (2.0..6.0).contains(&t)) }).collect();
        assert_eq!(run(&held), vec![(2.0, true), (6.0, false)]);
        // Turns on 0.5 s before stop: dropped.
        assert!(run(&[(0.0, false), (9.5, true), (9.75, true)]).is_empty());
    }
}

#[doc(hidden)]
pub mod replay {
    use super::*;
    pub struct Replay { tx: mpsc::Sender<Raw>, fallbacks: AtomicU64, worker: JoinHandle<()>, events: JsonlWriter, cursor: JsonlWriter }
    impl Replay {
        pub fn start(events_path: &std::path::Path, cursor_path: &std::path::Path, clock: Clock) -> io::Result<Self> {
            let (events, cursor) = (JsonlWriter::open(events_path)?, JsonlWriter::open(cursor_path)?);
            let (tx, rx) = mpsc::channel();
            let (e, c) = (events.clone(), cursor.clone());
            let worker = thread::Builder::new().name("replay-worker".into()).spawn(move || run_worker(rx, &e, &c, &clock))?;
            Ok(Self { tx, fallbacks: AtomicU64::new(0), worker, events, cursor })
        }
        /// Safety: `event` must be a valid CGEventRef of type `ty`.
        pub unsafe fn feed(&self, ty: u32, event: *mut c_void) { unsafe { handle_event(ty, event, &self.tx, &self.fallbacks) } }
        /// Drains the worker (closing bursts and scroll windows) and returns timestamp fallbacks.
        pub fn finish(self) -> io::Result<u64> {
            drop(self.tx);
            let _ = self.worker.join();
            self.events.flush()?;
            self.cursor.flush()?;
            Ok(self.fallbacks.into_inner())
        }
    }
}

// ---------- worker: cursor throttle, scroll and typing coalescing, element lookups ----------

const BUTTONS: [&str; 3] = ["left", "right", "other"];

fn run_worker(rx: mpsc::Receiver<Raw>, events: &JsonlWriter, cursor: &JsonlWriter, clock: &Clock) {
    let t = |ns: u64| round_t(clock.t_from_host_ns(ns));
    let mut last_cursor_ns = 0u64;
    let mut pending_cursor: Option<(u64, f64, f64)> = None;
    let mut scroll: Option<(u64, f64, f64, i64, i64)> = None; // start ns, x, y, dx, dy
    let mut typing: Option<(u64, u64, u32)> = None; // first ns, last ns, count
    let mut own_down = [false; 3]; // per button: the open mouse_down hit our own process

    let write_cursor = |ns: u64, x: f64, y: f64| { let _ = cursor.write(&json!({ "t": t(ns), "x": x, "y": y })); };
    let flush_scroll = |s: &mut Option<(u64, f64, f64, i64, i64)>| {
        if let Some((ns, x, y, dx, dy)) = s.take() {
            let _ = events.write(&json!({ "t": t(ns), "type": "scroll", "x": x, "y": y, "dx": dx, "dy": dy }));
        }
    };
    let flush_typing = |s: &mut Option<(u64, u64, u32)>| {
        if let Some((first, last, count)) = s.take() {
            let dur = (last - first) as f64 / 1e9;
            let _ = events.write(&json!({ "t": t(first), "type": "typing", "count": count, "dur": round_t(dur) }));
        }
    };

    loop {
        let msg = rx.recv_timeout(Duration::from_millis(20));
        let now = Clock::host_now_ns();
        match msg {
            Ok(Raw::Move { ns, x, y }) => {
                if ns.saturating_sub(last_cursor_ns) >= CURSOR_MIN_GAP_NS {
                    write_cursor(ns, x, y);
                    last_cursor_ns = ns;
                    pending_cursor = None;
                } else {
                    pending_cursor = Some((ns, x, y));
                }
            }
            Ok(Raw::Button { ns, down, button, x, y }) => {
                let ty = if down { "mouse_down" } else { "mouse_up" };
                let mut line = json!({ "t": t(ns), "type": ty, "button": button, "x": x, "y": y });
                let slot = BUTTONS.iter().position(|b| *b == button).unwrap_or(2);
                if down {
                    match ax::element_at(x, y) {
                        ax::Hit::Own => own_down[slot] = true,
                        ax::Hit::Other(el) => {
                            own_down[slot] = false;
                            if let Some(el) = el { line["el"] = el; }
                        }
                    }
                }
                // The matching mouse_up carries the same tag as its mouse_down.
                if own_down[slot] { line["self"] = true.into(); }
                if !down { own_down[slot] = false; }
                let _ = events.write(&line);
            }
            Ok(Raw::Scroll { ns, x, y, dx, dy }) => {
                if scroll.is_some_and(|s| ns.saturating_sub(s.0) >= SCROLL_WINDOW_NS) { flush_scroll(&mut scroll); }
                let s = scroll.get_or_insert((ns, x, y, 0, 0));
                s.3 += dx;
                s.4 += dy;
            }
            Ok(Raw::Typing { ns }) => {
                if typing.is_some_and(|b| ns.saturating_sub(b.1) >= TYPING_IDLE_NS) { flush_typing(&mut typing); }
                let b = typing.get_or_insert((ns, ns, 0));
                b.1 = ns;
                b.2 += 1;
            }
            Ok(Raw::Key { ns, name, mods }) => {
                let _ = events.write(&json!({ "t": t(ns), "type": "key", "key": name, "mods": mods.names() }));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if let Some((ns, x, y)) = pending_cursor {
            if now.saturating_sub(last_cursor_ns) >= CURSOR_MIN_GAP_NS {
                write_cursor(ns, x, y);
                last_cursor_ns = now;
                pending_cursor = None;
            }
        }
        if scroll.is_some_and(|s| now.saturating_sub(s.0) >= SCROLL_WINDOW_NS) { flush_scroll(&mut scroll); }
        if typing.is_some_and(|b| now.saturating_sub(b.1) >= TYPING_IDLE_NS) { flush_typing(&mut typing); }
        // Secure input turning on mid-burst: the burst so far is still just a count; flush it so
        // nothing about keys spans the secure period.
        if typing.is_some() && unsafe { IsSecureEventInputEnabled() } != 0 { flush_typing(&mut typing); }
    }
    if let Some((ns, x, y)) = pending_cursor { write_cursor(ns, x, y); }
    flush_scroll(&mut scroll);
    flush_typing(&mut typing);
}
