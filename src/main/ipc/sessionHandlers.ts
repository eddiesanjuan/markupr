/**
 * Session IPC Handlers
 *
 * Registers IPC handlers for session lifecycle operations:
 * start, stop, pause, resume, cancel, status queries.
 */

import { ipcMain } from 'electron';
import { sessionController } from '../SessionController';
import { IPC_CHANNELS, type SessionStatusPayload, type SessionPayload } from '../../shared/types';
import type { IpcContext, SessionActions } from './types';

export function registerSessionHandlers(ctx: IpcContext, actions: SessionActions): void {
  ipcMain.handle(IPC_CHANNELS.SESSION_START, async (_, sourceId?: string, sourceName?: string) => {
    console.log('[Main] Starting session');
    return actions.startSession(sourceId, sourceName);
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_STOP, async () => {
    console.log('[Main] Stopping session');
    return actions.stopSession();
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_PAUSE, async () => {
    console.log('[Main] Pausing session');
    return actions.pauseSession();
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_RESUME, async () => {
    console.log('[Main] Resuming session');
    return actions.resumeSession();
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_CANCEL, async () => {
    console.log('[Main] Cancelling session');
    return actions.cancelSession();
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_GET_STATUS, (): SessionStatusPayload => {
    const status = sessionController.getStatus();
    return {
      ...status,
      screenshotCount: 0,
    };
  });

  ipcMain.handle(IPC_CHANNELS.SESSION_GET_CURRENT, (): SessionPayload | null => {
    const session = sessionController.getSession();
    return session ? actions.serializeSession(session) : null;
  });

  // Legacy session handlers (for backwards compatibility)
  ipcMain.handle(IPC_CHANNELS.START_SESSION, async (_, sourceId?: string) => {
    return actions.startSession(sourceId);
  });

  ipcMain.handle(IPC_CHANNELS.STOP_SESSION, async () => {
    return actions.stopSession();
  });
}
