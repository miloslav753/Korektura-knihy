import {unpack, scriptURL} from './assets.mjs';

const $ = id => document.getElementById(id);
const assets = JSON.parse($('assets').textContent);
const pending = new Map();
let worker, requestID = 0, selectedFile = null, pages = null, busy = false, result = null, tablePage = 1;
let downloads = [], workerURL;
const pageCount = number => `${number} ${number === 1 ? 'strana' : number >= 2 && number <= 4 ? 'strany' : 'stran'}`;
const message = text => { $('message').textContent = text || ''; $('message').hidden = !text; };
function clearResult() {
  result = null; $('result').hidden = true;
  for (const url of downloads) URL.revokeObjectURL(url);
  downloads = [];
  for (const id of ['download-pdf', 'download-csv', 'download-json']) $(id).removeAttribute('href');
}
function setBusy(value) {
  busy = value;
  for (const node of document.querySelectorAll('[data-setting]')) node.disabled = value;
  $('file').disabled = value; $('unlock').disabled = value;
  $('run').disabled = value || !pages;
  $('dropzone').classList.toggle('disabled', value);
}
function send(type, payload = {}, transfer = []) {
  const id = ++requestID;
  return new Promise((resolve, reject) => {
    pending.set(id, {resolve, reject}); worker.postMessage({type, id, ...payload}, transfer);
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
  if (!file || busy) return;
  clearResult(); message(''); selectedFile = file; pages = null;
  $('settings').hidden = true; $('locked').hidden = true; $('password').value = '';
  $('file-label').textContent = file.name; $('file-help').textContent = 'Načítám PDF…';
  setBusy(true);
  try {
    if (file.size > 150 * 1024 * 1024) throw new Error('PDF je větší než 150 MB. Rozdělte jej na menší části.');
    const bytes = await file.arrayBuffer();
    metadata(await send('inspect', {bytes}, [bytes]));
    $('file-help').textContent = 'Kliknutím vyberete jiný dokument';
  } catch (error) { message(error.message); $('file-help').textContent = 'Vyberte platný soubor PDF'; }
  finally { setBusy(false); }
}
$('file').addEventListener('change', event => selectFile(event.target.files[0]));
$('dropzone').addEventListener('dragover', event => { event.preventDefault(); if (!busy) $('dropzone').classList.add('drag'); });
$('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('drag'));
$('dropzone').addEventListener('drop', event => { event.preventDefault(); $('dropzone').classList.remove('drag'); selectFile(event.dataTransfer.files[0]); });
$('unlock').addEventListener('click', async () => {
  message(''); setBusy(true);
  try { metadata(await send('authenticate', {password: $('password').value})); }
  catch (error) { message(error.message); }
  finally { setBusy(false); }
});
$('password').addEventListener('keydown', event => { if (event.key === 'Enter') $('unlock').click(); });
for (const node of document.querySelectorAll('[data-setting]')) node.addEventListener('input', clearResult);

$('run').addEventListener('click', async () => {
  const firstPage = Number($('first-page').value), lastPage = Number($('last-page').value);
  if (!Number.isInteger(firstPage) || !Number.isInteger(lastPage) || firstPage < 1 || firstPage > lastPage || lastPage > pages) {
    message('Vyberte platný rozsah stran PDF.'); return;
  }
  clearResult(); message(''); setBusy(true);
  $('processing').hidden = false; $('progress').value = 0; $('cancel').disabled = false;
  $('progress-label').textContent = 'Připravuji kontrolu…';
  try {
    const output = await send('process', {options: {
      firstPage, lastPage, password: $('password').value, stylistic: $('stylistic').checked,
      useOCR: $('ocr').checked, ignoredWords: $('ignored').value.split(/[,\s]+/u).filter(Boolean),
    }});
    showResult(output.result);
  } catch (error) { message(error.message); }
  finally { setBusy(false); $('processing').hidden = true; }
});
$('cancel').addEventListener('click', () => {
  worker.postMessage({type: 'cancel'}); $('cancel').disabled = true;
  $('progress-label').textContent = 'Zastavuji kontrolu po dokončení probíhajícího kroku…';
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

try {
  if (!globalThis.WebAssembly || !globalThis.Worker || !globalThis.DecompressionStream) {
    throw new Error('Použijte aktuální Chrome, Edge, Firefox nebo Safari s podporou WebAssembly.');
  }
  workerURL = scriptURL(await unpack(assets.bootstrap));
  worker = new Worker(workerURL, {type: 'module'});
  worker.onerror = event => {
    message('Nástroje pro PDF se nepodařilo spustit. Otevřete soubor v aktuálním prohlížeči.');
    for (const task of pending.values()) task.reject(new Error('Pracovní proces aplikace se zastavil.'));
    pending.clear();
  };
  worker.onmessage = ({data}) => {
    if (data.type === 'status') $('startup').textContent = data.message;
    else if (data.type === 'ready') {
      $('startup').textContent = 'Připraveno. Vyberte své PDF.'; setBusy(false); $('run').disabled = true;
    } else if (data.type === 'boot-error') { $('startup').hidden = true; message(data.message); }
    else if (data.type === 'progress') {
      $('progress').value = Math.min(data.done / data.total, 1);
      $('progress-label').textContent = `Kontroluji stranu ${data.page} · ${data.done}/${data.total} dokončeno`;
    } else if (data.type === 'ocr-status') $('progress-label').textContent = data.message;
    else if (pending.has(data.id)) {
      const task = pending.get(data.id); pending.delete(data.id);
      if (data.type === 'error' || data.type === 'cancelled') task.reject(new Error(data.message)); else task.resolve(data);
    }
  };
  worker.postMessage({type: 'boot', assets});
  $('licenses').textContent = assets.licenses;
} catch (error) { $('startup').hidden = true; message(error.message); }
window.addEventListener('pagehide', () => {
  worker?.terminate(); for (const url of downloads) URL.revokeObjectURL(url); if (workerURL) URL.revokeObjectURL(workerURL);
});
