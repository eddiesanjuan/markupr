/**
 * TranscriptionService - Real-time streaming transcription via Deepgram WebSocket API
 *
 * Features:
 * - Real-time WebSocket streaming with Deepgram nova-3 model
 * - Pause detection via utterance_end_ms (triggers screenshots)
 * - Smart formatting and punctuation
 * - Exponential backoff reconnection on network failures
 * - Audio buffering during reconnection attempts
 * - Comprehensive event handling and logging
 */

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import type { DeepgramClient, LiveClient } from '@deepgram/sdk';
import { errorHandler } from '../ErrorHandler';

// ============================================================================
// Types
// ============================================================================

export interface AudioChunk {
  data: ArrayBufferLike | Buffer;
  timestamp: number;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

export interface TranscriptResult {
  text: string;
  isFinal: boolean;
  confidence: number;
  timestamp: number;
  words?: TranscriptWord[];
}

export interface TranscriptionServiceConfig {
  model: string;
  language: string;
  smart_format: boolean;
  punctuate: boolean;
  utterance_end_ms: number;
  interim_results: boolean;
  encoding: string;
  sample_rate: number;
  channels: number;
}

export interface ApiKeyValidationResult {
  valid: boolean;
  reason?: string;
}

export interface PrerecordedTranscriptSegment {
  text: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

type TranscriptCallback = (result: TranscriptResult) => void;
type UtteranceEndCallback = (timestamp: number) => void;
type ErrorCallback = (error: Error) => void;
type ConnectionCallback = () => void;

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: TranscriptionServiceConfig = {
  model: 'nova-3',
  language: 'en-US',
  smart_format: true,
  punctuate: true,
  utterance_end_ms: 1200, // Pause detection threshold - KEY for screenshot triggers
  interim_results: true,
  encoding: 'linear16',
  sample_rate: 16000,
  channels: 1,
};

const RECONNECT_CONFIG = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

const KEEPALIVE_INTERVAL_MS = 8000;
const MAX_BUFFER_SIZE = 100; // Max audio chunks to buffer during reconnection

// ============================================================================
// TranscriptionService Class
// ============================================================================

export class TranscriptionService {
  private apiKey: string = '';
  private config: TranscriptionServiceConfig = { ...DEFAULT_CONFIG };
  private client: DeepgramClient | null = null;
  private connection: LiveClient | null = null;

  // Connection state
  private _isConnected: boolean = false;
  private isConnecting: boolean = false;
  private shouldReconnect: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  // Keepalive
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null;

  // Audio buffering during reconnection
  private audioBuffer: AudioChunk[] = [];
  private isBuffering: boolean = false;

  // Event callbacks
  private transcriptCallbacks: TranscriptCallback[] = [];
  private utteranceEndCallbacks: UtteranceEndCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];
  private connectionCallbacks: ConnectionCallback[] = [];
  private disconnectionCallbacks: ConnectionCallback[] = [];

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Configure the service with Deepgram API key
   *
   * Note: API key is now optional at the app level since TierManager handles
   * tier selection. If no key is provided, Deepgram tier will be unavailable
   * and the app will use local Whisper instead.
   */
  configure(apiKey: string, config?: Partial<TranscriptionServiceConfig>): void {
    if (!apiKey || apiKey.trim() === '') {
      // Don't throw - TierManager handles tier selection
      // Just log and return without configuring
      errorHandler.log('info', 'Deepgram API key not provided, service not configured', {
        component: 'TranscriptionService',
        operation: 'configure',
        data: { reason: 'No API key - will use local transcription' },
      });
      return;
    }

    this.apiKey = apiKey.trim();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.client = createClient(this.apiKey);

    errorHandler.log('info', 'Transcription service configured', {
      component: 'TranscriptionService',
      operation: 'configure',
      data: { model: this.config.model, language: this.config.language },
    });
  }

  /**
   * Check if the service is configured with an API key
   */
  isConfigured(): boolean {
    return this.client !== null && this.apiKey !== '';
  }

