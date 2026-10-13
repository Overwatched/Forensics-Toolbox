// Kontrollerar den vendorerade ExifTool-motorn: att wasm är byte för byte samma som i
// npm-paketet, att skrivfunktionen inte finns med och att workern läser en riktig bild.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const VENDOR = path.join(__dirname, 'vendor', 'exiftool');
const versions = require('./vendor/exiftool/VERSIONS.json');

// zeroperl.wasm i @6over3/zeroperl-ts 1.0.10.
const PINNED_WASM_SHA256 = 'a6ae97f184fabc444b0b70d77c3d16475bfb3de16ebfb58ab8b2fbf98a53835e';

function loadGlobal(file, name) {
    const prev = global.window;
    global.window = {};
    try {
        new Function('window', fs.readFileSync(path.join(VENDOR, file), 'utf8'))(global.window);
        return global.window[name];
    } finally {
        global.window = prev;
    }
}

const wasmGz = loadGlobal('zeroperl-wasm.js', 'EXIFTOOL_WASM_GZ');
const workerSource = loadGlobal('exiftool-worker.js', 'EXIFTOOL_WORKER_SOURCE');

test('wasm är oförändrad mot npm-paketet', () => {
    const wasm = zlib.gunzipSync(Buffer.from(wasmGz, 'base64'));
    const hash = crypto.createHash('sha256').update(wasm).digest('hex');
    assert.strictEqual(hash, PINNED_WASM_SHA256);
    assert.strictEqual(versions.wasmSha256, PINNED_WASM_SHA256);
    assert.strictEqual(wasm.length, versions.wasmBytes);
    assert.strictEqual(versions.packages['@uswriting/exiftool'].version, '1.0.9');
});

test('workern innehåller bara läsning', () => {
    assert.ok(workerSource.includes('No output data from ExifTool'), 'parseMetadata saknas');
    assert.ok(!workerSource.includes('Temporary output file not found'), 'writeMetadata ska inte finnas i bundlen');
    assert.ok(!/fetch\(\s*["'`]https?:/.test(workerSource), 'workern får inte hämta något från nätet');
    assert.ok(fs.existsSync(path.join(VENDOR, 'LICENSE-Apache-2.0.txt')));
    assert.ok(fs.existsSync(path.join(VENDOR, 'LICENSES.txt')));
});

test('workern läser EXIF ur en riktig bild utan att ändra den', { timeout: 60000 }, async () => {
    if (!globalThis.File) globalThis.File = require('node:buffer').File;
    const messages = [];
    const waiters = [];
    const self = globalThis;
    self.self = self;
    self.postMessage = (msg) => {
        messages.push(msg);
        while (waiters.length) waiters.shift()();
    };
    new Function(workerSource)();
    const next = (type) => new Promise((resolve) => {
        (function check() {
            const i = messages.findIndex((m) => m.type === type || m.type === 'init-error');
            if (i >= 0) return resolve(messages.splice(i, 1)[0]);
            waiters.push(check);
        })();
    });

    self.onmessage({ data: { type: 'init', wasmGz } });
    const ready = await next('ready');
    assert.strictEqual(ready.type, 'ready', ready.error);
    assert.strictEqual(ready.version, 13.42);

    const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'exif-sample.jpg'));
    const before = crypto.createHash('sha256').update(bytes).digest('hex');
    self.onmessage({ data: { type: 'parse', id: 7, file: new File([bytes], 'exif-sample.jpg', { lastModified: 1717245296000 }) } });
    const result = await next('result');
    assert.strictEqual(result.id, 7);
    assert.ok(result.ok, result.error);
    assert.strictEqual(result.tags['IFD0:Model'], 'iPhone 15 Pro');
    assert.strictEqual(result.tags['Composite:SubSecDateTimeOriginal'], '2024:06:01 14:34:56+02:00');
    assert.strictEqual(crypto.createHash('sha256').update(bytes).digest('hex'), before);

    const core = require('./exif-core.js');
    const s = core.summarize(core.cleanTags(result.tags), 'exif-sample.jpg');
    assert.strictEqual(s.device.text, 'Apple iPhone 15 Pro');
    assert.ok(Math.abs(s.position.lat - 59.3293) < 0.001);
    assert.ok(Math.abs(s.position.lon - 18.0686) < 0.001);
});
