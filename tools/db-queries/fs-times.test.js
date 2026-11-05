// Filernas tider ur metadata.msgpack: hela vägen från en byggd zip till posterna, och att zippens egna
// fält, där alla tre tiderna är åtkomsttiden, aldrig används när filen finns.

const test = require('node:test');
const assert = require('node:assert');
const zip = require('./zip');
const FsTimes = require('./fs-times');
const core = require('./extraction-core');
const { buildZip, reader } = require('./fixtures/zip-builder');

FsTimes.use({ ZipRead: zip });
core.use({ ZipRead: zip, FsTimes });

const S = 1000000000n;
const BTIME = 1700000000n;

// Msgpack för hand, som filerna ser ut: en karta från sökväg till en karta med fälten i bokstavsordning.
function str(s) {
    const b = Buffer.from(s, 'utf8');
    if (b.length < 32) return Buffer.concat([Buffer.from([0xa0 | b.length]), b]);
    if (b.length < 256) return Buffer.concat([Buffer.from([0xd9, b.length]), b]);
    const h = Buffer.alloc(3);
    h[0] = 0xda;
    h.writeUInt16BE(b.length, 1);
    return Buffer.concat([h, b]);
}
function uint(v) {
    const n = BigInt(v);
    if (n < 128n) return Buffer.from([Number(n)]);
    if (n < 65536n) { const h = Buffer.alloc(3); h[0] = 0xcd; h.writeUInt16BE(Number(n), 1); return h; }
    if (n < 4294967296n) { const h = Buffer.alloc(5); h[0] = 0xce; h.writeUInt32BE(Number(n), 1); return h; }
    const h = Buffer.alloc(9);
    h[0] = 0xcf;
    h.writeBigUInt64BE(n, 1);
    return h;
}
function map(pairs) {
    const body = pairs.flatMap(([k, v]) => [str(k), v]);
    const h = Buffer.alloc(5);
    h[0] = 0xdf;
    h.writeUInt32BE(pairs.length, 1);
    return Buffer.concat([h].concat(body));
}
function bin(b) { const h = Buffer.alloc(2); h[0] = 0xc4; h[1] = b.length; return Buffer.concat([h, b]); }

function record(t) {
    return map([
        ['atime', uint(t.a)], ['btime', uint(t.b)], ['ctime', uint(t.c)], ['gid', uint(501)], ['inode', uint(12345678901n)], ['links', uint(1)],
        ['mode', uint(t.mode === undefined ? 33188 : t.mode)], ['mtime', uint(t.m)], ['prot', uint(3)], ['size', uint(10)], ['uid', uint(501)],
        ['xattr', t.xattr ? map(t.xattr.map((k) => [k, bin(Buffer.from('bplist00'))])) : map([])],
    ]);
}

const FILES = {
    'private/var/mobile/Media/DCIM/100APPLE/IMG_0001.HEIC': { b: BTIME * S, m: BTIME * S + 123456789n, c: (BTIME + 5n) * S, a: (BTIME + 1000n) * S },
    'private/var/mobile/Media/DCIM/100APPLE/IMG_0002.HEIC': { b: BTIME * S, m: BTIME * S, c: BTIME * S, a: 0n, xattr: ['com.apple.assetsd.UUID', 'com.apple.assetsd.customLocation'] },
    'private/var/mobile/Media/DCIM/100APPLE': { b: BTIME * S, m: BTIME * S, c: BTIME * S, a: BTIME * S, mode: 16877 },
    'usr/en/fil/från/1970': { b: 0n, m: 1500000000n, c: BTIME * S, a: 0n },
    'private/var/mobile/åäö.db': { b: BTIME * S, m: (BTIME + 2n) * S, c: (BTIME + 3n) * S, a: (BTIME + 4n) * S },
};

function ffsZip(extra) {
    const ACCESS = Number(BTIME) + 1000;
    const zipFields = { ut: { m: ACCESS, a: ACCESS, c: ACCESS } };
    const pack = map(Object.entries(FILES).map(([k, t]) => [k, record(t)]));
    return buildZip([
        { name: 'extra/KeychainDump/backup_keychain_v2.plist', data: 'x' },
        { name: 'filesystem1/', data: '' },
        { name: 'metadata1/filesystem.msgpack', data: map([['mount_point', str('/')]]) },
        { name: 'metadata1/metadata.msgpack', data: pack },
        { name: 'filesystem1/private/var/mobile/Media/DCIM/100APPLE/IMG_0001.HEIC', data: 'bild1', ...zipFields },
        { name: 'filesystem1/private/var/mobile/Media/DCIM/100APPLE/IMG_0002.HEIC', data: 'bild2', ...zipFields },
        { name: 'filesystem1/usr/en/fil/från/1970', data: 'gammal', ...zipFields },
        { name: 'filesystem1/private/var/mobile/åäö.db', data: 'db', ...zipFields },
        { name: 'filesystem1/inte/i/metadata.txt', data: 'y', ...zipFields },
        { name: 'version', data: 'CLBX-0.3.1', ...zipFields },
    ].concat(extra || []), { zip64: true });
}

