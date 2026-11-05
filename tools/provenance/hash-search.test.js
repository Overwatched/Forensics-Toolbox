// Sök på hashsumma: vad som räknas som en summa, läsordningen, att sökningen stannar vid träff men
// ändå hittar alla kopior, att en summa som saknas betyder att alla filer lästs, cachen och avbrott.
// Zippen byggs här i testet.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const hs = require('./hash-search');
const zip = require('../db-queries/zip');
const hashing = require('../hash-calculator/hashing');
const { buildZip, reader } = require('../db-queries/fixtures/zip-builder');

const digest = (algo, data) => crypto.createHash(algo).update(Buffer.from(data)).digest('hex');

const FILES = [
    { name: 'private/var/mobile/Media/DCIM/100APPLE/IMG_0001.JPG', data: 'bild ett'.repeat(50) },
    { name: 'private/var/mobile/Containers/Data/Application/X/Library/Caches/0a1b2c', data: 'cachad bild'.repeat(40), deflate: true },
    { name: 'private/var/mobile/Media/DCIM/100APPLE/' },
    { name: 'private/var/mobile/Library/notes.txt', data: 'anteckning' },
    { name: 'private/var/mobile/Media/DCIM/100APPLE/IMG_0002.MOV', data: 'video'.repeat(300), deflate: true },
    // Samma innehåll som cachefilen, med en ändelse som läses sist.
    { name: 'private/var/mobile/Library/Kopia/bild.dat', data: 'cachad bild'.repeat(40) },
];

async function setup() {
    const files = FILES.map((f) => (f.data === undefined ? { name: f.name, data: '' } : f));
    const buf = buildZip(files);
    const read = reader(buf);
    const entries = (await zip.scan(read, buf.length, () => true)).entries;
    const streamed = [];
    const deps = {
        stream: (e, cb) => { streamed.push(e.name); return zip.stream(read, e, cb); },
        hasher: (a) => hashing.createHasher(a),
        shouldStop: () => false,
    };
    return { entries, deps, streamed };
}

test('algoOf: MD5, SHA-1 och SHA-256 efter längden, annars null', () => {
    assert.strictEqual(hs.algoOf(digest('md5', 'x')), 'md5');
    assert.strictEqual(hs.algoOf(' ' + digest('sha1', 'x').toUpperCase() + ' '), 'sha1');
    assert.strictEqual(hs.algoOf(digest('sha256', 'x')), 'sha256');
    assert.strictEqual(hs.algoOf('IMG_0001.JPG'), null);
    assert.strictEqual(hs.algoOf('c59503f8d37f48cc8a3aefb4aba984f'), null);
    assert.strictEqual(hs.algoOf('g59503f8d37f48cc8a3aefb4aba984fb'), null);
    assert.strictEqual(hs.label('sha256'), 'SHA-256');
});

test('läsordning: bilder och videor, filer utan ändelse, resten; mappar hoppas över', async () => {
    const { entries } = await setup();
    const tiers = hs.plan(entries);
    assert.deepStrictEqual(tiers.map((t) => t.entries.map((e) => e.name.split('/').pop())), [['IMG_0001.JPG', 'IMG_0002.MOV'], ['0a1b2c'], ['notes.txt', 'bild.dat']]);
    assert.strictEqual(tiers[0].text, 'bild- och videofilerna');
});

test('sökningen stannar vid träffen men hittar kopian med samma storlek och CRC32', async () => {
    const { entries, deps, streamed } = await setup();
    const cache = hs.emptyCache();
    const md5 = digest('md5', 'cachad bild'.repeat(40));
    const res = await hs.search(entries, [md5.toUpperCase()], cache, deps);
    assert.deepStrictEqual(Object.keys(res.found), [md5]);
    assert.deepStrictEqual(res.found[md5].map((e) => e.name.split('/').pop()), ['0a1b2c', 'bild.dat']);
    assert.deepStrictEqual(res.missing, []);
    assert.strictEqual(res.complete, false);
    // notes.txt (övriga filer) lästes aldrig; bild.dat bara som kopia.
    assert.ok(!streamed.some((n) => /notes\.txt$/.test(n)));
    assert.deepStrictEqual(streamed.map((n) => n.split('/').pop()), ['IMG_0001.JPG', 'IMG_0002.MOV', '0a1b2c', 'bild.dat']);
});

