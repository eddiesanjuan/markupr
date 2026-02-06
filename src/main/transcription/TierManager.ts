/**
 * TierManager.ts - Transcription Tier Selection and Failover
 *
 * Manages the three-tier transcription system:
 * - Tier 1: Deepgram (optional, best quality)
 * - Tier 2: Local Whisper (DEFAULT)
 * - Tier 3: macOS Dictation (fallback)
 * - Tier 4: Timer-only (emergency)
 *
 * Handles:
 * - Automatic tier selection based on availability
 * - Mid-session failback on failures
 * - Unified interface for all transcription services
 */

import { EventEmitter } from 'events';
import * as os from 'os';
import { transcriptionService as deepgramService } from './TranscriptionService';
import { whisperService } from './WhisperService';
import { silenceDetector } from './SilenceDetector';
import { modelDownloadManager } from './ModelDownloadManager';
import { getSettingsManager } from '../settings';
import type {
  TranscriptionTier,
  TierStatus,
  TierQuality,
  TranscriptEvent,
  PauseEvent,
  TranscriptCallback,
  PauseCallback,
  TierChangeCallback,
  ErrorCallback,
} from './types';

// ============================================================================
// Constants
// ============================================================================

const TIER_PRIORITY: TranscriptionTier[] = ['deepgram', 'whisper', 'macos-dictation', 'timer-only'];

const TIER_QUALITY: Record<TranscriptionTier, TierQuality> = {
  deepgram: { accuracy: '95%+', latency: '~300ms' },
  whisper: { accuracy: '90%+', latency: '1-3s' },
  'macos-dictation': { accuracy: '85%', latency: 'Real-time' },
  'timer-only': { accuracy: 'N/A', latency: 'N/A' },
};

// Minimum memory for Whisper (2GB)
const WHISPER_MIN_MEMORY = 2 * 1024 * 1024 * 1024;

// Timer-only screenshot interval
const TIMER_SCREENSHOT_INTERVAL_MS = 10000;

// Max failovers before forcing timer-only
const MAX_FAILOVERS = 3;
type PreferredTier = 'auto' | TranscriptionTier;

// ============================================================================
// TierManager Class
// ============================================================================

export class TierManager extends EventEmitter {
  private currentTier: TranscriptionTier | null = null;
  private preferredTier: PreferredTier = 'auto';
  private isActive: boolean = false;
  private failoverCount: number = 0;

  // Cleanup functions for subscriptions
  private cleanupFunctions: Array<() => void> = [];

  // Timer-only mode
  private timerInterval: ReturnType<typeof setInterval> | null = null;

  // Callbacks
  private transcriptCallbacks: TranscriptCallback[] = [];
  private pauseCallbacks: PauseCallback[] = [];
  private tierChangeCallbacks: TierChangeCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Get the status of all tiers
   */
  async getTierStatuses(): Promise<TierStatus[]> {
    const [tier1, tier2, tier3, tier4] = await Promise.all([
      this.checkTier1Availability(),
      this.checkTier2Availability(),
      this.checkTier3Availability(),
      this.checkTier4Availability(),
    ]);

    return [tier1, tier2, tier3, tier4];
  }

  /**
   * Get the currently active tier
   */
  getCurrentTier(): TranscriptionTier | null {
    return this.currentTier;
  }

  /**
   * Get preferred tier selection. 'auto' means dynamic best-available choice.
   */
  getPreferredTier(): PreferredTier {
    return this.preferredTier;
  }

  /**
   * Set preferred tier selection used for future session starts.
   * Only transcription-capable tiers are accepted in strict feedback mode.
   */
  setPreferredTier(tier: PreferredTier): void {
    if (tier !== 'auto' && !this.tierProvidesTranscription(tier)) {
      throw new Error(
        'This tier does not provide transcription. Select Deepgram, Whisper, or Auto.'
      );
    }

    this.preferredTier = tier;
    this.log(`Preferred tier set to: ${tier}`);
  }

  /**
   * Check if a session is active
   */
  isSessionActive(): boolean {
    return this.isActive;
  }

