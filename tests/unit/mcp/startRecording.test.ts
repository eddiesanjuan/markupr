/**
 * startRecording Tool Unit Tests
 *
 * Tests the start_recording MCP tool handler:
 * - Registers tool with correct name
 * - Returns isError when already recording
 * - Creates session via SessionStore
 * - Calls ScreenRecorder.start with correct output path
 * - Tracks recording in ActiveRecording
 * - Returns session ID in response
 * - Returns isError on failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Hoisted mocks
// =============================================================================

const { mockStart } = vi.hoisted(() => ({
  mockStart: vi.fn(),
}));

vi.mock('../../../src/mcp/capture/ScreenRecorder.js', () => ({
  start: mockStart,
}));

const mockIsRecording = vi.fn();
const mockGetCurrent = vi.fn();
const mockActiveStart = vi.fn();

vi.mock('../../../src/mcp/session/ActiveRecording.js', () => ({
  activeRecording: {
    isRecording: (...args: unknown[]) => mockIsRecording(...args),
    getCurrent: (...args: unknown[]) => mockGetCurrent(...args),
    start: (...args: unknown[]) => mockActiveStart(...args),
  },
}));

const mockCreate = vi.fn();
const mockGetSessionDir = vi.fn();

vi.mock('../../../src/mcp/session/SessionStore.js', () => ({
  sessionStore: {
    create: (...args: unknown[]) => mockCreate(...args),
    getSessionDir: (...args: unknown[]) => mockGetSessionDir(...args),
  },
}));

vi.mock('../../../src/mcp/utils/Logger.js', () => ({
  log: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(),
}));

vi.mock('zod', () => ({
  z: {
    string: () => ({ optional: () => ({ describe: () => ({}) }) }),
  },
}));

import { register } from '../../../src/mcp/tools/startRecording.js';

describe('startRecording tool', () => {
  let toolHandler: Function;
  let mockServer: any;
  let mockProcess: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockServer = {
      tool: vi.fn((_name: string, _desc: string, _schema: any, handler: Function) => {
        toolHandler = handler;
      }),
    };

    mockProcess = { pid: 1234, kill: vi.fn() };
    mockIsRecording.mockReturnValue(false);
    mockGetCurrent.mockReturnValue(null);
    mockCreate.mockResolvedValue({ id: 'mcp-20260214-120000' });
    mockGetSessionDir.mockReturnValue('/tmp/sessions/mcp-20260214-120000');
    mockStart.mockReturnValue(mockProcess);

    register(mockServer);
  });

  it('registers with correct tool name', () => {
    expect(mockServer.tool).toHaveBeenCalledWith(
      'start_recording',
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('returns isError when already recording', async () => {
    mockIsRecording.mockReturnValue(true);
    mockGetCurrent.mockReturnValue({ sessionId: 'existing-session' });

    const result = await toolHandler({ label: undefined });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Recording already in progress');
    expect(result.content[0].text).toContain('existing-session');
  });

  it('creates a session with label', async () => {
    await toolHandler({ label: 'bug review' });
    expect(mockCreate).toHaveBeenCalledWith('bug review');
  });

  it('calls ScreenRecorder.start with output path', async () => {
    await toolHandler({ label: undefined });

    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({
        outputPath: expect.stringContaining('recording.mp4'),
      }),
    );
  });

  it('tracks recording in ActiveRecording', async () => {
    await toolHandler({ label: undefined });

    expect(mockActiveStart).toHaveBeenCalledWith(
      'mcp-20260214-120000',
      mockProcess,
      expect.stringContaining('recording.mp4'),
    );
  });

  it('returns session ID in response', async () => {
    const result = await toolHandler({ label: undefined });

    expect(result.content[0].text).toContain('Recording started.');
    expect(result.content[0].text).toContain('Session ID: mcp-20260214-120000');
    expect(result.content[0].text).toContain('stop_recording');
  });

  it('returns isError on failure', async () => {
    mockCreate.mockRejectedValue(new Error('Disk full'));

    const result = await toolHandler({ label: undefined });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Disk full');
  });
});
