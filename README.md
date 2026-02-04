# FeedbackFlow

A macOS menu bar app for capturing voice feedback with local AI transcription. Speak naturally, get AI-ready Markdown.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5f5f?logo=ko-fi&logoColor=white)](https://ko-fi.com/eddiesanjuan)

## Features

- **Menu Bar Native** - Lives in your menu bar, no dock icon
- **Voice Recording** - One-click recording with visual feedback
- **Local Transcription** - Uses Whisper.cpp for offline transcription (no API key required)
- **Copy to Clipboard** - Instantly copy transcribed feedback
- **Crash Recovery** - Never lose a recording, even if the app crashes
- **Privacy First** - Your audio never leaves your device

## Installation

### Download

Download the latest DMG from [Releases](https://github.com/eddiesanjuan/feedbackflow/releases).

### Build from Source

```bash
# Clone the repository
git clone https://github.com/eddiesanjuan/feedbackflow.git
cd feedbackflow

# Install dependencies
npm install

# Run in development
npm run dev

# Build for production
npm run build
npm run package
```

## Requirements

- macOS 11.0 or later
- Microphone access permission

## Usage

1. Click the FeedbackFlow icon in your menu bar
2. Click "Start Recording" to begin
3. Speak your feedback naturally
4. Click "Stop" when done
5. Your transcription appears automatically
6. Click "Copy" to copy to clipboard

### First Time Setup

On first launch, you'll be prompted to download the Whisper model (~140MB). This enables fully offline transcription.

## How It Works

FeedbackFlow uses [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) for local speech-to-text transcription. Your audio never leaves your device.

### Transcription Models

| Model | Size | Speed | Quality |
|-------|------|-------|---------|
| Tiny | ~75MB | Fastest | Good |
| Base | ~140MB | Fast | Better |
| Small | ~460MB | Medium | Great |
| Medium | ~1.5GB | Slower | Best |

## Development

```bash
# Run development server with hot reload
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint

# Build
npm run build
```

### Project Structure

```
src/
├── main/           # Electron main process
│   ├── services/   # Core services (Session, Audio, Transcription)
│   ├── tray.ts     # Menu bar tray
│   └── ipc.ts      # IPC handlers
├── renderer/       # React UI
│   ├── components/ # UI components
│   └── hooks/      # React hooks
└── preload/        # Preload scripts
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

MIT - see [LICENSE](LICENSE)

## Support

If you find FeedbackFlow useful, consider supporting the project:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Buy%20Eddie%20a%20Coffee-ff5f5f?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/eddiesanjuan)

---

Made with caffeine and chaos by [Eddie San Juan](https://github.com/eddiesanjuan)
