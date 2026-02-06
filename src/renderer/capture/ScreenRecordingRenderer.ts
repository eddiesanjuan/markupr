/**
 * ScreenRecordingRenderer - Renderer-side full session screen recorder.
 *
 * Captures the selected desktop source continuously with MediaRecorder and
 * streams chunks to the main process for durable file writing.
 */

interface StartOptions {
  sessionId: string;
  sourceId: string;
}

interface StopResult {
  success: boolean;
  path?: string;
  bytes?: number;
  mimeType?: string;
  error?: string;
}

interface DesktopVideoConstraints extends MediaTrackConstraints {
  mandatory?: {
    chromeMediaSource: 'desktop';
    chromeMediaSourceId: string;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    maxFrameRate?: number;
  };
}

const MIME_TYPE_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
] as const;

function chooseMimeType(): string {
  for (const candidate of MIME_TYPE_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return 'video/webm';
}

export class ScreenRecordingRenderer {
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private activeSessionId: string | null = null;
  private inFlightWrites: Set<Promise<void>> = new Set();
  private stopping = false;

  isRecording(): boolean {
    return this.mediaRecorder !== null && this.mediaRecorder.state !== 'inactive';
  }

  getSessionId(): string | null {
    return this.activeSessionId;
  }

  async start(options: StartOptions): Promise<void> {
    if (this.isRecording()) {
      return;
    }

    const mimeType = chooseMimeType();

    const highQualityConstraints: MediaStreamConstraints = {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: options.sourceId,
          minWidth: 1280,
          minHeight: 720,
          maxWidth: 3840,
          maxHeight: 2160,
          maxFrameRate: 30,
        },
      } as DesktopVideoConstraints,
    };

    const fallbackConstraints: MediaStreamConstraints = {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: options.sourceId,
        },
      } as DesktopVideoConstraints,
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(highQualityConstraints);
    } catch (primaryError) {
      console.warn(
        '[ScreenRecordingRenderer] High-quality capture constraints failed, retrying with fallback:',
        primaryError
      );
      stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
    }

    const startResult = await window.feedbackflow.screenRecording.start(options.sessionId, mimeType);
    if (!startResult.success) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error(startResult.error || 'Unable to start screen recording persistence.');
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
    } catch (error) {
      // MediaRecorder construction failed — clean up the main-process artifact and stream.
      stream.getTracks().forEach((track) => track.stop());
      await window.feedbackflow.screenRecording.stop(options.sessionId).catch(() => {});
      throw error;
    }

    recorder.ondataavailable = (event: BlobEvent) => {
      if (!event.data || event.data.size === 0 || !this.activeSessionId) {
        return;
      }

      const sessionId = this.activeSessionId;
      const writePromise = event.data
        .arrayBuffer()
        .then((buffer) =>
          window.feedbackflow.screenRecording.appendChunk(sessionId, new Uint8Array(buffer))
        )
        .then((result) => {
          if (!result.success) {
            throw new Error(result.error || 'Failed to append recording chunk.');
          }
        })
        .catch((error) => {
          console.error('[ScreenRecordingRenderer] Chunk write failed:', error);
        })
        .finally(() => {
          this.inFlightWrites.delete(writePromise);
        });

      this.inFlightWrites.add(writePromise);
    };

    this.mediaStream = stream;
    this.mediaRecorder = recorder;
    this.activeSessionId = options.sessionId;
    this.stopping = false;

    // Emit chunks every second for near-real-time persistence.
    try {
      recorder.start(1000);
    } catch (error) {
      // recorder.start() failed — clean up everything.
      this.cleanupStream();
      this.mediaRecorder = null;
      this.activeSessionId = null;
      await window.feedbackflow.screenRecording.stop(options.sessionId).catch(() => {});
      throw error;
    }
  }

  async stop(): Promise<StopResult> {
    if (!this.mediaRecorder || !this.activeSessionId || this.stopping) {
      return { success: true };
    }

    this.stopping = true;
    const sessionId = this.activeSessionId;
    const recorder = this.mediaRecorder;

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 4000);
      recorder.onstop = () => {
        clearTimeout(timeout);
        resolve();
      };
      try {
        recorder.stop();
      } catch {
        clearTimeout(timeout);
        resolve();
      }
    });

    await Promise.allSettled(Array.from(this.inFlightWrites));
    this.inFlightWrites.clear();

    const result = await window.feedbackflow.screenRecording.stop(sessionId);
    this.cleanupStream();
    this.mediaRecorder = null;
    this.activeSessionId = null;
    this.stopping = false;
    return result;
  }

  private cleanupStream(): void {
    if (!this.mediaStream) {
      return;
    }
    this.mediaStream.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
  }
}

let screenRecordingRendererInstance: ScreenRecordingRenderer | null = null;

export function getScreenRecordingRenderer(): ScreenRecordingRenderer {
  if (!screenRecordingRendererInstance) {
    screenRecordingRendererInstance = new ScreenRecordingRenderer();
  }
  return screenRecordingRendererInstance;
}

export default getScreenRecordingRenderer;
