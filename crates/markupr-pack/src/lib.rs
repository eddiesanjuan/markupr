mod frames;
mod moments;
mod speech;
mod speech_stretches;
mod summary;

use markupr_core::{
    round_t,
    session::{StagesMs, Status},
    Config, PackDir, Session,
};
use moments::{kind, t, LogLine};
use serde::Serialize;
use serde_json::Value;
use std::{
    fs, io,
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub use frames::{frame_at, FrameAt};

pub type PackError = Box<dyn std::error::Error + Send + Sync>;
#[derive(Clone, Copy, Debug)]
pub enum AudioSource {
    Mic,
    System,
}
#[derive(Clone, Debug)]
pub struct PackOptions {
    pub fast: bool,
    pub audio_source: AudioSource,
}
#[derive(Debug, Serialize)]
pub struct PackReport {
    pub items: usize,
    pub other_errors: usize,
    pub words: usize,
    /// Number of key frames; zoom crops are companions, not additional moments.
    pub frames: usize,
    pub warnings: Vec<String>,
}
fn elapsed(start: Instant) -> u64 {
    start.elapsed().as_millis() as u64
}
fn has_data(path: &Path) -> bool {
    path.metadata().is_ok_and(|m| m.is_file() && m.len() > 0)
}
#[derive(Debug)]
struct CommandTimeout(String);
impl std::fmt::Display for CommandTimeout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for CommandTimeout {}
fn run(command: &mut Command) -> Result<Vec<u8>, PackError> {
    run_timed(command, Duration::from_secs(30))
}
fn run_timed(command: &mut Command, limit: Duration) -> Result<Vec<u8>, PackError> {
    // File-backed output avoids blocking on a full pipe while checking the deadline.
    let temp = tempfile::tempdir()?;
    let stdout = temp.path().join("stdout");
    let stderr = temp.path().join("stderr");
    let mut child = command
        .stdin(Stdio::null())
        .stdout(fs::File::create(&stdout)?)
        .stderr(fs::File::create(&stderr)?)
        .spawn()?;
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() >= limit {
            let _ = child.kill(); // This Child handle belongs only to this invocation.
            let _ = child.wait();
            return Err(CommandTimeout(format!(
                "{} timed out after {:.1} s; stopped child PID {}",
                command.get_program().to_string_lossy(),
                limit.as_secs_f64(),
                child.id()
            ))
            .into());
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    if !status.success() {
        let stderr = fs::read_to_string(stderr)?;
        let tail: String = stderr
            .chars()
            .rev()
            .take(1500)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        return Err(format!(
            "{} exited {}: {}",
            command.get_program().to_string_lossy(),
            status,
            tail.trim()
        )
        .into());
    }
    Ok(fs::read(stdout)?)
}
fn read_jsonl(
    path: &Path,
    duration: Option<f64>,
    warnings: &mut Vec<String>,
) -> Result<Vec<(usize, Value)>, PackError> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };
    let mut lines = vec![];
    for (i, line) in text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(line) {
            Ok(mut value)
                if value.is_object() && value["t"].as_f64().is_some_and(f64::is_finite) =>
            {
                if duration.is_some_and(|end| t(&value) > end) {
                    continue;
                }
                if value["self"] == true
                    && matches!(kind(&value), "mouse_down" | "mouse_up" | "scroll")
                {
                    continue;
                }
                value["t"] = serde_json::json!(round_t(t(&value)));
                lines.push((i + 1, value));
            }
            _ => warnings.push(format!(
                "{}:{} is not a JSON object with a time; skipped.",
                path.display(),
                i + 1
            )),
        }
    }
    Ok(lines)
}
fn log_lines(browser: &[(usize, Value)], system: &[(usize, Value)]) -> Vec<LogLine> {
    let mut result = vec![];
    for (line, v) in browser {
        let network = kind(v) == "network";
        if network && v["canceled"] == true {
            continue;
        }
        let pending = v["pending"] == true
            && v["status"].is_null()
            && v["dur_ms"].as_f64().unwrap_or(0.0) >= 3000.0;
        let failed =
            v["failed"].as_bool().unwrap_or(false) || v["status"].as_u64().unwrap_or(0) >= 400;
        let error = kind(v) == "exception"
            || (kind(v) == "console" && v["level"] == "error")
            || (kind(v) == "network" && (failed || pending));
        let warning =
            kind(v) == "console" && matches!(v["level"].as_str(), Some("warn" | "warning"));
        if !error && !warning && v["replayed"] != true {
            continue;
        }
        let text = if kind(v) == "network" && pending {
            format!(
                "network: {} {} no response after {:.1} s",
                v["method"].as_str().unwrap_or(""),
                v["url"].as_str().unwrap_or(""),
                v["dur_ms"].as_f64().unwrap() / 1000.0
            )
        } else if kind(v) == "network" {
            format!(
                "network: {} {} {} {}",
                v["method"].as_str().unwrap_or(""),
                v["url"].as_str().unwrap_or(""),
                v["status"]
                    .as_u64()
                    .map(|s| s.to_string())
                    .unwrap_or_default(),
                v["error"].as_str().unwrap_or("")
            )
        } else {
            let mut text = format!("{}: {}", kind(v), v["text"].as_str().unwrap_or(""));
            if let Some(url) = v["url"].as_str() {
                text.push_str(&format!(" ({url}"));
                if let Some(line) = v["line"].as_u64() {
                    text.push_str(&format!(":{line}"));
                }
                text.push(')');
            }
            text
        };
        result.push(LogLine {
            file: "logs/browser.jsonl".into(),
            line: *line,
            t: if network {
                round_t(v["start_t"].as_f64().unwrap_or(t(v)))
            } else {
                t(v)
            },
            text: text.trim().into(),
            error,
            replayed: v["replayed"] == true,
            observed_t: network.then(|| t(v)),
        });
    }
    for (line, v) in system {
        if !matches!(v["level"].as_str(), Some("error" | "fault")) {
            continue;
        }
        result.push(LogLine {
            file: "logs/system.jsonl".into(),
            line: *line,
            t: t(v),
            text: format!(
                "{} {}: {}",
                v["process"].as_str().unwrap_or(""),
                v["level"].as_str().unwrap_or(""),
                v["msg"].as_str().unwrap_or("")
            )
            .trim()
            .into(),
            error: true,
            replayed: false,
            observed_t: None,
        });
    }
    result
}

