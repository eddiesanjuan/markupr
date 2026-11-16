use crate::{
    moments::{t, Frame, Item},
    run, PackError,
};
use image::{
    imageops::{self, FilterType},
    Rgb, RgbImage,
};
use markupr_core::{Config, PackDir, Session};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

pub fn cursor_at(time: f64, cursor: &[Value], events: &[Value]) -> Option<(f64, f64)> {
    cursor
        .iter()
        .chain(
            events
                .iter()
                .filter(|v| matches!(crate::moments::kind(v), "mouse_down" | "mark")),
        )
        .filter(|v| v["self"] != true && t(v) <= time && v["x"].is_number() && v["y"].is_number())
        .max_by(|a, b| t(a).total_cmp(&t(b)))
        .map(|v| (v["x"].as_f64().unwrap(), v["y"].as_f64().unwrap()))
}
fn ring(image: &mut RgbImage, x: f64, y: f64, sx: f64, sy: f64) {
    let radius = 28.0;
    let half_stroke = 3.0;
    let outer = radius + half_stroke + 2.0;
    let x0 = (x - outer * sx).max(0.0) as u32;
    let y0 = (y - outer * sy).max(0.0) as u32;
    let x1 = ((x + outer * sx).ceil().max(0.0) as u32).min(image.width());
    let y1 = ((y + outer * sy).ceil().max(0.0) as u32).min(image.height());
    for py in y0..y1 {
        for px in x0..x1 {
            let delta = (((px as f64 - x) / sx).hypot((py as f64 - y) / sy) - radius).abs();
            if delta <= half_stroke {
                image.put_pixel(px, py, Rgb([255, 20, 120]));
            } else if delta <= half_stroke + 2.0 {
                image.put_pixel(px, py, Rgb([255, 255, 255]));
            }
        }
    }
}
#[derive(Debug, Serialize)]
pub struct FrameAt {
    pub t: f64,
    pub frame_t: f64,
    pub file: PathBuf,
    pub ringed: bool,
}

fn frame_times(pack: &PackDir, session: &Session, cfg: &Config) -> Result<Vec<f64>, PackError> {
    let video = session
        .video
        .as_ref()
        .ok_or("No screen video was captured")?;
    // Packet timestamps only: stream copy does not decode the video.
    let output = run(Command::new(&cfg.ffmpeg_bin)
        .args(["-hide_banner", "-loglevel", "error", "-copyts", "-i"])
        .arg(pack.root().join(&video.file))
        .args(["-map", "0:v:0", "-c:v", "copy", "-f", "framecrc", "-"]))?;
    let mut base = None;
    let mut times = vec![];
    for line in std::str::from_utf8(&output)?.lines() {
        if let Some(tb) = line.strip_prefix("#tb 0:") {
            let (n, d) = tb.trim().split_once('/').ok_or("missing video time base")?;
            base = Some(n.parse::<f64>()? / d.parse::<f64>()?);
        } else if !line.starts_with('#') && !line.trim().is_empty() {
            let pts = line
                .split(',')
                .nth(2)
                .ok_or("missing video packet time")?
                .trim()
                .parse::<f64>()?;
            times.push(pts * base.ok_or("missing video time base")?);
        }
    }
    times.sort_by(f64::total_cmp);
    times.dedup();
    if times.is_empty() {
        return Err("Video has no frames".into());
    }
    Ok(times)
}
fn choose_frame(times: &[f64], requested: f64) -> f64 {
    times[times.partition_point(|t| *t <= requested).saturating_sub(1)]
}
pub(crate) fn seek_arg(time: f64) -> String {
    // ffmpeg parses seeks to microseconds. Round down so a fractional PTS cannot
    // round past the selected frame and accidentally return the next change.
    format!("{:.6}", (time.max(0.0) * 1_000_000.0).floor() / 1_000_000.0)
}
fn decode(
    pack: &PackDir,
    session: &Session,
    cfg: &Config,
    file_t: f64,
) -> Result<RgbImage, PackError> {
    let video = session
        .video
        .as_ref()
        .ok_or("No screen video was captured")?;
    let out = run(Command::new(&cfg.ffmpeg_bin)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            &seek_arg(file_t),
            "-i",
        ])
        .arg(pack.root().join(&video.file))
        .args(["-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"]))?;
    Ok(image::load_from_memory(&out)?.to_rgb8())
}
fn cursor_pixel(
    session: &Session,
    image: &RgbImage,
    cursor: Option<(f64, f64)>,
) -> Option<(f64, f64, f64, f64)> {
    session.display.as_ref().and_then(|d| {
        cursor.and_then(|(x, y)| {
            if x < d.x as f64
                || y < d.y as f64
                || x >= d.x as f64 + d.w as f64
                || y >= d.y as f64 + d.h as f64
            {
                return None;
            }
            let (sx, sy) = (
                session.video.as_ref().unwrap().width as f64 / d.w as f64,
                session.video.as_ref().unwrap().height as f64 / d.h as f64,
            );
            let (px, py) = ((x - d.x as f64) * sx, (y - d.y as f64) * sy);
            (px >= 0.0 && py >= 0.0 && px < image.width() as f64 && py < image.height() as f64)
                .then_some((px, py, sx, sy))
        })
    })
}

