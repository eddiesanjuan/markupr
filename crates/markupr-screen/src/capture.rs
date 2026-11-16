//! ScreenCaptureKit stream feeding our own AVAssetWriter (video + system audio) and a WAV (mic).

use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchRetained};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass, Message};
use objc2_av_foundation::{
    AVAssetWriter, AVAssetWriterInput, AVAssetWriterStatus, AVFileTypeMPEG4, AVMediaTypeAudio,
    AVMediaTypeVideo, AVVideoAllowFrameReorderingKey, AVVideoCodecKey, AVVideoCodecTypeH264,
    AVVideoCompressionPropertiesKey, AVVideoExpectedSourceFrameRateKey, AVVideoHeightKey,
    AVVideoMaxKeyFrameIntervalKey, AVVideoWidthKey,
};
use objc2_core_audio_types::AudioStreamBasicDescription;
use objc2_core_foundation::{CFArray, CFRetained};
use objc2_core_graphics::{
    CGDisplayBounds, CGDisplayCopyDisplayMode, CGDisplayMode, CGEvent, CGGetActiveDisplayList,
    CGMainDisplayID, CGPreflightScreenCaptureAccess,
};
use objc2_core_media::{
    CMAudioFormatDescriptionGetStreamBasicDescription, CMSampleBuffer, CMSampleTimingInfo, CMTime,
    CMTimeFlags,
};
use objc2_foundation::{NSArray, NSDictionary, NSError, NSNumber, NSObject, NSObjectProtocol, NSString, NSURL};
use objc2_screen_capture_kit::{
    SCContentFilter, SCFrameStatus, SCShareableContent, SCStream, SCStreamConfiguration,
    SCStreamFrameInfoDisplayTime, SCStreamFrameInfoStatus, SCStreamOutput, SCStreamOutputType,
};

use crate::wav::WavWriter;
use crate::{
    host_now_ns, ticks_to_ns, DisplayChoice, DisplayInfo, MicInfo, ScreenConfig, ScreenError,
    ScreenReport, SystemAudioInfo, VideoInfo,
};

const WAIT: Duration = Duration::from_secs(10);
/// kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange ('420v'), the encoder's native input.
const PIXEL_420V: u32 = u32::from_be_bytes(*b"420v");
const AAC: u32 = u32::from_be_bytes(*b"aac ");
const SYS_RATE: u32 = 48_000;
const SYS_CHANNELS: u32 = 2;

/// Moves an Objective-C object across threads. ScreenCaptureKit and AVFoundation objects used
/// here are thread-safe for the calls we make; every access is serialized by a Mutex or the
/// single sample queue.
struct SendBox<T>(T);
unsafe impl<T> Send for SendBox<T> {}

// ---------- displays ----------

pub(crate) fn list_displays() -> Result<Vec<DisplayInfo>, ScreenError> {
    let mut ids = [0u32; 32];
    let mut count = 0u32;
    // SAFETY: buffer and count pointers are valid for 32 entries.
    let err = unsafe { CGGetActiveDisplayList(ids.len() as u32, ids.as_mut_ptr(), &mut count) };
    if err.0 != 0 {
        return Err(ScreenError::NoDisplay(format!("CGGetActiveDisplayList error {}", err.0)));
    }
    Ok(ids[..count as usize].iter().map(|&id| display_info(id)).collect())
}

fn display_info(id: u32) -> DisplayInfo {
    let b = CGDisplayBounds(id);
    let mode = CGDisplayCopyDisplayMode(id);
    let pw = CGDisplayMode::pixel_width(mode.as_deref()) as f64;
    let scale = if b.size.width > 0.0 && pw > 0.0 { pw / b.size.width } else { 1.0 };
    DisplayInfo { id, x: b.origin.x, y: b.origin.y, w: b.size.width, h: b.size.height, scale }
}

