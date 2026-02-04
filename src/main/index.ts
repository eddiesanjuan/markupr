import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createTray, updateTrayIcon } from './tray'
import { SessionController, AudioService, TranscriptionService, StateStore, SessionState } from './services'
import { setupIPC } from './ipc'

let mainWindow: BrowserWindow | null = null
let sessionController: SessionController | null = null
let audioService: AudioService | null = null
let transcriptionService: TranscriptionService | null = null
let stateStore: StateStore | null = null

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
    vibrancy: 'popover',
    visualEffectState: 'active',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  window.on('blur', () => {
    window.hide()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

function initializeServices(): void {
  stateStore = new StateStore()
  audioService = new AudioService()
  transcriptionService = new TranscriptionService()
  sessionController = new SessionController(audioService, transcriptionService, stateStore)

  // Update tray icon based on session state
  sessionController.on('stateChange', ({ newState }) => {
    updateTrayIcon(newState as SessionState)
  })
}

async function checkForRecovery(): Promise<void> {
  if (!sessionController) return

  const savedSession = await sessionController.checkRecovery()
  if (savedSession) {
    console.log('Found interrupted session, notifying renderer')
    // The renderer will handle showing the recovery dialog
    mainWindow?.webContents.send('recovery:found', savedSession)
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.eddiesanjuan.feedbackflow')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  if (app.dock) {
    app.dock.hide()
  }

  // Initialize services
  initializeServices()

  // Create window
  mainWindow = createWindow()

  // Setup IPC
  setupIPC(sessionController!, transcriptionService!, () => mainWindow)

  // Create tray
  createTray(mainWindow)

  // Check for crash recovery after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    checkForRecovery()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // Cleanup
  sessionController?.destroy()
  audioService?.destroy()
  transcriptionService?.destroy()
  stateStore?.destroy()
})
