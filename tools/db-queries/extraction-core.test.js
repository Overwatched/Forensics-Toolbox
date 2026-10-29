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

core.use({ ZipRead: require('./zip'), ZipLocate: require('./locate'), SqliteWal: wal });

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
