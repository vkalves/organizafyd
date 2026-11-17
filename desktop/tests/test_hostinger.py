import threading
import time
import unittest
from unittest.mock import Mock
from zyon.hostinger import Hostinger, Mailbox
from zyon.errors import CompanionError
from helpers import MemoryVault

class HostingerTests(unittest.TestCase):
    def setUp(self):
        self.vault = MemoryVault()
        self.vault.put('hostinger', {'mailbox': 'owner@example.com', 'password': 'secret'})
        self.client = Mock()
        self.client.list.return_value = ('OK', [b'(\\HasNoChildren) "/" "INBOX"'])
        self.client.select.side_effect = lambda folder, readonly=True: ('OK', []) if folder == 'INBOX' else ('NO', [])
        self.client.response.return_value = ('UIDVALIDITY', [b'12'])
        self.raw = b'From: security@mail.instagram.com\r\nTo: owner@example.com\r\nSubject: 123456 is your code\r\n\r\n123456'
        self.stamp = time.strftime('%d-%b-%Y %H:%M:%S +0000', time.gmtime()).encode()
        def uid(command, *args):
            if command == 'search': return 'OK', [b'7']
            raw = self.raw.split(b'\r\n\r\n')[0] if 'HEADER' in args[1] else self.raw
            return 'OK', [(b'7 (INTERNALDATE "' + self.stamp + b'"', raw)]
        self.client.uid.side_effect = uid
        self.factory = Mock(return_value=self.client)
        self.mail = Hostinger(self.vault, self.factory)

    def test_tls_readonly_retrieval_uses_peek_and_closes_connection(self):
        result = self.mail.wait_code('security@mail.instagram.com', 'owner@example.com', time.time()*1000-2000, threading.Event())
        self.assertEqual(result['code'], '123456')
        self.assertEqual(self.factory.call_args.args, ('imap.hostinger.com', 993))
        self.assertTrue(self.factory.call_args.kwargs['ssl_context'].check_hostname)
        self.client.select.assert_any_call('INBOX', readonly=True)
        self.client.uid.assert_any_call('fetch', b'7', '(BODY.PEEK[]<0.2097153>)')
        self.client.logout.assert_called_once()
        self.assertEqual(len(self.mail.used), 1)

    def test_wrong_recipient_and_stale_mail_are_not_accepted(self):
        self.raw = self.raw.replace(b'owner@example.com', b'other@example.com')
        cancel = threading.Event()
        cancel.wait = lambda _: cancel.set()
        with self.assertRaises(CompanionError) as caught:
            self.mail.wait_code('security@mail.instagram.com', 'owner@example.com', time.time()*1000-2000, cancel)
        self.assertEqual(caught.exception.code, 'CANCELLED')
        self.assertFalse(self.mail.used)

    def test_internaldate_second_precision_does_not_drop_same_second_delivery(self):
        from unittest.mock import patch
        now = time.time()
        self.stamp = time.strftime('%d-%b-%Y %H:%M:%S +0000', time.gmtime(now)).encode()
        with patch('zyon.hostinger.time.time', return_value=now):
            result = self.mail.wait_code('security@mail.instagram.com', 'owner@example.com', now*1000, threading.Event())
        self.assertEqual(result['code'], '123456')

    def test_failed_connection_restores_previous_credentials(self):
        self.client.login.side_effect = OSError('credential must not appear')
        with self.assertRaises(CompanionError) as caught: self.mail.connect('other@example.com', 'new-secret')
        self.assertEqual(self.vault.get('hostinger')['mailbox'], 'owner@example.com')
        self.assertNotIn('credential must not appear', str(caught.exception))
        self.client.logout.assert_called()

    def test_cancelled_before_connection(self):
        cancel = threading.Event(); cancel.set()
        with self.assertRaises(CompanionError):
            self.mail.wait_code('security@mail.instagram.com', 'owner@example.com', time.time()*1000, cancel)
        self.factory.assert_not_called()

    def test_provider_selection_survives_restart(self):
        mailbox = Mailbox(self.vault); mailbox.use('hostinger')
        self.assertEqual(Mailbox(self.vault).status()['mailbox'], 'owner@example.com')
        with self.assertRaises(CompanionError): mailbox.use('unknown')

    def test_stale_challenge_rejected_before_network(self):
        with self.assertRaises(CompanionError):
            self.mail.wait_code('security@mail.instagram.com', 'owner@example.com', time.time()*1000-700000, threading.Event())
        self.factory.assert_not_called()

    def test_connection_is_reused_while_waiting_for_delayed_delivery(self):
        original = self.client.uid.side_effect
        searches = 0
        def uid(command, *args):
            nonlocal searches
            if command == 'search':
                searches += 1
                if searches < 3: return 'OK', [b'']
            return original(command, *args)
        self.client.uid.side_effect = uid
        cancel = Mock(); cancel.is_set.return_value = False
        result = self.mail.wait_code('security@mail.instagram.com', 'owner@example.com', time.time()*1000-2000, cancel)
        self.assertEqual(result['code'], '123456')
        self.factory.assert_called_once()
        self.client.login.assert_called_once()
        self.client.list.assert_called_once()
        self.assertEqual(cancel.wait.call_args_list[0].args, (1,))

    def test_nonmatching_uid_is_not_fetched_again_during_polling(self):
        original = self.client.uid.side_effect
        searches = 0
        def uid(command, *args):
            nonlocal searches
            if command == 'search':
                searches += 1
                return 'OK', [b'6 7' if searches > 1 else b'6']
            status, parts = original(command, *args)
            if args[0] == b'6':
                parts = [(meta, body.replace(b'owner@example.com', b'other@example.com')) for meta, body in parts]
            return status, parts
        self.client.uid.side_effect = uid
        cancel = Mock(); cancel.is_set.return_value = False
        self.mail.wait_code('security@mail.instagram.com', 'owner@example.com', time.time()*1000-2000, cancel)
        headers = [call for call in self.client.uid.call_args_list if call.args == ('fetch', b'6', '(INTERNALDATE BODY.PEEK[HEADER])')]
        self.assertEqual(len(headers), 1)
        self.assertNotIn(('INBOX', "[b'12']", b'6'), self.mail.used)

    def test_discovers_localized_special_use_spam_folder(self):
        self.client.list.return_value = ('OK', [b'(\\HasNoChildren) "/" "INBOX"', b'(\\Junk) "/" "INBOX.Lixo"'])
        original = self.client.uid.side_effect
        selected = None
        def select(folder, readonly=True):
            nonlocal selected
            selected = folder
            return 'OK', []
        def uid(command, *args):
            if command == 'search' and selected == 'INBOX': return 'OK', [b'']
            return original(command, *args)
        self.client.select.side_effect = select
        self.client.uid.side_effect = uid
        result = self.mail.wait_code('security@mail.instagram.com', 'owner@example.com', time.time()*1000-2000, threading.Event())
        self.assertEqual(result['code'], '123456')
        self.client.select.assert_any_call('"INBOX.Lixo"', readonly=True)

    def test_dropped_connection_reconnects_without_losing_candidate(self):
        import imaplib
        self.client.list.return_value = ('OK', [b'(\\Junk) "/" "Spam"'])
        dropped = False
        def select(folder, readonly=True):
            nonlocal dropped
            if folder == '"Spam"' and not dropped:
                dropped = True
                raise imaplib.IMAP4.abort('fixture disconnect')
            return ('OK', []) if folder == 'INBOX' else ('NO', [])
        self.client.select.side_effect = select
        cancel = Mock(); cancel.is_set.return_value = False
        result = self.mail.wait_code('security@mail.instagram.com', 'owner@example.com', time.time()*1000-2000, cancel)
        self.assertEqual(result['code'], '123456')
        self.assertEqual(self.factory.call_count, 2)
        self.assertEqual(self.client.logout.call_count, 2)
        self.assertEqual(len(self.mail.used), 1)

    def test_network_failure_obeys_overall_deadline(self):
        from unittest.mock import patch
        self.factory.side_effect = OSError('fixture network failure')
        clock = [0]
        cancel = Mock(); cancel.is_set.return_value = False
        cancel.wait.side_effect = lambda delay: clock.__setitem__(0, clock[0]+delay)
        with patch('zyon.hostinger.time.monotonic', side_effect=lambda: clock[0]):
            with self.assertRaises(CompanionError) as caught:
                self.mail.wait_code('security@mail.instagram.com', 'owner@example.com', time.time()*1000, cancel, timeout=1)
        self.assertEqual(caught.exception.code, 'EMAIL_TIMEOUT')
        self.assertEqual(clock[0], 1)

    def test_ambiguous_codes_are_not_used(self):
        self.client.uid.side_effect = lambda command, *args: ('OK', [b'7 8']) if command == 'search' else ('OK', [(b'7 (INTERNALDATE "' + self.stamp + b'"', self.raw.replace(b'123456', b'654321') if args[0] == b'8' else self.raw)])
        with self.assertRaises(CompanionError) as caught:
            self.mail.wait_code('security@mail.instagram.com', 'owner@example.com', time.time()*1000-2000, threading.Event())
        self.assertEqual(caught.exception.code, 'AMBIGUOUS_CODE')
        self.assertFalse(self.mail.used)

    def test_midnight_search_overlaps_server_local_date(self):
        from datetime import datetime, timezone
        from unittest.mock import patch
        now = datetime(2026, 11, 16, 0, 1, tzinfo=timezone.utc).timestamp()
        self.stamp = b'15-Nov-2026 21:01:00 -0300'
        with patch('zyon.hostinger.time.time', return_value=now):
            result = self.mail.wait_code('security@mail.instagram.com', 'owner@example.com', now*1000, threading.Event())
        self.assertEqual(result['code'], '123456')
        self.client.uid.assert_any_call('search', None, 'SINCE', '15-Nov-2026', 'FROM', '"security@mail.instagram.com"')

    def test_no_code_body_is_not_downloaded_again(self):
        self.raw = self.raw.replace(b'123456', b'No verification code here')
        cancel = Mock(); cancel.is_set.side_effect = [False]*20+[True]
        with self.assertRaises(CompanionError) as caught:
            self.mail.wait_code('security@mail.instagram.com', 'owner@example.com', time.time()*1000-2000, cancel)
        self.assertEqual(caught.exception.code, 'CANCELLED')
        bodies = [call for call in self.client.uid.call_args_list if call.args == ('fetch', b'7', '(BODY.PEEK[]<0.2097153>)')]
        self.assertEqual(len(bodies), 1)
        self.client.logout.assert_called_once()

    def test_slow_logout_has_short_timeout_and_always_closes_socket(self):
        self.client.logout.side_effect = OSError('fixture logout timeout')
        result = self.mail.wait_code('security@mail.instagram.com', 'owner@example.com', time.time()*1000-2000, threading.Event())
        self.assertEqual(result['code'], '123456')
        self.client.sock.settimeout.assert_called_with(1)
        self.client.shutdown.assert_called_once()
