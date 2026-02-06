/**
 * Shared types for FeedbackFlow
 */

/**
 * Represents a single screenshot captured during a feedback session
 */
export interface Screenshot {
  id: string;
  timestamp: number;
  imagePath: string;
  base64?: string;
  width: number;
  height: number;
}

/**
 * Represents a transcription segment from voice narration
 */
export interface TranscriptionSegment {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  confidence: number;
  isFinal: boolean;
}

/**
 * Represents a complete feedback session
 */
export interface FeedbackSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  screenshots: Screenshot[];
  transcription: TranscriptionSegment[];
  status: SessionStatus;
}

/**
 * Session status enum (legacy, kept for compatibility)
 */
export type SessionStatus = 'idle' | 'recording' | 'processing' | 'complete' | 'error';

/**
 * Session state for bulletproof state machine.
 * Every state except 'idle' has a maximum timeout for automatic recovery.
 */
export type SessionState =
  | 'idle'       // Waiting for user action
  | 'starting'   // Initializing services (5s timeout)
  | 'recording'  // Active recording (30 min max)
  | 'stopping'   // Stopping services (3s timeout)
  | 'processing' // Processing results (10s timeout)
  | 'complete'   // Session finished (30s timeout then auto-idle)
  | 'error';     // Error occurred (5s timeout then auto-idle)

/**
 * Tray icon visual states
 */
export type TrayState = 'idle' | 'recording' | 'processing' | 'complete' | 'error';

/**
 * Hotkey configuration for the application
 */
export interface HotkeyConfig {
  toggleRecording: string;
  manualScreenshot: string;
}

/**
 * Default hotkey configuration
 */
export const DEFAULT_HOTKEY_CONFIG: HotkeyConfig = {
  toggleRecording: 'CommandOrControl+Shift+F',
  manualScreenshot: 'CommandOrControl+Shift+S',
};

/**
 * Application settings (v2 - expanded schema)
 *
 * Note: API keys are NOT stored in settings.
 * Use SettingsManager.getApiKey('deepgram') for secure storage via keytar.
 */
export interface AppSettings {
  // General
  outputDirectory: string;
  launchAtLogin: boolean;
  checkForUpdates: boolean;

  // Recording
  defaultCountdown: 0 | 3 | 5;
  showTranscriptionPreview: boolean;
  showAudioWaveform: boolean;

  // Capture
  pauseThreshold: number; // 500-3000ms
  minTimeBetweenCaptures: number; // 300-2000ms
  imageFormat: 'png' | 'jpeg';
  imageQuality: number; // 1-100 for jpeg
  maxImageWidth: number; // 800-2400

  // Transcription
  transcriptionService: 'deepgram';
  language: string;
  enableKeywordTriggers: boolean;

  // Hotkeys
  hotkeys: HotkeyConfig;

  // Appearance
  theme: 'dark' | 'light' | 'system';
  accentColor: string;

  // Audio
  audioDeviceId: string | null;

  // Advanced
  debugMode: boolean;
  keepAudioBackups: boolean;

  // Legacy fields (for migration compatibility)
  /** @deprecated Use SettingsManager.getApiKey('deepgram') for secure storage */
  deepgramApiKey?: string;
  /** @deprecated Use imageQuality instead */
  screenshotQuality?: number;
  /** @deprecated Use pauseThreshold instead */
  pauseThresholdMs?: number;
  /** @deprecated Clipboard is always available, no setting needed */
  autoClipboard?: boolean;
  /** @deprecated Output format is always markdown */
  outputFormat?: 'markdown' | 'json';
  /** @deprecated Use audioDeviceId instead */
  preferredAudioDevice?: string;
}

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: AppSettings = {
  // General
  outputDirectory: '', // Set dynamically by SettingsManager
  launchAtLogin: false,
  checkForUpdates: true,

  // Recording
  defaultCountdown: 3,
  showTranscriptionPreview: true,
  showAudioWaveform: true,

  // Capture
  pauseThreshold: 1500,
  minTimeBetweenCaptures: 500,
  imageFormat: 'png',
  imageQuality: 85,
  maxImageWidth: 1920,

  // Transcription
  transcriptionService: 'deepgram',
  language: 'en',
  enableKeywordTriggers: false,

  // Hotkeys
  hotkeys: { ...DEFAULT_HOTKEY_CONFIG },

  // Appearance
  theme: 'system',
  accentColor: '#3B82F6',

  // Audio
  audioDeviceId: null,

  // Advanced
  debugMode: false,
  keepAudioBackups: false,
};

// =============================================================================
// IPC Channel Definitions
// =============================================================================

