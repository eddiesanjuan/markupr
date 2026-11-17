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

// Pitch analysis runs at 8 kHz: 15 ms hops, 40 ms windows, periods for 70 to 450 Hz.
const DOWN: usize = 2;
const HOP: usize = 120;
const WINDOW: usize = 320;
const MIN_LAG: usize = 18;
const MAX_LAG: usize = 114;
const HOPS_PER_SECOND: usize = RATE / DOWN / HOP;

/// One 15 ms analysis step: loudness above the recording's steady background,
/// and the pitch period (in 8 kHz samples) when the step is voiced.
#[derive(Clone, Copy, Debug, Default)]
pub struct Hop {
    pub level: f64,
    pub lag: Option<f64>,
}

#[derive(Clone)]
struct Correlation {
    energy: f64,
    dot: Vec<f64>,
    left: Vec<f64>,
    right: Vec<f64>,
}

fn correlation(frame: &[f64]) -> Correlation {
    let mut squares = vec![0.0; frame.len() + 1];
    for (i, v) in frame.iter().enumerate() {
        squares[i + 1] = squares[i] + v * v;
    }
    let n = frame.len();
    let lags = 0..=MAX_LAG + 1;
    Correlation {
        energy: squares[n],
        dot: lags
            .clone()
            .map(|lag| (lag..n).map(|i| frame[i] * frame[i - lag]).sum())
            .collect(),
        left: lags.clone().map(|lag| squares[n] - squares[lag]).collect(),
        right: lags.map(|lag| squares[n - lag]).collect(),
    }
}

/// Pitch track for the whole recording. The quietest fifth of the recording is its
/// steady background (room noise, a fan, mains hum). Its autocorrelation is
/// subtracted from every step, so a constant hum is not a voice and does not hide one.
pub fn voicing(samples: &[i16]) -> Vec<Hop> {
    // A 4-sample average at 16 kHz, taken every second sample: 8 kHz with
    // less high-frequency click noise.
    let x: Vec<f64> = (0..samples.len() / DOWN)
        .map(|i| {
            let s = &samples[i * DOWN..(i * DOWN + 4).min(samples.len())];
            s.iter().map(|v| *v as f64).sum::<f64>() / s.len() as f64
        })
        .collect();
    if x.len() < WINDOW {
        return vec![];
    }
    let frame = |h: usize| {
        let frame = &x[h * HOP..h * HOP + WINDOW];
        let mean = frame.iter().sum::<f64>() / WINDOW as f64;
        frame.iter().map(|v| v - mean).collect::<Vec<_>>()
    };
    let count = (x.len() - WINDOW) / HOP + 1;
    let energy: Vec<f64> = (0..count)
        .map(|h| frame(h).iter().map(|v| v * v).sum())
        .collect();
    let mut order: Vec<usize> = (0..count).collect();
    order.sort_by(|a, b| energy[*a].total_cmp(&energy[*b]));
    let quiet = &order[..(count / 5).max(1)];
    let mut background = Correlation {
        energy: 0.0,
        dot: vec![0.0; MAX_LAG + 2],
        left: vec![0.0; MAX_LAG + 2],
        right: vec![0.0; MAX_LAG + 2],
    };
    for h in quiet {
        let c = correlation(&frame(*h));
        background.energy += c.energy / quiet.len() as f64;
        for lag in 0..=MAX_LAG + 1 {
            background.dot[lag] += c.dot[lag] / quiet.len() as f64;
            background.left[lag] += c.left[lag] / quiet.len() as f64;
            background.right[lag] += c.right[lag] / quiet.len() as f64;
        }
    }
    // A strong pitch in the quiet background (mains hum, a fan's tone) that only
    // grows louder later is still the background, not a voice.
    let r: Vec<f64> = (0..=MAX_LAG + 1)
        .map(|lag| {
            background.dot[lag]
                / (background.left[lag] * background.right[lag])
                    .sqrt()
                    .max(1e-9)
        })
        .collect();
    let hum = pitch(&r).filter(|lag| r[lag.round() as usize] >= 0.9);
    (0..count)
        .map(|h| {
            let excess = energy[h] - background.energy;
            let level = (excess.max(0.0) / WINDOW as f64).sqrt();
            // Voicing needs new sound of at least half the background's power;
            // below that, the background's own wobble could look periodic.
            if excess <= 0.0 || excess < background.energy * 0.5 {
                return Hop { level, lag: None };
            }
            let c = correlation(&frame(h));
            let r: Vec<f64> = (0..=MAX_LAG + 1)
                .map(|lag| {
                    let left = c.left[lag] - background.left[lag];
                    let right = c.right[lag] - background.right[lag];
                    if left <= background.left[lag] * 0.5 || right <= background.right[lag] * 0.5 {
                        0.0
                    } else {
                        (c.dot[lag] - background.dot[lag]) / (left * right).sqrt()
                    }
                })
                .collect();
            Hop {
                level,
                lag: pitch(&r).filter(|lag| hum.is_none_or(|hum| (lag / hum - 1.0).abs() > 0.03)),
            }
        })
        .collect()
}

