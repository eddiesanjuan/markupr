import { EventEmitter } from 'events'
import { desktopCapturer, screen } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { writeFile } from 'fs/promises'
import { logger } from '../utils/logger'

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
      logger.warn('No active session for screenshot')
      return null
    }

    try {
      // Capture the display where the cursor is located (supports multi-monitor)
      const cursorPoint = screen.getCursorScreenPoint()
      const display = screen.getDisplayNearestPoint(cursorPoint)
      const scaleFactor = display.scaleFactor

      // Calculate scaled dimensions, capped at max width to prevent OOM on 4K/5K displays
      const maxWidth = 1920
      const scaledWidth = Math.round(display.size.width * scaleFactor)
      const scaledHeight = Math.round(display.size.height * scaleFactor)

      // Cap to max resolution while maintaining aspect ratio
      const finalWidth = Math.min(scaledWidth, maxWidth)
      const finalHeight = Math.round(finalWidth * (scaledHeight / scaledWidth))

      // Get sources - capture entire screen
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: finalWidth,
          height: finalHeight
        }
      })

      if (sources.length === 0) {
        logger.error('No screen sources available')
        return null
      }

      // Use the display source matching the cursor's display
      const source = sources.find(s => s.display_id === String(display.id)) || sources[0]
      const thumbnail = source.thumbnail

      if (thumbnail.isEmpty()) {
        logger.error('Screenshot thumbnail is empty')
        return null
      }

      // Save as PNG
      this.captureCount++
      const timestamp = Date.now()
      const filename = `screenshot-${String(this.captureCount).padStart(3, '0')}.png`
      const filepath = join(this.sessionDir, filename)

      const pngBuffer = thumbnail.toPNG()
      await writeFile(filepath, pngBuffer)

      const screenshot: Screenshot = {
        path: filepath,
        timestamp,
        index: this.captureCount
      }

      this.emit('captured', screenshot)
      return screenshot
    } catch (err) {
      logger.error('Failed to capture screenshot:', err)
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
