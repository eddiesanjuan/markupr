/**
 * FeedbackFlow - Main Process Entry Point
 *
 * This is the orchestration heart of FeedbackFlow. It:
 * - Initializes all services in the correct order
 * - Wires up the complete session lifecycle
 * - Manages IPC communication with renderer
 * - Handles hotkey registration and tray management
 * - Coordinates graceful shutdown
 *
 * Service Integration Order:
 * 1. Error handler (for crash recovery)
 * 2. Settings (needed for API keys and config)
 * 3. Keytar initialization (secure storage)
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
  systemPreferences,
  shell,
  Notification,
} from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Hide dock icon on macOS for pure menu bar experience
// IMPORTANT: Must be called before app.whenReady()
if (process.platform === 'darwin') {
  app.dock.hide();
}

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
} from '../shared/types';
import { hotkeyManager, type HotkeyAction } from './HotkeyManager';
import { sessionController, type Session, type SessionState } from './SessionController';
import { trayManager } from './TrayManager';
import { SettingsManager } from './settings';
import { fileManager, outputManager, clipboardService, generateDocumentForFileManager, generateClipboardSummary } from './output';
import { screenCapture } from './capture/ScreenCapture';
import { intelligentCapture } from './capture/IntelligentCapture';
import { transcriptionService } from './transcription/TranscriptionService';
import { errorHandler } from './ErrorHandler';
import { autoUpdaterManager } from './AutoUpdater';
import { crashRecovery, type RecoverableFeedbackItem } from './CrashRecovery';
import { menuManager } from './MenuManager';
import { WindowsTaskbar, createWindowsTaskbar } from './platform';
import { PopoverManager, POPOVER_SIZES } from './windows';

// =============================================================================
// Module State
// =============================================================================

let mainWindow: BrowserWindow | null = null;
let popover: PopoverManager | null = null;
let settingsManager: SettingsManager | null = null;
let isQuitting = false;
let hasCompletedOnboarding = false;

// API key service (using keytar for secure storage)
let keytar: typeof import('keytar') | null = null;
const KEYTAR_SERVICE = 'feedbackflow';

// Cleanup functions for intelligent capture
let intelligentCaptureCleanup: (() => void) | null = null;

// Windows taskbar integration (Windows only)
let windowsTaskbar: WindowsTaskbar | null = null;

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

  // Load the renderer
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    console.log('[Main] Window ready to show');

    // Check if onboarding needed
    if (!hasCompletedOnboarding) {
      mainWindow?.webContents.send('feedbackflow:show-onboarding');
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
  screenshot?: { id: string };
}): void {
  mainWindow?.webContents.send(IPC_CHANNELS.SESSION_FEEDBACK_ITEM, {
    id: item.id,
    timestamp: item.timestamp,
    text: item.text,
    confidence: item.confidence,
    hasScreenshot: !!item.screenshot,
    screenshotId: item.screenshot?.id,
  });

  // Update crash recovery with new feedback item
  const session = sessionController.getSession();
  if (session) {
    const recoverableFeedbackItems: RecoverableFeedbackItem[] = session.feedbackItems.map((fi) => ({
      id: fi.id,
      timestamp: fi.timestamp,
      text: fi.text,
      confidence: fi.confidence,
      hasScreenshot: !!fi.screenshot,
      screenshotId: fi.screenshot?.id,
    }));

    crashRecovery.updateSession({
      feedbackItems: recoverableFeedbackItems,
      screenshotCount: session.screenshotBuffer.length,
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
  trayManager.setTooltip(`FeedbackFlow - Error: ${error.message}`);

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
    mainWindow?.webContents.send('feedbackflow:show-window-selector');
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
  mainWindow?.webContents.send('feedbackflow:show-settings');
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
      mainWindow?.webContents.send('feedbackflow:show-history');
      break;
    case 'show-export':
      showWindow();
      mainWindow?.webContents.send('feedbackflow:show-export');
      break;
    case 'show-shortcuts':
      showWindow();
      mainWindow?.webContents.send('feedbackflow:show-shortcuts');
      break;
    case 'check-updates':
      autoUpdaterManager.checkForUpdates();
      break;
    case 'open-session':
      showWindow();
      mainWindow?.webContents.send('feedbackflow:open-session-dialog');
      break;
    case 'open-session-path':
      if (data && typeof data === 'object' && 'path' in data) {
        showWindow();
        mainWindow?.webContents.send('feedbackflow:open-session', (data as { path: string }).path);
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
      handleToggleRecording();
      break;

    case 'manualScreenshot':
      handleManualScreenshot();
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
    // Show window to select source
    showWindow();
    mainWindow?.webContents.send('feedbackflow:show-window-selector');
  }
}

async function handleManualScreenshot(): Promise<void> {
  if (sessionController.getState() !== 'recording') {
    console.warn('[Main] Cannot take screenshot - not recording');
    return;
  }

  const session = sessionController.getSession();
  if (!session) return;

  try {
    const result = await screenCapture.capture(session.sourceId);
    mainWindow?.webContents.send(IPC_CHANNELS.SCREENSHOT_CAPTURED, {
      id: result.id,
      timestamp: Date.now(),
      count: session.screenshotBuffer.length + 1,
      width: result.width,
      height: result.height,
      trigger: 'manual',
    });
  } catch (error) {
    console.error('[Main] Manual screenshot failed:', error);
  }
}

// =============================================================================
// Session Control
// =============================================================================

/**
 * Start a recording session with intelligent capture
 */
