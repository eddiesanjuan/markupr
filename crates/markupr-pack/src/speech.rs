use crate::{
    moments::{utterances, Utterance, Word},
    run, PackError,
};
use crate::{AudioSource, PackOptions};
use markupr_core::{round_t, Config, PackDir, Session};
use serde::Serialize;
use serde_json::Value;
use std::{fs, process::Command};

#[derive(Serialize)]
pub struct Transcript {
    pub model: Option<String>,
    pub source: &'static str,
    pub segments: Vec<Utterance>,
}
pub fn transcribe(
    pack: &PackDir,
    session: &Session,
    cfg: &Config,
    opts: &PackOptions,
    warnings: &mut Vec<String>,
) -> Transcript {
    let mut transcript = Transcript {
        model: None,
        source: match opts.audio_source {
            AudioSource::Mic => "mic",
            AudioSource::System => "system",
        },
        segments: vec![],
    };
    let audio = match opts.audio_source {
        AudioSource::Mic => session
            .mic
            .as_ref()
            .map(|a| (a.file.as_str(), a.start_t, None)),
        AudioSource::System => session
            .system_audio
            .as_ref()
            .map(|a| (a.file.as_str(), a.start_t, Some(a.stream.as_str()))),
    };
    let Some((file, start_t, stream)) =
        audio.filter(|(f, _, _)| crate::has_data(&pack.root().join(f)))
    else {
        warnings.push(format!(
            "No {} audio was captured; speech was skipped.",
            transcript.source
        ));
        return transcript;
    };
    let model = if opts.fast {
        &cfg.whisper.fast_model
    } else {
        &cfg.whisper.model
    };
    let Some(model) = model.as_ref().filter(|p| p.is_file()) else {
        warnings.push(format!(
            "No {} Whisper model configured or model file missing; speech was skipped.",
            if opts.fast { "fast" } else { "accurate" }
        ));
        return transcript;
    };
    transcript.model = model.file_stem().map(|s| s.to_string_lossy().into_owned());
    let result = (|| -> Result<Vec<Utterance>, PackError> {
        let temp = tempfile::tempdir()?;
        let wav = temp.path().join("speech.wav");
        let mut ffmpeg = Command::new(&cfg.ffmpeg_bin);
        ffmpeg
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(pack.root().join(file));
        if let Some(stream) = stream {
            ffmpeg.args(["-map", &format!("0:{stream}")]);
        }
        ffmpeg
            .args(["-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"])
            .arg(&wav);
        run(&mut ffmpeg)?;
        match aligned_stretches(&wav, start_t, temp.path(), cfg, model) {
            Ok(segments) => Ok(segments),
            Err(error) => {
                warnings.push(format!(
                    "Speech timing alignment failed: {error}; using single-pass Whisper timing."
                ));
                let prefix = temp.path().join("words");
                let mut command = whisper(cfg, model);
                run(command.arg("-f").arg(&wav).arg("-of").arg(&prefix))?;
                let output: Value =
                    serde_json::from_slice(&fs::read(prefix.with_extension("json"))?)?;
                Ok(utterances(read_words(&output, start_t)))
            }
        }
    })();
    match result {
        Ok(segments) => {
            transcript.segments = segments;
            if transcript.segments.is_empty() {
                warnings.push("No speech was recognized in the selected audio.".into());
            }
        }
        Err(e) => warnings.push(format!("Speech could not be transcribed: {e}")),
    }
    transcript
}

fn whisper(cfg: &Config, model: &std::path::Path) -> Command {
    let mut command = Command::new(&cfg.whisper.bin);
    command
        .arg("-m")
        .arg(model)
        .args(["-ojf", "-ml", "1", "-sow", "-np", "-l", "en"]);
    command
}

fn aligned_stretches(
    wav: &std::path::Path,
    start_t: f64,
    temp: &std::path::Path,
    cfg: &Config,
    model: &std::path::Path,
) -> Result<Vec<Utterance>, PackError> {
    use crate::speech_stretches::{detect, RATE};
    let pcm = run(Command::new(&cfg.ffmpeg_bin)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(wav)
        .args(["-f", "s16le", "-c:a", "pcm_s16le", "-"]))?;
    let samples: Vec<i16> = pcm
        .chunks_exact(2)
        .map(|s| i16::from_le_bytes([s[0], s[1]]))
        .collect();
    let stretches = detect(&samples);
    if stretches.is_empty() {
        return Ok(vec![]);
    }
    let mut command = whisper(cfg, model);
    let mut files = vec![];
    let mut offsets = vec![];
    for (i, stretch) in stretches.iter().enumerate() {
        let lo = stretch.start.saturating_sub(RATE * 12 / 100);
        let hi = (stretch.end + RATE * 12 / 100).min(samples.len());
        let file = temp.join(format!("stretch-{i}.wav"));
        write_wav(&file, &pcm[lo * 2..hi * 2])?;
        command.arg("-of").arg(temp.join(format!("stretch-{i}")));
        files.push(file);
        offsets.push(lo as f64 / RATE as f64);
    }
    // DTW needs cross-attention, so flash attention must be disabled. Keep
    // Whisper's normal encoder context: shortened contexts repeated phrases.
    let preset = model
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("model has no filename")?
        .trim_start_matches("ggml-")
        .replace('-', ".");
    command.args(["-dtw", &preset, "-nfa"]);
    // Several files in one invocation: load the configured model only once.
    run(command.args(&files))?;
    let mut result = vec![];
    for (i, stretch) in stretches.iter().enumerate() {
        let output: Value = serde_json::from_slice(&fs::read(files[i].with_extension("json"))?)?;
        let t0 = round_t(start_t + stretch.start as f64 / RATE as f64);
        let t1 = round_t(start_t + stretch.end as f64 / RATE as f64);
        let words = aligned_words(&output, start_t + offsets[i], t0, t1)?;
        if !words.is_empty() {
            result.push(Utterance {
                t0,
                t1,
                text: words
                    .iter()
                    .map(|w| w.w.as_str())
                    .collect::<Vec<_>>()
                    .join(" "),
                words,
            });
        }
    }
    Ok(result)
}

