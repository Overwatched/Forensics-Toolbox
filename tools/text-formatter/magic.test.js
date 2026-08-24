const test = require('node:test');
const assert = require('node:assert/strict');
require('./protobuf.js');
require('../plist-viewer/plist.js');
const magic = require('./magic.js');

async function ids(text, enabled) {
    const hits = await magic.runMagic(text, enabled);
    return hits.map((h) => h.id);
}

test('JSON sample', async () => {
    const hits = await magic.runMagic('{"user":"anna","id":12}');
    assert.equal(hits[0].id, 'json');
    assert.match(hits[0].text, /"user": "anna"/);
});

test('JWT sample', async () => {
    const hits = await magic.runMagic(magic.SAMPLES.find((s) => s.id === 'jwt').input);
    assert.equal(hits[0].id, 'jwt');
    assert.match(hits[0].text, /"name": "Kim"/);
});

test('protobuf hex', async () => {
    const hits = await magic.runMagic('08 96 01');
    assert.ok(hits.some((h) => h.id === 'protobuf' && h.text.includes('150')));
});

test('base64 JSON', async () => {
    const hits = await magic.runMagic('eyJvayI6dHJ1ZX0=');
    assert.ok(hits.some((h) => h.id === 'base64' && h.text.includes('"ok": true')));
});

test('URL-encoded', async () => {
    const hits = await magic.runMagic('namn%3DKalle%20Svensson');
    assert.equal(hits[0].id, 'url');
    assert.match(hits[0].text, /Kalle Svensson/);
});

test('unix time is not treated as hex', async () => {
    const found = await ids('1714521600');
    assert.ok(found.includes('time'));
    assert.ok(!found.includes('hex'));
});

test('gzip hex wraps JSON', async () => {
    const sample = magic.SAMPLES.find((s) => s.id === 'gzip').input;
    const hits = await magic.runMagic(sample);
    assert.ok(hits.some((h) => h.id === 'gzip' && h.text.includes('"zip": true')));
});

test('checkbox limits detectors', async () => {
    const hits = await magic.runMagic('{"a":1}', ['protobuf']);
    assert.equal(hits.length, 0);
});

test('empty checkbox list runs nothing', async () => {
    const hits = await magic.runMagic('{"a":1}', []);
    assert.equal(hits.length, 0);
});

test('XML plist', async (t) => {
    if (typeof DOMParser === 'undefined') {
        t.skip('DOMParser saknas i Node');
        return;
    }
    const sample = magic.SAMPLES.find((s) => s.id === 'plist').input;
    const hits = await magic.runMagic(sample);
    assert.ok(hits.some((h) => h.id === 'plist' && h.text.includes('"Name": "Kim"')));
    assert.ok(!hits.some((h) => h.id === 'xml'));
});
