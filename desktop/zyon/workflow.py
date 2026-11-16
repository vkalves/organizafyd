# Python / zyon/workflow.py / Python 3.11+ / automatic native + Chrome + AVANCA controller
import copy
from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path
import threading
import time
import uuid
from urllib.parse import urlsplit
from .android import handle
from .avanca import Avanca, identifier
from .browser import Browser
from .errors import CompanionError
from .gmail import Gmail, address
from .phone import Phone
from .runtime import Runtime


def configuration(values):
    result = dict(values)
    if not isinstance(result.get('create_account', False), bool): raise CompanionError('INVALID_CONFIGURATION', 'Account creation must be explicitly selected or cleared.')
    checks = (
        ('username', handle, 'Na aba DADOS, informe o @ esperado do Instagram.'),
        ('recipient', address, 'Na aba DADOS, informe um email válido para a conta Instagram.'),
        ('email_sender', address, 'Na aba EMAIL, informe o remetente exato dos códigos.'),
        ('avanca_email', address, 'Na aba FLUXO, informe um email AVANÇA válido.'),
        ('flow_id', identifier, 'Na aba FLUXO, entre no AVANÇA, consulte seus fluxos e selecione um fluxo ativo.'),
    )
    result.setdefault('email_sender', 'security@mail.instagram.com')
    for field, validate, message in checks:
        try: result[field] = validate(result.get(field))
        except CompanionError as error:
            raise CompanionError(error.code, message, field=field) from None
    if result.get('meta_app_id') is not None:
        try: result['meta_app_id'] = identifier(result['meta_app_id'])
        except CompanionError:
            raise CompanionError('INVALID_IDENTIFIER', 'Na aba FLUXO, selecione um aplicativo Meta disponível.', field='meta_app_id') from None
    required = {
        'instagram_password': 'Na aba DADOS, preencha a senha do Instagram.',
        'tester_app_name': 'Na aba FLUXO, preencha “Nome do app no convite”. Copie o nome exibido no convite de testador do Instagram; ele pode ser diferente do nome no AVANÇA.',
        'serial': 'Na aba ADB, consulte os dispositivos e selecione seu telefone autorizado.',
    }
    for field, message in required.items():
        if not isinstance(result.get(field), str) or not result[field].strip():
            raise CompanionError('CONFIGURATION_REQUIRED', message, field=field)
    result['tester_app_name'] = result['tester_app_name'].strip()
    for field in ('full_name', 'bio', 'category', 'profile_photo', 'story_media', 'story_link', 'story_cta', 'highlight', 'birthday'):
        if not isinstance(result.get(field, ''), str): raise CompanionError('INVALID_CONFIGURATION', 'Invalid field: ' + field)
    if len(result.get('bio', '')) > 150: raise CompanionError('INVALID_BIO', 'Instagram bio must contain at most 150 characters.')
    if result.get('create_account'):
        raw_birthday = result.get('birthday', '').strip()
        try:
            if '/' in raw_birthday:
                born = datetime.strptime(raw_birthday, '%d/%m/%Y').date()
            else: born = date.fromisoformat(raw_birthday)
        except ValueError:
            raise CompanionError('BIRTHDAY_REQUIRED', 'Na aba DADOS, informe sua data de nascimento real como DD/MM/AAAA ou AAAA-MM-DD.', field='birthday') from None
        result['birthday'] = born.isoformat()
        today = date.today()
        age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
        if age < 18 or age > 120: raise CompanionError('INVALID_BIRTHDAY', 'Na aba DADOS, informe uma data de nascimento real de uma pessoa adulta.', field='birthday')
        if not result.get('full_name', '').strip(): raise CompanionError('NAME_REQUIRED', 'Na aba DADOS, preencha o nome do perfil.', field='full_name')
    if result.get('proxy'):
        try:
            proxy = urlsplit(result['proxy'].get('server', ''))
            valid = proxy.scheme in ('http', 'https', 'socks5') and proxy.hostname and not proxy.username and not proxy.password and proxy.path in ('', '/') and not proxy.query and not proxy.fragment
            if proxy.port is not None and not 1 <= proxy.port <= 65535: valid = False
        except (ValueError, AttributeError): valid = False
        if not valid: raise CompanionError('INVALID_PROXY', 'Configure a plain HTTP/HTTPS/SOCKS5 proxy server URL; keep credentials in the separate fields.')
    if result.get('story_link'):
        parsed = urlsplit(result['story_link'])
        if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password:
            raise CompanionError('INVALID_STORY_LINK', 'Enter a complete HTTP/HTTPS Story destination.')
    for field in ('profile_photo', 'story_media'):
        if result.get(field):
            path = Path(result[field])
            allowed = ('.jpg', '.jpeg', '.png') if field == 'profile_photo' else ('.jpg', '.jpeg', '.png', '.mp4')
            if not path.is_file() or path.stat().st_size > 50 * 1024 * 1024 or path.suffix.lower() not in allowed:
                raise CompanionError('MEDIA_MISSING', 'Choose a supported existing media file of at most 50 MiB: ' + field)
            digest = hashlib.sha256()
            with path.open('rb') as media:
                while chunk := media.read(1024 * 1024): digest.update(chunk)
            result[field + '_digest'] = digest.hexdigest()
            if field == 'story_media':
                digest.update(json.dumps([result.get('story_link', ''), result.get('story_cta', '')]).encode())
                result['story_fingerprint'] = digest.hexdigest()
    return result

