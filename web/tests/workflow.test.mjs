import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as mupdf from 'mupdf';
import {createChecker} from '../src/proofreading.mjs';
import {openPdf, extractPage, processPdf, checkPage, makeCSV, makeJSON} from '../src/pdf-engine.mjs';

const checker = createChecker(fs.readFileSync(new URL('../../data/cs_CZ/cs_CZ.aff', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('../../data/cs_CZ/cs_CZ.dic', import.meta.url), 'utf8'));
function makePdf(texts, rotation = 0) {
  const doc = new mupdf.PDFDocument();
  const font = new mupdf.Font('Helvetica');
  const pdfFont = doc.addSimpleFont(font, 'Latin');
  try {
    for (const text of texts) {
      const page = doc.addPage([0, 0, 595, 842], rotation, {Font: {F1: pdfFont}}, `BT /F1 18 Tf 40 770 Td (${text}) Tj ET`);
      doc.insertPage(-1, page); page.destroy();
    }
    const buffer = doc.saveToBuffer('compress=yes');
    try { return buffer.asUint8Array().slice(); } finally { buffer.destroy(); }
  } finally { pdfFont.destroy(); font.destroy(); doc.destroy(); }
}

test('Czech spelling, inflection, common typos and allowed words', () => {
  assert(checker.correct('žluťoučký')); assert(checker.correct('knihami'));
  assert(!checker.correct('samozdřejmě'));
  const findings = checker.check('Samozdřejmě čteme knihu. Xqznovák.', {ignoredWords: ['Xqznovák']});
  assert.equal(findings.length, 1); assert.equal(findings[0].replacement, 'Samozřejmě');
});
test('Unicode grammar boundaries, punctuation and optional style', () => {
  const findings = checker.check('To by jste chtěl. To je více lepší. Vyjímka,ano. V současné době čteme.', {stylistic: true});
  assert(findings.some(item => item.original === 'by jste' && item.replacement === 'byste'));
  assert(findings.some(item => item.original === 'více lepší' && item.replacement === 'lepší'));
  assert(findings.some(item => item.category === 'Stylistika' && item.replacement === 'Nyní'));
  assert(findings.some(item => item.category === 'Interpunkce' && item.replacement === ', '));
  assert(!checker.check('V současné době čteme.').some(item => item.category === 'Stylistika'));
});
test('URLs and email addresses are excluded', () => {
  assert.equal(checker.check('https://example.org/a:b www.example.cz test@example.cz').length, 0);
});
test('PDF comments, original pixels, all pages and report counts', async () => {
  const input = makePdf(['To by jste.', 'To by jste.']);
  const output = await processPdf(input, checker, {firstPage: 1, lastPage: 2});
  assert.equal(output.checkedPages, 2); assert.equal(output.corrections.length, 2);
  assert.deepEqual(output.counts, {Gramatika: 2});
  const before = openPdf(input).doc, after = openPdf(output.pdf).doc;
  try {
    assert.equal(before.countPages(), after.countPages());
    for (let index = 0; index < 2; index++) {
      const a = before.loadPage(index), b = after.loadPage(index);
      try {
        assert.equal(extractPage(a).text, extractPage(b).text);
        const annotations = b.getAnnotations(); assert.equal(annotations.length, 1);
        assert.equal(annotations[0].getType(), 'Highlight');
        assert(annotations[0].hasQuadPoints()); assert(annotations[0].getContents().includes('byste'));
        const x = a.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, true, false);
        const y = b.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, true, false);
        try { assert.deepEqual(x.getPixels(), y.getPixels()); } finally { x.destroy(); y.destroy(); }
      } finally { a.destroy(); b.destroy(); }
    }
    assert(makeCSV(output).startsWith('\uFEFF"Číslo"'));
    assert.equal(JSON.parse(makeJSON(output)).corrections.length, 2);
  } finally { before.destroy(); after.destroy(); }
});
test('Selected page range preserves unselected pages', async () => {
  const result = await processPdf(makePdf(['To by jste.', 'To by jste.', 'To by jste.']), checker, {firstPage: 2, lastPage: 2});
  assert.equal(result.checkedPages, 1); assert(result.corrections.every(item => item.page === 2));
  const doc = openPdf(result.pdf).doc;
  try {
    assert.equal(doc.countPages(), 3);
    for (let index = 0; index < 3; index++) {
      const page = doc.loadPage(index);
      try { assert.equal(page.getAnnotations().length, index === 1 ? 1 : 0); } finally { page.destroy(); }
    }
  } finally { doc.destroy(); }
});
test('Invalid PDF and invalid range fail explicitly', async () => {
  assert.throws(() => openPdf(new TextEncoder().encode('not a PDF')));
  await assert.rejects(processPdf(makePdf(['To by jste.']), checker, {firstPage: 2, lastPage: 2}), /rozsah/);
});
test('Overlapping text blocks and very long tokens terminate without duplicate findings', async () => {
  const text = 'kniha. '.repeat(850) + 'by jste ' + 'kniha. '.repeat(1000);
  const found = await checkPage(text, checker, {}, () => false);
  assert.equal(found.filter(item => item.original === 'by jste').length, 1);
  assert.deepEqual(await checkPage('q'.repeat(20000), checker, {}, () => false), []);
});
test('Cancellation stops processing rather than exporting partial results', async () => {
  await assert.rejects(processPdf(makePdf(['To by jste.']), checker, {}, {cancelled: () => true}), /CANCELLED/);
});