  /**
   * Validate a Deepgram API key against the Manage API.
   */
  async validateApiKey(apiKey: string, timeoutMs: number = 5000): Promise<ApiKeyValidationResult> {
    const normalizedKey = apiKey.trim();
    if (!normalizedKey) {
      return { valid: false, reason: 'No API key configured' };
    }

    if (normalizedKey.length < 20) {
      return { valid: false, reason: 'API key format looks invalid' };
    }

    try {
      const client = createClient(normalizedKey);
      const response = await this.withTimeout(
        client.manage.getProjects(),
        timeoutMs,
        'Deepgram API key validation timed out'
      );

      if (response.error) {
        const manageError = this.formatDeepgramError(response.error);

        // Some keys may lack Manage API scope while still being valid for listen APIs.
        // Probe the prerecorded endpoint before declaring the key invalid.
        if (this.isScopeRestrictionError(manageError)) {
          return this.probeListenApi(client, timeoutMs);
        }

        return { valid: false, reason: manageError };
      }

      const projects = (response.result as { projects?: unknown[] } | null)?.projects;
      if (!Array.isArray(projects)) {
        return {
          valid: false,
          reason: 'Deepgram validation returned an unexpected response',
        };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, reason: this.normalizeError(error).message };
    }
  }

  /**
   * Transcribe a full recorded audio buffer using Deepgram prerecorded API.
   */
  async transcribePrerecordedAudio(
    audioBuffer: Buffer,
    options: {
      apiKey?: string;
      timeoutMs?: number;
      model?: string;
      language?: string;
      smartFormat?: boolean;
      punctuate?: boolean;
    } = {}
  ): Promise<PrerecordedTranscriptSegment[]> {
    if (!audioBuffer || audioBuffer.byteLength === 0) {
      return [];
    }

    const resolvedApiKey = options.apiKey?.trim() || this.apiKey;
    if (!resolvedApiKey) {
      throw new Error('Deepgram API key not configured');
    }

    const client = this.client && this.apiKey === resolvedApiKey ? this.client : createClient(resolvedApiKey);
    const timeoutMs = options.timeoutMs ?? 60000;

    const response = await this.withTimeout(
      client.listen.prerecorded.transcribeFile(audioBuffer, {
        model: options.model ?? this.config.model,
        language: options.language ?? this.config.language,
        smart_format: options.smartFormat ?? true,
        punctuate: options.punctuate ?? true,
        utterances: true,
      }),
      timeoutMs,
      'Deepgram prerecorded transcription timed out'
    );

    if (response.error) {
      throw new Error(`Deepgram prerecorded transcription failed: ${this.formatDeepgramError(response.error)}`);
    }

    return this.parsePrerecordedSegments(response.result);
  }

  /**
   * Start the transcription connection
   */
  async start(): Promise<void> {
    if (this._isConnected || this.isConnecting) {
      this.log('Already connected or connecting, skipping start');
      return;
    }

    if (!this.client) {
      throw new Error('Service not configured. Call configure() with API key first.');
    }

    this.shouldReconnect = true;
    await this.connect();
  }

  /**
   * Stop the transcription connection
   */
  stop(): void {
    this.log('Stopping transcription service');
    this.shouldReconnect = false;
    this.clearReconnectTimeout();
    this.stopKeepalive();
    this.clearBuffer();
    this.disconnect();
  }

  /**
   * Send audio chunk to Deepgram
   */
  sendAudio(chunk: AudioChunk): void {
    // If we're reconnecting, buffer the audio
    if (this.isBuffering || !this._isConnected) {
      this.bufferAudio(chunk);
      return;
    }

    if (!this.connection) {
      this.logError('Cannot send audio: no active connection');
      return;
    }

    try {
      // Convert Buffer to ArrayBuffer if needed for Deepgram SDK compatibility
      const audioData = this.toArrayBufferLike(chunk.data);
      this.connection.send(audioData);
    } catch (error) {
      this.logError('Error sending audio', error);
      this.bufferAudio(chunk);
      this.handleConnectionLoss();
    }
  }

  /**
   * Check if connected to Deepgram
   */
  isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Get current configuration
   */
  getConfig(): TranscriptionServiceConfig {
    return { ...this.config };
  }

