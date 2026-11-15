# Python / tests/test_server.py / Python 3.11+ / loopback and workflow tests
import http.client
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from zyon.errors import CompanionError
from zyon.server import App, Server
from zyon.vault import Vault
from helpers import MemoryVault, wait_job

class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.app=App(self.temp.name,MemoryVault())
    def test_start_serializes_operations(self):
        gate=threading.Event()
        self.app.start('first',lambda:gate.wait(2))
        with self.assertRaises(CompanionError):self.app.start('second',lambda:None)
        gate.set();wait_job(self.app)
    def test_unexpected_exception_is_redacted(self):
        def work():raise RuntimeError('secret-password-refresh-token')
        self.app.start('work',work);result=wait_job(self.app)
        self.assertNotIn('secret-password',json.dumps(result));self.assertEqual(result['job']['state'],'needs_attention')
    def test_logout_cannot_bypass_recovery(self):
        with self.assertRaises(CompanionError):self.app.native({'username':'same.account','serial':'s'},logout=True)
    def test_recovery_requires_observed_two_factor(self):
        with self.assertRaises(CompanionError):self.app.action('/api/recovery/confirm',{'confirmed':True})
    def test_browser_cannot_skip_native(self):
        with patch('zyon.server.chrome') as browser:
            with self.assertRaises(CompanionError):self.app.action('/api/browser',{})
            browser.assert_not_called()
    def test_invitation_gate_requires_explicit_confirmation(self):
        self.app.workflow.update(username='same.account',phase='invitation_pending')
        with patch('zyon.server.chrome') as browser:
            with self.assertRaises(CompanionError):self.app.action('/api/continue',{'confirmed':False})
            browser.assert_not_called()
            result=self.app.action('/api/continue',{'confirmed':True})
        self.assertEqual(result['url'],'https://www.organizafy.site/avanca/integracao?expected_username=same.account')
        self.assertNotIn('token',result['url'])
    def test_restart_never_assumes_completed_native_stage(self):
        self.app.workflow.update(username='same.account',serial='s',phase='native_complete',recoveryConfirmed=True);self.app.persist()
        restored=App(self.temp.name,MemoryVault())
        self.assertEqual(restored.workflow['phase'],'interrupted');self.assertFalse(restored.workflow['recoveryConfirmed'])
    def test_email_code_not_persisted_and_expires(self):
        self.app.start('email',lambda:{'code':'123456'})
        result=wait_job(self.app);self.assertEqual(result['job']['result']['code'],'123456')
        self.app.job['expiresAt']=time.time()-1
        self.assertNotIn('result',self.app.snapshot()['job'])
        self.assertFalse((Path(self.temp.name)/'workflow.json').exists())
    @unittest.skipUnless(os.name=='nt','DPAPI requires Windows')
    def test_real_windows_dpapi_roundtrip_and_no_plaintext(self):
        vault=Vault(self.temp.name);vault.put('test',{'refresh_token':'top-secret-test'})
        self.assertEqual(vault.get('test')['refresh_token'],'top-secret-test')
        self.assertNotIn(b'top-secret-test',vault.path('test').read_bytes());vault.delete('test');self.assertIsNone(vault.get('test'))

class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.app=App(self.temp.name,MemoryVault());self.server=Server(0,self.app)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
    def request(self,path,method='GET',headers=None,body=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=5)
        connection.request(method,path,body=body,headers=headers or {})
        response=connection.getresponse();data=response.read();status=response.status;connection.close();return status,data
    def test_static_page_has_no_token(self):
        status,body=self.request('/');self.assertEqual(status,200);self.assertNotIn(self.app.token.encode(),body)
    def test_api_requires_bearer(self):self.assertEqual(self.request('/api/status')[0],401)
    def test_correct_token_reads_redacted_state(self):
        status,body=self.request('/api/status',headers={'Authorization':'Bearer '+self.app.token})
        self.assertEqual(status,200);self.assertNotIn(self.app.token.encode(),body)
    def test_foreign_origin_rejected_even_with_token(self):
        self.assertEqual(self.request('/api/status',headers={'Authorization':'Bearer '+self.app.token,'Origin':'https://evil.example'})[0],403)
    def test_rebinding_host_rejected(self):
        self.assertEqual(self.request('/api/status',headers={'Authorization':'Bearer '+self.app.token,'Host':'evil.example'})[0],403)
    def test_post_requires_json(self):
        self.assertEqual(self.request('/api/stop','POST',{'Authorization':'Bearer '+self.app.token},'{}')[0],415)
    def test_traversal_not_served(self):self.assertEqual(self.request('/../server.py')[0],404)

if __name__=='__main__':unittest.main()
