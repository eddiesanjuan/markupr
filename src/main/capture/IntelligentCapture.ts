/**
 * IntelligentCapture - Intelligent Screenshot Trigger for FeedbackFlow
 *
 * This is the SMART bridge between Deepgram's utterance_end events and screenshot capture.
 *
 * Features:
 * - Triggers screenshots on Deepgram utterance_end (1200ms natural pause)
 * - Supports manual screenshot via global hotkey (Cmd+Shift+S)
 * - 500ms debounce to prevent rapid captures
 * - Maintains 3-second rolling transcript window for association
 * - Emits events with full context for downstream consumers
 *
 * Architecture:
 *   TranscriptionService.onUtteranceEnd() ----\
 *                                              +--> IntelligentCapture --> SessionController
 *   HotkeyManager.onHotkey('manualScreenshot') /
 */

import { EventEmitter } from 'events';
import type { TranscriptionService, TranscriptResult } from '../transcription/TranscriptionService';
import type { ScreenCaptureService, Screenshot } from './ScreenCapture';
import type { IHotkeyManager, HotkeyAction } from '../HotkeyManager';

// =============================================================================
// Types
// =============================================================================

/**
 * Trigger type for capture decision
 */
export type CaptureTrigger = 'pause' | 'manual';

/**
 * Decision object with full context for screenshot association
 */
export interface CaptureDecision {
  /** What triggered this capture */
  trigger: CaptureTrigger;
  /** When the capture was triggered (ms since epoch) */
  timestamp: number;
  /** Confidence level (1.0 for manual, 0.9 for pause) */
  confidence: number;
  /** Recent transcripts within the 3s window for association */
  transcriptWindow: TranscriptResult[];
}

/**
 * Screenshot result with capture decision context
 */
export interface IntelligentScreenshot {
  /** The captured screenshot */
  screenshot: Screenshot;
  /** The decision context that triggered this capture */
  decision: CaptureDecision;
}

/**
 * Callback type for screenshot events
 */
export type ScreenshotCallback = (screenshot: Screenshot, decision: CaptureDecision) => void;

/**
 * Callback type for capture errors
 */
export type CaptureErrorCallback = (error: Error, trigger: CaptureTrigger) => void;

/**
 * IntelligentCapture service interface
 */
export interface IntelligentCaptureService {
  /**
   * Initialize with required service dependencies
   */
  initialize(
    transcriptionService: TranscriptionService,
    screenCapture: ScreenCaptureService,
    hotkeyManager: IHotkeyManager
  ): void;

  /**
   * Set the source ID to capture from (window or screen)
   */
  setSourceId(sourceId: string): void;

  /**
   * Start listening for capture triggers
   */
  start(): void;

  /**
   * Stop listening for capture triggers
   */
  stop(): void;

  /**
   * Check if currently active
   */
  isActive(): boolean;

  /**
   * Get statistics for current session
   */
  getStats(): CaptureStats;

  /**
   * Subscribe to screenshot events
   */
  onScreenshot(callback: ScreenshotCallback): () => void;

  /**
   * Subscribe to capture errors
   */
  onError(callback: CaptureErrorCallback): () => void;
}

/**
 * Statistics for capture session
 */
export interface CaptureStats {
  /** Total screenshots captured */
  totalCaptures: number;
  /** Screenshots triggered by pause */
  pauseCaptures: number;
  /** Screenshots triggered manually */
  manualCaptures: number;
  /** Captures skipped due to debounce */
  debouncedCount: number;
  /** Captures that failed */
  failedCount: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Debounce period to prevent rapid captures (ms) */
const DEBOUNCE_MS = 500;

/** Window duration for transcript association (ms) */
const TRANSCRIPT_WINDOW_MS = 3000;

/** Maximum transcripts to keep in window */
const MAX_WINDOW_SIZE = 100;

/** Confidence level for pause-triggered captures */
const PAUSE_CONFIDENCE = 0.9;

/** Confidence level for manual captures */
const MANUAL_CONFIDENCE = 1.0;

// =============================================================================
// Implementation
// =============================================================================

class IntelligentCaptureServiceImpl implements IntelligentCaptureService {
  private events = new EventEmitter();
  private _isActive = false;
  private sourceId: string | null = null;

  // Service dependencies
  private transcriptionService: TranscriptionService | null = null;
  private screenCapture: ScreenCaptureService | null = null;
  private hotkeyManager: IHotkeyManager | null = null;

  // Cleanup functions for event subscriptions
  private cleanupFunctions: Array<() => void> = [];

  // Debounce state
  private lastCaptureTime = 0;
  private isCapturing = false;

  // Transcript window (rolling buffer)
  private transcriptWindow: TranscriptResult[] = [];

