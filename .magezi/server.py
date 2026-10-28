#!/usr/bin/env python3
"""magezi server — serves the .magezi directory and persists annotations.json.

Run it from anywhere; it serves the directory the script lives in. It takes the
first free port from 8900 and writes it to .port. If a magezi server is already
listening on one of its ports it prints that URL and exits, so running it twice
is safe.

Set MAGEZI_PORT to pin a specific port when the default range is unsuitable.
"""

import json
import os
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import URLError
from urllib.request import urlopen

ROOT = os.path.dirname(os.path.abspath(__file__))
ANNOTATIONS = os.path.join(ROOT, "annotations.json")
PORTFILE = os.path.join(ROOT, ".port")
# Deliberately clear of the common dev-server defaults — 3000, 5173, 8000, 8080,
# and 8787 (wrangler) — so a view does not collide with the app it describes.
FIRST_PORT = int(os.environ.get("MAGEZI_PORT") or 8900)
LAST_PORT = FIRST_PORT + 30

_lock = threading.Lock()


def read_annotations():
    with _lock:
        if not os.path.exists(ANNOTATIONS):
            return []
        try:
            with open(ANNOTATIONS, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (json.JSONDecodeError, OSError):
            return []
    return data if isinstance(data, list) else []


def write_annotations(rows):
    """Write via a temp file so a crash mid-write cannot truncate the record."""
    with _lock:
        tmp = ANNOTATIONS + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        os.replace(tmp, ANNOTATIONS)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def guess_type(self, path):
        """Views are UTF-8. Without an explicit charset the browser falls back to
        Latin-1 and every non-ASCII character a comment quotes comes back mojibaked."""
        ctype = super().guess_type(path)
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            if "charset=" not in ctype:
                ctype += "; charset=utf-8"
        return ctype

    def send_json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # Views are edited constantly; a cached copy is always the wrong one.
        if not self.path.startswith("/__magezi"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/__magezi/ping"):
            return self.send_json(200, {"magezi": True})
        if self.path.startswith("/__magezi/annotations"):
            return self.send_json(200, read_annotations())
        if self.path.startswith("/__magezi"):
            return self.send_json(404, {"error": "unknown endpoint"})
        return super().do_GET()

    def do_POST(self):
        if not self.path.startswith("/__magezi/annotations"):
            return self.send_json(404, {"error": "unknown endpoint"})
        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"[]")
        except json.JSONDecodeError:
            return self.send_json(400, {"error": "invalid json"})
        if not isinstance(payload, list):
            return self.send_json(400, {"error": "expected a list of annotations"})
        write_annotations(payload)
        return self.send_json(200, {"ok": True, "count": len(payload)})


def already_running():
    """Return the URL of a live magezi server in our port range, or None."""
    for port in range(FIRST_PORT, LAST_PORT + 1):
        try:
            with urlopen(f"http://127.0.0.1:{port}/__magezi/ping", timeout=0.4) as res:
                if json.loads(res.read()).get("magezi"):
                    return f"http://127.0.0.1:{port}/"
        except (URLError, OSError, json.JSONDecodeError, ValueError):
            continue
    return None


def bind():
    for port in range(FIRST_PORT, LAST_PORT + 1):
        try:
            return ThreadingHTTPServer(("127.0.0.1", port), Handler), port
        except OSError:
            continue
    raise SystemExit(f"no free port between {FIRST_PORT} and {LAST_PORT}")


def main():
    existing = already_running()
    if existing:
        print(existing)
        return

    httpd, port = bind()
    with open(PORTFILE, "w", encoding="utf-8") as fh:
        fh.write(str(port))
    print(f"http://127.0.0.1:{port}/")
    sys.stdout.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        try:
            os.remove(PORTFILE)
        except OSError:
            pass


if __name__ == "__main__":
    main()
