# FeedbackFlow - Architecture Overview

> High-level system design extracted from master spec

---

## 1. System Overview

FeedbackFlow is a **macOS menu bar application** that captures voice feedback from developers and produces AI-ready Markdown output. The architecture prioritizes:

1. **Offline-first** - Works without internet or API keys
2. **Bulletproof reliability** - No stuck states, graceful degradation
3. **Native feel** - Pure menu bar presence, no dock icon

```
+------------------+
|   Menu Bar Icon  |  <- User interaction point
+--------+---------+
         |
         v
+------------------+
|  Popover UI      |  <- React components in Electron popover
|  (Recording,     |
|   Settings,      |
|   Complete view) |
+--------+---------+
         |
         v
+------------------+     +--------------------+
|  Session         |<--->|  State Persistence |
|  Controller      |     |  (StateStore)      |
|  (State Machine) |     +--------------------+
+--------+---------+
         |
    +----+----+
    |         |
    v         v
+--------+ +----------------+
| Audio  | | Transcription  |
| Capture| | Service        |
+--------+ +-------+--------+
                   |
         +---------+---------+
         |         |         |
         v         v         v
    +--------+ +--------+ +--------+
    |Deepgram| | Local  | | macOS  |
    | API    | | Whisper| | Dictat.|
    +--------+ +--------+ +--------+
```

---

## 2. Application Architecture

### 2.1 Process Model (Electron)

```
+------------------------------------------+
|              Main Process                |
|  +------------+  +-------------------+   |
|  | TrayManager|  | SessionController |   |
|  +------------+  +-------------------+   |
|  +------------+  +-------------------+   |
|  | AudioCapture| | TranscriptionSvc  |   |
|  +------------+  +-------------------+   |
|  +------------+  +-------------------+   |
|  | StateStore |  | RecoveryService   |   |
|  +------------+  +-------------------+   |
+------------------------------------------+
          |  IPC Bridge  |
          v              v
+------------------------------------------+
|            Renderer Process              |
|  +------------+  +-------------------+   |
|  | Popover UI |  | Settings Panel    |   |
|  | Components |  | Components        |   |
|  +------------+  +-------------------+   |
+------------------------------------------+
```

### 2.2 Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Desktop Framework | Electron | Cross-compile capability, web tech UI |
| UI Framework | React + TypeScript | Type safety, component model |
| Menu Bar Style | Popover (NSPopover-like) | Native macOS feel |
| Dock Icon | Hidden (`app.dock.hide()`) | Pure menu bar app |
| State Management | Custom state machine | Bulletproof guarantees |
| Transcription Default | Local Whisper | No API keys required |

---

## 3. Component Architecture

### 3.1 Main Process Components

#### TrayManager (`src/main/TrayManager.ts`)

Manages the menu bar icon and popover lifecycle.

```
Responsibilities:
- Create and manage system tray icon
- Handle icon state transitions (idle, recording, processing, etc.)
- Manage popover attachment and positioning
- Handle click events

Icon States:
- idle: gray microphone (static)
- recording: red microphone (pulse animation)
- processing: spinner icon (rotation animation)
- complete: green checkmark (brief display)
- error: orange warning (static)
```

#### SessionController (`src/main/SessionController.ts`)

The **heart of the application** - manages the recording session lifecycle.

```
State Machine:
  idle <---> starting <---> recording <---> stopping <---> processing <---> complete
    ^                          |                              |
    +------------ cancel() ----+------------------------------+

Key Guarantees:
- Every state has a maximum timeout
- Every async operation has a fallback
- Watchdog timer monitors state age
- State persisted every 5 seconds
```

#### TranscriptionService (`src/main/TranscriptionService.ts`)

Manages three-tier transcription with automatic fallback.

```
Tier Selection Logic:
1. Check if Deepgram API key configured
   - YES: Use Deepgram Nova-3 (Tier 1)
   - NO: Continue to Tier 2
2. Check if Whisper model downloaded
   - YES: Use local Whisper (Tier 2)
   - NO: Trigger model download, then use Whisper
3. Emergency fallback: macOS Dictation (Tier 3)

Mid-Session Fallback:
- If current tier fails, automatically try next tier
- Never lose recorded audio
```

