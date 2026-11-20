use crate::{
    moments::{Utterance, Word},
    run, run_timed, CommandTimeout, PackError,
};
use crate::{AudioSource, PackOptions};
use markupr_core::{round_t, Config, PackDir, Session};
use serde::Serialize;
use serde_json::Value;
use std::{fs, process::Command, time::Duration};

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
    let (mut ignored, mut wordless) = (0, 0);
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
        let samples = read_pcm(&wav, cfg)?;
        let found = crate::speech_stretches::detect(&samples);
        let hops = if found.is_empty() {
            vec![]
        } else {
            crate::speech_stretches::voicing(&samples)
        };
        // Whisper hears only voiced islands: never the typing between two
        // remarks, nor a stretch of sound without a voice.
        let mut stretches = vec![];
        for stretch in &found {
            let islands = crate::speech_stretches::islands(&hops, *stretch);
            if islands.is_empty() {
                ignored += 1;
            }
            stretches.extend(islands);
        }
        if stretches.is_empty() {
            return Ok(vec![]);
        }
        let segments = match transcribe_stretches(
            &samples,
            &stretches,
            start_t,
            temp.path(),
            cfg,
            model,
            true,
        ) {
            Ok(segments) => segments,
            Err(error) if error.downcast_ref::<CommandTimeout>().is_some() => return Err(error),
            Err(error) => {
                warnings.push(format!(
                    "Speech timing alignment failed: {error}; using single-pass Whisper timing."
                ));
                // The fallback also sees only accepted stretches, so it cannot
                // turn the rejected clicks or fan noise into an utterance.
                transcribe_stretches(
                    &samples,
                    &stretches,
                    start_t,
                    temp.path(),
                    cfg,
                    model,
                    false,
                )?
            }
        };
        wordless = stretches.len() - segments.len();
        Ok(segments)
    })();
    match ignored {
        0 => {}
        1 => warnings.push("1 stretch of sound without a voice was ignored".into()),
        n => warnings.push(format!(
            "{n} stretches of sound without a voice were ignored"
        )),
    }
    // Transcribed, then dropped by the word-rate floor: a pitch, but almost no words.
    match wordless {
        0 => {}
        1 => warnings.push(
            "1 stretch of sound with a voice-like pitch but almost no words was ignored (music or a tone)".into(),
        ),
        n => warnings.push(format!(
            "{n} stretches of sound with a voice-like pitch but almost no words were ignored (music or a tone)"
        )),
    }
    match result {
        Ok(segments) => {
            transcript.segments = segments;
            if transcript.segments.is_empty() && ignored + wordless == 0 {
                warnings.push(format!(
                    "No speech was detected in the {} audio.",
                    transcript.source
                ));
            }
        }
        Err(e) => warnings.push(format!("Speech could not be transcribed: {e}")),
    }
    transcript
}

fn whisper(cfg: &Config, model: &std::path::Path) -> Command {
    let mut command = Command::new(&cfg.whisper.bin);
    command.arg("-m").arg(model).args([
        "-ojf",
        "-ml",
        "1",
        "-sow",
        "-np",
        "-l",
        &cfg.whisper.language,
        "--suppress-nst",
    ]);
    command
}

