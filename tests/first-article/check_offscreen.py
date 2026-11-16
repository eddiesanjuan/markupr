#!/usr/bin/env python3
"""Display-free checks. Never starts run.py, a recorder, speech or native input."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import socket
import struct
import subprocess as sp
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('first_article', HERE / 'run.py')
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class CDP:
    """Minimal synchronous RFC 6455 client for this local, short-lived check."""
    def __init__(self, url):
        url = urlparse(url)
        self.socket = socket.create_connection((url.hostname, url.port), timeout=10)
        self.serial = 0
        self.events = []
        key = base64.b64encode(os.urandom(16)).decode()
        self.socket.sendall((f'GET {url.path} HTTP/1.1\r\nHost: {url.netloc}\r\n'
            f'Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n'
            'Sec-WebSocket-Version: 13\r\n\r\n').encode())
        response = b''
        while not response.endswith(b'\r\n\r\n'):
            response += self.read(1)
        assert response.splitlines()[0].split()[1] == b'101', response.decode()

    def read(self, count):
        value = b''
        while len(value) < count:
            chunk = self.socket.recv(count - len(value))
            if not chunk:
                raise RuntimeError('CDP websocket closed')
            value += chunk
        return value

    def call(self, method, params=None):
        self.serial += 1
        payload = json.dumps({'id': self.serial, 'method': method, 'params': params or {}}).encode()
        mask = os.urandom(4)
        size = len(payload)
        header = bytes([129, 128 | size]) if size < 126 else bytes([129, 254]) + struct.pack('!H', size)
        self.socket.sendall(header + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(payload)))
        while True:
            opcode, size = self.read(2)
            size &= 127
            if size == 126:
                size = struct.unpack('!H', self.read(2))[0]
            elif size == 127:
                size = struct.unpack('!Q', self.read(8))[0]
            assert opcode & 15 == 1, 'Expected CDP text frame'
            result = json.loads(self.read(size))
            if result.get('id') == self.serial:
                assert 'error' not in result, result
                return result.get('result', {})
            self.events.append(result)

    def evaluate(self, expression):
        return self.call('Runtime.evaluate', {'expression': expression, 'returnByValue': True})['result'].get('value')


def headless(temp):
    state = temp / 'state.jsonl'
    server = chrome = None
    try:
        with (temp / 'server.log').open('w') as log:
            server = sp.Popen([sys.executable, str(HERE / 'server.py'), '--state', str(state)],
                              stdout=sp.PIPE, stderr=log, text=True)
        port = json.loads(server.stdout.readline())['port']
        base = f'http://127.0.0.1:{port}'
        for path, expected in [('/', '200'), ('/favicon.ico', '204')]:
            status = driver.command(['/usr/bin/curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', base + path])
            assert status == expected
            print('CURL', path, status)
        with (temp / 'chrome.log').open('w') as log:
            chrome = sp.Popen([driver.CHROME, '--headless=new', '--remote-debugging-port=0',
                '--user-data-dir=' + str(temp / 'profile'), '--no-first-run', '--no-default-browser-check',
                '--window-size=1800,1130', base], stdout=log, stderr=log)
        active = temp / 'profile/DevToolsActivePort'
        driver.until(active.exists, 20, 'headless debug port')
        debug = int(active.read_text().splitlines()[0])
        with urllib.request.urlopen(f'http://127.0.0.1:{debug}/json', timeout=10) as response:
            tabs = [t for t in json.load(response) if t.get('type') == 'page']
        client = CDP(tabs[0]['webSocketDebuggerUrl'])
        client.call('Runtime.enable')
        driver.until(lambda: any(r['path'] == '/api/layout' for r in driver.json_lines(state)), 20, 'headless layout')
        assert client.evaluate('document.title') == 'markupR test page (automated)'
        layouts_before = len([r for r in driver.json_lines(state) if r['path'] == '/api/layout'])
        client.call('Emulation.setDeviceMetricsOverride', {'width': 1700, 'height': 1000,
                    'deviceScaleFactor': 1, 'mobile': False})
        driver.until(lambda: len([r for r in driver.json_lines(state) if r['path'] == '/api/layout']) > layouts_before,
                     10, 'resize layout report')
        for index, name in enumerate(['add', 'save', 'save']):
            box = client.evaluate(f"document.getElementById('{name}').getBoundingClientRect().toJSON()")
            point = {'x': box['x'] + box['width'] / 2, 'y': box['y'] + box['height'] / 2,
                     'button': 'left', 'clickCount': 1}
            client.call('Input.dispatchMouseEvent', dict(point, type='mousePressed'))
            client.call('Input.dispatchMouseEvent', dict(point, type='mouseReleased'))
            time.sleep(.2)
            expected = 'rgb(32, 80, 224)' if index % 2 == 0 else 'rgb(255, 240, 192)'
            assert client.evaluate('getComputedStyle(document.documentElement).backgroundColor') == expected
        rows = driver.json_lines(state)
        flips = [r for r in rows if r['path'] == '/api/flip']
        saves = [r for r in rows if r['path'] == '/api/save']
        exceptions = [e for e in client.events if e.get('method') == 'Runtime.exceptionThrown']
        errors = [e for e in client.events if e.get('method') == 'Runtime.consoleAPICalled' and e['params']['type'] == 'error']
        assert 'TypeError' in json.dumps(exceptions) and 'total' in json.dumps(exceptions)
        assert len(errors) == 2 and all('Save failed: 500' in json.dumps(e) for e in errors)
        assert [r['data']['target'] for r in flips] == ['add', 'save', 'save']
        assert [r['data']['flipped'] for r in flips] == [True, False, True]
        assert len(saves) == 2 and all(r['status'] == 500 for r in saves)
        for row in flips + saves:
            print('STATE', json.dumps(row))
        print('TYPEERROR', exceptions[0]['params']['exceptionDetails']['exception']['description'].splitlines()[0])
        print('PASS headless: 2 console errors; 2 Save POST 500; 3 mousedown reports')
        print('SERVER REQUESTS\n' + (temp / 'server.log').read_text())
        client.socket.close()
    finally:
        driver.stop_owned(chrome)
        driver.stop_owned(server)


def render_frame(pack, number, ring_point, color):
    width, height = 400, 200
    raw = bytearray(bytes(color) * (width * height))
    # Display [-100,-50,800,400], video 1600x800, JPEG 400x200.
    # The checker must undo both Retina capture and JPEG downscaling.
    if ring_point is not None:
        cx, cy = (ring_point[0] + 100) / 2, (ring_point[1] + 50) / 2
        for y in range(height):
            for x in range(width):
                if abs(((x - cx) ** 2 + (y - cy) ** 2) ** .5 - 14) <= 1.5:
                    offset = (y * width + x) * 3
                    raw[offset:offset + 3] = bytes([255, 20, 120])
    path = pack / f'frames/item-{number:02}.jpg'
    sp.run([driver.FFMPEG, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
            '-video_size', f'{width}x{height}', '-i', '-', '-frames:v', '1', '-q:v', '2', str(path)],
           input=raw, check=True, timeout=30)
    for suffix in ('-zoom', '-click'):
        (pack / f'frames/item-{number:02}{suffix}.jpg').write_bytes(path.read_bytes())


def popup_fixture(pack, results, wrong_clipboard=False):
    stub = pack / 'stub.py'
    stub.write_text("""import sys