/**
 * IPC channel names for main/renderer communication
 * Namespaced with 'feedbackflow:' prefix for clarity
 */
export const IPC_CHANNELS = {
  // ---------------------------------------------------------------------------
  // Session Channels (Renderer -> Main)
  // ---------------------------------------------------------------------------
  SESSION_START: 'feedbackflow:session:start',
  SESSION_STOP: 'feedbackflow:session:stop',
  SESSION_CANCEL: 'feedbackflow:session:cancel',
  SESSION_GET_STATUS: 'feedbackflow:session:get-status',
  SESSION_GET_CURRENT: 'feedbackflow:session:get-current',

  // ---------------------------------------------------------------------------
  // Session Channels (Main -> Renderer)
  // ---------------------------------------------------------------------------
  SESSION_STATE_CHANGED: 'feedbackflow:session:state-changed',
  SESSION_STATUS: 'feedbackflow:session:status-update',
  SESSION_COMPLETE: 'feedbackflow:session:complete',
  SESSION_FEEDBACK_ITEM: 'feedbackflow:session:feedback-item',
  SESSION_VOICE_ACTIVITY: 'feedbackflow:session:voice-activity',
  SESSION_ERROR: 'feedbackflow:session:error',

  // ---------------------------------------------------------------------------
  // Capture Channels (Renderer -> Main)
  // ---------------------------------------------------------------------------
  CAPTURE_GET_SOURCES: 'feedbackflow:capture:get-sources',
  CAPTURE_MANUAL_SCREENSHOT: 'feedbackflow:capture:manual-screenshot',
  SCREEN_RECORDING_START: 'feedbackflow:screen-recording:start',
  SCREEN_RECORDING_CHUNK: 'feedbackflow:screen-recording:chunk',
  SCREEN_RECORDING_STOP: 'feedbackflow:screen-recording:stop',

  // ---------------------------------------------------------------------------
  // Capture Channels (Main -> Renderer)
  // ---------------------------------------------------------------------------
  SCREENSHOT_CAPTURED: 'feedbackflow:capture:screenshot-taken',
  MANUAL_SCREENSHOT: 'feedbackflow:capture:manual-triggered',

  // ---------------------------------------------------------------------------
  // Display Channels (Main -> Renderer) - Multi-monitor support
  // ---------------------------------------------------------------------------
  DISPLAYS_CHANGED: 'feedbackflow:displays:changed',
  DISPLAY_DISCONNECTED: 'feedbackflow:display:disconnected',

  // ---------------------------------------------------------------------------
  // Audio Channels (Renderer -> Main)
  // ---------------------------------------------------------------------------
  AUDIO_GET_DEVICES: 'feedbackflow:audio:get-devices',
  AUDIO_SET_DEVICE: 'feedbackflow:audio:set-device',

  // ---------------------------------------------------------------------------
  // Audio Channels (Main -> Renderer) - Communication with audio capture
  // ---------------------------------------------------------------------------
  AUDIO_REQUEST_DEVICES: 'feedbackflow:audio:request-devices',
  AUDIO_START_CAPTURE: 'feedbackflow:audio:start-capture',
  AUDIO_STOP_CAPTURE: 'feedbackflow:audio:stop-capture',
  AUDIO_CHUNK: 'feedbackflow:audio:chunk',
  AUDIO_DEVICES_RESPONSE: 'feedbackflow:audio:devices-response',
  AUDIO_CAPTURE_ERROR: 'feedbackflow:audio:capture-error',
  AUDIO_CAPTURE_STARTED: 'feedbackflow:audio:capture-started',
  AUDIO_CAPTURE_STOPPED: 'feedbackflow:audio:capture-stopped',
  AUDIO_LEVEL: 'feedbackflow:audio:level',
  AUDIO_VOICE_ACTIVITY: 'feedbackflow:audio:voice-activity',

  // ---------------------------------------------------------------------------
  // Transcription Channels (Main -> Renderer)
  // ---------------------------------------------------------------------------
  TRANSCRIPTION_UPDATE: 'feedbackflow:transcript:chunk',
  TRANSCRIPTION_FINAL: 'feedbackflow:transcript:final',

  // ---------------------------------------------------------------------------
  // Transcription Control Channels (Renderer -> Main)
  // ---------------------------------------------------------------------------
  TRANSCRIPTION_GET_TIER_STATUSES: 'feedbackflow:transcription:get-tier-statuses',
  TRANSCRIPTION_GET_CURRENT_TIER: 'feedbackflow:transcription:get-current-tier',
  TRANSCRIPTION_SET_TIER: 'feedbackflow:transcription:set-tier',

  // ---------------------------------------------------------------------------
  // Settings Channels (Renderer -> Main)
  // ---------------------------------------------------------------------------
  SETTINGS_GET: 'feedbackflow:settings:get',
  SETTINGS_GET_ALL: 'feedbackflow:settings:get-all',
  SETTINGS_SET: 'feedbackflow:settings:set',
  SETTINGS_GET_API_KEY: 'feedbackflow:settings:get-api-key',
  SETTINGS_SET_API_KEY: 'feedbackflow:settings:set-api-key',
  SETTINGS_DELETE_API_KEY: 'feedbackflow:settings:delete-api-key',
  SETTINGS_HAS_API_KEY: 'feedbackflow:settings:has-api-key',
  SETTINGS_SELECT_DIRECTORY: 'feedbackflow:settings:select-directory',
  SETTINGS_CLEAR_ALL_DATA: 'feedbackflow:settings:clear-all-data',
  SETTINGS_EXPORT: 'feedbackflow:settings:export',
  SETTINGS_IMPORT: 'feedbackflow:settings:import',

  // ---------------------------------------------------------------------------
  // Permissions Channels (Renderer -> Main)
  // ---------------------------------------------------------------------------
  PERMISSIONS_CHECK: 'feedbackflow:permissions:check',
  PERMISSIONS_REQUEST: 'feedbackflow:permissions:request',
  PERMISSIONS_GET_ALL: 'feedbackflow:permissions:get-all',

  // ---------------------------------------------------------------------------
  // Output Channels (Renderer -> Main)
  // ---------------------------------------------------------------------------
  OUTPUT_SAVE: 'feedbackflow:output:save',
  OUTPUT_COPY_CLIPBOARD: 'feedbackflow:output:copy-clipboard',
  OUTPUT_OPEN_FOLDER: 'feedbackflow:output:open-folder',
  OUTPUT_EXPORT: 'feedbackflow:output:export',

  // Session History Browser
  OUTPUT_LIST_SESSIONS: 'feedbackflow:output:list-sessions',
  OUTPUT_GET_SESSION_METADATA: 'feedbackflow:output:get-session-metadata',
  OUTPUT_DELETE_SESSION: 'feedbackflow:output:delete-session',
  OUTPUT_DELETE_SESSIONS: 'feedbackflow:output:delete-sessions',
  OUTPUT_EXPORT_SESSION: 'feedbackflow:output:export-session',
  OUTPUT_EXPORT_SESSIONS: 'feedbackflow:output:export-sessions',

  // ---------------------------------------------------------------------------
  // Output Channels (Main -> Renderer)
  // ---------------------------------------------------------------------------
  OUTPUT_READY: 'feedbackflow:output:ready',
  OUTPUT_ERROR: 'feedbackflow:output:error',

  // ---------------------------------------------------------------------------
  // Hotkey Channels
  // ---------------------------------------------------------------------------
  HOTKEY_TRIGGERED: 'feedbackflow:hotkey:triggered',
  HOTKEY_CONFIG: 'feedbackflow:hotkey:config',
  HOTKEY_UPDATE: 'feedbackflow:hotkey:update',

  // ---------------------------------------------------------------------------
  // Clipboard (Legacy - kept for compatibility)
  // ---------------------------------------------------------------------------
  COPY_TO_CLIPBOARD: 'feedbackflow:clipboard:copy',

  // ---------------------------------------------------------------------------
  // Window Control Channels
  // ---------------------------------------------------------------------------
  WINDOW_MINIMIZE: 'feedbackflow:window:minimize',
  WINDOW_CLOSE: 'feedbackflow:window:close',
  WINDOW_HIDE: 'feedbackflow:window:hide',

  // ---------------------------------------------------------------------------
  // Update Channels (Renderer -> Main)
  // ---------------------------------------------------------------------------
  UPDATE_CHECK: 'feedbackflow:update:check',
  UPDATE_DOWNLOAD: 'feedbackflow:update:download',
  UPDATE_INSTALL: 'feedbackflow:update:install',

  // ---------------------------------------------------------------------------
  // Update Channels (Main -> Renderer)
  // ---------------------------------------------------------------------------
  UPDATE_STATUS: 'feedbackflow:update:status',

  // ---------------------------------------------------------------------------
  // Crash Recovery Channels (Renderer -> Main)
  // ---------------------------------------------------------------------------
  CRASH_RECOVERY_CHECK: 'feedbackflow:crash-recovery:check',
  CRASH_RECOVERY_RECOVER: 'feedbackflow:crash-recovery:recover',
  CRASH_RECOVERY_DISCARD: 'feedbackflow:crash-recovery:discard',
  CRASH_RECOVERY_GET_LOGS: 'feedbackflow:crash-recovery:get-logs',
  CRASH_RECOVERY_CLEAR_LOGS: 'feedbackflow:crash-recovery:clear-logs',
  CRASH_RECOVERY_UPDATE_SETTINGS: 'feedbackflow:crash-recovery:update-settings',

  // ---------------------------------------------------------------------------
  // Crash Recovery Channels (Main -> Renderer)
  // ---------------------------------------------------------------------------
  CRASH_RECOVERY_FOUND: 'feedbackflow:crash-recovery:found',

  // ---------------------------------------------------------------------------
  // Taskbar Channels (Renderer -> Main) - Windows-specific
  // ---------------------------------------------------------------------------
  TASKBAR_SET_PROGRESS: 'feedbackflow:taskbar:setProgress',
  TASKBAR_FLASH_FRAME: 'feedbackflow:taskbar:flashFrame',
  TASKBAR_SET_OVERLAY: 'feedbackflow:taskbar:setOverlay',

  // ---------------------------------------------------------------------------
  // Whisper Model Channels (Renderer -> Main)
  // ---------------------------------------------------------------------------
  WHISPER_CHECK_MODEL: 'feedbackflow:whisper:check-model',
  WHISPER_DOWNLOAD_MODEL: 'feedbackflow:whisper:download-model',
  WHISPER_CANCEL_DOWNLOAD: 'feedbackflow:whisper:cancel-download',
  WHISPER_GET_AVAILABLE_MODELS: 'feedbackflow:whisper:get-available-models',
  WHISPER_HAS_TRANSCRIPTION_CAPABILITY: 'feedbackflow:whisper:has-transcription-capability',

  // ---------------------------------------------------------------------------
  // Whisper Model Channels (Main -> Renderer)
  // ---------------------------------------------------------------------------
  WHISPER_DOWNLOAD_PROGRESS: 'feedbackflow:whisper:download-progress',
  WHISPER_DOWNLOAD_COMPLETE: 'feedbackflow:whisper:download-complete',
  WHISPER_DOWNLOAD_ERROR: 'feedbackflow:whisper:download-error',

  // ---------------------------------------------------------------------------
  // Legacy channels (backwards compatibility)
  // ---------------------------------------------------------------------------
  START_SESSION: 'session:start',
  STOP_SESSION: 'session:stop',
  GET_SETTINGS: 'settings:get',
  SET_SETTINGS: 'settings:set',
} as const;

