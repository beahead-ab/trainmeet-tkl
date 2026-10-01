"""The terminal's local service over HTTP, as the screen calls it.

The screen POSTs /terminal/pair and the shift, movement and line actions. They
sat under do_GET, so on a Pi every pairing answered "Sidan finns inte" (404)
whatever code was typed (Casper, CDA, 2026-10-01). These tests call the real
handler on a port, against a stand-in TrainMeet Server.
"""
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from terminal.trainmeet_tkl_terminal import Handler, TerminalApplication


class StandInServer(BaseHTTPRequestHandler):
    """Answers like TrainMeet Server: /v1/pair with the code 123456, and the TKL actions."""
    calls: list = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        StandInServer.calls.append((self.path, body, self.headers.get("Authorization")))
        if self.path == "/v1/pair":
            if body.get("pairing_code") != "123456":
                return self.answer(401, {"message": "Parkopplingskoden är ogiltig eller har gått ut"})
            return self.answer(200, {"client_id": body["client_id"], "access_token": "token-cda"})
        if self.path.startswith("/v1/tkl/"):
            if self.headers.get("Authorization") != "Bearer token-cda":
                return self.answer(403, {"message": "Terminalen har inte tillgång till stationen"})
            return self.answer(200, {"accepted": True, "path": self.path})
        self.answer(404, {"message": "okänd"})

    def answer(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def serve(handler):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


class QuietHandler(Handler):
    def log_message(self, *args):
        pass


class TerminalHTTPTests(unittest.TestCase):
    def setUp(self):
        StandInServer.calls = []
        self.trainmeet = serve(StandInServer)
        self.addCleanup(self.trainmeet.server_close)
        self.addCleanup(self.trainmeet.shutdown)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.terminal = serve(QuietHandler)
        self.terminal.application = TerminalApplication(root / "web", root / "state")
        self.addCleanup(self.terminal.server_close)
        self.addCleanup(self.terminal.shutdown)
        self.server_url = f"http://127.0.0.1:{self.trainmeet.server_port}"

    def call(self, method, path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        request = Request(f"http://127.0.0.1:{self.terminal.server_port}{path}", data=data, method=method,
                          headers={"Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            body = error.read()
            return error.code, json.loads(body) if body.startswith(b"{") else {}

    def pair(self, code="123456"):
        return self.call("POST", "/terminal/pair", {"server_url": self.server_url, "pairing_code": code, "terminal_name": "CDA TKL 1"})

    def test_pairing_with_the_servers_code_as_the_screen_sends_it(self):
        status, result = self.pair()
        self.assertEqual(200, status, result)
        self.assertEqual({"authenticated": True, "access_mode": "terminal"}, {k: result[k] for k in ("authenticated", "access_mode")})
        path, body, _ = StandInServer.calls[0]
        self.assertEqual("/v1/pair", path)
        self.assertEqual(("123456", "tkl_terminal", "CDA TKL 1"), (body["pairing_code"], body["device_kind"], body["display_name"]))
        self.assertEqual((200, True), (lambda s, r: (s, r["authenticated"]))(*self.call("GET", "/terminal/auth")))

    def test_a_wrong_code_says_why(self):
        status, result = self.pair("999999")
        self.assertEqual(401, status)
        self.assertEqual("Parkopplingskoden är ogiltig eller har gått ut", result["message"])
        self.assertFalse(self.call("GET", "/terminal/auth")[1]["authenticated"])

    def test_shift_movement_and_line_actions_reach_the_server(self):
        self.pair()
        for action in ("shift/start", "movement", "line", "shift/finish"):
            status, result = self.call("POST", f"/terminal/tkl/{action}", {"station_id": "cda"})
            self.assertEqual((200, f"/v1/tkl/{action}"), (status, result["path"]), action)
            self.assertEqual("Bearer token-cda", StandInServer.calls[-1][2])

    def test_lost_access_comes_back_with_the_servers_reason(self):
        self.pair()
        # A new meet on the Server: the key it holds no longer opens the station.
        path = self.terminal.application.config_path
        path.write_text(json.dumps({**json.loads(path.read_text()), "access_token": "revoked"}))
        status, result = self.call("POST", "/terminal/tkl/movement", {"station_id": "cda"})
        self.assertEqual(502, status)
        self.assertEqual("Terminalen har inte tillgång till stationen", result["message"])

    def test_pairing_is_not_a_get(self):
        status, _ = self.call("GET", "/terminal/pair")
        self.assertNotEqual(200, status)
        self.assertEqual([], StandInServer.calls)


if __name__ == "__main__":
    unittest.main()
