'use strict';
// HEIC: igenkänningen på innehållet, att avkodaren i vendor/libheif är den som VERSIONS.json säger, och att den
// avkodar testfilen (fixtures/prov.heic: 64 × 48 med en förhandsbild på 32 × 24). Avkodarens tråd körs här i en
// vm med ett eget self, och ger pixlarna (raw) eftersom Node saknar OffscreenCanvas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Heic = require('./heic.js');

const DIR = path.join(__dirname, 'vendor', 'libheif');
const PROV = fs.readFileSync(path.join(__dirname, 'fixtures', 'prov.heic'));

function ftyp(major, ...compat) {
    const body = Buffer.concat([Buffer.from(major, 'latin1'), Buffer.alloc(4), ...compat.map((c) => Buffer.from(c, 'latin1'))]);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length);
    head.write('ftyp', 4, 'latin1');
    return Buffer.concat([head, body, Buffer.alloc(8)]);
}

test('HEIC känns igen på ftyp, inte på ändelsen; AVIF och JPEG är inte HEIC', () => {
    assert.strictEqual(Heic.is(PROV), true);
    assert.strictEqual(Heic.is(ftyp('mif1', 'mif1', 'heic')), true);
    assert.strictEqual(Heic.is(ftyp('heix', 'mif1')), true);
    assert.strictEqual(Heic.is(ftyp('avif', 'mif1', 'miaf')), false);
    assert.strictEqual(Heic.is(ftyp('mif1', 'avif')), false);
    assert.strictEqual(Heic.is(ftyp('isom', 'mp41')), false, 'en video');
    assert.strictEqual(Heic.is(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1])), false, 'JPEG');
    assert.strictEqual(Heic.is(new Uint8Array(4)), false);
    assert.deepStrictEqual(['IMG_1.HEIC', 'a.heif', 'b.hif', 'c.jpg'].map(Heic.isName), [true, true, true, false]);
});

function workerSource() {
    const box = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(DIR, 'libheif-worker.js'), 'utf8'), box);
    return box.window.LIBHEIF_WORKER_SOURCE;
}

test('avkodaren är libheif-js enligt VERSIONS.json, utan adress till nätet', () => {
    const v = JSON.parse(fs.readFileSync(path.join(DIR, 'VERSIONS.json'), 'utf8'));
    const src = workerSource();
    assert.strictEqual(v.package.name, 'libheif-js');
    const bundle = Buffer.from(src, 'utf8').subarray(0, v.bundleBytes);
    assert.strictEqual(crypto.createHash('sha256').update(bundle).digest('hex'), v.bundleSha256);
    assert.ok(!/https?:\/\/[^\s"'`]*\.wasm/.test(src), 'en extern wasm-adress');
    assert.ok(fs.existsSync(path.join(DIR, 'LICENSE-libheif.txt')) && fs.existsSync(path.join(DIR, 'LICENSE-libheif-js.txt')), 'licenserna saknas');
});

test('testfilen avkodas: huvudbilden 64 × 48, förhandsbilden 32 × 24, och en trasig fil ger ett fel', async () => {
    const posted = [];
    const self = { postMessage: (m) => posted.push(m) };
    const ctx = vm.createContext({ self, console, Uint8Array, Uint8ClampedArray, Promise, WebAssembly, setTimeout, clearTimeout, TextDecoder, TextEncoder, performance });
    vm.runInContext(workerSource(), ctx);
    const ask = (msg) => new Promise((resolve) => {
        const n = posted.length;
        self.onmessage({ data: msg });
        const wait = () => (posted.length > n && posted.some((p) => p.id === msg.id) ? resolve(posted.find((p) => p.id === msg.id)) : setTimeout(wait, 5));
        wait();
    });
    const main = await ask({ id: 1, bytes: PROV, raw: true });
    assert.ok(main.ok, main.error);
    assert.deepStrictEqual([main.w, main.h, main.width, main.height, main.from, main.rgba.length], [64, 48, 64, 48, 'primary', 64 * 48 * 4]);
    // ffmpegs testbild har färgade fält: mitt i bilden är inte svart.
    const mid = (24 * 64 + 32) * 4;
    assert.ok(main.rgba[mid] + main.rgba[mid + 1] + main.rgba[mid + 2] > 60, 'mitten är svart');
    const small = await ask({ id: 2, bytes: PROV, raw: true, preview: true });
    assert.deepStrictEqual([small.ok, small.w, small.h, small.width, small.height, small.from], [true, 32, 24, 64, 48, 'preview']);
    const bad = await ask({ id: 3, bytes: Buffer.concat([PROV.subarray(0, 40), Buffer.alloc(20)]), raw: true });
    assert.strictEqual(bad.ok, false);
    assert.match(bad.error, /HEIC/);
});
