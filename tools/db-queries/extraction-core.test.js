// Den delade extraktionsläsningen: databaserna hittas, iOS-versionen läses, databas och -wal
// läses ut med CRC och SHA-256, WAL-ramarna läggs på, och zippen är oförändrad efteråt.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildZip, reader } = require('./fixtures/zip-builder');
const core = require('./extraction-core');
const wal = require('./wal');

core.use({ ZipRead: require('./zip'), ZipLocate: require('./locate'), SqliteWal: wal, ToolboxHashing: require('../hash-calculator/hashing') });

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { /* äldre Node */ }

const SQLJS = path.join(__dirname, '..', 'ios-keychain', 'vendor', 'sqljs');

async function openSqlJs(bytes) {
    const ctx = {};
    new Function('window', fs.readFileSync(path.join(SQLJS, 'sql-wasm-binary.js'), 'utf8'))(ctx);
    const initSqlJs = require(path.join(SQLJS, 'sql-wasm.js'));
    const SQL = await initSqlJs({ wasmBinary: ctx.SQL_WASM_BINARY });
    return new SQL.Database(bytes);
}

// En Photos.sqlite i WAL-läge där filens rad bara finns i -wal.
function makePhotosDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excore-test-'));
    const file = path.join(dir, 'Photos.sqlite');
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;');
    db.exec('CREATE TABLE ZASSET (Z_PK INTEGER PRIMARY KEY, ZFILENAME TEXT, ZDATECREATED REAL)');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.prepare('INSERT INTO ZASSET (ZFILENAME, ZDATECREATED) VALUES (?, ?)').run('IMG_0001.HEIC', 780409869.6);
    const bytes = { db: fs.readFileSync(file), wal: fs.readFileSync(file + '-wal') };
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    return bytes;
}

const DATABASES = [
    { id: 'photos-ios14', family: 'photos', familyTitle: 'Photos.sqlite', label: 'Photos (14)', paths: ['private/var/mobile/Media/PhotoData/Photos.sqlite'], ios: [14, 14] },
    { id: 'photos-ios17-plus', family: 'photos', familyTitle: 'Photos.sqlite', label: 'Photos (17+)', paths: ['private/var/mobile/Media/PhotoData/Photos.sqlite'], ios: [17, 99] },
    { id: 'knowledgec', family: 'knowledgec', familyTitle: 'knowledgeC.db', label: 'knowledgeC.db', paths: ['private/var/mobile/Library/CoreDuet/Knowledge/knowledgeC.db'], ios: null },
    { id: 'utan-paths', family: 'x', label: 'x', paths: [], ios: null },
];

const PLIST = '<plist><dict><key>ProductVersion</key><string>18.7.7</string></dict></plist>';

test('targets grupperar per familj och dbForVersion väljer band', () => {
    const t = core.targets(DATABASES);
    assert.deepStrictEqual(t.map((x) => [x.key, x.dbs.length]), [['photos', 2], ['knowledgec', 1]]);
    assert.strictEqual(core.dbForVersion(t[0], '18.7.7').db.id, 'photos-ios17-plus');
    assert.strictEqual(core.dbForVersion(t[0], '14.1').db.id, 'photos-ios14');
    assert.deepStrictEqual(core.dbForVersion(t[0], null), { db: DATABASES[1], guessed: true });
    assert.deepStrictEqual(core.dbForVersion(t[1], null), { db: DATABASES[2], guessed: false });
});

test('open hittar databaserna och iOS-versionen, find hittar bildfilen', async () => {
    const buf = buildZip([
        { name: 'filesystem1/System/Library/CoreServices/SystemVersion.plist', data: PLIST },
        { name: 'filesystem1/private/var/mobile/Media/PhotoData/Photos.sqlite', data: 'db', mtime: 1727436336 },
        { name: 'filesystem1/private/var/mobile/Media/PhotoData/Photos.sqlite-wal', data: 'wal' },
        { name: 'filesystem1/private/var/mobile/Media/DCIM/100APPLE/IMG_0001.HEIC', data: 'bild', mtime: 1727436300 },
        { name: 'filesystem1/private/var/mobile/Library/CoreDuet/Knowledge/knowledgeC.db', data: 'kc' },
    ]);
    const read = reader(buf);
    const r = await core.open(read, buf.length, core.targets(DATABASES));
    assert.strictEqual(r.version, '18.7.7');
    assert.deepStrictEqual(r.found.map((f) => [f.key, !!f.wal]), [['photos', true], ['knowledgec', false]]);
    assert.strictEqual(r.scan.count, 5);
    const dcim = await core.find(read, buf.length, (n) => /\/DCIM\/100APPLE\/IMG_0001\.HEIC$/.test(n));
    assert.strictEqual(dcim.length, 1);
    assert.strictEqual(core.entryTime(dcim[0]), '2024-09-27 11:25:00 UTC');
    assert.strictEqual(core.sizeText(dcim[0].size), '4 byte');
});