#### StateStore (`src/main/StateStore.ts`)

Persists session state for crash recovery.

```
Persistence Strategy:
- Write state to disk every 5 seconds during active session
- Store: audio path, transcript progress, screenshot paths, state
- On startup: check for incomplete sessions
- Recovery flow: detect -> prompt user -> restore or discard
```

#### RecoveryService (`src/main/RecoveryService.ts`)

Handles crash recovery on application startup.

```
Recovery Flow:
1. App starts
2. Check StateStore for incomplete session
3. If found:
   - Show recovery dialog
   - User chooses: Recover or Discard
   - Recover: restore session to 'complete' state
   - Discard: clear state, start fresh
4. If not found: normal startup
```

### 3.2 Renderer Process Components

#### Popover Layouts

```
src/renderer/
├── components/
│   ├── IdleView.tsx        # Start button, recent sessions, donate
│   ├── RecordingView.tsx   # Stop button, duration, waveform
│   ├── ProcessingView.tsx  # Progress indicator
│   ├── CompleteView.tsx    # Preview, copy, save buttons
│   ├── SettingsPanel.tsx   # All configuration options
│   ├── DonateButton.tsx    # Ko-fi link with rotating messages
│   └── RecoveryDialog.tsx  # Crash recovery prompt
```

#### State-to-View Mapping

| Session State | Rendered View |
|---------------|---------------|
| `idle` | IdleView |
| `starting` | RecordingView (loading) |
| `recording` | RecordingView |
| `stopping` | ProcessingView |
| `processing` | ProcessingView |
| `complete` | CompleteView |
| `error` | Error overlay on current view |

---

## 4. Data Flow Architecture

### 4.1 Recording Flow

```
User clicks "Start"
       |
       v
SessionController.start()
       |
       v
AudioCapture.beginCapture()
       |
       +---> TrayManager.setIcon('recording')
       |
       v
[Recording in progress]
       |
       +---> StateStore.persist() [every 5s]
       |
       v
User clicks "Stop"
       |
       v
SessionController.stop()
       |
       v
AudioCapture.endCapture() --> audio.wav
       |
       v
TranscriptionService.transcribe(audio.wav)
       |
       +---> TrayManager.setIcon('processing')
       |
       v
[Transcription complete]
       |
       v
OutputGenerator.createMarkdown(transcript, screenshots)
       |
       v
Clipboard.write(markdown)
       |
       +---> TrayManager.setIcon('complete')
       |
       v
[User can copy/save/dismiss]
```

### 4.2 Transcription Tier Fallback Flow

```
TranscriptionService.transcribe(audio)
       |
       v
   [Has Deepgram key?]
       |
   YES |           NO
       v            |
  Try Deepgram      |
       |            |
   [Success?]       |
       |            |
   YES |   NO       |
       v   +--------+
  Return   |
  result   v
       [Whisper model ready?]
               |
           YES |           NO
               v            |
          Try Whisper       |
               |       Download model
           [Success?]       |
               |            v
           YES |   NO   [Wait...]
               v   +--------+
          Return   |
          result   v
               Try macOS Dictation
                       |
                       v
                  Return result
                  (or error)
```

---

## 5. State Machine Architecture

### 5.1 State Definitions

```typescript
enum SessionState {
  IDLE = 'idle',
  STARTING = 'starting',
  RECORDING = 'recording',
  STOPPING = 'stopping',
  PROCESSING = 'processing',
  COMPLETE = 'complete',
  ERROR = 'error'
}
```

### 5.2 State Timeouts

| State | Timeout | Action on Timeout |
|-------|---------|-------------------|
| `idle` | None | N/A |
| `starting` | 5 seconds | Return to `idle` with error |
| `recording` | 30 minutes | Auto-transition to `stopping` |
| `stopping` | 3 seconds | Force to `processing` |
| `processing` | 10s + 2× audio duration | Complete with partial transcript |
| `complete` | None | User-initiated reset |
| `error` | None | User-initiated recovery |

### 5.3 Watchdog Timer

```
Purpose: Ensure no state can become "stuck"

Implementation:
- Timer checks state age every 1 second
- If state age > max timeout for current state:
  - Log warning
  - Force transition to safe state
  - Report telemetry (if enabled)
```

