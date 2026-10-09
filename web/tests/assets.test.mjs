import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {unpack} from '../src/assets.mjs';

const bytes = new TextEncoder().encode('Český text: žluťoučký kůň.');
const asset = {data: gzipSync(bytes).toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex')};
test('Embedded assets decompress and verify with browser WebCrypto', async () => {
  assert.deepEqual(await unpack(asset), bytes);
});
test('Opaque workers without WebCrypto verify exactly the same SHA-256', async () => {
  assert.deepEqual(await unpack(asset, null), bytes);
});
test('The fallback rejects modified asset checksums instead of skipping verification', async () => {
  await assert.rejects(unpack({...asset, sha256: '0'.repeat(64)}, null), /Kontrolní součet/);
});