/**
 * Type for IPC channel names
 */
export type IPCChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

// =============================================================================
// IPC Payload Types
// =============================================================================

/**
 * Session status update payload
 */
export interface SessionStatusPayload {
  state: SessionState;
  duration: number;
  feedbackCount: number;
  screenshotCount: number;
}

/**
 * Feedback item payload (without Buffer)
 */
export interface FeedbackItemPayload {
  id: string;
  timestamp: number;
  text: string;
  confidence: number;
  hasScreenshot: boolean;
  screenshotId?: string;
}

/**
 * Transcript chunk payload
 */
export interface TranscriptChunkPayload {
  text: string;
  timestamp: number;
  confidence: number;
  isFinal: boolean;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
}

/**
 * Screenshot captured payload
 */
export interface ScreenshotCapturedPayload {
  id: string;
  timestamp: number;
  count: number;
  width?: number;
  height?: number;
  trigger?: 'pause' | 'manual' | 'voice-command';
}

/**
 * Transcription tier identifiers used by UI and IPC.
 */
export type TranscriptionTier = 'auto' | 'deepgram' | 'whisper' | 'macos-dictation' | 'timer-only';

/**
 * Runtime availability status for a transcription tier.
 */
export interface TranscriptionTierStatus {
  tier: Exclude<TranscriptionTier, 'auto'>;
  available: boolean;
  reason?: string;
}

