/**
 * CLIPipeline.ts - Pipeline wrapper for CLI usage
 *
 * Orchestrates the existing post-processing pipeline without any Electron
 * dependencies. Handles: audio extraction, transcription, analysis, frame
 * extraction, and markdown generation.
 */

import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, basename } from 'path';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import { TranscriptAnalyzer } from '../main/pipeline/TranscriptAnalyzer';
import { FrameExtractor } from '../main/pipeline/FrameExtractor';
import { MarkdownGenerator } from '../main/output/MarkdownGenerator';
import { WhisperService } from '../main/transcription/WhisperService';

import type { PostProcessResult, TranscriptSegment } from '../main/pipeline/PostProcessor';

const execFile = promisify(execFileCb);

// ============================================================================
// Types
// ============================================================================

export interface CLIPipelineOptions {
  videoPath: string;
  audioPath?: string;
  outputDir: string;
  whisperModelPath?: string;
  openaiKey?: string;
  skipFrames: boolean;
  verbose: boolean;
}

export interface CLIPipelineResult {
  outputPath: string;
  transcriptSegments: number;
  extractedFrames: number;
  durationSeconds: number;
}

type LogFn = (message: string) => void;

// ============================================================================
// CLIPipeline Class
// ============================================================================

export class CLIPipeline {
  private options: CLIPipelineOptions;
  private log: LogFn;

  constructor(options: CLIPipelineOptions, log: LogFn) {
    this.options = options;
    this.log = log;
  }

