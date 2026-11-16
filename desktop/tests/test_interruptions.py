import unittest
from unittest.mock import Mock
import test_signup_email_method as signup_fixture
from helpers import node, screen

class InterruptionTests(unittest.TestCase):
    make_phone = signup_fixture.SignupEmailMethodTests.make_phone

    def test_known_notification_prompt_is_dismissed_before_reading_form(self):
        phone, driver = self.make_phone([
            screen(node('Ativar notificações'), node('Agora não')),
            screen(node('Qual é o seu email?'), node(cls='android.widget.EditText')),
        ])
        self.assertTrue(phone.screen().has(('Qual é o seu email?',)))
        self.assertEqual(driver.clicks, [(0, 'Agora não')])

    def test_unrelated_not_now_button_is_not_clicked(self):
        phone, driver = self.make_phone([screen(node('Unknown screen'), node('Agora não'))])
        phone.screen()
        self.assertFalse(driver.clicks)

    def test_code_is_replaced_instead_of_appended(self):
        phone, driver = self.make_phone([screen(node('Digite o código'), node(cls='android.widget.EditText'))])
        phone.fill_code('123456'); phone.fill_code('654321')
        self.assertEqual(list(driver.values.values()), ['654321'])

    def test_code_heading_variants_are_recognized(self):
        from zyon.phone import EMAIL_CODE
        for label in ('Digite o código', 'Insira o código de segurança', 'Enter code'):
            phone, driver = self.make_phone([screen(node(label))])
            self.assertTrue(phone.forms.has(phone.screen(), EMAIL_CODE))

    def test_bio_confirms_both_save_controls_and_profile_text(self):
        from unittest.mock import patch
        phone, driver = self.make_phone([
            screen(node('Edit profile')),
            screen(node('Bio')),
            screen(node(cls='android.widget.EditText'), node('Done')),
            screen(node('Bio'), node('Save')),
            screen(node('Edit profile'), node('Configured bio')),
        ])
        with patch.object(phone, 'profile'):
            phone.bio('same.account', 'Configured bio')
        self.assertEqual(driver.index, 4)
        self.assertIn((3, 'Save'), driver.clicks)

    def test_birthday_uses_explicit_portuguese_text_format(self):
        phone, driver = self.make_phone([
            screen(node('Data de nascimento')),
            screen(node('Text mode', rid='android:id/toggle_mode')),
            screen(node(cls='android.widget.EditText', rid='android:id/date_picker_input').replace('/>', ' hint="DD/MM/AAAA"/>'), node('OK', rid='android:id/button1')),
            screen(node('Qual é sua data de nascimento?')),
        ])
        phone.birthday('2000-09-04')
        self.assertIn((2, '04/09/2000'), driver.typed)
        self.assertEqual(driver.index, 3)
        phone.pause_callback.assert_not_called()

    def test_existing_code_screen_requests_one_fresh_code_and_continues(self):
        phone, driver = self.make_phone([
            screen(node('Digite o código'), node('Reenviar código')),
            screen(node('Digite o código'), node(cls='android.widget.EditText'), node('Avançar')),
            screen(node('Edit profile'), node('same.account', rid='com.instagram.android:id/profile_header_username')),
        ])
        phone.gmail.wait_code.return_value = {'code': '123456'}
        phone.create_account({'username': 'same.account', 'email_sender': 'security@mail.instagram.com', 'recipient': 'owner@example.com'})
        self.assertEqual(driver.index, 2)
        self.assertEqual(driver.clicks.count((0, 'Reenviar código')), 1)
        phone.gmail.wait_code.assert_called_once()
