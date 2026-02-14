/**
 * ScreenRecorder — Headless screen + audio recording using ffmpeg avfoundation.
 *
 * Provides two modes:
 * 1. Fixed-duration recording (`record`) — captures for N seconds, returns when done.
 * 2. Long-form recording (`start`/`stop`) — spawns ffmpeg, caller controls lifetime.
 *
 * Settings: 10 fps, ultrafast x264, AAC audio. Produces MP4.
 * Zero Electron dependencies.
 */

import { execFile as execFileCb, type ChildProcess } from 'child_process';
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

export interface RecordOptions {
  /** Recording duration in seconds (for fixed-duration mode). */
  duration: number;
  /** Absolute path for the output MP4 file. */
  outputPath: string;
  /** Video input device index (default: "1" = first screen). */
  videoDevice?: string;
  /** Audio input device name or index (default: "default"). */
  audioDevice?: string;
}

export interface StartOptions {
  /** Absolute path for the output MP4 file. */
  outputPath: string;
  /** Video input device index (default: "1" = first screen). */
  videoDevice?: string;
  /** Audio input device name or index (default: "default"). */
  audioDevice?: string;
}

/**
 * Build the common ffmpeg args for screen+audio recording.
 */
function buildFfmpegArgs(
  outputPath: string,
  videoDevice: string,
  audioDevice: string,
  duration?: number,
): string[] {
  const input = `${videoDevice}:${audioDevice}`;

  const args = [
    '-f', 'avfoundation',
    '-framerate', '10',
    '-i', input,
    '-vcodec', 'libx264',
    '-preset', 'ultrafast',
    '-acodec', 'aac',
    '-strict', 'experimental',
  ];

  if (duration !== undefined) {
    args.push('-t', String(duration));
  }

  args.push('-y', outputPath);

  return args;
}

/**
 * Record screen + audio for a fixed duration.
 *
 * @returns Absolute path to the recorded MP4 file.
 * @throws If ffmpeg fails or produces an empty file.
 */
export async function record(options: RecordOptions): Promise<string> {
  const { duration } = options;
  const outputPath = resolve(options.outputPath);
  const videoDevice = options.videoDevice ?? '1';
  const audioDevice = options.audioDevice ?? 'default';

  const args = buildFfmpegArgs(outputPath, videoDevice, audioDevice, duration);

  log(`Recording screen+audio: duration=${duration}s, output=${outputPath}`);

  await new Promise<void>((resolve, reject) => {
    execFileCb(
      'ffmpeg',
      args,
      { env: SAFE_CHILD_ENV, timeout: (duration + 30) * 1000 },
      (error) => {
        if (error) {
          reject(
            new Error(
              `Screen recording failed: ${error.message}\n` +
                'Ensure ffmpeg is installed and Screen Recording + Microphone permissions are granted.',
            ),
          );
          return;
        }
        resolve();
      },
    );
  });

  await validateOutputFile(outputPath);

  log(`Screen recording complete: ${outputPath}`);
  return outputPath;
}

/**
 * Start a long-form screen + audio recording.
 *
 * Returns the spawned ffmpeg ChildProcess. The caller is responsible for
 * calling `stop(process)` to end the recording cleanly.
 */
export function start(options: StartOptions): ChildProcess {
  const outputPath = resolve(options.outputPath);
  const videoDevice = options.videoDevice ?? '1';
  const audioDevice = options.audioDevice ?? 'default';

  const args = buildFfmpegArgs(outputPath, videoDevice, audioDevice);

  log(`Starting long-form recording: output=${outputPath}`);

  // Use execFile but we need the ChildProcess handle, so use spawn-style via execFile callback
  // Actually, execFile returns the ChildProcess synchronously
  const child = execFileCb(
    'ffmpeg',
    args,
    { env: SAFE_CHILD_ENV },
    (error) => {
      if (error && !error.killed) {
        // Log but don't throw — the caller handles process lifecycle
        log(`Recording process exited with error: ${error.message}`);
      }
    },
  );

  return child;
}

/**
 * Stop a long-form recording by sending SIGINT to ffmpeg.
 *
 * ffmpeg handles SIGINT gracefully — it finalizes the MP4 container
 * (writes moov atom) before exiting. We wait up to 10 seconds for
 * clean shutdown before force-killing.
 */
export async function stop(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) {
    log('Recording process already exited');
    return;
  }

  log('Stopping recording (SIGINT → ffmpeg)...');

  return new Promise<void>((resolve, reject) => {
    const forceKillTimeout = setTimeout(() => {
      log('Force-killing recording process (10s timeout exceeded)');
      process.kill('SIGKILL');
    }, 10_000);

    process.once('exit', (code) => {
      clearTimeout(forceKillTimeout);
      log(`Recording process exited with code ${code}`);
      resolve();
    });

    process.once('error', (err) => {
      clearTimeout(forceKillTimeout);
      reject(new Error(`Error stopping recording: ${err.message}`));
    });

    // SIGINT tells ffmpeg to finalize the file cleanly
    process.kill('SIGINT');
  });
}

/**
 * Validate that an output file exists and is non-empty.
 */
async function validateOutputFile(outputPath: string): Promise<void> {
  let fileStats;
  try {
    fileStats = await stat(outputPath);
  } catch {
    throw new Error(
      `Recording file not created at ${outputPath}.\n` +
        'Check Screen Recording and Microphone permissions in System Settings → Privacy & Security.',
    );
  }

  if (!fileStats.isFile() || fileStats.size === 0) {
    throw new Error(
      'Recording file is empty (0 bytes). Permissions may not be granted.\n' +
        'Check System Settings → Privacy & Security → Screen Recording and Microphone.',
    );
  }
}
