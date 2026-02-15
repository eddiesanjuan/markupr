/**
 * Shared helpers for output templates.
 *
 * Pure utility functions — no side effects.
 */

import * as path from 'path';
import type { TranscriptSegment, ExtractedFrame } from './types';

/**
 * Format seconds to M:SS (e.g. 125 -> "2:05").
 */
export function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format milliseconds to M:SS.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Deterministic date formatting: "Feb 14, 2026 at 10:30 AM".
 */
export function formatDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  const rawHours = date.getHours();
  const ampm = rawHours >= 12 ? 'PM' : 'AM';
  const hours = rawHours % 12 || 12;
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${month} ${day}, ${year} at ${hours}:${minutes} ${ampm}`;
}

/**
 * Generate a short title from transcript text (first sentence, max 60 chars).
 */
export function generateSegmentTitle(text: string): string {
  const firstSentence = text.split(/[.!?]/)[0].trim();
  if (firstSentence.length <= 60) return firstSentence;
  return firstSentence.slice(0, 57) + '...';
}

/**
 * Wrap transcription for markdown blockquote (handle multi-line).
 */
export function wrapTranscription(transcription: string): string {
  if (!transcription.includes('.') && !transcription.includes('!') && !transcription.includes('?')) {
    return transcription;
  }
  const sentences = transcription.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length <= 1) return transcription;
  return sentences.join('\n> ');
}

/**
 * Compute a relative path for a frame image from the session directory.
 */
export function computeRelativeFramePath(framePath: string, sessionDir: string): string {
  if (!path.isAbsolute(framePath)) {
    return framePath;
  }
  return path.relative(sessionDir, framePath);
}

/**
 * Compute session duration from transcript segments.
 */
export function computeSessionDuration(segments: TranscriptSegment[]): string {
  if (segments.length === 0) return '0:00';
  return formatDuration(
    (segments[segments.length - 1].endTime - segments[0].startTime) * 1000
  );
}

/**
 * Map extracted frames to their closest transcript segments.
 * Returns a Map from segment index to an array of frames.
 */
export function mapFramesToSegments(
  segments: TranscriptSegment[],
  frames: ExtractedFrame[]
): Map<number, ExtractedFrame[]> {
  const map = new Map<number, ExtractedFrame[]>();

  for (const frame of frames) {
    let bestIndex = 0;
    let bestDistance = Infinity;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      if (frame.timestamp >= seg.startTime && frame.timestamp <= seg.endTime) {
        bestIndex = i;
        bestDistance = 0;
        break;
      }

      const distance = Math.abs(frame.timestamp - seg.startTime);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    const existing = map.get(bestIndex) || [];
    existing.push(frame);
    map.set(bestIndex, existing);
  }

  for (const [, frameList] of map) {
    frameList.sort((a, b) => a.timestamp - b.timestamp);
  }

  return map;
}
