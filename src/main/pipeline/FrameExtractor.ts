/**
 * FrameExtractor.ts - Video Frame Extraction via ffmpeg
 *
 * Extracts PNG frames from a video file at specific timestamps using the
 * system-installed ffmpeg binary. Degrades gracefully if ffmpeg is not
 * available (returns empty result with ffmpegAvailable: false).
 *
 * Part of the post-processing pipeline that runs after recording stops.
 */

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const execFile = promisify(execFileCb);

// ============================================================================
// Types
// ============================================================================

export interface FrameExtractionRequest {
  videoPath: string;
  timestamps: number[]; // seconds from start of recording
  outputDir: string; // directory to save PNGs
  maxFrames?: number; // cap at 20 by default
}

export interface FrameExtractionResult {
  frames: Array<{
    path: string;
    timestamp: number;
    success: boolean;
  }>;
  ffmpegAvailable: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Default maximum number of frames to extract */
const DEFAULT_MAX_FRAMES = 20;

/** Timeout for a single ffmpeg frame extraction (10 seconds) */
const FFMPEG_FRAME_TIMEOUT_MS = 10_000;

/** Timeout for ffmpeg version check (5 seconds) */
const FFMPEG_CHECK_TIMEOUT_MS = 5_000;

// ============================================================================
// FrameExtractor Class
// ============================================================================

export class FrameExtractor {
  private ffmpegPath: string = 'ffmpeg';
  private ffmpegChecked: boolean = false;
  private ffmpegAvailable: boolean = false;

  /**
   * Check if ffmpeg is installed and accessible on the system PATH.
   * Result is cached after the first successful check.
   */
  async checkFfmpeg(): Promise<boolean> {
    if (this.ffmpegChecked) {
      return this.ffmpegAvailable;
    }

    try {
      await execFile(this.ffmpegPath, ['-version'], {
        timeout: FFMPEG_CHECK_TIMEOUT_MS,
      });
      this.ffmpegAvailable = true;
      this.log('ffmpeg is available');
    } catch {
      this.ffmpegAvailable = false;
      this.log('ffmpeg is not available - frame extraction will be skipped');
    }

    this.ffmpegChecked = true;
    return this.ffmpegAvailable;
  }

  /**
   * Extract frames from a video file at the specified timestamps.
   *
   * @param request - Extraction parameters (video path, timestamps, output dir)
   * @returns Result with extracted frame paths and ffmpeg availability status
   */
  async extract(request: FrameExtractionRequest): Promise<FrameExtractionResult> {
    const available = await this.checkFfmpeg();

    if (!available) {
      return { frames: [], ffmpegAvailable: false };
    }

    const maxFrames = request.maxFrames ?? DEFAULT_MAX_FRAMES;

    // Cap timestamps to maxFrames, keeping evenly distributed ones
    let timestamps = [...request.timestamps].sort((a, b) => a - b);
    if (timestamps.length > maxFrames) {
      timestamps = this.selectDistributed(timestamps, maxFrames);
    }

    // Ensure the screenshots subdirectory exists
    const screenshotsDir = join(request.outputDir, 'screenshots');
    if (!existsSync(screenshotsDir)) {
      mkdirSync(screenshotsDir, { recursive: true });
    }

    // Extract each frame
    const frames: FrameExtractionResult['frames'] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      const frameNumber = String(i + 1).padStart(3, '0');
      const outputPath = join(screenshotsDir, `frame-${frameNumber}.png`);

      try {
        await this.extractSingleFrame(request.videoPath, timestamp, outputPath);

        frames.push({
          path: outputPath,
          timestamp,
          success: true,
        });

        this.log(`Extracted frame ${frameNumber} at ${timestamp.toFixed(2)}s`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(`Failed to extract frame at ${timestamp.toFixed(2)}s: ${message}`);

        frames.push({
          path: outputPath,
          timestamp,
          success: false,
        });
      }
    }

    return { frames, ffmpegAvailable: true };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Extract a single frame from the video at the given timestamp.
   */
  private async extractSingleFrame(
    videoPath: string,
    timestamp: number,
    outputPath: string
  ): Promise<void> {
    // -ss before -i for fast seeking
    // -frames:v 1 to extract exactly one frame
    // -q:v 2 for high quality PNG output
    const args = [
      '-ss', String(timestamp),
      '-i', videoPath,
      '-frames:v', '1',
      '-q:v', '2',
      '-y', // overwrite output file if it exists
      outputPath,
    ];

    await execFile(this.ffmpegPath, args, {
      timeout: FFMPEG_FRAME_TIMEOUT_MS,
    });
  }

  /**
   * Select evenly distributed timestamps from a sorted array.
   * Always includes the first and last timestamp.
   */
  private selectDistributed(sorted: number[], count: number): number[] {
    if (sorted.length <= count) {
      return sorted;
    }

    if (count <= 0) {
      return [];
    }

    if (count === 1) {
      return [sorted[0]];
    }

    const result: number[] = [sorted[0]];
    const step = (sorted.length - 1) / (count - 1);

    for (let i = 1; i < count - 1; i++) {
      const index = Math.round(i * step);
      result.push(sorted[index]);
    }

    result.push(sorted[sorted.length - 1]);
    return result;
  }

  /**
   * Log helper with consistent prefix.
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    console.log(`[FrameExtractor ${timestamp}] ${message}`);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const frameExtractor = new FrameExtractor();
export default FrameExtractor;
