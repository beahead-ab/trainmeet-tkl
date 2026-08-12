#!/usr/bin/env python3
"""Local appliance layer for a TrainMeet TKL Raspberry Pi terminal."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import tempfile
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


DEFAULT_CONFIG = {
    "configured": False,
    "terminal_name": "",
    "server_url": "http://trainmeet.local:8787",
    "station_id": "",
    "station_name": "",
    "orientation": "portrait",
}


class TerminalApplication:
    def __init__(self, web_root: Path, state_dir: Path) -> None:
        self.web_root = web_root.resolve()
        self.state_dir = state_dir.resolve()
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.config_path = self.state_dir / "terminal-config.json"
        self.cache_path = self.state_dir / "last-runtime.json"

    def read_config(self) -> dict:
        try:
            loaded = json.loads(self.config_path.read_text(encoding="utf-8"))
            return {**DEFAULT_CONFIG, **loaded, "configured": bool(loaded.get("station_id") and loaded.get("server_url"))}
        except (OSError, json.JSONDecodeError, TypeError):
            return dict(DEFAULT_CONFIG)

    def save_config(self, payload: dict) -> dict:
        server_url = normalize_server_url(str(payload.get("server_url") or ""))
        station_id = str(payload.get("station_id") or "").strip()
        terminal_name = str(payload.get("terminal_name") or "").strip()
        orientation = str(payload.get("orientation") or "portrait")
        if not server_url or not station_id or not terminal_name:
            raise ValueError("Server, station och terminalnamn måste anges")
        if orientation not in {"portrait", "landscape"}:
            raise ValueError("Okänd skärmorientering")
        config = {
            "configured": True,
            "terminal_name": terminal_name,
            "server_url": server_url,
            "station_id": station_id,
            "station_name": str(payload.get("station_name") or "").strip(),
            "orientation": orientation,
        }
        atomic_json_write(self.config_path, config)
        return config

    def fetch_runtime(self, server_url: str | None = None) -> dict:
        base = normalize_server_url(server_url or str(self.read_config().get("server_url") or ""))
        if not base:
            raise ValueError("Terminalen saknar TrainMeet Server")
        request = Request(f"{base}/v1/display", headers={"Accept": "application/json", "User-Agent": "TrainMeet-TKL-Terminal/0.2"})
        with urlopen(request, timeout=4) as response:
            snapshot = json.loads(response.read().decode("utf-8"))
        if not isinstance(snapshot, dict) or not isinstance(snapshot.get("stations"), list):
            raise ValueError("Servern returnerade ingen giltig träff")
        cached_at = datetime.now(timezone.utc).isoformat()
        atomic_json_write(self.cache_path, {"snapshot": snapshot, "cached_at": cached_at})
        return snapshot

    def runtime_result(self) -> dict:
        try:
            snapshot = self.fetch_runtime()
            return {"snapshot": snapshot, "source": "server", "connected": True}
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
            try:
                cached = json.loads(self.cache_path.read_text(encoding="utf-8"))
                return {
                    "snapshot": cached["snapshot"],
                    "source": "cache",
                    "connected": False,
                    "cachedAt": cached.get("cached_at"),
                }
            except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
                raise RuntimeError("TrainMeet Server kan inte nås och inget tidigare driftläge finns") from error


def normalize_server_url(value: str) -> str:
    value = value.strip().rstrip("/")
    if value and "://" not in value:
        value = f"http://{value}"
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return ""
    return value


def atomic_json_write(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


class Handler(BaseHTTPRequestHandler):
    server_version = "TrainMeetTKL/0.2"

    @property
    def application(self) -> TerminalApplication:
        return self.server.application  # type: ignore[attr-defined]

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/terminal/config":
            self.send_json(HTTPStatus.OK, self.application.read_config())
            return
        if path == "/terminal/runtime":
            try:
                self.send_json(HTTPStatus.OK, self.application.runtime_result())
            except RuntimeError as error:
                self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"message": str(error)})
            return
        self.serve_static(path)

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/terminal/connect":
            self.send_json(HTTPStatus.NOT_FOUND, {"message": "Sidan finns inte"})
            return
        try:
            payload = self.read_json()
            snapshot = self.application.fetch_runtime(str(payload.get("server_url") or ""))
            self.send_json(HTTPStatus.OK, snapshot)
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as error:
            self.send_json(HTTPStatus.BAD_GATEWAY, {"message": f"TrainMeet Server kunde inte nås: {error}"})

    def do_PUT(self) -> None:
        if urlparse(self.path).path != "/terminal/config":
            self.send_json(HTTPStatus.NOT_FOUND, {"message": "Sidan finns inte"})
            return
        try:
            config = self.application.save_config(self.read_json())
            self.send_json(HTTPStatus.OK, config)
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 65536:
            raise ValueError("För stor begäran")
        value = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(value, dict):
            raise ValueError("Ogiltig begäran")
        return value

    def send_json(self, status: HTTPStatus, value: dict) -> None:
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def serve_static(self, request_path: str) -> None:
        relative = request_path.lstrip("/") or "index.html"
        candidate = (self.application.web_root / relative).resolve()
        if self.application.web_root not in candidate.parents and candidate != self.application.web_root:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not candidate.is_file():
            candidate = self.application.web_root / "index.html"
        try:
            body = candidate.read_bytes()
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8" if content_type.startswith("text/") else content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache" if candidate.name == "index.html" else "public, max-age=31536000, immutable")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--web-root", type=Path, default=Path("dist"))
    parser.add_argument("--state-dir", type=Path, default=Path("/var/lib/trainmeet-tkl"))
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.bind, args.port), Handler)
    server.application = TerminalApplication(args.web_root, args.state_dir)  # type: ignore[attr-defined]
    server.serve_forever()


if __name__ == "__main__":
    main()
