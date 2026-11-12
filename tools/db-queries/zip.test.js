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

test('krypterad post och okänd metod ger tydliga fel', async () => {
    const buf = buildZip([{ name: 'a.db', data: 'abc' }]);
    const e = (await zip.scan(reader(buf), buf.length, () => true)).entries[0];
    await assert.rejects(zip.extract(reader(buf), Object.assign({}, e, { flags: 1 })), /krypterad/);
    await assert.rejects(zip.extract(reader(buf), Object.assign({}, e, { method: 12 })), /metod 12/);
});

const BIG = Buffer.alloc(300000);
for (let i = 0; i < BIG.length; i++) BIG[i] = (i * 31 + (i >> 8)) & 0xff;

for (const method of ['lagrad', 'deflate']) {
    test('en stor post läses i bitar till samma bytes och samma CRC32 (' + method + ')', async () => {
        const buf = buildZip([{ name: 'stor.db', data: BIG, deflate: method === 'deflate' }]);
        const e = (await zip.scan(reader(buf), buf.length, () => true)).entries[0];
        assert.strictEqual(e.method, method === 'lagrad' ? 0 : 8);
        const whole = await zip.extract(reader(buf), e);
        const parts = await zip.extract(reader(buf), e, { piece: 4096 });
        assert.ok(parts.crcOk && whole.crcOk);
        assert.ok(Buffer.from(parts.bytes).equals(BIG), 'bitarna ger samma bytes');
        const bad = await zip.extract(reader(buf), Object.assign({}, e, { crc32: (e.crc32 ^ 1) >>> 0 }), { piece: 4096 });
        assert.strictEqual(bad.crcOk, false);
    });
}

test('en post som är större eller mindre än zippen anger ger fel, i bitar också', async () => {
    const buf = buildZip([{ name: 'stor.db', data: BIG }]);
    const e = (await zip.scan(reader(buf), buf.length, () => true)).entries[0];
    await assert.rejects(zip.extract(reader(buf), Object.assign({}, e, { size: e.size - 10 }), { piece: 4096 }), /fel storlek/);
    await assert.rejects(zip.extract(reader(buf), Object.assign({}, e, { size: e.size + 10 }), { piece: 4096 }), /fel storlek/);
});

test('slut på minne säger vad det gäller och vad som går att göra, andra fel lämnas orörda', async () => {
    const buf = buildZip([{ name: 'mapp/signal.sqlite', data: BIG }]);
    const e = (await zip.scan(reader(buf), buf.length, () => true)).entries[0];
    const opts = { piece: 4096, alloc: () => { throw new RangeError('Array buffer allocation failed'); } };
    await assert.rejects(zip.extract(reader(buf), e, opts), /mapp\/signal\.sqlite är 0,0 GB och får inte plats i minnet/);
    const other = new RangeError('Invalid typed array length');
    assert.strictEqual(zip.friendlyMemory(other, 'a', 1), other);
    assert.match(zip.friendlyMemory(new RangeError('Out of memory'), 'a', 5368709120).message, /a är 5,0 GB/);
});

