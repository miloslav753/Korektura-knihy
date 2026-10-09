import * as mupdf from 'mupdf';

export const colors = {Pravopis: [1, .65, .15], Gramatika: [1, .35, .35],
  Interpunkce: [.3, .65, 1], Typografie: [.25, .75, .55], Stylistika: [.7, .45, 1]};
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

export function openPdf(bytes, password = '', allowLocked = false) {
  if (bytes.byteLength > 150 * 1024 * 1024) throw new Error('PDF je větší než 150 MB. Rozdělte jej na menší části.');
  let doc;
  try { doc = mupdf.Document.openDocument(bytes, 'application/pdf'); }
  catch { throw new Error('Soubor se nepodařilo přečíst jako PDF.'); }
  try {
    if (!doc.isPDF()) throw new Error('Vyberte soubor ve formátu PDF.');
    if (doc.needsPassword() && !doc.authenticatePassword(password)) {
      if (allowLocked) return {doc, locked: true, pages: null};
      throw new Error('PDF je chráněno heslem. Zadejte správné heslo.');
    }
    const pages = doc.countPages();
    if (!pages || pages > 10000) throw new Error('PDF musí obsahovat 1 až 10 000 stran.');
    return {doc, pages, locked: false};
  } catch (error) { doc.destroy(); throw error; }
}

export function extractPage(page) {
  let text = '', line = -1, hasImages = false;
  const positions = [];
  const structured = page.toStructuredText('preserve-whitespace,preserve-images');
  try {
    structured.walk({
      beginLine() { line++; },
      onChar(char, origin, font, size, quad) {
        text += char;
        for (let index = 0; index < char.length; index++) positions.push({quad: [...quad], line});
      },
      endLine() { text += '\n'; positions.push(null); },
      endTextBlock() { text += '\n'; positions.push(null); },
      onImageBlock() { hasImages = true; },
    });
  } finally { structured.destroy(); }
  const remove = new Set();
  for (const match of text.matchAll(/\p{L}[-\u00ad]\n(?=\p{Ll})/gu)) {
    remove.add(match.index + match[0].length - 2);
    remove.add(match.index + match[0].length - 1);
  }
  let joined = '';
  const mapped = [];
  for (let index = 0; index < text.length; index++) if (!remove.has(index)) {
    joined += text[index]; mapped.push(positions[index]);
  }
  return {text: joined, positions: mapped, hasImages};
}

export async function checkPage(text, checker, options, cancelled, onProgress = () => {}) {
  const found = new Map();
  let start = 0;
  while (start < text.length) {
    if (cancelled()) throw new Error('CANCELLED');
    let end = Math.min(start + 6000, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(' ', end);
      if (boundary >= start + 5000) end = boundary;
      else while (end < text.length && !/\s/u.test(text[end])) end++;
    }
    for (const item of checker.check(text.slice(start, end), options)) {
      const absolute = {...item, start: item.start + start, end: item.end + start};
      found.set(`${absolute.start}:${absolute.end}:${absolute.category}`, absolute);
    }
    onProgress(end / text.length);
    if (end === text.length) break;
    start = Math.max(start + 1, end - 200);
    while (start < end && !/\s/u.test(text[start - 1])) start++;
    await pause();
  }
  const ordered = [...found.values()].sort((a, b) => a.start - b.start || b.end - a.end);
  const unique = [];
  for (const item of ordered) if (!unique.length || item.start >= unique.at(-1).end) unique.push(item);
  return unique;
}

function findingQuads(positions, item) {
  const lines = new Map();
  for (const position of positions.slice(item.start, item.end)) {
    if (!position) continue;
    if (!lines.has(position.line)) lines.set(position.line, {first: position.quad, last: position.quad});
    else lines.get(position.line).last = position.quad;
  }
  return [...lines.values()].map(({first, last}) =>
    [first[0], first[1], last[2], last[3], first[4], first[5], last[6], last[7]]);
}

export function rasterize(page) {
  const bounds = page.getBounds(), width = bounds[2] - bounds[0], height = bounds[3] - bounds[1];
  const scale = Math.min(2.8, Math.sqrt(20_000_000 / (width * height)));
  const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, false);
  try { return {image: pixmap.asPNG().slice(), scale, bounds}; }
  finally { pixmap.destroy(); }
}

export function extractOCR(tsv, scale, bounds) {
  const lines = tsv.trimEnd().split('\n');
  // TessBaseAPI returns TSV rows without the header added by the native CLI.
  const header = lines[0].startsWith('level\t') ? lines.shift().split('\t')
    : ['level', 'page_num', 'block_num', 'par_num', 'line_num', 'word_num', 'left', 'top', 'width', 'height', 'conf', 'text'];
  if (!header.includes('level') || !header.includes('text')) throw new Error('OCR nevrátilo polohy slov.');
  let text = '', previous = '', line = -1;
  const positions = [];
  for (const row of lines) {
    const values = row.split('\t');
    const entry = Object.fromEntries(header.map((name, index) => [name, values[index]]));
    const word = (entry.text || '').trim();
    if (entry.level !== '5' || !word) continue;
    const key = `${entry.block_num}:${entry.par_num}:${entry.line_num}`;
    if (text) { text += key === previous ? ' ' : '\n'; positions.push(null); }
    if (key !== previous) line++;
    previous = key;
    const left = Number(entry.left) / scale + bounds[0], top = Number(entry.top) / scale + bounds[1];
    const right = left + Number(entry.width) / scale, bottom = top + Number(entry.height) / scale;
    const quad = [left, top, right, top, left, bottom, right, bottom];
    text += word;
    for (let index = 0; index < word.length; index++) positions.push({quad, line});
  }
  return {text, positions};
}

