/**
 * Tool: capture_with_voice
 *
 * Records screen and voice for a specified duration, then runs the full
 * markupr pipeline to produce a structured feedback report.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { record } from '../capture/ScreenRecorder.js';
import { sessionStore } from '../session/SessionStore.js';
import { log } from '../utils/Logger.js';
import { CLIPipeline } from '../../cli/CLIPipeline.js';

export function register(server: McpServer): void {
  server.tool(
    'capture_with_voice',
    'Record screen and voice for a specified duration, then run the full markupr pipeline to produce a structured feedback report.',
    {
      duration: z.number().min(3).max(300).describe('Recording duration in seconds (3-300)'),
      outputDir: z.string().optional().describe('Output directory (default: session directory)'),
      skipFrames: z.boolean().optional().default(false).describe('Skip frame extraction'),
    },
    async ({ duration, outputDir, skipFrames }) => {
      try {
        // Create session
        const session = await sessionStore.create();
        const sessionDir = sessionStore.getSessionDir(session.id);
        const videoPath = join(sessionDir, 'recording.mp4');

        log(`Starting capture_with_voice: duration=${duration}s`);

        // Record screen + audio
        await record({ duration, outputPath: videoPath });

        // Run pipeline
        const pipelineOutputDir = outputDir ?? sessionDir;
        const pipeline = new CLIPipeline(
          {
            videoPath,
            outputDir: pipelineOutputDir,
            skipFrames,
            verbose: false,
          },
          (msg) => log(msg),
        );

        const result = await pipeline.run();

        // Update session metadata
        await sessionStore.update(session.id, {
          status: 'complete',
          endTime: Date.now(),
          videoPath,
          reportPath: result.outputPath,
        });

        return {
          content: [
            {
              type: 'text',
              text: [
                `Recording complete: ${duration} seconds captured`,
                'Pipeline results:',
                `  Transcript segments: ${result.transcriptSegments}`,
                `  Extracted frames: ${result.extractedFrames}`,
                `  Processing time: ${result.durationSeconds.toFixed(1)}s`,
                '',
                `Report: ${result.outputPath}`,
                `OUTPUT:${result.outputPath}`,
              ].join('\n'),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
