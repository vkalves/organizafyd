# Python / tests/test_signup_email_method.py / Python 3.11+ / phone-to-email signup transition regression
from itertools import count
import re
import threading
import unittest
from unittest.mock import Mock, patch
import xml.etree.ElementTree as ET
from zyon.phone import Phone
from zyon.errors import CompanionError
from helpers import MemoryVault, node, screen

SETTINGS = {'username': 'same.account', 'recipient': 'owner@example.com', 'email_sender': 'security@mail.instagram.com', 'instagram_password': 'fixture-password', 'birthday': '2000-01-02', 'full_name': 'Configured Profile'}


class Element:
    def __init__(self, driver, data, identity): self.driver, self.data, self.id = driver, data, identity
    def is_displayed(self): return self.data.get('displayed') != 'false'
    def is_enabled(self): return self.data.get('enabled') != 'false'
    def get_attribute(self, name):
        if name == 'text': return self.driver.values.get(self.id, self.data.get('text', ''))
        if name == 'focused': return 'true' if self.driver.focused == self.id else 'false'
        return self.data.get({'resourceId': 'resource-id', 'contentDescription': 'content-desc', 'className': 'class'}.get(name, name), '')
    def clear(self): self.driver.values[self.id] = ''
    def send_keys(self, value):
        self.driver.typed.append((self.driver.index, value))
        self.driver.values[self.id] = self.driver.values.get(self.id, '') + value
    def click(self):
        self.driver.clicks.append((self.driver.index, self.data.get('text')))
        if self.data.get('class') in ('android.widget.EditText', 'android.widget.AutoCompleteTextView') or self.data.get('editable') == 'true': self.driver.focused = self.id
        elif self.driver.transition: self.driver.index += 1


class SignupDriver:
    current_package = 'com.instagram.android'
    def __init__(self, stages):
        self.stages, self.index = stages, 0
        self.typed, self.clicks, self.transition = [], [], True
        self.values, self.elements, self.scripts = {}, {}, []
        self.focused, self.keyboard = None, False
    @property
    def page_source(self): return self.stages[self.index]
    def find_elements(self, kind, value):
        nodes = list(ET.fromstring(self.page_source).iter('node'))
        if kind == 'id': matches = [n for n in nodes if n.get('resource-id') == value]
        elif kind == 'class name': matches = [n for n in nodes if n.get('class') == value]
        elif '@editable=' in value: matches = [n for n in nodes if n.get('editable') == 'true' and n.get('class') not in ('android.widget.EditText', 'android.widget.AutoCompleteTextView')]
        else:
            text = re.search("@text='([^']*)'", value)
            matches = [n for n in nodes if text and n.get('text') == text.group(1)]
        result = []
        for n in matches:
            identity = str(self.index) + ':' + str(nodes.index(n))
            element = Element(self, n, identity); self.elements[identity] = element; result.append(element)
        return result
    def is_keyboard_shown(self): return self.keyboard
    def hide_keyboard(self): self.keyboard = False
    def execute_script(self, name, args):
        self.scripts.append((name, args))
        element = self.elements[args['elementId']]
        if name == 'mobile: clickGesture': element.click()
        elif name == 'mobile: replaceElementValue':
            self.values[element.id] = args['text']; self.typed.append((self.index, args['text']))


