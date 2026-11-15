# Python / zyon/vault.py / Python 3.11+ / Windows 10 DPAPI credential storage
"""Current-Windows-user DPAPI; no plaintext or non-Windows fallback."""
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import threading
from .errors import CompanionError

class Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

def protect(data, decrypt=False):
    if os.name != "nt":
        raise CompanionError("WINDOWS_REQUIRED", "Credential storage requires Windows DPAPI. Run start.cmd on Windows 10.")
    buffer = ctypes.create_string_buffer(data)
    incoming = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    fn = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
                   ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    fn.restype = wintypes.BOOL
    # CRYPTPROTECT_UI_FORBIDDEN; deliberately omit LOCAL_MACHINE scope.
    if not fn(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
        raise CompanionError("VAULT_FAILED", "Windows could not unlock/save credentials for this Windows user.")
    try:
        return ctypes.string_at(outgoing.pbData, outgoing.cbData)
    finally:
        kernel.LocalFree(outgoing.pbData)

class Vault:
    def __init__(self, root):
        self.root = Path(root) / "vault"
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()

    def path(self, name):
        return self.root / (hashlib.sha256(name.encode()).hexdigest() + ".dpapi")

    def get(self, name):
        with self.lock:
            path = self.path(name)
            if not path.exists():
                return None
            try:
                return json.loads(protect(path.read_bytes(), decrypt=True))
            except (ValueError, OSError):
                raise CompanionError("VAULT_FAILED", "Stored credentials could not be read. Reconnect this service.") from None

    def put(self, name, value):
        with self.lock:
            encrypted = protect(json.dumps(value).encode())
            path = self.path(name)
            temp = path.with_suffix(".tmp")
            temp.write_bytes(encrypted)
            os.replace(temp, path)

    def delete(self, name):
        with self.lock:
            self.path(name).unlink(missing_ok=True)
