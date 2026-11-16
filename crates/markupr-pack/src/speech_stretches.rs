//! Speech boundaries from the recording's own energy, independent of Whisper times.
pub const RATE: usize = 16_000;
const FRAME: usize = RATE / 50; // 20 ms

#[derive(Clone, Copy, Debug)]
pub struct Stretch {
    pub start: usize,
    pub end: usize,
}

pub fn detect(samples: &[i16]) -> Vec<Stretch> {
    let energy: Vec<f64> = samples
        .chunks(FRAME)
        .map(|frame| {
            (frame.iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / frame.len() as f64).sqrt()
        })
        .collect();
    if energy.is_empty() {
        return vec![];
    }
    let mut sorted = energy.clone();
    sorted.sort_by(f64::total_cmp);
    let floor = sorted[sorted.len() / 5];
    let peak = *sorted.last().unwrap();
    if peak == 0.0 || peak < floor * 2.0 {
        return vec![];
    }
    // Relative to the measured room noise, with bounds relative to this recording's
    // loudest speech. A quiet voice must not need to cross a fixed dB threshold.
    let threshold = (floor * 3.0).max(peak * 0.015).min(peak * 0.2);
    let mut ranges = vec![];
    let mut start = None;
    let mut last = 0;
    let finish = |start: usize, last: usize, ranges: &mut Vec<Stretch>| {
        if last + 1 - start >= 8 {
            // Ignore isolated transients shorter than 160 ms.
            ranges.push(Stretch {
                start: start.saturating_sub(1) * FRAME,
                end: ((last + 4) * FRAME).min(samples.len()), // 60 ms hangover
            });
        }
    };
    for (i, rms) in energy.iter().enumerate() {
        if *rms < threshold {
            continue;
        }
        if let Some(first) = start {
            if i - last - 1 > 25 {
                // Join up to 500 ms of quiet inside a sentence.
                finish(first, last, &mut ranges);
                start = Some(i);
            }
        } else {
            start = Some(i);
        }
        last = i;
    }
    if let Some(first) = start {
        finish(first, last, &mut ranges);
    }
    let mut result = vec![];
    for mut range in ranges {
        while range.end - range.start > 12 * RATE {
            // Cut long speech near 12 s at the quietest 100 ms, rather than at a word
            // timestamp stretched by Whisper. Short stretches never use this branch.
            let lo = (range.start + 8 * RATE) / FRAME;
            let hi = (range.start + 12 * RATE) / FRAME;
            let cut = (lo..hi)
                .min_by(|a, b| {
                    let rms = |i: usize| {
                        energy[i.saturating_sub(2)..(i + 3).min(energy.len())]
                            .iter()
                            .sum::<f64>()
                    };
                    rms(*a).total_cmp(&rms(*b))
                })
                .unwrap()
                * FRAME;
            result.push(Stretch {
                start: range.start,
                end: cut,
            });
            range.start = cut;
        }
        result.push(range);
    }
    result
}

/// Find sustained voiced sound, not just energy. Bounds remain relative to samples.
pub fn speech_bounds(samples: &[i16]) -> Option<Stretch> {
    const WINDOW: usize = RATE * 30 / 1000;
    const STEP: usize = RATE * 15 / 1000;
    let peak = samples
        .chunks(WINDOW)
        .map(|frame| {
            (frame.iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / frame.len() as f64).sqrt()
        })
        .fold(0.0, f64::max);
    let (mut active, mut voiced, mut run, mut longest) = (0, 0, 0, 0);
    let (mut first, mut last) = (samples.len(), 0);
    for start in (0..samples.len().saturating_sub(WINDOW)).step_by(STEP) {
        // Average to 4 kHz: cheaper pitch detection, less high-frequency click noise.
        let mut frame = [0.0; WINDOW / 4];
        for (out, input) in frame
            .iter_mut()
            .zip(samples[start..start + WINDOW].chunks_exact(4))
        {
            *out = input.iter().map(|s| *s as f64).sum::<f64>() / 4.0;
        }
        let mean = frame.iter().sum::<f64>() / frame.len() as f64;
        for sample in &mut frame {
            *sample -= mean;
        }
        let rms = (frame.iter().map(|v| v * v).sum::<f64>() / frame.len() as f64).sqrt();
        if rms < peak * 0.04 || rms == 0.0 {
            run = 0;
            continue;
        }
        active += 1;
        let mut correlation = [0.0; 52];
        for lag in 3..52 {
            let (mut dot, mut left, mut right) = (0.0, 0.0, 0.0);
            for i in lag..frame.len() {
                dot += frame[i] * frame[i - lag];
                left += frame[i] * frame[i];
                right += frame[i - lag] * frame[i - lag];
            }
            correlation[lag] = dot / (left * right).sqrt().max(1e-9);
        }
        // Use the first strong peak, not a subharmonic which makes a high chime
        // look like low-pitched speech. This also accepts higher-pitched voices.
        let pitch = (4..51).find(|lag| {
            correlation[*lag] > 0.65
                && correlation[*lag] > correlation[*lag - 1]
                && correlation[*lag] >= correlation[*lag + 1]
        });
        if pitch.is_some_and(|lag| (80.0..=350.0).contains(&(4000.0 / lag as f64))) {
            voiced += 1;
            run += 1;
            longest = longest.max(run);
            first = first.min(start);
            last = start + WINDOW;
        } else {
            run = 0;
        }
    }
    if voiced < 4 || longest < 3 || voiced * 10 < active {
        return None;
    }
    // Preserve consonants and the existing energy boundaries. Trim only distant
    // leading/trailing noise which was joined to real speech by the energy detector.
    Some(Stretch {
        start: if first > RATE / 2 {
            first.saturating_sub(RATE / 5)
        } else {
            0
        },
        end: if samples.len() - last > RATE / 2 {
            (last + RATE * 2 / 5).min(samples.len())
        } else {
            samples.len()
        },
    })
}

