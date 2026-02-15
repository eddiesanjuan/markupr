> **This project has moved.** FeedbackFlow has been rebranded and evolved into **[markupr](https://github.com/eddiesanjuan/markupr)** -- with cross-platform support, a CLI, an MCP server for AI coding agents, and an intelligent post-processing pipeline. All future development happens at [github.com/eddiesanjuan/markupr](https://github.com/eddiesanjuan/markupr).
>
> **Install:** `npm install -g markupr` | **Download:** [markupr.com](https://markupr.com) | **Releases:** [github.com/eddiesanjuan/markupr/releases](https://github.com/eddiesanjuan/markupr/releases)

---

<p align="center">
  <img src="src/renderer/assets/logo.svg" alt="markupr Logo" width="120" height="120">
</p>

<h1 align="center">markupr</h1>

<p align="center">
  <strong>Turn voice narration into AI-ready Markdown with intelligent screenshots</strong>
</p>

<p align="center">
  <a href="https://github.com/eddiesanjuan/markupr/actions/workflows/ci.yml"><img src="https://github.com/eddiesanjuan/markupr/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/eddiesanjuan/markupr/actions/workflows/release.yml"><img src="https://github.com/eddiesanjuan/markupr/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="https://github.com/eddiesanjuan/markupr/releases"><img src="https://img.shields.io/github/v/release/eddiesanjuan/markupr?style=flat-square" alt="Latest Release"></a>
  <a href="https://github.com/eddiesanjuan/markupr/releases"><img src="https://img.shields.io/github/downloads/eddiesanjuan/markupr/total?style=flat-square" alt="Downloads"></a>
  <a href="https://www.npmjs.com/package/markupr"><img src="https://img.shields.io/npm/v/markupr?style=flat-square" alt="npm version"></a>
  <a href="https://github.com/marketplace/actions/markupr-analyze"><img src="https://img.shields.io/badge/GitHub%20Action-markupr--action-orange?style=flat-square&logo=github" alt="GitHub Action"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License"></a>
  <a href="https://ko-fi.com/eddiesanjuan"><img src="https://img.shields.io/badge/Support-Ko--fi-FF5E5B?style=flat-square&logo=ko-fi" alt="Ko-fi"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> |
  <a href="#why-markupr">Why markupr?</a> |
  <a href="#features">Features</a> |
  <a href="#how-it-works">How It Works</a> |
  <a href="#example-output">Examples</a> |
  <a href="#installation">Installation</a> |
  <a href="#cli-usage">CLI Usage</a> |
  <a href="#mcp-server-for-ai-coding-agents">MCP Server</a> |
  <a href="#usage">Usage</a> |
  <a href="#keyboard-shortcuts">Shortcuts</a> |
  <a href="#export-formats">Export</a> |
  <a href="#development">Development</a> |
  <a href="#contributing">Contributing</a> |
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

markupr is a menu bar app that intelligently captures developer feedback. Press a hotkey, talk through what you see, and markupr records your screen while transcribing your voice. When you stop, an intelligent post-processing pipeline correlates your transcript timestamps with the screen recording to extract the right frames at the right moments -- then stitches everything into a structured, AI-ready Markdown document.

One hotkey to start. One hotkey to stop. A Markdown file with your words, contextually-placed screenshots, and intelligent structure -- ready to hand to your AI coding agent, paste into a GitHub issue, or drop in a Slack thread.

## Quick Start

### CLI (for developers and AI agents)
```bash
npx markupr analyze ./recording.mov
```

Or install globally:
```bash
npm install -g markupr
# or
bun install -g markupr
```

### Desktop App
Download from [markupr.com](https://markupr.com) or the [releases page](https://github.com/eddiesanjuan/markupr/releases) -- available for macOS, Windows, and Linux.

**First-time setup:**
1. Install the application (DMG for macOS, installer for Windows)
2. Grant required permissions (Microphone, Screen Recording)
3. Press `Cmd+Shift+F` (macOS) or `Ctrl+Shift+F` (Windows) to start recording
4. Narrate your feedback while markupr captures screenshots at pause points
5. Press the hotkey again to stop -- post-processing runs automatically
6. Paste the file path from your clipboard into your AI coding agent

**No API key required!** markupr uses local Whisper transcription by default.

If markupr saves you hours, consider [supporting development on Ko-fi](https://ko-fi.com/eddiesanjuan).

## See It In Action

<!-- TODO: Replace with actual demo recording -->
> **Demo video coming soon** -- Record your screen, talk through what you see, get structured Markdown with screenshots your AI coding agent can act on. One hotkey in, one hotkey out.

## Why markupr?

AI coding agents are transforming development, but they're only as good as the context you give them. Typing out bug reports with manual screenshots is slow and lossy -- you lose the flow of what you saw and the nuance of what you meant.

markupr bridges this gap. Record your screen, narrate what you see, and markupr produces a structured Markdown document that AI agents can consume directly. The output isn't a raw transcript with random screenshots -- it's an intelligently structured document where every screenshot is placed at the exact moment you were describing it, every issue is categorized, and the format is optimized for LLM consumption.

**The workflow:**
1. You see a bug. Press `Cmd+Shift+F`.
2. Talk through what you see: "This button is hidden on mobile, and the spacing is off here..."
3. Press the hotkey again to stop.
4. Paste the file path into Claude Code, Cursor, or any AI agent.
5. The agent reads your structured feedback -- with screenshots -- and fixes the issues.

**What makes it different:**
- **Timestamp-correlated frames** -- screenshots are extracted from the exact video frame matching your narration, not taken at arbitrary intervals
- **Local-first** -- Whisper runs on your machine, your data stays on your machine
- **AI-native output** -- Markdown structured for LLM consumption, not human-only reading
- **Zero-friction capture** -- one global hotkey from any app, no context switching

## Features

### Voice-Driven Capture
- **Local Whisper transcription** runs entirely on your machine -- no API key, no internet required
- **Optional OpenAI cloud transcription** for higher accuracy (BYOK)
- **Intelligent screenshot timing** captures automatically during voice pauses
- **Audio waveform visualization** for real-time feedback

### Intelligent Post-Processing Pipeline
- **Timestamp-correlated frame extraction** -- every screenshot corresponds to what you were describing
- **Key-moment detection** analyzes your transcript to find the most important moments
- **Video frame extraction** via ffmpeg pulls precise frames from the screen recording
- **Structured Markdown output** optimized for LLM consumption (llms.txt inspired)

### Smart Screenshots
- **Voice Activity Detection (VAD)** triggers captures at natural pause points
- **Manual screenshot hotkey** (`Cmd+Shift+S`) for precise control
- **Multi-monitor support** with display selection
- **Window-specific capture** for focused feedback

### AI-Ready Output
- **Markdown format** with contextually-placed screenshots and structured feedback items
- **Multiple export formats**: Markdown, PDF, HTML, JSON
- **Clipboard bridge** -- file path is copied to clipboard so AI tools can read the full document

### Bulletproof Reliability
- **7-state finite state machine** with watchdog timer -- no state the app can enter and not exit
- **Crash recovery** with 5-second auto-save -- never lose a feedback session
- **Graceful degradation** -- if transcription fails, frame extraction continues; if ffmpeg is missing, transcript-only output is generated
- **Auto-updater** for seamless updates

### Professional Experience
- **Native macOS menu bar** integration (no dock icon)
- **Windows system tray** support
- **Global hotkeys** that work from any application
- **Annotation tools** (arrow, circle, rectangle, freehand, text)
- **Session history browser** with search and export
- **Dark/light/system theme** support
- **Onboarding experience** for first-run setup

## How It Works

### The Post-Processing Pipeline

When you press stop, markupr's intelligent pipeline takes over:

1. **Transcribe** -- Your audio is transcribed using local Whisper (or OpenAI API if configured)
2. **Analyze** -- The transcript is analyzed to identify key moments, topic changes, and important observations
3. **Extract** -- Video frames are extracted at the exact timestamps corresponding to each key moment
4. **Generate** -- Everything is stitched into a structured Markdown document with screenshots placed exactly where they belong

The result isn't just "screenshots taken during pauses" -- it's contextually-aware frame extraction that ensures every image in the document shows exactly what you were talking about.

### The Clipboard Bridge

When a session completes, the **file path** to your Markdown document is copied to clipboard. Not the content -- the path. This is deliberate:

- If your clipboard gets overwritten, the file lives on disk permanently
- AI tools like Claude Code can read the file path and process the full document including screenshots
- The file is yours -- local, private, no cloud dependency

### Session State Machine

The recording session is governed by a 7-state FSM with timeouts:

```
idle ─→ starting (5s timeout) ─→ recording (30min max) ─→ stopping (3s timeout)
                                                              │
                                                              ▼
                                                         processing (10s timeout) ─→ complete (30s auto-idle)
                                                              │
                                                              ▼
                                                            error (5s auto-recover)
```

Every state has a maximum duration. A watchdog timer monitors state age and forces recovery if anything gets stuck.

## Example Output

See what markupr produces:

- [Desktop app feedback session](examples/feedback-session-example.md) -- a developer reviewing a dashboard, finding mobile and UX issues
- [MCP server capture session](examples/mcp-session-example.md) -- an AI coding agent recording a CSS bug via `capture_with_voice`
- [CLI analysis output](examples/cli-output-example.md) -- `npx markupr analyze` processing a security code review

## Installation

### macOS

Download the `.dmg` file from the [releases page](https://github.com/eddiesanjuan/markupr/releases).

1. Open the DMG file
2. Drag markupr to your Applications folder
3. Launch markupr from Applications
4. Grant required permissions (Microphone, Screen Recording)

### Windows

Download the `.exe` installer from the [releases page](https://github.com/eddiesanjuan/markupr/releases).

1. Run the installer
2. Follow the installation wizard
3. Launch markupr from the Start menu

### Linux

Download the `.AppImage` or `.deb` file from the [releases page](https://github.com/eddiesanjuan/markupr/releases).

```bash
# AppImage
chmod +x markupr-*.AppImage
./markupr-*.AppImage

# Debian/Ubuntu
sudo dpkg -i markupr_*.deb
```

## Configuration

### Transcription

markupr works out of the box with **local Whisper** transcription -- no API key needed. On first run, you'll be prompted to download a Whisper model (~75MB for tiny, ~500MB for base).

For cloud post-session transcription with higher accuracy, add your OpenAI API key:

1. Sign up at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create an API key with "Usage" permissions
3. Open Settings > Advanced > Transcription Service
4. Enter your OpenAI API key

OpenAI usage is billed to your own API account.

### AI-Enhanced Analysis (Optional)

Add your Anthropic API key for Claude-powered document analysis:

1. Get an API key at [console.anthropic.com](https://console.anthropic.com/)
2. Open Settings > Advanced > AI Analysis
3. Enter your Anthropic API key

Claude analyzes your transcript alongside screenshots to produce an intelligent document -- grouping related feedback, identifying patterns, and writing actionable summaries.

### Settings Overview

| Category | Setting | Description |
|----------|---------|-------------|
| **General** | Output Directory | Where sessions are saved |
| | Launch at Login | Start markupr on system boot |
| **Recording** | Countdown | 0, 3, or 5 second countdown before recording |
| | Transcription Preview | Show live transcription overlay |
| | Audio Waveform | Visual audio level feedback |
| **Capture** | Pause Threshold | Voice pause duration before screenshot (500-3000ms) |
| | Min Time Between | Minimum gap between screenshots |
| **Appearance** | Theme | Dark, Light, or System |
| | Accent Color | Customize UI accent color |
| **Hotkeys** | Toggle Recording | Default: `Cmd/Ctrl+Shift+F` |
| | Manual Screenshot | Default: `Cmd/Ctrl+Shift+S` |

## CLI Usage

markupr can run as a standalone CLI tool -- no Electron or desktop app required. This is ideal for:
- CI/CD pipelines processing screen recordings
- AI coding agents that need to analyze recordings programmatically
- Developers who prefer the command line

### Installation

```bash
# Run without installing
npx markupr analyze ./recording.mov

# Install globally via npm
npm install -g markupr

# Install globally via bun
bun install -g markupr
```

### Commands

#### `markupr analyze <video-file>`

Process a screen recording into a structured Markdown document with extracted frames and transcript.

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--audio <file>` | Separate audio file (if not embedded in video) | Auto-extracted from video |
| `--output <dir>` | Output directory | `./markupr-output` |
| `--whisper-model <path>` | Path to local Whisper model file | Auto-detected in `~/.markupr/whisper-models/` |
| `--no-frames` | Skip frame extraction | `false` |
| `--template <name>` | Output template (`markdown`, `json`, `github-issue`, `linear`, `jira`, `html`) | `markdown` |
| `--verbose` | Show detailed progress output | `false` |

**Examples:**

```bash
# Basic usage - analyze a screen recording
markupr analyze ./bug-demo.mov

# Use a specific output directory
markupr analyze ./recording.mov --output ./reports

# Separate audio and video files
markupr analyze ./screen.mov --audio ./voiceover.wav

# Skip frame extraction (transcript only)
markupr analyze ./recording.mov --no-frames
```

#### `markupr watch [directory]`

Watch a directory for new screen recordings and auto-process them as they appear. Ideal for continuous feedback workflows.

```bash
# Watch the current directory
markupr watch

# Watch a specific directory with custom output
markupr watch ./recordings --output ./reports

# Watch with verbose logging
markupr watch ~/Desktop --verbose
```

#### `markupr push github <report>`

Create GitHub issues from a markupr feedback report. Each feedback item (FB-001, FB-002, etc.) becomes a separate issue with labels and structured markdown.

```bash
# Create issues from a report (uses gh CLI auth or GITHUB_TOKEN)
markupr push github ./markupr-output/report.md --repo myorg/myapp

# Preview what would be created
markupr push github ./report.md --repo myorg/myapp --dry-run

# Push specific items only
markupr push github ./report.md --repo myorg/myapp --items FB-001 FB-003
```

Authentication resolves in order: `--token` flag, `GITHUB_TOKEN` env var, `gh auth token` CLI.

#### `markupr push linear <report>`

Create Linear issues from a markupr feedback report.

```bash
# Create issues in a Linear team
markupr push linear ./report.md --team ENG

# Assign to a project with dry run
markupr push linear ./report.md --team DES --project "Q1 Polish" --dry-run
```

Set `LINEAR_API_KEY` env var or pass `--token`.

### Output Templates

markupr supports multiple output templates for the `analyze` command:

| Template | Description |
|----------|-------------|
| `markdown` | Default structured Markdown (llms.txt-inspired) |
| `json` | Machine-readable JSON for integrations |
| `github-issue` | GitHub-flavored Markdown optimized for issues |
| `linear` | Linear-optimized issue format |
| `jira` | Jira-compatible markup |
| `html` | Self-contained HTML document |

```bash
# Generate JSON output for automation
markupr analyze ./recording.mov --template json

# Generate GitHub-ready issue format
markupr analyze ./recording.mov --template github-issue
```

### GitHub Action

Run markupr in CI to get visual feedback on pull requests:

```yaml
- uses: eddiesanjuan/markupr-action@v1
  with:
    video-path: ./recordings/
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

See [markupr-action/README.md](markupr-action/README.md) for full configuration and [example workflows](examples/github-action-examples/) for ready-to-use templates.

### Requirements

- **Node.js** 18+
- **ffmpeg** must be installed and on your PATH (for frame extraction and audio processing)
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
  - Windows: `choco install ffmpeg` or download from ffmpeg.org

### For AI Agents

markupr is designed to be used by AI coding agents. An agent can:

```bash
# Install and process a recording in one command
npx markupr analyze ./recording.mov --output ./feedback

# The output is a structured Markdown file with embedded screenshots
# Perfect for feeding into Claude, GPT, or any LLM
cat ./feedback/markupr-report.md
```

The output Markdown follows the llms.txt convention -- structured, parseable, and optimized for AI consumption.

## MCP Server (for AI Coding Agents)

markupr includes an MCP server that gives AI coding agents direct access to screen capture and voice recording. Your agent can see your screen, hear your narration, and receive structured reports -- all mid-conversation. This is the bridge between "I can see the bug" and "my agent can fix it."

### Setup

Add to your IDE config and your agent gets 6 tools:

**Claude Code** (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "markupr": {
      "command": "npx",
      "args": ["-y", "markupr-mcp"]
    }
  }
}
```

**Cursor / Windsurf** (MCP settings):
```json
{
  "mcpServers": {
    "markupr": {
      "command": "npx",
      "args": ["-y", "markupr-mcp"]
    }
  }
}
```

### Available Tools

| Tool | What it does |
|------|-------------|
| `capture_screenshot` | Grab the current screen. Your agent sees what you see. |
| `capture_with_voice` | Record screen + microphone for a set duration. Returns a full structured report. |
| `analyze_video` | Process any `.mov` or `.mp4` into Markdown with extracted frames. |
| `analyze_screenshot` | Feed a screenshot through the AI analysis pipeline. |
| `start_recording` | Begin an interactive recording session. |
| `stop_recording` | End the session. Full pipeline runs, report returned. |

### Example: Agent Captures and Fixes a Bug

In Claude Code, after adding the MCP config, your agent can do this:

```
You: "The sidebar is overlapping the main content on mobile. Can you see it?"

Claude: [calls capture_screenshot]
        "I can see the issue -- the sidebar has position: fixed but no
         z-index, and it's 280px wide with no responsive breakpoint.
         Let me fix the CSS..."

        [fixes the code]
```

No copy-pasting screenshots. No describing the bug in text. The agent looks at your screen and acts.

See **[README-MCP.md](README-MCP.md)** for full setup instructions, all tool parameters, and troubleshooting.

## Usage

### Basic Workflow

1. **Start Recording**: Press `Cmd+Shift+F` (macOS) or `Ctrl+Shift+F` (Windows)
2. **Select Source**: Choose which screen or window to capture
3. **Narrate**: Speak naturally about what you see
4. **Screenshots**: Captured automatically during pauses (or press `Cmd+Shift+S` manually)
5. **Stop Recording**: Press the hotkey again
6. **Post-Processing**: Pipeline automatically transcribes, analyzes, extracts frames, and generates output
7. **Use Output**: File path is on your clipboard -- paste into your AI tool

### Recording Tips

- **Speak naturally** -- markupr detects pauses to time screenshots
- **Pause briefly** when you want a screenshot captured
- **Use manual capture** (`Cmd+Shift+S`) for precise timing
- **Review before export** to remove unwanted items

### Using with AI Coding Agents

After a session completes, the file path is on your clipboard. Paste it into:

- **Claude Code**: `Read the feedback session at [paste path]`
- **Cursor/Windsurf**: Reference the file path in your prompt
- **GitHub Issues**: Copy the Markdown content directly

### AI Agent Setup

For coding agents, use the one-liner from repo root:

```bash
npm run setup:markupr
```

Detailed agent setup notes are in [`docs/AI_AGENT_QUICKSTART.md`](docs/AI_AGENT_QUICKSTART.md).

### Session Output

Sessions are saved to an organized folder:

```
~/markupr/sessions/2026-02-05_14-23-41/
  feedback-report.md     # Structured Markdown with inline screenshots
  metadata.json          # Session metadata (source, duration, environment)
  screenshots/
    fb-001.png           # Extracted frames from key moments
    fb-002.png
    fb-003.png
  session-recording.webm # Full screen recording (optional)
```

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

## Export Formats

### Markdown (.md)

AI-optimized format inspired by [llms.txt](https://llms.txt). Includes:

- Structured headings with timestamps
- Feedback items with categories and severity
- Inline screenshot references
- Summary table with session metadata

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

Professional document with embedded screenshots, print-ready layout, and theme support.

### HTML (.html)

Self-contained web page with embedded images, dark/light theme toggle, and mobile responsive design.

### JSON (.json)

Machine-readable format for integrations and automation.

## Architecture

```
markupr/
├── src/
│   ├── main/                  # Electron main process
│   │   ├── index.ts           # Entry point, orchestration
│   │   ├── SessionController  # 7-state FSM with watchdog
│   │   ├── CrashRecovery      # Auto-save and crash detection
│   │   ├── ai/                # Claude AI analysis pipeline
│   │   ├── audio/             # Audio capture and VAD
│   │   ├── capture/           # Screen capture services
│   │   ├── output/            # Document generation (MD, PDF, HTML, JSON)
│   │   ├── pipeline/          # Post-processing (transcribe → analyze → extract → generate)
│   │   ├── settings/          # Settings with secure API key storage
│   │   ├── transcription/     # Whisper + tier management
│   │   └── windows/           # Window management (popover, taskbar)
│   ├── renderer/              # React UI
│   │   ├── App.tsx            # Main component
│   │   ├── components/        # UI components (30+)
│   │   ├── audio/             # Renderer-side audio bridge
│   │   ├── capture/           # Renderer-side screen recording
│   │   └── hooks/             # React hooks (theme, animation)
│   ├── preload/               # Electron preload (secure IPC bridge)
│   └── shared/                # Shared types and constants
├── tests/                     # Test suite
├── docs/                      # Documentation
├── site/                      # Landing page
└── package.json
```

## Development

### Prerequisites

- Node.js 18+
- npm 9+
- macOS, Windows, or Linux

### Setup

```bash
# Clone the repository
git clone https://github.com/eddiesanjuan/markupr.git
cd markupr
```

Use either npm or bun:

```bash
# npm
npm install

# Start development mode
npm run dev
```

```bash
# bun
bun install

# Start development mode
bun run dev
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start in development mode with hot reload |
| `npm run build` | Build for production |
| `npm run build:desktop` | Build desktop app only |
| `npm run package` | Package for current platform |
| `npm run package:mac` | Package for macOS |
| `npm run package:win` | Package for Windows |
| `npm run package:linux` | Package for Linux |
| `npm test` | Run all tests |
| `npm run test:unit` | Run unit tests only |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint code |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run typecheck` | TypeScript type checking |

You can run the same scripts with bun (`bun run dev`, `bun run test`, etc.).

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npx vitest tests/unit/postProcessor.test.ts
```

## Contributing

We welcome contributions! markupr is MIT licensed and community-driven.

### Quick Start for Contributors

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Run tests: `npm test`
5. Run lint: `npm run lint`
6. Commit: `git commit -m 'Add amazing feature'`
7. Push: `git push origin feature/amazing-feature`
8. Open a Pull Request

### Guidelines

- **Tests required** for new functionality
- **Lint clean** -- run `npm run lint` before submitting
- **TypeScript strict** -- run `npm run typecheck`
- **Small PRs preferred** -- focused changes are easier to review
- **Follow existing patterns** -- check CLAUDE.md for architecture details

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

## Troubleshooting

### Common Issues

**Microphone not detected**
- Check System Preferences > Security & Privacy > Microphone
- Grant markupr microphone access

**Screen recording permission denied**
- macOS: System Preferences > Security & Privacy > Screen Recording
- Restart markupr after granting permission

**Whisper model download failing**
- Check your internet connection
- Try a smaller model first (tiny: ~75MB)
- Downloads support resume if interrupted

**OpenAI API connection failed**
- Verify your API key is correct
- Check your internet connection
- Ensure your OpenAI project has billing enabled

**Hotkeys not working**
- Check for conflicts with other applications
- Try customizing hotkeys in Settings > Hotkeys

**ffmpeg not found for frame extraction**
- Install ffmpeg: `brew install ffmpeg` (macOS) or download from [ffmpeg.org](https://ffmpeg.org/)
- markupr gracefully degrades to transcript-only output without ffmpeg

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for more solutions.

## Support markupr

If markupr is useful in your workflow and you want to keep it improving quickly:

- [Support on Ko-fi](https://ko-fi.com/eddiesanjuan)
- Share the project with a teammate who writes bug reports
- Open issues with reproducible feedback sessions so fixes land faster

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Whisper](https://github.com/openai/whisper) for local speech recognition
- [Anthropic Claude](https://anthropic.com) for AI-enhanced document analysis
- [OpenAI](https://platform.openai.com) for cloud transcription
- [Electron](https://electronjs.org) for cross-platform desktop framework
- [React](https://reactjs.org) for the UI framework
- [Vite](https://vitejs.dev) for blazing fast builds

---

<p align="center">
  Built by <a href="https://github.com/eddiesanjuan">Eddie San Juan</a>. Open source. MIT licensed.<br>
  <a href="https://ko-fi.com/eddiesanjuan">Support markupr on Ko-fi</a>
</p>
