"""Actual manual-Plus workflow and API contracts; no real account or model call.

Curated model replies test anchoring and protection, not a model's language score.
"""
import json
import os
from pathlib import Path
import tempfile
import pymupdf
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('KOREKTURA_BROWSER_TEST_URL','http://127.0.0.1:8510')
def correction(original,replacement,category='Pravopis'):
    return {'original':original,'replacement':replacement,'category':category,'comment':'Ověření českého pravidla.','confidence':'high'}

with tempfile.TemporaryDirectory(prefix='korektura-model-') as directory, sync_playwright() as p:
    root=Path(directory); source=root/'kniha.pdf'
    texts=['Jan Švamberk přijel do českého krumlova. Řekl že přijde.\nPhDr. Novák citoval:\n„Guten Tag, mein lieber Freund.“\n„Je pense, donc je suis.“\n„Veni, vidi, vici.“\n“The quick brown fox.”',
           'Kniha byla, a zůstala dobrá.\nV současné době čteme. Voda byla suchá.']
    with pymupdf.open() as doc:
        for text in texts:
            page=doc.new_page();page.insert_font(fontname='cs',fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
            page.insert_textbox((40,40,555,800),text,fontname='cs',fontsize=12)
        doc.save(source)
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    context=browser.new_context();page=context.new_page();errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(URL,wait_until='domcontentloaded');context.set_offline(True)
    expect(page.locator('#file')).to_be_enabled(timeout=120000)
    expect(page.locator('#mode')).to_have_value('plus')
    page.locator('#file').set_input_files(source);expect(page.locator('#run')).to_be_enabled();page.locator('#run').click()
    expect(page.locator('#manual-review')).to_be_visible(timeout=120000)
    expect(page.locator('#finish-review')).to_be_disabled()
    task=page.locator('#review-block').input_value()
    prompt=page.locator('#review-prompt').input_value()
    assert 'čárky' in prompt and 'příjmení' in prompt and 'latinské' in prompt
    payload={'task_id':task,'entities':[{'text':'českého krumlova','kind':'place'}],
       'corrections':[correction('českého krumlova','Českého Krumlova','Velká a malá písmena'),correction('Řekl že','Řekl, že','Interpunkce'),
           correction('byla, a','byla a','Interpunkce'),correction('V současné době','Nyní','Stylistika'),correction('Voda byla suchá.',None,'Smysl vět'),
           correction('Švamberk','Švanda'),correction('PhDr.','Profesor'),correction('Guten','Dobrý'),correction('pense','penses'),correction('Veni','Přišel'),correction('quick','fast')]}
    page.locator('#review-response').fill(json.dumps({**payload,'task_id':'wrong-book'},ensure_ascii=False))
    page.locator('#import-response').click();expect(page.locator('#message')).to_contain_text('jinému bloku')
    expect(page.locator('#finish-review')).to_be_disabled()
    page.locator('#review-response').fill(json.dumps(payload,ensure_ascii=False));page.locator('#import-response').click()
    expect(page.locator('#import-notice')).to_contain_text('Přijato 5 návrhů; odmítnuto 6')
    expect(page.locator('#finish-review')).to_be_enabled();page.locator('#finish-review').click()
    expect(page.locator('#result')).to_be_visible(timeout=30000);expect(page.locator('#count-total')).to_have_text('5')
    expect(page.locator('#counts')).to_contain_text('Velká a malá písmena: 1')
    with page.expect_download() as event:page.locator('#download-pdf').click()
    output=root/'output.pdf';event.value.save_as(output)
    with pymupdf.open(source) as before,pymupdf.open(output) as after:
        assert sum(len(list(page.annots())) for page in after)==5
        assert all(a.get_text()==b.get_text() for a,b in zip(before,after))
        assert all(a.get_pixmap(annots=False,alpha=True).samples==b.get_pixmap(annots=False,alpha=True).samples for a,b in zip(before,after))
    print('PASS: Plus manual prompts, imported comma/case/style/semantic corrections, protected names/abbreviations/four quotations and real unchanged PDF',flush=True)

    context.set_offline(False)
    requests=[]
    def api(route):
        data=route.request.post_data_json; requests.append(data)
        content=data['messages'][-1]['content']
        import re
        task_id=re.search(r'"task_id":"([^"]+)"',content).group(1)
        route.fulfill(content_type='application/json',body=json.dumps({'choices':[{'finish_reason':'stop','message':{'content':json.dumps({'task_id':task_id,'corrections':[correction('Řekl že','Řekl, že','Interpunkce')]})}}],
          'usage':{'prompt_tokens':100,'completion_tokens':50}}))
    page.route('https://api.openai.com/v1/chat/completions',api)
    page.locator('#mode').select_option('online');page.locator('#api-key').fill('test-only-not-a-real-key');page.locator('#run').click()
    expect(page.locator('#result')).to_be_visible(timeout=30000);expect(page.locator('#count-total')).to_have_text('1')
    assert len(requests)==1 and 'test-only-not-a-real-key' not in json.dumps(requests)
    with page.expect_download() as event:page.locator('#download-json').click()
    report=root/'report.json';event.value.save_as(report)
    data=json.loads(report.read_text());assert data['review']['engine']=='GPT-4.1'
    assert 'test-only-not-a-real-key' not in report.read_text()
    print('PASS: automatic API pipeline with controlled response, usage metadata and no key in prompts or exports',flush=True)
    page.unroute('https://api.openai.com/v1/chat/completions',api)
    page.route('https://api.openai.com/v1/chat/completions',lambda route:route.fulfill(status=402,body='No credit'))
    page.locator('#run').click();expect(page.locator('#message')).to_contain_text('chybí kredit')
    expect(page.locator('#result')).to_be_hidden()
    assert not errors,errors
    print('PASS: API errors invalidate exports without silently falling back to elementary rules',flush=True)

    # A long book cannot be marked complete while some blocks lack a reply.
    long_source=root/'vice-bloku.pdf'
    with pymupdf.open() as doc:
        for _ in range(4):
            sheet=doc.new_page();sheet.insert_font(fontname='cs',fontfile='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
            sheet.insert_textbox((40,40,555,800),'Čteme českou knihu a posuzujeme celé věty. '*35,fontname='cs',fontsize=10)
        doc.save(long_source)
    context.set_offline(True)
    page.locator('#mode').select_option('plus');page.locator('#file').set_input_files(long_source)
    expect(page.locator('#run')).to_be_enabled();page.locator('#run').click()
    expect(page.locator('#manual-review')).to_be_visible(timeout=120000)
    total=page.locator('#review-block option').count();assert total>1
    for index in range(total):
        current=page.locator('#review-block').input_value()
        page.locator('#review-response').fill(json.dumps({'task_id':current,'corrections':[]}));page.locator('#import-response').click()
        expect(page.locator('#review-status')).to_contain_text(f'Zkontrolováno {index+1}/{total}')
        if index+1<total:
            expect(page.locator('#finish-review')).to_be_disabled()
            assert page.locator('#review-block').input_value()!=current
    expect(page.locator('#finish-review')).to_be_enabled()
    page.set_viewport_size({'width':390,'height':844})
    page.locator('#manual-review').scroll_into_view_if_needed()
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile overflow'
    page.screenshot(path='/workspace/shared/korektura-plus-mobile.png',full_page=True)
    page.locator('#finish-review').click();expect(page.locator('#result')).to_be_visible(timeout=30000)
    expect(page.locator('#count-total')).to_have_text('0')
    assert not errors,errors
    print('PASS: every block is required, next block is selected automatically and Plus form fits mobile width',flush=True)
    browser.close()