  /**
   * Get quality info for a tier
   */
  getTierQuality(tier: TranscriptionTier): TierQuality {
    return TIER_QUALITY[tier];
  }

  /**
   * Check if a tier actually provides transcription
   * macos-dictation is a placeholder and timer-only never transcribes
   */
  tierProvidesTranscription(tier: TranscriptionTier): boolean {
    return tier === 'deepgram' || tier === 'whisper';
  }

  /**
   * Check if we have any tier that can actually transcribe
   */
  async hasTranscriptionCapability(): Promise<boolean> {
    const statuses = await this.getTierStatuses();
    return statuses.some(
      (s) => s.available && this.tierProvidesTranscription(s.tier)
    );
  }

  /**
   * Get all tier qualities
   */
  getAllTierQualities(): Record<TranscriptionTier, TierQuality> {
    return { ...TIER_QUALITY };
  }

  /**
   * Select the best available tier
   * Respects user preference if Deepgram API key is configured
   */
  async selectBestTier(): Promise<TranscriptionTier> {
    const statuses = await this.getTierStatuses();

    if (this.preferredTier !== 'auto') {
      const preferredStatus = statuses.find((s) => s.tier === this.preferredTier);
      if (preferredStatus?.available) {
        return this.preferredTier;
      }

      this.log(
        `Preferred tier "${this.preferredTier}" unavailable, using automatic failover`
      );
    }

    for (const tier of TIER_PRIORITY) {
      const status = statuses.find((s) => s.tier === tier);
      if (status?.available) {
        return tier;
      }
    }

    // Should never reach here - timer-only is always available
    return 'timer-only';
  }

  /**
   * Start transcription with the best available tier
   */
  async start(): Promise<TranscriptionTier> {
    if (this.isActive) {
      throw new Error('TierManager already active. Call stop() first.');
    }

    // Log all tier statuses for debugging
    const statuses = await this.getTierStatuses();
    this.log('=== TIER AVAILABILITY CHECK ===');
    for (const status of statuses) {
      this.log(`  ${status.tier}: ${status.available ? 'AVAILABLE' : `UNAVAILABLE - ${status.reason}`}`);
    }

    const tier = await this.selectBestTier();

    // Warn if falling back to a tier that doesn't provide transcription
    if (tier === 'macos-dictation') {
      this.log('WARNING: macOS Dictation tier is a PLACEHOLDER - it does NOT produce transcriptions!');
      this.log('WARNING: Only pause events (for screenshots) will be emitted.');
      this.log('WARNING: Consider downloading a Whisper model or configuring Deepgram API key.');
    } else if (tier === 'timer-only') {
      this.log('WARNING: Timer-only mode - NO transcription will be produced!');
      this.log('WARNING: Only periodic screenshot triggers will be emitted.');
    }

    this.log(`Selected tier: ${tier}`);
    await this.startTier(tier);

    return this.currentTier ?? tier;
  }

  /**
   * Start transcription with a specific tier
   */
  async startTier(tier: TranscriptionTier): Promise<void> {
    if (this.isActive && this.currentTier === tier) {
      return;
    }

    // Stop current tier if switching
    if (this.isActive) {
      await this.stopCurrentTier();
    }

    this.log(`Starting tier: ${tier}`);
    this.currentTier = tier;
    this.isActive = true;

    try {
      switch (tier) {
        case 'deepgram':
          await this.startDeepgram();
          break;
        case 'whisper':
          await this.startWhisper();
          break;
        case 'macos-dictation':
          await this.startMacOSDictation();
          break;
        case 'timer-only':
          await this.startTimerOnly();
          break;
      }
    } catch (error) {
      this.logError(`Failed to start ${tier}`, error);
      await this.handleTierFailure(tier, error as Error);
    }
  }

  /**
   * Stop transcription
   */
  async stop(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    await this.stopCurrentTier();
    this.isActive = false;
    this.currentTier = null;
    this.failoverCount = 0;
  }

