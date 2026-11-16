use serde::Deserialize;
use std::{env, fs, io, path::PathBuf};
pub fn app_support_dir() -> PathBuf {
    home().join("Library/Application Support/markupr")
}
fn home() -> PathBuf {
    PathBuf::from(env::var_os("HOME").expect("HOME is set"))
}
#[derive(Debug, Deserialize)]
#[serde(default)]
pub struct Config {
    pub packs_dir: PathBuf,
    pub hotkeys: Hotkeys,
    pub whisper: Whisper,
    pub ffmpeg_bin: PathBuf,
    pub video: Video,
    pub browser: Browser,
}
#[derive(Debug, Deserialize)]
#[serde(default)]
pub struct Hotkeys {
    pub toggle: String,
    pub mark: String,
}
#[derive(Debug, Deserialize)]
#[serde(default)]
pub struct Whisper {
    pub bin: PathBuf,
    pub model: Option<PathBuf>,
    pub fast_model: Option<PathBuf>,
}
#[derive(Debug, Deserialize)]
#[serde(default)]
pub struct Video {
    pub fps: u32,
}
#[derive(Debug, Deserialize)]
#[serde(default)]
pub struct Browser {
    pub port: u16,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            packs_dir: home().join("markupr/packs"),
            hotkeys: Hotkeys::default(),
            whisper: Whisper::default(),
            ffmpeg_bin: "ffmpeg".into(),
            video: Video::default(),
            browser: Browser::default(),
        }
    }
}
impl Default for Hotkeys {
    fn default() -> Self {
        Self {
            toggle: "ctrl+alt+KeyR".into(),
            mark: "ctrl+alt+KeyX".into(),
        }
    }
}
impl Default for Whisper {
    fn default() -> Self {
        Self {
            bin: "/opt/homebrew/bin/whisper-cli".into(),
            model: None,
            fast_model: None,
        }
    }
}
impl Default for Video {
    fn default() -> Self {
        Self { fps: 30 }
    }
}
impl Default for Browser {
    fn default() -> Self {
        Self { port: 9222 }
    }
}
impl Config {
    pub fn load() -> io::Result<Self> {
        match fs::read_to_string(app_support_dir().join("config.toml")) {
            Ok(text) => {
                toml::from_str(&text).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e),
        }
    }
}
