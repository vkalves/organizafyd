# Python / tests/test_desktop_gui.py / Python 3.11+ / actual native Tk GUI
import os,tempfile,unittest
from unittest.mock import patch
from helpers import MemoryVault
@unittest.skipUnless(os.name=='nt' or os.environ.get('DISPLAY'),'Native GUI requires Windows or an X display')
class DesktopTests(unittest.TestCase):
 def test_missing_tester_name_opens_flow_tab_without_saving_or_starting(self):
  import tkinter as tk
  from zyon.desktop import Desktop
  from test_workflow import SETTINGS
  with tempfile.TemporaryDirectory() as directory:
   root=tk.Tk()
   try:
    app=Desktop(root,directory,MemoryVault());root.update()
    for name,value in SETTINGS.items():
     if name in app.values:app.values[name].set(value)
    app.values['tester_app_name'].set('');app.values['save_secrets'].set(True)
    app.values['device_choice'].set('My phone');app.device_map['My phone']=SETTINGS['serial']
    app.values['flow_choice'].set('My flow');app.flow_map['My flow']=SETTINGS['flow_id']
    target=app.field_targets['tester_app_name'][0]
    with patch('zyon.desktop.messagebox.showerror') as alert,patch.object(app,'save_profile') as save,patch.object(app.workflow,'start') as start,patch.object(target,'focus_set') as focus:
     app.start();root.update()
     self.assertEqual(app.notebook.tab(app.notebook.select(),'text'),'FLUXO');focus.assert_called_once()
     alert.assert_called_once();self.assertIn('Nome do app no convite',alert.call_args.args[1])
     save.assert_not_called();start.assert_not_called();self.assertEqual(app.workflow.snapshot()['status'],'idle')
   finally:root.destroy()
 def test_native_window_and_tabs_do_not_start_web_server(self):
  import tkinter as tk
  from zyon.desktop import Desktop
  with tempfile.TemporaryDirectory() as directory,patch('zyon.server.Server') as web_server:
   root=tk.Tk()
   try:
    app=Desktop(root,directory,MemoryVault());root.update()
    self.assertEqual(len(app.notebook.tabs()),10);self.assertEqual(root.winfo_class(),'Tk');self.assertEqual(app.workflow.snapshot()['status'],'idle')
    app.values['full_name'].set('Configured Profile');app.generate();self.assertTrue(app.values['username'].get().startswith('configuredprofile'));self.assertGreaterEqual(len(app.values['instagram_password'].get()),20)
    app.values['username'].set('same.account');app.save_profile(silent=True);self.assertIn('same.account',app.saved);web_server.assert_not_called()
   finally:root.destroy()
