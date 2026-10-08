"""TKL:s egna konton: ägare, administratör och klarerare, och när inloggning krävs.

Kontot är e-postadressen; det finns inget användarnamn. Vid datorn där TKL
körs (127.0.0.1 utan proxy-huvuden) kör ställverket utan inloggning och bara
administrationen kräver ett konto. Via webben (X-Forwarded-For från en proxy,
eller --require-login) kräver allt inloggning, också ställverket.
"""
import json
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from terminal.trainmeet_tkl_terminal import AccountError, AccountStore, Handler, TerminalApplication, display_code


class QuietHandler(Handler):
    def log_message(self, *args):
        pass


def serve(handler):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


OWNER = {"display_name": "Casper", "email": "Casper@Example.se", "password": "ett-langt-losenord"}


class Harness(unittest.TestCase):
    require_login = False

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.terminal = serve(QuietHandler)
        self.terminal.application = TerminalApplication(self.root / "web", self.root / "state", require_login=self.require_login)
        self.addCleanup(self.terminal.server_close)
        self.addCleanup(self.terminal.shutdown)

    def call(self, method, path, payload=None, cookie=None, web=False):
        """(status, body, Set-Cookie). web=True is what a proxy in front of TKL sends."""
        data = None if payload is None else json.dumps(payload).encode()
        headers = {"Content-Type": "application/json"}
        if cookie:
            headers["Cookie"] = cookie
        if web:
            headers["X-Forwarded-For"] = "203.0.113.7"
            headers["X-Forwarded-Proto"] = "https"
        request = Request(f"http://127.0.0.1:{self.terminal.server_port}{path}", data=data, method=method, headers=headers)
        try:
            with urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read()), response.headers.get("Set-Cookie")
        except HTTPError as error:
            body = error.read()
            return error.code, (json.loads(body) if body.startswith(b"{") else {}), error.headers.get("Set-Cookie")

    @staticmethod
    def cookie(set_cookie):
        return set_cookie.split(";", 1)[0]

    def create_owner(self, web=False):
        status, body, set_cookie = self.call("POST", "/terminal/setup/owner", OWNER, web=web)
        self.assertEqual(201, status, body)
        return self.cookie(set_cookie)

    def login(self, email, password, web=False):
        status, body, set_cookie = self.call("POST", "/terminal/login", {"email": email, "password": password}, web=web)
        self.assertEqual(200, status, body)
        return self.cookie(set_cookie)

    def invite(self, owner, name, email, role):
        status, body, _ = self.call("POST", "/terminal/users", {"display_name": name, "email": email, "role": role}, cookie=owner)
        self.assertEqual(201, status, body)
        return body["user"], body["code"]

    def redeem(self, email, code, password, web=False):
        status, body, set_cookie = self.call("POST", "/terminal/redeem", {"email": email, "code": code, "password": password}, web=web)
        self.assertEqual(200, status, body)
        return self.cookie(set_cookie)


