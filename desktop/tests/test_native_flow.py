# Python / tests/test_native_flow.py / Python 3.11+ / scripted UI contract, no real device
import threading
import unittest
from unittest.mock import Mock, patch
from zyon.android import Android, Screen
from zyon.errors import CompanionError
from helpers import MemoryVault, node, screen

class Element:
    def __init__(self, driver): self.driver=driver
    def is_displayed(self):return True
    def is_enabled(self):return True
    def click(self):self.driver.index+=1
    def send_keys(self,value):self.driver.submitted=value

class Driver:
    current_package='com.instagram.android'
    def __init__(self, screens):self.screens=screens;self.index=0;self.submitted=None
    @property
    def page_source(self):return self.screens[self.index]
    def find_elements(self,*args):return [Element(self)]
    def quit(self):pass

class NativeFlowTests(unittest.TestCase):
    def test_enrollment_stores_key_and_waits_for_activation_before_success(self):
        driver=Driver([
            screen(node('Authentication app'),node('Off')),
            screen(node('Next')),
            screen(node('Copy key'),node('JBSW Y3DP EHPK 3PXP'),node('Next')),
            screen(node('Enter code'),node('Next')),
            screen(node('Two-factor authentication is on')),
        ])
        vault=MemoryVault();progress=Mock()
        native=Android('s','http://127.0.0.1:4723',vault,threading.Event(),progress,driver=driver)
        with patch.object(native,'security_screen',return_value=Screen(driver.page_source)),patch('zyon.android.time.time',return_value=60):
            result=native.ensure_two_factor('same.account')
        self.assertTrue(result['twoFactor']);self.assertRegex(driver.submitted,r'^\d{6}$')
        secret=vault.get('instagram:same.account');self.assertEqual(secret['state'],'active');self.assertEqual(secret['seed'],'JBSWY3DPEHPK3PXP')
        self.assertNotIn('seed',result);progress.assert_called_with('two_factor_verified',unittest.mock.ANY)
    def test_unconfirmed_activation_retains_pending_material_and_never_reports_active(self):
        driver=Driver([
            screen(node('Authentication app'),node('Off')),
            screen(node('Next')),
            screen(node('Copy key'),node('JBSW Y3DP EHPK 3PXP'),node('Next')),
            screen(node('Enter code'),node('Next')),
            screen(node('Incorrect code')),
        ])
        vault=MemoryVault();progress=Mock();native=Android('s','http://127.0.0.1:4723',vault,threading.Event(),progress,driver=driver)
        original_wait=native.wait
        def wait(predicate,message,seconds=20):
            if driver.index==4:raise CompanionError('SCREEN_NOT_RECOGNIZED','Activation not confirmed')
            return original_wait(predicate,message,seconds)
        with patch.object(native,'security_screen',return_value=Screen(driver.page_source)),patch.object(native,'wait',side_effect=wait),patch('zyon.android.time.time',return_value=60):
            with self.assertRaises(CompanionError):native.ensure_two_factor('same.account')
        self.assertEqual(vault.get('instagram:same.account')['state'],'pending')
        self.assertNotIn('two_factor_verified',[call.args[0] for call in progress.call_args_list])
    def test_on_for_another_method_in_same_container_is_not_accepted(self):
        xml=screen(node('Authentication app'),node('Off'),node('Text message'),node('On'))
        self.assertFalse(Screen(xml).method_active())

if __name__=='__main__':unittest.main()
