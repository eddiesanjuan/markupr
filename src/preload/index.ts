/**
 * FeedbackFlow - Preload Script
 *
 * Exposes a safe API to the renderer process via contextBridge.
 * This is the ONLY way the renderer can communicate with the main process.
 *
 * API Design:
 * - Organized by domain (session, capture, audio, transcript, settings, permissions, output)
 * - invoke() for request/response patterns
 * - on/send for event streams (returns cleanup function)
 * - Type-safe channel names from shared types
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type AppSettings,
  type CaptureSource,
  type AudioDevice,
  type PermissionType,
  type PermissionStatus,
  type SessionStatusPayload,
  type SessionPayload,
  type FeedbackItemPayload,
  type TranscriptChunkPayload,
  type ScreenshotCapturedPayload,
  type SaveResult,
  type HotkeyConfig,
  type SessionState,
  type UpdateStatusPayload,
} from '../shared/types';

// =============================================================================
// Type Definitions for Event Handlers
// =============================================================================

type Unsubscribe = () => void;

// =============================================================================
// Helper: Create typed event subscriber
// =============================================================================

function createEventSubscriber<T>(channel: string) {
  return (callback: (data: T) => void): Unsubscribe => {
    const handler = (_: Electron.IpcRendererEvent, data: T) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

// =============================================================================
// FeedbackFlow API
// =============================================================================

const feedbackflow = {
  // ===========================================================================
  // Session API
  // ===========================================================================
  session: {
    /**
     * Start a recording session
     * @param sourceId - ID of the capture source (screen or window)
     */
    start: (sourceId: string): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SESSION_START, sourceId);
    },

    /**
     * Stop the current recording session
     */
    stop: (): Promise<{ success: boolean; session?: SessionPayload; error?: string }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SESSION_STOP);
    },

    /**
     * Cancel the current session without saving
     */
    cancel: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SESSION_CANCEL);
    },

    /**
     * Get current session status
     */
    getStatus: (): Promise<SessionStatusPayload> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET_STATUS);
    },

    /**
     * Get current session data
     */
    getCurrent: (): Promise<SessionPayload | null> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET_CURRENT);
    },

    /**
     * Subscribe to session state changes
     */
    onStateChange: createEventSubscriber<{
      state: SessionState;
      session: SessionPayload | null;
    }>(IPC_CHANNELS.SESSION_STATE_CHANGED),

    /**
     * Subscribe to session status updates (periodic updates during recording)
     */
    onStatusUpdate: createEventSubscriber<SessionStatusPayload>(IPC_CHANNELS.SESSION_STATUS),

    /**
     * Subscribe to session completion
     */
    onComplete: createEventSubscriber<SessionPayload>(IPC_CHANNELS.SESSION_COMPLETE),

    /**
     * Subscribe to new feedback items
     */
    onFeedbackItem: createEventSubscriber<FeedbackItemPayload>(IPC_CHANNELS.SESSION_FEEDBACK_ITEM),

    /**
     * Subscribe to voice activity changes
     */
    onVoiceActivity: createEventSubscriber<{ active: boolean }>(IPC_CHANNELS.SESSION_VOICE_ACTIVITY),

    /**
     * Subscribe to session errors
     */
    onError: createEventSubscriber<{ message: string }>(IPC_CHANNELS.SESSION_ERROR),
  },

  // ===========================================================================
  // Capture API
  // ===========================================================================
  capture: {
    /**
     * Get available capture sources (screens and windows)
     */
    getSources: (): Promise<CaptureSource[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_GET_SOURCES);
    },

    /**
     * Trigger a manual screenshot during recording
     */
    manualScreenshot: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_MANUAL_SCREENSHOT);
    },

    /**
     * Subscribe to screenshot captured events
     */
    onScreenshot: createEventSubscriber<ScreenshotCapturedPayload>(IPC_CHANNELS.SCREENSHOT_CAPTURED),

    /**
     * Subscribe to manual screenshot trigger events (from hotkey)
     */
    onManualTrigger: createEventSubscriber<{ timestamp: number }>(IPC_CHANNELS.MANUAL_SCREENSHOT),
  },

  // ===========================================================================
  // Audio API
  // ===========================================================================
  audio: {
    /**
     * Get available audio input devices
     * Note: Device enumeration happens in renderer via Web Audio API
     */
    getDevices: (): Promise<AudioDevice[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.AUDIO_GET_DEVICES);
    },

    /**
     * Set the preferred audio input device
     */
    setDevice: (deviceId: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.AUDIO_SET_DEVICE, deviceId);
    },

    /**
     * Subscribe to audio level updates (for visualization)
     */
    onLevel: createEventSubscriber<number>(IPC_CHANNELS.AUDIO_LEVEL),

    /**
     * Subscribe to voice activity detection updates
     */
    onVoiceActivity: createEventSubscriber<boolean>(IPC_CHANNELS.AUDIO_VOICE_ACTIVITY),

    // -------------------------------------------------------------------------
    // Audio Capture Bridge (Renderer -> Main communication)
    // These are used by the AudioCaptureRenderer to communicate with AudioCapture in main
    // -------------------------------------------------------------------------

    /**
     * Respond to device enumeration request from main
     */
    onRequestDevices: (callback: () => void): Unsubscribe => {
      const handler = () => callback();
      ipcRenderer.on(IPC_CHANNELS.AUDIO_REQUEST_DEVICES, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUDIO_REQUEST_DEVICES, handler);
    },

    /**
     * Send device list back to main
     */
    sendDevices: (devices: AudioDevice[]): void => {
      ipcRenderer.send(IPC_CHANNELS.AUDIO_DEVICES_RESPONSE, devices);
    },

    /**
     * Handle start capture command from main
     */
    onStartCapture: (
      callback: (config: {
        deviceId: string | null;
        sampleRate: number;
        channels: number;
        chunkDurationMs: number;
      }) => void
    ): Unsubscribe => {
      const handler = (
        _: Electron.IpcRendererEvent,
        config: {
          deviceId: string | null;
          sampleRate: number;
          channels: number;
          chunkDurationMs: number;
        }
      ) => callback(config);
      ipcRenderer.on(IPC_CHANNELS.AUDIO_START_CAPTURE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUDIO_START_CAPTURE, handler);
    },

    /**
     * Handle stop capture command from main
     */
    onStopCapture: (callback: () => void): Unsubscribe => {
      const handler = () => callback();
      ipcRenderer.on(IPC_CHANNELS.AUDIO_STOP_CAPTURE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUDIO_STOP_CAPTURE, handler);
    },

    /**
     * Handle device change command from main
     */
    onSetDevice: (callback: (deviceId: string) => void): Unsubscribe => {
      const handler = (_: Electron.IpcRendererEvent, deviceId: string) => callback(deviceId);
      ipcRenderer.on(IPC_CHANNELS.AUDIO_SET_DEVICE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUDIO_SET_DEVICE, handler);
    },

    /**
     * Send audio chunk to main for transcription
     */
    sendAudioChunk: (data: { samples: number[]; timestamp: number; duration: number }): void => {
      ipcRenderer.send(IPC_CHANNELS.AUDIO_CHUNK, data);
    },

    /**
     * Notify main that capture started
     */
    notifyCaptureStarted: (): void => {
      ipcRenderer.send(IPC_CHANNELS.AUDIO_CAPTURE_STARTED);
    },

    /**
     * Notify main that capture stopped
     */
    notifyCaptureStopped: (): void => {
      ipcRenderer.send(IPC_CHANNELS.AUDIO_CAPTURE_STOPPED);
    },

    /**
     * Send capture error to main
     */
    sendCaptureError: (error: string): void => {
      ipcRenderer.send(IPC_CHANNELS.AUDIO_CAPTURE_ERROR, error);
    },
  },

  // ===========================================================================
  // Transcription API
  // ===========================================================================
  transcript: {
    /**
     * Subscribe to transcription chunks (interim and final)
     */
    onChunk: createEventSubscriber<TranscriptChunkPayload>(IPC_CHANNELS.TRANSCRIPTION_UPDATE),

    /**
     * Subscribe to final transcription results
     */
    onFinal: createEventSubscriber<{
      text: string;
      confidence: number;
      timestamp: number;
    }>(IPC_CHANNELS.TRANSCRIPTION_FINAL),
  },

  // ===========================================================================
  // Settings API
  // ===========================================================================
  settings: {
    /**
     * Get a specific setting
     */
    get: <K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, key);
    },

    /**
     * Get all settings
     */
    getAll: (): Promise<AppSettings> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL);
    },

    /**
     * Set a specific setting
     */
    set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<AppSettings> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, key, value);
    },

    /**
     * Get an API key from secure storage
     */
    getApiKey: (service: string): Promise<string | null> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_API_KEY, service);
    },

    /**
     * Set an API key in secure storage
     */
    setApiKey: (service: string, key: string): Promise<boolean> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET_API_KEY, service, key);
    },
  },

  // ===========================================================================
  // Hotkey API
  // ===========================================================================
  hotkeys: {
    /**
     * Get current hotkey configuration
     */
    getConfig: (): Promise<HotkeyConfig> => {
      return ipcRenderer.invoke(IPC_CHANNELS.HOTKEY_CONFIG);
    },

    /**
     * Update hotkey configuration
     */
    updateConfig: (
      config: Partial<HotkeyConfig>
    ): Promise<{ config: HotkeyConfig; results: unknown[] }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.HOTKEY_UPDATE, config);
    },

    /**
     * Subscribe to hotkey triggered events
     */
    onTriggered: createEventSubscriber<{ action: string; accelerator: string }>(
      IPC_CHANNELS.HOTKEY_TRIGGERED
    ),
  },

  // ===========================================================================
  // Permissions API
  // ===========================================================================
  permissions: {
    /**
     * Check if a permission is granted
     */
    check: (type: PermissionType): Promise<boolean> => {
      return ipcRenderer.invoke(IPC_CHANNELS.PERMISSIONS_CHECK, type);
    },

    /**
     * Request a permission
     */
    request: (type: PermissionType): Promise<boolean> => {
      return ipcRenderer.invoke(IPC_CHANNELS.PERMISSIONS_REQUEST, type);
    },

    /**
     * Get all permission statuses
     */
    getAll: (): Promise<PermissionStatus> => {
      return ipcRenderer.invoke(IPC_CHANNELS.PERMISSIONS_GET_ALL);
    },
  },

  // ===========================================================================
  // Output API
  // ===========================================================================
  output: {
    /**
     * Save the current session to disk
     */
    save: (session?: SessionPayload): Promise<SaveResult> => {
      return ipcRenderer.invoke(IPC_CHANNELS.OUTPUT_SAVE, session);
    },

    /**
     * Copy session summary to clipboard
     */
    copyClipboard: (): Promise<boolean> => {
      return ipcRenderer.invoke(IPC_CHANNELS.OUTPUT_COPY_CLIPBOARD);
    },

    /**
     * Open the session output folder in file explorer
     */
    openFolder: (sessionDir?: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.OUTPUT_OPEN_FOLDER, sessionDir);
    },

    /**
     * Subscribe to output ready events
     */
    onReady: createEventSubscriber<{ markdown: string; sessionId: string; path: string }>(
      IPC_CHANNELS.OUTPUT_READY
    ),

    /**
     * Subscribe to output error events
     */
    onError: createEventSubscriber<{ message: string }>(IPC_CHANNELS.OUTPUT_ERROR),

    // -------------------------------------------------------------------------
    // Session History Browser API
    // -------------------------------------------------------------------------

    /**
     * List all saved sessions
     */
    listSessions: (): Promise<Array<{
      id: string;
      startTime: number;
      endTime: number;
      itemCount: number;
      screenshotCount: number;
      sourceName: string;
      firstThumbnail?: string;
      folder: string;
      transcriptionPreview?: string;
    }>> => {
      return ipcRenderer.invoke(IPC_CHANNELS.OUTPUT_LIST_SESSIONS);
    },

    /**
     * Get metadata for a specific session
     */
    getSessionMetadata: (sessionId: string): Promise<{
      id: string;
      startTime: number;
      endTime: number;
      itemCount: number;
      screenshotCount: number;
      sourceName: string;
      firstThumbnail?: string;
      folder: string;
      transcriptionPreview?: string;
    } | null> => {
      return ipcRenderer.invoke(IPC_CHANNELS.OUTPUT_GET_SESSION_METADATA, sessionId);
    },

    /**
     * Delete a single session
     */
    deleteSession: (sessionId: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.OUTPUT_DELETE_SESSION, sessionId);
    },

    /**
     * Delete multiple sessions
     */
    deleteSessions: (sessionIds: string[]): Promise<{ success: boolean; deleted: string[]; failed: string[] }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.OUTPUT_DELETE_SESSIONS, sessionIds);
    },

    /**
     * Export a single session
     */
    exportSession: (
      sessionId: string,
      format: 'markdown' | 'json' | 'pdf' = 'markdown'
    ): Promise<{ success: boolean; path?: string; error?: string }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.OUTPUT_EXPORT_SESSION, sessionId, format);
    },

    /**
     * Export multiple sessions
     */
    exportSessions: (
      sessionIds: string[],
      format: 'markdown' | 'json' | 'pdf' = 'markdown'
    ): Promise<{ success: boolean; path?: string; error?: string }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.OUTPUT_EXPORT_SESSIONS, sessionIds, format);
    },
  },

  // ===========================================================================
  // Crash Recovery API
  // ===========================================================================
  crashRecovery: {
    /**
     * Check for incomplete sessions from crashes
     */
    check: (): Promise<{
      hasIncomplete: boolean;
      session: {
        id: string;
        startTime: number;
        lastSaveTime: number;
        feedbackItems: Array<{
          id: string;
          timestamp: number;
          text: string;
          confidence: number;
          hasScreenshot: boolean;
          screenshotId?: string;
        }>;
        sourceName: string;
        screenshotCount: number;
        metadata?: {
          appVersion: string;
          platform: string;
          sessionDurationMs: number;
        };
      } | null;
    }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CRASH_RECOVERY_CHECK);
    },

    /**
     * Recover an incomplete session
     */
    recover: (
      sessionId: string
    ): Promise<{
      success: boolean;
      session?: {
        id: string;
        feedbackItems: Array<{
          id: string;
          timestamp: number;
          text: string;
          confidence: number;
          hasScreenshot: boolean;
        }>;
      };
      error?: string;
    }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CRASH_RECOVERY_RECOVER, sessionId);
    },

    /**
     * Discard an incomplete session
     */
    discard: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CRASH_RECOVERY_DISCARD);
    },

    /**
     * Get recent crash logs for debugging
     */
    getLogs: (
      limit?: number
    ): Promise<
      Array<{
        timestamp: string;
        error: { name: string; message: string; stack?: string };
        appVersion: string;
        platform: string;
        sessionId?: string;
      }>
    > => {
      return ipcRenderer.invoke(IPC_CHANNELS.CRASH_RECOVERY_GET_LOGS, limit);
    },

    /**
     * Clear crash logs
     */
    clearLogs: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CRASH_RECOVERY_CLEAR_LOGS);
    },

    /**
     * Update crash recovery settings
     */
    updateSettings: (settings: {
      enableAutoSave?: boolean;
      autoSaveIntervalMs?: number;
      enableCrashReporting?: boolean;
      maxCrashLogs?: number;
    }): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CRASH_RECOVERY_UPDATE_SETTINGS, settings);
    },

    /**
     * Subscribe to incomplete session found events (on startup)
     */
    onIncompleteFound: createEventSubscriber<{
      session: {
        id: string;
        startTime: number;
        lastSaveTime: number;
        feedbackItems: Array<{
          id: string;
          timestamp: number;
          text: string;
          confidence: number;
          hasScreenshot: boolean;
        }>;
        sourceName: string;
        screenshotCount: number;
      };
    }>(IPC_CHANNELS.CRASH_RECOVERY_FOUND),
  },

  // ===========================================================================
  // Updates API
  // ===========================================================================
  updates: {
    /**
     * Check for available updates
     */
    check: (): Promise<unknown> => {
      return ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK);
    },

    /**
     * Download the available update
     */
    download: (): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD);
    },

    /**
     * Install the downloaded update (quits and restarts app)
     */
    install: (): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL);
    },

    /**
     * Subscribe to update status changes
     */
    onStatus: (callback: (status: UpdateStatusPayload) => void): Unsubscribe => {
      const handler = (_: Electron.IpcRendererEvent, status: UpdateStatusPayload) => callback(status);
      ipcRenderer.on(IPC_CHANNELS.UPDATE_STATUS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_STATUS, handler);
    },
  },

  // ===========================================================================
  // Legacy API (for backwards compatibility)
  // ===========================================================================
  startSession: (): Promise<{ success: boolean; sessionId?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.START_SESSION);
  },

  stopSession: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.STOP_SESSION);
  },

  getSettings: (): Promise<AppSettings> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS);
  },

  setSettings: (settings: Partial<AppSettings>): Promise<AppSettings> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_SETTINGS, settings);
  },

  copyToClipboard: (text: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.COPY_TO_CLIPBOARD, text);
  },

  // Window controls
  window: {
    minimize: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE);
    },
    hide: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_HIDE);
    },
    close: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE);
    },
  },

  onSessionStatus: (
    callback: (status: { action: string; status?: SessionStatusPayload }) => void
  ): Unsubscribe => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { action: string; status?: SessionStatusPayload }
    ) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.SESSION_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SESSION_STATUS, handler);
  },

  onTranscriptionUpdate: (callback: (data: { text: string; isFinal: boolean }) => void): Unsubscribe => {
    const handler = (_: Electron.IpcRendererEvent, data: { text: string; isFinal: boolean }) =>
      callback(data);
    ipcRenderer.on(IPC_CHANNELS.TRANSCRIPTION_UPDATE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TRANSCRIPTION_UPDATE, handler);
  },

  onScreenshotCaptured: (callback: (data: { id: string; timestamp: number }) => void): Unsubscribe => {
    const handler = (_: Electron.IpcRendererEvent, data: { id: string; timestamp: number }) =>
      callback(data);
    ipcRenderer.on(IPC_CHANNELS.SCREENSHOT_CAPTURED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SCREENSHOT_CAPTURED, handler);
  },

  onOutputReady: (callback: (data: { markdown: string; sessionId: string }) => void): Unsubscribe => {
    const handler = (_: Electron.IpcRendererEvent, data: { markdown: string; sessionId: string }) =>
      callback(data);
    ipcRenderer.on(IPC_CHANNELS.OUTPUT_READY, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.OUTPUT_READY, handler);
  },

  onOutputError: (callback: (error: { message: string }) => void): Unsubscribe => {
    const handler = (_: Electron.IpcRendererEvent, error: { message: string }) => callback(error);
    ipcRenderer.on(IPC_CHANNELS.OUTPUT_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.OUTPUT_ERROR, handler);
  },
};

// =============================================================================
// Expose API to Renderer
// =============================================================================

contextBridge.exposeInMainWorld('feedbackflow', feedbackflow);

// =============================================================================
// Type Exports
// =============================================================================

export type FeedbackFlowAPI = typeof feedbackflow;

declare global {
  interface Window {
    feedbackflow: FeedbackFlowAPI;
  }
}
