// Webbläsaren i Härkomst: vilken nedladdning en fil är, besöken strax före, och upplysningen Webbläsaren.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const W = require('./web-origin');
const core = require('./timeline-core');

const T = Date.UTC(2026, 10, 20, 13, 5, 0);
const M = 60000;
const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

test('sökvägen i den delade lagringen och MediaStores post', () => {
    assert.strictEqual(W.tail('/storage/emulated/0/Download/Bild.JPG'), 'download/bild.jpg');
    assert.strictEqual(W.tail('Dump/data/media/0/Download/Bild.jpg'), 'download/bild.jpg');
    assert.strictEqual(W.tail('/sdcard/Download/bild.jpg'), 'download/bild.jpg');
    assert.strictEqual(W.storeId('content://media/external/downloads/24'), 24);
    assert.strictEqual(W.storeId('content://media/external_primary/images/media/7'), 7);
    assert.strictEqual(W.storeId('/storage/emulated/0/Download/a.jpg'), null);
    assert.strictEqual(W.fileName('https://upload.wikimedia.org/a/b/Solros%20i%20f%C3%A4lt.jpg?x=1'), 'Solros i fält.jpg');
});

test('nedladdningen som filen är: MediaStores post före sökvägen, och namn och tid sist', () => {
    const store = { id: '1', path: 'content://media/external/downloads/24', url: 'https://example.org/a.jpg', startMs: T - M, endMs: T - M + 2000 };
    const path = { id: '2', path: '/storage/emulated/0/Download/a.jpg', url: 'https://example.org/a.jpg', startMs: T - 5 * M, endMs: T - 5 * M };
    const named = { id: '3', path: 'content://media/external/downloads/99', url: 'https://cdn.example.org/a.jpg', startMs: T - 2 * M, endMs: T - 2 * M };
    const file = { pk: 24, path: '/storage/emulated/0/Download/a.jpg', filename: 'a.jpg', addedMs: T };
    assert.deepStrictEqual(W.matchDownload(file, [named, path, store]), { d: store, how: 'mediastore' });
    assert.deepStrictEqual(W.matchDownload(Object.assign({}, file, { pk: 5 }), [named, path]), { d: path, how: 'path' });
    assert.deepStrictEqual(W.matchDownload({ pk: 5, path: '/storage/emulated/0/Pictures/a.jpg', filename: 'a.jpg', addedMs: T }, [named]), { d: named, how: 'name-time' });
    // Samma namn men en timme bort: ingen koppling.
    assert.strictEqual(W.matchDownload({ pk: 5, path: '/x/a.jpg', filename: 'a.jpg', addedMs: T + 60 * M }, [named]), null);
    assert.strictEqual(W.matchDownload(file, []), null);
});

test('besöken strax före: inom spannet, det senaste först', () => {
    const v = (id, ms) => ({ id, timeMs: ms, url: 'https://example.org/' + id });
    const list = [v('a', T - 20 * M), v('b', T - 9 * M), v('c', T - M), v('d', T + 3000), v('e', T + M)];
    assert.deepStrictEqual(W.visitsBefore(list, T, 10 * M, 5).map((x) => x.id), ['d', 'c', 'b']);
    assert.deepStrictEqual(W.visitsBefore(list, T, 10 * M, 1).map((x) => x.id), ['d']);
    assert.deepStrictEqual(W.visitsBefore(list, null, 10 * M, 5), []);
});

test('upplysningen Webbläsaren: nedladdningen med sidan, en sparad bild i Safari, och utan besök', () => {
    assert.strictEqual(core.factorWeb({ web: null }), null);
    const src = { db: 'com.android.chrome · History', table: 'downloads' };
    const down = core.factorWeb({ format: fmt, file: { pk: 24 }, web: {
        browser: { name: 'Chrome' }, how: 'mediastore', source: src, visitSource: src,
        download: { startMs: T, url: 'https://cdn.example.org/a.jpg', chain: 'https://example.org/a.jpg → https://cdn.example.org/a.jpg', tab: 'https://example.org/artikel' },
        visits: [{ timeMs: T - M, url: 'https://example.org/artikel', title: 'Artikeln' }] } });
    assert.strictEqual(down.id, 'web');
    assert.strictEqual(down.verdictText, 'Nedladdad i Chrome');
    assert.match(down.items[0].text, /^Filen laddades ner i Chrome 2026-11-20 13:05:00 från https:\/\/cdn\.example\.org\/a\.jpg, på sidan https:\/\/example\.org\/artikel \(omdirigerad: .* → .*\)\. Nedladdningens sökväg är filens post i MediaStore \(content:\/\/…\/24\)\.$/);
    assert.match(down.items[1].text, /Artikeln \(https:\/\/example\.org\/artikel\) 2026-11-20 13:04:00\.$/);
    assert.strictEqual(down.plain, 'Filen laddades ner i Chrome från https://cdn.example.org/a.jpg, på sidan https://example.org/artikel.');
    const guess = core.factorWeb({ format: fmt, file: {}, web: { browser: { name: 'Samsung Internet' }, how: 'name-time', download: { startMs: T, url: 'https://x/a.jpg' }, visits: [] } });
    assert.strictEqual(guess.verdictText, 'Kanske nedladdad i Samsung Internet');
    assert.match(guess.items[1].text, /inga besök de tio minuterna före/);
    const saved = core.factorWeb({ format: fmt, file: {}, web: { browser: { name: 'Safari' }, savedMs: T, visits: [{ timeMs: T - 30000, url: 'https://sv.wikipedia.org/wiki/Solros', title: 'Solros – Wikipedia' }] } });
    assert.strictEqual(saved.verdictText, 'Sparad ur Safari');
    assert.strictEqual(saved.plain, 'Safari sparade filen i bildbiblioteket. Strax före besöktes Solros – Wikipedia.');
});
