#!/usr/bin/env python3
"""Local appliance layer for a TrainMeet TKL Raspberry Pi terminal."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import subprocess
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

    def discover_servers(self) -> list[dict[str, str]]:
        found: dict[str, dict[str, str]] = {}
        try:
            result = subprocess.run(
                ["avahi-browse", "-rtp", "_tambox._tcp"],
                check=False,
                capture_output=True,
                text=True,
                timeout=6,
            )
            for line in result.stdout.splitlines():
                if not line.startswith("="):
                    continue
                fields = line.split(";")
                if len(fields) < 9:
                    continue
                name, hostname, address = fields[3], fields[6], fields[7]
                host = hostname or address
                if not host:
                    continue
                url = f"http://{host.rstrip('.')}:8787"
                found[url] = {"name": name or hostname, "url": url, "address": address}
        except (OSError, subprocess.SubprocessError):
            pass
        return list(found.values())

    def wifi_networks(self) -> list[dict[str, object]]:
        try:
            result = subprocess.run(
                ["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", "yes"],
                check=True,
                capture_output=True,
                text=True,
                timeout=15,
            )
        except (OSError, subprocess.SubprocessError):
            return []
        found: dict[str, dict[str, object]] = {}
        for line in result.stdout.splitlines():
            fields = split_nmcli_fields(line)
            if len(fields) < 4 or not fields[1]:
                continue
            ssid = fields[1]
            network = {
                "ssid": ssid,
                "connected": fields[0] == "*",
                "signal": int(fields[2]) if fields[2].isdigit() else 0,
                "secured": bool(fields[3] and fields[3] != "--"),
                "security": fields[3],
            }
            previous = found.get(ssid)
            if previous is None or int(network["signal"]) > int(previous["signal"]):
                found[ssid] = network
        return sorted(found.values(), key=lambda item: (not bool(item["connected"]), -int(item["signal"]), str(item["ssid"])))

    @staticmethod
    def connect_wifi(ssid: str, password: str) -> None:
        ssid = ssid.strip()
        if not ssid or len(ssid) > 64 or len(password) > 128:
            raise ValueError("Ogiltigt Wi-Fi-nätverk")
        command = ["nmcli", "--wait", "30", "device", "wifi", "connect", ssid]
        if password:
            command.extend(["password", password])
        result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=35)
        if result.returncode != 0:
            message = (result.stderr or result.stdout or "Anslutningen misslyckades").strip()
            raise RuntimeError(message)

    def update_status(self) -> dict:
        try:
            installed = Path("/opt/trainmeet-tkl/VERSION").read_text(encoding="utf-8").strip() or "okänd"
        except OSError:
            installed = "utvecklingsversion"
        result = {
            "supported": Path("/usr/local/sbin/trainmeet-tkl-update").exists(),
            "installed_version": installed,
            "status": "idle",
            "message": "Ingen uppdatering pågår",
        }
        try:
            saved = json.loads((self.state_dir / "update-status.json").read_text(encoding="utf-8"))
            if isinstance(saved, dict):
                result.update(saved)
        except (OSError, json.JSONDecodeError):
            pass
        try:
            request = Request(
                "https://api.github.com/repos/beahead-ab/trainmeet-tkl/commits/main",
                headers={"Accept": "application/vnd.github+json", "User-Agent": "TrainMeet-TKL-Terminal/0.2"},
            )
            with urlopen(request, timeout=5) as response:
                latest = str(json.loads(response.read().decode("utf-8"))["sha"])[:8]
            result["latest_version"] = latest
            result["update_available"] = latest != installed
        except (HTTPError, URLError, TimeoutError, OSError, KeyError, json.JSONDecodeError):
            result["check_error"] = "GitHub kunde inte nås"
        return result

    def start_update(self) -> None:
        atomic_json_write(
            self.state_dir / "update-status.json",
            {
                "status": "starting",
                "message": "Startar uppdateringstjänsten",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        subprocess.run(
            ["/bin/systemctl", "start", "--no-block", "trainmeet-tkl-update.service"],
            check=True,
            timeout=5,
        )


def normalize_server_url(value: str) -> str:
    value = value.strip().rstrip("/")
    if value and "://" not in value:
        value = f"http://{value}"
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return ""
    return value


def split_nmcli_fields(line: str) -> list[str]:
    fields: list[str] = []
    current: list[str] = []
    escaped = False
    for character in line:
        if escaped:
            current.append(character)
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == ":":
            fields.append("".join(current))
            current = []
        else:
            current.append(character)
    fields.append("".join(current))
    return fields


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
        if path == "/terminal/discover":
            self.send_json(HTTPStatus.OK, {"servers": self.application.discover_servers()})
            return
        if path == "/terminal/update":
            self.send_json(HTTPStatus.OK, self.application.update_status())
            return
        if path == "/terminal/wifi":
            self.send_json(HTTPStatus.OK, {"networks": self.application.wifi_networks()})
            return
        self.serve_static(path)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/terminal/update":
            try:
                self.application.start_update()
                self.send_json(HTTPStatus.ACCEPTED, {"status": "started", "message": "Uppdateringen har startat"})
            except (OSError, subprocess.SubprocessError) as error:
                self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"message": f"Uppdateringen kunde inte startas: {error}"})
            return
        if path == "/terminal/wifi":
            try:
                payload = self.read_json()
                self.application.connect_wifi(str(payload.get("ssid") or ""), str(payload.get("password") or ""))
                self.send_json(HTTPStatus.OK, {"connected": True, "message": "Wi-Fi är anslutet"})
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"message": str(error)})
            return
        if path != "/terminal/connect":
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

    def do_DELETE(self) -> None:
        if urlparse(self.path).path != "/terminal/config":
            self.send_json(HTTPStatus.NOT_FOUND, {"message": "Sidan finns inte"})
            return
        try:
            self.application.config_path.unlink(missing_ok=True)
            self.send_json(HTTPStatus.OK, {"configured": False})
        except OSError as error:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"message": str(error)})

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
