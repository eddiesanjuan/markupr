/**
 * Tool: capture_screenshot
 *
 * Takes a screenshot of the current screen, optionally optimizes it,
 * and saves it to the session directory. Returns a markdown image reference.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'path';
import { readdir } from 'fs/promises';
import { capture } from '../capture/ScreenCapture.js';
import { optimize } from '../utils/ImageOptimizer.js';
import { sessionStore } from '../session/SessionStore.js';
import { log } from '../utils/Logger.js';

export function register(server: McpServer): void {
  server.tool(
    'capture_screenshot',
    'Take a screenshot of the current screen, optimize it, and save to the session directory. Returns a markdown image reference.',
    {
      label: z.string().optional().describe('Optional label for the screenshot'),
      display: z.number().optional().default(1).describe('Display number (1-indexed)'),
      optimize: z.boolean().optional().default(true).describe('Optimize image size with sharp'),
    },
    async ({ label, display, optimize: shouldOptimize }) => {
      try {
        // Create or reuse latest session
        const session = await sessionStore.create(label);
        const sessionDir = sessionStore.getSessionDir(session.id);
        const screenshotsDir = join(sessionDir, 'screenshots');

        // Determine sequential filename
        const existing = await readdir(screenshotsDir).catch(() => []);
        const index = existing.filter((f) => f.startsWith('screenshot-')).length + 1;
        const filename = `screenshot-${String(index).padStart(3, '0')}.png`;
        const outputPath = join(screenshotsDir, filename);

        log(`Capturing screenshot: display=${display}, label=${label ?? 'none'}`);

        // Capture
        await capture({ display, outputPath });

        // Optimize if requested
        if (shouldOptimize) {
          await optimize(outputPath);
        }

        const markdownRef = `![${label ?? filename}](screenshots/${filename})`;

        return {
          content: [
            {
              type: 'text',
              text: `Screenshot saved: ${outputPath}\n${markdownRef}`,
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
