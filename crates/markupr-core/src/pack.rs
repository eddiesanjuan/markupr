use std::{
    fs, io,
    path::{Path, PathBuf},
};
#[derive(Clone, Debug)]
pub struct PackDir {
    root: PathBuf,
}
impl PackDir {
    pub fn create_new(base: &Path) -> io::Result<Self> {
        fs::create_dir_all(base)?;
        let name = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
        for n in 1.. {
            let path = base.join(if n == 1 {
                name.clone()
            } else {
                format!("{name}-{n}")
            });
            match fs::create_dir(&path) {
                Ok(()) => return Self::open(path),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e),
            }
        }
        unreachable!()
    }
    pub fn open(path: impl AsRef<Path>) -> io::Result<Self> {
        let root = fs::canonicalize(path)?;
        if !root.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                "pack is not a directory",
            ));
        }
        Ok(Self { root })
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn session_json(&self) -> PathBuf {
        self.root.join("session.json")
    }
    pub fn video(&self) -> PathBuf {
        self.root.join("video.mp4")
    }
    pub fn mic(&self) -> PathBuf {
        self.root.join("audio/mic.wav")
    }
    pub fn events(&self) -> PathBuf {
        self.root.join("events.jsonl")
    }
    pub fn cursor(&self) -> PathBuf {
        self.root.join("cursor.jsonl")
    }
    pub fn browser_log(&self) -> PathBuf {
        self.root.join("logs/browser.jsonl")
    }
    pub fn system_log(&self) -> PathBuf {
        self.root.join("logs/system.jsonl")
    }
    pub fn transcript_json(&self) -> PathBuf {
        self.root.join("transcript.json")
    }
    pub fn transcript_md(&self) -> PathBuf {
        self.root.join("transcript.md")
    }
    pub fn moments(&self) -> PathBuf {
        self.root.join("moments.json")
    }
    pub fn frames_dir(&self) -> PathBuf {
        self.root.join("frames")
    }
    pub fn summary(&self) -> PathBuf {
        self.root.join("SUMMARY.md")
    }
    pub fn prompt(&self) -> PathBuf {
        self.root.join("PROMPT.md")
    }
}
