import { EventEmitter } from 'events'
import { desktopCapturer, screen } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'

export interface Screenshot {
  path: string
  timestamp: number
  index: number
}

export class ScreenshotService extends EventEmitter {
  private screenshotsDir: string
  private sessionDir: string | null = null
  private captureCount = 0

  constructor() {
    super()
    this.screenshotsDir = join(app.getPath('userData'), 'screenshots')
    this.ensureDir(this.screenshotsDir)
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  startSession(sessionId: string): void {
    this.sessionDir = join(this.screenshotsDir, sessionId)
    this.ensureDir(this.sessionDir)
    this.captureCount = 0
  }

  endSession(): void {
    this.sessionDir = null
    this.captureCount = 0
  }

  async capture(): Promise<Screenshot | null> {
    if (!this.sessionDir) {
      console.warn('No active session for screenshot')
      return null
    }

    try {
      const primaryDisplay = screen.getPrimaryDisplay()

      // Get sources - capture entire screen
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: primaryDisplay.size.width * primaryDisplay.scaleFactor,
          height: primaryDisplay.size.height * primaryDisplay.scaleFactor
        }
      })

      if (sources.length === 0) {
        console.error('No screen sources available')
        return null
      }

      // Use the primary display source (usually "Entire Screen" or "Screen 1")
      const source = sources.find(s => s.display_id === String(primaryDisplay.id)) || sources[0]
      const thumbnail = source.thumbnail

      if (thumbnail.isEmpty()) {
        console.error('Screenshot thumbnail is empty')
        return null
      }

      // Save as PNG
      this.captureCount++
      const timestamp = Date.now()
      const filename = `screenshot-${String(this.captureCount).padStart(3, '0')}.png`
      const filepath = join(this.sessionDir, filename)

      const pngBuffer = thumbnail.toPNG()
      writeFileSync(filepath, pngBuffer)

      const screenshot: Screenshot = {
        path: filepath,
        timestamp,
        index: this.captureCount
      }

      this.emit('captured', screenshot)
      return screenshot
    } catch (err) {
      console.error('Failed to capture screenshot:', err)
      this.emit('error', err)
      return null
    }
  }

  getCaptureCount(): number {
    return this.captureCount
  }

  getSessionDir(): string | null {
    return this.sessionDir
  }

  destroy(): void {
    this.sessionDir = null
    this.captureCount = 0
    this.removeAllListeners()
  }
}
