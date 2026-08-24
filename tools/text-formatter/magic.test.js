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

test('pretty JSON is not split into lines', () => {
    const pretty = '{\n  "user": "anna"\n}';
    assert.deepEqual(magic.splitChunks(pretty), [pretty]);
});

test('blank-line chunks decode separately', async () => {
    const mixed = '{"user":"anna"}\n\n1714521600';
    const chunks = magic.splitChunks(mixed);
    assert.deepEqual(chunks, ['{"user":"anna"}', '1714521600']);
    const hits = await magic.runMagic(mixed);
    assert.ok(hits.some((h) => h.id === 'json' && h.chunk === 1));
    assert.ok(hits.some((h) => h.id === 'time' && h.chunk === 2));
});

test('one-liner mix jwt and unix time', async () => {
    const jwt = magic.SAMPLES.find((s) => s.id === 'jwt').input;
    const mixed = jwt + '\n1714521600';
    const hits = await magic.runMagic(mixed);
    assert.ok(hits.some((h) => h.id === 'jwt' && h.text.includes('"name": "Kim"')));
    assert.ok(hits.some((h) => h.id === 'time'));
});

test('all testdata sample has several chunks', () => {
    const all = magic.SAMPLES.find((s) => s.id === 'all');
    assert.ok(all);
    assert.ok(magic.splitChunks(all.input).length >= 6);
});

test('all testdata decodes several formats at once', async () => {
    const all = magic.SAMPLES.find((s) => s.id === 'all');
    const hits = await magic.runMagic(all.input);
    const found = new Set(hits.map((h) => h.id));
    for (const id of ['json', 'jwt', 'gzip', 'time', 'protobuf', 'url', 'hex']) {
        assert.ok(found.has(id), 'saknar ' + id + ' i ' + [...found].join(','));
    }
    assert.ok(hits.some((h) => h.id === 'jwt' && h.text.includes('"name": "Kim"')));
    assert.ok(hits.some((h) => h.id === 'gzip' && h.text.includes('"zip": true')));
    assert.ok(hits.filter((h) => h.chunk).length >= 6);
});

test('mixed plist gzip jwt with blank lines', async () => {
    const plist = magic.SAMPLES.find((s) => s.id === 'plist').input;
    const gzip = magic.SAMPLES.find((s) => s.id === 'gzip').input;
    const jwt = magic.SAMPLES.find((s) => s.id === 'jwt').input;
    const mixed = [plist, gzip, jwt].join('\n\n');
    assert.equal(magic.splitChunks(mixed).length, 3);
    const hits = await magic.runMagic(mixed);
    assert.ok(hits.some((h) => h.id === 'gzip' && h.text.includes('"zip": true')));
    assert.ok(hits.some((h) => h.id === 'jwt' && h.text.includes('"name": "Kim"')));
});

