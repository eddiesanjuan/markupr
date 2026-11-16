#!/usr/bin/env python3
"""Scripted first article. Requires an idle, logged-in macOS desktop."""
import argparse
import json
import math
from pathlib import Path
import re
import signal
import socket
import subprocess as sp
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
CLICK = '/opt/homebrew/bin/cliclick'
FFMPEG = '/opt/homebrew/bin/ffmpeg'
FFPROBE = '/opt/homebrew/bin/ffprobe'


def command(argv, **kwargs):
    return sp.check_output([str(a) for a in argv], text=True, **kwargs).strip()


def json_file(path):
    return json.loads(path.read_text()) if path.exists() else None


def json_lines(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line] if path.exists() else []


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def until(predicate, seconds, description):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.1)
    raise RuntimeError('Timed out waiting for ' + description)


def interrupted(_signum, _frame):
    raise KeyboardInterrupt


def stop_owned(process):
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except sp.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def coords(x, y):
    # cliclick needs '=' to distinguish negative absolute coordinates from offsets.
    return ','.join('=' + str(round(v)) if v < 0 else str(round(v)) for v in (x, y))


def move(point):
    command([CLICK, '-e', '20', 'm:' + coords(*point)])


def click(point):
    print('CLICK screen=' + coords(*point), flush=True)
    command([CLICK, 'c:' + coords(*point)])


def button_rect(layout, name):
    # Dedicated undecorated-content Chrome window: centered horizontal border and
    # bottom border are equal; all remaining outer/inner height is top chrome.
    border = (layout['outerWidth'] - layout['innerWidth']) / 2
    box = layout['buttons'][name]
    return {'x': layout['screenX'] + border + box['x'],
            'y': layout['screenY'] + layout['outerHeight'] - layout['innerHeight'] - border + box['y'],
            'w': box['width'], 'h': box['height']}


def center(rect):
    return rect['x'] + rect['w'] / 2, rect['y'] + rect['h'] / 2


class Results:
    def __init__(self):
        self.rows = []

    def add(self, name, passed=None, detail='missing input'):
        self.rows.append({'check': name, 'status': 'PASS' if passed else 'FAIL',
                          'detail': detail, 'missing_input': passed is None})

    def show(self):
        print('\nRESULT | CHECK                         | DETAIL')
        for row in self.rows:
            print(f"{row['status']:6} | {row['check']:<29} | {row['detail']}")


def app_names(pack, results):
    focus = sorted({e['app'] for e in json_lines(pack / 'events.jsonl')
                    if e.get('type') == 'focus' and e.get('app')})
    system = sorted({e['process'] for e in json_lines(pack / 'logs/system.jsonl') if e.get('process')})
    print('FOCUS APPS:', json.dumps(focus) if (pack / 'events.jsonl').exists() else 'missing input: events.jsonl')
    print('SYSTEM APPS:', json.dumps(system) if (pack / 'logs/system.jsonl').exists() else 'missing input: logs/system.jsonl')
    return {'focus': focus, 'system': system}


