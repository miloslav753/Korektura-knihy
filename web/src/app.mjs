import {unpack, scriptURL} from './assets.mjs';
import {WorkerClient} from './worker-client.mjs';

const $ = id => document.getElementById(id);
const assets = JSON.parse($('assets').textContent);
let client, engineReady, initializing = true, engineAvailable = false, selectedFile = null, pages = null,
  busy = false, result = null, tablePage = 1, operation = null, started = 0, reader = null, operationCancelled = false;
let downloads = [], workerURL;
let manualReview = null;
const pageCount = number => `${number} ${number === 1 ? 'strana' : number >= 2 && number <= 4 ? 'strany' : 'stran'}`;
const message = text => { $('message').textContent = text || ''; $('message').hidden = !text; };
function clearResult(clearManual = true) {
  result = null; $('result').hidden = true;
  for (const url of downloads) URL.revokeObjectURL(url);
  downloads = [];
  for (const id of ['download-pdf', 'download-csv', 'download-json']) $(id).removeAttribute('href');
  if (clearManual) { manualReview = null; $('manual-review').hidden = true; }
}
function setBusy(value) {
  busy = value;
  for (const node of document.querySelectorAll('[data-setting]')) node.disabled = value;
  $('file').disabled = value || !engineAvailable; $('unlock').disabled = value || !engineAvailable;
  $('run').disabled = value || !pages || !engineAvailable;
  $('dropzone').classList.toggle('disabled', value || !engineAvailable);
  for (const id of ['review-block','copy-prompt','import-response']) $(id).disabled = value;
  $('finish-review').disabled = value || !manualReview || manualReview.completed.size !== manualReview.jobs.length;
}
function modeSettings() {
  const mode = $('mode').value;
  $('api-settings').hidden = mode !== 'online';
  $('mode-help').textContent = mode === 'plus' ? 'Plus nemá API. Připravíme zadání pro váš ChatGPT; odpovědi vložíte zpět. Předplatné použijete na webu ChatGPT.'
    : mode === 'online' ? 'Model zkontroluje text automaticky po blocích. Potřebujete API klíč vybraného poskytovatele a jeho samostatné účtování.'
      : 'Slovník a základní pravidla běží bez internetu. Tento režim neposuzuje úplnou gramatiku ani smysl vět.';
  $('privacy').textContent = mode === 'online' ? 'PDF a heslo zůstávají v prohlížeči. Text vybraných stran a okolní kontext se odesílají vybranému poskytovateli modelu.'
    : mode === 'plus' ? 'PDF zůstává v prohlížeči. Textové bloky předáte ChatGPT ručně; zpracování se řídí nastavením vašeho účtu ChatGPT.'
      : 'PDF ani text se neodesílají na server. Základní kontrola i OCR fungují bez internetu.';
}
$('mode').addEventListener('change', () => { if ($('mode').value === 'rules') $('stylistic').checked = false; modeSettings(); });
modeSettings();
async function send(type, payload = {}, transfer = []) {
  const current = await engineReady;
  if (operationCancelled) throw new Error('Zpracování bylo zastaveno. Vyberte PDF znovu.');
  return current.request(type, payload, transfer);
}
function activity(type, label) {
  operation = type; operationCancelled = false; started = performance.now(); setBusy(true);
  $('processing').hidden = false; $('cancel').disabled = false;
  $('ocr-progress').hidden = true; $('elapsed').textContent = 'Uplynulo 0 s';
  progress(label);
}
function progress(label, fraction = null) {
  $('progress-label').textContent = label;
  if (fraction === null) $('progress').removeAttribute('value');
  else $('progress').value = Math.max(0, Math.min(fraction, 1));
  $('progress-percent').textContent = fraction === null ? '' : `${Math.round(fraction * 100)} %`;
}
function finishActivity() {
  operation = null; $('processing').hidden = true; setBusy(false);
}
function readFile(file) {
  return new Promise((resolve, reject) => {
    let timer;
    const watch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        reject(new Error('Čtení souboru z disku se zastavilo. Uložte PDF přímo do počítače a zkuste jej vybrat znovu.'));
        reader?.abort();
      }, 120000);
    };
    reader = new FileReader();
    reader.onprogress = event => {
      watch();
      const size = value => (value / (1024 * 1024)).toFixed(1);
      progress(`Načítám PDF z disku: ${size(event.loaded)} / ${size(file.size)} MB`,
        event.lengthComputable ? event.loaded / event.total : null);
    };
    reader.onload = () => { clearTimeout(timer); const bytes = reader.result; reader = null; resolve(bytes); };
    reader.onerror = () => { clearTimeout(timer); reader = null; reject(new Error('Soubor nelze přečíst z disku. Stáhněte jej do počítače a vyberte znovu.')); };
    reader.onabort = () => { clearTimeout(timer); reader = null; reject(new Error('Načítání bylo zastaveno. Vyberte PDF znovu.')); };
    watch();
    reader.readAsArrayBuffer(file);
  });
}
function metadata(info) {
  pages = info.pages;
  $('locked').hidden = !info.locked; $('settings').hidden = info.locked;
  if (!info.locked) {
    $('first-page').value = 1; $('last-page').value = pages;
    $('first-page').max = pages; $('last-page').max = pages;
    $('metadata').textContent = `${selectedFile.name} · ${pageCount(pages)} · ${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB`;
  }
}
async function selectFile(file) {
  if (!file || operation || (busy && !initializing)) return;
  clearResult(); message(''); selectedFile = file; pages = null;
  $('settings').hidden = true; $('locked').hidden = true; $('password').value = '';
  $('file-label').textContent = file.name; $('file-help').textContent = 'Načítám PDF…';
  activity('load', initializing ? 'Připravuji nástroje. PDF načtu hned poté…' : 'Načítám PDF z disku…');
  try {
    if (file.size > 150 * 1024 * 1024) throw new Error('PDF je větší než 150 MB. Rozdělte jej na menší části.');
    await engineReady;
    if (operationCancelled) throw new Error('Načítání bylo zastaveno. Vyberte PDF znovu.');
    const bytes = await readFile(file);
    progress('Otevírám PDF a zjišťuji počet stran…');
    metadata(await send('inspect', {bytes}, [bytes]));
    $('file-help').textContent = pages ? 'PDF načteno. Klikněte na Spustit korekturu níže.' : 'PDF načteno. Zadejte heslo níže.';
    (pages ? $('run') : $('password')).scrollIntoView({behavior: 'smooth', block: 'center'});
  } catch (error) { message(error.message); $('file-help').textContent = 'Vyberte platný soubor PDF'; }
  finally { finishActivity(); }
}
$('file').addEventListener('change', event => selectFile(event.target.files[0]));
$('dropzone').addEventListener('dragover', event => { event.preventDefault(); if (!busy) $('dropzone').classList.add('drag'); });
$('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('drag'));
$('dropzone').addEventListener('drop', event => { event.preventDefault(); $('dropzone').classList.remove('drag'); selectFile(event.dataTransfer.files[0]); });
$('unlock').addEventListener('click', async () => {
  message(''); activity('unlock', 'Odemknu PDF a zjišťuji počet stran…');
  try { metadata(await send('authenticate', {password: $('password').value})); }
  catch (error) { message(error.message); }
  finally { finishActivity(); }
});
$('password').addEventListener('keydown', event => { if (event.key === 'Enter') $('unlock').click(); });
for (const node of document.querySelectorAll('[data-setting]')) node.addEventListener('input', clearResult);

$('run').addEventListener('click', async () => {
  const firstPage = Number($('first-page').value), lastPage = Number($('last-page').value);
  if (!Number.isInteger(firstPage) || !Number.isInteger(lastPage) || firstPage < 1 || firstPage > lastPage || lastPage > pages) {
    message('Vyberte platný rozsah stran PDF.'); return;
  }
  if ($('mode').value === 'online' && !$('api-key').value.trim()) { message('Zadejte API klíč vybraného poskytovatele. ChatGPT Plus automatický přístup přes API nezahrnuje.'); return; }
  clearResult(); message(''); activity('process', 'Připravuji kontrolu…');
  try {
    const output = await send($('mode').value === 'plus' ? 'prepare-review' : 'process', {options: {
      firstPage, lastPage, password: $('password').value, stylistic: $('stylistic').checked,
      semantic: $('semantic').checked, mode: $('mode').value,
      api: $('mode').value === 'online' ? {provider:$('provider').value,key:$('api-key').value} : undefined,
      useOCR: $('ocr').checked, ignoredWords: $('ignored').value.split(/[,;\n]+/u).map(value=>value.trim()).filter(Boolean),
    }});
    if (output.type === 'review-prepared') showManualReview(output); else showResult(output.result);
  } catch (error) { message(error.message); }
  finally { finishActivity(); }
});
function showManualReview(output) {
  manualReview = {...output,completed:new Set()};
  $('manual-review').hidden = false; $('review-block').replaceChildren();
  output.jobs.forEach((job,index) => $('review-block').append(new Option(`Blok ${index+1} z ${output.jobs.length}`,job.id)));
  $('import-notice').textContent = output.warnings.join(' ');
  reviewStatus(); showReviewBlock(); $('manual-review').scrollIntoView({behavior:'smooth',block:'start'});
}
function reviewStatus() {
  $('review-status').textContent = `Zkontrolováno ${manualReview.completed.size}/${manualReview.jobs.length} bloků · ${pageCount(manualReview.checkedPages)} připraveno`;
  $('finish-review').disabled = busy || manualReview.completed.size !== manualReview.jobs.length;
  for (const option of $('review-block').options) {
    const index = manualReview.jobs.findIndex(job=>job.id===option.value);
    option.textContent = `Blok ${index+1} z ${manualReview.jobs.length}${manualReview.completed.has(option.value)?' · hotovo':''}`;
  }
}
function showReviewBlock() {
  const job = manualReview.jobs.find(item=>item.id===$('review-block').value);
  $('review-prompt').value = job.prompt; $('review-response').value = '';
}
$('review-block').addEventListener('change', showReviewBlock);
$('copy-prompt').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('review-prompt').value); $('import-notice').textContent = 'Zadání zkopírováno. Vložte jej do ChatGPT.'; }
  catch { $('review-prompt').focus(); $('review-prompt').select(); $('import-notice').textContent = 'Zadání je označené. Zkopírujte ho pomocí Ctrl+C.'; }
});
$('import-response').addEventListener('click', async () => {
  if (!manualReview || !$('review-response').value.trim()) { message('Vložte celou JSON odpověď ChatGPT pro vybraný blok.'); return; }
  message(''); activity('import','Ověřuji návrhy proti původnímu textu…');
  try {
    const output = await send('import-review',{jobID:$('review-block').value,content:$('review-response').value});
    clearResult(false); manualReview.completed.add(output.jobID); reviewStatus();
    $('import-notice').textContent = `Přijato ${output.accepted} návrhů; odmítnuto ${output.rejected}. Odmítnuté návrhy měnily chráněný text, neměly jednoznačné místo nebo nesplnily formát.`;
    const next = manualReview.jobs.find(job=>!manualReview.completed.has(job.id));
    if (next) { $('review-block').value = next.id; showReviewBlock(); }
  } catch (error) { message(error.message); }
  finally { finishActivity(); }
});
$('finish-review').addEventListener('click', async () => {
  clearResult(false); message(''); activity('process','Vytvářím PDF z ověřených korektur…');
  try { showResult((await send('export-review')).result); }
  catch (error) { message(error.message); }
  finally { finishActivity(); }
});
$('cancel').addEventListener('click', () => {
  operationCancelled = true; $('cancel').disabled = true;
  const stopped = 'Zpracování bylo zastaveno. Obnovte aplikaci a vyberte PDF znovu.';
  reader?.abort(); client?.close(stopped);
  if (client) failure(new Error(stopped));
  else message('Načítání bylo zastaveno. Vyberte PDF znovu po dokončení přípravy.');
});

