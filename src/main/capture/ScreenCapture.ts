/**
 * ScreenCapture Service for FeedbackFlow
 *
 * Production-quality screen capture using Electron's desktopCapturer API.
 * Handles:
 * - macOS screen recording permissions
 * - Window and full-screen capture
 * - Multi-monitor support with display detection
 * - Retina/HiDPI display support (per-monitor)
 * - Image resizing via Electron's nativeImage (no native dependencies)
 * - Display hotplug events (monitors added/removed)
 */

import {
  desktopCapturer,
  screen,
  systemPreferences,
  BrowserWindow,
  Display,
  nativeImage,
} from 'electron';
import { randomUUID } from 'crypto';
import { errorHandler } from '../ErrorHandler';

// ============================================================================
// Types
// ============================================================================

/**
 * Display information with layout positioning
 */
export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
  rotation: 0 | 90 | 180 | 270;
  internal: boolean;
}

/**
 * Capture source with optional display info for screen sources
 */
export interface CaptureSource {
  id: string;
  name: string;
  type: 'screen' | 'window';
  thumbnail?: string;
  appIcon?: string;
  display?: DisplayInfo;
}

export interface Screenshot {
  id: string;
  buffer: Buffer;
  width: number;
  height: number;
  timestamp: number;
  sourceId: string;
  displayId?: number;
}

/**
 * Callback for display change events
 */
export type DisplayChangeCallback = (displays: DisplayInfo[]) => void;

export interface ScreenCaptureService {
  checkPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  getDisplays(): DisplayInfo[];
  getSources(): Promise<CaptureSource[]>;
  capture(sourceId: string): Promise<Screenshot>;
  captureScreen(): Promise<Screenshot>;
  captureDisplay(displayId: number): Promise<Screenshot>;
  onDisplaysChanged(callback: DisplayChangeCallback): () => void;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_WIDTH = 1200;
const THUMBNAIL_SIZE = { width: 150, height: 150 };
const CAPTURE_TIMEOUT_MS = 10000;

// ============================================================================
// Implementation
// ============================================================================

class ScreenCaptureServiceImpl implements ScreenCaptureService {
  private captureWindow: BrowserWindow | null = null;
  private isCapturing = false;
  private displayChangeCallbacks: Set<DisplayChangeCallback> = new Set();
  private displayChangeHandlersBound = false;

  constructor() {
    // Bind display change handlers lazily when first callback is registered
  }

  // ==========================================================================
  // Display Management
  // ==========================================================================

  /**
   * Get all connected displays with layout information
   * Returns displays sorted by position (left-to-right, top-to-bottom)
   */
  getDisplays(): DisplayInfo[] {
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();

    // Map Electron displays to our DisplayInfo format
    const displayInfos: DisplayInfo[] = displays.map((display) => {
      const isPrimary = display.id === primaryDisplay.id;

      // Generate friendly label
      let label: string;
      if (isPrimary) {
        label = 'Main Display';
      } else if (display.internal) {
        label = 'Built-in Display';
      } else {
        // Number external displays left-to-right
        const externalDisplays = displays.filter(
          (d) => d.id !== primaryDisplay.id && !d.internal
        );
        const externalIndex = externalDisplays.findIndex(
          (d) => d.id === display.id
        );
        label = `Display ${externalIndex + 2}`;
      }

      return {
        id: display.id,
        label,
        bounds: { ...display.bounds },
        workArea: { ...display.workArea },
        scaleFactor: display.scaleFactor,
        isPrimary,
        rotation: display.rotation as 0 | 90 | 180 | 270,
        internal: display.internal ?? false,
      };
    });

    // Sort by position: left-to-right, then top-to-bottom
    return displayInfos.sort((a, b) => {
      if (a.bounds.x !== b.bounds.x) {
        return a.bounds.x - b.bounds.x;
      }
      return a.bounds.y - b.bounds.y;
    });
  }

  /**
   * Register a callback for display configuration changes
   * @returns Unsubscribe function
   */
  onDisplaysChanged(callback: DisplayChangeCallback): () => void {
    this.displayChangeCallbacks.add(callback);

    // Bind Electron screen events on first registration
    if (!this.displayChangeHandlersBound) {
      this.bindDisplayChangeHandlers();
      this.displayChangeHandlersBound = true;
    }

    // Return unsubscribe function
    return () => {
      this.displayChangeCallbacks.delete(callback);
    };
  }

