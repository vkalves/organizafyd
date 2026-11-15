# Python / tests/test_avanca.py / Python 3.11+ / owner-scoped API boundaries
import time
import unittest
from zyon.avanca import Avanca
from zyon.errors import CompanionError
from helpers import MemoryVault
OWNER='11111111-1111-4111-8111-111111111111'
OTHER='22222222-2222-4222-8222-222222222222'
ACCOUNT='33333333-3333-4333-8333-333333333333'
FLOW='44444444-4444-4444-8444-444444444444'
CONFIG={'url':'https://csaplfphtvufxjhbpstl.supabase.co','publishableKey':'public-fixture'}
class Response:
 def __init__(self,data,ok=True):self.data,self.ok=data,ok;self.status_code=200 if ok else 400
 def json(self):return self.data
class API:
 def __init__(self):self.calls=[];self.members=[];self.write_error=False;self.owner=OWNER;self.profile='same.account';self.connected_owner=OWNER
 def request(self,method,url,json=None,params=None,headers=None,timeout=None):
  self.calls.append((method,url,json,params))
  if '/auth/v1/token' in url:return Response({'access_token':'fixture-access','refresh_token':'fixture-refresh','expires_in':3600,'user':{'id':self.owner,'email':'owner@example.com'}})
  if '/auth/v1/user' in url:return Response({'id':self.owner,'email':'owner@example.com'})
  if '/rest/v1/instagram_accounts' in url:
   assert params['user_id']=='eq.'+OWNER
   return Response([{'id':ACCOUNT,'user_id':self.connected_owner,'username':'same.account'}])
  if '/rest/v1/ig_flows' in url:
   assert params['user_id']=='eq.'+OWNER
   return Response([{'id':FLOW,'user_id':OWNER,'name':'Existing flow','state':'active','settings':{'accountIds':list(self.members)}}])
  action=json['action']
  if action=='access':return Response({'account_status':'approved'})
  if action=='status':return Response({'accounts':[{'account_id':ACCOUNT,'paused':False,'reconnect_required':False}]})
  if action=='verify':return Response({'id':'12345678','username':self.profile})
  if action=='add_flow_accounts':
   self.members.append(ACCOUNT)
   if self.write_error:raise __import__('requests').Timeout('credential-bearing detail')
   return Response({'added':1})
  if action=='config':return Response({'apps':[],'platformReady':True})
  if action=='invite':return Response({'url':'https://www.organizafy.site/instagram/conectar#invite=fixture'})
  raise AssertionError(action)
class AvancaTests(unittest.TestCase):
 def setUp(self):
  self.http=API();self.vault=MemoryVault();self.client=Avanca(self.vault,CONFIG,self.http);self.client.sign_in('owner@example.com','fixture-password')
 def writes(self):return [c for c in self.http.calls if c[2] and c[2].get('action')=='add_flow_accounts']
 def test_sync_checks_owned_membership_and_duplicate_writes(self):
  first=self.client.sync('same.account',FLOW);second=self.client.sync('same.account',FLOW)
  self.assertFalse(first['alreadyAssociated']);self.assertTrue(second['alreadyAssociated']);self.assertEqual(len(self.writes()),1)
 def test_lost_write_response_recovered_without_resend(self):
  self.http.write_error=True;result=self.client.sync('same.account',FLOW)
  self.assertTrue(result['recoveredAfterWriteError']);self.assertEqual(len(self.writes()),1)
 def test_other_user_record_never_attached(self):
  self.http.connected_owner=OTHER
  with self.assertRaises(CompanionError):self.client.sync('same.account',FLOW)
  self.assertEqual(self.writes(),[])
 def test_live_meta_mismatch_blocks_write(self):
  self.http.profile='different.account'
  with self.assertRaises(CompanionError):self.client.sync('same.account',FLOW)
  self.assertEqual(self.writes(),[])
 def test_session_switch_blocks_write(self):
  self.http.owner=OTHER
  with self.assertRaises(CompanionError):self.client.sync('same.account',FLOW)
  self.assertEqual(self.writes(),[])
 def test_refresh_persisted_in_vault(self):
  self.client.session['expires_at']=0;self.client.catalog()
  self.assertGreater(self.vault.get('avanca-session')['expires_at'],time.time())
  self.assertEqual(sum('/auth/v1/token' in c[1] for c in self.http.calls),2)
 def test_invite_bound_to_expected_instagram(self):
  self.client.invite('same.account',None)
  call=next(c for c in self.http.calls if c[2] and c[2].get('action')=='invite')
  self.assertEqual(call[2]['expected_username'],'same.account')
 def test_wrong_restored_user_rejected(self):
  self.http.owner=OTHER
  with self.assertRaises(CompanionError):self.client.restore('owner@example.com')
 def test_login_cannot_return_different_email(self):
  with self.assertRaises(CompanionError):self.client.sign_in('other@example.com','password')