function fakeFile(buf, name) {
    const slice = (a, b) => ({ arrayBuffer: async () => buf.buffer.slice(buf.byteOffset + a, buf.byteOffset + Math.min(b, buf.length)) });
    return { name, size: buf.length, lastModified: 1, slice };
}

async function opened(buf) {
    const source = await core.openSource(fakeFile(buf || ffsZip(), 'EXTRACTION_FFS.zip'));
    const all = await zip.scan(source.read, (buf || ffsZip()).length, () => true);
    return { source, by: Object.fromEntries(all.entries.map((e) => [e.name, e])) };
}

test('posterna får tiderna ur metadata.msgpack, med del av sekund och riktiga namn', async () => {
    const { source, by } = await opened();
    assert.deepStrictEqual(source.fsTimes, { count: 4 });
    const e = by['filesystem1/private/var/mobile/Media/DCIM/100APPLE/IMG_0001.HEIC'];
    const t = core.entryTimes(e);
    assert.strictEqual(t.createdMs, Number(BTIME) * 1000, 'btime');
    assert.strictEqual(t.modifiedMs, Number(BTIME) * 1000 + 123, 'mtime, på millisekunden');
    assert.strictEqual(t.changedMs, (Number(BTIME) + 5) * 1000, 'ctime');
    assert.strictEqual(t.accessedMs, (Number(BTIME) + 1000) * 1000, 'atime');
    assert.strictEqual(t.thirdMs, null);
    assert.strictEqual(t.field, 'metadata.msgpack');
    assert.strictEqual(e.dosTime, '');
    assert.strictEqual(core.entryTime(e), '2023-11-14 22:13:20 UTC');
});

test('en tid som är noll är ingen tid, och attributet för platsen följer med', async () => {
    const { by } = await opened();
    const e = by['filesystem1/private/var/mobile/Media/DCIM/100APPLE/IMG_0002.HEIC'];
    assert.strictEqual(e.atime, null);
    assert.strictEqual(e.customLocation, true);
    assert.strictEqual(by['filesystem1/private/var/mobile/Media/DCIM/100APPLE/IMG_0001.HEIC'].customLocation, undefined);
    const old = by['filesystem1/usr/en/fil/från/1970'];
    assert.strictEqual(old.crtime, null);
    assert.strictEqual(core.entryTimes(old).modifiedMs, 1500, 'en äkta tid nära 1970 står kvar');
});

test('en fil som saknas i metadata får inga tider, i stället för åtkomsttiden', async () => {
    const { by } = await opened();
    const e = by['filesystem1/inte/i/metadata.txt'];
    assert.strictEqual(e.mtime, null);
    assert.strictEqual(e.atime, null);
    assert.strictEqual(e.timeField, 'metadata.msgpack');
    assert.strictEqual(e.dosTime, '');
    assert.strictEqual(core.entryTime(e), '');
    // Utanför filesystem1/ gäller zippens egna fält.
    assert.strictEqual(by.version.timeField, 'UT');
});

test('tiderna ändras inte när posten läses, och sökvägar med UTF-8 hittas', async () => {
    const { source, by } = await opened();
    const e = by['filesystem1/private/var/mobile/åäö.db'];
    assert.strictEqual(core.entryTimes(e).modifiedMs, (Number(BTIME) + 2) * 1000);
    const out = await zip.extract(source.read, e);
    assert.strictEqual(Buffer.from(out.bytes).toString(), 'db');
    assert.strictEqual(core.entryTimes(e).accessedMs, (Number(BTIME) + 4) * 1000);
    const noAtime = by['filesystem1/private/var/mobile/Media/DCIM/100APPLE/IMG_0002.HEIC'];
    await zip.extract(source.read, noAtime);
    assert.strictEqual(noAtime.atime, null, 'den lokala postens tider används inte');
});

