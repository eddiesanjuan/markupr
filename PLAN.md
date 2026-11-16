# markupR v3 plan

Rust rebuild of markupR as a whole-computer feedback recorder for AI coding agents. macOS first.
Branch `rust-v3`, worktree `~/Projects/markupr-v3`. v2 (TypeScript/Electron 2.6.8) stays on `main` untouched.

## What Eddie asked for (11/16)

"Takes a screen recording and the logs of your computer or the browser you're using, records them all time-stamped as you're doing it, as well as the audio... all of this stuff time-stamped together then gets post-processed so that it's understood which key points in the video, the logs, and the audio need to all line up and be highlighted for the agents. And then it basically gets composed into a whole context pack. And then whenever that context pack is ready, you get a little pop-up... copy the prompt to your agent... the agent could still dive into any of the stuff that it needed to... stripped down to what it was needing."

The agent should feel like it is "literally just watching me use the computer, able to see my clicks, the browser logs, literally everything", and "I can have my mouse around something, highlight certain times when I'm talking that I want it to understand exactly what I'm looking at or clicking on."

## Decisions

1. **One binary, `markupr`.** CLI now, menu bar in M4. The same recorder and pack code runs under both.
2. **One clock: mach host time.** ScreenCaptureKit frame and audio timestamps, CGEvent timestamps and unified-log mach timestamps are already on it. Sources without a host timestamp (browser, window polls, CLI marks) are stamped on arrival and keep their native time as `src_ts`.
3. **The pack folder is the session folder.** The recorder writes raw files into it; post-processing adds derived files. `session.json.status` goes `recording`, `processing`, `ready`.
4. **Post-processing is deterministic and local.** Whisper for speech, rules for key moments. No cloud model. The agent that receives the pack is the model.
5. **File formats are the contract between crates,** not shared Rust types. Only `markupr-core` is shared (clock, JSONL writer, paths, manifest).
6. **Screen capture uses the `screencapturekit` crate (v11, feature `macos_15_0`).** Fallback if it will not build on Command Line Tools only (SDK 15.5): `objc2-screen-capture-kit` plus `objc2-av-foundation` with our own AVAssetWriter. Requires macOS 15+.
7. **External tools at run time:** `ffmpeg` and `whisper-cli`. Whisper model paths come from config. The code never downloads a model.
8. **The "pack ready" pop-up is a small native AppKit panel with a Copy prompt button,** not a Notification Center banner. A banner's action button hides behind hover, and it needs a signed app bundle plus a notification permission click; this Mac has no signing identity. The panel needs neither and matches "a little pop-up". A banner can be added in M5 once there is a bundle.
9. **Browser logs come through the Chrome DevTools Protocol** from a dedicated debug profile. Chrome 136+ ignores `--remote-debugging-port` on the default profile, so the helper launches Chrome with its own `--user-data-dir`. Attaching to the real profile (Chrome 144+ `chrome://inspect/#remote-debugging`) is M5.
10. **v1 records one display:** the one under the cursor at start, or `--display`. All displays is M5. Events carry global coordinates so this is additive.

## Crates

| Crate                    | Owns                                                                                                                | Notes                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `crates/markupr-core`    | clock, JSONL writer, session paths, `session.json`, config                                                          | no macOS UI deps                                |
| `crates/markupr-screen`  | screen video, system audio, mic, host-time anchors                                                                  | reports host ns only; no core dependency needed |
| `crates/markupr-events`  | cursor, clicks, scroll, key policy, focused app/window, element under cursor, marks, unified log, permission checks | all permission code lives here                  |
| `crates/markupr-browser` | DevTools Protocol capture, debug-browser launcher                                                                   | plain threads, no async runtime unless forced   |
| `crates/markupr-pack`    | transcribe, align, moments, key frames, SUMMARY.md, PROMPT.md                                                       | pure functions over the pack folder             |
| `crates/markupr`         | CLI, control socket, hotkeys, main-thread loop, menu bar, pop-up                                                    | bin `markupr`                                   |

