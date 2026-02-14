/**
 * MCP Server Factory Unit Tests
 *
 * Tests that createServer():
 * - Returns a valid McpServer instance
 * - Registers all 6 tools
 * - Registers resources
 * - Uses correct server name and version
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Hoisted mocks — vi.hoisted runs before vi.mock factory hoisting
// =============================================================================

const {
  mockRegisterCaptureScreenshot,
  mockRegisterCaptureWithVoice,
  mockRegisterAnalyzeVideo,
  mockRegisterAnalyzeScreenshot,
  mockRegisterStartRecording,
  mockRegisterStopRecording,
  mockRegisterResources,
  mockTool,
  mockResource,
} = vi.hoisted(() => ({
  mockRegisterCaptureScreenshot: vi.fn(),
  mockRegisterCaptureWithVoice: vi.fn(),
  mockRegisterAnalyzeVideo: vi.fn(),
  mockRegisterAnalyzeScreenshot: vi.fn(),
  mockRegisterStartRecording: vi.fn(),
  mockRegisterStopRecording: vi.fn(),
  mockRegisterResources: vi.fn(),
  mockTool: vi.fn(),
  mockResource: vi.fn(),
}));

vi.mock('../../../src/mcp/tools/captureScreenshot.js', () => ({
  register: mockRegisterCaptureScreenshot,
}));

vi.mock('../../../src/mcp/tools/captureWithVoice.js', () => ({
  register: mockRegisterCaptureWithVoice,
}));

vi.mock('../../../src/mcp/tools/analyzeVideo.js', () => ({
  register: mockRegisterAnalyzeVideo,
}));

vi.mock('../../../src/mcp/tools/analyzeScreenshot.js', () => ({
  register: mockRegisterAnalyzeScreenshot,
}));

vi.mock('../../../src/mcp/tools/startRecording.js', () => ({
  register: mockRegisterStartRecording,
}));

vi.mock('../../../src/mcp/tools/stopRecording.js', () => ({
  register: mockRegisterStopRecording,
}));

vi.mock('../../../src/mcp/resources/sessionResource.js', () => ({
  registerResources: mockRegisterResources,
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation((config: { name: string; version: string }) => ({
    name: config.name,
    version: config.version,
    tool: mockTool,
    resource: mockResource,
    connect: vi.fn(),
  })),
}));

import { createServer } from '../../../src/mcp/server.js';

describe('MCP Server Factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a server instance', () => {
    const server = createServer();
    expect(server).toBeDefined();
  });

  it('registers all 6 tool handlers', () => {
    const server = createServer();

    expect(mockRegisterCaptureScreenshot).toHaveBeenCalledOnce();
    expect(mockRegisterCaptureScreenshot).toHaveBeenCalledWith(server);

    expect(mockRegisterCaptureWithVoice).toHaveBeenCalledOnce();
    expect(mockRegisterCaptureWithVoice).toHaveBeenCalledWith(server);

    expect(mockRegisterAnalyzeVideo).toHaveBeenCalledOnce();
    expect(mockRegisterAnalyzeVideo).toHaveBeenCalledWith(server);

    expect(mockRegisterAnalyzeScreenshot).toHaveBeenCalledOnce();
    expect(mockRegisterAnalyzeScreenshot).toHaveBeenCalledWith(server);

    expect(mockRegisterStartRecording).toHaveBeenCalledOnce();
    expect(mockRegisterStartRecording).toHaveBeenCalledWith(server);

    expect(mockRegisterStopRecording).toHaveBeenCalledOnce();
    expect(mockRegisterStopRecording).toHaveBeenCalledWith(server);
  });

  it('registers session resources', () => {
    const server = createServer();

    expect(mockRegisterResources).toHaveBeenCalledOnce();
    expect(mockRegisterResources).toHaveBeenCalledWith(server);
  });

  it('uses "markupr" as the server name', () => {
    const server = createServer();
    expect(server).toHaveProperty('name', 'markupr');
  });

  it('sets a version string on the server', () => {
    const server = createServer();
    // Version may be '0.0.0-dev' in test environment (no esbuild define)
    expect(server).toHaveProperty('version');
    expect(typeof (server as any).version).toBe('string');
  });
});
