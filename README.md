<p align="center">
  <img src="src/renderer/assets/logo.svg" alt="FeedbackFlow Logo" width="120" height="120">
</p>

<h1 align="center">FeedbackFlow</h1>

<p align="center">
  <strong>Capture developer feedback with voice narration and intelligent screenshots</strong>
</p>

<p align="center">
  <a href="https://github.com/eddiesanjuan/feedbackflow/actions/workflows/ci.yml"><img src="https://github.com/eddiesanjuan/feedbackflow/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/eddiesanjuan/feedbackflow/actions/workflows/release.yml"><img src="https://github.com/eddiesanjuan/feedbackflow/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="https://github.com/eddiesanjuan/feedbackflow/releases"><img src="https://img.shields.io/github/v/release/eddiesanjuan/feedbackflow?style=flat-square" alt="Latest Release"></a>
  <a href="https://github.com/eddiesanjuan/feedbackflow/releases"><img src="https://img.shields.io/github/downloads/eddiesanjuan/feedbackflow/total?style=flat-square" alt="Downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License"></a>
  <a href="https://ko-fi.com/eddiesanjuan"><img src="https://img.shields.io/badge/Support-Ko--fi-FF5E5B?style=flat-square&logo=ko-fi" alt="Ko-fi"></a>
</p>

<p align="center">
  <a href="#features">Features</a> |
  <a href="#quick-start">Quick Start</a> |
  <a href="#installation">Installation</a> |
  <a href="#usage">Usage</a> |
  <a href="#keyboard-shortcuts">Shortcuts</a> |
  <a href="#export-formats">Export</a> |
  <a href="#development">Development</a>
</p>

---

FeedbackFlow is a desktop application that transforms how developers capture and communicate feedback. Simply press a hotkey, narrate what you see, and FeedbackFlow automatically captures intelligent screenshots synchronized with your voice. The result is an AI-ready Markdown document perfect for Claude, ChatGPT, Cursor, or any coding assistant.

## Features

### Voice-Driven Capture
- **Real-time transcription** powered by Deepgram's Nova-2 model
- **Intelligent screenshot timing** - captures automatically during voice pauses
- **Audio waveform visualization** for real-time feedback

### Smart Screenshots
- **Voice Activity Detection (VAD)** triggers captures at natural pause points
- **Manual screenshot hotkey** for precise control
- **Multi-monitor support** with display selection
- **Window-specific capture** for focused feedback

### AI-Ready Output
- **Markdown format** optimized for LLM consumption (llms.txt inspired)
- **Structured feedback items** with timestamps and categories
- **Embedded screenshots** or linked references
- **Multiple export formats**: Markdown, PDF, HTML, JSON

### Professional Experience
- **Native macOS menu bar** integration
- **System tray** with status indicators
- **Global hotkeys** that work from any application
- **Auto-updater** for seamless updates
- **Crash recovery** to never lose your work

### Annotation Tools
- Arrow, circle, rectangle, and freehand drawing
- Text annotations
- Undo/redo support

## Quick Start

1. **Download** the latest release for your platform
2. **Install** the application (DMG for macOS, installer for Windows)
3. **Press** `Cmd+Shift+F` (macOS) or `Ctrl+Shift+F` (Windows) to start recording
4. **Narrate** your feedback while FeedbackFlow captures screenshots
5. **Press** the hotkey again to stop - your feedback is copied to clipboard

**No API key required!** FeedbackFlow uses local AI (Whisper) by default. Add a Deepgram key in Settings for cloud-powered accuracy.

## Installation

### macOS