fn choose_display(choice: &DisplayChoice) -> Result<DisplayInfo, ScreenError> {
    let all = list_displays()?;
    match choice {
        DisplayChoice::Id(id) => all
            .into_iter()
            .find(|d| d.id == *id)
            .ok_or_else(|| ScreenError::NoDisplay(format!("no active display with id {id}"))),
        DisplayChoice::UnderCursor => {
            let p = CGEvent::new(None).map(|e| CGEvent::location(Some(&e)));
            let main = CGMainDisplayID();
            let hit = p.and_then(|p| {
                all.iter().find(|d| p.x >= d.x && p.x < d.x + d.w && p.y >= d.y && p.y < d.y + d.h)
            });
            hit.or_else(|| all.iter().find(|d| d.id == main))
                .or(all.first())
                .cloned()
                .ok_or_else(|| ScreenError::NoDisplay("no active displays".into()))
        }
    }
}

// ---------- time helpers ----------

/// CMTime to ns on its own clock (host clock for ScreenCaptureKit samples).
fn cmtime_ns(t: CMTime) -> Option<u64> {
    if !t.flags.contains(CMTimeFlags::Valid) || t.timescale <= 0 || t.value < 0 {
        return None;
    }
    Some((t.value as i128 * 1_000_000_000 / t.timescale as i128) as u64)
}

fn ns_cmtime(ns: u64) -> CMTime {
    CMTime { value: ns as i64, timescale: 1_000_000_000, flags: CMTimeFlags::Valid, epoch: 0 }
}

// ---------- shared capture state ----------

#[derive(Default, Clone, Copy)]
struct LagStats {
    n: u64,
    min: i64,
    max: i64,
    sum: i128,
}

impl LagStats {
    fn add(&mut self, v: i64) {
        if self.n == 0 {
            self.min = v;
            self.max = v;
        }
        self.min = self.min.min(v);
        self.max = self.max.max(v);
        self.sum += v as i128;
        self.n += 1;
    }
    fn json(&self) -> String {
        let mean = if self.n > 0 { self.sum / self.n as i128 } else { 0 };
        format!(r#"{{"n":{},"min_ns":{},"mean_ns":{},"max_ns":{}}}"#, self.n, self.min, mean, self.max)
    }
}

struct State {
    writer: Retained<AVAssetWriter>,
    video_in: Retained<AVAssetWriterInput>,
    audio_in: Option<Retained<AVAssetWriterInput>>,
    /// Host ns of the first accepted frame; the writer session starts here.
    video_start: Option<u64>,
    /// Host ns of every frame accepted by the writer, in order.
    frames: Vec<u64>,
    /// window-server display time (host ns) for each accepted frame, when attached.
    frame_display: Vec<Option<u64>>,
    frames_dropped_not_ready: u64,
    frames_idle: u64,
    last_frame_ns: u64,
    /// Last accepted frame, re-appended at the stop time so a still tail keeps its length.
    last_frame: Option<CFRetained<CMSampleBuffer>>,
    sys_first: Option<u64>,
    sys_buffers: u64,
    sys_dropped: u64,
    mic_path: PathBuf,
    mic: Option<WavWriter>,
    mic_wanted: bool,
    mic_buffers: u64,
    mic_channels_in: u32,
    lag_video: LagStats,
    lag_sys: LagStats,
    lag_mic: LagStats,
    errors: Vec<String>,
    /// Set by stop() under the lock; later callbacks are ignored.
    stopped: bool,
}

struct OutputIvars {
    state: Arc<Mutex<SendBox<State>>>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "MarkuprScreenOutput"]
    #[ivars = OutputIvars]
    struct Output;

    unsafe impl NSObjectProtocol for Output {}

    unsafe impl SCStreamOutput for Output {
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        fn did_output(&self, _stream: &SCStream, sb: &CMSampleBuffer, kind: SCStreamOutputType) {
            let now = host_now_ns();
            let mut guard = match self.ivars().state.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            let st = &mut guard.0;
            if st.stopped {
                return;
            }
            if kind == SCStreamOutputType::Screen {
                on_screen(st, sb, now);
            } else if kind == SCStreamOutputType::Audio {
                on_system_audio(st, sb, now);
            } else if kind == SCStreamOutputType::Microphone {
                on_mic(st, sb, now);
            }
        }
    }
);

