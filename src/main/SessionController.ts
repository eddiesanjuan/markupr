/**
 * SessionController - Core Orchestrator for FeedbackFlow
 *
 * Implements a bulletproof finite state machine for session lifecycle:
 *   idle -> starting -> recording -> stopping -> processing -> complete
 *
 * Responsibilities:
 * - Coordinate all services (audio, capture, transcription)
 * - Manage session state with crash recovery (auto-save every 5 seconds)
 * - Watchdog timer to prevent stuck states
 * - Match screenshots to transcripts within 3-second window
 * - Emit state changes to renderer via IPC
 */

import Store from 'electron-store';
import { BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { audioCapture, type AudioChunk } from './audio/AudioCapture';
import { screenCapture } from './capture/ScreenCapture';
import { tierManager, whisperService, transcriptionService } from './transcription';
import type { TranscriptEvent, TranscriptionTier } from './transcription/types';
import { getSettingsManager } from './settings';
import { IPC_CHANNELS } from '../shared/types';
import { errorHandler } from './ErrorHandler';
// Note: CrashRecovery module runs independently for crash logging.
// Session recovery is handled directly in SessionController for full access to session data.

// =============================================================================
// Types - Bulletproof State Machine
// =============================================================================

/**
 * All possible session states.
 * Every state except 'idle' has a maximum timeout for automatic recovery.
 */
export type SessionState =
  | 'idle'       // Waiting for user action
  | 'starting'   // Initializing services (5s timeout)
  | 'recording'  // Active recording (30 min max)
  | 'stopping'   // Stopping services (3s timeout)
  | 'processing' // Processing results (10s timeout)
  | 'complete'   // Session finished (30s timeout then auto-idle)
  | 'error';     // Error occurred (5s timeout then auto-idle)

/**
 * State timeout configuration (in milliseconds).
 * Every state except 'idle' has a maximum duration.
 */
export const STATE_TIMEOUTS: Record<SessionState, number | null> = {
  idle: null,              // Infinite - waits for user action
  starting: 5_000,         // 5 seconds to initialize
  recording: 30 * 60_000,  // 30 minutes max recording
  stopping: 3_000,         // 3 seconds to stop services
  processing: 60_000,      // 60 seconds to process
  complete: 30_000,        // 30 seconds to show completion
  error: 5_000,            // 5 seconds to show error
} as const;

/**
 * Recording duration warnings and limits
 */
export const RECORDING_LIMITS = {
  WARNING_DURATION_MS: 25 * 60_000,  // 25 minutes - show warning
  MAX_DURATION_MS: 30 * 60_000,       // 30 minutes - force stop
} as const;

export interface Screenshot {
  id: string;
  timestamp: number;
  buffer: Buffer;
  width: number;
  height: number;
  base64?: string;
  trigger?: ScreenshotTrigger;
}

export interface FeedbackItem {
  id: string;
  timestamp: number;
  text: string;
  screenshot?: Screenshot;
  confidence: number;
}

export type ScreenshotTrigger = 'pause' | 'manual' | 'voice-command';

export interface SessionMetadata {
  sourceId: string;
  sourceName?: string;
  windowTitle?: string;
  appName?: string;
  recordingPath?: string;
  recordingMimeType?: string;
  recordingBytes?: number;
  audioPath?: string;
  audioBytes?: number;
  audioDurationMs?: number;
}

export interface Session {
  id: string;
  startTime: number;
  endTime?: number;
  state: SessionState;
  sourceId: string;
  feedbackItems: FeedbackItem[];
  transcriptBuffer: TranscriptEvent[];
  screenshotBuffer: Screenshot[];
  metadata: SessionMetadata;
}

export interface SessionStatus {
  state: SessionState;
  duration: number;
  feedbackCount: number;
  screenshotCount: number;
}

export interface SessionControllerEvents {
  onStateChange: (state: SessionState, session: Session | null) => void;
  onFeedbackItem: (item: FeedbackItem) => void;
  onError: (error: Error) => void;
}

/**
 * Valid state transitions.
 * Every state has a path back to 'idle' for recovery.
 */
const STATE_TRANSITIONS: Record<SessionState, SessionState[]> = {
  idle: ['starting'],
  starting: ['recording', 'error', 'idle'],  // success, error, or cancel
  recording: ['stopping', 'error', 'idle'],  // stop, error, or cancel
  stopping: ['processing', 'error', 'idle'], // success, error, or cancel
  processing: ['complete', 'error', 'idle'], // success, error, or timeout
  complete: ['idle'],                         // only back to idle
  error: ['idle'],                            // only back to idle
};

// =============================================================================
// Persistence Store Schema
// =============================================================================

// Session data for persistence (without Buffer objects)
interface PersistedSession {
  id: string;
  startTime: number;
  endTime?: number;
  state: SessionState;
  sourceId: string;
  feedbackItemCount: number;
  metadata: SessionMetadata;
}

/**
 * Persisted state format for crash recovery.
 * Contains everything needed to show recovery dialog and restore session.
 */
interface PersistedState {
  version: 1;
  state: SessionState;
  stateEnteredAt: number;
  session: PersistedSession | null;
  lastPersistedAt: number;
  feedbackItemIds: string[];  // IDs only - full data separate
}

interface StoreSchema {
  currentSession: PersistedSession | null;
  recentSessions: PersistedSession[];
  lastCrashRecoveryCheck: number;
  // New fields for bulletproof state machine
  persistedState: PersistedState | null;
  persistedFeedbackItems: Array<{
    id: string;
    timestamp: number;
    text: string;
    confidence: number;
    hasScreenshot: boolean;
  }> | null;
  lastCleanExit: boolean;
  lastExitTimestamp: number;
}

const store = new Store<StoreSchema>({
  name: 'feedbackflow-sessions',
  defaults: {
    currentSession: null,
    recentSessions: [],
    lastCrashRecoveryCheck: 0,
    persistedState: null,
    persistedFeedbackItems: null,
    lastCleanExit: true,
    lastExitTimestamp: 0,
  },
  // Clear on corruption
  clearInvalidConfig: true,
});

// =============================================================================
// SessionController Class
// =============================================================================

/**
 * Crash recovery info returned to caller.
 */
export interface CrashRecoveryInfo {
  sessionId: string;
  startTime: number;
  duration: number;
  feedbackCount: number;
  lastState: SessionState;
  lastPersistedAt: number;
  canRecover: boolean;
  recoveryReason: string;
}

export class SessionController {
  // Core state
  private state: SessionState = 'idle';
  private session: Session | null = null;
  private events: SessionControllerEvents | null = null;
  private mainWindow: BrowserWindow | null = null;

  // Service references (using actual implementations)
  private audioCaptureService: typeof audioCapture;
  private screenCaptureService: typeof screenCapture;

  // Cleanup functions for event subscriptions
  private cleanupFunctions: Array<() => void> = [];

  // Timers
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private durationTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private statePersistenceTimer: NodeJS.Timeout | null = null;

  // Watchdog state
  private stateEnteredAt: number = Date.now();
  private recordingWarningShown: boolean = false;

  // Pending screenshots
  private pendingScreenshots: Screenshot[] = [];
  private screenshotCaptureInFlight = false;
  private lastScreenshotCapturedAt = 0;

  // Configuration constants
  private readonly AUTO_SAVE_INTERVAL_MS = 5000;       // 5 seconds (per spec)
  private readonly WATCHDOG_CHECK_INTERVAL_MS = 1000;  // 1 second
  private readonly TRANSCRIPT_MATCH_WINDOW_MS = 3000;
  private readonly SCREENSHOT_DEBOUNCE_MS = 450;
  private readonly MAX_RECENT_SESSIONS = 10;
  private readonly MAX_TRANSCRIPT_BUFFER_EVENTS = 2000;
  private readonly VOICE_SCREENSHOT_COMMANDS: RegExp[] = [
    /\b(?:take|grab|capture)\s+(?:a\s+)?screenshot\b/i,
    /\bscreenshot\s+(?:this|that|now|here)\b/i,
    /^(?:please\s+)?screenshot(?:\s+now)?[.!?]*$/i,
  ];

  constructor() {
    // Use singleton instances
    this.audioCaptureService = audioCapture;
    this.screenCaptureService = screenCapture;
  }

  // ===========================================================================
  // Timeout Utilities
  // ===========================================================================

  /**
   * Wraps an async operation with a timeout.
   * If the operation takes longer than timeoutMs, returns the fallback value.
   *
   * @param operation - The promise to wrap
   * @param timeoutMs - Maximum time to wait in milliseconds
   * @param fallback - Value to return if timeout occurs
   * @param operationName - Name for logging purposes
   * @returns Promise resolving to either the operation result or the fallback
   */
  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    fallback: T,
    operationName: string = 'operation'
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([operation, timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);
      return result;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      console.warn(`[SessionController] ${operationName} timeout/error, using fallback:`, error);
      return fallback;
    }
  }

  /**
   * Wraps a synchronous function that may block, converting it to async with timeout.
   * Useful for wrapping service.stop() calls that don't return promises.
   */
  private async withTimeoutSync(
    fn: () => void,
    timeoutMs: number,
    operationName: string = 'operation'
  ): Promise<void> {
    return this.withTimeout(
      new Promise<void>((resolve) => {
        try {
          fn();
          resolve();
        } catch (error) {
          console.warn(`[SessionController] ${operationName} threw:`, error);
          resolve(); // Still resolve - we don't want to block
        }
      }),
      timeoutMs,
      undefined,
      operationName
    );
  }

  /**
   * Initialize the SessionController
   * Checks for incomplete sessions from crashes and offers recovery
   *
   * @returns Recovery info if an incomplete session was found
   */
  async initialize(): Promise<CrashRecoveryInfo | null> {
    console.log('[SessionController] Initializing...');

    // Start watchdog immediately
    this.startWatchdog();

    // Check for crash recovery
    const recoveryInfo = this.checkCrashRecovery();

    // Start state persistence
    this.startStatePersistence();

    store.set('lastCrashRecoveryCheck', Date.now());
    console.log('[SessionController] Initialization complete');

    return recoveryInfo;
  }

  /**
   * Check for incomplete sessions from crashes.
   * Called during initialization.
   */
  private checkCrashRecovery(): CrashRecoveryInfo | null {
    const lastCleanExit = store.get('lastCleanExit', true);
    const persistedState = store.get('persistedState');

    // Mark that we're starting (not a clean exit until we explicitly mark it)
    store.set('lastCleanExit', false);

    // No persisted state
    if (!persistedState || !persistedState.session) {
      console.log('[SessionController] No persisted state found');
      return null;
    }

    // Was a clean exit
    if (lastCleanExit && persistedState.state === 'idle') {
      console.log('[SessionController] Last exit was clean, no recovery needed');
      store.delete('persistedState');
      return null;
    }

    // Check if the persisted state indicates an incomplete session
    const wasInterrupted = ['starting', 'recording', 'stopping', 'processing'].includes(
      persistedState.state
    );

    if (!wasInterrupted) {
      console.log(`[SessionController] Persisted state '${persistedState.state}' does not need recovery`);
      store.delete('persistedState');
      return null;
    }

    // Calculate how old the persisted state is
    const stateAge = Date.now() - persistedState.lastPersistedAt;
    const maxRecoveryAge = 60 * 60_000; // 1 hour max

    const session = persistedState.session;
    const duration = (persistedState.lastPersistedAt - session.startTime);

    const recoveryInfo: CrashRecoveryInfo = {
      sessionId: session.id,
      startTime: session.startTime,
      duration,
      feedbackCount: session.feedbackItemCount,
      lastState: persistedState.state,
      lastPersistedAt: persistedState.lastPersistedAt,
      canRecover: stateAge < maxRecoveryAge,
      recoveryReason: stateAge >= maxRecoveryAge
        ? `Session is too old (${Math.round(stateAge / 60_000)} minutes)`
        : 'Session was interrupted',
    };

    console.log('[SessionController] Crash recovery detected:', {
      sessionId: recoveryInfo.sessionId,
      lastState: recoveryInfo.lastState,
      feedbackCount: recoveryInfo.feedbackCount,
      stateAge: `${Math.round(stateAge / 1000)}s`,
      canRecover: recoveryInfo.canRecover,
    });

    return recoveryInfo;
  }

  /**
   * Attempt to recover an incomplete session.
   * Called after user confirms they want to recover.
   */
  async recoverSession(): Promise<boolean> {
    const persistedState = store.get('persistedState');
    const persistedFeedback = store.get('persistedFeedbackItems');

    if (!persistedState || !persistedState.session) {
      console.warn('[SessionController] No session to recover');
      return false;
    }

    console.log('[SessionController] Recovering session:', persistedState.session.id);

    // Create a minimal recovered session and add to recent
    const recoveredSession: PersistedSession = {
      id: persistedState.session.id,
      startTime: persistedState.session.startTime,
      endTime: persistedState.lastPersistedAt,
      state: 'complete',
      sourceId: persistedState.session.sourceId,
      feedbackItemCount: persistedFeedback?.length || 0,
      metadata: persistedState.session.metadata,
    };

    // Add to recent sessions
    this.addToRecentSessionsPersisted(recoveredSession);

    // Clear persisted state
    store.delete('persistedState');
    store.delete('persistedFeedbackItems');

    console.log('[SessionController] Session recovered:', {
      id: recoveredSession.id,
      feedbackItems: recoveredSession.feedbackItemCount,
    });

    // Emit recovered session to renderer
    this.emitToRenderer('session:recovered', {
      session: {
        id: recoveredSession.id,
        feedbackCount: recoveredSession.feedbackItemCount,
        duration: (recoveredSession.endTime || Date.now()) - recoveredSession.startTime,
      },
    });

    return true;
  }

  /**
   * Discard a recoverable session.
   * Called when user declines recovery.
   */
  discardRecovery(): void {
    console.log('[SessionController] Discarding recoverable session');
    store.delete('persistedState');
    store.delete('persistedFeedbackItems');
  }

  /**
   * Set the main window for IPC communication
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
    // Also set on audio capture service (it needs window for renderer communication)
    this.audioCaptureService.setMainWindow(window);
  }

  /**
   * Set event callbacks
   */
  setEventCallbacks(events: SessionControllerEvents): void {
    this.events = events;
  }

  /**
   * Configure transcription service with API key
   * Note: TierManager handles API key configuration internally via settings
   * This method is kept for backward compatibility but is now a no-op
   */
  configureTranscription(_apiKey: string): void {
    // TierManager reads API key from settings automatically
    // No action needed here
  }

  // ===========================================================================
  // State Machine
  // ===========================================================================

  /**
   * Transition to a new state with validation.
   * Updates state entry time for watchdog tracking.
   */
  private transition(newState: SessionState): boolean {
    const validTransitions = STATE_TRANSITIONS[this.state];

    if (!validTransitions.includes(newState)) {
      console.error(
        `[SessionController] Invalid state transition: ${this.state} -> ${newState}`
      );
      return false;
    }

    const oldState = this.state;
    this.state = newState;
    this.stateEnteredAt = Date.now();
    this.recordingWarningShown = false; // Reset for new state

    // Update session state if exists
    if (this.session) {
      this.session.state = newState;
    }

    console.log(`[SessionController] State: ${oldState} -> ${newState}`);

    // Persist state change immediately
    this.persistState();

    // Notify listeners
    this.emitStateChange();

    return true;
  }

  /**
   * Get current state
   */
  getState(): SessionState {
    return this.state;
  }

  // ===========================================================================
  // Session Lifecycle
  // ===========================================================================

  /**
   * Start a new recording session.
   * Transitions: idle -> starting -> recording
   */
  async start(sourceId: string, sourceName?: string): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot start session from state: ${this.state}`);
    }

    console.log(`[SessionController] Starting session for source: ${sourceId}`);

    // Transition to starting state FIRST
    if (!this.transition('starting')) {
      throw new Error('Failed to transition to starting state');
    }

    // Reset counters
    this.audioChunkCount = 0;

    // Create new session
    this.session = {
      id: randomUUID(),
      startTime: Date.now(),
      state: 'starting',
      sourceId,
      feedbackItems: [],
      transcriptBuffer: [],
      screenshotBuffer: [],
      metadata: {
        sourceId,
        sourceName,
      },
    };

    // Persist immediately
    this.persistState();

    try {
      // Initialize services with timeout protection
      await this.initializeServicesWithTimeout();

      // Transition to recording
      if (!this.transition('recording')) {
        throw new Error('Failed to transition to recording state');
      }
      this.session.state = 'recording';

      // Start timers
      this.startAutoSave();
      this.startDurationTimer();

      // Persist successful start
      this.persistState();

      console.log(`[SessionController] Session started: ${this.session.id}`);
    } catch (error) {
      console.error('[SessionController] Failed to start services:', error);

      // Cleanup on failure
      await this.cleanupServicesAsync();
      this.session = null;

      // Transition to error state (which will auto-recover to idle)
      try {
        this.transition('error');
        this.emitToRenderer(IPC_CHANNELS.SESSION_ERROR, {
          type: 'startError',
          message: error instanceof Error ? error.message : 'Failed to start session',
        });
      } catch {
        // If transition fails, force to idle
        this.transitionForced('idle');
      }

      throw error;
    }
  }

  /**
   * Initialize all services with timeout protection.
   * Total timeout: 5 seconds (starting state timeout).
   */
  private async initializeServicesWithTimeout(): Promise<void> {
    const totalTimeout = STATE_TIMEOUTS.starting!;
    const startTime = Date.now();

    // Subscribe to audio events
    const unsubAudioChunk = this.audioCaptureService.onAudioChunk((chunk) =>
      this.handleAudioChunk(chunk)
    );
    const unsubVoiceActivity = this.audioCaptureService.onVoiceActivity((active) =>
      this.handleVoiceActivity(active)
    );
    const unsubAudioError = this.audioCaptureService.onError((error) =>
      this.handleServiceError('audio', error)
    );

    this.cleanupFunctions.push(unsubAudioChunk, unsubVoiceActivity, unsubAudioError);

    // Subscribe to transcription events via TierManager
    const unsubTranscript = tierManager.onTranscript((event) =>
      this.handleTranscriptResult(event)
    );
    const unsubPause = tierManager.onPause((event) =>
      this.handleUtteranceEnd(event.timestamp)
    );
    const unsubTransError = tierManager.onError((error) =>
      this.handleServiceError('transcription', error)
    );
    const unsubTierChange = tierManager.onTierChange((fromTier, toTier, reason) => {
      void this.handleTranscriptionTierChange(fromTier, toTier, reason);
    });

    this.cleanupFunctions.push(unsubTranscript, unsubPause, unsubTransError, unsubTierChange);

    // Calculate remaining time
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(totalTimeout - elapsed, 1000);

    // Start transcription service with timeout (TierManager auto-selects best tier)
    const selectedTier = await this.withTimeout(
      tierManager.start(),
      remaining / 2, // Half of remaining time
      'timer-only' as const,
      'TierManager.start()'
    );

    if (tierManager.tierProvidesTranscription(selectedTier)) {
      console.log(`[SessionController] Transcription tier active: ${selectedTier}`);
    } else {
      console.warn(
        `[SessionController] Started without live transcription (tier: "${selectedTier}"). ` +
        'Session recording will continue and post-session transcript recovery will be attempted from captured audio.'
      );
    }

    // Check if we still have time
    const elapsed2 = Date.now() - startTime;
    const remaining2 = Math.max(totalTimeout - elapsed2, 500);

    // Start audio capture with timeout
    const audioStarted = await this.withTimeout(
      this.audioCaptureService.start().then(() => true),
      remaining2,
      false,
      'AudioCapture.start()'
    );

    if (!audioStarted) {
      throw new Error(
        'Microphone capture failed to start. Check microphone permission and selected input device, then retry.'
      );
    }
  }

  /**
   * Stop the current session and process results.
   * Transitions: recording -> stopping -> processing -> complete
   */
  async stop(): Promise<Session | null> {
    if (this.state !== 'recording') {
      console.warn(`[SessionController] Cannot stop from state: ${this.state}`);
      return null;
    }

    if (!this.session) {
      console.warn('[SessionController] No active session to stop');
      return null;
    }

    console.log(`[SessionController] Stopping session: ${this.session.id}`);

    // Transition to stopping state
    if (!this.transition('stopping')) {
      console.error('[SessionController] Failed to transition to stopping state');
      return null;
    }
    this.session.state = 'stopping';

    // Stop services with timeout protection
    await this.withTimeout(
      this.cleanupServicesAsync(),
      STATE_TIMEOUTS.stopping!,
      undefined,
      'cleanupServices'
    );

    // Transition to processing
    if (!this.transition('processing')) {
      console.error('[SessionController] Failed to transition to processing state');
      // Force complete with partial data
      this.transitionForced('complete');
    }
    this.session.state = 'processing';

    // If live streaming transcripts were unavailable, run a post-session Whisper
    // fallback with retries before matching pending screenshots.
    await this.withTimeout(
      this.recoverTranscriptFromCapturedAudio(),
      Math.floor(STATE_TIMEOUTS.processing! * 0.6),
      undefined,
      'recoverTranscriptFromCapturedAudio'
    );

    // Process pending screenshots with timeout
    await this.withTimeout(
      this.processPendingScreenshotsAsync(),
      Math.floor(STATE_TIMEOUTS.processing! * 0.35),
      undefined,
      'processPendingScreenshots'
    );

    // Set end time
    this.session.endTime = Date.now();

    // Final persist
    this.persistState();

    // Transition to complete
    if (!this.transition('complete')) {
      this.transitionForced('complete');
    }
    this.session.state = 'complete';

    // Move to recent sessions
    const completedSession = { ...this.session };
    this.addToRecentSessions(completedSession);

    // Clear current session from store
    store.set('currentSession', null);

    console.log(
      `[SessionController] Session completed: ${completedSession.id}, ` +
        `${completedSession.feedbackItems.length} feedback items`
    );

    return completedSession;
  }

  /**
   * Async wrapper for processPendingScreenshots for timeout support.
   */
  private async processPendingScreenshotsAsync(): Promise<void> {
    return new Promise((resolve) => {
      this.processPendingScreenshots();
      resolve();
    });
  }

  /**
   * Cancel the current session without processing
   */
  cancel(): void {
    if (this.state !== 'recording' && this.state !== 'processing' && this.state !== 'starting') {
      console.warn(`[SessionController] Cannot cancel from state: ${this.state}`);
      return;
    }

    console.log(`[SessionController] Cancelling session: ${this.session?.id}`);

    // Force cleanup (don't wait for async)
    this.cleanupServicesForced();
    this.audioCaptureService.clearCapturedAudio();

    // Clear session
    this.session = null;
    store.set('currentSession', null);

    // Force transition to idle (bypass normal validation since we're cancelling)
    this.transitionForced('idle');
  }

  /**
   * Reset controller to idle state
   */
  reset(): void {
    this.cleanupServices();
    this.session = null;
    this.pendingScreenshots = [];
    this.state = 'idle';
    this.emitStateChange();
  }

  // ===========================================================================
  // Status & Data Access
  // ===========================================================================

  /**
   * Get current session status
   */
  getStatus(): SessionStatus {
    const duration = this.session ? Date.now() - this.session.startTime : 0;

    return {
      state: this.state,
      duration,
      feedbackCount: this.session?.feedbackItems.length ?? 0,
      screenshotCount: this.session?.screenshotBuffer.length ?? 0,
    };
  }

  /**
   * Get current session
   */
  getSession(): Session | null {
    return this.session ? { ...this.session } : null;
  }

  /**
   * Update metadata fields on the active session.
   */
  setSessionMetadata(updates: Partial<SessionMetadata>): boolean {
    if (!this.session) {
      return false;
    }

    this.session.metadata = {
      ...this.session.metadata,
      ...updates,
    };

    this.persistState();
    return true;
  }

  /**
   * Export the captured microphone audio for the most recent session.
   */
  async exportCapturedAudioWav(
    outputPath: string,
  ): Promise<{ path: string; bytesWritten: number; durationMs: number } | null> {
    const exported = await this.audioCaptureService.exportCapturedAudioWav(outputPath);
    if (!exported) {
      return null;
    }

    return {
      path: outputPath,
      bytesWritten: exported.bytesWritten,
      durationMs: exported.durationMs,
    };
  }

  clearCapturedAudio(): void {
    this.audioCaptureService.clearCapturedAudio();
  }

  /**
   * Get recent completed sessions (persisted metadata only)
   */
  getRecentSessions(): PersistedSession[] {
    return store.get('recentSessions') || [];
  }

  /**
   * Capture a screenshot on-demand while recording (manual hotkey/button).
   */
  async captureManualScreenshot(): Promise<Screenshot | null> {
    return this.captureAndQueueScreenshot('manual');
  }

  // ===========================================================================
  // Feedback Item Management
  // ===========================================================================

  /**
   * Add a feedback item manually
   */
  addFeedbackItem(item: Partial<FeedbackItem>): FeedbackItem {
    if (!this.session) {
      throw new Error('No active session');
    }

    const feedbackItem: FeedbackItem = {
      id: randomUUID(),
      timestamp: Date.now(),
      text: item.text || '',
      screenshot: item.screenshot,
      confidence: item.confidence ?? 1.0,
    };

    this.session.feedbackItems.push(feedbackItem);
    this.emitFeedbackItem(feedbackItem);
    this.persistSession();

    return feedbackItem;
  }

  /**
   * Delete a feedback item
   */
  deleteFeedbackItem(id: string): boolean {
    if (!this.session) {
      return false;
    }

    const index = this.session.feedbackItems.findIndex((item) => item.id === id);
    if (index === -1) {
      return false;
    }

    this.session.feedbackItems.splice(index, 1);
    this.persistSession();
    this.emitStateChange();

    return true;
  }

  /**
   * Update a feedback item
   */
  updateFeedbackItem(id: string, updates: Partial<FeedbackItem>): FeedbackItem | null {
    if (!this.session) {
      return null;
    }

    const item = this.session.feedbackItems.find((item) => item.id === id);
    if (!item) {
      return null;
    }

    Object.assign(item, updates, { id }); // Preserve ID
    this.persistSession();

    return item;
  }

  // ===========================================================================
  // Service Event Handlers
  // ===========================================================================

  // Audio chunk counter for debug logging
  private audioChunkCount: number = 0;

  /**
   * Handle audio chunk from microphone
   */
  private handleAudioChunk(chunk: AudioChunk): void {
    if (this.state !== 'recording') {
      return;
    }

    // Send audio to TierManager (handles routing to active transcription tier)
    // TierManager expects: samples (Float32Array|Buffer), timestamp, durationMs
    const durationMs = (chunk.buffer.byteLength / 4) / 16000 * 1000; // Assuming 16kHz mono Float32
    tierManager.sendAudio(chunk.buffer, chunk.timestamp, durationMs);

    // Log every 100 chunks (roughly every 10 seconds at 100ms chunks)
    this.audioChunkCount++;
    if (this.audioChunkCount % 100 === 0) {
      console.log(`[SessionController] Audio: ${this.audioChunkCount} chunks sent, ${Math.round(this.audioChunkCount * 0.1)}s of audio`);
    }
  }

  /**
   * Handle voice activity changes (for UI feedback)
   */
  private handleVoiceActivity(active: boolean): void {
    // Emit to renderer for visual feedback
    this.emitToRenderer('session:voiceActivity', { active });
  }

  /**
   * Handle utterance end - KEY event that triggers screenshot capture
   */
  private async handleUtteranceEnd(_timestamp: number): Promise<void> {
    await this.captureAndQueueScreenshot('pause');
  }

  /**
   * Enforce transcription availability during active recording.
   * If failover lands on a non-transcribing tier, keep recording and recover transcript post-session.
   */
  private async handleTranscriptionTierChange(
    fromTier: TranscriptionTier,
    toTier: TranscriptionTier,
    reason: string
  ): Promise<void> {
    if (tierManager.tierProvidesTranscription(toTier)) {
      console.log(`[SessionController] Transcription failover: ${fromTier} -> ${toTier}`);
      return;
    }

    if (this.state !== 'recording' || !this.session) {
      return;
    }

    const message =
      `Live transcription became unavailable (${fromTier} -> ${toTier}). ${reason}. ` +
      'Session recording will continue. A post-session transcription recovery pass will retry from captured audio.';

    console.warn(`[SessionController] ${message}`);
  }

  /**
   * Run a post-session transcription recovery pass when live transcription produced no final output.
   * Uses local Whisper and retries automatically for transient failures.
   */
  private async recoverTranscriptFromCapturedAudio(): Promise<void> {
    if (!this.session) {
      return;
    }

    const hasFinalTranscript = this.session.transcriptBuffer.some(
      (entry) => entry.isFinal && entry.text.trim().length > 0,
    );
    const hasUnmatchedScreenshots = this.pendingScreenshots.length > 0;
    if (hasFinalTranscript && !hasUnmatchedScreenshots) {
      return;
    }

    // Use captured in-memory audio (float32 PCM) to reconstruct missing transcript.
    const mergedAudio = this.audioCaptureService.getCapturedAudioBuffer();
    if (!mergedAudio || mergedAudio.byteLength === 0) {
      console.warn('[SessionController] Post-session transcription recovery skipped: no captured audio buffers.');
      return;
    }

    const audioSamples = new Float32Array(
      mergedAudio.buffer,
      mergedAudio.byteOffset,
      mergedAudio.byteLength / 4,
    );
    if (audioSamples.length === 0) {
      return;
    }

    const sessionStartSec = this.session.startTime / 1000;

    if (whisperService.isModelAvailable()) {
      const whisperRecovered = await this.recoverTranscriptWithWhisper(
        audioSamples,
        sessionStartSec,
        3
      );
      if (whisperRecovered.length > 0) {
        this.appendRecoveredTranscriptEvents(whisperRecovered);
        return;
      }
    } else {
      console.warn(
        '[SessionController] Post-session Whisper recovery skipped: no local model available.',
      );
    }

    const deepgramApiKey = await this.getDeepgramApiKey();
    if (deepgramApiKey) {
      const deepgramRecovered = await this.recoverTranscriptWithDeepgram(
        audioSamples,
        sessionStartSec,
        deepgramApiKey,
        2
      );
      if (deepgramRecovered.length > 0) {
        this.appendRecoveredTranscriptEvents(deepgramRecovered);
        return;
      }
    } else {
      console.warn(
        '[SessionController] Post-session Deepgram recovery skipped: API key not configured.',
      );
    }

    console.warn(
      '[SessionController] Post-session transcription recovery exhausted all providers without transcript output.',
    );
  }

  private appendRecoveredTranscriptEvents(events: TranscriptEvent[]): void {
    if (!this.session || events.length === 0) {
      return;
    }

    this.session.transcriptBuffer.push(...events);
    this.session.transcriptBuffer.sort((a, b) => a.timestamp - b.timestamp);
    if (this.session.transcriptBuffer.length > this.MAX_TRANSCRIPT_BUFFER_EVENTS) {
      this.session.transcriptBuffer.splice(
        0,
        this.session.transcriptBuffer.length - this.MAX_TRANSCRIPT_BUFFER_EVENTS,
      );
    }

    for (const event of events) {
      this.tryMatchTranscriptToScreenshot(event);
    }
  }

  private async recoverTranscriptWithWhisper(
    audioSamples: Float32Array,
    sessionStartSec: number,
    maxAttempts: number,
  ): Promise<TranscriptEvent[]> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const recoveredSegments = await whisperService.transcribeSamples(
          audioSamples,
          sessionStartSec,
        );

        const recoveredEvents: TranscriptEvent[] = recoveredSegments
          .map((segment) => ({
            text: segment.text,
            isFinal: true,
            confidence: segment.confidence,
            timestamp: this.normalizeTranscriptTimestamp(segment.startTime),
            tier: 'whisper' as const,
          }))
          .filter((segment) => segment.text.trim().length > 0);

        if (recoveredEvents.length === 0) {
          throw new Error('No transcript text recovered from captured audio');
        }

        console.log(
          `[SessionController] Recovered ${recoveredEvents.length} transcript segments via Whisper (attempt ${attempt}/${maxAttempts}).`,
        );
        return recoveredEvents;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[SessionController] Whisper recovery attempt ${attempt}/${maxAttempts} failed: ${message}`,
        );

        if (attempt < maxAttempts) {
          const delayMs = 400 * attempt;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    return [];
  }

  private async recoverTranscriptWithDeepgram(
    audioSamples: Float32Array,
    sessionStartSec: number,
    apiKey: string,
    maxAttempts: number,
  ): Promise<TranscriptEvent[]> {
    const wavBuffer = this.encodeFloat32Pcm16Wav(audioSamples, 16000, 1);
    const audioDurationSec = audioSamples.length / 16000;
    const timeoutMs = Math.min(10 * 60_000, Math.max(60_000, Math.round(audioDurationSec * 2000)));

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const segments = await transcriptionService.transcribePrerecordedAudio(wavBuffer, {
          apiKey,
          timeoutMs,
        });

        const recoveredEvents: TranscriptEvent[] = segments
          .map((segment) => ({
            text: segment.text,
            isFinal: true,
            confidence: segment.confidence,
            timestamp: this.normalizeTranscriptTimestamp(sessionStartSec + segment.startTime),
            tier: 'deepgram' as const,
          }))
          .filter((segment) => segment.text.trim().length > 0);

        if (recoveredEvents.length === 0) {
          throw new Error('No transcript text recovered from prerecorded transcription');
        }

        console.log(
          `[SessionController] Recovered ${recoveredEvents.length} transcript segments via Deepgram prerecorded (attempt ${attempt}/${maxAttempts}).`,
        );
        return recoveredEvents;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[SessionController] Deepgram recovery attempt ${attempt}/${maxAttempts} failed: ${message}`,
        );

        if (attempt < maxAttempts) {
          const delayMs = 500 * attempt;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    return [];
  }

  private async getDeepgramApiKey(): Promise<string | null> {
    try {
      const settings = getSettingsManager();
      const apiKey = await settings.getApiKey('deepgram');
      const normalized = apiKey?.trim();
      return normalized && normalized.length > 0 ? normalized : null;
    } catch (error) {
      console.warn('[SessionController] Failed to read Deepgram API key for recovery:', error);
      return null;
    }
  }

  private encodeFloat32Pcm16Wav(samples: Float32Array, sampleRate: number, channels: number): Buffer {
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples.length * bytesPerSample;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0, 'ascii');
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8, 'ascii');
    buffer.write('fmt ', 12, 'ascii');
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36, 'ascii');
    buffer.writeUInt32LE(dataSize, 40);

    for (let i = 0; i < samples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      const int16 = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
      buffer.writeInt16LE(int16, 44 + i * 2);
    }

    return buffer;
  }

  /**
   * Handle transcript result from TierManager (any tier: Deepgram, Whisper, etc.)
   */
  private handleTranscriptResult(event: TranscriptEvent): void {
    if (!this.session) {
      return;
    }

    const normalizedTimestamp = this.normalizeTranscriptTimestamp(event.timestamp);
    const normalizedEvent: TranscriptEvent = {
      ...event,
      timestamp: normalizedTimestamp,
    };

    const finalEvent = normalizedEvent.isFinal
      ? this.prepareFinalTranscript(normalizedEvent)
      : normalizedEvent;
    if (!finalEvent) {
      return;
    }

    // Add to buffer
    this.session.transcriptBuffer.push(finalEvent);
    if (this.session.transcriptBuffer.length > this.MAX_TRANSCRIPT_BUFFER_EVENTS) {
      this.session.transcriptBuffer.splice(
        0,
        this.session.transcriptBuffer.length - this.MAX_TRANSCRIPT_BUFFER_EVENTS
      );
    }

    // Emit to renderer
    if (finalEvent.isFinal) {
      console.log(`[SessionController] Final transcript (${finalEvent.tier}): "${finalEvent.text}"`);
      this.emitToRenderer(IPC_CHANNELS.TRANSCRIPTION_FINAL, {
        text: finalEvent.text,
        confidence: finalEvent.confidence,
        timestamp: finalEvent.timestamp,
        tier: finalEvent.tier,
      });

      // Try to match with pending screenshots
      this.tryMatchTranscriptToScreenshot(finalEvent);
    } else {
      this.emitToRenderer(IPC_CHANNELS.TRANSCRIPTION_UPDATE, {
        text: finalEvent.text,
        confidence: finalEvent.confidence,
        timestamp: finalEvent.timestamp,
        isFinal: false,
        tier: finalEvent.tier,
      });
    }
  }

  /**
   * Normalizes transcript timestamps to epoch seconds for consistent matching.
   * Deepgram may emit relative offsets while Whisper emits absolute timestamps.
   */
  private normalizeTranscriptTimestamp(timestamp: number): number {
    if (!this.session) {
      return timestamp;
    }

    const sessionStartSec = this.session.startTime / 1000;

    // Relative offsets from stream start are typically small (< 1 day in seconds).
    if (timestamp < 86_400) {
      return sessionStartSec + Math.max(0, timestamp);
    }

    // Defensive fallback for timestamps that are still clearly before session start.
    if (timestamp < sessionStartSec - 60) {
      return sessionStartSec + Math.max(0, timestamp);
    }

    return timestamp;
  }

  /**
   * Handles voice screenshot commands and strips command phrases from transcript text.
   * Returns null if the transcript should be dropped from feedback output.
   */
  private prepareFinalTranscript(event: TranscriptEvent): TranscriptEvent | null {
    const raw = event.text.trim();
    if (!raw) {
      return null;
    }

    if (!this.isVoiceScreenshotCommand(raw)) {
      return event;
    }

    const cleanedText = this.stripVoiceCommand(raw);
    void this.captureAndQueueScreenshot('voice-command');

    if (!cleanedText) {
      console.log('[SessionController] Voice screenshot command detected');
      return null;
    }

    return {
      ...event,
      text: cleanedText,
    };
  }

  private isVoiceScreenshotCommand(text: string): boolean {
    return this.VOICE_SCREENSHOT_COMMANDS.some((pattern) => pattern.test(text));
  }

  private stripVoiceCommand(text: string): string {
    let cleaned = text;

    cleaned = cleaned.replace(/\b(?:take|grab|capture)\s+(?:a\s+)?screenshot(?:\s+now)?\b/gi, ' ');
    cleaned = cleaned.replace(/\bscreenshot(?:\s+(?:this|that|now|here))?\b/gi, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // Trim punctuation left behind after removing command words.
    cleaned = cleaned.replace(/^[,.;:!?-]+\s*/, '').replace(/\s*[,.;:!?-]+$/, '');

    return cleaned.trim();
  }

  private async captureAndQueueScreenshot(trigger: ScreenshotTrigger): Promise<Screenshot | null> {
    if (this.state !== 'recording' || !this.session) {
      return null;
    }

    if (this.screenshotCaptureInFlight) {
      return null;
    }

    const now = Date.now();
    if (now - this.lastScreenshotCapturedAt < this.SCREENSHOT_DEBOUNCE_MS) {
      return null;
    }

    this.screenshotCaptureInFlight = true;

    try {
      const captureResult = await this.screenCaptureService.capture(this.session.sourceId);

      if (!this.session || this.state !== 'recording') {
        return null;
      }

      const screenshot: Screenshot = {
        id: captureResult.id,
        timestamp: Date.now(),
        buffer: captureResult.buffer,
        width: captureResult.width,
        height: captureResult.height,
        trigger,
      };

      this.lastScreenshotCapturedAt = screenshot.timestamp;
      this.session.screenshotBuffer.push(screenshot);
      this.pendingScreenshots.push(screenshot);

      // Match immediately if relevant transcript context is already buffered.
      this.tryMatchScreenshotToTranscript(screenshot);

      this.emitToRenderer(IPC_CHANNELS.SCREENSHOT_CAPTURED, {
        id: screenshot.id,
        timestamp: screenshot.timestamp,
        count: this.session.screenshotBuffer.length,
        width: screenshot.width,
        height: screenshot.height,
        trigger,
      });

      this.persistSession();
      this.persistState();

      return screenshot;
    } catch (error) {
      this.handleServiceError('capture', error as Error);
      return null;
    } finally {
      this.screenshotCaptureInFlight = false;
    }
  }

  /**
   * Handle service errors with categorized error handling
   */
  private handleServiceError(service: string, error: Error): void {
    const context = {
      component: 'SessionController',
      operation: `${service}Error`,
      data: { service, sessionId: this.session?.id },
    };

    // Log the error
    errorHandler.log('error', `${service} error`, {
      ...context,
      error: error.message,
    });

    // Handle based on service type
    switch (service) {
      case 'audio':
        errorHandler.handleAudioError(error, context);
        break;
      case 'transcription':
        errorHandler.handleTranscriptionError(error, context);
        break;
      case 'capture':
        errorHandler.handleCaptureError(error, context);
        break;
      default:
        // Generic error handling
        errorHandler.log('error', `Unknown service error: ${service}`, context);
    }

    // Notify event callbacks
    this.events?.onError(error);

    // Emit to renderer for UI feedback
    this.emitToRenderer(IPC_CHANNELS.SESSION_ERROR, {
      service,
      message: error.message,
      category: errorHandler.categorizeError(error),
    });
  }

  // ===========================================================================
  // Timestamp Matching Algorithm
  // ===========================================================================

  /**
   * Try to match a screenshot to recent transcripts
   */
  private tryMatchScreenshotToTranscript(screenshot: Screenshot): void {
    if (!this.session) {
      return;
    }

    // Screenshot timestamp is in ms, transcript timestamps are in seconds
    const screenshotTimeSec = screenshot.timestamp / 1000;

    const recentTranscripts = this.session.transcriptBuffer.filter(
      (t) =>
        t.isFinal &&
        screenshotTimeSec >= t.timestamp &&
        screenshotTimeSec - t.timestamp < this.TRANSCRIPT_MATCH_WINDOW_MS / 1000
    );

    if (recentTranscripts.length > 0) {
      // Combine recent transcripts as feedback text
      const combinedText = recentTranscripts
        .map((t) => t.text)
        .join(' ')
        .trim();

      // Calculate average confidence
      const avgConfidence =
        recentTranscripts.reduce((sum, t) => sum + t.confidence, 0) /
        recentTranscripts.length;

      // Create feedback item
      const feedbackItem: FeedbackItem = {
        id: randomUUID(),
        timestamp: screenshot.timestamp,
        text: combinedText,
        screenshot,
        confidence: avgConfidence,
      };

      this.session.feedbackItems.push(feedbackItem);
      this.emitFeedbackItem(feedbackItem);
      this.persistSession();
      this.persistState();

      // Remove from pending
      const pendingIndex = this.pendingScreenshots.findIndex(
        (s) => s.id === screenshot.id
      );
      if (pendingIndex !== -1) {
        this.pendingScreenshots.splice(pendingIndex, 1);
      }

      console.log(
        `[SessionController] Matched screenshot to transcript: "${combinedText.substring(0, 50)}..."`
      );
    }
  }

  /**
   * Try to match a transcript to pending screenshots
   */
  private tryMatchTranscriptToScreenshot(event: TranscriptEvent): void {
    if (!this.session || this.pendingScreenshots.length === 0 || !event.isFinal) {
      return;
    }

    // Find screenshots within the match window
    const resultTimeMs = event.timestamp * 1000;
    const matchingScreenshots = this.pendingScreenshots.filter(
      (s) =>
        s.timestamp - resultTimeMs < this.TRANSCRIPT_MATCH_WINDOW_MS &&
        s.timestamp >= resultTimeMs
    );

    for (const screenshot of matchingScreenshots) {
      // Get all transcripts within window of this screenshot
      const screenshotTimeSec = screenshot.timestamp / 1000;
      const windowTranscripts = this.session.transcriptBuffer.filter(
        (t) =>
          t.isFinal &&
          screenshotTimeSec - t.timestamp < this.TRANSCRIPT_MATCH_WINDOW_MS / 1000 &&
          screenshotTimeSec >= t.timestamp
      );

      const combinedText = windowTranscripts
        .map((t) => t.text)
        .join(' ')
        .trim();

      if (combinedText) {
        const avgConfidence =
          windowTranscripts.reduce((sum, t) => sum + t.confidence, 0) /
          windowTranscripts.length;

        const feedbackItem: FeedbackItem = {
          id: randomUUID(),
          timestamp: screenshot.timestamp,
          text: combinedText,
          screenshot,
          confidence: avgConfidence,
        };

        this.session.feedbackItems.push(feedbackItem);
        this.emitFeedbackItem(feedbackItem);
        this.persistSession();
        this.persistState();

        // Remove from pending
        const pendingIndex = this.pendingScreenshots.findIndex(
          (s) => s.id === screenshot.id
        );
        if (pendingIndex !== -1) {
          this.pendingScreenshots.splice(pendingIndex, 1);
        }
      }
    }
  }

  /**
   * Process any remaining pending screenshots at session end
   */
  private processPendingScreenshots(): void {
    if (!this.session) {
      return;
    }

    for (const screenshot of this.pendingScreenshots) {
      // Find any transcripts near this screenshot
      const screenshotTimeSec = screenshot.timestamp / 1000;
      const nearbyTranscripts = this.session.transcriptBuffer.filter(
        (t) =>
          t.isFinal &&
          Math.abs(screenshotTimeSec - t.timestamp) <
            (this.TRANSCRIPT_MATCH_WINDOW_MS * 2) / 1000
      );

      const combinedText = nearbyTranscripts
        .map((t) => t.text)
        .join(' ')
        .trim();

      const feedbackItem: FeedbackItem = {
        id: randomUUID(),
        timestamp: screenshot.timestamp,
        text: combinedText || '[No matching narration]',
        screenshot,
        confidence:
          nearbyTranscripts.length > 0
            ? nearbyTranscripts.reduce((sum, t) => sum + t.confidence, 0) /
              nearbyTranscripts.length
            : 0,
      };

      this.session.feedbackItems.push(feedbackItem);
    }

    this.pendingScreenshots = [];
    this.persistSession();
    this.persistState();
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    this.stopAutoSave();

    this.autoSaveTimer = setInterval(() => {
      if (this.session) {
        this.persistSession();
        console.log('[SessionController] Auto-saved session');
      }
    }, this.AUTO_SAVE_INTERVAL_MS);
  }

  /**
   * Stop auto-save timer
   */
  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * Persist current session metadata to disk
   * Note: We don't persist full session with buffers, just metadata
   */
  private persistSession(): void {
    if (this.session) {
      const persisted: PersistedSession = {
        id: this.session.id,
        startTime: this.session.startTime,
        endTime: this.session.endTime,
        state: this.session.state,
        sourceId: this.session.sourceId,
        feedbackItemCount: this.session.feedbackItems.length,
        metadata: this.session.metadata,
      };
      store.set('currentSession', persisted);
    }
  }

  // ===========================================================================
  // State Persistence - Crash Recovery Data (Every 5 Seconds)
  // ===========================================================================

  /**
   * Start state persistence timer.
   * Saves current state every 5 seconds (per spec - max 5 seconds data loss).
   */
  private startStatePersistence(): void {
    this.stopStatePersistence();

    // Save immediately on start
    this.persistState();

    // Then every 5 seconds
    this.statePersistenceTimer = setInterval(() => {
      this.persistState();
    }, this.AUTO_SAVE_INTERVAL_MS);

    console.log(`[SessionController] State persistence started (every ${this.AUTO_SAVE_INTERVAL_MS}ms)`);
  }

  /**
   * Stop state persistence timer.
   */
  private stopStatePersistence(): void {
    if (this.statePersistenceTimer) {
      clearInterval(this.statePersistenceTimer);
      this.statePersistenceTimer = null;
    }
  }

  /**
   * Persist current state to disk.
   * Called every 5 seconds and on state transitions.
   */
  private persistState(): void {
    const persistedState: PersistedState = {
      version: 1,
      state: this.state,
      stateEnteredAt: this.stateEnteredAt,
      session: this.session ? {
        id: this.session.id,
        startTime: this.session.startTime,
        endTime: this.session.endTime,
        state: this.session.state,
        sourceId: this.session.sourceId,
        feedbackItemCount: this.session.feedbackItems.length,
        metadata: this.session.metadata,
      } : null,
      lastPersistedAt: Date.now(),
      feedbackItemIds: this.session?.feedbackItems.map(f => f.id) || [],
    };

    store.set('persistedState', persistedState);

    // Also persist feedback items separately (for recovery)
    if (this.session && this.session.feedbackItems.length > 0) {
      // Store without buffers for space efficiency
      const persistedFeedback = this.session.feedbackItems.map(item => ({
        id: item.id,
        timestamp: item.timestamp,
        text: item.text,
        confidence: item.confidence,
        hasScreenshot: !!item.screenshot,
        // Don't persist screenshot buffer - too large
      }));
      store.set('persistedFeedbackItems', persistedFeedback);
    }
  }

  /**
   * Mark clean exit - called on graceful shutdown.
   */
  markCleanExit(): void {
    store.set('lastCleanExit', true);
    store.set('lastExitTimestamp', Date.now());
    console.log('[SessionController] Marked clean exit');
  }

  // ===========================================================================
  // Watchdog Timer - Monitors state age and forces recovery
  // ===========================================================================

  /**
   * Start the watchdog timer.
   * Monitors state age and triggers recovery if a state exceeds its timeout.
   * Also handles recording duration warnings and limits.
   */
  private startWatchdog(): void {
    this.stopWatchdog();
    this.stateEnteredAt = Date.now();
    this.recordingWarningShown = false;

    this.watchdogTimer = setInterval(() => {
      this.watchdogCheck();
    }, this.WATCHDOG_CHECK_INTERVAL_MS);

    console.log('[SessionController] Watchdog started');
  }

  /**
   * Stop the watchdog timer.
   */
  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /**
   * Watchdog check - runs every second.
   * Monitors state timeouts and recording duration.
   */
  private watchdogCheck(): void {
    const elapsed = Date.now() - this.stateEnteredAt;
    const timeout = STATE_TIMEOUTS[this.state];

    // Check state timeout
    if (timeout !== null && elapsed > timeout) {
      console.error(
        `[SessionController] WATCHDOG: State '${this.state}' exceeded ${timeout}ms timeout (elapsed: ${elapsed}ms). Forcing recovery.`
      );
      this.forceRecovery();
      return;
    }

    // Check recording-specific limits
    if (this.state === 'recording') {
      this.checkRecordingDuration(elapsed);
    }
  }

  /**
   * Check recording duration and emit warnings/force stop.
   */
  private checkRecordingDuration(elapsed: number): void {
    // Warning at 25 minutes
    if (!this.recordingWarningShown && elapsed >= RECORDING_LIMITS.WARNING_DURATION_MS) {
      this.recordingWarningShown = true;
      const remainingMinutes = Math.ceil(
        (RECORDING_LIMITS.MAX_DURATION_MS - elapsed) / 60_000
      );

      console.log(`[SessionController] Recording warning: ${remainingMinutes} minutes remaining`);

      this.emitToRenderer('session:warning', {
        type: 'duration',
        message: `Recording will auto-stop in ${remainingMinutes} minutes`,
        remainingMs: RECORDING_LIMITS.MAX_DURATION_MS - elapsed,
      });
    }

    // Force stop at 30 minutes
    if (elapsed >= RECORDING_LIMITS.MAX_DURATION_MS) {
      console.log('[SessionController] Recording max duration reached, auto-stopping');
      this.emitToRenderer('session:warning', {
        type: 'maxDuration',
        message: 'Maximum recording duration reached. Stopping automatically.',
      });
      this.stop(); // Will be wrapped with its own timeouts
    }
  }

  /**
   * Force recovery from a stuck state.
   * Called by watchdog when a state exceeds its timeout.
   */
  private forceRecovery(): void {
    console.log(`[SessionController] Force recovery from state: ${this.state}`);

    switch (this.state) {
      case 'starting':
        // Starting timed out - abort to idle
        this.handleTimeoutError('Service initialization timed out');
        this.cleanupServicesForced();
        this.transitionForced('idle');
        break;

      case 'recording':
        // Recording hit 30 minute limit - force stop
        this.stop().catch((error) => {
          console.error('[SessionController] Force stop failed:', error);
          this.handleTimeoutError('Recording auto-stop failed');
          this.cleanupServicesForced();
          this.transitionForced('error');
        });
        break;

      case 'stopping':
        // Stopping timed out - force to processing anyway
        console.warn('[SessionController] Stopping timeout, forcing to processing');
        this.cleanupServicesForced();
        this.transitionForced('processing');
        // Reset state entry time for processing timeout
        this.stateEnteredAt = Date.now();
        break;

      case 'processing':
        // Processing timed out - complete with partial data
        console.warn('[SessionController] Processing timeout, completing with partial data');
        if (this.session) {
          this.session.endTime = this.session.endTime || Date.now();
          this.session.state = 'complete';
          this.addToRecentSessions(this.session);
          store.set('currentSession', null);
        }
        this.transitionForced('complete');
        this.stateEnteredAt = Date.now();
        break;

      case 'complete':
        // Complete state timeout - reset to idle
        console.log('[SessionController] Complete timeout, resetting to idle');
        this.session = null;
        this.transitionForced('idle');
        break;

      case 'error':
        // Error state timeout - reset to idle
        console.log('[SessionController] Error timeout, resetting to idle');
        this.session = null;
        this.transitionForced('idle');
        break;

      case 'idle':
        // Should never happen (idle has no timeout)
        console.warn('[SessionController] Unexpected watchdog trigger in idle state');
        break;
    }
  }

  /**
   * Force a state transition without validation.
   * ONLY used by watchdog recovery - bypasses normal transition checks.
   */
  private transitionForced(newState: SessionState): void {
    const oldState = this.state;
    this.state = newState;
    this.stateEnteredAt = Date.now();

    if (this.session) {
      this.session.state = newState;
    }

    console.log(`[SessionController] Forced transition: ${oldState} -> ${newState}`);
    this.emitStateChange();
  }

  /**
   * Handle timeout errors - emit to renderer and log.
   */
  private handleTimeoutError(message: string): void {
    const error = new Error(message);

    console.error(`[SessionController] Timeout error: ${message}`);

    this.emitToRenderer(IPC_CHANNELS.SESSION_ERROR, {
      type: 'timeout',
      message,
      state: this.state,
      timestamp: Date.now(),
    });

    this.events?.onError(error);
  }

  /**
   * Force cleanup without waiting for services.
   * Used by watchdog when cleanup itself times out.
   */
  private cleanupServicesForced(): void {
    console.log('[SessionController] FORCED service cleanup');

    // Stop timers
    this.stopAutoSave();
    this.stopDurationTimer();
    this.stopStatePersistence();

    // Unsubscribe without waiting
    for (const cleanup of this.cleanupFunctions) {
      try {
        cleanup();
      } catch {
        // Ignore errors in forced cleanup
      }
    }
    this.cleanupFunctions = [];

    // Try to stop services but don't wait
    try {
      this.audioCaptureService.stop();
    } catch {
      // Ignore
    }
    try {
      // TierManager.stop() is async but we don't wait in forced cleanup
      tierManager.stop().catch(() => {
        // Ignore errors in forced cleanup
      });
    } catch {
      // Ignore
    }
  }

  /**
   * Add session to recent sessions list (full session)
   */
  private addToRecentSessions(session: Session): void {
    const persisted: PersistedSession = {
      id: session.id,
      startTime: session.startTime,
      endTime: session.endTime,
      state: session.state,
      sourceId: session.sourceId,
      feedbackItemCount: session.feedbackItems.length,
      metadata: session.metadata,
    };
    this.addToRecentSessionsPersisted(persisted);
  }

  /**
   * Add persisted session to recent sessions list
   */
  private addToRecentSessionsPersisted(session: PersistedSession): void {
    const recent = store.get('recentSessions') || [];

    // Add to front
    recent.unshift(session);

    // Limit size
    if (recent.length > this.MAX_RECENT_SESSIONS) {
      recent.splice(this.MAX_RECENT_SESSIONS);
    }

    store.set('recentSessions', recent);
  }

  // ===========================================================================
  // Duration Timer
  // ===========================================================================

  /**
   * Start duration timer (updates UI)
   */
  private startDurationTimer(): void {
    this.stopDurationTimer();

    this.durationTimer = setInterval(() => {
      this.emitToRenderer(IPC_CHANNELS.SESSION_STATUS, this.getStatus());
    }, 1000);
  }

  /**
   * Stop duration timer
   */
  private stopDurationTimer(): void {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
  }

  // ===========================================================================
  // Event Emission
  // ===========================================================================

  /**
   * Emit state change to listeners
   */
  private emitStateChange(): void {
    this.events?.onStateChange(this.state, this.session);
    this.emitToRenderer(IPC_CHANNELS.SESSION_STATUS, this.getStatus());
  }

  /**
   * Emit feedback item to listeners
   */
  private emitFeedbackItem(item: FeedbackItem): void {
    this.events?.onFeedbackItem(item);
    // Emit to renderer without buffer (just metadata)
    this.emitToRenderer('session:feedbackItem', {
      id: item.id,
      timestamp: item.timestamp,
      text: item.text,
      confidence: item.confidence,
      hasScreenshot: !!item.screenshot,
    });
  }

  /**
   * Send event to renderer via IPC
   */
  private emitToRenderer(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Clean up all services and timers (synchronous version for backwards compatibility)
   */
  private cleanupServices(): void {
    // Stop timers
    this.stopAutoSave();
    this.stopDurationTimer();
    // Note: Don't stop state persistence here - we want it running during stopping/processing

    // Unsubscribe from all events
    for (const cleanup of this.cleanupFunctions) {
      try {
        cleanup();
      } catch (error) {
        console.warn('[SessionController] Cleanup callback error:', error);
      }
    }
    this.cleanupFunctions = [];

    // Stop services
    this.audioCaptureService.stop();
    // TierManager.stop() is async, but we call it and don't wait
    tierManager.stop().catch((error) => {
      console.warn('[SessionController] TierManager stop error:', error);
    });
  }

  /**
   * Clean up all services and timers with timeout protection.
   * Never blocks for more than 2 seconds per service.
   */
  private async cleanupServicesAsync(): Promise<void> {
    console.log('[SessionController] Cleaning up services...');

    // Stop timers first (fast, non-blocking)
    this.stopAutoSave();
    this.stopDurationTimer();

    // Unsubscribe from all events (fast, non-blocking)
    for (const cleanup of this.cleanupFunctions) {
      try {
        cleanup();
      } catch (error) {
        console.warn('[SessionController] Cleanup callback error:', error);
      }
    }
    this.cleanupFunctions = [];

    // Stop services with timeout protection (may block)
    const serviceTimeout = 2000; // 2 seconds per service

    const [audioResult, transcriptionResult] = await Promise.allSettled([
      this.withTimeoutSync(
        () => this.audioCaptureService.stop(),
        serviceTimeout,
        'AudioCapture.stop()'
      ),
      this.withTimeout(
        tierManager.stop(),
        serviceTimeout,
        undefined,
        'TierManager.stop()'
      ),
    ]);

    // Log any failures
    if (audioResult.status === 'rejected') {
      console.warn('[SessionController] Audio cleanup failed:', audioResult.reason);
    }
    if (transcriptionResult.status === 'rejected') {
      console.warn('[SessionController] TierManager cleanup failed:', transcriptionResult.reason);
    }

    console.log('[SessionController] Service cleanup complete');
  }

  /**
   * Full cleanup for app shutdown.
   * Mark clean exit for crash recovery.
   */
  destroy(): void {
    console.log('[SessionController] Destroying...');

    // Save any active session
    if (this.session && (this.state === 'recording' || this.state === 'starting')) {
      this.session.state = 'complete';
      this.session.endTime = Date.now();
      this.addToRecentSessions(this.session);
    }

    // Stop all timers
    this.stopWatchdog();
    this.stopStatePersistence();
    this.cleanupServicesForced();

    // Clear state
    this.session = null;
    this.events = null;
    this.mainWindow = null;

    // Mark clean exit
    this.markCleanExit();

    console.log('[SessionController] Destroy complete');
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const sessionController = new SessionController();
export default SessionController;
