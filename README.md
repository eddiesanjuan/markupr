# markupR v3

markupR v3 is a complete Rust rewrite for giving an AI coding agent feedback from your Mac.
**Just record, talk, and point or click. Marking is optional.** When you stop, markupR writes a local pack. Open `SUMMARY.md` to see what you said alongside key frames, zoomed click crops, and UI element details where available. With ffmpeg and a local Whisper model configured, the pack includes a timestamped transcript.

## Install & Configure With Your Agent

Paste this into Claude Code, Codex, Cursor, or Antigravity on your Mac:

```text
Install markupR v3.0.0 on my Mac from https://github.com/eddiesanjuan/markupr/releases/tag/v3.0.0.
Check that I have macOS 15 or later. On Apple silicon, download and unzip the app.
For a source build, use scripts/make-app-bundle.sh from that tag. Install in ~/Applications.
Set up ffmpeg and whisper-cli. Reuse my local Whisper model, or help me choose one for transcription.
Open markupR and walk me through its macOS permission prompts so I can approve them myself.

Ask which recording hotkey, optional mark hotkey, and pack folder I want. Keep my other settings.
Help me choose a display and whether I want the ready pop-up. Use the supported launch options
for those choices. Tell me which settings will apply next time I open the app.
Then walk me through a short recording and show me its SUMMARY.md and timestamped transcript.
```

## Make your first pack

1. Press **Control+Option+R**. The menu bar item shows that it is recording.
2. Point at or click what you want changed and describe it. If you want to flag a particular instant, press **Control+Option+X**.
3. Press **Control+Option+R** again.
4. A small panel appears at the top right when the pack is ready. Click **Copy prompt** and paste it into your coding agent.

For browser console and network logs, use "Open debug browser" in the menu first and reproduce the problem in that window.
To transcribe speech, set your Whisper model path in the config file. See [Requirements](#requirements).

## Status

The `main` branch tracks v3 development. It requires macOS 15 or later and has been tested on Apple silicon.
The previous Electron release, v2.6.8, is archived at [legacy-v2](https://github.com/eddiesanjuan/markupr/tree/legacy-v2).

## Requirements

- For source builds, Rust 1.85 or later and the macOS command line developer tools.
- `ffmpeg` for audio conversion and frame extraction.
- `whisper-cli` from whisper.cpp for local speech recognition.
- A local Whisper model file. markupR never downloads one.
- A supported Chrome-family browser if you want browser logs.

Settings live in `~/Library/Application Support/markupr/config.toml`. Quit and reopen the app after editing it. Use absolute paths for tools, models, and custom pack folders.

```toml
ffmpeg_bin = "ffmpeg"  # default; set the full path for a Finder-launched app
# packs_dir = "/absolute/path/to/packs"  # default: ~/markupr/packs/

[whisper]
bin = "/opt/homebrew/bin/whisper-cli"
model = "/absolute/path/to/ggml-large-v3-turbo.bin"   # replace with your model
fast_model = "/absolute/path/to/ggml-small.bin"       # optional, used by --fast
language = "en"

[hotkeys]
toggle = "ctrl+alt+KeyR"
mark = "ctrl+alt+KeyX"

[video]
fps = 30

[browser]
port = 9222
```

Without a configured model, the pack is still written, but speech is skipped.

**Display and pop-up behavior.** Recording uses one display, chosen under the cursor when recording starts. Use `markupr displays` to list IDs, then pass `--display <ID>` to `markupr app` or `markupr record` to choose one for that launch. The menu bar app shows the ready panel at the top right of the screen under the cursor. For a one-off recording, `markupr record` finishes quietly and `markupr record --popup` shows the panel. Its placement and appearance are fixed in v3.0.0.

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
The video only has a frame when the screen changed; `markupr frame <pack dir> <seconds>` writes the screen at any moment, with the cursor ringed.

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
- `scripts/make-app-bundle.sh` builds `markupR.app`, ad-hoc signed, so macOS asks for the permissions again after each rebuild.
- A crash during recording loses the video because MP4 is finalized at stop; JSONL files survive.
- Speech recognition defaults to English (`language` under `[whisper]` in the config).
- Whispered speech is not transcribed: speech is found by its voicing, which keeps mouse and keyboard noise out of the transcript. For the same reason, speech over music that the microphone picks up can be dropped along with the music.
- Key moments are picked by rules, not a model. Everything said that did not become an item is still listed in SUMMARY.md.

## Credits and license

MIT licensed.
[kieranklaassen/riffrec](https://github.com/kieranklaassen/riffrec) and [dundas/thinkrun](https://github.com/dundas/thinkrun) explore the same space for the browser.