  // ============================================================================
  // Event Registration
  // ============================================================================

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
   * Register callback for utterance end events (KEY - triggers screenshots)
   */
  onUtteranceEnd(callback: UtteranceEndCallback): () => void {
    this.utteranceEndCallbacks.push(callback);
    return () => {
      this.utteranceEndCallbacks = this.utteranceEndCallbacks.filter((cb) => cb !== callback);
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
   * Register callback for connection established
   */
  onConnection(callback: ConnectionCallback): () => void {
    this.connectionCallbacks.push(callback);
    return () => {
      this.connectionCallbacks = this.connectionCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Register callback for disconnection
   */
  onDisconnection(callback: ConnectionCallback): () => void {
    this.disconnectionCallbacks.push(callback);
    return () => {
      this.disconnectionCallbacks = this.disconnectionCallbacks.filter((cb) => cb !== callback);
    };
  }

  // ============================================================================
  // Private: Connection Management
  // ============================================================================

  private async connect(): Promise<void> {
    if (!this.client) {
      throw new Error('Client not initialized');
    }

    this.isConnecting = true;
    this.log('Connecting to Deepgram...');

    try {
      this.connection = this.client.listen.live({
        model: this.config.model,
        language: this.config.language,
        smart_format: this.config.smart_format,
        punctuate: this.config.punctuate,
        utterance_end_ms: this.config.utterance_end_ms,
        interim_results: this.config.interim_results,
        encoding: this.config.encoding,
        sample_rate: this.config.sample_rate,
        channels: this.config.channels,
      });

      this.setupEventHandlers();
    } catch (error) {
      this.isConnecting = false;
      this.handleConnectionError(error);
    }
  }

  private setupEventHandlers(): void {
    if (!this.connection) return;

    // Connection opened
    this.connection.on(LiveTranscriptionEvents.Open, () => {
      this.log('WebSocket connection opened');
      this._isConnected = true;
      this.isConnecting = false;
      this.reconnectAttempts = 0;

      // Start keepalive
      this.startKeepalive();

      // Flush buffered audio
      this.flushBuffer();

      // Notify listeners
      this.connectionCallbacks.forEach((cb) => cb());
    });

    // Transcription results
    this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      this.handleTranscriptResult(data);
    });

    // Utterance end - KEY EVENT for screenshot triggers
    this.connection.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
      const timestamp = data?.last_word_end ?? Date.now() / 1000;
      this.log('Utterance ended', { timestamp });
      this.utteranceEndCallbacks.forEach((cb) => cb(timestamp));
    });

    // Speech started (for logging/debugging)
    this.connection.on(LiveTranscriptionEvents.SpeechStarted, (data) => {
      this.log('Speech detected', { timestamp: data?.timestamp });
    });

    // Error handling
    this.connection.on(LiveTranscriptionEvents.Error, (error) => {
      this.logError('WebSocket error', error);
      this.handleConnectionError(error);
    });

    // Connection closed
    this.connection.on(LiveTranscriptionEvents.Close, () => {
      this.log('WebSocket connection closed');
      this.handleConnectionClosed();
    });
  }

  private handleTranscriptResult(data: unknown): void {
    // Type guard for Deepgram response
    const response = data as {
      channel?: {
        alternatives?: Array<{
          transcript?: string;
          confidence?: number;
          words?: Array<{
            word: string;
            start: number;
            end: number;
            confidence: number;
          }>;
        }>;
      };
      is_final?: boolean;
      start?: number;
    };

    const alternative = response.channel?.alternatives?.[0];
    if (!alternative?.transcript) {
      return; // Empty transcript, skip
    }

    const result: TranscriptResult = {
      text: alternative.transcript,
      isFinal: response.is_final ?? false,
      confidence: alternative.confidence ?? 0,
      timestamp: response.start ?? Date.now() / 1000,
      words: alternative.words?.map((w) => ({
        word: w.word,
        start: w.start,
        end: w.end,
        confidence: w.confidence,
      })),
    };

    this.log(result.isFinal ? 'Final transcript' : 'Interim transcript', {
      text: result.text.substring(0, 50) + (result.text.length > 50 ? '...' : ''),
      confidence: result.confidence,
    });

    this.transcriptCallbacks.forEach((cb) => cb(result));
  }

  private disconnect(): void {
    this.stopKeepalive();

    if (this.connection) {
      try {
        this.connection.requestClose();
      } catch (error) {
        this.logError('Error during disconnect', error);
      }
      this.connection = null;
    }

    this._isConnected = false;
    this.isConnecting = false;
  }

