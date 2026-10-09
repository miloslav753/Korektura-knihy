import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {build} from 'esbuild';
import {zipSync} from 'fflate';

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(root);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function asset(bytes) {
  return {sha256: sha256(bytes), data: gzipSync(bytes, {level: 9}).toString('base64')};
}
async function bundle(entry) {
  const output = await build({entryPoints: [path.join(root, 'src', entry)], bundle: true, format: 'esm',
    platform: 'browser', target: 'es2022', minify: true, write: false,
    external: ['node:fs', 'module'], legalComments: 'inline'});
  return output.outputFiles[0].contents;
}
const dictionary = path.join(repo, 'data/cs_CZ');
const provenance = JSON.parse(await fs.readFile(path.join(dictionary, 'provenance.json'), 'utf8'));
for (const [name, hash] of Object.entries(provenance.sha256)) {
  if (sha256(await fs.readFile(path.join(dictionary, name))) !== hash) throw new Error(`Dictionary checksum mismatch: ${name}`);
}
const ocrPath = process.env.KOREKTURA_TESSDATA || '/workspace/.cloud-setup/korektura-knihy/tessdata';
let ocrModel;
try { ocrModel = await fs.readFile(path.join(ocrPath, 'ces.traineddata')); }
catch { ocrModel = await fs.readFile(path.join(repo, 'data/tessdata/ces.traineddata')); }
if (sha256(ocrModel) !== '934bcaf97ef3348413263331131c9fa7f55f30db333c711929c124fb635f7e1b') {
  throw new Error('Czech OCR model checksum mismatch. Run scripts/setup_ocr.py with the pinned model.');
}
const licenseFiles = [
  ['Nspell — MIT', 'node_modules/nspell/license'],
  ['Tesseract.js — Apache-2.0', 'node_modules/tesseract.js/LICENSE.md'],
  ['Tesseract.js-core / Czech OCR model — Apache-2.0', 'node_modules/tesseract.js-core/LICENSE'],
];
let licenses = 'MuPDF.js 1.28.1 — Copyright (C) 2004-2026 Artifex Software, Inc. AGPL-3.0-or-later.\nCorresponding source: https://github.com/ArtifexSoftware/mupdf/tree/1.28.1\n\n';
licenses += await fs.readFile(path.join(root, 'MUPDF-COPYING.txt'), 'utf8') + '\n\n';
for (const [title, filename] of licenseFiles) licenses += `${title}\n${await fs.readFile(path.join(root, filename), 'utf8')}\n\n`;
licenses += `Český slovník LibreOffice — zdrojová revize ${provenance.revision}\n${await fs.readFile(path.join(dictionary, 'README_cs.txt'), 'utf8')}`;
const sourceFiles = {};
async function collect(directory, prefix) {
  for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
    const filename = path.join(directory, entry.name), name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await collect(filename, name);
    else sourceFiles[name] = new Uint8Array(await fs.readFile(filename));
  }
}
await collect(path.join(root, 'src'), 'Korektura-knihy/web/src');
await collect(path.join(root, 'tests'), 'Korektura-knihy/web/tests');
await collect(dictionary, 'Korektura-knihy/data/cs_CZ');
for (const name of ['build.mjs', 'package.json', 'package-lock.json', 'index.template.html', 'MUPDF-COPYING.txt', 'README.md']) {
  sourceFiles[`Korektura-knihy/web/${name}`] = new Uint8Array(await fs.readFile(path.join(root, name)));
}
for (const name of ['README.md', 'scripts/setup_ocr.py']) sourceFiles[`Korektura-knihy/${name}`] = new Uint8Array(await fs.readFile(path.join(repo, name)));
sourceFiles['Korektura-knihy/web/THIRD-PARTY-LICENSES.txt'] = new TextEncoder().encode(licenses);
const sourcesZIP = zipSync(sourceFiles, {level: 9, mtime: new Date('1980-01-01T00:00:00Z')});
const payload = {
  engine: asset(await bundle('worker.mjs')), bootstrap: asset(await bundle('worker-bootstrap.mjs')),
  mupdfWasm: asset(await fs.readFile(path.join(root, 'node_modules/mupdf/dist/mupdf-wasm.wasm'))),
  aff: asset(await fs.readFile(path.join(dictionary, 'cs_CZ.aff'))), dic: asset(await fs.readFile(path.join(dictionary, 'cs_CZ.dic'))),
  ocrWorker: asset(await fs.readFile(path.join(root, 'node_modules/tesseract.js/dist/worker.min.js'))),
  ocrCore: asset(await fs.readFile(path.join(root, 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js'))),
  ocrModel: asset(ocrModel), sources: asset(sourcesZIP), licenses,
};
const app = new TextDecoder().decode(await bundle('app.mjs'));
const html = (await fs.readFile(path.join(root, 'index.template.html'), 'utf8'))
  .replace('__PAYLOAD__', JSON.stringify(payload).replaceAll('<', '\\u003c'))
  .replace('__APP__', app.replaceAll('</script', '<\\/script'));
const dist = path.join(root, 'dist');
await fs.mkdir(dist, {recursive: true});
await fs.writeFile(path.join(dist, 'index.html'), html);
await fs.writeFile(path.join(dist, 'sources.zip'), sourcesZIP);
await fs.writeFile(path.join(dist, '.nojekyll'), '');
await fs.writeFile(path.join(dist, 'build-provenance.json'), JSON.stringify({
  htmlSha256: sha256(Buffer.from(html)), sourceDictionary: provenance,
  npmLockSha256: sha256(await fs.readFile(path.join(root, 'package-lock.json'))),
  assets: Object.fromEntries(Object.entries(payload).filter(([name]) => name !== 'licenses').map(([name, data]) => [name, data.sha256])),
}, null, 2) + '\n');
console.log(`Built ${path.join(dist, 'index.html')} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB). All runtime assets embedded.`);