fn read_pcm(wav: &std::path::Path, cfg: &Config) -> Result<Vec<i16>, PackError> {
    let pcm = run(Command::new(&cfg.ffmpeg_bin)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(wav)
        .args(["-f", "s16le", "-c:a", "pcm_s16le", "-"]))?;
    Ok(pcm
        .chunks_exact(2)
        .map(|s| i16::from_le_bytes([s[0], s[1]]))
        .collect())
}
fn transcribe_stretches(
    samples: &[i16],
    stretches: &[crate::speech_stretches::Stretch],
    start_t: f64,
    temp: &std::path::Path,
    cfg: &Config,
    model: &std::path::Path,
    dtw: bool,
) -> Result<Vec<Utterance>, PackError> {
    use crate::speech_stretches::{plausible_word_rate, RATE};
    let mut command = whisper(cfg, model);
    let mut files = vec![];
    let mut offsets = vec![];
    for (i, stretch) in stretches.iter().enumerate() {
        let lo = if i > 0 && stretches[i - 1].end == stretch.start {
            stretch.start
        } else {
            stretch.start.saturating_sub(RATE * 12 / 100)
        };
        let hi = if stretches
            .get(i + 1)
            .is_some_and(|next| next.start == stretch.end)
        {
            stretch.end
        } else {
            (stretch.end + RATE * 12 / 100).min(samples.len())
        };
        let file = temp.join(format!("stretch-{i}.wav"));
        write_wav(&file, &samples[lo..hi])?;
        command.arg("-of").arg(temp.join(format!("stretch-{i}")));
        files.push(file);
        offsets.push(lo as f64 / RATE as f64);
    }
    // DTW needs cross-attention, so flash attention must be disabled. Keep
    // Whisper's normal encoder context: shortened contexts repeated phrases.
    if dtw {
        let preset = model
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("model has no filename")?
            .trim_start_matches("ggml-")
            .replace('-', ".");
        command.args(["-dtw", &preset, "-nfa"]);
    }
    // Several files in one invocation: load the configured model only once.
    run_timed(
        command.args(&files),
        Duration::from_secs_f64(60.0 + 2.0 * samples.len() as f64 / RATE as f64),
    )?;
    let mut result = vec![];
    for (i, stretch) in stretches.iter().enumerate() {
        let output: Value = serde_json::from_slice(&fs::read(files[i].with_extension("json"))?)?;
        let t0 = round_t(start_t + stretch.start as f64 / RATE as f64);
        let t1 = round_t(start_t + stretch.end as f64 / RATE as f64);
        let mut words = if dtw {
            aligned_words(&output, start_t + offsets[i], t0, t1)?
        } else {
            read_words(&output, start_t + offsets[i])
        };
        words.retain(|word| word.t0 <= t1 && word.t1 >= t0);
        for word in &mut words {
            word.t0 = word.t0.clamp(t0, t1);
            word.t1 = word.t1.clamp(word.t0, t1);
        }
        if plausible_word_rate(words.len(), t1 - t0) {
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
fn write_wav(path: &std::path::Path, samples: &[i16]) -> Result<(), PackError> {
    let pcm: Vec<u8> = samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect();
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
    file.write_all(&pcm)?;
    Ok(())
}

fn read_words(output: &Value, start_t: f64) -> Vec<Word> {
    let mut words = vec![];
    if let Some(segments) = output["transcription"].as_array() {
        for (segment, text) in segments.iter().zip(label_texts(segments)) {
            // -ml 1 -sow emits word-sized segments. Segment end times can
            // span a long silence; use lexical token times, not punctuation.
            if text.is_empty() {
                continue;
            }
            let lexical: Vec<_> = segment["tokens"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|token| {
                    let text = token["text"].as_str().unwrap_or("").trim();
                    !text.starts_with("[_")
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
                w: text,
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
    for (segment, text) in segments.iter().zip(label_texts(segments)) {
        if text.is_empty() {
            continue;
        }
        let tokens: Vec<_> = segment["tokens"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|token| {
                let text = token["text"].as_str().unwrap_or("").trim();
                !text.starts_with("[_")
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

fn label_texts(segments: &[Value]) -> Vec<String> {
    let mut chars = vec![];
    for (segment, value) in segments.iter().enumerate() {
        let text = value["text"].as_str().unwrap_or("");
        if text.trim_start().starts_with("<|") {
            continue;
        }
        chars.extend(text.chars().map(|c| (segment, c)));
        chars.push((segment, ' '));
    }
    let music = |c| ['♪', '♫', '♬', '♩'].contains(&c);
    let mut result = vec![String::new(); segments.len()];
    let mut i = 0;
    while i < chars.len() {
        let (segment, c) = chars[i];
        let closing = match c {
            '(' => Some(')'),
            '[' => Some(']'),
            '*' => Some('*'),
            c if music(c) => Some(c),
            _ => None,
        };
        if let Some(closing) = closing {
            let mut start = i + 1;
            if c == '*' {
                while start < chars.len() && chars[start].1 == '*' {
                    start += 1;
                }
            }
            let (mut words, mut in_word, mut end) = (0, false, None);
            for (j, (_, next)) in chars.iter().enumerate().skip(start) {
                if *next == closing || (music(closing) && music(*next)) {
                    end = Some(j);
                    break;
                }
                if next.is_whitespace() {
                    in_word = false;
                } else if next.is_alphanumeric() && !in_word {
                    words += 1;
                    in_word = true;
                    if words > 4 {
                        break;
                    }
                }
            }
            if let Some(end) = end {
                i = end + 1;
                if closing == '*' {
                    while i < chars.len() && chars[i].1 == '*' {
                        i += 1;
                    }
                }
                continue;
            }
        }
        result[segment].push(c);
        i += 1;
    }
    result
        .into_iter()
        .map(|text| {
            if text.chars().any(char::is_alphanumeric) {
                text.trim().to_owned()
            } else {
                String::new()
            }
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn non_speech_labels_split_across_word_tokens_do_not_become_narration() {
        let segments: Vec<_> = [
            "(upbeat",
            " music)",
            " [BLANK_AUDIO]",
            "*laughing*",
            "**music**",
            "♪",
            "instrumental",
            "♫",
            "Please",
            " save",
            " this.",
        ]
        .iter()
        .map(|text| json!({"text":text}))
        .collect();
        assert_eq!(
            label_texts(&segments)
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>(),
            vec!["Please", "save", "this."]
        );
    }
    #[test]
    fn an_unclosed_bracket_does_not_drop_the_rest_of_the_transcript() {
        let words = [
            "[Please", "save", "the", "cart", "and", "then", "close", "it.",
        ];
        let segments: Vec<_> = words.iter().map(|text| json!({"text":text})).collect();
        assert_eq!(label_texts(&segments), words);
        let distant: Vec<_> = [
            "(Please", "save", "the", "cart", "and", "then", "close", "it.)",
        ]
        .iter()
        .map(|text| json!({"text":text}))
        .collect();
        assert_eq!(
            label_texts(&distant)
                .iter()
                .filter(|w| !w.is_empty())
                .count(),
            8
        );
    }
}
