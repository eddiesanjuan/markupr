#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_DEV=1
if [[ "${1:-}" == "--checks-only" ]]; then
  RUN_DEV=0
fi

echo "==> Typecheck"
npm run typecheck

echo "==> Focused regression tests"
npx vitest run \
  tests/markdownGenerator.test.ts \
  tests/output.test.ts \
  tests/unit/sessionController.test.ts \
  tests/integration/sessionFlow.test.ts

if [[ "$RUN_DEV" -eq 0 ]]; then
  echo "==> Checks complete (skipped app launch)"
  exit 0
fi

echo "==> Launching FeedbackFlow"
echo "Hotkeys: Cmd+Shift+F (start/stop), Cmd+Shift+S (manual screenshot)"
echo "Voice cue during recording: \"take screenshot\""
npm run dev
