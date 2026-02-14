/**
 * ActiveRecording Unit Tests
 *
 * Tests the singleton recording lock:
 * - start() tracks a recording
 * - start() throws if already recording
 * - stop() clears the recording and returns session info
 * - stop() throws if no recording active
 * - isRecording() returns correct boolean
 * - getCurrent() returns state or null
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'child_process';

vi.mock('../../../src/mcp/utils/Logger.js', () => ({
  log: vi.fn(),
}));

import { ActiveRecording } from '../../../src/mcp/session/ActiveRecording.js';

describe('ActiveRecording', () => {
  let recording: ActiveRecording;
  let mockProcess: ChildProcess;

  beforeEach(() => {
    recording = new ActiveRecording();
    mockProcess = { pid: 1234 } as unknown as ChildProcess;
  });

  describe('start', () => {
    it('tracks a new recording', () => {
      recording.start('session-1', mockProcess, '/tmp/video.mp4');
      expect(recording.isRecording()).toBe(true);
    });

    it('throws if a recording is already in progress', () => {
      recording.start('session-1', mockProcess, '/tmp/video.mp4');

      expect(() => {
        recording.start('session-2', mockProcess, '/tmp/video2.mp4');
      }).toThrow('Recording already in progress');
    });

    it('includes the active session ID in the error message', () => {
      recording.start('session-1', mockProcess, '/tmp/video.mp4');

      expect(() => {
        recording.start('session-2', mockProcess, '/tmp/video2.mp4');
      }).toThrow('session-1');
    });
  });

  describe('stop', () => {
    it('clears the recording and returns session info', () => {
      recording.start('session-1', mockProcess, '/tmp/video.mp4');

      const result = recording.stop();

      expect(result.sessionId).toBe('session-1');
      expect(result.videoPath).toBe('/tmp/video.mp4');
      expect(recording.isRecording()).toBe(false);
    });

    it('throws if no recording is active', () => {
      expect(() => recording.stop()).toThrow('No recording in progress');
    });
  });

  describe('isRecording', () => {
    it('returns false initially', () => {
      expect(recording.isRecording()).toBe(false);
    });

    it('returns true when recording is active', () => {
      recording.start('session-1', mockProcess, '/tmp/video.mp4');
      expect(recording.isRecording()).toBe(true);
    });

    it('returns false after stop', () => {
      recording.start('session-1', mockProcess, '/tmp/video.mp4');
      recording.stop();
      expect(recording.isRecording()).toBe(false);
    });
  });

  describe('getCurrent', () => {
    it('returns null when no recording active', () => {
      expect(recording.getCurrent()).toBeNull();
    });

    it('returns current state when recording', () => {
      recording.start('session-1', mockProcess, '/tmp/video.mp4');

      const current = recording.getCurrent();
      expect(current).not.toBeNull();
      expect(current?.sessionId).toBe('session-1');
      expect(current?.videoPath).toBe('/tmp/video.mp4');
      expect(current?.process).toBe(mockProcess);
    });

    it('returns null after stop', () => {
      recording.start('session-1', mockProcess, '/tmp/video.mp4');
      recording.stop();
      expect(recording.getCurrent()).toBeNull();
    });
  });

  describe('lifecycle', () => {
    it('allows starting a new recording after stopping', () => {
      recording.start('session-1', mockProcess, '/tmp/video1.mp4');
      recording.stop();

      const newProcess = { pid: 5678 } as unknown as ChildProcess;
      recording.start('session-2', newProcess, '/tmp/video2.mp4');

      expect(recording.isRecording()).toBe(true);
      expect(recording.getCurrent()?.sessionId).toBe('session-2');
    });
  });
});