test('kataloger tas inte med, och innehållsförteckningen i minnet ger samma tider', async () => {
    const buf = ffsZip();
    const source = await core.openSource(fakeFile(buf, 'x.zip'));
    const cache = await zip.cacheDirectory(source.read, buf.length);
    assert.strictEqual(cache.cached, true);
    const hit = await zip.scan(cache.read, buf.length, (n) => /IMG_0001/.test(n));
    assert.strictEqual(core.entryTimes(hit.entries[0]).modifiedMs, Number(BTIME) * 1000 + 123);
    const hit2 = await zip.scan(cache.read, buf.length, (n) => /IMG_0001/.test(n));
    assert.strictEqual(hit2.entries[0].timeField, 'metadata.msgpack');
});

test('en zip utan metadata använder sina egna fält och läser inte förteckningen en extra gång', async () => {
    const buf = buildZip([{ name: '/private/var/mobile/a.db', data: 'x', ut: { m: 1700000000, a: 1700000001, c: 1700000002, b: 1700000003 } }]);
    let reads = 0;
    const file = fakeFile(buf, 'lab_fs.zip');
    const orig = file.slice;
    file.slice = (a, b) => { reads++; return orig(a, b); };
    const source = await core.openSource(file);
    assert.strictEqual(source.fsTimes, null);
    assert.strictEqual(reads, 1, 'bara början av filen');
    const e = (await zip.scan(source.read, buf.length, () => true)).entries[0];
    assert.strictEqual(e.timeField, 'UT');
    assert.strictEqual(core.entryTimes(e).createdMs, 1700000003000);
    assert.strictEqual(core.entryTimes(e).changedMs, 1700000002000);
    // En zip som börjar likadant men saknar filen.
    const like = buildZip([{ name: 'filesystem1/a.db', data: 'x', ut: { m: 1700000000, a: 1700000000, c: 1700000000 } }]);
    assert.strictEqual((await core.openSource(fakeFile(like, 'x.zip'))).fsTimes, null);
});

test('en trasig metadata.msgpack sägs och stoppar inte', async () => {
    const buf = buildZip([
        { name: 'filesystem1/a.db', data: 'x', ut: { m: 1700000000, a: 1700000000, c: 1700000000 } },
        { name: 'metadata1/metadata.msgpack', data: Buffer.from([0x01, 0x02, 0x03]) },
    ]);
    const source = await core.openSource(fakeFile(buf, 'x.zip'));
    assert.strictEqual(source.fsTimes, null);
    assert.match(source.timesError, /ingen karta/);
    const e = (await zip.scan(source.read, buf.length, (n) => n === 'filesystem1/a.db')).entries[0];
    assert.strictEqual(e.timeField, 'UT');
});

test('nanosekunder blir exakta millisekunder, också över 2^53', () => {
    const ms = (v) => FsTimes.nsToMs(uint(v), 0);
    assert.strictEqual(ms(0n), null);
    assert.strictEqual(ms(1793704566123999999n), 1793704566123);
    assert.strictEqual(ms(1793704566124000000n), 1793704566124);
    assert.strictEqual(ms(4294967295n), 4294);
    const negative = Buffer.alloc(9);
    negative[0] = 0xd3;
    negative.writeBigInt64BE(-1000n, 1);
    assert.strictEqual(FsTimes.nsToMs(negative, 0), null, 'en tid före 1970 är ingen tid här');
});

test('alla former av värden kan hoppas över', () => {
    const odd = Buffer.concat([
        Buffer.from([0x82]),
        str('a/b.jpg'),
        Buffer.concat([
            Buffer.from([0x8a]),
            str('x1'), Buffer.from([0xc0]), str('x2'), Buffer.from([0xc3]), str('x3'), Buffer.from([0x92, 0x01, 0xa1, 0x41]),
            str('x4'), Buffer.from([0xcb, 0, 0, 0, 0, 0, 0, 0, 0]), str('x5'), Buffer.from([0xd4, 1, 2]), str('x6'), Buffer.from([0xc7, 2, 1, 9, 9]),
            str('x7'), Buffer.from([0xd9, 1, 0x41]), str('x8'), Buffer.from([0xcc, 1]), str('x9'), Buffer.from([0x81, 0xa1, 0x41, 0xe0]),
            str('mtime'), uint(1700000000000000000n),
        ]),
        str('c.jpg'),
        map([['mtime', uint(1600000000000000000n)]]),
    ]);
    const t = FsTimes.parse(new Uint8Array(odd));
    assert.strictEqual(t.count, 2);
    assert.strictEqual(t.times[t.map.get('a/b.jpg') * 4 + 1], 1700000000000);
    assert.strictEqual(t.times[t.map.get('c.jpg') * 4 + 1], 1600000000000);
    assert.throws(() => FsTimes.parse(new Uint8Array([0x81, 0xa1, 0x41, 0x81, 0xa1, 0x41, 0xc1])), /går inte att tolka/);
});