class SignupEmailMethodTests(unittest.TestCase):
    def make_phone(self, stages):
        driver = SignupDriver(stages)
        phone = Phone('serial', 'http://127.0.0.1:4723', MemoryVault(), threading.Event(), Mock(), driver=driver, gmail=Mock(), pause=Mock(), journal={})
        return phone, driver

    def test_screenshot_phone_step_switches_to_email_and_completes_recognized_signup_sequence(self):
        for phone_title, email_button, email_title in (
            ('Qual é o número do seu celular?', 'Cadastrar-se com o email', 'Qual é o seu email?'),
            ('Qual é o número do seu celular?', 'Cadastrar-se com o e-mail', 'Qual é o seu e-mail?'),
            ("What's your mobile number?", 'Sign up with email', "What's your email?"),
        ):
            with self.subTest(email_button=email_button):
                stages = [screen(node(phone_title), node('Número do celular', cls='android.widget.EditText'), node('Avançar'), node(email_button)),
                    screen(node(email_title), node(cls='android.widget.EditText'), node('Avançar')),
                    screen(node('Insira o código de confirmação'), *(node(cls='android.widget.EditText') for _ in range(6)), node('Avançar')),
                    screen(node('Crie uma senha'), node(cls='android.widget.EditText'), node('Avançar')),
                    screen(node('Qual é a sua data de nascimento?'), node('Avançar')),
                    screen(node('Qual é o seu nome?'), node(cls='android.widget.EditText'), node('Avançar')),
                    screen(node('Crie um nome de usuário'), node(cls='android.widget.EditText'), node('Avançar')),
                    screen(node('Concorde com os termos e políticas do Instagram'), node('Concordo')),
                    screen(node('Edit profile'), node('same.account', 'com.instagram.android:id/profile_header_username'))]
                phone, driver = self.make_phone(stages)
                phone.gmail.wait_code.return_value = {'code': '123456'}
                with patch.object(phone.cancel, 'wait', return_value=False), patch.object(phone, 'birthday') as birthday:
                    phone.create_account(SETTINGS)
                self.assertEqual(driver.index, 8); self.assertEqual(driver.clicks[0], (0, email_button))
                self.assertFalse(any(index == 0 for index, _ in driver.typed))
                self.assertIn((1, SETTINGS['recipient']), driver.typed)
                self.assertEqual(''.join(value for index, value in driver.typed if index == 2), '123456')
                self.assertIn((3, SETTINGS['instagram_password']), driver.typed)
                self.assertIn((5, SETTINGS['full_name']), driver.typed); self.assertIn((6, SETTINGS['username']), driver.typed)
                birthday.assert_called_once_with(SETTINGS['birthday']); phone.pause_callback.assert_not_called()
                self.assertGreater(phone.gmail.wait_code.call_args.args[2], 0)

    def test_ambiguous_email_controls_do_not_type_or_click(self):
        phone, driver = self.make_phone([screen(node('Qual é o número do seu celular?'), node(cls='android.widget.EditText'), node('Cadastrar-se com o email'), node('Cadastrar-se com o email'))])
        with self.assertRaises(CompanionError) as caught: phone.create_account(SETTINGS)
        self.assertEqual(caught.exception.code, 'CONTROL_UNCERTAIN'); self.assertEqual(driver.typed, []); self.assertEqual(driver.clicks, [])

    def test_missing_email_choice_pauses_without_using_the_phone_field(self):
        phone, driver = self.make_phone([screen(node('Qual é o número do seu celular?'), node(cls='android.widget.EditText'), node('Avançar'))])
        clock = count(0, 13)
        with patch.object(phone, 'clock', side_effect=lambda: next(clock)), patch.object(phone, 'pause', side_effect=CompanionError('FIXTURE_PAUSED', 'pause')) as pause:
            with self.assertRaises(CompanionError) as caught: phone.create_account(SETTINGS)
        self.assertEqual(caught.exception.code, 'FIXTURE_PAUSED'); self.assertEqual(pause.call_args.args[0], 'native_signup_screen')
        self.assertEqual(driver.typed, []); self.assertEqual(driver.clicks, [])

    def test_unconfirmed_method_switch_is_not_clicked_repeatedly(self):
        phone, driver = self.make_phone([screen(node('Qual é o número do seu celular?'), node(cls='android.widget.EditText'), node('Cadastrar-se com o email'))])
        driver.transition = False
        clock = count()
        with patch('zyon.android.time.monotonic', side_effect=lambda: next(clock)), patch.object(phone.cancel, 'wait', return_value=False):
            with self.assertRaises(CompanionError) as caught: phone.create_account(SETTINGS)
        self.assertEqual(caught.exception.code, 'NATIVE_TRANSITION_UNCONFIRMED'); self.assertEqual(len(driver.clicks), 2); self.assertEqual(len(driver.scripts), 1); self.assertEqual(driver.typed, [])
