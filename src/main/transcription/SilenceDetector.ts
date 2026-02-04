/**
 * SilenceDetector.ts - Audio Silence Detection for Non-Deepgram Tiers
 *
 * When not using Deepgram (which provides utterance_end events), we need
 * to detect pauses in speech ourselves to trigger screenshots.
 *
 * Algorithm:
 * - Calculate RMS energy of audio chunks
 * - Track speaking/silence state transitions
 * - Emit silence events after configurable pause duration
 * - Debounce to prevent rapid-fire events
 */

import { EventEmitter } from 'events';
import type { SilenceDetectorConfig, SilenceCallback } from './types';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: SilenceDetectorConfig = {
  silenceThreshold: 0.015, // Slightly above noise floor
  silenceDurationMs: 1200, // Match Deepgram's utterance_end_ms default
  debounceDurationMs: 500, // Prevent rapid events
  sampleRate: 16000,
};

// ============================================================================
// SilenceDetector Class
// ============================================================================

export class SilenceDetector extends EventEmitter {
  private config: SilenceDetectorConfig;
  private isActive: boolean = false;

  // State tracking
  private isSpeaking: boolean = false;
  private silenceStartTime: number = 0;
  private lastSilenceEventTime: number = 0;

  // Running average for adaptive threshold (optional enhancement)
  private rmsHistory: number[] = [];
  private readonly RMS_HISTORY_SIZE = 50;

  // Callbacks
  private silenceCallbacks: SilenceCallback[] = [];

  constructor(config?: Partial<SilenceDetectorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Start silence detection
   */
  start(): void {
    if (this.isActive) {
      return;
    }

    this.isActive = true;
    this.isSpeaking = false;
    this.silenceStartTime = 0;
    this.lastSilenceEventTime = 0;
    this.rmsHistory = [];

    this.log('Silence detection started');
  }

  /**
   * Stop silence detection
   */
  stop(): void {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;
    this.rmsHistory = [];
    this.log('Silence detection stopped');
  }

  /**
   * Check if detector is active
   */
  isRunning(): boolean {
    return this.isActive;
  }

  /**
   * Process an audio chunk
   * @param samples Float32Array of audio samples (16kHz mono)
   * @param durationMs Duration of this chunk in milliseconds
   */
  addAudio(samples: Float32Array, durationMs: number): void {
    if (!this.isActive) {
      return;
    }

    const rms = this.calculateRMS(samples);
    this.updateRmsHistory(rms);

    const isSpeech = rms > this.config.silenceThreshold;
    const now = Date.now();

    if (isSpeech) {
      // Voice detected
      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.silenceStartTime = 0;
      }
    } else {
      // Silence detected
      if (this.isSpeaking) {
        // Transition from speaking to silence
        this.isSpeaking = false;
        this.silenceStartTime = now;
      } else if (this.silenceStartTime > 0) {
        // Already in silence - check if long enough
        const silenceDuration = now - this.silenceStartTime;

        if (silenceDuration >= this.config.silenceDurationMs) {
          // Check debounce
          const timeSinceLastEvent = now - this.lastSilenceEventTime;

          if (timeSinceLastEvent >= this.config.debounceDurationMs) {
            this.emitSilence(now / 1000);
            this.silenceStartTime = 0; // Reset to prevent repeated events
          }
        }
      }
    }
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<SilenceDetectorConfig>): void {
    this.config = { ...this.config, ...config };
    this.log(
      `Config updated: silenceDuration=${this.config.silenceDurationMs}ms, threshold=${this.config.silenceThreshold}`
    );
  }

  /**
   * Get current configuration
   */
  getConfig(): SilenceDetectorConfig {
    return { ...this.config };
  }

  /**
   * Get the current speaking state
   */
  isSpeakingNow(): boolean {
    return this.isSpeaking;
  }

  /**
   * Get average RMS level (useful for UI visualization)
   */
  getAverageRms(): number {
    if (this.rmsHistory.length === 0) {
      return 0;
    }
    const sum = this.rmsHistory.reduce((a, b) => a + b, 0);
    return sum / this.rmsHistory.length;
  }

  /**
   * Subscribe to silence events
   */
  onSilenceDetected(callback: SilenceCallback): () => void {
    this.silenceCallbacks.push(callback);
    return () => {
      this.silenceCallbacks = this.silenceCallbacks.filter((cb) => cb !== callback);
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Calculate Root Mean Square of audio samples
   * RMS is a common measure of audio energy/loudness
   */
  private calculateRMS(samples: Float32Array): number {
    if (samples.length === 0) {
      return 0;
    }

    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  /**
   * Update RMS history for adaptive threshold (future enhancement)
   */
  private updateRmsHistory(rms: number): void {
    this.rmsHistory.push(rms);
    if (this.rmsHistory.length > this.RMS_HISTORY_SIZE) {
      this.rmsHistory.shift();
    }
  }

  /**
   * Emit a silence detection event
   */
  private emitSilence(timestamp: number): void {
    this.lastSilenceEventTime = Date.now();

    this.log(`Silence detected at ${timestamp.toFixed(2)}s`);
    this.silenceCallbacks.forEach((cb) => cb(timestamp));
    this.emit('silence', timestamp);
  }

  /**
   * Log helper
   */
  private log(message: string): void {
    console.log(`[SilenceDetector] ${message}`);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const silenceDetector = new SilenceDetector();
export default SilenceDetector;
