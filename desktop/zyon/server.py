# Python / zyon/server.py / Python 3.11+ / Windows 10 loopback UI
import argparse
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import subprocess
import threading
import time
from urllib.parse import urlencode
import webbrowser
from .android import Android, devices, handle
from .errors import CompanionError
from .gmail import Gmail
from .vault import Vault

WEB = Path(__file__).parent / "web"
AVANCA = "https://www.organizafy.site/avanca/integracao"


def chrome(url):
    if os.name == "nt":
        roots = [os.environ.get("PROGRAMFILES", ""), os.environ.get("PROGRAMFILES(X86)", ""), os.environ.get("LOCALAPPDATA", "")]
        for root in roots:
            executable = Path(root) / "Google/Chrome/Application/chrome.exe"
            if executable.is_file():
                subprocess.Popen([str(executable), url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return
        raise CompanionError("CHROME_MISSING", "Install Google Chrome to continue the browser workflow.")
    webbrowser.open(url)


class App:
    def __init__(self, root, vault=None):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.vault = vault or Vault(root)
        self.gmail = Gmail(self.vault)
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.RLock()
        self.cancel = threading.Event()
        self.busy = False
        self.job = {"state": "idle", "message": "Ready."}
        self.workflow = {"username": "", "serial": "", "phase": "not_started", "recoveryConfirmed": False}
        path = self.root / "workflow.json"
        if path.exists():
            try:
                prior = json.loads(path.read_text(encoding="utf-8"))
                self.workflow = {**self.workflow, "username": handle(prior["username"]), "serial": str(prior.get("serial", "")), "phase": "interrupted"}
                self.job["message"] = "Previous session detected. Inspect the phone and start with a fresh identity and 2FA check."
            except (ValueError, KeyError, CompanionError): pass

    def persist(self):
        # No email codes, TOTP seeds, passwords or OAuth credentials in the journal.
        path = self.root / "workflow.json"
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(self.workflow), encoding="utf-8")
        os.replace(temp, path)

    def snapshot(self):
        with self.lock:
            if self.job.get("expiresAt", 0) and time.time() >= self.job["expiresAt"]:
                self.job.pop("result", None)
                self.job.pop("expiresAt", None)
                self.job["message"] = "Email code hidden after 60 seconds."
            return {"job": dict(self.job), "workflow": dict(self.workflow), "gmail": self.gmail.status(), "windows": os.name == "nt"}

    def progress(self, phase, message):
        with self.lock:
            self.workflow["phase"] = phase
            self.job["message"] = message
            self.persist()

    def start(self, label, work):
        with self.lock:
            if self.busy: raise CompanionError("BUSY", "An operation is already running. Wait or stop it before continuing.", 409)
            self.busy = True
            self.cancel.clear()
            self.job = {"state": "running", "message": label}
        def run():
            try:
                result = work()
                with self.lock:
                    self.job = {"state": "completed", "message": "Operation completed.", "result": result}
                    if isinstance(result, dict) and "code" in result:
                        self.job["expiresAt"] = time.time() + 60
            except CompanionError as failure:
                with self.lock:
                    self.job = {"state": "needs_attention", "code": failure.code, "message": str(failure)}
            except Exception:
                # Third-party exceptions may embed setup keys, tokens, email bodies or URLs.
                with self.lock:
                    self.job = {"state": "needs_attention", "code": "OPERATION_FAILED", "message": "Operation interrupted. Check the device, connection and setup. No success was inferred; inspect the current state before retrying."}
            finally:
                with self.lock: self.busy = False
        threading.Thread(target=run, daemon=True).start()
        return {"started": True}

    def native(self, payload, logout=False):
        username = handle(payload.get("username"))
        serial = payload.get("serial", "")
        endpoint = payload.get("endpoint", "http://127.0.0.1:4723")
        if not isinstance(serial, str) or not serial or len(serial) > 200:
            raise CompanionError("INVALID_DEVICE", "Choose a device serial first.")
        if not isinstance(endpoint, str): raise CompanionError("INVALID_ENDPOINT", "Enter the local Appium endpoint.")
        with self.lock:
            if self.busy: raise CompanionError("BUSY", "Wait for the current operation.", 409)
            if logout and (self.workflow["username"] != username or self.workflow["serial"] != serial or not self.workflow["recoveryConfirmed"]):
                raise CompanionError("RECOVERY_REQUIRED", "Verify 2FA and confirm recovery material for this account/device before logout.")
            if not logout:
                self.workflow = {"username": username, "serial": serial, "phase": "starting", "recoveryConfirmed": False}
                self.persist()
            def work():
                native = Android(serial, endpoint, self.vault, self.cancel, self.progress)
                try:
                    native.open()
                    if logout: return native.logout(username)
                    result = native.ensure_two_factor(username)
                    # Automatic collection only if the current hierarchy exposes the codes.
                    result["recoveryStored"] = native.collect_recovery(username)
                    return result
                finally: native.close()
            return self.start("Checking Instagram on Android…", work)

    def action(self, path, payload):
        if not isinstance(payload, dict): raise CompanionError("INVALID_BODY", "Request must be a JSON object.")
        if path == "/api/stop":
            self.cancel.set()
            return {"stopping": self.busy, "message": "A current device command or Google consent may need to finish. Inspect external state before retrying."}
        if path == "/api/devices": return {"devices": devices()}
        if path == "/api/gmail/connect":
            client, mailbox = payload.get("client"), payload.get("mailbox")
            return self.start("Waiting for initial Google consent…", lambda: self.gmail.connect(client, mailbox))
        if path == "/api/gmail/disconnect":
            with self.lock:
                if self.busy: raise CompanionError("BUSY", "Stop the active operation before disconnecting Gmail.", 409)
                self.gmail.disconnect()
                self.job = {"state": "idle", "message": "Gmail credentials removed from this computer."}
            return {"disconnected": True}
        if path == "/api/gmail/wait":
            return self.start("Waiting for a fresh verification email…", lambda: self.gmail.wait_code(payload.get("sender"), payload.get("recipient"), payload.get("sinceMs"), self.cancel))
        if path == "/api/android/enroll": return self.native(payload)
        if path == "/api/android/logout": return self.native(payload, logout=True)
        with self.lock:
            if self.busy: raise CompanionError("BUSY", "Wait for the current operation to finish.", 409)
            if path == "/api/recovery/confirm":
                if self.workflow["phase"] != "two_factor_verified":
                    raise CompanionError("TWO_FACTOR_REQUIRED", "First complete a visible 2FA check on the phone.")
                if payload.get("confirmed") is not True:
                    raise CompanionError("RECOVERY_REQUIRED", "Save recovery material before continuing.")
                self.workflow["recoveryConfirmed"] = True
                self.persist()
                return {"confirmed": True}
            if path == "/api/browser":
                if self.workflow["phase"] not in ("native_complete", "invitation_pending"):
                    raise CompanionError("NATIVE_REQUIRED", "Confirm native logout before starting the browser stage.")
                chrome("https://www.instagram.com/accounts/login/")
                self.progress("invitation_pending", "Use the same @ in Chrome. Send the tester invitation in Meta, then explicitly continue here.")
                return {"opened": True}
            if path == "/api/continue":
                if self.workflow["phase"] != "invitation_pending" or payload.get("confirmed") is not True:
                    raise CompanionError("INVITATION_PENDING", "Complete the invitation step for the displayed @ and confirm before continuing.")
                url = AVANCA + "?" + urlencode({"expected_username": self.workflow["username"]})
                chrome(url)
                self.progress("avanca_opened", "Continue official Meta authorization and verified flow synchronization in AVANÇA.")
                return {"opened": True, "url": url}
        raise CompanionError("NOT_FOUND", "Endpoint not found.", 404)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, port, app):
        self.app = app
        super().__init__(("127.0.0.1", port), Handler)
        self.origin = "http://127.0.0.1:" + str(self.server_port)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def send(self, status, value, mime="application/json"):
        raw = json.dumps(value).encode() if mime == "application/json" else value
        self.send_response(status)
        self.send_header("Content-Type", mime + "; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        self.end_headers()
        try: self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError): pass

    def guard(self, authenticated=True):
        if self.headers.get("Host") != self.server.origin.removeprefix("http://"):
            raise CompanionError("HOST_REJECTED", "Invalid local host.", 403)
        origin = self.headers.get("Origin")
        if origin is not None and origin != self.server.origin:
            raise CompanionError("ORIGIN_REJECTED", "Only this companion's local page may call its API.", 403)
        if authenticated and not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + self.server.app.token):
            raise CompanionError("UNAUTHORIZED", "Reopen the companion from start.cmd.", 401)

    def failure(self, failure):
        self.send(failure.status, {"error": failure.code, "message": str(failure)})

    def do_GET(self):
        try:
            self.guard(self.path.startswith("/api/"))
            if self.path == "/api/status": return self.send(200, self.server.app.snapshot())
            files = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "application/javascript"), "/style.css": ("style.css", "text/css")}
            if self.path not in files: raise CompanionError("NOT_FOUND", "Page not found.", 404)
            name, mime = files[self.path]
            self.send(200, (WEB / name).read_bytes(), mime)
        except CompanionError as failure: self.failure(failure)
        except Exception: self.failure(CompanionError("STATUS_FAILED", "Could not read local state. Check Windows credential storage.", 500))

    def do_POST(self):
        try:
            self.guard()
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise CompanionError("JSON_REQUIRED", "JSON body required.", 415)
            if self.headers.get("Transfer-Encoding"):
                raise CompanionError("INVALID_BODY", "Chunked requests are not accepted.")
            size = int(self.headers.get("Content-Length", "0"))
            if not 1 <= size <= 32_768: raise CompanionError("BODY_TOO_LARGE", "Request must be between 1 and 32768 bytes.", 413)
            payload = json.loads(self.rfile.read(size))
            self.send(202, self.server.app.action(self.path, payload))
        except CompanionError as failure: self.failure(failure)
        except (ValueError, TypeError): self.failure(CompanionError("INVALID_JSON", "Invalid JSON request."))
        except Exception: self.failure(CompanionError("REQUEST_FAILED", "Local operation failed. Check device and configuration.", 500))


def main():
    parser = argparse.ArgumentParser(description="Zyon Windows companion")
    parser.add_argument("--port", type=int, default=8788)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535: parser.error("Invalid port")
    root = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "ZyonCompanion"
    app = App(root)
    try: server = Server(args.port, app)
    except OSError: parser.exit(2, "Local port unavailable. Close another companion or choose --port.\n")
    url = server.origin + "/#" + app.token
    if not args.no_browser: webbrowser.open(url)
    print("Zyon companion running on " + server.origin + ". Close this window to stop.", flush=True)
    print("If the browser did not open, press Enter here to open it. Tokens are never printed.", flush=True)
    def reopen():
        try:
            while True:
                input(); webbrowser.open(url)
        except (EOFError, OSError): pass
    threading.Thread(target=reopen, daemon=True).start()
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally:
        app.cancel.set()
        server.server_close()

if __name__ == "__main__": main()
