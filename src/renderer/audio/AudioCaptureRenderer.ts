/**
 * AudioCaptureRenderer.ts - Browser-side Audio Capture for FeedbackFlow
 *
 * This module runs in the renderer process and handles:
 * - getUserMedia access for microphone
 * - AudioWorklet for low-latency audio processing
 * - Streaming audio chunks to main process via preload API
 *
 * The AudioWorklet approach is preferred over ScriptProcessorNode because:
 * - ScriptProcessorNode is deprecated
 * - AudioWorklet runs on a separate thread, preventing audio glitches
 * - Better latency characteristics
 */

interface CaptureConfig {
  deviceId: string | null;
  sampleRate: number;
  channels: number;
  chunkDurationMs: number;
}

interface AudioDeviceInfo {
  id: string;
  name: string;
  isDefault: boolean;
}

/**
 * AudioWorklet processor code as a string
 * This gets injected into a Blob URL and loaded by the AudioContext
 */
const AUDIO_WORKLET_PROCESSOR = `
class AudioChunkProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.buffer = [];
    this.chunkSamples = options.processorOptions?.chunkSamples || 1600;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0];

    // Accumulate samples
    for (let i = 0; i < samples.length; i++) {
      this.buffer.push(samples[i]);
    }

    // When we have enough samples, send a chunk
    while (this.buffer.length >= this.chunkSamples) {
      const chunk = this.buffer.splice(0, this.chunkSamples);
      this.port.postMessage({
        type: 'chunk',
        samples: chunk,
        timestamp: currentTime * 1000, // Convert to ms
      });
    }

    return true;
  }
}

registerProcessor('audio-chunk-processor', AudioChunkProcessor);
`;

/**
 * Renderer-side audio capture manager
 * Uses the preload API for secure IPC communication
 */
class AudioCaptureRenderer {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private capturing: boolean = false;
  private config: CaptureConfig = {
    deviceId: null,
    sampleRate: 16000,
    channels: 1,
    chunkDurationMs: 100,
  };
  private cleanupFunctions: Array<() => void> = [];

  constructor() {
    this.setupIPCListeners();
  }

  /**
   * Set up IPC listeners for commands from main process via preload API
   */
  private setupIPCListeners(): void {
    const api = window.feedbackflow;
    if (!api?.audio) {
      console.error('[AudioCaptureRenderer] feedbackflow.audio API not available');
      return;
    }

    // Handle device enumeration request
    const cleanupDevices = api.audio.onRequestDevices(async () => {
      try {
        const devices = await this.getDevices();
        api.audio.sendDevices(devices);
      } catch (error) {
        api.audio.sendCaptureError((error as Error).message);
      }
    });
    this.cleanupFunctions.push(cleanupDevices);

    // Handle start capture command
    const cleanupStart = api.audio.onStartCapture(async (config) => {
      try {
        this.config = { ...this.config, ...config };
        await this.startCapture();
        api.audio.notifyCaptureStarted();
      } catch (error) {
        api.audio.sendCaptureError((error as Error).message);
      }
    });
    this.cleanupFunctions.push(cleanupStart);

    // Handle stop capture command
    const cleanupStop = api.audio.onStopCapture(() => {
      this.stopCapture();
      api.audio.notifyCaptureStopped();
    });
    this.cleanupFunctions.push(cleanupStop);

    // Handle device change command
    const cleanupDevice = api.audio.onSetDevice(async (deviceId) => {
      this.config.deviceId = deviceId;
      if (this.capturing) {
        // Restart capture with new device
        this.stopCapture();
        try {
          await this.startCapture();
          api.audio.notifyCaptureStarted();
        } catch (error) {
          api.audio.sendCaptureError((error as Error).message);
        }
      }
    });
    this.cleanupFunctions.push(cleanupDevice);

    console.log('[AudioCaptureRenderer] IPC listeners initialized');
  }

  /**
   * Clean up all event listeners
   */
  destroy(): void {
    this.stopCapture();
    this.cleanupFunctions.forEach((fn) => fn());
    this.cleanupFunctions = [];
  }

  /**
   * Get list of available audio input devices
   */
  async getDevices(): Promise<AudioDeviceInfo[]> {
    // First, request permission to enumerate devices with labels
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach((track) => track.stop());
    } catch {
      // Permission denied or no devices - still try to enumerate
      console.warn('[AudioCaptureRenderer] Could not get permission to enumerate devices');
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === 'audioinput');

