# markupR v3

markupR records feedback for an AI coding agent across your Mac.
Press a hotkey, use the computer while talking, then press it again.
It lines up screen video, your voice, cursor and clicks, browser logs, and the system log on one clock, picks out key moments, and writes a context pack folder an agent can read.
A small pop-up offers “Copy prompt” when the pack is ready; capture and processing stay on your Mac.

## Status

This is the early Rust rebuild: v3, in development, on `rust-v3`.
The TypeScript/Electron v2 is on the [main branch](https://github.com/eddiesanjuan/markupr/tree/main).
Requires macOS 15 or later. Apple silicon has been tested.

## Requirements

- Rust 1.85 or later, with the macOS command line developer tools.
- `ffmpeg` for audio conversion and frame extraction.
- `whisper-cli` from whisper.cpp for local speech recognition.
- A local Whisper model file. markupR never downloads one.
- A supported Chrome-family browser if you want browser logs.

Create `~/Library/Application Support/markupr/config.toml`. Use absolute paths to your installed tools and model files; replace the example model path.

```toml
ffmpeg_bin = "ffmpeg"

[whisper]
bin = "/opt/homebrew/bin/whisper-cli"
model = "/absolute/path/to/ggml-large-v3-turbo.bin"   # accurate, the default
fast_model = "/absolute/path/to/ggml-small.bin"       # optional, used by --fast

[hotkeys]
toggle = "ctrl+alt+KeyR"
mark = "ctrl+alt+KeyX"
```

Without a configured model, the pack is still written, but speech is skipped.
The default pack location is `~/markupr/packs/`.
Video defaults to 30 frames per second. The browser debug port defaults to 9222.

## Build and first run

From the repository root (then add `target/release` to your PATH for the examples below):

```sh
cargo build --release -p markupr
./target/release/markupr doctor
```

Doctor checks permissions, tools, model paths, and the browser debug endpoint; missing core permissions make it exit with an error.
Run `markupr doctor --request` to request missing permissions.

In System Settings > Privacy & Security, grant:

- Screen Recording for screen video and system audio.
- Accessibility for focused windows and the element under the cursor.
- Microphone for your narration.

Doctor also checks Input Monitoring, which the event tap may need for cursor, clicks, and keys.
When launched from a terminal, grants normally attach to the terminal host, such as Terminal, iTerm, or T3 Code.
Use the process macOS shows in its permission list, then restart that host if macOS asks.

## Using it

Run `markupr app`, or just `markupr`, to start the menu bar app in an idle state.
The menu also offers “Open debug browser”, “Copy last prompt”, and “Show last pack in Finder”.
Press **Control+Option+R** to start recording. Press it again to stop and build the pack.
Press **Control+Option+X** to mark the moment at your cursor while recording.
When processing finishes, use “Copy prompt” in the pop-up and paste into your agent.

Start a recording in one terminal:

```sh
markupr record --popup
```

While it runs, use another terminal to mark and stop:

```sh
markupr mark --note "This button did not respond"
markupr status
markupr stop
```

`record` starts immediately. `--popup` shows the panel after processing.
`stop` waits for processing and prints the pack path; `stop --no-wait` only requests the stop.
`status` prints JSON with the current state and latest pack path, including when no recorder is running.

### Browser logs and the agent prompt

Before recording a browser issue, open the debug browser:

```sh
markupr browser --url http://localhost:3000
```

It uses `~/Library/Application Support/markupr/browser-profile/`, separate from your everyday profile.
The separate profile enables remote debugging without using your normal browsing session.
Sign in there if needed and reproduce the issue in that window.
Browser capture includes console messages, exceptions, network metadata, navigation, and clicked elements.

Copy the local pack prompt for your agent with:

```sh
markupr prompt --copy
```

## What is in a context pack

Each recording gets a dated folder with raw files and processed results. Missing sources are called out in the summary.

```text
2026-11-16_14-30-00/
├── SUMMARY.md          # Key moments, speech, frames, log references, and missing sources.
├── PROMPT.md           # Agent prompt pointing to this local pack.
├── session.json        # Source availability, timing offsets, geometry, and processing status.
├── video.mp4           # Screen video with system audio when captured.
├── audio/mic.wav       # Microphone narration when captured.
├── events.jsonl        # Clicks, scroll, key activity, focus, and numbered marks.
├── cursor.jsonl        # Cursor positions on the session clock.
├── logs/browser.jsonl  # Browser console, exceptions, network metadata, and page events.
├── logs/system.jsonl   # Unified log from the frontmost app as focus changes.
├── transcript.json     # Recognized speech with word times.
├── transcript.md       # Readable transcript.
├── moments.json        # Selected moments and links to supporting evidence.
└── frames/             # Key-frame JPEGs with cursor rings and optional zoom crops.
```

An invented excerpt from `SUMMARY.md`:

```markdown
## 1. Save button does not respond (t 8.000 to 12.000)

- Why flagged: mark 1 at 10.000; click at 9.500
- Said: "I clicked Save, but the page stayed the same."
- Looking at: Google Chrome; clicked #save "Save"; cursor at (420.0, 310.0)
- Frame: ![item 1](frames/item-01.jpg) at t 10.000
- Logs: no matching errors or warnings captured.
- Dive deeper: t 8.000 to 12.000 in events.jsonl and logs/
```

## Privacy

Capture and processing are local. markupR does not upload packs.
Typed characters are never stored by the key recorder; it records only typing counts and timing.
Named keys and shortcuts are recorded by name, such as Enter or Command+C.
While a password field has secure input enabled, nothing about keys is recorded.
Browser request headers and bodies are not recorded.
Browser URLs have credentials removed and secret-looking query and fragment values redacted by parameter name.
Screen video, audio, window titles, element labels, and log text can still contain private information.
Packs can contain whatever was on screen. Review a pack before sharing it or giving an agent access.

## How it works

- `markupr`: CLI, menu bar, hotkeys, recording control, and the native pop-up.
- `markupr-core`: shared clock, config, session manifest, pack paths, and JSONL writing.
- `markupr-screen`: ScreenCaptureKit capture, MP4 video/system audio, and microphone WAV.
- `markupr-events`: cursor, clicks, key policy, focus, marks, permissions, and unified log.
- `markupr-browser`: local browser debugging connection and browser event capture.
- `markupr-pack`: local transcription, rule-based moment selection, frames, summary, and prompt.

Sources use the Mac's monotonic host clock, expressed as seconds since recording began.
Sources without usable host timestamps are aligned by arrival or wall time, so the agent can follow one timeline.

## Limits today

- One display per recording, selected under the cursor by default.
- Browser logs require a Chrome-family browser through the debug profile.
- No signed app bundle yet; run the binary from a terminal.
- A crash during recording loses the video because MP4 is finalized at stop; JSONL files survive.
- Speech recognition is set to English.

## Credits and license

MIT licensed. Built on the [v2 markupR](https://github.com/eddiesanjuan/markupr) idea.
[kieranklaassen/riffrec](https://github.com/kieranklaassen/riffrec) and [dundas/thinkrun](https://github.com/dundas/thinkrun) explore the same space for the browser.
