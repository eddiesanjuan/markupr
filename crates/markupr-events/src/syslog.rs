//! Unified log for the frontmost app: one `/usr/bin/log stream` child at a time.
use crate::ax::cap;
use markupr_core::{round_t, Clock, JsonlWriter};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread::JoinHandle,
    time::Instant,
};

const MAX_PER_SEC: u32 = 50;
const MSG_MAX_CHARS: usize = 500;
/// Use the mach timestamp only when it agrees with the line's wall time within this many seconds.
const MACH_WALL_TOLERANCE_S: f64 = 0.5;

#[derive(Default)]
pub struct Stats { pub dropped: u64, pub t_from_mach: u64, pub t_from_wall: u64, window: Option<(Instant, u32)> }

pub struct SysLog {
    writer: JsonlWriter,
    clock: Clock,
    stats: Arc<Mutex<Stats>>,
    current: Option<(i32, Child, JoinHandle<()>)>,
}

impl SysLog {
    pub fn new(writer: JsonlWriter, clock: Clock) -> Self {
        Self { writer, clock, stats: Arc::default(), current: None }
    }

    /// Follow `pid` (or nothing). Restarts the child only when the pid changes.
    pub fn follow(&mut self, pid: Option<i32>) -> Result<(), String> {
        let pid = pid.filter(|p| *p > 0 && *p as u32 != std::process::id());
        if self.current.as_ref().map(|c| c.0) == pid { return Ok(()); }
        self.stop_child();
        let Some(pid) = pid else { return Ok(()) };
        let mut child = Command::new("/usr/bin/log")
            .args(["stream", "--style", "ndjson", "--level", "info", "--process", &pid.to_string()])
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
            .spawn().map_err(|e| format!("system log: cannot start log stream: {e}"))?;
        let stdout = child.stdout.take().expect("piped stdout");
        let (writer, clock, stats) = (self.writer.clone(), self.clock, self.stats.clone());
        let reader = std::thread::Builder::new().name("syslog-reader".into()).spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if let Some(v) = convert(&line, &clock, &stats) { let _ = writer.write(&v); }
            }
        }).map_err(|e| format!("system log: {e}"))?;
        self.current = Some((pid, child, reader));
        Ok(())
    }

    fn stop_child(&mut self) {
        if let Some((_, mut child, reader)) = self.current.take() {
            let _ = child.kill(); // by the child's own PID
            let _ = child.wait();
            let _ = reader.join();
        }
    }

    pub fn finish(mut self) -> (u64, Stats) {
        self.stop_child();
        let _ = self.writer.flush();
        let stats = std::mem::take(&mut *self.stats.lock().unwrap());
        (self.writer.lines_written(), stats)
    }
}

impl Drop for SysLog {
    fn drop(&mut self) { self.stop_child(); }
}

fn convert(line: &str, clock: &Clock, stats: &Mutex<Stats>) -> Option<Value> {
    if !line.starts_with('{') { return None; }
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("eventType")?.as_str()? != "logEvent" { return None; }
    let level = v.get("messageType").and_then(Value::as_str).unwrap_or("default").to_ascii_lowercase();
    let mut st = stats.lock().unwrap();
    if level != "error" && level != "fault" {
        let now = Instant::now();
        let w = st.window.get_or_insert((now, 0));
        if now.duration_since(w.0).as_secs_f64() >= 1.0 { *w = (now, 0); }
        if w.1 >= MAX_PER_SEC { st.dropped += 1; return None; }
        w.1 += 1;
    }
    let t_wall = v.get("timestamp").and_then(Value::as_str)
        .and_then(|s| chrono::DateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f%z").ok())
        .map(|d| clock.t_from_unix_ms(d.timestamp_millis().max(0) as u64));
    let t_mach = v.get("machTimestamp").and_then(Value::as_u64).filter(|m| *m > 0)
        .map(|m| clock.t_from_host_ns(Clock::mach_ticks_to_ns(m)));
    let t = match (t_mach, t_wall) {
        (Some(m), Some(w)) if (m - w).abs() <= MACH_WALL_TOLERANCE_S => { st.t_from_mach += 1; m }
        (_, Some(w)) => { st.t_from_wall += 1; w }
        (Some(m), None) => { st.t_from_mach += 1; m }
        (None, None) => return None,
    };
    drop(st);
    let path = v.get("processImagePath").and_then(Value::as_str).unwrap_or("");
    let process = path.rsplit('/').next().unwrap_or(path);
    let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    Some(json!({
        "t": round_t(t),
        "level": level,
        "process": process,
        "pid": v.get("processID").and_then(Value::as_i64),
        "subsystem": s("subsystem"),
        "category": s("category"),
        "msg": cap(&s("eventMessage"), MSG_MAX_CHARS),
    }))
}
