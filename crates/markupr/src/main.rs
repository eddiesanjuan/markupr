mod control;
mod popup;
mod recorder;
mod shell;

use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use markupr_core::{Config, PackDir};
use recorder::{ProcessingOptions, RecordOptions};
use std::{
    fs,
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
    App(RecordOptions),
    Record(RecordOptions),
    Start,
    Stop,
    Mark {
        #[arg(long)]
        note: Option<String>,
    },
    Popup {
        dir: PathBuf,
    },
    Doctor {
        #[arg(long)]
        request: bool,
    },
    Pack {
        dir: PathBuf,
        #[command(flatten)]
        processing: ProcessingOptions,
    },
    Displays,
    Browser {
        #[arg(long)]
        port: Option<u16>,
        #[arg(long)]
        url: Option<String>,
    },
    Prompt {
        dir: Option<PathBuf>,
        #[arg(long)]
        copy: bool,
    },
}
#[derive(Debug)]
enum UserEvent {
    Start,
    Toggle,
    Stop,
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
        Some(Command::Stop) => control::send(serde_json::json!({"cmd":"stop"})),
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
        Some(Command::Prompt { dir, copy }) => prompt(dir, copy),
    }
}

fn prompt(dir: Option<PathBuf>, copy: bool) -> Result<()> {
    let dir = match dir {
        Some(dir) => dir,
        None => fs::read_dir(Config::load()?.packs_dir)?
            .collect::<std::io::Result<Vec<_>>>()?
            .into_iter()
            .filter(|entry| entry.path().join("session.json").is_file())
            .max_by_key(|entry| entry.file_name())
            .ok_or_else(|| anyhow!("no packs found"))?
            .path(),
    };
    let text = markupr_pack::prompt_text(&PackDir::open(&dir)?);
    print!("{text}");
    if copy {
        copy_prompt(&dir)?;
        println!("copied");
    }
    Ok(())
}

// CLI and panel deliberately share this exact clipboard path.
fn copy_prompt(dir: &Path) -> Result<()> {
    let text = markupr_pack::prompt_text(&PackDir::open(dir)?);
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