  /**
   * Convert Buffer to Float32Array correctly
   * Node.js Buffers can have different byteOffset than 0, so we need to account for that
   */
  private bufferToFloat32Array(buffer: Buffer): Float32Array {
    // CRITICAL FIX: When converting from Node.js Buffer to Float32Array,
    // we must account for the buffer's byteOffset and byteLength.
    // Simply using new Float32Array(buffer.buffer) can read from wrong memory locations!
    return new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / 4  // Float32 = 4 bytes per element
    );
  }

  /**
   * Send audio to the active transcription service
   */
  sendAudio(samples: Float32Array | Buffer, timestamp: number, durationMs: number): void {
    if (!this.isActive || !this.currentTier) {
      return;
    }

    switch (this.currentTier) {
      case 'deepgram': {
        // Deepgram expects Buffer
        const buffer = Buffer.isBuffer(samples) ? samples : Buffer.from(samples.buffer);
        deepgramService.sendAudio({ data: buffer, timestamp });
        break;
      }

      case 'whisper': {
        // Whisper expects Float32Array - use correct conversion
        const float32 = samples instanceof Float32Array ? samples : this.bufferToFloat32Array(samples);
        whisperService.addAudio(float32, durationMs);
        // Also feed silence detector for screenshot triggers
        silenceDetector.addAudio(float32, durationMs);
        break;
      }

      case 'macos-dictation': {
        // macOS dictation handles its own audio capture
        // We only need silence detection for screenshots
        const float32ForSilence = samples instanceof Float32Array ? samples : this.bufferToFloat32Array(samples);
        silenceDetector.addAudio(float32ForSilence, durationMs);
        break;
      }

      case 'timer-only':
        // No transcription, just accumulate audio for recording
        break;
    }
  }

  /**
   * Force a failover to the next available tier
   */
  async forceFailover(reason: string): Promise<TranscriptionTier | null> {
    if (!this.currentTier) {
      return null;
    }

    const currentTier = this.currentTier;
    await this.handleTierFailure(currentTier, new Error(reason));
    return this.currentTier;
  }

  // ============================================================================
  // Event Subscriptions
  // ============================================================================

  onTranscript(callback: TranscriptCallback): () => void {
    this.transcriptCallbacks.push(callback);
    return () => {
      this.transcriptCallbacks = this.transcriptCallbacks.filter((cb) => cb !== callback);
    };
  }

  onPause(callback: PauseCallback): () => void {
    this.pauseCallbacks.push(callback);
    return () => {
      this.pauseCallbacks = this.pauseCallbacks.filter((cb) => cb !== callback);
    };
  }

  onTierChange(callback: TierChangeCallback): () => void {
    this.tierChangeCallbacks.push(callback);
    return () => {
      this.tierChangeCallbacks = this.tierChangeCallbacks.filter((cb) => cb !== callback);
    };
  }

  onError(callback: ErrorCallback): () => void {
    this.errorCallbacks.push(callback);
    return () => {
      this.errorCallbacks = this.errorCallbacks.filter((cb) => cb !== callback);
    };
  }

  // ============================================================================
  // Tier Availability Checks
  // ============================================================================

  private async checkTier1Availability(): Promise<TierStatus> {
    try {
      const settings = getSettingsManager();
      const apiKey = await settings.getApiKey('deepgram');

      if (!apiKey) {
        return { tier: 'deepgram', available: false, reason: 'No API key configured' };
      }

      const normalizedKey = apiKey.trim();
      if (normalizedKey.length < 16) {
        return { tier: 'deepgram', available: false, reason: 'API key format looks invalid' };
      }

      return { tier: 'deepgram', available: true };
    } catch (error) {
      return { tier: 'deepgram', available: false, reason: (error as Error).message };
    }
  }

  private async checkTier2Availability(): Promise<TierStatus> {
    // Check if model is downloaded
    const hasModel =
      modelDownloadManager.isModelDownloaded('medium') || modelDownloadManager.isModelDownloaded('small');

    if (!hasModel) {
      return { tier: 'whisper', available: false, reason: 'Model not downloaded' };
    }

    // Check memory
    const freeMemory = os.freemem();
    if (freeMemory < WHISPER_MIN_MEMORY) {
      return {
        tier: 'whisper',
        available: false,
        reason: `Insufficient memory (${Math.round(freeMemory / 1024 / 1024)}MB free, need 2GB)`,
      };
    }

    return { tier: 'whisper', available: true };
  }

  private async checkTier3Availability(): Promise<TierStatus> {
    // macOS only
    if (process.platform !== 'darwin') {
      return { tier: 'macos-dictation', available: false, reason: 'macOS only' };
    }

    // Note: Full implementation would check if Dictation is enabled in System Preferences
    // For now, assume available on macOS (users can enable it if needed)
    return { tier: 'macos-dictation', available: true };
  }

  private async checkTier4Availability(): Promise<TierStatus> {
    // Timer-only is always available
    return { tier: 'timer-only', available: true };
  }

  // ============================================================================
  // Tier Start/Stop Methods
  // ============================================================================

  private async startDeepgram(): Promise<void> {
    const settings = getSettingsManager();
    const apiKey = await settings.getApiKey('deepgram');

    if (!apiKey) {
      throw new Error('Deepgram API key not configured');
    }

    // Configure Deepgram service
    deepgramService.configure(apiKey);

    // Subscribe to events
    const unsubTranscript = deepgramService.onTranscript((result) => {
      this.emitTranscript({
        text: result.text,
        isFinal: result.isFinal,
        confidence: result.confidence,
        timestamp: result.timestamp,
        tier: 'deepgram',
      });
    });
    this.cleanupFunctions.push(unsubTranscript);

    const unsubUtterance = deepgramService.onUtteranceEnd((timestamp) => {
      this.emitPause({ timestamp, tier: 'deepgram' });
    });
    this.cleanupFunctions.push(unsubUtterance);

    const unsubError = deepgramService.onError((error) => {
      this.handleTierFailure('deepgram', error);
    });
    this.cleanupFunctions.push(unsubError);

    await deepgramService.start();
    this.log('Deepgram tier started');
  }

  private async startWhisper(): Promise<void> {
    // Determine which model to use
    let modelPath: string;
    if (modelDownloadManager.isModelDownloaded('medium')) {
      modelPath = modelDownloadManager.getModelPath('medium');
    } else if (modelDownloadManager.isModelDownloaded('small')) {
      modelPath = modelDownloadManager.getModelPath('small');
    } else {
      throw new Error('No Whisper model downloaded');
    }

    whisperService.setModelPath(modelPath);

    // Initialize Whisper
    await whisperService.initialize();

    // Subscribe to transcript events
    const unsubTranscript = whisperService.onTranscript((result) => {
      this.emitTranscript({
        text: result.text,
        isFinal: true, // Whisper always produces final results
        confidence: result.confidence,
        timestamp: result.startTime,
        tier: 'whisper',
      });
    });
    this.cleanupFunctions.push(unsubTranscript);

    const unsubError = whisperService.onError((error) => {
      this.handleTierFailure('whisper', error);
    });
    this.cleanupFunctions.push(unsubError);

    // Start silence detector for pause events
    const unsubSilence = silenceDetector.onSilenceDetected((timestamp) => {
      this.emitPause({ timestamp, tier: 'whisper' });
    });
    this.cleanupFunctions.push(unsubSilence);

    silenceDetector.start();
    await whisperService.start();
    this.log('Whisper tier started');
  }

  private async startMacOSDictation(): Promise<void> {
    // macOS Dictation uses the system's built-in speech recognition
    // We just need silence detection for screenshot triggers

    const unsubSilence = silenceDetector.onSilenceDetected((timestamp) => {
      this.log(`Pause detected at ${timestamp.toFixed(2)}s - triggering screenshot`);
      this.emitPause({ timestamp, tier: 'macos-dictation' });
    });
    this.cleanupFunctions.push(unsubSilence);

    silenceDetector.start();

    // IMPORTANT: This is a PLACEHOLDER tier - it does NOT produce actual transcriptions!
    // Full macOS Dictation integration would require NSSpeechRecognizer native bindings.
    // Currently it ONLY emits pause events for screenshot capture.
    this.log('=== macOS Dictation tier started ===');
    this.log('NOTE: This tier is a PLACEHOLDER - NO TRANSCRIPTION will be produced!');
    this.log('NOTE: Only silence detection for screenshot triggers is active.');
    this.log('NOTE: To get actual transcription, download a Whisper model or configure Deepgram.');
  }

  private async startTimerOnly(): Promise<void> {
    // Timer-only mode: emit pause events at regular intervals
    this.timerInterval = setInterval(() => {
      this.emitPause({ timestamp: Date.now() / 1000, tier: 'timer-only' });
    }, TIMER_SCREENSHOT_INTERVAL_MS);

    this.log(`Timer-only mode started (screenshots every ${TIMER_SCREENSHOT_INTERVAL_MS / 1000}s)`);
  }

  private async stopCurrentTier(): Promise<void> {
    // Cleanup subscriptions
    for (const cleanup of this.cleanupFunctions) {
      try {
        cleanup();
      } catch (error) {
        this.logError('Error during cleanup', error);
      }
    }
    this.cleanupFunctions = [];

    // Stop services based on current tier
    if (this.currentTier === 'deepgram') {
      deepgramService.stop();
    } else if (this.currentTier === 'whisper') {
      await whisperService.stop();
      silenceDetector.stop();
    } else if (this.currentTier === 'macos-dictation') {
      silenceDetector.stop();
    } else if (this.currentTier === 'timer-only') {
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
    }

    this.log(`Stopped tier: ${this.currentTier}`);
  }

  // ============================================================================
  // Failover Handling
  // ============================================================================

  private async handleTierFailure(failedTier: TranscriptionTier, error: Error): Promise<void> {
    this.logError(`Tier ${failedTier} failed`, error);
    this.errorCallbacks.forEach((cb) => cb(error, failedTier));

    this.failoverCount++;

    if (this.failoverCount >= MAX_FAILOVERS) {
      this.log('Max failovers reached, falling back to timer-only');
      await this.performFailover(failedTier, 'timer-only', 'Max failover attempts reached');
      return;
    }

    // Find next available tier
    const currentIndex = TIER_PRIORITY.indexOf(failedTier);
    const statuses = await this.getTierStatuses();

    for (let i = currentIndex + 1; i < TIER_PRIORITY.length; i++) {
      const nextTier = TIER_PRIORITY[i];
      const status = statuses.find((s) => s.tier === nextTier);

      if (status?.available) {
        await this.performFailover(failedTier, nextTier, error.message);
        return;
      }
    }

    // No available tiers, force timer-only
    await this.performFailover(failedTier, 'timer-only', 'No available fallback tiers');
  }

  private async performFailover(
    fromTier: TranscriptionTier,
    toTier: TranscriptionTier,
    reason: string
  ): Promise<void> {
    this.log(`Failover: ${fromTier} -> ${toTier} (${reason})`);

    // Notify listeners
    this.tierChangeCallbacks.forEach((cb) => cb(fromTier, toTier, reason));
    this.emit('tierChange', fromTier, toTier, reason);

    // Stop current tier and start new one
    await this.stopCurrentTier();
    await this.startTier(toTier);
  }

  // ============================================================================
  // Event Emission
  // ============================================================================

  private emitTranscript(event: TranscriptEvent): void {
    this.transcriptCallbacks.forEach((cb) => cb(event));
    this.emit('transcript', event);
  }

  private emitPause(event: PauseEvent): void {
    this.pauseCallbacks.forEach((cb) => cb(event));
    this.emit('pause', event);
  }

  // ============================================================================
  // Logging
  // ============================================================================

  private log(message: string): void {
    console.log(`[TierManager] ${message}`);
  }

  private logError(message: string, error?: unknown): void {
    const errorStr = error instanceof Error ? error.message : String(error);
    console.error(`[TierManager] ERROR: ${message} - ${errorStr}`);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const tierManager = new TierManager();
export default TierManager;
