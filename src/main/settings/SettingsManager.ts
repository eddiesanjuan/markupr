/**
 * SettingsManager - Secure Settings Storage for FeedbackFlow
 *
 * Handles:
 * - Persistent settings storage with electron-store (schema validated)
 * - Secure API key storage with keytar (macOS Keychain, Windows Credential Manager)
 * - Settings migration between versions
 * - Change event emission for reactive updates
 * - IPC handlers for renderer access
 *
 * Security:
 * - API keys are NEVER stored in electron-store
 * - keytar uses OS-level secure storage (Keychain, Credential Manager)
 * - Settings are validated against schema before saving
 */

import Store from 'electron-store';
import * as keytar from 'keytar';
import { app, ipcMain } from 'electron';
import { join } from 'path';
import type { HotkeyConfig } from '../HotkeyManager';

// ============================================================================
// Types
// ============================================================================

/**
 * Complete application settings schema
 */
export interface AppSettings {
  // General
  outputDirectory: string;
  launchAtLogin: boolean;
  checkForUpdates: boolean;

  // Recording
  defaultCountdown: 0 | 3 | 5;
  showTranscriptionPreview: boolean;
  showAudioWaveform: boolean;

  // Capture
  pauseThreshold: number; // 500-3000ms
  minTimeBetweenCaptures: number; // 300-2000ms
  imageFormat: 'png' | 'jpeg';
  imageQuality: number; // 1-100 for jpeg
  maxImageWidth: number; // 800-2400

  // Transcription
  transcriptionService: 'deepgram';
  language: string;
  enableKeywordTriggers: boolean;

  // Hotkeys
  hotkeys: HotkeyConfig;

  // Appearance
  theme: 'dark' | 'light' | 'system';
  accentColor: string;

  // Audio
  audioDeviceId: string | null;

  // Advanced
  debugMode: boolean;
  keepAudioBackups: boolean;

  // Legacy (for migration compatibility - these are mapped to secure storage or new fields)
  /** @deprecated Use SettingsManager.getApiKey('deepgram') for secure storage */
  deepgramApiKey?: string;
  /** @deprecated Use audioDeviceId instead */
  preferredAudioDevice?: string;
  /** @deprecated Output format is always markdown */
  outputFormat?: 'markdown' | 'json';
  /** @deprecated Use imageQuality instead */
  screenshotQuality?: number;
  /** @deprecated Use pauseThreshold instead */
  pauseThresholdMs?: number;
  /** @deprecated Clipboard is always available */
  autoClipboard?: boolean;
}

/**
 * Settings change callback type
 */
type SettingsChangeCallback = (key: string, newValue: unknown, oldValue: unknown) => void;

/**
 * SettingsManager interface
 */
export interface ISettingsManager {
  // Core
  get<K extends keyof AppSettings>(key: K): AppSettings[K];
  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void;
  getAll(): AppSettings;
  reset(): void;

  // Secure storage (API keys)
  getApiKey(service: string): Promise<string | null>;
  setApiKey(service: string, key: string): Promise<void>;
  deleteApiKey(service: string): Promise<void>;
  hasApiKey(service: string): Promise<boolean>;

  // Events
  onChange(callback: SettingsChangeCallback): () => void;

  // Migration
  migrate(): void;

  // IPC
  registerIpcHandlers(): void;
}

// ============================================================================
// Constants
// ============================================================================

const KEYTAR_SERVICE = 'com.feedbackflow.app';
const SETTINGS_VERSION = 2;

/**
 * Default hotkey configuration
 */
const DEFAULT_HOTKEY_CONFIG: HotkeyConfig = {
  toggleRecording: 'CommandOrControl+Shift+F',
  manualScreenshot: 'CommandOrControl+Shift+S',
};

/**
 * Default settings values
 */