def walkthrough_checks(pack, session, rectangles, results):
    results.add('session status ready', session['status'] == 'ready' if 'status' in session else None,
                'status=' + str(session['status']) if 'status' in session else 'missing input: session.json status')
    timing = session.get('timing') or {}
    latency = timing.get('stop_to_ready_ms')
    results.add('stop_to_ready_ms', latency is not None if latency is not None else None,
                str(latency) + ' ms' if latency is not None else 'missing input: timing.stop_to_ready_ms')
    moments = json_file(pack / 'moments.json')
    items = moments.get('items', []) if isinstance(moments, dict) else moments or []
    results.add('exactly two items', len(items) == 2 if moments is not None else None,
                f'{len(items)} items' if moments is not None else 'missing input: moments.json')
    track = json_lines(pack / 'cursor.jsonl')
    events = json_lines(pack / 'events.jsonl')
    for i, (name, phrase, error) in enumerate([('add', 'add to cart', 'TypeError'), ('save', 'save', '500')]):
        prefix = f'item {i + 1}'
        item = items[i] if i < len(items) else None
        for label in ('speech', 'logs', 'frames', 'cursor'):
            if item is None:
                results.add(prefix + ' ' + label, detail='missing input: item')
                continue
            if label == 'speech':
                said = item.get('said')
                results.add(prefix + ' speech', phrase in said.lower() if said else None,
                            said or 'missing input: item.said')
            elif label == 'logs':
                logs = item.get('logs')
                log_text = ' '.join(log if isinstance(log, str) else log.get('text', '') for log in logs or [])
                results.add(prefix + ' logs', error in log_text if logs else None,
                            f'expected {error}' if logs else 'missing input: item.logs')
            elif label == 'frames':
                paths = []
                for frame in item.get('frames', []):
                    if isinstance(frame, str):
                        paths.append(frame)
                    else:
                        paths.extend(frame[k] for k in ('file', 'zoom') if frame.get(k))
                # Both ringed frame and zoom crop are part of the pack contract.
                paths.extend([f'frames/item-{i+1:02}.jpg', f'frames/item-{i+1:02}-zoom.jpg'])
                absent = [p for p in sorted(set(paths)) if not (pack / p).is_file()]
                results.add(prefix + ' frames', True if not absent else None,
                            'missing input: ' + ', '.join(absent) if absent else ', '.join(sorted(set(paths))))
            else:
                anchor = item.get('anchor_t')
                # Dense cursor only writes while moving. Last sample remains valid
                # until the next move; a mark event is an exact anchor observation.
                points = track + [e for e in events if e.get('type') in ('mark', 'mouse_down', 'mouse_up')]
                before = [p for p in points if anchor is not None and p.get('t', math.inf) <= anchor and 'x' in p and 'y' in p]
                if not before:
                    results.add(prefix + ' cursor', detail='missing input: cursor at anchor')
                else:
                    p = max(before, key=lambda p: p['t'])
                    r = rectangles[name]
                    inside = r['x'] - 30 <= p['x'] <= r['x'] + r['w'] + 30 and r['y'] - 30 <= p['y'] <= r['y'] + r['h'] + 30
                    results.add(prefix + ' cursor', inside, f"anchor={anchor}, cursor=({p['x']}, {p['y']}), button={name}")
    for name in ('SUMMARY.md', 'PROMPT.md'):
        results.add(name, True if (pack / name).is_file() else None,
                    'exists' if (pack / name).is_file() else 'missing input: ' + name)


