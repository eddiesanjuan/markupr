//! `cargo run -p markupr-events --example events -- --seconds N --out DIR [--no-syslog]`
use markupr_core::Clock;
use markupr_events::{permissions, EventRecorder, EventsConfig};
use std::{path::PathBuf, thread, time::Duration};

fn main() {
    let mut args = std::env::args().skip(1);
    let (mut seconds, mut out, mut syslog) = (10.0f64, None::<PathBuf>, true);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--seconds" => seconds = args.next().and_then(|s| s.parse().ok()).expect("--seconds N"),
            "--out" => out = args.next().map(PathBuf::from),
            "--no-syslog" => syslog = false,
            other => panic!("unknown argument {other}"),
        }
    }
    let out = out.expect("--out DIR");
    let cfg = EventsConfig {
        events_path: out.join("events.jsonl"),
        cursor_path: out.join("cursor.jsonl"),
        system_log_path: syslog.then(|| out.join("logs/system.jsonl")),
    };
    let clock = Clock::start();
    let rec = EventRecorder::start(cfg, clock).expect("start");
    thread::sleep(Duration::from_secs_f64(seconds / 2.0));
    rec.mark("example", None);
    thread::sleep(Duration::from_secs_f64(seconds / 2.0));
    let report = rec.stop().expect("stop");
    let out = serde_json::json!({
        "clock": { "t0_host_ns": clock.t0_host_ns(), "t0_unix_ms": clock.t0_unix_ms() },
        "report": report.to_json(),
        "permissions": permissions::check().to_json(),
    });
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
