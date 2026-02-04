# FeedbackFlow - Technology Stack

> Technical stack decisions and dependencies

---

## 1. Overview

FeedbackFlow uses a modern Electron-based stack optimized for:
- **Offline-first** operation with local ML
- **Native macOS feel** despite web technologies
- **Type safety** throughout the codebase
- **Fast iteration** with hot reload

---

## 2. Core Technologies

### 2.1 Desktop Framework

| Technology | Version | Purpose |
|------------|---------|---------|
| **Electron** | ^28.0.0 | Cross-platform desktop runtime |
| **Node.js** | ^20.x | Backend runtime (bundled with Electron) |

**Why Electron?**
- Mature ecosystem for menu bar apps
- Web technologies for rapid UI development
- Strong macOS integration (Tray, popover patterns)
- Easy packaging and distribution

### 2.2 Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | ^18.x | UI component framework |
| **TypeScript** | ^5.x | Type safety |
| **Tailwind CSS** | ^3.x | Utility-first styling |
| **Vite** | ^5.x | Build tool and dev server |

**Why React?**
- Component model fits popover UI structure
- Large ecosystem of UI libraries
- TypeScript integration excellent
- Hot module replacement for fast development

### 2.3 State Management

| Technology | Purpose |
|------------|---------|
| **Custom State Machine** | Session lifecycle management |
| **React Context** | UI state (settings, theme) |
| **electron-store** | Persistent settings storage |

**Why custom state machine?**
- Bulletproof guarantees require explicit state control
- XState considered but adds complexity
- Simple finite state machine with timeouts sufficient

---

## 3. Transcription Stack

### 3.1 Local Transcription (Default)

| Technology | Version | Purpose |
|------------|---------|---------|
| **whisper.cpp** | latest | C++ Whisper implementation |
| **whisper-node** | ^1.x | Node.js bindings for whisper.cpp |

**Model Specifications:**
| Model | Size | Quality | Speed |
|-------|------|---------|-------|
| whisper-tiny | ~75MB | Basic | Fastest |
| **whisper-base** | ~150MB | Good | Fast |
| whisper-small | ~500MB | Better | Moderate |
| whisper-medium | ~1.5GB | Best | Slow |

**Default: whisper-base** (best balance of quality/size)

**Why whisper.cpp?**
- No Python dependency
- Native performance
- Works completely offline
- MIT licensed

### 3.2 Cloud Transcription (Optional)

| Technology | Purpose |
|------------|---------|
| **Deepgram Nova-3** | Premium cloud transcription |

**Why Deepgram?**
- Best-in-class accuracy
- Real-time streaming capability
- Utterance-end detection for screenshots
- Developer-friendly API

### 3.3 Fallback Transcription

| Technology | Purpose |
|------------|---------|
| **macOS Dictation** | Emergency fallback via NSSpeechRecognizer |

---

## 4. Audio & Media

### 4.1 Audio Capture

| Technology | Purpose |
|------------|---------|
| **Electron Audio** | Microphone access via web APIs |
| **Web Audio API** | Audio visualization (waveform) |
| **ffmpeg** | Audio format conversion (if needed) |

### 4.2 Screenshot Capture

| Technology | Purpose |
|------------|---------|
| **Electron desktopCapturer** | Screen/window capture |
| **sharp** | Image optimization |

---

## 5. Storage & Persistence

### 5.1 Settings Storage

| Technology | Purpose |
|------------|---------|
| **electron-store** | JSON-based settings persistence |
| **keytar** | Secure credential storage (Keychain) |

**Settings Location:**
```
~/Library/Application Support/FeedbackFlow/settings.json
```

### 5.2 State Persistence

| Technology | Purpose |
|------------|---------|
| **Node.js fs** | State file I/O |
| **JSON** | State serialization format |

**State Location:**
```
~/Library/Application Support/FeedbackFlow/state/current-session.json
```

### 5.3 Temporary Storage

| Technology | Purpose |
|------------|---------|
| **os.tmpdir()** | Temporary recording storage |
| **uuid** | Session directory naming |

**Temp Location:**
```
/tmp/feedbackflow/session-{uuid}/
```

---

## 6. Build & Package

### 6.1 Build Tools

| Technology | Version | Purpose |
|------------|---------|---------|
| **Vite** | ^5.x | Frontend bundling |
| **esbuild** | via Vite | Fast TypeScript compilation |
| **TypeScript** | ^5.x | Type checking |

### 6.2 Packaging

| Technology | Version | Purpose |
|------------|---------|---------|
| **electron-builder** | ^24.x | Application packaging |
| **electron-notarize** | ^2.x | macOS notarization |

**Output Formats:**
- `.dmg` - macOS disk image (primary)
- `.zip` - macOS zip archive (CI artifacts)

### 6.3 CI/CD

| Technology | Purpose |
|------------|---------|
| **GitHub Actions** | CI/CD pipeline |
| **ESLint** | Code linting |
| **Prettier** | Code formatting |
| **Jest** | Unit testing |

---

## 7. Development Tools

### 7.1 Required Tools

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | ^20.x | Runtime |
| **pnpm** | ^8.x | Package manager (preferred) |
| **Git** | ^2.x | Version control |
| **Xcode CLT** | latest | Native compilation (whisper.cpp) |

### 7.2 Recommended IDE Setup

| Tool | Extensions |
|------|------------|
| **VS Code** | ESLint, Prettier, TypeScript, Tailwind CSS IntelliSense |
| **Cursor** | Same as VS Code |

### 7.3 Debug Tools

