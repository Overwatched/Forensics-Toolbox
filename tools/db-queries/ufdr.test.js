// UFDR-läsaren: report.xml läses i bitar och blir en innehållsförteckning med telefonens sökvägar och
// namngivna tider. Fällorna kommer från två riktiga rapporter (docs/DEVELOPMENT.md); rapporterna byggs här.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const zip = require('./zip');
const Ufdr = require('./ufdr');
const { buildUfdr, buildReport } = require('./fixtures/ufdr-builder');
const { buildZip, reader } = require('./fixtures/zip-builder');

Ufdr.use({ ZipRead: zip });

const T = Date.UTC(2026, 10, 3, 11, 16, 6);
const DOS_ZERO = Date.UTC(1980, 0, 1);
const IMG = '/private/var/mobile/Media/DCIM/100APPLE/IMG_0033.HEIC';
const KEY = '/Imported GrayKey Keychain/00008030_keychain.plist';

const ROWS = [
    {
        path: IMG, data: 'ftypheic-bilden', tag: 'Image', c: T, m: T + 1000, a: T + 2000, service: 'com.apple.camera', origin: 'Device Captured', originReason: 'Native Camera App',
        metaData: [['Innehåll med slutet av avsnittet', 'text </metadata> <file path="/ska/inte/lasas" size="9"> ]] slut'], ['ExifEnumMake', 'Apple']],
    },
    {
        path: '/private/var/mobile/Containers/Data/Application/ABC/Documents/original.jpg', data: 'samma innehåll', tag: 'Image', c: T - 5000, m: T - 4000, a: T - 3000,
        related: [{ path: '/private/var/mobile/Containers/Data/Application/DEF/Documents/kopia.jpg', member: 'files\\Image\\original.jpg', data: 'samma innehåll', tag: 'Image', c: T - 9000, m: T - 8000, a: T - 7000 }],
    },
    { path: '/private/var/mobile/Library/signal.sqlite-wal', data: '', tag: 'Uncategorized', member: null, local: 'files\\Uncategorized\\tom-post-som-saknas', c: T, m: T, a: T },
    { path: '/private/var/mobile/Media/DCIM/100APPLE/IMG_0003.PNG', data: 'raderad', tag: 'Image', deleted: 'Trash', c: T, m: T, a: T, d: T + 123 },
    // Physical Analyzers ersättning för en tid som saknas, och en äkta tid samma sekund.
    { path: '/System/Library/utan-tider.strings', data: 'x', tag: 'Configuration', m: DOS_ZERO },
    { path: '/System/Library/akta-1980.strings', data: 'y', tag: 'Configuration', c: DOS_ZERO, m: DOS_ZERO, a: T },
    { path: '/System/Library/utan-atkomst.plist', data: 'z', tag: 'Configuration', c: T, m: T },
    { path: '/var/mobile/konstig & <namn>/åäö "citat".jpg', local: 'files\\Image\\konstig.jpg', data: 'tecken', tag: 'Image', c: T, m: T, a: T },
    // Utvunnet ur andra filer: märkt, eller med en fil i sökvägen.
    { path: '/private/var/mobile/Library/signal.sqlite', data: 'krypterad', tag: 'Database', c: T, m: T, a: T },
    { path: '/private/var/mobile/Library/signal.sqlite/signal.sqlite.decrypted', data: 'dekrypterad', tag: 'Database', embedded: true },
    { path: '/private/var/mobile/Library/arkiv.zip', data: 'zip', tag: 'Archives', c: T, m: T, a: T },
    { path: '/private/var/mobile/Library/arkiv.zip/bild.jpg', data: 'ur arkivet', tag: 'Image', m: T },
    { path: '/private/var/mobile/Library/borta.zip/utvunnen.jpg', data: 'märkt, men föräldern finns inte i rapporten', tag: 'Image', embedded: true },
    { path: KEY, data: '<plist/>', tag: 'Configuration', fs: 'Keychain' },
];

async function opened(rows, opts) {
    const { buf, xml } = buildUfdr(rows || ROWS, opts);
    const read = reader(buf);
    const r = await Ufdr.open(read, buf.length, opts && opts.index);
    const all = await zip.scan(r.read, buf.length, () => true);
    const by = Object.fromEntries(all.entries.map((e) => [e.name, e]));
    return { buf, xml, read: r.read, report: r.report, all, by };
}

