"""Real browser-only upload/download and offline OCR verification."""
import csv
import base64
import io
import json
import os
from pathlib import Path
import tempfile
import zipfile

import pymupdf
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get("KOREKTURA_BROWSER_TEST_URL", "http://127.0.0.1:8510")
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def make_pdf(path, texts, password=None, rotation=0):
    with pymupdf.open() as doc:
        for text in texts:
            page = doc.new_page()
            page.insert_font(fontname="cs", fontfile=FONT)
            page.insert_text((40, 70), text, fontname="cs", fontsize=16)
            page.set_rotation(rotation)
        kwargs = dict(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw=password, user_pw=password) if password else {}
        doc.save(path, **kwargs)


with tempfile.TemporaryDirectory(prefix="korektura-web-") as directory, sync_playwright() as playwright:
    base = Path(directory)
    source = base / "ukázka.pdf"
    make_pdf(source, ["Chtěl by jste přijít. To je vyjímka,ano.", "V současné době čteme knihu."])
    browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 1360, "height": 1100})
    page = context.new_page()
    errors, external_requests = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: external_requests.append(request.url)
            if request.url.startswith(("http:", "https:")) and not request.url.startswith(URL) else None)
    page.goto(URL, wait_until="domcontentloaded")
    # Every subsequent operation must work with all network access disabled.
    context.set_offline(True)
    # Reproduce the reported race: a drop arrives before dictionary/PDF boot.
    expect(page.locator('#startup-progress')).to_be_visible()
    page.evaluate('''encoded => {
      window.progressLog=[];
      new MutationObserver(() => progressLog.push(document.getElementById('progress-label').textContent))
        .observe(document.getElementById('progress-label'), {subtree:true,childList:true,characterData:true});
      const drop=new DataTransfer();
      drop.items.add(new File([Uint8Array.from(atob(encoded), c=>c.charCodeAt(0))], 'ukázka.pdf', {type:'application/pdf'}));
      document.getElementById('dropzone').dispatchEvent(new DragEvent('drop',{dataTransfer:drop,bubbles:true,cancelable:true}));
    }''', base64.b64encode(source.read_bytes()).decode())
    expect(page.locator('#processing')).to_be_visible()
    expect(page.locator("#startup")).to_have_text("Připraveno. Vyberte své PDF.", timeout=120000)
    expect(page.locator('#run')).to_be_enabled(timeout=30000)
    expect(page.locator('#file-help')).to_contain_text('Spustit korekturu')
    expect(page.locator('#startup-progress')).to_be_hidden()
    print('PASS: early PDF drop waits for initialization, finishes loading and reveals the start button', flush=True)

    def upload(path):
        page.locator("#file").set_input_files(str(path))
        expect(page.locator("#metadata")).to_contain_text(path.name, timeout=30000)
        expect(page.locator("#run")).to_be_enabled()

    def run(expected_pages):
        page.locator("#run").click()
        page.wait_for_function('!document.getElementById("result").hidden || !document.getElementById("message").hidden', timeout=120000)
        assert page.locator("#message").is_hidden(), page.locator("#message").text_content()
        expect(page.locator("#result")).to_be_visible(timeout=120000)
        expect(page.locator("#count-pages")).to_have_text(str(expected_pages))
        expect(page.locator("#message")).to_be_hidden()

    def download(id, filename):
        with page.expect_download() as event:
            page.locator("#" + id).click()
        target = base / filename
        event.value.save_as(target)
        assert not event.value.failure()
        return target, event.value.suggested_filename

    run(2)
    history = page.evaluate('window.progressLog')
    assert any('Otevírám PDF' in label for label in history), history
    assert any('stranu' in label for label in history), history
    assert any('Ukládám PDF' in label for label in history), history
    expect(page.locator("#count-total")).to_have_text("3")
    output, name = download("download-pdf", "annotated.pdf")
    assert name == "ukazka_korektury.pdf"
    with pymupdf.open(source) as before, pymupdf.open(output) as after:
        assert len(after) == 2
        assert sum(len(list(page.annots())) for page in after) == 3
        assert all(a.get_text() == b.get_text() for a, b in zip(before, after))
        assert all(a.get_pixmap(annots=False, alpha=True).samples == b.get_pixmap(annots=False, alpha=True).samples for a, b in zip(before, after))
    report, _ = download("download-csv", "report.csv")
    rows = list(csv.DictReader(io.StringIO(report.read_text(encoding="utf-8-sig"))))
    assert len(rows) == 3 and any(row["Návrh opravy"] == "výjimka" for row in rows)
    print("PASS: offline browser-only PDF upload, proofreading, PDF/CSV downloads and identical original appearance", flush=True)

    page.locator("#stylistic").check()
    expect(page.locator("#result")).to_be_hidden()
    run(2); expect(page.locator("#count-total")).to_have_text("4"); expect(page.locator("#count-style")).to_have_text("1")
    page.get_by_text("Vybrat stránky a povolená slova", exact=True).click()
    page.locator("#first-page").fill("2")
    run(1); expect(page.locator("#count-total")).to_have_text("1")
    print("PASS: optional style, invalidated previous results, selected page range", flush=True)

    invalid = base / "invalid.pdf"; invalid.write_bytes(b"not a PDF")
    page.locator("#file").set_input_files(str(invalid))
    expect(page.locator("#message")).to_be_visible()
    expect(page.locator("#result")).to_be_hidden()
    print("PASS: invalid PDF has a visible error and no stale export", flush=True)

    protected = base / "protected.pdf"
    make_pdf(protected, ["To je vyjímka."], password="heslo")
    page.locator("#file").set_input_files(str(protected))
    expect(page.locator("#locked")).to_be_visible()
    page.locator("#password").fill("špatné")
    page.locator("#unlock").click()
    expect(page.locator("#message")).to_be_visible()
    expect(page.locator("#unlock")).to_be_enabled()
    page.locator("#password").fill("heslo"); page.locator("#unlock").click()
    expect(page.locator("#run")).to_be_enabled(); run(1)
    encrypted, _ = download("download-pdf", "encrypted.pdf")
    with pymupdf.open(encrypted) as doc:
        assert doc.needs_pass and doc.authenticate("heslo")
        assert len(list(doc[0].annots())) == 1
    print("PASS: protected PDF and preserved encryption, entirely offline", flush=True)

    rotated = base / "rotated.pdf"; make_pdf(rotated, ["To je vyjímka."], rotation=90)
    upload(rotated); run(1)
    rotated_output, _ = download("download-pdf", "rotated-output.pdf")
    with pymupdf.open(rotated) as before, pymupdf.open(rotated_output) as after:
        page_pdf = after[0]
        assert page_pdf.rotation == 90
        assert list(page_pdf.annots())[0].rect.contains(page_pdf.search_for("vyjímka")[0])
        assert before[0].get_pixmap(annots=False, alpha=True).samples == page_pdf.get_pixmap(annots=False, alpha=True).samples
    print("PASS: rotated page coordinates and original appearance", flush=True)

    scan = base / "scan.pdf"
    with pymupdf.open(source) as doc:
        raster = doc[0].get_pixmap(matrix=pymupdf.Matrix(2, 2)).tobytes("png")
    with pymupdf.open() as doc:
        p = doc.new_page(); p.insert_image(p.rect, stream=raster); doc.save(scan)
    upload(scan); run(1)
    expect(page.locator("#count-ocr")).to_have_text("1")
    expect(page.locator("#count-total")).to_have_text("3")
    metadata, _ = download("download-json", "report.json")
    assert json.loads(metadata.read_text())["ocrPages"] == [1]
    scan_output, _ = download("download-pdf", "scan-output.pdf")
    with pymupdf.open(scan) as before, pymupdf.open(scan_output) as after:
        assert after[0].get_text() == ""
        assert before[0].get_pixmap(annots=False, alpha=True).samples == after[0].get_pixmap(annots=False, alpha=True).samples
    print("PASS: Czech OCR in browser, no downloads or external services, original scan unchanged", flush=True)

    page.locator("#search").fill("vyjímka")
    expect(page.locator("#rows tr")).to_have_count(1)
    page.locator("#search").fill("")
    page.get_by_text("Zdrojový kód a licence použitých součástí", exact=True).click()
    source_archive, _ = download("download-source", "sources.zip")
    with zipfile.ZipFile(source_archive) as zipped:
        assert zipped.testzip() is None
        assert "Korektura-knihy/web/src/worker.mjs" in zipped.namelist()
        assert "Korektura-knihy/data/cs_CZ/cs_CZ.dic" in zipped.namelist()
    page.get_by_text("Zdrojový kód a licence použitých součástí", exact=True).click()
    page.screenshot(path="/workspace/.cloud-setup/korektura-knihy/browser-only-desktop.png", full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path="/workspace/.cloud-setup/korektura-knihy/browser-only-mobile.png", full_page=True)
    assert not errors, errors
    assert not external_requests, external_requests
    browser.close()
    print("PASS: search, mobile layout, no uncaught browser errors and no external HTTP requests", flush=True)
