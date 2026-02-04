import { ipcMain, clipboard, BrowserWindow } from 'electron'
import { SessionController, SessionState, type SessionData } from './services'
import { TranscriptionService } from './services'

export function setupIPC(
  sessionController: SessionController,
  transcriptionService: TranscriptionService,
  getMainWindow: () => BrowserWindow | null
): void {
  // Session control
  ipcMain.handle('session:start', async () => {
    return sessionController.start()
  })

  ipcMain.handle('session:stop', async () => {
    return sessionController.stop()
  })

  ipcMain.handle('session:cancel', async () => {
    return sessionController.cancel()
  })

  ipcMain.handle('session:reset', async () => {
    return sessionController.reset()
  })

  ipcMain.handle('session:getState', () => {
    return sessionController.getState()
  })

  ipcMain.handle('session:getSession', () => {
    return sessionController.getSession()
  })

  // Transcription
  ipcMain.handle('transcription:isModelReady', () => {
    return transcriptionService.isModelDownloaded()
  })

  ipcMain.handle('transcription:downloadModel', async () => {
    return transcriptionService.downloadModel((percent) => {
      const window = getMainWindow()
      if (window) {
        window.webContents.send('transcription:downloadProgress', percent)
      }
    })
  })

  ipcMain.handle('transcription:getConfig', () => {
    return transcriptionService.getConfig()
  })

  ipcMain.handle('transcription:setConfig', (_, config) => {
    transcriptionService.setConfig(config)
  })

  // Clipboard
  ipcMain.handle('clipboard:write', (_, text: string) => {
    clipboard.writeText(text)
    return true
  })

  ipcMain.handle('clipboard:read', () => {
    return clipboard.readText()
  })

  // Recovery
  ipcMain.handle('recovery:check', async () => {
    return sessionController.checkRecovery()
  })

  ipcMain.handle('recovery:recover', async (_, session: SessionData) => {
    return sessionController.recoverSession(session)
  })

  ipcMain.handle('recovery:discard', async () => {
    return sessionController.reset()
  })

  // Forward state changes to renderer
  sessionController.on('stateChange', ({ newState, session }) => {
    const window = getMainWindow()
    if (window) {
      window.webContents.send('session:stateChanged', { state: newState, session })
    }
  })
}
