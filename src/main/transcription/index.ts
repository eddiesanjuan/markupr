/**
 * Transcription Module
 *
 * Transcription Tiers (post-process architecture):
 * - Tier 1: Local Whisper (default, post-session batch)
 * - Tier 2: Timer-only (fallback, no transcription)
 *
 * The TierManager tracks tier availability for the UI.
 * App works WITHOUT any API keys using local Whisper.
 */

// ============================================================================
// Primary API - TierManager (use this for transcription)
// ============================================================================

export { TierManager, tierManager } from './TierManager';

// ============================================================================
// Supporting Services
// ============================================================================
// Whisper (Tier 1)
export { WhisperService, whisperService } from './WhisperService';

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
  // Callbacks
  TranscriptCallback,
  PauseCallback,
  TierChangeCallback,
  ErrorCallback,
  ProgressCallback,
  CompleteCallback,
} from './types';

// Re-export types from shared for convenience
export type { TranscriptionSegment } from '../../shared/types';
