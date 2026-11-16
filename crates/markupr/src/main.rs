mod control;
mod recorder;

use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use global_hotkey::{hotkey::HotKey, GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
use markupr_core::{Clock, Config, PackDir};
use recorder::{RecordOptions, Recorder};
use signal_hook::{
    consts::{SIGINT, SIGTERM},
    iterator::Signals,
};
use std::{
    path::PathBuf,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use tao::{
    event::Event,
    event_loop::{ControlFlow, EventLoopBuilder},
    platform::{
        macos::{ActivationPolicy, EventLoopExtMacOS},
        run_return::EventLoopExtRunReturn,
    },
};

#[derive(Parser)]
#[command(version, about = "Whole-computer feedback recorder")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    Record(RecordOptions),
    Stop,
    Mark {
        #[arg(long)]
        note: Option<String>,
    },
    Doctor,
    Pack {
        dir: Option<PathBuf>,
    },
}
#[derive(Debug)]
enum UserEvent {
    Stop,
    Mark {
        source: &'static str,
        note: Option<String>,
    },
    Finished(std::result::Result<PathBuf, String>),
}
enum RecorderCommand {
    Stop,
    Mark {
        source: &'static str,
        note: Option<String>,
    },
}
fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Record(opts) => record(opts),
        Command::Stop => control::send(serde_json::json!({"cmd":"stop"})),
        Command::Mark { note } => control::send(serde_json::json!({"cmd":"mark","note":note})),
        Command::Doctor | Command::Pack { .. } => {
            println!("not wired yet");
            Ok(())
        }
    }
}
fn record(mut opts: RecordOptions) -> Result<()> {
    let config = Config::load()?;
    opts.browser_port = Some(opts.browser_port.unwrap_or(config.browser.port));
    let mut event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    event_loop.set_activation_policy(ActivationPolicy::Accessory);
    event_loop.set_dock_visibility(false);
    event_loop.set_activate_ignoring_other_apps(false);
    let proxy = event_loop.create_proxy();
    let control = control::ControlServer::start(proxy.clone())?;
    let hotkeys = GlobalHotKeyManager::new()?;
    let toggle: HotKey = config.hotkeys.toggle.parse()?;
    let mark: HotKey = config.hotkeys.mark.parse()?;
    hotkeys.register(toggle)?;
    hotkeys.register(mark)?;
    eprintln!(
        "hotkeys registered: toggle={} mark={}",
        config.hotkeys.toggle, config.hotkeys.mark
    );
    let hotkey_proxy = proxy.clone();
    GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
        if event.state != HotKeyState::Pressed {
            return;
        }
        let user_event = if event.id == toggle.id() {
            UserEvent::Stop
        } else if event.id == mark.id() {
            UserEvent::Mark {
                source: "hotkey",
                note: None,
            }
        } else {
            return;
        };
        let _ = hotkey_proxy.send_event(user_event);
    }));
    let mut signals = Signals::new([SIGINT, SIGTERM])?;
    let signal_handle = signals.handle();
    let signal_proxy = proxy.clone();
    let signal_worker = thread::Builder::new()
        .name("signals".into())
        .spawn(move || {
            if signals.forever().next().is_some() {
                let _ = signal_proxy.send_event(UserEvent::Stop);
            }
        })?;
    let (commands, receiver) = mpsc::channel();
    let worker = thread::Builder::new()
        .name("recorder".into())
        .spawn(move || {
            let result = (|| -> Result<PathBuf> {
                let pack = PackDir::create_new(opts.out.as_deref().unwrap_or(&config.packs_dir))?;
                let root = pack.root().to_path_buf();
                let deadline = opts
                    .duration
                    .map(|s| Instant::now() + Duration::from_secs_f64(s));
                let clock = Clock::start();
                let recorder = Recorder::start(opts, clock, pack)?;
                eprintln!("recording {}", root.display());
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
                recorder.stop()?;
                Ok(root)
            })()
            .map_err(|e| format!("{e:#}"));
            let _ = proxy.send_event(UserEvent::Finished(result));
        })?;
    let mut outcome = None;
    event_loop.run_return(|event, _, flow| {
        *flow = ControlFlow::Wait;
        if let Event::UserEvent(event) = event {
            match event {
                UserEvent::Stop => {
                    let _ = commands.send(RecorderCommand::Stop);
                }
                UserEvent::Mark { source, note } => {
                    let _ = commands.send(RecorderCommand::Mark { source, note });
                }
                UserEvent::Finished(result) => {
                    outcome = Some(result);
                    *flow = ControlFlow::Exit;
                }
            }
        }
    });
    signal_handle.close();
    let _ = signal_worker.join();
    worker
        .join()
        .map_err(|_| anyhow!("recorder worker panicked"))?;
    drop(control);
    drop(hotkeys);
    let root = outcome
        .ok_or_else(|| anyhow!("event loop exited before recorder finished"))?
        .map_err(|e| anyhow!(e))?;
    println!("{}", root.display());
    Ok(())
}
