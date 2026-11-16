# Python / tests/test_desktop_gui.py / Python 3.11+ / actual native Tk GUI
import os,tempfile,unittest
from unittest.mock import patch
from helpers import MemoryVault
@unittest.skipUnless(os.name=='nt' or os.environ.get('DISPLAY'),'Native GUI requires Windows or an X display')
class DesktopTests(unittest.TestCase):
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