  // Statistics
  private stats: CaptureStats = {
    totalCaptures: 0,
    pauseCaptures: 0,
    manualCaptures: 0,
    debouncedCount: 0,
    failedCount: 0,
  };

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Initialize with service dependencies
   * Must be called before start()
   */
  initialize(
    transcriptionService: TranscriptionService,
    screenCapture: ScreenCaptureService,
    hotkeyManager: IHotkeyManager
  ): void {
    if (this._isActive) {
      throw new Error('Cannot initialize while active. Call stop() first.');
    }

    this.transcriptionService = transcriptionService;
    this.screenCapture = screenCapture;
    this.hotkeyManager = hotkeyManager;

    this.log('Initialized with services');
  }

  /**
   * Set the capture source ID (screen or window)
   */
  setSourceId(sourceId: string): void {
    this.sourceId = sourceId;
    this.log(`Source ID set: ${sourceId}`);
  }

  /**
   * Start listening for capture triggers
   */
  start(): void {
    if (this._isActive) {
      this.log('Already active, skipping start');
      return;
    }

    if (!this.transcriptionService || !this.screenCapture || !this.hotkeyManager) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    if (!this.sourceId) {
      throw new Error('Source ID not set. Call setSourceId() first.');
    }

    // Subscribe to utterance end events (pause detection)
    const unsubUtterance = this.transcriptionService.onUtteranceEnd((timestamp) => {
      this.handleUtteranceEnd(timestamp);
    });
    this.cleanupFunctions.push(unsubUtterance);

    // Subscribe to transcript events to build the rolling window
    const unsubTranscript = this.transcriptionService.onTranscript((result) => {
      this.addToTranscriptWindow(result);
    });
    this.cleanupFunctions.push(unsubTranscript);

    // Subscribe to manual screenshot hotkey
    const unsubHotkey = this.hotkeyManager.onHotkey((action: HotkeyAction) => {
      if (action === 'manualScreenshot') {
        this.handleManualTrigger();
      }
    });
    this.cleanupFunctions.push(unsubHotkey);

    // Reset state
    this.transcriptWindow = [];
    this.lastCaptureTime = 0;
    this.isCapturing = false;
    this.resetStats();

    this._isActive = true;
    this.log('Started - listening for triggers');
  }

  /**
   * Stop listening for capture triggers
   */
  stop(): void {
    if (!this._isActive) {
      return;
    }

    // Unsubscribe from all events
    for (const cleanup of this.cleanupFunctions) {
      try {
        cleanup();
      } catch (error) {
        this.logError('Error during cleanup', error);
      }
    }
    this.cleanupFunctions = [];

    // Clear state
    this.transcriptWindow = [];
    this.isCapturing = false;
    this._isActive = false;

    this.log(`Stopped - ${this.stats.totalCaptures} captures, ${this.stats.debouncedCount} debounced`);
  }

  /**
   * Check if currently active
   */
  isActive(): boolean {
    return this._isActive;
  }

  /**
   * Get capture statistics
   */
  getStats(): CaptureStats {
    return { ...this.stats };
  }

  /**
   * Subscribe to screenshot events
   */
  onScreenshot(callback: ScreenshotCallback): () => void {
    this.events.on('screenshot', callback);
    return () => {
      this.events.off('screenshot', callback);
    };
  }

  /**
   * Subscribe to capture errors
   */
  onError(callback: CaptureErrorCallback): () => void {
    this.events.on('error', callback);
    return () => {
      this.events.off('error', callback);
    };
  }

  // =========================================================================
  // Event Handlers
  // =========================================================================

  /**
   * Handle utterance end event from transcription service
   * This is the primary intelligent trigger - Deepgram's 1200ms pause detection
   */
  private handleUtteranceEnd(_timestamp: number): void {
    if (!this._isActive) {
      return;
    }

    this.log('Utterance ended - pause detected');
    this.triggerCapture('pause');
  }

  /**
   * Handle manual screenshot hotkey
   */
  private handleManualTrigger(): void {
    if (!this._isActive) {
      // Allow manual screenshots even when not "recording"
      // This provides a quick screenshot feature
      this.log('Manual trigger received but not active - ignoring');
      return;
    }

    this.log('Manual screenshot triggered');
    this.triggerCapture('manual');
  }

  // =========================================================================
  // Transcript Window Management
  // =========================================================================

  /**
   * Add a transcript result to the rolling window
   * Only keeps final transcripts within the time window
   */
  private addToTranscriptWindow(result: TranscriptResult): void {
    if (!this._isActive) {
      return;
    }

    // Only track final transcripts for association
    if (result.isFinal) {
      this.transcriptWindow.push(result);
    }

    // Prune old transcripts outside the window
    this.pruneTranscriptWindow();
  }

