/**
 * MCP-specific types for the markupr MCP server.
 */

/** Represents a single MCP recording/capture session. */
export interface McpSession {
  id: string;
  startTime: number;
  endTime?: number;
  label?: string;
  videoPath?: string;
  reportPath?: string;
  status: 'recording' | 'processing' | 'complete' | 'error';
}

/** Metadata written to each session's metadata.json on disk. */
export interface McpSessionMetadata extends McpSession {
  transcriptSegments?: number;
  extractedFrames?: number;
  durationSeconds?: number;
}