Main thread runs a `tao` event loop from M1 (accessory activation policy, no Dock icon), so hotkeys (`global-hotkey`), the menu bar (`tray-icon`) and the pop-up attach without a rewrite. Capture runs on worker threads.

Commands: `app` (the default), `record`, `start`, `stop` (waits for the pack and prints its path), `status`, `mark`, `pack <dir>`, `frame <dir> <t>` (the screen at any time, cursor ringed), `prompt [--copy]`, `doctor`, `displays`, `browser`, `popup <dir>`. No MCP server in v1: the pack is plain files and the CLI covers the rest.
`stop` and `mark` reach the running recorder through a Unix socket at `~/Library/Application Support/markupr/control.sock`.
Default hotkeys: toggle `ctrl+opt+R`, mark `ctrl+opt+X`. Configurable in `~/Library/Application Support/markupr/config.toml`.

## Clock

- `t` everywhere is seconds since session start, 3 decimals: `(host_ns - t0_host_ns) / 1e9`, where host ns is `mach_absolute_time` scaled by the timebase.
- `session.json.clock = { t0_host_ns, t0_unix_ms }`. Wall time is for people; `t` is for alignment.
- **Video time zero.** `video.start_t` is the host time of the first frame written to the file. The screen crate must establish it exactly, either by owning the writer (session starts at the first frame's timestamp) or by logging every delivered frame's timestamp and matching the file's frame deltas against that log. File time = `t - video.start_t`.
- Mic and system audio each carry their own `start_t` from the first sample's host timestamp.
- Tolerance, measured in M1: a click-triggered page change appears in the frame at `t_click + 0.15 s` and not at `t_click - 0.05 s`; the same sound in the mic and system tracks agrees within 100 ms.

## Pack format (`markupr.pack/1`)

Default location `~/markupr/packs/<YYYY-MM-DD_HH-MM-SS>/`. Packs never go in the repo.

```
PROMPT.md            what to paste to the agent
SUMMARY.md           one item per issue; read first
session.json         manifest
video.mp4            screen, plus system audio track when captured
audio/mic.wav        microphone
transcript.json      segments and words with t
transcript.md        readable transcript, [mm:ss.s] per line
events.jsonl         discrete events on the session clock
cursor.jsonl         dense cursor track (max 30 Hz, only while moving)
logs/browser.jsonl   console, exceptions, network, navigation, clicked DOM element
logs/system.jsonl    filtered unified log for the frontmost app
moments.json         machine-readable version of SUMMARY
frames/item-NN.jpg       key frame, cursor ringed, max 1920 px wide
frames/item-NN-zoom.jpg  native-resolution crop around the cursor
```

`session.json`:

```json
{
  "schema": "markupr.pack/1",
  "id": "2026-11-16_14-05-33",
  "status": "ready",
  "app_version": "3.0.0-dev",
  "clock": { "t0_host_ns": 0, "t0_unix_ms": 0 },
  "duration": 61.2,
  "display": { "id": 1, "x": 0, "y": 0, "w": 1512, "h": 982, "scale": 2.0 },
  "video": {
    "file": "video.mp4",
    "start_t": 0.41,
    "width": 3024,
    "height": 1964,
    "fps": 30
  },
  "mic": { "file": "audio/mic.wav", "start_t": 0.4, "sample_rate": 48000 },
  "system_audio": { "file": "video.mp4", "stream": "a:0", "start_t": 0.41 },
  "sources": {
    "events": true,
    "system_log": true,
    "browser": { "attached": true, "port": 9222 }
  },
  "permissions": { "screen": true, "accessibility": true, "microphone": true },
  "timing": {
    "stop_unix_ms": 0,
    "pack_ready_unix_ms": 0,
    "stop_to_ready_ms": 0,
    "stages_ms": {
      "finalize": 0,
      "transcribe": 0,
      "moments": 0,
      "frames": 0,
      "write": 0
    }
  }
}
```

Missing sources are `null` or `false`; the pack still builds.

Coordinates are global display points, origin at the top-left of the main display. Frame pixel = `((x - display.x) * scale, (y - display.y) * scale)`.

`events.jsonl`, one object per line, always `t` and `type`:

```json
{"t":3.120,"type":"focus","app":"Google Chrome","bundle":"com.google.Chrome","pid":812,"window":"Shop demo"}
{"t":4.801,"type":"mouse_down","button":"left","x":812.0,"y":440.5,"el":{"role":"AXButton","title":"Add to cart"}}
{"t":4.893,"type":"mouse_up","button":"left","x":812.0,"y":440.5}
{"t":6.200,"type":"scroll","x":800.0,"y":500.0,"dx":0,"dy":-240}
{"t":7.000,"type":"key","key":"Enter","mods":["cmd"]}
{"t":8.100,"type":"typing","count":14,"dur":2.1}
{"t":9.500,"type":"mark","n":1,"x":812.0,"y":440.5,"source":"hotkey","note":null}
{"t":9.900,"type":"secure_input","on":true}
```

`cursor.jsonl`: `{"t":4.512,"x":790.2,"y":431.0}`.

`logs/browser.jsonl`:

```json
{"t":4.861,"type":"exception","text":"TypeError: Cannot read properties of undefined (reading 'total')","url":"http://127.0.0.1:8123/app.js","line":12,"col":9,"stack":["addToCart app.js:12"],"tab":{"id":"A1","url":"http://127.0.0.1:8123/","title":"Shop demo"},"src_ts":1234.5}
{"t":5.002,"type":"console","level":"error","text":"Save failed: 500","url":"...","line":30,"tab":{}}
{"t":5.000,"type":"network","method":"POST","url":"http://127.0.0.1:8123/api/save","status":500,"mime":"text/plain","dur_ms":12,"start_t":4.988,"failed":false,"error":null,"tab":{}}
{"t":1.100,"type":"navigation","url":"http://127.0.0.1:8123/","tab":{}}
{"t":4.800,"type":"dom_click","selector":"button#add","tag":"button","text":"Add to cart","tab":{}}
```

A request that never finished is written at stop with `"pending": true`. Console lines Chrome replays from before the recording carry their own time (negative `t`) and `"replayed": true`.

`logs/system.jsonl`: `{"t":5.2,"level":"error","process":"Google Chrome","pid":812,"subsystem":"...","category":"...","msg":"..."}`.

`transcript.json`: `{"model":"ggml-large-v3-turbo","source":"mic","segments":[{"t0":3.9,"t1":7.4,"text":"...","words":[{"t0":3.9,"t1":4.1,"w":"this"}]}]}`.

### Privacy rules (in code, not policy)

- Printable keys are only counted (`typing`). Named keys and cmd/ctrl chords are logged by name. No typed text is ever reconstructable. While secure input is on, nothing about keys is written.
- Element values are never read from secure text fields. Element text is capped at 80 characters.
- Network lines hold method, URL, status, type and duration. No headers, no bodies. Query and fragment values are replaced with `REDACTED` when the key contains token, secret, passw, session, credential, apikey or signature, or has a segment equal to key, sig, code, auth, pwd, sid, otp or pin. URL user and password are dropped. The same applies to URLs inside console text and tab titles.
- Everything stays on disk under the user's home. No network calls from markupR itself.

## Post-processing

1. **Transcribe.** `ffmpeg` to 16 kHz mono, then `whisper-cli` with word timestamps. Default model is the accurate one; `--fast` uses the small one. Speech comes from the mic; `--audio-source system` transcribes the system audio track instead. No model configured: skip speech, still build the pack, say so in SUMMARY.
2. **Utterances.** Join whisper words into utterances; split on a gap of 0.7 s or more, or after 12 s.
3. **Moments.** `mark` (every mark). `error` (browser exception, console error, request failed or status 400+, a request with no response at stop). System log lines never score: an app's unified log carries routine error chatter. `pointing` (strong phrases such as "that's wrong", "look at this", "right here", "broken", "doesn't work", "not working", "nothing happens", "wrong", "should"; weak words "this", "here", "that"). `click_speech` (a click inside an utterance). Clicks on markupR's own menu and panel are ignored. Canceled requests and long-lived requests that did get a response are not errors. Lines Chrome replays from before the recording are never scored.
4. **Items.** Score each utterance: an attached mark, +5; an attached error, +3; strong phrase, +2; click inside, +1; any weak word, +1 once. A mark attaches to one utterance: the one being spoken, else the nearest within 3 s. Each error attaches to one utterance: the one being spoken when it happened (a request counts from when it was sent), else the next one starting within 8 s, else the one that ended within 3 s before; an error text that already scored one utterance does not score another. Score 2 or more makes an item. Flagged utterances less than 2 s apart merge, unless each has its own mark. A mark with no speech becomes its own item. Errors nobody talked about go in one short "Other errors" list. Everything else that was said is listed, one line each, under "Other things said", so the summary never hides speech.
5. **Anchor and frames.** Anchor time is the mark, else the strong phrase, else the click, else the first weak word, else the item's attached error, else the utterance midpoint. The video only has a frame when the screen changed, so the picture for a time is the last frame at or before it. Pull that frame, ring the cursor, and write the zoom crop. Every further mark in the item gets its own ringed frame (`item-NN-mark-K.jpg`). An anchor before the first video frame uses the first frame and says so. If the item has a click more than 1 s from the anchor, add a second frame 0.3 s after the click.
6. **Log lines per item.** An item's attached errors first; then browser errors, warnings and failed requests from 15 s before the item to 5 s after, nearest first, at most 8, each cited as `logs/browser.jsonl:LINE`. System log errors from the item's window, at most 2 distinct messages. A log line is listed in one place only.
7. **SUMMARY.md.** Header (when, how long, what was captured, what was missing, and capture notes from `session.json.warnings` such as dropped frames, mic gaps or a capture that stopped early). Then one section per item, in time order: title (first sentence he said, else the error text), why it was flagged, what he said, what he was looking at (app, window, URL, element, cursor), the frame, matching log lines, and where to dive deeper (`t` range, video offset, an `ffmpeg -ss` line). Target under 150 lines for a one-minute session.
8. **PROMPT.md.** The pack path, "read SUMMARY.md first", then the raw files and how to pull more frames.

Target: stop to pack ready in under 20 s for a one-minute session with the accurate model. The tool writes its own timing into `session.json`.

## macOS permissions

| Permission                           | Used for                                                                 | Check                                                |
| ------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| Screen Recording                     | ScreenCaptureKit video and system audio                                  | `CGPreflightScreenCaptureAccess`                     |
| Accessibility (and Input Monitoring) | event tap for cursor, clicks, keys; focused window; element under cursor | `AXIsProcessTrusted`, `CGPreflightListenEventAccess` |
| Microphone                           | narration                                                                | `AVCaptureDevice.authorizationStatus(.audio)`        |

- Run from a terminal, the binary inherits that terminal's grants. That is the dev and first-article path on this Mac (T3 Code holds all three, checked 11/16).
- A bundled `markupR.app` gets its own grants, tied to its signature. With ad-hoc signing every rebuild needs a re-grant, so the bundle waits for M5 and a signing identity. Eddie clicks the three prompts once.
- `markupr doctor` prints each state and opens the right Settings pane. A missing permission disables that source and is recorded in `session.json`; it never blocks the others. One exception in v1: the microphone is captured through the screen stream, so without Screen Recording there is no microphone audio either.
- macOS 15+ periodically re-asks about direct screen capture. Expected.

## Milestones

Each lane owns its files exclusively. Lanes do not commit; the lead commits each lane after review. No pushes, tags or releases.

| #   | Outcome                                            | Lanes                                          | Acceptance                                                                                                                                                         |
| --- | -------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Recorder writes video, mic and events on one clock | core + CLI (Sol); screen (Opus); events (Opus) | 20 s run: `ffprobe` reads `video.mp4` and `mic.wav`; events show clicks, keys, focus, marks; both clock tolerances pass                                            |
| 2   | Pack with transcript and SUMMARY                   | pack (Sol), started early on fixtures          | recorded session yields SUMMARY.md naming the marked issues with ringed frames                                                                                     |
| 3   | Browser logs                                       | browser (Sol), started early                   | console error, exception and failed request land in `logs/browser.jsonl` within 100 ms of the click that caused them; `markupr browser` launches the debug profile |
| 4   | Pop-up with Copy prompt, menu bar toggle           | app shell (Sol)                                | stop from the menu bar or hotkey, panel appears when ready, button puts PROMPT.md text on the clipboard                                                            |
| 5   | Polish                                             | as needed                                      | README, all displays, real-profile attach, `list`/`mcp`, app bundle script, crash-safe video                                                                       |

Review, per RULINGS 2026-11-16 13:45 (the reviewer is never the builder's provider; permission diffs never go to Sol or Codex):

| Built by    | Paths                                        | Builder's check                      |
| ----------- | -------------------------------------------- | ------------------------------------ |
| Claude Opus | `markupr-screen`                             | Sol, with `sol-loop`                 |
| Claude Opus | `markupr-events` (input and permission code) | Grok                                 |
| Codex Sol   | core, CLI, pack, browser, app shell          | Grok while Claude is full, else Opus |

Then the lead reads the diff and runs the acceptance. Then `council` (Opus, Sol, Grok) closes the milestone, each seat scoped to paths its own provider did not build; Sol never gets `markupr-events`.

## First-article test

**Test windows (Eddie, 11/16 14:13).** Test windows on his screen are fine as long as he can tell what they are: the test page is titled "markupR test page (automated)", and any other test window is labeled the same way. (A 14:10 no-window rule was lifted three minutes later.) The on-screen run moves his cursor and speaks, so it starts only when Eddie replies "markupr go" (seat, 11/16 14:51). Nothing auto-starts on idle: an idle Mac can mean he is on a call. The harness refuses without `--owner-go`, and still checks that the Mac is idle and the mic is free before it begins. No capture tests and no test panels run during a call.

What is proved without the on-screen run:
- screen crate: file timestamps equal host timestamps (numeric proof), short passive clips;
- events crate: clock and key policy through in-process events fed to the handler; passive counts;
- browser crate: headless Chrome, clock difference measured;
- pack crate: synthetic session with file-generated speech;
- whole recorder: a short passive `markupr record` run, checked by numbers and deleted.

The on-screen run, about three minutes, from the terminal:

1. A local test page titled "markupR test page (automated)" (served from a temp port, stopped by PID) with two faults in two places: "Add to cart" throws a TypeError; "Save" posts to an endpoint that returns 500 and logs a console error. A click also changes the page color, for the clock check.
2. Chrome started by binary with a throwaway profile on a non-default debug port, sized to cover one display. Only that display is recorded.
3. Clock check, about 12 s: five clicks on the page; the color change must show in the video 0 to 150 ms after each click.
4. Walkthrough, about 60 s: `say` narration in Eddie's style, synthetic cursor moves and clicks on both buttons, the mark hotkey pressed twice by synthetic key events.
5. Stop. Read `timing.stop_to_ready_ms`.
6. Pass: SUMMARY.md has two items, each with the right sentence, a frame whose ring sits on the right button, and its own log line. The lead opens the frames, and checks for anything unrelated on screen, before citing the pack.

No EFSJ windows, titles or audio in any test pack. Test packs live in `~/markupr/packs/`, never in git.

## Risks

- **Capture binding on Command Line Tools only.** First deliverable of the screen lane is a 3 s video plus mic that `ffprobe` reads. If the crate cannot do it, switch to the objc2 fallback the same day.
- **Narration through speakers is not Eddie's voice.** The first article proves the pipeline; the first thing Eddie should try is one spoken run.
- **Input-capture code and Codex content filters.** That lane stays on Claude.
- **Arc.** Debug-port support is community-reported only. Chrome is the supported browser in v1.
- **A crash mid-recording loses the video** (MP4 is finalized at stop). JSONL files survive. Fragmented writing is M5.