test('loadDatabase läser databas och -wal, lägger på ramarna, hashar och varnar rätt', { skip: !DatabaseSync && 'node:sqlite saknas' }, async () => {
    const files = makePhotosDb();
    const buf = buildZip([
        { name: 'filesystem1/private/var/mobile/Media/PhotoData/Photos.sqlite', data: files.db },
        { name: 'filesystem1/private/var/mobile/Media/PhotoData/Photos.sqlite-wal', data: files.wal, deflate: true },
        { name: 'filesystem1/private/var/mobile/Library/CoreDuet/Knowledge/knowledgeC.db', data: files.db },
        { name: 'filesystem1/private/var/mobile/Library/CoreDuet/Knowledge/knowledgeC.db-journal', data: 'j' },
    ]);
    const before = Buffer.from(buf);
    const read = reader(buf);
    const r = await core.open(read, buf.length, core.targets(DATABASES));
    const photos = await core.loadDatabase(read, r.found[0], ['Extraktion: test.zip']);
    assert.ok(photos.stats.appliedFrames > 0);
    assert.strictEqual(photos.warnings.length, 0);
    assert.ok(photos.crcOk);
    assert.match(photos.hashes.db, /^[0-9a-f]{64}$/);
    assert.match(photos.hashes.wal, /^[0-9a-f]{64}$/);
    assert.strictEqual(photos.lines[0], 'Extraktion: test.zip');
    assert.match(photos.lines[1], /^Ur zippen: .*Photos\.sqlite \(\d+ byte, ändrad .*CRC32 [0-9a-f]{8} stämmer\)$/);
    assert.match(photos.lines[3], /^SHA-256 Photos\.sqlite: /);
    assert.match(core.walSummary(photos), /^-wal: \d+ av \d+ ramar lades på/);
    const db = await openSqlJs(photos.bytes);
    assert.deepStrictEqual(db.exec('SELECT ZFILENAME FROM ZASSET')[0].values, [['IMG_0001.HEIC']]);

    // Samma databas utan -wal och med -journal: raden saknas, och båda varningarna finns.
    const kc = await core.loadDatabase(read, r.found[1]);
    assert.strictEqual(kc.walEntry, null);
    assert.strictEqual(core.walSummary(kc), 'Utan -wal.');
    assert.ok(kc.warnings.some((w) => /utan -wal/.test(w)));
    assert.ok(kc.warnings.some((w) => /-journal/.test(w)));
    const db2 = await openSqlJs(kc.bytes);
    assert.strictEqual(db2.exec('SELECT count(*) FROM ZASSET')[0].values[0][0], 0);

    assert.ok(before.equals(buf), 'zippen ändrades');
});

// En -wal på 0 byte är normalt efter en checkpoint. Databasen ska läsas ändå, utan fel.
test('tom -wal (0 byte) stoppar inte inläsningen', { skip: !DatabaseSync && 'node:sqlite saknas' }, async () => {
    const files = makePhotosDb();
    const buf = buildZip([
        { name: 'filesystem1/private/var/mobile/Media/PhotoData/Photos.sqlite', data: files.db },
        { name: 'filesystem1/private/var/mobile/Media/PhotoData/Photos.sqlite-wal', data: '' },
    ]);
    const read = reader(buf);
    const r = await core.open(read, buf.length, core.targets(DATABASES));
    const photos = await core.loadDatabase(read, r.found[0]);
    assert.ok(photos.walEntry);
    assert.strictEqual(photos.stats.error, '');
    assert.strictEqual(photos.stats.appliedFrames, 0);
    assert.strictEqual(core.walSummary(photos), '-wal är tom (0 byte), så det fanns inga ramar att lägga på.');
    const db = await openSqlJs(photos.bytes);
    assert.strictEqual(db.exec('SELECT count(*) FROM ZASSET')[0].values[0][0], 0);
});