class OwnerTests(Harness):
    def test_before_the_owner_exists_the_screen_is_told_to_create_one(self):
        status, session, _ = self.call("GET", "/terminal/session")
        self.assertEqual(200, status)
        self.assertEqual(
            {"available": True, "configured": False, "at_the_machine": True, "login_required": False, "owner_setup_allowed": True, "user": None},
            session,
        )

    def test_the_owner_is_created_once_with_an_email_address_and_is_signed_in(self):
        status, session, set_cookie = self.call("POST", "/terminal/setup/owner", OWNER)
        self.assertEqual(201, status, session)
        self.assertEqual(("owner", "casper@example.se", "Casper"), (session["user"]["role"], session["user"]["email"], session["user"]["display_name"]))
        self.assertTrue(session["configured"])
        self.assertIn("HttpOnly", set_cookie)
        self.assertIn("SameSite=Strict", set_cookie)
        self.assertNotIn("Secure", set_cookie, "plain http at the machine: a Secure cookie would never come back")
        for secret in ("password_digest", "password_salt", OWNER["password"]):
            self.assertNotIn(secret, json.dumps(session))

        status, again, _ = self.call("GET", "/terminal/session", cookie=self.cookie(set_cookie))
        self.assertEqual(("owner", False), (again["user"]["role"], again["owner_setup_allowed"]))

        status, body, _ = self.call("POST", "/terminal/setup/owner", {**OWNER, "email": "annan@example.se"})
        self.assertEqual((409, "Ägaren är redan skapad"), (status, body["message"]))

    def test_the_owner_needs_an_email_address_a_name_and_a_real_password(self):
        for payload, message in (
            ({**OWNER, "email": "casper"}, "E-postadressen ser inte ut som en e-postadress"),
            ({**OWNER, "email": ""}, "Ange en e-postadress"),
            ({**OWNER, "password": "kort"}, "Lösenordet måste vara 8–256 tecken"),
            ({**OWNER, "display_name": "  "}, "Ange ett namn, högst 100 tecken"),
        ):
            status, body, _ = self.call("POST", "/terminal/setup/owner", payload)
            self.assertEqual((400, message), (status, body["message"]), payload)
        self.assertFalse(self.call("GET", "/terminal/session")[1]["configured"])

    def test_over_the_web_the_owner_is_still_created_through_the_proxy(self):
        # The proxy on the same machine connects from 127.0.0.1: the same
        # window as on TrainMeet Server, open only until the owner exists.
        status, session, set_cookie = self.call("POST", "/terminal/setup/owner", OWNER, web=True)
        self.assertEqual(201, status, session)
        self.assertIn("Secure", set_cookie)
        self.assertTrue(session["login_required"])


class AtTheMachineTests(Harness):
    def test_the_signal_box_runs_without_login_and_administration_needs_an_administrator(self):
        owner = self.create_owner()
        for path in ("/terminal/auth", "/terminal/config"):
            status, body, _ = self.call("GET", path)
            self.assertEqual(200, status, (path, body))
        status, body, _ = self.call("POST", "/terminal/tkl/movement", {"station_id": "cda"})
        self.assertNotEqual(401, status, "the signal box is free at the machine; this one fails only for lack of a server")

        profile = {"terminal_name": "CDA TKL 1", "server_url": "http://server.local:8787", "station_id": "cda", "orientation": "portrait"}
        status, body, _ = self.call("PUT", "/terminal/config", profile)
        self.assertEqual((401, "authentication_required", "Inloggning krävs"), (status, body["error"], body["message"]))
        for method, path in (("GET", "/terminal/discover"), ("GET", "/terminal/update"), ("GET", "/terminal/wifi"), ("DELETE", "/terminal/config"), ("GET", "/terminal/users")):
            self.assertEqual(401, self.call(method, path)[0], path)

        status, body, _ = self.call("PUT", "/terminal/config", profile, cookie=owner)
        self.assertEqual((200, "cda"), (status, body["station_id"]), body)

    def test_a_configured_terminal_without_an_owner_keeps_running_until_one_is_created(self):
        # Upgrading a Pi that was paired before accounts existed: the signal
        # box keeps working, and the owner is created when someone opens
        # the administration.
        self.terminal.application.config_path.write_text(json.dumps({"terminal_name": "CDA TKL 1", "server_url": "http://server.local:8787", "station_id": "cda", "access_token": "token-cda"}))
        status, session, _ = self.call("GET", "/terminal/session")
        self.assertEqual((False, True, True), (session["configured"], session["at_the_machine"], session["owner_setup_allowed"]))
        self.assertEqual(200, self.call("GET", "/terminal/auth")[0])
        self.assertEqual(401, self.call("PUT", "/terminal/config", {})[0])

    def test_the_profile_never_exposes_the_servers_key(self):
        owner = self.create_owner()
        self.terminal.application.config_path.write_text(json.dumps({"terminal_name": "CDA TKL 1", "server_url": "http://server.local:8787", "station_id": "cda", "client_id": "tkl-pi", "access_token": "token-cda"}))
        status, config, _ = self.call("GET", "/terminal/config")
        self.assertEqual(("tkl-pi", True), (config["client_id"], config["configured"]))
        self.assertNotIn("access_token", config)

        status, saved, _ = self.call("PUT", "/terminal/config", {**config, "station_id": "lek", "station_name": "Lekvall"}, cookie=owner)
        self.assertEqual((200, "lek"), (status, saved["station_id"]))
        self.assertNotIn("access_token", saved)
        self.assertEqual("token-cda", json.loads(self.terminal.application.config_path.read_text())["access_token"], "the key the screen never saw is kept")


