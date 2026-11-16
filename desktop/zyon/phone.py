# Python / zyon/phone.py / Python 3.11+ / reference Android workflow executor
import base64
import hashlib
from datetime import date
import os
from pathlib import Path
import re
import subprocess
import time
import unicodedata
from .android import Android, Screen, EDIT, NEXT, PACKAGE, xpath_literal
from .errors import CompanionError

SIGNUP_PHONE = ("What's your mobile number?", "What's your phone number?", 'Qual é o número do seu celular?', 'Qual é seu número de celular?', 'Qual é o seu número de celular?')
SIGNUP_EMAIL = ("What's your email?", "What's your email address?", 'Qual é seu email?', 'Qual é seu e-mail?', 'Qual é o seu email?', 'Qual é o seu e-mail?', 'Qual é o seu endereço de email?', 'Qual é o seu endereço de e-mail?')
SIGNUP_WITH_EMAIL = ('Cadastrar-se com o email', 'Cadastrar-se com o e-mail', 'Cadastrar-se com email', 'Cadastrar-se com e-mail', 'Cadastre-se com email', 'Sign up with email', 'Sign up with email address')

class Phone(Android):
    def __init__(self, *args, gmail, pause, journal, **kwargs):
        super().__init__(*args, **kwargs)
        self.gmail, self.pause_callback, self.journal = gmail, pause, journal
        self.pause_seconds = 0
        self.media_albums = {}

    def clock(self): return time.monotonic() - self.pause_seconds

    def pause(self, reason, message):
        started = time.monotonic()
        try: return self.pause_callback(reason, message)
        finally: self.pause_seconds += time.monotonic() - started

    def resource(self, name):
        elements = [e for e in self.driver.find_elements('id', PACKAGE + ':id/' + name) if e.is_displayed() and e.is_enabled()]
        if len(elements) != 1: return None
        return elements[0]

    def profile(self, expected):
        for _ in range(8):
            screen = self.screen()
            if screen.has(EDIT): self.assert_profile(expected); return
            tab = self.resource('profile_tab')
            if tab:
                tab.click()
                self.wait(lambda s: s.has(EDIT), 'Instagram profile did not load.')
                self.assert_profile(expected); return
            self.driver.back()
            self.cancel.wait(.4)
        raise CompanionError('PROFILE_UNAVAILABLE', 'Could not return to the expected own profile.')

    def inputs(self):
        return [e for e in self.driver.find_elements('class name', 'android.widget.EditText') if e.is_displayed() and e.is_enabled()]

    def fill_one(self, value):
        self.screen()
        fields = self.inputs()
        if len(fields) != 1: raise CompanionError('NATIVE_FORM_UNCERTAIN', 'Android did not expose one expected input field.')
        fields[0].clear(); fields[0].send_keys(value)

    def fill_code(self, value):
        self.screen()
        fields = self.inputs()
        if len(fields) == 1: fields[0].send_keys(value)
        elif len(fields) == 6:
            for field, digit in zip(fields, value): field.send_keys(digit)
        else: raise CompanionError('NATIVE_CODE_UNCERTAIN', 'Instagram code fields were not uniquely recognized.')

    def login_existing(self, settings):
        screen = self.screen()
        if screen.has(EDIT): self.assert_profile(settings['username']); return
        if self.resource('profile_tab'):
            self.profile(settings['username']); return
        login = self.resource('login_username')
        password = self.resource('password') or self.resource('login_password')
        if not login or not password:
            self.pause('native_login', 'Open the intended Instagram login/profile on the phone, then Continue. The app will verify its @.')
            self.profile(settings['username']); return
        login.send_keys(settings['username']); password.send_keys(settings['instagram_password'])
        since = time.time() * 1000
        self.click(('Log in', 'Entrar'))
        end = time.monotonic() + 100
        while time.monotonic() < end:
            screen = self.screen()
            if screen.has(EDIT) or self.resource('profile_tab'):
                self.profile(settings['username']); return
            if screen.has(('Enter confirmation code', 'Insira o código de confirmação', 'Enter security code', 'Insira o código de segurança')):
                code = self.gmail.wait_code(settings['email_sender'], settings['recipient'], since, self.cancel)
                self.fill_code(code['code']); code.clear(); self.click(NEXT)
            elif screen.has(('Not now', 'Agora não')): self.click(('Not now', 'Agora não'))
            self.cancel.wait(.5)
        raise CompanionError('NATIVE_LOGIN_UNCONFIRMED', 'Native Instagram login did not reach a verified profile.')

    def calendar_birthday(self, desired):
        from appium.webdriver.common.appiumby import AppiumBy
        def picker():
            if self.cancel.is_set(): raise CompanionError('CANCELLED', 'Date selection stopped.')
            if self.driver.current_package not in (PACKAGE, 'android'):
                raise CompanionError('BIRTHDAY_PICKER_UNCERTAIN', 'The date picker is no longer the active application.')
            return Screen(self.driver.page_source)
        years = [e for e in self.driver.find_elements('id', 'android:id/date_picker_header_year') if e.is_displayed()]
        if len(years) != 1: return False
        years[0].click()
        expression = 'new UiScrollable(new UiSelector().resourceId("android:id/date_picker_year_picker")).setMaxSearchSwipes(30).scrollIntoView(new UiSelector().text("' + str(desired.year) + '"))'
        try: self.driver.find_element(AppiumBy.ANDROID_UIAUTOMATOR, expression)
        except Exception: return False
        xpath = '//*[@text=' + xpath_literal(str(desired.year)) + ' and not(@resource-id="android:id/date_picker_header_year")]'
        choices = [e for e in self.driver.find_elements('xpath', xpath) if e.is_displayed() and e.is_enabled()]
        if len(choices) != 1: return False
        choices[0].click()
        month_names = [('january','janeiro','jan'),('february','fevereiro','feb','fev'),('march','marco','mar'),('april','abril','apr','abr'),('may','maio','mai'),('june','junho','jun'),('july','julho','jul'),('august','agosto','aug','ago'),('september','setembro','sep','set'),('october','outubro','oct','out'),('november','novembro','nov'),('december','dezembro','dec','dez')]
        for direction, attempts in ((('Next month', 'Próximo mês', 'Próximo'), 12), (('Previous month', 'Mês anterior', 'Anterior'), 24)):
            for _ in range(attempts + 1):
                current = picker()
                matches = []
                for node in current.nodes:
                    label = node.get('content-desc', '')
                    normalized = unicodedata.normalize('NFKD', label).encode('ascii', 'ignore').decode().lower()
                    words = re.findall(r'[a-z]+|\d+', normalized)
                    if str(desired.year) in words and str(desired.day) in words and any(m in words for m in month_names[desired.month-1]):
                        matches.append(label)
                if len(set(matches)) == 1:
                    label = matches[0]
                    days = [e for e in self.driver.find_elements('xpath', '//*[@content-desc=' + xpath_literal(label) + ']') if e.is_displayed() and e.is_enabled()]
                    if len(days) != 1: return False
                    days[0].click()
                    selected = [e for e in self.driver.find_elements('xpath', '//*[@content-desc=' + xpath_literal(label) + ']') if e.is_displayed()]
                    if len(selected) != 1 or selected[0].get_attribute('selected') != 'true': return False
                    confirm = current.controls(('OK', 'Set', 'Definir'))
                    if len(confirm) != 1: return False
                    buttons = [e for e in self.driver.find_elements('xpath', '//*[@text=' + xpath_literal(confirm[0].get('text', 'OK')) + ']') if e.is_displayed() and e.is_enabled()]
                    if len(buttons) != 1: return False
                    buttons[0].click(); return True
                controls = current.controls(direction)
                if len(controls) != 1: return False
                label = controls[0].get('content-desc') or controls[0].get('text')
                controls = [e for e in self.driver.find_elements('xpath', '//*[@content-desc=' + xpath_literal(label) + ' or @text=' + xpath_literal(label) + ']') if e.is_displayed() and e.is_enabled()]
                if len(controls) != 1: return False
                controls[0].click(); self.cancel.wait(.2)
        return False

    def birthday(self, birthday):
        desired = date.fromisoformat(birthday)
        labels = ('Set date', 'Definir data', 'Date of birth', 'Data de nascimento')
        if self.screen().has(labels): self.click(labels)
        elif len(self.inputs()) == 1: self.inputs()[0].click()
        else:
            self.pause('birthday_picker', 'Set and confirm your configured date of birth (' + birthday + ') on the phone, then Continue.')
            return
        # Date picker is an Android system dialog, so read only its known hierarchy.
        picker = Screen(self.driver.page_source)
        if self.driver.current_package not in (PACKAGE, 'android'):
            raise CompanionError('BIRTHDAY_PICKER_UNCERTAIN', 'An unexpected date-picker application opened.')
        values = {'year': str(desired.year), 'month': str(desired.month), 'day': str(desired.day)}
        complete = True
        for name, value in values.items():
            containers = self.driver.find_elements('id', 'android:id/' + name)
            if len(containers) != 1: complete = False; break
            fields = containers[0].find_elements('class name', 'android.widget.EditText')
            if len(fields) != 1: complete = False; break
            fields[0].clear(); fields[0].send_keys(value)
            observed = (fields[0].get_attribute('text') or '').strip().lower().rstrip('.')
            month_labels = [('jan','january','janeiro'),('feb','fev','february','fevereiro'),('mar','march','março'),('apr','abr','april','abril'),('may','mai','maio'),('jun','june','junho'),('jul','july','julho'),('aug','ago','august','agosto'),('sep','set','september','setembro'),('oct','out','october','outubro'),('nov','november','novembro'),('dec','dez','december','dezembro')]
            valid = (str(desired.month), f'{desired.month:02d}', *month_labels[desired.month-1]) if name == 'month' else (value, value.zfill(2))
            if observed not in valid: complete = False; break
        if not complete:
            if self.calendar_birthday(desired): return
            self.pause('birthday_picker', 'Set your configured date of birth (' + birthday + ') in the Android date picker, confirm it, then Continue.')
            return
        labels = ('OK', 'Set', 'Definir')
        matches = picker.matches(labels)
        if len(matches) != 1: raise CompanionError('BIRTHDAY_PICKER_UNCERTAIN', 'Date picker confirmation was not unique.')
        elements = self.driver.find_elements('xpath', '//*[@text=' + xpath_literal(matches[0].get('text')) + ']')
        if len(elements) != 1: raise CompanionError('BIRTHDAY_PICKER_UNCERTAIN', 'Date picker confirmation changed.')
        elements[0].click()

    def create_account(self, settings):
        headings = {
            'email': SIGNUP_EMAIL,
            'code': ('Enter confirmation code', 'Insira o código de confirmação'),
            'password': ('Create a password', 'Crie uma senha'),
            'birthday': ("What's your birthday?", 'Qual é sua data de nascimento?', 'Qual é a sua data de nascimento?'),
            'name': ("What's your name?", 'Qual é seu nome?', 'Qual é o seu nome?'),
            'username': ('Create a username', 'Crie um nome de usuário'),
            'terms': ("Agree to Instagram's terms and policies", 'Concorde com os termos e políticas do Instagram'),
        }
        since = None
        handled = set()
        deadline = self.clock() + 480
        unknown_since = None
        while self.clock() < deadline:
            screen = self.screen()
            if screen.has(EDIT) or self.resource('profile_tab'):
                self.profile(settings['username'])
                self.progress('native_created' if 'terms' in handled else 'native_identity', 'The configured Instagram account was confirmed from its own profile.')
                return
            if screen.has(('Create new account', 'Criar nova conta')):
                self.click(('Create new account', 'Criar nova conta')); self.cancel.wait(.5); continue
            if screen.has(SIGNUP_PHONE) and screen.has(SIGNUP_WITH_EMAIL):
                self.progress('native_signup_email_method', 'Selecionando o cadastro por email no Instagram.')
                self.click(SIGNUP_WITH_EMAIL)
                self.wait(lambda s: s.has(SIGNUP_EMAIL) and not s.has(SIGNUP_PHONE), 'O cadastro por email não abriu. Confira a tela do Instagram antes de tentar novamente.', seconds=20)
                unknown_since = None
                continue
            current = next((name for name, labels in headings.items() if screen.has(labels)), None)
            if current and current in handled:
                raise CompanionError('SIGNUP_INPUT_REJECTED', 'Instagram kept the same signup step after submission (' + current + '). Inspect its validation before retrying.')
            if current == 'email':
                self.fill_one(settings['recipient']); since = time.time() * 1000; self.click(NEXT)
            elif current == 'code':
                if since is None: raise CompanionError('EMAIL_CHALLENGE_UNBOUND', 'The native email challenge has no fresh request timestamp.')
                code = self.gmail.wait_code(settings['email_sender'], settings['recipient'], since, self.cancel)
                self.fill_code(code['code']); code.clear(); self.click(NEXT)
            elif current == 'password': self.fill_one(settings['instagram_password']); self.click(NEXT)
            elif current == 'birthday': self.birthday(settings['birthday']); self.click(NEXT)
            elif current == 'name': self.fill_one(settings['full_name']); self.click(NEXT)
            elif current == 'username': self.fill_one(settings['username']); self.click(NEXT)
            elif current == 'terms': self.click(('I agree', 'Concordo', 'Agree', 'Concordar'))
            elif screen.has(('Skip', 'Pular')): self.click(('Skip', 'Pular'))
            elif screen.has(('Done', 'Concluir', 'Finish', 'Concluir configuração')): self.click(('Done', 'Concluir', 'Finish', 'Concluir configuração'))
            elif screen.has(('Email', 'E-mail')) and screen.has(('Phone', 'Telefone')): self.click(('Email', 'E-mail'))
            else:
                if unknown_since is None: unknown_since = self.clock()
                if self.clock() - unknown_since < 12:
                    self.cancel.wait(.5); continue
                self.pause('native_signup_screen', 'Instagram showed an unrecognized onboarding or permission screen. Complete it on the phone, then Continue.')
                unknown_since = None
                continue
            unknown_since = None
            if current: handled.add(current)
            self.cancel.wait(.7)
            if current:
                self.wait(lambda s: not s.has(headings[current]), 'Instagram did not accept the ' + current + ' step.', seconds=30)
        raise CompanionError('SIGNUP_UNCONFIRMED', 'Account creation did not reach a verified own profile.')

    def bio(self, expected, value):
        if not value: return
        self.profile(expected); self.click(EDIT)
        self.wait(lambda s: s.has(('Bio', 'Biografia')), 'Edit-profile bio control was not recognized.')
        self.click(('Bio', 'Biografia'))
        self.wait(lambda s: bool(self.inputs()), 'Bio input did not open.')
        self.fill_one(value)
        self.click(('Done', 'Concluir', 'Save', 'Salvar'))
        self.wait(lambda s: s.has(('Bio', 'Biografia')), 'Bio save was not confirmed.')
        self.driver.back(); self.profile(expected)
        if value not in ' '.join(v for n in self.screen().nodes for v in self.screen().labels(n)):
            raise CompanionError('BIO_UNCONFIRMED', 'Saved bio was not visible on the profile.')

    def professional(self, expected, category):
        if not category: return
        self.profile(expected)
        if self.screen().has(('Professional dashboard', 'Painel profissional')): return
        self.click(EDIT)
        self.wait(lambda s: s.has(('Switch to professional account', 'Mudar para conta profissional')), 'Professional conversion entry was not found.')
        self.click(('Switch to professional account', 'Mudar para conta profissional'))
        for _ in range(10):
            screen = self.screen()
            if screen.has((category,)):
                self.click((category,))
                self.click(('Done', 'Concluir', 'Next', 'Avançar'))
                self.wait(lambda s: not s.has((category,)) or s.has(('Creator', 'Criador de conteúdo')), 'Professional category submission was not confirmed.')
            elif screen.has(('What category best describes you?', 'Qual categoria mais bem descreve você?', 'Qual categoria melhor descreve você?')) and len(self.inputs()) == 1:
                self.fill_one(category)
                self.wait(lambda s: s.has((category,)), 'The configured professional category was not found.')
            elif screen.has(('Creator', 'Criador de conteúdo')):
                self.click(('Creator', 'Criador de conteúdo')); self.click(NEXT)
            elif screen.has(('Professional dashboard', 'Painel profissional')):
                self.profile(expected); return
            elif screen.has(('Skip', 'Pular')): self.click(('Skip', 'Pular'))
            elif screen.has(('OK',)): self.click(('OK',))
            elif screen.has(('Continue', 'Continuar', 'Next', 'Avançar')): self.click(('Continue', 'Continuar', 'Next', 'Avançar'))
            else:
                self.pause('professional_screen', 'Complete the current professional-account setup screen for this @, then Continue.')
            self.cancel.wait(.7)
        self.profile(expected)
        if not self.screen().has(('Professional dashboard', 'Painel profissional')):
            raise CompanionError('PROFESSIONAL_UNCONFIRMED', 'Instagram professional-account conversion was not confirmed.')

    def media(self, filename, kind, expected, expected_digest=None):
        path = Path(filename)
        if not path.is_file() or path.stat().st_size > 50 * 1024 * 1024 or path.suffix.lower() not in ('.jpg', '.jpeg', '.png', '.mp4'):
            raise CompanionError('INVALID_MEDIA', 'Choose an existing JPG/PNG/MP4 file of at most 50 MiB.')
        remote_name = 'zyon_' + kind + '_' + expected.replace('.', '_') + path.suffix.lower()
        with path.open('rb') as source: data = source.read(50 * 1024 * 1024 + 1)
        digest = hashlib.sha256(data).hexdigest()
        if len(data) > 50 * 1024 * 1024 or expected_digest and digest != expected_digest:
            raise CompanionError('MEDIA_CHANGED', 'The selected media changed after the workflow started. No transfer or publication was sent.')
        album = 'Zyon_' + kind + '_' + hashlib.sha256((expected + ':' + digest).encode()).hexdigest()[:16]
        remote_dir = '/sdcard/Pictures/' + album
        remote = remote_dir + '/' + remote_name
        subprocess.run([self.adb, '-s', self.serial, 'shell', 'mkdir', '-p', remote_dir], capture_output=True, timeout=15, check=True, creationflags=0x08000000 if os.name == 'nt' else 0)
        self.driver.push_file(remote, base64.b64encode(data).decode())
        self.media_albums[remote_name] = album
        command = [self.adb, '-s', self.serial, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', 'file://' + remote]
        subprocess.run(command, capture_output=True, timeout=20, check=True, creationflags=0x08000000 if os.name == 'nt' else 0)
        return remote_name

    def choose_uploaded_album(self, album):
        # A content-specific album contains only the uploaded configured asset.
        # No arbitrary first/recent image or screen coordinate is selected.
        from appium.webdriver.common.appiumby import AppiumBy
        def matching(text):
            return [e for e in self.driver.find_elements('xpath', '//*[@text=' + xpath_literal(text) + ' or @content-desc=' + xpath_literal(text) + ']') if e.is_displayed() and e.is_enabled()]
        options = matching(album)
        if not options and self.driver.current_package == PACKAGE:
            menu = self.resource('gallery_folder_menu') or self.resource('gallery_folder_title')
            if menu:
                menu.click()
                options = matching(album)
                if not options:
                    try:
                        self.driver.find_element(AppiumBy.ANDROID_UIAUTOMATOR, 'new UiScrollable(new UiSelector().scrollable(true)).setMaxSearchSwipes(15).scrollIntoView(new UiSelector().text("' + album + '"))')
                        options = matching(album)
                    except Exception: return False
        if len(options) != 1: return False
        options[0].click()
        end = time.monotonic() + 10
        while time.monotonic() < end:
            if self.cancel.is_set(): raise CompanionError('CANCELLED', 'Media selection stopped.')
            current = Screen(self.driver.page_source)
            if not current.has((album,)):
                self.cancel.wait(.25); continue
            for package in (PACKAGE, 'com.google.android.providers.media.module', 'com.android.providers.media.module'):
                for rid in ('gallery_grid_item_thumbnail', 'media_grid_item', 'media_picker_item_image_view', 'icon_thumbnail'):
                    cells = [e for e in self.driver.find_elements('id', package + ':id/' + rid) if e.is_displayed() and e.is_enabled()]
                    if len(cells) == 1:
                        cells[0].click(); return True
            self.cancel.wait(.25)
        return False

    def choose_media(self, filename):
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if self.cancel.is_set(): raise CompanionError('CANCELLED', 'Media selection stopped.')
            if self.driver.current_package not in (PACKAGE, 'com.google.android.providers.media.module', 'com.android.providers.media.module', 'com.google.android.documentsui', 'com.android.documentsui'):
                raise CompanionError('MEDIA_PICKER_UNCERTAIN', 'An unexpected media-picker application opened.')
            candidates = self.driver.find_elements('xpath', '//*[@text=' + xpath_literal(filename) + ' or @content-desc=' + xpath_literal(filename) + ']')
            candidates = [e for e in candidates if e.is_displayed() and e.is_enabled()]
            if len(candidates) == 1:
                candidates[0].click(); return
            if len(candidates) > 1: raise CompanionError('MEDIA_PICKER_UNCERTAIN', 'More than one media control matches the selected file.')
            self.cancel.wait(.4)
        album = self.media_albums.get(filename)
        if album and self.choose_uploaded_album(album): return
        self.pause('media_picker', 'Select the uploaded file ' + filename + ' on the phone, then Continue. This picker did not expose its filename to Android accessibility.')

    def photo(self, expected, filename, expected_digest=None):
        if not filename: return
        name = self.media(filename, 'profile', expected, expected_digest)
        self.profile(expected); self.click(EDIT)
        self.wait(lambda s: s.has(('Edit picture or avatar', 'Editar foto ou avatar', 'Edit photo or avatar')), 'Profile-photo control was not recognized.')
        self.click(('Edit picture or avatar', 'Editar foto ou avatar', 'Edit photo or avatar'))
        self.wait(lambda s: s.has(('Choose from library', 'Escolher da biblioteca', 'New profile picture', 'Nova foto do perfil')), 'Photo library entry was not recognized.')
        self.click(('Choose from library', 'Escolher da biblioteca', 'New profile picture', 'Nova foto do perfil'))
        self.choose_media(name)
        self.wait(lambda s: s.has(('Done', 'Concluir', 'Next', 'Avançar')), 'Profile photo crop was not recognized.')
        self.click(('Done', 'Concluir', 'Next', 'Avançar'))
        self.wait(lambda s: s.has(('Your profile picture was changed', 'Sua foto do perfil foi alterada')), 'Profile photo update was not confirmed.')
        self.profile(expected)

    def story(self, settings):
        if not settings.get('story_media'): return
        record = self.journal
        fingerprint = settings.get('story_fingerprint')
        if fingerprint:
            if self.journal.get('story') in ('submitted', 'uncertain', 'confirmed'):
                raise CompanionError('STORY_HISTORY_REVIEW_REQUIRED', 'A previous Story record has no media fingerprint. Inspect it before another publication.')
            stories = self.journal.setdefault('stories', {})
            if any(r.get('story') in ('submitted', 'uncertain') for r in stories.values()):
                raise CompanionError('STORY_REVIEW_REQUIRED', 'A previous Story result for this account remains uncertain. Inspect it before a new publication.')
            record = stories.setdefault(fingerprint, {})
        expected = settings['username']
        if record.get('story') in ('submitted', 'uncertain'):
            raise CompanionError('STORY_REVIEW_REQUIRED', 'A previous Story submission has an uncertain outcome. Inspect it before posting again.')
        if record.get('story') == 'confirmed':
            if settings.get('highlight') and (record.get('highlight') != 'confirmed' or record.get('highlightName') != settings['highlight']):
                raise CompanionError('HIGHLIGHT_REVIEW_REQUIRED', 'The Story was confirmed but its highlight was not. Inspect the highlight before continuing; no duplicate Story was posted.')
            return
        name = self.media(settings['story_media'], 'story', expected, settings.get('story_media_digest'))
        self.profile(expected)
        create = self.resource('action_bar_create')
        if create: create.click()
        else: self.click(('Create', 'Criar'))
        self.wait(lambda s: s.has(('Story', 'Stories')), 'Story creation menu was not recognized.')
        self.click(('Story', 'Stories'))
        self.wait(lambda s: s.has(('Gallery', 'Galeria', 'Open gallery', 'Abrir galeria')), 'Story gallery control was not recognized.')
        self.click(('Gallery', 'Galeria', 'Open gallery', 'Abrir galeria'))
        self.choose_media(name)
        self.wait(lambda s: s.has(('Stickers', 'Figurinhas', 'Adesivos')), 'Story editor was not recognized.')
        if settings.get('story_link'):
            self.click(('Stickers', 'Figurinhas', 'Adesivos'))
            self.wait(lambda s: s.has(('LINK', 'Link')), 'Link sticker was not found.')
            self.click(('LINK', 'Link'))
            self.wait(lambda s: bool(self.inputs()), 'Story link input did not open.')
            self.fill_one(settings['story_link'])
            if settings.get('story_cta'):
                self.click(('Customize sticker text', 'Personalizar o texto da figurinha'))
                self.screen()
                fields = self.inputs()
                if len(fields) == 2:
                    fields[1].clear(); fields[1].send_keys(settings['story_cta'])
                elif len(fields) == 1: self.fill_one(settings['story_cta'])
                else: raise CompanionError('STICKER_FORM_UNCERTAIN', 'The link-sticker label field was not uniquely recognized.')
            self.click(('Done', 'Concluir'))
        self.wait(lambda s: s.has(('Your story', 'Seu story')), 'Story publish control was not recognized.')
        record['story'] = 'submitted'
        self.progress('story_submitting', 'Submitting the configured Story once; an uncertain result will not be replayed.')
        self.click(('Your story', 'Seu story'))
        self.wait(lambda s: s.has(('Your story', 'Seu story')) or bool(self.resource('profile_tab')), 'Story submission outcome is uncertain.', seconds=45)
        if self.screen().has(('Story archive', 'Arquivo de stories')) and self.screen().has(('OK',)): self.click(('OK',))
        self.profile(expected)
        self.click(('Your story', 'Seu story'))
        self.wait(lambda s: any(expected in s.labels(n) for n in s.nodes), 'Published own Story identity was not confirmed.')
        if settings.get('story_cta') and not self.screen().has((settings['story_cta'],)):
            raise CompanionError('STORY_UNCONFIRMED', 'The configured link sticker was not visible in the published Story. Inspect it before another submission.')
        record['story'] = 'confirmed'
        self.progress('story_confirmed', 'Published own Story and configured link label confirmed.')
        if settings.get('highlight'):
            self.click(('More', 'Mais'))
            self.wait(lambda s: s.has(('Highlight', 'Destacar')), 'Story highlight action was not recognized.')
            self.click(('Highlight', 'Destacar'))
            self.wait(lambda s: bool(self.inputs()) or s.has(('New', 'Novo')), 'Highlight creation was not recognized.')
            if self.screen().has(('New', 'Novo')): self.click(('New', 'Novo'))
            self.fill_one(settings['highlight']); self.click(('Add', 'Adicionar'))
            self.wait(lambda s: s.has(('Added to highlights', 'Adicionado aos destaques')), 'Highlight creation was not confirmed.')
            record['highlight'] = 'confirmed'
            record['highlightName'] = settings['highlight']
            self.progress('highlight_confirmed', 'Instagram confirmed addition to the configured highlight.')
            if self.screen().has(('Done', 'Concluir')): self.click(('Done', 'Concluir'))
        self.profile(expected)

    def prepare(self, settings):
        if settings.get('create_account'): self.create_account(settings)
        else: self.login_existing(settings)
        self.bio(settings['username'], settings.get('bio', ''))
        self.photo(settings['username'], settings.get('profile_photo', ''), settings.get('profile_photo_digest'))
        self.professional(settings['username'], settings.get('category', ''))
        self.story(settings)
        self.profile(settings['username'])
