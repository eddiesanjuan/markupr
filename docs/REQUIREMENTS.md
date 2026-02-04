# FeedbackFlow - Functional Requirements

> Extracted from master spec: SKILL.md (feedbackflow-ship orchestrator)

---

## 1. Core Mission

FeedbackFlow is a macOS menu bar application for capturing voice-based developer feedback. Users speak naturally while testing applications, and FeedbackFlow produces AI-ready Markdown output with auto-captured screenshots.

---

## 2. Critical Requirements (NON-NEGOTIABLE)

These requirements are marked as "MEMORIZE THESE" in the master spec:

| ID | Requirement | Rationale |
|----|-------------|-----------|
| CR-01 | **MUST work without any API keys** out of the box | Local Whisper is the default transcription engine |
| CR-02 | **MUST be menu bar native** | No dock icon, no floating windows - pure menu bar presence |
| CR-03 | **MUST have donate button** with rotating funny messages | Support open source via Ko-fi |
| CR-04 | **MUST be open source ready** | MIT license, comprehensive documentation |
| CR-05 | **MUST be bulletproof** | No stuck states, graceful error handling, crash recovery |

---

## 3. Functional Requirements

### 3.1 Recording & Transcription

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-REC-01 | Start/stop voice recording via menu bar click or global hotkey | Critical |
| FR-REC-02 | Visual feedback during recording (icon state, waveform optional) | Critical |
| FR-REC-03 | Maximum recording duration of 30 minutes with auto-stop | High |
| FR-REC-04 | Support for pause/resume during recording | Medium |

### 3.2 Transcription Tiers

Three-tier transcription system for reliability and offline capability:

| Tier | Engine | Requirement | When Used |
|------|--------|-------------|-----------|
| **Tier 1** | Deepgram Nova-3 | Optional, API key required | Best quality, when configured |
| **Tier 2** | Local Whisper | **DEFAULT**, no API key | Out of the box experience |
| **Tier 3** | macOS Dictation | Emergency fallback | When Whisper fails |

