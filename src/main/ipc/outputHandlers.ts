/**
 * Output IPC Handlers
 *
 * Registers IPC handlers for session output operations:
 * save, clipboard, session history, export, and deletion.
 */

import { ipcMain, shell } from 'electron';
import * as fs from 'fs/promises';
import { join, basename } from 'path';
import { sessionController } from '../SessionController';
import {
  fileManager,
  outputManager,
  clipboardService,
  generateDocumentForFileManager,
} from '../output';
import { processSession as aiProcessSession } from '../ai';
import { IPC_CHANNELS, type SaveResult } from '../../shared/types';
import type { IpcContext } from './types';

// =============================================================================
// Session History Types and Helpers
// =============================================================================

interface ListedSessionMetadata {
  sessionId: string;
  startTime: number;
  endTime?: number;
  itemCount: number;
  screenshotCount: number;
  source?: {
    id: string;
    name?: string;
  };
}

interface SessionHistoryItem {
  id: string;
  startTime: number;
  endTime: number;
  itemCount: number;
  screenshotCount: number;
  sourceName: string;
  firstThumbnail?: string;
  folder: string;
  transcriptionPreview?: string;
}

function extractPreviewFromMarkdown(content: string): string | undefined {
  const blockMatch = content.match(/#### Feedback\s*\n> ([\s\S]*?)(?:\n\n|\n---|$)/);
  const fallbackLine = content.split('\n').find((line) => line.startsWith('> '));
  const rawPreview = blockMatch?.[1] || fallbackLine?.replace(/^>\s*/, '');

  if (!rawPreview) {
    return undefined;
  }

  const singleLine = rawPreview.replace(/\n>\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return singleLine.slice(0, 220);
}

async function resolveSessionThumbnail(sessionDir: string): Promise<string | undefined> {
  const screenshotsDir = join(sessionDir, 'screenshots');

  try {
    const files = await fs.readdir(screenshotsDir);
    const firstImage = files
      .filter((file) => /\.(png|jpe?g|webp)$/i.test(file))
      .sort()[0];

    if (!firstImage) {
      return undefined;
    }

    return join(screenshotsDir, firstImage);
  } catch {
    return undefined;
  }
}

async function buildSessionHistoryItem(
  dir: string,
  metadata: ListedSessionMetadata
): Promise<SessionHistoryItem> {
  const markdownPath = join(dir, 'feedback-report.md');

  let transcriptionPreview: string | undefined;
  try {
    const markdown = await fs.readFile(markdownPath, 'utf-8');
    transcriptionPreview = extractPreviewFromMarkdown(markdown);
  } catch {
    transcriptionPreview = undefined;
  }

  return {
    id: metadata.sessionId,
    startTime: metadata.startTime,
    endTime: metadata.endTime || metadata.startTime,
    itemCount: metadata.itemCount || 0,
    screenshotCount: metadata.screenshotCount || 0,
    sourceName: metadata.source?.name || 'Feedback Session',
    firstThumbnail: await resolveSessionThumbnail(dir),
    folder: dir,
    transcriptionPreview,
  };
}

export async function listSessionHistoryItems(): Promise<SessionHistoryItem[]> {
  const sessions = await fileManager.listSessions();
  const items = await Promise.all(
    sessions.map(({ dir, metadata }) =>
      buildSessionHistoryItem(dir, metadata as ListedSessionMetadata)
    )
  );
  return items.sort((a, b) => b.startTime - a.startTime);
}

async function getSessionHistoryItem(sessionId: string): Promise<SessionHistoryItem | null> {
  const sessions = await listSessionHistoryItems();
  return sessions.find((session) => session.id === sessionId) || null;
}

async function exportSessionFolders(sessionIds: string[]): Promise<string> {
  const sessions = await listSessionHistoryItems();
  const selected = sessions.filter((session) => sessionIds.includes(session.id));

  if (!selected.length) {
    throw new Error('No sessions found to export.');
  }

  const exportRoot = join(fileManager.getOutputDirectory(), 'exports');
  const bundleDir = join(exportRoot, `bundle-${Date.now()}`);
  await fs.mkdir(bundleDir, { recursive: true });

  for (const session of selected) {
    const destination = join(bundleDir, basename(session.folder));
    await fs.cp(session.folder, destination, { recursive: true });
  }

  return bundleDir;
}

// =============================================================================
// IPC Registration
// =============================================================================

export function registerOutputHandlers(ctx: IpcContext): void {
  const { getSettingsManager } = ctx;

  ipcMain.handle(IPC_CHANNELS.OUTPUT_SAVE, async (): Promise<SaveResult> => {
    try {
      const session = sessionController.getSession();
      if (!session) {
        return { success: false, error: 'No session to save' };
      }

      const settingsManager = getSettingsManager();
      const { document } = settingsManager
        ? await aiProcessSession(session, {
            settingsManager,
            projectName: session.metadata?.sourceName || 'Feedback Session',
            screenshotDir: './screenshots',
          })
        : {
            document: generateDocumentForFileManager(session, {
              projectName: session.metadata?.sourceName || 'Feedback Session',
              screenshotDir: './screenshots',
            }),
          };

      const result = await fileManager.saveSession(session, document);
      return {
        success: result.success,
        path: result.sessionDir,
        error: result.error,
      };
    } catch (error) {
      console.error('[Main] Failed to save session:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.OUTPUT_COPY_CLIPBOARD, async (): Promise<boolean> => {
    try {
      const session = sessionController.getSession();
      if (!session) {
        console.warn('[Main] No session to copy');
        return false;
      }

      return await outputManager.copySessionSummary(session);
    } catch (error) {
      console.error('[Main] Failed to copy to clipboard:', error);
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.OUTPUT_OPEN_FOLDER, async (_, sessionDir?: string) => {
    try {
      const dir = sessionDir || fileManager.getOutputDirectory();
      await shell.openPath(dir);
      return { success: true };
    } catch (error) {
      console.error('[Main] Failed to open folder:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.OUTPUT_LIST_SESSIONS, async () => {
    try {
      return await listSessionHistoryItems();
    } catch (error) {
      console.error('[Main] Failed to list sessions:', error);
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.OUTPUT_GET_SESSION_METADATA, async (_, sessionId: string) => {
    try {
      return await getSessionHistoryItem(sessionId);
    } catch (error) {
      console.error('[Main] Failed to get session metadata:', error);
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.OUTPUT_DELETE_SESSION, async (_, sessionId: string) => {
    try {
      const session = await getSessionHistoryItem(sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      await fs.rm(session.folder, { recursive: true, force: true });
      return { success: true };
    } catch (error) {
      console.error('[Main] Failed to delete session:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.OUTPUT_DELETE_SESSIONS, async (_, sessionIds: string[]) => {
    const deleted: string[] = [];
    const failed: string[] = [];

    for (const sessionId of sessionIds) {
      try {
        const session = await getSessionHistoryItem(sessionId);
        if (!session) {
          failed.push(sessionId);
          continue;
        }

        await fs.rm(session.folder, { recursive: true, force: true });
        deleted.push(sessionId);
      } catch {
        failed.push(sessionId);
      }
    }

    return {
      success: failed.length === 0,
      deleted,
      failed,
    };
  });

  ipcMain.handle(
    IPC_CHANNELS.OUTPUT_EXPORT_SESSION,
    async (_, sessionId: string, format: 'markdown' | 'json' | 'pdf' = 'markdown') => {
      try {
        console.log(`[Main] Exporting session ${sessionId} as ${format}`);
        const exportPath = await exportSessionFolders([sessionId]);
        return { success: true, path: exportPath };
      } catch (error) {
        console.error('[Main] Failed to export session:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.OUTPUT_EXPORT_SESSIONS,
    async (_, sessionIds: string[], format: 'markdown' | 'json' | 'pdf' = 'markdown') => {
      try {
        console.log(`[Main] Exporting ${sessionIds.length} sessions as ${format}`);
        const exportPath = await exportSessionFolders(sessionIds);
        return { success: true, path: exportPath };
      } catch (error) {
        console.error('[Main] Failed to export sessions:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Legacy clipboard handler
  ipcMain.handle(IPC_CHANNELS.COPY_TO_CLIPBOARD, async (_, text: string) => {
    const success = await clipboardService.copyWithNotification(text);
    return { success };
  });
}
