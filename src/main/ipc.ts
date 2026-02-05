import { ipcMain, clipboard, BrowserWindow, shell, app } from 'electron'
import { SessionController, type SessionData, ScreenshotService, SessionState } from './services'
import { TranscriptionService } from './services'

/**
 * Structured IPC response type for consistent error handling
 */
export interface IPCResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Helper to wrap async IPC handlers with structured error responses
 */
function wrapHandler<T>(handler: () => Promise<T> | T): () => Promise<IPCResponse<T>> {
  return async () => {
    try {
      const data = await handler()
      return { success: true, data }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  }
}

/**
 * Helper to wrap async IPC handlers that take arguments
 */
function wrapHandlerWithArgs<T, A extends unknown[]>(
  handler: (...args: A) => Promise<T> | T
): (...args: A) => Promise<IPCResponse<T>> {
  return async (...args: A) => {
    try {
      const data = await handler(...args)
      return { success: true, data }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  }
}

export function setupIPC(
  sessionController: SessionController,
  transcriptionService: TranscriptionService,
  getMainWindow: () => BrowserWindow | null,
  screenshotService?: ScreenshotService
): void {
  // Session control - wrapped with structured error handling
  ipcMain.handle('session:start', wrapHandler(() => sessionController.start()))

  ipcMain.handle('session:stop', wrapHandler(() => sessionController.stop()))

  ipcMain.handle('session:cancel', wrapHandler(() => sessionController.cancel()))

  ipcMain.handle('session:reset', wrapHandler(() => sessionController.reset()))

  ipcMain.handle('session:getState', wrapHandler(() => sessionController.getState()))

  ipcMain.handle('session:getSession', wrapHandler(() => sessionController.getSession()))

  // Transcription - wrapped with structured error handling
  ipcMain.handle('transcription:isModelReady', wrapHandler(() => transcriptionService.isModelDownloaded()))

  ipcMain.handle('transcription:downloadModel', wrapHandler(() => {
    return transcriptionService.downloadModel((percent) => {
      const window = getMainWindow()
      if (window) {
        window.webContents.send('transcription:downloadProgress', percent)
      }
    })
  }))

  ipcMain.handle('transcription:getConfig', wrapHandler(() => transcriptionService.getConfig()))

  ipcMain.handle('transcription:setConfig', async (_, config) => {
    try {
      transcriptionService.setConfig(config)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Clipboard - wrapped with structured error handling
  ipcMain.handle('clipboard:write', async (_, text: string) => {
    try {
      clipboard.writeText(text)
      return { success: true, data: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  ipcMain.handle('clipboard:read', wrapHandler(() => clipboard.readText()))

  // Recovery - wrapped with structured error handling
  ipcMain.handle('recovery:check', wrapHandler(() => sessionController.checkRecovery()))

  ipcMain.handle('recovery:recover', async (_, session: SessionData) => {
    try {
      await sessionController.recoverSession(session)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  ipcMain.handle('recovery:discard', wrapHandler(() => sessionController.reset()))

  // Forward state changes to renderer
  sessionController.on('stateChange', ({ newState, session }) => {
    const window = getMainWindow()
    if (window) {
      window.webContents.send('session:stateChanged', { state: newState, session })
    }
  })

  // Screenshot
  ipcMain.handle('screenshot:capture', async () => {
    if (!screenshotService) {
      return { success: false, error: 'Screenshot service not available' }
    }

    if (sessionController.getState() !== SessionState.RECORDING) {
      return { success: false, error: 'Not currently recording' }
    }

    const screenshot = await screenshotService.capture()
    if (screenshot) {
      sessionController.addScreenshot(screenshot.path)
      return { success: true, screenshot }
    }
    return { success: false, error: 'Failed to capture screenshot' }
  })

  ipcMain.handle('screenshot:getCount', () => {
    return screenshotService?.getCaptureCount() ?? 0
  })

  // App version
  ipcMain.handle('app:getVersion', wrapHandler(() => app.getVersion()))

  // External URL handler - safe way to open URLs in system browser
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    // Validate URL before opening
    try {
      const parsed = new URL(url)
      // Only allow http and https protocols
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { success: false, error: 'Only http and https URLs are allowed' }
      }
      await shell.openExternal(url)
      return { success: true }
    } catch {
      return { success: false, error: 'Invalid URL' }
    }
  })
}