// The only generated WAV format: 16 kHz, mono, little-endian signed PCM16.
fn write_wav(path: &std::path::Path, pcm: &[u8]) -> Result<(), PackError> {
    use std::io::Write;
    let mut file = fs::File::create(path)?;
    file.write_all(b"RIFF")?;
    file.write_all(&(36 + pcm.len() as u32).to_le_bytes())?;
    file.write_all(b"WAVEfmt ")?;
    file.write_all(&16u32.to_le_bytes())?; // fmt chunk length
    file.write_all(&1u16.to_le_bytes())?; // PCM
    file.write_all(&1u16.to_le_bytes())?; // mono
    file.write_all(&16000u32.to_le_bytes())?;
    file.write_all(&32000u32.to_le_bytes())?; // bytes per second
    file.write_all(&2u16.to_le_bytes())?; // bytes per sample
    file.write_all(&16u16.to_le_bytes())?; // bits per sample
    file.write_all(b"data")?;
    file.write_all(&(pcm.len() as u32).to_le_bytes())?;
    file.write_all(pcm)?;
    Ok(())
}

fn read_words(output: &Value, start_t: f64) -> Vec<Word> {
    let mut words = vec![];
    if let Some(segments) = output["transcription"].as_array() {
        for segment in segments {
            // -ml 1 -sow emits word-sized segments. Segment end times can
            // span a long silence; use lexical token times, not punctuation.
            let text = segment["text"].as_str().unwrap_or("").trim();
            if text.is_empty()
                || (text.starts_with('[') && text.ends_with(']'))
                || text.starts_with("<|")
            {
                continue;
            }
            let lexical: Vec<_> = segment["tokens"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|token| {
                    let text = token["text"].as_str().unwrap_or("").trim();
                    !text.starts_with('[')
                        && !text.starts_with("<|")
                        && text.chars().any(char::is_alphanumeric)
                })
                .collect();
            let Some(from) = lexical
                .iter()
                .filter_map(|v| v["offsets"]["from"].as_f64())
                .min_by(f64::total_cmp)
            else {
                continue;
            };
            let Some(to) = lexical
                .iter()
                .filter_map(|v| v["offsets"]["to"].as_f64())
                .max_by(f64::total_cmp)
            else {
                continue;
            };
            words.push(Word {
                t0: round_t(start_t + from / 1000.0),
                t1: round_t(start_t + to / 1000.0),
                w: text.into(),
            });
        }
    }
    words
}

fn aligned_words(output: &Value, offset: f64, t0: f64, t1: f64) -> Result<Vec<Word>, PackError> {
    let segments = output["transcription"]
        .as_array()
        .ok_or("Whisper returned no transcription array")?;
    let mut timed = vec![];
    for segment in segments {
        let text = segment["text"].as_str().unwrap_or("").trim();
        if text.is_empty() || text.starts_with('[') || text.starts_with("<|") {
            continue;
        }
        let tokens: Vec<_> = segment["tokens"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|token| {
                let text = token["text"].as_str().unwrap_or("").trim();
                !text.starts_with('[')
                    && !text.starts_with("<|")
                    && text.chars().any(char::is_alphanumeric)
            })
            .collect();
        if tokens.is_empty() {
            continue;
        }
        let centers: Vec<f64> = tokens
            .iter()
            .map(|token| {
                token["t_dtw"]
                    .as_f64()
                    .filter(|t| *t >= 0.0)
                    .map(|t| offset + t / 100.0)
                    .ok_or("Whisper did not produce DTW timestamps")
            })
            .collect::<Result<_, _>>()?;
        timed.push((text.to_owned(), centers[0], *centers.last().unwrap()));
    }
    // DTW marks token emission centers, not starts. The boundary between the last
    // token of one word and the first token of the next is their midpoint.
    let mut words: Vec<Word> = vec![];
    for (i, (text, first, _)) in timed.iter().enumerate() {
        let start = if i == 0 {
            t0
        } else {
            (timed[i - 1].2 + first) / 2.0
        };
        let start = round_t(start.clamp(words.last().map_or(t0, |w| w.t0), t1));
        if let Some(prev) = words.last_mut() {
            prev.t1 = start;
        }
        words.push(Word {
            t0: start,
            t1,
            w: text.clone(),
        });
    }
    Ok(words)
}
