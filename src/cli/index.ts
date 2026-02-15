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
import {
  CLIPipeline,
  CLIPipelineError,
  EXIT_SUCCESS,
  EXIT_USER_ERROR,
  EXIT_SYSTEM_ERROR,
  EXIT_SIGINT,
} from './CLIPipeline';
import { WatchMode } from './WatchMode';
import { templateRegistry } from '../main/output/templates/index';

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
// Signal handling
// ============================================================================

let activePipeline: CLIPipeline | null = null;

function setupSignalHandlers(): void {
  const handler = async () => {
    console.log('\n  Interrupted — cleaning up...');
    if (activePipeline) {
      await activePipeline.abort();
    }
    process.exit(EXIT_SIGINT);
  };

  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}

setupSignalHandlers();

// ============================================================================
// CLI definition
// ============================================================================

const program = new Command();

program
  .name('markupr')
  .description('Analyze screen recordings and generate AI-ready Markdown reports')
  .version(VERSION, '-v, --version')
  .showHelpAfterError('(use --help for available options)');

program
  .command('analyze')
  .description('Analyze a video recording and generate a structured feedback report')
  .argument('<video-file>', 'Path to the video file to analyze')
  .option('--audio <file>', 'Separate audio file (if not embedded in video)')
  .option('--output <dir>', 'Output directory', './markupr-output')
  .option('--whisper-model <path>', 'Path to Whisper model file')
  .option('--openai-key <key>', 'OpenAI API key for cloud transcription (prefer OPENAI_API_KEY env var)')
  .option('--no-frames', 'Skip frame extraction')
  .option('--template <name>', `Output template (${templateRegistry.list().join(', ')})`, 'markdown')
  .option('--verbose', 'Verbose output', false)
  .action(async (videoFile: string, options: {
    audio?: string;
    output: string;
    whisperModel?: string;
    openaiKey?: string;
    frames: boolean;
    template: string;
    verbose: boolean;
  }) => {
    banner();

    // Resolve paths
    const videoPath = resolve(videoFile);
    const outputDir = resolve(options.output);
    const audioPath = options.audio ? resolve(options.audio) : undefined;
    const whisperModelPath = options.whisperModel ? resolve(options.whisperModel) : undefined;

    // Resolve OpenAI key: env var as primary, CLI flag as override (with warning)
    let openaiKey: string | undefined;
    if (options.openaiKey) {
      console.warn('  WARNING: Passing API keys via CLI args is insecure (visible in ps, shell history).');
      console.warn('  Use OPENAI_API_KEY env var instead.');
      console.warn();
      openaiKey = options.openaiKey;
    } else if (process.env.OPENAI_API_KEY) {
      openaiKey = process.env.OPENAI_API_KEY;
    }

    // Validate video file exists
    if (!existsSync(videoPath)) {
      fail(`Video file not found: ${videoPath}`);
      process.exit(EXIT_USER_ERROR);
    }

    // Validate audio file exists (fail-fast, before pipeline starts)
    if (audioPath && !existsSync(audioPath)) {
      fail(`Audio file not found: ${audioPath}`);
      process.exit(EXIT_USER_ERROR);
    }

    // Validate whisper model exists if explicitly provided
    if (whisperModelPath && !existsSync(whisperModelPath)) {
      fail(`Whisper model not found: ${whisperModelPath}`);
      process.exit(EXIT_USER_ERROR);
    }

    step(`Video:  ${videoPath}`);
    if (audioPath) {
      step(`Audio:  ${audioPath}`);
    }
    step(`Output: ${outputDir}`);
    console.log();

    // Validate template
    if (!templateRegistry.has(options.template)) {
      fail(`Unknown template "${options.template}". Available: ${templateRegistry.list().join(', ')}`);
      process.exit(EXIT_USER_ERROR);
    }

    if (options.template !== 'markdown') {
      step(`Template: ${options.template}`);
    }

    // Run pipeline
    const pipeline = new CLIPipeline(
      {
        videoPath,
        audioPath,
        outputDir,
        whisperModelPath,
        openaiKey,
        skipFrames: !options.frames,
        template: options.template,
        verbose: options.verbose,
      },
      options.verbose ? step : () => {},
      step, // progress — always visible
    );

    activePipeline = pipeline;

    try {
      step('Starting analysis pipeline...');
      console.log();

      const result = await pipeline.run();

      // Check for empty results
      if (result.transcriptSegments === 0 && result.extractedFrames === 0) {
        console.log();
        fail('Analysis produced no output (no transcript, no frames).');
        console.log('  Possible causes:');
        console.log('  - Video has no audio track (provide --audio <file>)');
        console.log('  - Whisper model not installed (check --whisper-model)');
        console.log('  - ffmpeg not installed (brew install ffmpeg)');
        process.exit(EXIT_USER_ERROR);
      }

      console.log();
      success('Analysis complete!');
      console.log();
      console.log(`  Transcript segments: ${result.transcriptSegments}`);
      console.log(`  Extracted frames:    ${result.extractedFrames}`);
      console.log(`  Processing time:     ${result.durationSeconds.toFixed(1)}s`);
      console.log();
      // Output path on its own line with a stable prefix for easy parsing by
      // AI agents and shell scripts (e.g., `markupr analyze ... | grep '^OUTPUT:'`).
      console.log(`  Output: ${result.outputPath}`);
      console.log(`OUTPUT:${result.outputPath}`);
      console.log();
    } catch (error) {
      console.log();
      const message = error instanceof Error ? error.message : String(error);
      fail(`Analysis failed: ${message}`);

      if (options.verbose && error instanceof Error && error.stack) {
        console.log();
        console.log(error.stack);
      }

      const exitCode =
        error instanceof CLIPipelineError && error.severity === 'user'
          ? EXIT_USER_ERROR
          : EXIT_SYSTEM_ERROR;
      process.exit(exitCode);
    } finally {
      activePipeline = null;
    }
  });

