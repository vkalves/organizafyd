# Python / zyon/android.py / Python 3.11+ / Android 14, Appium UiAutomator2
"""Bounded UI automation. Unsupported screens require inspection on the device."""
import base64
import hashlib
import hmac
from importlib.metadata import PackageNotFoundError, version
import re
import shutil
import struct
import subprocess
import time
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET
from .errors import CompanionError

PACKAGE = "com.instagram.android"
PROFILE = ("Profile", "Perfil")
EDIT = ("Edit profile", "Editar perfil")
MENU = ("Options", "Opções", "More options", "Mais opções", "Menu")
CENTER = ("Accounts Center", "Central de Contas", "Central de contas", "See more in Accounts Center", "Ver mais na Central de Contas")
SECURITY = ("Password and security", "Senha e segurança")
TWO_FACTOR = ("Two-factor authentication", "Autenticação de dois fatores")
AUTH_APP = ("Authentication app", "Aplicativo de autenticação", "App de autenticação")
NEXT = ("Next", "Avançar", "Continue", "Continuar")
ACTIVE = ("Two-factor authentication is on", "Two-factor authentication is enabled", "A autenticação de dois fatores está ativada", "Autenticação de dois fatores ativada")
SETUP = ("Copy key", "Copiar chave", "Setup key", "Chave de configuração", "Can't scan the QR code?", "Não consegue ler o código QR?")
ENTER_CODE = ("Enter code", "Enter confirmation code", "Insira o código", "Digite o código", "Código de confirmação")
BACKUP = ("Backup codes", "Códigos de reserva", "Recovery codes", "Códigos de recuperação")
LOGOUT = ("Log out", "Sair")
LOGIN = ("Log in", "Entrar", "Log into another account", "Entrar em outra conta")


def handle(value):
    if not isinstance(value, str): value = ""
    value = value.strip().removeprefix("@").lower()
    if not re.fullmatch(r"[a-z0-9._]{1,30}", value):
        raise CompanionError("INVALID_HANDLE", "Enter the exact Instagram @handle.")
    return value


