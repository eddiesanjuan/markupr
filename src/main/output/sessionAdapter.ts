/**
 * Session Adapter
 *
 * Converts between different session types used across the codebase.
 * This is needed because:
 * - SessionController uses its own Session/FeedbackItem types
 * - MarkdownGenerator uses enhanced Session/FeedbackItem types
 * - FileManager uses its own MarkdownDocument type
 */

import type { Session as ControllerSession, FeedbackItem as ControllerFeedbackItem } from '../SessionController';
import type {
  Session as MarkdownSession,
  FeedbackItem as MarkdownFeedbackItem,
  FeedbackCategory,
  GenerateOptions,
} from './MarkdownGenerator';
import type { MarkdownDocument as FileManagerDocument } from './FileManager';
import { markdownGenerator } from './MarkdownGenerator';

/**
 * Infer category from feedback text
 */
function inferCategory(text: string): FeedbackCategory {
  const lowerText = text.toLowerCase();

  if (lowerText.includes('bug') || lowerText.includes('broken') || lowerText.includes('error') ||
      lowerText.includes('crash') || lowerText.includes('doesn\'t work') || lowerText.includes('not working')) {
    return 'Bug';
  }

  if (lowerText.includes('confusing') || lowerText.includes('hard to') || lowerText.includes('unclear') ||
      lowerText.includes('ux') || lowerText.includes('user experience') || lowerText.includes('usability')) {
    return 'UX Issue';
  }

  if (lowerText.includes('should') || lowerText.includes('could') || lowerText.includes('would be nice') ||
      lowerText.includes('suggestion') || lowerText.includes('feature') || lowerText.includes('add')) {
    return 'Suggestion';
  }

  if (lowerText.includes('?') || lowerText.includes('how') || lowerText.includes('why') ||
      lowerText.includes('what') || lowerText.includes('question')) {
    return 'Question';
  }

  return 'General';
}

/**
 * Convert SessionController.FeedbackItem to MarkdownGenerator.FeedbackItem
 */
function adaptFeedbackItem(item: ControllerFeedbackItem, index: number): MarkdownFeedbackItem {
  return {
    id: item.id || `item-${index + 1}`,
    transcription: item.text,
    timestamp: item.timestamp,
    category: inferCategory(item.text),
    screenshots: item.screenshot ? [{
      id: item.screenshot.id,
      timestamp: item.screenshot.timestamp,
      width: item.screenshot.width,
      height: item.screenshot.height,
      imagePath: '', // Filled in by FileManager when saving
      base64: item.screenshot.base64,
    }] : [],
  };
}

/**
 * Convert SessionController.Session to MarkdownGenerator.Session
 */
export function adaptSessionForMarkdown(session: ControllerSession): MarkdownSession {
  return {
    id: session.id,
    startTime: session.startTime,
    endTime: session.endTime,
    feedbackItems: session.feedbackItems.map((item, index) => adaptFeedbackItem(item, index)),
    metadata: {
      os: process.platform,
      sourceName: session.metadata?.sourceName || 'Screen',
      sourceType: session.sourceId.startsWith('screen') ? 'screen' : 'window',
    },
  };
}

/**
 * Generate a FileManager-compatible MarkdownDocument from a SessionController session
 */
export function generateDocumentForFileManager(
  session: ControllerSession,
  options?: Partial<GenerateOptions>
): FileManagerDocument {
  const adaptedSession = adaptSessionForMarkdown(session);
  const fullOptions: GenerateOptions = {
    projectName: options?.projectName || session.metadata?.sourceName || 'Feedback Session',
    screenshotDir: options?.screenshotDir || './screenshots',
  };

  const generatedDoc = markdownGenerator.generateFullDocument(adaptedSession, fullOptions);

  // Convert MarkdownGenerator.MarkdownDocument to FileManager.MarkdownDocument
  return {
    content: generatedDoc.content,
    metadata: {
      itemCount: generatedDoc.metadata.itemCount,
      screenshotCount: generatedDoc.metadata.screenshotCount,
      types: Object.keys(generatedDoc.metadata.types),
    },
  };
}

/**
 * Generate clipboard summary from a SessionController session
 */
export function generateClipboardSummary(session: ControllerSession, projectName?: string): string {
  const adaptedSession = adaptSessionForMarkdown(session);
  return markdownGenerator.generateClipboardSummary(
    adaptedSession,
    projectName || session.metadata?.sourceName || 'Feedback Session'
  );
}
