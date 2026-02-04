# FeedbackFlow Bulletproof Design Specification

> **Mission**: Create a macOS menu bar app for developers to capture voice feedback while testing apps. It must work perfectly for EVERYONE, EVERYWHERE, with ZERO friction.

**Status**: DESIGN COMPLETE - Ready for Implementation
**Last Updated**: 2026-02-03
**Author**: Eddie San Juan (via Orchestrator Legion)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Issues Audit](#2-current-issues-audit)
3. [Architecture](#3-architecture)
4. [Menu Bar UX](#4-menu-bar-ux)
5. [Donate System](#5-donate-system)
6. [Open Source Setup](#6-open-source-setup)
7. [Critical Path](#7-critical-path)
8. [Testing Strategy](#8-testing-strategy)

---

## 1. Executive Summary

### Vision
FeedbackFlow is a **free, open-source** macOS menu bar app that transforms how developers capture feedback. Press a hotkey, speak naturally, and get AI-ready Markdown with auto-captured screenshots.

### Key Principles

| Principle | Implementation |
|-----------|----------------|
| **Zero Friction** | Works out of the box with local Whisper - no API key required |
| **Bulletproof** | State machine can NEVER get stuck; every state has timeout recovery |
| **Menu Bar Native** | Lives in menu bar like Claude Status app - minimal, clean, professional |
| **Community First** | Easy to fork, improve, contribute; rotating donate button for sustainability |

### Current vs. Target State

| Aspect | Current | Target |
|--------|---------|--------|
| Window Type | Floating window app | Menu bar native |
| API Requirement | Deepgram required (friction) | Local Whisper default, Deepgram optional |
| State Handling | Can get stuck on "Processing" | Bulletproof state machine with timeouts |
| Distribution | Manual builds | Automated CI/CD with notarization |
| Sustainability | None | Donate button with rotating messages |

---

## 2. Current Issues Audit

### 2.1 Critical Issues (Blocking)

#### CRITICAL-001: Session Stuck on "Processing"
**Location**: `src/main/SessionController.ts`, lines 349-380
**Root Cause**: The `stop()` method transitions to `processing` state but has no timeout mechanism. If `cleanupServices()` or `processPendingScreenshots()` hangs, the app is stuck forever.

```typescript
// CURRENT (BROKEN):
this.transition('processing');
this.cleanupServices();  // Can hang if WebSocket doesn't close
this.processPendingScreenshots();  // Can hang if many screenshots
this.transition('complete');  // Never reached if above hangs
```

**Impact**: Users must force-quit the app. Data may be lost.
**Fix**: Add timeout wrapper around processing with fallback to complete state.

#### CRITICAL-002: Deepgram API Key Required
**Location**: `src/main/TranscriptionService.ts`, lines 122-137
**Root Cause**: `configure()` throws if no API key. No fallback transcription.

**Impact**: Users can't use app without signing up for Deepgram.
**Fix**: Implement local Whisper fallback as default mode.

#### CRITICAL-003: Window-Based App, Not Menu Bar Native
**Location**: `src/main/index.ts`, lines 89-155
**Root Cause**: Uses `BrowserWindow` as primary interface instead of menu bar popover.

**Impact**: Feels like a utility app, not a professional tool. Takes dock space.
**Fix**: Redesign as pure menu bar app with popover UI.

### 2.2 High Priority Issues

#### HIGH-001: No State Recovery from Errors
**Location**: `src/main/SessionController.ts`, state machine definition
**Issue**: If transcription service fails mid-session, state transitions to error but no automatic recovery.

#### HIGH-002: Missing Processing Timeout
**Location**: `src/main/SessionController.ts`, `stop()` method
**Issue**: Processing state has no maximum duration. Could wait forever for WebSocket close.

#### HIGH-003: No Offline Mode
**Issue**: App is useless without internet connection. Should buffer locally and sync later or use local Whisper.

#### HIGH-004: No Graceful Transcription Degradation
**Location**: `src/main/TranscriptionService.ts`
**Issue**: If Deepgram fails, entire transcription fails. Should fall back to local options.

### 2.3 Medium Priority Issues

#### MED-001: Tray Manager Uses Placeholder Icons
**Location**: `src/main/TrayManager.ts`, lines 105-178
**Issue**: Falls back to SVG data URLs when icon files don't exist. Works but not ideal.

#### MED-002: Settings Not Persisted Correctly
**Location**: `src/main/settings/SettingsManager.ts`
**Issue**: Some settings don't survive app restart. Need verification.

#### MED-003: Crash Recovery Dialog Not Shown
**Issue**: Crash recovery infrastructure exists but dialog may not trigger reliably.

#### MED-004: No Linux Support in README
**Issue**: README mentions Linux but no testing on Linux.

### 2.4 Low Priority Issues

#### LOW-001: Console Logging Too Verbose
**Issue**: Lots of debug logging in production builds.

#### LOW-002: Missing Keyboard Shortcut Help
**Issue**: Help dialog exists but isn't easily discoverable.

#### LOW-003: Window Position Not Remembered
**Issue**: Window appears in default position each time.

---

## 3. Architecture

### 3.1 Bulletproof State Machine

The session lifecycle is governed by a finite state machine that can **NEVER get stuck**.

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                    STATE MACHINE                          │
                    │                                                           │
                    │   ┌──────┐   start()    ┌───────────┐                    │
                    │   │ IDLE │─────────────►│ STARTING  │                    │
                    │   └──────┘              └───────────┘                    │
                    │      ▲                        │                          │
                    │      │                        │ success                  │
                    │      │                        ▼                          │
                    │      │                  ┌───────────┐                    │
                    │      │                  │ RECORDING │◄─────┐             │
                    │      │                  └───────────┘      │             │
                    │      │                        │            │ resume      │
                    │      │ cancel()               │ stop()     │             │
                    │      │                        ▼            │             │
                    │      │                  ┌───────────┐      │             │
                    │      │                  │ STOPPING  │      │             │
                    │      │                  └───────────┘      │             │
                    │      │                        │            │             │
                    │      │                        │ success    │             │
                    │      │                        ▼            │             │
                    │      │                  ┌───────────┐      │             │
                    │      ├──────────────────│PROCESSING │──────┤             │
                    │      │     timeout      └───────────┘      │             │
                    │      │                        │            │             │
                    │      │                        │ success    │             │
                    │      │                        ▼            │             │
                    │      │                  ┌───────────┐      │             │
                    │      └──────────────────│ COMPLETE  │──────┘             │
                    │                         └───────────┘                    │
                    │                               │                          │
                    │                               │ reset()                  │
                    │                               ▼                          │
                    │                         ┌──────┐                         │
                    │                         │ IDLE │                         │
                    │                         └──────┘                         │
                    │                                                           │
                    │  EVERY STATE has:                                         │
                    │  - Maximum timeout (auto-recovery)                        │
                    │  - Cancel path to IDLE                                   │
                    │  - Error recovery path                                   │
                    └─────────────────────────────────────────────────────────┘
```

#### State Definitions

| State | Max Duration | Timeout Action | Entry Actions | Exit Actions |
|-------|-------------|----------------|---------------|--------------|
| `idle` | Infinite | N/A | Clear session data | Initialize services |
| `starting` | 5 seconds | Transition to `idle` + error | Start audio, transcription | None |
| `recording` | 30 minutes | Warning at 25min, auto-stop at 30 | Start capture | Buffer transcripts |
| `stopping` | 3 seconds | Force transition to `processing` | Stop audio capture | Finalize transcripts |
| `processing` | 10 seconds | Force transition to `complete` with partial data | Match screenshots to text | Generate output |
| `complete` | 30 seconds | Auto-transition to `idle` | Copy to clipboard | Clean up temp files |
| `error` | 5 seconds | Auto-transition to `idle` | Show error message | Log error details |

#### Critical Implementation Rules

1. **No Blocking Operations**: All async operations wrapped with timeout
2. **Every Transition Validated**: Invalid transitions throw immediately
3. **Watchdog Timer**: Background timer monitors state age, forces recovery if stuck
4. **State Persistence**: Current state written to disk every 5 seconds for crash recovery

```typescript
// IMPLEMENTATION PATTERN: Timeout-wrapped operations
async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<T> {
  const timeout = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout')), timeoutMs)
  );
  try {
    return await Promise.race([operation, timeout]);
  } catch {
    return fallback;
  }
}

// USAGE in stop():
await withTimeout(
  this.cleanupServices(),
  3000,  // 3 second max
  undefined  // Continue even if cleanup fails
);
```

### 3.2 Graceful Degradation System

FeedbackFlow works **without any API keys** using a three-tier transcription system.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      TRANSCRIPTION TIER SYSTEM                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  TIER 1: Deepgram Nova-3 (Optional - Best Quality)                      │
│  ├── Latency: ~300ms                                                     │
│  ├── Accuracy: 95%+                                                      │
│  ├── Requires: API key, internet                                         │
│  └── Triggers: Utterance end events for screenshot timing               │
│                                                                          │
│              ▼ Fallback on: No API key, network error, rate limit       │
│                                                                          │
│  TIER 2: Local Whisper (Default - Good Quality)                         │
│  ├── Latency: ~1-2 seconds                                               │
│  ├── Accuracy: 90%+                                                      │
│  ├── Requires: Downloaded model (~500MB), CPU/GPU                        │
│  └── Triggers: Silence detection for screenshot timing                  │
│                                                                          │
│              ▼ Fallback on: Model not downloaded, memory pressure       │
│                                                                          │
│  TIER 3: macOS Dictation (Emergency Fallback)                           │
│  ├── Latency: Real-time                                                  │
│  ├── Accuracy: 85%                                                       │
│  ├── Requires: macOS Dictation enabled                                   │
│  └── Triggers: Timer-based screenshot (every 5 seconds speaking)        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Tier Selection Logic

```typescript
async function selectTranscriptionTier(): Promise<TranscriptionTier> {
  // Check Tier 1 availability
  if (await hasDeepgramKey() && await hasInternetConnection()) {
    return 'deepgram';
  }

  // Check Tier 2 availability
  if (await isWhisperModelDownloaded() && await hasEnoughMemory(2 * GB)) {
    return 'whisper';
  }

  // Check Tier 3 availability
  if (await isMacosDictationEnabled()) {
    return 'macos-dictation';
  }

  // Absolute fallback: Timer-only mode (no transcription)
  return 'timer-only';
}
```

#### Tier Status UI

Show users which tier is active and why:

```
┌────────────────────────────────────────┐
│  Transcription: Local Whisper         │
│  ◉ Quality: High (90% accuracy)        │
│  ◉ Speed: Good (1-2s delay)            │
│                                        │
│  [Upgrade to Deepgram for best quality]│
└────────────────────────────────────────┘
```

### 3.3 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FEEDBACKFLOW ARCHITECTURE                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                              MENU BAR LAYER                                   │
│  ┌─────────────┐  ┌──────────────────┐  ┌────────────────────────────────┐   │
│  │ Menu Bar    │  │ Popover Window   │  │ Status Indicator               │   │
│  │ Icon        │  │ (NSPopover-like) │  │ (Recording/Idle/Processing)    │   │
│  │             │  │                  │  │                                │   │
│  │ ○ ● ◎       │  │ [Start Recording]│  │ Icon animation based on state  │   │
│  │ States      │  │ [Settings]       │  │                                │   │
│  │             │  │ [Buy Eddie Tacos]│  │                                │   │
│  └─────────────┘  └──────────────────┘  └────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           SESSION CONTROLLER                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                      STATE MACHINE (BULLETPROOF)                        │ │
│  │  idle ──► starting ──► recording ──► stopping ──► processing ──► complete│
│  │   ▲          │           │              │             │            │     │
│  │   └──────────┴───────────┴──────────────┴─────────────┴────────────┘     │
│  │                    (All paths lead back to idle)                         │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                          │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐                  │
│  │ Watchdog Timer │  │ Auto-Save      │  │ Crash Recovery │                  │
│  │ (State timeout)│  │ (Every 5s)     │  │ (On restart)   │                  │
│  └────────────────┘  └────────────────┘  └────────────────┘                  │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
┌─────────────────────────┐ ┌───────────────┐ ┌─────────────────────────┐
│   TRANSCRIPTION LAYER   │ │ AUDIO LAYER   │ │   CAPTURE LAYER         │
│                         │ │               │ │                         │
│ ┌─────────────────────┐ │ │ ┌───────────┐ │ │ ┌─────────────────────┐ │
│ │ Tier 1: Deepgram    │ │ │ │ Microphone│ │ │ │ Screen Capture      │ │
│ │ (Optional)          │ │ │ │ (Web Audio│ │ │ │ (desktopCapturer)   │ │
│ └─────────────────────┘ │ │ │  API)     │ │ │ └─────────────────────┘ │
│           │             │ │ └───────────┘ │ │           │             │
│           ▼             │ │       │       │ │           ▼             │
│ ┌─────────────────────┐ │ │       │       │ │ ┌─────────────────────┐ │
│ │ Tier 2: Whisper     │ │ │       │       │ │ │ Screenshot Buffer   │ │
│ │ (Default)           │ │ │       │       │ │ │ (Match to text)     │ │
│ └─────────────────────┘ │ │       │       │ │ └─────────────────────┘ │
│           │             │ │       │       │ │                         │
│           ▼             │ │       ▼       │ │                         │
│ ┌─────────────────────┐ │ │ ┌───────────┐ │ │                         │
│ │ Tier 3: macOS       │ │ │ │ VAD       │ │ │                         │
│ │ (Fallback)          │ │ │ │ (Silence  │ │ │                         │
│ └─────────────────────┘ │ │ │  detect)  │ │ │                         │
│                         │ │ └───────────┘ │ │                         │
└─────────────────────────┘ └───────────────┘ └─────────────────────────┘
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                            OUTPUT LAYER                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐   │
│  │ Markdown        │  │ Clipboard       │  │ File System                 │   │
│  │ Generator       │  │ (Auto-copy)     │  │ (Session storage)           │   │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Menu Bar UX

### 4.1 Design Philosophy

Inspired by the **Claude Status app** - minimal, professional, non-intrusive.

| Design Principle | Implementation |
|-----------------|----------------|
| **Invisible when not needed** | Icon only, no persistent UI |
| **Instant access** | Click or hotkey shows popover immediately |
| **Clear state feedback** | Icon animates during recording |
| **Non-blocking** | Popover closes automatically, work continues |

### 4.2 Icon States

```
STATE: IDLE                 STATE: RECORDING            STATE: PROCESSING
    ○                            ●                           ◎
   ╱ ╲                          ╱ ╲                         ╱ ╲
  ╱   ╲                        ╱   ╲                       ╱   ╲  (rotating)
 ╱     ╲                      ╱     ╲                     ╱     ╲
Gray outline             Solid red, pulsing         Dashed, spinning

STATE: ERROR                STATE: COMPLETE (brief)
    ⚠                            ✓
   ╱ ╲                          ╱ ╲
  ╱ ! ╲                        ╱   ╲
 ╱     ╲                      ╱     ╲
Orange warning             Green check (2s)
```

### 4.3 Popover Menu

```
┌────────────────────────────────────────┐
│ FeedbackFlow                           │  ← Header with subtle logo
├────────────────────────────────────────┤
│ ◉ Ready to Record                      │  ← Status line
│   Using: Local Whisper                 │  ← Transcription tier
├────────────────────────────────────────┤
│ [  ● Start Recording    ]  ⌘⇧F        │  ← Primary action (big button)
├────────────────────────────────────────┤
│   Recent Sessions ▸                    │  ← Expandable submenu
│   Settings...        ⌘,               │
│   Help & Shortcuts   ⌘?               │
├────────────────────────────────────────┤
│   ☕ Buy Eddie a Coffee                │  ← Donate with rotating message
├────────────────────────────────────────┤
│   Quit FeedbackFlow  ⌘Q               │
└────────────────────────────────────────┘
```

### 4.4 Recording State Popover

```
┌────────────────────────────────────────┐
│ ● Recording...                02:34    │  ← Timer
├────────────────────────────────────────┤
│ ▓▓▓▓▓▓▓▓░░░░  ◀ Audio Level           │  ← Audio visualization
├────────────────────────────────────────┤
│ "The login button should be..."        │  ← Live transcription (last 50 chars)
│                                        │
│ 📸 3 screenshots captured              │  ← Screenshot count
├────────────────────────────────────────┤
│ [  ■ Stop Recording     ]  ⌘⇧F        │  ← Stop action
│ [    Cancel Session     ]              │  ← Cancel (loses data)
└────────────────────────────────────────┘
```

### 4.5 Processing State Popover

```
┌────────────────────────────────────────┐
│ ◎ Processing...                        │
├────────────────────────────────────────┤
│                                        │
│         ◎ Generating report...         │  ← Centered spinner
│                                        │
│         Progress: ▓▓▓▓▓▓░░░░ 60%       │  ← Progress bar
│                                        │
├────────────────────────────────────────┤
│         (Maximum wait: 10s)            │  ← Timeout indicator
└────────────────────────────────────────┘
```

### 4.6 Complete State Popover

```
┌────────────────────────────────────────┐
│ ✓ Feedback Captured!                   │
├────────────────────────────────────────┤
│                                        │
│   ✓ Copied to clipboard                │
│   📁 Saved to ~/FeedbackFlow/...       │
│                                        │
│   Session: 2 min 34 sec                │
│   Items: 5 feedback points             │
│   Screenshots: 3 captured              │
│                                        │
├────────────────────────────────────────┤
│ [  Open Report  ] [  New Session  ]    │
└────────────────────────────────────────┘
```

### 4.7 Settings Panel

```
┌────────────────────────────────────────────────────────────────┐
│ Settings                                              [X]      │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│ TRANSCRIPTION                                                   │
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ ○ Local Whisper (Default - No API key needed)              ││
│ │   Uses on-device AI for transcription                       ││
│ │                                                              ││
│ │ ○ Deepgram (Best Quality)                                   ││
│ │   API Key: [____________________________] [Test]            ││
│ │   Get key: console.deepgram.com (free tier: 200 hrs/mo)     ││
│ └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│ CAPTURE                                                         │
│   Pause threshold: [1200ms ▼]  (time before auto-screenshot)   │
│   Min between:     [2000ms ▼]  (minimum gap between captures)  │
│                                                                 │
│ HOTKEYS                                                         │
│   Toggle Recording: [⌘⇧F] [Edit]                               │
│   Manual Screenshot: [⌘⇧S] [Edit]                              │
│                                                                 │
│ OUTPUT                                                          │
│   Save Location: ~/FeedbackFlow [Change]                        │
│   [✓] Auto-copy to clipboard                                    │
│   [✓] Launch at login                                           │
│                                                                 │
│ APPEARANCE                                                      │
│   Theme: [System ▼]                                             │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## 5. Donate System

### 5.1 Philosophy

- **Non-intrusive**: Single line in menu, never blocks workflow
- **Personality**: Rotating funny messages that reflect Eddie's humor
- **Transparent**: Links directly to donation, no dark patterns

### 5.2 Rotating Messages

Update the message every app launch (not during session). Store last message index in settings.

```typescript
const DONATE_MESSAGES = [
  // Food-related
  "Buy Eddie a Taco",
  "Fund Eddie's Caffeine Addiction",
  "Sponsor Eddie's Debugging Snacks",
  "Pizza Fuel for More Features",
  "Eddie Runs on Coffee",
  "Tacos = Better Code",
  "Feed the Developer",
  "Caffeine Level: Critical",
  "Taco Tuesday Sponsor",
  "Coffee Emergency Fund",

  // Developer humor
  "Help Eddie Avoid Real Jobs",
  "Keep Eddie Coding",
  "Prevent Eddie from Sleeping",
  "Support Open Source Chaos",
  "Stack Overflow Subscription Fund",
  "Mechanical Keyboard Fund",
  "Monitor Upgrade Savings",
  "Chair Upgrade for Better Posture",

  // Meta/self-aware
  "This Button Does Nothing... JK",
  "Click Here, Make Eddie Happy",
  "You Know You Want To",
  "Best $5 You'll Spend Today",
  "Cheaper Than Therapy",
  "Pay What It's Worth to You",

  // Seasonal (detect date)
  // "Pumpkin Spice Latte Fund" (Oct)
  // "Hot Chocolate Emergency" (Dec-Jan)
  // "Iced Coffee Season" (Jun-Aug)
];

function getDonateMessage(): string {
  const settings = getSettings();
  const lastIndex = settings.lastDonateMessageIndex || 0;
  const nextIndex = (lastIndex + 1) % DONATE_MESSAGES.length;
  setSettings({ lastDonateMessageIndex: nextIndex });
  return DONATE_MESSAGES[nextIndex];
}
```

### 5.3 Donation Platform

**Recommendation**: Ko-fi or Buy Me a Coffee

| Platform | Pros | Cons |
|----------|------|------|
| **Ko-fi** | No fees on donations, simple | Less known |
| **Buy Me a Coffee** | Well-known, good UI | 5% fee |
| **GitHub Sponsors** | GitHub integration | Requires approval |
| **Open Collective** | Transparency | More complex |

**Implementation**: Single link in menu that opens browser.

```typescript
const DONATE_URL = 'https://ko-fi.com/eddiesanjuan';

function openDonateLink(): void {
  shell.openExternal(DONATE_URL);
}
```

### 5.4 Menu Integration

```typescript
// In popover menu template
{
  label: `☕ ${getDonateMessage()}`,
  click: () => openDonateLink(),
  // Subtle styling - not bright colors
}
```

---

## 6. Open Source Setup

### 6.1 Repository Structure

```
feedbackflow/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   ├── feature_request.md
│   │   └── config.yml
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── workflows/
│   │   ├── ci.yml           # Lint, test, build on PR
│   │   ├── release.yml      # Build, sign, notarize, publish
│   │   └── codeql.yml       # Security scanning
│   ├── CODEOWNERS
│   ├── FUNDING.yml          # Ko-fi link
│   └── dependabot.yml
├── assets/
│   ├── icons/               # All icon states and sizes
│   └── screenshots/         # README screenshots
├── docs/
│   ├── ARCHITECTURE.md
│   ├── CONFIGURATION.md
│   ├── DEVELOPMENT.md
│   ├── TROUBLESHOOTING.md
│   └── BULLETPROOF_DESIGN_SPEC.md  # This document
├── scripts/
│   ├── generate-icons.mjs
│   ├── notarize.js
│   └── download-whisper.mjs
├── src/
│   ├── main/                # Electron main process
│   ├── renderer/            # React UI
│   ├── preload/             # IPC bridge
│   └── shared/              # Shared types
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── .eslintrc.json
├── .gitignore
├── .prettierrc
├── CHANGELOG.md
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE                  # MIT
├── README.md
├── SECURITY.md
├── package.json
└── tsconfig.json
```

### 6.2 README.md Structure

```markdown
<p align="center">
  <img src="assets/logo.svg" width="128">
  <h1 align="center">FeedbackFlow</h1>
  <p align="center">
    Capture voice feedback with AI-ready screenshots. Free and open source.
  </p>
</p>

<p align="center">
  <a href="...">Download for macOS</a> ·
  <a href="...">Documentation</a> ·
  <a href="...">Contributing</a>
</p>

## Why FeedbackFlow?

| Feature | FeedbackFlow | Screen Recording | Notes App |
|---------|--------------|------------------|-----------|
| Voice + Screenshots | ✓ | ✓ | ✗ |
| AI-Ready Output | ✓ | ✗ | ✗ |
| Auto Screenshots | ✓ | ✗ | ✗ |
| Works Offline | ✓ | ✓ | ✓ |
| Free | ✓ | ✓ | ✓ |

## Quick Start

1. Download the latest release
2. Move to Applications
3. Click the menu bar icon
4. Press ⌘⇧F to start recording
5. Speak your feedback - screenshots auto-capture
6. Press ⌘⇧F again - feedback copied to clipboard

**No API key required!** Uses on-device AI by default.

## Features

- **Menu bar native** - Lives in your menu bar, not your dock
- **Voice-driven** - Just talk, screenshots capture automatically
- **AI-ready output** - Markdown optimized for Claude, ChatGPT, etc.
- **Works offline** - Local Whisper transcription, no internet needed
- **Privacy first** - All processing on your device

[Rest of README...]
```

### 6.3 CONTRIBUTING.md Highlights

```markdown
# Contributing to FeedbackFlow

## Quick Setup

```bash
git clone https://github.com/eddiesanjuan/feedbackflow
cd feedbackflow
npm install
npm run dev
```

## Development Workflow

1. Fork and clone
2. Create a branch: `git checkout -b feature/amazing-feature`
3. Make changes
4. Test: `npm test && npm run lint`
5. Commit: `git commit -m 'feat: add amazing feature'`
6. Push and open PR

## Commit Convention

We use Conventional Commits:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `refactor:` Code improvement
- `test:` Tests

## Code Style

- TypeScript with strict mode
- React functional components
- Tailwind for styling
- ESLint + Prettier enforced

## Testing

```bash
npm test              # All tests
npm run test:unit     # Unit tests
npm run test:e2e      # End-to-end tests
```
```

### 6.4 CI/CD Pipeline

#### Continuous Integration (`ci.yml`)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test

  build:
    needs: validate
    strategy:
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run build
      - run: npm run package:mac:unsigned  # Skip signing in CI
```

#### Release Pipeline (`release.yml`)

```yaml
name: Release

on:
  push:
    tags: ['v*']

jobs:
  build-macos:
    runs-on: macos-latest
    steps:
      # ... full code signing and notarization
      # See existing release.yml for complete implementation

  build-windows:
    runs-on: windows-latest
    steps:
      # ... Windows code signing

  create-release:
    needs: [build-macos, build-windows]
    runs-on: ubuntu-latest
    steps:
      # ... Create GitHub release with artifacts
```

### 6.5 Security Policy (`SECURITY.md`)

```markdown
# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities to: security@feedbackflow.dev

Do NOT create a public GitHub issue for security vulnerabilities.

## What We Consider Security Issues

- Remote code execution
- Data exfiltration
- Privilege escalation
- Authentication bypass

## Safe Harbor

We will not take legal action against security researchers who:
- Act in good faith
- Avoid privacy violations
- Report vulnerabilities promptly
```

---

## 7. Critical Path

### 7.1 Phase 1: Bulletproof Core (Week 1)

**Goal**: Session lifecycle that can NEVER get stuck.

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Implement timeout-wrapped state transitions | P0 | 4h | None |
| Add watchdog timer for state monitoring | P0 | 2h | State transitions |
| Add state persistence for crash recovery | P0 | 2h | Watchdog |
| Test all failure scenarios | P0 | 4h | All above |

**Acceptance Criteria**:
- [ ] Force-close transcription service mid-recording -> recovers to idle
- [ ] Kill app during processing -> data recovered on restart
- [ ] Network disconnect during recording -> continues locally
- [ ] 30+ minute recording -> graceful handling

### 7.2 Phase 2: Graceful Degradation (Week 1-2)

**Goal**: Works without any API key.

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Integrate whisper.cpp for local transcription | P0 | 8h | None |
| Implement tier selection logic | P0 | 4h | Whisper integration |
| Add silence detection for screenshot timing | P1 | 4h | Tier selection |
| Build download manager for Whisper models | P1 | 4h | None |
| Add tier status UI in popover | P2 | 2h | Tier selection |

**Acceptance Criteria**:
- [ ] Fresh install with no API key -> works with local Whisper
- [ ] Deepgram fails mid-session -> falls back to Whisper
- [ ] Whisper model not downloaded -> prompts download or uses macOS dictation

### 7.3 Phase 3: Menu Bar Native (Week 2)

**Goal**: Pure menu bar app, no dock icon.

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Remove BrowserWindow, implement NSPopover-like | P0 | 8h | None |
| Design and implement all icon states | P0 | 4h | None |
| Build popover menu with all states | P0 | 6h | Icon states |
| Add recording overlay (optional) | P2 | 4h | Popover |
| Hide from dock | P1 | 1h | None |

**Acceptance Criteria**:
- [ ] App icon NOT in dock
- [ ] Menu bar icon shows correct state
- [ ] Click opens popover instantly
- [ ] Recording works from popover

### 7.4 Phase 4: Open Source Polish (Week 2-3)

**Goal**: Ready for public release.

| Task | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| Add donate button with rotating messages | P1 | 2h | Popover done |
| Create comprehensive README | P1 | 4h | None |
| Add issue templates | P2 | 1h | None |
| Configure GitHub Actions for releases | P0 | 4h | None |
| Add code signing and notarization | P0 | 4h | CI/CD |
| Create CONTRIBUTING.md | P2 | 2h | None |

**Acceptance Criteria**:
- [ ] One-click download from GitHub releases
- [ ] App is signed and notarized (no Gatekeeper warning)
- [ ] README explains everything clearly
- [ ] CI builds pass on every PR

---

## 8. Testing Strategy

### 8.1 Unit Tests

**Coverage Target**: 80% for core modules

```typescript
// SessionController tests
describe('SessionController', () => {
  describe('state transitions', () => {
    it('should transition idle -> starting -> recording', async () => { });
    it('should reject invalid transitions', () => { });
    it('should timeout starting state after 5s', async () => { });
    it('should timeout processing state after 10s', async () => { });
  });

  describe('crash recovery', () => {
    it('should persist state every 5 seconds', async () => { });
    it('should recover incomplete session on restart', async () => { });
  });
});

// TranscriptionService tests
describe('TranscriptionService', () => {
  describe('tier selection', () => {
    it('should select Deepgram when API key present', async () => { });
    it('should fall back to Whisper when no API key', async () => { });
    it('should fall back to macOS dictation when Whisper unavailable', async () => { });
  });
});
```

### 8.2 Integration Tests

```typescript
describe('Recording Flow', () => {
  it('should complete full recording cycle', async () => {
    // Start recording
    // Simulate voice input
    // Verify screenshots captured
    // Stop recording
    // Verify output generated
  });

  it('should recover from mid-session crash', async () => {
    // Start recording
    // Force crash
    // Restart app
    // Verify recovery dialog shown
    // Verify data recovered
  });

  it('should handle network disconnect during recording', async () => {
    // Start recording with Deepgram
    // Disconnect network
    // Verify fallback to Whisper
    // Reconnect network
    // Verify Deepgram resumes
  });
});
```

### 8.3 End-to-End Tests

```typescript
describe('E2E: Real User Scenarios', () => {
  it('should work for first-time user with no setup', async () => {
    // Fresh install
    // Open app
    // Start recording (no API key)
    // Record 30 seconds of voice
    // Stop recording
    // Verify Markdown in clipboard
  });

  it('should handle 30-minute recording session', async () => {
    // Start recording
    // Wait 30 minutes (simulated)
    // Verify memory stable
    // Verify all screenshots captured
    // Stop and verify output
  });
});
```

### 8.4 Manual Testing Checklist

#### Fresh Install
- [ ] Download DMG from GitHub
- [ ] Drag to Applications
- [ ] Open - no Gatekeeper warning
- [ ] Menu bar icon appears
- [ ] Click icon - popover shows
- [ ] Start recording - works without API key
- [ ] Stop recording - copied to clipboard
- [ ] Paste in TextEdit - valid Markdown

#### Recording States
- [ ] Idle state: gray icon
- [ ] Recording state: red pulsing icon
- [ ] Processing state: spinning icon
- [ ] Complete state: green check (briefly)
- [ ] Error state: orange warning

#### Edge Cases
- [ ] Close popover during recording - continues
- [ ] Hotkey works from any app
- [ ] Very long recording (10+ minutes) - stable
- [ ] No microphone permission - clear error
- [ ] No internet - uses local Whisper
- [ ] Quit during recording - data saved

#### Cross-Platform (Future)
- [ ] macOS Intel - works
- [ ] macOS Apple Silicon - works
- [ ] Windows - builds but not primary target

---

## Appendix A: Error Codes

| Code | Description | Recovery |
|------|-------------|----------|
| `E001` | Microphone permission denied | Show system preferences |
| `E002` | Screen recording permission denied | Show system preferences |
| `E003` | Deepgram API key invalid | Fall back to Whisper |
| `E004` | Network connection lost | Buffer locally, retry |
| `E005` | Whisper model not found | Prompt download |
| `E006` | Session timeout | Force complete with partial data |
| `E007` | Disk full | Alert user, offer cleanup |

---

## Appendix B: Keyboard Shortcuts

| Action | macOS | Configurable |
|--------|-------|--------------|
| Toggle Recording | ⌘⇧F | Yes |
| Manual Screenshot | ⌘⇧S | Yes |
| Open Settings | ⌘, | No |
| Show Help | ⌘? | No |
| Quit | ⌘Q | No |

---

## Appendix C: File Formats

### Session Output (Markdown)

```markdown
# Feedback Report: MyApp

## Summary
- **Duration**: 2m 34s
- **Items**: 5 feedback points
- **Screenshots**: 3 captured
- **Transcription**: Local Whisper

## Feedback Items

### FB-001: Login button hidden
**Timestamp**: 00:15 | **Confidence**: 0.94

> The login button is hidden behind the header on mobile viewport.
> Users won't be able to find it.

![Screenshot](./screenshots/fb-001.png)

### FB-002: Form validation unclear
**Timestamp**: 00:45 | **Confidence**: 0.91

> When I enter an invalid email, the error message doesn't appear...

![Screenshot](./screenshots/fb-002.png)
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-03 | Eddie (via Orchestrator) | Initial comprehensive spec |

---

**END OF DOCUMENT**

*This specification represents the complete design for a bulletproof FeedbackFlow. Any developer should be able to implement this exactly as described. No ambiguity, no gaps, no excuses.*