  /**
   * Run the full pipeline: audio extraction -> transcription -> analysis ->
   * frame extraction -> markdown generation.
   */
  async run(): Promise<CLIPipelineResult> {
    const startTime = Date.now();

    // Step 1: Ensure output directory exists
    if (!existsSync(this.options.outputDir)) {
      mkdirSync(this.options.outputDir, { recursive: true });
    }

    // Step 2: Resolve audio path - extract from video if not provided
    const audioPath = await this.resolveAudioPath();

    // Step 3: Transcribe audio
    const segments = await this.transcribe(audioPath);

    // Step 4: Analyze transcript for key moments
    const analyzer = new TranscriptAnalyzer();
    const keyMoments = analyzer.analyze(segments);
    this.log(`  Found ${keyMoments.length} key moment(s)`);

    // Step 5: Extract frames (unless --no-frames)
    let extractedFrames: PostProcessResult['extractedFrames'] = [];
    if (!this.options.skipFrames) {
      extractedFrames = await this.extractFrames(keyMoments, segments);
    } else {
      this.log('  Frame extraction skipped (--no-frames)');
    }

    // Step 6: Generate markdown
    const result: PostProcessResult = {
      transcriptSegments: segments,
      extractedFrames,
      reportPath: this.options.outputDir,
    };

    const generator = new MarkdownGenerator();
    const markdown = generator.generateFromPostProcess(result, this.options.outputDir);

    // Step 7: Write output
    const outputFilename = this.generateOutputFilename();
    const outputPath = join(this.options.outputDir, outputFilename);
    await writeFile(outputPath, markdown, 'utf-8');

    const durationSeconds = (Date.now() - startTime) / 1000;

    return {
      outputPath,
      transcriptSegments: segments.length,
      extractedFrames: extractedFrames.length,
      durationSeconds,
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Resolve the audio path. If no separate audio file was provided, probe
   * the video for an audio track and extract it to a temp WAV file.
   */
  private async resolveAudioPath(): Promise<string | null> {
    if (this.options.audioPath) {
      if (!existsSync(this.options.audioPath)) {
        throw new Error(`Audio file not found: ${this.options.audioPath}`);
      }
      this.log(`  Using provided audio: ${this.options.audioPath}`);
      return this.options.audioPath;
    }

    // Check if video has an audio track
    const hasAudio = await this.videoHasAudioTrack(this.options.videoPath);
    if (!hasAudio) {
      this.log('  No audio track found in video - transcription will be skipped');
      return null;
    }

    // Extract audio from video
    this.log('  Extracting audio from video...');
    const tempAudioPath = join(tmpdir(), `markupr-cli-audio-${randomUUID()}.wav`);

    try {
      await execFile('ffmpeg', [
        '-i', this.options.videoPath,
        '-vn',
        '-ar', '16000',
        '-ac', '1',
        '-f', 'wav',
        '-acodec', 'pcm_f32le',
        '-y',
        tempAudioPath,
      ]);
      this.log('  Audio extraction complete');
      return tempAudioPath;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log(`  WARNING: Audio extraction failed: ${msg}`);
      return null;
    }
  }

  /**
   * Use ffprobe to check whether the video file contains an audio stream.
   */
  private async videoHasAudioTrack(videoPath: string): Promise<boolean> {
    try {
      const { stdout } = await execFile('ffprobe', [
        '-v', 'error',
        '-select_streams', 'a',
        '-show_entries', 'stream=codec_type',
        '-of', 'csv=p=0',
        videoPath,
      ]);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Transcribe audio using WhisperService. Falls back gracefully if the
   * model is not available.
   */
  private async transcribe(audioPath: string | null): Promise<TranscriptSegment[]> {
    if (!audioPath) {
      this.log('  No audio available - skipping transcription');
      return [];
    }

    // If an OpenAI key is provided, we could use cloud transcription in the
    // future. For now the CLI only supports local Whisper.
    const whisper = new WhisperService(
      this.options.whisperModelPath ? { modelPath: this.options.whisperModelPath } : undefined
    );

    if (!whisper.isModelAvailable()) {
      const modelsDir = whisper.getModelsDirectory();
      this.log(`  Whisper model not found at: ${whisper.getConfig().modelPath}`);
      this.log(`  Models directory: ${modelsDir}`);
      this.log('  Transcription will be skipped. Download a model to enable transcription.');
      return [];
    }

    this.log(`  Transcribing with Whisper (model: ${basename(whisper.getConfig().modelPath)})...`);

    try {
      const results = await whisper.transcribeFile(audioPath, (percent) => {
        if (this.options.verbose) {
          process.stdout.write(`\r  Transcription progress: ${percent}%`);
        }
      });

      if (this.options.verbose && results.length > 0) {
        process.stdout.write('\n');
      }

      const segments: TranscriptSegment[] = results.map((r) => ({
        text: r.text,
        startTime: r.startTime,
        endTime: r.endTime,
        confidence: r.confidence,
      }));

      this.log(`  Transcription complete: ${segments.length} segment(s)`);
      return segments;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log(`  WARNING: Transcription failed: ${msg}`);
      return [];
    }
  }

  /**
   * Extract video frames at key moment timestamps.
   */
  private async extractFrames(
    keyMoments: Array<{ timestamp: number; reason: string; confidence: number }>,
    segments: TranscriptSegment[]
  ): Promise<PostProcessResult['extractedFrames']> {
    if (keyMoments.length === 0) {
      this.log('  No key moments found - skipping frame extraction');
      return [];
    }

    const extractor = new FrameExtractor();
    const available = await extractor.checkFfmpeg();

    if (!available) {
      this.log('  WARNING: ffmpeg not found - frame extraction skipped');
      this.log('  Install ffmpeg: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)');
      return [];
    }

    this.log(`  Extracting ${keyMoments.length} frame(s)...`);

    const timestamps = keyMoments.map((m) => m.timestamp);
    const extractionResult = await extractor.extract({
      videoPath: this.options.videoPath,
      timestamps,
      outputDir: this.options.outputDir,
    });

    const extractedFrames = extractionResult.frames
      .filter((f) => f.success)
      .map((frame) => {
        const moment = keyMoments.find(
          (m) => Math.abs(m.timestamp - frame.timestamp) < 0.5
        );
        const closestSegment = this.findClosestSegment(frame.timestamp, segments);

        return {
          path: frame.path,
          timestamp: frame.timestamp,
          reason: moment?.reason ?? 'Extracted frame',
          transcriptSegment: closestSegment,
        };
      });

    this.log(`  Extracted ${extractedFrames.length} frame(s)`);
    return extractedFrames;
  }

  /**
   * Find the transcript segment closest to a given timestamp.
   */
  private findClosestSegment(
    timestamp: number,
    segments: TranscriptSegment[]
  ): TranscriptSegment | undefined {
    if (segments.length === 0) return undefined;

    for (const segment of segments) {
      if (timestamp >= segment.startTime && timestamp <= segment.endTime) {
        return segment;
      }
    }

    let closest = segments[0];
    let minDistance = Math.abs(timestamp - closest.startTime);

    for (let i = 1; i < segments.length; i++) {
      const distance = Math.abs(timestamp - segments[i].startTime);
      if (distance < minDistance) {
        minDistance = distance;
        closest = segments[i];
      }
    }

    return closest;
  }

  /**
   * Generate the output filename based on the video filename and current date.
   */
  private generateOutputFilename(): string {
    const videoName = basename(this.options.videoPath)
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-');

    const now = new Date();
    const dateStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('');
    const timeStr = [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');

    return `${videoName}-feedback-${dateStr}-${timeStr}.md`;
  }
}
