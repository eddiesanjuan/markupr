/**
 * Transcription Module
 *
 * Three-Tier Transcription System:
 * - Tier 1: Deepgram (cloud, optional, best quality)
 * - Tier 2: Local Whisper (default)
 * - Tier 3: macOS Dictation (fallback)
 * - Tier 4: Timer-only (emergency)
 *
 * The TierManager orchestrates tier selection and failover.
 * App works WITHOUT any API keys using local Whisper.
 */

// ============================================================================
// Primary API - TierManager (use this for transcription)
// ============================================================================

export { TierManager, tierManager } from './TierManager';

// ============================================================================
// Supporting Services
// ============================================================================

// Deepgram (Tier 1)
export {
  TranscriptionService,
  transcriptionService,
  type AudioChunk,
  type TranscriptResult,
  type TranscriptWord,
  type TranscriptionServiceConfig,
} from './TranscriptionService';

// Whisper (Tier 2)
export { WhisperService, whisperService } from './WhisperService';

// Silence Detection (for non-Deepgram tiers)
export { SilenceDetector, silenceDetector } from './SilenceDetector';

// Model Management
export { ModelDownloadManager, modelDownloadManager } from './ModelDownloadManager';

// ============================================================================
// Types
// ============================================================================

export type {
  // Tier types
  TranscriptionTier,
  WhisperModel,
  TierStatus,
  TierQuality,
  // Event types
  TranscriptEvent,
  PauseEvent,
  WhisperTranscriptResult,
  WhisperConfig,
  // Model types
  ModelInfo,
  DownloadProgress,
  DownloadResult,
  // Silence detection
  SilenceDetectorConfig,
  // Callbacks
  TranscriptCallback,
  PauseCallback,
  TierChangeCallback,
  ErrorCallback,
  ProgressCallback,
  CompleteCallback,
  SilenceCallback,
} from './types';

// Re-export types from shared for convenience
export type { TranscriptionSegment } from '../../shared/types';