### 5.4 State Persistence Schema

```json
{
  "sessionId": "uuid-v4",
  "state": "recording",
  "stateEnteredAt": "2026-02-03T10:00:00Z",
  "audioPath": "/tmp/feedbackflow/session-abc/audio.wav",
  "partialTranscript": "So far the user has said...",
  "screenshots": [
    "/tmp/feedbackflow/session-abc/screenshot-001.png"
  ],
  "selectedTier": "whisper",
  "version": 1
}
```

---

## 6. Error Handling Architecture

### 6.1 Error Categories

| Category | Examples | Handling Strategy |
|----------|----------|-------------------|
| Transient | Network timeout, temporary file lock | Retry with backoff |
| Recoverable | Transcription tier failure | Fallback to next tier |
| Fatal | Audio device unavailable | Show error, allow retry |
| Corruption | State file corrupted | Reset to clean state |

### 6.2 Graceful Degradation Hierarchy

```
Level 1: Optimal Experience
  - Deepgram transcription (fastest, best quality)
  - Full screenshot intelligence

Level 2: Good Experience
  - Local Whisper transcription
  - Silence-based screenshot timing

Level 3: Basic Experience
  - macOS Dictation fallback
  - Manual screenshot triggers only

Level 4: Minimal Experience
  - Audio recording only (no transcription)
  - User can export audio file
```

---

## 7. Permissions UX Flow

### 7.1 Permission Request Order

| Permission | When Requested | Trigger |
|------------|----------------|---------|
| **Microphone** | First recording attempt | User clicks "Start" |
| **Screen Recording** | First screenshot capture | Silence detected or manual trigger |
| **Accessibility** | Global hotkey setup (optional) | User enables in Settings |

### 7.2 Permission Denial Handling

```
Permission Denied Flow:
1. User denies permission
2. Show inline guidance in popover:
   - Explain why permission is needed
   - Provide "Open System Settings" button (deep-link)
3. Continue with graceful degradation
```

| Permission Denied | Degraded Behavior |
|-------------------|-------------------|
| Microphone | Cannot record - show clear error, link to Settings |
| Screen Recording | Skip screenshots, continue audio recording |
| Accessibility | Global hotkey unavailable, menu bar click still works |

### 7.3 Permission Revocation

If user revokes permission mid-session or between sessions:
- **Detect** on next permission-requiring action
- **Gracefully degrade** to available functionality
- **Re-request** permission on next user-initiated attempt
- **Never** repeatedly prompt - wait for explicit user action

---

## 8. IPC Contract Summary

### 8.1 Key IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `session:start` | Renderer → Main | Initiate recording session |
| `session:stop` | Renderer → Main | Stop recording, begin processing |
| `session:cancel` | Renderer → Main | Cancel session, return to idle |
| `session:state` | Main → Renderer | Broadcast current session state |
| `transcription:update` | Main → Renderer | Partial transcript updates |
| `transcription:complete` | Main → Renderer | Final transcript ready |
| `screenshot:captured` | Main → Renderer | Screenshot taken notification |
| `error:occurred` | Main → Renderer | Error with recovery options |
| `settings:get` | Renderer → Main | Request current settings |
| `settings:set` | Renderer → Main | Update settings |

### 8.2 Payload Schemas

```typescript
// session:state payload
interface SessionStatePayload {
  state: SessionState;
  duration?: number;      // seconds, when recording
  progress?: number;      // 0-100, when processing
}

// transcription:update payload
interface TranscriptionUpdatePayload {
  partial: string;        // Current partial transcript
  isFinal: boolean;       // Whether this is the final result
}

// screenshot:captured payload
interface ScreenshotPayload {
  index: number;          // Screenshot sequence number
  timestamp: number;      // Capture time (ms since session start)
}

// error:occurred payload
interface ErrorPayload {
  code: string;           // Error code (e.g., 'PERMISSION_DENIED')
  message: string;        // Human-readable message
  recoverable: boolean;   // Whether user can retry
}
```

### 8.3 Error Propagation Pattern