async function startSession(sourceId: string, sourceName?: string): Promise<{
  success: boolean;
  sessionId?: string;
  error?: string;
}> {
  try {
    // Get API key (optional - TierManager handles tier selection)
    const apiKey = await getApiKey('deepgram');

    // Configure transcription service if API key exists (for Deepgram tier)
    // If no key, TierManager will fall back to local Whisper automatically
    if (apiKey && !transcriptionService.isConnected()) {
      transcriptionService.configure(apiKey);
    }

    // Configure session controller with transcription (optional API key)
    if (apiKey) {
      sessionController.configureTranscription(apiKey);
    }

    // Initialize intelligent capture for this session
    intelligentCapture.initialize(transcriptionService, screenCapture, hotkeyManager);
    intelligentCapture.setSourceId(sourceId);

    // Start the session
    await sessionController.start(sourceId, sourceName);

    // Start intelligent capture
    intelligentCapture.start();

    // Subscribe to intelligent capture screenshots
    const unsubScreenshot = intelligentCapture.onScreenshot((screenshot, decision) => {
      console.log(`[Main] Intelligent capture: ${decision.trigger}, ${decision.transcriptWindow.length} transcripts`);
      mainWindow?.webContents.send(IPC_CHANNELS.SCREENSHOT_CAPTURED, {
        id: screenshot.id,
        timestamp: screenshot.timestamp,
        count: sessionController.getStatus().screenshotCount,
        width: screenshot.width,
        height: screenshot.height,
        trigger: decision.trigger,
      });
    });

    const unsubError = intelligentCapture.onError((error, trigger) => {
      console.error(`[Main] Intelligent capture error (${trigger}):`, error);
    });

    // Store cleanup functions
    intelligentCaptureCleanup = () => {
      unsubScreenshot();
      unsubError();
      intelligentCapture.stop();
    };

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
        sourceName: sourceName || 'Unknown Source',
        screenshotCount: 0,
        metadata: {
          appVersion: app.getVersion(),
          platform: process.platform,
          sessionDurationMs: 0,
        },
      });
    }

    // Show recording notification
    showSuccessNotification('Recording Started', 'Speak and FeedbackFlow will capture your feedback.');

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
  try {
    // Stop intelligent capture first
    if (intelligentCaptureCleanup) {
      intelligentCaptureCleanup();
      intelligentCaptureCleanup = null;
    }

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

    // Update progress: generating document (33%)
    windowsTaskbar?.setProgress(0.33);

    // Generate output document using adapter for type compatibility
    const document = generateDocumentForFileManager(session, {
      projectName: session.metadata?.sourceName || 'Feedback Session',
      screenshotDir: './screenshots',
    });

    // Update progress: saving to file system (66%)
    windowsTaskbar?.setProgress(0.66);

    // Save to file system
    const saveResult = await fileManager.saveSession(session, document);

    // Update progress: copying to clipboard (90%)
    windowsTaskbar?.setProgress(0.9);

    // Copy summary to clipboard
    const settings = settingsManager?.getAll() || DEFAULT_SETTINGS;
    if (settings.autoClipboard !== false) {
      const clipboardSummary = generateClipboardSummary(session, session.metadata?.sourceName);
      await clipboardService.copyWithNotification(clipboardSummary, 'Feedback Captured!');
    }

    // Complete progress and flash taskbar
    windowsTaskbar?.setProgress(1);
    windowsTaskbar?.flashFrame(3);

    // Clear progress after a brief delay
    setTimeout(() => {
      windowsTaskbar?.clearProgress();
    }, 1000);

    // Notify renderer
    mainWindow?.webContents.send(IPC_CHANNELS.SESSION_COMPLETE, serializeSession(session));
    mainWindow?.webContents.send(IPC_CHANNELS.OUTPUT_READY, {
      markdown: document.content,
      sessionId: session.id,
      reportPath: saveResult.markdownPath,
    });

    // Show completion notification
    showSuccessNotification(
      'Feedback Captured!',
      `${session.feedbackItems.length} items saved. Summary copied to clipboard.`
    );

    return {
      success: true,
      session: serializeSession(session),
      reportPath: saveResult.markdownPath,
    };
  } catch (error) {
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
  if (intelligentCaptureCleanup) {
    intelligentCaptureCleanup();
    intelligentCaptureCleanup = null;
  }
  sessionController.cancel();
  crashRecovery.stopTracking();
  return { success: true };
}

