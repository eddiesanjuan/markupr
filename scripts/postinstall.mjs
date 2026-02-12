#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function isRailwayEnvironment() {
  return Object.keys(process.env).some((key) => key.startsWith('RAILWAY_'));
}

function run(command, args) {
  const commandLabel = [command, ...args].join(' ');
  console.log(`[postinstall] Running: ${commandLabel}`);

  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });

  if (result.error) {
    console.error(`[postinstall] Failed to execute "${commandLabel}":`, result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[postinstall] Command failed: ${commandLabel} (exit ${result.status ?? 1})`);
    process.exit(result.status ?? 1);
  }
}

if (process.env.MARKUPR_SKIP_ELECTRON_POSTINSTALL === '1' || isRailwayEnvironment()) {
  console.log('[postinstall] Skipping Electron native rebuild in Railway/skip mode.');
  process.exit(0);
}

run('npx', ['electron-builder', 'install-app-deps']);
run('npx', ['electron-rebuild']);
