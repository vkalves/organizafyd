# Python / tests/test_gmail.py / Python 3.11+ / Gmail boundary tests
import base64
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
import json
import threading
import time
import unittest
from unittest.mock import patch
from google.auth.exceptions import RefreshError
from zyon.errors import CompanionError
from zyon.gmail import Gmail, address, extract_code
from helpers import MemoryVault


def raw_mail(body='Your code is 123456', sender='security@mail.instagram.com', recipient='owner@gmail.com'):
    msg = EmailMessage(); msg['From'] = sender; msg['To'] = recipient; msg['Subject'] = 'Instagram verification'
    msg.set_content(body)
    return msg.as_bytes()


class EmailParsingTests(unittest.TestCase):
    def setUp(self): self.now = time.time() * 1000
    def code(self, raw=None, received=None, sender='security@mail.instagram.com', recipient='owner@gmail.com'):
        return extract_code(raw if raw is not None else raw_mail(), received if received is not None else self.now, sender, recipient, self.now - 1000, self.now)
    def test_fresh_exact_match(self): self.assertEqual(self.code(), '123456')
    def test_wrong_recipient(self): self.assertIsNone(self.code(recipient='other@gmail.com'))
    def test_wrong_sender(self): self.assertIsNone(self.code(sender='other@mail.instagram.com'))
    def test_stale_code(self): self.assertIsNone(self.code(received=self.now - 2000))
    def test_future_code(self): self.assertIsNone(self.code(received=self.now + 120000))
    def test_repeated_same_code_is_unambiguous(self): self.assertEqual(self.code(raw_mail('123456 and again 123456')), '123456')
    def test_different_codes_rejected(self):
        with self.assertRaisesRegex(CompanionError, 'multiple'): self.code(raw_mail('123456 or 654321'))
    def test_longer_numbers_not_truncated(self): self.assertIsNone(self.code(raw_mail('123456789')))
    def test_html_code_and_attachment(self):
        msg = EmailMessage(); msg['From']='security@mail.instagram.com'; msg['To']='owner@gmail.com'
        msg.set_content('Your code is below.'); msg.add_alternative('<style>654321</style><p>123456</p>', subtype='html')
        msg.add_attachment(b'999999', maintype='text', subtype='plain', filename='ignore.txt')
        self.assertEqual(self.code(msg.as_bytes()), '123456')
    def test_email_rejects_search_injection(self):
        for value in ['owner@gmail.com OR x', 'Name <owner@gmail.com>', 'owner@gmail.com\n', '']:
            with self.subTest(value=value), self.assertRaises(CompanionError): address(value)


class GmailRequestTests(unittest.TestCase):
    def setUp(self):
        self.vault = MemoryVault()
        self.vault.put('gmail', {'mailbox':'owner@gmail.com','credentials':{'token':'old-token','refresh_token':'refresh','client_id':'client.apps.googleusercontent.com','client_secret':'secret','token_uri':'https://oauth2.googleapis.com/token','expiry':'2020-01-01T00:00:00Z'}})
    def test_refresh_persisted_without_exposing_credentials(self):
        class Session:
            def __init__(self, credentials): self.credentials=credentials
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def get(self, *args, **kwargs):
                self.credentials.token='renewed-token'
                self.credentials.expiry=datetime.now(timezone.utc).replace(tzinfo=None)+timedelta(hours=1)
                class Response:
                    status_code=200
                    def json(self): return {'emailAddress':'owner@gmail.com'}
                return Response()
        gmail=Gmail(self.vault, Session)
        self.assertEqual(gmail.request('profile'), {'emailAddress':'owner@gmail.com'})
        self.assertEqual(self.vault.get('gmail')['credentials']['token'], 'renewed-token')
        self.assertNotIn('credentials', gmail.status())
    def test_invalid_grant_requires_reconnect(self):
        class Session:
            def __init__(self, credentials): pass
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def get(self,*args,**kwargs): raise RefreshError('invalid_grant secret-do-not-log')
        gmail=Gmail(self.vault, Session)
        with self.assertRaises(CompanionError) as caught: gmail.request('profile')
        self.assertEqual(caught.exception.code, 'GMAIL_RECONNECT')
        self.assertNotIn('secret-do-not-log', str(caught.exception))
        self.assertTrue(gmail.status()['reconnect'])
    def test_disconnect_deletes_saved_grant(self):
        gmail=Gmail(self.vault); gmail.disconnect(); self.assertFalse(gmail.status()['connected'])
    def test_wrong_mailbox_consent_is_not_saved(self):
        class Response:
            status_code=200
            def json(self): return {'emailAddress':'wrong@gmail.com'}
        class Session:
            def __init__(self,*args): pass
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def get(self,*args,**kwargs): return Response()
        class Credentials:
            refresh_token='refresh'
        class Flow:
            def run_local_server(self,**kwargs): return Credentials()
        with patch('google_auth_oauthlib.flow.InstalledAppFlow.from_client_config',return_value=Flow()), patch('google.auth.transport.requests.AuthorizedSession',Session):
            with self.assertRaises(CompanionError) as caught:
                Gmail(self.vault).connect({'installed':{'client_id':'id.apps.googleusercontent.com','client_secret':'secret'}}, 'owner@gmail.com')
        self.assertEqual(caught.exception.code,'WRONG_MAILBOX')
        self.assertEqual(self.vault.get('gmail')['credentials']['token'],'old-token')
    def test_poll_rejects_old_request(self):
        with self.assertRaises(CompanionError): Gmail(self.vault).wait_code('security@mail.instagram.com','owner@gmail.com',time.time()*1000-700000,threading.Event(),1)
    def test_message_retrieved_once(self):
        gmail=Gmail(self.vault)
        raw=base64.urlsafe_b64encode(raw_mail()).decode().rstrip('=')
        def request(path, params=None):
            if path=='messages': return {'messages':[{'id':'m1'}]}
            return {'raw':raw,'internalDate':str(int(time.time()*1000))}
        gmail.request=request
        self.assertEqual(gmail.wait_code('security@mail.instagram.com','owner@gmail.com',time.time()*1000-500,threading.Event(),1)['code'],'123456')
        self.assertIn('m1',gmail.used)
    def test_multiple_messages_rejected(self):
        gmail=Gmail(self.vault)
        raw=base64.urlsafe_b64encode(raw_mail()).decode()
        gmail.request=lambda path,params=None: {'messages':[{'id':'a'},{'id':'b'}]} if path=='messages' else {'raw':raw,'internalDate':str(int(time.time()*1000))}
        with self.assertRaises(CompanionError) as caught: gmail.wait_code('security@mail.instagram.com','owner@gmail.com',time.time()*1000-500,threading.Event(),1)
        self.assertEqual(caught.exception.code,'AMBIGUOUS_CODE')
    def test_cancel_does_not_query_gmail(self):
        cancel=threading.Event();cancel.set();gmail=Gmail(self.vault)
        with patch.object(gmail,'request') as request:
            with self.assertRaises(CompanionError):gmail.wait_code('security@mail.instagram.com','owner@gmail.com',time.time()*1000,cancel,1)
            request.assert_not_called()

if __name__=='__main__': unittest.main()
