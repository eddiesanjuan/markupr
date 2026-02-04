/**
 * FeedbackFlow - Auto Updater Manager
 *
 * Handles automatic updates using electron-updater with GitHub Releases.
 *
 * Features:
 * - Check for updates on app launch
 * - Background download of updates
 * - Show release notes to user
 * - User-controlled restart for installation
 * - Download progress indicator
 *
 * The update flow:
 * 1. App launches -> check for updates
 * 2. Update available -> notify renderer with version & release notes
 * 3. User clicks "Download" -> download in background with progress
 * 4. Download complete -> notify renderer that update is ready
 * 5. User clicks "Restart Now" -> quit and install
 */

import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
type UpdateCheckResult = electronUpdater.UpdateCheckResult;
type UpdateInfo = electronUpdater.UpdateInfo;
type ProgressInfo = electronUpdater.ProgressInfo;
import { BrowserWindow, ipcMain, app } from 'electron';
import electronLog from 'electron-log';
const log = electronLog.default ?? electronLog;
import { IPC_CHANNELS, type UpdateStatusPayload, type UpdateStatusType } from '../shared/types';

// =============================================================================
// Types
// =============================================================================

interface UpdateManagerState {
  status: UpdateStatusType;
  currentVersion: string;
  availableVersion?: string;
  releaseNotes?: string | null;
  downloadProgress?: number;
}

// =============================================================================
// AutoUpdater Manager Class
// =============================================================================

class AutoUpdaterManager {
  private mainWindow: BrowserWindow | null = null;
  private state: UpdateManagerState;
  private initialized = false;

  constructor() {
    this.state = {
      status: 'idle',
      currentVersion: app.getVersion(),
    };
  }

  /**
   * Initialize the auto-updater with a reference to the main window
   */
  initialize(window: BrowserWindow): void {
    if (this.initialized) {
      console.warn('[AutoUpdater] Already initialized');
      return;
    }

    this.mainWindow = window;
    this.initialized = true;

    // Configure logging
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    log.info('[AutoUpdater] Initializing auto-updater');

    // Configure update behavior
    autoUpdater.autoDownload = false; // Let user decide when to download
    autoUpdater.autoInstallOnAppQuit = true; // Install on quit if downloaded
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;

    // Set up event handlers
    this.setupEventHandlers();

    // Set up IPC handlers
    this.setupIPCHandlers();

    // Check for updates on startup (with delay to not slow app launch)
    setTimeout(() => {
      this.checkForUpdates();
    }, 5000);

    log.info('[AutoUpdater] Initialized successfully');
  }

  /**
   * Set up auto-updater event handlers
   */
  private setupEventHandlers(): void {
    // Checking for updates
    autoUpdater.on('checking-for-update', () => {
      log.info('[AutoUpdater] Checking for update...');
      this.updateState('checking');
    });

    // Update available
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      log.info(`[AutoUpdater] Update available: ${info.version}`);
      this.state.availableVersion = info.version;
      this.state.releaseNotes = this.parseReleaseNotes(info.releaseNotes);
      this.sendStatus('available', {
        version: info.version,
        releaseNotes: this.state.releaseNotes,
        releaseDate: info.releaseDate,
      });
    });

    // No update available
    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      log.info(`[AutoUpdater] No update available. Current: ${this.state.currentVersion}, Latest: ${info.version}`);
      this.updateState('not-available');
    });

    // Download progress
    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      const percent = Math.round(progress.percent);
      log.info(`[AutoUpdater] Download progress: ${percent}%`);
      this.state.downloadProgress = percent;
      this.sendStatus('downloading', {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        total: progress.total,
        transferred: progress.transferred,
      });
    });

    // Update downloaded
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      log.info(`[AutoUpdater] Update downloaded: ${info.version}`);
      this.sendStatus('ready', {
        version: info.version,
        releaseNotes: this.parseReleaseNotes(info.releaseNotes),
      });
    });

    // Error handling
    autoUpdater.on('error', (error: Error) => {
      log.error('[AutoUpdater] Error:', error);
      this.sendStatus('error', {
        message: error.message,
      });
    });
  }

  /**
   * Set up IPC handlers for renderer communication
   */
  private setupIPCHandlers(): void {
    // Check for updates
    ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => {
      return this.checkForUpdates();
    });

    // Download update
    ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, async () => {
      return this.downloadUpdate();
    });

    // Install update (quit and install)
    ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, () => {
      return this.installUpdate();
    });
  }

  /**
   * Check for available updates
   */
  async checkForUpdates(): Promise<UpdateCheckResult | null> {
    try {
      log.info('[AutoUpdater] Manual check for updates');
      const result = await autoUpdater.checkForUpdates();
      return result;
    } catch (error) {
      log.error('[AutoUpdater] Check for updates failed:', error);
      this.sendStatus('error', {
        message: error instanceof Error ? error.message : 'Failed to check for updates',
      });
      return null;
    }
  }

  /**
   * Download the available update
   */
  async downloadUpdate(): Promise<void> {
    try {
      log.info('[AutoUpdater] Starting download');
      this.updateState('downloading');
      await autoUpdater.downloadUpdate();
    } catch (error) {
      log.error('[AutoUpdater] Download failed:', error);
      this.sendStatus('error', {
        message: error instanceof Error ? error.message : 'Failed to download update',
      });
    }
  }

  /**
   * Install the downloaded update (quits app and installs)
   */
  installUpdate(): void {
    log.info('[AutoUpdater] Installing update and restarting');
    // Quit and install
    // isSilent: false - show installer UI
    // isForceRunAfter: true - restart app after update
    autoUpdater.quitAndInstall(false, true);
  }

  /**
   * Update internal state and send to renderer
   */
  private updateState(status: UpdateStatusType): void {
    this.state.status = status;
    this.sendStatus(status);
  }

  /**
   * Send status update to renderer process
   */
  private sendStatus(status: UpdateStatusType, data?: Partial<UpdateStatusPayload>): void {
    const payload: UpdateStatusPayload = {
      status,
      ...data,
    };

    this.mainWindow?.webContents.send(IPC_CHANNELS.UPDATE_STATUS, payload);
  }

  /**
   * Parse release notes from various formats
   */
  private parseReleaseNotes(notes: string | UpdateInfo['releaseNotes'] | null | undefined): string | null {
    if (!notes) return null;

    if (typeof notes === 'string') {
      return notes;
    }

    // Handle array of release notes (multiple releases)
    if (Array.isArray(notes)) {
      return notes
        .map((note) => {
          if (typeof note === 'string') return note;
          return note.note || '';
        })
        .join('\n\n');
    }

    return null;
  }

  /**
   * Get current update state
   */
  getState(): UpdateManagerState {
    return { ...this.state };
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.mainWindow = null;
    this.initialized = false;
    log.info('[AutoUpdater] Destroyed');
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const autoUpdaterManager = new AutoUpdaterManager();
