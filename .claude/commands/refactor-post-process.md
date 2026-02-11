# Architectural Refactor: Post-Process Pipeline

## IDENTITY LOCK
You are an **ORCHESTRATOR**. You COMMAND agent teams. You do NOT:
- Write application code yourself
- Implement features directly
- Fix bugs yourself
- Test anything yourself

**Before EVERY action, ask: "Am I about to do work myself?" If yes → STOP → spawn an agent team.**

Use Claude's agent teams feature (Opus 4.6) to parallelize work across specialized agents.

---

## THE VISION

markupr currently captures screenshots in real-time during recording using silence detection. This must change to a **post-processing architecture**:

### During Recording (SIMPLE)
- Record screen video (already works via ScreenRecordingRenderer → MediaRecorder → webm)
- Record microphone audio (already works via AudioCapture)
- Show recording UI (timer, waveform, pause/resume)
- **NO screenshots during recording**
- **NO transcription during recording**
- **NO silence detection driving captures**

### After Stop (NEW PIPELINE)
1. Save video + audio files to session folder (already partially works)
2. Run Whisper on saved audio → timestamped transcript segments
3. AI analyzes transcript → identifies key moments worth screenshotting (pause points, topic changes, specific UI mentions)
4. Extract frames from video at those timestamps using ffmpeg
5. Associate frames with transcript segments
6. Generate structured Markdown report with embedded frames
7. Copy report path to clipboard

---

## CURRENT STATE (What exists)

### Keep (working, needed):
- `src/renderer/capture/ScreenRecordingRenderer.ts` — MediaRecorder video capture ✅
- `src/main/audio/AudioCapture.ts` — mic audio capture ✅
- `src/main/SessionController.ts` — state machine (needs modification, not replacement)
- `src/main/output/` — FileManager, MarkdownGenerator, ExportService, ClipboardService ✅
- `src/main/ai/ClaudeAnalyzer.ts` — Claude analysis (needs adaptation for new pipeline)
- `src/main/transcription/WhisperService.ts` — local Whisper (needs adaptation: batch mode instead of streaming)
- `src/main/transcription/ModelDownloadManager.ts` — model downloads ✅
- `src/main/CrashRecovery.ts` — crash recovery ✅
- `src/main/ErrorHandler.ts` — error handling ✅
- `src/main/AutoUpdater.ts` — auto updater ✅
- `src/main/HotkeyManager.ts` — hotkeys ✅
- `src/main/TrayManager.ts` — tray icon ✅
- All renderer UI components (with modifications)

### Remove:
- `src/main/capture/IntelligentCapture.ts` — real-time screenshot trigger (568 lines, DELETE)
- `src/main/capture/ScreenCapture.ts` — real-time desktop screenshot capture (DELETE)
- `src/main/transcription/SilenceDetector.ts` — silence detection for triggers (DELETE)
- `src/main/transcription/TierManager.ts` — real-time tier management (DELETE or heavily simplify)
- All real-time transcription streaming logic
- All screenshot-during-recording logic in SessionController

### Create NEW:
- `src/main/pipeline/PostProcessor.ts` — orchestrates the post-processing pipeline
- `src/main/pipeline/FrameExtractor.ts` — uses ffmpeg to extract frames from video at timestamps
- `src/main/pipeline/TranscriptAnalyzer.ts` — analyzes transcript to find key moments for frame extraction
- `src/main/pipeline/index.ts` — barrel export
- Update `src/main/transcription/WhisperService.ts` — add batch transcription mode (transcribe full audio file, return timestamped segments)

### Modify:
- `src/main/SessionController.ts` — remove screenshot buffer, simplify to: start → record (video+audio only) → stop → post-process
- `src/main/index.ts` — rewire session lifecycle to use PostProcessor after stop
- `src/main/output/MarkdownGenerator.ts` — adapt to work with extracted frames instead of captured screenshots
- `src/renderer/App.tsx` — update UI: remove real-time transcript display during recording, add post-processing progress indicator
- `src/renderer/components/TranscriptionPreview.tsx` — change to show transcript AFTER processing, not during
- `src/renderer/components/TranscriptionTierSelector.tsx` — simplify (just Whisper model selection, no tier switching)
- `src/shared/types.ts` — update types for new pipeline
- `src/preload/index.ts` — update IPC channels for post-processing events

---