// =============================================================================
// Review Session Types (renderer-compatible mirrors of MarkdownGenerator types)
// =============================================================================

/**
 * Feedback category labels for the review UI
 */
export type ReviewFeedbackCategory = 'Bug' | 'UX Issue' | 'Suggestion' | 'Performance' | 'Question' | 'General';

/**
 * Feedback severity levels for the review UI
 */
export type ReviewFeedbackSeverity = 'Critical' | 'High' | 'Medium' | 'Low';

/**
 * A single feedback item in the review session (renderer-safe)
 */
export interface ReviewFeedbackItem {
  id: string;
  transcription: string;
  timestamp: number;
  screenshots: Screenshot[];
  title?: string;
  keywords?: string[];
  category?: ReviewFeedbackCategory;
  severity?: ReviewFeedbackSeverity;
}

/**
 * Review session metadata
 */
export interface ReviewSessionMetadata {
  os?: string;
  sourceName?: string;
  sourceType?: 'screen' | 'window';
}

/**
 * Complete review session for SessionReview component (renderer-safe)
 */
export interface ReviewSession {
  id: string;
  startTime: number;
  endTime?: number;
  feedbackItems: ReviewFeedbackItem[];
  metadata?: ReviewSessionMetadata;
}

/**
 * Output ready payload
 */
