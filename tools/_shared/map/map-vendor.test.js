// Kontrollerar offlinekartan: att vendorfilerna är de som byggdes, att offlinestilen inte
// pekar på någon server, och att appens kartserver (ftmaps://) bara lämnar ut kartfiler.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const VENDOR = path.join(__dirname, 'vendor', 'maps');
const ROOT = path.join(__dirname, '..', '..', '..');
const versions = require('./vendor/maps/VERSIONS.json');
const maps = require('../../../electron/map-protocol.js');

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function loadAssets() {
    const window = {};
    new Function('window', fs.readFileSync(path.join(VENDOR, 'map-assets.js'), 'utf8'))(window);
    return window.MAP_ASSETS;
}

test('vendorfilerna stämmer med VERSIONS.json', () => {
    for (const [file, hash] of Object.entries(versions.sha256)) {
        assert.strictEqual(sha256(path.join(VENDOR, file)), hash, file);
    }
    assert.strictEqual(versions.packages['maplibre-gl'].version, '6.14.0');
    assert.ok(fs.existsSync(path.join(VENDOR, 'LICENSES.txt')));
    assert.match(fs.readFileSync(path.join(VENDOR, 'maplibre.js'), 'utf8'), /window\.MAPLIBRE_WORKER_SOURCE = "/);
});

test('offlinestilen hämtar inget utanför datorn', () => {
    const assets = loadAssets();
    for (const flavor of ['light', 'dark']) {
        const layers = assets.layers[flavor];
        assert.ok(layers.length > 50, flavor);
        assert.ok(!/https?:\/\//.test(JSON.stringify(layers)), flavor + ' innehåller en URL');
        const fonts = new Set();
        JSON.stringify(layers).replace(/"(Noto Sans [^"]+)"/g, (_, f) => fonts.add(f));
        for (const font of fonts) assert.ok(assets.glyphs[font] && Object.keys(assets.glyphs[font]).length, 'typsnitt ' + font);
        assert.ok(assets.glyphs['Noto Sans Regular']['0-255'] && assets.glyphs['Noto Sans Regular']['8192-8447']);
        assert.ok(assets.sprites[flavor] && assets.sprites[flavor + '@2x'], 'ikoner ' + flavor);
    }
    // Det enda externa i kartvyn är onlinekartan, som kräver godkännande.
    const view = fs.readFileSync(path.join(__dirname, 'map-view.js'), 'utf8');
    const urls = view.match(/https?:\/\/[^'"\s)]+/g) || [];
    assert.deepStrictEqual([...new Set(urls.map((u) => new URL(u).host))], ['tiles.openfreemap.org']);
});

test('kartdata.json beskriver världen och Sverige', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'maps', 'kartdata.json'), 'utf8'));
    assert.match(manifest.release, /^kartdata-\d{8}$/);
    assert.deepStrictEqual(Object.keys(manifest.files), ['world.pmtiles', 'sweden.pmtiles']);
    for (const f of Object.values(manifest.files)) {
        assert.match(f.sha256, /^[0-9a-f]{64}$/);
        assert.ok(f.bytes > 1e6);
    }
    assert.strictEqual(manifest.files['world.pmtiles'].minzoom, 0);
    assert.strictEqual(manifest.files['sweden.pmtiles'].maxzoom, 14);
});

test('kartservern: Range, CORS och bara filer i maps/', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ftmaps-'));
    const dir = path.join(tmp, 'maps');
    fs.mkdirSync(dir);
    const data = Buffer.from(Array.from({ length: 100 }, (_, i) => i));
    fs.writeFileSync(path.join(dir, 'world.pmtiles'), data);
    fs.writeFileSync(path.join(dir, 'kartdata.json'), '{"ok":true}');
    fs.writeFileSync(path.join(tmp, 'hemlig.json'), '{}');
    test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const handle = maps.mapRequestHandler(dir);
    const req = (url, headers, method) => handle(new Request(url, { headers, method }));

    let res = await req('ftmaps://data/world.pmtiles', { Range: 'bytes=10-19' });
    assert.strictEqual(res.status, 206);
    assert.strictEqual(res.headers.get('Content-Range'), 'bytes 10-19/100');
    assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.deepStrictEqual([...new Uint8Array(await res.arrayBuffer())], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

    res = await req('ftmaps://data/world.pmtiles', { Range: 'bytes=90-' });
    assert.strictEqual(res.headers.get('Content-Range'), 'bytes 90-99/100');

    res = await req('ftmaps://data/world.pmtiles', { Range: 'bytes=200-300' });
    assert.strictEqual(res.status, 416);

    res = await req('ftmaps://data/kartdata.json');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { ok: true });

    for (const bad of ['ftmaps://data/..%2Fhemlig.json', 'ftmaps://data/sub/world.pmtiles', 'ftmaps://other/world.pmtiles',
        'ftmaps://data/world.exe', 'ftmaps://data/.hidden.json', 'ftmaps://data/saknas.pmtiles']) {
        assert.strictEqual((await req(bad)).status, 404, bad);
    }

    res = await req('ftmaps://data/world.pmtiles', { 'Access-Control-Request-Headers': 'range' }, 'OPTIONS');
    assert.strictEqual(res.status, 204);
    assert.match(res.headers.get('Access-Control-Allow-Headers'), /Range/);
});

test('User-Agent utan appnamn och Electron', () => {
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36';
    const names = ['Forensics Toolbox', 'forensics-toolbox'];
    for (const app of ['ForensicsToolbox/1.7.0', 'forensics-toolbox/1.7.0', 'Forensics Toolbox/1.7.0']) {
        const ua = chrome.replace(' Chrome/', ` ${app} Chrome/`).replace(' Safari/', ' Electron/44.5.1 Safari/');
        assert.strictEqual(maps.genericUserAgent(ua, names), chrome, app);
    }
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ForensicsToolbox/1.7.0 Chrome/152.0.0.0 Electron/44.5.1 Safari/537.36';
    assert.strictEqual(maps.genericUserAgent(mac, names),
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36');
});