class Workflow:
    def __init__(self, root, vault, avanca=None, gmail=None, phone_factory=Phone, browser_factory=Browser, runtime=None):
        self.root, self.vault = Path(root), vault
        self.root.mkdir(parents=True, exist_ok=True)
        self.avanca, self.gmail = avanca or Avanca(vault), gmail or Gmail(vault)
        self.phone_factory, self.browser_factory = phone_factory, browser_factory
        self.lock = threading.RLock()
        self.cancel = threading.Event(); self.continue_event = threading.Event()
        self.runtime = runtime or Runtime(self.cancel)
        self.state = {'status': 'idle', 'phase': 'ready', 'message': 'Ready to configure a workflow.', 'username': '', 'pauseId': None, 'events': [], 'result': None}
        self.thread = None
        self.journal = {}
        self.journal_path = None

    def snapshot(self):
        with self.lock: return copy.deepcopy(self.state)

    def progress(self, phase, message):
        if self.cancel.is_set(): raise CompanionError('CANCELLED', 'Workflow stopped. Inspect external state before another run.')
        with self.lock:
            self.state.update(phase=phase, message=message)
            self.state['events'].append({'time': datetime.now(timezone.utc).isoformat(), 'phase': phase, 'message': message})
            self.state['events'] = self.state['events'][-300:]
            self.persist()

    def persist(self):
        if self.journal_path is None: return
        data = {'username': self.state['username'], 'phase': self.state['phase'], 'status': self.state['status'],
                'story': self.journal.get('story'), 'highlight': self.journal.get('highlight'), 'stories': self.journal.get('stories', {}), 'result': self.state.get('result')}
        temp = self.journal_path.with_suffix('.tmp')
        temp.write_text(json.dumps(data), encoding='utf-8')
        temp.replace(self.journal_path)

    def pause(self, reason, message):
        self.continue_event.clear()
        with self.lock:
            self.state.update(status='paused', pauseId=str(uuid.uuid4()), pauseReason=reason)
            self.progress(reason, message)
        # Waiting is indefinite until the specific current pause is continued or stopped.
        while not self.continue_event.wait(.25):
            if self.cancel.is_set(): raise CompanionError('CANCELLED', 'Paused workflow stopped.')
        if self.cancel.is_set(): raise CompanionError('CANCELLED', 'Workflow stopped.')
        with self.lock: self.state.update(status='running', pauseId=None)

    def resume(self, pause_id):
        with self.lock:
            if self.state['status'] != 'paused' or self.state['pauseId'] != pause_id: return False
            self.state['status'] = 'resuming'; self.continue_event.set(); return True

    def stop(self): self.cancel.set(); self.continue_event.set()

    def start(self, values):
        return self.start_many([values])

    def start_many(self, profiles):
        if not isinstance(profiles, list) or not profiles or len(profiles) > 100:
            raise CompanionError('INVALID_QUEUE', 'Select between one and 100 configured profiles.')
        settings = [configuration(values) for values in profiles]
        if len({value['username'] for value in settings}) != len(settings):
            raise CompanionError('DUPLICATE_QUEUE_ACCOUNT', 'The same Instagram cannot appear twice in one queue.')
        with self.lock:
            if self.thread is not None and self.thread.is_alive(): raise CompanionError('BUSY', 'A workflow is already running.')
            if not self.gmail.status().get('connected'): raise CompanionError('GMAIL_REQUIRED', 'Connect Gmail once before starting automatic email verification.')
            self.cancel.clear(); self.continue_event.clear()
            self.thread = threading.Thread(target=self._execute_many, args=(copy.deepcopy(settings),), daemon=True)
            self.thread.start()

    def _execute_many(self, profiles):
        try: self._run_many(profiles)
        except Exception:
            with self.lock:
                self.state.update(status='needs_attention', phase='CHECKPOINT_UNAVAILABLE', message='The workflow checkpoint could not be read or saved. Inspect local storage and external state before another run.', pauseId=None)

    def _run_many(self, profiles):
        results = []
        for index, settings in enumerate(profiles):
            if self.cancel.is_set(): break
            with self.lock:
                path = self.root / 'runs'; path.mkdir(exist_ok=True)
                self.journal_path = path / (hashlib.sha256(settings['username'].encode()).hexdigest() + '.json')
                self.journal = {}
                if self.journal_path.exists():
                    try: self.journal = json.loads(self.journal_path.read_text())
                    except ValueError:
                        self.state.update(status='needs_attention', phase='JOURNAL_UNREADABLE', message='Previous workflow state could not be read. Inspect it before another run.')
                        return
                self.state.update(status='running', phase='preflight', message='Validating configured identities and services.', username=settings['username'], pauseId=None, result=None, events=[], cycle=index+1, cycles=len(profiles))
            self._run(settings)
            with self.lock:
                if self.state['status'] != 'completed': return
                results.append(self.state['result'])
        with self.lock:
            self.state['queueResults'] = results
            if self.cancel.is_set() and self.state['status'] == 'completed':
                self.state.update(status='stopped', message='Queue stopped before the next account.')

    def _run(self, settings):
        phone, browser = None, None
        self.avanca.cancel = self.cancel
        try:
            self.progress('avanca_login', 'Signing in to the configured AVANCA user and checking the existing active flow.')
            if not self.avanca.restore(settings['avanca_email']):
                self.avanca.sign_in(settings['avanca_email'], settings.get('avanca_password', ''))
            catalog = self.avanca.catalog()
            if not any(f['id'] == settings['flow_id'] for f in catalog['flows']):
                raise CompanionError('FLOW_UNAVAILABLE', 'The configured flow is not an active owned flow.')
            if settings.get('meta_app_id') is None and not catalog.get('platformReady'):
                raise CompanionError('META_APP_REQUIRED', 'Select an active owned Meta app. The platform app is not configured.')
            if settings.get('meta_app_id') is not None and not any(a['id'] == settings['meta_app_id'] for a in catalog['apps']):
                raise CompanionError('META_APP_UNAVAILABLE', 'The selected Meta app is not active under this AVANCA user.')
            self.progress('gmail_preflight', 'Renewing Gmail access and verifying the configured mailbox before Android account actions.')
            self.gmail.verify()
            self.progress('android_connect', 'Starting the local Android controller and opening Instagram.')
            self.runtime.ensure()
            phone = self.phone_factory(settings['serial'], 'http://127.0.0.1:4723', self.vault, self.cancel, self.progress,
                                       gmail=self.gmail, pause=self.pause, journal=self.journal)
            phone.open()
            self.progress('native_prepare', 'Running the configured native Instagram preparation steps.')
            phone.prepare(settings)
            self.progress('native_two_factor', 'Enabling or verifying 2FA for the same native Instagram account.')
            phone.ensure_two_factor(settings['username'])
            phone.collect_recovery(settings['username'])
            secret = self.vault.get('instagram:' + settings['username']) or {}
            if secret.get('state') != 'active' or not secret.get('seed'):
                self.pause('recovery_material', 'This account already uses an external authenticator. Confirm you retained its authenticator/recovery material, return to its own profile, then Continue.')
            phone.profile(settings['username'])
            self.progress('native_logout', 'Rechecking native identity/2FA and logging out of this account.')
            phone.logout(settings['username']); phone.close(); phone = None
            self.progress('chrome_login', 'Signing into the same Instagram in controlled Chrome; verification codes are entered automatically.')
            browser = self.browser_factory(self.root, self.vault, self.gmail, self.cancel, self.progress, self.pause)
            browser.open(settings['username'], settings.get('proxy'))
            browser.login(settings['instagram_password'], settings['recipient'], settings['email_sender'])
            self.pause('tester_invitation', '@' + settings['username'] + ' is verified in Chrome. Invite this exact account to Meta app "' + settings['tester_app_name'] + '", then click Continue. Acceptance has not been clicked.')
            self.progress('tester_acceptance', 'Accepting only the configured tester invitation and verifying acceptance.')
            browser.tester_invitation(settings['tester_app_name'])
            try:
                account = self.avanca.preflight(settings['username'])
            except CompanionError as failure:
                if failure.code != 'ACCOUNT_NOT_CONNECTED': raise
                self.progress('meta_authorization', 'Opening the official account-bound Meta authorization and checking its completion.')
                invite = self.avanca.invite(settings['username'], settings.get('meta_app_id'))
                browser.authorize(invite, self.avanca, settings['recipient'], settings['email_sender'])
            self.progress('flow_sync', 'Verifying the live Meta identity and synchronizing only the selected existing AVANCA flow.')
            result = self.avanca.sync(settings['username'], settings['flow_id'])
            with self.lock:
                self.state['result'] = result
                self.state['status'] = 'completed'
                self.progress('completed', '@' + settings['username'] + ' is confirmed in flow ' + result['flowName'] + '.')
        except CompanionError as failure:
            with self.lock:
                self.state.update(status='stopped' if failure.code == 'CANCELLED' else 'needs_attention', phase=failure.code, message=str(failure), pauseId=None)
                self.persist()
        except Exception:
            with self.lock:
                self.state.update(status='needs_attention', phase='UNCONFIRMED_OPERATION', message='An external operation was not confirmed. Inspect the phone or Chrome and the current step in Logs before retrying.', pauseId=None)
                self.persist()
        finally:
            self.avanca.cancel = None
            if phone is not None: phone.close()
            if browser is not None:
                try: browser.close()
                except Exception: pass

    def close(self):
        self.stop()
        if self.thread and self.thread.is_alive(): self.thread.join(timeout=3)
        self.runtime.close()
