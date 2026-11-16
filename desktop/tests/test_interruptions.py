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

    def test_signup_uses_its_configured_sender_and_advances_without_fixed_sleep(self):
        from unittest.mock import patch
        phone, driver = self.make_phone([
            screen(node('Digite o código'), node('Reenviar código')),
            screen(node('Digite o código'), node(cls='android.widget.EditText'), node('Avançar')),
            screen(node('Edit profile'), node('same.account', rid='com.instagram.android:id/profile_header_username')),
        ])
        phone.gmail.wait_code.return_value = {'code': '123456'}
        with patch.object(phone.cancel, 'wait', return_value=False) as wait:
            phone.create_account({'username':'same.account','email_sender':'security@mail.instagram.com','signup_email_sender':'signup@example.com','recipient':'owner@example.com'})
        self.assertEqual(phone.gmail.wait_code.call_args.args[0], 'signup@example.com')
        self.assertEqual(driver.index, 2)
        self.assertFalse(wait.called)

    def test_delayed_screen_still_waits_for_confirmation_without_resubmission(self):
        from unittest.mock import patch
        from test_signup_email_method import SignupDriver
        class DelayedDriver(SignupDriver):
            reads = 0
            @property
            def page_source(self):
                if self.index == 1:
                    self.reads += 1
                    if self.reads < 4: return self.stages[0]
                return self.stages[self.index]
        phone, _ = self.make_phone([])
        driver = DelayedDriver([
            screen(node('Qual é seu nome?'), node(cls='android.widget.EditText'), node('Avançar')),
            screen(node('Edit profile'), node('same.account', rid='com.instagram.android:id/profile_header_username')),
        ])
        phone.driver = driver
        with patch.object(phone.cancel, 'wait', return_value=False) as wait:
            phone.create_account({'username':'same.account','full_name':'Configured Name'})
        wait.assert_any_call(.25)
        self.assertEqual(driver.clicks.count((0, 'Avançar')), 1)
        phone.pause_callback.assert_not_called()

    def test_birthday_fills_inline_day_month_year_by_their_roles(self):
        from test_native_form_recovery import field
        phone, driver = self.make_phone([screen(node('Qual é sua data de nascimento?'), field('Dia'), field('Mês'), field('Ano'))])
        phone.birthday('2000-02-29')
        self.assertEqual(sorted(driver.values.values()), ['2','2000','29'])
        phone.pause_callback.assert_not_called()

    def test_birthday_inline_format_is_filled_without_manual_pause(self):
        from test_native_form_recovery import field
        phone, driver = self.make_phone([screen(node('Qual é sua data de nascimento?'), field('DD/MM/AAAA'))])
        phone.birthday('2000-09-04')
        self.assertIn('04/09/2000', driver.values.values())
        phone.pause_callback.assert_not_called()

    def test_birthday_opens_the_displayed_date_and_fills_android_input(self):
        phone, driver = self.make_phone([
            screen(node('Qual é sua data de nascimento?'), node('15/06/2001')),
            screen(node(cls='android.widget.EditText', rid='android:id/input').replace('/>', ' hint="DD/MM/AAAA"/>'), node('OK', rid='android:id/button1')),
            screen(node('Qual é sua data de nascimento?')),
        ])
        phone.birthday('2000-09-04')
        self.assertEqual(driver.index, 2)
        self.assertIn((1,'04/09/2000'), driver.typed)
        phone.pause_callback.assert_not_called()

    def test_unknown_birthday_control_reports_failure_instead_of_manual_date_pause(self):
        from zyon.errors import CompanionError
        phone, driver = self.make_phone([screen(node('Qual é sua data de nascimento?'))])
        with self.assertRaises(CompanionError) as caught: phone.birthday('2000-09-04')
        self.assertEqual(caught.exception.code, 'BIRTHDAY_PICKER_UNCERTAIN')
        phone.pause_callback.assert_not_called()
        self.assertFalse(driver.clicks)
