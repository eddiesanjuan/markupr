# FeedbackFlow v0.5.0 Release Notes

**Release Date:** 2026-02-05

## Overview

v0.5.0 is a production-hardening release that addresses 22 audit findings (14 P2, 8 P3) across security, performance, UX, and accessibility. All P0 and P1 issues were resolved in prior versions.

## Highlights

### Session Recovery
When FeedbackFlow detects an interrupted recording session from a crash or unexpected quit, it now shows a recovery modal giving you the choice to recover and process the recording or discard it.

### Multi-Monitor Screenshot Support
Screenshots now capture the display where your cursor is located, instead of always capturing the primary display. This properly supports multi-monitor setups.

### Model Download Security
Downloaded Whisper models are now verified with SHA256 checksums before being accepted. If a download is corrupted or tampered with, it will be rejected and you'll be prompted to re-download.

### Single Instance Lock
Only one instance of FeedbackFlow can now run at a time. Launching a second instance will focus the existing window instead of creating conflicting tray icons and shortcuts.

### Performance Improvements
- File writes for reports, screenshots, and state persistence are now fully async, preventing UI jank
- Spinner component optimized to avoid unnecessary re-renders

### Accessibility Improvements
- `role="application"` replaced with `role="main"` so screen reader shortcuts work properly
- Error icon semantically updated from warning triangle to error circle
- DOM root element has proper null check

### UX Polish
- Smoother view transitions (0.2s ease-out)
- Download button shows immediate loading feedback
- Transcript area in CompleteView has min/max height constraints
- Version number in Settings auto-syncs from package.json
- Popover arrow border properly visible in both light and dark themes

## Breaking Changes

None. This is a drop-in upgrade from v0.4.0.

## Technical Details

- **Files changed:** 16
- **Issues resolved:** 22 (14 P2 + 8 P3)
- **Validation:** TypeScript typecheck + production build passing
- **Security flags added:** `webSecurity: true`, `allowRunningInsecureContent: false`

## What's Next

- Multilingual transcription support (requires non-English model downloads)
- Audio device selection in Settings
- Log persistence for production debugging
