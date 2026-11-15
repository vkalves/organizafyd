# Python / tests/test_workflow.py / Python 3.11+ / actual orchestration with injected external boundaries
from pathlib import Path
import tempfile,time,unittest
from zyon.errors import CompanionError
from zyon.workflow import Workflow,configuration
from helpers import MemoryVault
from test_avanca import OWNER,ACCOUNT,FLOW
SETTINGS={'username':'same.account','recipient':'owner@example.com','avanca_email':'owner@example.com','avanca_password':'secret-avanca','instagram_password':'secret-instagram','flow_id':FLOW,'meta_app_id':None,'tester_app_name':'Expected Meta App','serial':'device-serial','create_account':False}
class WorkflowTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.vault=MemoryVault();self.calls=[]
  calls=self.calls;vault=self.vault
  class Gmail:
   def status(self):return {'connected':True}
   def verify(self):calls.append('gmail_verify');return {'connected':True}
  class Avanca:
   def restore(self,email):calls.append('avanca_restore');return True
   def catalog(self):return {'flows':[{'id':FLOW,'name':'Existing'}],'apps':[],'platformReady':True}
   def preflight(self,username):calls.append('api_preflight');return {'accountId':ACCOUNT,'userId':OWNER,'username':username,'graphId':'12345678'}
   def sync(self,username,flow):calls.append('sync');return {'username':username,'flowId':flow,'flowName':'Existing'}
  class Runtime:
   def ensure(self):calls.append('runtime')
   def close(self):calls.append('runtime_close')
  class Phone:
   def __init__(self,*args,**kwargs):pass
   def open(self):calls.append('phone_open')
   def prepare(self,settings):calls.append('phone_prepare')
   def ensure_two_factor(self,username):calls.append('two_factor');vault.put('instagram:'+username,{'seed':'fixture-seed','state':'active'})
   def collect_recovery(self,username):calls.append('recovery')
   def profile(self,username):calls.append('native_identity')
   def logout(self,username):calls.append('logout')
   def close(self):calls.append('phone_close')
  class Browser:
   def __init__(self,*args,**kwargs):pass
   def open(self,*args):calls.append('chrome_open')
   def login(self,*args):calls.append('chrome_login')
   def tester_invitation(self,name):calls.append('invitation_accept')
   def close(self):calls.append('chrome_close')
  self.workflow=Workflow(self.temp.name,vault,avanca=Avanca(),gmail=Gmail(),phone_factory=Phone,browser_factory=Browser,runtime=Runtime());self.addCleanup(self.workflow.close)
 def wait_state(self,status):
  deadline=time.monotonic()+3
  while time.monotonic()<deadline:
   state=self.workflow.snapshot()
   if state['status']==status:return state
   time.sleep(.01)
  self.fail(str(self.workflow.snapshot()))
 def test_pipeline_pauses_before_acceptance_and_resumes_once(self):
  self.workflow.start(SETTINGS);paused=self.wait_state('paused')
  self.assertEqual(paused['pauseReason'],'tester_invitation');self.assertIn('@same.account',paused['message'])
  self.assertNotIn('invitation_accept',self.calls);self.assertNotIn('sync',self.calls)
  self.assertLess(self.calls.index('two_factor'),self.calls.index('logout'));self.assertLess(self.calls.index('logout'),self.calls.index('chrome_login'))
  self.assertFalse(self.workflow.resume('stale-pause'));self.assertTrue(self.workflow.resume(paused['pauseId']));self.assertFalse(self.workflow.resume(paused['pauseId']))
  result=self.wait_state('completed');self.assertEqual(result['result']['username'],'same.account');self.assertEqual(self.calls.count('sync'),1)
 def test_stop_at_pause_prevents_acceptance_and_sync(self):
  self.workflow.start(SETTINGS);self.wait_state('paused');self.workflow.stop();self.wait_state('stopped');self.assertNotIn('invitation_accept',self.calls);self.assertNotIn('sync',self.calls)
 def test_config_edits_cannot_change_active_run(self):
  values=dict(SETTINGS);self.workflow.start(values);values['username']='other.account';self.assertEqual(self.wait_state('paused')['username'],'same.account')
 def test_checkpoint_excludes_passwords_and_seed(self):
  self.workflow.start(SETTINGS);self.wait_state('paused');content=''.join(p.read_text() for p in (Path(self.temp.name)/'runs').glob('*.json'))
  for secret in ('secret-instagram','secret-avanca','fixture-seed'):self.assertNotIn(secret,content)
 def test_unknown_native_result_blocks_browser_and_write(self):
  factory=self.workflow.phone_factory
  class WrongPhone(factory):
   def prepare(self,settings):raise CompanionError('WRONG_ACCOUNT','Unexpected native account')
  self.workflow.phone_factory=WrongPhone;self.workflow.start(SETTINGS);self.wait_state('needs_attention');self.assertNotIn('chrome_open',self.calls);self.assertNotIn('sync',self.calls)
 def test_missing_gmail_blocks_external_actions(self):
  self.workflow.gmail.status=lambda:{'connected':False}
  with self.assertRaises(CompanionError):self.workflow.start(SETTINGS)
  self.assertEqual(self.calls,[])
 def test_creation_requires_adult_birthdate(self):
  for extra in ({'birthday':'2020-01-01','full_name':'Configured Name'},{}):
   with self.assertRaises(CompanionError):configuration({**SETTINGS,'create_account':True,**extra})
 def test_story_scheme_validated(self):
  with self.assertRaises(CompanionError):configuration({**SETTINGS,'story_link':'javascript:alert(1)'})
 def test_queue_advances_after_completed_account_and_requires_new_invitation_pause(self):
  second={**SETTINGS,'username':'next.account'}
  self.workflow.start_many([SETTINGS,second])
  first=self.wait_state('paused');self.assertEqual(first['username'],'same.account');self.workflow.resume(first['pauseId'])
  deadline=time.monotonic()+3
  while time.monotonic()<deadline:
   current=self.workflow.snapshot()
   if current['status']=='paused' and current['username']=='next.account':break
   time.sleep(.01)
  else:self.fail('Second account did not reach its own invitation pause')
  self.assertEqual(current['cycle'],2);self.assertNotEqual(first['pauseId'],current['pauseId'])
  self.assertFalse(self.workflow.resume(first['pauseId']));self.assertEqual(self.calls.count('sync'),1)
  self.workflow.resume(current['pauseId']);self.workflow.thread.join(timeout=3)
  self.assertEqual(self.workflow.snapshot()['status'],'completed');self.assertEqual(self.calls.count('sync'),2)
