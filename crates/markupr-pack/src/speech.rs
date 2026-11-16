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
        let prefix = temp.path().join("words");
        run(Command::new(&cfg.whisper.bin)
            .arg("-m")
            .arg(model)
            .arg("-f")
            .arg(wav)
            .args(["-ojf", "-ml", "1", "-sow", "-np", "-l", "en", "-of"])
            .arg(&prefix))?;
        let output: Value = serde_json::from_slice(&fs::read(prefix.with_extension("json"))?)?;
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
        Ok(utterances(words))
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