// ============================================================================
// watch command
// ============================================================================

program
  .command('watch')
  .description('Watch a directory for new recordings and auto-process them')
  .argument('[directory]', 'Directory to watch for recordings', '.')
  .option('--output <dir>', 'Output directory (default: <watched-dir>/markupr-output)')
  .option('--whisper-model <path>', 'Path to Whisper model file')
  .option('--openai-key <key>', 'OpenAI API key for cloud transcription (prefer OPENAI_API_KEY env var)')
  .option('--no-frames', 'Skip frame extraction')
  .option('--verbose', 'Verbose output', false)
  .action(async (directory: string, options: {
    output?: string;
    whisperModel?: string;
    openaiKey?: string;
    frames: boolean;
    verbose: boolean;
  }) => {
    banner();

    const watchDir = resolve(directory);

    // Resolve OpenAI key
    let openaiKey: string | undefined;
    if (options.openaiKey) {
      console.warn('  WARNING: Passing API keys via CLI args is insecure (visible in ps, shell history).');
      console.warn('  Use OPENAI_API_KEY env var instead.');
      console.warn();
      openaiKey = options.openaiKey;
    } else if (process.env.OPENAI_API_KEY) {
      openaiKey = process.env.OPENAI_API_KEY;
    }

    if (!existsSync(watchDir)) {
      fail(`Directory not found: ${watchDir}`);
      process.exit(EXIT_USER_ERROR);
    }

    const watchMode = new WatchMode(
      {
        watchDir,
        outputDir: options.output ? resolve(options.output) : undefined,
        whisperModelPath: options.whisperModel ? resolve(options.whisperModel) : undefined,
        openaiKey,
        skipFrames: !options.frames,
        verbose: options.verbose,
      },
      {
        onLog: step,
        onFileDetected: (filePath) => {
          step(`Detected: ${filePath}`);
        },
        onProcessingStart: (filePath) => {
          console.log();
          step(`Processing: ${filePath}`);
        },
        onProcessingComplete: (filePath, outputPath) => {
          success(`Done: ${filePath}`);
          step(`Output: ${outputPath}`);
        },
        onProcessingError: (filePath, error) => {
          fail(`Failed: ${filePath} — ${error.message}`);
        },
      }
    );

    // Graceful shutdown
    const shutdown = () => {
      console.log('\n  Stopping watcher...');
      watchMode.stop();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    step(`Watching for recordings in: ${watchDir}`);
    step('Press Ctrl+C to stop');
    console.log();

    try {
      await watchMode.start();
      success('Watch mode stopped.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(`Watch mode error: ${message}`);
      process.exit(EXIT_SYSTEM_ERROR);
    }
  });

// ============================================================================
// push command group
// ============================================================================

const pushCmd = program
  .command('push')
  .description('Push feedback to external services');

// ============================================================================
// push linear command
// ============================================================================

pushCmd
  .command('linear')
  .description('Create Linear issues from a markupr feedback report')
  .argument('<report>', 'Path to the markupr markdown report')
  .requiredOption('--team <key>', 'Linear team key (e.g., ENG, DES)')
  .option('--token <token>', 'Linear API key (prefer LINEAR_API_KEY env var)')
  .option('--project <name>', 'Linear project name to assign issues to')
  .option('--dry-run', 'Show what would be created without creating anything', false)
  .action(async (report: string, options: {
    team: string;
    token?: string;
    project?: string;
    dryRun: boolean;
  }) => {
    banner();

    const reportPath = resolve(report);

    if (!existsSync(reportPath)) {
      fail(`Report file not found: ${reportPath}`);
      process.exit(EXIT_USER_ERROR);
    }

    // Warn about insecure token passing
    if (options.token) {
      console.warn('  WARNING: Passing tokens via CLI args is insecure (visible in ps, shell history).');
      console.warn('  Use LINEAR_API_KEY env var instead.');
      console.warn();
    }

    // Resolve token: CLI flag overrides env var
    const apiToken = options.token || process.env.LINEAR_API_KEY;
    if (!apiToken) {
      fail('No Linear API token found.');
      console.log('  Provide via --token flag or LINEAR_API_KEY env var.');
      process.exit(EXIT_USER_ERROR);
    }

    // Lazy import to keep startup fast
    const { LinearIssueCreator } = await import(
      '../integrations/linear/LinearIssueCreator'
    );

    try {
      step(`Report: ${reportPath}`);
      step(`Team:   ${options.team}`);
      if (options.project) {
        step(`Project: ${options.project}`);
      }
      if (options.dryRun) {
        step('Mode:   DRY RUN');
      }
      console.log();

      step('Parsing feedback report...');
      const creator = new LinearIssueCreator(apiToken);
      const result = await creator.pushReport(reportPath, {
        token: apiToken,
        teamKey: options.team,
        projectName: options.project,
        dryRun: options.dryRun,
      });

      console.log();

      if (options.dryRun) {
        success(`Dry run complete — ${result.created} issue(s) would be created:`);
        console.log();
        for (const issue of result.issues) {
          if (issue.success) {
            step(`${issue.identifier}: ${issue.issueUrl}`);
          }
        }
      } else {
        success(`Created ${result.created} issue(s):`);
        console.log();
        for (const issue of result.issues) {
          if (issue.success) {
            step(`${issue.identifier}: ${issue.issueUrl}`);
          }
        }
      }

      if (result.failed > 0) {
        console.log();
        fail(`${result.failed} error(s):`);
        for (const issue of result.issues) {
          if (!issue.success) {
            fail(`  ${issue.error}`);
          }
        }
      }

      console.log();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(message);
      process.exit(EXIT_USER_ERROR);
    }
  });

// ============================================================================
// push github command
// ============================================================================

pushCmd
  .command('github')
  .description('Create GitHub issues from a markupr feedback report')
  .argument('<report>', 'Path to the markupr markdown report')
  .requiredOption('--repo <owner/repo>', 'Target GitHub repository (e.g., myorg/myapp)')
  .option('--token <token>', 'GitHub token (prefer GITHUB_TOKEN env var or gh auth login)')
  .option('--items <ids...>', 'Specific FB-XXX item IDs to push (default: all)')
  .option('--dry-run', 'Show what would be created without creating anything', false)
  .action(async (report: string, options: {
    repo: string;
    token?: string;
    items?: string[];
    dryRun: boolean;
  }) => {
    banner();

    const reportPath = resolve(report);

    if (!existsSync(reportPath)) {
      fail(`Report file not found: ${reportPath}`);
      process.exit(EXIT_USER_ERROR);
    }

    // Warn about insecure token passing
    if (options.token) {
      console.warn('  WARNING: Passing tokens via CLI args is insecure (visible in ps, shell history).');
      console.warn('  Use GITHUB_TOKEN env var or `gh auth login` instead.');
      console.warn();
    }

    // Lazy import to keep startup fast
    const { resolveAuth, parseRepoString, pushToGitHub } = await import(
      '../integrations/github/GitHubIssueCreator'
    );

    try {
      const parsedRepo = parseRepoString(options.repo);
      const auth = await resolveAuth(options.token);

      step(`Report: ${reportPath}`);
      step(`Repo:   ${parsedRepo.owner}/${parsedRepo.repo}`);
      step(`Auth:   ${auth.source}`);
      if (options.dryRun) {
        step('Mode:   DRY RUN');
      }
      console.log();

      step('Parsing feedback report and creating issues...');
      const result = await pushToGitHub({
        repo: parsedRepo,
        auth,
        reportPath,
        dryRun: options.dryRun,
        items: options.items,
      });

      console.log();

      if (options.dryRun) {
        success(`Dry run complete — ${result.created.length} issue(s) would be created:`);
        console.log();
        for (const issue of result.created) {
          step(`  ${issue.title}`);
        }
      } else {
        success(`Created ${result.created.length} issue(s):`);
        console.log();
        for (const issue of result.created) {
          step(`#${issue.number}: ${issue.title}`);
          step(`  ${issue.url}`);
        }
      }

      if (result.labelsCreated.length > 0) {
        console.log();
        step(`Labels created: ${result.labelsCreated.join(', ')}`);
      }

      if (result.errors.length > 0) {
        console.log();
        fail(`${result.errors.length} error(s):`);
        for (const err of result.errors) {
          fail(`  ${err.itemId}: ${err.error}`);
        }
      }

      console.log();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(message);
      process.exit(EXIT_USER_ERROR);
    }
  });

// Show help if no command provided
if (process.argv.length <= 2) {
  banner();
  program.outputHelp();
  process.exit(EXIT_SUCCESS);
}

program.parse();