impl Output {
    fn new(state: Arc<Mutex<SendBox<State>>>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(OutputIvars { state });
        unsafe { msg_send![super(this), init] }
    }
}

/// First attachment dictionary of a ScreenCaptureKit sample buffer.
fn frame_info(sb: &CMSampleBuffer) -> Option<Retained<NSDictionary<NSString, AnyObject>>> {
    // SAFETY: CFArray of CFDictionary is toll-free bridged to NSArray of NSDictionary.
    let arr = unsafe { sb.sample_attachments_array(false) }?;
    let arr: &NSArray<NSDictionary<NSString, AnyObject>> =
        unsafe { &*(&*arr as *const CFArray as *const NSArray<NSDictionary<NSString, AnyObject>>) };
    arr.firstObject()
}

fn number(dict: &NSDictionary<NSString, AnyObject>, key: &NSString) -> Option<Retained<NSNumber>> {
    dict.objectForKey(key)?.downcast::<NSNumber>().ok()
}

fn on_screen(st: &mut State, sb: &CMSampleBuffer, now: u64) {
    let Some(info) = frame_info(sb) else { return };
    let status = number(&info, unsafe { SCStreamFrameInfoStatus }).map(|n| n.integerValue());
    if status != Some(SCFrameStatus::Complete.0) {
        st.frames_idle += 1;
        return;
    }
    let Some(pts) = cmtime_ns(unsafe { sb.presentation_time_stamp() }) else { return };
    if !unsafe { st.video_in.isReadyForMoreMediaData() } {
        st.frames_dropped_not_ready += 1;
        return;
    }
    if st.video_start.is_none() {
        unsafe { st.writer.startSessionAtSourceTime(sb.presentation_time_stamp()) };
        st.video_start = Some(pts);
    }
    if unsafe { st.video_in.appendSampleBuffer(sb) } {
        st.frames.push(pts);
        let disp = number(&info, unsafe { SCStreamFrameInfoDisplayTime })
            .map(|n| ticks_to_ns(n.unsignedLongLongValue()));
        st.frame_display.push(disp);
        st.last_frame_ns = pts;
        st.last_frame = Some(sb.retain().into());
        st.lag_video.add(now as i64 - pts as i64);
    } else {
        let e = unsafe { st.writer.error() }.map(|e| e.to_string()).unwrap_or_default();
        st.errors.push(format!("video append failed: {e}"));
    }
}

fn on_system_audio(st: &mut State, sb: &CMSampleBuffer, now: u64) {
    st.sys_buffers += 1;
    let (Some(start), Some(input)) = (st.video_start, st.audio_in.as_ref()) else { return };
    let Some(pts) = cmtime_ns(unsafe { sb.presentation_time_stamp() }) else { return };
    st.lag_sys.add(now as i64 - pts as i64);
    // Nothing before the video's time zero goes in the file.
    if pts < start {
        return;
    }
    if !unsafe { input.isReadyForMoreMediaData() } {
        st.sys_dropped += 1;
        return;
    }
    if unsafe { input.appendSampleBuffer(sb) } {
        st.sys_first.get_or_insert(pts);
    } else {
        st.sys_dropped += 1;
    }
}

fn on_mic(st: &mut State, sb: &CMSampleBuffer, now: u64) {
    st.mic_buffers += 1;
    if !st.mic_wanted {
        return;
    }
    let Some(pts) = cmtime_ns(unsafe { sb.presentation_time_stamp() }) else { return };
    st.lag_mic.add(now as i64 - pts as i64);
    let Some((asbd, mono)) = decode_mono(sb) else {
        st.errors.push("mic: unsupported sample format".into());
        st.mic_wanted = false;
        return;
    };
    st.mic_channels_in = asbd.mChannelsPerFrame;
    if st.mic.is_none() {
        match WavWriter::create(&st.mic_path, asbd.mSampleRate.round() as u32, pts) {
            Ok(w) => st.mic = Some(w),
            Err(e) => {
                st.errors.push(format!("mic: {e}"));
                st.mic_wanted = false;
                return;
            }
        }
    }
    if let Some(w) = st.mic.as_mut() {
        if let Err(e) = w.push(pts, &mono) {
            st.errors.push(format!("mic write: {e}"));
            st.mic_wanted = false;
        }
    }
}

