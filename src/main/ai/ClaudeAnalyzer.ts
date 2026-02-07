/**
 * ClaudeAnalyzer - Core AI analysis engine for FeedbackFlow
 *
 * Takes a session's transcript + screenshots, sends to Claude Sonnet 4.5 with vision,
 * and returns structured feedback analysis as AIAnalysisResult.
 *
 * On any error, returns null so the caller can fall back to the free tier.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Session } from '../SessionController';
import type {
  AIAnalysisResult,
  ClaudeAnalyzerOptions,
  OptimizedImage,
} from './types';
import {
  DEFAULT_CLAUDE_ANALYZER_OPTIONS,
  AIPipelineError,
} from './types';
import { optimizeForAPI } from './ImageOptimizer';
import type { ImageOptimizeOptions } from './types';

// =============================================================================
// System Prompt (from AI_PIPELINE_DESIGN.md)
// =============================================================================

const SYSTEM_PROMPT = `You are markupr's AI analysis engine. You receive a developer's voice-narrated feedback session: a transcript of everything they said while reviewing software, paired with screenshots captured at natural pause points.

Your job is to transform this raw narration into a structured, actionable feedback document.

## Rules

1. **Preserve the user's voice.** Quote their exact words in blockquotes. Never rephrase their observations.
2. **Group related feedback.** If the user mentions the same area multiple times, combine those into one item.
3. **Match screenshots to feedback.** Each screenshot was captured during or after the text segment it accompanies. Reference screenshots by their index (e.g., [Screenshot 1]).
4. **Extract action items.** For each feedback item, write a concrete 1-sentence action item a developer could act on immediately.
5. **Assign priority.** Use Critical/High/Medium/Low based on the severity of the issue described.
6. **Categorize.** Use exactly one of: Bug, UX Issue, Performance, Suggestion, Question, Positive Note.
7. **Write a summary.** 2-3 sentences capturing the most important findings.
8. **Be concise.** Developers will paste this into AI coding tools. Every word must earn its place.

## Output Format

Respond with ONLY valid JSON matching this schema:

{
  "summary": "2-3 sentence overview of key findings",
  "items": [
    {
      "title": "Short descriptive title (5-10 words)",
      "category": "Bug|UX Issue|Performance|Suggestion|Question|Positive Note",
      "priority": "Critical|High|Medium|Low",
      "quote": "User's exact words (the relevant excerpt)",
      "screenshotIndices": [0, 1],
      "actionItem": "Concrete 1-sentence action for a developer",
      "area": "Component or area of the app this relates to (e.g., 'Navigation', 'Login Form', 'Dashboard')"
    }
  ],
  "themes": ["theme1", "theme2"],
  "positiveNotes": ["Things the user explicitly praised"],
  "metadata": {
    "totalItems": 5,
    "criticalCount": 1,
    "highCount": 2
  }
}`;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convert an absolute timestamp to session-relative MM:SS format.
 */
function toRelativeTimestamp(timestampMs: number, sessionStartMs: number): string {
  const relSec = Math.max(0, Math.floor((timestampMs - sessionStartMs) / 1000));
  const mm = Math.floor(relSec / 60).toString().padStart(2, '0');
  const ss = (relSec % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * Build the transcript portion of the user message from session data.
 *
 * Uses final transcripts grouped chronologically. Falls back to all transcripts
 * if no finals exist (e.g., timer-only tier).
 */
function buildTranscriptText(session: Session): string {
  const finals = session.transcriptBuffer
    .filter((e) => e.isFinal && e.text.trim().length > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  const events = finals.length > 0
    ? finals
    : session.transcriptBuffer
        .filter((e) => e.text.trim().length > 0)
        .sort((a, b) => a.timestamp - b.timestamp);

  if (events.length === 0) {
    return '[No transcript available]';
  }

  return events
    .map((e) => {
      // TranscriptEvent timestamps are in seconds; convert to ms for relative calc
      const tsMs = Math.round(e.timestamp * 1000);
      const rel = toRelativeTimestamp(tsMs, session.startTime);
      return `[${rel}] ${e.text.trim()}`;
    })
    .join('\n');
}

/**
 * Build the Claude API message content array with text + image blocks.
 */
function buildUserContent(
  session: Session,
  optimizedImages: OptimizedImage[],
): Anthropic.Messages.ContentBlockParam[] {
  const sourceName = session.metadata?.sourceName || 'Application';
  const transcriptText = buildTranscriptText(session);

  // Map optimized images back to their original screenshot timestamps
  const screenshotTimestamps = new Map<string, number>();
  for (const s of session.screenshotBuffer) {
    screenshotTimestamps.set(s.id, s.timestamp);
  }

  // Build the text preamble
  let textContent = `## Transcript\n\nThe user narrated the following while reviewing the application "${sourceName}":\n\n${transcriptText}`;

  if (optimizedImages.length > 0) {
    textContent += `\n\n---\n\n## Screenshots\n\n${optimizedImages.length} screenshots were captured at natural pause points during narration.\nThey are provided as images below in chronological order.`;
  }

  const content: Anthropic.Messages.ContentBlockParam[] = [
    { type: 'text', text: textContent },
  ];

  // Add image blocks
  for (let i = 0; i < optimizedImages.length; i++) {
    const img = optimizedImages[i];
    const originalTs = screenshotTimestamps.get(img.originalScreenshotId) ?? session.startTime;
    const rel = toRelativeTimestamp(originalTs, session.startTime);

    content.push({
      type: 'text',
      text: `Screenshot ${i + 1} (captured at ${rel}):`,
    });

    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType,
        data: img.data.toString('base64'),
      },
    });
  }

  return content;
}

