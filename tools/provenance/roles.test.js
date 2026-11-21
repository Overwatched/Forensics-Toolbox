// Rollerna samlas ur katalogerna, rätt Photos-band väljs efter iOS-versionen, och
// platshållarna fylls i med tal i rätt epok.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const roles = require('./roles');

const ROOT = path.join(__dirname, '..', '..');
const catalogs = {
    photos: require(path.join(ROOT, 'queries', 'ios', 'photos-sqlite', 'catalog.json')),
    android: require(path.join(ROOT, 'queries', 'android', 'catalog.json')),
    appUsage: require(path.join(ROOT, 'queries', 'app-usage', 'catalog.json')),
    routined: require(path.join(ROOT, 'queries', 'ios', 'routined', 'catalog.json')),
    snapchat: require(path.join(ROOT, 'queries', 'ios', 'snapchat', 'catalog.json')),
    snapchatAndroid: require(path.join(ROOT, 'queries', 'android', 'snapchat', 'catalog.json')),
    signalAndroid: require(path.join(ROOT, 'queries', 'android', 'signal', 'catalog.json')),
    samsungAndroid: require(path.join(ROOT, 'queries', 'android', 'samsung', 'catalog.json')),
};

test('alla källor och roller finns', () => {
    const sources = roles.collect(catalogs);
    const byKey = Object.fromEntries(sources.map((s) => [s.key, s]));
    assert.deepStrictEqual(Object.keys(byKey).sort(), ['android-mediastore', 'knowledgec', 'photos', 'powerlog', 'routined-cache', 'samsung-rubin-logging', 'signal-android-logs', 'signal-android-main', 'snapchat-android-arroyo', 'snapchat-android-cache', 'snapchat-android-core', 'snapchat-android-friends', 'snapchat-android-journal', 'snapchat-android-memories', 'snapchat-android-notifications', 'snapchat-arroyo', 'snapchat-cache', 'snapchat-friends', 'snapchat-gallery', 'snapchat-memories', 'snapchat-notifications', 'wellbeing']);
    assert.strictEqual(byKey['signal-android-main'].cipher, 'signal');
    assert.strictEqual(byKey['signal-android-main'].databases[0].cipher, 'signal');
    assert.deepStrictEqual(Object.keys(byKey['signal-android-main'].roles).sort(), ['attachments', 'coverage', 'messages', 'recipients']);
    assert.strictEqual(byKey['snapchat-cache'].beta, true);
    assert.strictEqual(byKey['snapchat-cache'].platform, 'iOS');
    assert.strictEqual(byKey['snapchat-android-cache'].platform, 'Android');
    assert.strictEqual(byKey['snapchat-android-cache'].beta, true);
    assert.strictEqual(byKey['snapchat-android-cache'].title, 'cache_controller.db (Snapchat cache)');
    assert.deepStrictEqual(Object.keys(byKey['snapchat-android-cache'].roles).sort(), ['cache-key', 'cache-window', 'coverage']);
    assert.deepStrictEqual(Object.keys(byKey['snapchat-android-memories'].roles).sort(), ['coverage', 'memories', 'memory-id', 'memory-size']);
    assert.deepStrictEqual(Object.keys(byKey['snapchat-android-core'].roles), ['save-setting']);
    assert.deepStrictEqual(Object.keys(byKey['snapchat-memories'].roles).sort(), ['coverage', 'memories', 'memory-id']);
    assert.strictEqual(byKey['snapchat-memories'].platform, 'iOS');
    assert.strictEqual(byKey['snapchat-gallery'].cipher, 'snapchat-gallery');
    assert.deepStrictEqual(Object.keys(byKey['snapchat-gallery'].roles), ['memory-locations', 'memory-key']);
    assert.deepStrictEqual(byKey['snapchat-android-arroyo'].paths, ['data/data/com.snapchat.android/databases/arroyo.db']);
    assert.deepStrictEqual(Object.keys(byKey['snapchat-cache'].roles).sort(), ['cache-key', 'cache-memory', 'cache-window', 'coverage']);
    assert.strictEqual(byKey.photos.bands.length, 4);
    for (const band of byKey.photos.bands) {
        assert.deepStrictEqual(Object.keys(band.roles).sort(), ['albums', 'file', 'gallery', 'neighbours', 'sequence'], band.id);
        assert.ok(band.roles.file.fields.created === 'ZDATECREATED');
        assert.strictEqual(band.roles.file.epoch, 'cocoa');
    }
    assert.deepStrictEqual(Object.keys(byKey.knowledgec.roles).sort(), ['app-infocus', 'app-usage', 'coverage', 'lock', 'screen']);
    assert.deepStrictEqual(Object.keys(byKey.powerlog.roles).sort(), ['pl-backlight', 'pl-camera', 'pl-coverage', 'pl-gaps', 'pl-lock', 'pl-screen']);
    assert.strictEqual(byKey.powerlog.platform, 'iOS');
    assert.deepStrictEqual(Object.keys(byKey.wellbeing.roles).sort(), ['app-events', 'coverage']);
    assert.strictEqual(byKey.wellbeing.platform, 'Android');
    assert.strictEqual(byKey.knowledgec.platform, 'iOS');
    assert.ok(byKey['android-mediastore'].paths.length >= 3);
    assert.deepStrictEqual(Object.keys(byKey['android-mediastore'].roles).sort(), ['file', 'gallery', 'media-extra', 'media-origin', 'neighbours', 'store-downloads']);
    // Rubin: krypterad med nyckeln Logging, positioner och appar i förgrunden till Härkomst.
    assert.strictEqual(byKey['samsung-rubin-logging'].cipher, 'rubin-logging');
    assert.strictEqual(byKey['samsung-rubin-logging'].platform, 'Android');
    assert.deepStrictEqual(Object.keys(byKey['samsung-rubin-logging'].roles).sort(), ['app-usage', 'coverage', 'location']);
    const dbs = roles.databases(sources);
    assert.ok(dbs.some((d) => d.id === 'photos-ios17-plus' && d.family === 'photos' && d.ios[0] === 17));
    assert.ok(dbs.every((d) => d.paths.length));
});

