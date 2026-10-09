import {sha256} from '@noble/hashes/sha2.js';

export async function unpack(asset, subtle = globalThis.crypto?.subtle) {
  const compressed = Uint8Array.from(atob(asset.data), char => char.charCodeAt(0));
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  // Opaque-origin workers can lack WebCrypto even if the containing HTML is
  // trustworthy. Verify the same SHA-256 using a bundled implementation.
  const digest = subtle ? await subtle.digest('SHA-256', bytes) : sha256(bytes);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== asset.sha256) throw new Error('Kontrolní součet součásti aplikace nesouhlasí. Stáhněte původní soubor znovu.');
  return bytes;
}

export function scriptURL(bytes, suffix = '') {
  return URL.createObjectURL(new Blob([bytes], {type: 'text/javascript'})) + suffix;
}
