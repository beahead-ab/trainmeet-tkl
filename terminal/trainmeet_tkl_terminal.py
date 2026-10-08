#!/usr/bin/env python3
"""Local appliance layer for a TrainMeet TKL Raspberry Pi terminal."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import ipaddress
import json
import mimetypes
import os
import re
import secrets
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
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
    "client_id": "",
    "access_token": "",
}


def error_message(error: BaseException) -> str:
    """Keep the server's user-facing explanation when a proxied request fails."""
    if isinstance(error, HTTPError):
        try:
            payload = json.loads(error.read().decode("utf-8"))
            if isinstance(payload, dict) and payload.get("message"):
                return str(payload["message"])
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, TypeError):
            pass
    return str(error)


# ------------------------------------------------------------------ konton
#
# TKL har egna konton, skilda från TrainMeet Servers. Ägaren bestämmer vilka
# som har tillgång, en administratör sköter hela TKL (server, station,
# parkoppling, uppdatering) men inte vilka som har tillgång, och en klarerare
# kör ställverket. Kontot är e-postadressen; det finns inget användarnamn.
#
# Vid datorn där TKL körs (kioskens Chromium på 127.0.0.1) kör vem som helst
# ställverket utan att logga in - vem som helst på en träff ska kunna vara
# klarerare. Inloggning krävs först när någon går in i administrationen. Nås
# TKL via webben (bakom en proxy, från ett annat nätverk eller med
# --require-login) krävs inloggning för allt, också för ställverket.

PASSWORD_HASH_ITERATIONS = 210_000
PASSWORD_MIN, PASSWORD_MAX = 8, 256
NAME_MAX = 100
EMAIL_PATTERN = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$")
# Inga tecken som lätt förväxlas när koden lämnas över muntligt: 0/O, 1/I.
CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
SESSION_TTL = timedelta(hours=12)
INVITATION_TTL = timedelta(days=7)
SESSION_COOKIE = "trainmeet_tkl_session"
ROLES = ("owner", "admin", "operator")
ROLE_RANK = {"operator": 1, "admin": 2, "owner": 3}
FAILED_ATTEMPTS_PER_MINUTE = 5


class AccountError(ValueError):
    """En ogiltig kontouppgift, med ett besked som skärmen kan visa."""