test('filerna får telefonens sökvägar och de namngivna tiderna', async () => {
    const { by, read, report } = await opened();
    const e = by[IMG];
    assert.ok(e, 'bilden finns under telefonens sökväg');
    assert.strictEqual(e.mtime, (T + 1000) / 1000, 'ModifyTime är ändringstiden');
    assert.strictEqual(e.atime, (T + 2000) / 1000, 'AccessTime är åtkomsttiden');
    assert.strictEqual(e.crtime, T / 1000, 'CreationTime är skapandetiden');
    assert.strictEqual(e.ctime, null, 'rapporter har ingen ctime');
    assert.strictEqual(e.timeField, 'report.xml');
    assert.strictEqual(e.dosTime, '');
    assert.strictEqual(e.report.member, 'files/Image/IMG_0033.HEIC');
    assert.strictEqual(e.report.tags, 'Image');
    assert.strictEqual(e.report.origin, 'Device Captured');
    assert.strictEqual(e.report.originReason, 'Native Camera App');
    assert.strictEqual(e.report.service, 'com.apple.camera');
    const out = await zip.extract(read, e);
    assert.strictEqual(Buffer.from(out.bytes).toString(), 'ftypheic-bilden');
    assert.strictEqual(out.crcOk, true);
    assert.strictEqual(e.report.sha256, crypto.createHash('sha256').update('ftypheic-bilden').digest('hex'));
    assert.strictEqual(report.paVersion, '10.11.0.3022');
    assert.strictEqual(report.device, 'Apple iOS Full File system');
    assert.deepStrictEqual(report.sources.map((s) => [s.path, s.verify]), [['extraktion_fs.zip', 'Verified']]);
});

test('postens egna tider i rapporten läses inte: report.xml är källan', async () => {
    const { by, read } = await opened();
    const e = by['/System/Library/utan-atkomst.plist'];
    assert.strictEqual(e.atime, null);
    await zip.extract(read, e);
    assert.strictEqual(e.atime, null, 'den lokala posten har rapportfilens tider');
    assert.strictEqual(e.timeField, 'report.xml');
});

test('samma innehåll på två ställen: en post, egna sökvägar och tider', async () => {
    const { by, read, report } = await opened();
    const a = by['/private/var/mobile/Containers/Data/Application/ABC/Documents/original.jpg'];
    const b = by['/private/var/mobile/Containers/Data/Application/DEF/Documents/kopia.jpg'];
    assert.ok(a && b);
    assert.strictEqual(a.localOffset, b.localOffset);
    assert.strictEqual(a.crc32, b.crc32);
    assert.strictEqual(a.mtime, (T - 4000) / 1000);
    assert.strictEqual(b.mtime, (T - 8000) / 1000);
    assert.strictEqual(Buffer.from((await zip.extract(read, b)).bytes).toString(), 'samma innehåll');
    assert.strictEqual(report.counts.related, 1);
});

test('en tom fil har ingen post i rapporten men kan läsas', async () => {
    const { by, read, report } = await opened();
    const e = by['/private/var/mobile/Library/signal.sqlite-wal'];
    assert.ok(e);
    assert.strictEqual(e.size, 0);
    const out = await zip.extract(read, e);
    assert.strictEqual(out.bytes.length, 0);
    assert.strictEqual(out.crcOk, true);
    assert.strictEqual(await zip.stream(read, e, () => assert.fail('ingen data')), 0);
    assert.strictEqual(report.counts.empty, 1);
    assert.strictEqual(report.counts.unresolved, 0);
    assert.strictEqual(e.report.sha256, undefined, 'N/A är ingen summa');
    assert.strictEqual(e.report.md5, undefined);
});

