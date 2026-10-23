// Zip-läsaren: lagrade och deflate-poster, Zip64, unixtid, CRC-kontroll och att källan
// aldrig ändras. Zipparna byggs här i testet.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const zip = require('./zip');

const inflate = async (b) => new Uint8Array(zlib.inflateRawSync(b));

// files: [{ name, data, deflate, mtime }]. zip64: alla storlekar och offset i Zip64-fält,
// och slutet med Zip64-post och locator, som de stora extraktionerna har.
function buildZip(files, opts) {
    opts = opts || {};
    const parts = [];
    const central = [];
    let offset = opts.lead ? opts.lead.length : 0;
    if (opts.lead) parts.push(opts.lead);
    for (const f of files) {
        const data = Buffer.from(f.data);
        const body = f.deflate ? zlib.deflateRawSync(data) : data;
        const name = Buffer.from(f.name, 'utf8');
        const crc = zip.crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(45, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(f.deflate ? 8 : 0, 8);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        // Ett extrafält i den lokala posten som inte finns i innehållsförteckningen: datan
        // måste räknas från den lokala postens längder.
        const localExtra = Buffer.from([0x99, 0x99, 4, 0, 1, 2, 3, 4]);
        local.writeUInt16LE(localExtra.length, 28);
        parts.push(local, name, localExtra, body);

        const extras = [];
        if (opts.zip64) {
            const z = Buffer.alloc(4 + 24);
            z.writeUInt16LE(0x0001, 0);
            z.writeUInt16LE(24, 2);
            z.writeBigUInt64LE(BigInt(data.length), 4);
            z.writeBigUInt64LE(BigInt(body.length), 12);
            z.writeBigUInt64LE(BigInt(offset), 20);
            extras.push(z);
        }
        if (f.mtime) {
            const ut = Buffer.alloc(9);
            ut.writeUInt16LE(0x5455, 0);
            ut.writeUInt16LE(5, 2);
            ut[4] = 1;
            ut.writeUInt32LE(f.mtime, 5);
            extras.push(ut);
        }
        const extra = Buffer.concat(extras);
        const c = Buffer.alloc(46);
        c.writeUInt32LE(0x02014b50, 0);
        c.writeUInt16LE(0x0800, 8);
        c.writeUInt16LE(f.deflate ? 8 : 0, 10);
        c.writeUInt16LE((13 << 11) | (25 << 5) | 18, 12);
        c.writeUInt16LE(((2024 - 1980) << 9) | (9 << 5) | 27, 14);
        c.writeUInt32LE(crc, 16);
        c.writeUInt32LE(opts.zip64 ? 0xffffffff : body.length, 20);
        c.writeUInt32LE(opts.zip64 ? 0xffffffff : data.length, 24);
        c.writeUInt16LE(name.length, 28);
        c.writeUInt16LE(extra.length, 30);
        c.writeUInt32LE(opts.zip64 ? 0xffffffff : offset, 42);
        central.push(c, name, extra);
        offset += local.length + name.length + localExtra.length + body.length;
    }
    const cd = Buffer.concat(central);
    const cdOffset = offset;
    parts.push(cd);
    if (opts.zip64) {
        const rec = Buffer.alloc(56);
        rec.writeUInt32LE(0x06064b50, 0);
        rec.writeBigUInt64LE(44n, 4);
        rec.writeBigUInt64LE(BigInt(files.length), 24);
        rec.writeBigUInt64LE(BigInt(files.length), 32);
        rec.writeBigUInt64LE(BigInt(cd.length), 40);
        rec.writeBigUInt64LE(BigInt(cdOffset), 48);
        const loc = Buffer.alloc(20);
        loc.writeUInt32LE(0x07064b50, 0);
        loc.writeBigUInt64LE(BigInt(cdOffset + cd.length), 8);
        loc.writeUInt32LE(1, 16);
        parts.push(rec, loc);
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(opts.zip64 ? 0xffff : files.length, 8);
    eocd.writeUInt16LE(opts.zip64 ? 0xffff : files.length, 10);
    eocd.writeUInt32LE(opts.zip64 ? 0xffffffff : cd.length, 12);
    eocd.writeUInt32LE(opts.zip64 ? 0xffffffff : cdOffset, 16);
    const comment = Buffer.from(opts.comment || '');
    eocd.writeUInt16LE(comment.length, 20);
    parts.push(eocd, comment);
    return Buffer.concat(parts);
}

function reader(buf) {
    return async (offset, length) => new Uint8Array(buf.buffer, buf.byteOffset + offset, Math.min(length, buf.length - offset));
}

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
    for (const f of ['zip.js', 'locate.js', 'extraction.js', 'run.js', 'wal.js']) {
        const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
        const hit = src.match(forbidden);
        assert.strictEqual(hit, null, f + ' använder ' + (hit && hit[0]));
    }
});