pub fn build_pack(
    pack: &PackDir,
    cfg: &Config,
    opts: &PackOptions,
) -> Result<PackReport, PackError> {
    let mut session = Session::load(pack)?;
    let mut warnings = vec![];
    let mut stages = StagesMs {
        finalize: session.timing.stages_ms.as_ref().map_or(0, |s| s.finalize),
        ..StagesMs::default()
    };
    let start = Instant::now();
    let transcript = speech::transcribe(pack, &session, cfg, opts, &mut warnings);
    stages.transcribe = elapsed(start);
    let start = Instant::now();
    let events: Vec<_> = read_jsonl(&pack.events(), session.duration, &mut warnings)?
        .into_iter()
        .map(|(_, v)| v)
        .collect();
    let cursor: Vec<_> = read_jsonl(&pack.cursor(), session.duration, &mut warnings)?
        .into_iter()
        .map(|(_, v)| v)
        .collect();
    let browser = read_jsonl(&pack.browser_log(), session.duration, &mut warnings)?;
    let system = read_jsonl(&pack.system_log(), session.duration, &mut warnings)?;
    let logs = log_lines(&browser, &system);
    let mut moments = moments::detect(&transcript.segments, &events, &logs);
    let browser: Vec<_> = browser.into_iter().map(|(_, v)| v).collect();
    summary::enrich(&mut moments.items, &session, &events, &cursor, &browser);
    summary::other_elements(&mut moments, &browser);
    for item in &mut moments.items {
        item.title = summary::short_title(&item.title);
    }
    stages.moments = elapsed(start);
    let start = Instant::now();
    frames::make_frames(
        pack,
        &session,
        cfg,
        &mut moments.items,
        &cursor,
        &events,
        &mut warnings,
    )?;
    stages.frames = elapsed(start);
    let start = Instant::now();
    fs::write(
        pack.transcript_json(),
        serde_json::to_vec_pretty(&transcript)?,
    )?;
    let mut readable = String::from("# Transcript\n\n");
    for u in &transcript.segments {
        readable.push_str(&format!(
            "[{:02}:{:04.1}] {}\n",
            (u.t0 / 60.0).floor() as u64,
            u.t0 % 60.0,
            u.text
        ));
    }
    if transcript.segments.is_empty() {
        readable.push_str(
            "No speech transcript available. See SUMMARY.md for capture and processing notes.\n",
        );
    }
    fs::write(pack.transcript_md(), readable)?;
    fs::write(pack.moments(), serde_json::to_vec_pretty(&moments)?)?;
    fs::write(
        pack.summary(),
        summary::render(pack, &session, &moments, &warnings, &events, &cursor),
    )?;
    fs::write(pack.prompt(), prompt_text(pack))?;
    stages.write = elapsed(start);
    let ready = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    session.status = Status::Ready;
    session.timing.pack_ready_unix_ms = Some(ready);
    session.timing.stop_to_ready_ms = session
        .timing
        .stop_unix_ms
        .map(|stop| ready.saturating_sub(stop));
    session.timing.stages_ms = Some(stages);
    session.save(pack)?;
    Ok(PackReport {
        items: moments.items.len(),
        other_errors: moments.other_errors.len(),
        words: transcript.segments.iter().map(|u| u.words.len()).sum(),
        frames: moments.items.iter().map(|i| i.frames.len()).sum(),
        warnings,
    })
}

