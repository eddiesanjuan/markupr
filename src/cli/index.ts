/**
 * markupr CLI - Analyze screen recordings from the command line
 *
 * Usage:
 *   markupr analyze <video-file> [options]
 *
 * Processes a video recording through the markupr pipeline:
 *   1. Extract audio from video (or use a separate audio file)
 *   2. Transcribe with local Whisper
 *   3. Detect key moments in transcript
 *   4. Extract video frames at key timestamps
 *   5. Generate structured Markdown report
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { Command } from 'commander';
import { CLIPipeline } from './CLIPipeline';

// Read version from package.json at build time (injected by esbuild)
declare const __MARKUPR_VERSION__: string;
const VERSION = typeof __MARKUPR_VERSION__ !== 'undefined' ? __MARKUPR_VERSION__ : '0.0.0-dev';

// ============================================================================
// Console output helpers
// ============================================================================

const SYMBOLS = {
  check: '\u2714',    // checkmark
  cross: '\u2718',    // cross
  arrow: '\u2192',    // right arrow
  bullet: '\u2022',   // bullet
  ellipsis: '\u2026', // ellipsis
  line: '\u2500',     // horizontal line
} as const;

function banner(): void {
  console.log();
  console.log(`  markupr v${VERSION} ${SYMBOLS.bullet} CLI Mode`);
  console.log(`  ${SYMBOLS.line.repeat(40)}`);
  console.log();
}

function step(message: string): void {
  console.log(`  ${SYMBOLS.arrow} ${message}`);
}

function success(message: string): void {
  console.log(`  ${SYMBOLS.check} ${message}`);
}

function fail(message: string): void {
  console.log(`  ${SYMBOLS.cross} ${message}`);
}

// ============================================================================
// CLI definition
// ============================================================================

const program = new Command();

program
  .name('markupr')
  .description('Analyze screen recordings and generate AI-ready Markdown reports')
  .version(VERSION, '-v, --version');

program
  .command('analyze')
  .description('Analyze a video recording and generate a structured feedback report')
  .argument('<video-file>', 'Path to the video file to analyze')
  .option('--audio <file>', 'Separate audio file (if not embedded in video)')
  .option('--output <dir>', 'Output directory', './markupr-output')
  .option('--whisper-model <path>', 'Path to Whisper model file')
  .option('--openai-key <key>', 'OpenAI API key for cloud transcription')
  .option('--no-frames', 'Skip frame extraction')
  .option('--verbose', 'Verbose output', false)
  .action(async (videoFile: string, options: {
    audio?: string;
    output: string;
    whisperModel?: string;
    openaiKey?: string;
    frames: boolean;
    verbose: boolean;
  }) => {
    banner();

    // Resolve paths
    const videoPath = resolve(videoFile);
    const outputDir = resolve(options.output);
    const audioPath = options.audio ? resolve(options.audio) : undefined;
    const whisperModelPath = options.whisperModel ? resolve(options.whisperModel) : undefined;

    // Validate video file exists
    if (!existsSync(videoPath)) {
      fail(`Video file not found: ${videoPath}`);
      process.exit(1);
    }

    step(`Video:  ${videoPath}`);
    if (audioPath) {
      step(`Audio:  ${audioPath}`);
    }
    step(`Output: ${outputDir}`);
    console.log();

    // Run pipeline
    const pipeline = new CLIPipeline(
      {
        videoPath,
        audioPath,
        outputDir,
        whisperModelPath,
        openaiKey: options.openaiKey,
        skipFrames: !options.frames,
        verbose: options.verbose,
      },
      options.verbose ? step : () => {},
    );

    try {
      step('Starting analysis pipeline...');
      console.log();

      const result = await pipeline.run();

      console.log();
      success('Analysis complete!');
      console.log();
      console.log(`  Transcript segments: ${result.transcriptSegments}`);
      console.log(`  Extracted frames:    ${result.extractedFrames}`);
      console.log(`  Processing time:     ${result.durationSeconds.toFixed(1)}s`);
      console.log();
      console.log(`  Output: ${result.outputPath}`);
      console.log();
    } catch (error) {
      console.log();
      const message = error instanceof Error ? error.message : String(error);
      fail(`Analysis failed: ${message}`);

      if (options.verbose && error instanceof Error && error.stack) {
        console.log();
        console.log(error.stack);
      }

      process.exit(1);
    }
  });

// Show help if no command provided
if (process.argv.length <= 2) {
  banner();
  program.outputHelp();
  process.exit(0);
}

program.parse();