test('Photos-bandet väljs efter iOS-versionen och skaparkolumnen följer med', () => {
    const photos = roles.collect(catalogs).find((s) => s.key === 'photos');
    assert.strictEqual(roles.rolesFor(photos, { version: '18.7.7' }).file.fields.importer, 'ZIMPORTEDBYBUNDLEIDENTIFIER');
    assert.strictEqual(roles.rolesFor(photos, { version: '14.2' }).file.fields.importer, 'ZCREATORBUNDLEID');
    assert.strictEqual(roles.rolesFor(photos, { version: '12.0' }).file.fields.kindSubtype, undefined);
    assert.match(roles.rolesFor(photos, { version: '12.0' }).file.sql, /FROM ZGENERICASSET a/);
    assert.strictEqual(roles.rolesFor(photos, { dbId: 'photos-ios14' }).file.fields.importer, 'ZCREATORBUNDLEID');
    assert.strictEqual(roles.rolesFor(photos, {}).file.fields.importer, 'ZIMPORTEDBYBUNDLEIDENTIFIER');
});

test('platshållarna fylls i med tal i rätt epok och citerade strängar', () => {
    const window = { startMs: Date.UTC(2025, 8, 24, 12, 0, 0), endMs: Date.UTC(2025, 8, 24, 12, 30, 0) };
    const unix = Math.floor(window.startMs / 1000);
    const sql = roles.fill('a BETWEEN {{cocoaStart}} AND {{cocoaEnd}} b {{unixStart}} c {{unixMsEnd}} d \'{{filename}}\'', { window, filename: "IMG_0001'.HEIC" });
    assert.strictEqual(sql, 'a BETWEEN ' + (unix - 978307200) + ' AND ' + (unix + 1800 - 978307200) + ' b ' + unix + ' c ' + (window.endMs) + " d 'IMG_0001''.HEIC'");
    assert.throws(() => roles.fill('x {{filename}}', {}), /Platshållaren/);
});