def clock_checks(pack, session, state, point, results):
    events = [e for e in json_lines(pack / 'events.jsonl') if e.get('type') == 'mouse_down']
    flips = [e['data'] for e in state if e['path'] == '/api/flip']
    results.add('five mouse_down events', len(events) == 5 if (pack / 'events.jsonl').exists() else None,
                str(len(events)) if (pack / 'events.jsonl').exists() else 'missing input: events.jsonl')
    results.add('five page flips', len(flips) == 5, str(len(flips)))
    video = session.get('video') or {}
    start = video.get('start_t')
    video_path = pack / video.get('file', 'video.mp4')
    t0 = (session.get('clock') or {}).get('t0_unix_ms')
    available = start is not None and video_path.is_file() and session.get('display') is not None
    pts = []
    if available:
        probe = json.loads(command([FFPROBE, '-v', 'error', '-select_streams', 'v:0', '-show_frames',
                                    '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', video_path]))
        pts = [float(f['best_effort_timestamp_time']) for f in probe['frames']]
    for i in range(max(5, len(events))):
        event = events[i] if i < len(events) else None
        if not event:
            results.add(f'click {i+1} video flip', detail='missing input: mouse_down event')
            results.add(f'click {i+1} page clock', detail='missing input: mouse_down event')
            continue
        t = event['t']
        if i < len(flips) and t0 is not None:
            delta = flips[i]['unix_ms'] - (t0 + t * 1000)
            print(f'PAGE CLOCK click={i+1} delta_ms={delta:.1f}')
            results.add(f'click {i+1} page clock', True, f'{delta:.1f} ms (reported, no threshold)')
        else:
            results.add(f'click {i+1} page clock', detail='missing input: page flip or clock.t0_unix_ms')
        if not available:
            results.add(f'click {i+1} video flip', detail='missing input: video.mp4, video.start_t or display')
            continue
        display = session['display']
        # An empty, fixed page-background patch 40 points from the click.
        sx = video['width'] / display['w']
        sy = video['height'] / display['h']
        x = round((point[0] + 40 - display['x']) * sx)
        y = round((point[1] - display['y']) * sy)
        before, after = max(0, t - start - .2), t - start + .4
        times = [p for p in pts if before <= p <= after]
        vf = f"select=between(t\\,{before:.6f}\\,{after:.6f}),crop=8:8:{x}:{y},scale=1:1:flags=area"
        raw = sp.check_output([FFMPEG, '-v', 'error', '-i', str(video_path), '-an', '-vf', vf,
                               '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], timeout=30)
        colors = [tuple(raw[j:j+3]) for j in range(0, len(raw), 3)]
        if len(colors) != len(times) or not colors or not any(p + start < t for p in times):
            results.add(f'click {i+1} video flip', False, 'no baseline frame or timestamp/frame count mismatch')
            continue
        baseline = colors[0]
        changed = next((p for p, c in zip(times, colors) if math.dist(c, baseline) > 100), None)
        delta = (changed + start - t) * 1000 if changed is not None else None
        results.add(f'click {i+1} video flip', delta is not None and 0 <= delta <= 150,
                    f'{delta:.1f} ms' if delta is not None else 'no color flip in -200..+400 ms')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--markupr-bin', type=Path, default=REPO / 'target/release/markupr')
    parser.add_argument('--display', default='main', help='main or zero-based NSScreen index')
    parser.add_argument('--packs-dir', type=Path, default=Path.home() / 'markupr/packs')
    parser.add_argument('--mode', choices=['walkthrough', 'clock-check'], default='walkthrough')
    parser.add_argument('--no-speech', action='store_true')
    parser.add_argument('--idle-min', type=float, default=60)
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    if args.idle_min < 0:
        parser.error('--idle-min must be nonnegative')
    signal.signal(signal.SIGTERM, interrupted)
    args.markupr_bin = args.markupr_bin.expanduser().resolve()
    args.packs_dir = args.packs_dir.expanduser().resolve()
    if args.packs_dir == REPO or REPO in args.packs_dir.parents:
        parser.error('Recordings must stay outside the repository')
    recorder = chrome = server = speech = None
    with tempfile.TemporaryDirectory(prefix='markupr-first-article-') as temp:
        temp = Path(temp)
        helper = temp / 'mac'
        command(['/usr/bin/swiftc', HERE / 'mac.swift', '-o', helper])
        mic = json.loads(command([helper, 'mic']))
        print('MIC:', json.dumps(mic), flush=True)
        idle_text = command(['/usr/sbin/ioreg', '-c', 'IOHIDSystem'])
        idle = int(re.search(r'"HIDIdleTime"\s*=\s*(\d+)', idle_text).group(1)) / 1e9
        print(f'IDLE: {idle:.1f} seconds (required {args.idle_min:g})', flush=True)
        if not args.force and (idle < args.idle_min or mic['running_somewhere']):
            print('PREFLIGHT BLOCKED: ' + ('recent user input; wait for the desktop to be idle.' if idle < args.idle_min else 'default microphone is already in use.'))
            return 2
        if args.force:
            print('FORCE: idle and mic gates overridden explicitly')
        screens = json.loads(command([helper, 'screens']))
        display = screens[0 if args.display == 'main' else int(args.display)]
        print('DISPLAY:', json.dumps(display), flush=True)
        args.packs_dir.mkdir(parents=True, exist_ok=True)
        state_path = temp / 'server-state.jsonl'
        server_log = temp / 'server.log'
        recorder_log = temp / 'recorder.log'
        stdout_path = temp / 'recorder.stdout'
        try:
            with server_log.open('w') as log:
                server = sp.Popen([sys.executable, str(HERE / 'server.py'), '--state', str(state_path)], stdout=sp.PIPE, stderr=log, text=True)
            info = json.loads(server.stdout.readline())
            port = free_port()
            while port in (9222, info['port']):
                port = free_port()
            visible = display['visible']
            with (temp / 'chrome.log').open('w') as log:
                chrome = sp.Popen([CHROME, '--user-data-dir=' + str(temp / 'profile'),
                    f'--remote-debugging-port={port}', '--no-first-run', '--no-default-browser-check',
                    '--disable-session-crashed-bubble', '--disable-background-mode',
                    '--window-position=' + coords(visible['x'], visible['y']).replace('=', ''),
                    f"--window-size={round(visible['w'])},{round(visible['h'])}",
                    f"http://127.0.0.1:{info['port']}/"], stdout=log, stderr=log)
            def latest_layout():
                rows = [e['data'] for e in json_lines(state_path) if e['path'] == '/api/layout']
                return rows[-1] if rows else None
            until(latest_layout, 30, 'Chrome /api/layout')
            time.sleep(1)
            command([helper, 'front', chrome.pid])
            layout = latest_layout()
            rectangles = {name: button_rect(layout, name) for name in ('add', 'save')}
            print('LAYOUT:', json.dumps(layout), flush=True)
            print('BUTTON RECTANGLES:', json.dumps(rectangles), flush=True)
            for rect in rectangles.values():
                x, y = center(rect)
                d = display['rect']
                if not (d['x'] <= x <= d['x'] + d['w'] and d['y'] <= y <= d['y'] + d['h']):
                    raise RuntimeError('Chrome button is outside chosen display')
            # Empty strip below both cards, safely inside the page viewport.
            content_x = layout['screenX'] + (layout['outerWidth'] - layout['innerWidth']) / 2
            content_y = layout['screenY'] + layout['outerHeight'] - layout['innerHeight'] - (layout['outerWidth'] - layout['innerWidth']) / 2
            empty = (content_x + 60, content_y + layout['innerHeight'] - 60)
            heading = (content_x + 220, content_y + 75)
            move(heading)
            record_args = [str(args.markupr_bin), 'record', '--display', str(display['id']), '--browser-port', str(port), '--out', str(args.packs_dir)]
            if args.mode == 'clock-check':
                if '--no-pack' in command([args.markupr_bin, 'record', '--help']):
                    record_args.append('--no-pack')
                else:
                    print('Recorder has no --no-pack; clock checks will ignore derived pack output')
            with stdout_path.open('w') as out, recorder_log.open('w') as err:
                recorder = sp.Popen(record_args, stdout=out, stderr=err)
            def recording():
                if recorder.poll() is not None:
                    raise RuntimeError('Recorder exited early: ' + recorder_log.read_text())
                return 'recording ' in recorder_log.read_text()
            until(recording, 30, 'recorder startup')
            def sentence(text, duration, target=None):
                nonlocal speech
                if target:
                    move(center(rectangles[target]))
                print('NARRATION:', text, flush=True)
                start = time.monotonic()
                if not args.no_speech:
                    speech = sp.Popen(['/usr/bin/say', '-r', '155', text])
                if target:
                    time.sleep(max(0, start + 1.5 - time.monotonic()))
                    click(center(rectangles[target]))
                    time.sleep(max(0, start + 4 - time.monotonic()))
                    command([helper, 'mark'])
                    print('MARK: synthetic ctrl+alt+X', flush=True)
                if speech:
                    speech.wait(timeout=45)
                    speech = None
                time.sleep(max(0, start + duration - time.monotonic()))
            if args.mode == 'walkthrough':
                sentence("Okay, I'm testing the shop demo page. Let me walk through what's wrong.", 10)
                sentence("So when I click this add to cart button right here, nothing happens. Look at this, the cart total never updates. That's wrong, it should show the new total.", 18, 'add')
                move(empty)
                sentence('The rest of the page looks fine to me. The layout is okay and the spacing is okay.', 10)
                sentence("Now over here, when I hit save, it just sits there. This is broken, it's not saving anything.", 14, 'save')
                sentence("That's everything. Two problems, the add to cart button and the save button.", 8)
            else:
                move(empty)
                time.sleep(2)
                for _ in range(5):
                    click(empty)
                    time.sleep(1.5)
                time.sleep(2)
            command([args.markupr_bin, 'stop'], timeout=10)
            recorder.wait(timeout=180)
            print('RECORDER STDERR:\n' + recorder_log.read_text(), flush=True)
            lines = stdout_path.read_text().splitlines()
            if not lines:
                raise RuntimeError('Recorder produced no pack path')
            pack = Path(lines[-1]).expanduser().resolve()
            if args.packs_dir not in pack.parents or not (pack / 'session.json').is_file():
                raise RuntimeError('Recorder last stdout line is not a session path inside --packs-dir')
            print('PACK:', pack, flush=True)
            state = json_lines(state_path)
            print('SERVER STATE:')
            for row in state:
                if row['path'] != '/api/layout':
                    print(json.dumps(row))
            print('SERVER REQUESTS:\n' + server_log.read_text())
            session = json_file(pack / 'session.json')
            results = Results()
            if args.mode == 'walkthrough':
                walkthrough_checks(pack, session, rectangles, results)
            else:
                clock_checks(pack, session, state, empty, results)
            apps = app_names(pack, results)
            results.show()
            report = {'mode': args.mode, 'no_speech': args.no_speech or args.mode == 'clock-check',
                      'display': display, 'buttons': rectangles, 'mic_preflight': mic,
                      'server_state': state, 'apps': apps, 'checks': results.rows}
            (pack / 'tests-result.json').write_text(json.dumps(report, indent=2) + '\n')
            return int(any(row['status'] == 'FAIL' for row in results.rows))
        finally:
            # Termination targets are exclusively the Popen handles created above.
            stop_owned(speech)
            stop_owned(recorder)
            stop_owned(chrome)
            stop_owned(server)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except (RuntimeError, sp.SubprocessError, OSError, ValueError, KeyError) as error:
        print('ERROR:', error, file=sys.stderr)
        sys.exit(2)
