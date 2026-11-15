# Python / zyon/avanca.py / Python 3.11+ / authenticated owner-scoped AVANCA API
import json
from pathlib import Path
import re
import threading
import time
from urllib.parse import urlsplit
import requests
from .android import handle
from .errors import CompanionError
from .gmail import address

UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)

def identifier(value):
    if not isinstance(value, str) or not UUID.fullmatch(value):
        raise CompanionError('INVALID_IDENTIFIER', 'Select an existing account/app/flow from your AVANCA account.')
    return value

class Avanca:
    def __init__(self, vault, config=None, session=None):
        self.vault = vault
        self.config = config or json.loads((Path(__file__).parent / 'platform.json').read_text())
        self.base = self.config['url'].rstrip('/')
        if self.base != 'https://csaplfphtvufxjhbpstl.supabase.co':
            raise CompanionError('WRONG_PLATFORM', 'The configured platform does not match this application.')
        self.http = session or requests.Session()
        self.lock = threading.RLock()
        self.session = None
        self.expected_email = None
        self.cancel = None

    def _send(self, method, path, body=None, params=None, authenticated=True):
        with self.lock:
            if authenticated:
                self._renew()
                if not self.session: raise CompanionError('AVANCA_LOGIN_REQUIRED', 'Sign in to your AVANCA account in the desktop application.')
            headers = {'apikey': self.config['publishableKey'], 'Content-Type': 'application/json'}
            if authenticated: headers['Authorization'] = 'Bearer ' + self.session['access_token']
            try:
                response = self.http.request(method, self.base + path, json=body, params=params, headers=headers, timeout=25)
                data = response.json()
            except (requests.RequestException, ValueError):
                raise CompanionError('AVANCA_UNAVAILABLE', 'AVANCA did not return a confirmed response. Inspect state before retrying a write.') from None
            if response.status_code == 401 and authenticated:
                self.session = None; self.vault.delete('avanca-session')
                raise CompanionError('AVANCA_LOGIN_REQUIRED', 'The AVANCA session expired. Sign in again.')
            if not response.ok or isinstance(data, dict) and data.get('error'):
                code = data.get('error') if isinstance(data, dict) else None
                known = {'account_already_connected': 'This Instagram belongs to a different AVANCA user.',
                         'account_mismatch': 'Meta authorized a different Instagram account.',
                         'account_limit_reached': 'Your AVANCA account connection limit was reached.',
                         'account_connection_disabled': 'New connections are disabled for this AVANCA user.',
                         'professional_required': 'Instagram must be a professional account.',
                         'unauthorized': 'The AVANCA session expired. Sign in again.'}
                raise CompanionError('AVANCA_REJECTED', known.get(code, 'AVANCA rejected the operation. Check account approval, credentials and connection status.'))
            return data

    def _save(self, data, expected_email):
        user = data.get('user', {})
        if not UUID.fullmatch(str(user.get('id', ''))) or address(user.get('email', '')) != expected_email:
            raise CompanionError('AVANCA_IDENTITY_MISMATCH', 'AVANCA authenticated a different user. Operation stopped.')
        if self.session and self.session['user_id'] != user['id']:
            raise CompanionError('AVANCA_SESSION_CHANGED', 'AVANCA user changed during the operation.')
        if not data.get('access_token') or not data.get('refresh_token'):
            raise CompanionError('AVANCA_LOGIN_FAILED', 'AVANCA did not return a complete session.')
        self.session = {'access_token': data['access_token'], 'refresh_token': data['refresh_token'],
                        'expires_at': time.time() + int(data.get('expires_in', 3600)), 'user_id': user['id'], 'email': expected_email}
        self.expected_email = expected_email
        self.vault.put('avanca-session', self.session)

    def sign_in(self, email, password):
        expected = address(email)
        if not isinstance(password, str) or not password: raise CompanionError('AVANCA_PASSWORD_REQUIRED', 'Enter your AVANCA password.')
        with self.lock:
            self.session = None
            data = self._send('POST', '/auth/v1/token?grant_type=password', {'email': expected, 'password': password}, authenticated=False)
            self._save(data, expected)
            if self.function('app-admin', 'access').get('account_status') != 'approved':
                self.session = None
                self.vault.delete('avanca-session')
                raise CompanionError('AVANCA_NOT_APPROVED', 'Your AVANCA login is not approved for this workflow.')
            return {'email': expected, 'userId': self.session['user_id']}

    def restore(self, expected_email):
        with self.lock:
            stored = self.vault.get('avanca-session')
            if not stored or stored.get('email') != address(expected_email): return False
            self.session = stored; self.expected_email = address(expected_email)
            try: self.assert_user(stored['user_id'])
            except CompanionError as failure:
                if failure.code == 'AVANCA_LOGIN_REQUIRED': return False
                raise
            return True

    def _renew(self):
        if not self.session or self.session['expires_at'] > time.time() + 30: return
        old = self.session
        try:
            data = self._send('POST', '/auth/v1/token?grant_type=refresh_token', {'refresh_token': old['refresh_token']}, authenticated=False)
            self._save(data, old['email'])
        except CompanionError:
            self.session = None
            self.vault.delete('avanca-session')
            raise

    def assert_user(self, owner):
        data = self._send('GET', '/auth/v1/user')
        if data.get('id') != owner or address(data.get('email', '')) != self.expected_email:
            raise CompanionError('AVANCA_SESSION_CHANGED', 'AVANCA user changed. No further write was sent.')

    def function(self, name, action, **values):
        if self.cancel is not None and self.cancel.is_set(): raise CompanionError('CANCELLED', 'Workflow stopped before another platform operation.')
        if name not in ('instagram-publisher', 'instagram-login', 'app-admin'):
            raise CompanionError('INVALID_API', 'Unsupported platform operation.')
        return self._send('POST', '/functions/v1/' + name, {'action': action, **values})

    def catalog(self):
        owner = self.session['user_id'] if self.session else None
        if not owner: raise CompanionError('AVANCA_LOGIN_REQUIRED', 'Sign in to AVANCA first.')
        self.assert_user(owner)
        if self.function('app-admin', 'access').get('account_status') != 'approved':
            raise CompanionError('AVANCA_NOT_APPROVED', 'This AVANCA login is not currently approved.')
        flows = self._send('GET', '/rest/v1/ig_flows', params={'select': 'id,name,state', 'user_id': 'eq.' + owner, 'state': 'eq.active', 'order': 'name'})
        apps = self.function('instagram-login', 'config')
        return {'flows': [{'id': identifier(f['id']), 'name': f['name']} for f in flows],
                'apps': [{'id': identifier(a['id']), 'name': a['name']} for a in apps.get('apps', []) if a.get('active')],
                'platformReady': apps.get('platformReady') is True}

    def invite(self, username, app_id):
        expected = handle(username)
        if app_id is not None: identifier(app_id)
        self.assert_user(self.session['user_id'])
        result = self.function('instagram-login', 'invite', expected_username=expected, app_id=app_id)
        url = result.get('url', '')
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or parsed.hostname not in ('www.organizafy.site', 'organizafy.site') or parsed.path != '/instagram/conectar' or not parsed.fragment.startswith('invite='):
            raise CompanionError('INVALID_AUTHORIZATION_LINK', 'AVANCA returned an unexpected authorization destination.')
        return url

    def preflight(self, username):
        expected = handle(username)
        if not self.session: raise CompanionError('AVANCA_LOGIN_REQUIRED', 'Sign in first.')
        owner = self.session['user_id']
        self.assert_user(owner)
        if self.function('app-admin', 'access').get('account_status') != 'approved':
            raise CompanionError('AVANCA_NOT_APPROVED', 'This AVANCA user is not approved.')
        connections = self.function('instagram-publisher', 'status').get('accounts', [])
        available = {identifier(c['account_id']) for c in connections if c.get('paused') is False and c.get('reconnect_required') is False}
        records = self._send('GET', '/rest/v1/instagram_accounts', params={'select': 'id,user_id,username', 'user_id': 'eq.' + owner, 'username': 'eq.' + expected})
        candidates = [a for a in records if a.get('user_id') == owner and a.get('id') in available and str(a.get('username', '')).lower() == expected]
        if len(candidates) != 1:
            raise CompanionError('ACCOUNT_NOT_CONNECTED' if not candidates else 'AMBIGUOUS_ACCOUNT', 'The expected Instagram is not uniquely connected and available under this AVANCA user.')
        account = candidates[0]
        identity = self.function('instagram-publisher', 'verify', account_id=identifier(account['id']))
        if handle(identity.get('username')) != expected or not re.fullmatch(r'\d{5,40}', str(identity.get('id', ''))):
            raise CompanionError('INSTAGRAM_IDENTITY_MISMATCH', 'Live Meta identity differs from the expected Instagram.')
        self.assert_user(owner)
        return {'accountId': account['id'], 'userId': owner, 'graphId': str(identity['id']), 'username': expected}

    def flow(self, flow_id, owner):
        self.assert_user(owner)
        rows = self._send('GET', '/rest/v1/ig_flows', params={'select': 'id,user_id,name,state,settings', 'id': 'eq.' + identifier(flow_id), 'user_id': 'eq.' + owner})
        if len(rows) != 1 or rows[0].get('state') != 'active' or rows[0].get('user_id') != owner or not isinstance(rows[0].get('settings', {}).get('accountIds'), list):
            raise CompanionError('FLOW_UNAVAILABLE', 'The selected existing flow is not active or its membership could not be read.')
        return rows[0]

    def sync(self, username, flow_id):
        account = self.preflight(username)
        before = self.flow(flow_id, account['userId'])
        already = account['accountId'] in before['settings']['accountIds']
        uncertain = False
        if not already:
            check = self.preflight(username)
            if check != account: raise CompanionError('IDENTITY_CHANGED', 'Instagram identity changed before synchronization.')
            try: self.function('instagram-publisher', 'add_flow_accounts', id=flow_id, account_ids=[account['accountId']])
            except CompanionError: uncertain = True  # Never resend an uncertain write.
        after = self.flow(flow_id, account['userId'])
        if account['accountId'] not in after['settings']['accountIds']:
            raise CompanionError('FLOW_WRITE_UNCONFIRMED', 'Flow membership was not confirmed. Inspect state before another synchronization.')
        if self.preflight(username) != account: raise CompanionError('IDENTITY_CHANGED', 'Identity changed after synchronization; inspect the recorded association.')
        return {**account, 'flowId': flow_id, 'flowName': after['name'], 'alreadyAssociated': already, 'recoveredAfterWriteError': uncertain}
