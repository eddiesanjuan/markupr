# Changelog

All notable changes to FeedbackFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-02-04

### Highlights
**FeedbackFlow Initial Public Release** - Voice-to-AI feedback for developers. Free and open source.

### Added
- **Bulletproof State Machine**: 7-state finite state machine with watchdog timer - can never get stuck
- **Menu Bar Native**: Runs entirely from the menu bar (no dock icon)
- **Three-Tier Transcription**: Deepgram (premium) -> Whisper (default) -> Timer fallback
- **Crash Recovery**: 5-second auto-save ensures no work is lost
- **Offline Mode**: Local Whisper transcription works without internet
- **Platform-Aware Hotkeys**: Cmd on Mac, Ctrl on Windows - just works
- **Donate Button**: Rotating messages for supporting the developer
- **Windows Taskbar Integration**: Overlay icons and toolbar buttons

### Changed
- Default transcription now uses local Whisper (no API key required)
- Improved documentation with comprehensive guides
- Enhanced stability across all platforms

### Technical
- State machine: IDLE -> STARTING -> RECORDING -> STOPPING -> PROCESSING -> REVIEWING -> EXPORTING
- Watchdog monitors state transitions with configurable timeouts
- Recovery manager handles unexpected exits gracefully

## [0.4.0] - 2026-02-02

### Added
- **Export Options**: PDF, HTML, and JSON export formats
- **AI-Powered Categorization**: Automatic feedback categorization (Bug, Feature, UX)
- **Crash Recovery**: Automatic session recovery after unexpected crashes
- **Auto-Updater**: Seamless application updates with release notes
- **Keyboard Shortcuts Panel**: In-app cheatsheet with customization
- **Session History Browser**: View and manage past recording sessions
- **Multi-Monitor Support**: Full support for multiple displays with source preview
- **Screenshot Annotations**: Arrow, circle, rectangle, freehand, and text tools
- **Audio Waveform Visualization**: Real-time audio level display
- **Countdown Timer**: Optional countdown before recording starts
- **Clarification Questions**: AI-generated follow-up questions for unclear feedback
- **Native macOS Menu Bar**: Full menu bar integration

### Changed
- Improved Settings panel with live preview
- Enhanced onboarding wizard with better guidance
- Better error messages and user feedback
- Upgraded to Electron 28

### Fixed
- Fixed screenshot timing during rapid speech
- Fixed hotkey registration on Windows
- Fixed memory leak during long sessions
- Fixed clipboard copy on some macOS versions

## [0.3.0] - 2026-01-15

### Added
- **Real-time Transcription Preview**: See transcription as you speak
- **Intelligent Screenshot Timing**: Voice activity detection triggers captures
- **Tray Icon States**: Visual feedback for idle/recording/processing/error
- **Settings Panel**: Comprehensive configuration UI
- **Session Review**: Edit, reorder, and delete feedback items before export
- **Theme System**: Dark, light, and system theme options

### Changed
- Improved Deepgram integration with better error handling
- Enhanced Markdown output format for AI consumption
- Better screenshot compression

### Fixed
- Fixed audio capture on Windows
- Fixed window selector thumbnail generation
- Fixed crash when Deepgram connection drops

## [0.2.0] - 2026-01-01

### Added
- **Window Selector**: Choose specific windows or screens to capture
- **Manual Screenshot**: Hotkey to capture screenshots on demand
- **Output Directory Setting**: Choose where sessions are saved
- **Clipboard Integration**: Auto-copy summary to clipboard

### Changed
- Improved UI responsiveness
- Better error messages

### Fixed
- Fixed hotkey conflicts with system shortcuts
- Fixed screenshot resolution on Retina displays

## [0.1.0] - 2025-12-15

### Added
- Initial release
- Voice narration capture with Deepgram transcription
- Automatic screenshot capture on voice pauses
- Markdown document generation
- Global hotkey to start/stop recording (`Cmd+Shift+F`)
- System tray icon
- Basic settings (API key configuration)

---

## Version History Summary

| Version | Date | Highlights |
|---------|------|------------|
| 1.0.0 | 2026-02-04 | **Initial Public Release** - Bulletproof state machine, offline Whisper |
| 0.4.0 | 2026-02-02 | Export formats, crash recovery, auto-updater |
| 0.3.0 | 2026-01-15 | Transcription preview, intelligent capture, settings |
| 0.2.0 | 2026-01-01 | Window selector, manual screenshots |
| 0.1.0 | 2025-12-15 | Initial scaffold |

[Unreleased]: https://github.com/eddiesanjuan/feedbackflow/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/eddiesanjuan/feedbackflow/compare/v0.4.0...v1.0.0
[0.4.0]: https://github.com/eddiesanjuan/feedbackflow/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/eddiesanjuan/feedbackflow/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/eddiesanjuan/feedbackflow/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/eddiesanjuan/feedbackflow/releases/tag/v0.1.0
