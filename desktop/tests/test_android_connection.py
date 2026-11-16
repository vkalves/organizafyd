# Python / tests/test_android_connection.py / Python 3.11+ / actual Appium SDK imports and connection boundaries
from importlib.metadata import PackageNotFoundError
import threading
import unittest
from unittest.mock import Mock, patch
from zyon.android import Android, client_components, session_failure, PACKAGE
from zyon.errors import CompanionError
from helpers import MemoryVault


class AndroidConnectionTests(unittest.TestCase):
    def setUp(self):
        self.progress = Mock()
        self.phone = Android('selected-phone', 'http://127.0.0.1:4723', MemoryVault(), threading.Event(), self.progress)
        self.addCleanup(self.phone.close)

    def test_real_client_and_distribution_metadata_load(self):
        webdriver, options_class, config_class, proxy_class = client_components()
        self.assertTrue(callable(webdriver.Remote))
        self.assertEqual(options_class().load_capabilities({'appium:automationName': 'UiAutomator2'}).to_capabilities()['appium:automationName'], 'UiAutomator2')
        config = config_class(remote_server_addr=self.phone.endpoint, proxy=proxy_class({'proxyType': 'direct'}))
        self.assertEqual(config.proxy.to_capabilities(), {'proxyType': 'direct'})

    def test_missing_metadata_identified_before_device_or_session_actions(self):
        with patch('zyon.android.version', side_effect=PackageNotFoundError('Appium-Python-Client')), patch('zyon.android.devices') as adb:
            with self.assertRaises(CompanionError) as caught: self.phone.open()
            adb.assert_not_called()
        self.assertEqual(caught.exception.code, 'ANDROID_CLIENT_INCOMPLETE')
        self.assertEqual(self.progress.call_args.args[0], 'android_client_loading')

    def test_open_uses_actual_sdk_options_and_direct_local_connection(self):
        with patch('zyon.android.devices', return_value=[{'serial': 'selected-phone', 'state': 'device'}]), patch('appium.webdriver.Remote') as remote:
            self.phone.open()
            kwargs = remote.call_args.kwargs
            capabilities = kwargs['options'].to_capabilities()
            self.assertEqual(capabilities['appium:udid'], 'selected-phone')
            self.assertTrue(capabilities['appium:noReset']); self.assertFalse(capabilities['appium:autoLaunch'])
            self.assertEqual(kwargs['client_config'].proxy.to_capabilities(), {'proxyType': 'direct'})
            remote.return_value.activate_app.assert_called_once_with(PACKAGE)
            self.assertEqual([call.args[0] for call in self.progress.call_args_list], ['android_client_loading', 'adb_device_check', 'android_session_start', 'instagram_launch'])

    def test_unauthorized_and_offline_devices_do_not_create_sessions(self):
        for state, code in [('unauthorized', 'DEVICE_UNAUTHORIZED'), ('offline', 'DEVICE_OFFLINE')]:
            with self.subTest(state=state), patch('zyon.android.devices', return_value=[{'serial': 'selected-phone', 'state': state}]), patch('appium.webdriver.Remote') as remote:
                with self.assertRaises(CompanionError) as caught: self.phone.open()
                self.assertEqual(caught.exception.code, code); remote.assert_not_called()

    def test_selected_device_absent_does_not_use_another_phone(self):
        with patch('zyon.android.devices', return_value=[{'serial': 'other-phone', 'state': 'device'}]), patch('appium.webdriver.Remote') as remote:
            with self.assertRaises(CompanionError) as caught: self.phone.open()
            self.assertEqual(caught.exception.code, 'DEVICE_NOT_READY'); remote.assert_not_called()

    def test_session_error_does_not_leak_driver_response_or_credentials(self):
        secret = 'sensitive-fixture-password'
        with patch('zyon.android.devices', return_value=[{'serial': 'selected-phone', 'state': 'device'}]), patch('appium.webdriver.Remote', side_effect=RuntimeError('INSTALL_FAILED_USER_RESTRICTED ' + secret)):
            with self.assertRaises(CompanionError) as caught: self.phone.open()
        self.assertEqual(caught.exception.code, 'DEVICE_INSTALL_BLOCKED')
        self.assertNotIn(secret, str(caught.exception)); self.assertNotIn(secret, repr(self.progress.call_args_list))

    def test_known_driver_failures_are_distinguished(self):
        for text, code in [('device offline', 'DEVICE_OFFLINE'), ('Could not find a driver for UiAutomator2', 'UIAUTOMATOR2_MISSING'), ('INSTALL_FAILED_INSUFFICIENT_STORAGE', 'ANDROID_HELPER_INSTALL_FAILED'), ('SecurityException', 'ANDROID_PERMISSION_REQUIRED'), ('request timed out', 'ANDROID_SESSION_TIMEOUT'), ('unrecognized fixture detail', 'ANDROID_SESSION_FAILED')]:
            with self.subTest(code=code): self.assertEqual(session_failure(RuntimeError(text)).code, code)