pub fn frame_at(
    pack: &PackDir,
    cfg: &Config,
    t: f64,
    out: &Path,
    ring_cursor: bool,
) -> Result<FrameAt, PackError> {
    if !t.is_finite() {
        return Err("Frame time must be finite".into());
    }
    let session = Session::load(pack)?;
    let video = session
        .video
        .as_ref()
        .ok_or("No screen video was captured")?;
    let times = frame_times(pack, &session, cfg)?;
    let selected = choose_frame(&times, t - video.start_t);
    let mut image = decode(pack, &session, cfg, selected)?;
    let mut ringed = false;
    if ring_cursor {
        let mut warnings = vec![];
        let events: Vec<_> = crate::read_jsonl(&pack.events(), session.duration, &mut warnings)?
            .into_iter()
            .map(|(_, v)| v)
            .collect();
        let cursor: Vec<_> = crate::read_jsonl(&pack.cursor(), session.duration, &mut warnings)?
            .into_iter()
            .map(|(_, v)| v)
            .collect();
        if let Some((x, y, sx, sy)) = cursor_pixel(&session, &image, cursor_at(t, &cursor, &events))
        {
            ring(&mut image, x, y, sx, sy);
            ringed = true;
        }
    }
    image.save(out)?;
    Ok(FrameAt {
        t,
        frame_t: video.start_t + selected,
        file: out.to_path_buf(),
        ringed,
    })
}

fn extract(
    pack: &PackDir,
    session: &Session,
    cfg: &Config,
    time: f64,
    file_t: f64,
    name: &str,
    cursor: Option<(f64, f64)>,
) -> Result<Frame, PackError> {
    let frame_t = session.video.as_ref().unwrap().start_t + file_t;
    let mut image = decode(pack, session, cfg, file_t)?;
    let pixel = cursor_pixel(session, &image, cursor);
    let (mut zoom, mut note) = (None, None);
    if let Some((x, y, sx, sy)) = pixel {
        ring(&mut image, x, y, sx, sy);
        let (w, h) = (900.min(image.width()), 600.min(image.height()));
        let left = (x - w as f64 / 2.0)
            .round()
            .clamp(0.0, (image.width() - w) as f64) as u32;
        let top = (y - h as f64 / 2.0)
            .round()
            .clamp(0.0, (image.height() - h) as f64) as u32;
        let zoom_name = format!("frames/{name}-zoom.jpg");
        imageops::crop_imm(&image, left, top, w, h)
            .to_image()
            .save(pack.root().join(&zoom_name))?;
        zoom = Some(zoom_name);
    } else {
        note = Some(
            if cursor.is_none() {
                "Cursor position was not captured; ring and zoom omitted."
            } else if session.display.is_none() {
                "Recorded display geometry was not captured; ring and zoom omitted."
            } else {
                "Cursor was not on the recorded display; ring and zoom omitted."
            }
            .into(),
        );
    }
    if time < frame_t {
        let first = format!("first video frame, {:.3} s after the mark", frame_t - time);
        note = Some(match note {
            Some(note) => format!("{first}; {note}"),
            None => first,
        });
    }
    if image.width() > 1920 {
        let height = (image.height() as f64 * 1920.0 / image.width() as f64).round() as u32;
        image = imageops::resize(&image, 1920, height, FilterType::Lanczos3);
    }
    let file = format!("frames/{name}.jpg");
    image.save(pack.root().join(&file))?;
    Ok(Frame {
        file,
        zoom,
        t: time.max(frame_t),
        frame_t,
        note,
        mark: None,
        said: String::new(),
    })
}
pub fn make_frames(
    pack: &PackDir,
    session: &Session,
    cfg: &Config,
    items: &mut [Item],
    cursor: &[Value],
    events: &[Value],
    warnings: &mut Vec<String>,
) -> Result<(), PackError> {
    fs::create_dir_all(pack.frames_dir())?;
    // Delete only files this crate generated, so rerunning cannot leave stale item frames.
    for entry in fs::read_dir(pack.frames_dir())? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if generated_frame(&name) {
            fs::remove_file(entry.path())?;
        }
    }
    if !session
        .video
        .as_ref()
        .is_some_and(|v| crate::has_data(&pack.root().join(&v.file)))
    {
        warnings.push("No screen video was captured; key frames could not be extracted.".into());
        return Ok(());
    }
    let times = match frame_times(pack, session, cfg) {
        Ok(times) => times,
        Err(error) => {
            warnings.push(format!("Video frame times unavailable: {error}"));
            return Ok(());
        }
    };
    let video = session.video.as_ref().unwrap();
    for item in items {
        for request in selected_frames(item) {
            let time = request.t;
            match extract(
                pack,
                session,
                cfg,
                time,
                choose_frame(&times, time - video.start_t),
                &request.name,
                cursor_at(time, cursor, events),
            ) {
                Ok(mut frame) => {
                    frame.mark = request.mark;
                    frame.said = request.said;
                    item.frames.push(frame);
                }
                Err(e) => warnings.push(format!(
                    "Item {} frame at t {time:.3} unavailable: {e}",
                    item.id
                )),
            }
        }
        if let Some(frame) = item.frames.first() {
            item.dive["ffmpeg"] = json!(crate::summary::frame_hint(
                &video.file,
                frame.frame_t - video.start_t
            ));
        }
    }
    Ok(())
}

