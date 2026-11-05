// Knappen högst upp i Queries: zip, databas eller -wal, och vilken av katalogens databaser en fil är.
// Photos.sqlite provas mot schemat för varje iOS-version (fixtures/photos-schema.json, från iLEAPP).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const DbIdentify = require('./identify.js');
const schemas = require('./fixtures/photos-schema.json');
const json = (p) => require(path.join(ROOT, 'queries', p, 'catalog.json'));

async function loadSql() {
    const vendor = path.join(ROOT, 'tools', 'ios-keychain', 'vendor', 'sqljs');
    const sandbox = { window: {}, atob: (s) => Buffer.from(s, 'base64').toString('binary') };
    vm.runInNewContext(fs.readFileSync(path.join(vendor, 'sql-wasm-binary.js'), 'utf8'), sandbox);
    const initSqlJs = require(path.join(vendor, 'sql-wasm.js'));
    return initSqlJs({ wasmBinary: sandbox.window.SQL_WASM_BINARY });
}

// Samma form som databaserna i Queries (script.js, buildDatabases): de synliga queryerna per databas.
function catalogDatabases() {
    const out = [];
    const photos = json('ios/photos-sqlite');
    const visible = new Set(photos.questions.filter((q) => !q.hidden).map((q) => q.id));
    photos.bands.forEach((b) => out.push({
        id: 'photos-' + b.id, family: 'photos', os: 'iOS', paths: photos.paths,
        queries: b.queries.filter((q) => visible.has(q.id)),
    }));
    const shown = (list) => (list || []).filter((q) => !q.hidden);
    [['app-usage', null], ['ios/routined', 'iOS'], ['ios/snapchat', 'iOS'], ['android/snapchat', 'Android'], ['android/signal', 'Android'], ['ios/signal', 'iOS'], ['ios/whatsapp', 'iOS'], ['ios/telegram', 'iOS']].forEach(([p, os]) => {
        json(p).databases.forEach((d) => out.push({
            id: d.id, family: d.id, os: os || (/android|wellbeing/i.test(d.label) ? 'Android' : 'iOS'),
            paths: d.paths || [], cipher: d.cipher || null, queries: shown(d.queries),
        }));
    });
    json('android').categories.forEach((c) => out.push({
        id: 'android-' + c.id, family: 'android-' + c.id, os: 'Android', paths: c.paths || [], queries: shown(c.queries),
    }));
    return out;
}

function schemaDb(SQL, tables, extra) {
    const db = new SQL.Database();
    for (const [table, cols] of Object.entries(tables)) db.run('CREATE TABLE "' + table + '" (' + cols.map((c) => '"' + c + '"').join(', ') + ')');
    if (extra) db.run(extra);
    const bytes = db.export();
    db.close();
    return bytes;
}

const HEAD = (s) => Uint8Array.from(Buffer.from(s, 'binary'));

test('kindOf: zip, SQLite, -wal och resten', () => {
    assert.strictEqual(DbIdentify.kindOf(HEAD('PK\x03\x04rest of header'), 'x.bin'), 'zip');
    assert.strictEqual(DbIdentify.kindOf(HEAD('PK\x05\x06'), 'tom'), 'zip');
    assert.strictEqual(DbIdentify.kindOf(HEAD('\x2d\x06\x52\x6d'), 'skyddad.ufdr'), 'zip', 'en rapport som inte är en zip får sitt besked när den öppnas');
    assert.strictEqual(DbIdentify.kindOf(HEAD('\x1f\x8b\x08\x00'), 'powerlog_2026-02-12_6AF36970.PLSQL.gz'), 'gzip');
    assert.strictEqual(DbIdentify.kindOf(HEAD('SQLite format 3\x00'), 'Photos.sqlite'), 'sqlite');
    assert.strictEqual(DbIdentify.kindOf(HEAD('SQLite format 3\x00'), 'app_usage'), 'sqlite');
    assert.strictEqual(DbIdentify.kindOf(HEAD('\x37\x7f\x06\x82\x00\x2d\xe2\x18'), 'okänt namn'), 'wal');
    assert.strictEqual(DbIdentify.kindOf(new Uint8Array(0), 'Photos.sqlite-wal'), 'wal', 'en tom -wal känns igen på namnet');
    assert.strictEqual(DbIdentify.kindOf(HEAD('\x00\x01'), 'Photos.sqlite-shm'), 'companion');
    assert.strictEqual(DbIdentify.kindOf(HEAD('\x00\x01'), 'signal.db-journal'), 'companion');
    assert.strictEqual(DbIdentify.kindOf(HEAD('\x8a\x11\x02\x93salt-salt-salt'), 'signal.db'), 'other', 'SQLCipher börjar med saltet');
    assert.strictEqual(DbIdentify.kindOf(new Uint8Array(0), 'Extraktion.ZIP'), 'zip');
});

