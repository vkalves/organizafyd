# Python / zyon/phone.py / Python 3.11+ / reference Android workflow executor
import base64
from datetime import date
import os
from pathlib import Path
import re
import subprocess
import time
from .android import Android, Screen, EDIT, NEXT, PACKAGE, xpath_literal
from .errors import CompanionError

class Phone(Android):
    def __init__(self, *args, gmail, pause, journal, **kwargs):
        super().__init__(*args, **kwargs)
        self.gmail, self.pause, self.journal = gmail, pause, journal

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

    def birthday(self, birthday):
        desired = date.fromisoformat(birthday)
        self.click(('Set date', 'Definir data', 'Date of birth', 'Data de nascimento'))
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
        if not complete:
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
            'email': ("What's your email?", 'Qual é seu email?', 'Qual é seu e-mail?'),
            'code': ('Enter confirmation code', 'Insira o código de confirmação'),
            'password': ('Create a password', 'Crie uma senha'),
            'birthday': ("What's your birthday?", 'Qual é sua data de nascimento?'),
            'name': ("What's your name?", 'Qual é seu nome?'),
            'username': ('Create a username', 'Crie um nome de usuário'),
            'terms': ("Agree to Instagram's terms and policies", 'Concorde com os termos e políticas do Instagram'),
        }
        since = None
        handled = set()
        deadline = time.monotonic() + 480
        while time.monotonic() < deadline:
            screen = self.screen()
            if screen.has(EDIT) or self.resource('profile_tab'):
                self.profile(settings['username'])
                self.progress('native_created', 'Created Instagram account confirmed from its own profile.')
                return
            if screen.has(('Create new account', 'Criar nova conta')):
                self.click(('Create new account', 'Criar nova conta')); self.cancel.wait(.5); continue
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
                self.pause('native_signup_screen', 'Instagram showed an unrecognized onboarding or permission screen. Complete it on the phone, then Continue.')
                continue
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

    def media(self, filename, kind, expected):
        path = Path(filename)
        if not path.is_file() or path.stat().st_size > 50 * 1024 * 1024 or path.suffix.lower() not in ('.jpg', '.jpeg', '.png', '.mp4'):
            raise CompanionError('INVALID_MEDIA', 'Choose an existing JPG/PNG/MP4 file of at most 50 MiB.')
        remote_name = 'zyon_' + kind + '_' + expected.replace('.', '_') + path.suffix.lower()
        remote = '/sdcard/Download/' + remote_name
        self.driver.push_file(remote, base64.b64encode(path.read_bytes()).decode())
        command = [self.adb, '-s', self.serial, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', 'file://' + remote]
        subprocess.run(command, capture_output=True, timeout=20, check=True, creationflags=0x08000000 if os.name == 'nt' else 0)
        return remote_name

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
        self.pause('media_picker', 'Select the uploaded file ' + filename + ' on the phone, then Continue. This picker did not expose its filename to Android accessibility.')

    def photo(self, expected, filename):
        if not filename: return
        name = self.media(filename, 'profile', expected)
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
        expected = settings['username']
        if self.journal.get('story') in ('submitted', 'uncertain'):
            raise CompanionError('STORY_REVIEW_REQUIRED', 'A previous Story submission has an uncertain outcome. Inspect it before posting again.')
        if self.journal.get('story') == 'confirmed': return
        name = self.media(settings['story_media'], 'story', expected)
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
                self.fill_one(settings['story_cta'])
            self.click(('Done', 'Concluir'))
        self.wait(lambda s: s.has(('Your story', 'Seu story')), 'Story publish control was not recognized.')
        self.journal['story'] = 'submitted'
        self.progress('story_submitting', 'Submitting the configured Story once; an uncertain result will not be replayed.')
        self.click(('Your story', 'Seu story'))
        self.wait(lambda s: s.has(('Your story', 'Seu story')) or bool(self.resource('profile_tab')), 'Story submission outcome is uncertain.', seconds=45)
        if self.screen().has(('Story archive', 'Arquivo de stories')) and self.screen().has(('OK',)): self.click(('OK',))
        self.profile(expected)
        self.click(('Your story', 'Seu story'))
        self.wait(lambda s: any(expected in s.labels(n) for n in s.nodes), 'Published own Story identity was not confirmed.')
        if settings.get('story_cta') and not self.screen().has((settings['story_cta'],)):
            raise CompanionError('STORY_UNCONFIRMED', 'The configured link sticker was not visible in the published Story. Inspect it before another submission.')
        self.journal['story'] = 'confirmed'
        self.progress('story_confirmed', 'Published own Story and configured link label confirmed.')
        if settings.get('highlight'):
            self.click(('More', 'Mais'))
            self.wait(lambda s: s.has(('Highlight', 'Destacar')), 'Story highlight action was not recognized.')
            self.click(('Highlight', 'Destacar'))
            self.wait(lambda s: bool(self.inputs()) or s.has(('New', 'Novo')), 'Highlight creation was not recognized.')
            if self.screen().has(('New', 'Novo')): self.click(('New', 'Novo'))
            self.fill_one(settings['highlight']); self.click(('Add', 'Adicionar'))
            self.wait(lambda s: s.has(('Added to highlights', 'Adicionado aos destaques')), 'Highlight creation was not confirmed.')
            if self.screen().has(('Done', 'Concluir')): self.click(('Done', 'Concluir'))
        self.profile(expected)

    def prepare(self, settings):
        if settings.get('create_account'): self.create_account(settings)
        else: self.login_existing(settings)
        self.bio(settings['username'], settings.get('bio', ''))
        self.photo(settings['username'], settings.get('profile_photo', ''))
        self.professional(settings['username'], settings.get('category', ''))
        self.story(settings)
        self.profile(settings['username'])
