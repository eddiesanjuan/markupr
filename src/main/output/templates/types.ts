/**
 * Output Template Types
 *
 * Defines the interface for pluggable output templates.
 * Templates are pure render functions — no side effects, no I/O.
 */

import type { PostProcessResult, TranscriptSegment, ExtractedFrame } from '../../pipeline/PostProcessor';

/**
 * Context provided to templates when rendering from a PostProcessResult.
 * This is the primary render path used by the CLI and MCP tools.
 */
export interface TemplateContext {
  /** The post-processing pipeline result */
  result: PostProcessResult;
  /** Absolute path to the session directory (for computing relative frame paths) */
  sessionDir: string;
  /** Session timestamp (defaults to Date.now() if not provided) */
  timestamp?: number;
}

/**
 * Rendered output from a template.
 */
export interface TemplateOutput {
  /** The rendered content string */
  content: string;
  /** File extension including the dot (e.g. '.md', '.json') */
  fileExtension: string;
}

/**
 * An output template that can render PostProcessResult into a specific format.
 *
 * Templates must be pure functions — no file I/O, no network calls, no side effects.
 */
export interface OutputTemplate {
  /** Unique template identifier (e.g. 'markdown', 'json', 'github-issue') */
  name: string;
  /** Human-readable description */
  description: string;
  /** Default file extension including the dot */
  fileExtension: string;
  /** Render the template from a PostProcessResult context */
  render(context: TemplateContext): TemplateOutput;
}

export type { PostProcessResult, TranscriptSegment, ExtractedFrame };