test('sortPicked: databas och -wal paras ihop, -shm hoppas över', () => {
    const items = (names) => names.map((name) => ({ name, kind: DbIdentify.kindOf(new Uint8Array(0), name) === 'other' ? 'sqlite' : DbIdentify.kindOf(new Uint8Array(0), name) }));
    const p = DbIdentify.sortPicked(items(['Cache.sqlite-shm', 'Cache.sqlite-wal', 'Cache.sqlite']));
    assert.deepStrictEqual([p.dbs, p.wal, p.journal, p.mismatch], [[2], 1, null, false]);
    assert.strictEqual(DbIdentify.sortPicked(items(['Cache.sqlite', 'Local.sqlite-wal'])).mismatch, true);
    assert.deepStrictEqual(DbIdentify.sortPicked(items(['Cache.sqlite-wal'])).dbs, []);
    assert.strictEqual(DbIdentify.sortPicked(items(['signal.db', 'signal.db-journal'])).journal, 1);
    assert.deepStrictEqual(DbIdentify.sortPicked(items(['a.db', 'b.db'])).dbs, [0, 1]);
    assert.deepStrictEqual(DbIdentify.sortPicked([{ name: 'x.zip', kind: 'zip' }, { name: 'Photos.sqlite', kind: 'sqlite' }]).zips, [0]);
});

test('Photos.sqlite: varje iOS-versions schema ger rätt databas', async () => {
    const SQL = await loadSql();
    const databases = catalogDatabases();
    const expected = { '11-13': 'photos-ios10-13', 14: 'photos-ios14', 15: 'photos-ios15-16', 16: 'photos-ios15-16', 17: 'photos-ios17-plus', 18: 'photos-ios17-plus', 26: 'photos-ios17-plus' };
    for (const [version, id] of Object.entries(expected)) {
        const ranked = DbIdentify.rank(SQL, schemaDb(SQL, schemas[version]), databases, { name: 'Photos.sqlite' });
        const found = DbIdentify.conclude(ranked);
        assert.ok(found, 'iOS ' + version + ': inget passade');
        assert.strictEqual(found.best, id, 'iOS ' + version);
        assert.deepStrictEqual(found.families, ['photos'], 'iOS ' + version);
        assert.strictEqual(found.partial, false, 'iOS ' + version + ': alla queries ska passa');
    }
});

