use markupr_browser::{debug_browser_command, BrowserConfig, BrowserRecorder};
use markupr_core::Clock;
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let value = |key: &str| args.windows(2).find(|a| a[0] == key).map(|a| a[1].as_str());
    let port = value("--port").unwrap_or("9222").parse().unwrap();
    if args.iter().any(|a| a == "--print-launch") {
        println!("{:?}", debug_browser_command(port, value("--url")).unwrap());
        return;
    }
    let seconds = value("--seconds").unwrap_or("10").parse().unwrap();
    let clock = Clock::start();
    eprintln!("t0_unix_ms={}", clock.t0_unix_ms());
    let recorder = BrowserRecorder::start(
        BrowserConfig {
            port,
            log_path: PathBuf::from(value("--out").unwrap_or("browser.jsonl")),
        },
        clock,
    );
    std::thread::sleep(Duration::from_secs(seconds));
    let stop = Instant::now();
    let report = recorder.stop();
    eprintln!("stop_ms={}", stop.elapsed().as_millis());
    println!("{}", serde_json::to_string(&report).unwrap());
}
