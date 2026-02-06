/**
 * WhisperService.ts - Local Whisper Transcription (Tier 2)
 *
 * Uses whisper.cpp via whisper-node for on-device transcription.
 * No API key or internet required.
 *
 * Features:
 * - Batch processing of audio chunks
 * - Configurable model and language
 * - Memory-efficient buffer management
 * - Event-based result delivery
 */

import { EventEmitter } from 'events';
import { join } from 'path';
import { app } from 'electron';
import { existsSync } from 'fs';
import * as os from 'os';
import type { WhisperTranscriptResult, WhisperConfig, ErrorCallback } from './types';

// ============================================================================
// Types
// ============================================================================

type TranscriptCallback = (result: WhisperTranscriptResult) => void;

// Whisper-node module type (loaded dynamically)
interface WhisperModule {
  whisper: (
    samples: Float32Array,
    options: {
      modelPath: string;
      language?: string;
      threads?: number;
      translate?: boolean;
    }
  ) => Promise<Array<{ text: string; start: number; end: number }>>;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: WhisperConfig = {
  modelPath: '', // Set dynamically
  language: 'en',
  threads: Math.max(1, Math.floor(os.cpus().length / 2)), // Half CPU cores
  translateToEnglish: false,
};

// Audio buffer configuration
const CHUNK_DURATION_MS = 3000; // Process 3 seconds at a time
const MAX_BUFFER_DURATION_MS = 30000; // Max 30 seconds before force-processing
const MAX_BUFFER_SIZE_BYTES = 500 * 1024; // 500KB cap as per audit

// ============================================================================
// WhisperService Class
// ============================================================================

export class WhisperService extends EventEmitter {
  private config: WhisperConfig;
  private isInitialized: boolean = false;
  private isProcessing: boolean = false;
  private whisperModule: WhisperModule | null = null;

  // Audio buffering for batch processing
  private audioBuffer: Float32Array[] = [];
  private bufferStartTime: number = 0;
  private totalBufferDuration: number = 0;
  private totalBufferBytes: number = 0;

  // Processing state
  private processingInterval: ReturnType<typeof setInterval> | null = null;

  // Callbacks
  private transcriptCallbacks: TranscriptCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];