test('den valda databasen går före när flera passar, men inte före en som passar helt', async () => {
    const SQL = await loadSql();
    const databases = catalogDatabases();
    const files = ['_id', '_data', '_display_name', 'mime_type', 'date_added', 'date_modified', 'datetaken', 'owner_package_name',
        'relative_path', '_size', 'is_trashed', 'volume_name', 'media_type', 'bucket_display_name', 'generation_added',
        'generation_modified', 'is_pending', 'is_download', 'is_favorite', 'width', 'height', 'orientation', 'title', 'duration',
        'document_id', 'instance_id', 'original_document_id'];
    // MediaStore har vyn images ovanpå files.
    const bytes = schemaDb(SQL, { files: files }, 'CREATE VIEW images AS SELECT * FROM files WHERE media_type = 1');
    const plain = DbIdentify.conclude(DbIdentify.rank(SQL, bytes, databases, { name: 'external.db' }));
    assert.strictEqual(plain.best, 'android-mediastore');
    assert.deepStrictEqual(plain.families.sort(), ['android-camera', 'android-mediastore'], 'kamerans filer ligger i samma external.db');
    const camera = DbIdentify.conclude(DbIdentify.rank(SQL, bytes, databases, { name: 'external.db', prefer: 'android-camera' }));
    assert.strictEqual(camera.best, 'android-camera');
    // Utan vyn passar inte alla MediaStore-queries, men filen gäller ändå MediaStore.
    const older = DbIdentify.conclude(DbIdentify.rank(SQL, schemaDb(SQL, { files: files }), databases, { name: 'external.db' }));
    assert.deepStrictEqual(older.families.sort(), ['android-camera', 'android-mediastore']);
    // Photos.sqlite för iOS 14 vald, men filen är från iOS 17: den som passar helt vinner.
    const photos = DbIdentify.conclude(DbIdentify.rank(SQL, schemaDb(SQL, schemas['17']), databases, { prefer: 'photos-ios14' }));
    assert.strictEqual(photos.best, 'photos-ios17-plus');
});

test('Snapchats arroyo.db: Android har fler kolumner, och då vinner Android', async () => {
    const SQL = await loadSql();
    const databases = catalogDatabases();
    const ios = ['client_conversation_id', 'server_message_id', 'client_message_id', 'message_state_type', 'message_content', 'creation_timestamp', 'read_timestamp'];
    const android = ios.concat(['sender_id', 'content_type', 'created_on_device', 'is_saved', 'is_viewed_by_user', 'remote_media_count']);
    const fromIos = DbIdentify.conclude(DbIdentify.rank(SQL, schemaDb(SQL, { conversation_message: ios }), databases, { name: 'arroyo.db' }));
    assert.strictEqual(fromIos.best, 'snapchat-arroyo');
    assert.deepStrictEqual(fromIos.families, ['snapchat-arroyo'], 'Android-queries ska inte passa iOS-filen');
    const fromAndroid = DbIdentify.conclude(DbIdentify.rank(SQL, schemaDb(SQL, { conversation_message: android }), databases, { name: 'arroyo.db' }));
    assert.strictEqual(fromAndroid.best, 'snapchat-android-arroyo');
    assert.ok(fromAndroid.families.includes('snapchat-arroyo'), 'iOS-queries går också att köra mot Android-filen');
});

test('schemafrågor räknas inte: en databas utan katalogens tabeller känns inte igen', async () => {
    const SQL = await loadSql();
    const databases = catalogDatabases();
    const ranked = DbIdentify.rank(SQL, schemaDb(SQL, { notes: ['id', 'text'] }), databases, { name: 'notes.sqlite' });
    assert.deepStrictEqual(ranked, []);
    assert.strictEqual(DbIdentify.conclude(ranked), null);
    // Varje query som bara är kommentarer eller går mot en tom databas är borttagen ur kontrollen.
    const checks = DbIdentify.checks(SQL, databases);
    assert.ok(databases.find((d) => d.id === 'routined-cache').queries.some((q) => q.id === 'tables'));
    assert.ok(checks['routined-cache'].every((sql) => !/sqlite_master/i.test(sql)));
});

test('alla databaser som zippen letar efter går att känna igen på schemat', async () => {
    const SQL = await loadSql();
    const checks = DbIdentify.checks(SQL, catalogDatabases());
    const missing = catalogDatabases().filter((d) => d.paths.length && !d.cipher && !checks[d.id].length).map((d) => d.id);
    assert.deepStrictEqual(missing, []);
});