def totp(seed, at=None):
    clean = re.sub(r"\s", "", seed).upper()
    key = base64.b32decode(clean + "=" * (-len(clean) % 8))
    digest = hmac.new(key, struct.pack(">Q", int(time.time() if at is None else at) // 30), hashlib.sha1).digest()
    offset = digest[-1] & 15
    return f"{(struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7fffffff) % 1000000:06d}"


class Screen:
    def __init__(self, source):
        if len(source) > 4 * 1024 * 1024:
            raise CompanionError("SCREEN_TOO_LARGE", "Unexpected Android hierarchy. Inspect the phone.")
        self.root = ET.fromstring(source)
        self.nodes = list(self.root.iter("node"))
        # Appium page source uses class names as tags on some driver versions.
        if not self.nodes: self.nodes = list(self.root.iter())[1:]
        self.parents = {child: parent for parent in self.root.iter() for child in parent}

    def labels(self, node):
        return (node.get("text", "").strip(), node.get("content-desc", "").strip())

    def matches(self, labels):
        return [n for n in self.nodes if n.get("displayed", "true") != "false" and any(v in labels for v in self.labels(n) if v)]

    def controls(self, labels):
        grouped = {}
        for node in self.matches(labels):
            target = node
            ancestor = self.parents.get(node)
            for _ in range(4):
                if target.get('clickable') == 'true': break
                if ancestor is None: break
                if ancestor.get('clickable') == 'true':
                    target = ancestor
                    break
                ancestor = self.parents.get(ancestor)
            prior = grouped.get(target)
            # Click the labelled descendant while grouping duplicate labels from
            # its single clickable container. Distinct buttons stay ambiguous.
            if prior is None or node.get('text') and not prior.get('text'):
                grouped[target] = node
        return list(grouped.values())

    def has(self, labels): return bool(self.matches(labels))

    def method_active(self):
        for node in self.matches(AUTH_APP):
            row = self.parents.get(node)
            # Inspect only the immediate method row, never unrelated settings.
            if row is not None:
                labels = [v for n in row.iter() for v in self.labels(n)]
                if any(v in ("On", "Ativado", "Ativada") for v in labels) and not any(v in ("Off", "Desativado", "Desativada", "Text message", "Mensagem de texto", "SMS", "WhatsApp") for v in labels): return True
        return self.has(ACTIVE)

    def profile_handle(self):
        if not self.has(EDIT):
            raise CompanionError("PROFILE_REQUIRED", "Open the intended Instagram profile on the phone, then retry.")
        candidates = set()
        for node in self.nodes:
            rid = node.get("resource-id", "").split("/")[-1]
            if rid in ("profile_header_username", "action_bar_title", "profile_header_username_textview"):
                value = node.get("text", "").strip().removeprefix("@").lower()
                if re.fullmatch(r"[a-z0-9._]{1,30}", value): candidates.add(value)
        if len(candidates) != 1:
            raise CompanionError("IDENTITY_UNCERTAIN", "The profile @ could not be read uniquely. No account action was performed.")
        return candidates.pop()

    def seed(self):
        if not self.has(SETUP): return None
        found = set()
        for node in self.nodes:
            text = node.get("text", "").strip()
            if re.fullmatch(r"[A-Z2-7]{4}(?: [A-Z2-7]{4}){3,15}|[A-Z2-7]{16,64}", text):
                found.add(text.replace(" ", ""))
        if len(found) > 1:
            raise CompanionError("SEED_UNCERTAIN", "More than one setup key was found. Complete 2FA on the phone.")
        return next(iter(found), None)

    def backup_codes(self):
        if not self.has(BACKUP): return []
        found = set()
        for node in self.nodes:
            text = node.get("text", "").strip()
            if re.fullmatch(r"\d{4} ?\d{4}", text): found.add(text.replace(" ", ""))
        return sorted(found) if len(found) >= 5 else []


def devices(adb="adb"):
    executable = shutil.which(adb)
    if not executable:
        raise CompanionError("ADB_MISSING", "Install Android SDK Platform Tools and add adb to PATH, then restart the companion.")
    try:
        result = subprocess.run([executable, "devices", "-l"], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=15, check=True, creationflags=0x08000000 if __import__('os').name == 'nt' else 0)
    except (OSError, subprocess.SubprocessError):
        raise CompanionError("ADB_FAILED", "ADB could not list devices. Check USB debugging and the cable.") from None
    found = []
    for line in result.stdout.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2: found.append({"serial": parts[0], "state": parts[1]})
    return found


def client_components():
    try:
        # Appium reads its distribution metadata while importing WebDriver.
        version('Appium-Python-Client')
        from appium import webdriver
        from appium.options.android import UiAutomator2Options
        from appium.webdriver.client_config import AppiumClientConfig
        from selenium.webdriver.common.proxy import Proxy
        return webdriver, UiAutomator2Options, AppiumClientConfig, Proxy
    except (ImportError, PackageNotFoundError):
        raise CompanionError('ANDROID_CLIENT_INCOMPLETE', 'O cliente Android do executável está incompleto. Instale a versão corrigida do Zyon; reinstalar o SDK não corrige os arquivos internos do app.') from None


def session_failure(error):
    # Classify locally; never put raw driver responses or command arguments in logs.
    text = str(error).lower()
    checks = (
        (('install_failed_user_restricted',), 'DEVICE_INSTALL_BLOCKED', 'O Android bloqueou a instalação dos componentes UiAutomator2. Desbloqueie o telefone, autorize a instalação por USB e confirme os diálogos no aparelho.'),
        (('unauthorized',), 'DEVICE_UNAUTHORIZED', 'Autorize a depuração USB deste computador no telefone desbloqueado.'),
        (('device offline',), 'DEVICE_OFFLINE', 'O telefone ficou offline. Reconecte o cabo USB e consulte os dispositivos na aba ADB.'),
        (('could not find a driver', 'uiautomator2 driver is not installed'), 'UIAUTOMATOR2_MISSING', 'Instale / verifique todos os requisitos na aba PROGRAMA para registrar o UiAutomator2.'),
        (('install_failed',), 'ANDROID_HELPER_INSTALL_FAILED', 'A instalação dos componentes Android falhou. Confira espaço livre e os diálogos de instalação no telefone.'),
        (('securityexception', 'permission denial'), 'ANDROID_PERMISSION_REQUIRED', 'O Android recusou uma permissão necessária. Confira os diálogos e as opções de depuração USB no telefone.'),
        (('timed out', 'timeout'), 'ANDROID_SESSION_TIMEOUT', 'A sessão Android excedeu o tempo limite. Desbloqueie o telefone e confirme os diálogos de instalação/depuração antes de tentar novamente.'),
    )
    for patterns, code, message in checks:
        if any(pattern in text for pattern in patterns): return CompanionError(code, message)
    return CompanionError('ANDROID_SESSION_FAILED', 'A sessão UiAutomator2 ou a abertura do Instagram falhou. Confira o telefone desbloqueado, a instalação do Instagram e os requisitos Android.')


def xpath_literal(value):
    if "'" not in value: return "'" + value + "'"
    if '"' not in value: return '"' + value + '"'
    return "concat(" + ',"\'",'.join("'" + p + "'" for p in value.split("'")) + ")"


class Android:
    def __init__(self, serial, endpoint, vault, cancel, progress, adb="adb", driver=None):
        endpoint_parts = urlsplit(endpoint)
        if endpoint_parts.scheme != "http" or endpoint_parts.hostname != "127.0.0.1" or endpoint_parts.username or endpoint_parts.password or endpoint_parts.query or endpoint_parts.fragment or endpoint_parts.path not in ("", "/"):
            raise CompanionError("LOCAL_APPIUM_REQUIRED", "Use a local Appium endpoint such as http://127.0.0.1:4723.")
        self.serial, self.endpoint, self.vault = serial, endpoint, vault
        self.cancel, self.progress, self.driver = cancel, progress, driver
        self.adb = adb

    def open(self):
        if self.driver is not None: return
        self.progress('android_client_loading', 'Carregando o cliente Android e verificando seus arquivos internos.')
        webdriver, UiAutomator2Options, AppiumClientConfig, Proxy = client_components()
        self.progress('adb_device_check', 'Verificando a autorização USB do telefone selecionado.')
        selected = next((d for d in devices(self.adb) if d['serial'] == self.serial), None)
        if selected and selected['state'] == 'unauthorized':
            raise CompanionError('DEVICE_UNAUTHORIZED', 'Desbloqueie o telefone e aceite a autorização de depuração USB deste computador.')
        if selected and selected['state'] == 'offline':
            raise CompanionError('DEVICE_OFFLINE', 'O telefone está offline. Reconecte o cabo USB e consulte os dispositivos na aba ADB.')
        if not selected or selected['state'] != 'device':
            raise CompanionError('DEVICE_NOT_READY', 'Selecione seu telefone autorizado na aba ADB. Desbloqueie o Android e aceite a autorização USB.')
        try:
            options = UiAutomator2Options().load_capabilities({"platformName": "Android", "appium:automationName": "UiAutomator2",
                "appium:udid": self.serial, "appium:noReset": True, "appium:newCommandTimeout": 120,
                "appium:appPackage": PACKAGE, "appium:autoLaunch": False, "appium:dontStopAppOnReset": True,
                "appium:settings[waitForIdleTimeout]": 1000, "appium:settings[waitForSelectorTimeout]": 1000,
                "appium:skipLogcatCapture": True, "appium:settings[ignoreUnimportantViews]": False})
            config = AppiumClientConfig(remote_server_addr=self.endpoint, timeout=60, proxy=Proxy({'proxyType': 'direct'}))
            self.progress('android_session_start', 'Criando a sessão UiAutomator2. Confirme as permissões solicitadas no telefone.')
            self.driver = webdriver.Remote(options=options, client_config=config)
            self.progress('instagram_launch', 'Abrindo o Instagram nativo no telefone selecionado.')
            self.driver.activate_app(PACKAGE)
        except CompanionError: raise
        except Exception as error:
            raise session_failure(error) from None

    def screen(self):
        if self.cancel.is_set(): raise CompanionError("CANCELLED", "Stopped. Inspect the phone before starting again.")
        if self.driver.current_package != PACKAGE:
            raise CompanionError("WRONG_APP", "Instagram is not the active app. Return to it on the phone.")
        try: return Screen(self.driver.page_source)
        except ET.ParseError:
            raise CompanionError("SCREEN_UNREADABLE", "Android hierarchy could not be read. Inspect the device.") from None

    def wait(self, predicate, message, seconds=20):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            screen = self.screen()
            if predicate(screen): return screen
            self.cancel.wait(.4)
        raise CompanionError("SCREEN_NOT_RECOGNIZED", message)

    def click(self, labels):
        screen = self.screen()
        candidates = screen.controls(labels)
        if len(candidates) != 1:
            raise CompanionError("CONTROL_UNCERTAIN", "Expected one matching Instagram control. Inspect the screen, then retry from the profile.")
        node = candidates[0]
        conditions = []
        for key in ("resource-id", "text", "content-desc"):
            if node.get(key): conditions.append("@" + key + "=" + xpath_literal(node.get(key)))
        if not conditions: raise CompanionError("CONTROL_UNCERTAIN", "The control has no stable selector.")
        elements = [e for e in self.driver.find_elements("xpath", "//*[" + " and ".join(conditions) + "]") if e.is_displayed() and e.is_enabled()]
        if len(elements) != 1:
            raise CompanionError("CONTROL_UNCERTAIN", "Instagram changed the target control. No tap was sent.")
        elements[0].click()  # Never blindly retry a click after an uncertain response.

    def assert_profile(self, expected):
        current = self.screen().profile_handle()
        if current != expected:
            raise CompanionError("WRONG_ACCOUNT", "The open Instagram profile differs from the configured @. Switch accounts manually and retry.")
        self.progress("identity_verified", "Native profile identity verified.")

    def security_screen(self, expected):
        self.assert_profile(expected)
        self.click(MENU)
        self.wait(lambda s: s.has(CENTER), "Open Accounts Center manually and return to the profile before retrying.")
        self.click(CENTER)
        self.wait(lambda s: s.has(SECURITY), "Accounts Center security menu was not recognized.")
        self.click(SECURITY)
        self.wait(lambda s: s.has(TWO_FACTOR), "Two-factor settings were not recognized.")
        self.click(TWO_FACTOR)
        self.wait(lambda s: s.has((expected, "@" + expected)), "Choose the expected Instagram account on the phone, then retry from its profile.")
        # Explicit account selection; a previous device/profile identity is insufficient here.
        self.click((expected, "@" + expected))
        return self.wait(lambda s: s.has(AUTH_APP) or s.has(ACTIVE), "The selected account's 2FA screen was not recognized.")

    def ensure_two_factor(self, expected):
        expected = handle(expected)
        screen = self.security_screen(expected)
        if screen.method_active():
            self.progress("two_factor_verified", "Authentication-app 2FA is already active for the selected account.")
            return {"twoFactor": True, "alreadyEnabled": True}
        self.progress("enrolling_two_factor", "Configuring authentication-app 2FA.")
        self.click(AUTH_APP)
        screen = self.wait(lambda s: s.has(NEXT) or s.has(SETUP), "Complete the security challenge on the phone, then retry from the profile.")
        if not screen.has(SETUP):
            self.click(NEXT)
            screen = self.wait(lambda s: s.has(SETUP), "The authenticator setup-key screen was not recognized. Complete enrollment on the phone.")
        seed = screen.seed()
        if not seed:
            # Some builds show the key behind a separate exact 'Copy key' control.
            raise CompanionError("SETUP_KEY_UNAVAILABLE", "The setup key is not visible in Android accessibility. Complete 2FA on the phone, then retry from the profile.")
        self.vault.put("instagram:" + expected, {"seed": seed, "state": "pending", "backupCodes": []})
        self.click(NEXT)
        self.wait(lambda s: s.has(ENTER_CODE), "The authenticator code form was not recognized. Finish enrollment on the phone.")
        inputs = [e for e in self.driver.find_elements("class name", "android.widget.EditText") if e.is_displayed() and e.is_enabled()]
        if len(inputs) != 1:
            raise CompanionError("CODE_FORM_UNCERTAIN", "Expected exactly one authenticator code field. Complete the form on the phone.")
        if time.time() % 30 > 25:
            if self.cancel.wait(6): raise CompanionError("CANCELLED", "Enrollment stopped before code submission.")
        inputs[0].send_keys(totp(seed))
        self.click(NEXT)
        screen = self.wait(lambda s: s.method_active(), "2FA activation was not confirmed. Inspect Instagram before retrying.", seconds=30)
        secret = self.vault.get("instagram:" + expected)
        secret["state"] = "active"
        self.vault.put("instagram:" + expected, secret)
        self.progress("two_factor_verified", "Instagram confirmed 2FA activation; authenticator key encrypted locally.")
        return {"twoFactor": True, "alreadyEnabled": False}

    def collect_recovery(self, expected):
        screen = self.screen()
        if screen.has(BACKUP) and not screen.backup_codes():
            self.click(BACKUP)
            screen = self.wait(lambda s: bool(s.backup_codes()), "Save the recovery codes on the phone before confirming the recovery step.")
        codes = screen.backup_codes()
        if codes:
            secret = self.vault.get("instagram:" + expected) or {}
            secret["backupCodes"] = codes
            self.vault.put("instagram:" + expected, secret)
        return bool(codes)

    def logout(self, expected):
        # A new identity+2FA read is mandatory at logout, even after a restart.
        expected = handle(expected)
        self.security_screen(expected)
        if not self.screen().method_active():
            raise CompanionError("TWO_FACTOR_UNCONFIRMED", "2FA is not visibly active. Logout blocked.")
        self.progress("two_factor_verified", "2FA rechecked immediately before logout.")
        for _ in range(7):
            screen = self.screen()
            try:
                if screen.profile_handle() == expected: break
            except CompanionError: pass
            self.driver.back()
            self.cancel.wait(.5)
        self.assert_profile(expected)
        self.click(MENU)
        self.wait(lambda s: s.has(CENTER), "The profile settings menu was not recognized.")
        # Android's scrollIntoView searches semantic text, not screen coordinates.
        targets = ("Log out " + expected, "Sair de " + expected, *LOGOUT)
        if not self.screen().has(targets):
            from appium.webdriver.common.appiumby import AppiumBy
            expression = 'new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().textMatches("^(Log out|Sair)( ' + expected.replace('.', '\\.') + '| de ' + expected.replace('.', '\\.') + ')?$"))'
            self.driver.find_element(AppiumBy.ANDROID_UIAUTOMATOR, expression)
        screen = self.screen()
        # Never choose 'Log out all accounts'. Generic logout is acceptable only when
        # no all-accounts option exists in this single-account settings hierarchy.
        if screen.has(("Log out all accounts", "Sair de todas as contas")) and not screen.has(targets[:2]):
            raise CompanionError("LOGOUT_SCOPE_UNCERTAIN", "Only an all-accounts logout is exposed. Log out the intended account manually.")
        self.click(targets[:2] if screen.has(targets[:2]) else LOGOUT)
        screen = self.wait(lambda s: s.has(LOGOUT) or s.has(LOGIN), "Inspect the logout confirmation on the phone.")
        if not screen.has(LOGIN):
            if not screen.has((expected, "@" + expected, "Log out of your account?", "Sair da sua conta?")):
                raise CompanionError("LOGOUT_SCOPE_UNCERTAIN", "Logout confirmation identity is unclear. Confirm the intended account on the phone.")
            self.click(LOGOUT)
        self.wait(lambda s: s.has(LOGIN) and not s.has(EDIT), "Logout is not confirmed. Inspect the phone; do not start another account.")
        self.progress("native_complete", "Native logout confirmed by Instagram's login screen.")
        return {"loggedOut": True, "username": expected}

    def close(self):
        if self.driver is not None:
            try: self.driver.quit()
            except Exception: pass
