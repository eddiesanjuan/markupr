use anyhow::Result;
use clap::{Args, ValueEnum};
use markupr_core::{
    clock::round_t,
    session::{Permissions, SessionClock, Sources, Status, Timing},
    Clock, Config, PackDir, Session,
};
use std::{
    path::PathBuf,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Args, Clone, Debug)]
pub struct RecordOptions {
    #[arg(long)]
    pub popup: bool,
    #[arg(long)]
    pub out: Option<PathBuf>,
    #[arg(long, value_parser = positive_seconds)]
    pub duration: Option<f64>,
    #[arg(long)]
    pub display: Option<u32>,
    #[arg(long)]
    pub no_mic: bool,
    #[arg(long)]
    pub no_system_audio: bool,
    #[arg(long)]
    pub no_browser: bool,
    #[arg(long)]
    pub browser_port: Option<u16>,
    #[arg(long)]
    pub no_syslog: bool,
    #[arg(long)]
    pub no_pack: bool,
    #[command(flatten)]
    pub processing: ProcessingOptions,
}

#[derive(Args, Clone, Debug)]
pub struct ProcessingOptions {
    #[arg(long)]
    pub fast: bool,
    #[arg(long, value_enum, default_value = "mic")]
    pub audio_source: AudioChoice,
}
#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum AudioChoice {
    Mic,
    System,
}
impl ProcessingOptions {
    pub fn pack_options(&self) -> markupr_pack::PackOptions {
        markupr_pack::PackOptions {
            fast: self.fast,
            audio_source: match self.audio_source {
                AudioChoice::Mic => markupr_pack::AudioSource::Mic,
                AudioChoice::System => markupr_pack::AudioSource::System,
            },
        }
    }
}

