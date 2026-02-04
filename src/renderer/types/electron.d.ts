/**
 * FeedbackFlow - Electron Type Declarations for Renderer
 *
 * This file provides TypeScript type support for the window.feedbackflow API
 * exposed by the preload script via contextBridge.
 */

import type {
  AppSettings,
  CaptureSource,
  AudioDevice,
  PermissionType,
  PermissionStatus,
  SessionStatusPayload,
  SessionPayload,
  FeedbackItemPayload,
  TranscriptChunkPayload,
  ScreenshotCapturedPayload,
  SaveResult,
  HotkeyConfig,
  SessionState,
} from '../../shared/types';

type Unsubscribe = () => void;

/**
 * Session API
 */
interface SessionAPI {
  start: (sourceId: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>;
  stop: () => Promise<{ success: boolean; session?: SessionPayload; error?: string }>;
  cancel: () => Promise<{ success: boolean }>;
  getStatus: () => Promise<SessionStatusPayload>;
  getCurrent: () => Promise<SessionPayload | null>;
  onStateChange: (callback: (data: { state: SessionState; session: SessionPayload | null }) => void) => Unsubscribe;
  onStatusUpdate: (callback: (data: SessionStatusPayload) => void) => Unsubscribe;
  onComplete: (callback: (data: SessionPayload) => void) => Unsubscribe;
  onFeedbackItem: (callback: (data: FeedbackItemPayload) => void) => Unsubscribe;
  onVoiceActivity: (callback: (data: { active: boolean }) => void) => Unsubscribe;
  onError: (callback: (data: { message: string }) => void) => Unsubscribe;
}

/**
 * Capture API
 */
interface CaptureAPI {
  getSources: () => Promise<CaptureSource[]>;
  manualScreenshot: () => Promise<{ success: boolean }>;
  onScreenshot: (callback: (data: ScreenshotCapturedPayload) => void) => Unsubscribe;
  onManualTrigger: (callback: (data: { timestamp: number }) => void) => Unsubscribe;
}

/**
 * Audio API
 */
interface AudioAPI {
  getDevices: () => Promise<AudioDevice[]>;
  setDevice: (deviceId: string) => Promise<{ success: boolean }>;
  onLevel: (callback: (level: number) => void) => Unsubscribe;
  onVoiceActivity: (callback: (active: boolean) => void) => Unsubscribe;

  // Audio capture bridge
  onRequestDevices: (callback: () => void) => Unsubscribe;
  sendDevices: (devices: AudioDevice[]) => void;
  onStartCapture: (callback: (config: {
    deviceId: string | null;
    sampleRate: number;
    channels: number;
    chunkDurationMs: number;
  }) => void) => Unsubscribe;
  onStopCapture: (callback: () => void) => Unsubscribe;
  onSetDevice: (callback: (deviceId: string) => void) => Unsubscribe;
  sendAudioChunk: (data: { samples: number[]; timestamp: number; duration: number }) => void;
  notifyCaptureStarted: () => void;
  notifyCaptureStopped: () => void;
  sendCaptureError: (error: string) => void;
}

/**
 * Transcript API
 */
interface TranscriptAPI {
  onChunk: (callback: (data: TranscriptChunkPayload) => void) => Unsubscribe;
  onFinal: (callback: (data: { text: string; confidence: number; timestamp: number }) => void) => Unsubscribe;
}

/**
 * Settings API
 */
interface SettingsAPI {
  get: <K extends keyof AppSettings>(key: K) => Promise<AppSettings[K]>;
  getAll: () => Promise<AppSettings>;
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<AppSettings>;
  getApiKey: (service: string) => Promise<string | null>;
  setApiKey: (service: string, key: string) => Promise<boolean>;
  hasApiKey: (service: string) => Promise<boolean>;
  selectDirectory: () => Promise<string | null>;
  clearAllData: () => Promise<void>;
  export: () => Promise<void>;
  import: () => Promise<AppSettings | null>;
}

/**
 * Hotkey API
 */
interface HotkeyAPI {
  getConfig: () => Promise<HotkeyConfig>;
  updateConfig: (config: Partial<HotkeyConfig>) => Promise<{ config: HotkeyConfig; results: unknown[] }>;
  update: (config: HotkeyConfig) => Promise<{ config: HotkeyConfig; results: unknown[] }>;
  onTriggered: (callback: (data: { action: string; accelerator: string }) => void) => Unsubscribe;
}

/**
 * Permissions API
 */
interface PermissionsAPI {
  check: (type: PermissionType) => Promise<boolean>;
  request: (type: PermissionType) => Promise<boolean>;
  getAll: () => Promise<PermissionStatus>;
}

/**
 * Session history metadata for display
 */
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

/**
 * Output API
 */
interface OutputAPI {
  save: (session?: SessionPayload) => Promise<SaveResult>;
  copyClipboard: () => Promise<boolean>;
  openFolder: (sessionDir?: string) => Promise<{ success: boolean; error?: string }>;
  onReady: (callback: (data: { markdown: string; sessionId: string; path: string }) => void) => Unsubscribe;
  onError: (callback: (data: { message: string }) => void) => Unsubscribe;

  // Session History Browser API
  listSessions: () => Promise<SessionHistoryItem[]>;
  getSessionMetadata: (sessionId: string) => Promise<SessionHistoryItem | null>;
  deleteSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
  deleteSessions: (sessionIds: string[]) => Promise<{ success: boolean; deleted: string[]; failed: string[] }>;
  exportSession: (sessionId: string, format?: 'markdown' | 'json' | 'pdf') => Promise<{ success: boolean; path?: string; error?: string }>;
  exportSessions: (sessionIds: string[], format?: 'markdown' | 'json' | 'pdf') => Promise<{ success: boolean; path?: string; error?: string }>;
}

/**
 * Complete FeedbackFlow API
 */
export interface FeedbackFlowAPI {
  // Domain APIs
  session: SessionAPI;
  capture: CaptureAPI;
  audio: AudioAPI;
  transcript: TranscriptAPI;
  settings: SettingsAPI;
  hotkeys: HotkeyAPI;
  permissions: PermissionsAPI;
  output: OutputAPI;

  // Legacy API (backwards compatibility)
  startSession: () => Promise<{ success: boolean; sessionId?: string }>;
  stopSession: () => Promise<{ success: boolean }>;
  getSettings: () => Promise<AppSettings>;
  setSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  copyToClipboard: (text: string) => Promise<{ success: boolean }>;
  onSessionStatus: (callback: (status: { action: string; status?: SessionStatusPayload }) => void) => Unsubscribe;
  onTranscriptionUpdate: (callback: (data: { text: string; isFinal: boolean }) => void) => Unsubscribe;
  onScreenshotCaptured: (callback: (data: { id: string; timestamp: number }) => void) => Unsubscribe;
  onOutputReady: (callback: (data: { markdown: string; sessionId: string }) => void) => Unsubscribe;
  onOutputError: (callback: (error: { message: string }) => void) => Unsubscribe;
}

declare global {
  interface Window {
    feedbackflow: FeedbackFlowAPI;
  }
}

export {};
