# Python / package.py / Python 3.11+ / reproducible companion source ZIP
import hashlib
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / 'dist'
ALLOWED_ROOT = {'README.md','requirements.txt','start.cmd','setup-appium.cmd','setup-appium.ps1','start-appium.cmd','package.py','install-requirements.cmd','install-requirements.ps1','runtime.ps1','launch.ps1','native-entry.py','Zyon.spec','requirements-build.txt','package-desktop.py'}


def build():
    OUTPUT.mkdir(exist_ok=True)
    target = OUTPUT / 'Zyon-Desktop-Source-2.0.zip'
    paths = sorted(path for path in ROOT.rglob('*') if path.is_file()
        and (path.relative_to(ROOT).as_posix() in ALLOWED_ROOT
             or path.relative_to(ROOT).parts[0] in ('zyon','tests') and path.suffix in ('.py','.html','.js','.css','.ps1','.json')
             or path.relative_to(ROOT).as_posix() in ('tools/package.json','tools/package-lock.json'))
        and '__pycache__' not in path.parts)
    with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        for path in paths:
            entry=zipfile.ZipInfo('ZyonCompanion/' + path.relative_to(ROOT).as_posix(),date_time=(2026,11,15,0,0,0))
            entry.compress_type=zipfile.ZIP_DEFLATED
            entry.external_attr=0o100644 << 16
            archive.writestr(entry,path.read_bytes())
    digest=hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix('.zip.sha256').write_text(digest+'  '+target.name+'\n',encoding='ascii')
    print(str(target));print(digest)
    return target

if __name__=='__main__': build()
