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
    const roles = (id) => signalAndroid.databases.find((d) => d.id === id).queries.filter((q) => q.hidden).map((q) => q.role).sort();
    assert.deepStrictEqual(roles('signal-android-main'), ['attachments', 'coverage', 'messages', 'recipients']);
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
    const roles = (id) => snapchatAndroid.databases.find((d) => d.id === id).queries.filter((q) => q.hidden).map((q) => q.role).sort();
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
    const roles = (list) => list.filter((q) => q.hidden).map((q) => q.role).sort();
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
        ...signalIos.databases.concat(whatsappIos.databases).map((d) => [d.id, d.paths]),
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
    assert.deepStrictEqual(db.queries.filter((q) => q.hidden).map((q) => q.role).sort(), ['attachments', 'coverage', 'messages', 'recipients', 'stories']);
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
    assert.deepStrictEqual(db.queries.filter((q) => q.hidden).map((q) => q.role).sort(), ['coverage', 'media', 'messages', 'stanzas']);
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
    assert.deepStrictEqual(telegramIos.databases[0].queries.filter((q) => q.hidden).map((q) => q.role).sort(), ['coverage', 'messages', 'resources']);
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
