/**
 * ImageOptimizer Unit Tests
 *
 * Tests the sharp-based image optimization:
 * - Default max width (1920) and quality (85)
 * - Custom max width and quality
 * - Resize triggered when image exceeds max width
 * - No resize when image is within max width
 * - JPEG output for .jpg/.jpeg extensions
 * - PNG output for .png and other extensions
 * - Output path defaults to input path when not specified
 * - Custom output path
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Hoisted mocks
// =============================================================================

const { mockSharpInstance, mockSharp } = vi.hoisted(() => {
  const instance = {
    metadata: vi.fn(),
    resize: vi.fn(),
    png: vi.fn(),
    jpeg: vi.fn(),
    toFile: vi.fn(),
  };
  // Chain returns self
  instance.resize.mockReturnValue(instance);
  instance.png.mockReturnValue(instance);
  instance.jpeg.mockReturnValue(instance);
  instance.toFile.mockResolvedValue({ width: 1920, height: 1080, size: 102400 });

  return {
    mockSharpInstance: instance,
    mockSharp: vi.fn(() => instance),
  };
});

vi.mock('sharp', () => ({
  default: mockSharp,
}));

vi.mock('../../../src/mcp/utils/Logger.js', () => ({
  log: vi.fn(),
}));

import { optimize } from '../../../src/mcp/utils/ImageOptimizer.js';

describe('ImageOptimizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain returns after clearAllMocks
    mockSharpInstance.resize.mockReturnValue(mockSharpInstance);
    mockSharpInstance.png.mockReturnValue(mockSharpInstance);
    mockSharpInstance.jpeg.mockReturnValue(mockSharpInstance);
    mockSharpInstance.toFile.mockResolvedValue({ width: 1920, height: 1080, size: 102400 });
  });

  it('resizes images wider than default max width (1920)', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 2560, height: 1440 });

    await optimize('/tmp/input.png');

    expect(mockSharpInstance.resize).toHaveBeenCalledWith({
      width: 1920,
      withoutEnlargement: true,
    });
  });

  it('does not resize images within default max width', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 1200, height: 800 });

    await optimize('/tmp/input.png');

    expect(mockSharpInstance.resize).not.toHaveBeenCalled();
  });

  it('uses custom max width when specified', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 1500, height: 900 });

    await optimize('/tmp/input.png', undefined, { maxWidth: 1280 });

    expect(mockSharpInstance.resize).toHaveBeenCalledWith({
      width: 1280,
      withoutEnlargement: true,
    });
  });

  it('applies PNG format for .png files', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 800, height: 600 });

    await optimize('/tmp/input.png');

    expect(mockSharpInstance.png).toHaveBeenCalledWith({ quality: 85 });
    expect(mockSharpInstance.jpeg).not.toHaveBeenCalled();
  });

  it('applies JPEG format for .jpg files', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 800, height: 600 });

    await optimize('/tmp/input.jpg');

    expect(mockSharpInstance.jpeg).toHaveBeenCalledWith({ quality: 85 });
    expect(mockSharpInstance.png).not.toHaveBeenCalled();
  });

  it('applies JPEG format for .jpeg files', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 800, height: 600 });

    await optimize('/tmp/input.jpeg');

    expect(mockSharpInstance.jpeg).toHaveBeenCalledWith({ quality: 85 });
  });

  it('uses custom quality when specified', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 800, height: 600 });

    await optimize('/tmp/input.png', undefined, { quality: 60 });

    expect(mockSharpInstance.png).toHaveBeenCalledWith({ quality: 60 });
  });

  it('overwrites input when no output path is specified', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 800, height: 600 });

    await optimize('/tmp/input.png');

    expect(mockSharpInstance.toFile).toHaveBeenCalledWith(
      expect.stringContaining('input.png'),
    );
  });

  it('writes to custom output path when specified', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 800, height: 600 });

    await optimize('/tmp/input.png', '/tmp/output.png');

    expect(mockSharpInstance.toFile).toHaveBeenCalledWith(
      expect.stringContaining('output.png'),
    );
  });

  it('returns the output path', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 800, height: 600 });

    const result = await optimize('/tmp/input.png', '/tmp/output.png');

    expect(result).toContain('output.png');
  });

  it('caps quality at 100 for PNG', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 800, height: 600 });

    await optimize('/tmp/input.png', undefined, { quality: 150 });

    expect(mockSharpInstance.png).toHaveBeenCalledWith({ quality: 100 });
  });
});
