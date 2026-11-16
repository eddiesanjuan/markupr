use crate::{
    moments::{t, Frame, Item},
    run, PackError,
};
use image::{
    imageops::{self, FilterType},
    Rgb, RgbImage,
};
use markupr_core::{Config, PackDir, Session};
use serde_json::Value;
use std::{fs, process::Command};

pub fn cursor_at(time: f64, cursor: &[Value], events: &[Value]) -> Option<(f64, f64)> {
    cursor
        .iter()
        .chain(
            events
                .iter()
                .filter(|v| matches!(crate::moments::kind(v), "mouse_down" | "mark")),
        )
        .filter(|v| t(v) <= time && v["x"].is_number() && v["y"].is_number())
        .max_by(|a, b| t(a).total_cmp(&t(b)))
        .map(|v| (v["x"].as_f64().unwrap(), v["y"].as_f64().unwrap()))
}
fn ring(image: &mut RgbImage, x: f64, y: f64, scale: f64) {
    let radius = 28.0 * scale;
    let half_stroke = 3.0 * scale;
    let outer = radius + half_stroke + 2.0 * scale;
    let x0 = (x - outer).max(0.0) as u32;
    let y0 = (y - outer).max(0.0) as u32;
    let x1 = ((x + outer).ceil().max(0.0) as u32).min(image.width());
    let y1 = ((y + outer).ceil().max(0.0) as u32).min(image.height());
    for py in y0..y1 {
        for px in x0..x1 {
            let delta = ((px as f64 - x).hypot(py as f64 - y) - radius).abs();
            if delta <= half_stroke {
                image.put_pixel(px, py, Rgb([255, 20, 120]));
            } else if delta <= half_stroke + 2.0 * scale {
                image.put_pixel(px, py, Rgb([255, 255, 255]));
            }
        }
    }
}
fn extract(
    pack: &PackDir,
    session: &Session,
    cfg: &Config,
    time: f64,
    name: &str,
    cursor: Option<(f64, f64)>,
) -> Result<Frame, PackError> {
    let video = session.video.as_ref().unwrap();
    let video_t = time - video.start_t;
    if video_t < 0.0 {
        return Err(format!(
            "t {time:.3} precedes the first video frame at {:.3}",
            video.start_t
        )
        .into());
    }
    let out = run(Command::new(&cfg.ffmpeg_bin)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            &format!("{video_t:.3}"),
            "-i",
        ])
        .arg(pack.root().join(&video.file))
        .args(["-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"]))?;
    let mut image = image::load_from_memory(&out)?.to_rgb8();
    let pixel = session.display.as_ref().and_then(|d| {
        cursor.and_then(|(x, y)| {
            if x < d.x as f64
                || y < d.y as f64
                || x >= d.x as f64 + d.w as f64
                || y >= d.y as f64 + d.h as f64
            {
                return None;
            }
            let (px, py) = ((x - d.x as f64) * d.scale, (y - d.y as f64) * d.scale);
            (px >= 0.0 && py >= 0.0 && px < image.width() as f64 && py < image.height() as f64)
                .then_some((px, py, d.scale))
        })
    });
    let (mut zoom, mut note) = (None, None);
    if let Some((x, y, scale)) = pixel {
        ring(&mut image, x, y, scale);
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
    if image.width() > 1920 {
        let height = (image.height() as f64 * 1920.0 / image.width() as f64).round() as u32;
        image = imageops::resize(&image, 1920, height, FilterType::Lanczos3);
    }
    let file = format!("frames/{name}.jpg");
    image.save(pack.root().join(&file))?;
    Ok(Frame {
        file,
        zoom,
        t: time,
        note,
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
        let stem = name
            .strip_prefix("item-")
            .and_then(|s| s.strip_suffix(".jpg"));
        if stem.is_some_and(|s| {
            s.split('-')
                .next()
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
                && ["", "-zoom", "-click", "-click-zoom"]
                    .iter()
                    .any(|suffix| s.trim_start_matches(|c: char| c.is_ascii_digit()) == *suffix)
        }) {
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
    for item in items {
        let mut times = vec![(item.anchor_t, format!("item-{:02}", item.id))];
        if let Some(click) = item
            .clicks
            .iter()
            .find(|c| (t(c) - item.anchor_t).abs() > 1.0)
        {
            times.push((
                markupr_core::round_t(t(click) + 0.3),
                format!("item-{:02}-click", item.id),
            ));
        }
        for (time, name) in times {
            match extract(
                pack,
                session,
                cfg,
                time,
                &name,
                cursor_at(time, cursor, events),
            ) {
                Ok(frame) => item.frames.push(frame),
                Err(e) => warnings.push(format!(
                    "Item {} frame at t {time:.3} unavailable: {e}",
                    item.id
                )),
            }
        }
    }
    Ok(())
}
