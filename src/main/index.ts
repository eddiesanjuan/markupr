/**
 * markupr - Main Process Entry Point
 *
 * This is the orchestration heart of markupr. It:
 * - Initializes all services in the correct order
 * - Wires up the complete session lifecycle
 * - Manages IPC communication with renderer
 * - Handles hotkey registration and tray management
 * - Coordinates graceful shutdown
 *
 * Service Integration Order:
 * 1. Error handler (for crash recovery)
 * 2. Settings (needed for API keys and config)
 * 3. Secure settings + API key availability check
 * 4. Window creation
 * 5. Session controller initialization
 * 6. Transcription service configuration
 * 7. Tray manager initialization
 * 8. Hotkey registration
 * 9. IPC handler setup
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  screen,
  shell,
  Notification,
  dialog,
} from 'electron';
import * as fs from 'fs/promises';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';

// Hide dock icon on macOS for pure menu bar experience
// IMPORTANT: Must be called before app.whenReady()
if (process.platform === 'darwin') {
  app.dock.hide();
}

// Ensure runtime app identity uses the shipped product name.
app.setName('markupr');

// ESM compatibility - __dirname doesn't exist in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import {
  IPC_CHANNELS,
  DEFAULT_SETTINGS,
  type AppSettings,
  type HotkeyConfig,
  type CaptureSource,
  type AudioDevice,
  type PermissionType,
  type PermissionStatus,
  type SessionStatusPayload,
  type SessionPayload,
  type SaveResult,
  type TrayState,
  type ApiKeyValidationResult,
  type TranscriptionTier as UiTranscriptionTier,
  type TranscriptionTierStatus,
} from '../shared/types';
import { hotkeyManager, type HotkeyAction } from './HotkeyManager';
import { sessionController, type Session, type SessionState } from './SessionController';
import { trayManager } from './TrayManager';
import { audioCapture } from './audio/AudioCapture';
import { SettingsManager } from './settings';
import { fileManager, outputManager, clipboardService, generateDocumentForFileManager, adaptSessionForMarkdown } from './output';
import { processSession as aiProcessSession } from './ai';
import { modelDownloadManager } from './transcription/ModelDownloadManager';
import { tierManager } from './transcription/TierManager';
import type { WhisperModel } from './transcription/types';
import { errorHandler } from './ErrorHandler';
import { autoUpdaterManager } from './AutoUpdater';
import { crashRecovery, type RecoverableFeedbackItem } from './CrashRecovery';
import { postProcessor, type PostProcessResult, type PostProcessProgress } from './pipeline';
import { menuManager } from './MenuManager';
import { WindowsTaskbar, createWindowsTaskbar } from './platform';
import { PopoverManager, POPOVER_SIZES } from './windows';
import { permissionManager } from './PermissionManager';

// Guard against stdio EIO crashes when the parent terminal/PTY closes.
type ConsoleMethod = (...args: unknown[]) => void;

function wrapConsoleMethod(method: ConsoleMethod): ConsoleMethod {
  return (...args: unknown[]) => {
    try {
      method(...args);
    } catch (error) {
      if (error instanceof Error && error.message.includes('EIO')) {
        return;
      }
      throw error;
    }
  };
}

function isIgnorableStdioError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  if (typeof error === 'string') {
    return error.toUpperCase().includes('EIO');
  }

  if (error instanceof Error) {
    if (error.message.toUpperCase().includes('EIO')) {
      return true;
    }
    const withCode = error as Error & { code?: string };
    return withCode.code?.toUpperCase() === 'EIO';
  }

  if (typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.toUpperCase() === 'EIO') {
      return true;
    }
  }

  return false;
}

console.log = wrapConsoleMethod(console.log.bind(console));
console.info = wrapConsoleMethod(console.info.bind(console));
console.warn = wrapConsoleMethod(console.warn.bind(console));
console.error = wrapConsoleMethod(console.error.bind(console));

// =============================================================================
// Module State
// =============================================================================

let mainWindow: BrowserWindow | null = null;
let popover: PopoverManager | null = null;
let settingsManager: SettingsManager | null = null;
let isQuitting = false;
let hasCompletedOnboarding = false;
const rendererRecoveryAttempts = new WeakMap<BrowserWindow, number>();
let teardownAudioTelemetry: Array<() => void> = [];

// Windows taskbar integration (Windows only)
let windowsTaskbar: WindowsTaskbar | null = null;

interface RecordingArtifact {
  tempPath: string;
  mimeType: string;
  bytesWritten: number;
  writeChain: Promise<void>;
  startTime?: number;
}

const activeScreenRecordings = new Map<string, RecordingArtifact>();
const finalizedScreenRecordings = new Map<string, Omit<RecordingArtifact, 'writeChain'>>();
const DEV_RENDERER_URL = 'http://localhost:5173';
const DEV_RENDERER_LOAD_RETRIES = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attachRendererDiagnostics(window: BrowserWindow, label: string): void {
  window.on('unresponsive', () => {
    console.error(`[Main] ${label} window became unresponsive`);
  });

  window.on('responsive', () => {
    console.log(`[Main] ${label} window responsive again`);
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[Main] ${label} renderer process gone`, details);

    const attempts = rendererRecoveryAttempts.get(window) ?? 0;
    if (attempts >= 3) {
      console.error(`[Main] ${label} renderer recovery skipped after ${attempts} failed attempts`);
      return;
    }

    const nextAttempt = attempts + 1;
    rendererRecoveryAttempts.set(window, nextAttempt);

    const retryDelayMs = 300 * nextAttempt;
    setTimeout(() => {
      if (window.isDestroyed()) {
        return;
      }

      void loadRendererIntoWindow(window, `${label} (recovery #${nextAttempt})`)
        .then(() => {
          rendererRecoveryAttempts.set(window, 0);
          console.log(`[Main] ${label} renderer recovered on attempt ${nextAttempt}`);
        })
        .catch((error) => {
          console.error(`[Main] ${label} renderer recovery attempt ${nextAttempt} failed`, error);
        });
    }, retryDelayMs);
  });

  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }
      console.error(
        `[Main] ${label} failed to load renderer (${errorCode}): ${errorDescription} (${validatedURL})`,
      );
    },
  );
}

function wireAudioTelemetry(): void {
  teardownAudioTelemetry.forEach((teardown) => teardown());
  teardownAudioTelemetry = [];

  const sendAudioLevel = (level: number) => {
    mainWindow?.webContents.send(IPC_CHANNELS.AUDIO_LEVEL, level);
  };

  const sendVoiceActivity = (active: boolean) => {
    mainWindow?.webContents.send(IPC_CHANNELS.AUDIO_VOICE_ACTIVITY, active);
  };

  teardownAudioTelemetry.push(
    audioCapture.onAudioLevel(sendAudioLevel),
    audioCapture.onVoiceActivity(sendVoiceActivity),
  );
}

async function loadRendererIntoWindow(window: BrowserWindow, label: string): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    await window.loadFile(join(__dirname, '../renderer/index.html'));
    return;
  }

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= DEV_RENDERER_LOAD_RETRIES; attempt++) {
    try {
      await window.loadURL(DEV_RENDERER_URL);
      window.webContents.openDevTools({ mode: 'detach' });
      return;
    } catch (error) {
      lastError = error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(
        `[Main] ${label} renderer load attempt ${attempt}/${DEV_RENDERER_LOAD_RETRIES} failed: ${errorMessage}`,
      );
      await sleep(250 * attempt);
    }
  }

  const finalMessage =
    lastError instanceof Error ? lastError.message : 'Unknown renderer load failure';
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`
      <html>
        <body style="margin:0;padding:20px;background:#121212;color:#f5f5f5;font-family:-apple-system,system-ui,sans-serif;">
          <h2 style="margin:0 0 12px 0;">markupr failed to load</h2>
          <p style="margin:0 0 8px 0;">Dev renderer did not become reachable at ${DEV_RENDERER_URL}.</p>
          <p style="margin:0;color:#b3b3b3;">${finalMessage}</p>
        </body>
      </html>
    `)}`,
  );
}

// =============================================================================
// Window Management
// =============================================================================

function createWindow(): void {
  // Resolve preload path - works in both dev and production
  const preloadPath = join(app.getAppPath(), 'dist', 'preload', 'index.mjs');
  console.log('[Main] Preload path:', preloadPath);

  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    minWidth: 320,
    minHeight: 200,
    resizable: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false, // Don't show until ready
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Required for preload to work with contextBridge
    },
  });

  attachRendererDiagnostics(mainWindow, 'Main');
  void loadRendererIntoWindow(mainWindow, 'Main');

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    console.log('[Main] Window ready to show');

    // Check if onboarding needed
    if (!hasCompletedOnboarding) {
      mainWindow?.webContents.send('markupr:show-onboarding');
    }
  });

  // Handle window close - hide instead of quit on macOS
  mainWindow.on('close', (event) => {
    if (!isQuitting && process.platform === 'darwin') {
      event.preventDefault();
      mainWindow?.hide();
      return;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Set main window on session controller
  sessionController.setMainWindow(mainWindow);

  console.log('[Main] Window created');
}

/**
 * Show the main window (from tray or dock click)
 * In menu bar mode, shows the popover instead
 */
