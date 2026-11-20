//! Mono 16-bit PCM WAV writer placed on the host clock: sample i is at
//! `start_ns + i / sample_rate`. Gaps become silence, overlaps from a clock that moved backward
//! are dropped, and buffers at another rate are resampled to the file's rate.

use std::fs::File;
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::Path;

/// Gaps and overlaps shorter than this are timestamp jitter and are left alone.
const GAP_TOLERANCE_S: f64 = 0.010;

pub(crate) struct WavWriter {
    out: BufWriter<File>,
    pub sample_rate: u32,
    pub start_ns: u64,
    pub written: u64,
    padded: u64,
    dropped: u64,
    last_rate_in: u32,
    resampler: Resampler,
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
            last_rate_in: sample_rate,
            resampler: Resampler::default(),
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
            self.resampler = Resampler::default();
        }
        let rate = self.sample_rate as u64;
        let tol = (GAP_TOLERANCE_S * rate as f64) as u64;
        let expected = (pts_ns.saturating_sub(self.start_ns) as u128 * rate as u128 / 1_000_000_000) as u64;
        let backward = expected + tol < self.written;
        if backward || expected > self.written + tol {
            // Continuity is broken: never interpolate across it.
            self.resampler = Resampler::default();
        }
        let samples = if rate_in == self.sample_rate {
            samples.to_vec()
        } else {
            self.resampler.run(samples, rate_in, self.sample_rate)
        };
        let mut s: &[i16] = &samples;
        if backward {
            // Host time moved backward: drop what overlaps audio already written.
            let overlap = ((self.written - expected) as usize).min(s.len());
            self.dropped += overlap as u64;
            s = &s[overlap..];
            if s.is_empty() {
                self.resampler = Resampler::default(); // a rejected buffer leaves no history
            }
        } else if expected > self.written + tol {
            // Silence for the whole gap, as a hole in the file: it reads back as zeros and
            // costs neither memory nor time however long the gap is.
            let gap = expected - self.written;
            self.out.seek(SeekFrom::Current(gap as i64 * 2))?;
            self.written += gap;
            self.padded += gap;
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
        // A gap is a seek; if nothing was written after it, the file must still reach it.
        self.out.flush()?;
        self.out.get_ref().set_len(44 + data_len as u64)?;
        self.out.seek(SeekFrom::Start(0))?;
        self.out.write_all(&header(self.sample_rate, data_len))?;
        self.out.flush()?;
        self.out.get_ref().sync_all()
    }
}

/// Linear resampler that keeps its place across buffers, so no fraction of a sample is lost
/// per buffer. Enough for speech.
#[derive(Default)]
struct Resampler {
    /// Position of the next output sample, in input samples from the start of the next buffer
    /// (between -1 and 0 once running).
    pos: f64,
    /// Last input sample of the previous buffer, used when `pos` is negative.
    prev: Option<i16>,
}

