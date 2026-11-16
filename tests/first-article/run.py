#!/usr/bin/env python3
"""Scripted first article. Requires an idle, logged-in macOS desktop."""
import argparse
import json
import math
import os
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


def inside(point, rect, margin=30):
    x, y = point
    return rect['x'] - margin <= x <= rect['x'] + rect['w'] + margin and rect['y'] - margin <= y <= rect['y'] + rect['h'] + margin


def decode_frame(path):
    probe = json.loads(command([FFPROBE, '-v', 'error', '-select_streams', 'v:0',
                               '-show_entries', 'stream=width,height', '-of', 'json', path]))
    stream = probe['streams'][0]
    raw = sp.check_output([FFMPEG, '-v', 'error', '-i', str(path), '-frames:v', '1',
                           '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], timeout=30)
    return raw, stream['width'], stream['height']


def frame_checks(pack, session, number, rect, flip, background_point, results):
    prefix = f'item {number}'
    path = pack / f'frames/item-{number:02}.jpg'
    display, video = session.get('display'), session.get('video')
    if not path.is_file() or not display or not video:
        for label in ('ring', 'picture state'):
            results.add(prefix + ' ' + label, detail='missing input: anchor JPEG, display or video dimensions')
        return
    try:
        raw, width, height = decode_frame(path)
    except (sp.SubprocessError, KeyError, IndexError, ValueError) as error:
        for label in ('ring', 'picture state'):
            results.add(prefix + ' ' + label, False, 'anchor JPEG cannot be decoded: ' + str(error))
        return
    # JPEG and resizing alter the exact pink. A 70 RGB-unit radius excludes
    # both page backgrounds, white controls, and the white ring outline.
    count = sum_x = sum_y = 0
    for offset in range(0, len(raw), 3):
        r, g, b = raw[offset:offset + 3]
        if (r - 255) ** 2 + (g - 20) ** 2 + (b - 120) ** 2 <= 70 ** 2:
            pixel = offset // 3
            count += 1
            sum_x += pixel % width + .5
            sum_y += pixel // width + .5
    # Frame -> source video pixels -> global display points. This also handles
    # downscaled frames, Retina video, and displays above/left of the main one.
    sx = (video['width'] / width) * (display['w'] / video['width'])
    sy = (video['height'] / height) * (display['h'] / video['height'])
    if count:
        centroid = (display['x'] + sum_x / count * sx, display['y'] + sum_y / count * sy)
        distance = math.dist(centroid, center(rect))
        results.add(prefix + ' ring', inside(centroid, rect, 0),
                    f'centroid=({centroid[0]:.1f}, {centroid[1]:.1f}) pt, distance={distance:.1f} pt, pixels={count}')
    else:
        results.add(prefix + ' ring', False, 'zero ring pixels')
    if flip is None or background_point is None:
        results.add(prefix + ' picture state', detail='missing input: page mousedown report or background sample point')
        return
    x = round((background_point[0] - display['x']) / sx)
    y = round((background_point[1] - display['y']) / sy)
    if not (4 <= x < width - 4 and 4 <= y < height - 4):
        results.add(prefix + ' picture state', False, 'background sample is outside anchor JPEG')
        return
    pixels = [raw[(py * width + px) * 3:(py * width + px) * 3 + 3]
              for py in range(y - 4, y + 4) for px in range(x - 4, x + 4)]
    mean = tuple(sum(p[c] for p in pixels) / len(pixels) for c in range(3))
    expected = (32, 80, 224) if flip['flipped'] else (255, 240, 192)
    results.add(prefix + ' picture state', math.dist(mean, expected) <= 50,
                f'background RGB={tuple(round(c, 1) for c in mean)}, expected={expected}')


def browser_timing(pack, events, rectangles, results):
    logs = json_lines(pack / 'logs/browser.jsonl')
    for number, name in enumerate(('add', 'save'), 1):
        clicks = [e for e in events if e.get('type') == 'mouse_down' and
                  'x' in e and 'y' in e and inside((e['x'], e['y']), rectangles[name], 0)]
        prefix = f'item {number} browser timing'
        if not clicks or not logs:
            results.add(prefix, detail='missing input: button mouse_down or logs/browser.jsonl')
            continue
        matching = []
        for line in logs:
            kind, text = line.get('type'), line.get('text', '')
            if (kind == 'dom_click' and (f'#{name}' in line.get('selector', '') or
                text.lower() == ('add to cart' if name == 'add' else 'save')) or
                name == 'add' and kind == 'exception' and 'TypeError' in text and 'total' in text or
                name == 'save' and kind == 'console' and 'Save failed: 500' in text or
                name == 'save' and kind == 'network' and line.get('url', '').split('?')[0].endswith('/api/save')):
                matching.append(line)
        for index, event in enumerate(clicks):
            # A button is clicked once in the walkthrough. With repeated clicks,
            # assign each line to its nearest matching button click before testing.
            def timestamp(line):
                return line.get('start_t') if line.get('type') == 'network' else line.get('t')
            owned = [line for line in matching if min(clicks, key=lambda e:
                     abs(timestamp(line) - e['t']) if timestamp(line) is not None else math.inf) is event]
            required = {'dom_click', 'exception'} if name == 'add' else {'dom_click', 'console', 'network'}
            missing = required - {line['type'] for line in owned}
            passed, details = not missing, []
            for line in owned:
                stamp = line.get('start_t') if line['type'] == 'network' else line.get('t')
                if stamp is None:
                    passed = False
                    details.append(line['type'] + ': missing input timestamp')
                else:
                    delta = (stamp - event['t']) * 1000
                    passed &= -1e-6 <= delta <= 100 + 1e-6
                    details.append(f"{line['type']}={delta:.1f} ms")
            if missing:
                details.append('missing input: ' + ', '.join(sorted(missing)))
            results.add(prefix + (f' click {index+1}' if len(clicks) > 1 else ''), passed, '; '.join(details))


def clipboard_text():
    return sp.check_output(['/usr/bin/pbpaste']).decode('utf-8')


def wait_log(path, pattern, seconds=3):
    deadline = time.monotonic() + seconds
    while True:
        match = re.search(pattern, path.read_text())
        if match or time.monotonic() >= deadline:
            return match
        time.sleep(.05)


def popup_checks(pack, recorder_log, results, click_fn=None, read_clipboard=None,
                 save_clipboard=None, restore_clipboard=None, clipboard_helper=None):
    click_fn = click if click_fn is None else click_fn
    read_clipboard = clipboard_text if read_clipboard is None else read_clipboard
    if save_clipboard is None:
        save_clipboard = lambda path: command([clipboard_helper, 'clipboard-save', path])
    if restore_clipboard is None:
        restore_clipboard = lambda path: command([clipboard_helper, 'clipboard-restore', path])
    match = wait_log(recorder_log, r'popup: frame=[^\n]+ copy=([-\d.,]+) finder=')
    copy_rect = [float(n) for n in match[1].split(',')] if match else []
    appeared = len(copy_rect) == 4 and copy_rect[2] > 0 and copy_rect[3] > 0
    results.add('popup appeared', appeared, f'copy={copy_rect}' if appeared else 'missing input: popup Copy rectangle')
    if not appeared:
        results.add('popup closed copy', False, 'popup did not appear')
        results.add('clipboard equals PROMPT.md', False, 'popup did not appear')
        return False
    with tempfile.TemporaryDirectory(prefix='markupr-clipboard-') as folder:
        saved = Path(folder) / 'pasteboard.json'
        save_clipboard(saved)
        try:
            x, y, w, h = copy_rect
            click_fn((x + w / 2, y + h / 2))
            closed = wait_log(recorder_log, r'popup: closed reason=copy(?:\s|$)')
            results.add('popup closed copy', bool(closed), 'reason=copy' if closed else 'no copy close within 3 s')
            prompt = pack / 'PROMPT.md'
            same = prompt.is_file() and read_clipboard() == prompt.read_bytes().decode('utf-8')
            results.add('clipboard equals PROMPT.md', same, 'exact match' if same else 'clipboard differs or PROMPT.md missing')
        finally:
            restore_clipboard(saved)
    return bool(closed)


def finish_recording(binary, recorder, stdout_path, recorder_log, results, popup=False,
                     stop_command=None, **popup_io):
    stop_command = command if stop_command is None else stop_command
    stopped = stop_command([binary, 'stop'], timeout=180)
    if popup:
        # The stop reply includes the ready pack path. A non-app recorder prints
        # its own final path only after the panel closes, so do not wait for it yet.
        ready_pack = Path(stopped.splitlines()[-1]).expanduser().resolve()
        if not popup_checks(ready_pack, recorder_log, results, **popup_io):
            stop_owned(recorder)
    recorder.wait(timeout=10 if popup else 180)
    lines = stdout_path.read_text().splitlines()
    if not lines:
        raise RuntimeError('Recorder produced no pack path after exit')
    pack = Path(lines[-1]).expanduser().resolve()
    if popup and pack != ready_pack:
        raise RuntimeError('Stop reply and recorder stdout disagree on the pack path')
    return pack


def walkthrough_checks(pack, session, rectangles, results, state=None, background_point=None):
    results.add('session status ready', session['status'] == 'ready' if 'status' in session else None,
                'status=' + str(session['status']) if 'status' in session else 'missing input: session.json status')
    timing = session.get('timing') or {}
    latency = timing.get('stop_to_ready_ms')
    results.add('stop_to_ready_ms', 0 <= latency <= 20000 if latency is not None else None,
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
    for number, name in enumerate(('add', 'save'), 1):
        flips = [row['data'] for row in state or [] if row['path'] == '/api/flip' and row['data'].get('target') == name]
        frame_checks(pack, session, number, rectangles[name], flips[0] if flips else None, background_point, results)
    browser_timing(pack, events, rectangles, results)
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
            results.add(f'click {i+1} page clock', -50 <= delta <= 50, f'{delta:.1f} ms (limit ±50 ms)')
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
        click_time = t - start
        # ScreenCaptureKit may emit nothing while the page is still. The last
        # frame can be arbitrarily old; select its actual frame index, not a
        # fixed pre-click time window or an interpolated/repeated frame.
        baseline_index = next((n for n in range(len(pts) - 1, -1, -1)
                               if pts[n] <= click_time), None)
        if baseline_index is None:
            results.add(f'click {i+1} video flip', False, 'no frame at or before click')
            continue
        indices = [baseline_index] + [n for n in range(baseline_index + 1, len(pts))
                                      if pts[n] <= click_time + .4]
        select = '+'.join(f'eq(n\\,{n})' for n in indices)
        vf = f'select={select},crop=8:8:{x}:{y},scale=1:1:flags=area'
        raw = sp.check_output([FFMPEG, '-v', 'error', '-i', str(video_path), '-an', '-vf', vf,
                               '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], timeout=30)
        colors = [tuple(raw[j:j+3]) for j in range(0, len(raw), 3)]
        if len(colors) != len(indices):
            results.add(f'click {i+1} video flip', False, 'timestamp/frame count mismatch')
            continue
        baseline = colors[0]
        changed = next((pts[n] for n, color in zip(indices[1:], colors[1:])
                        if math.dist(color, baseline) > 100), None)
        delta = (changed + start - t) * 1000 if changed is not None else None
        age = (click_time - pts[baseline_index]) * 1000
        results.add(f'click {i+1} video flip', delta is not None and 0 <= delta <= 150,
                    (f'{delta:.1f} ms' if delta is not None else 'no color flip by +400 ms') +
                    f'; baseline age={age:.1f} ms')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--markupr-bin', type=Path, default=REPO / 'target/release/markupr')
    parser.add_argument('--display', default='main', help='main or zero-based NSScreen index')
    parser.add_argument('--packs-dir', type=Path, default=Path.home() / 'markupr/packs')
    parser.add_argument('--mode', choices=['walkthrough', 'clock-check'], default='walkthrough')
    parser.add_argument('--no-speech', action='store_true')
    parser.add_argument('--idle-min', type=float, default=60)
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--owner-go', action='store_true', help='required: the owner said "markupr go" for this run')
    parser.add_argument('--audio-source', choices=['mic', 'system'], default='mic', help='which track the pack transcribes')
    parser.add_argument('--say-device', help='audio device name for the narration (say -a); default output if omitted')
    args = parser.parse_args()
    if not args.owner_go:
        print('BLOCKED: this run moves the cursor and speaks. It starts only after the owner says "markupr go"; pass --owner-go then. There is no idle auto-start.')
        return 2
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
            if args.mode == 'walkthrough':
                record_args += ['--audio-source', args.audio_source, '--popup']
            if args.mode == 'clock-check':
                if '--no-pack' in command([args.markupr_bin, 'record', '--help']):
                    record_args.append('--no-pack')
                else:
                    print('Recorder has no --no-pack; clock checks will ignore derived pack output')
            with stdout_path.open('w') as out, recorder_log.open('w') as err:
                recorder = sp.Popen(record_args, stdout=out, stderr=err,
                                    env={**os.environ, 'MARKUPR_UI_DEBUG': '1'})
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
                    speech = sp.Popen(['/usr/bin/say', '-r', '155'] + (['-a', args.say_device] if args.say_device else []) + [text])
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
                sentence("Okay, I'm testing this test page. Let me walk through what's wrong.", 10)
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
            results = Results()
            pack = finish_recording(args.markupr_bin, recorder, stdout_path, recorder_log, results,
                                    popup=args.mode == 'walkthrough', clipboard_helper=helper)
            print('RECORDER STDERR:\n' + recorder_log.read_text(), flush=True)
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
            if args.mode == 'walkthrough':
                walkthrough_checks(pack, session, rectangles, results, state, empty)
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