test('en fil med storlek men utan post sägs och kan inte läsas', async () => {
    const rows = [{ path: '/a/borta.jpg', data: 'x', member: null, local: 'files\\Image\\borta.jpg', tag: 'Image', c: T, m: T, a: T }];
    const { by, read, report } = await opened(rows);
    assert.strictEqual(report.counts.unresolved, 1);
    await assert.rejects(zip.extract(read, by['/a/borta.jpg']), /står i report\.xml, men filen finns inte i rapporten/);
    await assert.rejects(zip.stream(read, by['/a/borta.jpg'], () => {}), /står i report\.xml, men filen finns inte i rapporten/);
    assert.match(Ufdr.limitText(report), /1 filer står i report\.xml men finns inte i rapporten/);
});

test('raderad enligt rapporten', async () => {
    const { by } = await opened();
    const e = by['/private/var/mobile/Media/DCIM/100APPLE/IMG_0003.PNG'];
    assert.strictEqual(e.report.deleted, 'Trash');
    assert.strictEqual(e.report.deletedMs, T + 123);
    assert.strictEqual(by[IMG].report.deleted, undefined, 'Intact utelämnas');
});

test('1980 är ingen tid när inga andra tider finns, men en äkta 1980 står kvar', async () => {
    const { by } = await opened();
    const none = by['/System/Library/utan-tider.strings'];
    assert.strictEqual(none.mtime, null);
    assert.strictEqual(none.crtime, null);
    assert.strictEqual(none.atime, null);
    const real = by['/System/Library/akta-1980.strings'];
    assert.strictEqual(real.mtime, DOS_ZERO / 1000);
    assert.strictEqual(real.crtime, DOS_ZERO / 1000);
});

test('ctime läses om rapporten har den, ur accessInfo eller MetaData', async () => {
    const rows = [
        { path: '/a/ingen.jpg', data: 'a', tag: 'Image', c: T, m: T, a: T },
        { path: '/a/access.jpg', data: 'b', tag: 'Image', c: T, m: T, a: T, x: T + 5000 },
        { path: '/a/meta.jpg', data: 'c', tag: 'Image', c: T, m: T, a: T, metaChange: '2026-11-03 13:16:09(UTC+2)' },
    ];
    const { by, report } = await opened(rows);
    assert.strictEqual(by['/a/ingen.jpg'].ctime, null);
    assert.strictEqual(by['/a/access.jpg'].ctime, (T + 5000) / 1000);
    assert.strictEqual(by['/a/meta.jpg'].ctime, (T + 3000) / 1000);
    assert.strictEqual(report.counts.ctimes, 2);
    assert.doesNotMatch(Ufdr.limitText(report), /ctime/);
    assert.match(Ufdr.limitText((await opened(rows.slice(0, 1))).report), /ctime\) finns inte i den här rapporten/);
});

test('tiden i MetaData: zonen står i parentes', () => {
    assert.strictEqual(Ufdr.metaTimeMs('2026-04-05 04:54:46(UTC+2)'), Date.UTC(2026, 3, 5, 2, 54, 46));
    assert.strictEqual(Ufdr.metaTimeMs('2026-04-05 02:54:46(UTC)'), Date.UTC(2026, 3, 5, 2, 54, 46));
    assert.strictEqual(Ufdr.metaTimeMs('2026-04-05 08:24:46(UTC+05:30)'), Date.UTC(2026, 3, 5, 2, 54, 46));
    assert.strictEqual(Ufdr.metaTimeMs('2026-04-04 21:54:46.500(UTC-5)'), Date.UTC(2026, 3, 5, 2, 54, 46, 500));
    assert.strictEqual(Ufdr.metaTimeMs('2026-04-05 04:54:46'), null, 'utan zon räknas den inte');
    assert.strictEqual(Ufdr.metaTimeMs(''), null);
});

test('en tid utan zon räknas inte', () => {
    assert.strictEqual(Ufdr.timeMs('2026-04-05T02:54:46.000+00:00'), Date.UTC(2026, 3, 5, 2, 54, 46));
    assert.strictEqual(Ufdr.timeMs('2026-04-05T04:54:46.000+02:00'), Date.UTC(2026, 3, 5, 2, 54, 46));
    assert.strictEqual(Ufdr.timeMs('2026-04-05T02:54:46Z'), Date.UTC(2026, 3, 5, 2, 54, 46));
    assert.strictEqual(Ufdr.timeMs('2026-04-05T02:54:46.000'), null);
    assert.strictEqual(Ufdr.timeMs(''), null);
});