const FLAG_FLOAT: u32 = 1;
const FLAG_SIGNED_INT: u32 = 1 << 2;
const FLAG_NON_INTERLEAVED: u32 = 1 << 5;
const LPCM: u32 = u32::from_be_bytes(*b"lpcm");

/// Decode an LPCM sample buffer (float32 or int16, interleaved or not) to mono i16.
fn decode_mono(sb: &CMSampleBuffer) -> Option<(AudioStreamBasicDescription, Vec<i16>)> {
    let fmt = unsafe { sb.format_description() }?;
    let asbd = *unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(&fmt).as_ref() }?;
    if asbd.mFormatID != LPCM || asbd.mChannelsPerFrame == 0 {
        return None;
    }
    let frames = unsafe { sb.num_samples() }.max(0) as usize;
    let block = unsafe { sb.data_buffer() }?;
    let len = unsafe { block.data_length() };
    let mut bytes = vec![0u8; len];
    if len > 0 {
        let ok = unsafe { block.copy_data_bytes(0, len, NonNull::new(bytes.as_mut_ptr().cast())?) };
        if ok != 0 {
            return None;
        }
    }
    let ch = asbd.mChannelsPerFrame as usize;
    let bits = asbd.mBitsPerChannel;
    let float = asbd.mFormatFlags & FLAG_FLOAT != 0;
    let planar = asbd.mFormatFlags & FLAG_NON_INTERLEAVED != 0;
    let bps = (bits / 8) as usize;
    let int16 = asbd.mFormatFlags & FLAG_SIGNED_INT != 0 && bits == 16;
    if !(float && bits == 32 || int16) {
        return None;
    }
    if bytes.len() < frames * ch * bps {
        return None;
    }
    let sample = |i: usize| -> f32 {
        let b = &bytes[i * bps..i * bps + bps];
        if float {
            f32::from_le_bytes([b[0], b[1], b[2], b[3]])
        } else {
            i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0
        }
    };
    let mut out = Vec::with_capacity(frames);
    for f in 0..frames {
        let mut acc = 0.0f32;
        for c in 0..ch {
            acc += if planar { sample(c * frames + f) } else { sample(f * ch + c) };
        }
        out.push(((acc / ch as f32).clamp(-1.0, 1.0) * 32767.0) as i16);
    }
    Some((asbd, out))
}

