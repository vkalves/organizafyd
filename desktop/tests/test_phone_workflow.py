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
