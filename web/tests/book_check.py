"""User-reported size: a small PDF with one hundred text pages."""
import os
from pathlib import Path
import tempfile
import time
import shutil
import pymupdf
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('KOREKTURA_BROWSER_TEST_URL', 'http://127.0.0.1:8510')
with tempfile.TemporaryDirectory(prefix='korektura-book-') as folder, sync_playwright() as p:
    source = Path(folder) / '100-stran.pdf'
    with pymupdf.open() as doc:
        for index in range(100):
            page = doc.new_page()
            page.insert_font(fontname='cs', fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
            text = 'Chtěl by jste přijít. To je vyjímka.\n' + ('Čteme knihu. Je to dobrá kniha. Čteme český text.\n' * 35)
            assert page.insert_textbox((40, 40, 555, 800), text, fontname='cs', fontsize=12) >= 0
        doc.save(source, deflate=True)
    assert source.stat().st_size < 2 * 1024 * 1024
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':1200,'height':1000})
    page = context.new_page()
    page.goto(URL, wait_until='domcontentloaded'); context.set_offline(True)
    expect(page.locator('#file')).to_be_enabled(timeout=120000)
    page.locator('#file').set_input_files(source)
    expect(page.locator('#metadata')).to_contain_text('100 stran', timeout=30000)
    expect(page.locator('#run')).to_be_enabled()
    page.evaluate('''() => {
      window.fractions=[];
      new MutationObserver(() => fractions.push(document.getElementById('progress').value))
        .observe(document.getElementById('progress'),{attributes:true,attributeFilter:['value']});
    }''')
    start = time.monotonic(); page.locator('#run').click()
    expect(page.locator('#processing')).to_be_visible()
    page.screenshot(path='/workspace/.cloud-setup/korektura-knihy/browser-book-progress.png', full_page=True)
    expect(page.locator('#result')).to_be_visible(timeout=120000)
    expect(page.locator('#count-pages')).to_have_text('100')
    expect(page.locator('#count-total')).to_have_text('200')
    assert any(0 < fraction < 1 for fraction in page.evaluate('window.fractions'))
    with page.expect_download() as event: page.locator('#download-pdf').click()
    output = Path(folder) / 'result.pdf'; event.value.save_as(output)
    shutil.copyfile(source, '/workspace/.cloud-setup/korektura-knihy/book-100-source.pdf')
    shutil.copyfile(output, '/workspace/.cloud-setup/korektura-knihy/book-100-result.pdf')
    with pymupdf.open(source) as before, pymupdf.open(output) as after:
        assert len(after) == 100
        assert sum(len(list(page.annots())) for page in after) == 200
        assert all(a.get_text() == b.get_text() for a,b in zip(before, after))
        assert all([before.xref_stream(x) for x in a.get_contents()] == [after.xref_stream(x) for x in b.get_contents()]
                   for a,b in zip(before, after))
        for index in [0,99]:
            # RGBA avoids opaque-background compositing rounding when highlights
            # introduce transparency. Original text streams and glyphs are exact.
            assert before[index].get_pixmap(annots=False, alpha=True).samples == after[index].get_pixmap(annots=False, alpha=True).samples
    print(f'PASS: 100 pages, {source.stat().st_size / 1024:.0f} kB, 200 corrections, real progress and preserved PDF; {time.monotonic()-start:.1f} s', flush=True)
    browser.close()