// =============================================================================
// IPC Handlers Setup
// =============================================================================

function setupIPC(): void {
  // ---------------------------------------------------------------------------
  // Session Channels
  // ---------------------------------------------------------------------------

  // Start session with intelligent capture
  ipcMain.handle(IPC_CHANNELS.SESSION_START, async (_, sourceId: string, sourceName?: string) => {
    console.log(`[Main] Starting session for source: ${sourceId}`);
    return startSession(sourceId, sourceName);
  });

  // Stop session with output generation
  ipcMain.handle(IPC_CHANNELS.SESSION_STOP, async () => {
    console.log('[Main] Stopping session');
    return stopSession();
  });

  // Cancel session without saving
  ipcMain.handle(IPC_CHANNELS.SESSION_CANCEL, async () => {
    console.log('[Main] Cancelling session');
    return cancelSession();
  });

  // Get session status
  ipcMain.handle(IPC_CHANNELS.SESSION_GET_STATUS, (): SessionStatusPayload => {
    return sessionController.getStatus();
  });

  // Get current session
  ipcMain.handle(IPC_CHANNELS.SESSION_GET_CURRENT, (): SessionPayload | null => {
    const session = sessionController.getSession();
    return session ? serializeSession(session) : null;
  });

  // Legacy session handlers (for backwards compatibility)
  ipcMain.handle(IPC_CHANNELS.START_SESSION, async (_, sourceId?: string) => {
    return startSession(sourceId || 'screen:0:0');
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

  // Trigger manual screenshot
  ipcMain.handle(IPC_CHANNELS.CAPTURE_MANUAL_SCREENSHOT, async () => {
    await handleManualScreenshot();
    return { success: true };
  });

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
      return getApiKey(service);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET_API_KEY,
    async (_, service: string, key: string): Promise<boolean> => {
      return setApiKey(service, key);
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

      const document = generateDocumentForFileManager(session, {
        projectName: session.metadata?.sourceName || 'Feedback Session',
        screenshotDir: './screenshots',
      });

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

  // Legacy clipboard handler
  ipcMain.handle(IPC_CHANNELS.COPY_TO_CLIPBOARD, async (_, text: string) => {
    const success = await clipboardService.copyWithNotification(text);
    return { success };
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

  ipcMain.handle('feedbackflow:popover:resize', (_, width: number, height: number) => {
    if (popover) {
      popover.resize(width, height);
      return { success: true };
    }
    return { success: false, error: 'Popover not initialized' };
  });

  ipcMain.handle('feedbackflow:popover:resize-to-state', (_, state: string) => {
    if (popover && state in POPOVER_SIZES) {
      popover.resizeToState(state as keyof typeof POPOVER_SIZES);
      return { success: true };
    }
    return { success: false, error: 'Popover not initialized or invalid state' };
  });

  ipcMain.handle('feedbackflow:popover:show', () => {
    popover?.show();
    return { success: true };
  });

  ipcMain.handle('feedbackflow:popover:hide', () => {
    popover?.hide();
    return { success: true };
  });

  ipcMain.handle('feedbackflow:popover:toggle', () => {
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
}

// =============================================================================
// Permission Helpers
// =============================================================================

async function checkPermission(type: PermissionType): Promise<boolean> {
  if (process.platform !== 'darwin') {
    // Windows/Linux don't have the same permission system
    return true;
  }

  switch (type) {
    case 'microphone':
      return systemPreferences.getMediaAccessStatus('microphone') === 'granted';
    case 'screen':
      return systemPreferences.getMediaAccessStatus('screen') === 'granted';
    case 'accessibility':
      return systemPreferences.isTrustedAccessibilityClient(false);
    default:
      return false;
  }
}

async function requestPermission(type: PermissionType): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return true;
  }

  switch (type) {
    case 'microphone':
      return await systemPreferences.askForMediaAccess('microphone');
    case 'screen':
      // Screen recording permission is handled by opening System Preferences
      if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
        shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
        );
        return false;
      }
      return true;
    case 'accessibility':
      // Accessibility requires manual enablement
      systemPreferences.isTrustedAccessibilityClient(true);
      return systemPreferences.isTrustedAccessibilityClient(false);
    default:
      return false;
  }
}

// =============================================================================
// API Key Helpers (Secure Storage)
// =============================================================================

async function initKeytar(): Promise<void> {
  try {
    keytar = await import('keytar');
    console.log('[Main] Keytar initialized for secure API key storage');
  } catch (error) {
    console.warn('[Main] Keytar not available, falling back to settings storage');
    keytar = null;
  }
}

async function getApiKey(service: string): Promise<string | null> {
  if (keytar) {
    try {
      return await keytar.getPassword(KEYTAR_SERVICE, service);
    } catch (error) {
      console.warn(`[Main] Failed to get API key from keytar for ${service}:`, error);
    }
  }

  // Fallback to settings
  if (service === 'deepgram') {
    return settingsManager?.get('deepgramApiKey') || null;
  }
  return null;
}

async function setApiKey(service: string, key: string): Promise<boolean> {
  if (keytar) {
    try {
      await keytar.setPassword(KEYTAR_SERVICE, service, key);
      return true;
    } catch (error) {
      console.warn(`[Main] Failed to set API key in keytar for ${service}:`, error);
    }
  }

  // Fallback to settings
  if (service === 'deepgram') {
    settingsManager?.update({ deepgramApiKey: key });
    return true;
  }
  return false;
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
      hasScreenshot: !!item.screenshot,
      screenshotId: item.screenshot?.id,
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

  // 3. Initialize keytar for secure storage
  await initKeytar();

  // 4. Check for API key to determine onboarding state
  const apiKey = await getApiKey('deepgram');
  hasCompletedOnboarding = !!apiKey;

  // 5. Initialize session controller
  await sessionController.initialize();
  console.log('[Main] Session controller initialized');

  // 6. Configure transcription service if API key exists
  if (apiKey) {
    try {
      transcriptionService.configure(apiKey);
      console.log('[Main] Transcription service configured');
    } catch (error) {
      console.error('[Main] Failed to configure transcription:', error);
    }
  }

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

    // Load renderer
    if (process.env.NODE_ENV === 'development') {
      popoverWindow.loadURL('http://localhost:5173');
      // Open DevTools in detached mode for debugging
      popoverWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
      popoverWindow.loadFile(join(__dirname, '../renderer/index.html'));
    }

    // Check if onboarding needed after window is ready
    popoverWindow.once('ready-to-show', () => {
      console.log('[Main] Popover ready to show');
      if (!hasCompletedOnboarding) {
        popoverWindow.webContents.send('feedbackflow:show-onboarding');
      }
    });

    console.log('[Main] Popover window created');
  } else {
    // Fallback to regular window if tray not available
    createWindow();
    console.log('[Main] Fallback: Regular window created (no tray)');
  }

  // Set error handler main window
  errorHandler.setMainWindow(mainWindow!);

  // Set crash recovery main window
  crashRecovery.setMainWindow(mainWindow!);

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

  console.log('[Main] FeedbackFlow initialization complete');
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
    if (intelligentCaptureCleanup) {
      intelligentCaptureCleanup();
      intelligentCaptureCleanup = null;
    }
    sessionController.cancel();
  }

  // Cleanup services
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
  console.error('[Main] Uncaught exception:', error);
  try {
    showErrorNotification('FeedbackFlow Error', error.message);
  } catch {
    // Ignore notification errors
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});

// Export for testing
export {
  createWindow,
  startSession,
  stopSession,
  showWindow,
};
