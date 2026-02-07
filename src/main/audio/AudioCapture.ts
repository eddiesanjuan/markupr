/**
 * AudioCapture.ts - Production Audio Capture Service for FeedbackFlow
 *
 * Architecture:
 * - Renderer process captures audio via getUserMedia (browser API)
 * - Audio data streams to main process via IPC
 * - Main process handles buffering, VAD, and recovery
 *
 * Why this approach:
 * - getUserMedia is only available in renderer (browser context)
 * - Main process provides reliability, buffering, and transcription coordination
 * - IPC overhead is minimal for 100ms chunks at 16kHz mono
 */

import { ipcMain, systemPreferences, BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { app } from 'electron';
import { errorHandler } from '../ErrorHandler';
import { IPC_CHANNELS } from '../../shared/types';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface AudioChunk {
  buffer: Buffer;
  timestamp: number;
  duration: number;
  sampleRate: number;
}

export interface AudioCaptureConfig {
  sampleRate: number;
  channels: number;
  chunkDurationMs: number;
  vadThreshold: number;
  vadSilenceMs: number;
  recoveryBufferMinutes: number;
}

export interface AudioCaptureService {
  checkPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  getDevices(): Promise<AudioDevice[]>;
  setDevice(deviceId: string): void;
  start(): Promise<void>;
  stop(): void;
  getAudioLevel(): number;
  isCapturing(): boolean;
  getCapturedAudioBuffer(): Buffer | null;
  exportCapturedAudioWav(filePath: string): Promise<{ bytesWritten: number; durationMs: number } | null>;
  clearCapturedAudio(): void;

  // Event handlers
  onAudioChunk: (callback: (chunk: AudioChunk) => void) => () => void;
  onVoiceActivity: (callback: (active: boolean) => void) => () => void;
  onError: (callback: (error: Error) => void) => () => void;
  onAudioLevel: (callback: (level: number) => void) => () => void;
}

// ============================================================================
// IPC Channel Constants
// ============================================================================

export const AUDIO_IPC_CHANNELS = {
  // Main -> Renderer requests
  REQUEST_DEVICES: IPC_CHANNELS.AUDIO_REQUEST_DEVICES,
  START_CAPTURE: IPC_CHANNELS.AUDIO_START_CAPTURE,
  STOP_CAPTURE: IPC_CHANNELS.AUDIO_STOP_CAPTURE,
  SET_DEVICE: IPC_CHANNELS.AUDIO_SET_DEVICE,

  // Renderer -> Main data
  AUDIO_CHUNK: IPC_CHANNELS.AUDIO_CHUNK,
  DEVICES_RESPONSE: IPC_CHANNELS.AUDIO_DEVICES_RESPONSE,
  CAPTURE_ERROR: IPC_CHANNELS.AUDIO_CAPTURE_ERROR,
  CAPTURE_STARTED: IPC_CHANNELS.AUDIO_CAPTURE_STARTED,
  CAPTURE_STOPPED: IPC_CHANNELS.AUDIO_CAPTURE_STOPPED,
} as const;

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: AudioCaptureConfig = {
  sampleRate: 16000, // 16kHz required by Deepgram
  channels: 1, // Mono
  chunkDurationMs: 100, // 100ms chunks for real-time streaming
  vadThreshold: 0.01, // RMS threshold for voice detection
  vadSilenceMs: 300, // Consecutive silence before marking inactive
  recoveryBufferMinutes: 5, // Rotate buffer files every 5 minutes
};

// ============================================================================
// AudioCaptureService Implementation
// ============================================================================

class AudioCaptureServiceImpl extends EventEmitter implements AudioCaptureService {
  private config: AudioCaptureConfig;
  private capturing: boolean = false;
  private currentDeviceId: string | null = null;
  private currentAudioLevel: number = 0;
  private voiceActive: boolean = false;
  private silenceStartTime: number = 0;
  private mainWindow: BrowserWindow | null = null;

  // Recovery buffer management
  private recoveryBufferPath: string;
  private currentBufferFile: string | null = null;
  private bufferStartTime: number = 0;
  private recoveryChunks: Buffer[] = [];
  private recoveryInterval: NodeJS.Timeout | null = null;

  // Full-session audio capture (used for post-session transcription + retry workflows)
  private sessionAudioChunks: Buffer[] = [];
  private sessionAudioBytes: number = 0;

  constructor(config: Partial<AudioCaptureConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.recoveryBufferPath = join(app.getPath('temp'), 'feedbackflow-audio');
    this.setupIPCHandlers();
  }

  /**
   * Set the main window reference for IPC communication
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  // ==========================================================================
  // Permission Management
  // ==========================================================================

  /**
   * Check if microphone permission is granted (macOS only)
   */
  async checkPermission(): Promise<boolean> {
    if (process.platform !== 'darwin') {
      // Non-macOS platforms don't have system-level permission checks
      return true;
    }

    const status = systemPreferences.getMediaAccessStatus('microphone');
    const granted = status === 'granted';

    if (!granted) {
      errorHandler.log('info', 'Microphone permission not granted', {
        component: 'AudioCapture',
        operation: 'checkPermission',
        data: { status },
      });
    }

    return granted;
  }

  /**
   * Request microphone permission (macOS only)
   * Returns true if granted, false if denied
   */
  async requestPermission(): Promise<boolean> {
    if (process.platform !== 'darwin') {
      return true;
    }

    const status = systemPreferences.getMediaAccessStatus('microphone');

    if (status === 'granted') {
      return true;
    }

    if (status === 'denied') {
      // User previously denied, they need to enable in System Preferences
      return false;
    }

    // Status is 'not-determined' or 'restricted', request permission
    try {
      const granted = await systemPreferences.askForMediaAccess('microphone');

      if (!granted) {
        errorHandler.log('warn', 'Microphone permission denied by user', {
          component: 'AudioCapture',
          operation: 'requestPermission',
        });
      }

      return granted;
    } catch (error) {
      errorHandler.log('error', 'Permission request failed', {
        component: 'AudioCapture',
        operation: 'requestPermission',
        error: (error as Error).message,
      });
      return false;
    }
  }

  // ==========================================================================
  // Device Management
  // ==========================================================================

  /**
   * Get list of available audio input devices
   * This requests device list from renderer via IPC
   */
  async getDevices(): Promise<AudioDevice[]> {
    return new Promise((resolve, reject) => {
      if (!this.mainWindow) {
        reject(new Error('Main window not set'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Device enumeration timeout'));
      }, 5000);

      const handler = (_event: Electron.IpcMainEvent, devices: AudioDevice[]) => {
        clearTimeout(timeout);
        ipcMain.removeListener(AUDIO_IPC_CHANNELS.DEVICES_RESPONSE, handler);
        resolve(devices);
      };

      ipcMain.on(AUDIO_IPC_CHANNELS.DEVICES_RESPONSE, handler);
      this.mainWindow.webContents.send(AUDIO_IPC_CHANNELS.REQUEST_DEVICES);
    });
  }

  /**
   * Set the audio input device to use
   */
  setDevice(deviceId: string): void {
    this.currentDeviceId = deviceId;
    if (this.capturing && this.mainWindow) {
      // If already capturing, notify renderer to switch device
      this.mainWindow.webContents.send(AUDIO_IPC_CHANNELS.SET_DEVICE, deviceId);
    }
  }

  // ==========================================================================
  // Capture Control
  // ==========================================================================

  /**
   * Start audio capture
   */
  async start(): Promise<void> {
    if (this.capturing) {
      errorHandler.log('info', 'Audio capture already in progress', {
        component: 'AudioCapture',
        operation: 'start',
      });
      return;
    }

    // Check permission first
    const hasPermission = await this.checkPermission();
    if (!hasPermission) {
      const granted = await this.requestPermission();
      if (!granted) {
        const permError = new Error('Microphone permission denied');
        errorHandler.handleAudioError(permError, {
          component: 'AudioCapture',
          operation: 'start',
        });
        throw permError;
      }
    }

    if (!this.mainWindow) {
      const windowError = new Error('Main window not set');
      errorHandler.log('error', 'Cannot start audio - no main window', {
        component: 'AudioCapture',
        operation: 'start',
      });
      throw windowError;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Audio capture start timeout'));
      }, 10000);

      const successHandler = () => {
        clearTimeout(timeout);
        ipcMain.removeListener(AUDIO_IPC_CHANNELS.CAPTURE_STARTED, successHandler);
        ipcMain.removeListener(AUDIO_IPC_CHANNELS.CAPTURE_ERROR, errorHandler);

        this.capturing = true;
        this.sessionAudioChunks = [];
        this.sessionAudioBytes = 0;
        this.startRecoveryBuffer();
        console.log('[AudioCapture] Capture started');
        resolve();
      };

      const errorHandler = (_event: Electron.IpcMainEvent, error: string) => {
        clearTimeout(timeout);
        ipcMain.removeListener(AUDIO_IPC_CHANNELS.CAPTURE_STARTED, successHandler);
        ipcMain.removeListener(AUDIO_IPC_CHANNELS.CAPTURE_ERROR, errorHandler);
        reject(new Error(error));
      };

      ipcMain.once(AUDIO_IPC_CHANNELS.CAPTURE_STARTED, successHandler);
      ipcMain.once(AUDIO_IPC_CHANNELS.CAPTURE_ERROR, errorHandler);

      // Send start command to renderer with config
      this.mainWindow!.webContents.send(AUDIO_IPC_CHANNELS.START_CAPTURE, {
        deviceId: this.currentDeviceId,
        sampleRate: this.config.sampleRate,
        channels: this.config.channels,
        chunkDurationMs: this.config.chunkDurationMs,
      });
    });
  }

  /**
   * Stop audio capture
   */
  stop(): void {
    if (!this.capturing) {
      return;
    }

    this.capturing = false;
    this.stopRecoveryBuffer();

    if (this.mainWindow) {
      this.mainWindow.webContents.send(AUDIO_IPC_CHANNELS.STOP_CAPTURE);
    }

    // Reset state
    this.voiceActive = false;
    this.currentAudioLevel = 0;
    this.emit('voiceActivity', false);

    console.log('[AudioCapture] Capture stopped');
  }

  /**
   * Check if currently capturing
   */
  isCapturing(): boolean {
    return this.capturing;
  }

  /**
   * Get current audio level (0-1 normalized)
   */
  getAudioLevel(): number {
    return this.currentAudioLevel;
  }

  /**
   * Export captured audio as a WAV file (IEEE float 32-bit PCM).
   * Returns null when there is no audio for the current session.
   */
  async exportCapturedAudioWav(
    filePath: string
  ): Promise<{ bytesWritten: number; durationMs: number } | null> {
    const rawAudio = this.getCapturedAudioBuffer();
    if (!rawAudio) {
      return null;
    }

    const wavBuffer = this.encodeFloat32Wav(
      rawAudio,
      this.config.sampleRate,
      this.config.channels
    );
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, wavBuffer);

    const durationMs =
      (rawAudio.byteLength / (this.config.channels * this.config.sampleRate * 4)) * 1000;
    return {
      bytesWritten: wavBuffer.byteLength,
      durationMs,
    };
  }

  /**
   * Clear in-memory session audio data.
   */
  clearCapturedAudio(): void {
    this.sessionAudioChunks = [];
    this.sessionAudioBytes = 0;
  }

  // ==========================================================================
  // Event Subscription
  // ==========================================================================

  onAudioChunk(callback: (chunk: AudioChunk) => void): () => void {
    this.on('audioChunk', callback);
    return () => this.off('audioChunk', callback);
  }

  onVoiceActivity(callback: (active: boolean) => void): () => void {
    this.on('voiceActivity', callback);
    return () => this.off('voiceActivity', callback);
  }

  onError(callback: (error: Error) => void): () => void {
    this.on('error', callback);
    return () => this.off('error', callback);
  }

  onAudioLevel(callback: (level: number) => void): () => void {
    this.on('audioLevel', callback);
    return () => this.off('audioLevel', callback);
  }

  // ==========================================================================
  // IPC Handlers
  // ==========================================================================

  private setupIPCHandlers(): void {
    // Handle incoming audio chunks from renderer
    ipcMain.on(AUDIO_IPC_CHANNELS.AUDIO_CHUNK, this.handleAudioChunk.bind(this));

    // Handle capture errors from renderer
    ipcMain.on(AUDIO_IPC_CHANNELS.CAPTURE_ERROR, (_event, error: string) => {
      const captureError = new Error(error);
      errorHandler.handleAudioError(captureError, {
        component: 'AudioCapture',
        operation: 'rendererCapture',
      });
      this.emit('error', captureError);
    });

    // Handle capture stopped (e.g., device disconnected)
    ipcMain.on(AUDIO_IPC_CHANNELS.CAPTURE_STOPPED, () => {
      if (this.capturing) {
        this.capturing = false;
        this.stopRecoveryBuffer();
        const stopError = new Error('Audio capture stopped unexpectedly');
        errorHandler.handleAudioError(stopError, {
          component: 'AudioCapture',
          operation: 'captureStop',
          data: { unexpected: true },
        });
        this.emit('error', stopError);
      }
    });
  }

  /**
   * Process incoming audio chunk from renderer
   */
  private handleAudioChunk(
    _event: Electron.IpcMainEvent,
    data: { samples: number[]; timestamp: number; duration: number }
  ): void {
    if (!this.capturing) return;

    // Convert samples array back to Float32Array then to Buffer
    const float32 = new Float32Array(data.samples);
    const buffer = Buffer.from(float32.buffer);

    // Calculate RMS for VAD and level visualization
    const rms = this.calculateRMS(float32);
    this.currentAudioLevel = Math.min(1, rms * 10); // Normalize for visualization
    this.emit('audioLevel', this.currentAudioLevel);

    // Voice Activity Detection
    this.updateVAD(rms, data.timestamp);

    // Create chunk object
    const chunk: AudioChunk = {
      buffer,
      timestamp: data.timestamp,
      duration: data.duration,
      sampleRate: this.config.sampleRate,
    };

    // Add to recovery buffer
    this.recoveryChunks.push(buffer);
    this.sessionAudioChunks.push(buffer);
    this.sessionAudioBytes += buffer.byteLength;

    // Emit chunk for transcription
    this.emit('audioChunk', chunk);
  }

  // ==========================================================================
  // Voice Activity Detection
  // ==========================================================================

  /**
   * Calculate Root Mean Square of audio samples
   */
  private calculateRMS(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  /**
   * Update voice activity state based on RMS
   */
  private updateVAD(rms: number, timestamp: number): void {
    const isVoice = rms > this.config.vadThreshold;

    if (isVoice) {
      // Voice detected
      if (!this.voiceActive) {
        this.voiceActive = true;
        this.emit('voiceActivity', true);
        console.log('[AudioCapture] Voice activity started');
      }
      this.silenceStartTime = 0;
    } else {
      // Silence detected
      if (this.voiceActive) {
        if (this.silenceStartTime === 0) {
          this.silenceStartTime = timestamp;
        } else if (timestamp - this.silenceStartTime > this.config.vadSilenceMs) {
          // Enough silence, mark as inactive
          this.voiceActive = false;
          this.emit('voiceActivity', false);
          this.silenceStartTime = 0;
          console.log('[AudioCapture] Voice activity ended');
        }
      }
    }
  }

  // ==========================================================================
  // Recovery Buffer Management
  // ==========================================================================

  /**
   * Start the recovery buffer system
   * Writes audio to temp files for network failure recovery
   */
  private async startRecoveryBuffer(): Promise<void> {
    // Ensure recovery directory exists
    if (!existsSync(this.recoveryBufferPath)) {
      await mkdir(this.recoveryBufferPath, { recursive: true });
    }

    this.bufferStartTime = Date.now();
    this.recoveryChunks = [];
    this.currentBufferFile = this.generateBufferFilename();

    // Rotate buffer every recoveryBufferMinutes
    this.recoveryInterval = setInterval(
      () => this.rotateRecoveryBuffer(),
      this.config.recoveryBufferMinutes * 60 * 1000
    );

    console.log('[AudioCapture] Recovery buffer started');
  }

  /**
   * Stop the recovery buffer system
   */
  private stopRecoveryBuffer(): void {
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }

    // Write remaining chunks
    if (this.recoveryChunks.length > 0) {
      this.writeRecoveryBuffer().catch((err) => {
        console.error('[AudioCapture] Failed to write final recovery buffer:', err);
      });
    }

    this.recoveryChunks = [];
    console.log('[AudioCapture] Recovery buffer stopped');
  }

  /**
   * Rotate the recovery buffer - write current and start new
   */
  private async rotateRecoveryBuffer(): Promise<void> {
    await this.writeRecoveryBuffer();

    // Clean up old buffer files (keep last 2)
    await this.cleanOldBuffers();

    // Start new buffer
    this.bufferStartTime = Date.now();
    this.recoveryChunks = [];
    this.currentBufferFile = this.generateBufferFilename();
  }

  /**
   * Write current recovery buffer to disk
   */
  private async writeRecoveryBuffer(): Promise<void> {
    if (this.recoveryChunks.length === 0 || !this.currentBufferFile) {
      return;
    }

    try {
      const combined = Buffer.concat(this.recoveryChunks);
      await writeFile(this.currentBufferFile, combined);
      console.log(
        `[AudioCapture] Recovery buffer written: ${this.currentBufferFile} (${combined.length} bytes)`
      );
    } catch (error) {
      console.error('[AudioCapture] Failed to write recovery buffer:', error);
    }
  }

  /**
   * Generate a unique buffer filename
   */
  private generateBufferFilename(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return join(this.recoveryBufferPath, `audio-${timestamp}.raw`);
  }

  /**
   * Clean up old recovery buffer files
   */
  private async cleanOldBuffers(): Promise<void> {
    try {
      const { readdir, stat } = await import('fs/promises');
      const files = await readdir(this.recoveryBufferPath);

      const bufferFiles = await Promise.all(
        files
          .filter((f) => f.startsWith('audio-') && f.endsWith('.raw'))
          .map(async (f) => {
            const path = join(this.recoveryBufferPath, f);
            const stats = await stat(path);
            return { path, mtime: stats.mtime.getTime() };
          })
      );

      // Sort by modification time, newest first
      bufferFiles.sort((a, b) => b.mtime - a.mtime);

      // Delete all but the 2 most recent
      for (let i = 2; i < bufferFiles.length; i++) {
        await unlink(bufferFiles[i].path);
        console.log(`[AudioCapture] Deleted old buffer: ${bufferFiles[i].path}`);
      }
    } catch (error) {
      console.error('[AudioCapture] Failed to clean old buffers:', error);
    }
  }

  /**
   * Get recovery buffers for replay after network failure
   * Returns buffers from the last N minutes
   */
  async getRecoveryBuffers(lastMinutes: number = 5): Promise<Buffer[]> {
    const buffers: Buffer[] = [];
    const cutoff = Date.now() - lastMinutes * 60 * 1000;

    try {
      const { readdir, stat, readFile } = await import('fs/promises');
      const files = await readdir(this.recoveryBufferPath);

      for (const file of files) {
        if (!file.startsWith('audio-') || !file.endsWith('.raw')) continue;

        const path = join(this.recoveryBufferPath, file);
        const stats = await stat(path);

        if (stats.mtime.getTime() > cutoff) {
          const data = await readFile(path);
          buffers.push(data);
        }
      }

      // Include current in-memory chunks
      if (this.recoveryChunks.length > 0) {
        buffers.push(Buffer.concat(this.recoveryChunks));
      }

      console.log(`[AudioCapture] Retrieved ${buffers.length} recovery buffers`);
    } catch (error) {
      console.error('[AudioCapture] Failed to get recovery buffers:', error);
    }

    return buffers;
  }

  /**
   * Clear all recovery buffers
   */
  async clearRecoveryBuffers(): Promise<void> {
    try {
      const { readdir } = await import('fs/promises');
      const files = await readdir(this.recoveryBufferPath);

      for (const file of files) {
        if (file.startsWith('audio-') && file.endsWith('.raw')) {
          await unlink(join(this.recoveryBufferPath, file));
        }
      }

      this.recoveryChunks = [];
      console.log('[AudioCapture] Recovery buffers cleared');
    } catch (error) {
      console.error('[AudioCapture] Failed to clear recovery buffers:', error);
    }
  }

  /**
   * Build a single buffer from all captured session chunks.
   */
  getCapturedAudioBuffer(): Buffer | null {
    if (this.sessionAudioChunks.length === 0 || this.sessionAudioBytes === 0) {
      return null;
    }
    return Buffer.concat(this.sessionAudioChunks, this.sessionAudioBytes);
  }

  /**
   * Encode float32 PCM samples into a WAV container.
   */
  private encodeFloat32Wav(rawAudio: Buffer, sampleRate: number, channels: number): Buffer {
    const bytesPerSample = 4; // Float32
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = rawAudio.byteLength;
    const riffChunkSize = 36 + dataSize;
    const header = Buffer.alloc(44);

    // RIFF header
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(riffChunkSize, 4);
    header.write('WAVE', 8, 'ascii');

    // fmt chunk
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16); // fmt chunk size
    header.writeUInt16LE(3, 20); // IEEE float
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(32, 34); // bits per sample

    // data chunk
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, rawAudio], 44 + dataSize);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const audioCapture = new AudioCaptureServiceImpl();
export { AudioCaptureServiceImpl };
export default audioCapture;
