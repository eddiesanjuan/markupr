mod control;
mod popup;
mod recorder;
mod shell;

use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use markupr_core::{Config, PackDir};
use recorder::{ProcessingOptions, RecordOptions};
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{Command as ProcessCommand, Stdio},
};

#[derive(Parser)]
#[command(version, about = "Whole-computer feedback recorder")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}
#[derive(Subcommand)]
enum Command {
    /// Run the menu bar app (also the default command).
    App(RecordOptions),
    /// Record once, then build a context pack.
    Record(RecordOptions),
    /// Start recording in the running app.
    Start,
    /// Stop recording and wait for the finished pack.
    Stop {
        #[arg(long)]
        /// Return immediately after requesting stop.
        no_wait: bool,
    },
    /// Print the running state and newest ready pack as JSON.
    Status,
    /// Mark this moment in the running recording.
    Mark {
        /// Add a short note to the mark.
        #[arg(long)]
        note: Option<String>,
    },
    /// Show the native ready panel for an existing pack.
    Popup {
        /// Context pack directory.
        dir: PathBuf,
    },
    /// Check permissions, tools, models, and browser access.
    Doctor {
        /// Ask macOS for missing permissions.
        #[arg(long)]
        request: bool,
    },
    /// Rebuild the derived files in an existing pack.
    Pack {
        /// Context pack directory.
        dir: PathBuf,
        #[command(flatten)]
        processing: ProcessingOptions,
    },
    /// List available displays as JSON.
    Displays,
    /// Open Chrome with a dedicated debug profile.
    Browser {
        /// Debugging port (defaults to the configured port).
        #[arg(long)]
        port: Option<u16>,
        #[arg(long)]
        /// Page to open in the debug browser.
        url: Option<String>,
    },
    /// Extract a screen frame at a session time.
    Frame {
        /// Context pack directory.
        dir: PathBuf,
        /// Time in seconds from the start of the session.
        t: f64,
        /// Output image (defaults to frames/at-T.jpg in the pack).
        #[arg(short, long)]
        output: Option<PathBuf>,
        /// Omit the cursor ring.
        #[arg(long)]
        no_ring: bool,
    },
    /// Print the prompt for a ready pack.
    Prompt {
        /// Pack directory (defaults to the newest ready pack).
        dir: Option<PathBuf>,
        #[arg(long)]
        /// Also copy the prompt to the general pasteboard.
        copy: bool,
    },
}
#[derive(Debug)]
enum UserEvent {
    Start,
    Toggle,
    Stop,
    Control {
        command: control::Command,
        stream: std::os::unix::net::UnixStream,
    },
    Started(PathBuf),
    Signal,
    SelfClick,
    Mark {
        source: &'static str,
        note: Option<String>,
    },
    Processing,
    Finished {
        root: Option<PathBuf>,
        result: std::result::Result<Option<markupr_pack::PackReport>, String>,
    },
    Menu(String),
    Popup(popup::Action),
    Quit,
}
fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        None => {
            // Let clap supply the same defaults as the explicit app subcommand.
            let Some(Command::App(opts)) = Cli::parse_from(["markupr", "app"]).command else {
                unreachable!()
            };
            shell::run(Some(opts), true, None)
        }
        Some(Command::App(opts)) => shell::run(Some(opts), true, None),
        Some(Command::Record(opts)) => shell::run(Some(opts), false, None),
        Some(Command::Popup { dir }) => shell::run(None, false, Some(dir)),
        Some(Command::Start) => control::send(serde_json::json!({"cmd":"start"})),
        Some(Command::Stop { no_wait }) => {
            control::send(serde_json::json!({"cmd":"stop","wait":!no_wait}))
        }
        Some(Command::Status) => {
            control::status();
            Ok(())
        }
        Some(Command::Mark { note }) => {
            control::send(serde_json::json!({"cmd":"mark","note":note}))
        }
        Some(Command::Doctor { request }) => doctor(request),
        Some(Command::Pack { dir, processing }) => {
            let report = recorder::build_pack(
                &PackDir::open(dir)?,
                &Config::load()?,
                &processing.pack_options(),
            )?;
            println!("{}", serde_json::to_string(&report)?);
            Ok(())
        }
        Some(Command::Displays) => {
            println!(
                "{}",
                serde_json::to_string(&markupr_screen::list_displays()?)?
            );
            Ok(())
        }
        Some(Command::Browser { port, url }) => {
            let info = markupr_browser::launch_debug_browser(
                port.unwrap_or(Config::load()?.browser.port),
                url.as_deref(),
            )?;
            println!("{}", serde_json::to_string(&info)?);
            Ok(())
        }
        Some(Command::Frame {
            dir,
            t,
            output,
            no_ring,
        }) => {
            let pack = PackDir::open(dir)?;
            let output = match output {
                Some(output) => output,
                None => {
                    std::fs::create_dir_all(pack.frames_dir())?;
                    pack.frames_dir().join(format!("at-{t}.jpg"))
                }
            };
            let frame = markupr_pack::frame_at(&pack, &Config::load()?, t, &output, !no_ring)
                .map_err(|error| anyhow!("{error}"))?;
            println!("{}", serde_json::to_string(&frame)?);
            Ok(())
        }
        Some(Command::Prompt { dir, copy }) => prompt(dir, copy),
    }
}