function showWindow(): void {
  // In menu bar mode, show the popover
  if (popover) {
    popover.show();
    return;
  }

  // Fallback for non-popover mode
  if (!mainWindow) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

// =============================================================================
// Session State Handling
// =============================================================================

/**
 * Map SessionController state to TrayManager state
 */
function mapToTrayState(state: SessionState): TrayState {
  switch (state) {
    case 'idle':
      return 'idle';
    case 'recording':
      return 'recording';
    case 'processing':
      return 'processing';
    case 'complete':
      return 'idle';
    default:
      return 'idle';
  }
}

/**
 * Handle session state changes - update tray, Windows taskbar, and notify renderer
 */
function handleSessionStateChange(state: SessionState, session: Session | null): void {
  console.log(`[Main] Session state changed: ${state}`);

  // Update tray icon
  trayManager.setState(mapToTrayState(state));
  if (state === 'recording' && sessionController.isSessionPaused()) {
    trayManager.setTooltip('markupr - Paused (Cmd+Shift+P to resume)');
  }

  const keepVisibleOnBlur =
    state === 'starting' ||
    state === 'recording' ||
    state === 'stopping' ||
    state === 'processing';
  popover?.setKeepVisibleOnBlur(keepVisibleOnBlur);

  // Update Windows taskbar (if on Windows)
  windowsTaskbar?.updateSessionState(state);

  // Notify renderer
  mainWindow?.webContents.send(IPC_CHANNELS.SESSION_STATE_CHANGED, {
    state,
    session: session ? serializeSession(session) : null,
  });

  // Also send status update
  mainWindow?.webContents.send(IPC_CHANNELS.SESSION_STATUS, sessionController.getStatus());
}

/**
 * Handle new feedback item
 */
function handleFeedbackItem(item: {
  id: string;
  timestamp: number;
  text: string;
  confidence: number;
}): void {
  mainWindow?.webContents.send(IPC_CHANNELS.SESSION_FEEDBACK_ITEM, {
    id: item.id,
    timestamp: item.timestamp,
    text: item.text,
    confidence: item.confidence,
    hasScreenshot: false,
  });

  // Update crash recovery with new feedback item
  const session = sessionController.getSession();
  if (session) {
    const recoverableFeedbackItems: RecoverableFeedbackItem[] = session.feedbackItems.map((fi) => ({
      id: fi.id,
      timestamp: fi.timestamp,
      text: fi.text,
      confidence: fi.confidence,
      hasScreenshot: false,
    }));

    crashRecovery.updateSession({
      feedbackItems: recoverableFeedbackItems,
      screenshotCount: 0,
    });
  }
}

/**
 * Handle session errors
 */
function handleSessionError(error: Error): void {
  console.error('[Main] Session error:', error);

  // Update tray to error state
  trayManager.setState('error');
  trayManager.setTooltip(`markupr - Error: ${error.message}`);

  // Notify renderer
  mainWindow?.webContents.send(IPC_CHANNELS.SESSION_ERROR, {
    message: error.message,
  });

  // Show notification
  showErrorNotification('Recording Error', error.message);
}

// =============================================================================
// Tray Handling
// =============================================================================

/**
 * Handle tray icon click - toggle popover for menu bar mode
 */
function handleTrayClick(): void {
  // In menu bar mode, tray click toggles the popover
  if (popover) {
    popover.toggle();
    return;
  }

  // Fallback for non-popover mode
  const currentState = sessionController.getState();

  if (currentState === 'idle') {
    // Show window to start a new session
    showWindow();
    mainWindow?.webContents.send('markupr:show-window-selector');
  } else if (currentState === 'recording') {
    // Stop recording
    stopSession();
  } else {
    // Just show the window
    showWindow();
  }
}

/**
 * Handle settings click from tray menu
 */
function handleSettingsClick(): void {
  showWindow();
  mainWindow?.webContents.send('markupr:show-settings');
}

/**
 * Handle menu bar actions from MenuManager
 */
function handleMenuAction(action: string, data?: unknown): void {
  console.log(`[Main] Menu action: ${action}`, data);

  switch (action) {
    case 'toggle-recording':
      handleToggleRecording();
      break;
    case 'show-settings':
      handleSettingsClick();
      break;
    case 'show-history':
      showWindow();
      mainWindow?.webContents.send('markupr:show-history');
      break;
    case 'show-export':
      showWindow();
      mainWindow?.webContents.send('markupr:show-export');
      break;
    case 'show-shortcuts':
      showWindow();
      mainWindow?.webContents.send('markupr:show-shortcuts');
      break;
    case 'check-updates':
      autoUpdaterManager.checkForUpdates();
      break;
    case 'open-session':
      showWindow();
      mainWindow?.webContents.send('markupr:open-session-dialog');
      break;
    case 'open-session-path':
      if (data && typeof data === 'object' && 'path' in data) {
        showWindow();
        mainWindow?.webContents.send('markupr:open-session', (data as { path: string }).path);
      }
      break;
    default:
      console.warn(`[Main] Unknown menu action: ${action}`);
  }
}

// =============================================================================
// Notifications
// =============================================================================

function showSuccessNotification(title: string, body: string): void {
  if (Notification.isSupported()) {
    const notification = new Notification({ title, body, silent: false });
    notification.show();
  }
}

function showErrorNotification(title: string, body: string): void {
  if (body.toUpperCase().includes('EIO')) {
    return;
  }

  if (Notification.isSupported()) {
    const notification = new Notification({ title, body, silent: false, urgency: 'critical' });
    notification.show();
  }
}

// =============================================================================
// Hotkey Management
// =============================================================================

function initializeHotkeys(): void {
  const results = hotkeyManager.initialize();

  for (const result of results) {
    if (result.success) {
      console.log(`[Main] Hotkey registered: ${result.action} -> ${result.accelerator}`);
      if (result.fallbackUsed) {
        console.log(`[Main] (Used fallback: ${result.fallbackUsed})`);
      }
    } else {
      console.error(`[Main] Failed to register hotkey for ${result.action}: ${result.error}`);
    }
  }

  hotkeyManager.onHotkey((action: HotkeyAction) => {
    handleHotkeyAction(action);
  });
}

function handleHotkeyAction(action: HotkeyAction): void {
  console.log(`[Main] Hotkey triggered: ${action}`);

  switch (action) {
    case 'toggleRecording':
      void handleToggleRecording();
      break;

    case 'manualScreenshot':
      void handleManualScreenshot();
      break;

    case 'pauseResume':
      void handlePauseResume();
      break;

    default:
      console.warn(`[Main] Unknown hotkey action: ${action}`);
  }
}

async function handleToggleRecording(): Promise<void> {
  const currentState = sessionController.getState();

  if (currentState === 'recording') {
    // Stop recording
    await stopSession();
  } else if (currentState === 'idle') {
    const result = await startSession();
    if (!result.success && result.error) {
      showErrorNotification('Unable to Start Recording', result.error);
    }
  }
}

async function handlePauseResume(): Promise<void> {
  if (sessionController.getState() !== 'recording') {
    return;
  }

  if (sessionController.isSessionPaused()) {
    resumeSession();
    return;
  }

  pauseSession();
}

async function handleManualScreenshot(): Promise<void> {
  // Manual screenshots are no longer captured during recording.
  // In the post-process architecture, frames are extracted from the
  // video recording after the session stops.
  console.log('[Main] Manual screenshot requested (no-op in post-process architecture)');
}

function pauseSession(): { success: boolean; error?: string } {
  if (sessionController.getState() !== 'recording') {
    return { success: false, error: 'No recording session is active.' };
  }

  const paused = sessionController.pause();
  if (!paused) {
    return { success: false, error: 'Session is already paused.' };
  }

  trayManager.setTooltip('markupr - Paused (Cmd+Shift+P to resume)');
  return { success: true };
}

function resumeSession(): { success: boolean; error?: string } {
  if (sessionController.getState() !== 'recording') {
    return { success: false, error: 'No recording session is active.' };
  }

  const resumed = sessionController.resume();
  if (!resumed) {
    return { success: false, error: 'Session is not paused.' };
  }

  trayManager.setTooltip('markupr - Recording... (Cmd+Shift+F to stop)');
  return { success: true };
}

// =============================================================================
// Session Control
// =============================================================================

/**
 * Resolve the default capture source for zero-friction recording start.
 * Prefers the primary display to match what users are actively looking at.
 */
async function resolveDefaultCaptureSource(): Promise<{ sourceId: string; sourceName: string }> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1, height: 1 },
  });

  if (!sources.length) {
    throw new Error('No screen capture source is available.');
  }

  const primaryDisplayId = String(screen.getPrimaryDisplay().id);
  const preferredSource = sources.find((source) => source.display_id === primaryDisplayId);
  const fallbackSource = sources.find((source) => source.id.startsWith('screen')) || sources[0];
  const selected = preferredSource || fallbackSource;

  return {
    sourceId: selected.id,
    sourceName: selected.name || 'Main Display',
  };
}

