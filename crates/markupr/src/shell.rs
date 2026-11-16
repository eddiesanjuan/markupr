use crate::{
    control::{self, Command, State},
    copy_prompt,
    popup::{Action, Popup},
    recorder::{RecordOptions, Recorder},
    reveal, ui_debug, UserEvent,
};
use anyhow::{anyhow, Result};
use global_hotkey::{hotkey::HotKey, GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
use markupr_core::{Clock, Config, PackDir};
use signal_hook::{
    consts::{SIGINT, SIGTERM},
    iterator::Signals,
};
use std::{
    path::PathBuf,
    sync::mpsc,
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tao::{
    event::{Event, StartCause},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    platform::{
        macos::{ActivationPolicy, EventLoopExtMacOS},
        run_return::EventLoopExtRunReturn,
    },
};
use tray_icon::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    Icon, TrayIcon, TrayIconBuilder,
};

enum RecorderCommand {
    Stop,
    Mark {
        source: &'static str,
        note: Option<String>,
    },
}
struct Active {
    commands: mpsc::Sender<RecorderCommand>,
    worker: JoinHandle<()>,
}
fn start(opts: RecordOptions, proxy: EventLoopProxy<UserEvent>) -> Result<Active> {
    let (commands, receiver) = mpsc::channel();
    let worker = thread::Builder::new()
        .name("recorder".into())
        .spawn(move || {
            let mut root = None;
            let result = (|| {
                let config = Config::load()?;
                let pack = PackDir::create_new(opts.out.as_deref().unwrap_or(&config.packs_dir))?;
                root = Some(pack.root().to_path_buf());
                let deadline = opts
                    .duration
                    .map(|s| Instant::now() + Duration::from_secs_f64(s));
                let recorder = Recorder::start(opts, Clock::start(), pack, config)?;
                let _ = proxy.send_event(UserEvent::Started(root.as_ref().unwrap().clone()));
                eprintln!("recording {}", root.as_ref().unwrap().display());
                loop {
                    let command = match deadline {
                        Some(deadline) => receiver
                            .recv_timeout(deadline.saturating_duration_since(Instant::now())),
                        None => receiver
                            .recv()
                            .map_err(|_| mpsc::RecvTimeoutError::Disconnected),
                    };
                    match command {
                        Ok(RecorderCommand::Mark { source, note }) => recorder.mark(source, note),
                        Ok(RecorderCommand::Stop) | Err(_) => break,
                    }
                }
                let _ = proxy.send_event(UserEvent::Processing);
                recorder.stop()
            })()
            .map_err(|e: anyhow::Error| format!("{e:#}"));
            let _ = proxy.send_event(UserEvent::Finished { root, result });
        })?;
    Ok(Active { commands, worker })
}
struct Tray {
    icon: TrayIcon,
    toggle: MenuItem,
    mark: MenuItem,
    copy: MenuItem,
    finder: MenuItem,
    toggle_key: String,
}
impl Tray {
    fn new(config: &Config, proxy: EventLoopProxy<UserEvent>, has_last: bool) -> Result<Self> {
        let menu = Menu::new();
        let toggle = MenuItem::with_id("toggle", "Start recording", true, None);
        let mark = MenuItem::with_id(
            "mark",
            format!("Mark ({})", config.hotkeys.mark),
            false,
            None,
        );
        let copy = MenuItem::with_id("copy", "Copy last prompt", has_last, None);
        let finder = MenuItem::with_id("finder", "Show last pack in Finder", has_last, None);
        menu.append_items(&[
            &toggle,
            &mark,
            &PredefinedMenuItem::separator(),
            &copy,
            &finder,
            &MenuItem::with_id("browser", "Open debug browser", true, None),
            &PredefinedMenuItem::separator(),
            &MenuItem::with_id("quit", "Quit", true, None),
        ])?;
        let p = markupr_events::permissions::check();
        if !(p.screen && p.accessibility && p.input_monitoring && p.microphone) {
            menu.append(&MenuItem::new(
                "Permissions missing: run markupr doctor",
                false,
                None,
            ))?;
        }
        MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
            let _ = proxy.send_event(UserEvent::Menu(event.id.0));
        }));
        let icon = TrayIconBuilder::new()
            .with_menu(Box::new(menu))
            .with_icon(icon()?)
            .with_icon_as_template(true)
            .with_title("markupR · idle")
            .with_tooltip("markupR: idle")
            .build()?;
        let tray = Self {
            icon,
            toggle,
            mark,
            copy,
            finder,
            toggle_key: config.hotkeys.toggle.clone(),
        };
        tray.update(State::Idle, has_last, has_last);
        Ok(tray)
    }
    fn update(&self, state: State, has_last: bool, copyable: bool) {
        self.icon.set_title(Some(format!(
            "markupR {} {}",
            match state {
                State::Idle => "·",
                State::Starting => "◌",
                State::Recording => "●",
                State::Processing => "◌",
            },
            state.name()
        )));
        self.icon
            .set_tooltip(Some(format!("markupR: {}", state.name())))
            .ok();
        self.toggle.set_text(format!(
            "{} ({})",
            match state {
                State::Idle => "Start recording",
                State::Starting => "Stop recording",
                State::Recording => "Stop recording",
                State::Processing => "Processing…",
            },
            self.toggle_key
        ));
        self.toggle.set_enabled(state != State::Processing);
        self.mark.set_enabled(state == State::Recording);
        self.copy.set_enabled(copyable);
        self.finder.set_enabled(has_last);
    }
}
fn icon() -> Result<Icon> {
    let mut rgba = vec![0; 18 * 18 * 4];
    for y in 0..18_i32 {
        for x in 0..18_i32 {
            let radius = (x - 9).pow(2) + (y - 9).pow(2);
            if (20..=56).contains(&radius) {
                rgba[((y * 18 + x) * 4 + 3) as usize] = 255;
            }
        }
    }
    Ok(Icon::from_rgba(rgba, 18, 18)?)
}

