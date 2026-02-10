# CLAUDE.md - markupr

## Project Overview

markupr is a macOS menu bar app that intelligently captures developer feedback. It records your screen and voice simultaneously, then uses an intelligent post-processing pipeline to correlate transcript timestamps with the screen recording — extracting the right frames at the right moments and stitching everything into a structured, AI-ready Markdown document. The output is purpose-built for AI coding agents: every screenshot placed exactly where it belongs, every issue clearly documented.

**Version:** 1.2.0
**License:** MIT (Open Source)

## Tech Stack

- **Framework:** Electron + React + TypeScript
- **Build:** electron-vite + Vite
- **Transcription:** Local Whisper (default), OpenAI Whisper-1 API (optional cloud)
- **AI Analysis:** Anthropic Claude API (BYOK or premium tier)
- **Testing:** Vitest (356 tests)
- **Package:** electron-builder
- **Styling:** Tailwind CSS

## Architecture

```
src/
├── main/                   # Electron main process
│   ├── index.ts            # Entry point, window management, IPC orchestration
│   ├── SessionController.ts # 7-state FSM with watchdog timer
│   ├── CrashRecovery.ts    # Auto-save every 5s, crash detection, recovery dialog
│   ├── ErrorHandler.ts     # Centralized error handling
│   ├── HotkeyManager.ts    # Global hotkey registration
│   ├── MenuManager.ts      # Application menu
│   ├── TrayManager.ts      # Menu bar tray icon and status
│   ├── PermissionManager.ts # macOS permission checks
│   ├── AutoUpdater.ts      # Auto-update via electron-updater
│   ├── ai/                 # AI analysis pipeline (Claude)
│   │   ├── AIPipelineManager.ts  # Orchestrates AI analysis (free/byok/premium tiers)
│   │   ├── ClaudeAnalyzer.ts     # Claude API integration
│   │   ├── ImageOptimizer.ts     # Screenshot optimization for API
│   │   ├── StructuredMarkdownBuilder.ts # AI-enhanced markdown output
│   │   └── types.ts              # AI pipeline types
│   ├── analysis/           # Feedback analysis and categorization
│   ├── audio/              # Microphone capture, VAD
│   ├── capture/            # Screen capture via desktopCapturer
│   ├── output/             # Document generation and export
│   │   ├── MarkdownGenerator.ts  # llms.txt-inspired markdown output
│   │   ├── ExportService.ts      # Multi-format export (MD, PDF, HTML, JSON)
│   │   ├── ClipboardService.ts   # Clipboard bridge (copies file path)
│   │   ├── FileManager.ts        # Session file management
│   │   └── sessionAdapter.ts     # Type conversion utilities
│   ├── pipeline/           # Post-processing pipeline
│   │   ├── PostProcessor.ts      # Pipeline orchestrator (transcribe → analyze → extract → generate)
│   │   ├── TranscriptAnalyzer.ts # Heuristic key-moment detection
│   │   └── FrameExtractor.ts     # ffmpeg-based video frame extraction
│   ├── platform/           # Platform-specific code (Windows taskbar)
│   ├── settings/           # Persistent settings with secure API key storage
│   ├── transcription/      # Transcription tier management
│   │   ├── TierManager.ts       # Tier selection (Whisper, timer-only)
│   │   ├── WhisperService.ts     # Local Whisper integration
│   │   └── ModelDownloadManager.ts # Whisper model download from HuggingFace
│   └── windows/            # Window management (popover, taskbar)
├── renderer/               # React UI
│   ├── App.tsx             # Main component with state machine UI
│   ├── AppWrapper.tsx      # Root wrapper with providers
│   ├── components/         # UI components
│   │   ├── AnnotationOverlay.tsx    # Drawing tools (arrow, circle, rect, freehand, text)
│   │   ├── AudioWaveform.tsx        # Real-time audio level visualization
│   │   ├── CrashRecoveryDialog.tsx  # Crash recovery UI
│   │   ├── DonateButton.tsx         # Rotating donate messages
│   │   ├── ModelDownloadDialog.tsx   # Whisper model download UI
│   │   ├── Onboarding.tsx           # First-run experience
│   │   ├── SessionHistory.tsx       # Session browser
│   │   ├── SessionReview.tsx        # Post-recording review/edit
│   │   ├── SettingsPanel.tsx        # Settings configuration
│   │   └── ...                      # Other UI components
│   ├── audio/              # Renderer-side audio capture bridge
│   ├── capture/            # Renderer-side screen recording (MediaRecorder)
│   └── hooks/              # React hooks (theme, animation)
├── preload/                # Context bridge (secure IPC)
└── shared/                 # Types shared between processes
    ├── types.ts            # IPC channels, payload types, state types
    └── hotkeys.ts          # Hotkey configuration types
```

## Commands

```bash
npm run dev          # Development mode with hot reload
npm run build        # Build for production
npm run build:desktop # Build desktop app only
npm test             # Run all tests (356 tests)
npm run test:unit    # Run unit tests only
npm run test:watch   # Run tests in watch mode
npm run lint         # Lint code
npm run lint:fix     # Auto-fix lint issues
npm run typecheck    # TypeScript check
npm run package      # Package for current platform
npm run package:mac  # Package for macOS
npm run package:win  # Package for Windows
```

## Key Architecture Decisions

### State Machine
The recording session is governed by a 7-state FSM: `idle → starting → recording → stopping → processing → complete → error`. Every state has a maximum duration enforced by a watchdog timer that forces recovery if anything gets stuck.

### Post-Processing Pipeline
When recording stops, the pipeline runs: audio transcription (Whisper) → transcript analysis (key-moment detection) → video frame extraction (ffmpeg) → markdown generation. Each step degrades gracefully if a dependency is missing.

### Three-Tier Transcription
1. **OpenAI Whisper-1 API** (optional, best quality) — cloud-based, requires API key
2. **Local Whisper** (default) — runs on device, no API key needed
3. **Timer-only** (fallback) — captures screenshots on a timer when no transcription is available

### Crash Recovery
Session state auto-saves to disk every 5 seconds. On restart after a crash, the app detects the incomplete session and offers recovery.

### Clipboard Bridge
When a session completes, the **file path** to the markdown document is copied to clipboard — not the content. This is deliberate: the file persists on disk, and AI tools can read the full document including screenshots.

## IPC Communication

All main/renderer communication goes through the preload script. See `src/shared/types.ts` for IPC channel names.

## Configuration

No configuration required for first run. Local Whisper transcription works out of the box after downloading a model (~75MB for tiny, ~500MB for base).

Optional API keys (stored securely in OS keychain):
- **OpenAI** — for cloud post-session transcription
- **Anthropic** — for AI-enhanced document analysis (BYOK mode)

## Development Notes

- Menu bar popover window, frameless, always-on-top
- Screenshots saved as PNG files in session directories
- Voice activity detection uses RMS amplitude analysis
- All settings validated against JSON schema
- Secure API key storage via keytar (macOS Keychain, Windows Credential Manager) with encrypted fallback
