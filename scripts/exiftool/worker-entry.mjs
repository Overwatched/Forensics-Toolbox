// Källa för tools/exif-viewer/vendor/exiftool/exiftool-worker.js (byggs av
// scripts/vendor-exiftool.js). Körs i en Web Worker och läser metadata med ExifTool.
//
// Bara parseMetadata importeras. Verktyget skriver aldrig metadata, och filerna läses
// som Blob, som ExifTools filsystem i minnet inte kan skriva till.

import { parseMetadata } from '@uswriting/exiftool';

// Biblioteket hämtar wasm med fetch() bara när window och document finns, annars
// försöker det läsa från disk via Node. I workern lämnar vi själva ut binären.
self.window = self;
self.document = {};

const ARGS = ['-json', '-a', '-G1', '-s', '-api', 'LargeFileSupport=1'];
// -U tar med okända taggar, även ur binära block. RequestAll=3 tar med taggar
// som ExifTool annars hoppar över (unsafe, protected, hidden).
const ALL_ARGS = ARGS.concat(['-U', '-api', 'RequestAll=3']);

let wasm = null;

async function gunzipBase64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
}

const wasmFetch = async () => ({ arrayBuffer: async () => wasm });

async function parse(file, allValues) {
    const result = await parseMetadata(file, {
        args: allValues ? ALL_ARGS : ARGS,
        fetch: wasmFetch,
        transform: (s) => JSON.parse(s),
    });
    if (!result.success) return { ok: false, error: String(result.error || 'Okänt fel') };
    return { ok: true, tags: (result.data && result.data[0]) || {} };
}

self.onmessage = async (event) => {
    const msg = event.data || {};
    if (msg.type === 'init') {
        try {
            wasm = await gunzipBase64(msg.wasmGz);
            const probe = await parse(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'probe.jpg'), false);
            self.postMessage({ type: 'ready', version: probe.ok ? probe.tags['ExifTool:ExifToolVersion'] : null });
        } catch (err) {
            self.postMessage({ type: 'init-error', error: String((err && err.message) || err) });
        }
        return;
    }
    if (msg.type === 'parse') {
        let out;
        try {
            out = await parse(msg.file, !!msg.unknown);
        } catch (err) {
            out = { ok: false, error: String((err && err.message) || err) };
        }
        self.postMessage(Object.assign({ type: 'result', id: msg.id, unknown: !!msg.unknown }, out));
    }
};
