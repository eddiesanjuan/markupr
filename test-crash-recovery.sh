#!/bin/bash
# FeedbackFlow Crash Recovery Test Script
# Tests the crash recovery system by simulating crashes and verifying recovery

set -e

APP_DATA="$HOME/Library/Application Support/feedbackflow"
CRASH_RECOVERY_STORE="$APP_DATA/feedbackflow-crash-recovery.json"
PROJECT_DIR="/Users/eddiesanjuan/Projects/feedbackflow"

echo "=== FeedbackFlow Crash Recovery Test Suite ==="
echo ""

# Helper function to check store state
check_store() {
    echo "Store state:"
    cat "$CRASH_RECOVERY_STORE" | jq '.'
    echo ""
}

# Helper to create a mock incomplete session
create_mock_session() {
    local timestamp=$(date +%s)000
    local save_time=$((timestamp + 5000))

    cat > "$CRASH_RECOVERY_STORE" << EOF
{
    "activeSession": {
        "id": "test-session-$(date +%s)",
        "startTime": $timestamp,
        "lastSaveTime": $save_time,
        "feedbackItems": [
            {
                "id": "item-1",
                "timestamp": $timestamp,
                "text": "This is test feedback item 1",
                "confidence": 0.95,
                "hasScreenshot": true,
                "screenshotId": "screenshot-1"
            },
            {
                "id": "item-2",
                "timestamp": $((timestamp + 2000)),
                "text": "This is test feedback item 2",
                "confidence": 0.88,
                "hasScreenshot": false
            }
        ],
        "transcriptionBuffer": "Accumulated transcription text...",
        "sourceId": "screen:0",
        "sourceName": "Main Display",
        "screenshotCount": 1,
        "metadata": {
            "appVersion": "0.5.0",
            "platform": "darwin",
            "sessionDurationMs": 15000
        }
    },
    "crashLogs": [],
    "settings": {
        "enableAutoSave": true,
        "autoSaveIntervalMs": 5000,
        "enableCrashReporting": false,
        "maxCrashLogs": 50
    },
    "lastCleanExit": false,
    "lastExitTimestamp": $save_time
}
EOF
    echo "Mock session created"
}

# Helper to clear session
clear_session() {
    cat > "$CRASH_RECOVERY_STORE" << EOF
{
    "activeSession": null,
    "crashLogs": [],
    "settings": {
        "enableAutoSave": true,
        "autoSaveIntervalMs": 5000,
        "enableCrashReporting": false,
        "maxCrashLogs": 50
    },
    "lastCleanExit": true,
    "lastExitTimestamp": $(date +%s)000
}
EOF
    echo "Session cleared"
}

# Kill app
kill_app() {
    pkill -9 -f "electron-vite|Electron" 2>/dev/null || true
    sleep 1
}

echo "Test 1: Verify Mock Session Detection"
echo "======================================"
kill_app
create_mock_session
check_store
echo "Result: Mock session should show activeSession with 2 feedback items"
echo ""

echo "Test 2: Starting app with incomplete session"
echo "============================================="
echo "Starting app... (Check if recovery dialog appears)"
cd "$PROJECT_DIR"
npm run dev &
APP_PID=$!
sleep 8  # Wait for app to fully initialize

echo "App started (PID: $APP_PID)"
echo "Checking store state after startup..."
check_store
echo ""

echo "Test 3: Force-kill (SIGKILL) simulation"
echo "========================================"
echo "Killing app with SIGKILL..."
kill_app

echo "Checking store state after force-kill..."
check_store
echo "Result: lastCleanExit should be false (crash simulated)"
echo ""

echo "Test 4: Clean exit verification setup"
echo "======================================"
clear_session
check_store
echo "Starting app with clean state..."
cd "$PROJECT_DIR"
npm run dev &
sleep 5
echo "Checking initial state..."
check_store
echo ""

echo "Test completed. Review output above for results."
echo ""
echo "Manual tests needed:"
echo "1. Start recording in the app"
echo "2. Wait 5+ seconds for auto-save"
echo "3. Force kill with: pkill -9 -f Electron"
echo "4. Restart app and verify recovery dialog appears"