pub fn build_pack(
    pack: &PackDir,
    config: &Config,
    opts: &markupr_pack::PackOptions,
) -> Result<markupr_pack::PackReport> {
    let mut session = Session::load(pack)?;
    session.status = Status::Processing;
    session.save(pack)?;
    match markupr_pack::build_pack(pack, config, opts) {
        Ok(report) => Ok(report),
        Err(error) => {
            session.status = Status::Failed;
            session.save(pack)?;
            Err(anyhow::anyhow!("{error}"))
        }
    }
}
fn positive_seconds(s: &str) -> Result<f64, String> {
    let value: f64 = s
        .parse()
        .map_err(|_| "duration must be a positive number")?;
    if value.is_finite() && value > 0.0 && value <= u32::MAX as f64 {
        Ok(value)
    } else {
        Err("duration must be positive, finite, and at most 4294967295 seconds".into())
    }
}
pub struct Recorder {
    clock: Clock,
    pack: PackDir,
    session: Session,
    no_pack: bool,
    config: Config,
    processing: markupr_pack::PackOptions,
    screen: Option<markupr_screen::ScreenRecorder>,
    browser: Option<markupr_browser::BrowserRecorder>,
    events: Option<markupr_events::EventRecorder>,
    system_log: bool,
}
impl Recorder {
    pub fn start(opts: RecordOptions, clock: Clock, pack: PackDir, config: Config) -> Result<Self> {
        let permissions = markupr_events::permissions::check();
        if !opts.no_mic && !permissions.microphone {
            eprintln!("warning: microphone permission missing; microphone capture disabled");
        }
        let session = Session {
            schema: "markupr.pack/1".into(),
            id: pack
                .root()
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            status: Status::Recording,
            app_version: env!("CARGO_PKG_VERSION").into(),
            clock: SessionClock {
                t0_host_ns: clock.t0_host_ns(),
                t0_unix_ms: clock.t0_unix_ms(),
            },
            duration: None,
            display: None,
            video: None,
            mic: None,
            system_audio: None,
            sources: Sources::default(),
            permissions: Permissions {
                screen: Some(permissions.screen),
                accessibility: Some(permissions.accessibility),
                microphone: Some(permissions.microphone),
            },
            timing: Timing::default(),
            warnings: vec![],
        };
        session.save(&pack)?;
        let events = match markupr_events::EventRecorder::start(
            markupr_events::EventsConfig {
                events_path: pack.events(),
                cursor_path: pack.cursor(),
                system_log_path: (!opts.no_syslog).then(|| pack.system_log()),
            },
            clock,
        ) {
            Ok(events) => Some(events),
            Err(error) => {
                eprintln!("warning: events unavailable: {error}");
                None
            }
        };
        let browser = (!opts.no_browser).then(|| {
            markupr_browser::BrowserRecorder::start(
                markupr_browser::BrowserConfig {
                    port: opts.browser_port.unwrap_or(config.browser.port),
                    log_path: pack.browser_log(),
                },
                clock,
            )
        });
        let screen = match markupr_screen::ScreenRecorder::start(markupr_screen::ScreenConfig {
            out_dir: pack.root().to_path_buf(),
            display: opts.display.map_or(
                markupr_screen::DisplayChoice::UnderCursor,
                markupr_screen::DisplayChoice::Id,
            ),
            fps: config.video.fps,
            mic: !opts.no_mic && permissions.microphone,
            system_audio: !opts.no_system_audio,
        }) {
            Ok(screen) => Some(screen),
            Err(error) => {
                eprintln!("warning: screen capture unavailable: {error}");
                None
            }
        };
        Ok(Self {
            clock,
            pack,
            session,
            no_pack: opts.no_pack,
            processing: opts.processing.pack_options(),
            config,
            screen,
            browser,
            events,
            system_log: !opts.no_syslog,
        })
    }
    pub fn mark(&self, source: &str, note: Option<String>) {
        if let Some(events) = &self.events {
            let n = events.mark(source, note);
            eprintln!(
                "mark {n} t={:.3} source={source}",
                round_t(self.clock.now())
            );
            return;
        }
        eprintln!(
            "warning: mark not recorded (events unavailable) t={:.3} source={source} note={note:?}",
            round_t(self.clock.now())
        );
    }
    pub fn stop(mut self) -> Result<Option<markupr_pack::PackReport>> {
        let stop = Instant::now();
        self.session.duration = Some(round_t(self.clock.now()));
        self.session.timing.stop_unix_ms = Some(unix_ms()?);
        if let Some(screen) = self.screen.take() {
            match screen.stop() {
                Ok(report) => {
                    for warning in report.warnings {
                        eprintln!("warning: {warning}");
                    }
                    let d = report.display;
                    self.session.display = Some(markupr_core::session::Display {
                        id: d.id,
                        x: d.x.round() as i32,
                        y: d.y.round() as i32,
                        w: d.w.round() as u32,
                        h: d.h.round() as u32,
                        scale: d.scale,
                    });
                    let video = report.video;
                    self.session.video = Some(markupr_core::session::Video {
                        file: "video.mp4".into(),
                        start_t: round_t(self.clock.t_from_host_ns(video.start_host_ns)),
                        width: video.width,
                        height: video.height,
                        fps: video.fps,
                    });
                    self.session.mic = report.mic.map(|mic| markupr_core::session::Mic {
                        file: "audio/mic.wav".into(),
                        start_t: round_t(self.clock.t_from_host_ns(mic.start_host_ns)),
                        sample_rate: mic.sample_rate,
                    });
                    self.session.system_audio =
                        report
                            .system_audio
                            .map(|audio| markupr_core::session::SystemAudio {
                                file: "video.mp4".into(),
                                stream: audio.stream,
                                start_t: round_t(self.clock.t_from_host_ns(audio.start_host_ns)),
                            });
                }
                Err(error) => eprintln!("warning: screen finalization failed: {error}"),
            }
        }
        if let Some(events) = self.events.take() {
            match events.stop() {
                Ok(report) => {
                    self.session.sources.events = report.tap_active;
                    self.session.sources.system_log =
                        self.system_log && self.pack.system_log().is_file();
                    for warning in report.warnings {
                        eprintln!("warning: events: {warning}");
                    }
                }
                Err(error) => eprintln!("warning: events finalization failed: {error}"),
            }
        }
        if let Some(browser) = self.browser.take() {
            let report = browser.stop();
            self.session.sources.browser = Some(markupr_core::session::Browser {
                attached: report.attached,
                port: report.port,
            });
            for warning in report.warnings {
                eprintln!("warning: browser: {warning}");
            }
            if !report.attached {
                eprintln!(
                    "warning: browser debug endpoint unavailable on port {}",
                    report.port
                );
            }
        }
        self.session.timing.stages_ms = Some(markupr_core::session::StagesMs {
            finalize: stop.elapsed().as_millis() as u64,
            ..Default::default()
        });
        self.session.status = if self.no_pack {
            Status::Ready
        } else {
            Status::Processing
        };
        if self.no_pack {
            let ready = unix_ms()?;
            self.session.timing.pack_ready_unix_ms = Some(ready);
            self.session.timing.stop_to_ready_ms = self
                .session
                .timing
                .stop_unix_ms
                .map(|s| ready.saturating_sub(s));
        }
        self.session.save(&self.pack)?;
        let mut pack_report = None;
        if !self.no_pack {
            let report = build_pack(&self.pack, &self.config, &self.processing)?;
            for warning in &report.warnings {
                eprintln!("warning: pack: {warning}");
            }
            eprintln!("pack: {}", serde_json::to_string(&report)?);
            pack_report = Some(report);
        }
        Ok(pack_report)
    }
}
fn unix_ms() -> Result<u64> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64)
}