  /**
   * Bind Electron screen events for display changes
   */
  private bindDisplayChangeHandlers(): void {
    const notifyCallbacks = () => {
      const displays = this.getDisplays();
      this.displayChangeCallbacks.forEach((callback) => {
        try {
          callback(displays);
        } catch (error) {
          errorHandler.log('error', 'Display change callback error', {
            component: 'ScreenCapture',
            operation: 'displayChangeCallback',
            error: (error as Error).message,
          });
        }
      });
    };

    // Display added (monitor connected)
    screen.on('display-added', (_event, newDisplay: Display) => {
      errorHandler.log('info', 'Display added', {
        component: 'ScreenCapture',
        operation: 'displayAdded',
        data: {
          displayId: newDisplay.id,
          bounds: newDisplay.bounds,
        },
      });
      notifyCallbacks();
    });

    // Display removed (monitor disconnected)
    screen.on('display-removed', (_event, oldDisplay: Display) => {
      errorHandler.log('info', 'Display removed', {
        component: 'ScreenCapture',
        operation: 'displayRemoved',
        data: {
          displayId: oldDisplay.id,
        },
      });
      notifyCallbacks();
    });

    // Display metrics changed (resolution, scale factor, position)
    screen.on(
      'display-metrics-changed',
      (_event, display: Display, changedMetrics: string[]) => {
        errorHandler.log('info', 'Display metrics changed', {
          component: 'ScreenCapture',
          operation: 'displayMetricsChanged',
          data: {
            displayId: display.id,
            changedMetrics,
          },
        });
        notifyCallbacks();
      }
    );
  }

  /**
   * Get display by ID
   */
  private getDisplayById(displayId: number): Display | undefined {
    return screen.getAllDisplays().find((d) => d.id === displayId);
  }

  /**
   * Check if screen recording permission is granted (macOS)
   * On other platforms, always returns true
   */
  async checkPermission(): Promise<boolean> {
    if (process.platform !== 'darwin') {
      return true;
    }

    try {
      const status = systemPreferences.getMediaAccessStatus('screen');
      const granted = status === 'granted';

      if (!granted) {
        errorHandler.log('info', 'Screen recording permission not granted', {
          component: 'ScreenCapture',
          operation: 'checkPermission',
          data: { status },
        });
      }

      return granted;
    } catch (error) {
      errorHandler.log('error', 'Error checking screen permission', {
        component: 'ScreenCapture',
        operation: 'checkPermission',
        error: (error as Error).message,
      });
      // If we can't check, assume we need to request
      return false;
    }
  }

  /**
   * Request screen recording permission (macOS)
   * Opens System Preferences on macOS, returns true on other platforms
   */
  async requestPermission(): Promise<boolean> {
    if (process.platform !== 'darwin') {
      return true;
    }

    try {
      const status = systemPreferences.getMediaAccessStatus('screen');

      if (status === 'granted') {
        return true;
      }

      if (status === 'denied' || status === 'restricted') {
        // User previously denied - use error handler to guide them
        errorHandler.log('warn', 'Screen recording permission denied', {
          component: 'ScreenCapture',
          operation: 'requestPermission',
          data: { status },
        });
        await errorHandler.handlePermissionError('screen');
        return false;
      }

      // Status is 'not-determined' - trigger the permission prompt
      // On macOS, the permission prompt is triggered automatically when we try to capture
      // We'll do a test capture to trigger it
      try {
        await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1, height: 1 },
        });

