"""Build or verify the deterministic, source-controlled extension download."""
from pathlib import Path
import argparse
import io
import zipfile

root = Path(__file__).resolve().parents[1]
source = root / "extensions/storys-com-link"
target = root / "public/extensions/storys-com-link.zip"
files = ["manifest.json", "background.js", "editor.html", "editor.css", "editor.js", "LEIA-ME.txt"]
parser = argparse.ArgumentParser()
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
output = io.BytesIO()
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name in files:
        info = zipfile.ZipInfo(name, date_time=(2026, 11, 9, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (source / name).read_bytes())
expected = output.getvalue()
if args.check:
    if not target.exists() or target.read_bytes() != expected:
        raise SystemExit("Extension ZIP is missing or differs from source. Rebuild it.")
    print("PASS: extension ZIP matches source exactly")
else:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(expected)
    print(f"Built {target.relative_to(root)} ({len(expected)} bytes)")