const DEFAULT_SETTINGS: AppSettings = {
  // General
  outputDirectory: '', // Set dynamically in constructor
  launchAtLogin: false,
  checkForUpdates: true,

  // Recording
  defaultCountdown: 3,
  showTranscriptionPreview: true,
  showAudioWaveform: true,

  // Capture
  pauseThreshold: 1500,
  minTimeBetweenCaptures: 500,
  imageFormat: 'png',
  imageQuality: 85,
  maxImageWidth: 1920,

  // Transcription
  transcriptionService: 'deepgram',
  language: 'en',
  enableKeywordTriggers: false,

  // Hotkeys
  hotkeys: { ...DEFAULT_HOTKEY_CONFIG },

  // Appearance
  theme: 'system',
  accentColor: '#3B82F6', // Blue-500

  // Audio
  audioDeviceId: null,

  // Advanced
  debugMode: false,
  keepAudioBackups: false,
};

/**
 * Schema for electron-store validation
 */
const SETTINGS_SCHEMA = {
  outputDirectory: { type: 'string' },
  launchAtLogin: { type: 'boolean' },
  checkForUpdates: { type: 'boolean' },
  defaultCountdown: { type: 'number', enum: [0, 3, 5] },
  showTranscriptionPreview: { type: 'boolean' },
  showAudioWaveform: { type: 'boolean' },
  pauseThreshold: { type: 'number', minimum: 500, maximum: 3000 },
  minTimeBetweenCaptures: { type: 'number', minimum: 300, maximum: 2000 },
  imageFormat: { type: 'string', enum: ['png', 'jpeg'] },
  imageQuality: { type: 'number', minimum: 1, maximum: 100 },
  maxImageWidth: { type: 'number', minimum: 800, maximum: 2400 },
  transcriptionService: { type: 'string', enum: ['deepgram'] },
  language: { type: 'string' },
  enableKeywordTriggers: { type: 'boolean' },
  hotkeys: {
    type: 'object',
    properties: {
      toggleRecording: { type: 'string' },
      manualScreenshot: { type: 'string' },
    },
  },
  theme: { type: 'string', enum: ['dark', 'light', 'system'] },
  accentColor: { type: 'string' },
  audioDeviceId: { type: ['string', 'null'] },
  debugMode: { type: 'boolean' },
  keepAudioBackups: { type: 'boolean' },
} as const;

// ============================================================================
// Implementation
// ============================================================================

export class SettingsManager implements ISettingsManager {
  private store: Store<AppSettings>;
  private changeCallbacks: Set<SettingsChangeCallback> = new Set();
  private ipcRegistered = false;

  constructor() {
    // Initialize electron-store with schema
    // We use type assertion here because electron-store's Schema type is overly strict
    // and doesn't match JSON Schema 7 format we're using
    this.store = new Store<AppSettings>({
      name: 'settings',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      schema: SETTINGS_SCHEMA as any,
      defaults: this.getDefaultsWithPaths(),
      clearInvalidConfig: false, // Don't clear on schema violation, migrate instead
    });

    // Run migrations
    this.migrate();

    console.log('[SettingsManager] Initialized with settings version:', SETTINGS_VERSION);
  }

  /**
   * Get defaults with dynamic paths resolved
   */
  private getDefaultsWithPaths(): AppSettings {
    const documentsPath = app.isReady()
      ? app.getPath('documents')
      : join(process.env.HOME || process.env.USERPROFILE || '', 'Documents');

    return {
      ...DEFAULT_SETTINGS,
      outputDirectory: join(documentsPath, 'FeedbackFlow'),
    };
  }

  // --------------------------------------------------------------------------
  // Core Methods
  // --------------------------------------------------------------------------