  private handleConnectionClosed(): void {
    const wasConnected = this._isConnected;
    this._isConnected = false;
    this.isConnecting = false;
    this.stopKeepalive();

    if (wasConnected) {
      this.disconnectionCallbacks.forEach((cb) => cb());
    }

    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  private handleConnectionLoss(): void {
    if (!this._isConnected) return;

    this.log('Connection loss detected, starting buffer mode');
    this.isBuffering = true;
    this._isConnected = false;

    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  private handleConnectionError(error: unknown): void {
    const errorObj = this.normalizeError(error);
    const context = {
      component: 'TranscriptionService',
      operation: 'connection',
      data: { reconnectAttempts: this.reconnectAttempts },
    };

    // Check for specific error types
    if (this.isAuthError(errorObj)) {
      errorHandler.handleApiKeyError(errorObj);
      this.shouldReconnect = false;
      this.errorCallbacks.forEach((cb) => cb(errorObj));
      return;
    }

    if (this.isRateLimitError(errorObj)) {
      errorHandler.log('warn', 'Rate limited by Deepgram', context);
      errorHandler.notifyUser('Rate Limited', 'Too many requests. Please wait a moment.');
      // Increase backoff for rate limits
      this.reconnectAttempts = Math.max(this.reconnectAttempts, 3);
    }

    // Handle as network/transcription error
    errorHandler.handleTranscriptionError(errorObj, context);
    this.errorCallbacks.forEach((cb) => cb(errorObj));

    if (this.shouldReconnect && !this.isConnecting) {
      this.scheduleReconnect();
    }
  }

  // ============================================================================
  // Private: Reconnection with Exponential Backoff
  // ============================================================================

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= RECONNECT_CONFIG.maxAttempts) {
      const maxRetriesError = new Error(
        'Unable to connect to Deepgram after multiple attempts. Please check your network connection.'
      );
      errorHandler.log('error', 'Max reconnection attempts reached', {
        component: 'TranscriptionService',
        operation: 'reconnect',
        data: { maxAttempts: RECONNECT_CONFIG.maxAttempts },
      });
      errorHandler.notifyUser(
        'Connection Failed',
        'Could not connect to transcription service. Please check your internet connection.'
      );
      this.errorCallbacks.forEach((cb) => cb(maxRetriesError));
      this.shouldReconnect = false;
      return;
    }

    this.isBuffering = true;
    const delay = this.calculateBackoffDelay();
    this.reconnectAttempts++;

    errorHandler.log('info', `Scheduling reconnect attempt ${this.reconnectAttempts}/${RECONNECT_CONFIG.maxAttempts}`, {
      component: 'TranscriptionService',
      operation: 'reconnect',
      data: { attempt: this.reconnectAttempts, delayMs: delay },
    });

    this.clearReconnectTimeout();
    this.reconnectTimeout = setTimeout(async () => {
      if (this.shouldReconnect) {
        try {
          await this.connect();
        } catch (error) {
          this.handleConnectionError(error);
        }
      }
    }, delay);
  }

  private calculateBackoffDelay(): number {
    const delay =
      RECONNECT_CONFIG.baseDelayMs *
      Math.pow(RECONNECT_CONFIG.backoffMultiplier, this.reconnectAttempts);
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.3 * delay;
    return Math.min(delay + jitter, RECONNECT_CONFIG.maxDelayMs);
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  // ============================================================================
  // Private: Keepalive
  // ============================================================================

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveInterval = setInterval(() => {
      if (this.connection && this._isConnected) {
        try {
          this.connection.keepAlive();
          this.log('Keepalive sent');
        } catch (error) {
          this.logError('Keepalive failed', error);
          this.handleConnectionLoss();
        }
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  // ============================================================================
  // Private: Audio Buffering
  // ============================================================================

  private bufferAudio(chunk: AudioChunk): void {
    if (this.audioBuffer.length >= MAX_BUFFER_SIZE) {
      // Remove oldest chunk to make room
      this.audioBuffer.shift();
      this.log('Audio buffer full, dropping oldest chunk');
    }
    this.audioBuffer.push(chunk);
  }

  private flushBuffer(): void {
    if (this.audioBuffer.length === 0) {
      this.isBuffering = false;
      return;
    }

    this.log(`Flushing ${this.audioBuffer.length} buffered audio chunks`);

    const buffered = [...this.audioBuffer];
    this.audioBuffer = [];
    this.isBuffering = false;

    // Send buffered audio
    for (const chunk of buffered) {
      if (this.connection && this._isConnected) {
        try {
          const audioData = this.toArrayBufferLike(chunk.data);
          this.connection.send(audioData);
        } catch (error) {
          this.logError('Error flushing buffered audio', error);
          // Re-buffer remaining chunks
          this.audioBuffer = buffered.slice(buffered.indexOf(chunk));
          this.isBuffering = true;
          this.handleConnectionLoss();
          return;
        }
      }
    }
  }

  private clearBuffer(): void {
    this.audioBuffer = [];
    this.isBuffering = false;
  }

  // ============================================================================
  // Private: Error Helpers
  // ============================================================================

  /**
   * Convert Buffer or ArrayBuffer to ArrayBufferLike for Deepgram SDK compatibility
   */
  private toArrayBufferLike(data: ArrayBufferLike | Buffer): ArrayBufferLike {
    if (Buffer.isBuffer(data)) {
      // Convert Node.js Buffer to ArrayBuffer
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    }
    return data;
  }

  private parsePrerecordedSegments(result: unknown): PrerecordedTranscriptSegment[] {
    const payload = result as {
      results?: {
        utterances?: Array<{
          transcript?: string;
          start?: number;
          end?: number;
          confidence?: number;
        }>;
        channels?: Array<{
          alternatives?: Array<{
            transcript?: string;
            confidence?: number;
            words?: Array<{ start?: number; end?: number }>;
          }>;
        }>;
      };
    };

    const utterances = payload.results?.utterances;
    if (Array.isArray(utterances) && utterances.length > 0) {
      return utterances
        .map((utterance) => ({
          text: (utterance.transcript ?? '').trim(),
          startTime: typeof utterance.start === 'number' ? utterance.start : 0,
          endTime: typeof utterance.end === 'number' ? utterance.end : 0,
          confidence: typeof utterance.confidence === 'number' ? utterance.confidence : 0.85,
        }))
        .filter((segment) => segment.text.length > 0);
    }

    const alternative = payload.results?.channels?.[0]?.alternatives?.[0];
    if (!alternative?.transcript?.trim()) {
      return [];
    }

    const words = Array.isArray(alternative.words) ? alternative.words : [];
    const firstWord = words[0];
    const lastWord = words[words.length - 1];
    const startTime = typeof firstWord?.start === 'number' ? firstWord.start : 0;
    const endTime = typeof lastWord?.end === 'number' ? lastWord.end : startTime;

    return [
      {
        text: alternative.transcript.trim(),
        startTime,
        endTime,
        confidence: typeof alternative.confidence === 'number' ? alternative.confidence : 0.85,
      },
    ];
  }

  private formatDeepgramError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (typeof error === 'object' && error !== null) {
      const maybeMessage = (error as { message?: unknown }).message;
      if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) {
        return maybeMessage;
      }
      try {
        return JSON.stringify(error);
      } catch {
        return String(error);
      }
    }
    return String(error);
  }

  private isScopeRestrictionError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('forbidden') ||
      normalized.includes('permission') ||
      normalized.includes('scope') ||
      normalized.includes('not allowed')
    );
  }

