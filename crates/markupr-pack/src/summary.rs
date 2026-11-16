use crate::{
    frames::cursor_at,
    moments::{kind, t, time_label, Item, LogLine, Moments},
    PackDir,
};
use markupr_core::{round_t, Session};
use serde_json::{json, Value};
use std::fmt::Write;

pub fn enrich(
    items: &mut [Item],
    session: &Session,
    events: &[Value],
    cursor: &[Value],
    browser: &[Value],
) {
    for item in items {
        let focus = events
            .iter()
            .filter(|v| kind(v) == "focus" && t(v) <= item.anchor_t)
            .max_by(|a, b| t(a).total_cmp(&t(b)));
        let mut looking = json!({"app":null,"window":null,"tab":null,"element":null,"cursor":null});
        if let Some(focus) = focus {
            looking["app"] = focus["app"].clone();
            looking["window"] = focus["window"].clone();
            if let Some(line) = browser_line(browser, focus, item.anchor_t) {
                looking["tab"] = line["tab"].clone();
                if !looking["tab"].is_object() {
                    looking["tab"] = json!({});
                }
                if looking["tab"]["url"].is_null() {
                    looking["tab"]["url"] = line["url"].clone();
                }
            }
        }
        let click = item.clicks.iter().min_by(|a, b| {
            (t(a) - item.anchor_t)
                .abs()
                .total_cmp(&(t(b) - item.anchor_t).abs())
        });
        let dom = browser
            .iter()
            .filter(|v| {
                kind(v) == "dom_click"
                    && focus.is_some_and(|f| browser_bundle(f["bundle"].as_str().unwrap_or("")))
            })
            .filter(|v| match click {
                Some(click) => (t(v) - t(click)).abs() <= 0.5,
                None => t(v) >= item.t0 && t(v) <= item.t1,
            })
            .min_by(|a, b| {
                let reference = click.map_or(item.anchor_t, t);
                (t(a) - reference)
                    .abs()
                    .total_cmp(&(t(b) - reference).abs())
            });
        if let Some(dom) = dom {
            looking["element"] =
                json!({"selector":dom["selector"],"tag":dom["tag"],"text":dom["text"]});
        } else if let Some(click) = click {
            looking["element"] = click["el"].clone();
        }
        if let Some((x, y)) = cursor_at(item.anchor_t, cursor, events) {
            looking["cursor"] = json!({"x":x,"y":y});
        }
        item.looking_at = looking;
        item.dive = json!({"t0":item.t0,"t1":item.t1,"files":["events.jsonl","logs/"]});
        if let Some(video) = &session.video {
            item.dive["video_t0"] = json!(round_t((item.t0 - video.start_t).max(0.0)));
            item.dive["video_t1"] = json!(round_t((item.t1 - video.start_t).max(0.0)));
        }
    }
}
fn browser_bundle(bundle: &str) -> bool {
    [
        "com.google.Chrome",
        "com.google.Chrome.canary",
        "com.brave.Browser",
        "com.microsoft.edgemac",
        "company.thebrowser.Browser",
        "org.chromium.Chromium",
    ]
    .contains(&bundle)
}
fn browser_line<'a>(browser: &'a [Value], focus: &Value, anchor: f64) -> Option<&'a Value> {
    let bundle = focus["bundle"].as_str().unwrap_or("");
    if !browser_bundle(bundle) {
        return None;
    }
    let app = focus["app"].as_str().unwrap_or("");
    let window = focus["window"].as_str().unwrap_or("");
    let focused_app = |v: &&Value| {
        v["bundle"].as_str().is_some_and(|b| b == bundle)
            || v["app"]
                .as_str()
                .is_some_and(|a| !app.is_empty() && a == app)
    };
    let candidates: Vec<_> = browser
        .iter()
        .filter(|v| t(v) <= anchor && v["replayed"] != true)
        .filter(|v| v["tab"].is_object())
        .filter(|v| {
            v["bundle"].as_str().is_none_or(|b| b == bundle)
                && v["app"].as_str().is_none_or(|a| a == app)
        })
        .collect();
    candidates
        .iter()
        .copied()
        .filter(|v| {
            v["tab"]["title"]
                .as_str()
                .is_some_and(|title| !title.is_empty() && window.starts_with(title))
        })
        .max_by(|a, b| {
            a["tab"]["title"]
                .as_str()
                .unwrap()
                .len()
                .cmp(&b["tab"]["title"].as_str().unwrap().len())
                .then_with(|| t(a).total_cmp(&t(b)))
        })
        .or_else(|| {
            candidates
                .iter()
                .copied()
                .filter(focused_app)
                .max_by(|a, b| t(a).total_cmp(&t(b)))
        })
}
pub(crate) fn frame_hint(file: &str, file_t: f64) -> String {
    format!(
        "ffmpeg -ss {} -i {} -frames:v 1 frame.png",
        crate::frames::seek_arg(file_t),
        shell_quote(file)
    )
}
fn shell_quote(s: &str) -> String {
    if s.chars()
        .all(|c| c.is_ascii_alphanumeric() || "_./-".contains(c))
    {
        s.into()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}
fn one_line(s: &str) -> String {
    s.replace(['\n', '\r'], " ").replace('`', "'")
}
fn looking_text(v: &Value) -> String {
    let mut parts = vec![];
    if let Some(app) = v["app"].as_str() {
        parts.push(one_line(app));
    }
    if let Some(window) = v["window"].as_str() {
        parts.push(format!("window {:?}", one_line(window)));
    }
    if let Some(url) = v["tab"]["url"].as_str() {
        parts.push(one_line(url));
    }
    if let Some(title) = v["tab"]["title"].as_str() {
        parts.push(format!("tab {:?}", one_line(title)));
    }
    if let Some(el) = v["element"].as_object() {
        let name = el
            .get("selector")
            .or_else(|| el.get("role"))
            .and_then(Value::as_str)
            .unwrap_or("element");
        let label = el
            .get("text")
            .or_else(|| el.get("title"))
            .and_then(Value::as_str)
            .unwrap_or("");
        parts.push(format!("clicked {} {:?}", one_line(name), one_line(label)));
    }
    if let (Some(x), Some(y)) = (v["cursor"]["x"].as_f64(), v["cursor"]["y"].as_f64()) {
        parts.push(format!("cursor at ({x:.1}, {y:.1})"));
    }
    if parts.is_empty() {
        "App, window, element and cursor were not captured".into()
    } else {
        parts.join("; ")
    }
}
pub fn render(
    pack: &PackDir,
    session: &Session,
    moments: &Moments,
    warnings: &[String],
    system: &[(usize, Value)],
) -> String {
    let date = chrono::DateTime::from_timestamp_millis(session.clock.t0_unix_ms as i64)
        .map(|d| {
            d.with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M")
                .to_string()
        })
        .unwrap_or_else(|| session.id.clone());
    let duration = session
        .duration
        .map(|d| format!("{d:.1} s"))
        .unwrap_or_else(|| "duration unknown".into());
    let mut out = format!("# Context pack: {date} ({duration})\n\n");
    let mut captured = vec![];
    let mut missing = vec![];
    let mut source = |present: bool, name: String| {
        if present {
            captured.push(name);
        } else {
            missing.push(name);
        }
    };
    source(
        session
            .video
            .as_ref()
            .is_some_and(|v| crate::has_data(&pack.root().join(&v.file))),
        "screen video".into(),
    );
    source(
        session
            .mic
            .as_ref()
            .is_some_and(|m| crate::has_data(&pack.root().join(&m.file))),
        "microphone".into(),
    );
    source(
        session
            .system_audio
            .as_ref()
            .is_some_and(|a| crate::has_data(&pack.root().join(&a.file))),
        "system audio".into(),
    );
    source(session.sources.events, "cursor and clicks".into());
    source(
        session.sources.browser.as_ref().is_some_and(|b| b.attached),
        session
            .sources
            .browser
            .as_ref()
            .map(|b| format!("browser logs (127.0.0.1:{})", b.port))
            .unwrap_or_else(|| "browser logs".into()),
    );
    source(session.sources.system_log, "system log".into());
    writeln!(
        out,
        "Captured: {}.",
        if captured.is_empty() {
            "nothing".into()
        } else {
            captured.join(", ")
        }
    )
    .unwrap();
    writeln!(
        out,
        "Not captured: {}.",
        if missing.is_empty() {
            "nothing missing".into()
        } else {
            missing.join(", ")
        }
    )
    .unwrap();
    out.push_str("Times are seconds from the start of the recording (t).");
    if let Some(video) = &session.video {
        write!(out, " Video time = t - {:.3}.", video.start_t).unwrap();
    }
    out.push('\n');
    if session.video.is_some() {
        out.push_str("Video only has a frame when the screen changed. Use `markupr frame <pack dir> <t>` for the screen at any time.\n");
    }
    let system_errors: Vec<_> = system
        .iter()
        .filter(|(_, line)| matches!(line["level"].as_str(), Some("error" | "fault")))
        .collect();
    if !system_errors.is_empty() {
        let processes: std::collections::BTreeSet<_> = system_errors
            .iter()
            .map(|(_, line)| one_line(line["process"].as_str().unwrap_or("unknown process")))
            .collect();
        writeln!(
            out,
            "System log: {} error/fault lines from {}; see logs/system.jsonl.",
            system_errors.len(),
            processes.into_iter().collect::<Vec<_>>().join(", ")
        )
        .unwrap();
    }
    out.push('\n');
    for warning in session.warnings.iter().chain(warnings) {
        writeln!(out, "Capture notes: {}", one_line(warning)).unwrap();
    }
    if !warnings.is_empty() || !session.warnings.is_empty() {
        out.push('\n');
    }
    writeln!(
        out,
        "{} items, {} other error{}.\n",
        moments.items.len(),
        moments.other_errors.len(),
        if moments.other_errors.len() == 1 {
            ""
        } else {
            "s"
        }
    )
    .unwrap();
    for item in &moments.items {
        writeln!(
            out,
            "## {}. {} (t {:.3} to {:.3})\n",
            item.id,
            short_title(&item.title),
            item.t0,
            item.t1
        )
        .unwrap();
        let mut reasons = vec![];
        let mut phrases = vec![];
        for reason in &item.reasons {
            if let Some(phrase) = reason.strip_prefix("pointing words ") {
                let phrase = phrase.rsplit_once(" at ").map_or(phrase, |(p, _)| p);
                if !phrases.contains(&phrase) {
                    phrases.push(phrase);
                }
            } else if reason.starts_with("mark ") || reason.starts_with("click at ") {
                reasons.push(reason.as_str());
            } else if reason.starts_with("error at ") {
                reasons.push(reason.split_once(": ").map_or(reason.as_str(), |(r, _)| r));
            }
        }
        let mut why = reasons.join("; ");
        if !phrases.is_empty() {
            if !why.is_empty() {
                why.push_str("; ");
            }
            why.push_str(&format!("pointing phrases: {}", phrases.join(", ")));
        }
        writeln!(out, "- Why flagged: {}", one_line(&why)).unwrap();
        writeln!(
            out,
            "- Said: {}",
            if item.said.is_empty() {
                "No speech captured.".into()
            } else {
                format!("\"{}\"", one_line(&item.said))
            }
        )
        .unwrap();
        writeln!(out, "- Looking at: {}", looking_text(&item.looking_at)).unwrap();
        if item.frames.is_empty() {
            out.push_str("- Frame: unavailable (screen video missing or extraction failed).\n");
        }
        for frame in &item.frames {
            write!(
                out,
                "- Frame: ![item {}]({}) at t {:.3}; screen last changed at t {:.3}",
                item.id, frame.file, frame.t, frame.frame_t
            )
            .unwrap();
            if let Some(mark) = frame.mark {
                write!(out, "; mark {mark}").unwrap();
            }
            if !frame.said.is_empty() {
                write!(out, "; said near this time: \"{}\"", one_line(&frame.said)).unwrap();
            }
            if let Some(zoom) = &frame.zoom {
                write!(out, "; zoom {zoom}").unwrap();
            }
            if let Some(note) = &frame.note {
                write!(out, "; {note}").unwrap();
            }
            out.push('\n');
        }
        if item.logs.is_empty() {
            out.push_str("- Logs: no matching errors or warnings captured.\n");
        } else {
            out.push_str("- Logs:\n");
            for log in &item.logs {
                writeln!(
                    out,
                    "  - {}:{} {} {}",
                    log.file,
                    log.line,
                    log_time(log),
                    one_line(&log.text)
                )
                .unwrap();
            }
        }
        write!(
            out,
            "- Dive deeper: t {:.3} to {:.3} in events.jsonl and logs/",
            item.t0, item.t1
        )
        .unwrap();
        if let Some(cmd) = item.dive["ffmpeg"].as_str() {
            write!(
                out,
                "; video {:.3} to {:.3} s.\n\n```sh\n{cmd}\n```",
                item.dive["video_t0"].as_f64().unwrap(),
                item.dive["video_t1"].as_f64().unwrap()
            )
            .unwrap();
        }
        out.push_str("\n\n");
    }
    out.push_str("## Other errors (not narrated)\n\n");
    if moments.other_errors.is_empty() {
        out.push_str("None.\n");
    } else {
        for log in &moments.other_errors {
            writeln!(
                out,
                "- {}:{} {} {}",
                log.file,
                log.line,
                log_time(log),
                one_line(&log.text)
            )
            .unwrap();
        }
    }
    if !moments.other_said.is_empty() {
        out.push_str("\n## Other things said\n\n");
        for said in &moments.other_said {
            write!(
                out,
                "- t {:.3} to {:.3}: \"{}\"",
                said.t0,
                said.t1,
                one_line(&said.text)
            )
            .unwrap();
            for click in &said.clicks {
                let el = &click["el"];
                let name = el["title"]
                    .as_str()
                    .or_else(|| el["text"].as_str())
                    .or_else(|| el["selector"].as_str())
                    .or_else(|| el["role"].as_str())
                    .unwrap_or("element not captured");
                write!(out, "; clicked \"{}\"", one_line(name)).unwrap();
            }
            out.push('\n');
        }
    }
    out
}

fn log_time(log: &LogLine) -> String {
    if log.replayed {
        return format!(
            "before the recording started ({:.3} s earlier)",
            log.t.abs()
        );
    }
    let label = |time| {
        if time < 0.0 {
            time_label(time)
        } else {
            format!("t {}", time_label(time))
        }
    };
    if let Some(observed) = log.observed_t {
        format!("request start {}; log {}", label(log.t), label(observed))
    } else {
        label(log.t)
    }
}

pub fn short_title(title: &str) -> String {
    let title = one_line(title);
    if title.chars().count() <= 80 {
        return title;
    }
    let prefix: String = title.chars().take(77).collect();
    let end = prefix.rfind(char::is_whitespace).unwrap_or(prefix.len());
    format!("{}...", prefix[..end].trim_end())
}

pub fn other_elements(moments: &mut Moments, browser: &[Value]) {
    for said in &mut moments.other_said {
        for click in &mut said.clicks {
            if !click["el"].is_object() {
                if let Some(dom) = browser
                    .iter()
                    .filter(|v| kind(v) == "dom_click" && (t(v) - t(click)).abs() <= 0.5)
                    .min_by(|a, b| (t(a) - t(click)).abs().total_cmp(&(t(b) - t(click)).abs()))
                {
                    click["el"] = json!({"selector":dom["selector"],"text":dom["text"]});
                }
            }
        }
    }
}