/// The fundamental period: the shortest strong peak, judged against the best peak,
/// so neither its multiples (a low voice's octaves) nor weaker early formant peaks
/// decide. A fundamental above 450 Hz (a chime, a whistle) is not a voice even when
/// one of its multiples falls inside the voice band.
fn pitch(r: &[f64]) -> Option<f64> {
    let peaks: Vec<usize> = (2..=MAX_LAG)
        .filter(|lag| r[*lag] > r[lag - 1] && r[*lag] >= r[lag + 1])
        .collect();
    let best = peaks.iter().map(|lag| r[*lag]).fold(0.0, f64::max);
    if best <= 0.65 {
        return None;
    }
    let lag = *peaks.iter().find(|lag| r[**lag] >= best * 0.9)?;
    if lag < MIN_LAG {
        return None;
    }
    let (a, b, c) = (r[lag - 1], r[lag], r[lag + 1]);
    let curve = a - 2.0 * b + c;
    Some(
        lag as f64
            + if curve < 0.0 {
                0.5 * (a - c) / curve
            } else {
                0.0
            },
    )
}

/// Voiced islands inside one energy stretch. A second or more without voicing
/// splits the stretch, so typing between two remarks neither joins them nor
/// reaches Whisper. Each island is judged on its own span.
pub fn islands(hops: &[Hop], stretch: Stretch) -> Vec<Stretch> {
    let to_sample = |h: usize| h * HOP * DOWN;
    let inside: Vec<usize> = (0..hops.len())
        .filter(|h| (stretch.start..stretch.end).contains(&(to_sample(*h) + WINDOW * DOWN / 2)))
        .collect();
    let Some((&lo, &hi)) = inside.first().zip(inside.last()) else {
        return vec![];
    };
    let peak = hops[lo..=hi].iter().map(|h| h.level).fold(0.0, f64::max);
    let active = |h: usize| hops[h].level > 0.0 && hops[h].level >= peak * 0.04;
    let held = held(&hops[lo..=hi]);
    let voiced = |h: usize| active(h) && hops[h].lag.is_some() && !held[h - lo];
    // Voice is a run of three or more voiced steps; a lone voiced step inside
    // clicks or fan noise neither starts an island nor bridges a gap.
    let mut runs: Vec<(usize, usize)> = vec![];
    let mut h = lo;
    while h <= hi {
        if voiced(h) {
            let start = h;
            while h < hi && voiced(h + 1) {
                h += 1;
            }
            if h - start >= 2 {
                runs.push((start, h));
            }
        }
        h += 1;
    }
    let mut groups: Vec<(usize, usize)> = vec![];
    for (start, end) in runs {
        match groups.last_mut() {
            Some(group) if start - group.1 < HOPS_PER_SECOND => group.1 = end,
            _ => groups.push((start, end)),
        }
    }
    groups
        .into_iter()
        .filter(|(first, last)| {
            let voiced_count = (*first..=*last).filter(|h| voiced(*h)).count();
            let active_count = (*first..=*last).filter(|h| active(*h)).count();
            voiced_count >= 4 && voiced_count * 10 >= active_count
        })
        .map(|(first, last)| {
            let (first, last) = (to_sample(first), to_sample(last) + WINDOW * DOWN);
            // Keep the stretch's own energy edge when voicing starts or ends close
            // to it; otherwise pad into the surrounding sound for consonants.
            Stretch {
                start: if first > stretch.start + RATE / 2 {
                    first - RATE / 5
                } else {
                    stretch.start
                },
                end: if last + RATE / 2 < stretch.end {
                    last + RATE * 2 / 5
                } else {
                    stretch.end
                },
            }
        })
        .collect()
}

