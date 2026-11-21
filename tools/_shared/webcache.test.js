// Webbläsarnas cache: WebKits poster (Safari) och Chromiums simple cache (Chrome på Android), med påhittade poster i
// telefonernas form (tests/app/webcache-builder.js). Kontrollerat mot labbtelefonerna 2026-11-11.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const W = require('./webcache.js');
const { webkitRecord, chromiumEntry } = require('../../tests/app/webcache-builder.js');

test('WebKit: nyckel, tid, typ, rubriker och innehållet i posten eller i Blobs', () => {
    const html = Buffer.from('<!doctype html><title>Katter</title><img src="/a.png">');
    const a = webkitRecord({ url: 'https://example.org/katter', mime: 'text/html', body: html, partition: 'example.org', ms: Date.UTC(2026, 10, 3, 10, 58, 31), headers: { 'Content-Type': 'text/html; charset=utf-8', Date: 'Tue, 03 Nov 2026 10:58:31 GMT' } });
    const r = W.parseWebKit(new Uint8Array(a.record));
    assert.strictEqual(r.url, 'https://example.org/katter');
    assert.strictEqual(r.partition, 'example.org');
    assert.strictEqual(r.mime, 'text/html');
    assert.strictEqual(r.ms, Date.UTC(2026, 10, 3, 10, 58, 31));
    assert.strictEqual(r.status, 'HTTP/1.1');
    assert.strictEqual(r.headers['content-type'], 'text/html; charset=utf-8');
    assert.strictEqual(Buffer.from(r.body).toString(), html.toString());
    assert.ok(W.isHtml(r));
    const big = webkitRecord({ url: 'https://example.org/a.png', mime: 'image/png', body: Buffer.alloc(5000, 7), inline: false });
    const b = W.parseWebKit(new Uint8Array(big.record));
    assert.strictEqual(b.inline, false);
    assert.strictEqual(b.body, null);
    assert.strictEqual(b.bodyHash, big.blobName);
    assert.strictEqual(b.bodySize, 5000);
    assert.strictEqual(W.kindOf('/private/var/mobile/Containers/Data/Application/04DA9C3D-2473-442F-B0EE-0468D62DB409/Library/Caches/WebKit/NetworkCache/Version 17/Records/5781F56DB95C20148F6ACFEECC4EDDFDBBE1EBE5/Resource/BE1D5DCEED9D383A40C5A238CF53828E89CD51F1'), 'webkit');
    assert.strictEqual(W.kindOf('x/NetworkCache/Version 17/Blobs/' + big.blobName), 'webkit-blob');
});

test('Chromium: adressen ur nyckeln, tiderna, rubrikerna och det packade innehållet', () => {
    const html = '<!doctype html><p>Hej</p>';
    const e = chromiumEntry({ url: 'https://www.example.se/nyheter', body: zlib.gzipSync(html), headers: 'HTTP/1.1 200\0content-type:text/html; charset=utf-8\0content-encoding:gzip\0date:Wed, 11 Nov 2026 13:08:34 GMT', ms: Date.UTC(2026, 10, 11, 13, 8, 33) });
    const r = W.parseChromium(new Uint8Array(e));
    assert.strictEqual(r.url, 'https://www.example.se/nyheter');
    assert.strictEqual(r.status, 'HTTP/1.1 200');
    assert.strictEqual(r.mime, 'text/html');
    assert.strictEqual(r.encoding, 'gzip');
    assert.strictEqual(r.ms, Date.UTC(2026, 10, 11, 13, 8, 33));
    assert.strictEqual(r.requestMs, Date.UTC(2026, 10, 11, 13, 8, 33) - 40);
    assert.strictEqual(zlib.gunzipSync(Buffer.from(r.body)).toString(), html);
    assert.strictEqual(W.kindOf('Dump/data/data/com.android.chrome/cache/Cache/Cache_Data/0a1b2c3d4e5f6071_0'), 'chromium');
    assert.deepStrictEqual(W.ownerOf('Dump/data/data/com.android.chrome/cache/Cache/Cache_Data/0a1b2c3d4e5f6071_0'), { platform: 'Android', id: 'com.android.chrome' });
});

test('texten avkodas efter teckenkodningen i rubriken eller sidan', () => {
    assert.strictEqual(W.decodeText(new Uint8Array([0x48, 0xe4, 0x6a]), { 'content-type': 'text/html; charset=iso-8859-1' }), 'Häj');
    assert.strictEqual(W.decodeText(new Uint8Array(Buffer.from('<meta charset="utf-8">Hä')), {}), '<meta charset="utf-8">Hä');
    assert.strictEqual(W.resolve('/a.png', 'https://example.org/x/y'), 'https://example.org/a.png');
    assert.strictEqual(W.bare('https://example.org/a#b'), 'https://example.org/a');
});
