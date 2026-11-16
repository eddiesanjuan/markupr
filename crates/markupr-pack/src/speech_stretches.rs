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
}
