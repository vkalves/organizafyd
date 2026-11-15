# Python / zyon/gmail.py / Python 3.11+ / Gmail API desktop OAuth
import base64
from datetime import datetime, timezone
import email
import email.policy
import email.utils
from html.parser import HTMLParser
import json
import re
import threading
import math
import time
from .errors import CompanionError

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
API = "https://gmail.googleapis.com/gmail/v1/users/me/"


def address(value):
    if not isinstance(value, str) or len(value) > 254 or not re.fullmatch(r"[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", value):
        raise CompanionError("INVALID_EMAIL", "Enter one plain email address.")
    return value.lower()

class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.hidden = [], 0
    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"): self.hidden += 1
        if tag in ("p", "br", "div", "td", "tr"): self.parts.append(" ")
    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.hidden: self.hidden -= 1
        self.parts.append(" ")
    def handle_data(self, data):
        if not self.hidden: self.parts.append(data)


def extract_code(raw, received_ms, sender, recipient, since_ms, now_ms=None):
    now_ms = now_ms if now_ms is not None else time.time() * 1000
    if received_ms < since_ms or received_ms > now_ms + 60_000: return None
    if len(raw) > 2 * 1024 * 1024:
        raise CompanionError("MESSAGE_TOO_LARGE", "Candidate email exceeds 2 MiB.")
    message = email.message_from_bytes(raw, policy=email.policy.default)
    senders = [a.lower() for _, a in email.utils.getaddresses(message.get_all("From", []))]
    if senders != [sender]: return None
    recipients = [a.lower() for _, a in email.utils.getaddresses(sum((message.get_all(h, []) for h in ("To", "Delivered-To", "X-Original-To")), []))]
    if recipient not in recipients: return None
    texts = [str(message.get("Subject", ""))]
    for part in message.walk():
        if part.is_multipart() or part.get_content_disposition() == "attachment": continue
        if part.get_content_type() not in ("text/plain", "text/html"): continue
        try: content = part.get_content()
        except (LookupError, UnicodeError): continue
        if part.get_content_type() == "text/html":
            parser = Text(); parser.feed(content); content = " ".join(parser.parts)
        texts.append(content)
    # Distinct digits in subject/plain/html must agree. Never guess among codes.
    codes = set(re.findall(r"(?<!\d)\d{6}(?!\d)", " ".join(texts)))
    if len(codes) > 1:
        raise CompanionError("AMBIGUOUS_CODE", "Email contains multiple different codes. Inspect it in Gmail.")
    return next(iter(codes), None)

