# Python / tests/test_browser.py / Python 3.11+ / real browser engine with intercepted requests
import os,tempfile,threading,unittest
from unittest.mock import Mock
from playwright.sync_api import sync_playwright
from zyon.browser import Browser
from zyon.errors import CompanionError
from helpers import MemoryVault
LOGIN='''<html><body><input name="username"><input name="password" type="password"><button onclick="location.href='/challenge/'">Entrar</button></body></html>'''
CODE='''<html><body>Verifique seu email<input name="security_code" autocomplete="one-time-code"><button onclick="if(document.querySelector('input').value==='123456')location.href='/same.account/';">Continuar</button></body></html>'''
PROFILE='''<html><body><a href="/same.account/" aria-label="Perfil">Perfil</a></body></html>'''
INVITES='''<html><body><a href="/same.account/" aria-label="Perfil">Perfil</a><button>Convites do testador</button><section><p>Other App</p><button>Aceitar</button></section><section><p>Expected App</p><button onclick="this.textContent='Remover'">Aceitar</button></section></body></html>'''
@unittest.skipUnless(os.environ.get('ZYON_TEST_CHROME'),'Set ZYON_TEST_CHROME to test installed Chrome/Chromium')
class BrowserTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.playwright=sync_playwright().start();cls.chrome=cls.playwright.chromium.launch(executable_path=os.environ['ZYON_TEST_CHROME'],headless=True,args=['--no-sandbox'])
 @classmethod
 def tearDownClass(cls):cls.chrome.close();cls.playwright.stop()
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.context=self.chrome.new_context();self.addCleanup(self.context.close);self.seen=[]
  def serve(route):
   url=route.request.url;self.seen.append(url)
   html=LOGIN if url.endswith('/accounts/login/') else CODE if url.endswith('/challenge/') else INVITES if 'manage_access' in url else PROFILE
   route.fulfill(status=200,body=html,content_type='text/html')
  self.context.route('**/*',serve);self.gmail=Mock();self.gmail.wait_code.return_value={'code':'123456'}
  self.worker=Browser(self.temp.name,MemoryVault(),self.gmail,threading.Event(),Mock(),Mock(),context=self.context);self.worker.open('same.account')
 def test_email_code_retrieved_and_entered_automatically(self):
  self.assertEqual(self.worker.login('fixture-password','owner@example.com','security@mail.instagram.com'),'same.account');self.gmail.wait_code.assert_called_once();self.assertTrue(any('/challenge/' in u for u in self.seen))
 def test_accepts_only_exact_named_invitation(self):
  self.worker.page.goto('https://www.instagram.com/same.account/');self.assertTrue(self.worker.tester_invitation('Expected App')['accepted'])
 def test_wrong_profile_navigation_blocks_account_actions(self):
  self.worker.page.goto('https://www.instagram.com/same.account/');self.worker.page.locator('a').evaluate("e=>e.href='/wrong.account/'")
  with self.assertRaises(CompanionError) as caught:self.worker.identity()
  self.assertEqual(caught.exception.code,'WRONG_BROWSER_ACCOUNT')
 def test_unknown_origin_never_receives_credentials(self):
  self.worker.page.goto('https://untrusted.example/accounts/login/')
  with self.assertRaises(CompanionError):self.worker.guard({'www.instagram.com'})
  self.assertEqual(self.worker.page.locator('input[name=password]').input_value(),'')
 def test_selects_only_unambiguous_business_and_expected_instagram_assets(self):
  self.worker.page.goto('https://www.instagram.com/same.account/')
  self.worker.page.set_content('<select id="business"><option value="">Select</option><option value="owned">Owned portfolio</option></select><select id="instagram"><option value="wrong">other.account</option><option value="right">same.account</option></select>')
  self.assertTrue(self.worker.choose_unique_assets());self.assertEqual(self.worker.page.locator('#business').input_value(),'owned');self.assertEqual(self.worker.page.locator('#instagram').input_value(),'right')
 def test_ambiguous_business_assets_are_not_guessed(self):
  self.worker.page.goto('https://www.instagram.com/same.account/')
  self.worker.page.set_content('<select><option value="first">Portfolio one</option><option value="second">Portfolio two</option></select>same.account')
  self.assertFalse(self.worker.choose_unique_assets())