function extensionFromMimeType(mimeType?: string): string {
  const normalized = (mimeType || '').toLowerCase();
  if (normalized.includes('mp4')) {
    return '.mp4';
  }
  if (normalized.includes('quicktime') || normalized.includes('mov')) {
    return '.mov';
  }
  return '.webm';
}

async function finalizeScreenRecording(sessionId: string): Promise<{
  tempPath: string;
  mimeType: string;
  bytesWritten: number;
  startTime?: number;
} | null> {
  const active = activeScreenRecordings.get(sessionId);
  if (active) {
    try {
      await active.writeChain;
    } catch (error) {
      console.warn('[Main] Screen recording write chain failed during finalize:', error);
    }

    activeScreenRecordings.delete(sessionId);
    finalizedScreenRecordings.set(sessionId, {
      tempPath: active.tempPath,
      mimeType: active.mimeType,
      bytesWritten: active.bytesWritten,
      startTime: active.startTime,
    });
  }

  return finalizedScreenRecordings.get(sessionId) || null;
}

async function attachRecordingToSessionOutput(
  sessionId: string,
  sessionDir: string,
  markdownPath: string
): Promise<{ path: string; mimeType: string; bytesWritten: number; startTime?: number } | undefined> {
  const artifact = await finalizeScreenRecording(sessionId);
  if (!artifact || artifact.bytesWritten <= 0) {
    return undefined;
  }

  const extension = extname(artifact.tempPath) || extensionFromMimeType(artifact.mimeType);
  const finalPath = join(sessionDir, `session-recording${extension}`);

  try {
    await fs.copyFile(artifact.tempPath, finalPath);

    // Append recording link to the report for agent context replay.
    let markdown = await fs.readFile(markdownPath, 'utf-8');
    if (!markdown.includes('## Session Recording')) {
      markdown += `\n## Session Recording\n- [Open full recording](./${basename(finalPath)})\n`;
      await fs.writeFile(markdownPath, markdown, 'utf-8');
    }

    return {
      path: finalPath,
      mimeType: artifact.mimeType,
      bytesWritten: artifact.bytesWritten,
      startTime: artifact.startTime,
    };
  } catch (error) {
    console.warn('[Main] Failed to attach session recording to output:', error);
    return undefined;
  } finally {
    finalizedScreenRecordings.delete(sessionId);
    await fs.unlink(artifact.tempPath).catch(() => {
      // Best-effort cleanup for temp artifacts.
    });
  }
}

async function attachAudioToSessionOutput(
  sessionDir: string,
  markdownPath: string
): Promise<{ path: string; bytesWritten: number; durationMs: number; mimeType: string } | undefined> {
  const basePath = join(sessionDir, 'session-audio');

  try {
    const exported = await sessionController.exportCapturedAudio(basePath);
    if (!exported || exported.bytesWritten <= 0) {
      return undefined;
    }

    let markdown = await fs.readFile(markdownPath, 'utf-8');
    if (!markdown.includes('## Session Audio')) {
      markdown += `\n## Session Audio\n- [Open narration audio](./${basename(exported.path)})\n`;
      await fs.writeFile(markdownPath, markdown, 'utf-8');
    }

    return {
      path: exported.path,
      bytesWritten: exported.bytesWritten,
      durationMs: exported.durationMs,
      mimeType: exported.mimeType,
    };
  } catch (error) {
    console.warn('[Main] Failed to attach session audio to output:', error);
    return undefined;
  } finally {
    sessionController.clearCapturedAudio();
  }
}

/**
 * Start a recording session.
 */