/// A held musical note or a chime keeps one pitch for a long time; speech moves.
/// Marks steps in runs of 0.7 s or more within 3 % of one pitch, so a note is
/// not a voice while speech right next to it still is.
fn held(hops: &[Hop]) -> Vec<bool> {
    let mut held = vec![false; hops.len()];
    let mut i = 0;
    while i < hops.len() {
        let Some(base) = hops[i].lag else {
            i += 1;
            continue;
        };
        let mut j = i + 1;
        while j < hops.len()
            && hops[j]
                .lag
                .is_some_and(|lag| (lag / base - 1.0).abs() <= 0.03)
        {
            j += 1;
        }
        if j - i >= HOPS_PER_SECOND * 7 / 10 {
            held[i..j].fill(true);
        }
        i = j;
    }
    held
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
        let hops = voicing(&samples);
        assert!(ranges.iter().all(|s| islands(&hops, *s).is_empty()));
    }
    fn room(seconds: f64, seed: u32) -> (Vec<i16>, impl FnMut() -> f64) {
        let mut seed = seed;
        let mut random = move || {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed >> 16) as f64 / 32768.0 - 1.0
        };
        let samples = (0..(seconds * RATE as f64) as usize)
            .map(|_| (random() * 25.0) as i16)
            .collect();
        (samples, random)
    }
    /// Syllables with harmonics and a falling pitch, like speech rather than a held note.
    fn talk(samples: &mut [i16], start: f64, end: f64, f0: f64, amplitude: f64) {
        let mut phase = 0.0;
        let (first, last) = ((start * RATE as f64) as usize, (end * RATE as f64) as usize);
        for (i, sample) in samples.iter_mut().enumerate().take(last).skip(first) {
            let t = i as f64 / RATE as f64 - start;
            let syllable = t % 0.3;
            if syllable > 0.24 {
                continue;
            }
            phase += 2.0 * std::f64::consts::PI * f0 * (1.15 - syllable) / RATE as f64;
            let wave: f64 = (1..12).map(|k| (k as f64 * phase).sin() / k as f64).sum();
            *sample = sample.saturating_add((amplitude * 0.6 * wave) as i16);
        }
    }
    fn samples_len(seconds: f64) -> f64 {
        seconds * RATE as f64
    }
    fn seconds(stretch: &Stretch) -> (f64, f64) {
        (
            stretch.start as f64 / RATE as f64,
            stretch.end as f64 / RATE as f64,
        )
    }
    #[test]
    fn typing_between_two_remarks_does_not_drop_the_remarks() {
        let (mut samples, mut random) = room(10.0, 5);
        talk(&mut samples, 1.0, 1.5, 150.0, 3000.0);
        let mut offset = RATE * 18 / 10;
        while offset < RATE * 15 / 2 {
            for sample in &mut samples[offset..offset + 160] {
                *sample += (random() * 9000.0) as i16;
            }
            offset += (RATE as f64 * (0.27 + random() * 0.15)) as usize;
        }
        talk(&mut samples, 7.8, 8.6, 150.0, 3000.0);
        let ranges = detect(&samples);
        assert_eq!(
            ranges.len(),
            1,
            "the typing joins both remarks into one stretch"
        );
        let found = islands(&voicing(&samples), ranges[0]);
        assert_eq!(found.len(), 2);
        let (first, second) = (seconds(&found[0]), seconds(&found[1]));
        assert!(first.0 <= 1.0 && first.1 >= 1.5 && first.1 < 2.5);
        assert!(second.0 > 7.0 && second.0 <= 7.8 && second.1 >= 8.6);
        // One word and two words, each judged on its own voice, not on 7 s.
        assert!(plausible_word_rate(1, first.1 - first.0));
        assert!(plausible_word_rate(2, second.1 - second.0));
    }
    #[test]
    fn a_sentence_in_steady_noise_is_not_rejected() {
        let (mut samples, mut random) = room(30.0, 9);
        for sample in &mut samples[RATE * 3 / 2..RATE * 27 / 2] {
            *sample += (random() * 1300.0) as i16; // a quarter of the speech level
        }
        talk(&mut samples, 6.0, 6.6, 180.0, 3000.0); // under a tenth of the stretch
        let ranges = detect(&samples);
        assert!(ranges.iter().any(|s| seconds(s).1 - seconds(s).0 > 10.0));
        let hops = voicing(&samples);
        let found: Vec<_> = ranges.iter().flat_map(|s| islands(&hops, *s)).collect();
        assert_eq!(found.len(), 1);
        let (start, end) = seconds(&found[0]);
        assert!((5.0..=6.0).contains(&start) && (6.6..7.6).contains(&end));
    }
    #[test]
    fn a_hum_through_the_whole_file_does_not_make_it_one_island() {
        // A steady hum, and one that grows from half to one and a half its level.
        for ramp in [0.0, 1.0] {
            let (mut samples, _) = room(10.0, 13);
            let hum = |samples: &mut [i16]| {
                for (i, sample) in samples.iter_mut().enumerate() {
                    let level = 1.0 + ramp * (i as f64 / samples_len(10.0) - 0.5);
                    let t = i as f64 / RATE as f64 * 2.0 * std::f64::consts::PI * 120.0;
                    *sample += (level * (2400.0 * t.sin() + 800.0 * (2.0 * t + 1.0).sin())) as i16;
                }
            };
            let mut only_hum = samples.clone();
            hum(&mut only_hum);
            let ranges = detect(&only_hum);
            let hops = voicing(&only_hum);
            assert!(ranges.iter().all(|s| islands(&hops, *s).is_empty()));
            hum(&mut samples);
            talk(&mut samples, 3.0, 4.5, 200.0, 8000.0);
            let ranges = detect(&samples);
            assert!(seconds(&ranges[0]).1 - seconds(&ranges[0]).0 > 9.0);
            let hops = voicing(&samples);
            let found: Vec<_> = ranges.iter().flat_map(|s| islands(&hops, *s)).collect();
            assert_eq!(found.len(), 1, "ramp {ramp}");
            let (start, end) = seconds(&found[0]);
            assert!((2.0..=3.0).contains(&start) && (4.5..5.5).contains(&end));
        }
    }
    #[test]
    fn very_low_and_very_high_voices_are_not_rejected() {
        for f0 in [75.0, 380.0] {
            let (mut samples, _) = room(4.0, 17);
            talk(&mut samples, 1.0, 2.5, f0, 3000.0);
            let ranges = detect(&samples);
            let hops = voicing(&samples);
            assert_eq!(
                ranges.iter().flat_map(|s| islands(&hops, *s)).count(),
                1,
                "{f0} Hz"
            );
        }
    }
    #[test]
    fn a_chime_or_a_held_note_is_not_a_voice_even_with_a_pitch_in_the_voice_band() {
        let tone = |samples: &mut [i16], partials: &[(f64, f64)]| {
            for (i, sample) in samples.iter_mut().enumerate().skip(RATE).take(2 * RATE) {
                let t = (i - RATE) as f64 / RATE as f64;
                let wave: f64 = partials
                    .iter()
                    .map(|(f, a)| a * (2.0 * std::f64::consts::PI * f * t).sin())
                    .sum();
                *sample += (4000.0 * (-1.5 * t).exp() * wave) as i16;
            }
        };
        let notes: Vec<(f64, f64)> = (1..9).map(|k| (196.0 * k as f64, 1.0 / k as f64)).collect();
        // A high tone has multiples in the voice band; two tones share 220 Hz;
        // a held note sits right in the band.
        for partials in [
            vec![(700.0, 1.0)],
            vec![(660.0, 1.0), (880.0, 1.0)],
            notes.clone(),
        ] {
            let (mut samples, _) = room(4.0, 21);
            tone(&mut samples, &partials);
            let ranges = detect(&samples);
            let hops = voicing(&samples);
            assert!(ranges.iter().all(|s| islands(&hops, *s).is_empty()));
        }
        // Speech right after a held note is still speech.
        let (mut samples, _) = room(5.0, 21);
        tone(&mut samples, &notes);
        talk(&mut samples, 3.25, 3.85, 180.0, 3000.0);
        let ranges = detect(&samples);
        let hops = voicing(&samples);
        let found: Vec<_> = ranges.iter().flat_map(|s| islands(&hops, *s)).collect();
        assert_eq!(found.len(), 1);
        let (start, end) = seconds(&found[0]);
        assert!((2.5..=3.25).contains(&start) && end >= 3.85);
    }
    #[test]
    fn a_stock_phrase_over_long_noise_is_rejected_without_rejecting_short_or_slow_speech() {
        assert!(!plausible_word_rate(4, 10.7));
        assert!(plausible_word_rate(3, 0.8));
        assert!(plausible_word_rate(4, 3.8));
        assert!(plausible_word_rate(7, 8.0));
    }
}
