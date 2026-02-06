#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_MODE="foreground"
if [[ "${1:-}" == "--detached" ]]; then
  RUN_MODE="detached"
fi

echo "==> Stopping old FeedbackFlow processes"
pkill -f "FeedbackFlow.app/Contents/MacOS/FeedbackFlow" 2>/dev/null || true
pkill -f "feedbackflow" 2>/dev/null || true

echo "==> Removing previous installed artifacts"
TARGETS=(
  "/Applications/FeedbackFlow.app"
  "$HOME/Applications/FeedbackFlow.app"
  "$HOME/Library/Application Support/feedbackflow"
  "$HOME/Library/Application Support/FeedbackFlow"
  "$HOME/Library/Preferences/com.eddiesanjuan.feedbackflow.plist"
  "$HOME/Library/Preferences/com.feedbackflow.app.plist"
  "$HOME/Library/Logs/feedbackflow"
  "$HOME/Library/Logs/FeedbackFlow"
  "$HOME/Library/Caches/com.eddiesanjuan.feedbackflow"
  "$HOME/Library/Caches/com.feedbackflow.app"
  "$HOME/Library/Saved Application State/com.eddiesanjuan.feedbackflow.savedState"
)

for target in "${TARGETS[@]}"; do
  if [[ -e "$target" ]]; then
    rm -rf "$target" || true
    echo "removed: $target"
  else
    echo "absent:  $target"
  fi
done

echo "==> Running validation"
./scripts/manual-polish-test.sh --checks-only

if [[ "$RUN_MODE" == "foreground" ]]; then
  echo "==> Launching FeedbackFlow in foreground"
  npm run dev
  exit 0
fi

echo "==> Launching FeedbackFlow in detached mode"
mkdir -p "$HOME/Library/Logs/feedbackflow"
LOG_FILE="$HOME/Library/Logs/feedbackflow/dev-run.log"
: > "$LOG_FILE"

nohup npm run dev >"$LOG_FILE" 2>&1 &
PID=$!
sleep 2

if ps -p "$PID" >/dev/null 2>&1; then
  echo "Launched successfully (PID: $PID)"
  echo "Log file: $LOG_FILE"
else
  echo "Launch failed. Check log file: $LOG_FILE"
  exit 1
fi
