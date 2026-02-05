import { app, BrowserWindow, globalShortcut } from "electron";
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
      sandbox: false,
    },
  });

  window.on("blur", () => {
    window.hide();
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
  // Screenshot hotkey: Cmd+Shift+S (S for Screenshot, avoids macOS native conflict)
  globalShortcut.register("CommandOrControl+Shift+S", async () => {
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
}

function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
}

async function checkForRecovery(): Promise<void> {
  if (!sessionController) return;

  const savedSession = await sessionController.checkRecovery();
  if (savedSession) {
    console.log("Found interrupted session, notifying renderer");
    // The renderer will handle showing the recovery dialog
    mainWindow?.webContents.send("recovery:found", savedSession);
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.eddiesanjuan.feedbackflow");

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