pub fn plausible_word_rate(words: usize, seconds: f64) -> bool {
    words > 0 && (seconds < 4.0 || words as f64 / seconds >= 0.65)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn voice(samples: &mut [i16], start: f64, end: f64, amplitude: f64) {
        for (i, sample) in samples
            .iter_mut()
            .enumerate()
            .take((end * RATE as f64) as usize)
            .skip((start * RATE as f64) as usize)
        {
            *sample += (amplitude * (i as f64 * 0.11).sin()) as i16;
        }
    }
    #[test]
    fn quiet_speech_inside_a_noisy_recording_is_not_missed() {
        let mut seed = 7u32;
        let mut samples: Vec<i16> = (0..5 * RATE)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                ((seed >> 16) as i32 % 121 - 60) as i16
            })
            .collect();
        voice(&mut samples, 1.0, 2.0, 8000.0);
        voice(&mut samples, 3.0, 4.0, 600.0);
        let ranges = detect(&samples);
        assert_eq!(ranges.len(), 2);
        assert!((ranges[1].start as f64 / RATE as f64 - 3.0).abs() < 0.1);
        assert!((ranges[1].end as f64 / RATE as f64 - 4.0).abs() < 0.1);
    }
    #[test]
    fn a_short_pause_does_not_split_one_sentence() {
        let mut samples = vec![0; 6 * RATE];
        voice(&mut samples, 1.0, 2.0, 2000.0);
        voice(&mut samples, 2.18, 3.0, 2000.0);
        voice(&mut samples, 3.4, 4.0, 2000.0);
        voice(&mut samples, 5.0, 5.6, 2000.0);
        let ranges = detect(&samples);
        assert_eq!(ranges.len(), 2); // Short pauses join; a full second of quiet separates.
        assert!((ranges[0].start as f64 / RATE as f64 - 1.0).abs() < 0.1);
        assert!((ranges[0].end as f64 / RATE as f64 - 4.0).abs() < 0.1);
    }
    #[test]
    fn key_and_mouse_noise_does_not_become_an_invented_sentence() {
        let mut seed = 53u32;
        let mut random = || {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed >> 16) as f64 / 32768.0 - 1.0
        };
        let mut samples: Vec<i16> = (0..12 * RATE).map(|_| (random() * 25.0) as i16).collect();
        let mut offset = RATE / 10;
        while offset + 160 < samples.len() {
            for sample in &mut samples[offset..offset + 160] {
                *sample += (random() * 9000.0) as i16;
            }
            offset += (RATE as f64 * (0.12 + (random() + 1.0) * 0.13)) as usize;
        }
        let ranges = detect(&samples);
        assert!(!ranges.is_empty());
        assert!(ranges
            .iter()
            .all(|s| speech_bounds(&samples[s.start..s.end]).is_none()));
    }
    #[test]
    fn a_stock_phrase_over_long_noise_is_rejected_without_rejecting_short_or_slow_speech() {
        assert!(!plausible_word_rate(4, 10.7));
        assert!(plausible_word_rate(3, 0.8));
        assert!(plausible_word_rate(4, 3.8));
        assert!(plausible_word_rate(7, 8.0));
    }
}