**Tier Selection Requirements:**
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-TRANS-01 | Default to local Whisper (no API key needed) | Critical |
| FR-TRANS-02 | Allow optional Deepgram configuration for better quality | High |
| FR-TRANS-03 | Automatic fallback: Deepgram -> Whisper -> macOS Dictation | Critical |
| FR-TRANS-04 | Mid-session tier fallback on failure (don't lose recording) | Critical |
| FR-TRANS-05 | Whisper model download manager with progress UI | High |
| FR-TRANS-06 | Model size approximately 150MB (whisper-base default) | High |

### 3.3 Screenshot Capture

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-SS-01 | Automatic screenshot capture during recording | High |
| FR-SS-02 | Silence detection triggers screenshot (when Deepgram not available) | High |
| FR-SS-03 | Manual screenshot trigger via hotkey | Medium |
| FR-SS-04 | Screenshots embedded in final Markdown output | Critical |

#### Screenshot Capture Policy

**Silence Detection Trigger:**
- 1.5 second pause in speech triggers capture consideration
- Audio level must drop below threshold for full 1.5s

**Throttling:**
- Maximum 1 screenshot per 10 seconds
- Prevents screenshot spam during natural pauses
- Timer resets after each capture

**Permission Fallback:**
- If Screen Recording permission denied: skip screenshots, continue audio recording
- User notified of degraded mode with link to System Settings
- No repeated permission prompts - re-request only on next explicit user action

### 3.4 Output Generation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-OUT-01 | Generate AI-ready Markdown from transcription | Critical |
| FR-OUT-02 | Include embedded screenshots in output | Critical |
| FR-OUT-03 | Copy to clipboard on completion | Critical |
| FR-OUT-04 | Save to configurable output directory | High |
| FR-OUT-05 | Timestamp and metadata in output | Medium |

---

## 4. State Machine Requirements

### 4.1 Session States

| State | Description | Max Duration | Timeout Action |
|-------|-------------|--------------|----------------|
| `idle` | Ready to record | Indefinite | N/A |
| `starting` | Initializing recording | 5 seconds | Return to idle |
| `recording` | Actively recording | 30 minutes | Auto-stop |
| `stopping` | Finalizing recording | 3 seconds | Force to processing |
| `processing` | Transcribing audio | 10s + 2× audio duration | Complete with partial |
| `complete` | Ready to copy/save | Indefinite (user action) | N/A |
| `error` | Error occurred | N/A | Show recovery options |

### 4.2 State Machine Guarantees

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-SM-01 | Every state has a maximum timeout | Critical |
| FR-SM-02 | Every async operation wrapped with timeout fallback | Critical |
| FR-SM-03 | Watchdog timer monitors state age | Critical |
| FR-SM-04 | State persisted to disk every 5 seconds | Critical |
| FR-SM-05 | `cancel()` from any state returns to `idle` | Critical |
| FR-SM-06 | No state can become "stuck" | Critical |

### 4.3 State Transitions

```
idle -> starting -> recording -> stopping -> processing -> complete -> idle
  ^                    |            |            |             |
  |                    v            v            v             v
  +<------ cancel() --+------------+------------+-------------+
  |
  +<------ error recovery (from any state)
```

---

## 5. Crash Recovery Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-CR-01 | Detect interrupted sessions on app startup | Critical |
| FR-CR-02 | Show recovery dialog with options: Recover / Discard | Critical |
| FR-CR-03 | Recover audio, transcripts, screenshots from interrupted session | Critical |
| FR-CR-04 | Clear state after successful recovery or explicit discard | High |
| FR-CR-05 | State persistence every 5 seconds during active session | Critical |
| FR-CR-06 | Survive force-kill (kill -9) scenarios | High |

---

## 6. Menu Bar UI Requirements

### 6.1 Menu Bar Behavior

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-MB-01 | Pure menu bar presence (no dock icon) | Critical |
| FR-MB-02 | NSPopover-style popover on tray click | Critical |
| FR-MB-03 | Instant popover open/close | High |
| FR-MB-04 | Popover attached to tray icon position | High |

### 6.2 Icon States

| State | Icon Appearance | Animation |
|-------|-----------------|-----------|
| `idle` | Gray microphone | None |
| `recording` | Red microphone | Pulse animation |
| `processing` | Processing icon | Spin animation |
| `complete` | Green checkmark | None (brief display) |
| `error` | Orange warning | None |

### 6.3 Popover Layouts

| Layout | Content | When Shown |
|--------|---------|------------|
| Idle | Start button, recent sessions, donate button | Default state |
| Recording | Stop button, duration, waveform (optional) | During recording |
| Processing | Progress indicator, "Transcribing..." | After stopping |
| Complete | Preview, copy button, save button | After processing |
| Settings | Configuration options | User navigates |

---

## 7. Settings Requirements

| ID | Setting | Default | Priority |
|----|---------|---------|----------|
| FR-SET-01 | Transcription tier selection | Local Whisper | Critical |
| FR-SET-02 | Deepgram API key (optional) | Empty | High |
| FR-SET-03 | Global hotkey configuration | Cmd+Shift+R | High |
| FR-SET-04 | Output location | ~/Documents/FeedbackFlow | High |
| FR-SET-05 | Theme (system/light/dark) | System | Medium |
| FR-SET-06 | Launch at login | Off | Medium |
| FR-SET-07 | Settings persist across app restarts | Required | Critical |

---

## 8. Donate Button Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-DON-01 | Donate button visible in idle popover | High |
| FR-DON-02 | Link to Ko-fi (https://ko-fi.com/eddiesanjuan) | High |
| FR-DON-03 | Rotating messages on each app launch | High |
| FR-DON-04 | Store last message index in settings | Medium |
| FR-DON-05 | Subtle styling, not intrusive | High |

**Rotating Messages (use exactly):**
1. "Buy Eddie a Coffee"
2. "Buy Eddie Legos"
3. "Buy Eddie Golf Balls"
4. "Buy Eddie Tacos"
5. "Buy Eddie a Plant"
6. "Buy Eddie Socks"
7. "Fund Eddie's Caffeine Addiction"
8. "Support Open Source Chaos"
9. "Keep Eddie Coding"
10. "Taco Tuesday Sponsor"

---

## 9. Open Source Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-OS-01 | MIT License | Critical |
| FR-OS-02 | Comprehensive README with screenshots | Critical |
| FR-OS-03 | CONTRIBUTING.md with setup instructions | High |
| FR-OS-04 | SECURITY.md for vulnerability reporting | High |
| FR-OS-05 | CODE_OF_CONDUCT.md | Medium |
| FR-OS-06 | GitHub issue/PR templates | High |
| FR-OS-07 | CI/CD workflows (lint, test, build, release) | High |
| FR-OS-08 | FUNDING.yml for Ko-fi | Medium |

---

## 10. Distribution Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-DIST-01 | DMG installer for macOS | Critical |
| FR-DIST-02 | Code signing (when certificates available) | High |
| FR-DIST-03 | Notarization for Gatekeeper | High |
| FR-DIST-04 | DMG background image with drag-to-Applications | Medium |
| FR-DIST-05 | GitHub Releases with checksums | High |

---

## 11. Non-Functional Requirements

### 11.1 Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-PERF-01 | Popover opens instantly | < 100ms |
| NFR-PERF-02 | Recording starts without delay | < 500ms |
| NFR-PERF-03 | Local transcription completes | < 2x recording duration |
| NFR-PERF-04 | Memory usage during idle | < 100MB |

### 11.2 Reliability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-REL-01 | Zero stuck states | 100% recovery |
| NFR-REL-02 | Crash recovery success rate | > 95% |
| NFR-REL-03 | Offline functionality | Full (with Whisper) |

### 11.3 Usability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-UX-01 | First-time user to first feedback | < 5 minutes |
| NFR-UX-02 | Zero confusion points in FTUE | 0 |
| NFR-UX-03 | No API key required for basic use | Mandatory |

---

## 12. Test Requirements

### 12.1 Required Test Coverage

| Category | Tests Required |
|----------|----------------|
| State Transitions | All state -> state paths |
| Timeouts | Every state timeout triggers correctly |
| Offline Mode | Full functionality without internet |
| Crash Recovery | Recovery from every state |
| First-Time UX | Download to first feedback < 5 min |

### 12.2 QA Test Matrix

| From State | Action | Expected To State |
|------------|--------|-------------------|
| idle | start() | starting |
| starting | success | recording |
| starting | timeout (5s) | idle |
| recording | stop() | stopping |
| recording | timeout (30min) | stopping |
| stopping | success | processing |
| stopping | timeout (3s) | processing |
| processing | success | complete |
| processing | timeout (10s) | complete |
| complete | reset() | idle |
| any | cancel() | idle |

---

## 13. Product Hunt Launch Requirements

| ID | Requirement | Specification |
|----|-------------|---------------|
| FR-PH-01 | Hero image | 1270x760 pixels |
| FR-PH-02 | Gallery images | 4-5 screenshots |
| FR-PH-03 | Tagline | "Voice-to-AI feedback for developers. Free, open source." (max 60 chars) |
| FR-PH-04 | Description | "Capture voice feedback while testing apps. Speak naturally, get AI-ready Markdown with auto-captured screenshots. Works offline, no API key needed." (max 260 chars) |

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-03 | Initial extraction from feedbackflow-ship spec |
