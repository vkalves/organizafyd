# Python / tests/android-emulator-check.py / Android 14 emulator / real UiAutomator2 form operations
import json
from pathlib import Path
import subprocess
import threading
import time
import xml.etree.ElementTree as ET
import requests
from appium import webdriver
from appium.options.android import UiAutomator2Options
from appium.webdriver.client_config import AppiumClientConfig
from selenium.webdriver.common.proxy import Proxy
from zyon.android import Screen
from zyon.phone import Phone

class FixturePhone(Phone):
    def screen(self):
        if self.cancel.is_set(): raise RuntimeError('Fixture cancelled')
        assert self.driver.current_package == 'com.zyon.formfixture'
        root = ET.fromstring(self.driver.page_source)
        # Test-only fixture package: production screen ownership stays unchanged.
        for node in root.iter():
            if node.get('package') == 'com.zyon.formfixture': node.attrib.pop('package')
        return Screen(ET.tostring(root, encoding='unicode'))

server = subprocess.Popen(['node', 'tools/node_modules/appium/index.js', '--address', '127.0.0.1', '--port', '4723', '--log-level', 'warn', '--log-no-colors'], stderr=subprocess.STDOUT)
driver = None
try:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            if requests.get('http://127.0.0.1:4723/status', timeout=2).json()['value']['ready']: break
        except (requests.RequestException, KeyError): pass
        time.sleep(.5)
    else: raise RuntimeError('Fixture Appium not ready')
    apk = Path('tests/android-form-fixture/build/fixture.apk').resolve()
    options = UiAutomator2Options().load_capabilities({'platformName':'Android','appium:automationName':'UiAutomator2','appium:app':str(apk),'appium:appPackage':'com.zyon.formfixture','appium:appActivity':'.MainActivity','appium:noReset':False,'appium:newCommandTimeout':120})
    driver = webdriver.Remote(options=options, client_config=AppiumClientConfig(remote_server_addr='http://127.0.0.1:4723', timeout=120, proxy=Proxy({'proxyType':'direct'})))
    phone = FixturePhone('emulator', 'http://127.0.0.1:4723', None, threading.Event(), lambda *args: None, driver=driver, gmail=None, pause=None, journal={})
    email = 'owner@example.com'
    phone.forms.fill(email, 'email')
    assert phone.forms.value_matches(phone.forms.select('email'), email, 'email')
    phone.forms.hide_keyboard()
    phone.forms.click(('Avançar',))
    phone.forms.wait_for(lambda s: phone.forms.has(s, ('Entrada confirmada',)), 'Fixture did not verify email')
    phone.forms.click(('Recriar campo',))
    phone.forms.fill(email, 'email')
    element = phone.forms.select('email')
    assert phone.forms.value_matches(element, email, 'email')
    driver.execute_script('mobile: replaceElementValue', {'elementId': element.id, 'text':'replacement@example.com'})
    assert phone.forms.value_matches(element, 'replacement@example.com', 'email')
    driver.execute_script('mobile: clickGesture', {'elementId': element.id})
    report = {'android_api':34,'real_uiautomator2':True,'email_focus_and_readback':True,'submission_after_verification':True,'delayed_field_recovery':True,'native_replacement_and_gesture':True,'instagram_live_run':False}
    Path('tests/android-form-fixture/build/emulator-result.json').write_text(json.dumps(report), encoding='utf-8')
    driver.get_screenshot_as_file('tests/android-form-fixture/build/emulator-screen.png')
    print(json.dumps(report))
finally:
    if driver:
        try: driver.quit()
        except Exception: pass
    server.terminate()
    try: server.wait(timeout=10)
    except subprocess.TimeoutExpired: server.kill(); server.wait(timeout=5)
