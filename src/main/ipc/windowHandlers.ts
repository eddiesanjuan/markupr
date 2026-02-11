/**
 * Window IPC Handlers
 *
 * Registers IPC handlers for window control, popover management,
 * app version, Windows taskbar, transcription tiers, and Whisper model management.
 */

import { ipcMain, app } from 'electron';
import { tierManager } from '../transcription/TierManager';
import { modelDownloadManager } from '../transcription/ModelDownloadManager';
import type { WhisperModel } from '../transcription/types';
import { POPOVER_SIZES } from '../windows';
import {
  IPC_CHANNELS,
  type TranscriptionTier as UiTranscriptionTier,
  type TranscriptionTierStatus,
} from '../../shared/types';
import type { IpcContext } from './types';

export function registerWindowHandlers(ctx: IpcContext): void {
  const { getMainWindow, getPopover, getWindowsTaskbar } = ctx;

  // -------------------------------------------------------------------------
  // App Version
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.APP_VERSION, () => {
    return app.getVersion();
  });

  // -------------------------------------------------------------------------
  // Window Control
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    getMainWindow()?.minimize();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_HIDE, () => {
    const popover = getPopover();
    if (popover) {
      popover.hide();
    } else {
      getMainWindow()?.hide();
    }
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    getMainWindow()?.close();
    return { success: true };
  });

  // -------------------------------------------------------------------------
  // Popover Control (Menu Bar Mode)
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.POPOVER_RESIZE, (_, width: number, height: number) => {
    const popover = getPopover();
    if (popover) {
      popover.resize(width, height);
      return { success: true };
    }
    return { success: false, error: 'Popover not initialized' };
  });

  ipcMain.handle(IPC_CHANNELS.POPOVER_RESIZE_TO_STATE, (_, state: string) => {
    const popover = getPopover();
    if (popover && state in POPOVER_SIZES) {
      popover.resizeToState(state as keyof typeof POPOVER_SIZES);
      return { success: true };
    }
    return { success: false, error: 'Popover not initialized or invalid state' };
  });

  ipcMain.handle(IPC_CHANNELS.POPOVER_SHOW, () => {
    getPopover()?.show();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.POPOVER_HIDE, () => {
    getPopover()?.hide();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.POPOVER_TOGGLE, () => {
    getPopover()?.toggle();
    return { success: true };
  });

  // -------------------------------------------------------------------------
  // Windows Taskbar (Windows-specific)
  // -------------------------------------------------------------------------

  ipcMain.handle(
    IPC_CHANNELS.TASKBAR_SET_PROGRESS,
    (_, progress: number) => {
      getWindowsTaskbar()?.setProgress(progress);
      return { success: true };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.TASKBAR_FLASH_FRAME,
    (_, count?: number) => {
      getWindowsTaskbar()?.flashFrame(count);
      return { success: true };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.TASKBAR_SET_OVERLAY,
    (_, state: 'recording' | 'processing' | 'none') => {
      getWindowsTaskbar()?.setOverlayIcon(state);
      return { success: true };
    }
  );

  // -------------------------------------------------------------------------
  // Transcription Tier Control
  // -------------------------------------------------------------------------

  ipcMain.handle(
    IPC_CHANNELS.TRANSCRIPTION_GET_TIER_STATUSES,
    async (): Promise<TranscriptionTierStatus[]> => {
      const statuses = await tierManager.getTierStatuses();

      return statuses.map((status) => {
        if (tierManager.tierProvidesTranscription(status.tier)) {
          return status;
        }

        return {
          ...status,
          available: false,
          reason: 'Not supported for narrated feedback reports',
        };
      });
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.TRANSCRIPTION_GET_CURRENT_TIER,
    async (): Promise<UiTranscriptionTier | null> => {
      const preferred = tierManager.getPreferredTier();
      if (preferred !== 'auto') {
        return preferred;
      }

      const active = tierManager.getCurrentTier();
      if (active) {
        return active;
      }

      const best = await tierManager.selectBestTier();
      if (tierManager.tierProvidesTranscription(best)) {
        return best;
      }

      return null;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.TRANSCRIPTION_SET_TIER,
    (_, tier: UiTranscriptionTier): { success: boolean; error?: string } => {
      try {
        const validTiers = new Set(['auto', 'whisper', 'timer-only']);
        if (!validTiers.has(tier)) {
          return { success: false, error: `Tier "${tier}" is no longer supported.` };
        }
        tierManager.setPreferredTier(tier as 'auto' | 'whisper' | 'timer-only');
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set transcription tier.',
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Whisper Model Channels
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.WHISPER_CHECK_MODEL, () => {
    const hasAnyModel = modelDownloadManager.hasAnyModel();
    const downloadedModels: string[] = [];
    const models: WhisperModel[] = ['tiny', 'base', 'small', 'medium', 'large'];

    for (const model of models) {
      if (modelDownloadManager.isModelDownloaded(model)) {
        downloadedModels.push(model);
      }
    }

    const defaultModel = hasAnyModel ? modelDownloadManager.getDefaultModel() : null;
    const recommendedModel = 'tiny';
    const recommendedInfo = modelDownloadManager.getModelInfo('tiny');

    return {
      hasAnyModel,
      defaultModel,
      downloadedModels,
      recommendedModel,
      recommendedModelSizeMB: recommendedInfo.sizeMB,
    };
  });

  ipcMain.handle(IPC_CHANNELS.WHISPER_HAS_TRANSCRIPTION_CAPABILITY, async () => {
    return tierManager.hasTranscriptionCapability();
  });

  ipcMain.handle(IPC_CHANNELS.WHISPER_GET_AVAILABLE_MODELS, () => {
    const models = modelDownloadManager.getAvailableModels();
    return models.map((info) => ({
      name: info.name,
      filename: info.filename,
      sizeMB: info.sizeMB,
      ramRequired: info.ramRequired,
      quality: info.quality,
      isDownloaded: modelDownloadManager.isModelDownloaded(info.name as WhisperModel),
    }));
  });

  ipcMain.handle(IPC_CHANNELS.WHISPER_DOWNLOAD_MODEL, async (_, model: WhisperModel) => {
    try {
      const unsubProgress = modelDownloadManager.onProgress((progress) => {
        getMainWindow()?.webContents.send(IPC_CHANNELS.WHISPER_DOWNLOAD_PROGRESS, {
          model: progress.model,
          downloadedBytes: progress.downloadedBytes,
          totalBytes: progress.totalBytes,
          percent: progress.percent,
          speedBps: progress.speedBps,
          estimatedSecondsRemaining: progress.estimatedSecondsRemaining,
        });
      });

      const unsubComplete = modelDownloadManager.onComplete((result) => {
        getMainWindow()?.webContents.send(IPC_CHANNELS.WHISPER_DOWNLOAD_COMPLETE, {
          model: result.model,
          path: result.path,
        });
        unsubProgress();
        unsubComplete();
        unsubError();
      });

      const unsubError = modelDownloadManager.onError((error, errorModel) => {
        getMainWindow()?.webContents.send(IPC_CHANNELS.WHISPER_DOWNLOAD_ERROR, {
          model: errorModel,
          error: error.message,
        });
        unsubProgress();
        unsubComplete();
        unsubError();
      });

      const result = await modelDownloadManager.downloadModel(model);

      return { success: result.success };
    } catch (error) {
      console.error('[Main] Failed to download Whisper model:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WHISPER_CANCEL_DOWNLOAD, (_, model: WhisperModel) => {
    modelDownloadManager.cancelDownload(model);
    return { success: true };
  });
}
