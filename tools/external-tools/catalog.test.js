const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('./catalog.js');

test('catalog is alphabetical within forensik group', () => {
    const names = catalog.TOOLS.filter((t) => t.group === 'forensik').map((t) => t.name);
    const sorted = names.slice().sort((a, b) => a.localeCompare(b, 'sv'));
    assert.deepEqual(names, sorted);
});

test('search finds iLEAPP by name', () => {
    const hits = catalog.filterTools('ileapp');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, 'ileapp');
});

test('search finds sqlite in description', () => {
    const hits = catalog.filterTools('sqlite');
    assert.ok(hits.some((h) => h.id === 'dbbrowser'));
});

test('empty query returns all tools', () => {
    assert.equal(catalog.filterTools('').length, catalog.TOOLS.length);
});

test('unknown query returns none', () => {
    assert.equal(catalog.filterTools('xyzzy-not-a-tool').length, 0);
});
