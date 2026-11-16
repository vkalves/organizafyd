# Python / zyon/runtime.py / Python 3.11+ / desktop-owned Appium runtime
from collections import deque
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import threading
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
    os.environ['PATH'] = os.pathsep.join(dict.fromkeys(additions + os.environ.get('PATH', '').split(os.pathsep)))
    os.environ['APPIUM_HOME'] = str(root / 'appium')


class Runtime:
    def __init__(self, cancel, root=None, app_dir=None, startup_timeout=90):
        self.cancel, self.process = cancel, None
        self.root, self.app_dir = Path(root or data_dir()), Path(app_dir or application_dir())
        self.startup_timeout = startup_timeout
        self.http = requests.Session(); self.http.trust_env = False
        self.output = deque(maxlen=64); self.output_lock = threading.Lock()
        self.capture_startup = threading.Event(); self.reader = None
        self.diagnostic_path = self.root / 'runtime' / 'appium-startup.json'

    def ready(self):
        try:
            result = self.http.get('http://127.0.0.1:4723/status', timeout=2)
            value = result.json().get('value') if result.status_code == 200 else None
            return isinstance(value, dict) and value.get('ready') is True
        except (requests.RequestException, ValueError, AttributeError): return False

    def install(self):
        if os.name != 'nt': raise CompanionError('WINDOWS_REQUIRED', 'Run the Windows application to install its runtime tools.')
        script = self.app_dir / 'install-requirements.ps1'
        if not script.is_file(): raise CompanionError('INSTALLER_MISSING', 'Keep the executable and installer files in the same extracted application folder.')
        process = subprocess.Popen(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script)],
                                   creationflags=subprocess.CREATE_NEW_CONSOLE)
        if process.wait() != 0: raise CompanionError('INSTALLATION_FAILED', 'Requirement installation stopped. Review its diagnostic and run installation again.')
        load_runtime(self.root)
        return {'installed': True}

    def port_busy(self):
        try:
            with socket.create_connection(('127.0.0.1', 4723), timeout=.5): return True
        except OSError: return False

    def _record(self, outcome, **details):
        # Only fixed classifications and numeric facts are persisted, never provider output.
        data = {'time': datetime.now(timezone.utc).isoformat(), 'outcome': outcome, 'port': 4723, **details}
        try:
            self.diagnostic_path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.diagnostic_path.with_suffix('.tmp')
            temp.write_text(json.dumps(data, indent=2), encoding='utf-8'); temp.replace(self.diagnostic_path)
        except OSError: pass

    def _drain(self, stream):
        try:
            while chunk := stream.read(1024):
                if self.capture_startup.is_set():
                    with self.output_lock:
                        if self.capture_startup.is_set(): self.output.append(chunk)
        except (OSError, ValueError): pass
        finally: stream.close()

    def _discard_output(self):
        self.capture_startup.clear()
        with self.output_lock: self.output.clear()

    def _failure_reason(self):
        with self.output_lock: text = b''.join(self.output).decode('utf-8', errors='replace').lower()
        if 'eaddrinuse' in text: return 'port_in_use'
        if any(term in text for term in ('eacces', 'eperm', 'access denied', 'access is denied')): return 'access_denied'
        if any(term in text for term in ('cannot find module', 'module_not_found', 'err_module_not_found')): return 'dependencies_missing'
        if any(term in text for term in ('unsupported engine', 'unsupported node', 'requires node')): return 'node_version'
        return 'process_exited' if self.process and self.process.poll() is not None else 'readiness_timeout'

    def _entrypoint(self):
        node = shutil.which('node.exe')
        package = self.app_dir / 'tools/node_modules/appium'
        try:
            metadata = json.loads((package / 'package.json').read_text(encoding='utf-8-sig'))
            relative = metadata.get('bin', {})
            if isinstance(relative, dict): relative = relative.get('appium')
            if not isinstance(relative, str): raise ValueError()
            entry = (package / relative).resolve()
            if not entry.is_relative_to(package.resolve()) or not entry.is_file(): raise ValueError()
        except (OSError, ValueError, AttributeError):
            self._record('dependencies_missing', node_present=bool(node), appium_present=False)
            raise CompanionError('REQUIREMENTS_MISSING', 'Appium incompleto. Na aba PROGRAMA, execute Instalar / verificar todos os requisitos.') from None
        if not node or not (self.root / 'appium/node_modules/appium-uiautomator2-driver/package.json').is_file():
            self._record('dependencies_missing', node_present=bool(node), appium_present=True)
            raise CompanionError('REQUIREMENTS_MISSING', 'Node.js ou UiAutomator2 ausente. Na aba PROGRAMA, execute Instalar / verificar todos os requisitos.')
        return node, entry

    def ensure(self):
        if self.cancel.is_set(): raise CompanionError('CANCELLED', 'Inicialização cancelada.')
        if self.ready():
            self._record('ready', reused=True)
            return
        if sys.platform != 'win32': raise CompanionError('WINDOWS_REQUIRED', 'Execute o aplicativo Windows para controlar o Android.')
        load_runtime(self.root)
        if self.port_busy():
            self._record('port_in_use')
            raise CompanionError('APPIUM_PORT_IN_USE', 'A porta local 4723 está ocupada por um serviço que não respondeu como Appium pronto. Feche esse serviço e tente novamente; o app não encerra processos externos.')
        node, entry = self._entrypoint()
        started = time.monotonic()
        try:
            if self.process is None or self.process.poll() is not None:
                self._discard_output(); self.capture_startup.set()
                # Execute Node directly: cmd.exe and npm batch shims corrupt quoted paths.
                self.process = subprocess.Popen([node, str(entry), '--address', '127.0.0.1', '--port', '4723', '--log-level', 'warn', '--log-no-colors'],
                    cwd=self.app_dir, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                self.reader = threading.Thread(target=self._drain, args=(self.process.stdout,), daemon=True); self.reader.start()
            while time.monotonic() - started < self.startup_timeout:
                if self.cancel.is_set():
                    self.close(); self._record('cancelled')
                    raise CompanionError('CANCELLED', 'Inicialização cancelada.')
                if self.ready():
                    self._discard_output(); self._record('ready', reused=False, elapsed_seconds=round(time.monotonic()-started, 2))
                    return
                if self.process.poll() is not None:
                    self.reader.join(timeout=1)
                    break
                self.cancel.wait(.4)
            reason = self._failure_reason()
            code = self.process.poll()
        except OSError as error:
            reason = 'access_denied' if isinstance(error, PermissionError) else 'launch_error'
            code = getattr(error, 'winerror', None) or error.errno
        self.close()
        self._record(reason, exit_code=code, elapsed_seconds=round(time.monotonic()-started, 2))
        hints = {
            'port_in_use': 'A porta 4723 foi ocupada por outro serviço. Feche esse serviço e tente novamente.',
            'access_denied': 'O Windows bloqueou a execução do Node/Appium. Confira permissões e o histórico de bloqueios do Windows.',
            'dependencies_missing': 'A instalação do Appium está incompleta. Execute Instalar / verificar todos os requisitos na aba PROGRAMA.',
            'node_version': 'A versão do Node não é compatível. Execute Instalar / verificar todos os requisitos na aba PROGRAMA.',
            'readiness_timeout': 'Appium não respondeu dentro de 90 segundos. Confira os requisitos e se algum bloqueio do Windows aguarda confirmação.',
        }
        message = hints.get(reason, 'O processo Appium encerrou antes de ficar pronto. Execute Instalar / verificar todos os requisitos na aba PROGRAMA.')
        raise CompanionError('APPIUM_START_FAILED', message + ' Use “Ver diagnóstico Appium” na aba PROGRAMA para consultar a causa registrada.')

    def close(self):
        if self.process is not None:
            try:
                if self.process.poll() is None:
                    if os.name == 'nt':
                        subprocess.run(['taskkill', '/PID', str(self.process.pid), '/T', '/F'], capture_output=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
                    else: self.process.terminate()
                    self.process.wait(timeout=5)
            finally:
                if self.reader: self.reader.join(timeout=1)
                self.process = None
                self._discard_output()