export async function processPdf(bytes, checker, options, {progress = () => {}, ocr, cancelled = () => false} = {}) {
  const opened = openPdf(bytes, options.password);
  const doc = opened.doc;
  const first = options.firstPage || 1, last = options.lastPage || opened.pages;
  const corrections = [], warnings = [], ocrPages = [], skippedPages = [];
  let checkedPages = 0;
  try {
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || first > last || last > opened.pages) {
      throw new Error('Vyberte platný rozsah stran PDF.');
    }
    for (let index = first - 1; index < last; index++) {
      if (cancelled()) throw new Error('CANCELLED');
      const status = {done: index - first + 1, total: last - first + 1, page: index + 1};
      progress({...status, message: 'Načítám', stage: 'page'});
      const page = doc.loadPage(index);
      try {
        let {text, positions, hasImages} = extractPage(page);
        let source = 'Text PDF';
        if (text.trim().length < 30 && (hasImages || !text.trim())) {
          if (options.useOCR && ocr) {
            progress({...status, message: 'Rozpoznávám text na', stage: 'ocr'});
            const raster = rasterize(page);
            const tsv = await ocr(raster.image);
            ({text, positions} = extractOCR(tsv, raster.scale, raster.bounds));
            source = 'OCR'; ocrPages.push(index + 1);
          } else if (hasImages) {
            skippedPages.push(index + 1);
            warnings.push(`Strana ${index + 1}: sken bez textu, nebyla zkontrolována. Zapněte OCR.`);
            continue;
          }
        }
        if (!text.trim()) {
          skippedPages.push(index + 1); warnings.push(`Strana ${index + 1}: nebyl nalezen text ke kontrole.`); continue;
        }
        checkedPages++;
        progress({...status, message: 'Kontroluji text na', stage: 'text'});
        for (const finding of await checkPage(text, checker, options, cancelled,
          fraction => progress({...status, message: 'Kontroluji text na', stage: 'text', fraction: fraction * .9}))) {
          const quads = findingQuads(positions, finding);
          if (!quads.length) throw new Error(`Nález na straně ${index + 1} nelze přiřadit k místu v PDF.`);
          if (corrections.length >= 50000) throw new Error('Více než 50 000 nálezů. Zpracujte menší rozsah stran.');
          const correction = {id: corrections.length + 1, page: index + 1, ...finding, source};
          const annotation = page.createAnnotation('Highlight');
          try {
            annotation.setQuadPoints(quads);
            annotation.setColor(colors[finding.category]);
            annotation.setOpacity(.35);
            annotation.setAuthor('Korektura knihy');
            annotation.setSubject(finding.category);
            annotation.setLanguage('cs');
            const proposal = finding.replacement || (finding.category === 'Pravopis' ? '(bez návrhu; ověřte slovo)' : '(odstranit)');
            annotation.setContents(`#${correction.id} · ${finding.category}\nPůvodní: ${finding.original}\nNávrh: ${proposal}\n${finding.message}`);
            annotation.update();
          } finally { annotation.destroy(); }
          corrections.push(correction);
        }
      } finally {
        page.destroy();
        progress({done: index - first + 2, total: last - first + 1, page: index + 1, stage: 'page'});
      }
      await pause();
    }
    if (cancelled()) throw new Error('CANCELLED');
    progress({done: last - first + 1, total: last - first + 1, page: last, stage: 'save'});
    const buffer = doc.saveToBuffer('compress=yes,garbage=0,encrypt=keep');
    let pdf;
    try { pdf = buffer.asUint8Array().slice(); } finally { buffer.destroy(); }
    const counts = corrections.reduce((counts, item) => ({...counts, [item.category]: (counts[item.category] || 0) + 1}), {});
    return {pdf, corrections, counts, checkedPages, totalPages: opened.pages, ocrPages, skippedPages, warnings,
      selectedPages: [first, last]};
  } finally { doc.destroy(); }
}

export function makeCSV(result) {
  const escape = value => {
    let text = String(value);
    if (/^[=+\-@]/u.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [['Číslo', 'Strana', 'Kategorie', 'Původní text', 'Návrh opravy', 'Komentář', 'Zdroj'],
    ...result.corrections.map(item => [item.id, item.page, item.category, item.original, item.replacement, item.message, item.source])];
  return '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n') + '\r\n';
}

export function makeJSON({pdf, ...details}) { return JSON.stringify(details, null, 2); }
