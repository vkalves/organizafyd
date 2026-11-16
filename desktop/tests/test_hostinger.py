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
