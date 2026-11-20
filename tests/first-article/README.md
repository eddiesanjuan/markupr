# First article (macOS, logged-in desktop)
On-screen runs need `--owner-go` and start only after the owner says "markupr go"; nothing auto-starts on idle. Run from the repo root; display-free checks: `python3 tests/first-article/check_offscreen.py`; on-screen tests move the cursor.
Build: `CARGO_TARGET_DIR=target/l7 cargo build -p markupr`.
Walkthrough: `python3 tests/first-article/run.py --markupr-bin target/l7/debug/markupr`.
Silent dry run: append `--no-speech`; speech checks will fail without recorded narration.
Clock check: `python3 tests/first-article/run.py --markupr-bin target/l7/debug/markupr --mode clock-check`.
Select `--display main` (default) or a zero-based NSScreen index; points use main-display top-left origin.
Idle for 60 seconds and free the default mic first; `--idle-min SECONDS` changes the idle gate, `--force` overrides both gates.
Packs default to `~/markupr/packs`; `--packs-dir DIR` changes it; JPEG rings/state, browser timing and popup Copy checks print and write `tests-result.json` in that pack; exit 0=pass, 1=failed checks, 2=blocked/error.
Only owned PIDs are stopped and the temporary Chrome profile is removed; inspect frames for unrelated screen content before sharing, then delete disposable dry-run packs.