class WebTests(Harness):
    def test_over_the_web_everything_needs_a_signed_in_account(self):
        self.create_owner()
        status, session, _ = self.call("GET", "/terminal/session", web=True)
        self.assertEqual((False, True, None), (session["at_the_machine"], session["login_required"], session["user"]))
        for method, path in (("GET", "/terminal/auth"), ("GET", "/terminal/config"), ("GET", "/terminal/runtime"), ("POST", "/terminal/tkl/movement")):
            status, body, _ = self.call(method, path, {} if method == "POST" else None, web=True)
            self.assertEqual((401, "authentication_required"), (status, body["error"]), path)

        owner = self.login("casper@example.se", OWNER["password"], web=True)
        self.assertEqual(200, self.call("GET", "/terminal/auth", cookie=owner, web=True)[0])
        self.assertEqual("owner", self.call("GET", "/terminal/session", cookie=owner, web=True)[1]["user"]["role"])

    def test_a_dispatcher_runs_the_signal_box_but_changes_no_settings(self):
        owner = self.create_owner()
        _, code = self.invite(owner, "Anna", "anna@example.se", "operator")
        anna = self.redeem("anna@example.se", code, "annas-losenord", web=True)
        self.assertEqual(200, self.call("GET", "/terminal/auth", cookie=anna, web=True)[0])
        status, body, _ = self.call("PUT", "/terminal/config", {}, cookie=anna, web=True)
        self.assertEqual((403, "admin_required", "Administratörsbehörighet krävs"), (status, body["error"], body["message"]))
        self.assertEqual(403, self.call("GET", "/terminal/users", cookie=anna, web=True)[0])
        self.assertEqual(403, self.call("POST", "/terminal/users", {"display_name": "X", "email": "x@example.se"}, cookie=anna, web=True)[0])

    def test_wrong_passwords_are_refused_and_then_throttled(self):
        self.create_owner()
        for _ in range(5):
            status, body, set_cookie = self.call("POST", "/terminal/login", {"email": "casper@example.se", "password": "fel"}, web=True)
            self.assertEqual((401, "Fel e-postadress eller lösenord", None), (status, body["message"], set_cookie))
        status, body, _ = self.call("POST", "/terminal/login", {"email": "casper@example.se", "password": OWNER["password"]}, web=True)
        self.assertEqual((429, "Vänta en minut innan nästa försök."), (status, body["message"]))
        # Another address is not held back by this one's attempts.
        self.assertEqual(200, self.call("POST", "/terminal/login", {"email": "casper@example.se", "password": OWNER["password"]})[0])

    def test_an_old_screen_sending_username_with_the_address_still_signs_in(self):
        self.create_owner()
        status, _, _ = self.call("POST", "/terminal/login", {"username": "casper@example.se", "password": OWNER["password"]}, web=True)
        self.assertEqual(200, status)
        status, _, _ = self.call("POST", "/terminal/login", {"username": "casper", "password": OWNER["password"]}, web=True)
        self.assertEqual(401, status, "a bare username opens nothing")


class RequireLoginTests(Harness):
    require_login = True

    def test_require_login_treats_the_machine_as_the_web(self):
        self.create_owner()
        status, session, _ = self.call("GET", "/terminal/session")
        self.assertEqual((False, True), (session["at_the_machine"], session["login_required"]))
        self.assertEqual(401, self.call("GET", "/terminal/auth")[0])
        owner = self.login("casper@example.se", OWNER["password"])
        self.assertEqual(200, self.call("GET", "/terminal/auth", cookie=owner)[0])