test('tecken i sökvägen: entiteter och UTF-8', async () => {
    const { by, read } = await opened();
    const e = by['/var/mobile/konstig & <namn>/åäö "citat".jpg'];
    assert.ok(e, Object.keys(by).join('\n'));
    assert.strictEqual(Buffer.from((await zip.extract(read, e)).bytes).toString(), 'tecken');
});

test('det som utvunnits ur andra filer och nyckelringen är inga filer på telefonen', async () => {
    const { by, report, read } = await opened();
    assert.ok(by['/private/var/mobile/Library/signal.sqlite']);
    assert.ok(!by['/private/var/mobile/Library/signal.sqlite/signal.sqlite.decrypted'], 'märkt embedded');
    assert.ok(!by['/private/var/mobile/Library/arkiv.zip/bild.jpg'], 'en fil i sökvägen');
    assert.ok(!by['/private/var/mobile/Library/borta.zip/utvunnen.jpg'], 'märkt embedded, utan förälder');
    assert.ok(by['/private/var/mobile/Library/arkiv.zip']);
    assert.ok(!by[KEY]);
    assert.strictEqual(report.counts.derived, 3);
    assert.strictEqual(report.keychains.length, 1);
    assert.strictEqual(report.keychains[0].name, KEY);
    assert.strictEqual(Buffer.from((await zip.extract(read, report.keychains[0])).bytes).toString(), '<plist/>');
    assert.match(Ufdr.limitText(report), /3 filer som rapportverktyget utvunnit/);
});

test('metadata hoppas över, också med text som ser ut som taggar, och decodedData läses inte', async () => {
    const { by, report } = await opened();
    assert.ok(!by['/ska/inte/lasas']);
    assert.strictEqual(report.counts.rows, report.nodeCount);
});

test('rapporten kan delas var som helst när den läses', async () => {
    const { xml } = buildReport(ROWS);
    const bytes = Buffer.from(xml);
    const run = (size) => {
        const got = [];
        let header = '';
        const s = Ufdr.createScanner({ header: (t) => { header = t; }, file: (r) => got.push(r) });
        let done = false;
        for (let at = 0; at < bytes.length && !done; at += size) done = s.push(new Uint8Array(bytes.subarray(at, at + size)));
        assert.ok(done, 'filerna tog slut vid bitstorlek ' + size);
        return { got, header };
    };
    const whole = run(bytes.length);
    assert.match(whole.header, /UFED_PA_Version/);
    assert.strictEqual(whole.got.length, 15);
    for (const size of [1, 2, 3, 7, 16, 17, 64, 97, 1024, 4099]) {
        const r = run(size);
        assert.deepStrictEqual(r.got, whole.got, 'bitstorlek ' + size);
        assert.strictEqual(r.header, whole.header);
    }
});

test('ett > i ett attributvärde avslutar inte taggen', () => {
    const got = [];
    const s = Ufdr.createScanner({ header: () => {}, file: (r) => got.push(r) });
    const xml = '<project><taggedFiles><file path="/a>b/c.jpg" size="1" deleted="Intact" embedded="false" isrelated="False"><metadata section="File"><item name="Local Path"><![CDATA[files\\x]]></item></metadata></file></taggedFiles>                                                                       ';
    assert.strictEqual(s.push(new Uint8Array(Buffer.from(xml))), true);
    assert.strictEqual(got[0].path, '/a>b/c.jpg');
    assert.strictEqual(got[0].local, 'files\\x');
});

test('värden utan CDATA och taggar som stängs direkt', () => {
    const got = [];
    const s = Ufdr.createScanner({ header: () => {}, file: (r) => got.push(r) });
    const xml = '<project><taggedFiles><file path="/a/&#xE5;.jpg" size="1" /><file path="/b.jpg" size="2"><accessInfo><timestamp name="ModifyTime" />' +
        '<timestamp name="AccessTime" format="TimeStampKnown">2026-04-05T02:54:46.000+00:00</timestamp></accessInfo><metadata section="File" /><metadata section="File"><item name="Tags">A &amp; B</item><item name="MD5" /></metadata></file></taggedFiles>                                                                       ';
    assert.strictEqual(s.push(new Uint8Array(Buffer.from(xml))), true);
    assert.strictEqual(got[0].path, '/a/å.jpg');
    assert.strictEqual(got[1].m, null);
    assert.strictEqual(got[1].a, Date.UTC(2026, 3, 5, 2, 54, 46));
    assert.strictEqual(got[1].tags, 'A & B');
    assert.strictEqual(got[1].md5, '');
});