test('råa tider blir UTC-millisekunder', () => {
    assert.strictEqual(roles.toMs(780409869.622, 'cocoa'), Math.round((780409869.622 + 978307200) * 1000));
    assert.strictEqual(roles.toMs(1727436336, 'unixS'), 1727436336000);
    assert.strictEqual(roles.toMs(1727436336123, 'unixMs'), 1727436336123);
    assert.strictEqual(roles.toMs(1727436336123, 'unixAuto'), 1727436336123);
    assert.strictEqual(roles.toMs(1727436336, 'unixAuto'), 1727436336000);
    assert.strictEqual(roles.toMs(null, 'cocoa'), null);
    assert.strictEqual(roles.toMs(0, 'unixS'), null);
});

test('mapRows ger fältkartans namn och Ms-fält för tider', () => {
    const q = { epoch: 'unixS', fields: { filename: '_display_name', created: { col: 'datetaken', epoch: 'unixAuto' }, added: 'date_added' } };
    const rows = roles.mapRows(q, { columns: ['_display_name', 'datetaken', 'date_added'], values: [['a.jpg', 1727436336123, 1727436400]] }, ['created', 'added']);
    assert.strictEqual(rows[0].filename, 'a.jpg');
    assert.strictEqual(rows[0].createdMs, 1727436336123);
    assert.strictEqual(rows[0].addedMs, 1727436400000);
    assert.strictEqual(rows[0]._raw.datetaken, 1727436336123);
});

test('utan iOS-version väljs Photos-bandet efter databasens tabeller och kolumner', () => {
    assert.strictEqual(roles.photosBandFromSchema(['ZGENERICASSET', 'ZADDITIONALASSETATTRIBUTES'], ['ZCREATORBUNDLEID']).id, 'photos-ios10-13');
    assert.strictEqual(roles.photosBandFromSchema(['ZASSET'], ['ZCREATORBUNDLEID']).id, 'photos-ios14');
    assert.strictEqual(roles.photosBandFromSchema(['ZASSET'], ['ZIMPORTEDBYBUNDLEIDENTIFIER']).id, 'photos-ios17-plus');
    assert.strictEqual(roles.photosBandFromSchema(['ZFOO'], []), null);
    const sources = roles.collect(catalogs);
    const photos = sources.find((s) => s.key === 'photos');
    ['photos-ios10-13', 'photos-ios14', 'photos-ios17-plus'].forEach((id) => assert.ok(photos.bands.some((b) => b.id === id), id + ' finns som band'));
});