// En -wal med trasigt huvud hoppar SQLite över. Databasen ska läsas utan den, med en varning.
test('trasigt -wal-huvud ger en varning, och databasen läses utan -wal', { skip: !DatabaseSync && 'node:sqlite saknas' }, async () => {
    const files = makePhotosDb();
    const broken = Buffer.from(files.wal);
    broken[24] ^= 0xff;   // checksumman i huvudet
    const buf = buildZip([
        { name: 'filesystem1/private/var/mobile/Media/PhotoData/Photos.sqlite', data: files.db },
        { name: 'filesystem1/private/var/mobile/Media/PhotoData/Photos.sqlite-wal', data: broken },
    ]);
    const read = reader(buf);
    const r = await core.open(read, buf.length, core.targets(DATABASES));
    const photos = await core.loadDatabase(read, r.found[0]);
    assert.match(photos.stats.error, /checksumma/);
    assert.ok(photos.warnings.some((w) => /Photos\.sqlite-wal lades inte på: Fel checksumma.*utan -wal, som SQLite/.test(w)), photos.warnings.join(' | '));
    assert.match(core.walSummary(photos), /^-wal lades inte på: Fel checksumma i -wal-huvudet\./);
    const db = await openSqlJs(photos.bytes);
    assert.strictEqual(db.exec('SELECT count(*) FROM ZASSET')[0].values[0][0], 0);
});

test('SHA-256 över gränsen för crypto.subtle räknas i JavaScript och ger samma summa', async () => {
    const bytes = new Uint8Array(200000).map((_, i) => (i * 7 + (i >> 8)) & 0xff);
    const want = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    assert.strictEqual(await core.sha256(bytes), want);
    assert.strictEqual(await core.sha256(bytes, { subtleMax: 1000 }), want);
});

test('en databas lämnas till sql.js utan kopia, läses rätt och kan skrivas i', { skip: !DatabaseSync && 'node:sqlite saknas' }, async () => {
    const files = makePhotosDb();
    const bytes = new Uint8Array(wal.apply(new Uint8Array(files.db), files.wal).bytes);
    const copied = await openSqlJs(bytes.slice());
    const want = copied.exec("SELECT name FROM sqlite_master ORDER BY name")[0].values;
    copied.close();
    assert.ok(want.length > 0);
    const db = await openSqlJs(core.noCopy(bytes));
    assert.deepStrictEqual(db.exec("SELECT name FROM sqlite_master ORDER BY name")[0].values, want);
    // Telegrams tabeller skrivs i databasen, och filen får då växa.
    db.run('CREATE TABLE tg_prov (a)');
    for (let i = 0; i < 500; i++) db.run('INSERT INTO tg_prov VALUES (?)', ['rad'.repeat(100)]);
    assert.strictEqual(db.exec('SELECT count(*) FROM tg_prov')[0].values[0][0], 500);
    db.close();
});

// En rapport (UFDR) som källa: samma väg som en zip, med telefonens sökvägar och rapportens egna summor.
const { buildUfdr } = require('./fixtures/ufdr-builder');
core.use({ UfdrRead: require('./ufdr') });
require('./ufdr').use({ ZipRead: require('./zip') });

// Som en File i webbläsaren: slice() och arrayBuffer().
function fakeFile(buf, name) {
    const slice = (a, b) => ({ arrayBuffer: async () => buf.buffer.slice(buf.byteOffset + a, buf.byteOffset + Math.min(b, buf.length)) });
    return { name, size: buf.length, lastModified: 1, slice };
}

