import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { clipboard } from "electron";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { writeFile } from "fs/promises";
import { AudioService } from "./AudioService";
import { TranscriptionService } from "./TranscriptionService";
import { StateStore } from "./StateStore";
import { ScreenshotService } from "./ScreenshotService";
import { logger } from "../utils/logger";

export enum SessionState {
  IDLE = "idle",
  STARTING = "starting",
  RECORDING = "recording",
  STOPPING = "stopping",
  PROCESSING = "processing",
  COMPLETE = "complete",
  ERROR = "error",
}

export interface SessionData {
  id: string;
  state: SessionState;
  startedAt: number | null;
  stoppedAt: number | null;
  audioPath: string | null;
  transcript: string | null;
  screenshots: string[];
  markdownOutput: string | null;
  reportPath: string | null;
  error: string | null;
  stateEnteredAt: number;
}

interface StateTimeoutConfig {
  state: SessionState;
  duration: number;
  fallbackState: SessionState;
}

const STATE_TIMEOUTS: StateTimeoutConfig[] = [
  {
    state: SessionState.STARTING,
    duration: 5000,
    fallbackState: SessionState.ERROR,
  },
  {
    state: SessionState.RECORDING,
    duration: 30 * 60 * 1000,
    fallbackState: SessionState.STOPPING,
  },
  {
    state: SessionState.STOPPING,
    duration: 3000,
    fallbackState: SessionState.PROCESSING,
  },
  {
    state: SessionState.PROCESSING,
    duration: 60000,
    fallbackState: SessionState.COMPLETE,
  },
  {
    state: SessionState.COMPLETE,
    duration: 60000,
    fallbackState: SessionState.IDLE,
  },
  {
    state: SessionState.ERROR,
    duration: 30000,
    fallbackState: SessionState.IDLE,
  },
];

export class SessionController extends EventEmitter {
  private session: SessionData;
  private audioService: AudioService;
  private transcriptionService: TranscriptionService;
  private stateStore: StateStore;
  private screenshotService: ScreenshotService | null;
  private watchdogInterval: NodeJS.Timeout | null = null;
  private operationLock = false;
  private onAudioFatalError: (error: Error) => void;

  constructor(
    audioService: AudioService,
    transcriptionService: TranscriptionService,
    stateStore: StateStore,
    screenshotService?: ScreenshotService,
  ) {
    super();
    this.audioService = audioService;
    this.transcriptionService = transcriptionService;
    this.stateStore = stateStore;
    this.screenshotService = screenshotService || null;
    this.session = this.createFreshSession();
    // Don't start watchdog in constructor - only needed when not IDLE

    // Listen for fatal audio errors (e.g., recording process crash)
    // so the UI transitions to ERROR instead of freezing on "Recording"
    this.onAudioFatalError = (error: Error) => {
      logger.error("Audio fatal error:", error);
      if (this.session.state === SessionState.RECORDING) {
        this.setState(SessionState.ERROR, `Recording failed: ${error.message}`);
      }
    };
    this.audioService.on("fatalError", this.onAudioFatalError);
  }

  private createFreshSession(): SessionData {
    return {
      id: uuidv4(),
      state: SessionState.IDLE,
      startedAt: null,
      stoppedAt: null,
      audioPath: null,
      transcript: null,
      screenshots: [],
      markdownOutput: null,
      reportPath: null,
      error: null,
      stateEnteredAt: Date.now(),
    };
  }

  private startWatchdog(): void {
    if (this.watchdogInterval) return; // Already running
    this.watchdogInterval = setInterval(() => {
      this.checkStateHealth();
    }, 1000);
  }

