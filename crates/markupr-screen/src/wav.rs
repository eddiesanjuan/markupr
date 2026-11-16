//! Mono 16-bit PCM WAV writer placed on the host clock: samples land at the index their
//! timestamp says, gaps are filled with silence, overlaps from a clock that moved backward
//! are dropped, and buffers at another rate are resampled to the file's rate.

use std::fs::File;
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::Path;

/// Gaps and overlaps shorter than this are timestamp jitter and are left alone.
const GAP_TOLERANCE_S: f64 = 0.010;
/// Longest silence written for one gap.
const MAX_GAP_S: u64 = 60;

pub(crate) struct WavWriter {
    out: BufWriter<File>,
    pub sample_rate: u32,
    pub start_ns: u64,
    pub written: u64,
    padded: u64,
    dropped: u64,
    /// Samples of capped gaps not written; later timestamps are shifted back by this much.
    skipped: u64,
    last_rate_in: u32,
    warnings: Vec<String>,
}

impl WavWriter {
    pub fn create(path: &Path, sample_rate: u32, start_ns: u64) -> std::io::Result<Self> {
        let mut out = BufWriter::new(File::create(path)?);
        out.write_all(&header(sample_rate, 0))?;
        Ok(Self {
            out,
            sample_rate,
            start_ns,
            written: 0,
            padded: 0,
            dropped: 0,
            skipped: 0,
            last_rate_in: sample_rate,
            warnings: Vec::new(),
        })
    }