test('openSource: en zip är en zip, en UFDR läses in och databasen hittas på telefonens sökväg', { skip: !DatabaseSync && 'node:sqlite saknas' }, async () => {
    const files = makePhotosDb();
    const T = Date.UTC(2026, 10, 3);
    const { buf } = buildUfdr([
        { path: '/System/Library/CoreServices/SystemVersion.plist', data: PLIST, tag: 'Configuration', c: T, m: T, a: T },
        { path: '/private/var/mobile/Media/PhotoData/Photos.sqlite', data: files.db, tag: 'Database', c: T, m: T, a: T },
        { path: '/private/var/mobile/Media/PhotoData/Photos.sqlite-wal', data: files.wal, tag: 'Uncategorized', c: T, m: T, a: T },
        { path: '/private/var/mobile/Library/CoreDuet/Knowledge/knowledgeC.db', data: files.db, member: 'files\\Database\\Photos.sqlite', tag: 'Database', c: T, m: T, a: T, sha256: 'f'.repeat(64) },
        { path: '/private/var/mobile/Library/CoreDuet/Knowledge/knowledgeC.db-wal', data: '', member: null, local: 'files\\Uncategorized\\saknas', tag: 'Uncategorized', c: T, m: T, a: T },
    ]);
    const source = await core.openSource(fakeFile(buf, 'rapport.ufdr'));
    assert.ok(source.report, 'rapporten kändes igen');
    const r = await core.open(source.read, buf.length, core.targets(DATABASES));
    assert.strictEqual(r.version, '18.7.7');
    assert.deepStrictEqual(r.found.map((f) => [f.key, f.db.name, !!f.wal]), [
        ['photos', '/private/var/mobile/Media/PhotoData/Photos.sqlite', true],
        ['knowledgec', '/private/var/mobile/Library/CoreDuet/Knowledge/knowledgeC.db', true],
    ]);
    const photos = await core.loadDatabase(source.read, r.found[0], ['Rapport: rapport.ufdr']);
    assert.ok(photos.stats.appliedFrames > 0);
    assert.deepStrictEqual(photos.warnings, []);
    assert.match(photos.lines[1], /^Ur rapporten: \/private\/var\/mobile\/Media\/PhotoData\/Photos\.sqlite \(posten files\/Database\/Photos\.sqlite, \d+ byte, ändrad 2026-11-03 00:00:00 UTC, CRC32 [0-9a-f]{8} stämmer\)$/);
    const db = await openSqlJs(photos.bytes);
    assert.deepStrictEqual(db.exec('SELECT ZFILENAME FROM ZASSET')[0].values, [['IMG_0001.HEIC']]);
    assert.strictEqual(core.entryTimes(r.found[0].db).field, 'report.xml');
    assert.strictEqual(core.entryTimes(r.found[0].db).createdMs, T);
    assert.strictEqual(core.entryTimes(r.found[0].db).changedMs, null);
    assert.strictEqual(core.reportHashOk(r.found[0].db, photos.hashes.db), true);

    // Filen stämmer inte med summan i report.xml, och -wal är en tom fil utan post.
    const kc = await core.loadDatabase(source.read, r.found[1]);
    assert.ok(kc.warnings.some((w) => /SHA-256 för knowledgeC\.db stämmer inte med report\.xml/.test(w)), kc.warnings.join(' | '));
    assert.ok(!kc.warnings.some((w) => /-wal/.test(w) && /SHA-256/.test(w)), 'en tom fil har ingen summa att jämföra');
    assert.strictEqual(core.walSummary(kc), '-wal är tom (0 byte), så det fanns inga ramar att lägga på.');

    // Rapporten har ingen -wal: det säger inget om telefonen.
    const without = await core.loadDatabase(source.read, Object.assign({}, r.found[1], { wal: null }));
    assert.ok(without.warnings.some((w) => /rapporten har ingen, men den kan ha funnits på telefonen/.test(w)), without.warnings.join(' | '));

    const plain = buildZip([{ name: 'filesystem1/private/var/mobile/a.db', data: 'x' }]);
    const zip = await core.openSource(fakeFile(plain, 'extraktion.zip'));
    assert.strictEqual(zip.report, null);
    assert.strictEqual(core.sourceWord({}), 'zippen');
    assert.strictEqual(core.sourceWord({ report: {} }), 'rapporten');
});

// ---------- Nycklarna som hör till extraktionen ----------

const secretsLib = require('./app-secrets');
core.use({ AppSecrets: secretsLib });
require('../ios-keychain/lib/bplist.js');
require('../ios-keychain/lib/asn1.js');
const { encryptedKeychain } = require('./fixtures/keychain-builder');
const KEY48 = Buffer.alloc(48, 7);
const KEY96 = KEY48.toString('hex');
const SIGNAL_POST = { svce: 'GRDBKeyChainService', acct: 'GRDBDatabaseCipherKeySpec', agrp: 'X.org.whispersystems.signal', value: KEY48 };
const plainKeychain = (key) => '<plist><dict><key>genp</key><array><dict><key>svce</key><string>GRDBKeyChainService</string><key>acct</key><string>GRDBDatabaseCipherKeySpec</string><key>v_Data</key><data>' + key.toString('base64') + '</data></dict></array></dict></plist>';
const readerOf = (buf) => async (offset, length) => new Uint8Array(buf.subarray(offset, offset + length));

