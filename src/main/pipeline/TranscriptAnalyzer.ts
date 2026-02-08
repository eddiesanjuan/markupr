/**
 * TranscriptAnalyzer.ts - Heuristic Key Moment Detection
 *
 * Analyzes transcript segments to identify moments where video frames
 * should be extracted. Uses local heuristics (no AI required):
 *
 * - Natural pauses > 1.5s between segments
 * - Periodic baseline captures every 15-20 seconds
 * - Session start and end always included
 *
 * Part of the post-processing pipeline that runs after recording stops.
 */

import type { TranscriptSegment } from './PostProcessor';

// ============================================================================
// Types
// ============================================================================

export interface KeyMoment {
  timestamp: number; // seconds from start of recording
  reason: string; // human-readable reason for selection
  confidence: number; // 0-1
}

// ============================================================================
// Constants
// ============================================================================

/** Minimum gap between segments to count as a natural pause */
const PAUSE_THRESHOLD_SECONDS = 1.5;

/** Baseline periodic capture interval when no pauses are found */
const PERIODIC_INTERVAL_SECONDS = 15;

/** Maximum periodic interval to avoid sparse captures */
const MAX_PERIODIC_INTERVAL_SECONDS = 20;

/** Hard cap on returned key moments */
const MAX_KEY_MOMENTS = 20;

// ============================================================================
// TranscriptAnalyzer Class
// ============================================================================

export class TranscriptAnalyzer {
  /**
   * Analyze transcript segments and return key moments where frames
   * should be extracted from the video recording.
   *
   * @param segments - Array of transcript segments with timing info
   * @returns Array of key moments sorted by timestamp, capped at 20
   */
  analyze(segments: TranscriptSegment[]): KeyMoment[] {
    if (segments.length === 0) {
      return [];
    }

    const moments: KeyMoment[] = [];

    // Always include session start
    const firstSegment = segments[0];
    moments.push({
      timestamp: firstSegment.startTime,
      reason: 'Session start',
      confidence: 1.0,
    });

    // Detect natural pauses between segments
    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1];
      const curr = segments[i];
      const gap = curr.startTime - prev.endTime;

      if (gap >= PAUSE_THRESHOLD_SECONDS) {
        // Place the key moment at the start of the pause (end of previous segment)
        moments.push({
          timestamp: prev.endTime,
          reason: 'Natural pause in narration',
          confidence: Math.min(1.0, gap / 3.0), // Longer pauses = higher confidence
        });
      }
    }

    // Always include session end
    const lastSegment = segments[segments.length - 1];
    if (lastSegment.endTime !== firstSegment.startTime) {
      moments.push({
        timestamp: lastSegment.endTime,
        reason: 'Session end',
        confidence: 1.0,
      });
    }

    // If we found fewer than 3 moments (just start/end), add periodic baseline captures
    if (moments.length < 3) {
      const sessionStart = firstSegment.startTime;
      const sessionEnd = lastSegment.endTime;
      const sessionDuration = sessionEnd - sessionStart;

      if (sessionDuration > PERIODIC_INTERVAL_SECONDS) {
        // Calculate interval: target 15s but stretch up to 20s to avoid one extra capture
        const rawCount = Math.floor(sessionDuration / PERIODIC_INTERVAL_SECONDS);
        const interval = Math.min(
          sessionDuration / rawCount,
          MAX_PERIODIC_INTERVAL_SECONDS
        );

        for (
          let t = sessionStart + interval;
          t < sessionEnd;
          t += interval
        ) {
          moments.push({
            timestamp: t,
            reason: 'Periodic capture',
            confidence: 0.5,
          });
        }
      }
    }

    // Deduplicate moments that are very close together (within 1 second)
    const deduped = this.deduplicateMoments(moments);

    // Sort by timestamp
    deduped.sort((a, b) => a.timestamp - b.timestamp);

    // Cap at MAX_KEY_MOMENTS, keeping highest confidence ones
    if (deduped.length > MAX_KEY_MOMENTS) {
      // Always keep first and last; rank the rest by confidence
      const first = deduped[0];
      const last = deduped[deduped.length - 1];
      const middle = deduped
        .slice(1, -1)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, MAX_KEY_MOMENTS - 2);

      const capped = [first, ...middle, last];
      capped.sort((a, b) => a.timestamp - b.timestamp);
      return capped;
    }

    return deduped;
  }

  /**
   * Remove moments that are within 1 second of each other,
   * keeping the one with higher confidence.
   */
  private deduplicateMoments(moments: KeyMoment[]): KeyMoment[] {
    if (moments.length <= 1) {
      return moments;
    }

    // Sort by timestamp first for grouping
    const sorted = [...moments].sort((a, b) => a.timestamp - b.timestamp);
    const result: KeyMoment[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prev = result[result.length - 1];
      const curr = sorted[i];

      if (curr.timestamp - prev.timestamp < 1.0) {
        // Keep the one with higher confidence
        if (curr.confidence > prev.confidence) {
          result[result.length - 1] = curr;
        }
      } else {
        result.push(curr);
      }
    }

    return result;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const transcriptAnalyzer = new TranscriptAnalyzer();
export default TranscriptAnalyzer;