class AccessDenied(Exception):
    """Begäran saknar inloggning eller rätt roll."""

    def __init__(self, status: HTTPStatus, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def normalise_email(value: object) -> str:
    """En e-postadress i gemener, eller tom sträng för ingen adress."""
    email = str(value or "").strip().lower()
    if not email:
        return ""
    if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
        raise AccountError("E-postadressen ser inte ut som en e-postadress")
    return email


def required_email(value: object) -> str:
    email = normalise_email(value)
    if not email:
        raise AccountError("Ange en e-postadress")
    return email


def clean_display_name(value: object) -> str:
    """Ett namn att visa: blanksteg i följd blir ett, och 1–100 tecken."""
    name = " ".join(str(value or "").split())
    if not 1 <= len(name) <= NAME_MAX:
        raise AccountError(f"Ange ett namn, högst {NAME_MAX} tecken")
    return name


def check_password(password: object) -> str:
    if not isinstance(password, str) or not PASSWORD_MIN <= len(password) <= PASSWORD_MAX:
        raise AccountError(f"Lösenordet måste vara {PASSWORD_MIN}–{PASSWORD_MAX} tecken")
    return password


def password_digest(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_HASH_ITERATIONS)


def credential_digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def new_account_code() -> str:
    return "-".join("".join(secrets.choice(CODE_ALPHABET) for _ in range(4)) for _ in range(2))


def display_code(value: object) -> str:
    """Koden som den visas, ABCD-EFGH, hur den än skrevs in."""
    letters = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    return f"{letters[:4]}-{letters[4:8]}" if len(letters) == 8 else letters


class AccountStore:
    """Kontona och inloggningarna, i två JSON-filer i terminalens katalog.

    users.json är beständig: den beskriver vilka som har tillgång. Lösenord
    och koder sparas bara som hashar. sessions.json är vilka som är inloggade
    just nu; den överlever en omstart av tjänsten så att en kiosk inte loggar
    ut administratören när den startas om, men varje inloggning går ut av sig
    själv efter tolv timmar.
    """

    def __init__(self, state_dir: Path) -> None:
        self.users_path = state_dir / "users.json"
        self.sessions_path = state_dir / "sessions.json"
        self._lock = threading.RLock()

    # ------------------------------------------------------------- filer

    def _read(self, path: Path, key: str) -> list[dict]:
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        items = loaded.get(key) if isinstance(loaded, dict) else None
        return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []

    def _users(self) -> list[dict]:
        return self._read(self.users_path, "users")

    def _write_users(self, users: list[dict]) -> None:
        atomic_json_write(self.users_path, {"users": users})

    def _sessions(self, now: datetime) -> list[dict]:
        sessions = []
        for session in self._read(self.sessions_path, "sessions"):
            try:
                if datetime.fromisoformat(str(session["expires_at"])) > now:
                    sessions.append(session)
            except (KeyError, TypeError, ValueError):
                continue
        return sessions

    def _write_sessions(self, sessions: list[dict]) -> None:
        atomic_json_write(self.sessions_path, {"sessions": sessions})

    # --------------------------------------------------------- hjälpare

    @staticmethod
    def public(user: dict) -> dict:
        """Kontot som skärmen får se det: aldrig hashar eller salt."""
        return {
            "user_id": str(user.get("user_id") or ""),
            "display_name": str(user.get("display_name") or ""),
            "email": str(user.get("email") or ""),
            "role": str(user.get("role") or "operator"),
            "created_at": user.get("created_at"),
            "updated_at": user.get("updated_at"),
            "password_configured": bool(user.get("password_digest")),
            "invitation_pending": bool(user.get("setup_code_digest")),
            "invitation_expires_at": user.get("setup_expires_at"),
        }

    @staticmethod
    def _find(users: list[dict], user_id: str) -> dict:
        user = next((item for item in users if item.get("user_id") == user_id), None)
        if user is None:
            raise AccountError("Användaren finns inte")
        return user

    @staticmethod
    def _assert_email_free(users: list[dict], email: str, user_id: str | None = None) -> None:
        if any(item.get("email") == email and item.get("user_id") != user_id for item in users):
            raise AccountError("Det finns redan ett konto med den e-postadressen")

    @staticmethod
    def _new_user(display_name: str, email: str, role: str, now: datetime) -> dict:
        return {
            "user_id": secrets.token_hex(16),
            "display_name": display_name,
            "email": email,
            "role": role,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }

    @staticmethod
    def _set_password(user: dict, password: str, now: datetime) -> None:
        salt = secrets.token_bytes(16)
        user["password_salt"] = salt.hex()
        user["password_digest"] = password_digest(password, salt).hex()
        user.pop("setup_code_digest", None)
        user.pop("setup_expires_at", None)
        user["updated_at"] = now.isoformat()

    @staticmethod
    def _password_matches(user: dict, password: str) -> bool:
        try:
            salt = bytes.fromhex(str(user.get("password_salt") or ""))
            expected = bytes.fromhex(str(user.get("password_digest") or ""))
        except ValueError:
            return False
        if not salt or not expected:
            return False
        return hmac.compare_digest(password_digest(password, salt), expected)

    @staticmethod
    def _issue_code(user: dict, now: datetime) -> str:
        code = new_account_code()
        user["setup_code_digest"] = credential_digest(code)
        user["setup_expires_at"] = (now + INVITATION_TTL).isoformat()
        user["updated_at"] = now.isoformat()
        return code

    @staticmethod
    def _would_strand(users: list[dict], user_id: str) -> bool:
        """Utan en ägare som kan logga in finns ingen som kan bjuda in en."""
        return not any(
            item.get("role") == "owner" and item.get("password_digest") and item.get("user_id") != user_id
            for item in users
        )

    # ------------------------------------------------------------- konton

    def configured(self) -> bool:
        """Finns det ett konto som kan logga in? Innan dess ska ägaren skapas."""
        return any(user.get("password_digest") for user in self._users())

    def list_users(self) -> list[dict]:
        order = {"owner": 0, "admin": 1, "operator": 2}
        users = sorted(self._users(), key=lambda user: (order.get(str(user.get("role")), 3), str(user.get("display_name") or "").lower(), str(user.get("email") or "")))
        return [self.public(user) for user in users]

    def user(self, user_id: str) -> dict | None:
        user = next((item for item in self._users() if item.get("user_id") == user_id), None)
        return self.public(user) if user else None

    def create_owner(self, display_name: object, email: object, password: object, *, now: datetime | None = None) -> dict:
        """Installationens första konto, ägaren. Bara när inget konto kan logga in."""
        display_name = clean_display_name(display_name)
        email = required_email(email)
        password = check_password(password)
        now = now or utcnow()
        with self._lock:
            users = self._users()
            if any(user.get("password_digest") for user in users):
                raise AccountError("Ägaren är redan skapad")
            self._assert_email_free(users, email)
            user = self._new_user(display_name, email, "owner", now)
            self._set_password(user, password, now)
            users.append(user)
            self._write_users(users)
        return self.public(user)

    def invite(self, display_name: object, email: object, role: object, *, now: datetime | None = None) -> tuple[dict, str]:
        """Skapa ett konto och en engångskod att lämna över.

        Ägaren sätter inte någon annans lösenord. Den inbjudne löser in koden
        med sin e-postadress och väljer sitt eget, så lösenordet finns aldrig
        hos någon annan, inte ens en kort stund.
        """
        display_name = clean_display_name(display_name)
        email = required_email(email)
        role = str(role or "operator")
        if role not in ROLES:
            raise AccountError("Rollen måste vara ägare, administratör eller klarerare")
        now = now or utcnow()
        with self._lock:
            users = self._users()
            self._assert_email_free(users, email)
            user = self._new_user(display_name, email, role, now)
            code = self._issue_code(user, now)
            users.append(user)
            self._write_users(users)
        return self.public(user), code

    def reissue(self, user_id: str, *, now: datetime | None = None) -> tuple[dict, str]:
        """En ny kod: för en inbjudan som gått ut, eller för den som glömt lösenordet."""
        now = now or utcnow()
        with self._lock:
            users = self._users()
            user = self._find(users, user_id)
            code = self._issue_code(user, now)
            self._write_users(users)
        return self.public(user), code

    def redeem(self, email: object, code: object, password: object, *, now: datetime | None = None) -> dict:
        """Löser in en kod och sätter det lösenord användaren själv valt."""
        password = check_password(password)
        try:
            email = normalise_email(email)
        except AccountError:
            raise AccountError("Koden gäller inte") from None
        now = now or utcnow()
        digest = credential_digest(display_code(code))
        with self._lock:
            users = self._users()
            user = next((item for item in users if item.get("email") == email), None) if email else None
            expected = str(user.get("setup_code_digest") or "") if user else ""
            if not user or not expected or not hmac.compare_digest(expected, digest):
                raise AccountError("Koden gäller inte")
            try:
                expired = datetime.fromisoformat(str(user.get("setup_expires_at"))) < now
            except (TypeError, ValueError):
                expired = True
            if expired:
                raise AccountError("Koden har gått ut. Be ägaren om en ny.")
            self._set_password(user, password, now)
            self._write_users(users)
            self._write_sessions([session for session in self._sessions(now) if session.get("user_id") != user["user_id"]])
        return self.public(user)

    def update_user(self, user_id: str, *, role: object = None, display_name: object = None, now: datetime | None = None) -> dict:
        now = now or utcnow()
        with self._lock:
            users = self._users()
            user = self._find(users, user_id)
            if role is not None:
                role = str(role)
                if role not in ROLES:
                    raise AccountError("Rollen måste vara ägare, administratör eller klarerare")
                if user.get("role") == "owner" and role != "owner" and self._would_strand(users, user_id):
                    raise AccountError("Det måste finnas minst en ägare. Utse någon annan till ägare först.")
                user["role"] = role
            if display_name is not None:
                user["display_name"] = clean_display_name(display_name)
            user["updated_at"] = now.isoformat()
            self._write_users(users)
        return self.public(user)

    def delete_user(self, user_id: str, *, now: datetime | None = None) -> None:
        """Den sista ägaren går inte att ta bort."""
        now = now or utcnow()
        with self._lock:
            users = self._users()
            user = self._find(users, user_id)
            if user.get("role") == "owner" and self._would_strand(users, user_id):
                raise AccountError("Det måste finnas minst en ägare. Utse någon annan till ägare först.")
            self._write_users([item for item in users if item is not user])
            self._write_sessions([session for session in self._sessions(now) if session.get("user_id") != user_id])

    def change_password(self, user_id: str, current: object, new: object, *, keep_token: str | None = None, now: datetime | None = None) -> None:
        """Ett nytt lösenord stänger ute den som satt inloggad med det gamla,
        utom den inloggning som bytte det."""
        new = check_password(new)
        now = now or utcnow()
        with self._lock:
            users = self._users()
            user = self._find(users, user_id)
            if not isinstance(current, str) or not self._password_matches(user, current):
                raise AccountError("Fel nuvarande lösenord")
            self._set_password(user, new, now)
            self._write_users(users)
            keep = credential_digest(keep_token) if keep_token else None
            self._write_sessions([
                session for session in self._sessions(now)
                if session.get("user_id") != user_id or session.get("digest") == keep
            ])

    # ------------------------------------------------------ inloggningar

    def login(self, email: object, password: object, *, now: datetime | None = None) -> str | None:
        """Logga in med e-postadress och lösenord. Adressen är kontot."""
        try:
            email = normalise_email(email)
        except AccountError:
            return None
        if not email or not isinstance(password, str) or len(password) > PASSWORD_MAX:
            return None
        now = now or utcnow()
        with self._lock:
            user = next((item for item in self._users() if item.get("email") == email), None)
            if user is None or not user.get("password_digest"):
                # Samma arbete som för ett riktigt konto, så att svarstiden
                # inte avslöjar vilka adresser som finns.
                password_digest(password, b"no-such-account")
                return None
            if not self._password_matches(user, password):
                return None
            token = secrets.token_urlsafe(32)
            sessions = self._sessions(now)
            sessions.append({
                "digest": credential_digest(token),
                "user_id": user["user_id"],
                "created_at": now.isoformat(),
                "expires_at": (now + SESSION_TTL).isoformat(),
            })
            self._write_sessions(sessions)
        return token

    def session_user(self, token: str, *, now: datetime | None = None) -> dict | None:
        """Vem inloggningen tillhör, eller None när den inte gäller."""
        if not token:
            return None
        now = now or utcnow()
        digest = credential_digest(token)
        with self._lock:
            session = next((item for item in self._sessions(now) if item.get("digest") == digest), None)
            if session is None:
                return None
            return self.user(str(session.get("user_id") or ""))

    def revoke_session(self, token: str, *, now: datetime | None = None) -> None:
        now = now or utcnow()
        digest = credential_digest(token)
        with self._lock:
            self._write_sessions([item for item in self._sessions(now) if item.get("digest") != digest])


class TerminalApplication:
    def __init__(self, web_root: Path, state_dir: Path, *, require_login: bool = False) -> None:
        self.web_root = web_root.resolve()
        self.state_dir = state_dir.resolve()
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.config_path = self.state_dir / "terminal-config.json"
        self.cache_path = self.state_dir / "last-runtime.json"
        self.accounts = AccountStore(self.state_dir)
        #: Inloggning för allt, också vid datorn själv: för TKL via webben.
        self.require_login = require_login
        self._attempts: dict[tuple[str, str], list[float]] = {}
        self._attempts_lock = threading.Lock()

    def check_attempts(self, peer: str, bucket: str) -> None:
        """Fem misslyckade försök per minut och adress, sedan en minuts paus."""
        with self._attempts_lock:
            now = time.monotonic()
            self._attempts = {
                key: stamps for key, stamps in ((key, [stamp for stamp in stamps if now - stamp < 60]) for key, stamps in self._attempts.items())
                if stamps
            }
            if len(self._attempts.get((bucket, peer), [])) >= FAILED_ATTEMPTS_PER_MINUTE:
                raise AccessDenied(HTTPStatus.TOO_MANY_REQUESTS, "too_many_attempts", "Vänta en minut innan nästa försök.")

    def record_failed_attempt(self, peer: str, bucket: str) -> None:
        with self._attempts_lock:
            self._attempts.setdefault((bucket, peer), []).append(time.monotonic())

    def read_config(self) -> dict:
        try:
            loaded = json.loads(self.config_path.read_text(encoding="utf-8"))
            return {**DEFAULT_CONFIG, **loaded, "configured": bool(loaded.get("station_id") and loaded.get("server_url"))}
        except (OSError, json.JSONDecodeError, TypeError):
            return dict(DEFAULT_CONFIG)

    def public_config(self) -> dict:
        """Profilen som skärmen får se den. Serverns nyckel stannar här: med
        den kunde en inloggad klarerare agera som terminalen direkt mot servern."""
        config = self.read_config()
        config.pop("access_token", None)
        return config

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
            "client_id": str(payload.get("client_id") or self.read_config().get("client_id") or "").strip(),
            "access_token": str(payload.get("access_token") or self.read_config().get("access_token") or "").strip(),
        }
        atomic_json_write(self.config_path, config)
        config.pop("access_token")
        return config

    def pair(self, server_url: str, pairing_code: str, terminal_name: str) -> dict:
        base = normalize_server_url(server_url)
        terminal_name = terminal_name.strip() or "TrainMeet TKL Terminal"
        if not base or not pairing_code.strip():
            raise ValueError("Server och anslutningskod måste anges")
        client_id = str(self.read_config().get("client_id") or f"tkl-{os.uname().nodename}")[:64]
        response = self.server_json(
            "/v1/pair",
            method="POST",
            payload={
                "pairing_code": pairing_code,
                "client_id": client_id,
                "display_name": terminal_name,
                "device_kind": "tkl_terminal",
            },
            server_url=base,
            authenticated=False,
        )
        token = str(response.get("access_token") or "")
        if not token:
            raise ValueError("Servern returnerade ingen terminalbehörighet")
        current = self.read_config()
        current.update(
            {
                "server_url": base,
                "terminal_name": terminal_name,
                "client_id": str(response.get("client_id") or client_id),
                "access_token": token,
            }
        )
        atomic_json_write(self.config_path, current)
        return {"authenticated": True, "access_mode": "terminal", "client_id": current["client_id"]}

    def auth_status(self) -> dict:
        config = self.read_config()
        return {
            "authenticated": bool(config.get("access_token")),
            "access_mode": "terminal",
            "username": config.get("terminal_name") or "TrainMeet TKL Terminal",
            "password_configured": True,
            "must_change_password": False,
        }

    def server_json(
        self,
        path: str,
        *,
        method: str = "GET",
        payload: dict | None = None,
        server_url: str | None = None,
        authenticated: bool = True,
    ) -> dict:
        config = self.read_config()
        base = normalize_server_url(server_url or str(config.get("server_url") or ""))
        if not base:
            raise ValueError("Terminalen saknar TrainMeet Server")
        headers = {"Accept": "application/json", "User-Agent": "TrainMeet-TKL-Terminal/0.3"}
        if authenticated:
            token = str(config.get("access_token") or "")
            if not token:
                raise PermissionError("Terminalen är inte parkopplad")
            headers["Authorization"] = f"Bearer {token}"
        body = None
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(f"{base}{path}", data=body, headers=headers, method=method)
        with urlopen(request, timeout=6) as response:
            value = json.loads(response.read().decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("Servern returnerade ett ogiltigt svar")
        return value

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


#: Vilken roll varje anrop kräver. "operate" är ställverket självt: fritt vid
#: datorn, annars ett konto av vilken roll som helst. Allt som ändrar vad
#: terminalen är (server, station, parkoppling, nätverk, uppdatering) är
#: administration, och vilka som har tillgång är ägarens.
REQUIRED_ROLE = {
    ("GET", "/terminal/config"): "operate",
    ("GET", "/terminal/auth"): "operate",
    ("GET", "/terminal/tkl/context"): "operate",
    ("GET", "/terminal/runtime"): "operate",
    ("POST", "/terminal/tkl/shift/start"): "operate",
    ("POST", "/terminal/tkl/shift/finish"): "operate",
    ("POST", "/terminal/tkl/movement"): "operate",
    ("POST", "/terminal/tkl/line"): "operate",
    ("GET", "/terminal/discover"): "admin",
    ("GET", "/terminal/update"): "admin",
    ("GET", "/terminal/wifi"): "admin",
    ("POST", "/terminal/update"): "admin",
    ("POST", "/terminal/wifi"): "admin",
    ("POST", "/terminal/pair"): "admin",
    ("POST", "/terminal/connect"): "admin",
    ("PUT", "/terminal/config"): "admin",
    ("DELETE", "/terminal/config"): "admin",
    ("GET", "/terminal/users"): "admin",
    ("POST", "/terminal/users"): "owner",
    ("POST", "/terminal/users/reissue"): "owner",
    ("POST", "/terminal/users/update"): "owner",
    ("POST", "/terminal/users/delete"): "owner",
}
LEVEL_ROLE = {"operate": "operator", "admin": "admin", "owner": "owner"}
FORWARDED_HEADERS = ("Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto")


class Handler(BaseHTTPRequestHandler):
    server_version = "TrainMeetTKL/0.3"

    @property
    def application(self) -> TerminalApplication:
        return self.server.application  # type: ignore[attr-defined]

    # ----------------------------------------------------- vem som frågar

    def _client_address(self) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
        try:
            return ipaddress.ip_address(self.client_address[0])
        except ValueError:
            return None

    def _client_is_loopback(self) -> bool:
        address = self._client_address()
        return address is not None and address.is_loopback

    def _client_is_private(self) -> bool:
        address = self._client_address()
        return address is not None and (address.is_loopback or address.is_private or address.is_link_local)

    def _forwarded(self) -> bool:
        return any(self.headers.get(name) for name in FORWARDED_HEADERS)

    def _at_the_machine(self) -> bool:
        """Står skärmen på datorn där TKL körs?

        Kiosken öppnar 127.0.0.1 direkt. En proxy på samma dator ansluter
        också från 127.0.0.1, men den säger vem den talar för i
        X-Forwarded-*, och då är det webben. --require-login gör att det
        alltid är webben, för en TKL som är tänkt att nås utifrån.
        """
        if self.application.require_login:
            return False
        return self._client_is_loopback() and not self._forwarded()

    def _peer(self) -> str:
        forwarded = str(self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        return forwarded or self.client_address[0]

    def _session_token(self) -> str | None:
        header = self.headers.get("Cookie")
        if not header:
            return None
        cookies = SimpleCookie()
        try:
            cookies.load(header)
        except Exception:
            return None
        morsel = cookies.get(SESSION_COOKIE)
        return morsel.value if morsel is not None else None

    def _current_user(self) -> dict | None:
        token = self._session_token()
        return self.application.accounts.session_user(token) if token else None

    def _session_status(self, user: dict | None = None) -> dict:
        at_the_machine = self._at_the_machine()
        configured = self.application.accounts.configured()
        return {
            "available": True,
            "configured": configured,
            "at_the_machine": at_the_machine,
            "login_required": not at_the_machine,
            "owner_setup_allowed": not configured and self._client_is_private(),
            "user": user if user is not None else self._current_user(),
        }

    def _require(self, level: str) -> dict | None:
        """Den inloggade som får göra detta, eller None för ställverket vid datorn."""
        user = self._current_user()
        if level == "operate" and self._at_the_machine():
            return user
        if user is None:
            raise AccessDenied(HTTPStatus.UNAUTHORIZED, "authentication_required", "Inloggning krävs")
        if ROLE_RANK.get(str(user.get("role")), 0) < ROLE_RANK[LEVEL_ROLE[level]]:
            if level == "owner":
                raise AccessDenied(HTTPStatus.FORBIDDEN, "owner_required", "Bara ägaren kan lägga till och ta bort användare")
            raise AccessDenied(HTTPStatus.FORBIDDEN, "admin_required", "Administratörsbehörighet krävs")
        return user

    def _session_cookie(self, token: str, *, max_age: int = int(SESSION_TTL.total_seconds())) -> str:
        cookie = SimpleCookie()
        cookie[SESSION_COOKIE] = token
        cookie[SESSION_COOKIE]["path"] = "/"
        cookie[SESSION_COOKIE]["httponly"] = True
        cookie[SESSION_COOKIE]["samesite"] = "Strict"
        cookie[SESSION_COOKIE]["max-age"] = max_age
        if str(self.headers.get("X-Forwarded-Proto") or "").split(",", 1)[0].strip().lower() == "https":
            cookie[SESSION_COOKIE]["secure"] = True
        return cookie.output(header="").strip()

    def _send_signed_in(self, token: str, status: HTTPStatus = HTTPStatus.OK) -> None:
        user = self.application.accounts.session_user(token)
        self.send_json(status, self._session_status(user), headers={"Set-Cookie": self._session_cookie(token)})

    # ------------------------------------------------------------ anrop

    def do_GET(self) -> None:
        self._handle(self._get)

    def do_POST(self) -> None:
        self._handle(self._post)

    def do_PUT(self) -> None:
        self._handle(self._put)

    def do_DELETE(self) -> None:
        self._handle(self._delete)

    def _handle(self, method) -> None:
        path = urlparse(self.path).path
        try:
            level = REQUIRED_ROLE.get((self.command, path))
            if level:
                self._require(level)
            method(path)
        except AccessDenied as error:
            self.send_json(error.status, {"error": error.code, "message": error.message})
        except AccountError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_account", "message": str(error)})

    def _get(self, path: str) -> None:
        if path == "/terminal/session":
            self.send_json(HTTPStatus.OK, self._session_status())
            return
        if path == "/terminal/config":
            self.send_json(HTTPStatus.OK, self.application.public_config())
            return
        if path == "/terminal/auth":
            self.send_json(HTTPStatus.OK, self.application.auth_status())
            return
        if path == "/terminal/users":
            user = self._current_user() or {}
            self.send_json(HTTPStatus.OK, {"users": self.application.accounts.list_users(), "role": user.get("role")})
            return
        if path == "/terminal/tkl/context":
            try:
                query = urlparse(self.path).query
                suffix = f"?{query}" if query else ""
                self.send_json(HTTPStatus.OK, self.application.server_json(f"/v1/tkl/context{suffix}"))
            except (HTTPError, URLError, TimeoutError, OSError, ValueError, PermissionError) as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"message": error_message(error)})
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
        if path.startswith("/terminal/"):
            self.send_json(HTTPStatus.NOT_FOUND, {"message": "Sidan finns inte"})
            return
        self.serve_static(path)

    def _post(self, path: str) -> None:
        accounts = self.application.accounts
        if path == "/terminal/setup/owner":
            # Som på TrainMeet Server: öppet tills ägaren finns, och bara från
            # datorn själv eller dess nätverk. Fönstret stänger sig i samma
            # stund som ägaren skapas.
            if accounts.configured():
                raise AccessDenied(HTTPStatus.CONFLICT, "owner_already_configured", "Ägaren är redan skapad")
            if not self._client_is_private():
                raise AccessDenied(HTTPStatus.FORBIDDEN, "local_setup_required", "Ägaren skapas på datorn där TKL körs eller från dess lokala nätverk.")
            payload = self.read_json()
            user = accounts.create_owner(payload.get("display_name"), payload.get("email"), payload.get("password"))
            token = accounts.login(user["email"], payload.get("password"))
            if token is None:
                raise AccessDenied(HTTPStatus.INTERNAL_SERVER_ERROR, "login_failed", "Ägaren skapades men inloggningen kunde inte startas")
            self._send_signed_in(token, HTTPStatus.CREATED)
            return
        if path == "/terminal/login":
            self.application.check_attempts(self._peer(), "login")
            payload = self.read_json()
            token = accounts.login(payload.get("email") or payload.get("username"), payload.get("password"))
            if token is None:
                self.application.record_failed_attempt(self._peer(), "login")
                raise AccessDenied(HTTPStatus.UNAUTHORIZED, "invalid_login", "Fel e-postadress eller lösenord")
            self._send_signed_in(token)
            return
        if path == "/terminal/logout":
            token = self._session_token()
            if token:
                accounts.revoke_session(token)
            status = self._session_status()
            status["user"] = None
            self.send_json(HTTPStatus.OK, status, headers={"Set-Cookie": self._session_cookie("", max_age=0)})
            return
        if path == "/terminal/redeem":
            self.application.check_attempts(self._peer(), "redeem")
            payload = self.read_json()
            try:
                user = accounts.redeem(payload.get("email"), payload.get("code"), payload.get("password"))
            except AccountError:
                self.application.record_failed_attempt(self._peer(), "redeem")
                raise
            token = accounts.login(user["email"], payload.get("password"))
            if token is None:
                raise AccessDenied(HTTPStatus.INTERNAL_SERVER_ERROR, "login_failed", "Lösenordet sattes men inloggningen kunde inte startas")
            self._send_signed_in(token)
            return
        if path == "/terminal/password":
            user = self._current_user()
            if user is None:
                raise AccessDenied(HTTPStatus.UNAUTHORIZED, "authentication_required", "Inloggning krävs")
            payload = self.read_json()
            accounts.change_password(user["user_id"], payload.get("current_password"), payload.get("new_password"), keep_token=self._session_token())
            self.send_json(HTTPStatus.OK, {"changed": True})
            return
        if path == "/terminal/users":
            payload = self.read_json()
            user, code = accounts.invite(payload.get("display_name"), payload.get("email"), payload.get("role") or "operator")
            self.send_json(HTTPStatus.CREATED, {"user": user, "code": code})
            return
        if path == "/terminal/users/reissue":
            payload = self.read_json()
            user, code = accounts.reissue(str(payload.get("user_id") or ""))
            self.send_json(HTTPStatus.OK, {"user": user, "code": code})
            return
        if path == "/terminal/users/update":
            payload = self.read_json()
            user = accounts.update_user(str(payload.get("user_id") or ""), role=payload.get("role"), display_name=payload.get("display_name"))
            self.send_json(HTTPStatus.OK, {"user": user})
            return
        if path == "/terminal/users/delete":
            payload = self.read_json()
            accounts.delete_user(str(payload.get("user_id") or ""))
            self.send_json(HTTPStatus.OK, {"removed": True})
            return
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
        # The screen sends these as POST. They sat under do_GET, so pairing a
        # Pi with the Server's code answered "Sidan finns inte" (404), and so
        # did every shift, movement and line action.
        if path == "/terminal/pair":
            try:
                payload = self.read_json()
                result = self.application.pair(
                    str(payload.get("server_url") or ""),
                    str(payload.get("pairing_code") or ""),
                    str(payload.get("terminal_name") or ""),
                )
                self.send_json(HTTPStatus.OK, result)
            except (HTTPError, URLError, TimeoutError, OSError, ValueError, PermissionError) as error:
                self.send_json(HTTPStatus.UNAUTHORIZED, {"message": error_message(error)})
            return
        if path in {"/terminal/tkl/shift/start", "/terminal/tkl/shift/finish", "/terminal/tkl/movement", "/terminal/tkl/line"}:
            try:
                payload = self.read_json()
                remote_path = path.removeprefix("/terminal")
                self.send_json(HTTPStatus.OK, self.application.server_json(f"/v1{remote_path}", method="POST", payload=payload))
            except (HTTPError, URLError, TimeoutError, OSError, ValueError, PermissionError) as error:
                self.send_json(HTTPStatus.BAD_GATEWAY, {"message": error_message(error)})
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

    def _put(self, path: str) -> None:
        if path != "/terminal/config":
            self.send_json(HTTPStatus.NOT_FOUND, {"message": "Sidan finns inte"})
            return
        try:
            config = self.application.save_config(self.read_json())
            self.send_json(HTTPStatus.OK, config)
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})

    def _delete(self, path: str) -> None:
        if path != "/terminal/config":
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

    def send_json(self, status: HTTPStatus, value: dict, *, headers: dict[str, str] | None = None) -> None:
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, header in (headers or {}).items():
            self.send_header(name, header)
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


def env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() not in {"", "0", "false", "no", "off"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--web-root", type=Path, default=Path("dist"))
    parser.add_argument("--state-dir", type=Path, default=Path("/var/lib/trainmeet-tkl"))
    parser.add_argument(
        "--require-login",
        action="store_true",
        default=env_flag("TRAINMEET_TKL_REQUIRE_LOGIN"),
        help="kräv inloggning för allt, också ställverket: för TKL som nås via webben",
    )
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.bind, args.port), Handler)
    server.application = TerminalApplication(args.web_root, args.state_dir, require_login=args.require_login)  # type: ignore[attr-defined]
    server.serve_forever()


if __name__ == "__main__":
    main()
