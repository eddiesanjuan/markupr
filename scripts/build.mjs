#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const siteDir = join(repoRoot, 'site');
const distDir = join(repoRoot, 'dist');

function isRailwayEnvironment() {
  return Object.keys(process.env).some((key) => key.startsWith('RAILWAY_'));
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    cwd: repoRoot,
    shell: true,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!isRailwayEnvironment()) {
  run('npx', ['electron-vite', 'build']);
  process.exit(0);
}

console.log('[build] Railway environment detected. Building landing page artifact from /site.');
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const sourceIndex = join(siteDir, 'index.html');
if (!existsSync(sourceIndex)) {
  console.error('[build] Missing site/index.html; cannot produce landing artifact.');
  process.exit(1);
}

cpSync(sourceIndex, join(distDir, 'index.html'));

const optionalAssetsDir = join(siteDir, 'assets');
if (existsSync(optionalAssetsDir)) {
  cpSync(optionalAssetsDir, join(distDir, 'assets'), { recursive: true });
}

console.log('[build] Landing page artifact ready at /dist/index.html');