## TECHNICAL REQUIREMENTS

### Frame Extraction
- Use ffmpeg (via child_process exec, NOT an npm package — ffmpeg is already required by markupr)
- Extract frames as PNG at specific timestamps: `ffmpeg -ss <timestamp> -i <video.webm> -frames:v 1 -q:v 2 <output.png>`
- Handle case where ffmpeg is not installed (graceful degradation: no frames, transcript-only output)
- Optimize: batch extract multiple frames in one ffmpeg call if possible

### Whisper Batch Mode
- WhisperService already has `transcribeSamples()` for batch processing
- Need to add: load audio file from disk → convert to Float32Array at 16kHz mono → transcribe → return timestamped segments
- Consider: for large files, split into chunks and process sequentially to manage memory

### Transcript Analysis for Key Moments
- Use local heuristics first (don't require AI for frame selection):
  - Natural pauses > 1.5 seconds between speech segments
  - Topic changes (detect via keyword shifts)
  - Every N seconds as baseline (e.g., every 15-20 seconds minimum)
  - Cap at ~20 frames per session to keep output manageable
- If Claude API key is available, use Claude to pick better moments (premium feature)

### Session State Machine Updates
States should be:
```
idle → starting → recording → stopping → processing → complete → idle
```
The `processing` state now actually does heavy work (transcription + frame extraction + report generation) instead of just saving files. Show progress updates to the renderer.

### IPC Updates
New channels needed:
- `markupr:processing:progress` — send progress updates (% complete, current step name)
- `markupr:processing:transcript-ready` — transcript available for preview
- `markupr:processing:frames-ready` — frames extracted
- `markupr:processing:complete` — full pipeline done

### Branding Cleanup
All feedbackflow references have been removed from source code. The only remaining reference is `LEGACY_KEYTAR_SERVICES` in SettingsManager.ts for API key migration from old installs.

---

## DEPLOYMENT STRATEGY

### Wave 1: Foundation (parallel agents)
- **Agent A**: Create `src/main/pipeline/` module (PostProcessor, FrameExtractor, TranscriptAnalyzer, index.ts)
- **Agent B**: Modify WhisperService to add batch file transcription method
- **Agent C**: Clean up removals (delete IntelligentCapture, ScreenCapture, SilenceDetector; gut TierManager)

### Wave 2: Integration (parallel agents, depends on Wave 1)
- **Agent D**: Rewire SessionController — remove screenshot logic, integrate PostProcessor after stop
- **Agent E**: Update main/index.ts — new IPC channels, post-processing lifecycle
- **Agent F**: Update renderer (App.tsx, components) — processing progress UI, remove real-time transcript

### Wave 3: Polish (parallel agents, depends on Wave 2)
- **Agent G**: Update MarkdownGenerator and output pipeline for extracted frames
- **Agent H**: Update types.ts, preload/index.ts, branding cleanup
- **Agent I**: Update/fix tests for new architecture

### Wave 4: Validation
- **Agent J**: Full code review — ensure no dead imports, no broken references, type-check passes
- **Agent K**: Verify the complete pipeline flow end-to-end in code review

**SYNTHESIS between each wave.** Review agent outputs, resolve conflicts, then proceed.

---

## CONSTRAINTS
- Electron app — main process (Node.js) does heavy work, renderer shows UI
- All IPC goes through preload contextBridge (context isolation enabled)
- Must maintain the bulletproof state machine philosophy (timeouts, watchdog, crash recovery)
- ffmpeg dependency: check for availability, graceful fallback if missing
- Keep the session folder structure: `~/markupr/sessions/<timestamp>/` with markdown, screenshots/, audio, video
- Must still work fully offline (Whisper local, no cloud required)
- Premium Claude analysis is optional enhancement, not required for core flow
- macOS is primary platform, Windows secondary

---

## SUCCESS CRITERIA
1. `npm run build` succeeds with zero TypeScript errors
2. Recording captures ONLY video + audio (no screenshots during recording)
3. After stop, post-processing pipeline runs: transcribe → analyze → extract frames → generate report
4. Output folder contains: `feedback.md`, `screenshots/` (extracted frames), `session-recording.webm`, `session-audio.*`
5. No Deepgram references anywhere in source
6. No real-time transcription during recording
7. All tests updated and passing (or removed if testing deleted code)
8. Branding: zero `feedbackflow` references in runtime code paths