Download the `.dmg` file from the [releases page](https://github.com/eddiesanjuan/feedbackflow/releases).

1. Open the DMG file
2. Drag FeedbackFlow to your Applications folder
3. Launch FeedbackFlow from Applications
4. Grant required permissions (Microphone, Screen Recording)

### Windows

Download the `.exe` installer from the [releases page](https://github.com/eddiesanjuan/feedbackflow/releases).

1. Run the installer
2. Follow the installation wizard
3. Launch FeedbackFlow from the Start menu

### Linux

Download the `.AppImage` or `.deb` file from the [releases page](https://github.com/eddiesanjuan/feedbackflow/releases).

```bash
# AppImage
chmod +x FeedbackFlow-*.AppImage
./FeedbackFlow-*.AppImage

# Debian/Ubuntu
sudo dpkg -i feedbackflow_*.deb
```

## Configuration

### Transcription Options

FeedbackFlow works out of the box with **local Whisper** transcription - no API key needed.

For improved accuracy, optionally add [Deepgram](https://deepgram.com):

1. Sign up at [console.deepgram.com](https://console.deepgram.com)
2. Create an API key with "Usage" permissions
3. Open Settings > Advanced > Transcription Service
4. Select "Deepgram" and enter your API key

Deepgram offers 200 free hours/month.

### Settings Overview

| Category | Setting | Description |
|----------|---------|-------------|
| **General** | Output Directory | Where sessions are saved |
| | Launch at Login | Start FeedbackFlow on system boot |
| **Recording** | Countdown | 0, 3, or 5 second countdown before recording |
| | Transcription Preview | Show live transcription overlay |
| | Audio Waveform | Visual audio level feedback |
| **Capture** | Pause Threshold | Voice pause duration before screenshot (500-3000ms) |
| | Min Time Between | Minimum gap between screenshots |
| **Appearance** | Theme | Dark, Light, or System |
| | Accent Color | Customize UI accent color |
| **Hotkeys** | Toggle Recording | Default: `Cmd/Ctrl+Shift+F` |
| | Manual Screenshot | Default: `Cmd/Ctrl+Shift+S` |

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for complete settings documentation.

## Usage

### Basic Workflow

1. **Start Recording**: Press `Cmd+Shift+F` (macOS) or `Ctrl+Shift+F` (Windows)
2. **Select Source**: Choose which screen or window to capture
3. **Narrate**: Speak naturally about what you see
4. **Screenshots**: Captured automatically during pauses (or press `Cmd+Shift+S` manually)
5. **Stop Recording**: Press the hotkey again
6. **Review**: Edit, reorder, or delete items in the review panel
7. **Export**: Copy to clipboard or export to your preferred format

### Recording Tips

- **Speak naturally** - FeedbackFlow detects pauses to time screenshots
- **Pause briefly** when you want a screenshot captured
- **Use manual capture** (`Cmd+Shift+S`) for precise timing
- **Review before export** to remove unwanted items

### Session Review

After stopping a recording, the Session Review panel lets you:

- **Reorder items** by dragging
- **Edit transcriptions** inline
- **Delete unwanted** screenshots or feedback
- **Preview output** in real-time
- **Add annotations** to screenshots

## Keyboard Shortcuts

### Recording

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Start/Stop Recording | `Cmd+Shift+F` | `Ctrl+Shift+F` |
| Manual Screenshot | `Cmd+Shift+S` | `Ctrl+Shift+S` |
| Pause/Resume | `Cmd+Shift+P` | `Ctrl+Shift+P` |

### Navigation

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Open Settings | `Cmd+,` | `Ctrl+,` |
| Session History | `Cmd+H` | `Ctrl+H` |
| Keyboard Shortcuts | `Cmd+/` | `Ctrl+/` |
| Close Dialog | `Escape` | `Escape` |

### Editing

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Delete Selected | `Backspace` | `Delete` |
| Edit Item | `Enter` | `Enter` |
| Move Up | `Cmd+Up` | `Ctrl+Up` |
| Move Down | `Cmd+Down` | `Ctrl+Down` |
| Undo | `Cmd+Z` | `Ctrl+Z` |
| Redo | `Cmd+Shift+Z` | `Ctrl+Shift+Z` |
| Select All | `Cmd+A` | `Ctrl+A` |

### Annotation Tools

| Tool | Shortcut |
|------|----------|
| Arrow | `1` |
| Circle | `2` |
| Rectangle | `3` |
| Freehand | `4` |
| Text | `5` |
| Clear Annotations | `Cmd/Ctrl+Backspace` |

See [docs/KEYBOARD_SHORTCUTS.md](docs/KEYBOARD_SHORTCUTS.md) for the complete reference.

## Export Formats

### Markdown (.md)

AI-optimized format inspired by [llms.txt](https://llms.txt). Includes:

- Structured headings
- Timestamped feedback items
- Image references (embedded or linked)
- Summary table

```markdown
# Feedback Report: My App

## Summary
- **Duration**: 2m 34s
- **Items**: 5 feedback points
- **Screenshots**: 3 captured

## Feedback Items

### FB-001: Login button not visible
**Timestamp**: 00:15 | **Type**: Bug

> The login button is hidden behind the header on mobile viewport...

![Screenshot](./screenshots/fb-001.png)
```

### PDF (.pdf)

Professional document with:
- Embedded screenshots
- Print-ready layout
- Dark or light theme
- Professional typography

### HTML (.html)

Self-contained web page with:
- No external dependencies
- Dark/light theme toggle
- Mobile responsive
- Embedded images as base64

### JSON (.json)

Machine-readable format for integrations:

```json
{
  "version": "1.0",
  "session": {
    "id": "session-123",
    "startTime": 1704067200000,
    "endTime": 1704067354000,
    "source": "My App - Chrome"
  },
  "feedbackItems": [
    {
      "id": "FB-001",
      "timestamp": 1704067215000,
      "transcription": "The login button is hidden...",
      "category": "bug",
      "confidence": 0.95,
      "screenshot": {
        "id": "screenshot-001",
        "path": "./screenshots/fb-001.png",
        "width": 1920,
        "height": 1080
      }
    }
  ]
}
```

See [docs/EXPORT_FORMATS.md](docs/EXPORT_FORMATS.md) for complete schema documentation.

## Development

### Prerequisites

- Node.js 18+
- npm 9+
- macOS, Windows, or Linux

### Setup

```bash
# Clone the repository
git clone https://github.com/eddiesanjuan/feedbackflow.git
cd feedbackflow

# Install dependencies
npm install

# Start development mode
npm run dev
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start in development mode with hot reload |
| `npm run build` | Build for production |
| `npm run package` | Package for current platform |
| `npm run package:mac` | Package for macOS |
| `npm run package:win` | Package for Windows |
| `npm run package:linux` | Package for Linux |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint code |
| `npm run typecheck` | TypeScript type checking |

### Project Structure

```
feedbackflow/
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # Entry point, orchestration
│   │   ├── capture/       # Screen capture services
│   │   ├── audio/         # Audio capture
│   │   ├── transcription/ # Deepgram integration
│   │   ├── output/        # Document generation
│   │   ├── analysis/      # AI categorization
│   │   └── settings/      # Settings management
│   ├── renderer/          # React UI
│   │   ├── App.tsx        # Main component
│   │   ├── components/    # UI components
│   │   └── hooks/         # React hooks
│   ├── preload/           # Electron preload (IPC bridge)
│   └── shared/            # Shared types
├── tests/                 # Test files
├── docs/                  # Documentation
└── package.json
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for detailed development documentation.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Quick Start for Contributors

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Run tests: `npm test`
5. Commit: `git commit -m 'Add amazing feature'`
6. Push: `git push origin feature/amazing-feature`
7. Open a Pull Request

## Troubleshooting

### Common Issues

**Microphone not detected**
- Check System Preferences > Security & Privacy > Microphone
- Grant FeedbackFlow microphone access

**Screen recording permission denied**
- macOS: System Preferences > Security & Privacy > Screen Recording
- Restart FeedbackFlow after granting permission

**Deepgram connection failed**
- Verify your API key is correct
- Check your internet connection
- Ensure your Deepgram account has available credits

**Hotkeys not working**
- Check for conflicts with other applications
- Try customizing hotkeys in Settings > Hotkeys

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for more solutions.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Deepgram](https://deepgram.com) for real-time speech recognition
- [Electron](https://electronjs.org) for cross-platform desktop framework
- [React](https://reactjs.org) for the UI framework
- [Vite](https://vitejs.dev) for blazing fast builds

---

<p align="center">
  Made with care by <a href="https://github.com/eddiesanjuan">Eddie San Juan</a><br>
  <a href="https://ko-fi.com/eddiesanjuan">Support FeedbackFlow on Ko-fi</a>
</p>
