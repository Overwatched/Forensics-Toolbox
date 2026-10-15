#!/usr/bin/env python3
# Lokal server för HTML-mappen. Kartfilerna (.pmtiles) läses i bitar, så
# servern måste svara på HTTP Range. Pythons vanliga http.server gör inte det.

import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class LimitedFile:
    def __init__(self, handle, length):
        self.handle = handle
        self.left = length

    def read(self, amt=None):
        if self.left <= 0:
            return b''
        if amt is None or amt > self.left:
            amt = self.left
        data = self.handle.read(amt)
        self.left -= len(data)
        return data

    def close(self):
        self.handle.close()


class RangeHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return SimpleHTTPRequestHandler.send_head(self)
        try:
            handle = open(path, 'rb')
        except OSError:
            self.send_error(404)
            return None
        size = os.fstat(handle.fileno()).st_size
        ctype = self.guess_type(path)
        spec = self.headers.get('Range')
        if not spec:
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(size))
            self.send_header('Accept-Ranges', 'bytes')
            self.end_headers()
            return handle
        if not spec.startswith('bytes='):
            handle.close()
            self.send_range_error(size)
            return None
        part = spec[6:].split(',')[0].strip()
        if '-' not in part:
            handle.close()
            self.send_range_error(size)
            return None
        start_s, end_s = part.split('-', 1)
        try:
            if start_s == '':
                length = int(end_s)
                start = max(0, size - length)
                end = size - 1
            else:
                start = int(start_s)
                end = int(end_s) if end_s else size - 1
        except ValueError:
            handle.close()
            self.send_range_error(size)
            return None
        if start >= size or start > end:
            handle.close()
            self.send_range_error(size)
            return None
        end = min(end, size - 1)
        length = end - start + 1
        self.send_response(206)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.send_header('Content-Length', str(length))
        self.send_header('Accept-Ranges', 'bytes')
        self.end_headers()
        handle.seek(start)
        return LimitedFile(handle, length)

    def send_range_error(self, size):
        self.send_response(416)
        self.send_header('Content-Range', 'bytes */%d' % size)
        self.end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = ThreadingHTTPServer(('127.0.0.1', port), RangeHandler)
    print('serve-html: http://127.0.0.1:%d/' % port)
    server.serve_forever()


if __name__ == '__main__':
    main()