print('popup: frame=80,100,400,200 copy=100,200,130,32 finder=240,200,140,32', file=sys.stderr, flush=True)
sys.stdin.readline()
print('popup: closed reason=copy', file=sys.stderr, flush=True)
print(sys.argv[1], flush=True)
""")
    stdout, log = pack / 'stub.stdout', pack / 'stub.stderr'
    original = {'text': 'prior clipboard\n\n', 'image': 'AAH/gA=='}
    clipboard = [dict(original)]
    writes, clicks, budgets = [], [], []
    with stdout.open('w') as out, log.open('w') as err:
        process = sp.Popen([sys.executable, str(stub), str(pack)], stdin=sp.PIPE,
                           stdout=out, stderr=err, text=True)
    try:
        driver.until(lambda: 'popup: frame=' in log.read_text(), 3, 'fixture popup')
        def fake_click(point):
            clicks.append(point)
            clipboard[0] = {'text': (pack / 'PROMPT.md').read_text() + ('different' if wrong_clipboard else '')}
            process.stdin.write('copy\n')
            process.stdin.flush()
        def fake_save(path):
            path.write_text(json.dumps(clipboard[0]))
        def fake_restore(path):
            clipboard[0] = json.loads(path.read_text())
            writes.append(dict(clipboard[0]))
        def fake_stop(argv, timeout):
            assert argv == ['stub-markupr', 'stop']
            budgets.append(timeout)
            assert not stdout.read_text(), "Recorder must not print its final path before the panel closes"
            return str(pack)
        actual = driver.finish_recording('stub-markupr', process, stdout, log, results,
                    popup=True, stop_command=fake_stop, click_fn=fake_click,
                    read_clipboard=lambda: clipboard[0]['text'], save_clipboard=fake_save, restore_clipboard=fake_restore)
        assert actual == pack.resolve()
        assert budgets == [180], budgets
        assert clicks == [(165, 216)], clicks
        assert clipboard[0] == original and writes == [original]
        assert process.returncode == 0
    finally:
        driver.stop_owned(process)
        process.stdin.close()


def fixtures(temp):
    import shutil
    pack = temp / 'fixture-pack'
    pack.mkdir()
    (pack / 'frames').mkdir()
    (pack / 'logs').mkdir()
    rectangles = {'add': {'x': 0, 'y': 100, 'w': 120, 'h': 60},
                  'save': {'x': 450, 'y': 100, 'w': 120, 'h': 60}}
    session = {'status': 'ready', 'timing': {'stop_to_ready_ms': 123},
               'clock': {'t0_unix_ms': 100000},
               'display': {'x': -100, 'y': -50, 'w': 800, 'h': 400},
               'video': {'width': 1600, 'height': 800, 'start_t': 0}}
    (pack / 'session.json').write_text(json.dumps(session))
    items, events, state = [], [], []
    for number, (name, phrase, error) in enumerate([('add', 'add to cart', 'TypeError: reading total of undefined'),
                                                   ('save', 'save', 'Save failed: 500')], 1):
        frame = f'frames/item-{number:02}.jpg'
        items.append({'said': phrase, 'anchor_t': number + .5,
                      'frames': [{'file': frame, 'zoom': f'frames/item-{number:02}-zoom.jpg'},
                                 {'file': f'frames/item-{number:02}-click.jpg'}], 'logs': [{'text': error}]})
        x, y = driver.center(rectangles[name])
        events += [{'type': 'mouse_down', 't': number, 'x': x, 'y': y},
                   {'type': 'mark', 't': number + .5, 'x': x, 'y': y}]
        state.append({'path': '/api/flip', 'data': {'target': name, 'flipped': number == 1,
                                                   'unix_ms': 100000 + number * 1000}})
        render_frame(pack, number, (x, y), (32, 80, 224) if number == 1 else (255, 240, 192))
    browser = [{'type': 'dom_click', 't': 1.02, 'selector': 'button#add', 'text': 'Add to cart'},
               {'type': 'exception', 't': 1.04, 'text': 'TypeError: reading total of undefined'},
               {'type': 'dom_click', 't': 2.02, 'selector': 'button#save', 'text': 'Save'},
               {'type': 'console', 't': 2.05, 'text': 'Save failed: 500'},
               {'type': 'network', 't': 2.8, 'start_t': 2.03, 'url': 'http://127.0.0.1/api/save', 'status': 500}]
    (pack / 'moments.json').write_text(json.dumps({'items': items}))
    (pack / 'events.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in events))
    (pack / 'logs/browser.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in browser))
    (pack / 'SUMMARY.md').write_text('## Item 1\n- Said: add to cart\n## Item 2\n- Said: save\n')
    (pack / 'PROMPT.md').write_text('Read SUMMARY.md first.\n\n')
    def check(folder, wrong_clipboard=False):
        results = driver.Results()
        driver.walkthrough_checks(folder, driver.json_file(folder / 'session.json'), rectangles, results,
                                  state, (-40, 300))
        popup_fixture(folder, results, wrong_clipboard)
        return results
    passing = check(pack)
    print('PASSING REAL-JPEG AND POPUP-STUB FIXTURE:')
    passing.show()
    assert all(row['status'] == 'PASS' for row in passing.rows)
    print('PASS stop budget=180 s; stdout pack path used; injected click=(165, 216); clipboard restored exactly')
    cases = [('edge ring', 'item 1 ring'), ('wrong ring', 'item 1 ring'), ('zero ring', 'item 1 ring'),
             ('pre-click picture', 'item 1 picture state'), ('late browser', 'item 1 browser timing'),
             ('late network', 'item 2 browser timing'),
             ('slow pack', 'stop_to_ready_ms'), ('different clipboard', 'clipboard equals PROMPT.md')]
    for slug, expected in cases:
        broken = temp / slug.replace(' ', '-')
        shutil.copytree(pack, broken)
        if slug == 'edge ring':
            rect = rectangles['add']
            render_frame(broken, 1, (rect['x'] - 10, driver.center(rect)[1]), (32, 80, 224))
        elif slug == 'wrong ring':
            render_frame(broken, 1, driver.center(rectangles['save']), (32, 80, 224))
        elif slug == 'zero ring':
            render_frame(broken, 1, None, (32, 80, 224))
        elif slug == 'pre-click picture':
            render_frame(broken, 1, driver.center(rectangles['add']), (255, 240, 192))
        elif slug == 'late browser':
            late = [dict(line) for line in browser]
            late[1]['t'] = 1.3
            (broken / 'logs/browser.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in late))
        elif slug == 'late network':
            late = [dict(line) for line in browser]
            late[-1]['start_t'] = 2.3
            (broken / 'logs/browser.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in late))
        elif slug == 'slow pack':
            slow = dict(session, timing={'stop_to_ready_ms': 25000})
            (broken / 'session.json').write_text(json.dumps(slow))
        results = check(broken, wrong_clipboard=slug == 'different clipboard')
        failed = [r for r in results.rows if r['status'] == 'FAIL']
        assert [r['check'] for r in failed] == [expected], (slug, failed)
        print(f"SINGLE FAILURE ({slug}): {failed[0]['status']} | {expected} | {failed[0]['detail']}")
    empty = temp / 'missing-pack'
    empty.mkdir()
    missing = driver.Results()
    driver.walkthrough_checks(empty, {}, rectangles, missing)
    assert all(r['status'] == 'FAIL' for r in missing.rows)
    layout = {'screenX': -1800, 'screenY': 39, 'outerWidth': 1800, 'innerWidth': 1800,
              'outerHeight': 1130, 'innerHeight': 1043, 'buttons': {'add': {'x': 125, 'y': 475.71875, 'width': 196.9375, 'height': 77}}}
    assert driver.button_rect(layout, 'add') == {'x': -1675.0, 'y': 601.71875, 'w': 196.9375, 'h': 77}
    assert driver.coords(-1675, -100) == '=-1675,=-100'
    print('PASS missing-input and negative-display coordinate fixtures')



def clock_fixture(temp):
    pack = temp / 'clock-fixture'
    pack.mkdir()
    clicks = [1.99, 3.49, 4.99, 6.49, 7.99]
    frames = []
    for frame in range(300):
        count = sum(frame / 30 >= click for click in clicks)
        color = bytes([32, 80, 224] if count % 2 else [255, 240, 192])
        frames.append(color * (160 * 120))
    sp.run([driver.FFMPEG, '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
            '-video_size', '160x120', '-framerate', '30', '-i', '-', '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p', str(pack / 'video.mp4')], input=b''.join(frames), check=True, timeout=30)
    events = [{'type': 'mouse_down', 't': t, 'x': 20, 'y': 60} for t in clicks]
    (pack / 'events.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in events))
    state = [{'path': '/api/flip', 'data': {'unix_ms': 100000 + t * 1000}} for t in clicks]
    session = {'clock': {'t0_unix_ms': 100000},
               'video': {'start_t': 0, 'width': 160, 'height': 120},
               'display': {'x': 0, 'y': 0, 'w': 160, 'h': 120}}
    results = driver.Results()
    driver.clock_checks(pack, session, state, (20, 60), results)
    print('SYNTHETIC VIDEO CLOCK FIXTURE (not a live clock measurement):')
    results.show()
    assert all(r['status'] == 'PASS' for r in results.rows)
    sparse = temp / 'sparse-clock-fixture'
    sparse.mkdir()
    # Keep only the initial frame and actual flips; preserve their original PTS.
    select = '+'.join(f'eq(n\\,{n})' for n in (0, 60, 105, 150, 195, 240))
    sp.run([driver.FFMPEG, '-v', 'error', '-i', str(pack / 'video.mp4'), '-vf', 'select=' + select,
            '-fps_mode', 'vfr', '-c:v', 'libx264', str(sparse / 'video.mp4')], check=True, timeout=30)
    probe = json.loads(driver.command([driver.FFPROBE, '-v', 'error', '-show_frames',
                       '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time',
                       '-of', 'json', sparse / 'video.mp4']))
    assert len(probe['frames']) == 6, probe
    (sparse / 'events.jsonl').write_text((pack / 'events.jsonl').read_text())
    sparse_results = driver.Results()
    driver.clock_checks(sparse, session, state, (20, 60), sparse_results)
    print('SPARSE VIDEO FIXTURE (6 frames: start plus 5 flips):')
    sparse_results.show()
    assert all(r['status'] == 'PASS' for r in sparse_results.rows)
    early_events = [dict(e) for e in events]
    early_events[0]['t'] += .1
    early_state = json.loads(json.dumps(state))
    early_state[0]['data']['unix_ms'] += 100
    (sparse / 'events.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in early_events))
    sparse_early = driver.Results()
    driver.clock_checks(sparse, session, early_state, (20, 60), sparse_early)
    failed = [r for r in sparse_early.rows if r['status'] == 'FAIL']
    assert [r['check'] for r in failed] == ['click 1 video flip'], failed
    print(f"SINGLE FAILURE (sparse flip 90 ms early): FAIL | {failed[0]['check']} | {failed[0]['detail']}")
    # Exactly one page-clock row fails; video timing and all other clicks pass.
    shifted = json.loads(json.dumps(state))
    shifted[0]['data']['unix_ms'] += 51
    page_bad = driver.Results()
    driver.clock_checks(pack, session, shifted, (20, 60), page_bad)
    failed = [r for r in page_bad.rows if r['status'] == 'FAIL']
    assert [r['check'] for r in failed] == ['click 1 page clock'], failed
    print(f"SINGLE FAILURE (page clock): FAIL | {failed[0]['check']} | {failed[0]['detail']}")
    for event in events:
        event['t'] += .1
    (pack / 'events.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in events))
    early = driver.Results()
    driver.clock_checks(pack, session, state, (20, 60), early)
    assert all(r['status'] == 'FAIL' for r in early.rows if r['check'].endswith('video flip'))
    print('PASS clock checker rejects a flip 90 ms before its click')


def private_pasteboard_fixture(temp, helper):
    import hashlib
    import uuid
    name = 'org.markupr.first-article.' + str(uuid.uuid4())
    source = temp / 'pasteboard-fixture.swift'
    source.write_text('''import AppKit
let board = NSPasteboard(name: NSPasteboard.Name(CommandLine.arguments[1]))
switch CommandLine.arguments[2] {
case "seed":
    board.clearContents()
    let text = NSPasteboardItem()
    text.setString("first text\\n", forType: .string)
    let mixed = NSPasteboardItem()
    let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXxQAAAAASUVORK5CYII=")!
    mixed.setData(png, forType: .png)
    mixed.setString("second text 🐦\\n", forType: .string)
    precondition(board.writeObjects([text, mixed]))
case "overwrite":
    board.clearContents()
    precondition(board.setString("replacement", forType: .string))
case "snapshot":
    let items = (board.pasteboardItems ?? []).map { item in
        item.types.map { type in ["type": type.rawValue, "data": item.data(forType: type)!.base64EncodedString()] }
    }
    print(String(data: try JSONSerialization.data(withJSONObject: items, options: [.sortedKeys]), encoding: .utf8)!)
case "release": board.releaseGlobally()
default: exit(2)
}
''')
    fixture = temp / 'pasteboard-fixture'
    driver.command(['/usr/bin/swiftc', source, '-o', fixture])
    saved = temp / 'private-pasteboard.json'
    try:
        driver.command([fixture, name, 'seed'])
        before = json.loads(driver.command([fixture, name, 'snapshot']))
        assert [len(item) for item in before] == [1, 2], before
        driver.command([helper, 'clipboard-save', saved, name])
        driver.command([fixture, name, 'overwrite'])
        assert json.loads(driver.command([fixture, name, 'snapshot'])) != before
        driver.command([helper, 'clipboard-restore', saved, name])
        after = json.loads(driver.command([fixture, name, 'snapshot']))
        assert after == before, (before, after)
        for index, item in enumerate(after, 1):
            for representation in item:
                data = base64.b64decode(representation['data'])
                print(f"PASS private pasteboard item={index} type={representation['type']} bytes={len(data)} "
                      f"sha256={hashlib.sha256(data).hexdigest()[:16]} identical")
        print('PASS private pasteboard: save -> overwrite -> restore; 2 items, 3 types, all bytes identical; general untouched')
    finally:
        driver.command([fixture, name, 'release'])


def main():
    with tempfile.TemporaryDirectory(prefix='markupr-l7-offscreen-') as temp:
        temp = Path(temp)
        headless(temp)
        fixtures(temp)
        clock_fixture(temp)
        helper = temp / 'mac'
        driver.command(['/usr/bin/swiftc', HERE / 'mac.swift', '-o', helper])
        private_pasteboard_fixture(temp, helper)
        print('MIC:', driver.command([helper, 'mic']))
        print('SCREENS:', driver.command([helper, 'screens']))
    print('PASS display-free checks; no recorder, speech or desktop input started')


if __name__ == '__main__':
    main()
