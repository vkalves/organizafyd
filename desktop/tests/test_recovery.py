from pathlib import Path
import json
import subprocess
import unittest
from unittest.mock import Mock, patch
from zyon.errors import CompanionError
from zyon.diagnostics import write_report
from zyon.screen_state import classify
from helpers import node, screen
import test_signup_email_method as fixture
import test_workflow as workflow_fixture

class ScreenRecognitionTests(unittest.TestCase):
    def test_heading_with_explanation_is_classified(self):
        phone, _ = fixture.SignupEmailMethodTests().make_phone([screen(node('Qual é a sua data de nascimento? Informe a data real.'))])
        self.assertEqual(classify(phone.screen(), phone.forms), 'birthday')

    def test_input_value_cannot_invent_a_screen_heading(self):
        phone, _ = fixture.SignupEmailMethodTests().make_phone([screen(node('Crie uma senha', cls='android.widget.EditText'))])
        self.assertIsNone(classify(phone.screen(), phone.forms))

    def test_competing_headings_do_not_choose_a_random_step(self):
        phone, _ = fixture.SignupEmailMethodTests().make_phone([screen(node('Digite seu email'), node('Crie uma senha'))])
        with self.assertRaises(CompanionError) as caught: classify(phone.screen(), phone.forms)
        self.assertEqual(caught.exception.code, 'NATIVE_SCREEN_AMBIGUOUS')

class RecoveryTests(unittest.TestCase):
    setUp = workflow_fixture.WorkflowTests.setUp
    wait_state = workflow_fixture.WorkflowTests.wait_state

    def test_recognition_failure_resets_once_and_completes(self):
        phone = Mock()
        phone.prepare.side_effect = [CompanionError('UNKNOWN_SIGNUP_SCREEN', 'Unknown'), None]
        self.workflow.prepare_with_recovery(phone, workflow_fixture.SETTINGS)
        self.assertEqual(phone.prepare.call_count, 2)
        phone.reset_instagram.assert_called_once()
        self.assertEqual(self.workflow.journal['recovery_attempts'], 1)
        self.assertTrue(Path(self.workflow.snapshot()['diagnosticPath']).is_file())

    def test_reset_budget_prevents_endless_cycles(self):
        phone = Mock(); phone.prepare.side_effect = CompanionError('UNKNOWN_SIGNUP_SCREEN', 'Unknown')
        with self.assertRaises(CompanionError): self.workflow.prepare_with_recovery(phone, workflow_fixture.SETTINGS)
        self.assertEqual(phone.prepare.call_count, 2)
        phone.reset_instagram.assert_called_once()
        with self.assertRaises(CompanionError): self.workflow.prepare_with_recovery(phone, workflow_fixture.SETTINGS)
        phone.reset_instagram.assert_called_once()

    def test_uncertain_signup_or_story_prevents_destructive_reset(self):
        for journal in ({'signup_state':'submission_pending'}, {'stories':{'asset':{'story':'submitted'}}}):
            with self.subTest(journal=journal):
                self.workflow.journal = journal
                phone = Mock(); phone.prepare.side_effect = CompanionError('UNKNOWN_SIGNUP_SCREEN', 'Unknown')
                with self.assertRaises(CompanionError): self.workflow.prepare_with_recovery(phone, workflow_fixture.SETTINGS)
                phone.reset_instagram.assert_not_called()

    def test_confirmed_account_recovers_by_login_instead_of_new_signup(self):
        self.workflow.journal = {'signup_state':'confirmed'}
        phone = Mock(); phone.prepare.side_effect = [CompanionError('BIO_UNCONFIRMED', 'Unknown'), None]
        self.workflow.prepare_with_recovery(phone, {**workflow_fixture.SETTINGS, 'create_account':True})
        self.assertFalse(phone.prepare.call_args_list[0].args[0]['create_account'])
        self.assertFalse(phone.prepare.call_args_list[1].args[0]['create_account'])

    def test_wrong_account_never_cleared(self):
        phone = Mock(); phone.prepare.side_effect = CompanionError('WRONG_ACCOUNT', 'Wrong')
        with self.assertRaises(CompanionError): self.workflow.prepare_with_recovery(phone, workflow_fixture.SETTINGS)
        phone.reset_instagram.assert_not_called()

    def test_report_preserves_structure_without_password_codes_or_editable_text(self):
        phone, _ = fixture.SignupEmailMethodTests().make_phone([screen(
            node('Confirme o código 123456 enviado a owner@example.com'),
            node('secret-instagram', cls='android.widget.EditText'),
            node('OK', rid='android:id/button1'),
        )])
        path, prompt = write_report(self.temp.name, workflow_fixture.SETTINGS, {'phase':'native_signup_code','events':[]}, CompanionError('BIRTHDAY_PICKER_UNCERTAIN','x'), phone)
        self.assertTrue(Path(path).is_file())
        for private in ('123456', 'owner@example.com', 'secret-instagram'): self.assertNotIn(private, prompt)
        self.assertIn('android:id/button1', prompt)
        self.assertIn('BIRTHDAY_PICKER_UNCERTAIN', prompt)
        self.assertTrue(json.loads((Path(path).parent/'report.json').read_text())['screen']['available'])