impl Resampler {
    fn run(&mut self, x: &[i16], from: u32, to: u32) -> Vec<i16> {
        if x.is_empty() || from == 0 || to == 0 {
            return Vec::new();
        }
        let step = from as f64 / to as f64;
        let last = (x.len() - 1) as f64;
        let at = |i: isize| if i < 0 { self.prev.unwrap_or(x[0]) } else { x[(i as usize).min(x.len() - 1)] };
        let mut out = Vec::with_capacity((x.len() as f64 / step) as usize + 2);
        let mut p = self.pos;
        while p <= last {
            let j = p.floor();
            let f = p - j;
            let (a, b) = (at(j as isize) as f64, at(j as isize + 1) as f64);
            out.push((a + (b - a) * f).round() as i16);
            p += step;
        }
        self.pos = p - x.len() as f64;
        self.prev = Some(x[x.len() - 1]);
        out
    }
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

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("markupr-wav-{name}-{}.wav", std::process::id()))
    }

    /// Bug: a mid-recording rate change (Bluetooth headset) or a backward timestamp pushes
    /// later narration off the host clock.
    #[test]
    fn rate_change_and_backward_buffer_stay_on_host_time() {
        let path = tmp("rate");
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
        w.push(t - 50_000_000, 48_000, &[7i16; 480]).unwrap();
        let span_s = (t - start) as f64 / 1e9;
        let file_s = w.written as f64 / 48_000.0;
        let notes = w.notes();
        w.finish().unwrap();
        std::fs::remove_file(&path).unwrap();
        println!("span {span_s:.4} s, file {file_s:.4} s, diff {:+.2} ms; {notes:?}", (file_s - span_s) * 1e3);
        assert!((file_s - span_s).abs() < 0.010);
        assert!(notes.iter().any(|n| n.contains("48000 -> 24000")));
        assert!(notes.iter().any(|n| n.contains("24000 -> 48000")));
        assert!(notes.iter().any(|n| n.contains("moved backward")));
    }

    /// Bug: a capped gap left every later word early by the skipped amount.
    #[test]
    fn audio_after_a_90_s_gap_lands_at_its_true_offset() {
        let path = tmp("gap");
        let mut w = WavWriter::create(&path, 8_000, 0).unwrap();
        w.push(0, 8_000, &[1; 80]).unwrap();
        w.push(90_000_000_000, 8_000, &[2; 80]).unwrap();
        w.push(90_010_000_000, 8_000, &[3; 80]).unwrap();
        let (written, notes) = (w.written, w.notes());
        w.finish().unwrap();
        let bytes = std::fs::read(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        let sample = |i: usize| i16::from_le_bytes([bytes[44 + 2 * i], bytes[45 + 2 * i]]);
        println!("written {written} samples, file {} bytes; {notes:?}", bytes.len());
        assert_eq!(written, 90 * 8_000 + 160);
        assert_eq!(bytes.len() as u64, 44 + written * 2);
        assert_eq!((sample(80), sample(719_999)), (0, 0));
        assert_eq!((sample(720_000), sample(720_080)), (2, 3));
        assert!(notes.iter().any(|n| n.contains("89990 ms of gaps filled with silence")));
    }

    /// Bug: a gap followed by a buffer that resampled to nothing left the header claiming
    /// more data than the file held.
    #[test]
    fn trailing_gap_with_no_samples_after_it_still_matches_the_header() {
        let path = tmp("trail");
        let mut w = WavWriter::create(&path, 16_000, 0).unwrap();
        w.push(0, 16_000, &[1; 160]).unwrap();
        w.push(10_000_000, 48_000, &[1; 2]).unwrap();
        w.push(90_000_000_000, 48_000, &[1; 1]).unwrap();
        // With history reset after a gap that buffer now yields one sample, so also end on a
        // gap followed by an empty buffer: nothing at all is written after that seek.
        w.push(120_000_000_000, 48_000, &[]).unwrap();
        w.finish().unwrap();
        let bytes = std::fs::read(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        let claimed = u32::from_le_bytes(bytes[40..44].try_into().unwrap()) as usize;
        println!("header data {claimed} bytes, file {} bytes", bytes.len());
        assert_eq!(bytes.len(), 44 + claimed);
    }

    /// Bug: per-buffer rounding in the resampler lost a fraction of a sample per buffer, which
    /// the gap check then filled with silence (40 ms over 2000 buffers of 48 kHz into 16 kHz).
    #[test]
    fn resampling_many_buffers_inserts_no_silence() {
        let path = tmp("drift");
        let start: u64 = 5_000_000_000;
        let mut w = WavWriter::create(&path, 16_000, start).unwrap();
        w.push(start, 16_000, &[1; 160]).unwrap();
        let mut t = start + 10_000_000;
        let mut input: u64 = 0;
        for _ in 0..2000 {
            w.push(t, 48_000, &[1000; 1024]).unwrap();
            input += 1024;
            t = start + 10_000_000 + input * 1_000_000_000 / 48_000;
        }
        let span = (t - start) as f64 * 16_000.0 / 1e9;
        let (written, padded, notes) = (w.written, w.padded, w.notes());
        w.finish().unwrap();
        std::fs::remove_file(&path).unwrap();
        println!("written {written}, span {span:.2} samples, padded {padded}; {notes:?}");
        assert_eq!(padded, 0);
        assert!((written as f64 - span).abs() <= 1.0);
    }
}