    /// Append mono samples at `rate_in` Hz whose first sample is at host time `pts_ns`.
    pub fn push(&mut self, pts_ns: u64, rate_in: u32, samples: &[i16]) -> std::io::Result<()> {
        if rate_in != self.last_rate_in {
            self.warnings.push(format!(
                "mic: input rate changed {} -> {} Hz; resampled to {} Hz",
                self.last_rate_in, rate_in, self.sample_rate
            ));
            self.last_rate_in = rate_in;
        }
        let samples = resample(samples, rate_in, self.sample_rate);
        let rate = self.sample_rate as u64;
        let tol = (GAP_TOLERANCE_S * rate as f64) as u64;
        let expected = (pts_ns.saturating_sub(self.start_ns) as u128 * rate as u128 / 1_000_000_000) as u64;
        let expected = expected.saturating_sub(self.skipped);
        let mut s: &[i16] = &samples;
        if expected + tol < self.written {
            // Host time moved backward: drop what overlaps audio already written.
            let overlap = ((self.written - expected) as usize).min(s.len());
            self.dropped += overlap as u64;
            s = &s[overlap..];
        } else if expected > self.written + tol {
            let gap = expected - self.written;
            let fill = gap.min(MAX_GAP_S * rate);
            if fill < gap {
                self.skipped += gap - fill;
                self.warnings.push(format!(
                    "mic: a {:.1} s gap was capped at {MAX_GAP_S} s of silence; later mic audio is {:.1} s early",
                    gap as f64 / rate as f64,
                    (gap - fill) as f64 / rate as f64
                ));
            }
            let chunk = vec![0u8; rate as usize * 2];
            let mut left = fill;
            while left > 0 {
                let n = left.min(rate);
                self.out.write_all(&chunk[..n as usize * 2])?;
                left -= n;
            }
            self.written += fill;
            self.padded += fill;
        }
        let mut bytes = Vec::with_capacity(s.len() * 2);
        for v in s {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        self.out.write_all(&bytes)?;
        self.written += s.len() as u64;
        Ok(())
    }

    /// Warnings about what was padded, dropped or resampled.
    pub fn notes(&self) -> Vec<String> {
        let ms = |n: u64| n * 1000 / self.sample_rate as u64;
        let mut w = self.warnings.clone();
        if self.padded > 0 {
            w.push(format!("mic: {} ms of gaps filled with silence", ms(self.padded)));
        }
        if self.dropped > 0 {
            w.push(format!("mic: {} ms dropped where timestamps moved backward", ms(self.dropped)));
        }
        w
    }

    pub fn finish(mut self) -> std::io::Result<()> {
        let data_len = (self.written * 2).min(u32::MAX as u64 - 36) as u32;
        self.out.seek(SeekFrom::Start(0))?;
        self.out.write_all(&header(self.sample_rate, data_len))?;
        self.out.flush()?;
        self.out.get_ref().sync_all()
    }
}

/// Linear resampling; enough for speech.
fn resample(x: &[i16], from: u32, to: u32) -> Vec<i16> {
    if from == to || from == 0 || x.is_empty() {
        return x.to_vec();
    }
    let n = ((x.len() as u64 * to as u64 + from as u64 / 2) / from as u64) as usize;
    let step = from as f64 / to as f64;
    let last = x.len() - 1;
    (0..n)
        .map(|i| {
            let p = i as f64 * step;
            let j = (p as usize).min(last);
            let f = p - j as f64;
            let (a, b) = (x[j] as f64, x[(j + 1).min(last)] as f64);
            (a + (b - a) * f).round() as i16
        })
        .collect()
}

fn header(rate: u32, data_len: u32) -> [u8; 44] {
    let mut h = [0u8; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36 + data_len).to_le_bytes());
    h[8..12].copy_from_slice(b"WAVE");
    h[12..16].copy_from_slice(b"fmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
    h[22..24].copy_from_slice(&1u16.to_le_bytes()); // mono
    h[24..28].copy_from_slice(&rate.to_le_bytes());
    h[28..32].copy_from_slice(&(rate * 2).to_le_bytes());
    h[32..34].copy_from_slice(&2u16.to_le_bytes());
    h[34..36].copy_from_slice(&16u16.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data_len.to_le_bytes());
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Bug: a mid-recording rate change (Bluetooth headset), a backward timestamp or a long
    /// gap pushes later narration off the host clock.
    #[test]
    fn rate_change_backward_buffer_and_gap_stay_on_host_time() {
        let path = std::env::temp_dir().join(format!("markupr-wav-test-{}.wav", std::process::id()));
        let start: u64 = 1_000_000_000;
        let mut w = WavWriter::create(&path, 48_000, start).unwrap();
        let mut t = start;
        // 10 ms buffers: 48 kHz, then 24 kHz, then 48 kHz.
        for (rate, n) in [(48_000u32, 100), (24_000, 100), (48_000, 100)] {
            for _ in 0..n {
                w.push(t, rate, &vec![1000i16; rate as usize / 100]).unwrap();
                t += 10_000_000;
            }
        }
        // A buffer whose timestamp moved 50 ms backward.
        w.push(t - 50_000_000, 48_000, &vec![7i16; 480]).unwrap();
        // A 5 s gap, then 1 s more audio.
        t += 5_000_000_000;
        for _ in 0..100 {
            w.push(t, 48_000, &vec![1000i16; 480]).unwrap();
            t += 10_000_000;
        }
        let span_s = (t - start) as f64 / 1e9;
        let file_s = w.written as f64 / 48_000.0;
        let notes = w.notes();
        w.finish().unwrap();
        let len = std::fs::metadata(&path).unwrap().len();
        std::fs::remove_file(&path).unwrap();
        println!("span {span_s:.4} s, file {file_s:.4} s, diff {:+.2} ms, bytes {len}", (file_s - span_s) * 1e3);
        for n in &notes {
            println!("{n}");
        }
        assert!((file_s - span_s).abs() < 0.010);
        assert_eq!(len, 44 + w_samples(file_s) * 2);
        assert!(notes.iter().any(|n| n.contains("48000 -> 24000")));
        assert!(notes.iter().any(|n| n.contains("24000 -> 48000")));
        assert!(notes.iter().any(|n| n.contains("moved backward")));
    }

    fn w_samples(s: f64) -> u64 {
        (s * 48_000.0).round() as u64
    }

    #[test]
    fn gap_longer_than_cap_is_capped_with_warning() {
        let path = std::env::temp_dir().join(format!("markupr-wav-cap-{}.wav", std::process::id()));
        let mut w = WavWriter::create(&path, 8_000, 0).unwrap();
        w.push(0, 8_000, &[1; 80]).unwrap();
        w.push(90_000_000_000, 8_000, &[1; 80]).unwrap();
        w.push(90_010_000_000, 8_000, &[1; 80]).unwrap(); // the next buffer must not reopen the gap
        let (written, notes) = (w.written, w.notes());
        w.finish().unwrap();
        std::fs::remove_file(&path).unwrap();
        println!("written {written} samples; {notes:?}");
        assert_eq!(written, 80 + 60 * 8_000 + 80 + 80);
        assert!(notes.iter().any(|n| n.contains("capped at 60 s")));
    }
}
