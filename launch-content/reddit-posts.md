# Reddit Launch Posts

---

## r/ClaudeAI

**Title:** I built an MCP server that lets Claude Code see your screen and hear your voice

**Body:**

I've been using Claude Code daily and the biggest friction point for me was context about visual issues. Describing what I see in text loses half the information. So I built markupr -- an MCP server that gives Claude Code direct access to screen capture and voice recording.

### Setup

Add this to `~/.claude/settings.json`:

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

That's it. Restart Claude Code and you get 6 new tools.

### What the agent can do

- **capture_screenshot** -- grab the current screen. The agent sees what you see.
- **capture_with_voice** -- record screen + mic for a set duration. Returns a structured Markdown report with transcript and extracted frames.
- **analyze_screenshot** -- take a screenshot and return the image data directly for vision analysis.
- **analyze_video** -- process any .mov or .mp4 through the pipeline.
- **start_recording / stop_recording** -- interactive recording sessions.

### How I actually use it

I'll be reviewing a feature and spot something off. Instead of typing out what's wrong, I just say: "The sidebar is overlapping on mobile, can you see it?" Claude calls `capture_screenshot`, sees the layout issue, and starts fixing the CSS. No copy-pasting screenshots, no describing pixel positions.

For bigger reviews, I use `capture_with_voice` -- record for 30 seconds while narrating what I see. The pipeline transcribes with Whisper, finds the key moments in my narration, extracts video frames at those timestamps, and returns a structured report. Claude reads the whole thing and addresses each issue.

### Privacy

Everything runs locally. Whisper transcription is on your machine. No telemetry, no data collection. External calls only happen if you explicitly add API keys for cloud transcription.

Open source, MIT: https://github.com/eddiesanjuan/markupr

---

## r/cursor

**Title:** MCP server that gives Cursor screenshot and screen recording capabilities

**Body:**

Sharing an MCP server I built for capturing screen context during Cursor sessions. It lets the agent take screenshots, record your screen with voice narration, and process everything into structured Markdown.

### Quick Setup

Add to `.cursor/mcp.json` (project-level) or `~/.cursor/mcp.json` (global):

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

Restart Cursor. You now have 6 tools available.

### Tools

| Tool | What it does |
|------|-------------|
| `capture_screenshot` | Grab current screen |
| `capture_with_voice` | Record screen + mic, get structured report |
| `analyze_video` | Process any video file into Markdown |
| `analyze_screenshot` | Screenshot with vision analysis |
| `start_recording` | Begin interactive session |
| `stop_recording` | End session, get report |

### Practical example

You're reviewing a page and the layout breaks on resize. Instead of screenshotting, uploading, and explaining, ask Cursor to capture a screenshot. It sees the issue and can act on it.

For more complex feedback, `capture_with_voice({ duration: 30 })` records your screen while you talk through issues. It transcribes your voice with local Whisper, extracts frames at the moments you described each issue, and returns a structured Markdown report.

### Requirements

- macOS (screen recording + mic permissions required)
- ffmpeg (`brew install ffmpeg`) for recording tools
- Screenshot tools work without ffmpeg

Open source, MIT licensed: https://github.com/eddiesanjuan/markupr

Full MCP docs: https://github.com/eddiesanjuan/markupr/blob/main/README-MCP.md

---

## r/webdev

**Title:** How I closed the feedback loop between what I see and what my AI agent fixes

**Body:**

The hardest part of using AI coding agents for frontend work isn't the code generation -- it's the context. You see a broken layout, a misaligned button, a color that's off. You try to describe it in text and half the information is lost.

I built markupr to fix this. It's a tool that records your screen and microphone, then produces a structured Markdown document where every screenshot is placed at the exact moment you were describing something.

### How it works

1. Start recording (hotkey, CLI command, or AI agent triggers it via MCP)
2. Talk through what you see: "This button is hidden on mobile, and the spacing is off here..."
3. Stop recording
4. The pipeline runs:
   - Transcribes your voice with local Whisper
   - Analyzes the transcript for key moments (topic changes, issue descriptions)
   - Extracts video frames via ffmpeg at those exact timestamps
   - Generates structured Markdown with screenshots placed where they belong

The result isn't "screenshots taken every 5 seconds." It's contextually-aware frame extraction -- each image shows what you were talking about at that moment.

### Three ways to use it

**Desktop app** -- macOS menu bar. One hotkey to start, one to stop. File path copied to clipboard. Paste into whatever AI tool you use.