class Gmail:
    def __init__(self, vault, session_factory=None):
        self.vault = vault
        self.session_factory = session_factory
        self.lock = threading.RLock()
        self.reconnect = False
        self.used = set()

    def status(self):
        data = self.vault.get("gmail")
        return {"connected": bool(data) and not self.reconnect, "mailbox": data.get("mailbox", "") if data else "", "reconnect": self.reconnect}

    def connect(self, client, mailbox):
        from google_auth_oauthlib.flow import InstalledAppFlow
        mailbox = address(mailbox)
        installed = client.get("installed", {}) if isinstance(client, dict) else {}
        # Only Google's Desktop application config. Config cannot supply arbitrary endpoints.
        if not isinstance(installed, dict) or not isinstance(installed.get("client_id"), str) or not installed["client_id"].endswith(".apps.googleusercontent.com") or not isinstance(installed.get("client_secret"), str) or not installed["client_secret"]:
            raise CompanionError("DESKTOP_CLIENT_REQUIRED", "Choose the OAuth client JSON for a Google Desktop application.")
        config = {"installed": {"client_id": installed["client_id"], "client_secret": installed["client_secret"],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth", "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"]}}
        flow = InstalledAppFlow.from_client_config(config, SCOPES, autogenerate_code_verifier=True)
        credentials = flow.run_local_server(host="127.0.0.1", port=0, open_browser=True, timeout_seconds=300,
            authorization_prompt_message="Google consent opened in your browser.",
            success_message="Gmail connected. You can close this tab.", access_type="offline", prompt="consent")
        if not credentials or not credentials.refresh_token:
            raise CompanionError("OFFLINE_GRANT_MISSING", "Google did not issue offline access. Reconnect and complete consent.")
        from google.auth.transport.requests import AuthorizedSession
        with AuthorizedSession(credentials) as session:
            response = session.get(API + "profile", timeout=20)
            if response.status_code != 200:
                raise CompanionError("GMAIL_PROFILE_FAILED", "Enable Gmail API in this Google project and retry authorization.")
            if address(response.json().get("emailAddress", "")) != mailbox:
                raise CompanionError("WRONG_MAILBOX", "Google authorized a different mailbox. Reconnect using the configured address.")
        with self.lock:
            self.vault.put("gmail", {"mailbox": mailbox, "credentials": json.loads(credentials.to_json())})
            self.reconnect = False
            self.used.clear()
        return {"mailbox": mailbox, "connected": True}

    def disconnect(self):
        # Remove local credentials. Google Account permissions can also be revoked there.
        with self.lock:
            self.vault.delete("gmail"); self.used.clear(); self.reconnect = False

    def request(self, path, params=None):
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import AuthorizedSession
        from google.auth.exceptions import RefreshError, TransportError
        from requests.exceptions import RequestException
        data = self.vault.get("gmail")
        if not data or self.reconnect:
            raise CompanionError("GMAIL_RECONNECT", "Connect Gmail in this companion first.")
        credentials = Credentials.from_authorized_user_info(data["credentials"], SCOPES)
        factory = self.session_factory or AuthorizedSession
        try:
            with factory(credentials) as session:
                for attempt in range(3):
                    response = session.get(API + path, params=params, timeout=20)
                    if response.status_code == 200: return response.json()
                    if response.status_code == 401:
                        self.reconnect = True
                        raise CompanionError("GMAIL_RECONNECT", "Gmail authorization expired or was revoked. Reconnect Gmail.")
                    if response.status_code not in (429, 500, 502, 503, 504):
                        raise CompanionError("GMAIL_API_FAILED", "Gmail rejected the request. Check Gmail API access and OAuth permissions.")
                    if attempt < 2:
                        delay = response.headers.get("Retry-After", "")
                        time.sleep(min(5, max(1, int(delay))) if delay.isdigit() else 2 ** attempt)
                raise CompanionError("GMAIL_RETRY", "Gmail is temporarily unavailable. Retry this verification request.")
        except RefreshError:
            self.reconnect = True
            raise CompanionError("GMAIL_RECONNECT", "Google rejected token renewal. Reconnect Gmail.") from None
        except (TransportError, RequestException):
            raise CompanionError("GMAIL_NETWORK", "Gmail network request failed. Check connectivity and retry.") from None
        finally:
            # AuthorizedSession renews automatically; persist a rotated grant even on API failure.
            if not self.reconnect:
                data["credentials"] = json.loads(credentials.to_json())
                self.vault.put("gmail", data)

    def wait_code(self, sender, recipient, since_ms, cancel, timeout=90):
        sender, recipient = address(sender), address(recipient)
        if isinstance(since_ms, bool) or not isinstance(since_ms, (int, float)) or not math.isfinite(since_ms) or not time.time() * 1000 - 600_000 <= since_ms <= time.time() * 1000 + 5000:
            raise CompanionError("STALE_CHALLENGE", "Start a fresh email challenge; the timestamp must be within ten minutes.")
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 1 <= timeout <= 120:
            raise CompanionError("INVALID_TIMEOUT", "Email timeout must be between 1 and 120 seconds.")
        with self.lock:
            data = self.vault.get("gmail")
            if not data: raise CompanionError("GMAIL_RECONNECT", "Connect Gmail first.")
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if cancel.is_set(): raise CompanionError("CANCELLED", "Email retrieval cancelled.")
                listing = self.request("messages", {"q": f"in:anywhere from:{sender} to:{recipient} after:{int(since_ms / 1000) - 1}", "maxResults": 25})
                if listing.get("nextPageToken"):
                    raise CompanionError("TOO_MANY_MESSAGES", "Too many matching emails; start a fresh challenge.")
                found = []
                for item in listing.get("messages", []):
                    if cancel.is_set(): raise CompanionError("CANCELLED", "Email retrieval cancelled.")
                    if item["id"] in self.used: continue
                    message = self.request("messages/" + item["id"], {"format": "raw"})
                    encoded = message.get("raw", "")
                    if len(encoded) > 3 * 1024 * 1024:
                        raise CompanionError("MESSAGE_TOO_LARGE", "Candidate email exceeds 2 MiB.")
                    raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
                    code = extract_code(raw, int(message["internalDate"]), sender, recipient, since_ms)
                    if code: found.append((item["id"], code))
                if len(found) > 1:
                    raise CompanionError("AMBIGUOUS_CODE", "Multiple verification emails match this challenge. Request a new code.")
                if found:
                    message_id, code = found[0]
                    self.used.add(message_id)
                    return {"code": code, "recipient": recipient, "expiresInSeconds": 60,
                            "note": "Retrieved only. Confirm acceptance in Instagram before continuing."}
                cancel.wait(2)
        raise CompanionError("EMAIL_TIMEOUT", "No matching fresh email arrived. Request a new Instagram code and retry.")
