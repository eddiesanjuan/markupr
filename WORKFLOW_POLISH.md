# Workflow Polish - FeedbackFlow

## Summary

Implemented seamless completion flow for the core use case: record feedback, get file path, paste into AI agent.

## Changes Made

### 1. Auto-save markdown to file
- Reports now save to `~/FeedbackFlow/` directory
- Filename format: `session-YYYY-MM-DD-HHMM.md` (e.g., `session-2026-02-05-0615.md`)
- Added `reportPath` field to SessionData to track saved file location

**Files modified:**
- `src/main/services/SessionController.ts` - Added `saveMarkdownToFile()` method, updated `processRecording()` to call it

### 2. Auto-copy file path to clipboard
- When transcription completes, the file PATH (not content) is automatically copied to clipboard
- User can immediately paste into their AI agent without any clicks

**Files modified:**
- `src/main/services/SessionController.ts` - Added clipboard.writeText() in saveMarkdownToFile()

### 3. Recent sessions dropdown in menu bar
- Created `SessionHistory` service to track last 5 completed sessions
- Tray menu now shows "Recent Sessions" submenu
- Click any session = copy its file path to clipboard

**Files created:**
- `src/main/services/SessionHistory.ts` - New service for session history persistence

**Files modified:**
- `src/main/services/index.ts` - Export SessionHistory
- `src/main/tray.ts` - Added recent sessions submenu, `updateRecentSessions()` function
- `src/main/index.ts` - Initialize SessionHistory, update tray on session completion

### 4. Clear completion state in UI
- CompleteView now shows explicit file path: `~/FeedbackFlow/session-2026-02-05-0615.md`
- Header briefly shows "Report saved! Path copied" on completion
- "Copy Markdown" button changed to "Copy Path" (re-copies path if needed)

**Files modified:**
- `src/renderer/components/CompleteView.tsx` - Show reportPath, auto-copy notification, updated button
- `src/renderer/types/api.d.ts` - Added `reportPath` to SessionData type

## The New Workflow

1. User starts recording from menu bar
2. Tests their app, speaks feedback, Cmd+Shift+S for screenshots
3. Stops recording
4. Processing... transcription runs
5. **Complete!** - File auto-saved, path auto-copied
6. User pastes path into AI agent (e.g., Claude Code)
7. Done - user forgets about it

## File Locations

- Reports: `~/FeedbackFlow/session-*.md`
- Session history: `~/Library/Application Support/feedbackflow/state/recent-sessions.json`
- Audio/screenshots: `~/Library/Application Support/feedbackflow/recordings/` and `/screenshots/`