test('fromName: krypterade databaser och tabeller som bara finns i -wal', () => {
    const databases = catalogDatabases();
    assert.strictEqual(DbIdentify.fromName('signal.db', databases, { encrypted: true }).best, 'signal-android-main');
    assert.strictEqual(DbIdentify.fromName('signal-logs.db', databases, { encrypted: true }).best, 'signal-android-logs');
    assert.strictEqual(DbIdentify.fromName('external.db', databases, { encrypted: true }), null, 'MediaStore är inte krypterad');
    assert.strictEqual(DbIdentify.fromName('random.bin', databases), null);
    const arroyo = DbIdentify.fromName('arroyo.db', databases, { os: 'Android' });
    assert.strictEqual(arroyo.best, 'snapchat-android-arroyo');
    assert.deepStrictEqual(arroyo.families.sort(), ['snapchat-android-arroyo', 'snapchat-arroyo']);
    assert.strictEqual(DbIdentify.fromName('ARROYO.DB', databases, { prefer: 'snapchat-arroyo', os: 'Android' }).best, 'snapchat-arroyo');
});

test('SQLCipher med okrypterat huvud (Signal på iOS) räknas som krypterad, en vanlig databas med reserv gör det inte', () => {
    const head = (reserve, page1) => {
        const b = Buffer.alloc(128);
        b.write('SQLite format 3\0', 0, 'latin1');
        b.writeUInt16BE(4096, 16);
        b[20] = reserve;
        page1.copy(b, 100);
        return new Uint8Array(b);
    };
    const btree = Buffer.from([0x0d, 0, 0, 0, 1, 0x0f, 0x80, 0]);
    const random = Buffer.from([0x9f, 0x3c, 0x71, 0x02, 0xe4, 0xaa, 0x10, 0xc8]);
    assert.strictEqual(DbIdentify.kindOf(head(80, random), 'signal.sqlite'), 'other');
    assert.strictEqual(DbIdentify.kindOf(head(80, btree), 'vanlig.sqlite'), 'sqlite', 'reserv men ett riktigt b-träd');
    assert.strictEqual(DbIdentify.kindOf(head(0, random), 'x.sqlite'), 'sqlite', 'ingen reserv: vanlig SQLite');
    assert.strictEqual(DbIdentify.kindOf(head(80, random).subarray(0, 16), 'signal.sqlite'), 'sqlite', 'bara 16 byte: går inte att avgöra');
    assert.strictEqual(DbIdentify.fromName('signal.sqlite', catalogDatabases(), { encrypted: true }).best, 'signal-ios-main');
});

test('Telegrams databaser känns igen när formatet avkodats, inte annars', async () => {
    const SQL = await loadSql();
    const PB = require('./postbox.js');
    const E = require('./fixtures/postbox-encode');
    const KIM = E.peer(0, 7000000002);
    const postbox = E.postboxDb(SQL, { messages: [{ peer: KIM, timestamp: 1793000000, id: 1, text: 'Hej' }], peers: [{ peer: KIM, value: E.user({ id: 7000000002, fn: 'Kim' }) }] });
    const storage = E.storageDb(SQL, { entries: [{ id: 'telegram-cloud-document-1-99' }] });
    const databases = catalogDatabases();
    const best = (bytes, opts) => DbIdentify.conclude(DbIdentify.rank(SQL, bytes, databases, opts));
    const p = best(postbox, { name: 'db_sqlite', attach: PB.attach });
    assert.deepStrictEqual([p.best, p.partial], ['telegram-ios-postbox', false]);
    assert.deepStrictEqual([best(storage, { name: 'db_sqlite', attach: PB.attach }).best], ['telegram-ios-storage']);
    // Utan avkodningen finns inga tg_-tabeller, och bara nyckelkontrollen och tabellistan passar.
    const raw = DbIdentify.rank(SQL, postbox, databases, { name: 'db_sqlite', attach: () => null }).find((r) => r.id === 'telegram-ios-postbox');
    assert.ok(raw && !raw.full, 'utan tg_-tabellerna passar inte alla queries');
});

