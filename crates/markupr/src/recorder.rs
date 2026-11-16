use anyhow::Result;
use clap::Args;
use markupr_core::{
    clock::round_t,
    session::{Permissions, SessionClock, Sources, Status, Timing},
    Clock, PackDir, Session,
};
use std::{
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Args, Debug)]
pub struct RecordOptions {
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
}
impl Recorder {
    pub fn start(opts: RecordOptions, clock: Clock, pack: PackDir) -> Result<Self> {
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
            permissions: Permissions::default(),
            timing: Timing::default(),
        };
        // WIRE: screen — start capture with opts and retain its handle; stop/finalize it below.
        // WIRE: events — start event capture with clock/pack; stop it below and forward marks.
        // WIRE: browser — start CDP capture with opts; stop it below.
        // Until wired, absent sources and unchecked permissions stay false/null.
        session.save(&pack)?;
        Ok(Self {
            clock,
            pack,
            session,
            no_pack: opts.no_pack,
        })
    }
    pub fn mark(&self, source: &str, note: Option<String>) {
        eprintln!(
            "mark t={:.3} source={source} note={note:?}",
            round_t(self.clock.now())
        );
    }
    pub fn stop(mut self) -> Result<Session> {
        let duration = round_t(self.clock.now());
        let stop_unix_ms = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
        // WIRE: screen — stop/finalize capture and populate display/video/audio metadata.
        // WIRE: events — stop capture and populate source/permission results.
        // WIRE: browser — stop capture and populate attachment results.
        self.session.duration = Some(duration);
        self.session.timing.stop_unix_ms = Some(stop_unix_ms);
        self.session.status = if self.no_pack {
            Status::Ready
        } else {
            Status::Processing
        };
        self.session.save(&self.pack)?;
        if !self.no_pack {
            eprintln!("pack stage not wired yet; session left processing");
        }
        Ok(self.session)
    }
}
