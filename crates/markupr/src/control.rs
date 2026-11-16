use crate::UserEvent;
use anyhow::{bail, Context, Result};
use markupr_core::{config::app_support_dir, session::Status, Config, PackDir, Session};
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Write},
    os::{
        fd::AsRawFd,
        unix::net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use tao::event_loop::EventLoopProxy;

pub struct ControlServer {
    path: PathBuf,
    _lock: File,
    stopping: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}
impl ControlServer {
    pub fn start(proxy: EventLoopProxy<UserEvent>) -> Result<Self> {
        let dir = app_support_dir();
        fs::create_dir_all(&dir)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(dir.join("control.lock"))?;
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            bail!(
                "another markupr recorder or app is already running ({})",
                std::io::Error::last_os_error()
            );
        }
        let path = dir.join("control.sock");
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        let listener = UnixListener::bind(&path)?;
        listener.set_nonblocking(true)?;
        let stopping = Arc::new(AtomicBool::new(false));
        let stop = stopping.clone();
        let worker = thread::Builder::new()
            .name("control-socket".into())
            .spawn(move || {
                while !stop.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            let reply = handle_request(&mut stream, &|event| {
                                proxy
                                    .send_event(event)
                                    .map_err(|_| anyhow::anyhow!("recorder has stopped"))
                            });
                            match reply {
                                Ok(Some(value)) => reply_to(&mut stream, &value),
                                Ok(None) => {} // The main loop owns the deferred reply.
                                Err(e) => reply_to(
                                    &mut stream,
                                    &json!({"ok":false,"error":e.to_string()}),
                                ),
                            }
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(20))
                        }
                        Err(e) => {
                            eprintln!("control socket: {e}");
                            break;
                        }
                    }
                }
            })?;
        Ok(Self {
            path,
            _lock: lock,
            stopping,
            worker: Some(worker),
        })
    }
}
fn handle_request(
    stream: &mut UnixStream,
    dispatch: &impl Fn(UserEvent) -> Result<()>,
) -> Result<Option<Value>> {
    stream.set_read_timeout(Some(Duration::from_secs(1)))?;
    stream.set_write_timeout(Some(Duration::from_secs(1)))?;
    let mut line = String::new();
    BufReader::new(&mut *stream).read_line(&mut line)?;
    let value: Value = serde_json::from_str(&line)?;
    let command = match value["cmd"].as_str() {
        Some("start") => Command::Start,
        Some("stop") => Command::Stop {
            wait: value["wait"] != false,
        },
        Some("status") => Command::Status,
        Some("mark") => Command::Mark {
            note: match &value["note"] {
                Value::Null => None,
                Value::String(note) => Some(note.clone()),
                _ => bail!("note must be a string or null"),
            },
        },
        _ => bail!("unknown command"),
    };
    dispatch(UserEvent::Control {
        command,
        stream: stream.try_clone()?,
    })?;
    Ok(None)
}

#[derive(Debug)]
pub enum Command {
    Start,
    Stop { wait: bool },
    Mark { note: Option<String> },
    Status,
}
impl Command {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Stop { .. } => "stop",
            Self::Mark { .. } => "mark",
            Self::Status => "status",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum State {
    Idle,
    Starting,
    Recording,
    Processing,
}
impl State {
    pub fn name(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Starting => "starting",
            Self::Recording => "recording",
            Self::Processing => "processing",
        }
    }
    pub fn accepts(self, command: &Command) -> bool {
        match command {
            Command::Start => self == Self::Idle,
            Command::Mark { .. } => self == Self::Recording,
            Command::Stop { wait } => {
                matches!(self, Self::Starting | Self::Recording)
                    || (*wait && self == Self::Processing)
            }
            Command::Status => true,
        }
    }
    pub fn started(stop_requested: bool) -> Self {
        if stop_requested {
            Self::Processing
        } else {
            Self::Recording
        }
    }
    pub fn reply(self, ok: bool) -> Value {
        json!({"ok":ok,"state":self.name()})
    }
}

