#!/usr/bin/env python3
"""Loopback-only HTTP server for the LeechBlock reason gate."""

from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


PROJECT_ROOT = Path(__file__).resolve().parent.parent
CANONICAL_PATH = "/lb-custom/reason-gate.html"
LEGACY_PATH = "/lb-custom/reason-gate-v2.html"


class ReasonGateHandler(SimpleHTTPRequestHandler):
    server_version = "ReasonGate/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PROJECT_ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)

        if parsed.path == "/healthz":
            body = b"ok\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path == LEGACY_PATH:
            destination = CANONICAL_PATH
            if parsed.query:
                destination += "?" + parsed.query
            self.send_response(302)
            self.send_header("Location", destination)
            self.end_headers()
            return

        if parsed.path != CANONICAL_PATH:
            self.send_error(404)
            return

        super().do_GET()

    def log_message(self, format: str, *args) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")

    server = ThreadingHTTPServer(("127.0.0.1", args.port), ReasonGateHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
