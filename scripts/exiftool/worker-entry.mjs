// Källa för tools/exif-viewer/vendor/exiftool/exiftool-worker.js (byggs av
// scripts/vendor-exiftool.js). Körs i en Web Worker och läser metadata med ExifTool.
//
// Bara parseMetadata importeras. Verktyget skriver aldrig metadata, och filerna läses
// som Blob, som ExifTools filsystem i minnet inte kan skriva till. Där workern inte får
// läsa en Blob (WebKit under file://) kommer filen som { name, data }.

import { parseMetadata } from '@uswriting/exiftool';

// Biblioteket hämtar wasm med fetch() bara när window och document finns, annars
// försöker det läsa från disk via Node. I workern lämnar vi själva ut binären.
self.window = self;
self.document = {};

const ARGS = ['-json', '-a', '-G1', '-s', '-api', 'LargeFileSupport=1'];
// -U tar med okända taggar, även ur binära block. RequestAll=3 tar med taggar
// som ExifTool annars hoppar över (unsafe, protected, hidden).
const ALL_ARGS = ARGS.concat(['-U', '-api', 'RequestAll=3']);

// En ny Perl-instans för varje fil. Biblioteket sparar sin instans i en WeakRef och använder den tills
// skräpsamlaren har tagit den. I samma instans blir varje läsning långsammare än den förra (uppmätt: från
// 83 ms till 366 ms på 230 läsningar av samma lilla bild), och efter ungefär 230 läsningar är instansens minne
// slut, så att varje läsning därefter slutar med "memory access out of bounds". Bygget
// (scripts/vendor-exiftool.js) byter därför bibliotekets WeakRef mot NoRef här, som aldrig har något kvar, och
// dess WebAssembly.instantiate mot instantiate här, som gör instansen av modulen som kompilerades vid starten.
// En ny instans kostar då lika mycket som en läsning i en ny instans förut, och ingenting följer med från
// en fil till nästa.
const WASM = new ArrayBuffer(0);   // det biblioteket får i stället för binären, och lämnar tillbaka till instantiate
let wasmModule = null;
let instances = 0;

self.FT_EXIF = {
    NoRef: class { deref() { return undefined; } },
    instantiate: async (source, imports) => {
        if (source !== WASM || !wasmModule) throw new Error('ExifTools binär är inte laddad');
        instances++;
        return { module: wasmModule, instance: new WebAssembly.Instance(wasmModule, imports) };
    },
};

async function gunzipBase64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // Inte via Blob: WebKit vägrar läsa en Blob i en worker från en blob-URL under file://.
    const source = new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
    return new Response(source.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

async function canReadBlobs() {
    try {
        await new Blob([new Uint8Array(1)]).arrayBuffer();
        return true;
    } catch (err) {
        return false;
    }
}

const wasmFetch = async () => ({ arrayBuffer: async () => WASM });

async function parse(file, allValues) {
    const result = await parseMetadata(file, {
        args: allValues ? ALL_ARGS : ARGS,
        fetch: wasmFetch,
        transform: (s) => JSON.parse(s),
    });
    if (!result.success) return { ok: false, error: String(result.error || 'Okänt fel') };
    const tags = (result.data && result.data[0]) || {};
    // Bytes utan File har ingen filtid: ExifTool skulle annars visa 1970 som ändringstid.
    if (!(file instanceof File)) ['System:FileModifyDate', 'System:FileAccessDate', 'System:FileInodeChangeDate'].forEach((k) => delete tags[k]);
    return { ok: true, tags };
}

self.onmessage = async (event) => {
    const msg = event.data || {};
    if (msg.type === 'init') {
        try {
            wasmModule = await WebAssembly.compile(await gunzipBase64(msg.wasmGz));
            const blobs = await canReadBlobs();
            const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
            const probe = await parse(blobs ? new File([jpeg], 'probe.jpg') : { name: 'probe.jpg', data: jpeg }, false);
            self.postMessage({ type: 'ready', version: probe.ok ? probe.tags['ExifTool:ExifToolVersion'] : null, blobsBlocked: !blobs });
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
        // instance: vilken Perl-instans i ordningen som svarade (en ny för varje läsning).
        self.postMessage(Object.assign({ type: 'result', id: msg.id, unknown: !!msg.unknown, instance: instances }, out));
    }
};
