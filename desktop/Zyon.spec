# Python / Zyon.spec / PyInstaller 6 / Windows x64 native executable
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, copy_metadata

project = Path(SPECPATH)
playwright_data, playwright_binaries, playwright_imports = collect_all('playwright')
a = Analysis([str(project / 'native-entry.py')], pathex=[str(project)],
    binaries=playwright_binaries,
    datas=playwright_data + copy_metadata('Appium-Python-Client') + [(str(project / 'zyon/platform.json'), 'zyon')],
    hiddenimports=playwright_imports,
    hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=[])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='Zyon', debug=False,
    bootloader_ignore_signals=False, strip=False, upx=False, console=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='Zyon')