// =============================================================================
// ClaudeAnalyzer
// =============================================================================

export class ClaudeAnalyzer {
  private client: Anthropic;
  private options: ClaudeAnalyzerOptions;

  constructor(apiKey: string, options?: Partial<ClaudeAnalyzerOptions>, baseUrl?: string) {
    this.options = { ...DEFAULT_CLAUDE_ANALYZER_OPTIONS, ...options };

    const clientOptions: ConstructorParameters<typeof Anthropic>[0] = { apiKey };
    if (baseUrl) {
      clientOptions.baseURL = baseUrl;
    }
    this.client = new Anthropic(clientOptions);
  }

  /**
   * Analyze a session using Claude's vision API.
   *
   * @param session - The completed session with transcript and screenshots
   * @param imageOptions - Optional image optimization settings
   * @returns Structured analysis result, or null on any error
   */
  async analyze(
    session: Session,
    imageOptions?: Partial<ImageOptimizeOptions>,
  ): Promise<AIAnalysisResult | null> {
    try {
      // Optimize screenshots for the API
      const optimizedImages = optimizeForAPI(session.screenshotBuffer, imageOptions);

      // Build message content
      const userContent = buildUserContent(session, optimizedImages);

      // Call Claude API
      let timeoutHandle: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new AIPipelineError(
              `Claude API request timed out after ${this.options.timeoutMs}ms`,
              'API_TIMEOUT',
            ),
          );
        }, this.options.timeoutMs);
      });

      const response = await Promise.race([
        this.client.messages.create({
          model: this.options.model,
          max_tokens: this.options.maxTokens,
          temperature: this.options.temperature,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userContent }],
        }),
        timeoutPromise,
      ]).finally(() => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      });

      // Extract text from response
      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new AIPipelineError('No text content in Claude response', 'INVALID_RESPONSE');
      }

      // Parse JSON from response
      const result = parseAnalysisResult(textBlock.text);
      return result;
    } catch (error) {
      if (error instanceof AIPipelineError) {
        console.error(`[ClaudeAnalyzer] Pipeline error (${error.code}):`, error.message);
      } else {
        console.error('[ClaudeAnalyzer] Unexpected error:', error instanceof Error ? error.message : error);
      }
      return null;
    }
  }
}

// =============================================================================
// Response Parsing
// =============================================================================

/**
 * Parse Claude's JSON response into a validated AIAnalysisResult.
 *
 * Handles common edge cases:
 * - JSON wrapped in markdown code fences
 * - Extra whitespace / trailing commas (via lenient extraction)
 */
function parseAnalysisResult(text: string): AIAnalysisResult {
  // Strip markdown code fences if present
  let jsonStr = text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new AIPipelineError(
      `Failed to parse Claude response as JSON: ${jsonStr.slice(0, 200)}...`,
      'INVALID_RESPONSE',
    );
  }

  // Validate required fields
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('summary' in parsed) ||
    !('items' in parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).items)
  ) {
    throw new AIPipelineError(
      'Claude response JSON missing required fields (summary, items)',
      'INVALID_RESPONSE',
    );
  }

  const obj = parsed as Record<string, unknown>;

  // Build items first so we can compute accurate metadata
  const items = Array.isArray(obj.items)
    ? (obj.items as Record<string, unknown>[]).map(validateFeedbackItem)
    : [];

  const result: AIAnalysisResult = {
    summary: String(obj.summary ?? ''),
    items,
    themes: Array.isArray(obj.themes)
      ? (obj.themes as unknown[]).map(String)
      : [],
    positiveNotes: Array.isArray(obj.positiveNotes)
      ? (obj.positiveNotes as unknown[]).map(String)
      : [],
    metadata: {
      totalItems: items.length,
      criticalCount: items.filter((i) => i.priority === 'Critical').length,
      highCount: items.filter((i) => i.priority === 'High').length,
    },
  };

  return result;
}

/**
 * Validate and coerce a single feedback item from Claude's response.
 */
function validateFeedbackItem(raw: Record<string, unknown>): AIAnalysisResult['items'][0] {
  const validCategories = ['Bug', 'UX Issue', 'Performance', 'Suggestion', 'Question', 'Positive Note'];
  const validPriorities = ['Critical', 'High', 'Medium', 'Low'];

  const category = String(raw.category ?? 'Suggestion');
  const priority = String(raw.priority ?? 'Medium');

  return {
    title: String(raw.title ?? 'Untitled Feedback'),
    category: validCategories.includes(category) ? category as AIAnalysisResult['items'][0]['category'] : 'Suggestion',
    priority: validPriorities.includes(priority) ? priority as AIAnalysisResult['items'][0]['priority'] : 'Medium',
    quote: String(raw.quote ?? ''),
    screenshotIndices: Array.isArray(raw.screenshotIndices)
      ? (raw.screenshotIndices as unknown[]).filter((v): v is number => typeof v === 'number')
      : [],
    actionItem: String(raw.actionItem ?? ''),
    area: String(raw.area ?? 'General'),
  };
}