  private async probeListenApi(
    client: DeepgramClient,
    timeoutMs: number
  ): Promise<ApiKeyValidationResult> {
    try {
      const probeAudio = this.buildSilentPcm16Wav(16000, 0.2);
      const response = await this.withTimeout(
        client.listen.prerecorded.transcribeFile(probeAudio, {
          model: this.config.model,
          language: this.config.language,
          punctuate: false,
          smart_format: false,
        }),
        timeoutMs,
        'Deepgram listen API probe timed out'
      );

      if (response.error) {
        return { valid: false, reason: this.formatDeepgramError(response.error) };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, reason: this.normalizeError(error).message };
    }
  }

  private buildSilentPcm16Wav(sampleRate: number, durationSeconds: number): Buffer {
    const sampleCount = Math.max(1, Math.floor(sampleRate * durationSeconds));
    const bytesPerSample = 2;
    const channels = 1;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = sampleCount * bytesPerSample;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0, 'ascii');
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8, 'ascii');
    buffer.write('fmt ', 12, 'ascii');
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36, 'ascii');
    buffer.writeUInt32LE(dataSize, 40);

    return buffer;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    if (typeof error === 'string') {
      return new Error(error);
    }
    if (typeof error === 'object' && error !== null) {
      const errorObj = error as Record<string, unknown>;
      return new Error(errorObj.message?.toString() ?? JSON.stringify(error));
    }
    return new Error('Unknown error occurred');
  }

  private isAuthError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('401') ||
      message.includes('unauthorized') ||
      message.includes('invalid api key') ||
      message.includes('authentication')
    );
  }

  private isRateLimitError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return message.includes('429') || message.includes('rate limit') || message.includes('too many');
  }

  // ============================================================================
  // Private: Logging
  // ============================================================================

  private log(message: string, data?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    console.log(`[TranscriptionService ${timestamp}] ${message}${dataStr}`);
  }

  private logError(message: string, error?: unknown): void {
    const timestamp = new Date().toISOString();
    const errorStr = error instanceof Error ? error.message : error ? String(error) : '';
    console.error(`[TranscriptionService ${timestamp}] ERROR: ${message}${errorStr ? ` - ${errorStr}` : ''}`);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const transcriptionService = new TranscriptionService();
export default TranscriptionService;
