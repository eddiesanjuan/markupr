use crate::UserEvent;
use anyhow::{bail, Context, Result};
use markupr_core::config::app_support_dir;
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Write},
    os::{
        fd::AsRawFd,
        unix::net::{UnixListener, UnixStream},
    },
    path::PathBuf,
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
                            let reply = handle_request(&mut stream, &proxy);
                            let value = match reply {
                                Ok(()) => json!({"ok":true}),
                                Err(e) => json!({"ok":false,"error":e.to_string()}),
                            };
                            let _ = writeln!(stream, "{value}");
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
fn handle_request(stream: &mut UnixStream, proxy: &EventLoopProxy<UserEvent>) -> Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(1)))?;
    stream.set_write_timeout(Some(Duration::from_secs(1)))?;
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line)?;
    let value: Value = serde_json::from_str(&line)?;
    let event = match value["cmd"].as_str() {
        Some("start") => UserEvent::Start,
        Some("stop") => UserEvent::Stop,
        Some("mark") => {
            let note = match &value["note"] {
                Value::Null => None,
                Value::String(s) => Some(s.clone()),
                _ => bail!("note must be a string or null"),
            };
            UserEvent::Mark {
                source: "cli",
                note,
            }
        }
        _ => bail!("unknown command"),
    };
    proxy
        .send_event(event)
        .map_err(|_| anyhow::anyhow!("recorder has stopped"))?;
    Ok(())
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
pub fn send(request: Value) -> Result<()> {
    let mut stream = UnixStream::connect(app_support_dir().join("control.sock"))
        .context("no running markupr recorder")?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    writeln!(stream, "{request}")?;
    let mut reply = String::new();
    BufReader::new(stream).read_line(&mut reply)?;
    let value: Value = serde_json::from_str(&reply)?;
    if value["ok"] != true {
        bail!(
            "{}",
            value["error"].as_str().unwrap_or("control request failed")
        );
    }
    println!("{}", reply.trim_end());
    Ok(())
}