| Tool | Purpose |
|------|---------|
| **Electron DevTools** | React inspection, network, console |
| **React Developer Tools** | Component tree, props, state |
| **electron-debug** | F12 to open DevTools in dev mode |

---

## 8. Dependencies

### 8.1 Production Dependencies

```json
{
  "dependencies": {
    "electron-store": "^8.x",
    "keytar": "^7.x",
    "sharp": "^0.33.x",
    "uuid": "^9.x",
    "whisper-node": "^1.x"
  }
}
```

### 8.2 Development Dependencies

```json
{
  "devDependencies": {
    "@types/node": "^20.x",
    "@types/react": "^18.x",
    "@vitejs/plugin-react": "^4.x",
    "electron": "^28.x",
    "electron-builder": "^24.x",
    "eslint": "^8.x",
    "jest": "^29.x",
    "prettier": "^3.x",
    "tailwindcss": "^3.x",
    "typescript": "^5.x",
    "vite": "^5.x"
  }
}
```

### 8.3 React Dependencies

```json
{
  "dependencies": {
    "react": "^18.x",
    "react-dom": "^18.x"
  }
}
```

---

## 9. System Requirements

### 9.1 Minimum Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| macOS | 11.0 (Big Sur) | 13.0+ (Ventura) |
| RAM | 4GB | 8GB+ |
| Disk Space | 500MB | 1GB+ |
| CPU | Apple Silicon or Intel | Apple Silicon |

### 9.2 Permissions Required

| Permission | Purpose | When Requested |
|------------|---------|----------------|
| Microphone | Audio recording | First recording |
| Screen Recording | Screenshot capture | First screenshot |
| Accessibility | Global hotkeys (optional) | Settings change |

---

## 10. Native Module Compilation

### 10.1 whisper-node Requirements

whisper.cpp requires native compilation:

```bash
# Prerequisites (macOS)
xcode-select --install
brew install cmake
```

### 10.2 Electron Rebuild

After installing native modules:

```bash
npx electron-rebuild
```

### 10.3 Architecture Support

| Architecture | Status |
|--------------|--------|
| arm64 (Apple Silicon) | Primary target |
| x64 (Intel Mac) | Supported |
| Universal Binary | Build target |

---

## 11. API Integrations

### 11.1 Deepgram API (Optional)

| Endpoint | Purpose |
|----------|---------|
| `wss://api.deepgram.com/v1/listen` | Real-time transcription |

**Required Headers:**
```
Authorization: Token {API_KEY}
```

**Configuration:**
```json
{
  "model": "nova-3",
  "language": "en",
  "punctuate": true,
  "utterances": true
}
```

### 11.2 Ko-fi (Donate Button)

| URL | Purpose |
|-----|---------|
| `https://ko-fi.com/eddiesanjuan` | Donation link |

---

## 12. File Format Specifications

### 12.1 Audio Format

| Property | Value |
|----------|-------|
| Format | WAV |
| Sample Rate | 16000 Hz |
| Channels | Mono |
| Bit Depth | 16-bit |

**Why this format?**
- Whisper requires 16kHz mono
- WAV is lossless and simple
- No additional encoding needed

### 12.2 Output Markdown Format

```markdown
# Feedback Session
**Date:** 2026-02-03 10:00 AM
**Duration:** 2:34

## Transcript
[Transcribed text here...]

## Screenshots
![Screenshot 1](./screenshots/screenshot-001.png)
![Screenshot 2](./screenshots/screenshot-002.png)

---
*Generated by FeedbackFlow*
```

### 12.3 Settings Schema

```typescript
interface Settings {
  transcriptionTier: 'deepgram' | 'whisper' | 'dictation';
  deepgramApiKey?: string;
  hotkey: string;
  outputLocation: string;
  theme: 'system' | 'light' | 'dark';
  launchAtLogin: boolean;
  donateMessageIndex: number;
}
```

---

## 13. Security Considerations

### 13.1 Sensitive Data Handling

| Data | Storage Method |
|------|----------------|
| Deepgram API Key | macOS Keychain via keytar |
| Audio Recordings | Temp directory, auto-deleted |
| Transcripts | Memory only until export |

### 13.2 Code Signing

| Certificate | Purpose |
|-------------|---------|
| Developer ID Application | Sign .app bundle |
| Developer ID Installer | Sign .pkg (if used) |

### 13.3 Notarization

Required for Gatekeeper approval:
```bash
xcrun notarytool submit FeedbackFlow.dmg \
  --apple-id "developer@example.com" \
  --team-id "TEAM_ID" \
  --password "@keychain:AC_PASSWORD"
```

---

## 14. Performance Targets

| Metric | Target |
|--------|--------|
| App Launch | < 2 seconds |
| Popover Open | < 100ms |
| Recording Start | < 500ms |
| Whisper Transcription | < 2x real-time |
| Idle Memory | < 100MB |
| Recording Memory | < 200MB |

---

## 15. Future Considerations

### 15.1 Potential Upgrades

| Technology | Current | Future Option |
|------------|---------|---------------|
| Desktop Framework | Electron | Tauri (smaller binary) |
| Local ML | whisper-node | mlx-whisper (Apple Silicon optimized) |
| State Management | Custom | XState (if complexity grows) |

### 15.2 Not Planned

| Technology | Reason |
|------------|--------|
| Swift/SwiftUI rewrite | Electron sufficient, faster iteration |
| Windows/Linux | macOS-only by design |
| Mobile apps | Desktop-focused product |

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-03 | Initial tech stack document |
