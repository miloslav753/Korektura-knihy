import {createWorker} from 'tesseract.js';
import {unpack, scriptURL} from './assets.mjs';
import {createChecker} from './proofreading.mjs';
import {openPdf, processPdf, makeCSV, makeJSON} from './pdf-engine.mjs';

const assets = globalThis.__KOREKTURA_ASSETS__;
self.postMessage({type: 'status', message: 'Načítám český slovník…'});
const decoder = new TextDecoder();
const checker = createChecker(decoder.decode(await unpack(assets.aff)), decoder.decode(await unpack(assets.dic)));
let sourceBytes = null, cancelled = false, running = false, ocrWorker = null;
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
      logger: status => self.postMessage({type: 'ocr-status', message: 'Rozpoznávám text stránky…', progress: status.progress}),
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
      if (data.bytes) sourceBytes = data.bytes;
      if (!sourceBytes) throw new Error('Nejprve vyberte PDF.');
      const {doc, pages, locked} = openPdf(sourceBytes, data.password || '', data.type === 'inspect');
      doc.destroy();
      self.postMessage({type: 'metadata', id: data.id, pages, locked});
    } else if (data.type === 'process') {
      if (!sourceBytes) throw new Error('Nejprve vyberte PDF.');
      running = true; cancelled = false;
      const result = await processPdf(sourceBytes, checker, data.options, {
        cancelled: () => cancelled,
        progress: status => self.postMessage({type: 'progress', ...status}),
        ocr: recognize,
      });
      const csv = makeCSV(result), json = makeJSON(result);
      self.postMessage({type: 'result', id: data.id, result: {...result, csv, json}}, [result.pdf.buffer]);
    }
  } catch (error) {
    self.postMessage({type: error.message === 'CANCELLED' ? 'cancelled' : 'error', id: data.id,
      message: error.message === 'CANCELLED' ? 'Kontrola byla zastavena. Žádný částečný výsledek nebyl uložen.' : error.message});
  } finally {
    if (data.type === 'process') {
      running = false;
      if (ocrWorker) { await ocrWorker.terminate(); ocrWorker = null; }
      for (const url of ocrURLs) URL.revokeObjectURL(url);
      ocrURLs = [];
    }
  }
};
self.postMessage({type: 'ready'});
