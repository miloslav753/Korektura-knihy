"""Install a pinned, checksum-verified Czech Tesseract model (Apache-2.0)."""
import hashlib
import os
from pathlib import Path
import shutil
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REVISION = "87416418657359cb625c412a48b6e1d6d41c29bd"
SHA256 = "934bcaf97ef3348413263331131c9fa7f55f30db333c711929c124fb635f7e1b"
target = Path(os.environ.get("KOREKTURA_TESSDATA", str(ROOT / "data" / "tessdata")))
target.mkdir(parents=True, exist_ok=True)
model = target / "ces.traineddata"
if model.is_file() and hashlib.sha256(model.read_bytes()).hexdigest() == SHA256:
    print(f"Český model OCR je připraven: {target}")
else:
    if model.exists():
        raise SystemExit("Existující OCR model má jiný kontrolní součet. Soubor nebyl přepsán.")
    url = f"https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/{REVISION}/ces.traineddata"
    with urllib.request.urlopen(url, timeout=60) as response:
        content = response.read()
    if hashlib.sha256(content).hexdigest() != SHA256:
        raise SystemExit("Stažený model nesouhlasí s očekávaným kontrolním součtem.")
    model.write_bytes(content)
    print(f"Český model OCR stažen a ověřen: {target}")
if not shutil.which("tesseract"):
    print("Pro OCR ještě nainstalujte Tesseract 5. Textové PDF funguje i bez něj.")