class UsersTests(Harness):
    def test_the_owner_invites_with_a_code_and_the_invitee_chooses_the_password(self):
        owner = self.create_owner()
        user, code = self.invite(owner, "Anna", "Anna@Example.se", "admin")
        self.assertRegex(code, r"^[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$")
        self.assertEqual(("admin", "anna@example.se", True, False), (user["role"], user["email"], user["invitation_pending"], user["password_configured"]))
        self.assertEqual(401, self.call("POST", "/terminal/login", {"email": "anna@example.se", "password": "annas-losenord"})[0], "no password until the code is redeemed")
        self.assertEqual(400, self.call("POST", "/terminal/redeem", {"email": "anna@example.se", "code": "XXXX-XXXX", "password": "annas-losenord"})[0])

        anna = self.redeem("anna@example.se", code.lower().replace("-", " "), "annas-losenord")
        status, session, _ = self.call("GET", "/terminal/session", cookie=anna)
        self.assertEqual(("admin", "Anna"), (session["user"]["role"], session["user"]["display_name"]))
        status, body, _ = self.call("GET", "/terminal/users", cookie=anna)
        self.assertEqual((200, "admin"), (status, body["role"]))
        self.assertEqual([("Casper", "owner", False), ("Anna", "admin", False)], [(u["display_name"], u["role"], u["invitation_pending"]) for u in body["users"]])
        status, body, _ = self.call("POST", "/terminal/redeem", {"email": "anna@example.se", "code": code, "password": "ett-annat"}, )
        self.assertEqual((400, "Koden gäller inte"), (status, body["message"]), "a code is used once")

    def test_an_administrator_manages_tkl_but_not_who_has_access(self):
        owner = self.create_owner()
        _, code = self.invite(owner, "Anna", "anna@example.se", "admin")
        anna = self.redeem("anna@example.se", code, "annas-losenord")
        self.assertEqual(200, self.call("DELETE", "/terminal/config", cookie=anna)[0])
        status, body, _ = self.call("POST", "/terminal/users", {"display_name": "Bo", "email": "bo@example.se"}, cookie=anna)
        self.assertEqual((403, "owner_required", "Bara ägaren kan lägga till och ta bort användare"), (status, body["error"], body["message"]))
        for path in ("/terminal/users/reissue", "/terminal/users/update", "/terminal/users/delete"):
            self.assertEqual(403, self.call("POST", path, {"user_id": "x"}, cookie=anna)[0], path)

    def test_the_same_address_cannot_have_two_accounts_and_the_role_must_exist(self):
        owner = self.create_owner()
        status, body, _ = self.call("POST", "/terminal/users", {"display_name": "Casper igen", "email": "CASPER@example.se"}, cookie=owner)
        self.assertEqual((400, "Det finns redan ett konto med den e-postadressen"), (status, body["message"]))
        status, body, _ = self.call("POST", "/terminal/users", {"display_name": "Bo", "email": "bo@example.se", "role": "chef"}, cookie=owner)
        self.assertEqual((400, "Rollen måste vara ägare, administratör eller klarerare"), (status, body["message"]))

    def test_the_last_owner_is_neither_removed_nor_demoted(self):
        owner = self.create_owner()
        me = self.call("GET", "/terminal/session", cookie=owner)[1]["user"]["user_id"]
        for path, payload in (("/terminal/users/delete", {"user_id": me}), ("/terminal/users/update", {"user_id": me, "role": "admin"})):
            status, body, _ = self.call("POST", path, payload, cookie=owner)
            self.assertEqual((400, "Det måste finnas minst en ägare. Utse någon annan till ägare först."), (status, body["message"]), path)

        bo, code = self.invite(owner, "Bo", "bo@example.se", "owner")
        status, body, _ = self.call("POST", "/terminal/users/delete", {"user_id": me}, cookie=owner)
        self.assertEqual(400, status, "an invited owner who has not chosen a password cannot yet sign in")
        self.redeem("bo@example.se", code, "bos-losenord")
        status, body, _ = self.call("POST", "/terminal/users/delete", {"user_id": me}, cookie=owner)
        self.assertEqual(200, status, body)
        self.assertIsNone(self.call("GET", "/terminal/session", cookie=owner)[1]["user"], "a removed account is signed out")

    def test_changing_a_role_and_removing_a_user(self):
        owner = self.create_owner()
        anna, code = self.invite(owner, "Anna", "anna@example.se", "operator")
        anna_cookie = self.redeem("anna@example.se", code, "annas-losenord")
        status, body, _ = self.call("POST", "/terminal/users/update", {"user_id": anna["user_id"], "role": "admin"}, cookie=owner)
        self.assertEqual((200, "admin"), (status, body["user"]["role"]))
        self.assertEqual(200, self.call("GET", "/terminal/users", cookie=anna_cookie)[0], "the new role applies to the running session")
        status, body, _ = self.call("POST", "/terminal/users/delete", {"user_id": anna["user_id"]}, cookie=owner)
        self.assertEqual((200, True), (status, body["removed"]))
        self.assertEqual(401, self.call("GET", "/terminal/users", cookie=anna_cookie)[0])
        status, body, _ = self.call("POST", "/terminal/users/delete", {"user_id": anna["user_id"]}, cookie=owner)
        self.assertEqual((400, "Användaren finns inte"), (status, body["message"]))

    def test_a_new_code_replaces_a_forgotten_password(self):
        owner = self.create_owner()
        anna, code = self.invite(owner, "Anna", "anna@example.se", "operator")
        self.redeem("anna@example.se", code, "annas-losenord")
        status, body, _ = self.call("POST", "/terminal/users/reissue", {"user_id": anna["user_id"]}, cookie=owner)
        self.assertEqual((200, True), (status, body["user"]["invitation_pending"]))
        self.assertNotEqual(code, body["code"])
        self.redeem("anna@example.se", body["code"], "nytt-losenord")
        self.assertEqual(401, self.call("POST", "/terminal/login", {"email": "anna@example.se", "password": "annas-losenord"})[0])
        self.login("anna@example.se", "nytt-losenord")


