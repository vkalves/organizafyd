"""Hostinger mailbox access over certificate-verified IMAP TLS."""
from datetime import datetime
import email
import email.utils
import imaplib
import math
import re
import ssl
import time
from .errors import CompanionError
from .gmail import Gmail, address, extract_code

class Hostinger:
    def __init__(self, vault, factory=None):
        self.vault, self.factory = vault, factory or imaplib.IMAP4_SSL
        self.used = set()

    def status(self):
        data = self.vault.get('hostinger') or {}
        return {'connected': bool(data.get('password')), 'mailbox': data.get('mailbox', '')}

    def session(self, timeout=15):
        data = self.vault.get('hostinger') or {}
        if not data.get('password'):
            raise CompanionError('HOSTINGER_REQUIRED', 'Connect your Hostinger mailbox in EMAIL first.')
        client = self.factory('imap.hostinger.com', 993, ssl_context=ssl.create_default_context(), timeout=timeout)
        try:
            client.login(data['mailbox'], data['password'])
            return client
        except Exception:
            try: client.logout()
            except Exception: pass
            raise

    def connect(self, mailbox, password):
        mailbox = address(mailbox)
        if not isinstance(password, str) or not password:
            raise CompanionError('HOSTINGER_REQUIRED', 'Enter the Hostinger mailbox password.')
        previous = self.vault.get('hostinger')
        self.vault.put('hostinger', {'mailbox': mailbox, 'password': password})
        try: self.verify()
        except Exception:
            if previous: self.vault.put('hostinger', previous)
            else: self.vault.delete('hostinger')
            raise
        self.used.clear()
        return self.status()

    def verify(self):
        client = None
        try:
            client = self.session()
            if client.select('INBOX', readonly=True)[0] != 'OK':
                raise CompanionError('HOSTINGER_INBOX', 'Hostinger did not open INBOX.')
            return self.status()
        except (imaplib.IMAP4.error, OSError):
            raise CompanionError('HOSTINGER_CONNECTION', 'Hostinger IMAP login failed. Check mailbox credentials and IMAP access.') from None
        finally:
            if client:
                try: client.logout()
                except Exception: pass

    def wait_code(self, sender, recipient, since_ms, cancel, timeout=90):
        sender, recipient = address(sender), address(recipient)
        now = time.time() * 1000
        if isinstance(since_ms, bool) or not isinstance(since_ms, (int, float)) or not math.isfinite(since_ms) or not now-600000 <= since_ms <= now+5000:
            raise CompanionError('STALE_CHALLENGE', 'Start a fresh email challenge.')
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 1 <= timeout <= 120:
            raise CompanionError('INVALID_TIMEOUT', 'Email timeout must be between 1 and 120 seconds.')
        # IMAP INTERNALDATE has second precision, unlike Gmail internalDate.
        since_ms = math.floor(since_ms / 1000) * 1000
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if cancel.is_set(): raise CompanionError('CANCELLED', 'Email retrieval cancelled.')
            client = None
            try:
                client = self.session(timeout=min(15, max(.1, deadline-time.monotonic())))
                def request(method, *args, **kwargs):
                    remaining = deadline-time.monotonic()
                    if remaining <= 0: raise TimeoutError()
                    client.sock.settimeout(min(15, remaining))
                    return method(*args, **kwargs)
                # INTERNALDATE is validated below; include spam, which commonly receives signup mail.
                found = []
                for folder in ('INBOX', 'INBOX.Junk', 'Junk', 'Spam'):
                    if request(client.select, folder, readonly=True)[0] != 'OK': continue
                    validity = client.response('UIDVALIDITY')[1]
                    status, listing = request(client.uid, 'search', None, 'SINCE', datetime.fromtimestamp(since_ms/1000).strftime('%d-%b-%Y'), 'FROM', '"' + sender + '"')
                    if status != 'OK': continue
                    ids = listing[0].split() if listing and listing[0] else []
                    for uid in reversed(ids[-100:]):
                        if cancel.is_set(): raise CompanionError('CANCELLED', 'Email retrieval cancelled.')
                        if time.monotonic() >= deadline: break
                        key = (folder, str(validity), uid)
                        if key in self.used: continue
                        status, data = request(client.uid, 'fetch', uid, '(INTERNALDATE BODY.PEEK[HEADER])')
                        if status != 'OK': continue
                        parts = [part for part in data if isinstance(part, tuple)]
                        if not parts: continue
                        meta, headers = parts[0]
                        stamp = re.search(rb'INTERNALDATE "([^"]+)"', meta)
                        if not stamp: continue
                        received = email.utils.parsedate_to_datetime(stamp[1].decode()).timestamp()*1000
                        if received < since_ms: continue
                        # Filter headers before downloading a body.
                        message = email.message_from_bytes(headers)
                        senders = [a.lower() for _, a in email.utils.getaddresses(message.get_all('From', []))]
                        if senders != [sender]: continue
                        status, data = request(client.uid, 'fetch', uid, '(BODY.PEEK[]<0.2097153>)')
                        if status != 'OK': continue
                        raw = b''.join(part[1] for part in data if isinstance(part, tuple))
                        code = extract_code(raw, received, sender, recipient, since_ms)
                        if code: found.append((key, code))
                distinct = {code for _, code in found}
                if len(distinct) > 1: raise CompanionError('AMBIGUOUS_CODE', 'Multiple fresh verification codes match this request.')
                if found:
                    self.used.update(key for key, _ in found)
                    return {'code': found[0][1], 'recipient': recipient}
            except imaplib.IMAP4.abort:
                if time.monotonic() >= deadline: break
            except imaplib.IMAP4.error:
                raise CompanionError('HOSTINGER_CONNECTION', 'Hostinger rejected the mailbox request. Check IMAP credentials.') from None
            except OSError:
                if time.monotonic() >= deadline: break
            finally:
                if client:
                    try: client.logout()
                    except Exception: pass
            cancel.wait(min(2, max(0, deadline-time.monotonic())))
        raise CompanionError('EMAIL_TIMEOUT', 'No fresh matching code arrived in the Hostinger inbox or spam folders.')

class Mailbox(Gmail):
    def __init__(self, vault):
        super().__init__(vault)
        self.hostinger = Hostinger(vault)
        self.provider = (vault.get('email-provider') or {}).get('name', 'gmail')

    def use(self, provider):
        if provider not in ('gmail', 'hostinger'): raise CompanionError('INVALID_PROVIDER', 'Choose Gmail or Hostinger.')
        self.provider = provider
        self.vault.put('email-provider', {'name': provider})

    def status(self):
        return self.hostinger.status() if self.provider == 'hostinger' else super().status()

    def verify(self):
        return self.hostinger.verify() if self.provider == 'hostinger' else super().verify()

    def wait_code(self, *args, **kwargs):
        return self.hostinger.wait_code(*args, **kwargs) if self.provider == 'hostinger' else super().wait_code(*args, **kwargs)
