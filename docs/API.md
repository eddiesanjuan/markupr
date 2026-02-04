# API Reference

FeedbackFlow uses Electron's IPC (Inter-Process Communication) for all communication between the main process and renderer. This document covers the internal API for developers.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [IPC Channels](#ipc-channels)
- [Preload API](#preload-api)
- [Event System](#event-system)
- [Plugin Architecture](#plugin-architecture)
- [Type Definitions](#type-definitions)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Renderer Process                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  React Application                    │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐            │   │
│  │  │  App.tsx │  │Components│  │  Hooks  │            │   │
│  │  └────┬────┘  └────┬────┘  └────┬────┘            │   │
│  │       │            │            │                   │   │
│  │       └────────────┴────────────┘                   │   │
│  │                     │                                │   │
│  │              window.feedbackflow                     │   │
│  └─────────────────────┬───────────────────────────────┘   │
│                        │                                     │
├────────────────────────┼─────────────────────────────────────┤
│                   Preload Script                             │
│              contextBridge.exposeInMainWorld                 │
├────────────────────────┼─────────────────────────────────────┤
│                        │                                     │
│                     ipcMain                                  │
│                        │                                     │
│  ┌─────────────────────┴───────────────────────────────┐   │
│  │                    Main Process                       │   │
│  │                                                       │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │ Session  │ │ Capture  │ │Transcript│            │   │
│  │  │Controller│ │ Service  │ │ Service  │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  │                                                       │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │  Hotkey  │ │   Tray   │ │ Settings │            │   │
│  │  │ Manager  │ │ Manager  │ │ Manager  │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  └───────────────────────────────────────────────────────┘   │
│                     Main Process                             │
└─────────────────────────────────────────────────────────────┘
```

## IPC Channels

All IPC channels are defined in `src/shared/types.ts` with the `IPC_CHANNELS` constant.

### Session Channels

#### Renderer to Main

| Channel | Method | Description | Returns |
|---------|--------|-------------|---------|
| `feedbackflow:session:start` | invoke | Start recording | `{success, sessionId?, error?}` |
| `feedbackflow:session:stop` | invoke | Stop recording | `{success, session?, error?}` |
| `feedbackflow:session:cancel` | invoke | Cancel without saving | `{success}` |
| `feedbackflow:session:get-status` | invoke | Get current status | `SessionStatusPayload` |
| `feedbackflow:session:get-current` | invoke | Get session data | `SessionPayload | null` |

#### Main to Renderer

| Channel | Description | Payload |
|---------|-------------|---------|
| `feedbackflow:session:state-changed` | State transition | `{state, session}` |
| `feedbackflow:session:status-update` | Periodic status | `SessionStatusPayload` |
| `feedbackflow:session:complete` | Session finished | `SessionPayload` |
| `feedbackflow:session:feedback-item` | New item captured | `FeedbackItemPayload` |
| `feedbackflow:session:error` | Error occurred | `{message}` |

### Capture Channels

#### Renderer to Main

| Channel | Method | Description | Returns |
|---------|--------|-------------|---------|
| `feedbackflow:capture:get-sources` | invoke | List sources | `CaptureSource[]` |
| `feedbackflow:capture:manual-screenshot` | invoke | Take screenshot | `{success}` |

#### Main to Renderer

| Channel | Description | Payload |
|---------|-------------|---------|
| `feedbackflow:capture:screenshot-taken` | Screenshot captured | `ScreenshotCapturedPayload` |
| `feedbackflow:capture:manual-triggered` | Manual hotkey used | `{timestamp}` |

### Audio Channels

#### Communication Flow

```
Main Process                    Renderer Process
     │                               │
     │ ─── AUDIO_START_CAPTURE ───> │  Start audio capture
     │                               │
     │ <── AUDIO_CAPTURE_STARTED ─── │  Confirm started
     │                               │
     │ <── AUDIO_CHUNK ──────────── │  Audio data (100ms chunks)
     │ <── AUDIO_CHUNK ──────────── │
     │ <── AUDIO_CHUNK ──────────── │
     │                               │
     │ ─── AUDIO_STOP_CAPTURE ────> │  Stop capture
     │                               │
     │ <── AUDIO_CAPTURE_STOPPED ── │  Confirm stopped
```

### Settings Channels

| Channel | Method | Description | Returns |
|---------|--------|-------------|---------|
| `feedbackflow:settings:get` | invoke | Get single setting | `AppSettings[K]` |
| `feedbackflow:settings:get-all` | invoke | Get all settings | `AppSettings` |
| `feedbackflow:settings:set` | invoke | Set single setting | `AppSettings` |
| `feedbackflow:settings:get-api-key` | invoke | Get API key (secure) | `string | null` |
| `feedbackflow:settings:set-api-key` | invoke | Set API key (secure) | `boolean` |

### Update Channels

| Channel | Method | Description | Returns |
|---------|--------|-------------|---------|
| `feedbackflow:update:check` | invoke | Check for updates | `UpdateInfo` |
| `feedbackflow:update:download` | invoke | Download update | `void` |
| `feedbackflow:update:install` | invoke | Install and restart | `void` |

#### Main to Renderer

| Channel | Description | Payload |
|---------|-------------|---------|
| `feedbackflow:update:status` | Update status change | `UpdateStatusPayload` |

## Preload API

The preload script (`src/preload/index.ts`) exposes a safe API to the renderer via `window.feedbackflow`.

### Session API

```typescript
// Start a recording session
const result = await window.feedbackflow.session.start(sourceId);
// Returns: { success: boolean; sessionId?: string; error?: string }

// Stop the current session
const result = await window.feedbackflow.session.stop();
// Returns: { success: boolean; session?: SessionPayload; error?: string }

// Cancel without saving
const result = await window.feedbackflow.session.cancel();
// Returns: { success: boolean }

// Get current status
const status = await window.feedbackflow.session.getStatus();
// Returns: SessionStatusPayload

// Get current session data
const session = await window.feedbackflow.session.getCurrent();
// Returns: SessionPayload | null

// Subscribe to state changes
const unsubscribe = window.feedbackflow.session.onStateChange(({ state, session }) => {
  console.log('State:', state);
});

// Subscribe to new feedback items
const unsubscribe = window.feedbackflow.session.onFeedbackItem((item) => {
  console.log('New item:', item);
});

// Subscribe to errors
const unsubscribe = window.feedbackflow.session.onError(({ message }) => {
  console.error('Error:', message);
});
```

### Capture API

```typescript
// Get available capture sources
const sources = await window.feedbackflow.capture.getSources();
// Returns: CaptureSource[]

// Trigger manual screenshot
await window.feedbackflow.capture.manualScreenshot();

// Subscribe to screenshots
const unsubscribe = window.feedbackflow.capture.onScreenshot((data) => {
  console.log('Screenshot:', data.id, data.count);
});
```

### Audio API

```typescript
// Get available devices (enumeration happens in renderer)
const devices = await window.feedbackflow.audio.getDevices();

// Set preferred device
await window.feedbackflow.audio.setDevice(deviceId);

// Subscribe to audio level (for visualization)
const unsubscribe = window.feedbackflow.audio.onLevel((level) => {
  // level is 0-1 normalized amplitude
});

// Subscribe to voice activity
const unsubscribe = window.feedbackflow.audio.onVoiceActivity((isActive) => {
  // isActive is boolean
});
```

### Settings API

```typescript
// Get a single setting
const theme = await window.feedbackflow.settings.get('theme');

// Get all settings
const settings = await window.feedbackflow.settings.getAll();

// Set a setting
const updated = await window.feedbackflow.settings.set('theme', 'dark');

// Get API key from secure storage
const apiKey = await window.feedbackflow.settings.getApiKey('deepgram');

// Set API key in secure storage
const success = await window.feedbackflow.settings.setApiKey('deepgram', 'your-key');
```

### Hotkeys API

```typescript
// Get current configuration
const config = await window.feedbackflow.hotkeys.getConfig();
// Returns: HotkeyConfig

// Update configuration
const result = await window.feedbackflow.hotkeys.updateConfig({
  toggleRecording: 'CommandOrControl+Shift+G'
});
// Returns: { config: HotkeyConfig; results: RegistrationResult[] }

// Subscribe to hotkey triggers
const unsubscribe = window.feedbackflow.hotkeys.onTriggered(({ action, accelerator }) => {
  console.log('Hotkey:', action);
});
```

### Output API

```typescript
// Save current session
const result = await window.feedbackflow.output.save();
// Returns: SaveResult

// Copy to clipboard
const success = await window.feedbackflow.output.copyClipboard();

// Open output folder
await window.feedbackflow.output.openFolder();

// List saved sessions
const sessions = await window.feedbackflow.output.listSessions();

// Delete a session
await window.feedbackflow.output.deleteSession(sessionId);

// Export a session
await window.feedbackflow.output.exportSession(sessionId, 'pdf');
```

### Crash Recovery API

```typescript
// Check for incomplete sessions
const { hasIncomplete, session } = await window.feedbackflow.crashRecovery.check();

// Recover an incomplete session
const result = await window.feedbackflow.crashRecovery.recover(sessionId);

// Discard incomplete session
await window.feedbackflow.crashRecovery.discard();

// Get crash logs
const logs = await window.feedbackflow.crashRecovery.getLogs(10);

// Subscribe to found incomplete sessions (on startup)
const unsubscribe = window.feedbackflow.crashRecovery.onIncompleteFound(({ session }) => {
  // Show recovery dialog
});
```

### Updates API

```typescript
// Check for updates
await window.feedbackflow.updates.check();

// Download available update
await window.feedbackflow.updates.download();

// Install and restart
await window.feedbackflow.updates.install();

// Subscribe to update status
const unsubscribe = window.feedbackflow.updates.onStatus((status) => {
  console.log('Update status:', status.status);
  if (status.percent) {
    console.log('Progress:', status.percent);
  }
});
```

## Event System

### Event Subscription Pattern

All event subscriptions return an unsubscribe function:

```typescript
// Subscribe
const unsubscribe = window.feedbackflow.session.onStateChange((data) => {
  // Handle event
});

// Later, clean up
unsubscribe();
```

### Using with React

```tsx
import { useEffect, useState } from 'react';

function useSessionState() {
  const [state, setState] = useState<SessionState>('idle');

  useEffect(() => {
    const unsubscribe = window.feedbackflow.session.onStateChange(({ state }) => {
      setState(state);
    });

    return unsubscribe; // Clean up on unmount
  }, []);

  return state;
}
```

## Plugin Architecture

FeedbackFlow is designed to support plugins in future versions.

### Planned Plugin Types

1. **Output Formatters**: Add new export formats
2. **Transcription Services**: Alternative to Deepgram
3. **Integrations**: Connect to external services
4. **Annotation Tools**: Custom drawing tools

### Plugin Interface (Draft)

```typescript
interface FeedbackFlowPlugin {
  name: string;
  version: string;
  type: 'formatter' | 'transcription' | 'integration' | 'annotation';

  // Lifecycle hooks
  onLoad(): Promise<void>;
  onUnload(): Promise<void>;

  // Type-specific methods
  // ...
}

// Example: Custom formatter plugin
interface FormatterPlugin extends FeedbackFlowPlugin {
  type: 'formatter';

  format(session: Session): Promise<{
    content: string;
    extension: string;
    mimeType: string;
  }>;
}
```

## Type Definitions

### Core Types

```typescript
// Session state machine
type SessionState = 'idle' | 'recording' | 'processing' | 'complete';

// Session status
type SessionStatus = 'idle' | 'recording' | 'processing' | 'complete' | 'error';

// Tray icon states
type TrayState = 'idle' | 'recording' | 'processing' | 'error';
```

### Payload Types

```typescript
// Session status (sent during recording)
interface SessionStatusPayload {
  state: SessionState;
  duration: number;
  feedbackCount: number;
  screenshotCount: number;
}

// Feedback item (sent when captured)
interface FeedbackItemPayload {
  id: string;
  timestamp: number;
  text: string;
  confidence: number;
  hasScreenshot: boolean;
  screenshotId?: string;
}

// Screenshot captured
interface ScreenshotCapturedPayload {
  id: string;
  timestamp: number;
  count: number;
  width?: number;
  height?: number;
}

// Transcript chunk
interface TranscriptChunkPayload {
  text: string;
  timestamp: number;
  confidence: number;
  isFinal: boolean;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
}
```

### Configuration Types

```typescript
// Hotkey configuration
interface HotkeyConfig {
  toggleRecording: string;
  manualScreenshot: string;
}

// Application settings
interface AppSettings {
  outputDirectory: string;
  launchAtLogin: boolean;
  checkForUpdates: boolean;
  defaultCountdown: 0 | 3 | 5;
  showTranscriptionPreview: boolean;
  showAudioWaveform: boolean;
  pauseThreshold: number;
  minTimeBetweenCaptures: number;
  imageFormat: 'png' | 'jpeg';
  imageQuality: number;
  maxImageWidth: number;
  theme: 'dark' | 'light' | 'system';
  accentColor: string;
  hotkeys: HotkeyConfig;
  audioDeviceId: string | null;
  debugMode: boolean;
  keepAudioBackups: boolean;
}
```

### Capture Types

```typescript
// Capture source
interface CaptureSource {
  id: string;
  name: string;
  type: 'screen' | 'window';
  thumbnail?: string;
  appIcon?: string;
  display?: DisplayInfo;
}

// Display info (multi-monitor)
interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
  rotation: 0 | 90 | 180 | 270;
  internal: boolean;
}
```

For the complete type definitions, see `src/shared/types.ts`.