test('CRC32 är samma över gränsen mellan bitarna', () => {
    const size = 64 * 1024 * 1024 + 1000;
    const bytes = new Uint8Array(size);
    bytes[size - 1] = 7;
    bytes[64 * 1024 * 1024] = 9;
    let c = 0xffffffff;
    const table = new Int32Array(256).map((_, n) => { let x = n; for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1; return x; });
    for (let i = 0; i < size; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    assert.strictEqual(zip.crc32(bytes), (c ^ 0xffffffff) >>> 0);
});

test('en fil från disk läses i bitar till samma bytes', async () => {
    const file = { name: 'a.db', size: BIG.length, slice: (a, b) => new Blob([BIG.subarray(a, b)]) };
    assert.ok(Buffer.from(await zip.readFile(file, { piece: 4096 })).equals(BIG));
    assert.ok(Buffer.from(await zip.readFile(file)).equals(BIG));
    await assert.rejects(zip.readFile(file, { alloc: () => { throw new RangeError('Array buffer allocation failed'); } }), /a\.db är 0,0 GB/);
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
    const files = ['zip.js', 'ufdr.js', 'fs-times.js', 'locate.js', 'extraction.js', 'extraction-core.js', 'run.js', 'wal.js'].map((f) => path.join(__dirname, f));
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

test('innehållsförteckningen läses från disk en gång och sedan ur minnet', async () => {
    const buf = buildZip(FILES, { zip64: true, comment: 'slut' });
    let diskReads = 0;
    const raw = reader(buf);
    const counting = async (o, l) => { diskReads++; return raw(o, l); };
    const progress = [];
    const cache = await zip.cacheDirectory(counting, buf.length, null, (done, total) => progress.push([done, total]));
    assert.strictEqual(cache.cached, true);
    assert.strictEqual(cache.entries, 3);
    assert.ok(cache.directorySize > 0 && progress[progress.length - 1][0] === cache.directorySize);
    const before = diskReads;
    const a = await zip.scan(cache.read, buf.length, () => true);
    const b = await zip.scan(cache.read, buf.length, (n) => /routined/.test(n));
    assert.strictEqual(a.count, 3);
    assert.deepStrictEqual(b.entries.map((e) => e.name), FILES.slice(0, 2).map((f) => f.name));
    // Per sökning läses bara zippens svans (EOCD och Zip64-huvudet) från disk, inte förteckningen.
    assert.ok(diskReads - before <= 4, 'förteckningen lästes från disk igen: ' + (diskReads - before) + ' läsningar');
    const out = await zip.extract(cache.read, b.entries[1], { inflate });
    assert.strictEqual(Buffer.from(out.bytes).toString(), FILES[1].data);
    assert.strictEqual(out.crcOk, true);
    const tooBig = await zip.cacheDirectory(counting, buf.length, { maxBytes: 10 });
    assert.strictEqual(tooBig.cached, false);
    assert.strictEqual(tooBig.read, counting, 'över gränsen används disken som förut');
    assert.strictEqual(tooBig.entries, 3);
});

test('alla tider i zippen: UT med tre eller fyra tider, UT i den lokala posten, och NTFS före UT', async () => {
    const M = 1759303248, A = 1759303300, C = 1759300000, B = 1759200000;
    const buf = buildZip([
        { name: 'ut-alla.jpg', data: 'a', ut: { m: M, a: A, c: C } },
        { name: 'ut-fyra.jpg', data: 'a', ut: { m: M, a: A, c: C, b: B } },
        { name: 'ut-ingen-fjarde.jpg', data: 'a', ut: { m: M, a: A, c: C, b: 0 } },
        { name: 'infozip.jpg', data: 'b', utLocal: { m: M, a: A, c: C } },
        { name: 'infozip-fyra.jpg', data: 'b', utLocal: { m: M, a: A, c: C, b: B } },
        { name: 'ut-och-ntfs.jpg', data: 'c', ut: { m: M, a: A, c: C, b: B }, ntfs: { m: M, a: A, c: C - 5 } },
        { name: 'ntfs.jpg', data: 'c', ntfs: { m: M + 0.25, a: A, c: C }, mtime: M - 3600 },
        { name: 'bara-dos.jpg', data: 'd' },
    ]);
    const read = reader(buf);
    const e = Object.fromEntries((await zip.scan(read, buf.length, () => true)).entries.map((x) => [x.name, x]));
    // Tre tider: det syns inte i zippen om den tredje är skapad eller ctime, så den är ingen skapandetid.
    assert.deepStrictEqual([e['ut-alla.jpg'].mtime, e['ut-alla.jpg'].atime, e['ut-alla.jpg'].utThird, e['ut-alla.jpg'].crtime, e['ut-alla.jpg'].ctime, e['ut-alla.jpg'].timeField], [M, A, C, null, null, 'UT']);
    // Fyra tider: den tredje är ctime och den fjärde skapandetiden.
    assert.deepStrictEqual([e['ut-fyra.jpg'].mtime, e['ut-fyra.jpg'].atime, e['ut-fyra.jpg'].ctime, e['ut-fyra.jpg'].crtime, e['ut-fyra.jpg'].utThird], [M, A, C, B, null]);
    // Saknas den fjärde (flaggan 8 sätts inte när tiden är 0) är det tre tider.
    assert.deepStrictEqual([e['ut-ingen-fjarde.jpg'].utThird, e['ut-ingen-fjarde.jpg'].crtime], [C, null]);
    // NTFS ersätter UT: inget ctime eller tredje UT-tid blir kvar bredvid NTFS-tiderna.
    assert.deepStrictEqual([e['ut-och-ntfs.jpg'].timeField, e['ut-och-ntfs.jpg'].ctime, e['ut-och-ntfs.jpg'].utThird], ['NTFS', null, null]);
    assert.ok(Math.abs(e['ut-och-ntfs.jpg'].crtime - (C - 5)) < 1e-3);
    // Info-ZIP: innehållsförteckningen har bara ändringen; resten kommer ur den lokala posten när posten läses.
    assert.deepStrictEqual([e['infozip.jpg'].mtime, e['infozip.jpg'].atime, e['infozip.jpg'].utThird], [M, null, null]);
    await zip.extract(read, e['infozip.jpg']);
    assert.deepStrictEqual([e['infozip.jpg'].mtime, e['infozip.jpg'].atime, e['infozip.jpg'].utThird, e['infozip.jpg'].crtime], [M, A, C, null]);
    await zip.extract(read, e['infozip-fyra.jpg']);
    assert.deepStrictEqual([e['infozip-fyra.jpg'].atime, e['infozip-fyra.jpg'].ctime, e['infozip-fyra.jpg'].crtime], [A, C, B]);
    // NTFS går före UT och har delar av sekunder.
    assert.strictEqual(e['ntfs.jpg'].timeField, 'NTFS');
    assert.ok(Math.abs(e['ntfs.jpg'].mtime - (M + 0.25)) < 1e-3, 'ändringstiden ur NTFS, inte UT');
    assert.ok(Math.abs(e['ntfs.jpg'].crtime - C) < 1e-3);
    assert.deepStrictEqual([e['bara-dos.jpg'].mtime, e['bara-dos.jpg'].timeField, e['bara-dos.jpg'].dosTime], [null, '', '2024-09-27 13:25:36']);
});

test('stream lämnar posten i bitar: lagrad och deflate, liten och större än en bit, Zip64', async () => {
    const big = Buffer.alloc(300000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 7919) % 251;
    const files = [
        { name: 'a/liten.jpg', data: 'liten bild' },
        { name: 'a/tom', data: '' },
        { name: 'a/stor.mov', data: big },
        { name: 'a/stor-deflate.mov', data: big, deflate: true },
        { name: 'a/text.txt', data: 'packad '.repeat(4000), deflate: true },
    ];
    for (const zip64 of [false, true]) {
        const buf = buildZip(files, { zip64 });
        const read = reader(buf);
        const entries = (await zip.scan(read, buf.length, () => true)).entries;
        for (const chunk of [undefined, 4096]) {
            for (let i = 0; i < files.length; i++) {
                const parts = [];
                const n = await zip.stream(read, entries[i], (b) => parts.push(Buffer.from(b)), chunk ? { chunk } : {});
                const want = Buffer.from(files[i].data);
                assert.strictEqual(n, want.length, files[i].name);
                assert.ok(Buffer.concat(parts).equals(want), files[i].name + (chunk ? ' i bitar' : ''));
                if (chunk && want.length > chunk) assert.ok(parts.length > 1, files[i].name + ' ska komma i flera bitar');
            }
        }
    }
});

test('stream: krypterad post, okänd metod och avkortad post ger fel', async () => {
    const buf = buildZip([{ name: 'x.jpg', data: 'abc'.repeat(100) }]);
    const read = reader(buf);
    const e = (await zip.scan(read, buf.length, () => true)).entries[0];
    await assert.rejects(zip.stream(read, Object.assign({}, e, { flags: 1 }), () => {}), /krypterad/);
    await assert.rejects(zip.stream(read, Object.assign({}, e, { method: 12 }), () => {}), /metod 12/);
    await assert.rejects(zip.stream(read, Object.assign({}, e, { size: e.size + 1 }), () => {}), /fel storlek/);
    const cut = buf.subarray(0, 60);
    await assert.rejects(zip.stream(reader(cut), e, () => {}, { chunk: 16 }), /i förtid|fel storlek/);
});

test('0x4b47: platsen satt i Bilder märks på posten', async () => {
    const key = Buffer.from('com.apple.assetsd.customLocation\0abc', 'latin1');
    const field = Buffer.alloc(4 + key.length);
    field.writeUInt16LE(0x4b47, 0);
    field.writeUInt16LE(key.length, 2);
    key.copy(field, 4);
    const buf = buildZip([{ name: 'a.jpg', data: Buffer.from('x'), centralExtra: field }, { name: 'b.jpg', data: Buffer.from('y') }]);
    const scan = await zip.scan(reader(buf), buf.length, () => true);
    assert.deepStrictEqual(scan.entries.map((e) => !!e.customLocation), [true, false]);
});

for (const zip64 of [false, true]) {
    test('innehållsförteckningen i minnet ger samma poster som en läsning från disk, ' + (zip64 ? 'Zip64' : 'vanlig zip'), async () => {
        const files = FILES.concat([{ name: 'åäö/fil med namn.txt', data: 'x', ut: { m: 1700000000, a: 1700000001, c: 1700000002, b: 1700000003 } }]);
        const buf = buildZip(files, { zip64, comment: 'kommentar', lead: Buffer.from('stubbe') });
        const disk = reader(buf);
        const cached = await zip.cacheDirectory(disk, buf.length);
        assert.ok(cached.read.directory, 'förteckningen ligger i minnet');
        const seen = { disk: [], cached: [] };
        const keep = (list) => (name, size, crc) => { list.push([name, size, crc]); return /routined|åäö/.test(name); };
        const a = await zip.scan(disk, buf.length, keep(seen.disk));
        const b = await zip.scan(cached.read, buf.length, keep(seen.cached));
        assert.deepStrictEqual(b, a);
        assert.deepStrictEqual(seen.cached, seen.disk, 'keep får samma namn, storlek och CRC32');
        assert.ok(b.entries.some((e) => e.name.startsWith('åäö') && e.ctime === 1700000002 && e.crtime === 1700000003));
    });
}

test('innehållsförteckningen i minnet: namnen avkodas en gång, posterna är nya och extract fungerar', async () => {
    const buf = buildZip(FILES, {});
    const cached = await zip.cacheDirectory(reader(buf), buf.length);
    const a = await zip.scan(cached.read, buf.length, () => true);
    const names = cached.read.directory.names;
    const b = await zip.scan(cached.read, buf.length, () => true);
    assert.strictEqual(cached.read.directory.names, names, 'samma lista med namn');
    assert.notStrictEqual(a.entries[0], b.entries[0], 'en post som ändras av extract påverkar inte nästa sökning');
    const out = await zip.extract(cached.read, b.entries[0], { inflate });
    assert.strictEqual(Buffer.from(out.bytes).toString(), FILES[0].data);
    let progress = null;
    await zip.scan(cached.read, buf.length, () => false, (done, total) => { progress = [done, total]; });
    assert.strictEqual(progress[0], progress[1]);
});

test('innehållsförteckningen i minnet: en trasig förteckning ger samma fel som från disk', async () => {
    const buf = Buffer.from(buildZip(FILES, {}));
    const dir = await zip.readDirectory(reader(buf), buf.length);
    const cut = Buffer.from(buf);
    cut.writeUInt32LE(0, dir.offset);
    const messages = async (b) => {
        const fromDisk = await zip.scan(reader(b), b.length, () => false).catch((e) => e.message);
        const cached = await zip.cacheDirectory(reader(b), b.length);
        const fromMemory = await zip.scan(cached.read, b.length, () => false).catch((e) => e.message);
        return [fromDisk, fromMemory];
    };
    const [d, m] = await messages(cut);
    assert.match(d, /trasig \(post 1\)/);
    assert.strictEqual(m, d);
});

// Sökningar som säger vad de gäller (keep.bases, keep.crc) slår upp posterna i förteckningen i minnet.
// Svaret ska vara detsamma som när alla poster gås igenom, i samma ordning.
for (const zip64 of [false, true]) {
    test('en sökning efter filnamn eller CRC32 slår upp posterna och ger samma svar, ' + (zip64 ? 'Zip64' : 'vanlig zip'), async () => {
        const files = [];
        for (let i = 0; i < 1500; i++) {
            files.push({ name: 'fs/mapp' + (i % 37) + '/', data: '' });
            files.push({ name: 'fs/mapp' + (i % 37) + '/IMG_' + String(i % 400).padStart(4, '0') + (i % 3 ? '.JPG' : '.jpg'), data: 'bild ' + (i % 250) });
            files.push({ name: 'fs/annat/fil' + i + '.bin', data: i % 5 ? 'x' + i : '' });
        }
        files.push({ name: 'IMG_0007.JPG', data: 'i roten' }, { name: 'fs/räksmörgås/ÅÄÖ.heic', data: 'bild 7' });
        const buf = buildZip(files, { zip64 });
        const cache = await zip.cacheDirectory(reader(buf), buf.length);
        const base = (n) => n.slice(n.lastIndexOf('/') + 1).toLowerCase();
        const cases = [
            { bases: ['img_0007.jpg'] },
            { bases: ['img_0007.jpg', 'åäö.heic', 'finns-inte.png', 'fil12.bin'] },
            { bases: [], crc: zip.crc32(Buffer.from('bild 7')) },
            // Tomma filer och mappar är många: där är uppslaget stort, och svaret ändå detsamma.
            { bases: ['img_0399.jpg'], crc: zip.crc32(Buffer.from('')), many: true },
            { bases: [''], many: true },
            { bases: [] },
        ];
        for (const c of cases) {
            const rule = (name, size, crc) => c.bases.includes(base(name)) || c.crc != null && crc === c.crc;
            let asked = 0;
            const hinted = Object.assign((name, size, crc) => { asked++; return rule(name, size, crc); }, { bases: c.bases, crc: c.crc });
            const a = await zip.scan(cache.read, buf.length, rule);
            const b = await zip.scan(cache.read, buf.length, hinted);
            assert.deepStrictEqual(b, a, JSON.stringify(c));
            assert.ok(c.many || asked < 200, 'uppslaget prövade ' + asked + ' av ' + a.count + ' poster för ' + JSON.stringify(c));
            // Utan förteckningen i minnet gås alla poster igenom som förut, med samma svar.
            assert.deepStrictEqual((await zip.scan(reader(buf), buf.length, hinted)).entries, a.entries);
        }
        const seven = await zip.scan(cache.read, buf.length, Object.assign((n) => base(n) === 'img_0007.jpg', { bases: ['img_0007.jpg'] }));
        assert.strictEqual(seven.entries.length, 5);
        assert.strictEqual(seven.entries[seven.entries.length - 1].name, 'IMG_0007.JPG');
    });
}
