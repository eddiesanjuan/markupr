//! Mono 16-bit PCM WAV writer placed on the host clock: samples land at the index their
//! timestamp says, and gaps are filled with silence so WAV time stays linear.

use std::fs::File;
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::Path;

/// Gaps shorter than this are treated as timestamp jitter and not padded.
const GAP_TOLERANCE_S: f64 = 0.010;

pub(crate) struct WavWriter {
    out: BufWriter<File>,
    pub sample_rate: u32,
    pub start_ns: u64,
    pub written: u64,
    pub padded: u64,
}

impl WavWriter {
    pub fn create(path: &Path, sample_rate: u32, start_ns: u64) -> std::io::Result<Self> {
        let mut out = BufWriter::new(File::create(path)?);
        out.write_all(&header(sample_rate, 0))?;
        Ok(Self { out, sample_rate, start_ns, written: 0, padded: 0 })
    }

    /// Append mono samples whose first sample is at host time `pts_ns`.
    pub fn push(&mut self, pts_ns: u64, samples: &[i16]) -> std::io::Result<()> {
        let rate = self.sample_rate as f64;
        let expected = (pts_ns.saturating_sub(self.start_ns) as f64 * rate / 1e9).round() as u64;
        if expected > self.written + (GAP_TOLERANCE_S * rate) as u64 {
            let gap = expected - self.written;
            self.out.write_all(&vec![0u8; gap as usize * 2])?;
            self.written += gap;
            self.padded += gap;
        }
        let mut bytes = Vec::with_capacity(samples.len() * 2);
        for s in samples {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        self.out.write_all(&bytes)?;
        self.written += samples.len() as u64;
        Ok(())
    }

    pub fn finish(mut self) -> std::io::Result<()> {
        let data_len = (self.written * 2).min(u32::MAX as u64 - 36) as u32;
        self.out.seek(SeekFrom::Start(0))?;
        self.out.write_all(&header(self.sample_rate, data_len))?;
        self.out.flush()?;
        self.out.get_ref().sync_all()
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
