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
        use serde::ser::{SerializeMap, Serializer};
        let object = value.as_object().unwrap();
        let mut bytes = Vec::new();
        let mut serializer = serde_json::Serializer::new(&mut bytes);
        let mut map = serializer.serialize_map(Some(object.len()))?;
        for key in ["t", "type"] {
            if let Some(value) = object.get(key) {
                map.serialize_entry(key, value)?;
            }
        }
        for (key, value) in object {
            if key != "t" && key != "type" {
                map.serialize_entry(key, value)?;
            }
        }
        map.end()?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jsonl_alphabetical_keys_hide_time_and_type() {
        let path = std::env::temp_dir().join(format!("markupr-jsonl-{}.jsonl", std::process::id()));
        let writer = JsonlWriter::open(&path).unwrap();
        writer
            .write(&serde_json::json!({"app":"test", "type":"focus", "t":1.2}))
            .unwrap();
        writer.write(&serde_json::json!({"x":1, "t":2.0})).unwrap();
        writer.flush().unwrap();
        let text = fs::read_to_string(&path).unwrap();
        fs::remove_file(path).unwrap();
        let lines: Vec<_> = text.lines().collect();
        assert_eq!(lines[0], r#"{"t":1.2,"type":"focus","app":"test"}"#);
        assert_eq!(lines[1], r#"{"t":2.0,"x":1}"#);
    }
}
