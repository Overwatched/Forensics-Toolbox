// Varje databas i Queries ska ha exakt en rekommenderad query som inte är en hjälpfråga,
// och varje query ska säga vad den gör.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const photos = require(path.join(ROOT, 'queries', 'ios', 'photos-sqlite', 'catalog.json'));
const android = require(path.join(ROOT, 'queries', 'android', 'catalog.json'));
const appUsage = require(path.join(ROOT, 'queries', 'app-usage', 'catalog.json'));
const routined = require(path.join(ROOT, 'queries', 'ios', 'routined', 'catalog.json'));
const snapchat = require(path.join(ROOT, 'queries', 'ios', 'snapchat', 'catalog.json'));
const snapchatAndroid = require(path.join(ROOT, 'queries', 'android', 'snapchat', 'catalog.json'));
const signalAndroid = require(path.join(ROOT, 'queries', 'android', 'signal', 'catalog.json'));
const signalIos = require(path.join(ROOT, 'queries', 'ios', 'signal', 'catalog.json'));
const whatsappIos = require(path.join(ROOT, 'queries', 'ios', 'whatsapp', 'catalog.json'));
const telegramIos = require(path.join(ROOT, 'queries', 'ios', 'telegram', 'catalog.json'));
const samsungAndroid = require(path.join(ROOT, 'queries', 'android', 'samsung', 'catalog.json'));
const SCHEMAS = require(path.join(__dirname, 'fixtures', 'chat-schemas.json'));
const fs = require('node:fs');

// Rollqueryer (hidden) hör till Härkomst och visas inte i Queries. De kontrolleras för sig.
const visible = (list) => list.filter((q) => !q.hidden);

function checkGroup(name, queries, describe) {
    queries = visible(queries);
    const recommended = queries.filter((q) => q.recommended);
    assert.strictEqual(recommended.length, 1, name + ': ska ha exakt en rekommenderad query');
    assert.notStrictEqual(recommended[0].group, 'advanced', name + ': den rekommenderade får inte vara en hjälpfråga');
    for (const q of queries) {
        const text = String(describe(q) || '').trim();
        assert.ok(text.length >= 20, name + '/' + q.id + ': beskrivningen saknas eller är för kort');
    }
}

test('Android: en rekommenderad query per kategori och beskrivning på alla', () => {
    for (const cat of android.categories) checkGroup('android-' + cat.id, cat.queries, (q) => q.description);
});

test('App-aktivitet: en rekommenderad query per databas och undertext på alla', () => {
    for (const db of appUsage.databases) checkGroup(db.id, db.queries, (q) => q.subtitle);
});

test('routined: en rekommenderad query per databas och undertext på alla', () => {
    for (const db of routined.databases) checkGroup(db.id, db.queries, (q) => q.subtitle);
});

