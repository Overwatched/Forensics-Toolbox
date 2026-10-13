const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

require('./sample-jpegs.js');
const sample = require('./sample-data.js');
const core = require('../../exif-viewer/exif-core.js');

test('testdata har två rutter och filer utan giltig position', () => {
    const map = require('./map-core.js');
    const points = sample.positionPoints();
    assert.strictEqual(points.length, 20);
    assert.strictEqual(points[0].name, 'IMG_4101.JPG');
    const routes = map.routesBy(points, 'device');
    assert.strictEqual(routes.length, 2);
    routes.forEach((g) => {
        const line = map.routeLines(g.route, '#ff9f0a').lines[0];
        assert.ok(line.coordinates.length >= 5, g.name);
        assert.ok(map.haversine(
            { lat: line.coordinates[0][1], lon: line.coordinates[0][0] },
            { lat: line.coordinates[line.coordinates.length - 1][1], lon: line.coordinates[line.coordinates.length - 1][0] }
        ) > 800, g.name);
    });
    const files = sample.exifFiles();
    assert.strictEqual(files.length, 22);
    assert.strictEqual(files[0].bytes[0], 0xFF);
    assert.strictEqual(files[0].bytes[1], 0xD8);
});

test('ExifTool läser den påhittade testdatan', { timeout: 60000 }, async () => {
    const vendor = path.join(__dirname, '../../exif-viewer/vendor/exiftool');
    const window = {};
    new Function('window', fs.readFileSync(path.join(vendor, 'exiftool-worker.js'), 'utf8'))(window);
    new Function('window', fs.readFileSync(path.join(vendor, 'zeroperl-wasm.js'), 'utf8'))(window);
    if (!globalThis.File) globalThis.File = require('node:buffer').File;
    const messages = [];
    const waiters = [];
    const self = globalThis;
    self.self = self;
    self.postMessage = (msg) => {
        messages.push(msg);
        while (waiters.length) waiters.shift()();
    };
    new Function(window.EXIFTOOL_WORKER_SOURCE)();
    const next = () => new Promise((resolve) => {
        (function check() {
            const i = messages.findIndex((m) => m.type === 'result' || m.type === 'ready' || m.type === 'init-error');
            if (i >= 0) return resolve(messages.splice(i, 1)[0]);
            waiters.push(check);
        })();
    });
    self.onmessage({ data: { type: 'init', wasmGz: window.EXIFTOOL_WASM_GZ } });
    const ready = await next();
    assert.strictEqual(ready.type, 'ready', ready.error);

    async function read(name) {
        const file = sample.exifFiles().find((f) => f.name.endsWith(name));
        self.onmessage({ data: { type: 'parse', id: 1, file: new File([file.bytes], name) } });
        const result = await next();
        assert.ok(result.ok, name + ' ' + result.error);
        return core.summarize(core.cleanTags(result.tags), name);
    }

    const walk = await read('IMG_4101.JPG');
    assert.strictEqual(walk.device.text, 'Apple iPhone 15 Pro');
    assert.ok(Math.abs(walk.position.lat - 59.3303) < 0.0002);
    assert.strictEqual(walk.taken.zone, '+02:00');

    const samsung = await read('20240601_151012.jpg');
    assert.strictEqual(samsung.device.text, 'samsung SM-S918B');
    assert.strictEqual(samsung.taken.zone, '');
    assert.ok(samsung.patterns.some((p) => p.app === 'samsung-camera' && p.makerMatch === 'match'));

    const zero = await read('IMG_4141.JPG');
    assert.strictEqual(zero.position.zero, true);
    const none = await read('IMG_4140.JPG');
    assert.strictEqual(none.position, null);
});
