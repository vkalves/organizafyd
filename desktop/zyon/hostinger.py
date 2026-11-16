"""Hostinger mailbox access over certificate-verified IMAP TLS."""
from datetime import datetime, timezone
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

    @staticmethod
    def release(client, timeout=1):
        # A slow LOGOUT must not delay code entry or hold a failed TLS socket open.
        try:
            client.sock.settimeout(timeout)
            client.logout()
        except Exception:
            pass
        finally:
            try: client.shutdown()
            except Exception: pass

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
            self.release(client)
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
            if client: self.release(client)

    @staticmethod
    def folders(client, request):
        """Use server-advertised spam names, including Hostinger special-use folders."""
        status, listing = request(client.list)
        if status != 'OK': return ('INBOX', 'INBOX.Junk', 'Junk', 'Spam')
        folders = ['INBOX']
        for entry in listing or []:
            if not isinstance(entry, bytes): continue
            match = re.match(rb'^\(([^)]*)\) (?:"(?:[^"\\]|\\.)*"|NIL) (.+)$', entry)
            if not match: continue
            flags, name = match.groups()
            if b'\\noselect' in flags.lower(): continue
            try: name = name.decode('ascii')
            except UnicodeError: continue
            plain = name.strip('"').casefold()
            leaf = re.split(r'[./]', plain)[-1]
            if b'\\junk' in flags.lower() or leaf in ('junk', 'spam', 'junk e-mail', 'junk email'):
                if plain not in {n.strip('"').casefold() for n in folders}: folders.append(name)
        return tuple(folders)

    def wait_code(self, sender, recipient, since_ms, cancel, timeout=90):
        sender, recipient = address(sender), address(recipient)
        now = time.time() * 1000
        if isinstance(since_ms, bool) or not isinstance(since_ms, (int, float)) or not math.isfinite(since_ms) or not now-600000 <= since_ms <= now+5000:
            raise CompanionError('STALE_CHALLENGE', 'Start a fresh email challenge.')
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 1 <= timeout <= 120:
            raise CompanionError('INVALID_TIMEOUT', 'Email timeout must be between 1 and 120 seconds.')
        since_ms = math.floor(since_ms / 1000) * 1000
        started = time.monotonic()
        deadline = started + timeout
        # IMAP search dates require English month names regardless of Windows locale.
        # SINCE ignores timezone offsets: overlap one day, then enforce exact timestamps.
        day = datetime.fromtimestamp((since_ms-86400000)/1000, timezone.utc)
        month = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')[day.month-1]
        search_date = f'{day.day:02d}-{month}-{day.year}'
        client, folders, failures = None, (), 0
        scanned = set()

        def close():
            nonlocal client
            if client:
                self.release(client, timeout=min(1, max(.1, deadline-time.monotonic())))
                client = None

        def request(method, *args, **kwargs):
            if cancel.is_set(): raise CompanionError('CANCELLED', 'Email retrieval cancelled.')
            remaining = deadline-time.monotonic()
            if remaining <= 0: raise TimeoutError()
            client.sock.settimeout(min(15, remaining))
            return method(*args, **kwargs)

        try:
            while time.monotonic() < deadline:
                if cancel.is_set(): raise CompanionError('CANCELLED', 'Email retrieval cancelled.')
                try:
                    if client is None:
                        client = self.session(timeout=min(15, max(.1, deadline-time.monotonic())))
                        folders = self.folders(client, request)
                    found = []
                    for folder in folders:
                        status, _ = request(client.select, folder, readonly=True)
                        if status != 'OK':
                            if folder == 'INBOX': raise CompanionError('HOSTINGER_INBOX', 'Hostinger did not open INBOX.')
                            continue
                        validity = client.response('UIDVALIDITY')[1]
                        if not validity or not validity[0]:
                            raise CompanionError('HOSTINGER_UIDVALIDITY', 'Hostinger did not identify the mailbox version. Reconnect before retrieving codes.')
                        status, listing = request(client.uid, 'search', None, 'SINCE', search_date, 'FROM', '"' + sender + '"')
                        if status != 'OK': raise CompanionError('HOSTINGER_SEARCH', 'Hostinger could not search for verification mail.')
                        ids = listing[0].split() if listing and listing[0] else []
                        if len(ids) > 100:
                            raise CompanionError('TOO_MANY_MESSAGES', 'More than 100 matching emails arrived in the search period. Use a dedicated mailbox for verification.')
                        for uid in reversed(ids):
                            key = (folder, str(validity), uid)
                            if key in self.used or key in scanned: continue
                            status, data = request(client.uid, 'fetch', uid, '(INTERNALDATE BODY.PEEK[HEADER])')
                            if status != 'OK': continue
                            parts = [part for part in data if isinstance(part, tuple)]
                            if not parts: continue
                            meta, headers = parts[0]
                            stamp = re.search(rb'INTERNALDATE "([^"]+)"', meta)
                            if not stamp: continue
                            try: received = email.utils.parsedate_to_datetime(stamp[1].decode()).timestamp()*1000
                            except (ValueError, TypeError, UnicodeError): continue
                            if received < since_ms or received > time.time()*1000 + 60000:
                                scanned.add(key); continue
                            message = email.message_from_bytes(headers)
                            senders = [a.lower() for _, a in email.utils.getaddresses(message.get_all('From', []))]
                            recipients = [a.lower() for _, a in email.utils.getaddresses(sum((message.get_all(h, []) for h in ('To', 'Delivered-To', 'X-Original-To')), []))]
                            if senders != [sender] or recipient not in recipients:
                                scanned.add(key); continue
                            status, data = request(client.uid, 'fetch', uid, '(BODY.PEEK[]<0.2097153>)')
                            if status != 'OK': continue
                            chunks = [part[1] for part in data if isinstance(part, tuple)]
                            if not chunks: continue
                            raw = b''.join(chunks)
                            code = extract_code(raw, received, sender, recipient, since_ms)
                            if code: found.append((key, code))
                            else: scanned.add(key)
                    distinct = {code for _, code in found}
                    if len(distinct) > 1: raise CompanionError('AMBIGUOUS_CODE', 'Multiple fresh verification codes match this request.')
                    if found:
                        self.used.update(key for key, _ in found)
                        return {'code': found[0][1], 'recipient': recipient}
                    failures = 0
                    delay = 1 if time.monotonic()-started < 10 else 2
                except (imaplib.IMAP4.abort, OSError):
                    close()
                    failures += 1
                    delay = min(4, .5 * 2**min(failures-1, 3))
                except imaplib.IMAP4.error:
                    raise CompanionError('HOSTINGER_CONNECTION', 'Hostinger rejected the mailbox request. Check IMAP credentials.') from None
                cancel.wait(min(delay, max(0, deadline-time.monotonic())))
        finally:
            close()
        raise CompanionError('EMAIL_TIMEOUT', 'No fresh matching code arrived. Check the configured sender, recipient, and Hostinger inbox/spam delivery.')

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
