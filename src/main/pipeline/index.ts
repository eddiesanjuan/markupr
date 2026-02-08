/**
 * Pipeline Module - Post-Processing Pipeline
 *
 * After recording stops, this pipeline:
 *   1. Transcribes audio via WhisperService (batch mode)
 *   2. Analyzes transcript for key moments (heuristic-based)
 *   3. Extracts video frames at those timestamps (via ffmpeg)
 *   4. Returns structured data for markdown report generation
 */

// ============================================================================
// Classes & Singletons
// ============================================================================

export { PostProcessor, postProcessor } from './PostProcessor';
export { FrameExtractor, frameExtractor } from './FrameExtractor';
export { TranscriptAnalyzer, transcriptAnalyzer } from './TranscriptAnalyzer';

// ============================================================================
// Types
// ============================================================================

export type {
  PostProcessResult,
  TranscriptSegment,
  ExtractedFrame,
  PostProcessProgress,
  PostProcessOptions,
} from './PostProcessor';

export type {
  FrameExtractionRequest,
  FrameExtractionResult,
} from './FrameExtractor';

export type { KeyMoment } from './TranscriptAnalyzer';