async function startSession(sourceId?: string, sourceName?: string): Promise<{
  success: boolean;
  sessionId?: string;
  error?: string;
}> {
  try {
    const [hasMicrophonePermission, hasScreenPermission] = await Promise.all([
      checkPermission('microphone'),
      checkPermission('screen'),
    ]);

    if (!hasMicrophonePermission) {
      await requestPermission('microphone');
    }
    if (!hasScreenPermission) {
      await requestPermission('screen');
    }

    const [microphoneGranted, screenGranted] = await Promise.all([
      checkPermission('microphone'),
      checkPermission('screen'),
    ]);

    if (!microphoneGranted || !screenGranted) {
      return {
        success: false,
        error:
          'Microphone and screen recording permissions are required. Enable both in macOS System Settings, then retry.',
      };
    }

    let resolvedSourceId = sourceId;
    let resolvedSourceName = sourceName;

    if (!resolvedSourceId) {
      const defaultSource = await resolveDefaultCaptureSource();
      resolvedSourceId = defaultSource.sourceId;
      resolvedSourceName = defaultSource.sourceName;
    }

    // Start the session
    await sessionController.start(resolvedSourceId, resolvedSourceName);

    const session = sessionController.getSession();

    // Start crash recovery tracking
    if (session) {
      crashRecovery.startTracking({
        id: session.id,
        startTime: session.startTime,
        lastSaveTime: Date.now(),
        feedbackItems: [],
        transcriptionBuffer: '',
        sourceId: session.sourceId,
        sourceName: resolvedSourceName || 'Unknown Source',
        screenshotCount: 0,
        metadata: {
          appVersion: app.getVersion(),
          platform: process.platform,
          sessionDurationMs: 0,
        },
      });
    }

    // Show recording notification
    showSuccessNotification('Recording Started', 'Speak naturally. Pause, hotkey, or voice command will capture screenshots.');

    return {
      success: true,
      sessionId: session?.id,
    };
  } catch (error) {
    console.error('[Main] Failed to start session:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Stop the current recording session and generate output
 */
async function stopSession(): Promise<{
  success: boolean;
  session?: SessionPayload;
  reportPath?: string;
  error?: string;
}> {
  let stoppedSessionId: string | null = null;

  const cleanupRecordingArtifacts = async (sessionId: string): Promise<void> => {
    const artifact = await finalizeScreenRecording(sessionId).catch(() => null);
    if (!artifact?.tempPath) {
      finalizedScreenRecordings.delete(sessionId);
      return;
    }

    await fs.unlink(artifact.tempPath).catch(() => {
      // Best-effort cleanup of orphaned temp recordings.
    });
    finalizedScreenRecordings.delete(sessionId);
  };

  try {
    // Set Windows taskbar to processing state with indeterminate progress
    windowsTaskbar?.setProgress(-1);

    // Stop the session and get results
    const session = await sessionController.stop();

    // Stop crash recovery tracking
    crashRecovery.stopTracking();

    if (!session) {
      windowsTaskbar?.clearProgress();
      return {
        success: false,
        error: 'No active session to stop',
      };
    }
    stoppedSessionId = session.id;

    const recordingProbe = await finalizeScreenRecording(session.id).catch(() => null);
    const hasTranscript = session.transcriptBuffer.some((entry) => entry.text.trim().length > 0);
    const hasRecording = !!recordingProbe && recordingProbe.bytesWritten > 0;
    const recordingExtension = hasRecording
      ? extname(recordingProbe?.tempPath ?? '') || extensionFromMimeType(recordingProbe?.mimeType)
      : '.webm';
    const recordingFilename = `session-recording${recordingExtension}`;

    if (!hasTranscript && !hasRecording) {
      await cleanupRecordingArtifacts(session.id);
      sessionController.clearCapturedAudio();
      windowsTaskbar?.clearProgress();
      return {
        success: false,
        error:
          'No capture data was collected (no transcript or recording). Check microphone/screen capture access and retry.',
      };
    }

    // Update progress: generating document (33%)
    windowsTaskbar?.setProgress(0.33);

    // Generate output document — uses AI pipeline if an Anthropic key is configured,
    // otherwise falls back to the free-tier rule-based generator.
    const { document } = settingsManager
      ? await aiProcessSession(session, {
          settingsManager,
          projectName: session.metadata?.sourceName || 'Feedback Session',
          screenshotDir: './screenshots',
          hasRecording,
          recordingFilename,
        })
      : {
          document: generateDocumentForFileManager(session, {
            projectName: session.metadata?.sourceName || 'Feedback Session',
            screenshotDir: './screenshots',
          }),
        };

    // Update progress: saving to file system (66%)
    windowsTaskbar?.setProgress(0.66);

    // Save to file system
    const saveResult = await fileManager.saveSession(session, document);
    if (!saveResult.success) {
      await cleanupRecordingArtifacts(session.id);
      sessionController.clearCapturedAudio();
      windowsTaskbar?.clearProgress();
      return {
        success: false,
        error: saveResult.error || 'Unable to save session report.',
      };
    }

    const recordingArtifact = await attachRecordingToSessionOutput(
      session.id,
      saveResult.sessionDir,
      saveResult.markdownPath
    );

    const audioArtifact = await attachAudioToSessionOutput(
      saveResult.sessionDir,
      saveResult.markdownPath
    );

    if (recordingArtifact) {
      sessionController.setSessionMetadata({
        recordingPath: recordingArtifact.path,
        recordingMimeType: recordingArtifact.mimeType,
        recordingBytes: recordingArtifact.bytesWritten,
      });
    }
    if (audioArtifact) {
      sessionController.setSessionMetadata({
        audioPath: audioArtifact.path,
        audioBytes: audioArtifact.bytesWritten,
        audioDurationMs: audioArtifact.durationMs,
      });
    }

    // ------------------------------------------------------------------
    // Post-Processing Pipeline
    // ------------------------------------------------------------------
    // Run the post-processor if we have audio and/or video artifacts.
    // Progress and completion events are sent to the renderer via IPC.
    let postProcessResult: PostProcessResult | null = null;

    if (audioArtifact || recordingArtifact) {
      try {
        postProcessResult = await postProcessor.process({
          videoPath: recordingArtifact?.path ?? '',
          audioPath: audioArtifact?.path ?? '',
          sessionDir: saveResult.sessionDir,
          onProgress: (progress: PostProcessProgress) => {
            mainWindow?.webContents.send('markupr:processing:progress', {
              percent: progress.percent,
              step: progress.step,
            });
          },
        });

        // Notify renderer that post-processing is complete
        mainWindow?.webContents.send('markupr:processing:complete', postProcessResult);
      } catch (postProcessError) {
        console.warn('[Main] Post-processing pipeline failed, continuing with basic output:', postProcessError);
        // Non-fatal: we still have the basic markdown report from the AI/rule-based pipeline
      }
    }

    const markdownForPayload = await fs
      .readFile(saveResult.markdownPath, 'utf-8')
      .catch(() => document.content);

    // Update progress: copying to clipboard (90%)
    windowsTaskbar?.setProgress(0.9);

    // Copy markdown report path to clipboard (the bridge into AI agents)
    await clipboardService.copy(saveResult.markdownPath);

    // Complete progress and flash taskbar
    windowsTaskbar?.setProgress(1);
    windowsTaskbar?.flashFrame(3);

    // Clear progress after a brief delay
    setTimeout(() => {
      windowsTaskbar?.clearProgress();
    }, 1000);

    // Build the review session for the SessionReview component
    const reviewSession = adaptSessionForMarkdown(session);

    // Notify renderer
    mainWindow?.webContents.send(IPC_CHANNELS.SESSION_COMPLETE, serializeSession(session));
    mainWindow?.webContents.send(IPC_CHANNELS.OUTPUT_READY, {
      markdown: markdownForPayload,
      sessionId: session.id,
      path: saveResult.markdownPath,
      reportPath: saveResult.markdownPath,
      sessionDir: saveResult.sessionDir,
      recordingPath: recordingArtifact?.path,
      audioPath: audioArtifact?.path,
      audioDurationMs: audioArtifact?.durationMs,
      videoStartTime: recordingArtifact?.startTime,
      reviewSession,
    });

    // Show completion notification
    showSuccessNotification(
      'Feedback Captured!',
      `${session.feedbackItems.length} items saved. Report path copied to clipboard.`
    );

    return {
      success: true,
      session: serializeSession(session),
      reportPath: saveResult.markdownPath,
    };
  } catch (error) {
    if (stoppedSessionId) {
      await cleanupRecordingArtifacts(stoppedSessionId);
    }
    sessionController.clearCapturedAudio();
    console.error('[Main] Failed to stop session:', error);
    windowsTaskbar?.clearProgress();
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Cancel session without saving
 */
function cancelSession(): { success: boolean } {
  const currentSessionId = sessionController.getSession()?.id;
  sessionController.cancel();
  crashRecovery.stopTracking();

  if (currentSessionId) {
    void finalizeScreenRecording(currentSessionId).then(async (artifact) => {
      if (artifact?.tempPath) {
        await fs.unlink(artifact.tempPath).catch(() => {
          // Best-effort cleanup for canceled session recordings.
        });
      }
      finalizedScreenRecordings.delete(currentSessionId);
    });
  }

  return { success: true };
}

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

async function listSessionHistoryItems(): Promise<SessionHistoryItem[]> {
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

type ApiKeyProvider = 'openai' | 'anthropic';

async function validateProviderApiKey(
  service: ApiKeyProvider,
  key: string,
): Promise<ApiKeyValidationResult> {
  const trimmedKey = key.trim();

  if (trimmedKey.length < 10) {
    return {
      valid: false,
      error: 'Please enter a valid API key.',
    };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), 12000);

  const requestConfig = service === 'openai'
    ? {
        url: 'https://api.openai.com/v1/models?limit=1',
        headers: {
          Authorization: `Bearer ${trimmedKey}`,
          'Content-Type': 'application/json',
        } as Record<string, string>,
      }
    : {
        url: 'https://api.anthropic.com/v1/models?limit=1',
        headers: {
          'x-api-key': trimmedKey,
          'anthropic-version': '2023-06-01',
        } as Record<string, string>,
      };

  try {
    const response = await fetch(requestConfig.url, {
      method: 'GET',
      headers: requestConfig.headers,
      signal: controller.signal,
    });

    if (response.ok) {
      return { valid: true };
    }

    if (service === 'openai' && (response.status === 401 || response.status === 403)) {
      return {
        valid: false,
        status: response.status,
        error: 'Invalid OpenAI API key. Please check and try again.',
      };
    }

    if (service === 'anthropic' && (response.status === 401 || response.status === 403)) {
      return {
        valid: false,
        status: response.status,
        error: 'Invalid Anthropic API key. Please check and try again.',
      };
    }

    const providerLabel = service === 'openai' ? 'OpenAI' : 'Anthropic';
    return {
      valid: false,
      status: response.status,
      error: `${providerLabel} API error (${response.status}). Please try again.`,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        valid: false,
        error: 'Request timed out. Please check your connection and try again.',
      };
    }

    return {
      valid: false,
      error: 'Unable to reach API service. Check internet/VPN/firewall and try again.',
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// =============================================================================
// IPC Handlers Setup
// =============================================================================

function setupIPC(): void {
  // ---------------------------------------------------------------------------
  // Session Channels
  // ---------------------------------------------------------------------------

  // Start session with intelligent capture
  ipcMain.handle(IPC_CHANNELS.SESSION_START, async (_, sourceId?: string, sourceName?: string) => {
    console.log('[Main] Starting session');
    return startSession(sourceId, sourceName);
  });

  // Stop session with output generation
  ipcMain.handle(IPC_CHANNELS.SESSION_STOP, async () => {
    console.log('[Main] Stopping session');
    return stopSession();
  });

  // Pause active recording session
  ipcMain.handle(IPC_CHANNELS.SESSION_PAUSE, async () => {
    console.log('[Main] Pausing session');
    return pauseSession();
  });

  // Resume paused recording session
  ipcMain.handle(IPC_CHANNELS.SESSION_RESUME, async () => {
    console.log('[Main] Resuming session');
    return resumeSession();
  });

  // Cancel session without saving
  ipcMain.handle(IPC_CHANNELS.SESSION_CANCEL, async () => {
    console.log('[Main] Cancelling session');
    return cancelSession();
  });

  // Get session status
  ipcMain.handle(IPC_CHANNELS.SESSION_GET_STATUS, (): SessionStatusPayload => {
    const status = sessionController.getStatus();
    return {
      ...status,
      screenshotCount: 0, // Screenshots are now extracted in post-processing
    };
  });

  // Get current session
  ipcMain.handle(IPC_CHANNELS.SESSION_GET_CURRENT, (): SessionPayload | null => {
    const session = sessionController.getSession();
    return session ? serializeSession(session) : null;
  });

  // Legacy session handlers (for backwards compatibility)
  ipcMain.handle(IPC_CHANNELS.START_SESSION, async (_, sourceId?: string) => {
    return startSession(sourceId);
  });

  ipcMain.handle(IPC_CHANNELS.STOP_SESSION, async () => {
    return stopSession();
  });

  // ---------------------------------------------------------------------------
  // Capture Channels
  // ---------------------------------------------------------------------------

  // Get available capture sources (screens and windows)
  ipcMain.handle(IPC_CHANNELS.CAPTURE_GET_SOURCES, async (): Promise<CaptureSource[]> => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });

      return sources.map((source) => ({
        id: source.id,
        name: source.name,
        type: source.id.startsWith('screen') ? 'screen' : 'window',
        thumbnail: source.thumbnail.toDataURL(),
        appIcon: source.appIcon?.toDataURL(),
      }));
    } catch (error) {
      console.error('[Main] Failed to get capture sources:', error);
      return [];
    }
  });

  // Manual screenshot (no-op in post-process architecture; frames extracted from video)
  ipcMain.handle(IPC_CHANNELS.CAPTURE_MANUAL_SCREENSHOT, async () => {
    console.log('[Main] Manual screenshot IPC called (no-op in post-process architecture)');
    return { success: false };
  });

  // Start persisted screen recording for the active session
  ipcMain.handle(
    IPC_CHANNELS.SCREEN_RECORDING_START,
    async (_, sessionId: string, mimeType: string, startTime?: number): Promise<{ success: boolean; path?: string; error?: string }> => {
      try {
        const currentSession = sessionController.getSession();
        if (!currentSession || currentSession.id !== sessionId) {
          return { success: false, error: 'No matching active session for screen recording.' };
        }

        const extension = extensionFromMimeType(mimeType);
        const recordingsDir = join(app.getPath('temp'), 'markupr-recordings');
        await fs.mkdir(recordingsDir, { recursive: true });

        const tempPath = join(recordingsDir, `${sessionId}${extension}`);
        await fs.writeFile(tempPath, Buffer.alloc(0));

        activeScreenRecordings.set(sessionId, {
          tempPath,
          mimeType: mimeType || 'video/webm',
          bytesWritten: 0,
          writeChain: Promise.resolve(),
          startTime,
        });

        return { success: true, path: tempPath };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to initialize screen recording.',
        };
      }
    }
  );

  // Append screen recording chunk data
  ipcMain.handle(
    IPC_CHANNELS.SCREEN_RECORDING_CHUNK,
    async (
      _,
      sessionId: string,
      chunk: Uint8Array | ArrayBuffer
    ): Promise<{ success: boolean; error?: string }> => {
      const recording = activeScreenRecordings.get(sessionId);
      if (!recording) {
        return { success: false, error: 'No active recording writer for this session.' };
      }

      let buffer: Buffer;
      if (chunk instanceof ArrayBuffer) {
        buffer = Buffer.from(chunk);
      } else if (ArrayBuffer.isView(chunk)) {
        buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      } else {
        return { success: false, error: 'Unsupported recording chunk format.' };
      }

      recording.writeChain = recording.writeChain
        .then(() => fs.appendFile(recording.tempPath, buffer))
        .then(() => {
          recording.bytesWritten += buffer.byteLength;
        });

      try {
        await recording.writeChain;
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to append recording chunk.',
        };
      }
    }
  );

  // Finalize persisted screen recording
  ipcMain.handle(
    IPC_CHANNELS.SCREEN_RECORDING_STOP,
    async (
      _,
      sessionId: string
    ): Promise<{ success: boolean; path?: string; bytes?: number; mimeType?: string; error?: string }> => {
      try {
        const artifact = await finalizeScreenRecording(sessionId);
        if (!artifact) {
          return { success: true };
        }

        return {
          success: true,
          path: artifact.tempPath,
          bytes: artifact.bytesWritten,
          mimeType: artifact.mimeType,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to finalize screen recording.',
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Audio Channels
  // ---------------------------------------------------------------------------

  // Get audio devices - renderer handles this via Web Audio API
  ipcMain.handle(IPC_CHANNELS.AUDIO_GET_DEVICES, async (): Promise<AudioDevice[]> => {
    // Audio device enumeration happens in renderer via Web Audio API
    // This handler is for settings persistence
    return [];
  });

  // Set preferred audio device
  ipcMain.handle(IPC_CHANNELS.AUDIO_SET_DEVICE, async (_, deviceId: string) => {
    const settings = settingsManager?.getAll() || DEFAULT_SETTINGS;
    settingsManager?.update({ ...settings, preferredAudioDevice: deviceId });
    mainWindow?.webContents.send(IPC_CHANNELS.AUDIO_SET_DEVICE, deviceId);
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // Settings Channels
  // ---------------------------------------------------------------------------

  // Get specific setting
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_, key: keyof AppSettings) => {
    return settingsManager?.get(key) ?? DEFAULT_SETTINGS[key];
  });

  // Get all settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, (): AppSettings => {
    return settingsManager?.getAll() ?? { ...DEFAULT_SETTINGS };
  });

  // Set setting(s)
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET,
    (_, key: keyof AppSettings, value: unknown): AppSettings => {
      const updates = { [key]: value } as Partial<AppSettings>;
      return settingsManager?.update(updates) ?? { ...DEFAULT_SETTINGS, ...updates };
    }
  );

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SELECT_DIRECTORY, async (): Promise<string | null> => {
    const options: Electron.OpenDialogOptions = {
      title: 'Select Feedback Output Folder',
      buttonLabel: 'Use Folder',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const selected = result.filePaths[0];
    if (settingsManager) {
      settingsManager.update({ outputDirectory: selected });
    }

    return selected;
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_CLEAR_ALL_DATA, async (): Promise<void> => {
    if (!settingsManager) {
      return;
    }

    const outputDirectory = settingsManager.get('outputDirectory');
    await fs.rm(outputDirectory, { recursive: true, force: true }).catch(() => {
      // Ignore missing directories.
    });

    await settingsManager.deleteApiKey('openai').catch(() => {
      // Ignore missing keychain entries.
    });
    await settingsManager.deleteApiKey('anthropic').catch(() => {
      // Ignore missing keychain entries.
    });

    settingsManager.reset();
    crashRecovery.discardIncompleteSession();
    crashRecovery.clearCrashLogs();
    sessionController.reset();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_EXPORT, async (): Promise<void> => {
    if (!settingsManager) {
      return;
    }

    const options: Electron.SaveDialogOptions = {
      title: 'Export markupr Settings',
      defaultPath: join(app.getPath('documents'), 'markupr-settings.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);

    if (result.canceled || !result.filePath) {
      return;
    }

    const payload = JSON.stringify(settingsManager.getAll(), null, 2);
    await fs.writeFile(result.filePath, payload, 'utf-8');
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_IMPORT, async (): Promise<AppSettings | null> => {
    if (!settingsManager) {
      return null;
    }

    const options: Electron.OpenDialogOptions = {
      title: 'Import markupr Settings',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const raw = await fs.readFile(result.filePaths[0], 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid settings file format.');
    }

    const entries = Object.entries(parsed as Record<string, unknown>);
    const allowedKeys = new Set(Object.keys(DEFAULT_SETTINGS));
    const sanitized: Partial<AppSettings> = {};

    for (const [key, value] of entries) {
      if (!allowedKeys.has(key)) {
        continue;
      }
      (sanitized as Record<string, unknown>)[key] = value;
    }

    return settingsManager.update(sanitized);
  });

  // Legacy settings handlers
  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, () => {
    return settingsManager?.getAll() ?? { ...DEFAULT_SETTINGS };
  });

  ipcMain.handle(IPC_CHANNELS.SET_SETTINGS, (_, newSettings: Partial<AppSettings>) => {
    const settings = settingsManager?.update(newSettings) ?? {
      ...DEFAULT_SETTINGS,
      ...newSettings,
    };

    // Re-register hotkeys if changed
    if (newSettings.hotkeys) {
      const results = hotkeyManager.updateConfig(newSettings.hotkeys);
      console.log('[Main] Hotkeys updated:', results);
    }

    return settings;
  });

  // ---------------------------------------------------------------------------
  // API Key Channels (Secure Storage)
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_GET_API_KEY,
    async (_, service: string): Promise<string | null> => {
      if (!settingsManager) {
        return null;
      }
      return settingsManager.getApiKey(service);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET_API_KEY,
    async (_, service: string, key: string): Promise<boolean> => {
      if (!settingsManager) {
        return false;
      }

      await settingsManager.setApiKey(service, key);
      return true;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_DELETE_API_KEY,
    async (_, service: string): Promise<boolean> => {
      if (!settingsManager) {
        return false;
      }

      await settingsManager.deleteApiKey(service);
      return true;
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_HAS_API_KEY,
    async (_, service: string): Promise<boolean> => {
      if (!settingsManager) {
        return false;
      }

      return settingsManager.hasApiKey(service);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_TEST_API_KEY,
    async (_, service: ApiKeyProvider, key: string): Promise<ApiKeyValidationResult> => {
      if (service !== 'openai' && service !== 'anthropic') {
        return {
          valid: false,
          error: 'Unsupported API provider.',
        };
      }

      return validateProviderApiKey(service, key);
    }
  );

  // ---------------------------------------------------------------------------
  // Permissions Channels
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    IPC_CHANNELS.PERMISSIONS_CHECK,
    async (_, type: PermissionType): Promise<boolean> => {
      return checkPermission(type);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PERMISSIONS_REQUEST,
    async (_, type: PermissionType): Promise<boolean> => {
      return requestPermission(type);
    }
  );

  ipcMain.handle(IPC_CHANNELS.PERMISSIONS_GET_ALL, async (): Promise<PermissionStatus> => {
    return {
      microphone: await checkPermission('microphone'),
      screen: await checkPermission('screen'),
      accessibility: await checkPermission('accessibility'),
    };
  });

  // ---------------------------------------------------------------------------
  // Output Channels
  // ---------------------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.OUTPUT_SAVE, async (): Promise<SaveResult> => {
    try {
      const session = sessionController.getSession();
      if (!session) {
        return { success: false, error: 'No session to save' };
      }

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
        // TODO: For json/pdf formats, reconstruct Session from disk and use exportService.export()
        // For now, all formats fall through to folder export which includes pre-generated markdown
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
        // TODO: For json/pdf formats, reconstruct Sessions from disk and use exportService.export()
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

  // ---------------------------------------------------------------------------
  // App Version Handler
  // ---------------------------------------------------------------------------

  ipcMain.handle('markupr:app:version', () => {
    return app.getVersion();
  });

  // ---------------------------------------------------------------------------
  // Window Control Handlers
  // ---------------------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    mainWindow?.minimize();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_HIDE, () => {
    // In popover mode, hide the popover
    if (popover) {
      popover.hide();
    } else {
      mainWindow?.hide();
    }
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    mainWindow?.close();
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // Popover Control Handlers (Menu Bar Mode)
  // ---------------------------------------------------------------------------

  ipcMain.handle('markupr:popover:resize', (_, width: number, height: number) => {
    if (popover) {
      popover.resize(width, height);
      return { success: true };
    }
    return { success: false, error: 'Popover not initialized' };
  });

  ipcMain.handle('markupr:popover:resize-to-state', (_, state: string) => {
    if (popover && state in POPOVER_SIZES) {
      popover.resizeToState(state as keyof typeof POPOVER_SIZES);
      return { success: true };
    }
    return { success: false, error: 'Popover not initialized or invalid state' };
  });

  ipcMain.handle('markupr:popover:show', () => {
    popover?.show();
    return { success: true };
  });

  ipcMain.handle('markupr:popover:hide', () => {
    popover?.hide();
    return { success: true };
  });

  ipcMain.handle('markupr:popover:toggle', () => {
    popover?.toggle();
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // Hotkey Channels
  // ---------------------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.HOTKEY_CONFIG, (): HotkeyConfig => {
    return hotkeyManager.getConfig();
  });

  ipcMain.handle(
    IPC_CHANNELS.HOTKEY_UPDATE,
    (_, newConfig: Partial<HotkeyConfig>) => {
      const results = hotkeyManager.updateConfig(newConfig);
      settingsManager?.update({ hotkeys: hotkeyManager.getConfig() });
      return { config: hotkeyManager.getConfig(), results };
    }
  );

  // ---------------------------------------------------------------------------
  // Crash Recovery Channels
  // ---------------------------------------------------------------------------

  // Check for incomplete sessions
  ipcMain.handle(IPC_CHANNELS.CRASH_RECOVERY_CHECK, () => {
    const session = crashRecovery.getIncompleteSession();
    return {
      hasIncomplete: !!session,
      session: session,
    };
  });

  // Recover an incomplete session
  ipcMain.handle(IPC_CHANNELS.CRASH_RECOVERY_RECOVER, (_, sessionId: string) => {
    const session = crashRecovery.getIncompleteSession();
    if (!session || session.id !== sessionId) {
      return {
        success: false,
        error: 'Session not found or ID mismatch',
      };
    }

    // Clear the incomplete session from storage
    crashRecovery.discardIncompleteSession();

    // Return the session data for the renderer to display in review mode
    return {
      success: true,
      session: {
        id: session.id,
        feedbackItems: session.feedbackItems,
        startTime: session.startTime,
        sourceName: session.sourceName,
        screenshotCount: session.screenshotCount,
      },
    };
  });

  // Discard an incomplete session
  ipcMain.handle(IPC_CHANNELS.CRASH_RECOVERY_DISCARD, () => {
    crashRecovery.discardIncompleteSession();
    return { success: true };
  });

  // Get recent crash logs
  ipcMain.handle(IPC_CHANNELS.CRASH_RECOVERY_GET_LOGS, (_, limit?: number) => {
    return crashRecovery.getCrashLogs(limit);
  });

  // Clear crash logs
  ipcMain.handle(IPC_CHANNELS.CRASH_RECOVERY_CLEAR_LOGS, () => {
    crashRecovery.clearCrashLogs();
    return { success: true };
  });

  // Update crash recovery settings
  ipcMain.handle(
    IPC_CHANNELS.CRASH_RECOVERY_UPDATE_SETTINGS,
    (_, settings: Partial<{
      enableAutoSave: boolean;
      autoSaveIntervalMs: number;
      enableCrashReporting: boolean;
      maxCrashLogs: number;
    }>) => {
      crashRecovery.updateSettings(settings);
      return { success: true };
    }
  );

  // ---------------------------------------------------------------------------
  // Windows Taskbar Channels (Windows-specific)
  // ---------------------------------------------------------------------------

  // Set taskbar progress bar
  ipcMain.handle(
    IPC_CHANNELS.TASKBAR_SET_PROGRESS,
    (_, progress: number) => {
      windowsTaskbar?.setProgress(progress);
      return { success: true };
    }
  );

  // Flash taskbar frame
  ipcMain.handle(
    IPC_CHANNELS.TASKBAR_FLASH_FRAME,
    (_, count?: number) => {
      windowsTaskbar?.flashFrame(count);
      return { success: true };
    }
  );

  // Set taskbar overlay icon
  ipcMain.handle(
    IPC_CHANNELS.TASKBAR_SET_OVERLAY,
    (_, state: 'recording' | 'processing' | 'none') => {
      windowsTaskbar?.setOverlayIcon(state);
      return { success: true };
    }
  );

  // ---------------------------------------------------------------------------
  // Transcription Tier Control Channels
  // ---------------------------------------------------------------------------

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
        // Filter out tiers removed in post-process refactor (e.g. macos-dictation)
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

  // ---------------------------------------------------------------------------
  // Whisper Model Channels
  // ---------------------------------------------------------------------------

  // Check if any Whisper model is downloaded
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
    const recommendedModel = 'tiny'; // Fastest path to first usable transcripts
    const recommendedInfo = modelDownloadManager.getModelInfo('tiny');

    return {
      hasAnyModel,
      defaultModel,
      downloadedModels,
      recommendedModel,
      recommendedModelSizeMB: recommendedInfo.sizeMB,
    };
  });

  // Check if we have transcription capability (OpenAI or local Whisper)
  ipcMain.handle(IPC_CHANNELS.WHISPER_HAS_TRANSCRIPTION_CAPABILITY, async () => {
    return tierManager.hasTranscriptionCapability();
  });

  // Get available models with their info
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

  // Download a Whisper model
  ipcMain.handle(IPC_CHANNELS.WHISPER_DOWNLOAD_MODEL, async (_, model: WhisperModel) => {
    try {
      // Set up progress listener to forward to renderer
      const unsubProgress = modelDownloadManager.onProgress((progress) => {
        mainWindow?.webContents.send(IPC_CHANNELS.WHISPER_DOWNLOAD_PROGRESS, {
          model: progress.model,
          downloadedBytes: progress.downloadedBytes,
          totalBytes: progress.totalBytes,
          percent: progress.percent,
          speedBps: progress.speedBps,
          estimatedSecondsRemaining: progress.estimatedSecondsRemaining,
        });
      });

      // Set up completion listener
      const unsubComplete = modelDownloadManager.onComplete((result) => {
        mainWindow?.webContents.send(IPC_CHANNELS.WHISPER_DOWNLOAD_COMPLETE, {
          model: result.model,
          path: result.path,
        });
        unsubProgress();
        unsubComplete();
        unsubError();
      });

      // Set up error listener
      const unsubError = modelDownloadManager.onError((error, errorModel) => {
        mainWindow?.webContents.send(IPC_CHANNELS.WHISPER_DOWNLOAD_ERROR, {
          model: errorModel,
          error: error.message,
        });
        unsubProgress();
        unsubComplete();
        unsubError();
      });

      // Start the download
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

  // Cancel a Whisper model download
  ipcMain.handle(IPC_CHANNELS.WHISPER_CANCEL_DOWNLOAD, (_, model: WhisperModel) => {
    modelDownloadManager.cancelDownload(model);
    return { success: true };
  });
}

// =============================================================================
// Permission Helpers
// =============================================================================

async function checkPermission(type: PermissionType): Promise<boolean> {
  return permissionManager.isGranted(type);
}

async function requestPermission(type: PermissionType): Promise<boolean> {
  return permissionManager.requestPermission(type);
}

/**
 * Check all permissions on startup and show dialog if any are missing
 * This runs after the window is ready to ensure dialogs are properly parented
 */
async function checkStartupPermissions(): Promise<void> {
  if (process.platform !== 'darwin') {
    // Only macOS has these system-level permissions
    return;
  }

  const initial = await permissionManager.checkAllPermissions();

  // On first launch, proactively trigger macOS permission prompts for not-determined states.
  if (initial.state.microphone === 'not-determined') {
    await requestPermission('microphone');
  }
  if (initial.state.screen === 'not-determined') {
    await requestPermission('screen');
  }

  const result = await permissionManager.checkAllPermissions();

  if (!result.allGranted && result.missing.length > 0) {
    // Log which permissions are missing
    errorHandler.log('warn', 'Missing required permissions on startup', {
      component: 'Main',
      operation: 'checkStartupPermissions',
      data: {
        missing: result.missing,
        state: result.state,
      },
    });

    // Show guidance dialog for users who already finished onboarding.
    // New users will continue through onboarding guidance.
    if (hasCompletedOnboarding) {
      // Avoid blocking startup on a modal dialog; show guidance asynchronously.
      setTimeout(() => {
        void permissionManager.showStartupPermissionDialog(result.missing).catch((error) => {
          console.warn('[Main] Startup permission dialog failed:', error);
        });
      }, 500);
    }
  }
}

// =============================================================================
// Session Serialization Helper
// =============================================================================

function serializeSession(session: Session): SessionPayload {
  return {
    id: session.id,
    startTime: session.startTime,
    endTime: session.endTime,
    state: session.state,
    sourceId: session.sourceId,
    feedbackItems: session.feedbackItems.map((item) => ({
      id: item.id,
      timestamp: item.timestamp,
      text: item.text,
      confidence: item.confidence,
      hasScreenshot: false, // Screenshots are now extracted in post-processing
    })),
    metadata: session.metadata,
  };
}

// =============================================================================
// App Lifecycle
// =============================================================================

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Main] Another instance is running, quitting...');
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
  });
}

app.whenReady().then(async () => {
  console.log('[Main] App ready, starting initialization...');

  // 1. Initialize error handler first (for crash recovery)
  await errorHandler.initialize();

  // 1b. Initialize crash recovery manager
  await crashRecovery.initialize();
  console.log('[Main] Crash recovery initialized');

  // 2. Initialize settings manager
  settingsManager = new SettingsManager();
  console.log('[Main] Settings loaded');

  // 3. Determine onboarding readiness from BYOK keys + transcription path
  const [hasOpenAiKey, hasAnthropicKey] = await Promise.all([
    settingsManager.hasApiKey('openai'),
    settingsManager.hasApiKey('anthropic'),
  ]);
  const hasLocalWhisperModel = modelDownloadManager.hasAnyModel();
  const hasTranscriptionPath = hasOpenAiKey || hasLocalWhisperModel;
  hasCompletedOnboarding = hasAnthropicKey && hasTranscriptionPath;

  // 5. Initialize session controller
  await sessionController.initialize();
  console.log('[Main] Session controller initialized');

  // 7. Initialize tray manager FIRST (needed for popover positioning)
  trayManager.initialize();
  console.log('[Main] Tray manager initialized');

  // 8. Create popover window (menu bar native UI)
  const tray = trayManager.getTray();
  if (tray) {
    popover = new PopoverManager({
      width: POPOVER_SIZES.idle.width,
      height: POPOVER_SIZES.idle.height,
      tray: tray,
    });

    const popoverWindow = popover.create();
    mainWindow = popoverWindow; // Assign to mainWindow for compatibility
    sessionController.setMainWindow(popoverWindow);

    attachRendererDiagnostics(popoverWindow, 'Popover');
    void loadRendererIntoWindow(popoverWindow, 'Popover');

    // Check if onboarding needed after window is ready
    popoverWindow.once('ready-to-show', () => {
      console.log('[Main] Popover ready to show');
      if (!hasCompletedOnboarding) {
        popoverWindow.webContents.send('markupr:show-onboarding');
      }
    });

    console.log('[Main] Popover window created');
  } else {
    // Fallback to regular window if tray not available
    createWindow();
    console.log('[Main] Fallback: Regular window created (no tray)');
  }

  wireAudioTelemetry();

  // Set error handler main window
  errorHandler.setMainWindow(mainWindow!);

  // Set crash recovery main window
  crashRecovery.setMainWindow(mainWindow!);

  // Set permission manager main window
  permissionManager.setMainWindow(mainWindow!);

  // 9. Wire up tray click to toggle popover
  trayManager.onClick(handleTrayClick);
  trayManager.onSettingsClick(handleSettingsClick);

  // 8b. Initialize menu manager (native macOS menu bar)
  menuManager.initialize(mainWindow!);
  menuManager.onAction((action, data) => {
    handleMenuAction(action, data);
  });
  // Load recent sessions into menu
  const recentSessions = sessionController.getRecentSessions();
  menuManager.setRecentSessions(
    recentSessions.map((s) => ({
      id: s.id,
      name: s.metadata?.sourceName || 'Feedback Session',
      path: s.id, // We use ID as path for now
      date: new Date(s.startTime),
    }))
  );
  console.log('[Main] Menu manager initialized');

  // 8c. Initialize Windows taskbar (Windows only)
  if (process.platform === 'win32') {
    windowsTaskbar = createWindowsTaskbar(mainWindow!);
    windowsTaskbar.setActionCallbacks({
      onRecord: () => handleToggleRecording(),
      onStop: () => stopSession(),
      onScreenshot: () => handleManualScreenshot(),
      onSettings: () => handleSettingsClick(),
    });
    windowsTaskbar.initialize();
    // Update jump list with recent sessions
    windowsTaskbar.updateRecentSessions(
      recentSessions.map((s) => ({
        id: s.id,
        name: s.metadata?.sourceName || 'Feedback Session',
        path: s.id,
        date: new Date(s.startTime),
      }))
    );
    console.log('[Main] Windows taskbar initialized');
  }

  // 9. Initialize hotkeys
  initializeHotkeys();

  // 10. Setup IPC handlers
  setupIPC();

  // 11. Configure session controller event callbacks
  sessionController.setEventCallbacks({
    onStateChange: handleSessionStateChange,
    onFeedbackItem: handleFeedbackItem,
    onError: handleSessionError,
  });

  // 12. Initialize auto-updater (only in production)
  if (process.env.NODE_ENV !== 'development') {
    autoUpdaterManager.initialize(mainWindow!);
    console.log('[Main] Auto-updater initialized');
  } else {
    console.log('[Main] Auto-updater skipped (development mode)');
  }

  // 13. Check permissions on startup (macOS only)
  // Delay slightly to ensure window is fully ready
  setTimeout(async () => {
    await checkStartupPermissions();
    console.log('[Main] Startup permission check complete');
  }, 1000);

  // Handle macOS dock click (fallback, dock is hidden in menu bar mode)
  app.on('activate', () => {
    // In menu bar mode, show the popover
    if (popover) {
      popover.show();
      return;
    }

    // Fallback for non-popover mode
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showWindow();
    }
  });

  console.log('[Main] markupr initialization complete');
});

// Handle all windows closed
app.on('window-all-closed', () => {
  // On macOS, keep the app running in the tray
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle before quit
app.on('before-quit', () => {
  isQuitting = true;
});

// Handle app quit
app.on('will-quit', async () => {
  console.log('[Main] App quitting, cleaning up...');

  // Stop any active session
  if (sessionController.getState() === 'recording') {
    sessionController.cancel();
  }

  // Best-effort cleanup of temporary recording artifacts.
  for (const [sessionId] of activeScreenRecordings) {
    const artifact = await finalizeScreenRecording(sessionId).catch(() => null);
    if (artifact?.tempPath) {
      await fs.unlink(artifact.tempPath).catch(() => {});
    }
    finalizedScreenRecordings.delete(sessionId);
  }
  for (const artifact of finalizedScreenRecordings.values()) {
    await fs.unlink(artifact.tempPath).catch(() => {});
  }
  finalizedScreenRecordings.clear();

  // Cleanup services
  teardownAudioTelemetry.forEach((teardown) => teardown());
  teardownAudioTelemetry = [];
  hotkeyManager.unregisterAll();
  popover?.destroy();
  trayManager.destroy();
  menuManager.destroy();
  windowsTaskbar?.destroy();
  sessionController.destroy();
  autoUpdaterManager.destroy();
  crashRecovery.destroy();

  // Clean up error handler
  await errorHandler.destroy();

  console.log('[Main] Cleanup complete');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  if (isIgnorableStdioError(error)) {
    return;
  }

  console.error('[Main] Uncaught exception:', error);
  try {
    showErrorNotification('markupr Error', error.message);
  } catch {
    // Ignore notification errors
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  if (isIgnorableStdioError(reason)) {
    return;
  }

  console.error('[Main] Unhandled rejection:', reason);
});

// Export for testing
export {
  createWindow,
  startSession,
  stopSession,
  showWindow,
};
