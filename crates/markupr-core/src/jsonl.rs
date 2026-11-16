use std::{
    fs::{self, File, OpenOptions},
    io::{self, BufWriter, Write},
    path::Path,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

struct State {
    writer: BufWriter<File>,
    lines: u64,
}
struct Inner(Mutex<State>);
impl Drop for Inner {
    fn drop(&mut self) {
        if let Ok(state) = self.0.get_mut() {
            let _ = state.writer.flush();
        }
    }
}
#[derive(Clone)]
pub struct JsonlWriter {
    inner: Arc<Inner>,
}
impl JsonlWriter {
    pub fn open(path: impl AsRef<Path>) -> io::Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            fs::create_dir_all(parent)?;
        }
        let writer = BufWriter::new(OpenOptions::new().create(true).append(true).open(path)?);
        let inner = Arc::new(Inner(Mutex::new(State { writer, lines: 0 })));
        let weak = Arc::downgrade(&inner);
        thread::Builder::new()
            .name("jsonl-flush".into())
            .spawn(move || loop {
                thread::sleep(Duration::from_millis(200));
                let Some(inner) = weak.upgrade() else { break };
                if let Ok(mut state) = inner.0.lock() {
                    let _ = state.writer.flush();
                };
            })?;
        Ok(Self { inner })
    }
    pub fn write<T: serde::Serialize>(&self, v: &T) -> io::Result<()> {
        let value = serde_json::to_value(v)?;
        if !value.is_object() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "JSONL entries must be objects",
            ));
        }
        let mut bytes = serde_json::to_vec(&value)?;
        bytes.push(b'\n');
        let mut state = self.inner.0.lock().unwrap();
        state.writer.write_all(&bytes)?;
        state.lines += 1;
        Ok(())
    }
    pub fn flush(&self) -> io::Result<()> {
        self.inner.0.lock().unwrap().writer.flush()
    }
    pub fn lines_written(&self) -> u64 {
        self.inner.0.lock().unwrap().lines
    }
}