class ResetDeviceTests(unittest.TestCase):
    def test_only_selected_device_and_instagram_are_cleared(self):
        phone, _ = fixture.SignupEmailMethodTests().make_phone([screen(node('Log in'))])
        phone.driver.activate_app = Mock()
        with patch('zyon.phone.subprocess.run', return_value=Mock(stdout='Success\n')) as run:
            phone.reset_instagram()
        self.assertEqual(run.call_args_list[1].args[0], ['adb','-s','serial','shell','pm','clear','com.instagram.android'])
        phone.driver.activate_app.assert_called_once_with('com.instagram.android')

    def test_failed_clear_never_claims_success_or_relaunches(self):
        phone, _ = fixture.SignupEmailMethodTests().make_phone([screen(node('Log in'))])
        phone.driver.activate_app = Mock()
        with patch('zyon.phone.subprocess.run', return_value=Mock(stdout='Failed')):
            with self.assertRaises(CompanionError): phone.reset_instagram()
        phone.driver.activate_app.assert_not_called()

class TaggedHierarchyTests(unittest.TestCase):
    def test_editable_class_tag_is_not_treated_as_a_heading(self):
        from zyon.android import Screen
        phone, _ = fixture.SignupEmailMethodTests().make_phone([])
        current = Screen('<hierarchy><android.widget.EditText text="Crie uma senha"/></hierarchy>')
        self.assertIsNone(classify(current, phone.forms))

class FailureHistoryTests(unittest.TestCase):
    setUp = workflow_fixture.WorkflowTests.setUp
    def test_second_failure_prompt_preserves_both_observed_error_codes(self):
        self.workflow.diagnostic(workflow_fixture.SETTINGS, CompanionError('UNKNOWN_SIGNUP_SCREEN', 'x'))
        self.workflow.diagnostic(workflow_fixture.SETTINGS, CompanionError('BIRTHDAY_PICKER_UNCERTAIN', 'x'))
        prompt = self.workflow.snapshot()['diagnosticPrompt']
        self.assertIn('UNKNOWN_SIGNUP_SCREEN', prompt)
        self.assertIn('BIRTHDAY_PICKER_UNCERTAIN', prompt)
        self.assertEqual(len(self.workflow.snapshot()['failures']), 2)

class StructuredScreenTests(unittest.TestCase):
    def test_code_fields_identify_step_without_a_known_heading(self):
        phone, _ = fixture.SignupEmailMethodTests().make_phone([])
        from zyon.android import Screen
        current = Screen(screen(node('Confirmação por email'), *[node(cls='android.widget.EditText').replace('/>', ' input-type="2"/>') for _ in range(6)]))
        self.assertEqual(classify(current, phone.forms, allow_fields=True), 'code')
        self.assertIsNone(classify(current, phone.forms))

    def test_editable_values_never_identify_field_roles(self):
        phone, _ = fixture.SignupEmailMethodTests().make_phone([])
        from zyon.android import Screen
        current = Screen(screen(node('username', cls='android.widget.EditText')))
        self.assertIsNone(classify(current, phone.forms, allow_fields=True))

class VersionDiagnosticTests(unittest.TestCase):
    def test_instagram_version_is_read_without_exporting_the_package_dump(self):
        from zyon.diagnostics import app_version
        phone, _ = fixture.SignupEmailMethodTests().make_phone([])
        phone.driver.capabilities = {'platformName':'Android'}
        with patch('zyon.diagnostics.subprocess.run', return_value=Mock(stdout='package data omitted\n versionName=400.0.0.1.23\n')) as run:
            self.assertEqual(app_version(phone), '400.0.0.1.23')
        self.assertEqual(run.call_args.args[0][-3:], ['dumpsys','package','com.instagram.android'])
