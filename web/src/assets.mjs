export async function unpack(asset) {
  const compressed = Uint8Array.from(atob(asset.data), char => char.charCodeAt(0));
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  if (!globalThis.crypto?.subtle) throw new Error('Otevřete aplikaci v aktuálním prohlížeči jako místní soubor nebo přes HTTPS.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== asset.sha256) throw new Error('Kontrolní součet součásti aplikace nesouhlasí. Stáhněte původní soubor znovu.');
  return bytes;
}

export function scriptURL(bytes, suffix = '') {
  return URL.createObjectURL(new Blob([bytes], {type: 'text/javascript'})) + suffix;
}