```
Main Process Error
       |
       v
Classify Error (transient/recoverable/fatal)
       |
       +---> Transient: Retry with backoff, don't notify UI
       |
       +---> Recoverable: Fallback to next tier, notify UI
       |
       +---> Fatal: Emit error:occurred, show recovery UI
```

---

## 9. Security Architecture

### 9.1 Data Handling

| Data Type | Storage | Retention |
|-----------|---------|-----------|
| Audio recordings | In-memory during session | Auto-deleted on session end |
| Transcripts | In-memory during session | Exported to output dir as markdown on completion |
| Screenshots | Temp directory during session | Embedded in markdown, temp files auto-cleaned |
| Settings | User preferences | Persistent |
| API keys | Keychain (encrypted) | Persistent |

**Data Lifecycle:**
1. **During recording**: Audio buffered in memory, screenshots written to temp dir
2. **On completion**: Markdown generated with embedded screenshots, saved to output directory
3. **Cleanup**: Temp files automatically deleted after successful export

### 9.2 Privacy Principles

1. **Local-first**: Default transcription happens entirely on-device
2. **No telemetry**: No usage data sent without explicit opt-in
3. **No cloud storage**: All data stays on user's machine
4. **Explicit upload**: User must explicitly choose to use cloud APIs

---

## 10. File System Architecture

### 10.1 Application Structure

```
FeedbackFlow.app/
├── Contents/
│   ├── MacOS/
│   │   └── FeedbackFlow           # Main executable
│   ├── Resources/
│   │   ├── app.asar               # Bundled application
│   │   ├── icons/                 # Tray icons (all states)
│   │   └── whisper/               # Bundled Whisper model (optional)
│   └── Info.plist
```

### 10.2 User Data Locations

```
~/Library/Application Support/FeedbackFlow/
├── settings.json                  # User preferences
├── state/
│   └── current-session.json       # Crash recovery state
└── models/
    └── whisper-base.bin           # Downloaded Whisper model

~/Documents/FeedbackFlow/          # Default output location
└── feedback-2026-02-03-1000.md    # Exported feedback files
```

### 10.3 Temporary Data

```
/tmp/feedbackflow/
└── session-{uuid}/
    ├── audio.wav                  # Recording in progress
    ├── screenshot-001.png         # Captured screenshots
    └── transcript.partial.txt     # In-progress transcript
```

---

## 11. Build & Distribution Architecture

### 11.1 Build Pipeline

```
Source Code
     |
     v
TypeScript Compile
     |
     v
Vite Bundle
     |
     v
Electron Builder
     |
     +---> DMG (macOS)
     |
     +---> Code Signing (if certs available)
     |
     v
Notarization (Apple)
     |
     v
GitHub Release
```

### 11.2 CI/CD Workflow

```
Push to main
     |
     v
GitHub Actions
     |
     +---> Lint (ESLint)
     |
     +---> Type Check (tsc)
     |
     +---> Unit Tests (Jest)
     |
     +---> Build (electron-builder)
     |
     v
[On tag v*.*.*]
     |
     +---> Sign & Notarize
     |
     +---> Create GitHub Release
     |
     +---> Upload DMG + checksums
```

---

## 12. Integration Points

### 12.1 External Services (Optional)

| Service | Purpose | Required? |
|---------|---------|-----------|
| Deepgram API | Cloud transcription (Tier 1) | No |
| Ko-fi | Donation link | No (but included) |
| GitHub | Distribution, issues | Yes |

### 12.2 System Integrations

| Integration | Purpose | API Used |
|-------------|---------|----------|
| macOS Audio | Recording | AVFoundation via Electron |
| macOS Screenshots | Screen capture | Electron desktopCapturer |
| macOS Dictation | Fallback transcription | NSSpeechRecognizer |
| System Clipboard | Copy output | Electron clipboard |
| System Tray | Menu bar presence | Electron Tray |
| Keychain | Secure API key storage | keytar |

---

## 13. Scalability Considerations

While FeedbackFlow is a single-user desktop app, the architecture supports:

| Scenario | Support |
|----------|---------|
| Multiple recordings per day | Session isolation |
| Large audio files (30 min) | Streaming transcription |
| Multiple screenshot formats | Configurable capture |
| Future cloud sync | Abstracted storage layer |

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-03 | Initial architecture document |
