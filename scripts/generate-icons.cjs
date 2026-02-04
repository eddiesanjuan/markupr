#!/usr/bin/env node
/**
 * generate-icons.js
 *
 * Generates macOS icon assets from SVG sources
 * Creates:
 *   - build/icon.icns (macOS app icon)
 *   - build/dmg-background.png (DMG installer background)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const BUILD = path.join(ROOT, 'build');
const SVG_SOURCE = path.join(ASSETS, 'svg-source');

// Ensure build directory exists
if (!fs.existsSync(BUILD)) {
  fs.mkdirSync(BUILD, { recursive: true });
}

/**
 * Generate macOS .icns from SVG
 */
function generateIconset() {
  const svgPath = path.join(SVG_SOURCE, 'icon.svg');
  const iconsetPath = path.join(BUILD, 'icon.iconset');
  const icnsPath = path.join(BUILD, 'icon.icns');

  // Check if source exists
  if (!fs.existsSync(svgPath)) {
    console.log('WARNING: No icon.svg found, creating placeholder icon');
    createPlaceholderIcon();
    return;
  }

  console.log('Generating macOS icon from SVG...');

  // Create iconset directory
  if (fs.existsSync(iconsetPath)) {
    fs.rmSync(iconsetPath, { recursive: true });
  }
  fs.mkdirSync(iconsetPath);

  // Required icon sizes for macOS
  const sizes = [
    { name: 'icon_16x16.png', size: 16 },
    { name: 'icon_16x16@2x.png', size: 32 },
    { name: 'icon_32x32.png', size: 32 },
    { name: 'icon_32x32@2x.png', size: 64 },
    { name: 'icon_128x128.png', size: 128 },
    { name: 'icon_128x128@2x.png', size: 256 },
    { name: 'icon_256x256.png', size: 256 },
    { name: 'icon_256x256@2x.png', size: 512 },
    { name: 'icon_512x512.png', size: 512 },
    { name: 'icon_512x512@2x.png', size: 1024 },
  ];

  // Convert SVG to each size using ImageMagick
  for (const { name, size } of sizes) {
    const outputPath = path.join(iconsetPath, name);
    try {
      execSync(
        `convert -background none -density 300 "${svgPath}" -resize ${size}x${size} "${outputPath}"`,
        { stdio: 'pipe' }
      );
      console.log(`  Created ${name} (${size}x${size})`);
    } catch (error) {
      console.error(`  Failed to create ${name}: ${error.message}`);
      // Try sips as fallback (needs a PNG first)
    }
  }

  // Convert iconset to icns
  try {
    execSync(`iconutil -c icns "${iconsetPath}" -o "${icnsPath}"`, { stdio: 'pipe' });
    console.log(`Created: ${icnsPath}`);

    // Clean up iconset directory
    fs.rmSync(iconsetPath, { recursive: true });
  } catch (error) {
    console.error(`Failed to create icns: ${error.message}`);
  }
}

/**
 * Create a placeholder icon if no source exists
 */
function createPlaceholderIcon() {
  const iconsetPath = path.join(BUILD, 'icon.iconset');
  const icnsPath = path.join(BUILD, 'icon.icns');

  if (fs.existsSync(iconsetPath)) {
    fs.rmSync(iconsetPath, { recursive: true });
  }
  fs.mkdirSync(iconsetPath);

  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  const names = {
    16: 'icon_16x16.png',
    32: ['icon_16x16@2x.png', 'icon_32x32.png'],
    64: 'icon_32x32@2x.png',
    128: 'icon_128x128.png',
    256: ['icon_128x128@2x.png', 'icon_256x256.png'],
    512: ['icon_256x256@2x.png', 'icon_512x512.png'],
    1024: 'icon_512x512@2x.png',
  };

  for (const size of sizes) {
    const fileNames = Array.isArray(names[size]) ? names[size] : [names[size]];
    for (const name of fileNames) {
      const outputPath = path.join(iconsetPath, name);
      // Create a gradient placeholder using ImageMagick
      execSync(
        `convert -size ${size}x${size} -define gradient:angle=135 gradient:'#6366f1'-'#8b5cf6' -fill white -gravity center -pointsize ${Math.floor(size * 0.4)} -annotate 0 "FF" "${outputPath}"`,
        { stdio: 'pipe' }
      );
    }
  }

  execSync(`iconutil -c icns "${iconsetPath}" -o "${icnsPath}"`, { stdio: 'pipe' });
  console.log(`Created placeholder: ${icnsPath}`);
  fs.rmSync(iconsetPath, { recursive: true });
}

/**
 * Generate DMG background image
 */
function generateDmgBackground() {
  const svgPath = path.join(SVG_SOURCE, 'dmg-background.svg');
  const outputPath = path.join(BUILD, 'dmg-background.png');

  if (fs.existsSync(svgPath)) {
    console.log('Generating DMG background from SVG...');
    try {
      execSync(
        `convert -background none -density 72 "${svgPath}" -resize 660x400! "${outputPath}"`,
        { stdio: 'pipe' }
      );
      console.log(`Created: ${outputPath}`);
    } catch (error) {
      console.error(`Failed to convert SVG: ${error.message}`);
      createPlaceholderBackground();
    }
  } else {
    console.log('No dmg-background.svg found, creating placeholder...');
    createPlaceholderBackground();
  }
}

/**
 * Create a placeholder DMG background
 */
function createPlaceholderBackground() {
  const outputPath = path.join(BUILD, 'dmg-background.png');

  // Create a gradient background matching the app theme
  // Using the specified colors: #1E1E2E background
  execSync(
    `convert -size 660x400 -define gradient:angle=135 gradient:'#1E1E2E'-'#2D2D3F' \\
     -fill '#94a3b8' -gravity center -pointsize 14 -font Helvetica \\
     -annotate +0+80 "Drag FeedbackFlow to Applications" \\
     "${outputPath}"`,
    { stdio: 'pipe' }
  );
  console.log(`Created placeholder: ${outputPath}`);
}

// Main execution
console.log('========================================');
console.log('FeedbackFlow Icon Generator');
console.log('========================================\n');

generateIconset();
console.log('');
generateDmgBackground();

console.log('\n========================================');
console.log('Done!');
console.log('========================================');