**CLI** -- `npx markupr analyze ./recording.mov` -- process any screen recording. Works in CI/CD pipelines or scripts.

**MCP server** -- `npx markupr-mcp` -- your AI coding agent (Claude Code, Cursor, Windsurf) gets direct access to screen capture and recording. The agent can see what you see mid-conversation.

### Example output

```markdown
# Feedback Report: Dashboard Redesign

## FB-001: Navigation dropdown clipped
**Timestamp**: 00:15 | **Type**: Bug

> The dropdown menu is being clipped by the parent container's
> overflow hidden. You can see it cuts off after the third item.

![Screenshot at 00:15](./screenshots/fb-001.png)

## FB-002: Card spacing inconsistent
**Timestamp**: 00:32 | **Type**: UI Issue

> These cards have different padding -- the first row is 16px
> and the second row looks like 24px.

![Screenshot at 00:32](./screenshots/fb-002.png)
```

Everything runs locally. Open source, MIT licensed.

GitHub: https://github.com/eddiesanjuan/markupr
Site: https://markupr.com

---

## r/programming

**Title:** Building a timestamp-correlated frame extraction pipeline for screen recordings

**Body:**

I built an open source tool called markupr that processes screen recordings with voice narration into structured documents. The interesting technical bit is the pipeline that correlates transcript timestamps with video frames.

### The problem

Most screen-to-document tools either capture at fixed intervals (every N seconds) or on manual trigger. Both are noisy -- you get frames that don't correspond to anything meaningful.

### The approach

markupr records screen and microphone simultaneously, then runs a post-processing pipeline:

```
Audio ──→ Whisper (local) ──→ Timestamped transcript
                                      │
                                      ▼
                              Transcript Analyzer
                              (key-moment detection)
                                      │
                                      ▼
                              Timestamp list ──→ ffmpeg ──→ Extracted frames
                                                               │
                                                               ▼
                              Transcript + frames ──→ Structured Markdown
```

**Step 1: Transcription.** Audio goes through local Whisper. The key detail is preserving word-level timestamps, not just segment-level. This gives us sub-second precision for frame extraction.

**Step 2: Key-moment detection.** A heuristic analyzer scans the transcript for:
- Topic changes (semantic shifts in what the speaker is describing)
- Emphasis markers (words like "notice," "look at," "this is broken")
- Issue descriptions (bug reports, visual observations)
- Natural pauses that indicate the speaker is pointing at something

This is heuristic, not ML -- it runs instantly and doesn't need a model.

**Step 3: Frame extraction.** ffmpeg pulls frames at the exact timestamps from step 2. Since we have word-level timing from Whisper, the extracted frame shows what was on screen when the speaker said "this button is hidden."

**Step 4: Document generation.** The transcript segments and corresponding frames are stitched into Markdown, with each screenshot placed inline at the point in the narrative where it was referenced. Format is inspired by llms.txt -- structured for LLM consumption.

### Architecture decisions

**Why local Whisper by default?** Privacy. Screen recordings often contain sensitive content (emails, code, credentials visible on screen). Sending audio to a cloud API is a non-starter for many developers. Local Whisper (tiny model, ~75MB) is good enough for the key-moment detection to work.

**Why heuristic analysis instead of an LLM?** Speed and reliability. The analyzer runs in <100ms on any transcript length. An LLM call would add seconds of latency and require an API key. The heuristics work well enough because spoken narration during screen recording follows predictable patterns.

**Why Markdown output?** It's the most portable format for both humans and AI tools. The structured format (with headers, timestamps, inline images) is directly consumable by LLMs without any parsing step.

### The state machine

The recording session is a 7-state FSM with a watchdog timer:

```
idle → starting (5s) → recording (30min max) → stopping (3s)
                                                     │
                                                     ▼
                                                processing (10s) → complete (30s auto-idle)
                                                     │
                                                     ▼
                                                   error (5s auto-recover)
```

Every state has a maximum duration. The watchdog forces recovery if anything gets stuck. Crash recovery auto-saves state every 5 seconds, so an interrupted recording session can be recovered on restart.

### MCP server

v2.4.0 adds an MCP server -- a protocol that lets AI coding agents call tools. The server exposes 6 tools (screenshot, screen+voice recording, video analysis, etc.) so an agent can trigger the pipeline mid-conversation. It's a stdio-based JSON-RPC server.

Open source, MIT, 644 tests: https://github.com/eddiesanjuan/markupr