pub fn run(opts: Option<RecordOptions>, app: bool, existing: Option<PathBuf>) -> Result<()> {
    let config = Config::load()?;
    let popup_only = existing.is_some();
    let wants_popup = app || opts.as_ref().is_some_and(|o| o.popup && !o.no_pack) || popup_only;
    let mut event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    event_loop.set_activation_policy(ActivationPolicy::Accessory);
    event_loop.set_dock_visibility(false);
    event_loop.set_activate_ignoring_other_apps(false);
    let proxy = event_loop.create_proxy();
    let control = if popup_only {
        None
    } else {
        Some(control::ControlServer::start(proxy.clone())?)
    };
    let hotkeys = if popup_only {
        None
    } else {
        let manager = GlobalHotKeyManager::new()?;
        let toggle: HotKey = config.hotkeys.toggle.parse()?;
        let mark: HotKey = config.hotkeys.mark.parse()?;
        manager.register(toggle)?;
        manager.register(mark)?;
        let hotkey_proxy = proxy.clone();
        GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
            if event.state != HotKeyState::Pressed {
                return;
            }
            let event = if event.id == toggle.id() {
                UserEvent::Toggle
            } else if event.id == mark.id() {
                UserEvent::Mark {
                    source: "hotkey",
                    note: None,
                }
            } else {
                return;
            };
            let _ = hotkey_proxy.send_event(event);
        }));
        Some(manager)
    };
    let mut signals = Signals::new([SIGINT, SIGTERM])?;
    let signal_handle = signals.handle();
    let signal_proxy = proxy.clone();
    let signal_worker = thread::Builder::new()
        .name("signals".into())
        .spawn(move || {
            for _ in signals.forever() {
                if signal_proxy.send_event(UserEvent::Signal).is_err() {
                    break;
                }
            }
        })?;
    let mut tray = None;
    let mut state = State::Idle;
    let mut stop_requested = false;
    let mut current_root = None;
    let mut active: Option<Active> = None;
    let mut stop_waiters = Vec::new();
    let mut panel: Option<Popup> = None;
    let mut last = control::last_pack(&config);
    let mut copyable = last.is_some();
    let mut quitting = false;
    let mut signal_received = false;
    let mut outcome: Result<()> = Ok(());
    let mut printed_root = None;
    event_loop.run_return(|event, _, flow| {
        *flow = ControlFlow::Wait;
        if let Some(p) = &panel {
            if Instant::now() >= p.deadline {
                panel.take();
                if !app {
                    *flow = ControlFlow::Exit;
                    return;
                }
            } else {
                *flow = ControlFlow::WaitUntil(p.deadline);
            }
        }
        let event = match event {
            Event::NewEvents(StartCause::Init) => {
                if app {
                    match Tray::new(&config, proxy.clone(), last.is_some()) {
                        Ok(item) => {
                            tray = Some(item);
                            ui_debug("tray: state=idle");
                        }
                        Err(error) => {
                            outcome = Err(error);
                            *flow = ControlFlow::Exit;
                            return;
                        }
                    }
                }
                if let Some(dir) = &existing {
                    match Popup::show(dir.clone(), None, proxy.clone()) {
                        Ok(p) => {
                            *flow = ControlFlow::WaitUntil(p.deadline);
                            let _ = proxy.send_event(UserEvent::SelfClick);
                            panel = Some(p);
                        }
                        Err(error) => {
                            outcome = Err(error);
                            *flow = ControlFlow::Exit;
                        }
                    }
                    return;
                }
                if app {
                    return;
                }
                UserEvent::Start
            }
            Event::UserEvent(event) => event,
            _ => return,
        };
        let event = match event {
            UserEvent::Menu(id) => match id.as_str() {
                "toggle" => UserEvent::Toggle,
                "mark" => UserEvent::Mark {
                    source: "menu",
                    note: None,
                },
                "copy" => {
                    if let Some(dir) = &last {
                        if let Err(e) = copy_prompt(dir) {
                            eprintln!("copy: {e:#}");
                        }
                    }
                    return;
                }
                "finder" => {
                    if let Some(dir) = &last {
                        if let Err(e) = reveal(dir) {
                            eprintln!("Finder: {e:#}");
                        }
                    }
                    return;
                }
                "browser" => {
                    let port = config.browser.port;
                    // Launch can wait for Chrome; keep the main-thread panel and tray responsive.
                    thread::spawn(move || {
                        if let Err(e) = markupr_browser::launch_debug_browser(port, None) {
                            eprintln!("browser: {e}");
                        }
                    });
                    return;
                }
                "quit" => UserEvent::Quit,
                _ => return,
            },
            UserEvent::Toggle => match state {
                State::Idle if app => UserEvent::Start,
                State::Starting | State::Recording => UserEvent::Stop,
                _ => return,
            },
            UserEvent::Signal if signal_received && state == State::Processing => {
                if let Some(root) = &current_root {
                    if let Ok(pack) = PackDir::open(root) {
                        if let Ok(mut session) = markupr_core::Session::load(&pack) {
                            session.status = markupr_core::session::Status::Failed;
                            session.warnings.push("Processing interrupted by a second signal.".into());
                            let _ = session.save(&pack);
                        }
                    }
                }
                std::process::exit(130);
            }
            UserEvent::Signal => { signal_received = true; UserEvent::Quit },
            event => event,
        };
        let mut ack = None;
        let mut ack_ok = true;
        let event = match event {
            UserEvent::Control { command, mut stream } => {
                if !state.accepts(&command) || quitting && !matches!(command, Command::Status) {
                    let mut reply = state.reply(false);
                    reply["error"] = format!("cannot {} while {}", command.name(), state.name()).into();
                    control::reply_to(&mut stream, &reply);
                    return;
                }
                match command {
                    Command::Status => {
                        control::reply_to(&mut stream, &serde_json::json!({"state":state.name(),"last_pack":control::last_pack(&config)}));
                        return;
                    }
                    Command::Stop { wait: true } => { stop_waiters.push(stream); UserEvent::Stop }
                    Command::Stop { wait: false } => { ack = Some(stream); UserEvent::Stop }
                    Command::Start => { ack = Some(stream); UserEvent::Start }
                    Command::Mark { note } => { ack = Some(stream); UserEvent::Mark { source: "cli", note } }
                }
            }
            event => event,
        };
        let previous = state;
        match event {
            UserEvent::Start if state == State::Idle && !popup_only && !quitting => {
                if let Some(mut p) = panel.take() {
                    p.close("close");
                }
                match start(opts.as_ref().unwrap().clone(), proxy.clone()) {
                    Ok(worker) => {
                        active = Some(worker);
                        state = State::Starting;
                        stop_requested = false;
                    }
                    Err(e) => {
                        ack_ok = false;
                        eprintln!("recording: {e:#}");
                        if !app {
                            outcome = Err(e);
                            *flow = ControlFlow::Exit;
                        }
                    }
                }
            }
            UserEvent::Stop if matches!(state, State::Starting | State::Recording) => {
                stop_requested = true;
                if state == State::Recording { state = State::Processing; }
                if let Some(active) = &active {
                    let _ = active.commands.send(RecorderCommand::Stop);
                }
            }
            UserEvent::Started(root) => {
                current_root = Some(root);
                state = State::started(stop_requested);
            }
            UserEvent::Mark { source, note } if state == State::Recording => {
                if let Some(active) = &active {
                    let _ = active.commands.send(RecorderCommand::Mark { source, note });
                }
            }
            UserEvent::Processing => state = State::Processing,
            UserEvent::Finished { root, result } => {
                if let Some(active) = active.take() {
                    let _ = active.worker.join();
                }
                state = State::Idle;
                // Recorder::stop saves session.json before the worker sends Finished.
                let reply = control::stop_reply(root.as_deref(), result.as_ref().err().map(String::as_str));
                for mut stream in stop_waiters.drain(..) {
                    control::reply_to(&mut stream, &reply);
                }
                let report = match result {
                    Ok(report) => report,
                    Err(error) => {
                        eprintln!("recording: {error}");
                        if !app {
                            outcome = Err(anyhow!(error));
                        }
                        None
                    }
                };
                if let Some(root) = root {
                    copyable = control::ready_pack(&root).is_ok();
                    last = Some(root.clone());
                    printed_root = Some(root.clone());
                    if app {
                        println!("{}", root.display());
                    }
                    if wants_popup && !quitting && (report.is_some() || outcome.is_err() || app) {
                        match Popup::show(root, report.as_ref(), proxy.clone()) {
                            Ok(p) => panel = Some(p),
                            Err(e) => {
                                eprintln!("popup: {e:#}");
                                if !app {
                                    outcome = Err(e);
                                }
                            }
                        }
                    }
                }
                if quitting || (!app && panel.is_none()) {
                    *flow = ControlFlow::Exit;
                }
            }
            UserEvent::Popup(action) => {
                if let Some(p) = &mut panel {
                    match action {
                        Action::Copy if p.can_copy() => match if p.selftest_copy { Ok(()) } else { copy_prompt(&p.dir) } {
                            Ok(()) => p.copied(),
                            Err(e) => eprintln!("copy: {e:#}"),
                        },
                        Action::Finder => match reveal(&p.dir) {
                            Ok(()) => {
                                p.close("finder");
                                panel.take();
                            }
                            Err(e) => eprintln!("Finder: {e:#}"),
                        },
                        Action::Close => {
                            p.close("close");
                            panel.take();
                        }
                        _ => {}
                    }
                }
                if !app && panel.is_none() {
                    *flow = ControlFlow::Exit;
                }
            }
            UserEvent::SelfClick => {
                if let Some(panel) = &panel { panel.self_click_copy(); }
            }
            UserEvent::Quit => {
                quitting = true;
                if let Some(mut p) = panel.take() {
                    p.close("close");
                }
                if let Some(active) = &active {
                    stop_requested = true;
                    if state != State::Starting { state = State::Processing; }
                    let _ = active.commands.send(RecorderCommand::Stop);
                } else {
                    *flow = ControlFlow::Exit;
                }
            }
            _ => {}
        }
        if let Some(mut stream) = ack { control::reply_to(&mut stream, &state.reply(ack_ok)); }
        if previous != state && app {
            ui_debug(format!("tray: state={}", state.name()));
        }
        if let Some(tray) = &tray {
            tray.update(state, last.is_some(), copyable);
        }
        if let Some(p) = &panel {
            *flow = ControlFlow::WaitUntil(p.deadline);
        }
    });
    signal_handle.close();
    let _ = signal_worker.join();
    drop(panel);
    drop(tray);
    drop(control);
    drop(hotkeys);
    if !app && outcome.is_ok() {
        if let Some(root) = printed_root {
            println!("{}", root.display());
        }
    }
    outcome
}
