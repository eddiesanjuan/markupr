/**
 * AudioCapture — Headless audio recording using ffmpeg avfoundation.
 *
 * Records from the default microphone (or specified device) as 16kHz mono WAV,
 * which is optimal for Whisper transcription. Zero Electron dependencies.
 */

import { execFile as execFileCb } from 'child_process';
import { stat } from 'fs/promises';
import { resolve } from 'path';
import { log } from '../utils/Logger.js';

const SAFE_CHILD_ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME || process.env.USERPROFILE,
  USERPROFILE: process.env.USERPROFILE,
  LANG: process.env.LANG,
  TMPDIR: process.env.TMPDIR || process.env.TEMP,
  TEMP: process.env.TEMP,
};

export interface AudioCaptureOptions {
  /** Recording duration in seconds. */
  duration: number;
  /** Absolute path for the output WAV file. */
  outputPath: string;
  /** Audio input device name or index (default: "default" = system default mic). */
  device?: string;
}

/**
 * Record audio from the microphone for a fixed duration.
 *
 * ffmpeg command:
 * `ffmpeg -f avfoundation -i ":{device}" -ar 16000 -ac 1 -acodec pcm_f32le -t {duration} {output}`
 *
 * @returns Absolute path to the recorded WAV file.
 * @throws If ffmpeg fails or produces an empty file.
 */
export async function record(options: AudioCaptureOptions): Promise<string> {
  const { duration } = options;
  const outputPath = resolve(options.outputPath);
  const device = options.device ?? 'default';

  // avfoundation input: ":device" means audio-only (no video input)
  const inputDevice = `:${device}`;

  const args = [
    '-f', 'avfoundation',
    '-i', inputDevice,
    '-ar', '16000',
    '-ac', '1',
    '-acodec', 'pcm_f32le',
    '-t', String(duration),
    '-y', // overwrite output
    outputPath,
  ];

  log(`Recording audio: device=${device}, duration=${duration}s, output=${outputPath}`);

  await new Promise<void>((resolve, reject) => {
    execFileCb(
      'ffmpeg',
      args,
      { env: SAFE_CHILD_ENV, timeout: (duration + 10) * 1000 },
      (error) => {
        if (error) {
          const msg = error.message.toLowerCase();
          if (msg.includes('permission') || msg.includes('not granted')) {
            reject(
              new Error(
                `Microphone access denied.\n` +
                  'Grant permission in System Settings → Privacy & Security → Microphone.',
              ),
            );
          } else {
            reject(
              new Error(
                `Audio recording failed: ${error.message}\n` +
                  'Ensure ffmpeg is installed (brew install ffmpeg) and microphone permission is granted.',
              ),
            );
          }
          return;
        }
        resolve();
      },
    );
  });

  // Validate output
  let fileStats;
  try {
    fileStats = await stat(outputPath);
  } catch {
    throw new Error(
      `Audio file not created at ${outputPath}.\n` +
        'Check microphone permission in System Settings → Privacy & Security → Microphone.',
    );
  }

  if (!fileStats.isFile() || fileStats.size === 0) {
    throw new Error(
      'Audio recorded but file is empty (0 bytes). Microphone may not be accessible.\n' +
        'Check System Settings → Privacy & Security → Microphone.',
    );
  }

  log(`Audio recorded: ${outputPath} (${fileStats.size} bytes, ${duration}s)`);
  return outputPath;
}