    return audioInputs.map((device, index) => ({
      id: device.deviceId,
      name: device.label || `Microphone ${index + 1}`,
      isDefault: device.deviceId === 'default',
    }));
  }

  /**
   * Start capturing audio
   */
  async startCapture(): Promise<void> {
    if (this.capturing) {
      console.log('[AudioCaptureRenderer] Already capturing');
      return;
    }

    // Create AudioContext with target sample rate
    this.audioContext = new AudioContext({
      sampleRate: this.config.sampleRate,
    });

    // Get microphone stream
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: this.config.deviceId ? { exact: this.config.deviceId } : undefined,
        sampleRate: { ideal: this.config.sampleRate },
        channelCount: { exact: this.config.channels },
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
      },
      video: false,
    };

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      throw new Error(`Failed to access microphone: ${(error as Error).message}`);
    }

    // Create source node from media stream
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Calculate chunk size in samples
    const chunkSamples = Math.floor(
      (this.config.sampleRate * this.config.chunkDurationMs) / 1000
    );

    // Try AudioWorklet first, fall back to ScriptProcessorNode
    try {
      await this.setupAudioWorklet(chunkSamples);
      console.log('[AudioCaptureRenderer] Capture started with AudioWorklet');
    } catch (workletError) {
      console.warn(
        '[AudioCaptureRenderer] AudioWorklet failed, using ScriptProcessorNode fallback:',
        workletError
      );
      this.setupScriptProcessorFallback(chunkSamples);
      console.log('[AudioCaptureRenderer] Capture started with ScriptProcessorNode');
    }

    this.capturing = true;
  }

  /**
   * Set up AudioWorklet for audio processing
   */
  private async setupAudioWorklet(chunkSamples: number): Promise<void> {
    if (!this.audioContext || !this.sourceNode) {
      throw new Error('AudioContext or source node not initialized');
    }

    // Create Blob URL for the worklet processor
    const blob = new Blob([AUDIO_WORKLET_PROCESSOR], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    try {
      await this.audioContext.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    // Create worklet node
    this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-chunk-processor', {
      processorOptions: {
        chunkSamples,
      },
    });

    // Handle messages from worklet
    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === 'chunk') {
        this.sendChunkToMain(event.data.samples, event.data.timestamp);
      }
    };

    // Connect the audio graph (don't connect to destination - we don't want to hear our own voice)
    this.sourceNode.connect(this.workletNode);
  }

  /**
   * Fallback using deprecated ScriptProcessorNode
   * Used when AudioWorklet is not available (older Electron versions)
   */
  private setupScriptProcessorFallback(chunkSamples: number): void {
    if (!this.audioContext || !this.sourceNode) {
      throw new Error('AudioContext or source node not initialized');
    }

    // Buffer size must be power of 2
    const bufferSize = Math.pow(2, Math.ceil(Math.log2(chunkSamples)));

    // Create script processor (deprecated but still functional)
    this.scriptNode = this.audioContext.createScriptProcessor(
      bufferSize,
      this.config.channels,
      this.config.channels
    );

    const accumulatedSamples: number[] = [];

    this.scriptNode.onaudioprocess = (event) => {
      const inputBuffer = event.inputBuffer.getChannelData(0);

      // Accumulate samples (array is mutated, not reassigned)
      for (let i = 0; i < inputBuffer.length; i++) {
        accumulatedSamples.push(inputBuffer[i]);
      }

      // Send chunks when we have enough
      while (accumulatedSamples.length >= chunkSamples) {
        const chunk = accumulatedSamples.splice(0, chunkSamples);
        this.sendChunkToMain(chunk, performance.now());
      }
    };

    // Connect: source -> scriptProcessor -> destination (required for scriptProcessor to work)
    this.sourceNode.connect(this.scriptNode);
    this.scriptNode.connect(this.audioContext.destination);
  }

  /**
   * Send audio chunk to main process via preload API
   */
  private sendChunkToMain(samples: number[], timestamp: number): void {
    const api = window.feedbackflow;
    if (!api?.audio) {
      console.error('[AudioCaptureRenderer] feedbackflow.audio API not available');
      return;
    }

    api.audio.sendAudioChunk({
      samples: Array.from(samples),
      timestamp,
      duration: this.config.chunkDurationMs,
    });
  }

  /**
   * Stop capturing audio
   */
  stopCapture(): void {
    if (!this.capturing) {
      return;
    }

    // Stop media stream tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    // Disconnect and clean up worklet node
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    // Clean up script processor fallback
    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }

    // Disconnect source node
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.capturing = false;
    console.log('[AudioCaptureRenderer] Capture stopped');
  }

  /**
   * Check if currently capturing
   */
  isCapturing(): boolean {
    return this.capturing;
  }
}

// ============================================================================
// Module Initialization
// ============================================================================

let audioCaptureRenderer: AudioCaptureRenderer | null = null;

/**
 * Initialize the audio capture renderer
 * Call this once when the renderer process starts
 */
export function initAudioCapture(): AudioCaptureRenderer {
  if (!audioCaptureRenderer) {
    audioCaptureRenderer = new AudioCaptureRenderer();
  }
  return audioCaptureRenderer;
}

/**
 * Get the audio capture renderer instance
 */
export function getAudioCapture(): AudioCaptureRenderer | null {
  return audioCaptureRenderer;
}

/**
 * Destroy the audio capture renderer
 */
export function destroyAudioCapture(): void {
  if (audioCaptureRenderer) {
    audioCaptureRenderer.destroy();
    audioCaptureRenderer = null;
  }
}

export { AudioCaptureRenderer };
export default initAudioCapture;
