use crate::{
    frames::cursor_at,
    moments::{kind, t, Item, Moments},
    PackDir,
};
use markupr_core::{round_t, Session};
use serde_json::{json, Value};
use std::fmt::Write;

fn text(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or("").replace(['\n', '\r'], " ")
}
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
            let app = format!("{} {}", text(focus, "app"), text(focus, "bundle")).to_lowercase();
            if [
                "chrome", "chromium", "arc", "brave", "edge", "vivaldi", "opera",
            ]
            .iter()
            .any(|name| app.contains(name))
            {
                if let Some(line) = browser
                    .iter()
                    .filter(|v| {
                        t(v) <= item.anchor_t
                            && (v["tab"]["url"].is_string() || kind(v) == "navigation")
                    })
                    .max_by(|a, b| t(a).total_cmp(&t(b)))
                {
                    looking["tab"] = line["tab"].clone();
                    if !looking["tab"].is_object() {
                        looking["tab"] = json!({});
                    }
                    if looking["tab"]["url"].is_null() {
                        looking["tab"]["url"] = line["url"].clone();
                    }
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
            .filter(|v| kind(v) == "dom_click")
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
            item.dive["ffmpeg"] = json!(format!(
                "ffmpeg -ss {:.3} -i {} -frames:v 1 frame.png",
                (item.anchor_t - video.start_t).max(0.0),
                shell_quote(&video.file)
            ));
        }
    }
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
    s.replace(['\n', '\r'], " ")
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
    events: &[Value],
    cursor: &[Value],
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
    let clicks = events.iter().any(|v| kind(v) == "mouse_down");
    if !cursor.is_empty() && clicks {
        source(true, "cursor and clicks".into());
    } else {
        source(!cursor.is_empty(), "cursor track".into());
        source(clicks, "clicks".into());
    }
    source(
        crate::has_data(&pack.browser_log()),
        session
            .sources
            .browser
            .as_ref()
            .map(|b| format!("browser logs (127.0.0.1:{})", b.port))
            .unwrap_or_else(|| "browser logs".into()),
    );
    source(crate::has_data(&pack.system_log()), "system log".into());
    if events.is_empty() {
        missing.push("events".into());
    }
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
    out.push_str("\n\n");
    for warning in warnings {
        writeln!(out, "Processing note: {}", one_line(warning)).unwrap();
    }
    if !warnings.is_empty() {
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
            one_line(&item.title),
            item.t0,
            item.t1
        )
        .unwrap();
        writeln!(out, "- Why flagged: {}", item.reasons.join("; ")).unwrap();
        writeln!(
            out,
            "- He said: {}",
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
                "- Frame: ![item {}]({}) at t {:.3}",
                item.id, frame.file, frame.t
            )
            .unwrap();
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
                    "  - {}:{} t {:.3} {}",
                    log.file,
                    log.line,
                    log.t,
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
                "; video {:.3} to {:.3} s; `{cmd}`",
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
                "- {}:{} t {:.3} {}",
                log.file,
                log.line,
                log.t,
                one_line(&log.text)
            )
            .unwrap();
        }
    }
    out
}