  /**
   * Prune transcripts older than the window duration
   */
  private pruneTranscriptWindow(): void {
    const now = Date.now();
    const cutoffMs = now - TRANSCRIPT_WINDOW_MS;

    // Filter by timestamp - convert transcript seconds to ms for comparison
    this.transcriptWindow = this.transcriptWindow.filter((t) => {
      const transcriptMs = t.timestamp * 1000;
      return transcriptMs > cutoffMs;
    });

    // Also cap at max size to prevent memory issues
    if (this.transcriptWindow.length > MAX_WINDOW_SIZE) {
      this.transcriptWindow = this.transcriptWindow.slice(-MAX_WINDOW_SIZE);
    }
  }

  /**
   * Get a snapshot of the current transcript window
   */
  private getTranscriptWindowSnapshot(): TranscriptResult[] {
    // Prune first to ensure freshness
    this.pruneTranscriptWindow();

    // Return a copy to prevent mutation
    return [...this.transcriptWindow];
  }

  // =========================================================================
  // Capture Logic
  // =========================================================================

  /**
   * Trigger a screenshot capture with debounce protection
   */
  private async triggerCapture(trigger: CaptureTrigger): Promise<void> {
    const now = Date.now();

    // Debounce check - prevent rapid captures
    if (now - this.lastCaptureTime < DEBOUNCE_MS) {
      this.stats.debouncedCount++;
      this.log(`Capture debounced (${now - this.lastCaptureTime}ms since last)`);
      return;
    }

    // Prevent concurrent captures
    if (this.isCapturing) {
      this.stats.debouncedCount++;
      this.log('Capture already in progress, skipping');
      return;
    }

    // Validate state
    if (!this.sourceId || !this.screenCapture) {
      this.logError('Cannot capture: missing sourceId or screenCapture service');
      return;
    }

    this.isCapturing = true;
    this.lastCaptureTime = now;

    try {
      // Build the capture decision with context
      const decision: CaptureDecision = {
        trigger,
        timestamp: now,
        confidence: trigger === 'manual' ? MANUAL_CONFIDENCE : PAUSE_CONFIDENCE,
        transcriptWindow: this.getTranscriptWindowSnapshot(),
      };

      // Capture the screenshot
      const screenshot = await this.screenCapture.capture(this.sourceId);

      // Update statistics
      this.stats.totalCaptures++;
      if (trigger === 'pause') {
        this.stats.pauseCaptures++;
      } else {
        this.stats.manualCaptures++;
      }

      // Emit the screenshot event
      this.events.emit('screenshot', screenshot, decision);

      this.log(
        `Captured (${trigger}): ${screenshot.width}x${screenshot.height}, ` +
        `${decision.transcriptWindow.length} transcripts in window`
      );

    } catch (error) {
      this.stats.failedCount++;
      this.logError(`Capture failed (${trigger})`, error);

      // Emit error event
      const captureError = error instanceof Error ? error : new Error(String(error));
      this.events.emit('error', captureError, trigger);
    } finally {
      this.isCapturing = false;
    }
  }

  // =========================================================================
  // Utilities
  // =========================================================================

  /**
   * Reset statistics
   */
  private resetStats(): void {
    this.stats = {
      totalCaptures: 0,
      pauseCaptures: 0,
      manualCaptures: 0,
      debouncedCount: 0,
      failedCount: 0,
    };
  }

  /**
   * Log a message with timestamp
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    console.log(`[IntelligentCapture ${timestamp}] ${message}`);
  }

  /**
   * Log an error with timestamp
   */
  private logError(message: string, error?: unknown): void {
    const timestamp = new Date().toISOString();
    const errorStr = error instanceof Error ? error.message : error ? String(error) : '';
    console.error(
      `[IntelligentCapture ${timestamp}] ERROR: ${message}${errorStr ? ` - ${errorStr}` : ''}`
    );
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

/**
 * Singleton instance of IntelligentCapture service
 *
 * Usage:
 * ```typescript
 * import { intelligentCapture } from './capture/IntelligentCapture';
 *
 * // Initialize with services
 * intelligentCapture.initialize(transcriptionService, screenCapture, hotkeyManager);
 *
 * // Set capture source
 * intelligentCapture.setSourceId('screen:1:0');
 *
 * // Subscribe to screenshots
 * intelligentCapture.onScreenshot((screenshot, decision) => {
 *   console.log(`Captured: ${decision.trigger}, ${decision.transcriptWindow.length} transcripts`);
 * });
 *
 * // Start listening
 * intelligentCapture.start();
 *
 * // ... later ...
 * intelligentCapture.stop();
 * ```
 */
export const intelligentCapture = new IntelligentCaptureServiceImpl();

// Export class for testing
export { IntelligentCaptureServiceImpl };

export default intelligentCapture;