fn prompt(dir: Option<PathBuf>, copy: bool) -> Result<()> {
    let dir = match dir {
        Some(dir) => dir,
        None => {
            control::last_pack(&Config::load()?).ok_or_else(|| anyhow!("no ready packs found"))?
        }
    };
    let text = markupr_pack::prompt_text(&control::ready_pack(&dir)?);
    print!("{text}");
    if copy {
        copy_prompt(&dir)?;
        println!("copied");
    }
    Ok(())
}

// CLI and panel deliberately share this exact clipboard path.
fn copy_prompt(dir: &Path) -> Result<()> {
    let text = markupr_pack::prompt_text(&control::ready_pack(dir)?);
    let mut child = ProcessCommand::new("/usr/bin/pbcopy")
        .stdin(Stdio::piped())
        .spawn()?;
    child.stdin.take().unwrap().write_all(text.as_bytes())?;
    anyhow::ensure!(child.wait()?.success(), "pbcopy failed");
    Ok(())
}
fn reveal(dir: &Path) -> Result<()> {
    anyhow::ensure!(
        ProcessCommand::new("/usr/bin/open")
            .arg("-R")
            .arg(dir)
            .status()?
            .success(),
        "Finder reveal failed"
    );
    Ok(())
}
fn ui_debug(message: impl std::fmt::Display) {
    if std::env::var("MARKUPR_UI_DEBUG").as_deref() == Ok("1") {
        eprintln!("{message}");
    }
}

fn doctor(request: bool) -> Result<()> {
    if request {
        markupr_events::permissions::request_missing();
    }
    let permissions = markupr_events::permissions::check();
    for (name, granted) in [
        ("screen", permissions.screen),
        ("accessibility", permissions.accessibility),
        ("input_monitoring", permissions.input_monitoring),
        ("microphone", permissions.microphone),
    ] {
        println!("{name}: {}", if granted { "granted" } else { "missing" });
    }
    let config = Config::load()?;
    for (name, bin, arg) in [
        ("ffmpeg", &config.ffmpeg_bin, "-version"),
        ("whisper-cli", &config.whisper.bin, "--help"),
    ] {
        let runs = ProcessCommand::new(bin)
            .arg(arg)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        println!("{name}: {}", if runs { "runs" } else { "unavailable" });
    }
    for (name, path) in [
        ("accurate_model", &config.whisper.model),
        ("fast_model", &config.whisper.fast_model),
    ] {
        println!(
            "{name}: {}",
            if path.as_ref().is_some_and(|p| p.is_file()) {
                "exists"
            } else {
                "missing or not configured"
            }
        );
    }
    println!(
        "browser (port {}): {}",
        config.browser.port,
        if markupr_browser::debug_endpoint(config.browser.port).is_some() {
            "answers"
        } else {
            "unavailable"
        }
    );
    anyhow::ensure!(
        permissions.screen && permissions.accessibility && permissions.microphone,
        "required permissions missing"
    );
    Ok(())
}
