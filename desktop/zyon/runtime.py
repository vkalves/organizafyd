# Python / zyon/runtime.py / Python 3.11+ / desktop-owned Appium runtime
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import requests
from .errors import CompanionError


def application_dir():
    return Path(sys.executable).parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parents[1]


def data_dir(): return Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'ZyonCompanion'


def load_runtime(root=None):
    root = Path(root or data_dir())
    config = root / 'runtime' / 'paths.json'
    if not config.exists(): return
    paths = json.loads(config.read_text(encoding='utf-8-sig'))
    additions = []
    for field in ('Node', 'Python'):
        if paths.get(field) and Path(paths[field]).is_dir(): additions.append(paths[field])
    if paths.get('Java'):
        os.environ['JAVA_HOME'] = paths['Java']; additions.append(str(Path(paths['Java']) / 'bin'))
    if paths.get('Android'):
        sdk = Path(paths['Android'])
        os.environ['ANDROID_HOME'] = str(sdk); os.environ['ANDROID_SDK_ROOT'] = str(sdk)
        additions.extend(str(sdk / p) for p in ('platform-tools', 'emulator', 'cmdline-tools/latest/bin'))
    os.environ['PATH'] = os.pathsep.join(additions + [os.environ.get('PATH', '')])
    os.environ['APPIUM_HOME'] = str(root / 'appium')

class Runtime:
    def __init__(self, cancel): self.cancel, self.process = cancel, None
    def ready(self):
        try:
            result = requests.get('http://127.0.0.1:4723/status', timeout=2)
            return result.status_code == 200 and result.json().get('value', {}).get('ready') is True
        except (requests.RequestException, ValueError): return False
    def install(self):
        if os.name != 'nt': raise CompanionError('WINDOWS_REQUIRED', 'Run the Windows application to install its runtime tools.')
        script = application_dir() / 'install-requirements.ps1'
        if not script.is_file(): raise CompanionError('INSTALLER_MISSING', 'Keep the executable and installer files in the same extracted application folder.')
        process = subprocess.Popen(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script)],
                                   creationflags=subprocess.CREATE_NEW_CONSOLE)
        if process.wait() != 0: raise CompanionError('INSTALLATION_FAILED', 'Requirement installation stopped. Review its diagnostic and run installation again.')
        load_runtime()
        return {'installed': True}

    def ensure(self):
        if self.ready(): return
        load_runtime()
        executable = application_dir() / 'tools/node_modules/.bin/appium.cmd'
        if os.name != 'nt' or not executable.is_file():
            raise CompanionError('REQUIREMENTS_MISSING', 'Run Install requirements in this application before starting Android control.')
        if self.process is None or self.process.poll() is not None:
            command = '""' + str(executable) + '" --address 127.0.0.1 --port 4723 --log-level error --log-no-colors"'
            self.process = subprocess.Popen([os.environ['ComSpec'], '/d', '/s', '/c', command], stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if self.cancel.is_set(): raise CompanionError('CANCELLED', 'Startup stopped.')
            if self.ready(): return
            if self.process.poll() is not None: break
            self.cancel.wait(.4)
        raise CompanionError('APPIUM_START_FAILED', 'The installed Android controller did not become ready. Run Install requirements and check its diagnostics.')
    def close(self):
        if self.process is not None and self.process.poll() is None:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(self.process.pid), '/T', '/F'], capture_output=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
            else: self.process.terminate()
        self.process = None
