# Python / tests/test_phone_workflow.py / Python 3.11+ / native workflow side-effect guards
import threading,unittest
from unittest.mock import Mock,patch
from zyon.phone import Phone
from zyon.errors import CompanionError
from helpers import MemoryVault,screen,node
class PhoneWorkflowTests(unittest.TestCase):
 def setUp(self):
  self.driver=Mock();self.driver.current_package='com.instagram.android';self.driver.page_source=screen(node('Edit profile'),node('same.account','com.instagram.android:id/profile_header_username'))
  self.phone=Phone('serial','http://127.0.0.1:4723',MemoryVault(),threading.Event(),Mock(),driver=self.driver,gmail=Mock(),pause=Mock(),journal={})
 def test_uncertain_story_never_reposted(self):
  self.phone.journal['story']='submitted'
  with patch.object(self.phone,'media') as media:
   with self.assertRaises(CompanionError):self.phone.story({'username':'same.account','story_media':'fixture.jpg'})
   media.assert_not_called()
 def test_confirmed_story_not_reposted(self):
  self.phone.journal['story']='confirmed'
  with patch.object(self.phone,'media') as media:self.phone.story({'username':'same.account','story_media':'fixture.jpg'});media.assert_not_called()
 def test_verified_existing_profile_does_not_create_duplicate(self):
  self.phone.create_account({'username':'same.account'});self.driver.find_elements.assert_not_called()
 def test_missing_media_rejected_before_transfer(self):
  with self.assertRaises(CompanionError):self.phone.media('/missing/media.jpg','story','same.account')
  self.driver.push_file.assert_not_called()
 def test_duplicate_parent_and_child_label_resolve_to_single_control(self):
  from zyon.android import Screen
  data='<hierarchy><node clickable="true" content-desc="Next"><node text="Next" class="android.widget.TextView"/></node></hierarchy>'
  controls=Screen(data).controls(('Next',))
  self.assertEqual(len(controls),1);self.assertEqual(controls[0].get('text'),'Next')
 def test_signup_enters_configured_fields_and_email_code_until_verified_profile(self):
  from helpers import node,screen
  stages=[screen(node('Qual é seu email?'),node(cls='android.widget.EditText'),node('Avançar')),
   screen(node('Insira o código de confirmação'),*(node(cls='android.widget.EditText') for _ in range(6)),node('Avançar')),
   screen(node('Crie uma senha'),node(cls='android.widget.EditText'),node('Avançar')),
   screen(node('Qual é sua data de nascimento?'),node('Avançar')),
   screen(node('Qual é seu nome?'),node(cls='android.widget.EditText'),node('Avançar')),
   screen(node('Crie um nome de usuário'),node(cls='android.widget.EditText'),node('Avançar')),
   screen(node('Concorde com os termos e políticas do Instagram'),node('Concordo')),
   screen(node('Edit profile'),node('same.account','com.instagram.android:id/profile_header_username'))]
  from test_signup_email_method import SignupDriver
  driver=SignupDriver(stages);self.phone.driver=driver
  self.phone.gmail.wait_code.return_value={'code':'123456'}
  settings={'username':'same.account','recipient':'owner@example.com','email_sender':'security@mail.instagram.com','instagram_password':'fixture-password','birthday':'2000-01-02','full_name':'Configured Profile'}
  with patch.object(self.phone,'birthday') as birthday,patch('zyon.phone.time.sleep'):
   self.phone.create_account(settings)
   birthday.assert_called_once_with('2000-01-02')
  self.assertEqual(driver.index,7)
  self.assertIn((0,'owner@example.com'),driver.typed);self.assertIn((2,'fixture-password'),driver.typed)
  self.assertEqual(''.join(v for index,v in driver.typed if index==1),'123456')
  self.assertIn((4,'Configured Profile'),driver.typed);self.assertIn((5,'same.account'),driver.typed)
 def test_uncertain_story_for_one_asset_blocks_a_different_asset(self):
  self.phone.journal['stories']={'old-digest':{'story':'submitted'}}
  with patch.object(self.phone,'media') as media:
   with self.assertRaises(CompanionError):self.phone.story({'username':'same.account','story_media':'new.jpg','story_fingerprint':'new-digest'})
   media.assert_not_called()
 def test_confirmed_story_requires_its_configured_highlight_to_be_confirmed(self):
  self.phone.journal['stories']={'digest':{'story':'confirmed','highlight':'confirmed','highlightName':'Other'}}
  with self.assertRaises(CompanionError) as caught:self.phone.story({'username':'same.account','story_media':'asset.jpg','story_fingerprint':'digest','highlight':'Expected'})
  self.assertEqual(caught.exception.code,'HIGHLIGHT_REVIEW_REQUIRED')
 def test_changed_media_is_rejected_before_device_transfer(self):
  import tempfile,pathlib
  with tempfile.TemporaryDirectory() as directory:
   path=pathlib.Path(directory)/'asset.jpg';path.write_bytes(b'changed fixture media')
   with self.assertRaises(CompanionError) as caught:self.phone.media(str(path),'story','same.account','0'*64)
   self.assertEqual(caught.exception.code,'MEDIA_CHANGED');self.driver.push_file.assert_not_called()
 def test_calendar_selects_verified_year_day_before_confirming(self):
  from datetime import date
  class Element:
   def __init__(self,driver,kind):self.driver,self.kind=driver,kind
   def is_displayed(self):return True
   def is_enabled(self):return True
   def click(self):
    if self.kind=='header':self.driver.mode='years'
    elif self.kind=='year':self.driver.mode='calendar'
    elif self.kind=='day':self.driver.selected=True
    elif self.kind=='ok':self.driver.mode='confirmed'
   def get_attribute(self,key):return 'true' if key=='selected' and self.driver.selected else 'false'
  class Driver:
   current_package='android'
   def __init__(self):self.mode='start';self.selected=False
   @property
   def page_source(self):return '<hierarchy><node text="OK"/><node content-desc="2 de janeiro de 2000"/></hierarchy>'
   def find_element(self,kind,value):
    assert '2000' in value
    return Element(self,'year')
   def find_elements(self,kind,value):
    if kind=='id' and value=='android:id/date_picker_header_year':return [Element(self,'header')]
    if '@text=' in value and '2000' in value:return [Element(self,'year')]
    if '@content-desc=' in value and 'janeiro' in value:return [Element(self,'day')]
    if '@text=' in value and 'OK' in value:return [Element(self,'ok')]
    return []
  driver=Driver();self.phone.driver=driver
  self.assertTrue(self.phone.calendar_birthday(date(2000,1,2)));self.assertEqual(driver.mode,'confirmed');self.assertTrue(driver.selected)
 def test_uploads_are_isolated_by_account_even_when_media_is_reused(self):
  import tempfile,pathlib
  with tempfile.TemporaryDirectory() as directory,patch('zyon.phone.subprocess.run'):
   path=pathlib.Path(directory)/'asset.jpg';path.write_bytes(b'fixture image')
   first=self.phone.media(str(path),'profile','first.account');second=self.phone.media(str(path),'profile','second.account')
   self.assertNotEqual(self.phone.media_albums[first],self.phone.media_albums[second])
   paths=[c.args[0] for c in self.driver.push_file.call_args_list]
   self.assertTrue(all(p.startswith('/sdcard/Pictures/Zyon_profile_') for p in paths))