test('en summa som inte finns: alla filer lästa, och svaret säger det', async () => {
    const { entries, deps } = await setup();
    const cache = hs.emptyCache();
    const res = await hs.search(entries, [digest('md5', 'finns inte')], cache, deps);
    assert.strictEqual(res.complete, true);
    assert.strictEqual(res.total, 5);
    assert.strictEqual(res.read, 5);
    assert.deepStrictEqual(res.found, {});
    assert.strictEqual(hs.missingText('md5', res, (n) => n + ' byte'), 'Ingen fil i zippen har den MD5:n. Alla 5 filerna (' + res.totalBytes + ' byte) är genomsökta.');
    assert.strictEqual(hs.missingText('md5', res, (n) => n + ' byte', true), 'Ingen fil i rapporten har den MD5:n. Alla 5 filerna (' + res.totalBytes + ' byte) är genomsökta. En rapport är ett urval, så det säger inte att filen saknades på telefonen.');
});

test('SHA-1 och SHA-256 i samma sökning, och cachen gör nästa sökning utan läsning', async () => {
    const { entries, deps, streamed } = await setup();
    const cache = hs.emptyCache();
    const sha1 = digest('sha1', 'video'.repeat(300));
    const sha256 = digest('sha256', 'anteckning');
    const res = await hs.search(entries, [sha1, sha256], cache, deps);
    assert.deepStrictEqual(Object.keys(res.found).sort(), [sha1, sha256].sort());
    assert.strictEqual(res.found[sha256][0].name.split('/').pop(), 'notes.txt');
    const before = streamed.length;
    const again = await hs.search(entries, [sha256], cache, deps);
    assert.strictEqual(streamed.length, before);
    assert.strictEqual(again.found[sha256][0].name.split('/').pop(), 'notes.txt');
    assert.strictEqual(again.read, 0);
});

test('avbruten sökning och filer som inte går att läsa', async () => {
    const { entries, deps } = await setup();
    let n = 0;
    const stopped = await hs.search(entries, [digest('md5', 'finns inte')], hs.emptyCache(), Object.assign({}, deps, { shouldStop: () => n++ >= 1 }));
    assert.strictEqual(stopped.stopped, true);
    assert.strictEqual(stopped.complete, false);
    assert.strictEqual(hs.missingText('md5', stopped, String), 'Sökningen avbröts efter 1 av 5 filer, innan MD5:n hittades.');

    const broken = entries.map((e) => (/notes\.txt$/.test(e.name) ? Object.assign({}, e, { method: 12 }) : e));
    const res = await hs.search(broken, [digest('md5', 'finns inte')], hs.emptyCache(), deps);
    assert.strictEqual(res.complete, true);
    assert.strictEqual(res.skipped.length, 1);
    assert.match(hs.missingText('md5', res, String), /utom 1 fil som inte gick att läsa \(notes\.txt\)\.$/);
});

test('progress: grupp, antal och byte', async () => {
    const { entries, deps } = await setup();
    const seen = [];
    await hs.search(entries, [digest('md5', 'finns inte')], hs.emptyCache(), Object.assign({}, deps, { onProgress: (p) => seen.push(p) }));
    assert.strictEqual(seen.length, 5);
    assert.deepStrictEqual(seen.map((p) => p.tier), [0, 0, 1, 2, 2]);
    const last = seen[seen.length - 1];
    assert.strictEqual(last.done, last.total);
    assert.strictEqual(last.bytes, last.totalBytes);
    assert.strictEqual(last.doneBytes, last.totalBytes);
    assert.strictEqual(last.tierText, 'övriga filer');
});