struct FrameRequest {
    t: f64,
    name: String,
    mark: Option<u64>,
    said: String,
}
fn words_around(item: &Item, time: f64) -> String {
    let Some((i, _)) = item.words.iter().enumerate().min_by(|a, b| {
        let distance = |w: &crate::moments::Word| (w.t0 - time).max(time - w.t1).max(0.0);
        distance(a.1).total_cmp(&distance(b.1))
    }) else {
        return String::new();
    };
    item.words[i.saturating_sub(3)..(i + 4).min(item.words.len())]
        .iter()
        .map(|w| w.w.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}
fn selected_frames(item: &Item) -> Vec<FrameRequest> {
    let mut requests = vec![FrameRequest {
        t: item.anchor_t,
        name: format!("item-{:02}", item.id),
        mark: item.marks.first().and_then(|m| m["n"].as_u64()),
        said: words_around(item, item.anchor_t),
    }];
    for mark in item.marks.iter().skip(1) {
        let n = mark["n"].as_u64().unwrap();
        requests.push(FrameRequest {
            t: t(mark),
            name: format!("item-{:02}-mark-{n}", item.id),
            mark: Some(n),
            said: words_around(item, t(mark)),
        });
    }
    if let Some(click) = item
        .clicks
        .iter()
        .find(|c| markupr_core::round_t((t(c) - item.anchor_t).abs()) > 1.0)
    {
        let time = markupr_core::round_t(t(click) + 0.3);
        requests.push(FrameRequest {
            t: time,
            name: format!("item-{:02}-click", item.id),
            mark: None,
            said: words_around(item, time),
        });
    }
    requests
}
fn generated_frame(name: &str) -> bool {
    let Some(stem) = name
        .strip_prefix("item-")
        .and_then(|s| s.strip_suffix(".jpg"))
    else {
        return false;
    };
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    let stem = stem.strip_suffix("-zoom").unwrap_or(stem);
    if let Some((item, mark)) = stem.split_once("-mark-") {
        digits(item) && digits(mark)
    } else {
        digits(stem.strip_suffix("-click").unwrap_or(stem))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::moments::{detect, utterances, Word};
    use serde_json::json;
    #[test]
    fn a_still_screen_uses_the_previous_frame_instead_of_a_future_click_result() {
        let times = [0.0, 5.0, 10.0];
        assert_eq!(choose_frame(&times, 3.0), 0.0);
        assert_eq!(choose_frame(&times, 7.0), 5.0);
        assert_eq!(choose_frame(&times, 12.0), 10.0);
        assert_eq!(choose_frame(&times, -1.0), 0.0);
    }
    #[test]
    fn two_marks_in_one_spoken_item_do_not_lose_the_second_frame_or_its_words() {
        let words = (0..20)
            .map(|i| Word {
                t0: i as f64 * 0.4,
                t1: i as f64 * 0.4 + 0.35,
                w: format!("word{i}"),
            })
            .collect();
        let result = detect(
            &utterances(words),
            &[
                json!({"t":2.0,"type":"mark","n":1}),
                json!({"t":5.0,"type":"mark","n":2}),
            ],
            &[],
        );
        assert_eq!(result.items.len(), 1);
        let selected = selected_frames(&result.items[0]);
        assert_eq!(
            selected
                .iter()
                .map(|r| (r.t, r.name.as_str()))
                .collect::<Vec<_>>(),
            vec![(2.0, "item-01"), (5.0, "item-01-mark-2")]
        );
        assert!(selected[0].said.contains("word5"));
        assert!(selected[1].said.contains("word12"));
        assert!(generated_frame("item-01-mark-2.jpg"));
        assert!(generated_frame("item-01-mark-2-zoom.jpg"));
        assert!(!generated_frame("item-01-mark-notes.jpg"));
    }
}
