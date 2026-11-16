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


def fixtures(temp):
    pack = temp / 'fixture-pack'
    pack.mkdir()
    rectangles = {'add': {'x': 100, 'y': 200, 'w': 200, 'h': 80},
                  'save': {'x': 600, 'y': 200, 'w': 150, 'h': 80}}
    session = {'status': 'ready', 'timing': {'stop_to_ready_ms': 123}}
    (pack / 'session.json').write_text(json.dumps(session))
    (pack / 'frames').mkdir()
    items = []
    for number, (phrase, error) in enumerate([('add to cart', 'TypeError: reading total of undefined'), ('save', 'Save failed: 500')], 1):
        frame = f'frames/item-{number:02}.jpg'
        zoom = f'frames/item-{number:02}-zoom.jpg'
        # Existence-only frame contract: these are named placeholders, not images.
        (pack / frame).touch()
        (pack / zoom).touch()
        items.append({'said': phrase, 'anchor_t': number, 'frames': [{'file': frame, 'zoom': zoom}], 'logs': [{'text': error}]})
    (pack / 'moments.json').write_text(json.dumps({'items': items}))
    (pack / 'cursor.jsonl').write_text('\n'.join(json.dumps({'t': i, 'x': x, 'y': 240}) for i, x in [(1, 200), (2, 675)]))
    for name in ['SUMMARY.md', 'PROMPT.md']:
        (pack / name).touch()
    results = driver.Results()
    driver.walkthrough_checks(pack, session, rectangles, results)
    results.show()
    assert all(r['status'] == 'PASS' for r in results.rows)
    # The checker must reject a concrete failure, even when every file exists.
    items[1]['logs'] = [{'text': 'unrelated message', 'line': 500, 't': 500}]
    (pack / 'moments.json').write_text(json.dumps({'items': items}))
    broken = driver.Results()
    driver.walkthrough_checks(pack, session, rectangles, broken)
    assert any(r['check'] == 'item 2 logs' and r['status'] == 'FAIL' for r in broken.rows)
    print('PASS fixture rejects missing Save 500 evidence')
    empty = temp / 'missing-pack'
    empty.mkdir()
    missing = driver.Results()
    driver.walkthrough_checks(empty, {}, rectangles, missing)
    print('MISSING-INPUT FIXTURE (not a real recorder pack):')
    missing.show()
    assert all(r['status'] == 'FAIL' for r in missing.rows)
    # Main display top-left conversion, including negative monitor coordinates.
    layout = {'screenX': -1800, 'screenY': 39, 'outerWidth': 1800, 'innerWidth': 1800,
              'outerHeight': 1130, 'innerHeight': 1043, 'buttons': {'add': {'x': 125, 'y': 475.71875, 'width': 196.9375, 'height': 77}}}
    assert driver.button_rect(layout, 'add') == {'x': -1675.0, 'y': 601.71875, 'w': 196.9375, 'h': 77}
    assert driver.coords(-1675, -100) == '=-1675,=-100'
    print('PASS coordinate fixture: negative display origin and absolute cliclick coordinates')



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
    for event in events:
        event['t'] += .1
    (pack / 'events.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in events))
    early = driver.Results()
    driver.clock_checks(pack, session, state, (20, 60), early)
    assert all(r['status'] == 'FAIL' for r in early.rows if r['check'].endswith('video flip'))
    print('PASS clock checker rejects a flip 90 ms before its click')


def main():
    with tempfile.TemporaryDirectory(prefix='markupr-l7-offscreen-') as temp:
        temp = Path(temp)
        headless(temp)
        fixtures(temp)
        clock_fixture(temp)
        helper = temp / 'mac'
        driver.command(['/usr/bin/swiftc', HERE / 'mac.swift', '-o', helper])
        print('MIC:', driver.command([helper, 'mic']))
        print('SCREENS:', driver.command([helper, 'screens']))
    print('PASS display-free checks; no recorder, speech or desktop input started')


if __name__ == '__main__':
    main()
