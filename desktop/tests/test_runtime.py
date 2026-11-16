# Python / tests/test_runtime.py / Python 3.11+ / Appium startup and failure recovery
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from zyon.errors import CompanionError
from zyon.runtime import Runtime, load_runtime


class Process:
    pid = 987654
    def __init__(self, output=b'', exited=None):
        self.stdout = io.BytesIO(output); self.returncode = exited; self.terminated = False
    def poll(self): return self.returncode
    def terminate(self): self.terminated = True; self.returncode = -15
    def wait(self, timeout=None):
        if self.returncode is None: self.returncode = -15
        return self.returncode


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'user runtime'
        self.app = Path(self.temp.name) / 'Zyon app & spaces'
        package = self.app / 'tools/node_modules/appium'; package.mkdir(parents=True)
        (package / 'package.json').write_text(json.dumps({'bin': {'appium': 'index.js'}}))
        (package / 'index.js').write_text('// fixture')
        driver = self.root / 'appium/node_modules/appium-uiautomator2-driver'; driver.mkdir(parents=True)
        (driver / 'package.json').write_text('{}')
        self.runtime = Runtime(threading.Event(), self.root, self.app)
        self.platform = patch('zyon.runtime.sys.platform', 'win32'); self.platform.start(); self.addCleanup(self.platform.stop)
        self.loader = patch('zyon.runtime.load_runtime'); self.loader.start(); self.addCleanup(self.loader.stop)
        self.node = patch('zyon.runtime.shutil.which', return_value=str(self.root / 'node/node.exe')); self.node.start(); self.addCleanup(self.node.stop)
        self.kill = patch('zyon.runtime.subprocess.run'); self.kill.start(); self.addCleanup(self.kill.stop)
        self.port = patch.object(self.runtime, 'port_busy', return_value=False); self.port.start(); self.addCleanup(self.port.stop)
        self.addCleanup(self.runtime.close)

    def diagnostic(self): return json.loads(self.runtime.diagnostic_path.read_text())

    def test_direct_node_launch_preserves_spaces_without_a_shell(self):
        process = Process()
        with patch.object(self.runtime, 'ready', side_effect=[False, True]), patch('zyon.runtime.subprocess.Popen', return_value=process) as launch:
            self.runtime.ensure()
        command = launch.call_args.args[0]
        self.assertTrue(command[0].endswith('node.exe')); self.assertTrue(command[1].endswith('appium' + os.sep + 'index.js'))
        self.assertNotIn('/c', command); self.assertFalse(launch.call_args.kwargs.get('shell', False))
        self.assertEqual(launch.call_args.kwargs['cwd'], self.app)
        self.assertEqual(self.diagnostic()['outcome'], 'ready'); self.assertFalse(self.diagnostic()['reused'])
        self.assertFalse(self.runtime.capture_startup.is_set())

    def test_reuses_healthy_existing_server_without_owning_or_killing_it(self):
        with patch.object(self.runtime, 'ready', return_value=True), patch('zyon.runtime.subprocess.Popen') as launch:
            self.runtime.ensure(); self.runtime.close(); launch.assert_not_called()
        self.assertIsNone(self.runtime.process); self.assertTrue(self.diagnostic()['reused'])

    def test_busy_port_does_not_launch_or_terminate_external_process(self):
        with patch.object(self.runtime, 'ready', return_value=False), patch.object(self.runtime, 'port_busy', return_value=True), patch('zyon.runtime.subprocess.Popen') as launch:
            with self.assertRaises(CompanionError) as caught: self.runtime.ensure()
            launch.assert_not_called()
        self.assertEqual(caught.exception.code, 'APPIUM_PORT_IN_USE'); self.assertEqual(self.diagnostic()['outcome'], 'port_in_use')

    def test_missing_driver_requests_repair_before_launch(self):
        (self.root / 'appium/node_modules/appium-uiautomator2-driver/package.json').unlink()
        with patch.object(self.runtime, 'ready', return_value=False), patch('zyon.runtime.subprocess.Popen') as launch:
            with self.assertRaises(CompanionError) as caught: self.runtime.ensure()
            launch.assert_not_called()
        self.assertEqual(caught.exception.code, 'REQUIREMENTS_MISSING')

    def test_invalid_package_entry_cannot_launch_outside_appium(self):
        (self.app / 'outside.js').write_text('// fixture')
        (self.app / 'tools/node_modules/appium/package.json').write_text(json.dumps({'bin': {'appium': '../../../outside.js'}}))
        with patch.object(self.runtime, 'ready', return_value=False), patch('zyon.runtime.subprocess.Popen') as launch:
            with self.assertRaises(CompanionError): self.runtime.ensure()
            launch.assert_not_called()

    def test_exit_is_classified_without_persisting_raw_output(self):
        secret = b'password=fixture-secret-token'
        process = Process(b'Error: Cannot find module. ' + secret, exited=1)
        with patch.object(self.runtime, 'ready', return_value=False), patch('zyon.runtime.subprocess.Popen', return_value=process):
            with self.assertRaises(CompanionError) as caught: self.runtime.ensure()
        self.assertEqual(caught.exception.code, 'APPIUM_START_FAILED')
        self.assertEqual(self.diagnostic()['outcome'], 'dependencies_missing'); self.assertEqual(self.diagnostic()['exit_code'], 1)
        self.assertNotIn('fixture-secret-token', self.runtime.diagnostic_path.read_text()); self.assertEqual(len(self.runtime.output), 0)

    def test_timeout_stops_owned_process_before_another_attempt(self):
        self.runtime.startup_timeout = 0
        process = Process()
        with patch.object(self.runtime, 'ready', return_value=False), patch('zyon.runtime.subprocess.Popen', return_value=process):
            with self.assertRaises(CompanionError): self.runtime.ensure()
        self.assertIsNotNone(process.poll()); self.assertIsNone(self.runtime.process)
        self.assertEqual(self.diagnostic()['outcome'], 'readiness_timeout')

    def test_windows_execution_block_is_reported(self):
        with patch.object(self.runtime, 'ready', return_value=False), patch('zyon.runtime.subprocess.Popen', side_effect=PermissionError(13, 'blocked')):
            with self.assertRaises(CompanionError) as caught: self.runtime.ensure()
        self.assertEqual(caught.exception.code, 'APPIUM_START_FAILED'); self.assertEqual(self.diagnostic()['outcome'], 'access_denied')

    def test_cancel_before_start_does_not_launch(self):
        self.runtime.cancel.set()
        with patch('zyon.runtime.subprocess.Popen') as launch:
            with self.assertRaises(CompanionError) as caught: self.runtime.ensure()
            launch.assert_not_called()
        self.assertEqual(caught.exception.code, 'CANCELLED')

    def test_cancel_during_start_stops_owned_process(self):
        process = Process()
        with patch.object(self.runtime, 'ready', return_value=False), patch('zyon.runtime.subprocess.Popen', return_value=process), patch.object(self.runtime.cancel, 'wait', side_effect=lambda _: self.runtime.cancel.set()):
            with self.assertRaises(CompanionError) as caught: self.runtime.ensure()
        self.assertEqual(caught.exception.code, 'CANCELLED'); self.assertIsNotNone(process.poll()); self.assertEqual(self.diagnostic()['outcome'], 'cancelled')

    def test_local_readiness_ignores_system_http_proxies_and_rejects_bad_payload(self):
        self.assertFalse(self.runtime.http.trust_env)
        with patch.object(self.runtime.http, 'get') as get:
            get.return_value.status_code = 200
            for data in (None, [], {'value': []}, {'value': {'ready': 'true'}}):
                get.return_value.json.return_value = data; self.assertFalse(self.runtime.ready())

    def test_runtime_path_reload_does_not_grow_path(self):
        directory = self.root / 'runtime'; directory.mkdir()
        node = directory / 'node'; node.mkdir()
        (directory / 'paths.json').write_text(json.dumps({'Node': str(node)}), encoding='utf-8-sig')
        with patch.dict(os.environ, {'PATH': os.pathsep.join([str(node), '/original'])}):
            load_runtime(self.root); first = os.environ['PATH']; load_runtime(self.root)
            self.assertEqual(os.environ['PATH'], first); self.assertEqual(first.split(os.pathsep).count(str(node)), 1)

    def test_manual_setup_still_uses_the_app_owned_driver_home(self):
        with patch.dict(os.environ, {'APPIUM_HOME': 'external-driver-home'}):
            load_runtime(self.root)
            self.assertEqual(os.environ['APPIUM_HOME'], str(self.root / 'appium'))
