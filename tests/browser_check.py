"""Real upload/download checks. Run with: python tests/browser_check.py."""
from pathlib import Path
import csv
import io
import os
import re
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import pymupdf
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get("KOREKTURA_TEST_URL", "http://127.0.0.1:8501")
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def make_pdf(path, texts, password=None):
    with pymupdf.open() as doc:
        for text in texts:
            page = doc.new_page()
            page.insert_font(fontname="czech", fontfile=FONT)
            page.insert_text((40, 70), text, fontname="czech", fontsize=16)
        kwargs = dict(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw=password, user_pw=password) if password else {}
        doc.save(path, **kwargs)


with tempfile.TemporaryDirectory(prefix="korektura-browser-") as directory, sync_playwright() as playwright:
    base = Path(directory)
    source = base / "ukázka.pdf"
    make_pdf(source, ["Chtěl by jste přijít. To je vyjímka,ano.", "V současné době čteme knihu."])
    browser = playwright.chromium.launch(executable_path=shutil.which("chromium"), headless=True,
                                         args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1360, "height": 1050})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(URL, wait_until="networkidle")
    expect(page.get_by_role("heading", name="Každé slovo na svém místě.")).to_be_visible()
    page.locator('input[type="file"]').set_input_files(str(source))
    expect(page.get_by_role("button", name="Spustit korekturu")).to_be_visible()
    page.get_by_role("button", name="Spustit korekturu").click()
    expect(page.get_by_text("Kontrola dokončena: 2 strany.", exact=False)).to_be_visible(timeout=60000)
    expect(page.get_by_text("Gramatika: 1", exact=False)).to_be_visible()
    expect(page.get_by_text("Stylistika: 1", exact=False)).to_have_count(0)
    with page.expect_download() as download:
        page.get_by_role("button", name="Stáhnout PDF s korekturami").click()
    target = base / "annotated.pdf"
    download.value.save_as(target)
    assert download.value.suggested_filename == "ukazka_korektury.pdf"
    with pymupdf.open(source) as before, pymupdf.open(target) as after:
        assert len(after) == 2
        assert sum(len(list(p.annots())) for p in after) == 3
        assert all(a.get_text() == b.get_text() for a, b in zip(before, after))
        assert all(a.get_pixmap(annots=False, alpha=True).samples == b.get_pixmap(annots=False, alpha=True).samples for a, b in zip(before, after))
    with page.expect_download() as download:
        page.get_by_role("button", name="Stáhnout seznam (CSV)").click()
    report = base / "report.csv"
    download.value.save_as(report)
    rows = list(csv.DictReader(io.StringIO(report.read_text(encoding="utf-8-sig"))))
    assert len(rows) == 3 and any(row["Návrh opravy"] == "výjimka" for row in rows)
    print("PASS: actual PDF upload, local proofreading, PDF and CSV downloads, original appearance")

    page.get_by_text("Přidat stylistická doporučení", exact=True).click()
    expect(page.get_by_role("button", name="Stáhnout PDF s korekturami")).to_have_count(0)
    page.get_by_role("button", name="Spustit korekturu").click()
    expect(page.get_by_text("Stylistika: 1", exact=False)).to_be_visible(timeout=60000)
    page.get_by_text("Vybrat stránky a povolená slova", exact=True).click()
    page.get_by_role("spinbutton", name="Od strany").fill("2")
    page.get_by_role("spinbutton", name="Od strany").press("Tab")
    expect(page.get_by_role("button", name="Stáhnout PDF s korekturami")).to_have_count(0)
    page.get_by_role("button", name="Spustit korekturu").click()
    expect(page.get_by_text("Kontrola dokončena: 1 strana.", exact=False)).to_be_visible(timeout=60000)
    expect(page.get_by_text("Pravopis: 1", exact=False)).to_have_count(0)
    expect(page.get_by_text("Stylistika: 1", exact=False)).to_be_visible()
    print("PASS: stylistic toggle, changed settings invalidate old downloads, selected page range")

    invalid = base / "invalid.pdf"
    invalid.write_bytes(b"not a PDF")
    page.locator('input[type="file"]').set_input_files(str(invalid))
    expect(page.get_by_text("Vybraný soubor se nepodařilo otevřít jako PDF.")).to_be_visible()
    expect(page.get_by_role("button", name="Stáhnout PDF s korekturami")).to_have_count(0)
    print("PASS: invalid PDF has a visible error and no stale result")

    protected = base / "protected.pdf"
    make_pdf(protected, ["To je vyjímka."], password="heslo")
    page.locator('input[type="file"]').set_input_files(str(protected))
    page.get_by_role("textbox", name="Heslo k PDF").fill("heslo")
    page.get_by_role("textbox", name="Heslo k PDF").press("Enter")
    expect(page.get_by_role("button", name="Spustit korekturu")).to_be_visible()
    page.get_by_role("button", name="Spustit korekturu").click()
    expect(page.get_by_text("Kontrola dokončena: 1 strana.", exact=False)).to_be_visible(timeout=60000)
    with page.expect_download() as download:
        page.get_by_role("button", name="Stáhnout PDF s korekturami").click()
    protected_result = base / "protected-result.pdf"
    download.value.save_as(protected_result)
    with pymupdf.open(protected_result) as doc:
        assert doc.needs_pass and doc.authenticate("heslo")
        assert len(list(doc[0].annots())) == 1
    print("PASS: password-protected upload and preserved encryption on download")

    scan = base / "scan.pdf"
    with pymupdf.open(source) as doc:
        raster = doc[0].get_pixmap(matrix=pymupdf.Matrix(2, 2)).tobytes("png")
    with pymupdf.open() as doc:
        doc.new_page().insert_image(pymupdf.Rect(0, 0, 595, 842), stream=raster)
        doc.save(scan)
    page.locator('input[type="file"]').set_input_files(str(scan))
    expect(page.get_by_text(re.compile(r"^scan\.pdf ·"))).to_be_visible()
    expect(page.get_by_role("button", name="Stáhnout PDF s korekturami")).to_have_count(0)
    expect(page.get_by_role("button", name="Spustit korekturu")).to_be_visible()
    page.get_by_role("button", name="Spustit korekturu").click()
    expect(page.get_by_text("Kontrola dokončena: 1 strana.", exact=False)).to_be_visible(timeout=60000)
    expect(page.get_by_text("Pravopis: 1", exact=False)).to_be_visible()
    with page.expect_download() as download:
        page.get_by_role("button", name="Stáhnout podrobnosti (JSON)").click()
    import json
    metadata = base / "metadata.json"
    download.value.save_as(metadata)
    assert json.loads(metadata.read_text())["ocr_pages"] == [1]
    print("PASS: scanned PDF, Czech OCR, and JSON download")

    page.set_viewport_size({"width": 1360, "height": 1900})
    page.locator('[data-testid="stMain"]').evaluate('(element) => element.scrollTop = 0')
    page.screenshot(path="/workspace/.cloud-setup/korektura-knihy/application-desktop.png", full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    expect(page.get_by_role("heading", name="Každé slovo na svém místě.")).to_be_visible()
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    page.locator('[data-testid="stMain"]').evaluate('(element) => element.scrollTop = 0')
    page.screenshot(path="/workspace/.cloud-setup/korektura-knihy/application-mobile.png", full_page=True)
    assert not errors, errors
    browser.close()
    print("PASS: desktop and mobile layout, no uncaught browser errors")