        // Check status again after the prompt
        const newStatus = systemPreferences.getMediaAccessStatus('screen');
        return newStatus === 'granted';
      } catch {
        // Prompt was shown but user may have denied
        return false;
      }
    } catch (error) {
      errorHandler.log('error', 'Error requesting screen permission', {
        component: 'ScreenCapture',
        operation: 'requestPermission',
        error: (error as Error).message,
      });
      return false;
    }
  }

  /**
   * Get all available capture sources (screens and windows)
   * Screen sources include display information for multi-monitor support
   */
  async getSources(): Promise<CaptureSource[]> {
    try {
      // Check permission first on macOS
      if (process.platform === 'darwin') {
        const hasPermission = await this.checkPermission();
        if (!hasPermission) {
          console.warn('[ScreenCapture] No screen recording permission');
          return [];
        }
      }

      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: THUMBNAIL_SIZE,
        fetchWindowIcons: true,
      });

      // Get display info for matching screen sources
      const displays = this.getDisplays();

      return sources.map((source) => {
        const isScreen = source.id.startsWith('screen:');

        if (isScreen) {
          // Extract display index from source ID (e.g., "screen:0:0" -> 0)
          const displayIndex = parseInt(source.id.split(':')[1], 10);
          const display = displays[displayIndex];

          return {
            id: source.id,
            name: display?.label || source.name,
            type: 'screen' as const,
            thumbnail: source.thumbnail?.toDataURL() || undefined,
            display,
          };
        }

        return {
          id: source.id,
          name: source.name,
          type: 'window' as const,
          thumbnail: source.thumbnail?.toDataURL() || undefined,
          appIcon: source.appIcon?.toDataURL() || undefined,
        };
      });
    } catch (error) {
      errorHandler.handleCaptureError(error as Error, {
        component: 'ScreenCapture',
        operation: 'getSources',
      });
      return [];
    }
  }

  /**
   * Capture a specific source by ID
   * @param sourceId - The source ID from getSources()
   */
  async capture(sourceId: string): Promise<Screenshot> {
    if (this.isCapturing) {
      throw new Error('Capture already in progress');
    }

    this.isCapturing = true;

    try {
      // Check permission on macOS
      if (process.platform === 'darwin') {
        const hasPermission = await this.checkPermission();
        if (!hasPermission) {
          const permissionError = new Error('Screen recording permission not granted');
          errorHandler.log('error', 'Screen capture failed - no permission', {
            component: 'ScreenCapture',
            operation: 'capture',
            data: { sourceId },
          });
          throw permissionError;
        }
      }

      // Get the source to determine dimensions
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: this.getCaptureSize(),
      });

      const source = sources.find((s) => s.id === sourceId);
      if (!source) {
        const sourceError = new Error(`Source not found: ${sourceId}`);
        errorHandler.log('warn', 'Capture source not found', {
          component: 'ScreenCapture',
          operation: 'capture',
          data: { sourceId, availableSources: sources.length },
        });
        throw sourceError;
      }

      // Capture using the thumbnail (high resolution)
      const thumbnail = source.thumbnail;
      if (!thumbnail || thumbnail.isEmpty()) {
        const emptyError = new Error('Failed to capture screenshot - empty thumbnail');
        errorHandler.log('warn', 'Empty thumbnail from capture', {
          component: 'ScreenCapture',
          operation: 'capture',
          data: { sourceId, sourceName: source.name },
        });
        throw emptyError;
      }

      // Convert NativeImage to PNG buffer
      const pngBuffer = thumbnail.toPNG();

      // Resize using nativeImage if needed
      const { buffer: resizedBuffer, width, height } = await this.resizeImage(pngBuffer);

      const screenshot: Screenshot = {
        id: randomUUID(),
        buffer: resizedBuffer,
        width,
        height,
        timestamp: Date.now(),
        sourceId,
      };

      return screenshot;
    } finally {
      this.isCapturing = false;
    }
  }

  /**
   * Capture the primary screen
   * Convenience method that captures the main display
   */
  async captureScreen(): Promise<Screenshot> {
    try {
      // Check permission on macOS
      if (process.platform === 'darwin') {
        const hasPermission = await this.checkPermission();
        if (!hasPermission) {
          throw new Error('Screen recording permission not granted');
        }
      }

      // Get screen sources
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: this.getCaptureSize(),
      });

      // Find the primary screen
      const primaryDisplay = screen.getPrimaryDisplay();
      const primarySource = sources.find((s) => {
        // On macOS, screen IDs often include the display ID
        // Try to match by name or just use the first one
        return (
          s.name.toLowerCase().includes('entire screen') ||
          s.name.toLowerCase().includes('screen 1') ||
          s.id.includes(primaryDisplay.id.toString())
        );
      }) || sources[0];

      if (!primarySource) {
        throw new Error('No screen source available');
      }

      return this.capture(primarySource.id);
    } catch (error) {
      console.error('[ScreenCapture] Error capturing screen:', error);
      throw error;
    }
  }

  /**
   * Capture a specific display by its Electron display ID
   * Useful for multi-monitor setups where you want to capture a specific monitor
   */
  async captureDisplay(displayId: number): Promise<Screenshot> {
    try {
      // Verify the display exists
      const display = this.getDisplayById(displayId);
      if (!display) {
        throw new Error(`Display not found: ${displayId}`);
      }

      // Check permission on macOS
      if (process.platform === 'darwin') {
        const hasPermission = await this.checkPermission();
        if (!hasPermission) {
          throw new Error('Screen recording permission not granted');
        }
      }

      // Get all displays to find the index
      const displays = screen.getAllDisplays();
      const displayIndex = displays.findIndex((d) => d.id === displayId);

      if (displayIndex === -1) {
        throw new Error(`Display index not found for ID: ${displayId}`);
      }

      // Get screen sources with appropriate size for this display
      const captureSize = this.getCaptureSizeForDisplay(display);
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: captureSize,
      });

      // Find the source for this display
      // Source IDs are typically in format "screen:INDEX:0"
      const sourceId = `screen:${displayIndex}:0`;
      const source = sources.find((s) => s.id === sourceId);

      if (!source) {
        // Fallback: try to find by matching bounds or just use index
        errorHandler.log('warn', 'Could not find exact source for display', {
          component: 'ScreenCapture',
          operation: 'captureDisplay',
          data: { displayId, displayIndex, availableSources: sources.map((s) => s.id) },
        });

        // Try by index
        if (sources[displayIndex]) {
          return this.captureFromSourceWithDisplay(sources[displayIndex], display);
        }

        throw new Error(`No capture source for display: ${displayId}`);
      }

      return this.captureFromSourceWithDisplay(source, display);
    } catch (error) {
      errorHandler.log('error', 'Error capturing display', {
        component: 'ScreenCapture',
        operation: 'captureDisplay',
        data: { displayId },
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Internal: capture from a source and attach display info
   */
  private async captureFromSourceWithDisplay(
    source: Electron.DesktopCapturerSource,
    display: Display
  ): Promise<Screenshot> {
    const thumbnail = source.thumbnail;
    if (!thumbnail || thumbnail.isEmpty()) {
      throw new Error('Failed to capture screenshot - empty thumbnail');
    }

    const pngBuffer = thumbnail.toPNG();
    const { buffer: resizedBuffer, width, height } = await this.resizeImage(pngBuffer);

    return {
      id: randomUUID(),
      buffer: resizedBuffer,
      width,
      height,
      timestamp: Date.now(),
      sourceId: source.id,
      displayId: display.id,
    };
  }

  /**
   * Get the optimal capture size accounting for HiDPI displays
   * Uses the largest display dimensions to ensure we capture everything
   */
  private getCaptureSize(): { width: number; height: number } {
    const displays = screen.getAllDisplays();

    // Find the largest physical resolution across all displays
    let maxWidth = 0;
    let maxHeight = 0;

    for (const display of displays) {
      const physicalWidth = Math.round(display.size.width * display.scaleFactor);
      const physicalHeight = Math.round(display.size.height * display.scaleFactor);

      maxWidth = Math.max(maxWidth, physicalWidth);
      maxHeight = Math.max(maxHeight, physicalHeight);
    }

    // Fallback to primary display if something went wrong
    if (maxWidth === 0 || maxHeight === 0) {
      const primaryDisplay = screen.getPrimaryDisplay();
      return {
        width: Math.round(primaryDisplay.size.width * primaryDisplay.scaleFactor),
        height: Math.round(primaryDisplay.size.height * primaryDisplay.scaleFactor),
      };
    }

    return { width: maxWidth, height: maxHeight };
  }

  /**
   * Get capture size for a specific display
   * Accounts for that display's specific scale factor (HiDPI support per monitor)
   */
  private getCaptureSizeForDisplay(display: Display): { width: number; height: number } {
    const { width, height } = display.size;
    const scaleFactor = display.scaleFactor;

    return {
      width: Math.round(width * scaleFactor),
      height: Math.round(height * scaleFactor),
    };
  }

  /**
   * Resize image to max width while maintaining aspect ratio
   * Uses Electron's nativeImage for efficient image processing (no native dependencies)
   */
  private async resizeImage(buffer: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
    try {
      const image = nativeImage.createFromBuffer(buffer);
      const { width, height } = image.getSize();

      // Only resize if wider than max
      if (width > MAX_WIDTH) {
        // Calculate new height maintaining aspect ratio
        const aspectRatio = height / width;
        const newWidth = MAX_WIDTH;
        const newHeight = Math.round(newWidth * aspectRatio);

        const resized = image.resize({ width: newWidth, height: newHeight });
        return {
          buffer: resized.toPNG(),
          width: newWidth,
          height: newHeight,
        };
      }

      // Return original dimensions
      return {
        buffer: image.toPNG(),
        width,
        height,
      };
    } catch (error) {
      console.error('[ScreenCapture] Error resizing image:', error);
      // Return original if resize fails - try to get dimensions
      try {
        const fallbackImage = nativeImage.createFromBuffer(buffer);
        const { width, height } = fallbackImage.getSize();
        return { buffer, width, height };
      } catch {
        // Absolute fallback
        return { buffer, width: 0, height: 0 };
      }
    }
  }

  /**
   * Alternative capture method using BrowserWindow and MediaStream
   * More complex but provides higher quality for some use cases
   * @deprecated Use capture() instead - kept for reference
   */
  private async captureWithMediaStream(sourceId: string): Promise<Screenshot> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.cleanupCaptureWindow();
        reject(new Error('Capture timeout'));
      }, CAPTURE_TIMEOUT_MS);

      try {
        // Create a hidden window for capture
        this.captureWindow = new BrowserWindow({
          width: 1,
          height: 1,
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        });

        // Inject capture script
        const captureScript = `
          (async () => {
            try {
              const stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                  mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: '${sourceId}',
                  }
                }
              });

              const video = document.createElement('video');
              video.srcObject = stream;
              await video.play();

              const canvas = document.createElement('canvas');
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;

              const ctx = canvas.getContext('2d');
              ctx.drawImage(video, 0, 0);

              stream.getTracks().forEach(track => track.stop());

              const dataUrl = canvas.toDataURL('image/png');
              return { success: true, dataUrl, width: canvas.width, height: canvas.height };
            } catch (error) {
              return { success: false, error: error.message };
            }
          })();
        `;

        this.captureWindow.webContents.executeJavaScript(captureScript)
          .then(async (result: { success: boolean; dataUrl?: string; width?: number; height?: number; error?: string }) => {
            clearTimeout(timeout);
            this.cleanupCaptureWindow();

            if (!result.success || !result.dataUrl) {
              reject(new Error(result.error || 'Capture failed'));
              return;
            }

            // Convert data URL to buffer
            const base64Data = result.dataUrl.replace(/^data:image\/png;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');

            // Resize if needed
            const { buffer: resizedBuffer, width, height } = await this.resizeImage(buffer);

            resolve({
              id: randomUUID(),
              buffer: resizedBuffer,
              width,
              height,
              timestamp: Date.now(),
              sourceId,
            });
          })
          .catch((error) => {
            clearTimeout(timeout);
            this.cleanupCaptureWindow();
            reject(error);
          });
      } catch (error) {
        clearTimeout(timeout);
        this.cleanupCaptureWindow();
        reject(error);
      }
    });
  }

  /**
   * Clean up the hidden capture window
   */
  private cleanupCaptureWindow(): void {
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      this.captureWindow.close();
    }
    this.captureWindow = null;
  }
}

// ============================================================================
// Exports
// ============================================================================

// Singleton instance
export const screenCapture = new ScreenCaptureServiceImpl();

// Export the implementation class (use ScreenCaptureService interface for typing)
export { ScreenCaptureServiceImpl };