class SessionTests(Harness):
    def test_sessions_survive_a_restart_of_the_service(self):
        owner = self.create_owner()
        self.terminal.application = TerminalApplication(self.root / "web", self.root / "state")
        self.assertEqual("owner", self.call("GET", "/terminal/session", cookie=owner)[1]["user"]["role"])

    def test_signing_out_ends_the_session(self):
        owner = self.create_owner()
        status, session, set_cookie = self.call("POST", "/terminal/logout", cookie=owner)
        self.assertEqual((200, None), (status, session["user"]))
        self.assertIn("Max-Age=0", set_cookie)
        self.assertIsNone(self.call("GET", "/terminal/session", cookie=owner)[1]["user"])
        self.assertEqual(401, self.call("PUT", "/terminal/config", {}, cookie=owner)[0])

    def test_changing_the_password_signs_out_the_other_sessions_but_not_this_one(self):
        first = self.create_owner()
        second = self.login("casper@example.se", OWNER["password"])
        status, body, _ = self.call("POST", "/terminal/password", {"current_password": "fel", "new_password": "nytt-losenord"}, cookie=first)
        self.assertEqual((400, "Fel nuvarande lösenord"), (status, body["message"]))
        status, body, _ = self.call("POST", "/terminal/password", {"current_password": OWNER["password"], "new_password": "nytt-losenord"}, cookie=first)
        self.assertEqual((200, True), (status, body["changed"]))
        self.assertEqual("owner", self.call("GET", "/terminal/session", cookie=first)[1]["user"]["role"])
        self.assertIsNone(self.call("GET", "/terminal/session", cookie=second)[1]["user"])
        self.assertEqual(401, self.call("POST", "/terminal/password", {"current_password": "x", "new_password": "nytt-losenord"})[0])
        self.login("casper@example.se", "nytt-losenord")

    def test_a_session_and_an_invitation_expire(self):
        store = AccountStore(self.root / "state")
        start = datetime(2026, 10, 8, 9, 0, tzinfo=timezone.utc)
        store.create_owner("Casper", "casper@example.se", OWNER["password"], now=start)
        token = store.login("casper@example.se", OWNER["password"], now=start)
        self.assertEqual("owner", store.session_user(token, now=start + timedelta(hours=11))["role"])
        self.assertIsNone(store.session_user(token, now=start + timedelta(hours=13)))

        user, code = store.invite("Anna", "anna@example.se", "operator", now=start)
        with self.assertRaises(AccountError) as refused:
            store.redeem("anna@example.se", code, "annas-losenord", now=start + timedelta(days=8))
        self.assertEqual("Koden har gått ut. Be ägaren om en ny.", str(refused.exception))
        store.redeem("anna@example.se", code, "annas-losenord", now=start + timedelta(days=6))

    def test_the_code_is_read_however_it_was_written(self):
        self.assertEqual("ABCD-EFGH", display_code(" abcd efgh "))
        self.assertEqual("ABCD-EFGH", display_code("abcd-efgh"))
        self.assertEqual("ABC", display_code("abc"))


if __name__ == "__main__":
    unittest.main()
