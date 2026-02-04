/**
 * Screen Capture Module
 *
 * Handles:
 * - Full screen capture using Electron's desktopCapturer
 * - Multi-monitor support with display detection
 * - Screenshot timing based on voice pause detection
 * - Image compression and storage
 * - Display hotplug events
 */

// Re-export everything from ScreenCapture for external use
export {
  screenCapture,
  ScreenCaptureServiceImpl,
  type CaptureSource,
  type Screenshot,
  type DisplayInfo,
  type DisplayChangeCallback,
  type ScreenCaptureService,
} from './ScreenCapture';

// Legacy CaptureManager for backwards compatibility
import { desktopCapturer, screen } from 'electron';
import type { Screenshot as SharedScreenshot } from '../../shared/types';

export class CaptureManager {
  private screenshots: SharedScreenshot[] = [];

  /**
   * Capture the current screen
   * @deprecated Use screenCapture.captureScreen() instead
   */
  async captureScreen(): Promise<SharedScreenshot> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: screen.getPrimaryDisplay().size,
    });

    const primarySource = sources[0];
    if (!primarySource) {
      throw new Error('No screen source available');
    }

    const screenshot: SharedScreenshot = {
      id: `screenshot-${Date.now()}`,
      timestamp: Date.now(),
      imagePath: '', // TODO: Save to temp directory
      base64: primarySource.thumbnail.toDataURL(),
      width: primarySource.thumbnail.getSize().width,
      height: primarySource.thumbnail.getSize().height,
    };

    this.screenshots.push(screenshot);
    return screenshot;
  }

  /**
   * Get all captured screenshots
   */
  getScreenshots(): SharedScreenshot[] {
    return [...this.screenshots];
  }

  /**
   * Clear all screenshots
   */
  clear(): void {
    this.screenshots = [];
  }
}

export default CaptureManager;
