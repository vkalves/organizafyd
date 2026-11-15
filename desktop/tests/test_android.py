# Python / tests/test_android.py / Python 3.11+ / semantic Android fixtures
import threading
import unittest
from unittest.mock import Mock, patch
from zyon.android import Android, Screen, handle, totp
from zyon.errors import CompanionError
from helpers import MemoryVault, node, screen

PROFILE = screen(node('Edit profile'), node('same.account', 'com.instagram.android:id/profile_header_username'),node(desc='Options'))
ACTIVE = screen(node('Authentication app') + node('On'))

class AndroidTests(unittest.TestCase):
    def setUp(self):
        self.driver=Mock();self.driver.current_package='com.instagram.android';self.driver.page_source=PROFILE
        self.native=Android('serial','http://127.0.0.1:4723',MemoryVault(),threading.Event(),Mock(),driver=self.driver)
    def test_rfc6238_sha1_vector_truncated_to_six_digits(self): self.assertEqual(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',59),'287082')
    def test_profile_requires_profile_anchor(self):
        with self.assertRaises(CompanionError): Screen(screen(node('same.account','com.instagram.android:id/action_bar_title'))).profile_handle()
    def test_profile_identity_exact(self): self.assertEqual(Screen(PROFILE).profile_handle(),'same.account')
    def test_ambiguous_profile_rejected(self):
        xml=screen(node('Edit profile'),node('one','x:id/profile_header_username'),node('two','x:id/action_bar_title'))
        with self.assertRaises(CompanionError): Screen(xml).profile_handle()
    def test_wrong_account_no_tap(self):
        with self.assertRaises(CompanionError) as caught: self.native.assert_profile('other.account')
        self.assertEqual(caught.exception.code,'WRONG_ACCOUNT');self.driver.find_elements.assert_not_called()
    def test_foreign_app_rejected(self):
        self.driver.current_package='com.android.chrome'
        with self.assertRaises(CompanionError):self.native.screen()
    def test_cancel_stops_before_ui_read(self):
        self.native.cancel.set()
        with self.assertRaises(CompanionError): self.native.screen()
    def test_remote_appium_rejected(self):
        for endpoint in ['http://example.com:4723','http://127.0.0.1.evil:4723','https://127.0.0.1:4723','http://u:p@127.0.0.1:4723']:
            with self.subTest(endpoint=endpoint),self.assertRaises(CompanionError): Android('s',endpoint,MemoryVault(),threading.Event(),Mock())
    def test_duplicate_control_no_tap(self):
        self.driver.page_source=screen(node('Next'),node('Next'))
        with self.assertRaises(CompanionError):self.native.click(('Next',))
        self.driver.find_elements.assert_not_called()
    def test_already_enabled_no_enrollment(self):
        with patch.object(self.native,'security_screen',return_value=Screen(ACTIVE)),patch.object(self.native,'click') as click:
            result=self.native.ensure_two_factor('same.account')
            self.assertTrue(result['alreadyEnabled']);click.assert_not_called()
    def test_logout_requires_fresh_visible_2fa(self):
        self.driver.page_source=screen(node('Authentication app'),node('Off'))
        with patch.object(self.native,'security_screen'):
            with self.assertRaises(CompanionError) as caught:self.native.logout('same.account')
        self.assertEqual(caught.exception.code,'TWO_FACTOR_UNCONFIRMED');self.driver.back.assert_not_called()
    def test_unrelated_on_label_cannot_confirm_authentication_method(self):
        xml='<hierarchy><node>'+node('Authentication app')+'</node><node>'+node('SMS')+node('On')+'</node></hierarchy>'
        self.assertFalse(Screen(xml).method_active())
    def test_setup_key_requires_known_screen(self):self.assertIsNone(Screen(screen(node('JBSWY3DPEHPK3PXP'))).seed())
    def test_seed_and_backup_material_recognized_only_in_context(self):
        self.assertEqual(Screen(screen(node('Copy key'),node('JBSW Y3DP EHPK 3PXP'))).seed(),'JBSWY3DPEHPK3PXP')
        codes=['1234 5678','2345 6789','3456 7890','4567 8901','5678 9012']
        self.assertEqual(len(Screen(screen(node('Backup codes'),*(node(c) for c in codes))).backup_codes()),5)
    def test_handle_canonical_and_invalid_input(self):
        self.assertEqual(handle(' @Same.Account '),'same.account')
        with self.assertRaises(CompanionError):handle('account; command')

if __name__=='__main__':unittest.main()
