use crate::{clock::round_t, PackDir};
use serde::{Deserialize, Serialize, Serializer};
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Session {
    pub schema: String,
    pub id: String,
    pub status: Status,
    pub app_version: String,
    pub clock: SessionClock,
    pub duration: Option<f64>,
    pub display: Option<Display>,
    pub video: Option<Video>,
    pub mic: Option<Mic>,
    pub system_audio: Option<SystemAudio>,
    pub sources: Sources,
    pub permissions: Permissions,
    pub timing: Timing,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Recording,
    Processing,
    Ready,
    Failed,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct SessionClock {
    pub t0_host_ns: u64,
    pub t0_unix_ms: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Display {
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub scale: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Video {
    pub file: String,
    #[serde(serialize_with = "serialize_t")]
    pub start_t: f64,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Mic {
    pub file: String,
    #[serde(serialize_with = "serialize_t")]
    pub start_t: f64,
    pub sample_rate: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct SystemAudio {
    pub file: String,
    pub stream: String,
    #[serde(serialize_with = "serialize_t")]
    pub start_t: f64,
}
fn serialize_t<S: Serializer>(t: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_f64(round_t(*t))
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Sources {
    pub events: bool,
    pub system_log: bool,
    pub browser: Option<Browser>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Browser {
    pub attached: bool,
    pub port: u16,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Permissions {
    pub screen: Option<bool>,
    pub accessibility: Option<bool>,
    pub microphone: Option<bool>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Timing {
    pub stop_unix_ms: Option<u64>,
    pub pack_ready_unix_ms: Option<u64>,
    pub stop_to_ready_ms: Option<u64>,
    pub stages_ms: Option<StagesMs>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct StagesMs {
    pub finalize: u64,
    pub transcribe: u64,
    pub moments: u64,
    pub frames: u64,
    pub write: u64,
}
impl Session {
    pub fn load(pack: &PackDir) -> io::Result<Self> {
        Ok(serde_json::from_slice(&fs::read(pack.session_json())?)?)
    }
    pub fn save(&self, pack: &PackDir) -> io::Result<()> {
        let bytes = serde_json::to_vec_pretty(self)?;
        let temporary = pack
            .root()
            .join(format!(".session-{}.tmp", std::process::id()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        let result = (|| {
            file.write_all(&bytes)?;
            file.write_all(b"\n")?;
            file.sync_all()?;
            fs::rename(&temporary, pack.session_json())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_json_example_from_plan_fails_to_round_trip() {
        let plan = include_str!("../../../PLAN.md");
        let example = plan
            .split("`session.json`:\n\n```json\n")
            .nth(1)
            .unwrap()
            .split("\n```")
            .next()
            .unwrap();
        let expected: serde_json::Value = serde_json::from_str(example).unwrap();
        let session: Session = serde_json::from_value(expected.clone()).unwrap();
        let actual = serde_json::to_value(session).unwrap();
        assert_eq!(actual, expected);
    }
}