  /**
   * Get a single setting value
   */
  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.store.get(key);
  }

  /**
   * Set a single setting value
   */
  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    const oldValue = this.store.get(key);

    // Validate before setting
    if (!this.validateSetting(key, value)) {
      console.warn(`[SettingsManager] Invalid value for ${key}:`, value);
      return;
    }

    this.store.set(key, value);
    this.emitChange(key, value, oldValue);

    console.log(`[SettingsManager] Set ${key}:`, value);
  }

  /**
   * Get all settings
   */
  getAll(): AppSettings {
    return this.store.store;
  }

  /**
   * Reset all settings to defaults
   */
  reset(): void {
    const oldSettings = this.getAll();
    const defaults = this.getDefaultsWithPaths();

    this.store.clear();
    this.store.set(defaults);

    // Emit changes for all settings
    for (const key of Object.keys(defaults) as Array<keyof AppSettings>) {
      if (oldSettings[key] !== defaults[key]) {
        this.emitChange(key, defaults[key], oldSettings[key]);
      }
    }

    console.log('[SettingsManager] Reset to defaults');
  }

  /**
   * Update multiple settings at once (legacy compatibility method)
   * Note: For new code, prefer using set() for individual settings
   */
  update(updates: Partial<AppSettings>): AppSettings {
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        this.set(key as keyof AppSettings, value as AppSettings[keyof AppSettings]);
      }
    }
    return this.getAll();
  }

  // --------------------------------------------------------------------------
  // Validation
  // --------------------------------------------------------------------------

  /**
   * Validate a single setting value
   */
  private validateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): boolean {
    switch (key) {
      case 'pauseThreshold':
        return typeof value === 'number' && value >= 500 && value <= 3000;

      case 'minTimeBetweenCaptures':
        return typeof value === 'number' && value >= 300 && value <= 2000;

      case 'imageQuality':
        return typeof value === 'number' && value >= 1 && value <= 100;

      case 'maxImageWidth':
        return typeof value === 'number' && value >= 800 && value <= 2400;

      case 'defaultCountdown':
        return value === 0 || value === 3 || value === 5;

      case 'imageFormat':
        return value === 'png' || value === 'jpeg';

      case 'theme':
        return value === 'dark' || value === 'light' || value === 'system';

      case 'transcriptionService':
        return value === 'deepgram';

      case 'accentColor':
        return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value as string);

      default:
        return true;
    }
  }

  // --------------------------------------------------------------------------
  // Secure Storage (API Keys)
  // --------------------------------------------------------------------------

  /**
   * Get an API key from secure storage
   */
  async getApiKey(service: string): Promise<string | null> {
    try {
      const key = await keytar.getPassword(KEYTAR_SERVICE, service);
      return key;
    } catch (error) {
      console.error(`[SettingsManager] Failed to get API key for ${service}:`, error);
      return null;
    }
  }

  /**
   * Store an API key in secure storage
   */
  async setApiKey(service: string, key: string): Promise<void> {
    try {
      await keytar.setPassword(KEYTAR_SERVICE, service, key);
      console.log(`[SettingsManager] Stored API key for ${service}`);
    } catch (error) {
      console.error(`[SettingsManager] Failed to store API key for ${service}:`, error);
      throw new Error(`Failed to store API key: ${error}`);
    }
  }

  /**
   * Delete an API key from secure storage
   */
  async deleteApiKey(service: string): Promise<void> {
    try {
      await keytar.deletePassword(KEYTAR_SERVICE, service);
      console.log(`[SettingsManager] Deleted API key for ${service}`);
    } catch (error) {
      console.error(`[SettingsManager] Failed to delete API key for ${service}:`, error);
      throw new Error(`Failed to delete API key: ${error}`);
    }
  }

  /**
   * Check if an API key exists in secure storage
   */
  async hasApiKey(service: string): Promise<boolean> {
    const key = await this.getApiKey(service);
    return key !== null && key.length > 0;
  }

  // --------------------------------------------------------------------------
  // Change Events
  // --------------------------------------------------------------------------

  /**
   * Subscribe to settings changes
   * @returns Unsubscribe function
   */
  onChange(callback: SettingsChangeCallback): () => void {
    this.changeCallbacks.add(callback);
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  /**
   * Emit a change event to all subscribers
   */
  private emitChange(key: string, newValue: unknown, oldValue: unknown): void {
    for (const callback of this.changeCallbacks) {
      try {
        callback(key, newValue, oldValue);
      } catch (error) {
        console.error('[SettingsManager] Error in change callback:', error);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Migration
  // --------------------------------------------------------------------------

  /**
   * Run settings migrations
   */
  migrate(): void {
    const currentVersion = this.store.get('_version' as keyof AppSettings) as number | undefined;

    if (currentVersion === SETTINGS_VERSION) {
      return;
    }

    console.log(`[SettingsManager] Migrating from version ${currentVersion || 1} to ${SETTINGS_VERSION}`);

    // Migration from v1 (legacy settings)
    if (!currentVersion || currentVersion < 2) {
      this.migrateV1ToV2();
    }

    // Set current version
    this.store.set('_version' as keyof AppSettings, SETTINGS_VERSION as unknown as AppSettings[keyof AppSettings]);
  }

  /**
   * Migrate from v1 (legacy JSON settings) to v2 (electron-store with new schema)
   */
  private migrateV1ToV2(): void {
    console.log('[SettingsManager] Running v1 -> v2 migration');

    // Map old settings to new settings
    const legacyMappings: Record<string, keyof AppSettings> = {
      screenshotQuality: 'imageQuality',
      pauseThresholdMs: 'pauseThreshold',
    };

    for (const [oldKey, newKey] of Object.entries(legacyMappings)) {
      const oldValue = this.store.get(oldKey as keyof AppSettings);
      if (oldValue !== undefined) {
        this.store.set(newKey, oldValue);
        this.store.delete(oldKey as keyof AppSettings);
        console.log(`[SettingsManager] Migrated ${oldKey} -> ${newKey}`);
      }
    }

    // Remove deprecated settings
    const deprecatedKeys = ['autoClipboard', 'outputFormat', 'deepgramApiKey'];
    for (const key of deprecatedKeys) {
      if (this.store.has(key as keyof AppSettings)) {
        this.store.delete(key as keyof AppSettings);
        console.log(`[SettingsManager] Removed deprecated setting: ${key}`);
      }
    }

    // Ensure all new settings have defaults
    const defaults = this.getDefaultsWithPaths();
    for (const [key, value] of Object.entries(defaults)) {
      if (!this.store.has(key as keyof AppSettings)) {
        this.store.set(key as keyof AppSettings, value as AppSettings[keyof AppSettings]);
      }
    }
  }

  // --------------------------------------------------------------------------
  // IPC Handlers
  // --------------------------------------------------------------------------

  /**
   * Register IPC handlers for renderer communication
   */
  registerIpcHandlers(): void {
    if (this.ipcRegistered) {
      console.warn('[SettingsManager] IPC handlers already registered');
      return;
    }

    // Get single setting
    ipcMain.handle('settings:get', (_, key: keyof AppSettings) => {
      return this.get(key);
    });

    // Get all settings
    ipcMain.handle('settings:getAll', () => {
      return this.getAll();
    });

    // Set single setting
    ipcMain.handle('settings:set', (_, key: keyof AppSettings, value: AppSettings[keyof AppSettings]) => {
      this.set(key, value);
      return this.get(key);
    });

    // Reset to defaults
    ipcMain.handle('settings:reset', () => {
      this.reset();
      return this.getAll();
    });

    // Get API key (secure)
    ipcMain.handle('settings:getApiKey', async (_, service: string) => {
      return this.getApiKey(service);
    });

    // Set API key (secure)
    ipcMain.handle('settings:setApiKey', async (_, service: string, key: string) => {
      await this.setApiKey(service, key);
      return true;
    });

    // Delete API key (secure)
    ipcMain.handle('settings:deleteApiKey', async (_, service: string) => {
      await this.deleteApiKey(service);
      return true;
    });

    // Check if API key exists
    ipcMain.handle('settings:hasApiKey', async (_, service: string) => {
      return this.hasApiKey(service);
    });

    this.ipcRegistered = true;
    console.log('[SettingsManager] IPC handlers registered');
  }

  /**
   * Get the storage path for debugging
   */
  getStorePath(): string {
    return this.store.path;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let instance: SettingsManager | null = null;

/**
 * Get or create the SettingsManager singleton
 */
export function getSettingsManager(): SettingsManager {
  if (!instance) {
    instance = new SettingsManager();
  }
  return instance;
}

/**
 * Create a new SettingsManager instance (for testing)
 */
export function createSettingsManager(): SettingsManager {
  return new SettingsManager();
}

// Singleton instance
export const settingsManager = getSettingsManager();

export { DEFAULT_SETTINGS, SETTINGS_VERSION };
// Note: AppSettings and ISettingsManager are already exported via `export interface` above
export default settingsManager;
