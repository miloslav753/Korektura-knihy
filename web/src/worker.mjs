import {createWorker} from 'tesseract.js';
import {unpack, scriptURL} from './assets.mjs';
import {createChecker} from './proofreading.mjs';
import {openPdf, processPdf, extractBook, annotateReview, makeCSV, makeJSON} from './pdf-engine.mjs';
import {createReview, reviewPrompt, parseReviewResponse} from './review-format.mjs';
import {checkWithModel} from './model-api.mjs';

const assets = globalThis.__KOREKTURA_ASSETS__;
self.postMessage({type: 'status', message: 'Načítám český slovník…'});
const decoder = new TextDecoder();
const checker = createChecker(decoder.decode(await unpack(assets.aff)), decoder.decode(await unpack(assets.dic)));
let sourceBytes = null, cancelled = false, running = false, ocrWorker = null;
let manual = null;
let ocrURLs = [];

async function recognize(image) {
  if (!ocrWorker) {
    self.postMessage({type: 'ocr-status', message: 'Načítám české OCR…'});
    const originalWorkerPath = scriptURL(await unpack(assets.ocrWorker));
    const corePath = scriptURL(await unpack(assets.ocrCore), '#tesseract-core-lstm.wasm.js');
    const model = await unpack(assets.ocrModel);
    let binary = '';
    for (let index = 0; index < model.length; index += 32768) binary += String.fromCharCode(...model.subarray(index, index + 32768));
    // Tesseract's public string-language API expects a fetchable model. Serve
    // the bundled bytes inside its worker; no HTTP request or cache is involved.
    const wrapper = `const model=${JSON.stringify(btoa(binary))};
      const nativeFetch=self.fetch.bind(self);
      self.fetch=async (url,options)=>{
        if(String(url)==='korektura://local/ces.traineddata')
          return new Response(Uint8Array.from(atob(model),c=>c.charCodeAt(0)));
        if(String(url).startsWith('blob:')||String(url).startsWith('data:')) return nativeFetch(url,options);
        throw new Error('OCR se nesmí připojovat k externím službám.');
      };
      importScripts(${JSON.stringify(originalWorkerPath)});`;
    const workerPath = scriptURL(new TextEncoder().encode(wrapper));
    ocrURLs = [workerPath, originalWorkerPath, corePath.split('#')[0]];
    ocrWorker = await createWorker('ces', 1, {
      workerPath, corePath, langPath: 'korektura://local', workerBlobURL: false, gzip: false, cacheMethod: 'none',
      errorHandler: () => {},
      logger: status => self.postMessage({type: 'ocr-status',
        message: status.status === 'recognizing text' ? 'Rozpoznávám text aktuální strany…' : 'Připravuji české OCR…', progress: status.progress}),
    });
  }
  const result = await ocrWorker.recognize(image, {}, {text: true, tsv: true});
  return result.data.tsv;
}

self.onmessage = async ({data}) => {
  if (data.type === 'cancel') { cancelled = true; return; }
  if (running) { self.postMessage({type: 'error', id: data.id, message: 'Nejdříve dokončete nebo zastavte probíhající kontrolu.'}); return; }
  try {
    if (data.type === 'inspect' || data.type === 'authenticate') {
      if (data.bytes) { sourceBytes = data.bytes; manual = null; }
      if (!sourceBytes) throw new Error('Nejprve vyberte PDF.');
      self.postMessage({type: 'inspect-status', message: 'Otevírám PDF a zjišťuji počet stran…'});
      const {doc, pages, locked} = openPdf(sourceBytes, data.password || '', data.type === 'inspect');
      doc.destroy();
      self.postMessage({type: 'metadata', id: data.id, pages, locked});
    } else if (data.type === 'process' || data.type === 'prepare-review') {
      if (!sourceBytes) throw new Error('Nejprve vyberte PDF.');
      running = true; cancelled = false;
      const hooks = {
        cancelled: () => cancelled,
        progress: status => self.postMessage({type: 'progress', ...status}),
        ocr: recognize,
      };
      let result;
      if (data.type === 'prepare-review' || data.options.mode === 'online') {
        const options = {firstPage:data.options.firstPage, lastPage:data.options.lastPage, password:data.options.password,
          stylistic:data.options.stylistic, semantic:data.options.semantic, useOCR:data.options.useOCR, ignoredWords:data.options.ignoredWords};
        const book = await extractBook(sourceBytes, options, hooks);
        const review = createReview(book.text, {...options, isKnown:checker.correct});
        if (data.type === 'prepare-review') {
          manual = {book, review, options, responses: new Map()};
          self.postMessage({type:'review-prepared',id:data.id,bookID:review.bookID,
            jobs:review.jobs.map(job => ({id:job.id,prompt:reviewPrompt(job,options)})),
            checkedPages:book.checkedPages,warnings:book.warnings});
          return;
        }
        const reviewed = await checkWithModel(review, data.options.api, hooks);
        result = await annotateReview(sourceBytes, book, reviewed.corrections, options, reviewed.metadata, hooks);
      } else result = await processPdf(sourceBytes, checker, data.options, hooks);
      const csv = makeCSV(result), json = makeJSON(result);
      self.postMessage({type: 'result', id: data.id, result: {...result, csv, json}}, [result.pdf.buffer]);
    } else if (data.type === 'import-review') {
      if (!manual) throw new Error('Nejprve připravte bloky této knihy pro ChatGPT.');
      const job = manual.review.jobs.find(item => item.id === data.jobID);
      if (!job) throw new Error('Neznámý blok korektury.');
      const parsed = parseReviewResponse(data.content, manual.review, job);
      manual.responses.set(job.id, parsed);
      self.postMessage({type:'review-imported',id:data.id,jobID:job.id,accepted:parsed.accepted.length,rejected:parsed.rejected.length,
        completed:manual.responses.size,total:manual.review.jobs.length});
    } else if (data.type === 'export-review') {
      if (!manual || manual.responses.size !== manual.review.jobs.length) throw new Error('Nejprve vložte odpověď pro každý blok. Chybějící bloky nejsou zkontrolované.');
      running = true; cancelled = false;
      const corrections = manual.review.jobs.flatMap(job => manual.responses.get(job.id).accepted).sort((a,b) => a.start-b.start);
      const rejected = [...manual.responses.values()].reduce((sum,item) => sum+item.rejected.length,0);
      const hooks = {cancelled:()=>cancelled,progress:status=>self.postMessage({type:'progress',...status})};
      const result = await annotateReview(sourceBytes,manual.book,corrections,manual.options,
        {engine:'ChatGPT – ruční přenos',completedBlocks:manual.responses.size,totalBlocks:manual.review.jobs.length,
          warnings:rejected?[`${rejected} návrhů modelu bylo odmítnuto kvůli nejednoznačnému místu nebo změně chráněného textu.`]:[]},hooks);
      self.postMessage({type:'result',id:data.id,result:{...result,csv:makeCSV(result),json:makeJSON(result)}},[result.pdf.buffer]);
    }
  } catch (error) {
    self.postMessage({type: error.message === 'CANCELLED' ? 'cancelled' : 'error', id: data.id,
      message: error.message === 'CANCELLED' ? 'Kontrola byla zastavena. Žádný částečný výsledek nebyl uložen.' : error.message});
  } finally {
    if (['process','prepare-review','export-review'].includes(data.type)) {
      running = false;
      if (ocrWorker) { await ocrWorker.terminate(); ocrWorker = null; }
      for (const url of ocrURLs) URL.revokeObjectURL(url);
      ocrURLs = [];
    }
  }
};
self.postMessage({type: 'ready'});
