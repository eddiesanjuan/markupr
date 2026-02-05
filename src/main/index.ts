import { app, BrowserWindow, globalShortcut, shell } from "electron";
import { join } from "path";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { createTray, updateTrayIcon, updateRecentSessions } from "./tray";
import {
  SessionController,
  AudioService,
  TranscriptionService,
  StateStore,
  SessionState,
  ScreenshotService,
  SessionHistory,
} from "./services";
import { setupIPC } from "./ipc";
import { logger } from "./utils/logger";

// Single instance lock - prevent multiple instances from running
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let sessionController: SessionController | null = null;
let audioService: AudioService | null = null;
let transcriptionService: TranscriptionService | null = null;
let stateStore: StateStore | null = null;
let screenshotService: ScreenshotService | null = null;
let sessionHistory: SessionHistory | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 320,
    height: 420,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    vibrancy: "popover",
    visualEffectState: "active",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  window.on("blur", () => {
    window.hide();
  });

  // Block window.open and redirect to system browser
  // Only allow http/https protocols to prevent file:/javascript:/custom scheme abuse
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        shell.openExternal(url);
      }
    } catch {
      // Invalid URL, ignore silently
    }
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

function initializeServices(): void {
  stateStore = new StateStore();
  audioService = new AudioService();
  transcriptionService = new TranscriptionService();
  screenshotService = new ScreenshotService();
  sessionHistory = new SessionHistory();
  sessionController = new SessionController(
    audioService,
    transcriptionService,
    stateStore,
    screenshotService,
  );

  // Update tray icon based on session state
  sessionController.on("stateChange", ({ newState, session }) => {
    updateTrayIcon(newState as SessionState);

    // Add to history when session completes
    if (newState === SessionState.COMPLETE && session.reportPath) {
      const duration =
        session.startedAt && session.stoppedAt
          ? Math.round((session.stoppedAt - session.startedAt) / 1000)
          : 0;

      sessionHistory?.addSession({
        id: session.id,
        reportPath: session.reportPath,
        timestamp: Date.now(),
        duration,
        screenshotCount: session.screenshots?.length || 0,
      });

      // Update tray menu with recent sessions
      updateRecentSessions(sessionHistory!.getSessions());
    }
  });
}

function registerGlobalShortcuts(): void {
  // Recording toggle hotkey: Cmd+Shift+F (F for Feedback)
  const feedbackRegistered = globalShortcut.register("CommandOrControl+Shift+F", async () => {
    if (!sessionController) return;

    // Show the window when shortcut is pressed
    if (mainWindow) {
      mainWindow.show();
    }

    const currentState = sessionController.getState();

    if (currentState === SessionState.IDLE) {
      // Start recording
      await sessionController.start();
    } else if (currentState === SessionState.RECORDING) {
      // Stop recording
      await sessionController.stop();
    }
    // If in other states (PROCESSING, COMPLETE, ERROR), just show the window
  });

  // Screenshot hotkey: Cmd+Shift+S (S for Screenshot, avoids macOS native conflict)
  const screenshotRegistered = globalShortcut.register("CommandOrControl+Shift+S", async () => {
    if (!sessionController || !screenshotService) return;

    // Only capture if actively recording
    if (sessionController.getState() === SessionState.RECORDING) {
      const screenshot = await screenshotService.capture();
      if (screenshot) {
        sessionController.addScreenshot(screenshot.path);
        // Notify renderer
        mainWindow?.webContents.send("screenshot:captured", {
          index: screenshot.index,
          timestamp: screenshot.timestamp,
          path: screenshot.path,
        });
      }
    }
  });

  // Log warnings if shortcuts failed to register (may conflict with other apps)
  if (!feedbackRegistered) {
    logger.warn("Failed to register global shortcut CommandOrControl+Shift+F - may conflict with another app");
  }
  if (!screenshotRegistered) {
    logger.warn("Failed to register global shortcut CommandOrControl+Shift+S - may conflict with another app");
  }
}

function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
}

async function checkForRecovery(): Promise<void> {
  if (!sessionController) return;

  const savedSession = await sessionController.checkRecovery();
  if (savedSession) {
    logger.log("Found interrupted session, notifying renderer");
    // The renderer will handle showing the recovery dialog
    mainWindow?.webContents.send("recovery:found", savedSession);
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.eddiesanjuan.feedbackflow");

  // Focus existing window when second instance is launched
  app.on("second-instance", () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  if (app.dock) {
    app.dock.hide();
  }

  // Initialize services
  initializeServices();

  // Create window
  mainWindow = createWindow();

  // Setup IPC
  setupIPC(
    sessionController!,
    transcriptionService!,
    () => mainWindow,
    screenshotService!,
  );

  // Create tray
  createTray(mainWindow);

  // Initialize tray with recent sessions
  if (sessionHistory) {
    updateRecentSessions(sessionHistory.getSessions());
  }

  // Register global shortcuts
  registerGlobalShortcuts();

  // Check for crash recovery after window is ready
  mainWindow.webContents.on("did-finish-load", () => {
    checkForRecovery();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  // Cleanup
  unregisterGlobalShortcuts();
  sessionController?.destroy();
  audioService?.destroy();
  transcriptionService?.destroy();
  stateStore?.destroy();
  screenshotService?.destroy();
});