function makeDownload(id, content, mime, filename) {
  const url = URL.createObjectURL(new Blob([content], {type: mime}));
  downloads.push(url); $(id).href = url; $(id).download = filename;
}
function showResult(output) {
  result = output; tablePage = 1;
  $('result').hidden = false;
  $('complete').textContent = result.checkedPages
    ? `Kontrola dokončena: ${pageCount(result.checkedPages)}. Původní text a sazba byly zachovány.`
    : 'Žádnou stránku nebylo možné jazykově zkontrolovat. Výstup není potvrzením bezchybnosti textu.';
  $('complete').classList.toggle('warning', !result.checkedPages);
  $('count-total').textContent = result.corrections.length; $('count-style').textContent = result.counts.Stylistika || 0;
  $('count-pages').textContent = result.checkedPages; $('count-ocr').textContent = result.ocrPages.length;
  $('warnings').replaceChildren();
  for (const warning of result.warnings.slice(0, 20)) {
    const notice = document.createElement('p'); notice.className = 'status warning'; notice.textContent = warning; $('warnings').append(notice);
  }
  if (result.warnings.length > 20) {
    const note = document.createElement('p'); note.textContent = 'Další upozornění jsou uvedena v JSON exportu.'; $('warnings').append(note);
  }
  const stem = selectedFile.name.replace(/\.pdf$/iu, '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\w .-]/gu, '_').slice(0, 100) || 'kniha';
  makeDownload('download-pdf', result.pdf, 'application/pdf', `${stem}_korektury.pdf`);
  makeDownload('download-csv', result.csv, 'text/csv;charset=utf-8', `${stem}_korektury.csv`);
  makeDownload('download-json', result.json, 'application/json;charset=utf-8', `${stem}_korektury.json`);
  $('counts').replaceChildren(); $('category').replaceChildren(new Option('Všechny', 'Všechny'));
  for (const [category, count] of Object.entries(result.counts)) {
    const badge = document.createElement('span'); badge.textContent = `${category}: ${count}`; $('counts').append(badge);
    $('category').append(new Option(category, category));
  }
  $('search').value = '';
  $('listing').hidden = !result.corrections.length; $('no-findings').hidden = !result.checkedPages || !!result.corrections.length;
  renderTable(); $('result').scrollIntoView({behavior: 'smooth', block: 'start'});
}
function renderTable() {
  if (!result) return;
  const category = $('category').value, search = $('search').value.toLocaleLowerCase('cs');
  const filtered = result.corrections.filter(item => (category === 'Všechny' || item.category === category)
    && `${item.original} ${item.replacement} ${item.message}`.toLocaleLowerCase('cs').includes(search));
  const totalPages = Math.max(1, Math.ceil(filtered.length / 50));
  tablePage = Math.min(tablePage, totalPages);
  $('rows').replaceChildren();
  for (const item of filtered.slice((tablePage - 1) * 50, tablePage * 50)) {
    const row = document.createElement('tr');
    for (const value of [item.id, item.page, item.category, item.original, item.replacement, item.message, item.source]) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    $('rows').append(row);
  }
  $('pagination').textContent = `Stránka ${tablePage} z ${totalPages} · ${filtered.length} nálezů`;
  $('previous').disabled = tablePage <= 1; $('next').disabled = tablePage >= totalPages;
}
for (const id of ['category', 'search']) $(id).addEventListener('input', () => { tablePage = 1; renderTable(); });
$('previous').addEventListener('click', () => { tablePage--; renderTable(); });
$('next').addEventListener('click', () => { tablePage++; renderTable(); });
$('download-source').addEventListener('click', async () => {
  const button = $('download-source'); button.disabled = true;
  try {
    const bytes = await unpack(assets.sources);
    const url = URL.createObjectURL(new Blob([bytes], {type: 'application/zip'}));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Korektura-knihy-zdrojovy-kod.zip';
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) { message(error.message); }
  finally { button.disabled = false; }
});

function failure(error) {
  engineAvailable = false; pages = null; clearResult();
  $('settings').hidden = true; $('locked').hidden = true;
  $('startup-progress').hidden = true; $('startup').hidden = true;
  $('retry').hidden = false; $('retry').disabled = false;
  message(error.message); setBusy(busy);
}
async function initialize() {
  initializing = true; engineAvailable = false; setBusy(true);
  $('startup').hidden = false; $('startup').textContent = 'Připravuji aplikaci pro váš prohlížeč…';
  $('startup-progress').hidden = false; $('retry').hidden = true;
  const bootStart = performance.now();
  const bootClock = setInterval(() => { $('startup-time').textContent = `Příprava: ${Math.floor((performance.now() - bootStart) / 1000)} s`; }, 1000);
  try {
  if (!globalThis.WebAssembly || !globalThis.Worker || !globalThis.DecompressionStream) {
    throw new Error('Použijte aktuální Chrome, Edge, Firefox nebo Safari s podporou WebAssembly.');
  }
  if (workerURL) URL.revokeObjectURL(workerURL);
  workerURL = scriptURL(await unpack(assets.bootstrap));
  client = new WorkerClient(new Worker(workerURL), assets, {onFailure: failure, onEvent: data => {
    if (data.type === 'status') $('startup').textContent = data.message;
    else if (data.type === 'ready') {
      $('startup').textContent = 'Připraveno. Vyberte své PDF.';
    } else if (data.type === 'inspect-status' && operation === 'load') progress(data.message);
    else if (data.type === 'progress' && operation === 'process') {
      if (data.stage === 'model') { $('ocr-progress').hidden = true; progress(data.message,data.done/data.total); return; }
      if (data.stage !== 'ocr') $('ocr-progress').hidden = true;
      const label = data.stage === 'save' ? 'Ukládám PDF s korekturami…'
        : `${data.message || 'Kontroluji'} stranu ${data.page} · ${data.done}/${data.total} dokončeno`;
      progress(label, data.stage === 'save' ? null : (data.done + (data.fraction || 0)) / data.total);
    } else if (data.type === 'ocr-status' && operation === 'process') {
      $('ocr-label').textContent = data.message; $('ocr-progress').hidden = false;
      if (Number.isFinite(data.progress)) $('ocr-bar').value = data.progress;
      else $('ocr-bar').removeAttribute('value');
    }
  }});
  await client.ready;
  engineAvailable = true; $('startup-progress').hidden = true;
  $('licenses').textContent = assets.licenses;
  return client;
  } catch (error) { failure(error); throw error; }
  finally { clearInterval(bootClock); initializing = false; setBusy(!!operation); }
}
$('retry').addEventListener('click', () => {
  if (operation) return;
  client?.close(); selectedFile = null; pages = null; $('file').value = '';
  $('file-label').textContent = 'Vyberte PDF z počítače'; $('file-help').textContent = 'Klikněte nebo soubor přetáhněte sem · nejvýše 150 MB';
  message(''); engineReady = initialize(); engineReady.catch(() => {});
});
const clock = setInterval(() => {
  if (operation) $('elapsed').textContent = `Uplynulo ${Math.floor((performance.now() - started) / 1000)} s`;
}, 1000);
engineReady = initialize(); engineReady.catch(() => {});
window.addEventListener('pagehide', () => {
  $('api-key').value = '';
  clearInterval(clock); client?.close(); for (const url of downloads) URL.revokeObjectURL(url); if (workerURL) URL.revokeObjectURL(workerURL);
});