fn append_copy_at(input: &AVAssetWriterInput, sb: &CMSampleBuffer, at_ns: u64) -> Result<(), String> {
    let invalid = CMTime { value: 0, timescale: 0, flags: CMTimeFlags(0), epoch: 0 };
    let timing = CMSampleTimingInfo { duration: invalid, presentationTimeStamp: ns_cmtime(at_ns), decodeTimeStamp: invalid };
    let mut out: *mut CMSampleBuffer = std::ptr::null_mut();
    let err = unsafe { CMSampleBuffer::create_copy_with_new_timing(None, sb, 1, &timing, NonNull::from(&mut out)) };
    let copy = NonNull::new(out).filter(|_| err == 0).ok_or(format!("copy failed ({err})"))?;
    // SAFETY: a Create function returns a +1 reference.
    let copy = unsafe { CFRetained::from_raw(copy) };
    let deadline = std::time::Instant::now() + Duration::from_secs(1);
    while !unsafe { input.isReadyForMoreMediaData() } {
        if std::time::Instant::now() > deadline {
            return Err("encoder not ready".into());
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    if unsafe { input.appendSampleBuffer(&copy) } {
        Ok(())
    } else {
        Err("append refused".into())
    }
}

// ---------- recorder ----------

pub struct ScreenRecorder {
    stream: Retained<SCStream>,
    _output: Retained<Output>,
    queue: DispatchRetained<DispatchQueue>,
    state: Arc<Mutex<SendBox<State>>>,
    display: crate::DisplayInfo,
    cfg: ScreenConfig,
    width: u32,
    height: u32,
    warnings: Vec<String>,
}

// The SCStream and queue are only touched from start/stop, which take ownership.
unsafe impl Send for ScreenRecorder {}

fn wait<T>(rx: &mpsc::Receiver<T>, what: &str) -> Result<T, ScreenError> {
    rx.recv_timeout(WAIT)
        .map_err(|_| ScreenError::Capture(format!("timed out waiting for {what}")))
}

fn ns_err(e: *mut NSError) -> Option<String> {
    // SAFETY: completion handlers pass either null or a valid NSError.
    unsafe { e.as_ref() }.map(|e| e.localizedDescription().to_string())
}

fn shareable_content() -> Result<Retained<SCShareableContent>, ScreenError> {
    let (tx, rx) = mpsc::channel::<Result<SendBox<Retained<SCShareableContent>>, String>>();
    let block = RcBlock::new(move |content: *mut SCShareableContent, err: *mut NSError| {
        let r = match (unsafe { Retained::retain(content) }, ns_err(err)) {
            (Some(c), None) => Ok(SendBox(c)),
            (_, e) => Err(e.unwrap_or_else(|| "no shareable content".into())),
        };
        let _ = tx.send(r);
    });
    unsafe { SCShareableContent::getShareableContentWithCompletionHandler(&block) };
    match wait(&rx, "shareable content")? {
        Ok(c) => Ok(c.0),
        Err(e) => Err(ScreenError::Capture(e)),
    }
}

fn num_i(v: i64) -> Retained<AnyObject> {
    Retained::into_super(Retained::into_super(Retained::into_super(NSNumber::new_i64(v))))
}

fn num_b(v: bool) -> Retained<AnyObject> {
    Retained::into_super(Retained::into_super(Retained::into_super(NSNumber::new_bool(v))))
}

fn dict(pairs: Vec<(&NSString, Retained<AnyObject>)>) -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys: Vec<&NSString> = pairs.iter().map(|p| p.0).collect();
    let vals: Vec<Retained<AnyObject>> = pairs.into_iter().map(|p| p.1).collect();
    NSDictionary::from_retained_objects(&keys, &vals)
}

fn key(k: Option<&'static NSString>) -> &'static NSString {
    k.expect("AVFoundation constant missing")
}

type WriterParts = (Retained<AVAssetWriter>, Retained<AVAssetWriterInput>, Option<Retained<AVAssetWriterInput>>);

fn make_writer(
    path: &Path,
    width: u32,
    height: u32,
    fps: u32,
    system_audio: bool,
) -> Result<WriterParts, ScreenError> {
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let writer = unsafe {
        AVAssetWriter::initWithURL_fileType_error(AVAssetWriter::alloc(), &url, key(AVFileTypeMPEG4))
    }
    .map_err(|e| ScreenError::Writer(e.localizedDescription().to_string()))?;
    unsafe { writer.setMovieTimeScale(90_000) };

    let compression = dict(vec![
        (key(unsafe { AVVideoAllowFrameReorderingKey }), num_b(false)),
        (key(unsafe { AVVideoExpectedSourceFrameRateKey }), num_i(fps as i64)),
        (key(unsafe { AVVideoMaxKeyFrameIntervalKey }), num_i((fps * 2) as i64)),
    ]);
    let codec: Retained<AnyObject> =
        Retained::into_super(Retained::into_super(key(unsafe { AVVideoCodecTypeH264 }).retain()));
    let settings = dict(vec![
        (key(unsafe { AVVideoCodecKey }), codec),
        (key(unsafe { AVVideoWidthKey }), num_i(width as i64)),
        (key(unsafe { AVVideoHeightKey }), num_i(height as i64)),
        (key(unsafe { AVVideoCompressionPropertiesKey }), Retained::into_super(Retained::into_super(compression))),
    ]);
    let media_video = key(unsafe { AVMediaTypeVideo });
    if !unsafe { writer.canApplyOutputSettings_forMediaType(Some(&settings), media_video) } {
        return Err(ScreenError::Writer(format!("H.264 refuses {width}x{height}")));
    }
    let video_in = unsafe {
        AVAssetWriterInput::initWithMediaType_outputSettings(AVAssetWriterInput::alloc(), media_video, Some(&settings))
    };
    unsafe {
        video_in.setExpectsMediaDataInRealTime(true);
        video_in.setMediaTimeScale(90_000);
    }
    if !unsafe { writer.canAddInput(&video_in) } {
        return Err(ScreenError::Writer("cannot add video input".into()));
    }
    unsafe { writer.addInput(&video_in) };

    let mut audio_in = None;
    if system_audio {
        let s = dict(vec![
            (&NSString::from_str("AVFormatIDKey"), num_i(AAC as i64)),
            (&NSString::from_str("AVSampleRateKey"), num_i(SYS_RATE as i64)),
            (&NSString::from_str("AVNumberOfChannelsKey"), num_i(SYS_CHANNELS as i64)),
            (&NSString::from_str("AVEncoderBitRateKey"), num_i(128_000)),
        ]);
        let media_audio = key(unsafe { AVMediaTypeAudio });
        let input = unsafe {
            AVAssetWriterInput::initWithMediaType_outputSettings(AVAssetWriterInput::alloc(), media_audio, Some(&s))
        };
        unsafe { input.setExpectsMediaDataInRealTime(true) };
        if unsafe { writer.canAddInput(&input) } {
            unsafe { writer.addInput(&input) };
            audio_in = Some(input);
        }
    }
    if !unsafe { writer.startWriting() } {
        let e = unsafe { writer.error() }.map(|e| e.localizedDescription().to_string());
        return Err(ScreenError::Writer(e.unwrap_or_else(|| "startWriting failed".into())));
    }
    Ok((writer, video_in, audio_in))
}

impl ScreenRecorder {
    pub fn start(cfg: ScreenConfig) -> Result<ScreenRecorder, ScreenError> {
        // Touching CoreGraphics first initializes the window-server connection.
        let _ = CGMainDisplayID();
        if !CGPreflightScreenCaptureAccess() {
            return Err(ScreenError::Permission("not granted to this process".into()));
        }
        let display = choose_display(&cfg.display)?;
        let fps = cfg.fps.clamp(1, 120);
        let width = (display.w * display.scale).round() as u32;
        let height = (display.h * display.scale).round() as u32;

        std::fs::create_dir_all(&cfg.out_dir)?;
        let video_path = cfg.out_dir.join("video.mp4");
        let mic_path = cfg.out_dir.join("audio").join("mic.wav");
        if cfg.mic {
            std::fs::create_dir_all(mic_path.parent().unwrap())?;
        }
        for p in [&video_path, &mic_path] {
            if p.exists() {
                std::fs::remove_file(p)?;
            }
        }

        let content = shareable_content()?;
        let displays = unsafe { content.displays() };
        let sc_display = displays
            .iter()
            .find(|d| unsafe { d.displayID() } == display.id)
            .ok_or_else(|| ScreenError::NoDisplay(format!("ScreenCaptureKit has no display {}", display.id)))?;

        let filter = unsafe {
            SCContentFilter::initWithDisplay_excludingWindows(SCContentFilter::alloc(), &sc_display, &NSArray::new())
        };
        let conf = unsafe { SCStreamConfiguration::new() };
        unsafe {
            conf.setWidth(width as usize);
            conf.setHeight(height as usize);
            conf.setMinimumFrameInterval(CMTime { value: 1, timescale: fps as i32, flags: CMTimeFlags::Valid, epoch: 0 });
            conf.setPixelFormat(PIXEL_420V);
            conf.setShowsCursor(true);
            conf.setQueueDepth(8);
            conf.setCapturesAudio(cfg.system_audio);
            conf.setExcludesCurrentProcessAudio(true);
            conf.setSampleRate(SYS_RATE as isize);
            conf.setChannelCount(SYS_CHANNELS as isize);
            conf.setCaptureMicrophone(cfg.mic);
        }

        let (writer, video_in, audio_in) = make_writer(&video_path, width, height, fps, cfg.system_audio)?;
        let mut warnings = Vec::new();
        if cfg.system_audio && audio_in.is_none() {
            warnings.push("system audio: writer refused the AAC input; recording without it".into());
        }

        let state = Arc::new(Mutex::new(SendBox(State {
            writer,
            video_in,
            audio_in,
            video_start: None,
            frames: Vec::new(),
            frame_display: Vec::new(),
            frames_dropped_not_ready: 0,
            frames_idle: 0,
            last_frame_ns: 0,
            last_frame: None,
            sys_first: None,
            sys_buffers: 0,
            sys_dropped: 0,
            mic_path,
            mic: None,
            mic_wanted: cfg.mic,
            mic_buffers: 0,
            mic_channels_in: 0,
            lag_video: LagStats::default(),
            lag_sys: LagStats::default(),
            lag_mic: LagStats::default(),
            errors: Vec::new(),
            stopped: false,
        })));

        let stream = unsafe { SCStream::initWithFilter_configuration_delegate(SCStream::alloc(), &filter, &conf, None) };
        let output = Output::new(state.clone());
        let queue = DispatchQueue::new("markupr.screen.samples", None);
        let proto = ProtocolObject::from_ref(&*output);
        let mut kinds = vec![SCStreamOutputType::Screen];
        if cfg.system_audio {
            kinds.push(SCStreamOutputType::Audio);
        }
        if cfg.mic {
            kinds.push(SCStreamOutputType::Microphone);
        }
        for k in kinds {
            unsafe { stream.addStreamOutput_type_sampleHandlerQueue_error(proto, k, Some(&queue)) }
                .map_err(|e| ScreenError::Capture(format!("add output {}: {}", k.0, e.localizedDescription())))?;
        }

        let (tx, rx) = mpsc::channel::<Option<String>>();
        let block = RcBlock::new(move |err: *mut NSError| {
            let _ = tx.send(ns_err(err));
        });
        unsafe { stream.startCaptureWithCompletionHandler(Some(&block)) };
        if let Some(e) = wait(&rx, "capture start")? {
            unsafe { state.lock().unwrap().0.writer.cancelWriting() };
            return Err(ScreenError::Capture(e));
        }

        Ok(ScreenRecorder { stream, _output: output, queue, state, display, cfg, width, height, warnings })
    }

    pub fn display(&self) -> DisplayInfo {
        self.display.clone()
    }

    pub fn stop(self) -> Result<ScreenReport, ScreenError> {
        let stop_ns = host_now_ns();
        let (tx, rx) = mpsc::channel::<Option<String>>();
        let block = RcBlock::new(move |err: *mut NSError| {
            let _ = tx.send(ns_err(err));
        });
        unsafe { self.stream.stopCaptureWithCompletionHandler(Some(&block)) };
        let mut warnings = self.warnings;
        match wait(&rx, "capture stop") {
            Ok(Some(e)) => warnings.push(format!("stop capture: {e}")),
            Ok(None) => {}
            Err(e) => warnings.push(e.to_string()),
        }
        // Drain callbacks already queued.
        self.queue.exec_sync(|| {});

        let mut guard = self.state.lock().unwrap_or_else(|p| p.into_inner());
        let st = &mut guard.0;
        st.stopped = true;
        warnings.append(&mut st.errors);

        let Some(video_start) = st.video_start else {
            unsafe { st.writer.cancelWriting() };
            return Err(ScreenError::Capture("no video frame arrived before stop".into()));
        };
        // AVAssetWriter does not stretch the last frame to the session end, so a still
        // screen at the end would cut the video short. Repeat the last frame at stop time.
        let end = stop_ns.max(st.last_frame_ns + 1);
        if let Some(last) = st.last_frame.take() {
            if end > st.last_frame_ns + 1_000_000 {
                match append_copy_at(&st.video_in, &last, end) {
                    Ok(()) => {
                        st.frames.push(end);
                        st.frame_display.push(None);
                    }
                    Err(e) => warnings.push(format!("video tail frame: {e}")),
                }
            }
        }
        unsafe {
            st.video_in.markAsFinished();
            if let Some(a) = &st.audio_in {
                a.markAsFinished();
            }
            st.writer.endSessionAtSourceTime(ns_cmtime(end));
        }
        let (tx, rx) = mpsc::channel::<()>();
        let done = RcBlock::new(move || {
            let _ = tx.send(());
        });
        unsafe { st.writer.finishWritingWithCompletionHandler(&done) };
        wait(&rx, "video finalize")?;
        let status = unsafe { st.writer.status() };
        if status != AVAssetWriterStatus::Completed {
            let e = unsafe { st.writer.error() }.map(|e| e.localizedDescription().to_string());
            return Err(ScreenError::Writer(e.unwrap_or_else(|| format!("writer status {}", status.0))));
        }

        let mic = match st.mic.take() {
            Some(w) => {
                let info = MicInfo { path: st.mic_path.clone(), start_host_ns: w.start_ns, sample_rate: w.sample_rate, channels: 1 };
                if w.padded > 0 {
                    warnings.push(format!("mic: {} ms of gaps filled with silence", w.padded * 1000 / w.sample_rate as u64));
                }
                w.finish()?;
                Some(info)
            }
            None => {
                if self.cfg.mic {
                    warnings.push(format!("mic: no samples arrived ({} buffers)", st.mic_buffers));
                }
                None
            }
        };
        let system_audio = match st.sys_first {
            Some(t) => Some(SystemAudioInfo { path: self.cfg.out_dir.join("video.mp4"), stream: "a:0".into(), start_host_ns: t }),
            None => {
                if self.cfg.system_audio && st.audio_in.is_some() {
                    warnings.push(format!("system audio: no samples written ({} buffers)", st.sys_buffers));
                }
                None
            }
        };
        if st.frames_dropped_not_ready > 0 {
            warnings.push(format!("video: {} frames dropped (encoder busy)", st.frames_dropped_not_ready));
        }
        if st.sys_dropped > 0 {
            warnings.push(format!("system audio: {} buffers dropped", st.sys_dropped));
        }

        // Debug sidecar for timing proofs; only when asked for.
        if let Some(p) = std::env::var_os("MARKUPR_SCREEN_DEBUG") {
            let frames: Vec<String> = st.frames.iter().map(|f| f.to_string()).collect();
            let disp: Vec<String> = st.frame_display.iter().map(|d| d.map_or("null".into(), |v| v.to_string())).collect();
            let json = format!(
                r#"{{"stop_ns":{},"video_start":{},"frames":[{}],"display_time":[{}],"idle":{},"lag_video":{},"lag_sys":{},"lag_mic":{},"mic_channels_in":{}}}"#,
                stop_ns, video_start, frames.join(","), disp.join(","), st.frames_idle,
                st.lag_video.json(), st.lag_sys.json(), st.lag_mic.json(), st.mic_channels_in
            );
            let _ = std::fs::write(p, json);
        }

        Ok(ScreenReport {
            display: self.display,
            video: VideoInfo {
                path: self.cfg.out_dir.join("video.mp4"),
                start_host_ns: video_start,
                width: self.width,
                height: self.height,
                fps: self.cfg.fps,
            },
            mic,
            system_audio,
            warnings,
        })
    }
}