test('samma förteckning med små läsbitar genom hela kedjan', async () => {
    const small = await opened(ROWS, { index: { chunk: 1000 } });
    const big = await opened(ROWS);
    assert.deepStrictEqual(small.all.entries, big.all.entries);
});

test('äldre rapport: deflate i både filer och report.xml, och Zip64 i zippen', async () => {
    const rows = [{ path: IMG, data: 'bild'.repeat(2000), deflate: true, tag: 'Image', c: T, m: T, a: T }];
    const { by, read, report } = await opened(rows, { deflateReport: true, zip64: true });
    assert.strictEqual(report.counts.files, 1);
    const out = await zip.extract(read, by[IMG]);
    assert.strictEqual(out.bytes.length, 8000);
    assert.strictEqual(out.crcOk, true);
    let total = 0;
    assert.strictEqual(await zip.stream(read, by[IMG], (c) => { total += c.length; }), 8000);
    assert.strictEqual(total, 8000);
});

test('storlekar och platser över 4 GB går genom förteckningen', async () => {
    const big = { name: 'files/Video/stor.mov', method: 0, flags: 0, crc32: 7, compSize: 6e9, size: 6e9, localOffset: 9e9 };
    const offsetOnly = { name: 'files/Image/liten.jpg', method: 0, flags: 0, crc32: 8, compSize: 10, size: 10, localOffset: 5e9 };
    const bytes = Ufdr._buildDirectory([{ path: '/stor.mov', size: 6e9, member: big, m: T, a: null, c: null, d: null }, { path: '/liten.jpg', size: 10, member: offsetOnly, m: T, a: null, c: null, d: null }]);
    const read = async () => assert.fail('förteckningen ska inte läsas från filen');
    read.directory = { bytes, size: bytes.length, entries: 2, zip64: true, names: null, places: null, built: true };
    const scan = await zip.scan(read, 1, () => true);
    assert.strictEqual(scan.entries[0].size, 6e9);
    assert.strictEqual(scan.entries[0].compSize, 6e9);
    assert.strictEqual(scan.entries[0].localOffset, 9e9);
    assert.strictEqual(scan.entries[1].size, 10);
    assert.strictEqual(scan.entries[1].localOffset, 5e9);
    assert.strictEqual(scan.entries[1].report.member, 'files/Image/liten.jpg');
});

test('en krypterad post i rapporten ger samma fel som i en zip', async () => {
    const member = { name: 'files/Image/a.jpg', method: 0, flags: 1, crc32: 7, compSize: 10, size: 10, localOffset: 0 };
    const bytes = Ufdr._buildDirectory([{ path: '/a.jpg', size: 10, member, m: T, a: null, c: null, d: null }]);
    const read = async () => assert.fail('filen ska inte läsas');
    read.directory = { bytes, size: bytes.length, entries: 1, zip64: true, names: null, places: null, built: true };
    const e = (await zip.scan(read, 1, () => true)).entries[0];
    await assert.rejects(zip.extract(read, e), /är krypterad i zippen/);
});

test('en vanlig zip kan inte låtsas ha rapportens uppgifter', async () => {
    const field = Buffer.alloc(4 + 21);
    field.writeUInt16LE(0x5546, 0);
    field.writeUInt16LE(21, 2);
    field.write('{"m":1000,"tags":"x"}', 4);
    const buf = buildZip([{ name: 'a.jpg', data: 'x', mtime: 1700000000, centralExtra: field }]);
    const scan = await zip.scan(reader(buf), buf.length, () => true);
    assert.strictEqual(scan.entries[0].report, undefined);
    assert.strictEqual(scan.entries[0].mtime, 1700000000);
    assert.strictEqual(scan.entries[0].timeField, 'UT');
});

