# Python / zyon/browser.py / Python 3.11+ / controlled installed Google Chrome
import hashlib
import os
from pathlib import Path
import re
import time
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
from .android import handle, totp
from .errors import CompanionError

INSTAGRAM = {'www.instagram.com', 'instagram.com', 'accountscenter.instagram.com'}
META = INSTAGRAM | {'www.facebook.com', 'facebook.com', 'business.facebook.com', 'm.facebook.com'}
SITE = {'www.organizafy.site', 'organizafy.site'}


def chrome_path():
    for root in (os.environ.get('PROGRAMFILES'), os.environ.get('PROGRAMFILES(X86)'), os.environ.get('LOCALAPPDATA')):
        if root:
            candidate = Path(root) / 'Google/Chrome/Application/chrome.exe'
            if candidate.is_file(): return str(candidate)
    raise CompanionError('CHROME_MISSING', 'Install Google Chrome using Install requirements in the desktop application.')

class Browser:
    def __init__(self, root, vault, gmail, cancel, progress, pause, context=None, executable=None):
        self.root, self.vault, self.gmail = Path(root), vault, gmail
        self.cancel, self.progress, self.pause_callback = cancel, progress, pause
        self.pause_seconds = 0
        self.context, self.page, self.playwright = context, None, None
        self.executable = executable
        self.username = None

    def clock(self): return time.monotonic() - self.pause_seconds

    def pause(self, reason, message):
        started = time.monotonic()
        try: return self.pause_callback(reason, message)
        finally: self.pause_seconds += time.monotonic() - started

    def check(self):
        if self.cancel.is_set(): raise CompanionError('CANCELLED', 'Workflow stopped. No remaining browser step was executed.')

    def open(self, username, proxy=None):
        self.username = handle(username)
        if self.context is None:
            from playwright.sync_api import sync_playwright
            self.playwright = sync_playwright().start()
            profile = self.root / 'chrome' / hashlib.sha256(self.username.encode()).hexdigest()[:20]
            profile.mkdir(parents=True, exist_ok=True)
            values = {'executable_path': self.executable or chrome_path(), 'headless': False,
                      'viewport': {'width': 1200, 'height': 850}, 'locale': 'pt-BR',
                      'args': ['--no-first-run', '--no-default-browser-check']}
            if proxy:
                parsed = urlsplit(proxy.get('server', ''))
                if parsed.scheme not in ('http', 'https', 'socks5') or not parsed.hostname or parsed.username or parsed.password:
                    raise CompanionError('INVALID_PROXY', 'Use a plain http/https/socks5 proxy URL; enter credentials separately.')
                values['proxy'] = proxy
            self.context = self.playwright.chromium.launch_persistent_context(str(profile), **values)
        self.page = self.context.pages[0] if self.context.pages else self.context.new_page()
        self.page.set_default_timeout(12000)

    def guard(self, allowed):
        self.check()
        parsed = urlsplit(self.page.url)
        if parsed.scheme != 'https' or parsed.hostname not in allowed:
            raise CompanionError('UNEXPECTED_BROWSER_ORIGIN', 'Chrome reached an unexpected page. Passwords and codes were not entered there.')

    def visible(self, selector):
        candidates = self.page.locator(selector)
        return [candidates.nth(i) for i in range(candidates.count()) if candidates.nth(i).is_visible()]

    def button(self, names, within=None):
        area = within or self.page
        locator = area.get_by_role('button', name=re.compile('^(?:' + '|'.join(re.escape(n) for n in names) + ')$', re.I))
        matches = [locator.nth(i) for i in range(locator.count()) if locator.nth(i).is_visible() and locator.nth(i).is_enabled()]
        if len(matches) != 1: return None
        return matches[0]

    def click(self, names, within=None):
        self.check()
        button = self.button(names, within)
        if button is None: raise CompanionError('BROWSER_CONTROL_UNCERTAIN', 'Chrome did not expose a unique expected control. Inspect the page before continuing.')
        button.click()  # Never retry an uncertain click automatically.

    def text(self): return self.page.locator('body').inner_text(timeout=12000)

    def fill_code(self, code):
        self.guard(INSTAGRAM)
        previous_url = self.page.url
        fields = self.visible('input[autocomplete="one-time-code"], input[name="verificationCode"], input[name="security_code"], input[name="confirmationCode"], input[inputmode="numeric"]')
        if len(fields) == 1:
            fields[0].fill(code)
        elif len(fields) == 6:
            for field, digit in zip(fields, code): field.fill(digit)
        else: raise CompanionError('CODE_FORM_UNCERTAIN', 'The verification-code form is not uniquely recognized.')
        self.click(('Continue', 'Continuar', 'Confirm', 'Confirmar', 'Submit', 'Enviar', 'Next', 'Avançar'))
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            self.guard(INSTAGRAM)
            text = self.text().lower()
            if any(word in text for word in ('incorrect code', 'invalid code', 'código incorreto', 'código inválido')):
                raise CompanionError('CODE_REJECTED', 'Instagram rejected the submitted code. No repeated code submission was attempted.')
            if self.page.url != previous_url or not self.visible('input[autocomplete="one-time-code"], input[name="verificationCode"], input[name="security_code"], input[name="confirmationCode"], input[inputmode="numeric"]'):
                return
            self.cancel.wait(.4)
        raise CompanionError('CODE_RESULT_UNCONFIRMED', 'Instagram did not confirm verification-code submission. Inspect the current challenge before retrying.')

    def challenges(self, recipient, sender, since_ms, password=None):
        self.guard(INSTAGRAM)
        text = self.text().lower()
        if any(word in text for word in ('captcha', 'confirm you are human', 'confirme que você é humano')):
            self.pause('instagram_challenge', 'Complete the Instagram security challenge in Chrome, then click Continue here.')
            return True
        if any(word in text for word in ('authentication app', 'aplicativo de autenticação', 'app de autenticação')) and self.visible('input'):
            secret = self.vault.get('instagram:' + self.username) or {}
            if not secret.get('seed') or secret.get('state') != 'active':
                self.pause('authenticator_code', 'Enter your authenticator code in Chrome and continue here.')
                return True
            if time.time() % 30 > 25 and self.cancel.wait(6): self.check()
            self.fill_code(totp(secret['seed']))
            return True
        if any(word in text for word in ('check your email', 'verifique seu email', 'verifique seu e-mail', 'sent a code', 'enviamos um código', 'confirmation code', 'código de confirmação')):
            self.progress('browser_email', 'Retrieving and entering the fresh Instagram email code automatically.')
            result = self.gmail.wait_code(sender, recipient, since_ms, self.cancel)
            self.guard(INSTAGRAM)
            self.fill_code(result['code'])
            result.clear()
            return True
        return False

    def navigation_identity(self):
        links = self.page.get_by_role('link', name=re.compile('^(Profile|Perfil)$', re.I))
        matches = [links.nth(i) for i in range(links.count()) if links.nth(i).is_visible()]
        if len(matches) != 1: return None
        href = matches[0].get_attribute('href') or ''
        parsed = urlsplit(href)
        if parsed.netloc and parsed.hostname not in INSTAGRAM: return None
        try: observed = handle(parsed.path.strip('/'))
        except CompanionError: return None
        if observed != self.username: raise CompanionError('WRONG_BROWSER_ACCOUNT', 'Chrome profile navigation points to another Instagram account.')
        return observed

    def identity(self):
        self.guard(INSTAGRAM)
        observed = self.navigation_identity()
        if observed: return observed
        self.page.goto('https://www.instagram.com/accounts/edit/', wait_until='domcontentloaded')
        end = time.monotonic() + 20
        while time.monotonic() < end:
            self.guard(INSTAGRAM)
            observed = self.navigation_identity()
            if observed: return observed
            inputs = self.visible('input[name="username"], input[aria-label="Username"], input[aria-label="Nome de usuário"]')
            if len(inputs) == 1:
                observed = handle(inputs[0].input_value())
                if observed != self.username: raise CompanionError('WRONG_BROWSER_ACCOUNT', 'The signed-in Chrome Instagram differs from the Android account.')
                return observed
            self.cancel.wait(.4)
        raise CompanionError('BROWSER_IDENTITY_UNCONFIRMED', 'Could not verify the signed-in Instagram from its edit-profile form.')

    def login(self, password, recipient, sender):
        self.page.goto('https://www.instagram.com/accounts/login/', wait_until='domcontentloaded')
        stamp = time.time() * 1000
        submitted = False
        submitted_at = None
        end = self.clock() + 120
        while self.clock() < end:
            self.guard(INSTAGRAM)
            users, passwords = self.visible('input[name="username"]'), self.visible('input[name="password"]')
            if users and passwords:
                if submitted:
                    if time.monotonic() - submitted_at > 25: raise CompanionError('INSTAGRAM_LOGIN_REJECTED', 'Instagram did not leave the password form. Check credentials before retrying.')
                    self.cancel.wait(.5)
                    continue
                if len(users) != 1 or len(passwords) != 1: raise CompanionError('LOGIN_FORM_UNCERTAIN', 'Instagram login controls are ambiguous.')
                users[0].fill(self.username); passwords[0].fill(password)
                stamp = time.time() * 1000
                self.click(('Log in', 'Entrar', 'Log In'))
                submitted = True
                submitted_at = time.monotonic()
                self.cancel.wait(1)
                continue
            if self.challenges(recipient, sender, stamp):
                self.cancel.wait(1)
                continue
            for names in (('Not now', 'Agora não'), ('Only allow essential cookies', 'Permitir apenas cookies essenciais')):
                button = self.button(names)
                if button: button.click(); self.cancel.wait(.5)
            links = self.page.locator('a[href="/accounts/edit/"], a[href="/' + self.username + '/"]')
            if links.count() or urlsplit(self.page.url).path in ('/', '/accounts/onetap/'):
                if '/onetap' in self.page.url and self.button(('Not now', 'Agora não')):
                    self.click(('Not now', 'Agora não'))
                try: return self.identity()
                except CompanionError as failure:
                    if failure.code == 'WRONG_BROWSER_ACCOUNT': raise
            self.cancel.wait(.5)
        raise CompanionError('INSTAGRAM_LOGIN_UNCONFIRMED', 'Chrome login was not confirmed within the deadline.')

    def tester_invitation(self, app_name):
        if not isinstance(app_name, str) or not app_name.strip() or len(app_name) > 150:
            raise CompanionError('TESTER_APP_REQUIRED', 'Enter the exact tester-invitation app name from Meta.')
        self.identity()
        self.page.goto('https://www.instagram.com/accounts/manage_access/', wait_until='domcontentloaded')
        end = time.monotonic() + 90
        while time.monotonic() < end:
            self.guard(INSTAGRAM)
            tab = self.page.get_by_text(re.compile('^(Tester invites|Tester invitations|Convites do testador)$', re.I))
            if tab.count() == 1 and tab.is_visible(): tab.click()
            label = self.page.get_by_text(app_name, exact=True)
            if label.count() == 1 and label.is_visible():
                row = label
                for _ in range(5):
                    row = row.locator('..')
                    remove = self.button(('Remove', 'Remover'), row)
                    accept = self.button(('Accept', 'Aceitar'), row)
                    if remove:
                        self.identity()
                        return {'accepted': True, 'alreadyAccepted': True}
                    if accept:
                        accept.click()
                        # A network timeout after this point never causes a second acceptance.
                        deadline = time.monotonic() + 25
                        while time.monotonic() < deadline:
                            self.guard(INSTAGRAM)
                            if self.button(('Remove', 'Remover'), row):
                                self.identity()
                                return {'accepted': True, 'alreadyAccepted': False}
                            self.cancel.wait(.5)
                        raise CompanionError('INVITATION_UNCONFIRMED', 'Invitation acceptance was not confirmed. Inspect Instagram before retrying.')
            self.cancel.wait(2)
            self.page.reload(wait_until='domcontentloaded')
        raise CompanionError('INVITATION_NOT_FOUND', 'The exact expected Meta tester invitation was not found. No other invitation was accepted.')

    def choose_unique_assets(self):
        selects = self.visible('select')
        for control in selects:
            options = control.locator('option').all()
            valid = [(o.get_attribute('value'), o.inner_text().strip()) for o in options
                     if o.get_attribute('value') and o.get_attribute('disabled') is None]
            expected = [(value, label) for value, label in valid if self.username.lower() in label.lower()]
            choice = expected[0] if len(expected) == 1 else valid[0] if len(valid) == 1 else None
            if choice is None: return False
            control.select_option(choice[0])
        custom = [c for c in self.visible('[role="combobox"]') if c.evaluate('e=>e.tagName') != 'SELECT']
        for control in custom:
            if not control.is_enabled(): continue
            control.click()
            options = self.page.get_by_role('option')
            valid = [options.nth(i) for i in range(options.count()) if options.nth(i).is_visible() and options.nth(i).is_enabled()]
            expected = [option for option in valid if self.username.lower() in option.inner_text().lower()]
            choice = expected[0] if len(expected) == 1 else valid[0] if len(valid) == 1 else None
            if choice is None:
                self.page.keyboard.press('Escape')
                return False
            choice.click()
        return bool(selects or custom) and self.username.lower() in self.text().lower()

    def authorize(self, url, avanca, recipient, sender):
        parsed = urlsplit(url)
        if parsed.hostname not in SITE or parsed.scheme != 'https' or parsed.path != '/instagram/conectar':
            raise CompanionError('INVALID_AUTHORIZATION_LINK', 'Unexpected AVANCA authorization link.')
        fragment = dict(parse_qsl(parsed.fragment)); fragment['direct'] = '1'
        self.page.goto(urlunsplit(parsed._replace(fragment=urlencode(fragment))), wait_until='domcontentloaded')
        stamp, deadline = time.time() * 1000, self.clock() + 120
        while self.clock() < deadline:
            self.check()
            try:
                account = avanca.preflight(self.username)
                return account
            except CompanionError as failure:
                if failure.code != 'ACCOUNT_NOT_CONNECTED': raise
            pages = [p for p in self.context.pages if not p.is_closed()]
            if pages: self.page = pages[-1]
            self.guard(META | SITE)
            host = urlsplit(self.page.url).hostname
            if host in INSTAGRAM and self.challenges(recipient, sender, stamp): continue
            text = self.text()
            if host in SITE:
                choices = self.page.get_by_role('radio', name='@' + self.username, exact=True)
                if choices.count() == 1 and choices.is_visible():
                    choices.check()
                    button = self.button(('Conectar perfil escolhido',))
                    if button:
                        button.click(); self.cancel.wait(1); continue
            if host in META:
                if any(title in text.lower() for title in ('select the business assets', 'selecione os ativos de negócios')):
                    if self.choose_unique_assets():
                        button = self.button(('Continue', 'Continuar'))
                        if button: button.click(); self.cancel.wait(1); continue
                    self.pause('meta_assets', 'Select the intended business portfolio and this exact Instagram in Chrome, then Continue. Ambiguous assets were not selected automatically.')
                    continue
                # Account-specific continuation only; asset selection is never guessed.
                labels = (f'Continue as {self.username}', f'Entrar como {self.username}', f'Continuar como {self.username}',
                          f'Continue as @{self.username}', f'Entrar como @{self.username}')
                button = self.button(labels)
                if button:
                    button.click(); self.cancel.wait(1); continue
                if self.username.lower() in text.lower() and any(label in text.lower() for label in ('review what', 'reveja o que', 'review your', 'revisar')):
                    button = self.button(('Continue', 'Continuar', 'Allow', 'Permitir', 'Save', 'Salvar'))
                    if button:
                        button.click(); self.cancel.wait(1); continue
            self.cancel.wait(2)
        self.pause('meta_consent', 'Complete any Meta asset selection/consent in the controlled Chrome window, then Continue. The desktop app will verify the live account before syncing.')
        return avanca.preflight(self.username)

    def close(self):
        try:
            if self.context is not None: self.context.close()
        finally:
            if self.playwright is not None: self.playwright.stop()
