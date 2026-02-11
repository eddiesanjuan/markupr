/**
 * Audio Utility Functions
 *
 * Shared audio helpers extracted from SessionController and AudioCapture
 * to eliminate duplication and centralize audio encoding logic.
 */

/**
 * Map an audio MIME type to a file extension.
 * Handles common audio container formats.
 */
export function extensionFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('webm')) return '.webm';
  if (normalized.includes('ogg')) return '.ogg';
  if (normalized.includes('mp4') || normalized.includes('aac') || normalized.includes('m4a')) {
    return '.m4a';
  }
  if (normalized.includes('wav')) return '.wav';
  return '.audio';
}

/**
 * Encode a raw Float32 PCM buffer into a WAV container (IEEE Float32 format).
 * Used by AudioCapture for exporting captured audio.
 *
 * @param rawAudio - Buffer containing raw Float32 samples
 * @param sampleRate - Sample rate in Hz (e.g. 16000)
 * @param channels - Number of audio channels (1 = mono, 2 = stereo)
 * @returns WAV file as a Buffer
 */
export function encodeFloat32Wav(rawAudio: Buffer, sampleRate: number, channels: number): Buffer {
  const bytesPerSample = 4; // Float32
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = rawAudio.byteLength;
  const riffChunkSize = 36 + dataSize;
  const header = Buffer.alloc(44);

  // RIFF header
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(riffChunkSize, 4);
  header.write('WAVE', 8, 'ascii');

  // fmt chunk
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(3, 20); // IEEE float
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(32, 34); // bits per sample

  // data chunk
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, rawAudio], 44 + dataSize);
}

/**
 * Encode Float32 PCM samples into a WAV container (PCM Int16 format).
 * Converts from Float32 [-1, 1] to Int16 [-32768, 32767].
 * Used for Whisper-compatible audio export.
 *
 * @param samples - Float32Array of audio samples in [-1, 1] range
 * @param sampleRate - Sample rate in Hz (e.g. 16000)
 * @param channels - Number of audio channels (1 = mono, 2 = stereo)
 * @returns WAV file as a Buffer
 */
export function encodeFloat32Pcm16Wav(samples: Float32Array, sampleRate: number, channels: number): Buffer {
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    buffer.writeInt16LE(int16, 44 + i * 2);
  }

  return buffer;
}