test('findKeys: nyckelringen under extra/ räcker, och mappen bredvid zippen rörs inte', async () => {
    const buf = buildZip([
        { name: 'filesystem1/private/var/mobile/extra/falsk_keychain.plist', data: plainKeychain(Buffer.alloc(48, 9)) },
        { name: 'extra/KeychainDump/backup_keychain_v2.plist', data: encryptedKeychain([SIGNAL_POST]), deflate: true },
    ]);
    let asked = 0;
    const out = await core.findKeys(readerOf(buf), buf.length, { beside: async () => { asked++; return { files: [], other: [] }; } });
    assert.strictEqual(asked, 0, 'mappen ska inte läsas när nyckeln redan finns');
    assert.strictEqual(out.lookedBeside, false);
    assert.deepStrictEqual(out.secrets.map((x) => x.source), ['extra/KeychainDump/backup_keychain_v2.plist i zippen']);
    assert.strictEqual(secretsLib.keysForProfile(out.secrets, 'signal-ios').dbKey, KEY96);
});

test('findKeys: utan nyckel i zippen läses filerna bredvid, och namnet säger var de låg', async () => {
    const buf = buildZip([{ name: 'filesystem1/a.txt', data: 'x' }]);
    const out = await core.findKeys(readerOf(buf), buf.length, { beside: async () => ({ files: [{ name: 'X_keychain.plist', bytes: new Uint8Array(Buffer.from(plainKeychain(KEY48))) }], other: ['Y_keychain.plist'] }) });
    assert.strictEqual(out.lookedBeside, true);
    assert.deepStrictEqual(out.other, ['Y_keychain.plist']);
    assert.strictEqual(secretsLib.keysForProfile(out.secrets, 'signal-ios').source, 'X_keychain.plist bredvid zippen');
    // En rapport säger rapporten, och dess egen nyckelring står först.
    const rep = await core.findKeys(readerOf(buildZip([{ name: 'Keychain/R_keychain.plist', data: plainKeychain(KEY48) }])), buildZip([{ name: 'Keychain/R_keychain.plist', data: plainKeychain(KEY48) }]).length, { report: { keychains: [] }, beside: async () => ({ files: [{ name: 'X_keychain.plist', bytes: new Uint8Array(Buffer.from(plainKeychain(KEY48))) }], other: [] }) });
    assert.strictEqual(secretsLib.keysForProfile(rep.secrets, 'signal-ios').source, 'X_keychain.plist bredvid rapporten');
});

test('findKeys: i en rapport ur en zip med extra/ ligger nyckelfilerna högst upp, och mappen bredvid rörs inte', async () => {
    const fs = 'EXTRACTION_FFS.zip';
    const open = async (rows) => {
        const { buf } = buildUfdr(rows);
        const source = await core.openSource(fakeFile(buf, 'rapport.ufdr'));
        let asked = 0;
        const out = await core.findKeys(source.read, buf.length, { report: source.report, beside: async () => { asked++; return { files: [], other: [] }; } });
        assert.strictEqual(asked, 0, 'mappen ska inte läsas när nyckeln redan finns');
        return out;
    };
    const ios = await open([{ path: '/backup_keychain_v2.plist', data: encryptedKeychain([SIGNAL_POST]), tag: 'Configuration', fs }]);
    assert.strictEqual(secretsLib.keysForProfile(ios.secrets, 'signal-ios').dbKey, KEY96);
    assert.strictEqual(secretsLib.keysForProfile(ios.secrets, 'signal-ios').source, 'backup_keychain_v2.plist i rapporten');
    const android = await open([{ path: '/Secrets/secrets.json', data: JSON.stringify([{ app: secretsLib.SIGNAL, script_output: [{ payload: { 'sqlite db key': 'ab'.repeat(32), 'signal attachment key': { modernKey: 'bilagenyckeln' } } }] }]), tag: 'Uncategorized', fs }]);
    assert.deepStrictEqual(secretsLib.keysForProfile(android.secrets, 'signal'), { dbKey: 'ab'.repeat(32), modernKey: 'bilagenyckeln', source: 'secrets.json i rapporten', modernSource: 'secrets.json i rapporten' });
});

