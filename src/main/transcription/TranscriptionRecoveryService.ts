/**
 * TranscriptionRecoveryService
 *
 * Handles post-session transcription recovery when live transcription
 * produces no output. Tries OpenAI Whisper-1 API first, then falls back
 * to local Whisper. Extracted from SessionController for separation of concerns.
 */

import type { CapturedAudioAsset } from '../audio/AudioCapture';
import { extensionFromMimeType } from '../audio/audioUtils';
import { getSettingsManager } from '../settings';
import { whisperService } from './WhisperService';
import type { TranscriptEvent } from './types';

// =============================================================================
// Configuration
// =============================================================================

const WHISPER_RECOVERY_CHUNK_SECONDS = 30;
const MAX_POST_SESSION_LOCAL_RECOVERY_DURATION_SEC = 8 * 60;

// =============================================================================
// Types
// =============================================================================

/**
 * Audio data needed for recovery.
 * Provided by the SessionController from its audio capture service.
 */
export interface RecoveryAudioData {
  /** Encoded audio asset (webm/ogg/mp4). Used by OpenAI API. */
  capturedAudioAsset: CapturedAudioAsset | null;
  /** Raw PCM Float32 buffer. Used by local Whisper. */
  capturedAudioBuffer: Buffer | null;
}

// =============================================================================
// Pure Helper Functions
// =============================================================================

/**
 * Normalize a transcript timestamp to epoch seconds.
 * Relative offsets (< 1 day) are rebased to session start.
 */
export function normalizeTranscriptTimestamp(timestamp: number, sessionStartSec: number): number {
  if (timestamp < 86_400) {
    return sessionStartSec + Math.max(0, timestamp);
  }
  if (timestamp < sessionStartSec - 60) {
    return sessionStartSec + Math.max(0, timestamp);
  }
  return timestamp;
}

/**
 * Extract a user-friendly error message from an OpenAI API error response.
 */
async function extractOpenAiError(response: Response): Promise<string> {
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

/**
 * Read the OpenAI API key from secure storage.
 */
async function getOpenAIApiKey(): Promise<string | null> {
  try {
    const settings = getSettingsManager();
    const apiKey = await settings.getApiKey('openai');
    const normalized = apiKey?.trim();
    return normalized && normalized.length > 0 ? normalized : null;
  } catch (error) {
    console.warn('[TranscriptionRecovery] Failed to read OpenAI API key:', error);
    return null;
  }
}

// =============================================================================
// Recovery Strategies
// =============================================================================

/**
 * Recover transcript via OpenAI Whisper-1 API from an encoded audio asset.
 */
async function recoverWithOpenAI(
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
        const extension = extensionFromMimeType(audioAsset.mimeType);
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
          const detail = await extractOpenAiError(response);
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
            const normalizedTimestamp = normalizeTranscriptTimestamp(sessionStartSec + start, sessionStartSec);
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
            timestamp: normalizeTranscriptTimestamp(sessionStartSec, sessionStartSec),
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
        `[TranscriptionRecovery] Recovered ${recoveredEvents.length} segments via OpenAI (attempt ${attempt}/${maxAttempts}).`,
      );
      return recoveredEvents;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[TranscriptionRecovery] OpenAI recovery attempt ${attempt}/${maxAttempts} failed: ${message}`,
      );

      if (attempt < maxAttempts) {
        const delayMs = 500 * attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  return [];
}

/**
 * Recover transcript via local Whisper from raw PCM audio samples.
 */
async function recoverWithWhisper(
  audioSamples: Float32Array,
  sessionStartSec: number,
  maxAttempts: number,
): Promise<TranscriptEvent[]> {
  const sampleRate = 16000;
  const chunkSamples = sampleRate * WHISPER_RECOVERY_CHUNK_SECONDS;

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
          isFinal: true as const,
          confidence: segment.confidence,
          timestamp: normalizeTranscriptTimestamp(segment.startTime, sessionStartSec),
          tier: 'whisper' as const,
        }))
        .filter((segment) => segment.text.trim().length > 0);

      if (recoveredEvents.length === 0) {
        throw new Error('No transcript text recovered from captured audio');
      }

      console.log(
        `[TranscriptionRecovery] Recovered ${recoveredEvents.length} segments via Whisper (attempt ${attempt}/${maxAttempts}).`,
      );
      return recoveredEvents;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[TranscriptionRecovery] Whisper recovery attempt ${attempt}/${maxAttempts} failed: ${message}`,
      );

      if (attempt < maxAttempts) {
        const delayMs = 400 * attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  return [];
}

// =============================================================================
// Main Recovery Orchestrator
// =============================================================================

/**
 * Run post-session transcription recovery.
 *
 * Attempts OpenAI API first, then falls back to local Whisper.
 * Returns recovered transcript events, or an empty array if all strategies fail.
 *
 * @param sessionStartSec - Session start time in epoch seconds
 * @param audioData - Audio data from the capture service
 * @returns Recovered transcript events (may be empty)
 */
export async function recoverTranscript(
  sessionStartSec: number,
  audioData: RecoveryAudioData,
): Promise<TranscriptEvent[]> {
  // Try OpenAI first (best quality)
  if (audioData.capturedAudioAsset && audioData.capturedAudioAsset.buffer.byteLength > 0) {
    const openAiApiKey = await getOpenAIApiKey();
    if (openAiApiKey) {
      const openAiRecovered = await recoverWithOpenAI(
        audioData.capturedAudioAsset,
        sessionStartSec,
        openAiApiKey,
        2,
      );
      if (openAiRecovered.length > 0) {
        return openAiRecovered;
      }
    } else {
      console.warn('[TranscriptionRecovery] OpenAI recovery skipped: API key not configured.');
    }
  } else {
    console.warn('[TranscriptionRecovery] OpenAI recovery skipped: no captured audio asset.');
  }

  // Fall back to local Whisper (raw PCM only)
  if (!audioData.capturedAudioBuffer || audioData.capturedAudioBuffer.byteLength === 0) {
    console.warn('[TranscriptionRecovery] Whisper recovery skipped: captured audio is encoded-only.');
    return [];
  }

  const audioSamples = new Float32Array(
    audioData.capturedAudioBuffer.buffer,
    audioData.capturedAudioBuffer.byteOffset,
    audioData.capturedAudioBuffer.byteLength / 4,
  );
  if (audioSamples.length === 0) {
    return [];
  }

  const audioDurationSec = audioSamples.length / 16000;
  if (audioDurationSec > MAX_POST_SESSION_LOCAL_RECOVERY_DURATION_SEC) {
    console.warn(
      `[TranscriptionRecovery] Whisper recovery skipped for long session (${Math.round(audioDurationSec)}s).`,
    );
    return [];
  }

  if (!whisperService.isModelAvailable()) {
    console.warn('[TranscriptionRecovery] Whisper recovery skipped: no local model available.');
    return [];
  }

  const whisperRecovered = await recoverWithWhisper(audioSamples, sessionStartSec, 3);
  if (whisperRecovered.length > 0) {
    return whisperRecovered;
  }

  console.warn('[TranscriptionRecovery] All recovery strategies exhausted without transcript output.');
  return [];
}
