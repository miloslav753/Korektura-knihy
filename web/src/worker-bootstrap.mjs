import {unpack, scriptURL} from './assets.mjs';

self.onmessage = async ({data}) => {
  if (data.type !== 'boot') return;
  try {
    self.postMessage({type: 'status', message: 'Načítám nástroje pro PDF…'});
    globalThis.__KOREKTURA_ASSETS__ = data.assets;
    globalThis.$libmupdf_wasm_Module = {wasmBinary: await unpack(data.assets.mupdfWasm), locateFile: () => 'mupdf-wasm.wasm'};
    const moduleURL = scriptURL(await unpack(data.assets.engine));
    await import(moduleURL);
    URL.revokeObjectURL(moduleURL);
  } catch (error) {
    self.postMessage({type: 'boot-error', message: error.message});
  }
};
