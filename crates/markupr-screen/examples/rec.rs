//! `cargo run -p markupr-screen --example rec -- --seconds N --out DIR [--display ID] [--no-mic] [--no-system-audio]`
//! Records, stops, and prints the ScreenReport as JSON. stop() latency goes to stderr.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use markupr_screen::{DisplayChoice, ScreenConfig, ScreenRecorder};

fn main() {
    let mut seconds = 3.0f64;
    let mut out: Option<PathBuf> = None;
    let mut display = DisplayChoice::UnderCursor;
    let (mut mic, mut system_audio) = (true, true);
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--seconds" => seconds = args.next().and_then(|v| v.parse().ok()).expect("--seconds N"),
            "--out" => out = args.next().map(PathBuf::from),
            "--display" => display = DisplayChoice::Id(args.next().and_then(|v| v.parse().ok()).expect("--display ID")),
            "--no-mic" => mic = false,
            "--no-system-audio" => system_audio = false,
            "--list" => {
                println!("{}", serde_json::to_string_pretty(&markupr_screen::list_displays().unwrap()).unwrap());
                return;
            }
            other => panic!("unknown argument {other}"),
        }
    }
    let out_dir = out.expect("--out DIR is required");
    let rec = ScreenRecorder::start(ScreenConfig { out_dir, display, fps: 30, mic, system_audio })
        .unwrap_or_else(|e| panic!("start: {e}"));
    eprintln!("recording display {} for {seconds} s", rec.display().id);
    std::thread::sleep(Duration::from_secs_f64(seconds));
    let t = Instant::now();
    let report = rec.stop().unwrap_or_else(|e| panic!("stop: {e}"));
    eprintln!("stop_ms {}", t.elapsed().as_millis());
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
}
