/**
 * DeviceDetector — Detect avfoundation video and audio devices via ffmpeg.
 *
 * Parses the stderr output from `ffmpeg -f avfoundation -list_devices true -i ""`
 * and returns structured device lists. Zero Electron dependencies.
 */

import { execFile as execFileCb } from 'child_process';
import { log } from '../utils/Logger.js';

// Minimal environment for child processes — prevents env variable leakage
const SAFE_CHILD_ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME || process.env.USERPROFILE,
  USERPROFILE: process.env.USERPROFILE,
  LANG: process.env.LANG,
  TMPDIR: process.env.TMPDIR || process.env.TEMP,
  TEMP: process.env.TEMP,
};

export interface Device {
  index: number;
  name: string;
}

export interface DetectedDevices {
  video: Device[];
  audio: Device[];
}

/**
 * Detect available avfoundation video and audio devices.
 *
 * ffmpeg prints device info to stderr (the command itself "fails" because
 * the dummy input `""` is invalid, but the device list is still printed).
 */
export async function detectDevices(): Promise<DetectedDevices> {
  const stderr = await runFfmpegDeviceList();
  return parseDeviceList(stderr);
}

function runFfmpegDeviceList(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFileCb(
      'ffmpeg',
      ['-f', 'avfoundation', '-list_devices', 'true', '-i', ''],
      { env: SAFE_CHILD_ENV },
      (_error, _stdout, stderr) => {
        // ffmpeg always exits non-zero for -list_devices because "" is not a real input.
        // The device list is in stderr regardless.
        const output = stderr?.toString() ?? '';
        if (!output.includes('AVFoundation')) {
          reject(
            new Error(
              'ffmpeg did not return AVFoundation device list. Is ffmpeg installed with avfoundation support?',
            ),
          );
          return;
        }
        resolve(output);
      },
    );
  });
}

/**
 * Parse ffmpeg avfoundation device list stderr output.
 *
 * Expected format:
 * ```
 * [AVFoundation indev @ ...] AVFoundation video devices:
 * [AVFoundation indev @ ...] [0] Capture screen 0
 * [AVFoundation indev @ ...] [1] FaceTime HD Camera
 * [AVFoundation indev @ ...] AVFoundation audio devices:
 * [AVFoundation indev @ ...] [0] MacBook Pro Microphone
 * [AVFoundation indev @ ...] [1] External Microphone
 * ```
 */
export function parseDeviceList(stderr: string): DetectedDevices {
  const video: Device[] = [];
  const audio: Device[] = [];

  let currentCategory: 'video' | 'audio' | null = null;

  // Match lines from AVFoundation device listing
  const deviceLineRegex = /\[AVFoundation.*?\]\s*\[(\d+)\]\s*(.+)/;
  const videoHeaderRegex = /AVFoundation video devices/i;
  const audioHeaderRegex = /AVFoundation audio devices/i;

  for (const line of stderr.split('\n')) {
    if (videoHeaderRegex.test(line)) {
      currentCategory = 'video';
      continue;
    }

    if (audioHeaderRegex.test(line)) {
      currentCategory = 'audio';
      continue;
    }

    if (currentCategory === null) continue;

    const match = deviceLineRegex.exec(line);
    if (match) {
      const device: Device = {
        index: parseInt(match[1], 10),
        name: match[2].trim(),
      };

      if (currentCategory === 'video') {
        video.push(device);
      } else {
        audio.push(device);
      }
    }
  }

  log(`Detected ${video.length} video device(s), ${audio.length} audio device(s)`);
  return { video, audio };
}