pub fn reply_to(stream: &mut UnixStream, value: &Value) {
    let _ = writeln!(stream, "{value}");
}
pub fn stop_reply(pack: Option<&Path>, error: Option<&str>) -> Value {
    match (pack, error) {
        (Some(pack), None) => json!({"ok":true,"state":"idle","pack":pack,"status":"ready"}),
        (Some(pack), Some(error)) => {
            json!({"ok":false,"state":"idle","pack":pack,"status":"failed","error":error})
        }
        (None, _) => json!({"ok":false,"error":error.unwrap_or("no pack was created")}),
    }
}
impl Drop for ControlServer {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Relaxed);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        let _ = fs::remove_file(&self.path);
    }
}
fn request(request: &Value) -> Result<Value> {
    let mut stream = UnixStream::connect(app_support_dir().join("control.sock"))
        .context("no running markupr recorder")?;
    let waited_stop = request["cmd"] == "stop" && request["wait"] != false;
    stream.set_read_timeout((!waited_stop).then(|| Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    writeln!(stream, "{request}")?;
    let mut reply = String::new();
    BufReader::new(stream).read_line(&mut reply)?;
    let value: Value = serde_json::from_str(&reply)?;
    Ok(value)
}
pub fn send(value: Value) -> Result<()> {
    let value = request(&value).map_err(|error| anyhow::anyhow!("{error}"))?;
    write_reply(&value, &mut std::io::stdout().lock())
}
fn write_reply(value: &Value, output: &mut impl Write) -> Result<()> {
    writeln!(output, "{value}")?;
    if let Some(pack) = value["pack"].as_str() {
        writeln!(output, "{pack}")?;
    }
    if value["ok"] != true {
        bail!(
            "{}",
            value["error"].as_str().unwrap_or("control request failed")
        );
    }
    Ok(())
}

pub fn last_pack(config: &Config) -> Option<PathBuf> {
    fs::read_dir(&config.packs_dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| ready_pack(path).is_ok())
        .max()?
        .canonicalize()
        .ok()
}

pub fn ready_pack(dir: &Path) -> Result<PackDir> {
    let pack = PackDir::open(dir)?;
    anyhow::ensure!(
        Session::load(&pack)?.status == Status::Ready,
        "pack is not ready: {}",
        pack.root().display()
    );
    Ok(pack)
}

pub fn status() {
    let value = request(&json!({"cmd":"status"})).ok().filter(|value| {
        matches!(value["state"].as_str(), Some("idle" | "starting" | "recording" | "processing"))
    }).unwrap_or_else(|| {
        json!({"state":"not_running", "last_pack":Config::load().ok().and_then(|config| last_pack(&config))})
    });
    println!("{value}");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Read, sync::mpsc};

    #[test]
    fn control_requests_wait_for_the_main_loop_to_decide_their_state() -> Result<()> {
        let (dispatch, events) = mpsc::channel();
        for command in ["start", "mark", "stop", "status"] {
            let (mut client, mut server) = UnixStream::pair()?;
            writeln!(client, "{}", json!({"cmd":command}))?;
            assert!(handle_request(&mut server, &|event| dispatch
                .send(event)
                .map_err(Into::into))?
            .is_none());
            let UserEvent::Control {
                command: parsed,
                mut stream,
            } = events.recv_timeout(Duration::from_secs(1))?
            else {
                panic!("missing control event")
            };
            assert_eq!(parsed.name(), command);
            client.set_nonblocking(true)?;
            assert_eq!(
                client.read(&mut [0]).unwrap_err().kind(),
                std::io::ErrorKind::WouldBlock
            );
            client.set_nonblocking(false)?;
            client.set_read_timeout(Some(Duration::from_secs(1)))?;
            reply_to(&mut stream, &State::Starting.reply(true));
            let mut line = String::new();
            BufReader::new(client).read_line(&mut line)?;
            assert_eq!(
                serde_json::from_str::<Value>(&line)?,
                json!({"ok":true,"state":"starting"})
            );
        }
        Ok(())
    }
    #[test]
    fn early_stop_is_honored_after_start_and_invalid_commands_are_rejected() {
        assert_eq!(State::started(false), State::Recording);
        assert_eq!(State::started(true), State::Processing);
        for state in [
            State::Idle,
            State::Starting,
            State::Recording,
            State::Processing,
        ] {
            assert_eq!(state.accepts(&Command::Start), state == State::Idle);
            assert_eq!(
                state.accepts(&Command::Mark { note: None }),
                state == State::Recording
            );
            assert_eq!(
                state.accepts(&Command::Stop { wait: false }),
                matches!(state, State::Starting | State::Recording)
            );
            assert_eq!(
                state.accepts(&Command::Stop { wait: true }),
                state != State::Idle
            );
        }
    }
    #[test]
    fn ready_and_failed_stop_replies_put_the_absolute_pack_path_last() -> Result<()> {
        let pack = Path::new("/tmp/markupr-unit-pack");
        for error in [None, Some("pack failed")] {
            let reply = stop_reply(Some(pack), error);
            let mut output = Vec::new();
            assert_eq!(write_reply(&reply, &mut output).is_ok(), error.is_none());
            assert_eq!(
                reply["status"],
                if error.is_none() { "ready" } else { "failed" }
            );
            assert_eq!(
                String::from_utf8(output)?.lines().last(),
                Some("/tmp/markupr-unit-pack")
            );
        }
        Ok(())
    }
    #[test]
    fn unfinished_or_failed_packs_cannot_be_selected_or_copied() -> Result<()> {
        let root = std::env::temp_dir().join(format!(
            "markupr-l9-ready-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos()
        ));
        let config = Config {
            packs_dir: root.clone(),
            ..Config::default()
        };
        let mut ready = None;
        for (n, status) in ["ready", "recording", "processing", "failed"]
            .into_iter()
            .enumerate()
        {
            let dir = root.join(format!("2026-11-16_14-0{n}-00"));
            fs::create_dir_all(&dir)?;
            fs::write(
                dir.join("session.json"),
                serde_json::to_vec(
                    &json!({"schema":"markupr.pack/1","id":"fixture","status":status,"app_version":"test","clock":{"t0_host_ns":0,"t0_unix_ms":0},"sources":{"events":false,"system_log":false},"permissions":{},"timing":{}}),
                )?,
            )?;
            if n == 0 {
                ready = Some(dir.canonicalize()?);
            } else {
                assert!(ready_pack(&dir).is_err());
            }
        }
        let actual = last_pack(&config);
        fs::remove_dir_all(&root)?;
        assert_eq!(actual, ready);
        Ok(())
    }
}