export interface OutputReadyPayload {
  markdown: string;
  sessionId: string;
  path: string;
  reportPath?: string;
  sessionDir?: string;
  recordingPath?: string;
  /** The full review session for SessionReview component */
  reviewSession?: ReviewSession;
}

/**
 * Whisper model download progress payload
 */
export interface WhisperDownloadProgressPayload {
  model: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  speedBps: number;
  estimatedSecondsRemaining: number;
}

/**
 * Whisper model info payload
 */
export interface WhisperModelInfoPayload {
  name: string;
  filename: string;
  sizeMB: number;
  ramRequired: string;
  quality: string;
  isDownloaded: boolean;
}

/**
 * Whisper model check result
 */
export interface WhisperModelCheckResult {
  hasAnyModel: boolean;
  defaultModel: string | null;
  downloadedModels: string[];
  recommendedModel: string;
  recommendedModelSizeMB: number;
}

/**
 * Permission types
 */
export type PermissionType = 'microphone' | 'screen' | 'accessibility';

/**
 * Permission status
 */
export interface PermissionStatus {
  microphone: boolean;
  screen: boolean;
  accessibility: boolean;
}

/**
 * Save result
 */
export interface SaveResult {
  success: boolean;
  path?: string;
  error?: string;
}

// =============================================================================
// Update Types
// =============================================================================

/**
 * Update status types for auto-updater
 */
export type UpdateStatusType =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'ready'
  | 'error';

/**
 * Update status payload from main process
 */
export interface UpdateStatusPayload {
  status: UpdateStatusType;
  version?: string;
  releaseNotes?: string | null;
  releaseDate?: string;
  percent?: number;
  bytesPerSecond?: number;
  total?: number;
  transferred?: number;
  message?: string;
}

// =============================================================================
// Audio Types
// =============================================================================

/**
 * Audio device representation
 */
export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

/**
 * Audio chunk for streaming to transcription
 */
export interface AudioChunk {
  buffer: Buffer;
  timestamp: number;
  duration: number;
  sampleRate: number;
}

/**
 * Audio capture configuration
 */
export interface AudioCaptureConfig {
  sampleRate: number;
  channels: number;
  chunkDurationMs: number;
  vadThreshold: number;
  vadSilenceMs: number;
  recoveryBufferMinutes: number;
}

/**
 * Default audio configuration (optimized for Deepgram)
 */
export const DEFAULT_AUDIO_CONFIG: AudioCaptureConfig = {
  sampleRate: 16000,
  channels: 1,
  chunkDurationMs: 100,
  vadThreshold: 0.01,
  vadSilenceMs: 300,
  recoveryBufferMinutes: 5,
};

// =============================================================================
// Capture Types
// =============================================================================

/**
 * Output document structure
 */
export interface OutputDocument {
  sessionId: string;
  generatedAt: number;
  markdown: string;
  screenshots: Screenshot[];
}

/**
 * Display information with layout positioning for multi-monitor support
 */
export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
  rotation: 0 | 90 | 180 | 270;
  internal: boolean;
}

/**
 * Capture source for window/screen selection
 */
export interface CaptureSource {
  id: string;
  name: string;
  type: 'screen' | 'window';
  thumbnail?: string;
  appIcon?: string;
  /** Display info for screen sources (multi-monitor support) */
  display?: DisplayInfo;
}

// =============================================================================
// Session Types (for IPC)
// =============================================================================

/**
 * Session metadata for IPC transport
 */
export interface SessionMetadata {
  sourceId: string;
  sourceName?: string;
  windowTitle?: string;
  appName?: string;
  recordingPath?: string;
  recordingMimeType?: string;
  recordingBytes?: number;
}

/**
 * Complete session for IPC (excludes Buffer data)
 */
export interface SessionPayload {
  id: string;
  startTime: number;
  endTime?: number;
  state: SessionState;
  sourceId: string;
  feedbackItems: FeedbackItemPayload[];
  metadata: SessionMetadata;
}