test('snapchat (beta): en rekommenderad query per databas, undertext på alla, tider i millisekunder', () => {
    for (const db of snapchat.databases) checkGroup(db.id, db.queries, (q) => q.subtitle);
    for (const db of snapchat.databases) for (const q of db.queries) {
        if (/\{\{(cocoa|unix)(Start|End)\}\}/.test(q.sql)) assert.fail(db.id + '/' + q.id + ': Snapchat-tider är millisekunder, använd unixMs-platshållarna');
        if (!q.hidden && /\{\{unixMs/.test(q.sql)) assert.strictEqual(q.timeEpoch, 'unix-ms', db.id + '/' + q.id + ': timeEpoch');
    }
    const cache = snapchat.databases.find((d) => d.id === 'snapchat-cache');
    assert.match(cache.queries.find((q) => q.id === 'cached-media').sql, /CACHE_FILE_CLAIM[\s\S]*CACHE_FILE_METADATA/);
    const arroyo = snapchat.databases.find((d) => d.id === 'snapchat-arroyo');
    assert.match(arroyo.queries.find((q) => q.id === 'messages').sql, /hex\(substr\(message_content, 7, 16\)\)/, 'avsändar-id ska gå att kontrollera för hand');
});

test('Signal på Android (beta): krypterade databaser, en rekommenderad query per databas, tider i millisekunder, rollerna Härkomst behöver', () => {
    assert.deepStrictEqual(signalAndroid.databases.map((d) => d.id), ['signal-android-main', 'signal-android-logs']);
    for (const db of signalAndroid.databases) {
        assert.strictEqual(db.cipher, 'signal', db.id + ': krypterad med Signals inställningar');
        checkGroup(db.id, db.queries, (q) => q.subtitle);
        assert.ok(db.paths.every((p) => p.startsWith('data/data/org.thoughtcrime.securesms/databases/')), db.id + ': sökvägarna');
        for (const q of db.queries) {
            if (/\{\{(cocoa|unix)(Start|End)\}\}/.test(q.sql)) assert.fail(db.id + '/' + q.id + ': Signals tider är millisekunder');
            if (!q.hidden && /\{\{unixMs/.test(q.sql)) assert.strictEqual(q.timeEpoch, 'unix-ms', db.id + '/' + q.id + ': timeEpoch');
            if (q.hidden) { assert.strictEqual(q.epoch, 'unixMs', db.id + '/' + q.id + ': epoch'); assert.ok(q.fields, db.id + '/' + q.id + ': fields'); }
            for (const p of q.params || []) if (!/^time(Start|End)$/.test(p)) assert.ok(signalAndroid.paramLabels[p], db.id + '/' + q.id + ': etikett för ' + p);
        }
    }
    const roles = (id) => signalAndroid.databases.find((d) => d.id === id).queries.filter((q) => q.hidden && !/^chat-/.test(q.role)).map((q) => q.role).sort();
    assert.deepStrictEqual(roles('signal-android-main').filter((r) => !/^chat-/.test(r)), ['attachments', 'coverage', 'messages', 'recipients']);
    assert.deepStrictEqual(roles('signal-android-logs'), ['coverage', 'log']);
    // Fälten som signal.js läser.
    const att = signalAndroid.databases[0].queries.find((q) => q.role === 'attachments');
    for (const f of ['id', 'messageId', 'hashStart', 'hashEnd', 'sent', 'received', 'server', 'type', 'threadRecipient', 'fromId', 'toId', 'deletedBy']) assert.ok(att.fields[f], 'attachments.' + f);
});

test('snapchat på Android (beta): en rekommenderad query per databas, undertext på alla, tider i millisekunder, sökvägar under appens datamapp', () => {
    assert.deepStrictEqual(snapchatAndroid.databases.map((d) => d.id), ['snapchat-android-cache', 'snapchat-android-arroyo', 'snapchat-android-friends', 'snapchat-android-notifications', 'snapchat-android-memories', 'snapchat-android-journal']);
    for (const db of snapchatAndroid.databases) {
        checkGroup(db.id, db.queries, (q) => q.subtitle);
        assert.ok(db.paths.every((p) => p.startsWith('data/data/com.snapchat.android/databases/')), db.id + ': sökvägarna');
        for (const q of db.queries) {
            if (/\{\{(cocoa|unix)(Start|End)\}\}/.test(q.sql)) assert.fail(db.id + '/' + q.id + ': Snapchat-tider är millisekunder, använd unixMs-platshållarna');
            if (!q.hidden && /\{\{unixMs/.test(q.sql)) assert.strictEqual(q.timeEpoch, 'unix-ms', db.id + '/' + q.id + ': timeEpoch');
            if (q.hidden) { assert.strictEqual(q.epoch, 'unixMs', db.id + '/' + q.id + ': epoch'); assert.ok(q.fields, db.id + '/' + q.id + ': fields'); }
        }
    }
    const roles = (id) => snapchatAndroid.databases.find((d) => d.id === id).queries.filter((q) => q.hidden && !/^chat-/.test(q.role)).map((q) => q.role).sort();
    assert.deepStrictEqual(roles('snapchat-android-cache'), ['cache-key', 'cache-window', 'coverage']);
    assert.deepStrictEqual(roles('snapchat-android-arroyo'), ['coverage', 'messages']);
    assert.deepStrictEqual(roles('snapchat-android-memories'), ['coverage', 'memories']);
    // Samma fältkarta som iOS för cache och meddelanden, så att snapchat.js kan läsa båda.
    const iosCache = snapchat.databases.find((d) => d.id === 'snapchat-cache').queries.find((q) => q.role === 'cache-window');
    const andCache = snapchatAndroid.databases.find((d) => d.id === 'snapchat-android-cache').queries.find((q) => q.role === 'cache-window');
    assert.deepStrictEqual(andCache.fields, iosCache.fields);
    const msg = snapchatAndroid.databases.find((d) => d.id === 'snapchat-android-arroyo').queries.find((q) => q.role === 'messages');
    assert.strictEqual(msg.fields.senderId, 'sender_id');
    assert.strictEqual(msg.fields.createdOnDevice, 'created_on_device');
    const mem = snapchatAndroid.databases.find((d) => d.id === 'snapchat-android-memories').queries.find((q) => q.role === 'memories');
    assert.strictEqual(mem.fields.captured, 'snap_capture_time');
    assert.strictEqual(mem.fields.front, 'front_facing');
});

test('routined: positionerna tar bara med kända ZTYPE (1 GNSS, 4 Wi-Fi) och filtrerar på råtiden', () => {
    const q = routined.databases[0].queries.find((x) => x.id === 'locations');
    assert.match(q.sql, /ZTYPE IN \(1, 4\)/);
    assert.match(q.sql, /ZTIMESTAMP BETWEEN \{\{cocoaStart\}\} AND \{\{cocoaEnd\}\}/);
    assert.doesNotMatch(q.sql, /WHERE[\s\S]*localtime/);
});

test('Photos.sqlite: en rekommenderad query i varje band och undertext på alla', () => {
    for (const band of photos.bands) {
        const ids = new Set(band.queries.map((q) => q.id));
        checkGroup('photos-' + band.id, photos.questions.filter((q) => ids.has(q.id)), (q) => q.subtitle);
    }
});

test('hjälpfrågor heter "Hjälp: …" eller "Tips: …"', () => {
    const all = [
        ...photos.questions.map((q) => [q.id, q.label, q.group]),
        ...android.categories.flatMap((c) => c.queries.map((q) => [q.id, q.title, q.group])),
        ...appUsage.databases.flatMap((d) => d.queries.map((q) => [q.id, q.title, q.group])),
        ...routined.databases.flatMap((d) => d.queries.map((q) => [q.id, q.title, q.group])),
        ...snapchat.databases.flatMap((d) => d.queries.map((q) => [q.id, q.title, q.group])),
        ...samsungAndroid.databases.flatMap((d) => d.queries.map((q) => [q.id, q.title, q.group])),
    ];
    for (const [id, title, group] of all) {
        if (/^(Hjälp|Tips):/.test(title)) assert.strictEqual(group, 'advanced', id + ': hjälpfråga utan group advanced');
    }
});

// Härkomst hämtar sin SQL ur katalogerna via fältet role. Varje rollquery är dold i Queries,
// anger epoch för tiderna och har en fältkarta vars kolumner finns i SQL:en.
test('rollqueryer för Härkomst: dolda, med epoch och fältkarta som stämmer med SQL:en', () => {
    const groups = [];
    for (const band of photos.bands) {
        for (const q of band.queries) {
            const question = photos.questions.find((x) => x.id === q.id);
            if (!question || !question.hidden) continue;
            groups.push(['photos-' + band.id + '/' + q.id, Object.assign({}, question, q)]);
        }
    }
    for (const db of appUsage.databases) for (const q of db.queries) if (q.hidden) groups.push([db.id + '/' + q.id, q]);
    for (const db of routined.databases) for (const q of db.queries) if (q.hidden) groups.push([db.id + '/' + q.id, q]);
    for (const db of snapchat.databases) for (const q of db.queries) if (q.hidden) groups.push([db.id + '/' + q.id, q]);
    for (const db of signalIos.databases.concat(whatsappIos.databases, telegramIos.databases)) for (const q of db.queries) if (q.hidden) groups.push([db.id + '/' + q.id, q]);
    for (const cat of android.categories) for (const q of cat.queries) if (q.hidden) groups.push(['android-' + cat.id + '/' + q.id, q]);
    assert.ok(groups.length >= 12, 'för få rollqueryer: ' + groups.length);
    for (const [name, q] of groups) {
        assert.ok(q.role, name + ': role saknas');
        assert.ok(['cocoa', 'unixS', 'unixMs'].includes(q.epoch), name + ': epoch saknas eller okänd');
        assert.ok(q.fields && typeof q.fields === 'object' && Object.keys(q.fields).length, name + ': fields saknas');
        for (const [key, spec] of Object.entries(q.fields)) {
            const col = typeof spec === 'string' ? spec : spec.col;
            assert.ok(col, name + ': fältet ' + key + ' saknar kolumn');
            assert.ok(new RegExp('\\b' + col + '\\b').test(q.sql), name + ': kolumnen ' + col + ' (' + key + ') finns inte i SQL:en');
            if (typeof spec !== 'string') assert.ok(['cocoa', 'unixS', 'unixMs', 'unixAuto'].includes(spec.epoch), name + ': ' + key + ' har okänd epoch');
        }
        assert.doesNotMatch(q.sql, /localtime/, name + ': rollqueryer returnerar råa tider, inte localtime');
    }
    const roles = (list) => list.filter((q) => q.hidden && !/^chat-/.test(q.role)).map((q) => q.role).sort();
    for (const band of photos.bands) {
        const ids = new Set(band.queries.map((q) => q.id));
        assert.deepStrictEqual(photos.questions.filter((q) => q.hidden && ids.has(q.id)).map((q) => q.role).sort(), ['file', 'neighbours', 'sequence'], 'photos-' + band.id);
    }
    assert.deepStrictEqual(roles(appUsage.databases.find((d) => d.id === 'knowledgec').queries), ['app-infocus', 'app-usage', 'coverage', 'lock', 'screen']);
    assert.deepStrictEqual(roles(appUsage.databases.find((d) => d.id === 'wellbeing').queries), ['app-events', 'coverage']);
    assert.deepStrictEqual(roles(routined.databases[0].queries), ['coverage', 'location']);
    assert.deepStrictEqual(roles(snapchat.databases.find((d) => d.id === 'snapchat-cache').queries), ['cache-key', 'cache-window', 'coverage']);
    assert.deepStrictEqual(roles(snapchat.databases.find((d) => d.id === 'snapchat-arroyo').queries), ['coverage', 'messages']);
    assert.deepStrictEqual(roles(snapchat.databases.find((d) => d.id === 'snapchat-friends').queries), ['friends']);
    assert.deepStrictEqual(roles(snapchat.databases.find((d) => d.id === 'snapchat-notifications').queries), ['coverage', 'notifications']);
    assert.deepStrictEqual(roles(android.categories.find((c) => c.id === 'mediastore').queries), ['file', 'neighbours']);
});

// Extraktion: databaserna hittas i en zip på sökvägarna i "paths". De skrivs utan inledande /
// och utan prefix, så att de kan jämföras bakifrån mot namnen i zippen.
test('sökvägar för extraktion: alla SQL-databaser har dem, och de är skrivna utan prefix', () => {
    const groups = [
        ['photos', photos.paths],
        ...appUsage.databases.map((d) => [d.id, d.paths]),
        ...routined.databases.map((d) => [d.id, d.paths]),
        ...snapchat.databases.map((d) => [d.id, d.paths]),
        ...signalIos.databases.concat(whatsappIos.databases, samsungAndroid.databases).map((d) => [d.id, d.paths]),
        ...android.categories.filter((c) => c.id !== 'usage').map((c) => ['android-' + c.id, c.paths]),
    ];
    for (const [name, paths] of groups) {
        assert.ok(Array.isArray(paths) && paths.length, name + ': paths saknas');
        for (const p of paths) {
            assert.ok(!/^\//.test(p) && !/\s|\(|…/.test(p), name + ': ' + p + ' ska vara en ren sökväg utan inledande /');
        }
    }
    const bands = photos.bands.map((b) => b.ios);
    assert.ok(bands.every((r) => Array.isArray(r) && r.length === 2), 'Photos: varje band behöver ios: [från, till]');
    for (let v = 10; v <= 26; v++) {
        assert.strictEqual(bands.filter((r) => v >= r[0] && v <= r[1]).length, 1, 'Photos: iOS ' + v + ' ska höra till exakt ett band');
    }
});

// ---------- Signal och WhatsApp på iOS ----------


let SQLJS = null;
async function sqlJs() {
    if (SQLJS) return SQLJS;
    const dir = path.join(ROOT, 'tools', 'ios-keychain', 'vendor', 'sqljs');
    const ctx = {};
    new Function('window', fs.readFileSync(path.join(dir, 'sql-wasm-binary.js'), 'utf8'))(ctx);
    SQLJS = await require(path.join(dir, 'sql-wasm.js'))({ wasmBinary: ctx.SQL_WASM_BINARY });
    return SQLJS;
}

// Varje query förbereds mot labbtelefonens schema (bara CREATE TABLE, inga data), med platshållarna ifyllda.
async function prepareAll(catalog, schema) {
    const S = await sqlJs();
    const db = new S.Database();
    Object.values(schema).forEach((sql) => db.run(sql));
    const errors = [];
    for (const d of catalog.databases) for (const q of d.queries) {
        const sql = q.sql.replace(/\{\{\w+\}\}/g, '0');
        try { db.prepare(sql).free(); } catch (e) { errors.push(d.id + '/' + q.id + ': ' + e.message); }
    }
    db.close();
    return errors;
}

test('Signal på iOS (beta): krypterad med iOS-profilen, en rekommenderad query, millisekunder, rollerna och schemat', async () => {
    assert.deepStrictEqual(signalIos.databases.map((d) => d.id), ['signal-ios-main']);
    const db = signalIos.databases[0];
    assert.strictEqual(db.cipher, 'signal-ios');
    assert.deepStrictEqual(db.paths, ['grdb/signal.sqlite']);
    checkGroup(db.id, db.queries, (q) => q.subtitle);
    for (const q of db.queries) {
        if (/\{\{(cocoa|unix)(Start|End)\}\}/.test(q.sql)) assert.fail(db.id + '/' + q.id + ': Signals tider är millisekunder');
        if (!q.hidden && /\{\{unixMs/.test(q.sql)) assert.strictEqual(q.timeEpoch, 'unix-ms', db.id + '/' + q.id + ': timeEpoch');
        if (q.hidden) { assert.strictEqual(q.epoch, 'unixMs'); assert.ok(q.fields, q.id + ': fields'); }
        for (const p of q.params || []) if (!/^time(Start|End)$/.test(p)) assert.ok(signalIos.paramLabels[p], q.id + ': etikett för ' + p);
    }
    assert.deepStrictEqual(db.queries.filter((q) => q.hidden && !/^chat-/.test(q.role)).map((q) => q.role).sort(), ['attachments', 'coverage', 'messages', 'recipients', 'stories']);
    const att = db.queries.find((q) => q.role === 'attachments');
    for (const f of ['id', 'messageId', 'ownerType', 'sha256', 'fileName', 'sent', 'received', 'type', 'threadName', 'isGroup', 'authorId']) assert.ok(att.fields[f], 'attachments.' + f);
    assert.deepStrictEqual(await prepareAll(signalIos, SCHEMAS['signal-ios']), []);
});

test('WhatsApp på iOS (beta): okrypterad, Cocoa-tider, SHA-256 och bildbibliotekets id i SQL:en, rollerna och schemat', async () => {
    assert.deepStrictEqual(whatsappIos.databases.map((d) => d.id), ['whatsapp-ios-chat']);
    const db = whatsappIos.databases[0];
    assert.strictEqual(db.cipher, undefined);
    checkGroup(db.id, db.queries, (q) => q.subtitle);
    for (const q of db.queries) {
        if (/\{\{unix/.test(q.sql)) assert.fail(db.id + '/' + q.id + ': WhatsApps tider är Cocoa-sekunder');
        if (!q.hidden && /\{\{cocoa/.test(q.sql)) assert.strictEqual(q.timeEpoch, 'cocoa', q.id + ': timeEpoch');
        if (q.hidden) { assert.strictEqual(q.epoch, 'cocoa'); assert.ok(q.fields, q.id + ': fields'); }
        for (const p of q.params || []) if (!/^time(Start|End)$/.test(p)) assert.ok(whatsappIos.paramLabels[p], q.id + ': etikett för ' + p);
    }
    assert.deepStrictEqual(db.queries.filter((q) => q.hidden && !/^chat-/.test(q.role)).map((q) => q.role).sort(), ['coverage', 'media', 'messages', 'stanzas']);
    const media = db.queries.find((q) => q.role === 'media');
    assert.match(media.sql, /instr\(i\.ZMETADATA, CAST\('\/L0\/001' AS BLOB\)\)/, 'bildbibliotekets id ur ZMETADATA');
    assert.match(media.sql, /length\(i\.ZVCARDNAME\) = 44/, 'SHA-256 i base64 ur ZVCARDNAME');
    assert.deepStrictEqual(await prepareAll(whatsappIos, SCHEMAS['whatsapp-ios']), []);
});

test('WhatsApp: bildbibliotekets id och SHA-256 läses ut i SQL, ett kontaktkort ger ingen summa', async () => {
    const S = await sqlJs();
    const db = new S.Database();
    Object.values(SCHEMAS['whatsapp-ios']).forEach((sql) => db.run(sql));
    const meta = new Uint8Array([0xa2, 0x04, 0x20, ...new Array(32).fill(7), 0x2b, ...Buffer.from('E0A969AD-D0EE-4693-97EE-DEF992DAD88A/L0/001')]);
    db.run('INSERT INTO ZWACHATSESSION (Z_PK, ZSESSIONTYPE, ZCONTACTJID, ZPARTNERNAME) VALUES (3, 0, ?, ?)', ['123@lid', 'Kim']);
    db.run('INSERT INTO ZWAMESSAGE (Z_PK, ZISFROMME, ZMESSAGETYPE, ZMESSAGEDATE, ZSENTDATE, ZCHATSESSION, ZMEDIAITEM) VALUES (10, 1, 1, 815397366, 815397366, 3, 9)');
    db.run('INSERT INTO ZWAMEDIAITEM (Z_PK, ZMESSAGE, ZMEDIALOCALPATH, ZFILESIZE, ZVCARDNAME, ZVCARDSTRING, ZMETADATA) VALUES (9, 10, ?, 55761, ?, ?, ?)', ['Media/123@lid/1/3/x.jpg', '07ZeqtAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'image/jpeg', meta]);
    db.run('INSERT INTO ZWAMESSAGE (Z_PK, ZISFROMME, ZMESSAGETYPE, ZMESSAGEDATE, ZCHATSESSION, ZMEDIAITEM) VALUES (7, 1, 4, 815397300, 3, 6)');
    db.run('INSERT INTO ZWAMEDIAITEM (Z_PK, ZMESSAGE, ZVCARDNAME, ZVCARDSTRING) VALUES (6, 7, ?, ?)', ['Kim Kontakt', 'BEGIN:VCARD\nVERSION:3.0\nFN:Kim Kontakt\nEND:VCARD']);
    const q = whatsappIos.databases[0].queries.find((x) => x.role === 'media');
    const res = db.exec(q.sql)[0];
    const rows = res.values.map((v) => Object.fromEntries(res.columns.map((c, i) => [c, v[i]])));
    db.close();
    const photo = rows.find((r) => r.media_id === 9);
    assert.strictEqual(photo.asset_uuid, 'E0A969AD-D0EE-4693-97EE-DEF992DAD88A');
    assert.strictEqual(photo.sha256_b64, '07ZeqtAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    assert.strictEqual(photo.mime, 'image/jpeg');
    const card = rows.find((r) => r.media_id === 6);
    assert.strictEqual(card.sha256_b64, null, 'kontaktkortets namn är ingen summa');
    assert.strictEqual(card.mime, null);
});

// ---------- Telegram på iOS ----------

test('Telegram på iOS (beta): två databaser som avkodas i minnet, unixsekunder och rollerna', () => {
    assert.deepStrictEqual(telegramIos.databases.map((d) => [d.id, d.paths[0], d.derive]), [
        ['telegram-ios-postbox', 'postbox/db/db_sqlite', 'telegram-postbox'], ['telegram-ios-storage', 'postbox/media/storage/db/db_sqlite', 'telegram-storage']]);
    for (const db of telegramIos.databases) {
        assert.strictEqual(db.cipher, undefined);
        checkGroup(db.id, db.queries, (q) => q.subtitle);
        for (const q of db.queries) {
            if (/\{\{(cocoa|unixMs)/.test(q.sql)) assert.fail(db.id + '/' + q.id + ': Telegrams tider är unixsekunder');
            if (!q.hidden && /\{\{unixStart/.test(q.sql)) assert.strictEqual(q.timeEpoch, 'unix', q.id + ': timeEpoch');
            if (q.hidden) assert.ok(q.fields, q.id + ': fields');
            for (const p of q.params || []) if (!/^time(Start|End)$/.test(p)) assert.ok(telegramIos.paramLabels[p], q.id + ': etikett för ' + p);
        }
    }
    assert.deepStrictEqual(telegramIos.databases[0].queries.filter((q) => q.hidden && !/^chat-/.test(q.role)).map((q) => q.role).sort(), ['coverage', 'messages', 'resources']);
    assert.deepStrictEqual(telegramIos.databases[1].queries.filter((q) => q.hidden).map((q) => q.role), ['storage']);
});

test('Telegram: varje query körs mot påhittade databaser i labbets form, och nycklarna läses också med vanlig SQL', async () => {
    const S = await sqlJs();
    const PB = require('./postbox');
    const E = require('./fixtures/postbox-encode');
    const KIM = E.peer(0, 7000000002);
    const ME = E.peer(0, 9000000001);
    const T = 1793000000;
    const msgs = [
        { peer: KIM, timestamp: T, id: 1, author: ME, text: 'Hej' },
        { peer: KIM, timestamp: T + 16, id: 2, author: ME, media: [E.image({ photoId: 601, sizes: [{ s: 'm', w: 240, h: 320, size: 6320 }, { s: 'y', w: 960, h: 1280, size: 34707 }] })] },
        { peer: KIM, timestamp: T + 30, id: 3, incoming: true, author: KIM, attributes: [E.viewOnce()], media: [E.image({ photoId: 602, sizes: [{ s: 'w', w: 1152, h: 2048, size: 262257 }] })] },
        { peer: KIM, timestamp: T + 80, id: 4, author: ME, globalTags: 1, media: [E.call({ id: 3, discard: 0 })] },
        { peer: KIM, timestamp: T + 101, id: 5, author: ME, media: [E.video({ fileId: 77, size: 114165, w: 464, h: 848 })] },
    ];
    const peers = [{ peer: KIM, value: E.user({ id: 7000000002, fn: 'Kim', p: '46700000000' }) }, { peer: ME, value: E.user({ id: 9000000001, fn: 'Jag' }) }];
    const dbs = {
        'telegram-ios-postbox': E.postboxDb(S, { messages: msgs, peers }),
        'telegram-ios-storage': E.storageDb(S, { entries: [
            { id: 'ph-E0A969AD-D0EE-4693-97EE-DEF992DAD88A_L0_001--690', contentType: 0, size: 34707, refs: [{ peer: KIM, messageId: 0 }] },
            { id: 'telegram-cloud-photo-size-4-601-y', contentType: 1, refs: [{ peer: KIM, messageId: 2 }] },
            { id: 'telegram-cloud-document-1-99', contentType: 0 },
        ] }),
    };
    const counts = {};
    for (const d of telegramIos.databases) {
        const db = new S.Database(dbs[d.id]);
        assert.ok(PB.attach(db), d.id + ': avkodas');
        for (const q of d.queries) {
            if (/^chat-/.test(q.role || '')) continue;
            const sql = q.sql.replace(/\{\{unixStart\}\}/g, '0').replace(/\{\{unixEnd\}\}/g, '4102444800').replace(/\{\{resourceId\}\}/g, 'telegram-cloud-photo-size-4-601-y_partial');
            let res;
            try { res = db.exec(sql); } catch (e) { assert.fail(d.id + '/' + q.id + ': ' + e.message); }
            counts[d.id + '/' + q.id] = res.length ? res[res.length - 1].values.length : 0;
        }
        db.close();
    }
    assert.deepStrictEqual(counts, {
        'telegram-ios-postbox/messages': 5, 'telegram-ios-postbox/media': 3, 'telegram-ios-postbox/resource': 1, 'telegram-ios-postbox/calls': 1,
        'telegram-ios-postbox/chats': 2, 'telegram-ios-postbox/message-keys': 5, 'telegram-ios-postbox/tables': 10,
        'telegram-ios-postbox/role-messages': 5, 'telegram-ios-postbox/role-resources': 5, 'telegram-ios-postbox/role-coverage': 1,
        'telegram-ios-storage/storage': 2, 'telegram-ios-storage/library-picks': 1, 'telegram-ios-storage/storage-resource': 1,
        'telegram-ios-storage/tables': 8, 'telegram-ios-storage/role-storage': 2,
    });
    // Chattrollerna på samma databas: chattarna med meddelanden, och meddelandena och den största resursen i den första.
    const chatDb = new S.Database(dbs['telegram-ios-postbox']);
    PB.attach(chatDb);
    const role = (r) => telegramIos.databases[0].queries.find((q) => q.role === r);
    const chatThreads = chatDb.exec(role('chat-threads').sql)[0];
    assert.ok(chatThreads && chatThreads.values.length >= 1, 'chattarna');
    const tid = chatThreads.values[0][chatThreads.columns.indexOf('thread_id')];
    const chatMsgs = chatDb.exec(role('chat-messages').sql.split('{{threadId}}').join(tid))[0];
    assert.ok(chatMsgs && chatMsgs.values.length >= 1, 'meddelandena i ' + tid);
    const chatAtts = chatDb.exec(role('chat-attachments').sql.split('{{threadId}}').join(tid));
    for (const row of chatAtts.length ? chatAtts[0].values : []) assert.match(row[chatAtts[0].columns.indexOf('file_path')], /^media\//);
    chatDb.close();
    // Kontrollen av nycklarna ger samma tid, id och peer som avkodningen, utan den.
    const db = new S.Database(dbs['telegram-ios-postbox']);
    const keys = db.exec(telegramIos.databases[0].queries.find((q) => q.id === 'message-keys').sql)[0];
    const row = Object.fromEntries(keys.columns.map((c, i) => [c, keys.values[1][i]]));
    assert.deepStrictEqual([row.meddelande_id, row.peer_id, row.tid_utc], [2, Number(KIM), new Date((T + 16) * 1000).toISOString().slice(0, 19).replace('T', ' ')]);
    db.close();
});


// ---------- PowerLog på iOS ----------

test('PowerLog: queryerna körs, tiden rättas med förskjutningen som gällde, glapp och täckning', async () => {
    const S = await sqlJs();
    const { powerlogDb } = require('./fixtures/powerlog-fixture');
    const Roles = require('../provenance/roles');
    const def = appUsage.databases.find((d) => d.id === 'powerlog');
    assert.deepStrictEqual(def.paths, ['Library/BatteryLife/CurrentPowerlog.PLSQL']);
    checkGroup(def.id, def.queries, (q) => q.subtitle);
    const T = 1793700000;
    const hb = [];
    for (let t = T - 7200; t <= T + 1800; t += 600) hb.push(t);
    for (let t = T + 1800 + 5 * 3600; t <= T + 1800 + 6 * 3600; t += 600) hb.push(t);   // telefonen avstängd i fem timmar
    const db = new S.Database(powerlogDb(S, {
        offsets: [{ at: T - 7200, system: -900 }, { at: T + 600, system: -905 }],
        camera: [{ t: T - 2, app: 'net.whatsapp.WhatsApp', state: 1 }, { t: T + 1, state: 0 }, { t: T + 900, app: 'ph.telegra.Telegraph', state: 1 }, { t: T + 903, state: 0 }],
        backlight: [{ t: T - 60, active: 1 }, { t: T + 1200, active: 0 }],
        blank: [{ t: T - 60, blanked: 0 }],
        lock: [{ t: T - 70, locked: 0 }],
        screen: [{ t: T - 30, bundle: 'net.whatsapp.WhatsApp' }, { t: T + 40, bundle: 'com.apple.springboard.home-screen' }],
        heartbeat: hb,
    }));
    for (const q of def.queries.filter((x) => !x.hidden)) {
        const sql = q.sql.replace(/\{\{unixStart\}\}/g, String(T - 3600)).replace(/\{\{unixEnd\}\}/g, String(T + 3600));
        try { db.exec(sql); } catch (e) { assert.fail(q.id + ': ' + e.message); }
    }
    const win = { startMs: (T - 600) * 1000, endMs: (T + 1800) * 1000 };
    const run = (role, keys) => {
        const q = def.queries.find((x) => x.role === role);
        const res = db.exec(Roles.fill(q.sql, q.params.length ? { window: win } : {}));
        return Roles.mapRows(q, res.length ? res[res.length - 1] : { columns: [], values: [] }, keys);
    };
    // Varje rad rättas med förskjutningen som gällde vid raden: före T+600 -900 s, efter -905 s.
    assert.deepStrictEqual(run('pl-camera', ['time']).map((r) => [Math.round(r.timeMs / 1000) - T, r.app, Number(r.state)]),
        [[-2, 'net.whatsapp.WhatsApp', 1], [1, null, 0], [900, 'ph.telegra.Telegraph', 1], [903, null, 0]]);
    assert.deepStrictEqual(run('pl-backlight', ['time']).map((r) => [Math.round(r.timeMs / 1000) - T, Number(r.active)]), [[-60, 1], [1200, 0]]);
    assert.deepStrictEqual(run('pl-lock', ['time']).map((r) => Math.round(r.timeMs / 1000) - T), [-70]);
    assert.deepStrictEqual(run('pl-screen', ['time']).map((r) => r.bundle), ['net.whatsapp.WhatsApp', 'com.apple.springboard.home-screen']);
    const gaps = run('pl-gaps', ['start', 'end']);
    assert.deepStrictEqual(gaps.map((g) => [Math.round(g.startMs / 1000) - T, Math.round(g.endMs / 1000) - T]), [[1800, 1800 + 5 * 3600]]);
    const cov = run('pl-coverage', ['first', 'last'])[0];
    assert.deepStrictEqual([Math.round(cov.firstMs / 1000) - T, Math.round(cov.lastMs / 1000) - T, Number(cov.rows)], [-7200, 1800 + 6 * 3600, hb.length]);
    db.close();
});

// ---------- Samsungs textfiler ----------

test('Samsung: eRR.p läses in som tabellen err, och varje query körs mot påhittade rader', async () => {
    const textLogs = require('./text-logs');
    assert.deepStrictEqual(samsungAndroid.databases.map((d) => [d.id, d.convert]), [['samsung-err-p', 'err-p']]);
    for (const db of samsungAndroid.databases) {
        assert.ok(textLogs.known(db.convert), db.id + ': okänd tolkning ' + db.convert);
        assert.strictEqual(db.queries.filter((q) => q.recommended).length, 1, db.id + ': en rekommenderad');
        for (const q of db.queries) assert.ok(q.subtitle && q.returns, db.id + '/' + q.id + ': undertext och returns');
    }
    // Påhittade rader i eRR.p:s form: huvudet LOGM, antalet rader och sista radens index, sedan raderna.
    const lines = [
        '2026-10-03 16:15:08+0200 | REBOOT | | REASON: device_locked_3days [0]',
        '2026-10-03 16:15:59+0200 | ON | RP | A000XXU1 [1]',
        '2023-01-01 09:00:00+0100 | ON | NP | A000XXU1 [2]',
        '2026-10-09 08:34:12+0200 | REBOOT | | REASON: recovery [3]',
    ];
    const head = Buffer.alloc(12);
    head.write('LOGM', 0, 'latin1');
    head.writeUInt32LE(lines.length, 4);
    head.writeUInt32LE(lines.length - 1, 8);
    const bytes = new Uint8Array(Buffer.concat([head, Buffer.from('\n' + lines.join('\n') + '\n')]));
    const S = await sqlJs();
    const conv = textLogs.toSqlite(S, 'err-p', bytes, 'eRR.p');
    assert.strictEqual(conv.rows, 4);
    assert.match(conv.line, /^eRR\.p är text: 4 rader, 1 med fel klocka lästes in i tabellen err i minnet/);
    const db = new S.Database(conv.bytes);
    try {
        const run = (id) => { const q = samsungAndroid.databases[0].queries.find((x) => x.id === id); const r = db.exec(q.sql); return r.length ? r[0] : { columns: [], values: [] }; };
        const all = run('err-all');
        assert.deepStrictEqual(all.columns, ['rad', 'tid', 'utc', 'vad', 'kod', 'orsak', 'orsak_i_ord', 'krasch', 'fel_klocka', 'text']);
        assert.ok(Number.isInteger(all.values[0][0]), 'radnumret i filen');
        assert.deepStrictEqual(all.values[0].slice(1, 8), ['2026-10-03 16:15:08+0200', '2026-10-03 14:15:08', 'REBOOT', '', 'device_locked_3days', 'låst i tre dygn', 0]);
        assert.deepStrictEqual(all.values.map((r) => r[8]), [0, 0, 1, 0], 'raden från 2023 har en tid före raden innan');
        assert.deepStrictEqual(run('err-downs').values.map((r) => r[3]), ['REBOOT', 'REBOOT']);
        assert.deepStrictEqual(run('err-locked').values.map((r) => [r[1], r[2]]), [['2026-09-30 14:15:08', '2026-10-03 14:15:08']]);
        assert.deepStrictEqual(run('err-clock').values.map((r) => r[1]), ['2023-01-01 09:00:00+0100']);
        assert.deepStrictEqual(db.exec('SELECT unix_ms FROM err WHERE rad = (SELECT min(rad) FROM err)')[0].values[0], [Date.UTC(2026, 9, 3, 14, 15, 8)]);
    } finally {
        db.close();
    }
    assert.throws(() => textLogs.toSqlite(S, 'okänd', bytes, 'x'), /Okänd textfil/);
});

// ---------- Chattar ----------
// Chattar har ingen egen SQL. En databas med chattroller ger konversationer, deltagare, meddelanden och bilagor med
// fasta fältnamn, och bara de här rollerna läses. De synliga queryerna kan ändras fritt; ett meddelande-query som har
// "chat" pekar ut kolumnerna med chattens och meddelandets id, så att raden kan öppnas i Chattar.
const CHAT_ROLES = {
    'chat-threads': ['id', 'name', 'kind'],
    'chat-members': ['threadId', 'id', 'name'],
    'chat-messages': ['id', 'threadId', 'fromMe', 'text', 'kind'],
    'chat-attachments': ['messageId', 'path'],
};
const CHAT_KINDS = ['text', 'image', 'video', 'audio', 'voice', 'file', 'contact', 'location', 'sticker', 'gif', 'call', 'system', 'deleted', 'poll', 'other'];
const THREAD_KINDS = ['person', 'group', 'status', 'channel', 'self', 'other'];

function chatDatabases() {
    const all = [photos, appUsage, routined, snapchat, snapchatAndroid, signalAndroid, signalIos, whatsappIos, telegramIos, samsungAndroid];
    const out = [];
    for (const cat of all) for (const db of cat.databases || []) if (db.queries.some((q) => q.role === 'chat-threads')) out.push([cat, db]);
    return out;
}

test('Chattar: varje databas med chattroller har alla fyra med fälten Chattar läser, tider med förklaring och sökvägar till filerna', () => {
    const dbs = chatDatabases();
    assert.ok(dbs.some(([, db]) => db.id === 'whatsapp-ios-chat'), 'WhatsApp på iOS har chattroller');
    for (const [cat, db] of dbs) {
        assert.ok(db.chatApp, db.id + ': chatApp saknas');
        // Bilagerollen är valfri: Snapchats medier ligger i cachen och kopplas inte till chatten.
        const have = db.queries.filter((q) => /^chat-/.test(q.role || '')).map((q) => q.role).sort();
        assert.deepStrictEqual(have.filter((r) => r !== 'chat-attachments'), ['chat-members', 'chat-messages', 'chat-threads'], db.id);
        for (const [role, required] of Object.entries(CHAT_ROLES)) {
            const q = db.queries.find((x) => x.role === role);
            if (!q && role === 'chat-attachments') continue;
            assert.ok(q.hidden, db.id + '/' + role + ': ska vara dold');
            // Meddelandena och bilagorna läses i omgångar med en förberedd sats (ChatCore.readRows), som bara kör den
            // första satsen. Ingen chattroll har därför mer än en.
            assert.ok(!/;\s*\S/.test(q.sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, '')), db.id + '/' + role + ': en enda sats');
            for (const f of required) assert.ok(q.fields[f], db.id + '/' + role + ': fältet ' + f + ' saknas');
            if (role === 'chat-messages' || role === 'chat-attachments') {
                assert.deepStrictEqual(q.params, ['threadId'], db.id + '/' + role + ': params');
                assert.match(q.sql, /'\{\{threadId\}\}'/, db.id + '/' + role + ': chattens id inom citattecken');
                assert.ok(cat.paramLabels && cat.paramLabels.threadId, db.id + ': etikett för threadId');
            } else assert.deepStrictEqual(q.params, [], db.id + '/' + role + ': inga params');
        }
        const msg = db.queries.find((q) => q.role === 'chat-messages');
        assert.ok(Array.isArray(msg.times) && msg.times.length, db.id + ': chat-messages.times');
        for (const t of msg.times) {
            assert.ok(msg.fields[t.key], db.id + ': tiden ' + t.key + ' finns inte i fälten');
            assert.ok(t.label && t.note, db.id + ': tiden ' + t.key + ' saknar label eller note');
            const col = typeof msg.fields[t.key] === 'string' ? msg.fields[t.key] : msg.fields[t.key].col;
            assert.ok(t.note.indexOf(col) === 0 || t.note.indexOf(col) > 0, db.id + ': förklaringen till ' + t.key + ' nämner inte kolumnen ' + col);
        }
        assert.ok(msg.times.some((t) => t.key === msg.sortTime), db.id + ': sortTime är ingen av tiderna');
        for (const d of msg.details || []) assert.ok(msg.fields[d.key] && d.label, db.id + ': detaljen ' + d.key);
        const att = db.queries.find((q) => q.role === 'chat-attachments') || { fileRoot: '.' };
        assert.match(att.fileRoot, /^(\.|\.\.(\/\.\.)*)$/, db.id + ': fileRoot är . eller .. uppåt');
        for (const q of db.queries.filter((x) => x.chat)) {
            assert.ok(!q.hidden, db.id + '/' + q.id + ': chat hör till synliga queryer');
            for (const col of [q.chat.thread, q.chat.message]) assert.match(q.sql, new RegExp('\\b' + col + '\\b'), db.id + '/' + q.id + ': kolumnen ' + col + ' finns inte i SQL:en');
        }
        assert.ok(db.queries.some((q) => q.chat && q.recommended), db.id + ': den rekommenderade meddelandequeryn kan öppnas i Chattar');
    }
    // En databas med bara namn (chat-names) har id och namn eller en kolumn att läsa namnen ur, och samma app som chatten.
    const all = [snapchat, snapchatAndroid, signalAndroid, signalIos, whatsappIos, telegramIos];
    const named = [];
    for (const cat of all) for (const db of cat.databases) {
        const q = db.queries.find((x) => x.role === 'chat-names');
        if (!q) continue;
        named.push(db.id);
        assert.ok(q.hidden && q.fields.id && (q.fields.name || q.nameFrom), db.id + ': chat-names');
        assert.ok(cat.databases.some((d) => d.chatApp === db.chatApp && d.queries.some((x) => x.role === 'chat-messages')), db.id + ': ingen chatt i samma app');
    }
    assert.deepStrictEqual(named.sort(), ['snapchat-android-friends', 'snapchat-friends']);
});

test('Chattar: WhatsApps roller ger slag, avsändare, typer, sökvägar och kontaktkort ur en databas med labbtelefonens schema', async () => {
    const S = await sqlJs();
    const db = new S.Database();
    Object.values(SCHEMAS['whatsapp-ios']).forEach((sql) => db.run(sql));
    const ins = (t, row) => db.run('INSERT INTO ' + t + ' (' + Object.keys(row).join(', ') + ') VALUES (' + Object.keys(row).map(() => '?').join(', ') + ')', Object.values(row));
    ins('ZWACHATSESSION', { Z_PK: 1, ZSESSIONTYPE: 0, ZCONTACTJID: '111@lid', ZPARTNERNAME: 'Kim' });
    ins('ZWACHATSESSION', { Z_PK: 2, ZSESSIONTYPE: 1, ZCONTACTJID: '999-1@g.us', ZPARTNERNAME: 'Klubben' });
    ins('ZWACHATSESSION', { Z_PK: 3, ZSESSIONTYPE: 3, ZCONTACTJID: '0@status' });
    ins('ZWAGROUPMEMBER', { Z_PK: 5, ZCHATSESSION: 2, ZMEMBERJID: '222@lid', ZCONTACTNAME: 'Lo', ZISADMIN: 1, ZISACTIVE: 1 });
    ins('ZWAPROFILEPUSHNAME', { Z_PK: 1, ZJID: '333@lid', ZPUSHNAME: 'Mo' });
    ins('ZWAMESSAGE', { Z_PK: 10, ZCHATSESSION: 1, ZISFROMME: 1, ZMESSAGETYPE: 0, ZTEXT: 'Hej', ZMESSAGEDATE: 815000000, ZSENTDATE: 815000001 });
    ins('ZWAMESSAGE', { Z_PK: 11, ZCHATSESSION: 1, ZISFROMME: 0, ZMESSAGETYPE: 38, ZFROMJID: '111@lid', ZMESSAGEDATE: 815000100, ZSENTDATE: 815000099, ZMEDIAITEM: 1 });
    ins('ZWAMEDIAITEM', { Z_PK: 1, ZMESSAGE: 11, ZMEDIALOCALPATH: 'Media/111@lid/a/b/x.jpg', ZFILESIZE: 100, ZVCARDNAME: '07ZeqtAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', ZVCARDSTRING: 'image/jpeg' });
    ins('ZWAMESSAGE', { Z_PK: 12, ZCHATSESSION: 1, ZISFROMME: 0, ZMESSAGETYPE: 4, ZFROMJID: '111@lid', ZMESSAGEDATE: 815000200, ZMEDIAITEM: 2 });
    ins('ZWAMEDIAITEM', { Z_PK: 2, ZMESSAGE: 12, ZVCARDNAME: 'Kim Kontakt', ZVCARDSTRING: 'BEGIN:VCARD\nFN:Kim Kontakt\nEND:VCARD' });
    ins('ZWAMESSAGE', { Z_PK: 20, ZCHATSESSION: 2, ZISFROMME: 0, ZMESSAGETYPE: 0, ZGROUPMEMBER: 5, ZTEXT: 'Från Lo', ZMESSAGEDATE: 815000300 });
    ins('ZWAMESSAGE', { Z_PK: 21, ZCHATSESSION: 2, ZISFROMME: 0, ZMESSAGETYPE: 59, ZFROMJID: '333@lid', ZMESSAGEDATE: 815000400 });
    const wa = whatsappIos.databases[0];
    const roles = require(path.join(ROOT, 'tools', 'provenance', 'roles.js'));
    const run = (role, params) => {
        const q = wa.queries.find((x) => x.role === role);
        const res = db.exec(roles.fill(q.sql, params || {}))[0];
        if (!res) return [];
        return res.values.map((r) => Object.fromEntries(Object.entries(q.fields).map(([k, col]) => [k, r[res.columns.indexOf(typeof col === 'string' ? col : col.col)]])));
    };
    try {
        const threads = run('chat-threads');
        assert.deepStrictEqual(threads.map((t) => [t.id, t.name, t.kind, t.messages]).sort(), [[1, 'Kim', 'person', 3], [2, 'Klubben', 'group', 2], [3, '0@status', 'status', 0]]);
        for (const t of threads) assert.ok(THREAD_KINDS.includes(t.kind));
        const members = run('chat-members');
        assert.deepStrictEqual(members.map((m) => [m.threadId, m.id, m.name, m.admin]), [[1, '111@lid', 'Kim', null], [2, '222@lid', 'Lo', 1]]);
        const one = run('chat-messages', { threadId: 1 });
        assert.deepStrictEqual(one.map((m) => [m.id, m.fromMe, m.kind, m.kindLabel, m.viewOnce, m.senderName]), [
            [10, 1, 'text', 'text', 0, null], [11, 0, 'image', 'bild (engångsvisning)', 1, 'Kim'], [12, 0, 'contact', 'kontaktkort', 0, 'Kim']]);
        assert.strictEqual(one[0].sent, 815000001);
        const group = run('chat-messages', { threadId: 2 });
        assert.deepStrictEqual(group.map((m) => [m.senderName, m.kind, m.kindLabel]), [['Lo', 'text', 'text'], ['Mo', 'other', 'typ 59']]);
        for (const m of one.concat(group)) assert.ok(CHAT_KINDS.includes(m.kind), m.kind);
        const att = run('chat-attachments', { threadId: 1 });
        assert.deepStrictEqual(att.map((a) => [a.messageId, a.path, a.mime, a.sha256b64 ? a.sha256b64.length : null, a.cardName]), [
            [11, 'Message/Media/111@lid/a/b/x.jpg', 'image/jpeg', 44, null], [12, null, null, null, 'Kim Kontakt']]);
        assert.match(att[1].card, /^BEGIN:VCARD/);
        assert.deepStrictEqual(run('chat-messages', { threadId: "1' OR '1'='1" }), [], 'ett id med citattecken ger inga rader');
    } finally {
        db.close();
    }
});

// En databas med labbtelefonens schema för Signal på iOS: fem kontakter med var sitt slags namn och fyra trådar.
async function signalIosSample() {
    const S = await sqlJs();
    const db = new S.Database();
    Object.values(SCHEMAS['signal-ios']).forEach((sql) => db.run(sql));
    const ins = (t, row) => db.run('INSERT INTO ' + t + ' (' + Object.keys(row).join(', ') + ') VALUES (' + Object.keys(row).map(() => '?').join(', ') + ')', Object.values(row));
    const T = 1717504496000;
    const recipient = (id, aci, phone) => ins('model_SignalRecipient', { id, recordType: 31, uniqueId: 'r-' + id, devices: new Uint8Array(0), recipientUUID: aci, recipientPhoneNumber: phone });
    // Telefonens ägare står först och har ett nummer. Kim har smeknamn och profilnamn, Lo bara profilnamn.
    recipient(1, 'ACI-AGAREN', '+46700000001');
    recipient(2, 'ACI-KIM', '+46700000002');
    recipient(3, 'ACI-LO', '+46700000003');
    recipient(4, 'ACI-NUMMER', '+46700000004');
    recipient(5, 'ACI-BARA', null);
    recipient(6, null, '+46700000006');
    ins('model_SignalAccount', { id: 1, recordType: 30, uniqueId: 'a-1', multipleAccountLabelText: '', recipientUUID: 'ACI-AGAREN', fullName: 'Ägaren Själv' });
    ins('NicknameRecord', { recipientRowID: 2, givenName: 'Kimmen' });
    ins('model_OWSUserProfile', { id: 1, recordType: 41, uniqueId: 'p-1', recipientUUID: 'ACI-KIM', profileName: 'Kim', familyName: 'Karlsson' });
    ins('model_OWSUserProfile', { id: 2, recordType: 41, uniqueId: 'p-2', recipientUUID: 'ACI-LO', profileName: 'Lo' });
    const thread = (id, extra) => ins('model_TSThread', Object.assign({ id, recordType: 14, uniqueId: 'tråd-' + id, conversationColorName: '', isArchived: 0, lastInteractionRowId: 0, shouldThreadBeVisible: 1 }, extra));
    thread(1, { contactUUID: 'ACI-KIM' });
    thread(2, { recordType: 26, groupModel: new Uint8Array([1]), name: 'Klubben' });
    thread(3, { contactUUID: 'ACI-NUMMER', isArchived: 1 });
    thread(4, { contactPhoneNumber: '+46700000006' });
    // Tråd 5: en kontakt som bara har ACI, också i kontakterna.
    thread(5, { contactUUID: 'ACI-BARA' });
    // Gruppens medlemmar har oftast bara ACI. Lo har sitt nummer i kontakterna, ACI-BARA har inget, och en har bara nummer.
    const member = (id, extra) => ins('model_TSGroupMember', Object.assign({ id, recordType: 1, uniqueId: 'g-' + id, groupThreadId: 'tråd-2', lastInteractionTimestamp: 0 }, extra));
    member(1, { uuidString: 'ACI-LO' });
    member(2, { uuidString: 'ACI-BARA' });
    member(3, { phoneNumber: '+46700000009' });
    const message =(id, threadKey, received) => ins('model_TSInteraction', { id, recordType: 19, uniqueId: 'm-' + id, receivedAtTimestamp: received, timestamp: received - 500, uniqueThreadId: threadKey });
    // Tråd 1: det äldsta meddelandet har det högsta id:t, så första och senaste tiden följer inte id:t.
    message(10, 'tråd-1', T + 3000); message(11, 'tråd-1', T + 9000); message(12, 'tråd-1', T + 1000);
    message(20, 'tråd-2', T + 5000); message(21, 'tråd-2', T + 6000);
    // Tråd 4 slutar samma millisekund som tråd 1, och tråd 3 har inga meddelanden.
    message(30, 'tråd-4', T + 9000);
    // Ett meddelande vars tråd inte finns kvar.
    message(40, 'tråd-borta', T + 20000);
    return { db, T };
}

test('Signal på iOS: varje kontakt får sitt eget namn, också när någon annan har ett smeknamn', async () => {
    const { db } = await signalIosSample();
    const main = signalIos.databases[0];
    try {
        const own = { 'ACI-AGAREN': 'Ägaren Själv', 'ACI-KIM': 'Kimmen', 'ACI-LO': 'Lo', 'ACI-NUMMER': '+46700000004', 'ACI-BARA': 'ACI-BARA' };
        const role = db.exec(main.queries.find((q) => q.role === 'recipients').sql)[0];
        assert.deepStrictEqual(Object.fromEntries(role.values.map((r) => [r[role.columns.indexOf('aci')], r[role.columns.indexOf('name')]])), own, 'rollen Härkomst namnger avsändaren med');
        assert.deepStrictEqual(role.values.map((r) => r[role.columns.indexOf('phone')]), ['+46700000001', '+46700000002', '+46700000003', '+46700000004', null]);
        const shown = db.exec(main.queries.find((q) => q.id === 'recipients').sql)[0];
        assert.deepStrictEqual(shown.values.map((r) => [r[shown.columns.indexOf('mottagare_id')], r[shown.columns.indexOf('namn')]]),
            [[1, 'Ägaren Själv'], [2, 'Kimmen'], [3, 'Lo'], [4, '+46700000004'], [5, 'ACI-BARA'], [6, '+46700000006']], 'queryn Kontakter');
        // Ett alias som används två gånger i samma delfråga jämför raden med sig själv, och då får alla samma namn.
        for (const q of main.queries) assert.doesNotMatch(q.sql, /\b(\w+)\.(\w+)\s*=\s*\1\.\2\b/, q.id + ': en kolumn jämförs med sig själv');
    } finally {
        db.close();
    }
});

test('Chattar: Signals trådar på iOS har antal, första och senaste tid, ordnade efter det senaste', async () => {
    const { db, T } = await signalIosSample();
    const q = signalIos.databases[0].queries.find((x) => x.role === 'chat-threads');
    try {
        const res = db.exec(q.sql)[0];
        const rows = res.values.map((r) => Object.fromEntries(Object.entries(q.fields).map(([k, col]) => [k, r[res.columns.indexOf(col)]])));
        assert.deepStrictEqual(rows.map((t) => [t.id, t.name, t.kind, t.messages, t.first, t.last, t.archived]), [
            [1, 'Kimmen', 'person', 3, T + 1000, T + 9000, 0],
            [4, '+46700000006', 'person', 1, T + 9000, T + 9000, 0],
            [2, 'Klubben', 'group', 2, T + 5000, T + 6000, 0],
            [3, '+46700000004', 'person', 0, null, null, 1],
            [5, 'ACI-BARA', 'person', 0, null, null, 0],
        ]);
        // Meddelandetabellen läses en gång. Inget index har både tråden och tiden, så en fråga per tråd får slå upp
        // varje meddelande för sig: tre gånger så långsamt i en databas med 600 000 meddelanden.
        assert.strictEqual(q.sql.split('model_TSInteraction').length - 1, 1, 'meddelandetabellen ska nämnas en gång');
        assert.match(q.sql, /model_TSInteraction\s+(AS\s+)?\w+\s+NOT INDEXED|model_TSInteraction\s+NOT INDEXED/);
    } finally {
        db.close();
    }
});

test('Chattar: Signal på iOS har numret ur kontakterna som adress när tråden eller gruppmedlemmen bara har ACI', async () => {
    const { db } = await signalIosSample();
    const main = signalIos.databases[0];
    const rows = (role) => {
        const q = main.queries.find((x) => x.role === role);
        const res = db.exec(q.sql)[0];
        return res.values.map((r) => Object.fromEntries(Object.entries(q.fields).map(([k, col]) => [k, r[res.columns.indexOf(col)]])));
    };
    try {
        const threads = rows('chat-threads');
        // Tråd 1 och 3 har bara ACI, och numret står i kontakterna. Tråd 4 har numret själv, och tråd 5 har inget nummer.
        assert.deepStrictEqual(Object.fromEntries(threads.map((t) => [t.id, t.address])),
            { 1: '+46700000002', 2: null, 3: '+46700000004', 4: '+46700000006', 5: 'ACI-BARA' });
        const members = rows('chat-members');
        assert.deepStrictEqual(members.map((m) => [m.threadId, m.id, m.name, m.address]), [
            [1, 'ACI-KIM', 'Kimmen', '+46700000002'],
            [2, '+46700000009', '+46700000009', '+46700000009'], [2, 'ACI-BARA', 'ACI-BARA', 'ACI-BARA'], [2, 'ACI-LO', 'Lo', '+46700000003'],
            [3, 'ACI-NUMMER', '+46700000004', '+46700000004'],
            [4, '+46700000006', '+46700000006', '+46700000006'],
            [5, 'ACI-BARA', 'ACI-BARA', 'ACI-BARA'],
        ]);
        // Listan i Chattar hittar då Kim på numret och gruppen genom Los nummer, fast raderna bara har ACI.
        const core = require(path.join(ROOT, 'tools', 'chats', 'chat-core.js'));
        const list = threads.map((t) => ({ key: String(t.id), name: t.name, address: t.address }));
        const people = {};
        members.forEach((m) => (people[m.threadId] = people[m.threadId] || []).push({ id: m.id, name: m.name, address: m.address }));
        const index = core.listIndex(list, people);
        const hits = (query) => list.map((t, i) => [t.key, core.listMatch(index[i], core.searchTerms(query))]).filter((h) => h[1]);
        assert.deepStrictEqual(hits('070-000 00 02'), [['1', []]]);
        assert.deepStrictEqual(hits('070-000 00 03'), [['2', ['Lo']]]);
    } finally {
        db.close();
    }
});