  private stopWatchdog(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  private checkStateHealth(): void {
    const timeout = STATE_TIMEOUTS.find((t) => t.state === this.session.state);
    if (!timeout) return;

    const stateAge = Date.now() - this.session.stateEnteredAt;
    if (stateAge > timeout.duration) {
      logger.warn(
        `State ${this.session.state} timed out after ${stateAge}ms, transitioning to ${timeout.fallbackState}`,
      );
      // Fire and forget - the forceTransition handles cleanup async
      void this.forceTransition(
        timeout.fallbackState,
        `Timeout after ${Math.round(stateAge / 1000)}s`,
      );
    }
  }

  private setState(newState: SessionState, error?: string): void {
    const oldState = this.session.state;

    // Prevent redundant state transitions (e.g., idle-to-idle after createFreshSession)
    if (oldState === newState && !error) {
      return;
    }

    this.session.state = newState;
    this.session.stateEnteredAt = Date.now();

    if (error) {
      this.session.error = error;
    }

    // Manage watchdog: stop when entering IDLE, start when leaving IDLE
    if (newState === SessionState.IDLE) {
      this.stopWatchdog();
    } else if (oldState === SessionState.IDLE) {
      this.startWatchdog();
    }

    this.persistState();

    this.emit("stateChange", {
      oldState,
      newState,
      session: this.getSession(),
    });
  }

  private async persistState(): Promise<void> {
    try {
      await this.stateStore.save(this.session);
    } catch (err) {
      logger.error("Failed to persist state:", err);
    }
  }

  private async forceTransition(
    state: SessionState,
    reason: string,
  ): Promise<void> {
    logger.log(`Force transition to ${state}: ${reason}`);
    const currentState = this.session.state;

    // Perform actionful cleanup based on current state before transitioning
    await this.cleanupCurrentState(currentState);

    if (state === SessionState.IDLE) {
      // Reset to fresh session and emit single state change
      const previousState = this.session.state;
      this.session = this.createFreshSession();
      this.persistState();
      this.emit("stateChange", {
        oldState: previousState,
        newState: SessionState.IDLE,
        session: this.getSession(),
      });
      return;
    }

    this.setState(state, reason);
  }

  /**
   * Performs actionful cleanup based on current state.
   * This ensures processes are actually stopped, not just state changed.
   */
  private async cleanupCurrentState(currentState: SessionState): Promise<void> {
    switch (currentState) {
      case SessionState.RECORDING:
        // Force stop the recording - kill the audio process
        if (this.audioService.isCurrentlyRecording()) {
          try {
            await this.audioService.stopRecording();
          } catch {
            // Force kill via destroy if graceful stop fails
            this.audioService.destroy();
          }
        }
        break;

      case SessionState.STARTING:
        // Kill any audio process that might be starting
        this.audioService.destroy();
        // End any screenshot session that was started
        this.screenshotService?.endSession();
        break;

      case SessionState.STOPPING:
        // Ensure audio is killed if stop is stuck
        if (this.audioService.isCurrentlyRecording()) {
          this.audioService.destroy();
        }
        break;

      case SessionState.PROCESSING:
        // Note: TranscriptionService doesn't track active process externally,
        // but the watchdog timeout will cause us to move on.
        // The transcription's internal timeout will kill the whisper process.
        // End screenshot session if still active
        this.screenshotService?.endSession();
        break;
    }
  }

  async withTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    fallbackValue: T,
  ): Promise<T> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        logger.warn(`Operation timed out after ${timeoutMs}ms`);
        resolve(fallbackValue);
      }, timeoutMs);

      operation()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          logger.error("Operation failed:", err);
          resolve(fallbackValue);
        });
    });
  }

  getSession(): SessionData {
    return { ...this.session };
  }

  getState(): SessionState {
    return this.session.state;
  }

  async start(): Promise<boolean> {
    // Atomic state check with operation lock to prevent race conditions
    // from double-triggering via global shortcut + UI button
    if (this.operationLock || this.session.state !== SessionState.IDLE) {
      logger.warn(`Cannot start: current state is ${this.session.state}, lock=${this.operationLock}`);
      return false;
    }

    this.operationLock = true;
    try {
      this.session = this.createFreshSession();
      this.setState(SessionState.STARTING);

      // Start screenshot session
      this.screenshotService?.startSession(this.session.id);

      const audioPath = await this.withTimeout(
        () => this.audioService.startRecording(this.session.id),
        4000,
        null,
      );

      if (!audioPath) {
        this.screenshotService?.endSession();
        this.setState(SessionState.ERROR, "Failed to start audio recording");
        return false;
      }

      this.session.audioPath = audioPath;
      this.session.startedAt = Date.now();
      this.setState(SessionState.RECORDING);

      return true;
    } catch (err) {
      this.screenshotService?.endSession();
      const message = err instanceof Error ? err.message : "Unknown error";
      this.setState(SessionState.ERROR, message);
      return false;
    } finally {
      this.operationLock = false;
    }
  }

  async stop(): Promise<boolean> {
    // Atomic state check with operation lock to prevent race conditions
    // from double-triggering via global shortcut + UI button
    if (this.operationLock || this.session.state !== SessionState.RECORDING) {
      logger.warn(`Cannot stop: current state is ${this.session.state}, lock=${this.operationLock}`);
      return false;
    }

    this.operationLock = true;
    try {
      this.setState(SessionState.STOPPING);
      this.session.stoppedAt = Date.now();

      await this.withTimeout(
        () => this.audioService.stopRecording(),
        2500,
        null,
      );

      await this.processRecording();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      this.setState(SessionState.ERROR, message);
      return false;
    } finally {
      this.operationLock = false;
    }
  }

  private async processRecording(): Promise<void> {
    this.setState(SessionState.PROCESSING);

    // End screenshot session
    this.screenshotService?.endSession();

    if (!this.session.audioPath) {
      this.session.markdownOutput = this.generateMarkdown();
      await this.saveMarkdownToFile();
      this.setState(SessionState.COMPLETE);
      return;
    }

    try {
      const transcript = await this.withTimeout(
        () => this.transcriptionService.transcribe(this.session.audioPath!),
        55000,
        "[Transcription unavailable]",
      );

      this.session.transcript = transcript;
      this.session.markdownOutput = this.generateMarkdown();
      await this.saveMarkdownToFile();
      this.setState(SessionState.COMPLETE);
    } catch (err) {
      logger.error("Transcription failed:", err);
      this.session.transcript = "[Transcription failed]";
      this.session.markdownOutput = this.generateMarkdown();
      await this.saveMarkdownToFile();
      this.setState(SessionState.COMPLETE);
    }
  }

  private async saveMarkdownToFile(): Promise<void> {
    if (!this.session.markdownOutput) return;

    try {
      // Create ~/FeedbackFlow directory
      const feedbackDir = join(homedir(), "FeedbackFlow");
      if (!existsSync(feedbackDir)) {
        mkdirSync(feedbackDir, { recursive: true });
      }

      // Generate filename with seconds and unique ID to prevent collisions
      // Format: session-YYYY-MM-DD-HHMMSS-xxxx.md
      const timestamp = new Date()
        .toISOString()
        .replace(/[T:]/g, "-")
        .replace(/\..+/, ""); // Remove milliseconds
      const shortId = Math.random().toString(36).substring(2, 6);
      const filename = `session-${timestamp}-${shortId}.md`;
      const filePath = join(feedbackDir, filename);

      // Write markdown to file asynchronously
      await writeFile(filePath, this.session.markdownOutput, "utf-8");
      this.session.reportPath = filePath;

      // Auto-copy path to clipboard
      clipboard.writeText(filePath);

      logger.log(`Report saved to: ${filePath}`);
    } catch (err) {
      logger.error("Failed to save markdown to file:", err);
    }
  }

  private generateMarkdown(): string {
    const lines: string[] = [];
    const date = new Date();
    const dateStr = date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    // Header
    lines.push(`# Feedback - ${dateStr}`);
    lines.push("");
    lines.push(`*Recorded at ${timeStr}*`);
    lines.push("");

    // Duration if available
    if (this.session.startedAt && this.session.stoppedAt) {
      const durationMs = this.session.stoppedAt - this.session.startedAt;
      const durationSec = Math.round(durationMs / 1000);
      const minutes = Math.floor(durationSec / 60);
      const seconds = durationSec % 60;
      lines.push(
        `**Duration:** ${minutes}:${String(seconds).padStart(2, "0")}`,
      );
      lines.push("");
    }

    // Transcript
    lines.push("## Transcript");
    lines.push("");
    if (this.session.transcript) {
      lines.push(this.session.transcript);
    } else {
      lines.push("*No transcript available*");
    }
    lines.push("");

    // Screenshots
    if (this.session.screenshots.length > 0) {
      lines.push("## Screenshots");
      lines.push("");
      this.session.screenshots.forEach((path, index) => {
        lines.push(`### Screenshot ${index + 1}`);
        lines.push(`![Screenshot ${index + 1}](${path})`);
        lines.push("");
      });
    }

    // Footer
    lines.push("---");
    lines.push("*Generated by FeedbackFlow*");

    return lines.join("\n");
  }

  async cancel(): Promise<void> {
    if (this.session.state === SessionState.IDLE) {
      return;
    }

    // End screenshot session
    this.screenshotService?.endSession();

    if (this.session.state === SessionState.RECORDING) {
      try {
        await this.audioService.stopRecording();
      } catch {
        // Ignore errors during cancel
      }
    }

    this.session = this.createFreshSession();
    this.setState(SessionState.IDLE);
  }

  async reset(): Promise<void> {
    // Stop any active recording before clearing state
    if (this.audioService.isCurrentlyRecording()) {
      try {
        await this.audioService.stopRecording();
      } catch {
        // Force kill if graceful stop fails
        this.audioService.destroy();
      }
    }

    // End any active screenshot session
    this.screenshotService?.endSession();

    // Now clear persisted state and reset to fresh session
    await this.stateStore.clear();
    this.session = this.createFreshSession();
    this.setState(SessionState.IDLE);
  }

  addScreenshot(path: string): void {
    if (this.session.state === SessionState.RECORDING) {
      this.session.screenshots.push(path);
      this.persistState();
    }
  }

  async checkRecovery(): Promise<SessionData | null> {
    try {
      const savedSession = await this.stateStore.load();
      if (
        savedSession &&
        savedSession.state !== SessionState.IDLE &&
        savedSession.state !== SessionState.COMPLETE
      ) {
        return savedSession;
      }
    } catch {
      // No recovery needed
    }
    return null;
  }

  async recoverSession(savedSession: SessionData): Promise<void> {
    this.session = savedSession;
    this.session.stateEnteredAt = Date.now();

    if (
      this.session.state === SessionState.RECORDING ||
      this.session.state === SessionState.STARTING
    ) {
      this.session.state = SessionState.PROCESSING;
      await this.processRecording();
    } else if (
      this.session.state === SessionState.PROCESSING ||
      this.session.state === SessionState.STOPPING
    ) {
      await this.processRecording();
    }
  }

  destroy(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
    }
    this.audioService.removeListener("fatalError", this.onAudioFatalError);
    this.removeAllListeners();
  }
}
