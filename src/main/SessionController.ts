/**
 * SessionController - Core Orchestrator for markupr
 *
 * Implements a bulletproof finite state machine for session lifecycle:
 *   idle -> starting -> recording -> stopping -> processing -> complete
 *
 * Responsibilities:
 * - Coordinate all services (audio, video recording)
 * - Manage session state with crash recovery (auto-save every 5 seconds)
 * - Watchdog timer to prevent stuck states
 * - Run PostProcessor pipeline after recording stops
 * - Emit state changes and processing progress to renderer via IPC
 */

import Store from 'electron-store';
import { BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { audioCapture, type AudioChunk, type CapturedAudioAsset } from './audio/AudioCapture';
import { whisperService } from './transcription';
import type { TranscriptEvent } from './transcription/types';
import { getSettingsManager } from './settings';
import { IPC_CHANNELS } from '../shared/types';
import { errorHandler } from './ErrorHandler';
import { type PostProcessResult, type PostProcessProgress } from './pipeline';
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
  processing: 5 * 60_000,  // 5 minutes for post-processing pipeline
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

/**
 * @deprecated Screenshot capture during recording has been removed.
 * Frame extraction now happens in the post-processing pipeline.
 * This interface is kept for backward compatibility with downstream consumers.
 */
export interface Screenshot {
  id: string;
  timestamp: number;
  buffer: Buffer;
  width: number;
  height: number;
  base64?: string;
  trigger?: string;
}

export interface FeedbackItem {
  id: string;
  timestamp: number;
  text: string;
  confidence: number;
  /**
   * @deprecated Screenshots are no longer captured during recording.
   * Extracted frames are available via PostProcessResult after processing.
   */
  screenshot?: Screenshot;
}

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
  /**
   * @deprecated Screenshots are no longer captured during recording.
   * Kept for backward compatibility; always an empty array.
   */
  screenshotBuffer: Screenshot[];
  metadata: SessionMetadata;
}

export interface SessionStatus {
  state: SessionState;
  duration: number;
  feedbackCount: number;
  isPaused: boolean;
  /** Post-processing progress (only set when state === 'processing') */
  processingProgress?: PostProcessProgress;
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
  name: 'markupr-sessions',
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
  private isPaused = false;
  private session: Session | null = null;
  private events: SessionControllerEvents | null = null;
  private mainWindow: BrowserWindow | null = null;

  // Service references (using actual implementations)
  private audioCaptureService: typeof audioCapture;

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

  // Post-processing result (available after processing completes)
  private postProcessResult: PostProcessResult | null = null;

  // Current processing progress (for status reporting)
  private currentProcessingProgress: PostProcessProgress | null = null;

  // Configuration constants
  private readonly AUTO_SAVE_INTERVAL_MS = 5000;       // 5 seconds (per spec)
  private readonly WATCHDOG_CHECK_INTERVAL_MS = 1000;  // 1 second
  private readonly MAX_RECENT_SESSIONS = 10;
  private readonly MAX_TRANSCRIPT_BUFFER_EVENTS = 2000;
  private readonly WHISPER_RECOVERY_CHUNK_SECONDS = 30;
  private readonly OPENAI_RECOVERY_CHUNK_SECONDS = 180;
  private readonly MAX_POST_SESSION_LOCAL_RECOVERY_DURATION_SEC = 8 * 60;

  constructor() {
    // Use singleton instances
    this.audioCaptureService = audioCapture;
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
    this.isPaused = false;
    this.postProcessResult = null;
    this.currentProcessingProgress = null;

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

    console.log(
      '[SessionController] Live transcription disabled for this workflow; using post-session transcription from captured audio.'
    );

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
   * Stop the current session and run the post-processing pipeline.
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

    // NOTE: The full PostProcessor pipeline (transcribe -> analyze -> extract frames)
    // is NOT run here because recordingPath and audioPath are not yet available on
    // session.metadata at this point. Those paths are set later in stopSession()
    // (src/main/index.ts) after the recording and audio files are finalized and
    // written to disk. The real PostProcessor call happens there with the actual
    // file paths. Here we only attempt transcript recovery from the in-memory
    // captured audio buffer as a fallback for when stop() is called directly
    // (e.g., by the watchdog timer) without going through stopSession().
    await this.withTimeout(
      this.recoverTranscriptFromCapturedAudio(),
      Math.floor(STATE_TIMEOUTS.processing! * 0.8),
      undefined,
      'recoverTranscriptFromCapturedAudio'
    );

    // Set end time
    this.session.endTime = Date.now();
    this.isPaused = false;
    this.currentProcessingProgress = null;

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
    this.isPaused = false;
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
    this.postProcessResult = null;
    this.currentProcessingProgress = null;
    this.isPaused = false;
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

    const status: SessionStatus = {
      state: this.state,
      duration,
      feedbackCount: this.session?.feedbackItems.length ?? 0,
      isPaused: this.state === 'recording' && this.isPaused,
    };

    if (this.state === 'processing' && this.currentProcessingProgress) {
      status.processingProgress = this.currentProcessingProgress;
    }

    return status;
  }

