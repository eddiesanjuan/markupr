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
  'video/webm;codecs=vp8',
  'video/webm;codecs=vp9',
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
  private startPromise: Promise<void> | null = null;
  private stopping = false;
  private stopPromise: Promise<StopResult> | null = null;
  private recordingStartTime: number | null = null;

  private stopTracks(stream: MediaStream | null | undefined): void {
    if (!stream) {
      return;
    }
    try {
      stream.getTracks().forEach((track) => {
        try {
          track.enabled = false;
          track.stop();
        } catch {
          // Best effort.
        }
      });
    } catch {
      // Best effort.
    }
  }

  private hasLiveTrack(stream: MediaStream | null | undefined): boolean {
    if (!stream) {
      return false;
    }
    return stream.getTracks().some((track) => track.readyState === 'live');
  }

  private getDesktopConstraints(
    sourceId: string,
    highQuality: boolean
  ): MediaStreamConstraints {
    if (highQuality) {
      return {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            minWidth: 1280,
            minHeight: 720,
            maxWidth: 3840,
            maxHeight: 2160,
            maxFrameRate: 30,
          },
        } as DesktopVideoConstraints,
      };
    }

    return {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
        },
      } as DesktopVideoConstraints,
    };
  }

  private async getCandidateSourceIds(preferredSourceId: string): Promise<string[]> {
    const candidates = new Set<string>([preferredSourceId]);
    const captureApi = window.markupr?.capture;
    if (!captureApi?.getSources) {
      return Array.from(candidates);
    }

    try {
      const sources = await captureApi.getSources();
      for (const source of sources) {
        if (source.type === 'screen') {
          candidates.add(source.id);
        }
      }
    } catch (error) {
      console.warn('[ScreenRecordingRenderer] Failed to enumerate capture sources:', error);
    }

    return Array.from(candidates);
  }

  private async acquireScreenStream(sourceId: string): Promise<MediaStream> {
    let lastError: unknown;
    const candidates = await this.getCandidateSourceIds(sourceId);

    for (const candidateId of candidates) {
      const highQualityConstraints = this.getDesktopConstraints(candidateId, true);
      const fallbackConstraints = this.getDesktopConstraints(candidateId, false);

      try {
        return await navigator.mediaDevices.getUserMedia(highQualityConstraints);
      } catch (primaryError) {
        console.warn(
          `[ScreenRecordingRenderer] High-quality capture failed for ${candidateId}, retrying fallback:`,
          primaryError
        );
        lastError = primaryError;
      }

      try {
        return await navigator.mediaDevices.getUserMedia(fallbackConstraints);
      } catch (fallbackError) {
        console.warn(
          `[ScreenRecordingRenderer] Fallback capture failed for ${candidateId}:`,
          fallbackError
        );
        lastError = fallbackError;
      }
    }

    const message =
      lastError instanceof Error
        ? lastError.message
        : 'Unable to acquire a desktop capture stream.';
    throw new Error(message);
  }

  isRecording(): boolean {
    return this.mediaRecorder !== null && this.mediaRecorder.state !== 'inactive';
  }

  isPaused(): boolean {
    return this.mediaRecorder?.state === 'paused';
  }

  getSessionId(): string | null {
    return this.activeSessionId;
  }

  getRecordingStartTime(): number | null {
    return this.recordingStartTime;
  }

  async start(options: StartOptions): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    const startTask = (async () => {
      if (this.stopPromise) {
        await this.stopPromise.catch(() => {
          // Best effort; continuing to start allows a clean retry path.
        });
      }

      this.forceReleaseOrphanedCapture();

      if (this.isRecording()) {
        return;
      }

      const mimeType = chooseMimeType();
      const stream = await this.acquireScreenStream(options.sourceId);

      const recordingStartTime = Date.now();
      const startResult = await window.markupr.screenRecording.start(
        options.sessionId,
        mimeType,
        recordingStartTime
      );
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
        await window.markupr.screenRecording.stop(options.sessionId).catch(() => {});
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
            window.markupr.screenRecording.appendChunk(sessionId, new Uint8Array(buffer))
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
      this.recordingStartTime = recordingStartTime;

      // Emit chunks every second for near-real-time persistence.
      try {
        recorder.start(1000);
      } catch (error) {
        // recorder.start() failed — clean up everything.
        this.cleanupStream();
        this.mediaRecorder = null;
        this.activeSessionId = null;
        this.recordingStartTime = null;
        await window.markupr.screenRecording.stop(options.sessionId).catch(() => {});
        throw error;
      }
    })();

    this.startPromise = startTask.finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async stop(): Promise<StopResult> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    if (this.startPromise) {
      await this.startPromise.catch(() => {
        // If start failed, stop should still continue to clean up any residual state.
      });
    }

    if (this.stopping) {
      return { success: true };
    }

    if (!this.mediaRecorder || !this.activeSessionId) {
      // Defensive cleanup for partially-initialized recorder state.
      this.cleanupStream();
      this.mediaRecorder = null;
      this.activeSessionId = null;
      this.stopping = false;
      this.recordingStartTime = null;
      return { success: true };
    }

    const stopTask = (async (): Promise<StopResult> => {
      this.stopping = true;
      const sessionId = this.activeSessionId;
      const recorder = this.mediaRecorder;
      let result: StopResult = { success: true };

      if (!recorder || !sessionId) {
        this.cleanupStream();
        this.mediaRecorder = null;
        this.activeSessionId = null;
        this.recordingStartTime = null;
        this.stopping = false;
        return result;
      }

      try {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 4000);
          recorder.onstop = () => {
            clearTimeout(timeout);
            resolve();
          };
          try {
            if (recorder.state === 'recording') {
              try {
                recorder.requestData();
              } catch {
                // Best effort.
              }
            }
            recorder.stop();
          } catch {
            clearTimeout(timeout);
            resolve();
          }
        });

        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        this.stopTracks(recorder.stream);

        // Release screen-capture tracks immediately so macOS indicator turns off
        // even if persistence finalization takes longer than expected.
        this.cleanupStream();
        this.mediaRecorder = null;
        this.activeSessionId = null;
        this.recordingStartTime = null;

        await Promise.allSettled(Array.from(this.inFlightWrites));
        this.inFlightWrites.clear();

        try {
          const finalized = await Promise.race([
            window.markupr.screenRecording.stop(sessionId),
            new Promise<StopResult>((resolve) => {
              setTimeout(
                () =>
                  resolve({
                    success: false,
                    error: 'Timed out while finalizing screen recording persistence.',
                  }),
                7000
              );
            }),
          ]);
          result = finalized;
        } catch (error) {
          result = {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to finalize screen recording.',
          };
        }
      } finally {
        // Defensive cleanup for any partial/failed stop paths.
        this.cleanupStream();
        this.mediaRecorder = null;
        this.activeSessionId = null;
        this.stopping = false;
        this.recordingStartTime = null;
      }

      return result;
    })();

    this.stopPromise = stopTask.finally(() => {
      this.stopPromise = null;
    });
    return this.stopPromise;
  }

  async pause(): Promise<void> {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') {
      return;
    }

    try {
      this.mediaRecorder.pause();
    } catch (error) {
      console.warn('[ScreenRecordingRenderer] Failed to pause recording:', error);
    }
  }

  async resume(): Promise<void> {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'paused') {
      return;
    }

    try {
      this.mediaRecorder.resume();
    } catch (error) {
      console.warn('[ScreenRecordingRenderer] Failed to resume recording:', error);
    }
  }

  forceReleaseOrphanedCapture(): void {
    const hasStreamLeak = this.hasLiveTrack(this.mediaStream);
    const hasRecorderLeak = this.hasLiveTrack(this.mediaRecorder?.stream);
    if (!hasStreamLeak && !hasRecorderLeak) {
      return;
    }

    try {
      if (this.mediaRecorder) {
        this.mediaRecorder.ondataavailable = null;
        this.mediaRecorder.onerror = null;
        this.mediaRecorder.onstop = null;
      }
    } catch {
      // Best effort.
    }

    this.stopTracks(this.mediaRecorder?.stream);
    this.cleanupStream();
    this.mediaRecorder = null;
    this.activeSessionId = null;
    this.stopping = false;
    this.recordingStartTime = null;
  }

  private cleanupStream(): void {
    if (!this.mediaStream) {
      return;
    }
    this.stopTracks(this.mediaStream);
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
