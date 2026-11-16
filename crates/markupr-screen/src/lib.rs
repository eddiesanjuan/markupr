//! Screen video, system audio and microphone capture on the mach host clock (macOS 15+).
//!
//! Built on ScreenCaptureKit through the `objc2` bindings, with our own `AVAssetWriter`.
//! Every timestamp this crate reports is host ns: `mach_absolute_time` scaled by the
//! timebase, the clock CoreMedia's host clock and CGEvent timestamps use.
//!
//! Time zero: the writer session starts at the presentation timestamp of the first
//! complete frame it accepted, so for every frame in `video.mp4`,
//! `file time = frame host ns - video.start_host_ns`. Frames arrive only when the
//! screen changes; they keep their real timestamps (variable frame rate). While the stream
//! is alive at stop, the last frame is repeated at the stop time so a still tail keeps its
//! length.

mod capture;
mod wav;

use std::path::PathBuf;
use std::sync::OnceLock;

use serde::Serialize;

pub use capture::ScreenRecorder;

/// Which display to record.
#[derive(Debug, Clone, Serialize)]
pub enum DisplayChoice {
    UnderCursor,
    Id(u32),
}

#[derive(Debug, Clone, Serialize)]
pub struct ScreenConfig {
    pub out_dir: PathBuf,
    pub display: DisplayChoice,
    pub fps: u32,
    pub mic: bool,
    pub system_audio: bool,
}

/// Global display points, origin at the top-left of the main display. `scale` is pixels per point.
#[derive(Debug, Clone, Serialize)]
pub struct DisplayInfo {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub scale: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct VideoInfo {
    pub path: PathBuf,
    // width/height are the file's pixel size: native, or the longer edge capped at 3840.
    /// Host ns of the first frame in the file: file time = host ns - start_host_ns.
    pub start_host_ns: u64,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct MicInfo {
    pub path: PathBuf,
    /// Host ns of the first sample in the file. Sample i is at start_host_ns + i * 1e9 / sample_rate.
    pub start_host_ns: u64,
    pub sample_rate: u32,
    pub channels: u16,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemAudioInfo {
    pub path: PathBuf,
    /// ffmpeg stream specifier inside `path`, e.g. "a:0".
    pub stream: String,
    /// Host ns of the first audio sample in the file.
    pub start_host_ns: u64,
}

/// The stream stopped by itself before stop() (display gone, permission revoked, ...).
#[derive(Debug, Clone, Serialize)]
pub struct CaptureStop {
    pub host_ns: u64,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScreenReport {
    pub display: DisplayInfo,
    /// None when the video could not be finalized or no frame arrived; see `warnings`.
    pub video: Option<VideoInfo>,
    pub mic: Option<MicInfo>,
    pub system_audio: Option<SystemAudioInfo>,
    pub capture_stopped: Option<CaptureStop>,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
pub enum ScreenError {
    /// Screen Recording permission is missing.
    Permission(String),
    /// The requested display does not exist.
    NoDisplay(String),
    /// ScreenCaptureKit refused or failed.
    Capture(String),
    /// The video writer failed.
    Writer(String),
    Io(std::io::Error),
}

impl std::fmt::Display for ScreenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScreenError::Permission(m) => write!(f, "screen recording permission: {m}"),
            ScreenError::NoDisplay(m) => write!(f, "display: {m}"),
            ScreenError::Capture(m) => write!(f, "capture: {m}"),
            ScreenError::Writer(m) => write!(f, "video writer: {m}"),
            ScreenError::Io(e) => write!(f, "io: {e}"),
        }
    }
}

impl std::error::Error for ScreenError {}

impl From<std::io::Error> for ScreenError {
    fn from(e: std::io::Error) -> Self {
        ScreenError::Io(e)
    }
}

#[repr(C)]
struct MachTimebaseInfo {
    numer: u32,
    denom: u32,
}

extern "C" {
    fn mach_absolute_time() -> u64;
    fn mach_timebase_info(info: *mut MachTimebaseInfo) -> i32;
}

fn timebase() -> (u64, u64) {
    static TB: OnceLock<(u64, u64)> = OnceLock::new();
    *TB.get_or_init(|| {
        let mut info = MachTimebaseInfo { numer: 0, denom: 0 };
        // SAFETY: mach_timebase_info fills the struct we pass.
        unsafe { mach_timebase_info(&mut info) };
        (info.numer as u64, info.denom.max(1) as u64)
    })
}

/// Mach absolute ticks to host ns.
pub(crate) fn ticks_to_ns(ticks: u64) -> u64 {
    let (n, d) = timebase();
    ((ticks as u128 * n as u128) / d as u128) as u64
}

/// `mach_absolute_time` scaled to ns by `mach_timebase_info`.
pub fn host_now_ns() -> u64 {
    // SAFETY: plain syscall wrapper with no arguments.
    ticks_to_ns(unsafe { mach_absolute_time() })
}

/// Active displays in global points with their pixel scale.
pub fn list_displays() -> Result<Vec<DisplayInfo>, ScreenError> {
    capture::list_displays()
}
