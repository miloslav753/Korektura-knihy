"""Real-browser failure, timeout, cancellation and retry regressions."""
import os
from pathlib import Path
import tempfile
import pymupdf
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('KOREKTURA_BROWSER_TEST_URL', 'http://127.0.0.1:8510')
INJECT = '''
const NativeWorker = window.Worker;
window.testFailure = '';
window.Worker = class extends NativeWorker {
  postMessage(data, transfer) {
    if (data.type === 'boot' && window.testFailure === 'boot') {
      window.testFailure='';
      queueMicrotask(() => this.onmessage({data:{type:'boot-error',message:'Test: příprava selhala'}})); return;
    }
    if (data.type === 'inspect' && window.testFailure === 'crash') {
      window.testFailure='';
      queueMicrotask(() => this.onerror({message:'Test: nedostatek paměti'})); return;
    }
    if (['inspect','process'].includes(data.type) && window.testFailure === 'silent') return;
    return super.postMessage(data, transfer);
  }
};
'''

with tempfile.TemporaryDirectory(prefix='korektura-loading-') as directory, sync_playwright() as p:
    source = Path(directory) / 'book.pdf'
    with pymupdf.open() as doc:
        page = doc.new_page(); page.insert_text((40, 60), 'To by jste.'); doc.save(source)
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    context = browser.new_context()
    context.add_init_script(INJECT)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL, wait_until='domcontentloaded')
    context.set_offline(True)
    expect(page.locator('#file')).to_be_enabled(timeout=120000)

    def recover():
        expect(page.locator('#retry')).to_be_visible()
        page.locator('#retry').click()
        expect(page.locator('#file')).to_be_enabled(timeout=120000)
        expect(page.locator('#message')).to_be_hidden()

    page.evaluate("window.testFailure='crash'")
    page.locator('#file').set_input_files(source)
    expect(page.locator('#message')).to_contain_text('nedostatek paměti')
    expect(page.locator('#processing')).to_be_hidden()
    expect(page.locator('#result')).to_be_hidden()
    page.evaluate("window.testFailure='boot'")
    page.locator('#retry').click()
    expect(page.locator('#message')).to_contain_text('příprava selhala')
    recover()
    print('PASS: worker crash and boot failure show actionable errors and recover without reloading HTML', flush=True)

    page.clock.install()
    page.evaluate("window.testFailure='silent'")
    page.locator('#file').set_input_files(source)
    expect(page.locator('#processing')).to_be_visible()
    expect(page.locator('#progress-label')).to_contain_text('Otevírám PDF')
    page.clock.fast_forward(121000)
    expect(page.locator('#message')).to_contain_text('Načítání PDF trvá příliš dlouho')
    expect(page.locator('#processing')).to_be_hidden()
    page.evaluate("window.testFailure=''")
    recover()
    print('PASS: unresponsive inspection times out with recovery instead of hanging forever', flush=True)

    page.evaluate("window.testFailure='silent'")
    page.locator('#file').set_input_files(source)
    expect(page.locator('#progress-label')).to_contain_text('Otevírám PDF')
    page.locator('#cancel').click()
    expect(page.locator('#message')).to_contain_text('zastaveno')
    expect(page.locator('#processing')).to_be_hidden()
    page.evaluate("window.testFailure=''")
    recover()
    print('PASS: PDF loading can be cancelled immediately without leaving a pending request', flush=True)

    page.locator('#file').set_input_files(source)
    expect(page.locator('#run')).to_be_enabled()
    page.evaluate("window.testFailure='silent'")
    page.locator('#run').click()
    expect(page.locator('#processing')).to_be_visible()
    page.clock.fast_forward(5000)
    page.wait_for_function(r'Number(document.getElementById("elapsed").textContent.match(/\d+/)?.[0]) >= 5')
    page.locator('#cancel').click()
    expect(page.locator('#message')).to_contain_text('zastaveno')
    expect(page.locator('#processing')).to_be_hidden()
    expect(page.locator('#result')).to_be_hidden()
    page.evaluate("window.testFailure=''")
    recover()
    page.locator('#file').set_input_files(source)
    expect(page.locator('#run')).to_be_enabled()
    page.locator('#run').click()
    expect(page.locator('#result')).to_be_visible(timeout=30000)
    expect(page.locator('#count-total')).to_have_text('1')
    assert not errors, errors
    print('PASS: elapsed time, immediate cancellation and successful reprocessing after recovery', flush=True)
    browser.close()