test('WhatsApp och Telegram på Android är egna källor, i beta, utan chattrollerna', () => {
    const sources = roles.collect({
        whatsappAndroid: require(path.join(ROOT, 'queries', 'android', 'whatsapp', 'catalog.json')),
        telegramAndroid: require(path.join(ROOT, 'queries', 'android', 'telegram', 'catalog.json')),
    });
    const byKey = Object.fromEntries(sources.map((s) => [s.key, s]));
    assert.deepStrictEqual(Object.keys(byKey['whatsapp-android-msgstore'].roles).sort(), ['coverage', 'media', 'messages']);
    assert.deepStrictEqual(Object.keys(byKey['whatsapp-android-contacts'].roles), ['names']);
    assert.deepStrictEqual(Object.keys(byKey['telegram-android-cache4'].roles).sort(), ['coverage', 'messages', 'photo']);
    ['whatsapp-android-msgstore', 'whatsapp-android-contacts', 'telegram-android-cache4'].forEach((key) => {
        assert.strictEqual(byKey[key].platform, 'Android', key);
        assert.strictEqual(byKey[key].beta, true, key);
        assert.strictEqual(byKey[key].cipher, null, key);
        assert.doesNotMatch(byKey[key].title, /^Android/, key);
    });
    assert.strictEqual(byKey['whatsapp-android-msgstore'].title, 'msgstore.db (WhatsApp)');
    assert.deepStrictEqual(byKey['telegram-android-cache4'].paths, ['data/data/org.telegram.messenger/files/cache4.db']);
    // Bildens id sätts in som text mellan citattecken, och queryn läser den som hexadecimala tecken.
    const sql = roles.fill(byKey['telegram-android-cache4'].roles.photo.sql, { idHex: '0D7A3C5E9B1F0A4D' });
    assert.match(sql, /unhex\('0D7A3C5E9B1F0A4D'\)/);
    assert.doesNotMatch(sql, /\{\{/);
});

// ---------- En fråga över en stor logg i tidsdelar ----------

const fs = require('node:fs');
const SQLJS = path.join(ROOT, 'tools', 'ios-keychain', 'vendor', 'sqljs');
async function sqlite() {
    const ctx = {};
    new Function('window', fs.readFileSync(path.join(SQLJS, 'sql-wasm-binary.js'), 'utf8'))(ctx);
    const SQL = await require(path.join(SQLJS, 'sql-wasm.js'))({ wasmBinary: ctx.SQL_WASM_BINARY });
    return new SQL.Database();
}
const signalLog = () => catalogs.signalAndroid.databases.find((d) => d.id === 'signal-android-logs').queries.find((q) => q.role === 'log');
const ALL = { startMs: 0, endMs: 4102444800000 };

test('frågan över Signals logg går att dela efter tid, en vanlig rollquery gör det inte', () => {
    assert.strictEqual(roles.canSplit(signalLog()), true);
    assert.strictEqual(roles.canSplit(Object.assign({}, signalLog(), { splitByTime: false })), false);
    assert.strictEqual(roles.canSplit(Object.assign({}, signalLog(), { epoch: 'unix' })), false, 'bara tider i millisekunder');
    assert.strictEqual(roles.canSplit(Object.assign({}, signalLog(), { fields: { body: 'body' } })), false, 'tidsfältet behövs');
    const other = catalogs.signalAndroid.databases.find((d) => d.id === 'signal-android-main').queries.find((q) => q.role === 'messages');
    assert.strictEqual(roles.canSplit(other), false);
});

test('en fråga i tidsdelar ger rad för rad samma svar som hela frågan', async () => {
    const db = await sqlite();
    db.run('CREATE TABLE log (_id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL, keep_longer INTEGER DEFAULT 0, body TEXT NOT NULL, size INTEGER NOT NULL)');
    db.run('CREATE INDEX log_created_at_keep_longer_index ON log (created_at, keep_longer)');
    const kinds = ['BaseActivity: [MediaSendV3Activity] onCreate()', 'CameraScreenViewModel: Video recording started', 'något helt annat', 'AttachmentTable: Inserting attachment content://x for pre-upload.'];
    // Ett eget slumptal med fast frö, så att ett fel går att köra om.
    let seed = 20261113;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const T0 = Date.parse('2026-11-01T00:00:00Z');
    const add = db.prepare('INSERT INTO log (created_at, body, size) VALUES (?, ?, 1)');
    // Tätt och glest om vartannat, många rader på samma millisekund, och raderna inlagda i en annan ordning än tidens.
    for (let i = 0; i < 6000; i++) add.run([T0 + (rnd(4) ? rnd(40) * 1000 : 3600000 * rnd(72)) + rnd(3), kinds[rnd(kinds.length)] + ' ' + i]);
    // Rader som ett fönster lätt tappar: före och efter resten, vid fönstrets egna gränser, och en tid med decimaler.
    for (const ms of [0, 1, 5, T0 - 86400000, T0 + 400 * 86400000, ALL.endMs, ALL.endMs + 1, -5, T0 + 1234.5]) add.run([ms, kinds[0] + ' kant']);
    add.free();
    const query = signalLog();
    const exec = (sql) => { const all = db.exec(sql); return all.length ? all[all.length - 1] : null; };
    const whole = exec(roles.fill(query.sql, { window: ALL }));
    assert.ok(whole.values.length > 4000, 'provdatat ger rader: ' + whole.values.length);
    assert.ok(whole.values.some((r) => r[0] === T0 + 1234.5), 'raden med decimaler är med i hela frågan');
    const span = exec('SELECT MIN(created_at), MAX(created_at) FROM log').values[0];
    // Tiden en del tar är påhittad, så att delarna blir breda och smala om vartannat.
    for (const clock of [() => 100, () => 1, () => 5000, () => [1, 2000, 40, 9000][rnd(4)]]) {
        for (const ends of [{ firstMs: span[0], lastMs: span[1] }, { firstMs: T0, lastMs: T0 + 72 * 3600000 }, { firstMs: T0 + 5000, lastMs: T0 + 5003 }, { firstMs: T0 - 9e9, lastMs: T0 + 9e12 }]) {
            let t = 0, calls = 0;
            const fracs = [];
            const got = await roles.inParts(query, ALL, { span: ends, exec, now: () => (calls++ % 2 ? (t += clock()) : t), between: async (f) => { fracs.push(f); } });
            assert.deepStrictEqual(got.values, whole.values);
            assert.deepStrictEqual(got.columns, whole.columns);
            assert.strictEqual(fracs.length, got.parts - 1, 'en paus mellan varje del');
            assert.ok(got.parts <= 20001, 'delarna blir inte hur många som helst: ' + got.parts);
            assert.ok(fracs.every((f, i) => f > 0 && f < 1 && (!i || f > fracs[i - 1])), 'andelen växer hela vägen');
        }
    }
    // Delarna är flera, inte en enda som råkar vara hela frågan.
    const many = await roles.inParts(query, ALL, { span: { firstMs: span[0], lastMs: span[1] }, exec, now: () => 0 });
    assert.ok(many.parts > 3, 'antal delar: ' + many.parts);
    // Delad efter antal rader: då spelar det ingen roll för en dels längd att raderna ligger tätt och glest om
    // vartannat. Tiden en del tar är här antalet rader den läser gånger en påhittad tid per rad.
    const total = exec('SELECT count(*) FROM log').values[0][0];
    const spec = roles.edgeQuery(query, db.exec('EXPLAIN QUERY PLAN ' + roles.fill(query.sql, { window: { startMs: 1000, endMs: 1001 } }))[0].values);
    assert.strictEqual(spec.table, 'log');
    assert.strictEqual(spec.inIndex(db.exec('EXPLAIN QUERY PLAN ' + spec.sql(0, 100))[0].values), true, 'gränsen slås upp i indexet');
    assert.strictEqual(spec.inIndex(db.exec('EXPLAIN QUERY PLAN SELECT body FROM log ORDER BY body LIMIT 1 OFFSET 99')[0].values), false);
    const edge = (after, n) => { const r = db.exec(spec.sql(after, n)); return r.length && r[0].values.length ? r[0].values[0][0] : null; };
    for (const perRow of [0.001, 0.1, 5]) {
        let t = 0, calls = 0, read = 0, asked = 0;
        const counts = [], fracs = [];
        const at = (ms) => db.exec('SELECT count(*) FROM log WHERE created_at = ' + ms)[0].values[0][0];
        const counting = (sql) => {
            const m = /created_at BETWEEN (-?\d+) AND (-?\d+)/.exec(sql);
            read = db.exec('SELECT count(*) FROM log WHERE created_at BETWEEN ' + m[1] + ' AND ' + m[2])[0].values[0][0];
            // En del läser de rader som begärdes, och därtill bara dem som delar millisekund med någon av gränserna.
            assert.ok(read <= asked + at(m[1]) + at(m[2]) + 1, 'en del på ' + asked + ' rader läste ' + read);
            return exec(sql);
        };
        const got = await roles.inParts(query, ALL, {
            span: { firstMs: span[0], lastMs: span[1], rows: total }, exec: counting, aimMs: 50,
            edge: (after, n) => { asked = n; counts.push(n); return edge(after, n); },
            now: () => (calls++ % 2 ? (t += read * perRow) : t), between: async (f) => { fracs.push(f); },
        });
        assert.deepStrictEqual(got.values, whole.values, 'samma rader delat efter antal, ' + perRow + ' ms per rad');
        assert.deepStrictEqual(got.columns, whole.columns);
        assert.strictEqual(fracs.length, got.parts - 1);
        assert.ok(got.parts > 3 && got.parts <= 20001, 'antal delar: ' + got.parts);
        assert.ok(fracs.every((f, i) => f > 0 && f < 1 && (!i || f > fracs[i - 1])), 'andelen växer hela vägen');
        assert.ok(counts.every((n, i) => !i || n <= 2 * counts[i - 1]), 'antalet rader per del växer högst till det dubbla: ' + counts.slice(0, 12).join(' '));
    }
    // En gräns som inte går att använda ändrar inte svaret: resten tas i en del.
    for (const bad of [() => undefined, () => -1, (after) => after, () => { return NaN; }]) {
        const got = await roles.inParts(query, ALL, { span: { firstMs: span[0], lastMs: span[1], rows: total }, edge: bad, exec, now: () => 0 });
        assert.deepStrictEqual(got.values, whole.values);
        assert.strictEqual(got.parts, 1);
    }
    // En logg utan rader som passar ger ett tomt svar, som hela frågan.
    db.run("DELETE FROM log WHERE body NOT LIKE 'något%'");
    assert.strictEqual(exec(roles.fill(query.sql, { window: ALL })), null);
    assert.deepStrictEqual((await roles.inParts(query, ALL, { span: { firstMs: T0, lastMs: T0 + 1000 }, exec })).values, []);
    db.close();
});

test('en fråga körs bara i delar när tiden slås upp i ett index', async () => {
    const db = await sqlite();
    const query = signalLog();
    const plan = () => db.exec('EXPLAIN QUERY PLAN ' + roles.fill(query.sql, { window: { startMs: 1000, endMs: 1001 } }))[0].values;
    db.run('CREATE TABLE log (_id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL, keep_longer INTEGER DEFAULT 0, body TEXT NOT NULL, size INTEGER NOT NULL)');
    assert.strictEqual(roles.searchesByTime(query, plan()), false, 'utan index läser varje del hela tabellen');
    db.run('CREATE INDEX log_created_at_keep_longer_index ON log (created_at, keep_longer)');
    assert.strictEqual(roles.searchesByTime(query, plan()), true);
    assert.strictEqual(roles.searchesByTime(query, []), false);
    db.close();
});

// ---------- Meddelandena en gång, i en tabell i minnet med index på tiderna ----------

const signalMessages = () => catalogs.signalAndroid.databases.find((d) => d.id === 'signal-android-main').queries.find((q) => q.role === 'messages');

test('bara en fråga som katalogen märkt får en tabell med index, och fönstret är dess enda platshållare', () => {
    const q = signalMessages();
    const spec = roles.timeIndex(q);
    assert.strictEqual(spec.schema, 'ft_index');
    assert.strictEqual(spec.table, 'q_role_messages');
    const build = spec.build(ALL);
    assert.strictEqual(build.length, 3, 'tabellen och ett index per tidskolumn');
    assert.match(build[0], /^CREATE TABLE ft_index\."q_role_messages" AS SELECT\b[\s\S]*ORDER BY m\.date_received, m\._id$/);
    assert.match(build[0], /m\.date_sent BETWEEN 0 AND 4102444800000/);
    assert.strictEqual(build[1], 'CREATE INDEX ft_index."q_role_messages_1" ON "q_role_messages" ("date_sent")');
    assert.strictEqual(build[2], 'CREATE INDEX ft_index."q_role_messages_2" ON "q_role_messages" ("date_received")');
    assert.strictEqual(spec.lookup({ startMs: 1000.5, endMs: 2000.5 }),
        'SELECT * FROM ft_index."q_role_messages" WHERE "date_sent" BETWEEN 1000 AND 2001 OR "date_received" BETWEEN 1000 AND 2001 ORDER BY rowid');
    assert.strictEqual(roles.timeIndex(Object.assign({}, q, { indexByTime: undefined })), null);
    assert.strictEqual(roles.timeIndex(Object.assign({}, q, { indexByTime: [] })), null);
    assert.strictEqual(roles.timeIndex(Object.assign({}, q, { indexByTime: ['date_sent"; DROP TABLE message; --'] })), null, 'bara rena kolumnnamn');
    assert.strictEqual(roles.timeIndex(Object.assign({}, q, { sql: q.sql.replace('{{unixMsStart}}', '{{unixStart}}') })), null, 'en enda epok');
    assert.strictEqual(roles.timeIndex(Object.assign({}, q, { sql: q.sql.replace(/;\s*$/, " AND m.type = '{{type}}';") })), null, 'inget annat än fönstret');
    assert.strictEqual(roles.timeIndex(signalLog()), null);
    // En sekundfråga fyller uppslaget i sekunder, som frågan själv.
    const unix = roles.timeIndex({ id: 'x', indexByTime: ['t'], sql: 'SELECT t FROM m WHERE t BETWEEN {{unixStart}} AND {{unixEnd}} ORDER BY t, id;' });
    assert.strictEqual(unix.lookup({ startMs: 1500, endMs: 2500 }), 'SELECT * FROM ft_index."q_x" WHERE "t" BETWEEN 1 AND 3 ORDER BY rowid');
});

test('uppslaget i tabellen ger rad för rad samma svar som frågan mot databasen, för slumpade fönster', async () => {
    const db = await sqlite();
    // Signals tabeller med kolumnerna frågan läser. Påhittat innehåll.
    db.run('CREATE TABLE message (_id INTEGER PRIMARY KEY AUTOINCREMENT, date_sent INTEGER NOT NULL, date_received INTEGER NOT NULL, date_server INTEGER DEFAULT -1, type INTEGER NOT NULL, thread_id INTEGER NOT NULL, from_recipient_id INTEGER NOT NULL, to_recipient_id INTEGER NOT NULL, view_once INTEGER DEFAULT 0, deleted_by INTEGER, body TEXT)');
    db.run('CREATE TABLE thread (_id INTEGER PRIMARY KEY, recipient_id INTEGER NOT NULL)');
    db.run('CREATE TABLE attachment (_id INTEGER PRIMARY KEY, message_id INTEGER)');
    let seed = 20261114;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const T0 = Date.parse('2026-11-01T00:00:00Z');
    for (let i = 1; i <= 9; i++) db.run('INSERT INTO thread VALUES (?, ?)', [i, 100 + i]);
    const add = db.prepare('INSERT INTO message (date_sent, date_received, date_server, type, thread_id, from_recipient_id, to_recipient_id, view_once, deleted_by, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    // Många meddelanden på samma millisekund, sänt och mottaget långt isär, och raderna inlagda i en annan ordning än
    // tidens. Tråd 10–12 finns inte i thread.
    for (let i = 0; i < 5000; i++) {
        const sent = T0 + (rnd(3) ? rnd(60) * 1000 : rnd(40 * 86400) * 1000) + rnd(2);
        add.run([sent, rnd(4) ? sent + rnd(5) * 1000 : T0 + rnd(40 * 86400) * 1000, rnd(5) ? sent : -1, rnd(3), 1 + rnd(12), 1 + rnd(9), 1 + rnd(9), rnd(20) ? 0 : 1, rnd(30) ? null : 1 + rnd(9), rnd(4) ? 'text ' + i : rnd(2) ? '' : null]);
    }
    // Rader som ett uppslag lätt tappar eller dubblar: tiden 0, före 1970, efter 2100, vid gränserna för hela tiden,
    // sänt i fönstret men mottaget utanför och tvärtom, och en tid med decimaler.
    for (const [a, b] of [[0, 0], [-5, 7], [7, -5], [ALL.endMs, 1], [1, ALL.endMs], [ALL.endMs + 1, ALL.endMs + 1], [ALL.endMs + 1, T0], [T0 + 1234.5, T0 + 1234.5], [T0, T0 + 39 * 86400000], [T0 + 500, T0 + 500]]) add.run([a, b, -1, 1, 1, 1, 2, 0, null, 'kant']);
    add.free();
    for (let i = 0; i < 900; i++) db.run('INSERT INTO attachment (message_id) VALUES (?)', [1 + rnd(5000)]);
    db.run('PRAGMA query_only = ON');
    const query = signalMessages();
    const spec = roles.timeIndex(query);
    const exec = (sql) => { const all = db.exec(sql); return all.length ? all[all.length - 1] : null; };
    // Byggs som i Härkomst: skrivskyddet av bara under bygget, och det enda som skrivs är den bifogade minnesdatabasen.
    db.run('PRAGMA query_only = OFF');
    db.run("ATTACH DATABASE ':memory:' AS " + spec.schema);
    db.run(spec.drop);
    spec.build(ALL).forEach((sql) => db.run(sql));
    db.run('PRAGMA query_only = ON');
    assert.throws(() => db.run('DELETE FROM message'), /readonly/);
    assert.deepStrictEqual(exec("SELECT name FROM main.sqlite_master WHERE name LIKE 'q_%'"), null, 'inget skrevs i databasen själv');
    // Båda indexen används, så att uppslaget inte läser igenom tabellen.
    const plan = db.exec('EXPLAIN QUERY PLAN ' + spec.lookup({ startMs: T0, endMs: T0 + 1 }))[0].values.map((r) => r[3]).join(' | ');
    assert.match(plan, /USING INDEX q_role_messages_1 /);
    assert.match(plan, /USING INDEX q_role_messages_2 /);
    assert.doesNotMatch(plan, /SCAN/);
    let withRows = 0, both = 0;
    const same = (win, what) => {
        const direct = exec(roles.fill(query.sql, { window: win })), looked = exec(spec.lookup(win));
        assert.deepStrictEqual(looked, direct, what + ' ' + JSON.stringify(win));
        if (direct) {
            withRows++;
            const s = direct.columns.indexOf('date_sent'), r = direct.columns.indexOf('date_received');
            const inside = (v) => v >= Math.floor(win.startMs) && v <= Math.ceil(win.endMs);
            if (direct.values.some((row) => inside(row[s]) && inside(row[r]))) both++;
            assert.strictEqual(new Set(direct.values.map((row) => row[0])).size, direct.values.length, 'ett meddelande står en gång');
        }
    };
    same(ALL, 'hela tiden');
    assert.strictEqual(exec(spec.lookup(ALL)).values.length, 5010 - 1, 'alla utom raden med båda tiderna efter hela tiden');
    for (const win of [{ startMs: 0, endMs: 0 }, { startMs: 0, endMs: 7 }, { startMs: T0 + 1234, endMs: T0 + 1235 }, { startMs: T0 + 1234.5, endMs: T0 + 1234.5 }, { startMs: T0 + 500, endMs: T0 + 500 },
        { startMs: ALL.endMs, endMs: ALL.endMs }, { startMs: T0 + 41 * 86400000, endMs: T0 + 42 * 86400000 }, { startMs: T0 + 60000, endMs: T0 + 59000 }]) same(win, 'kant');
    for (let i = 0; i < 400; i++) {
        const c = T0 + rnd(40 * 86400) * 1000 + rnd(1000), half = [0, 1, 1000, 30 * 60000, 86400000, 5 * 86400000][rnd(6)] + rnd(3) / 2;
        same({ startMs: c - half, endMs: c + half }, 'slumpat');
    }
    for (let i = 0; i < 60; i++) { const c = T0 + rnd(60) * 1000; same({ startMs: c, endMs: c + rnd(3) }, 'tätt'); }
    assert.ok(withRows > 200, 'fönster med rader: ' + withRows);
    assert.ok(both > 50, 'fönster där en rad träffas på båda tiderna: ' + both);
    db.close();
});
