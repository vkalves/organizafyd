# Python / package-desktop.py / Python 3.11+ / native Windows release package
import hashlib
from pathlib import Path
import shutil
import zipfile

root = Path(__file__).resolve().parent
bundle = root / 'dist' / 'Zyon'
if not (bundle / 'Zyon.exe').is_file(): raise SystemExit('Build Zyon.spec on Windows first.')
for name in ('install-requirements.cmd','install-requirements.ps1','runtime.ps1','launch.ps1','setup-appium.ps1','README.md'):
    shutil.copy2(root / name, bundle / name)
(bundle / 'tools').mkdir(exist_ok=True)
for name in ('package.json','package-lock.json'): shutil.copy2(root / 'tools' / name, bundle / 'tools' / name)
manifest = []
for path in sorted(bundle.rglob('*')):
    if path.is_file() and path.name != 'SHA256SUMS.txt':
        manifest.append(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.relative_to(bundle).as_posix())
(bundle / 'SHA256SUMS.txt').write_text('\n'.join(manifest) + '\n', encoding='utf-8')
target = root / 'dist' / 'Zyon-Desktop-Windows-2.0.3.zip'
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(bundle.rglob('*')):
        if path.is_file(): archive.write(path,'Zyon/' + path.relative_to(bundle).as_posix())
target.with_suffix('.zip.sha256').write_text(hashlib.sha256(target.read_bytes()).hexdigest()+'  '+target.name+'\n',encoding='ascii')
print(target)
