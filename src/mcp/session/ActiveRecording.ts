/**
 * Active Recording — Singleton lock for the currently running recording.
 *
 * Enforces a single-recording constraint: only one ffmpeg recording process
 * can be active at a time. Tools call start()/stop() to manage the lifecycle.
 *
 * NO Electron dependencies.
 */

import type { ChildProcess } from 'child_process';
import { log } from '../utils/Logger.js';

interface RecordingState {
  sessionId: string;
  process: ChildProcess;
  videoPath: string;
}

export class ActiveRecording {
  private current: RecordingState | null = null;

  /**
   * Start tracking a recording. Throws if one is already in progress.
   */
  start(sessionId: string, process: ChildProcess, videoPath: string): void {
    if (this.current !== null) {
      throw new Error(
        `Recording already in progress (session: ${this.current.sessionId}). ` +
        `Stop it before starting a new one.`
      );
    }

    this.current = { sessionId, process, videoPath };
    log(`Active recording started: ${sessionId}`);
  }

  /**
   * Stop tracking the current recording. Returns the session ID and video path.
   * Throws if no recording is active.
   */
  stop(): { sessionId: string; videoPath: string } {
    if (this.current === null) {
      throw new Error('No recording in progress.');
    }

    const { sessionId, videoPath } = this.current;
    this.current = null;
    log(`Active recording stopped: ${sessionId}`);
    return { sessionId, videoPath };
  }

  /**
   * Check if a recording is currently active.
   */
  isRecording(): boolean {
    return this.current !== null;
  }

  /**
   * Get the current recording state (read-only), or null.
   */
  getCurrent(): Readonly<RecordingState> | null {
    return this.current;
  }
}

export const activeRecording = new ActiveRecording();