test('findKeys: i en webbläsare letas bara i zippen, och det sägs', async () => {
    const buf = buildZip([{ name: 'filesystem1/a.txt', data: 'x' }]);
    const out = await core.findKeys(readerOf(buf), buf.length, {});
    assert.deepStrictEqual(out, { secrets: [], lookedBeside: false, other: [] });
    assert.match(secretsLib.missingKeyText({ profile: 'signal-ios', word: 'zippen', search: out }), /En webbläsare får inte se mappen/);
    // Går mappen inte att läsa är det samma sak som att inte ha letat där.
    const failed = await core.findKeys(readerOf(buf), buf.length, { beside: async () => null });
    assert.strictEqual(failed.lookedBeside, false);
    const threw = await core.findKeys(readerOf(buf), buf.length, { beside: async () => { throw new Error('nej'); } });
    assert.strictEqual(threw.lookedBeside, false);
});

test('findKeys: en trasig fil stoppar inte nästa, och felet följer med', async () => {
    const buf = buildZip([{ name: 'extra/KeychainDump/trasig_keychain.plist', data: 'inte en plist' }, { name: 'extra/Secrets/secrets.json', data: JSON.stringify([{ app: secretsLib.SIGNAL, script_output: [{ payload: { 'sqlite db key': 'ab'.repeat(32) } }] }]) }]);
    const out = await core.findKeys(readerOf(buf), buf.length, {});
    assert.strictEqual(out.secrets.length, 2);
    assert.match(out.secrets.find((x) => /trasig/.test(x.source)).error, /ingen nyckelfil/);
    assert.strictEqual(secretsLib.keysForProfile(out.secrets, 'signal').dbKey, 'ab'.repeat(32));
});

test('findKeys: ett läsfel i en fil stoppar inte nästa, och felet följer med', async () => {
    const buf = buildZip([{ name: 'extra/Trasig/x_keychain.plist', data: plainKeychain(KEY48) }, { name: 'extra/Secrets/secrets.json', data: JSON.stringify([{ app: secretsLib.SIGNAL, script_output: [{ payload: { 'sqlite db key': 'ab'.repeat(32) } }] }]) }]);
    // Filhuvudet för den första posten ligger först i zippen, och bara den går inte att läsa.
    const read = async (offset, length) => {
        if (offset === 0 && length < buf.length) throw new Error('läsfel på disken');
        return new Uint8Array(buf.subarray(offset, offset + length));
    };
    const out = await core.findKeys(read, buf.length, {});
    assert.strictEqual(out.secrets.length, 2);
    assert.match(out.secrets[0].error, /Filen kunde inte läsas: läsfel på disken/);
    assert.strictEqual(secretsLib.keysForProfile(out.secrets, 'signal').dbKey, 'ab'.repeat(32));
});

test('findKeys: en jättestor fil under extra/ läses inte in, och det sägs', async () => {
    const buf = buildZip([{ name: 'extra/stor_keychain.plist', data: Buffer.alloc(65 * 1024 * 1024), deflate: true }]);
    const out = await core.findKeys(readerOf(buf), buf.length, {});
    assert.deepStrictEqual(out.secrets.map((x) => x.source), ['extra/stor_keychain.plist i zippen']);
    assert.match(out.secrets[0].error, /för stor/);
});

test('readKeyFile: en zip packas upp, och nyckelfilen i den tolkas', async () => {
    const ks = JSON.stringify({ 'org.thoughtcrime.securesms': [{ description: 'pref_database_encrypted_secret', key_name: 'SignalSecret', decrypted_data: 'cd'.repeat(32) }] });
    const zipped = buildZip([{ name: 'android_keystore', data: ks, deflate: true }]);
    const r = await core.readKeyFile(new Uint8Array(zipped), 'X_android_keystore.zip');
    assert.strictEqual(r.error, undefined);
    assert.deepStrictEqual(secretsLib.keysForProfile([r], 'signal'), { dbKey: 'cd'.repeat(32), modernKey: null, source: 'X_android_keystore.zip', modernSource: null });
    assert.match((await core.readKeyFile(new Uint8Array(buildZip([{ name: 'annat.txt', data: 'x' }])), 'Y.zip')).error, /ingen nyckelfil/);
    // Och utan zip går filen rakt till tolken.
    assert.strictEqual(secretsLib.keysForProfile([await core.readKeyFile(new Uint8Array(Buffer.from(plainKeychain(KEY48))), 'k.plist')], 'signal-ios').dbKey, KEY96);
});
