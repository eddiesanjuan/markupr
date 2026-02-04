/**
 * Generate placeholder tray icons for FeedbackFlow
 *
 * Creates 16x16 and 32x32 (retina) icons for each state.
 * These are simple placeholders - replace with proper icons for production.
 *
 * Run with: node scripts/generate-tray-icons.js
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ASSETS_DIR = path.join(__dirname, '../assets');

// Ensure assets directory exists
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

/**
 * Generate an SVG icon for a given state
 */
function generateSvg(state, size) {
  const center = size / 2;
  const radius = size / 2 - 2;
  const strokeWidth = Math.max(1, size / 16);

  switch (state) {
    case 'idle':
      // Circle outline (ready to record)
      return `
        <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${center}" cy="${center}" r="${radius}"
                  fill="none" stroke="#666666" stroke-width="${strokeWidth}"/>
        </svg>
      `;

    case 'recording':
      // Filled red circle (recording active)
      return `
        <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${center}" cy="${center}" r="${radius}" fill="#FF3B30"/>
        </svg>
      `;

    case 'processing':
      // Dashed circle (processing)
      return `
        <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${center}" cy="${center}" r="${radius}"
                  fill="none" stroke="#666666" stroke-width="${strokeWidth}"
                  stroke-dasharray="${size / 4} ${size / 8}" stroke-linecap="round"/>
        </svg>
      `;

    case 'error':
      // Warning icon (amber)
      const triTop = size * 0.15;
      const triBottom = size * 0.85;
      const triLeft = size * 0.1;
      const triRight = size * 0.9;
      const fontSize = Math.round(size * 0.5);
      const textY = size * 0.75;

      return `
        <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
          <polygon points="${center},${triTop} ${triRight},${triBottom} ${triLeft},${triBottom}"
                   fill="#FF9500"/>
          <text x="${center}" y="${textY}" text-anchor="middle"
                fill="white" font-size="${fontSize}" font-weight="bold" font-family="Arial, sans-serif">!</text>
        </svg>
      `;

    default:
      // Fallback circle
      return `
        <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${center}" cy="${center}" r="${radius}" fill="#999999"/>
        </svg>
      `;
  }
}

/**
 * Generate processing animation frames
 */
function generateProcessingFrame(frame, totalFrames, size) {
  const center = size / 2;
  const radius = size / 2 - 2;
  const strokeWidth = Math.max(1, size / 16);
  const rotation = (frame / totalFrames) * 360;

  return `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(${rotation} ${center} ${center})">
        <circle cx="${center}" cy="${center}" r="${radius}"
                fill="none" stroke="#666666" stroke-width="${strokeWidth}"
                stroke-dasharray="${size / 4} ${size / 8}" stroke-linecap="round"/>
      </g>
    </svg>
  `;
}

async function generateIcon(name, svg, size) {
  const buffer = Buffer.from(svg.trim());

  // Generate standard resolution
  await sharp(buffer)
    .resize(size, size)
    .png()
    .toFile(path.join(ASSETS_DIR, `${name}.png`));

  // Generate @2x for retina (macOS)
  await sharp(buffer)
    .resize(size * 2, size * 2)
    .png()
    .toFile(path.join(ASSETS_DIR, `${name}@2x.png`));

  console.log(`Generated: ${name}.png and ${name}@2x.png`);
}

async function main() {
  console.log('Generating FeedbackFlow tray icons...\n');

  const states = ['idle', 'recording', 'processing', 'error'];
  const size = 16;

  // Generate standard icons
  for (const state of states) {
    const svg = generateSvg(state, 64); // Generate at 64x64 for quality
    await generateIcon(`tray-${state}`, svg, size);

    // Also generate Template versions for macOS (grayscale)
    await generateIcon(`tray-${state}Template`, svg, size);
  }

  // Generate processing animation frames
  const totalFrames = 4;
  for (let frame = 0; frame < totalFrames; frame++) {
    const svg = generateProcessingFrame(frame, totalFrames, 64);
    await generateIcon(`tray-processing-${frame}`, svg, size);
    await generateIcon(`tray-processing-${frame}Template`, svg, size);
  }

  console.log('\nDone! Icons generated in:', ASSETS_DIR);
  console.log('\nNote: These are placeholder icons. Replace with professionally designed icons for production.');
}

main().catch(console.error);
