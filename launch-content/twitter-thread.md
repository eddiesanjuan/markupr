# Twitter/X Launch Thread

---

## Tweet 1 (Hook)
> Your AI coding agent can't see your screen. That changes today.
>
> markupr gives agents eyes and ears -- record your screen, narrate what you see, get structured Markdown with screenshots placed at the exact moments that matter.
>
> Open source. Runs locally. Three lines of config.
>
> https://github.com/eddiesanjuan/markupr

**Characters:** 289

---

## Tweet 2 (MCP Config)
> Add this to your Claude Code settings and your agent gets 6 tools -- screenshot capture, screen+voice recording, video analysis:
>
> ```json
> {
>   "mcpServers": {
>     "markupr": {
>       "command": "npx",
>       "args": ["-y", "markupr-mcp"]
>     }
>   }
> }
> ```
>
> Zero install. npx handles everything.

**Characters:** 247

---

## Tweet 3 (The Output)
> What the output looks like -- not random screenshots, but frames extracted at the exact timestamp you described each issue:
>
> ```markdown
> ### FB-001: Login button not visible
> **Timestamp**: 00:15 | **Type**: Bug
>
> > The login button is hidden behind
> > the header on mobile viewport...
>
> ![Screenshot](./screenshots/fb-001.png)
> ```
>
> Structured for LLM consumption.

**Characters:** 283

---

## Tweet 4 (Technical Pipeline)
> The pipeline that makes this work:
>
> 1. Record screen + mic
> 2. Transcribe with local Whisper (no API key)
> 3. Analyze transcript for key moments
> 4. Extract video frames via ffmpeg at those timestamps
> 5. Generate structured Markdown with screenshots placed where they belong
>
> All local. All automatic.

**Characters:** 271

---

## Tweet 5 (Open Source)
> markupr is MIT licensed, fully open source.
>
> - No telemetry
> - No tracking
> - No accounts
> - Whisper runs on your machine
> - Your recordings never leave your disk
>
> The only external calls happen if you explicitly add an API key for cloud transcription or AI analysis. You control when data leaves.

**Characters:** 267

---

## Tweet 6 (Three Ways)
> Three ways to use it:
>
> Desktop app -- menu bar, one hotkey, file path to clipboard
> CLI -- `npx markupr analyze ./video.mov`
> MCP server -- `npx markupr-mcp` gives your agent direct access
>
> Same pipeline. Pick whatever fits your workflow.

**Characters:** 219

---

## Tweet 7 (CTA)
> If you're tired of describing visual bugs in text, give it a try.
>
> GitHub: https://github.com/eddiesanjuan/markupr
> Site: https://markupr.com
> npm: `npx markupr-mcp`
>
> Contributions welcome. MIT licensed.

**Characters:** 196