  isSessionPaused(): boolean {
    return this.state === 'recording' && this.isPaused;
  }

  pause(): boolean {
    if (this.state !== 'recording' || this.isPaused) {
      return false;
    }

    this.isPaused = true;
    this.audioCaptureService.setPaused(true);
    this.emitToRenderer(IPC_CHANNELS.SESSION_VOICE_ACTIVITY, { active: false });
    this.emitStatus();
    return true;
  }

  resume(): boolean {
    if (this.state !== 'recording' || !this.isPaused) {
      return false;
    }

    this.isPaused = false;
    this.audioCaptureService.setPaused(false);
    this.emitStatus();
    return true;
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
  async exportCapturedAudio(
    outputPathBase: string,
  ): Promise<{ path: string; bytesWritten: number; durationMs: number; mimeType: string } | null> {
    const exported = await this.audioCaptureService.exportCapturedAudio(outputPathBase);
    if (!exported) {
      return null;
    }

    return exported;
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
   * Get the post-processing result from the most recent session.
   * Available after the processing state completes.
   */
  getPostProcessResult(): PostProcessResult | null {
    return this.postProcessResult;
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
  private handleAudioChunk(_chunk: AudioChunk): void {
    if (this.state !== 'recording') {
      return;
    }

    if (this.isPaused) {
      return;
    }

    // Log every 100 chunks (roughly every 10 seconds at 100ms chunks)
    this.audioChunkCount++;
    if (this.audioChunkCount % 100 === 0) {
      console.log(
        `[SessionController] Audio captured: ${this.audioChunkCount} chunks, ${Math.round(
          this.audioChunkCount * 0.1
        )}s of audio`
      );
    }
  }

  /**
   * Handle voice activity changes (forward to renderer for UI feedback).
   * Screenshots are no longer captured during recording; frame extraction
   * happens in the post-processing pipeline after recording stops.
   */
  private handleVoiceActivity(active: boolean): void {
    if (this.isPaused) {
      this.emitToRenderer(IPC_CHANNELS.SESSION_VOICE_ACTIVITY, { active: false });
      return;
    }

    this.emitToRenderer(IPC_CHANNELS.SESSION_VOICE_ACTIVITY, { active });
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
    if (hasFinalTranscript) {
      return;
    }

    const capturedAudio = this.audioCaptureService.getCapturedAudioAsset();
    if (!capturedAudio || capturedAudio.buffer.byteLength === 0) {
      console.warn('[SessionController] Post-session transcription recovery skipped: no captured audio asset.');
      return;
    }

    const sessionStartSec = this.session.startTime / 1000;
    const openAiApiKey = await this.getOpenAIApiKey();
    if (openAiApiKey) {
      const openAiRecovered = await this.recoverTranscriptWithOpenAIAudioAsset(
        capturedAudio,
        sessionStartSec,
        openAiApiKey,
      2
      );
      if (openAiRecovered.length > 0) {
        this.appendRecoveredTranscriptEvents(openAiRecovered);
        return;
      }
    } else {
      console.warn(
        '[SessionController] Post-session OpenAI recovery skipped: API key not configured.',
      );
    }

    // Local Whisper fallback only works with raw PCM buffers.
    const mergedAudio = this.audioCaptureService.getCapturedAudioBuffer();
    if (!mergedAudio || mergedAudio.byteLength === 0) {
      console.warn(
        '[SessionController] Post-session Whisper recovery skipped: captured audio is encoded-only.',
      );
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

    const audioDurationSec = audioSamples.length / 16000;
    const canRunLocalWhisperRecovery =
      audioDurationSec <= this.MAX_POST_SESSION_LOCAL_RECOVERY_DURATION_SEC;
    if (canRunLocalWhisperRecovery && whisperService.isModelAvailable()) {
      const whisperRecovered = await this.recoverTranscriptWithWhisper(
        audioSamples,
        sessionStartSec,
        3
      );
      if (whisperRecovered.length > 0) {
        this.appendRecoveredTranscriptEvents(whisperRecovered);
        return;
      }
    } else if (!canRunLocalWhisperRecovery) {
      console.warn(
        `[SessionController] Skipping post-session Whisper recovery for long session (${Math.round(audioDurationSec)}s).`,
      );
    } else {
      console.warn(
        '[SessionController] Post-session Whisper recovery skipped: no local model available.',
      );
    }

    console.warn(
      '[SessionController] Post-session transcription recovery exhausted OpenAI + local Whisper without transcript output.',
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
  }

  private async recoverTranscriptWithWhisper(
    audioSamples: Float32Array,
    sessionStartSec: number,
    maxAttempts: number,
  ): Promise<TranscriptEvent[]> {
    const sampleRate = 16000;
    const chunkSamples = sampleRate * this.WHISPER_RECOVERY_CHUNK_SECONDS;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const recoveredSegments: Array<{
          text: string;
          startTime: number;
          endTime: number;
          confidence: number;
        }> = [];
        for (let offset = 0; offset < audioSamples.length; offset += chunkSamples) {
          const chunk = audioSamples.subarray(offset, Math.min(audioSamples.length, offset + chunkSamples));
          const chunkStartSec = sessionStartSec + offset / sampleRate;
          const chunkSegments = await whisperService.transcribeSamples(chunk, chunkStartSec);
          recoveredSegments.push(...chunkSegments);

          // Yield between chunks to keep the app responsive during longer sessions.
          if (offset + chunkSamples < audioSamples.length) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }

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

  private async recoverTranscriptWithOpenAIAudioAsset(
    audioAsset: CapturedAudioAsset,
    sessionStartSec: number,
    apiKey: string,
    maxAttempts: number,
  ): Promise<TranscriptEvent[]> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutMs = Math.min(180_000, Math.max(30_000, Math.round(audioAsset.durationMs * 1.8)));
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const recoveredEvents: TranscriptEvent[] = [];

        try {
          const extension = this.extensionFromMimeType(audioAsset.mimeType);
          const form = new FormData();
          form.append('model', 'whisper-1');
          form.append('response_format', 'verbose_json');
          form.append('temperature', '0');
          form.append(
            'file',
            new Blob([new Uint8Array(audioAsset.buffer)], { type: audioAsset.mimeType }),
            `session-audio${extension}`,
          );

          const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
            body: form,
            signal: controller.signal,
          });

          if (!response.ok) {
            const detail = await this.extractOpenAiError(response);
            throw new Error(`OpenAI transcription failed (${response.status}): ${detail}`);
          }

          const payload = (await response.json()) as {
            text?: string;
            segments?: Array<{
              text?: string;
              start?: number;
            }>;
          };

          const segments = Array.isArray(payload.segments) ? payload.segments : [];
          if (segments.length > 0) {
            for (const segment of segments) {
              const text = segment.text?.trim();
              if (!text) {
                continue;
              }

              const start = Number.isFinite(segment.start) ? Math.max(0, Number(segment.start)) : 0;
              const normalizedTimestamp = this.normalizeTranscriptTimestamp(sessionStartSec + start);
              recoveredEvents.push({
                text,
                isFinal: true,
                confidence: 0.9,
                timestamp: normalizedTimestamp,
                tier: 'whisper',
              });
            }
          } else if (payload.text?.trim()) {
            recoveredEvents.push({
              text: payload.text.trim(),
              isFinal: true,
              confidence: 0.85,
              timestamp: this.normalizeTranscriptTimestamp(sessionStartSec),
              tier: 'whisper',
            });
          }
        } finally {
          clearTimeout(timeout);
        }

        if (recoveredEvents.length === 0) {
          throw new Error('No transcript text recovered from OpenAI transcription');
        }

        console.log(
          `[SessionController] Recovered ${recoveredEvents.length} transcript segments via OpenAI (attempt ${attempt}/${maxAttempts}).`,
        );
        return recoveredEvents;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[SessionController] OpenAI recovery attempt ${attempt}/${maxAttempts} failed: ${message}`,
        );

        if (attempt < maxAttempts) {
          const delayMs = 500 * attempt;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    return [];
  }

  private async getOpenAIApiKey(): Promise<string | null> {
    try {
      const settings = getSettingsManager();
      const apiKey = await settings.getApiKey('openai');
      const normalized = apiKey?.trim();
      return normalized && normalized.length > 0 ? normalized : null;
    } catch (error) {
      console.warn('[SessionController] Failed to read OpenAI API key for recovery:', error);
      return null;
    }
  }

  private async extractOpenAiError(response: Response): Promise<string> {
    try {
      const raw = await response.text();
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        return 'Unknown API error';
      }

      const parsed = JSON.parse(trimmed) as { error?: { message?: string } };
      const message = parsed?.error?.message;
      if (message && message.trim().length > 0) {
        return message.trim();
      }
      return trimmed.length > 220 ? `${trimmed.slice(0, 220)}...` : trimmed;
    } catch {
      return `HTTP ${response.status}`;
    }
  }

  private extensionFromMimeType(mimeType: string): string {
    const normalized = mimeType.toLowerCase();
    if (normalized.includes('webm')) return '.webm';
    if (normalized.includes('ogg')) return '.ogg';
    if (normalized.includes('mp4') || normalized.includes('aac') || normalized.includes('m4a')) {
      return '.m4a';
    }
    if (normalized.includes('wav')) return '.wav';
    return '.audio';
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
   * Handle transcript result from the active transcription source.
   * Note: Live transcription is currently disabled in favor of post-processing,
   * but this handler is retained for future use if streaming transcription returns.
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

    const text = normalizedEvent.text.trim();
    if (!text) {
      return;
    }

    // Add to buffer
    this.session.transcriptBuffer.push(normalizedEvent);
    if (this.session.transcriptBuffer.length > this.MAX_TRANSCRIPT_BUFFER_EVENTS) {
      this.session.transcriptBuffer.splice(
        0,
        this.session.transcriptBuffer.length - this.MAX_TRANSCRIPT_BUFFER_EVENTS
      );
    }

    // Emit to renderer
    if (normalizedEvent.isFinal) {
      console.log(`[SessionController] Final transcript (${normalizedEvent.tier}): "${text}"`);
      this.emitToRenderer(IPC_CHANNELS.TRANSCRIPTION_FINAL, {
        text,
        confidence: normalizedEvent.confidence,
        timestamp: normalizedEvent.timestamp,
        tier: normalizedEvent.tier,
      });
    } else {
      this.emitToRenderer(IPC_CHANNELS.TRANSCRIPTION_UPDATE, {
        text,
        confidence: normalizedEvent.confidence,
        timestamp: normalizedEvent.timestamp,
        isFinal: false,
        tier: normalizedEvent.tier,
      });
    }
  }

  /**
   * Normalizes transcript timestamps to epoch seconds for consistent matching.
   * Some providers emit relative offsets while others emit absolute timestamps.
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
        hasScreenshot: false,
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
    this.isPaused = false;

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
      void this.audioCaptureService.stop();
    } catch {
      // Ignore
    }
    // No-op: transcription recovery is post-session and does not run as a live service.
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
    this.emitStatus();
  }

  private emitStatus(): void {
    this.emitToRenderer(IPC_CHANNELS.SESSION_STATUS, this.getStatus());
  }

  /**
   * Emit feedback item to listeners
   */
  private emitFeedbackItem(item: FeedbackItem): void {
    this.events?.onFeedbackItem(item);
    this.emitToRenderer('session:feedbackItem', {
      id: item.id,
      timestamp: item.timestamp,
      text: item.text,
      confidence: item.confidence,
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
    this.isPaused = false;
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
    void this.audioCaptureService.stop();
  }

  /**
   * Clean up all services and timers with timeout protection.
   * Never blocks for more than 2 seconds per service.
   */
  private async cleanupServicesAsync(): Promise<void> {
    console.log('[SessionController] Cleaning up services...');
    this.isPaused = false;

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

    const [audioResult] = await Promise.allSettled([
      this.withTimeout(
        this.audioCaptureService.stop(),
        serviceTimeout,
        undefined,
        'AudioCapture.stop()'
      ),
    ]);

    // Log any failures
    if (audioResult.status === 'rejected') {
      console.warn('[SessionController] Audio cleanup failed:', audioResult.reason);
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
    this.postProcessResult = null;
    this.currentProcessingProgress = null;
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
