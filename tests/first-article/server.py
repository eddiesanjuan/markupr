#!/usr/bin/env python3
"""Loopback-only demo server. State is append-only JSONL outside the repository."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import time


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body=b'', content_type='text/plain'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/favicon.ico':
            self.reply(204)
        elif self.path in ('/', '/index.html'):
            self.reply(200, (Path(__file__).parent / 'page/index.html').read_bytes(), 'text/html; charset=utf-8')
        else:
            self.reply(404)

    def do_POST(self):
        if self.path not in ('/api/layout', '/api/flip', '/api/save'):
            self.reply(404)
            return
        value = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        status = 500 if self.path == '/api/save' else 200
        record = {'path': self.path, 'status': status, 'received_unix_ms': time.time_ns() // 1_000_000,
                  'data': value}
        with self.server.state.open('a') as stream:
            stream.write(json.dumps(record) + '\n')
        self.reply(status, b'Save failed: 500' if status == 500 else b'OK')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', required=True, type=Path)
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    with HTTPServer(('127.0.0.1', args.port), Handler) as server:
        server.state = args.state
        print(json.dumps({'port': server.server_port, 'pid': __import__('os').getpid()}), flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
