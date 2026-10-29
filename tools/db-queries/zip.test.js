// Zip-läsaren: lagrade och deflate-poster, Zip64, unixtid, CRC-kontroll och att källan
// aldrig ändras. Zipparna byggs här i testet.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const zip = require('./zip');

const inflate = async (b) => new Uint8Array(zlib.inflateRawSync(b));

const { buildZip, reader } = require('./fixtures/zip-builder');

const FILES = [
    { name: 'filesystem1/private/var/mobile/Library/Caches/com.apple.routined/Cache.sqlite', data: 'databasen'.repeat(500), mtime: 1727436336 },
    { name: 'filesystem1/private/var/mobile/Library/Caches/com.apple.routined/Cache.sqlite-wal', data: 'wal-innehåll'.repeat(300), deflate: true, mtime: 1727436337 },
    { name: 'filesystem1/annat/fil.txt', data: 'hej' },
];

for (const zip64 of [false, true]) {
    test('poster läses rätt, ' + (zip64 ? 'Zip64' : 'vanlig zip'), async () => {
        const buf = buildZip(FILES, { zip64, comment: 'kommentar på slutet', lead: Buffer.from('självuppackande stubbe') });
        const read = reader(buf);
        const scan = await zip.scan(read, buf.length, (n) => /routined/.test(n));
        assert.strictEqual(scan.count, 3);
        assert.strictEqual(scan.expected, 3);
        assert.strictEqual(scan.zip64, zip64);
        assert.deepStrictEqual(scan.entries.map((e) => e.name), FILES.slice(0, 2).map((f) => f.name));
        for (let i = 0; i < 2; i++) {
            const e = scan.entries[i];
            assert.strictEqual(e.mtime, FILES[i].mtime);
            assert.strictEqual(e.dosTime, '2024-09-27 13:25:36');
            const out = await zip.extract(read, e, { inflate });
            assert.strictEqual(Buffer.from(out.bytes).toString(), FILES[i].data);
            assert.strictEqual(out.crcOk, true);
        }
    });
}

test('innehållsförteckning större än en läsbit', async () => {
    const many = [];
    for (let i = 0; i < 70000; i++) many.push({ name: 'filesystem1/mapp/' + String(i).padStart(6, '0') + '-' + 'x'.repeat(100), data: '' });
    many.push({ name: 'filesystem1/sist.db', data: 'sist' });
    const buf = buildZip(many, { zip64: true });
    const scan = await zip.scan(reader(buf), buf.length, (n) => n.endsWith('.db'));
    assert.strictEqual(scan.count, 70001);
    assert.strictEqual(scan.entries.length, 1);
    assert.strictEqual(Buffer.from((await zip.extract(reader(buf), scan.entries[0])).bytes).toString(), 'sist');
});

test('fel CRC flaggas men stoppar inte', async () => {
    const buf = buildZip([{ name: 'a.db', data: 'abcdef' }]);
    const scan = await zip.scan(reader(buf), buf.length, () => true);
    const bad = Object.assign({}, scan.entries[0], { crc32: (scan.entries[0].crc32 ^ 1) >>> 0 });
    const out = await zip.extract(reader(buf), bad);
    assert.strictEqual(out.crcOk, false);
    assert.strictEqual(Buffer.from(out.bytes).toString(), 'abcdef');
});

test('krypterad post, okänd metod och för stor fil ger tydliga fel', async () => {
    const buf = buildZip([{ name: 'a.db', data: 'abc' }]);
    const e = (await zip.scan(reader(buf), buf.length, () => true)).entries[0];
    await assert.rejects(zip.extract(reader(buf), Object.assign({}, e, { flags: 1 })), /krypterad/);
    await assert.rejects(zip.extract(reader(buf), Object.assign({}, e, { method: 12 })), /metod 12/);
    await assert.rejects(zip.extract(reader(buf), Object.assign({}, e, { size: zip.MAX_ENTRY + 1 })), /1,5 GB/);
});

test('ingen zip eller avkortad zip ger tydliga fel', async () => {
    const junk = Buffer.alloc(5000, 7);
    await assert.rejects(zip.scan(reader(junk), junk.length, () => true), /ingen zip-fil/);
    const buf = buildZip(FILES, { zip64: true });
    const cut = buf.subarray(0, buf.length - 200);
    await assert.rejects(zip.scan(reader(cut), cut.length, () => true), /zip/);
});

test('källan ändras inte av läsningen', async () => {
    const buf = buildZip(FILES, { zip64: true });
    const copy = Buffer.from(buf);
    const read = reader(buf);
    const scan = await zip.scan(read, buf.length, () => true);
    for (const e of scan.entries) await zip.extract(read, e, { inflate });
    assert.ok(buf.equals(copy));
});

test('crc32 ger standardvärdet för 123456789', () => {
    assert.strictEqual(zip.crc32(Buffer.from('123456789')), 0xcbf43926);
});

// Extraktionsdelen får bara läsa. Inga API:er som kan skriva till filer eller nå huvudprocessen.
test('extraktionskoden använder inga skrivande API:er', () => {
    const forbidden = /createWritable|showOpenFilePicker|showSaveFilePicker|showDirectoryPicker|FileSystemHandle|forensicsMedia|ipcRenderer|require\(|\bfs\.|localStorage|indexedDB/;
    const files = ['zip.js', 'locate.js', 'extraction.js', 'extraction-core.js', 'run.js', 'wal.js'].map((f) => path.join(__dirname, f));
    // Härkomst läser extraktionen med samma moduler. Alla dess filer, även nya, omfattas.
    const provenance = path.join(__dirname, '..', 'provenance');
    if (fs.existsSync(provenance)) {
        for (const f of fs.readdirSync(provenance)) if (/\.js$/.test(f) && !/\.test\.js$/.test(f)) files.push(path.join(provenance, f));
    }
    assert.ok(files.length >= 6);
    for (const file of files) {
        const f = path.relative(__dirname, file);
        if (!fs.existsSync(file)) continue;
        const src = fs.readFileSync(file, 'utf8');
        const hit = src.match(forbidden);
        assert.strictEqual(hit, null, f + ' använder ' + (hit && hit[0]));
    }
});

test('keep får namn, storlek och CRC32 ur innehållsförteckningen', async () => {
    const buf = buildZip([{ name: 'a/one.bin', data: Buffer.from('hello') }, { name: 'b/two.bin', data: Buffer.from('hello') }, { name: 'c/other.bin', data: Buffer.from('world') }]);
    const seen = [];
    const scan = await zip.scan(reader(buf), buf.length, (name, size, crc) => { seen.push([name, size, crc]); return size === 5 && crc === zip.crc32(Buffer.from('hello')); });
    assert.strictEqual(seen.length, 3);
    assert.ok(seen.every(([, size, crc]) => size === 5 && typeof crc === 'number'));
    assert.deepStrictEqual(scan.entries.map((e) => e.name), ['a/one.bin', 'b/two.bin']);
});