test('rapporten känns igen på namnet, eller på innehållet om den bytt namn', async () => {
    const { buf } = buildUfdr(ROWS);
    const read = reader(buf);
    assert.strictEqual(await Ufdr.detect(read, buf.length, 'rapport.ufdr'), true);
    assert.strictEqual(await Ufdr.detect(read, buf.length, 'RAPPORT.UFDR'), true);
    assert.strictEqual(await Ufdr.detect(read, buf.length, 'rapport.zip'), true, 'en omdöpt rapport');
    const plain = buildZip([{ name: 'filesystem1/private/var/mobile/a.db', data: 'x' }]);
    assert.strictEqual(await Ufdr.detect(reader(plain), plain.length, 'extraktion.zip'), false);
    // En zip som råkar börja med files/ utan report.xml är ingen rapport.
    const other = buildZip([{ name: 'files/a.txt', data: 'x' }]);
    assert.strictEqual(await Ufdr.detect(reader(other), other.length, 'annan.zip'), false);
});

test('en skyddad eller trasig rapport ger ett begripligt fel', async () => {
    const locked = Buffer.from([0x2d, 0x06, 0x52, 0x6d, 1, 2, 3, 4, 5, 6, 7, 8]);
    await assert.rejects(Ufdr.detect(reader(locked), locked.length, 'skyddad.ufdr'), (err) => err.code === 'UFDR_LOCKED' && /skyddad med lösenord/.test(err.message));
    assert.strictEqual(await Ufdr.detect(reader(locked), locked.length, 'annat.bin'), false);
});

test('utan report.xml eller filavsnitt sägs det', async () => {
    const none = buildUfdr(ROWS, { noReport: true }).buf;
    await assert.rejects(Ufdr.open(reader(none), none.length), /ingen report\.xml/);
    const empty = buildUfdr(ROWS, { noFiles: true }).buf;
    await assert.rejects(Ufdr.open(reader(empty), empty.length), /inget avsnitt med filer/);
});

test('texterna säger vad en rapport inte kan svara på', async () => {
    const { report } = await opened();
    const limits = Ufdr.limitText(report);
    assert.match(limits, /säger inte att den saknades på telefonen/);
    assert.match(limits, /ctime/);
    assert.match(Ufdr.summaryText(report), /rapportverktygets version 10\.11\.0\.3022/);
    assert.doesNotMatch(Ufdr.summaryText(report) + limits, /cellebrite|physical analyzer|ufed/i);
    assert.match(Ufdr.summaryText(report), /extraktion_fs\.zip \(Verified\)/);
    assert.ok(report.tags.Uncategorized, 'testraderna har kategorin');
    assert.doesNotMatch(limits, /Uncategorized/);
    const limited = await opened(ROWS.filter((r) => r.tag !== 'Uncategorized'));
    assert.match(Ufdr.limitText(limited.report), /Filer utan kategori \(Uncategorized\) ingår inte/);
    const partial = await opened(ROWS, { partial: true });
    assert.match(Ufdr.limitText(partial.report), /ofullständig/);
    const wrong = await opened(ROWS, { nodeCount: 99 });
    assert.match(Ufdr.limitText(wrong.report), /report\.xml säger 99 filer, men 15 lästes/);
});

test('rapportens egen benämning med verktygets namn visas inte', () => {
    const report = { paVersion: '1', createdText: '', device: 'Cellebrite UFED Reports', sources: [], counts: { files: 1, related: 0 } };
    assert.doesNotMatch(Ufdr.summaryText(report), /cellebrite|ufed|Extraktion:/i);
    assert.match(Ufdr.summaryText(Object.assign({}, report, { device: 'Apple iOS Full File system' })), /Extraktion: Apple iOS Full File system\./);
});

test('summorna i report.xml fyller cachen för hashsökning', async () => {
    const { all } = await opened();
    const cache = { md5: {}, sha1: {}, sha256: {} };
    Ufdr.fillHashCache(all.entries, cache, (e) => e.name);
    assert.strictEqual(cache.sha256[IMG], crypto.createHash('sha256').update('ftypheic-bilden').digest('hex'));
    assert.strictEqual(cache.md5[IMG], crypto.createHash('md5').update('ftypheic-bilden').digest('hex'));
    assert.deepStrictEqual(cache.sha1, {}, 'rapporter har ingen SHA-1');
});
