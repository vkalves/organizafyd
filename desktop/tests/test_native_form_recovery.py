# Python / tests/test_native_form_recovery.py / Python 3.11+ / semantic form selection and bounded recovery
import unittest
from unittest.mock import patch
from selenium.common.exceptions import StaleElementReferenceException, ElementClickInterceptedException
from zyon.errors import CompanionError
from zyon.native_forms import normalized
import test_signup_email_method as signup_fixture
from test_signup_email_method import SETTINGS, Element
from helpers import node, screen


def field(hint='', cls='android.widget.EditText', **attrs):
    import xml.etree.ElementTree as ET
    data = ET.fromstring(node(cls=cls))
    if hint: data.set('hint', hint)
    for key, value in attrs.items(): data.set(key.replace('_', '-'), str(value))
    return ET.tostring(data, encoding='unicode')


class NativeFormRecoveryTests(unittest.TestCase):
    def phone(self, stages): return signup_fixture.SignupEmailMethodTests().make_phone(stages)

    def test_email_field_is_focused_and_verified_before_submit(self):
        phone, driver = self.phone([screen(node('Qual é o seu email?'), field('Email'), node('Avançar'))])
        with patch.object(phone.cancel, 'wait', return_value=False): phone.forms.fill(SETTINGS['recipient'], 'email')
        self.assertIsNotNone(driver.focused); self.assertIn(SETTINGS['recipient'], driver.values.values())
        self.assertFalse(any(label == 'Avançar' for _, label in driver.clicks))

    def test_autocomplete_and_custom_editable_fields_are_supported(self):
        for cls, attrs in [('android.widget.AutoCompleteTextView', {}), ('android.view.View', {'editable': 'true'})]:
            with self.subTest(cls=cls):
                phone, driver = self.phone([screen(node('Qual é o seu email?'), field('Email', cls, **attrs))])
                with patch.object(phone.cancel, 'wait', return_value=False): phone.forms.fill(SETTINGS['recipient'], 'email')
                self.assertIn(SETTINGS['recipient'], driver.values.values())

    def test_silent_keyboard_failure_recovers_with_direct_text_replacement(self):
        phone, driver = self.phone([screen(node('Qual é o seu email?'), field('Email'))])
        with patch.object(Element, 'send_keys', return_value=None), patch.object(phone.cancel, 'wait', return_value=False):
            phone.forms.fill(SETTINGS['recipient'], 'email')
        self.assertIn(SETTINGS['recipient'], driver.values.values())
        self.assertEqual(sum(name == 'mobile: replaceElementValue' for name, _ in driver.scripts), 1)

    def test_partial_typing_is_replaced_without_appending_duplicate_email(self):
        phone, driver = self.phone([screen(node('Qual é o seu email?'), field('Email'))])
        original = Element.send_keys
        def partial(element, value): original(element, value[:3])
        with patch.object(Element, 'send_keys', partial), patch.object(phone.cancel, 'wait', return_value=False): phone.forms.fill(SETTINGS['recipient'], 'email')
        self.assertEqual(list(driver.values.values()), [SETTINGS['recipient']])

    def test_stale_element_is_relocated_before_recovery(self):
        phone, driver = self.phone([screen(node('Qual é o seu email?'), field('Email'))])
        original = Element.click; attempts = []
        def click(element):
            attempts.append(element.id)
            if len(attempts) == 1: raise StaleElementReferenceException('fixture')
            original(element)
        with patch.object(Element, 'click', click), patch.object(phone.cancel, 'wait', return_value=False): phone.forms.fill(SETTINGS['recipient'], 'email')
        self.assertIn(SETTINGS['recipient'], driver.values.values()); self.assertGreaterEqual(len(attempts), 2)

    def test_delayed_input_is_waited_for_without_pausing(self):
        phone, driver = self.phone([screen(node('Qual é o seu email?'), field('Email'))])
        original = driver.find_elements; calls = []
        def delayed(kind, value):
            calls.append((kind, value))
            return [] if len(calls) <= 6 else original(kind, value)
        with patch.object(driver, 'find_elements', delayed), patch.object(phone.cancel, 'wait', return_value=False): phone.forms.fill(SETTINGS['recipient'], 'email')
        self.assertIn(SETTINGS['recipient'], driver.values.values()); phone.pause_callback.assert_not_called()

    def test_ambiguous_fields_are_never_selected_by_order(self):
        phone, driver = self.phone([screen(node('Qual é o seu email?'), field('Email'), field('Email'))])
        with self.assertRaises(CompanionError) as caught: phone.forms.fill(SETTINGS['recipient'], 'email')
        self.assertEqual(caught.exception.code, 'NATIVE_FORM_AMBIGUOUS'); self.assertEqual(driver.typed, [])

    def test_phone_and_password_fields_cannot_receive_signup_email(self):
        phone, driver = self.phone([screen(node('Qual é o seu email?'), field('Número do celular', inputType='3'), field('Senha', password='true'))])
        self.assertIsNone(phone.forms.select('email')); self.assertEqual(driver.typed, [])

    def test_form_change_during_focus_prevents_typing_into_next_stage(self):
        phone, driver = self.phone([screen(node('Qual é o seu email?'), field('Email')), screen(node('Crie uma senha'), field('Senha', password='true'))])
        def change(element): driver.index = 1
        with patch.object(Element, 'click', change):
            with self.assertRaises(CompanionError) as caught:
                phone.forms.fill(SETTINGS['recipient'], 'email', guard=lambda s: phone.forms.has(s, ('Qual é o seu email?',)))
        self.assertEqual(caught.exception.code, 'NATIVE_FORM_CHANGED'); self.assertEqual(driver.typed, [])

    def test_unverified_email_is_never_submitted(self):
        phone, driver = self.phone([screen(node('Qual é o seu email?'), field('Email'), node('Avançar'))])
        with patch.object(Element, 'send_keys', return_value=None), patch.object(driver, 'execute_script', return_value=None), patch.object(phone.cancel, 'wait', return_value=False):
            with self.assertRaises(CompanionError) as caught: phone.create_account(SETTINGS)
        self.assertEqual(caught.exception.code, 'NATIVE_INPUT_UNCONFIRMED')
        self.assertFalse(any(label == 'Avançar' for _, label in driver.clicks)); phone.gmail.wait_code.assert_not_called()
        self.assertLessEqual(len(driver.clicks), 1)

    def test_existing_correct_value_is_not_typed_twice(self):
        phone, driver = self.phone([screen(node('Qual é o seu email?'), field('Email'))])
        element = phone.forms.select('email'); driver.values[element.id] = SETTINGS['recipient']
        phone.forms.fill(SETTINGS['recipient'], 'email'); self.assertEqual(driver.typed, [])

    def test_normalization_handles_accents_case_spacing_and_curly_apostrophes(self):
        self.assertEqual(normalized('  QUAL É O SEU E-MAIL? '), normalized('Qual é o seu email?'))
        self.assertEqual(normalized('What’s your email?'), normalized("What's your email?"))

    def test_security_challenge_is_reported_without_field_actions(self):
        phone, driver = self.phone([screen(node('Confirme que você é humano'), field('Email'))])
        with patch.object(phone, 'pause', side_effect=CompanionError('FIXTURE_CHALLENGE', 'challenge')) as pause:
            with self.assertRaises(CompanionError): phone.create_account(SETTINGS)
        self.assertEqual(pause.call_args.args[0], 'native_security_challenge'); self.assertEqual(driver.typed, [])

    def test_login_fields_are_resolved_by_role_and_confirmed_profile(self):
        phone, driver = self.phone([screen(node('Instagram'), field('Email ou nome de usuário'), field('Senha', password='true'), node('Entrar')),
            screen(node('Editar perfil'), node('same.account', 'com.instagram.android:id/profile_header_username'))])
        with patch.object(phone.cancel, 'wait', return_value=False): phone.login_existing(SETTINGS)
        self.assertEqual(driver.index, 1); self.assertIn((0, SETTINGS['username']), driver.typed); self.assertIn((0, SETTINGS['instagram_password']), driver.typed)
        self.assertEqual(sum(label == 'Entrar' for _, label in driver.clicks), 1)

    def test_signup_can_leave_login_screen_through_create_account(self):
        phone, driver = self.phone([screen(node('Instagram'), field('Email'), field('Senha', password='true'), node('Entrar'), node('Criar conta')),
            screen(node('Qual é o seu email?'), field('Email'), node('Avançar')),
            screen(node('Editar perfil'), node('same.account', 'com.instagram.android:id/profile_header_username'))])
        with patch.object(phone.cancel, 'wait', return_value=False): phone.create_account(SETTINGS)
        self.assertEqual(driver.index, 2); self.assertFalse(any(index == 0 for index, _ in driver.typed))
        self.assertEqual(driver.clicks[0], (0, 'Criar conta'))

    def test_unknown_heading_uses_explicit_email_hint_only_in_signup_context(self):
        phone, driver = self.phone([screen(node('Digite seu endereço para continuar'), field('Email'), node('Cadastrar-se com o número do celular'), node('Avançar')),
            screen(node('Editar perfil'), node('same.account', 'com.instagram.android:id/profile_header_username'))])
        with patch.object(phone.cancel, 'wait', return_value=False): phone.create_account(SETTINGS)
        self.assertEqual(driver.typed, [(0, SETTINGS['recipient'])])

    def test_recovery_logs_do_not_include_credentials(self):
        phone, driver = self.phone([screen(node('Qual é o seu email?'), field('Email'))])
        with patch.object(Element, 'send_keys', return_value=None), patch.object(phone.cancel, 'wait', return_value=False): phone.forms.fill(SETTINGS['recipient'], 'email')
        self.assertNotIn(SETTINGS['recipient'], str(phone.progress.call_args_list)); self.assertNotIn(SETTINGS['instagram_password'], str(phone.progress.call_args_list))

    def test_keyboard_interception_is_recovered_before_typing(self):
        phone, driver = self.phone([screen(node('Qual é o seu email?'), field('Email'))]); driver.keyboard = True
        original = Element.click
        def blocked(element):
            if driver.keyboard: raise ElementClickInterceptedException('fixture overlay')
            original(element)
        with patch.object(Element, 'click', blocked), patch.object(phone.cancel, 'wait', return_value=False): phone.forms.fill(SETTINGS['recipient'], 'email')
        self.assertFalse(driver.keyboard); self.assertIn(SETTINGS['recipient'], driver.values.values())

    def test_login_password_cannot_fall_back_to_the_username_field(self):
        phone, driver = self.phone([screen(node('Instagram'), field('Email ou nome de usuário'), node('Entrar'))])
        self.assertIsNone(phone.forms.select('password', allow_generic=False)); self.assertEqual(driver.typed, [])

    def test_cancellation_after_focus_prevents_text_entry(self):
        phone, driver = self.phone([screen(node('Qual é o seu email?'), field('Email'))])
        with patch.object(Element, 'click', side_effect=lambda: phone.cancel.set()):
            with self.assertRaises(CompanionError) as caught: phone.forms.fill(SETTINGS['recipient'], 'email')
        self.assertEqual(caught.exception.code, 'CANCELLED'); self.assertEqual(driver.typed, [])

    def test_navigation_can_recover_once_with_an_element_gesture(self):
        from itertools import count
        phone, driver = self.phone([screen(node('Qual é o número do seu celular?'), node('Cadastrar-se com o email')),
            screen(node('Qual é o seu email?'), field('Email'))]); driver.transition = False
        original = driver.execute_script
        def gesture(name, args): driver.transition = True; return original(name, args)
        clock = count()
        with patch.object(driver, 'execute_script', gesture), patch('zyon.phone.time.monotonic', side_effect=lambda: next(clock)), patch.object(phone.cancel, 'wait', return_value=False):
            phone.forms.navigate(('Cadastrar-se com o email',), lambda s: phone.forms.has(s, ('Qual é o seu email?',)))
        self.assertEqual(driver.index, 1); self.assertEqual(len(driver.clicks), 2); self.assertEqual(len(driver.scripts), 1); self.assertEqual(driver.typed, [])

    def test_email_is_not_written_into_name_or_numeric_code_fields(self):
        phone, driver = self.phone([screen(node('Qual é o seu email?'), field('Nome completo'), field('Código', inputType='2'))])
        self.assertIsNone(phone.forms.select('email')); self.assertEqual(driver.typed, [])

    def test_password_is_not_written_into_a_person_name_field(self):
        phone, driver = self.phone([screen(node('Crie uma senha'), field(inputType='97'))])
        self.assertIsNone(phone.forms.select('password')); self.assertEqual(driver.typed, [])
