# Changelog

All notable changes to FeedbackFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-02-05

### Added
- Session recovery modal - users are now prompted to recover interrupted recordings
- Single instance lock - prevents multiple conflicting app instances
- SHA256 checksum verification for downloaded Whisper models
- Dynamic version display in Settings (auto-synced from package.json)
- Download button loading state with spinner feedback
- Explicit `webSecurity: true` and `allowRunningInsecureContent: false` in Electron config

### Changed
- Screenshot capture now targets the display under the cursor (multi-monitor support)
- Error icon updated from warning triangle to x-circle for better semantic clarity
- View transition animation eased from 0.15s to 0.2s for smoother feel
- `role="application"` changed to `role="main"` for better screen reader compatibility
- Keyboard shortcuts now use Unicode characters (⌘⇧) instead of HTML entities
- Language selector constrained to English (matches English-only model files)
- Popover arrow border layering fixed for proper visibility in both themes
- CompleteView transcript area now has min/max height constraints (100px/200px)

### Performance
- MacSpinner segment array is now static (no longer re-created on each render)
- Synchronous file writes converted to async (`fs.promises.writeFile`) for:
  - Markdown report saving (SessionController)
  - Screenshot saving (ScreenshotService)
  - State persistence flush (StateStore)
  - Only `destroy()` retains sync writes for exit safety

### Removed
- Unused `stateTimeout` member and `clearStateTimeout()` from SessionController
- Non-English language options (temporarily, pending multilingual model support)

### Fixed
- DOM root element now has proper null check with descriptive error
- ffmpeg audio input documented as macOS system default device

## [0.4.0] - 2026-02-05

### Added
- Sandbox enabled in Electron BrowserWindow
- Comprehensive security audit fixes (P0/P1)

## [0.3.1] - 2026-02-05

### Fixed
- P0 critical fixes from dual security audit
- IPC hardening - electronAPI exposure trimmed
- `setWindowOpenHandler` for safe external URL opening
- Watchdog timeouts now perform cleanup actions
- `reset()` properly stops recording and ends screenshot session
- Report filenames include seconds + unique ID to prevent collisions
- Recorder early-exit detection with 300ms grace period
- Screenshot resolution capped at 1920px to prevent OOM

## [0.3.0] - 2026-02-05

### Added
- Native macOS polish: theme, transitions, accessibility
- Global keyboard shortcuts (Cmd+Shift+F, Cmd+Shift+S)
- Error boundary component
- Operation lock to prevent race conditions

## [0.1.0] - 2024-XX-XX

Initial public release.