pub fn prompt_text(pack: &PackDir) -> String {
    format!("I recorded my screen while talking through what I want changed. Everything is in this context pack:\n\n{}\n\nRead SUMMARY.md in that folder first. It has one item per issue: what I said, what I was looking at, a key frame (open the image), and the matching log lines.\n\nThen work through the items. If you need more than the summary gives you, the raw material is in the same folder: transcript.md, events.jsonl (clicks, keys, focus, marks), cursor.jsonl, logs/browser.jsonl, logs/system.jsonl and video.mp4. All times are seconds from the start of the recording, and SUMMARY.md shows how to pull any frame from the video.\n", pack.root().display())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn hung_request_is_scored_at_send_time_instead_of_stop_time() {
        let logs = log_lines(
            &[
                (
                    1,
                    json!({"t":30.0,"type":"network","pending":true,"dur_ms":5200,"start_t":10.0,"method":"POST","url":"http://localhost/save"}),
                ),
                (
                    2,
                    json!({"t":30.0,"type":"network","pending":true,"dur_ms":2999,"start_t":10.0}),
                ),
            ],
            &[],
        );
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].t, 10.0);
        assert_eq!(
            logs[0].text,
            "network: POST http://localhost/save no response after 5.2 s"
        );
        assert!(logs[0].error);
        let utterance = moments::utterances(vec![moments::Word {
            t0: 10.0,
            t1: 10.5,
            w: "saving".into(),
        }]);
        let result = moments::detect(&utterance, &[], &logs);
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].anchor_t, 10.0);
    }
    #[test]
    fn canceled_or_completed_pending_requests_do_not_become_errors_and_failures_use_send_time() {
        use serde_json::json;
        let logs = log_lines(
            &[
                (
                    1,
                    json!({"t":20.0,"type":"network","pending":true,"dur_ms":5200,"status":200,"start_t":8.0}),
                ),
                (
                    2,
                    json!({"t":20.0,"type":"network","failed":true,"canceled":true,"status":500,"start_t":8.0}),
                ),
                (
                    3,
                    json!({"t":20.0,"type":"network","status":500,"start_t":8.0,"method":"POST","url":"http://localhost/save"}),
                ),
            ],
            &[],
        );
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].t, 8.0);
        assert_eq!(logs[0].observed_t, Some(20.0));
        let narration = moments::utterances(vec![moments::Word {
            t0: 8.0,
            t1: 8.5,
            w: "saving".into(),
        }]);
        let result = moments::detect(&narration, &[], &logs);
        assert_eq!(result.items[0].anchor_t, 8.0);
    }
}
