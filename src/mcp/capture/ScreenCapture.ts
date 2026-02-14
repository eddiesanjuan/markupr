/**
 * ScreenCapture — Headless screenshot capture using macOS screencapture CLI.
 *
 * Wraps the built-in `screencapture` command. No Electron dependencies.
 * Requires macOS Screen Recording permission.
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

export interface ScreenCaptureOptions {
  /** Display number (1-indexed, default 1 = main display). */
  display?: number;
  /** Absolute path for the output PNG file. */
  outputPath: string;
}

/**
 * Capture a screenshot of the specified display.
 *
 * Uses `screencapture -x -D{display} {outputPath}`:
 * - `-x` = silent (no shutter sound)
 * - `-D{n}` = specific display
 *
 * @returns Absolute path to the captured PNG image.
 * @throws If screencapture fails or produces an empty file (permission denied).
 */
export async function capture(options: ScreenCaptureOptions): Promise<string> {
  const display = options.display ?? 1;
  const outputPath = resolve(options.outputPath);

  const args = ['-x', `-D${display}`, outputPath];

  log(`Capturing screenshot: display=${display}, output=${outputPath}`);

  await new Promise<void>((resolve, reject) => {
    execFileCb('screencapture', args, { env: SAFE_CHILD_ENV }, (error) => {
      if (error) {
        reject(
          new Error(
            `screencapture failed: ${error.message}\n` +
              'Ensure Screen Recording permission is granted in System Settings → Privacy & Security → Screen Recording.',
          ),
        );
        return;
      }
      resolve();
    });
  });

  // Validate the output file exists and is non-empty
  // (screencapture may succeed with exit 0 but produce an empty file if permission is denied)
  let fileStats;
  try {
    fileStats = await stat(outputPath);
  } catch {
    throw new Error(
      `Screenshot file not created at ${outputPath}.\n` +
        'Ensure Screen Recording permission is granted in System Settings → Privacy & Security → Screen Recording.',
    );
  }

  if (!fileStats.isFile() || fileStats.size === 0) {
    throw new Error(
      'Screenshot captured but file is empty (0 bytes). This typically means Screen Recording permission is not granted.\n' +
        'Grant permission in System Settings → Privacy & Security → Screen Recording.',
    );
  }

  log(`Screenshot captured: ${outputPath} (${fileStats.size} bytes)`);
  return outputPath;
}