  constructor(config?: Partial<WhisperConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Set default model path if not specified
    if (!this.config.modelPath) {
      this.config.modelPath = this.getDefaultModelPath();
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Check if Whisper model is available
   */
  isModelAvailable(): boolean {
    return existsSync(this.config.modelPath);
  }

  /**
   * Get the path where models should be stored
   */
  getModelsDirectory(): string {
    try {
      return join(app.getPath('userData'), 'whisper-models');
    } catch {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
      return join(homeDir, '.feedbackflow', 'whisper-models');
    }
  }

  /**
   * Get the default model path (whisper-medium)
   */
  getDefaultModelPath(): string {
    return join(this.getModelsDirectory(), 'ggml-medium.bin');
  }

  /**
   * Set the model path
   */
  setModelPath(modelPath: string): void {
    this.config.modelPath = modelPath;
    this.isInitialized = false; // Need to reinitialize with new model
  }

  /**
   * Check if system has enough memory for Whisper
   * Whisper medium model requires ~2GB RAM
   */
  hasEnoughMemory(): boolean {
    const freeMemory = os.freemem();
    const requiredMemory = 2 * 1024 * 1024 * 1024; // 2GB
    return freeMemory >= requiredMemory;
  }

  /**
   * Get current memory info
   */
  getMemoryInfo(): { freeMemoryMB: number; requiredMemoryMB: number; sufficient: boolean } {
    const freeMemory = os.freemem();
    const requiredMemory = 2 * 1024 * 1024 * 1024;
    return {
      freeMemoryMB: Math.round(freeMemory / 1024 / 1024),
      requiredMemoryMB: 2048,
      sufficient: freeMemory >= requiredMemory,
    };
  }

  /**
   * Initialize the Whisper model
   * Call this once before starting transcription
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (!this.isModelAvailable()) {
      throw new Error(`Whisper model not found at ${this.config.modelPath}. Please download the model first.`);
    }

    if (!this.hasEnoughMemory()) {
      const memInfo = this.getMemoryInfo();
      throw new Error(
        `Insufficient memory for Whisper. Need 2GB free, only ${memInfo.freeMemoryMB}MB available.`
      );
    }

    this.log('Initializing Whisper model...');

    try {
      // Dynamically import whisper-node to avoid startup crashes if not installed
      // @ts-expect-error - whisper-node may not have types
      this.whisperModule = await import('whisper-node');

      // Verify the module loaded correctly
      if (!this.whisperModule || typeof this.whisperModule.whisper !== 'function') {
        throw new Error('whisper-node module loaded but whisper function not found');
      }

      // Do a test transcription with tiny audio to pre-load the model
      this.log('Pre-loading model with test transcription...');
      const testBuffer = new Float32Array(1600); // 16kHz * 0.1s = 100ms of silence

      await this.whisperModule.whisper(testBuffer, {
        modelPath: this.config.modelPath,
        language: this.config.language,
        threads: this.config.threads,
      });

      this.isInitialized = true;
      this.log('Whisper model initialized successfully');
    } catch (error) {
      const initError = new Error(`Failed to initialize Whisper: ${(error as Error).message}`);
      this.errorCallbacks.forEach((cb) => cb(initError));
      throw initError;
    }
  }

  /**
   * Check if service is initialized and ready
   */
  isReady(): boolean {
    return this.isInitialized && this.whisperModule !== null;
  }

  /**
   * Start accepting audio for transcription
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Reset buffer state
    this.audioBuffer = [];
    this.bufferStartTime = Date.now();
    this.totalBufferDuration = 0;
    this.totalBufferBytes = 0;

    // Start periodic processing
    this.processingInterval = setInterval(() => {
      this.processBufferedAudio();
    }, CHUNK_DURATION_MS);

    this.log('Whisper transcription started');
  }

  /**
   * Stop transcription and process remaining audio
   */
  async stop(): Promise<void> {
    // Clear processing interval
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    // Process any remaining audio
    await this.processBufferedAudio(true);

    // Clear buffer
    this.audioBuffer = [];
    this.totalBufferDuration = 0;
    this.totalBufferBytes = 0;

    this.log('Whisper transcription stopped');
  }

  /**
   * Add audio data to the buffer
   * @param samples Float32Array of audio samples at 16kHz mono
   * @param durationMs Duration of this chunk in milliseconds
   */
  addAudio(samples: Float32Array, durationMs: number): void {
    const chunkBytes = samples.byteLength;

    // Enforce buffer size cap (500KB as per audit CRIT-006)
    if (this.totalBufferBytes + chunkBytes > MAX_BUFFER_SIZE_BYTES) {
      this.log('Audio buffer full, force-processing before adding new audio');
      this.processBufferedAudio(true);
    }

    this.audioBuffer.push(samples);
    this.totalBufferDuration += durationMs;
    this.totalBufferBytes += chunkBytes;

    // Force process if buffer duration is too long
    if (this.totalBufferDuration >= MAX_BUFFER_DURATION_MS) {
      this.processBufferedAudio(true);
    }
  }

  /**
   * Register callback for transcript results
   */
  onTranscript(callback: TranscriptCallback): () => void {
    this.transcriptCallbacks.push(callback);
    return () => {
      this.transcriptCallbacks = this.transcriptCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Register callback for errors
   */
  onError(callback: ErrorCallback): () => void {
    this.errorCallbacks.push(callback);
    return () => {
      this.errorCallbacks = this.errorCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): WhisperConfig {
    return { ...this.config };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Process buffered audio through Whisper
   */
  private async processBufferedAudio(force: boolean = false): Promise<void> {
    // Skip if already processing or buffer is too small (unless forced)
    if (this.isProcessing) {
      return;
    }

    if (!force && this.totalBufferDuration < CHUNK_DURATION_MS) {
      return;
    }

    if (this.audioBuffer.length === 0) {
      return;
    }

    if (!this.whisperModule) {
      this.logError('Cannot process: Whisper module not loaded');
      return;
    }

    this.isProcessing = true;
    const processStartTime = this.bufferStartTime;

    try {
      // Concatenate all buffered audio into a single array
      const totalSamples = this.audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
      const combinedAudio = new Float32Array(totalSamples);

      let offset = 0;
      for (const chunk of this.audioBuffer) {
        combinedAudio.set(chunk, offset);
        offset += chunk.length;
      }

      // Clear buffer before processing (to accept new audio while processing)
      const processedDuration = this.totalBufferDuration;
      this.audioBuffer = [];
      this.totalBufferDuration = 0;
      this.totalBufferBytes = 0;
      this.bufferStartTime = Date.now();

      // Run Whisper transcription
      this.log(`Processing ${Math.round(processedDuration)}ms of audio...`);

      const result = await this.whisperModule.whisper(combinedAudio, {
        modelPath: this.config.modelPath,
        language: this.config.language,
        threads: this.config.threads,
        translate: this.config.translateToEnglish,
      });

      // Parse result and emit transcript
      if (result && result.length > 0) {
        for (const segment of result) {
          const transcriptResult: WhisperTranscriptResult = {
            text: segment.text.trim(),
            startTime: processStartTime / 1000 + segment.start,
            endTime: processStartTime / 1000 + segment.end,
            confidence: 0.9, // Whisper doesn't provide confidence, use default
          };

          if (transcriptResult.text) {
            this.transcriptCallbacks.forEach((cb) => cb(transcriptResult));
            this.emit('transcript', transcriptResult);

            const preview =
              transcriptResult.text.length > 50
                ? `${transcriptResult.text.substring(0, 50)}...`
                : transcriptResult.text;
            this.log(`Transcript: "${preview}"`);
          }
        }
      }
    } catch (error) {
      const transcriptionError = new Error(`Whisper transcription failed: ${(error as Error).message}`);
      this.errorCallbacks.forEach((cb) => cb(transcriptionError));
      this.emit('error', transcriptionError);
      this.logError('Transcription error', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Log helper
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    console.log(`[WhisperService ${timestamp}] ${message}`);
  }

  /**
   * Error log helper
   */
  private logError(message: string, error?: unknown): void {
    const timestamp = new Date().toISOString();
    const errorStr = error instanceof Error ? error.message : String(error);
    console.error(`[WhisperService ${timestamp}] ERROR: ${message} - ${errorStr}`);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const whisperService = new WhisperService();
export default WhisperService;
