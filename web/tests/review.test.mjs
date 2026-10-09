import test from 'node:test';
import assert from 'node:assert/strict';
import * as mupdf from 'mupdf';
import {createReview, reviewPrompt, parseReviewResponse} from '../src/review-format.mjs';
import {protectText, preservesProtected, language} from '../src/text-protection.mjs';
import {checkWithModel} from '../src/model-api.mjs';
import {openPdf, extractBook, annotateReview, makeJSON} from '../src/pdf-engine.mjs';

const options = {stylistic:true, semantic:true, isKnown:()=>true};
const edit = (original,replacement,category='Pravopis',extra={}) => ({original,replacement,category,
  comment:'Návrh podle pravidel českého pravopisu.',confidence:'high',...extra});
const response = (review,corrections,entities=[]) => JSON.stringify({task_id:review.jobs[0].id,corrections,entities});

test('Personal names, geographical names, abbreviations and four foreign quotations stay intact', () => {
  const text = 'Jan Švamberk žil v Českém Krumlově. PhDr. Novák uvedl „Guten Tag, mein lieber Freund“, „Je pense, donc je suis“, „Veni, vidi, vici“ a “The quick brown fox”.';
  const review = createReview(text,options);
  const output = parseReviewResponse(response(review,[edit('Švamberk','Švanda'),edit('Krumlově','krumplích'),edit('PhDr.','Profesor'),
    edit('Guten','Dobrý'),edit('pense','penses'),edit('Veni','Přišel'),edit('quick','fast')]),review,review.jobs[0]);
  assert.equal(output.accepted.length,0); assert.equal(output.rejected.length,7);
});
test('Capitalization of a geographic name is allowed without renaming it', () => {
  const review = createReview('Navštívil český krumlov.',options);
  const output = parseReviewResponse(response(review,[edit('český krumlov','Český Krumlov','Velká a malá písmena')],
    [{text:'český krumlov',kind:'place'}]),review,review.jobs[0]);
  assert.equal(output.accepted[0].replacement,'Český Krumlov');
});
test('Mixed Czech and English quotes do not protect the Czech prose between them', () => {
  const review = createReview('„Čteme knihu.“ Řekl že přijde. “The quick brown fox.”', options);
  const parsed = parseReviewResponse(response(review, [edit('Řekl že', 'Řekl, že', 'Interpunkce'), edit('quick', 'fast')]), review, review.jobs[0]);
  assert.equal(parsed.accepted.length, 1); assert.equal(parsed.accepted[0].original, 'Řekl že');
  assert.equal(parsed.rejected.length, 1);
});
test('Missing and extra commas, style and a semantic note have exact source anchors', () => {
  const review = createReview('Řekl že přijde. Šel, a díval se. V současné době čteme. Voda byla suchá.',options);
  const parsed = parseReviewResponse(response(review,[edit('Řekl že','Řekl, že','Interpunkce'),
    edit('Šel, a','Šel a','Interpunkce'),edit('V současné době','Nyní','Stylistika'),
    edit('Voda byla suchá.',null,'Smysl vět')]),review,review.jobs[0]);
  assert.equal(parsed.accepted.length,4); assert(parsed.accepted.at(-1).note);
  for (const item of parsed.accepted) assert.equal(review.text.slice(item.start,item.end),item.original);
});
test('Ambiguous, hallucinated, wrong-book and malformed model responses are rejected', () => {
  const review = createReview('On řekl že přijde. Znovu řekl že odejde.',options);
  let parsed = parseReviewResponse(response(review,[edit('řekl že','řekl, že'),edit('vymyšlená věta','jiná')]),review,review.jobs[0]);
  assert.equal(parsed.accepted.length,0); assert.equal(parsed.rejected.length,2);
  parsed = parseReviewResponse(response(review,[edit('řekl že','řekl, že','Interpunkce',{before:'Znovu '})]),review,review.jobs[0]);
  assert.equal(parsed.accepted.length,1);
  assert.throws(()=>parseReviewResponse('{"task_id":"other","corrections":[]}',review,review.jobs[0]),/jinému bloku/);
  assert.throws(()=>parseReviewResponse('text bez JSON',review,review.jobs[0]),/platný JSON/);
});
test('Chunked review covers all text and supplies neighboring context across boundaries', () => {
  const text = 'Čteme českou knihu. '.repeat(600);
  const review = createReview(text,options);
  assert(review.jobs.length>1); assert.equal(review.jobs.map(job=>job.text).join(''),text);
  assert(review.jobs[1].before.length>0); assert(review.jobs[0].after.length>0);
  const prompt = reviewPrompt(review.jobs[0],options);
  assert(prompt.includes('čárky')); assert(prompt.includes('latinské')); assert(prompt.includes('příjmení'));
});
test('User-protected phrases override both spelling and capitalization edits', () => {
  const text = 'Žil v Českém Krumlově.';
  const spans = protectText(text,{isKnown:()=>true,ignoredWords:['Českém Krumlově']});
  assert(!preservesProtected(text,{start:6,end:21,original:'Českém Krumlově',replacement:'českém krumlově',category:'Velká a malá písmena'},spans));
});
test('API transport uses a separate key, preserves model JSON and records usage without credentials', async () => {
  const review = createReview('Řekl že přijde.',options);
  let request;
  const result = await checkWithModel(review,{provider:'openai',key:'test-only-key'},{fetcher:async(url,init)=>{
    request={url,init}; return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:response(review,[edit('Řekl že','Řekl, že','Interpunkce')])}}],usage:{prompt_tokens:100,completion_tokens:80}})};
  }});
  assert.equal(result.corrections.length,1); assert.equal(result.metadata.usage.promptTokens,100);
  assert.equal(request.init.headers.Authorization,'Bearer test-only-key');
  assert(!request.init.body.includes('test-only-key')); assert(!JSON.stringify(result).includes('test-only-key'));
});
test('API credit errors and incomplete answers fail instead of producing a false clean result', async () => {
  const review = createReview('Řekl že přijde.',options);
  await assert.rejects(checkWithModel(review,{provider:'qwen',key:'test'},{fetcher:async()=>({ok:false,status:402})}),/chybí kredit/);
  await assert.rejects(checkWithModel(review,{provider:'openai',key:'test'},{fetcher:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length'}]})})}),/zkrácenou odpověď/);
});
test('A sentence spanning two PDF pages receives one correction with comments on both pages', async () => {
  const doc = new mupdf.PDFDocument(), font = new mupdf.Font('Helvetica'), pdfFont = doc.addSimpleFont(font,'Latin');
  let bytes;
  try {
    for (const text of ['To by','jste chtel.']) {
      const page=doc.addPage([0,0,595,842],0,{Font:{F1:pdfFont}},`BT /F1 18 Tf 40 770 Td (${text}) Tj ET`);
      doc.insertPage(-1,page); page.destroy();
    }
    const buffer=doc.saveToBuffer('compress=yes'); try { bytes=buffer.asUint8Array().slice(); } finally {buffer.destroy();}
  } finally {pdfFont.destroy();font.destroy();doc.destroy();}
  const book=await extractBook(bytes,{useOCR:false});
  const review=createReview(book.text,options);
  const parsed=parseReviewResponse(response(review,[edit('by\njste','byste','Gramatika')]),review,review.jobs[0]);
  const result=await annotateReview(bytes,book,parsed.accepted,{}, {engine:'test'});
  assert.equal(result.corrections.length,1); assert.equal(result.corrections[0].endPage,2);
  const before=openPdf(bytes).doc, after=openPdf(result.pdf).doc;
  try {
    for (let i=0;i<2;i++) {
      const a=before.loadPage(i), b=after.loadPage(i);
      try {
        assert.equal(b.getAnnotations().length,1);
        const x=a.toPixmap(mupdf.Matrix.identity,mupdf.ColorSpace.DeviceRGB,true,false);
        const y=b.toPixmap(mupdf.Matrix.identity,mupdf.ColorSpace.DeviceRGB,true,false);
        try {assert.deepEqual(x.getPixels(),y.getPixels());}finally{x.destroy();y.destroy();}
      }finally{a.destroy();b.destroy();}
    }
    assert.equal(JSON.parse(makeJSON(result)).review.engine,'test');
  }finally{before.destroy();after.destroy();}
});
