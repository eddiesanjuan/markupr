/**
 * ScreenRecordingRenderer Unit Tests
 *
 * Tests the renderer-side screen recording lifecycle:
 * - Start/stop recording
 * - Chunk streaming to main process via IPC
 * - Error handling and cleanup
 * - Guard against double-start, double-stop
 * - In-flight write draining on stop
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock MediaRecorder + MediaStream + navigator.mediaDevices
// ---------------------------------------------------------------------------

class MockMediaStream {
  private tracks: Array<{ stop: ReturnType<typeof vi.fn>; kind: string }> = [];

  constructor() {
    this.tracks = [{ stop: vi.fn(), kind: 'video' }];
  }

  getTracks() {
    return this.tracks;
  }
}

let mockRecorderInstance: {
  state: string;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
};

class MockMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    // Fire onstop async
    setTimeout(() => this.onstop?.(), 0);
  });

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    mockRecorderInstance = this;
  }
}

vi.stubGlobal('MediaRecorder', MockMediaRecorder);

vi.stubGlobal('navigator', {
  mediaDevices: {
    getUserMedia: vi.fn(() => Promise.resolve(new MockMediaStream())),
  },
});

// ---------------------------------------------------------------------------
// Mock window.feedbackflow.screenRecording IPC
// ---------------------------------------------------------------------------

const mockScreenRecordingIPC = {
  start: vi.fn(() => Promise.resolve({ success: true, path: '/tmp/rec.webm' })),
  appendChunk: vi.fn(() => Promise.resolve({ success: true })),
  stop: vi.fn(() =>
    Promise.resolve({ success: true, path: '/tmp/rec.webm', bytes: 1024, mimeType: 'video/webm' })
  ),
};

vi.stubGlobal('window', {
  feedbackflow: {
    screenRecording: mockScreenRecordingIPC,
  },
});

// ---------------------------------------------------------------------------
// Import AFTER mocks are in place
// ---------------------------------------------------------------------------

import { ScreenRecordingRenderer } from '../../src/renderer/capture/ScreenRecordingRenderer';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScreenRecordingRenderer', () => {
  let renderer: ScreenRecordingRenderer;

  beforeEach(() => {
    renderer = new ScreenRecordingRenderer();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Ensure cleanup
    if (renderer.isRecording()) {
      await renderer.stop();
    }
  });

  // ========================================================================
  // Initial state
  // ========================================================================

  describe('initial state', () => {
    it('should not be recording initially', () => {
      expect(renderer.isRecording()).toBe(false);
    });

    it('should have null sessionId initially', () => {
      expect(renderer.getSessionId()).toBeNull();
    });
  });

  // ========================================================================
  // Start recording
  // ========================================================================

  describe('start', () => {
    it('should request getUserMedia with desktop source constraints', async () => {
      await renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' });

      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: false,
          video: expect.objectContaining({
            mandatory: expect.objectContaining({
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: 'screen:0:0',
            }),
          }),
        })
      );
    });

    it('should call IPC start with sessionId and mimeType', async () => {
      await renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' });

      expect(mockScreenRecordingIPC.start).toHaveBeenCalledWith('sess-1', expect.any(String));
    });

    it('should set isRecording to true after start', async () => {
      await renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' });

      expect(renderer.isRecording()).toBe(true);
    });

    it('should set sessionId after start', async () => {
      await renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' });

      expect(renderer.getSessionId()).toBe('sess-1');
    });

    it('should start MediaRecorder with 1000ms timeslice', async () => {
      await renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' });

      expect(mockRecorderInstance.start).toHaveBeenCalledWith(1000);
    });

    it('should no-op if already recording', async () => {
      await renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' });
      vi.clearAllMocks();

      await renderer.start({ sessionId: 'sess-2', sourceId: 'screen:0:0' });

      // Should NOT have called getUserMedia again
      expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
      // Session ID should still be the first one
      expect(renderer.getSessionId()).toBe('sess-1');
    });

    it('should throw if IPC start fails', async () => {
      mockScreenRecordingIPC.start.mockResolvedValueOnce({ success: false, error: 'disk full' });

      await expect(
        renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' })
      ).rejects.toThrow('disk full');
    });

    it('should stop tracks if IPC start fails', async () => {
      const mockStream = new MockMediaStream();
      vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValueOnce(
        mockStream as unknown as MediaStream
      );
      mockScreenRecordingIPC.start.mockResolvedValueOnce({ success: false, error: 'fail' });

      await expect(renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' })).rejects.toThrow();

      expect(mockStream.getTracks()[0].stop).toHaveBeenCalled();
    });

    it('should fall back to basic constraints if high-quality fails', async () => {
      let callCount = 0;
      vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('OverconstrainedError'));
        }
        return Promise.resolve(new MockMediaStream() as unknown as MediaStream);
      });

      await renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' });

      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
      expect(renderer.isRecording()).toBe(true);
    });
  });

  // ========================================================================
  // Chunk streaming
  // ========================================================================

  describe('chunk streaming', () => {
    it('should send chunks to IPC when data is available', async () => {
      await renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' });

      // Simulate a data chunk from MediaRecorder
      const blob = new Blob(['test-data'], { type: 'video/webm' });
      mockRecorderInstance.ondataavailable?.({ data: blob });

      // Wait for async processing
      await new Promise((r) => setTimeout(r, 10));

      expect(mockScreenRecordingIPC.appendChunk).toHaveBeenCalledWith(
        'sess-1',
        expect.any(Uint8Array)
      );
    });

    it('should ignore empty chunks', async () => {
      await renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' });

      const emptyBlob = new Blob([], { type: 'video/webm' });
      mockRecorderInstance.ondataavailable?.({ data: emptyBlob });

      await new Promise((r) => setTimeout(r, 10));

      expect(mockScreenRecordingIPC.appendChunk).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Stop recording
  // ========================================================================

  describe('stop', () => {
    it('should return success immediately if not recording', async () => {
      const result = await renderer.stop();

      expect(result).toEqual({ success: true });
    });

    it('should call IPC stop with sessionId', async () => {
      await renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' });
      await renderer.stop();

      expect(mockScreenRecordingIPC.stop).toHaveBeenCalledWith('sess-1');
    });

    it('should reset state after stop', async () => {
      await renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' });
      await renderer.stop();

      expect(renderer.isRecording()).toBe(false);
      expect(renderer.getSessionId()).toBeNull();
    });

    it('should stop media stream tracks on stop', async () => {
      const mockStream = new MockMediaStream();
      vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValueOnce(
        mockStream as unknown as MediaStream
      );

      await renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' });
      await renderer.stop();

      expect(mockStream.getTracks()[0].stop).toHaveBeenCalled();
    });

    it('should return IPC stop result', async () => {
      const expected = { success: true, path: '/tmp/rec.webm', bytes: 2048, mimeType: 'video/webm' };
      mockScreenRecordingIPC.stop.mockResolvedValueOnce(expected);

      await renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' });
      const result = await renderer.stop();

      expect(result).toEqual(expected);
    });

    it('should no-op on double stop', async () => {
      await renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' });
      await renderer.stop();

      vi.clearAllMocks();

      const result = await renderer.stop();

      expect(result).toEqual({ success: true });
      expect(mockScreenRecordingIPC.stop).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // MIME type selection
  // ========================================================================

  describe('MIME type selection', () => {
    it('should use first supported MIME type', async () => {
      MockMediaRecorder.isTypeSupported.mockImplementation(
        (type: string) => type === 'video/webm;codecs=vp9'
      );

      await renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' });

      expect(mockScreenRecordingIPC.start).toHaveBeenCalledWith('sess-1', 'video/webm;codecs=vp9');
    });

    it('should fall back to video/webm when no codecs supported', async () => {
      MockMediaRecorder.isTypeSupported.mockReturnValue(false);

      await renderer.start({ sessionId: 'sess-1', sourceId: 'screen:0:0' });

      expect(mockScreenRecordingIPC.start).toHaveBeenCalledWith('sess-1', 'video/webm');
    });
  });
});
