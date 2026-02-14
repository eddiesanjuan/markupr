/**
 * ImageOptimizer — sharp-based image optimization for the MCP server.
 *
 * Replaces the Electron nativeImage approach from src/main/ai/ImageOptimizer.ts.
 * Resizes images to a max width and compresses to reduce size for API transport
 * and disk storage. Zero Electron dependencies.
 */

import sharp from 'sharp';
import { resolve } from 'path';
import { log } from './Logger.js';

export interface OptimizeOptions {
  /** Maximum width in pixels. Images wider than this are resized (aspect ratio preserved). Default: 1920. */
  maxWidth?: number;
  /** JPEG/PNG quality (1-100). Default: 85. */
  quality?: number;
}

const DEFAULT_MAX_WIDTH = 1920;
const DEFAULT_QUALITY = 85;

/**
 * Optimize an image by resizing and compressing it.
 *
 * - Images wider than maxWidth are scaled down (aspect ratio preserved).
 * - PNG images are re-encoded at the specified quality.
 * - If outputPath is not provided, the input file is overwritten.
 *
 * @param inputPath  Absolute path to the source image.
 * @param outputPath Optional output path. Defaults to overwriting inputPath.
 * @param options    Resize and compression options.
 * @returns Absolute path to the optimized image.
 */
export async function optimize(
  inputPath: string,
  outputPath?: string,
  options?: OptimizeOptions,
): Promise<string> {
  const resolvedInput = resolve(inputPath);
  const resolvedOutput = resolve(outputPath ?? inputPath);
  const maxWidth = options?.maxWidth ?? DEFAULT_MAX_WIDTH;
  const quality = options?.quality ?? DEFAULT_QUALITY;

  const metadata = await sharp(resolvedInput).metadata();
  const originalWidth = metadata.width ?? 0;
  const originalHeight = metadata.height ?? 0;

  let pipeline = sharp(resolvedInput);

  // Resize if wider than maxWidth
  if (originalWidth > maxWidth) {
    pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
    log(
      `Resizing image: ${originalWidth}x${originalHeight} → max width ${maxWidth}px`,
    );
  }

  // Determine output format from extension
  const ext = resolvedOutput.split('.').pop()?.toLowerCase();

  if (ext === 'jpg' || ext === 'jpeg') {
    pipeline = pipeline.jpeg({ quality });
  } else {
    // Default to PNG
    pipeline = pipeline.png({ quality: Math.min(quality, 100) });
  }

  await pipeline.toFile(resolvedOutput);

  log(`Image optimized: ${resolvedOutput}`);
  return resolvedOutput;
}
