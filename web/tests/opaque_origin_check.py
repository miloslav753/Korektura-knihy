"""Offline browser regression for opaque origins, as used by local HTML files.

The cloud browser blocks file:// by administrator policy. A permitted sandbox
gives the application a secure opaque origin without changing that policy.
"""
import os
from pathlib import Path
import tempfile
import pymupdf
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('KOREKTURA_BROWSER_TEST_URL', 'http://127.0.0.1:8510')
HTML = Path(__file__).resolve().parents[1] / 'dist/index.html'
with tempfile.TemporaryDirectory(prefix='korektura-opaque-') as directory, sync_playwright() as p:
    root = Path(directory)
    source = root / '100-pages.pdf'
    with pymupdf.open() as doc:
        for index in range(100):
            page = doc.new_page(); page.insert_text((40,60), 'To by jste.');
        doc.save(source)
    scan = root / 'scan.pdf'
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_font(fontname='cs',fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
        page.insert_text((40,70),'Chtěl by jste přijít. To je vyjímka,ano.',fontname='cs',fontsize=16)
        image = page.get_pixmap(matrix=pymupdf.Matrix(2,2)).tobytes('png')
    with pymupdf.open() as doc:
        page = doc.new_page(); page.insert_image(page.rect,stream=image); doc.save(scan)

    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    context = browser.new_context()
    page = context.new_page()
    page.route(URL + '/', lambda route: route.fulfill(content_type='text/html', body='<html><body></body></html>'))
    page.goto(URL + '/'); context.set_offline(True)
    errors, requests = [], []
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('http:', 'https:')) else None)
    page.evaluate('''html => {
      const frame=document.createElement('iframe');frame.id='app';
      frame.sandbox='allow-scripts allow-downloads';frame.srcdoc=html;
      frame.style='width:100%;height:900px';document.body.append(frame);
    }''', HTML.read_text())
    app = page.frame_locator('#app')
    frame = page.frames[1]
    frame.wait_for_function('document.getElementById("file")?.disabled === false || document.getElementById("message")?.hidden === false', timeout=120000)
    assert app.locator('#message').is_hidden(), app.locator('#message').text_content()
    expect(app.locator('#file')).to_be_enabled()
    assert frame.evaluate('location.origin') == 'null'
    assert frame.evaluate('isSecureContext && !!crypto.subtle')
    expect(app.locator('#message')).to_be_hidden()
    print('PASS: entire standalone HTML boots offline in a secure opaque origin, without module workers', flush=True)

    app.locator('#file').set_input_files(source)
    expect(app.locator('#metadata')).to_contain_text('100 stran')
    expect(app.locator('#run')).to_be_enabled(); app.locator('#run').click()
    expect(app.locator('#result')).to_be_visible(timeout=120000)
    expect(app.locator('#count-pages')).to_have_text('100'); expect(app.locator('#count-total')).to_have_text('100')
    with page.expect_download() as event: app.locator('#download-pdf').click()
    output = root / 'output.pdf'; event.value.save_as(output)
    with pymupdf.open(source) as before, pymupdf.open(output) as after:
        assert len(after) == 100
        assert sum(len(list(page.annots())) for page in after) == 100
        assert all(a.get_text() == b.get_text() for a,b in zip(before, after))
        assert before[0].get_pixmap(annots=False,alpha=True).samples == after[0].get_pixmap(annots=False,alpha=True).samples
    print('PASS: 100-page PDF upload, check and real PDF download in opaque origin', flush=True)

    app.locator('#file').set_input_files(scan)
    expect(app.locator('#run')).to_be_enabled(); app.locator('#run').click()
    expect(app.locator('#result')).to_be_visible(timeout=120000)
    expect(app.locator('#count-ocr')).to_have_text('1'); expect(app.locator('#count-total')).to_have_text('3')
    with page.expect_download() as event: app.locator('#download-pdf').click()
    output = root / 'scan-output.pdf'; event.value.save_as(output)
    with pymupdf.open(scan) as before, pymupdf.open(output) as after:
        assert before[0].get_pixmap(annots=False,alpha=True).samples == after[0].get_pixmap(annots=False,alpha=True).samples
    assert not errors, errors
    assert not requests, requests
    print('PASS: Czech OCR and annotated scan download from opaque origin without network requests', flush=True)
    browser.close()
