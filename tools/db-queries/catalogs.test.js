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
const whatsappAndroid = require(path.join(ROOT, 'queries', 'android', 'whatsapp', 'catalog.json'));
const telegramAndroid = require(path.join(ROOT, 'queries', 'android', 'telegram', 'catalog.json'));
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
    for (const db of signalIos.databases.concat(whatsappIos.databases, telegramIos.databases, whatsappAndroid.databases, telegramAndroid.databases)) for (const q of db.queries) if (q.hidden) groups.push([db.id + '/' + q.id, q]);
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
        ...signalIos.databases.concat(whatsappIos.databases, whatsappAndroid.databases, telegramAndroid.databases, samsungAndroid.databases).map((d) => [d.id, d.paths]),
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

// ---------- WhatsApp på Android ----------

test('WhatsApp på Android (beta): två okrypterade databaser, millisekunder, rollerna och schemat', async () => {
    assert.deepStrictEqual(whatsappAndroid.databases.map((d) => [d.id, d.paths[0]]), [
        ['whatsapp-android-msgstore', 'data/data/com.whatsapp/databases/msgstore.db'], ['whatsapp-android-contacts', 'data/data/com.whatsapp/databases/wa.db']]);
    for (const db of whatsappAndroid.databases) {
        assert.strictEqual(db.cipher, undefined);
        assert.strictEqual(db.chatApp, 'WhatsApp');
        assert.match(db.label, /^Android — /);
        checkGroup(db.id, db.queries, (q) => q.subtitle);
        for (const q of db.queries) {
            if (/\{\{(cocoa|unix)(Start|End)\}\}/.test(q.sql)) assert.fail(db.id + '/' + q.id + ': WhatsApps tider på Android är millisekunder');
            if (!q.hidden && /\{\{unixMs/.test(q.sql)) assert.strictEqual(q.timeEpoch, 'unix-ms', db.id + '/' + q.id + ': timeEpoch');
            if (q.hidden) { assert.strictEqual(q.epoch, 'unixMs'); assert.ok(q.fields, q.id + ': fields'); }
            for (const p of q.params || []) if (!/^time(Start|End)$/.test(p)) assert.ok(whatsappAndroid.paramLabels[p], q.id + ': etikett för ' + p);
        }
    }
    // Härkomsts roller står först bland de dolda, sedan Chattars.
    assert.deepStrictEqual(whatsappAndroid.databases[0].queries.filter((q) => q.hidden && !/^chat-/.test(q.role)).map((q) => q.role), ['media', 'messages', 'coverage']);
    assert.deepStrictEqual(whatsappAndroid.databases[1].queries.filter((q) => q.hidden).map((q) => q.role), ['names', 'chat-names']);
    assert.strictEqual(whatsappAndroid.databases[0].queries.find((q) => q.role === 'chat-threads').nameFromMembers, 'person', 'en grupp behåller sitt namn');
    assert.deepStrictEqual(await prepareAll(whatsappAndroid, Object.assign({}, SCHEMAS['whatsapp-android-msgstore'], SCHEMAS['whatsapp-android-contacts'])), []);
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
    const all = [photos, appUsage, routined, snapchat, snapchatAndroid, signalAndroid, signalIos, whatsappIos, whatsappAndroid, telegramIos, telegramAndroid, samsungAndroid];
    const out = [];
    for (const cat of all) for (const db of cat.databases || []) if (db.queries.some((q) => q.role === 'chat-threads')) out.push([cat, db]);
    return out;
}

test('Chattar: varje databas med chattroller har alla fyra med fälten Chattar läser, tider med förklaring och sökvägar till filerna', () => {
    const dbs = chatDatabases();
    assert.ok(dbs.some(([, db]) => db.id === 'whatsapp-ios-chat'), 'WhatsApp på iOS har chattroller');
    assert.ok(dbs.some(([, db]) => db.id === 'whatsapp-android-msgstore'), 'WhatsApp på Android har chattroller');
    assert.ok(dbs.some(([, db]) => db.id === 'telegram-android-cache4'), 'Telegram på Android har chattroller');
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
    const all = [snapchat, snapchatAndroid, signalAndroid, signalIos, whatsappIos, whatsappAndroid, telegramIos, telegramAndroid];
    const named = [];
    for (const cat of all) for (const db of cat.databases) {
        const q = db.queries.find((x) => x.role === 'chat-names');
        if (!q) continue;
        named.push(db.id);
        assert.ok(q.hidden && q.fields.id && (q.fields.name || q.nameFrom), db.id + ': chat-names');
        assert.ok(cat.databases.some((d) => d.chatApp === db.chatApp && d.queries.some((x) => x.role === 'chat-messages')), db.id + ': ingen chatt i samma app');
    }
    assert.deepStrictEqual(named.sort(), ['snapchat-android-friends', 'snapchat-friends', 'whatsapp-android-contacts']);
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

// msgstore.db och wa.db med labbtelefonens schema och påhittade rader: en enskild chatt vars lid är kopplad till numret,
// en grupp med en medlem som bara är känd som lid, och en dold chatt utan meddelanden.
async function whatsappAndroidSample() {
    const S = await sqlJs();
    const db = new S.Database();
    Object.values(Object.assign({}, SCHEMAS['whatsapp-android-msgstore'], SCHEMAS['whatsapp-android-contacts'])).forEach((sql) => db.run(sql));
    const ins = (t, row) => db.run('INSERT INTO ' + t + ' (' + Object.keys(row).join(', ') + ') VALUES (' + Object.keys(row).map(() => '?').join(', ') + ')', Object.values(row));
    const T = 1794427000000;
    const jid = (id, user, server, type) => ins('jid', { _id: id, user, server, agent: 0, device: 0, type, raw_string: user ? user + '@' + server : server });
    jid(1, '111', 'lid', 18);
    jid(2, '46700000001', 's.whatsapp.net', 0);
    jid(3, '999', 'g.us', 1);
    jid(4, '', 'lid_me', 11);
    jid(5, '222', 'lid', 18);
    jid(6, '333', 'lid', 18);
    ins('jid_map', { lid_row_id: 1, jid_row_id: 2 });
    ins('chat', { _id: 1, jid_row_id: 1, hidden: 0, archived: 0 });
    ins('chat', { _id: 2, jid_row_id: 3, hidden: 0, archived: 1, subject: 'Klubben', created_timestamp: T - 5000 });
    ins('chat', { _id: 3, jid_row_id: 6, hidden: 1, archived: 0 });
    ins('group_participant_user', { _id: 1, group_jid_row_id: 3, user_jid_row_id: 5, rank: 2, pending: 0, add_timestamp: T - 5000 });
    ins('group_participant_user', { _id: 2, group_jid_row_id: 3, user_jid_row_id: 1, rank: 0, pending: 0, add_timestamp: T - 4000 });
    ins('group_participant_user', { _id: 3, group_jid_row_id: 3, user_jid_row_id: 4, rank: 0, pending: 0, add_timestamp: T - 4000 });
    const msg = (id, chat, fromMe, type, row) => ins('message', Object.assign({ _id: id, chat_row_id: chat, from_me: fromMe, key_id: 'K' + id, message_type: type, status: fromMe ? 13 : 0,
        timestamp: T + id * 1000, received_timestamp: 0, receipt_server_timestamp: -1, starred: 0, sort_id: id }, row || {}));
    const media = (id, row) => ins('message_media', Object.assign({ message_row_id: id, chat_row_id: 1, transferred: 1, media_caption: null }, row));
    // WhatsApps egen platshållare: rad 1 utan chatt och typ.
    ins('message', { _id: 1, chat_row_id: -1, from_me: 0, key_id: '-1', sort_id: 1 });
    msg(10, 1, 1, 0, { text_data: 'Hej', receipt_server_timestamp: T + 10000 });
    ins('receipt_user', { _id: 1, message_row_id: 10, receipt_user_jid_row_id: 1, receipt_timestamp: T + 11000, read_timestamp: T + 15000 });
    msg(11, 1, 0, 1, { text_data: 'Bildtext', received_timestamp: T + 11500 });
    media(11, { file_path: 'Media/WhatsApp Images/IMG-1.jpg', mime_type: 'image/jpeg', file_length: 100, file_hash: '07ZeqtAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', width: 40, height: 30 });
    msg(12, 1, 1, 2, { origin: 1, received_timestamp: T + 12300 });
    media(12, { file_path: 'Media/WhatsApp Voice Notes/202646/PTT-1.opus', mime_type: 'audio/ogg; codecs=opus', file_length: 50, file_hash: '17ZeqtAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', media_duration: 3 });
    msg(13, 1, 0, 9, { text_data: 'rapport', received_timestamp: T + 13500 });
    media(13, { file_path: 'Media/WhatsApp Documents/rapport.pdf', mime_type: 'application/pdf', file_length: 70, file_hash: '27ZeqtAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', media_name: 'rapport.pdf', media_caption: 'Läs den' });
    msg(14, 1, 0, 3, { received_timestamp: T + 14500 });
    media(14, { transferred: 0, mime_type: 'video/mp4', file_length: 900, file_hash: '37ZeqtAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', media_duration: 7, width: 64, height: 48 });
    msg(15, 1, 1, 15, { status: 5, receipt_server_timestamp: T + 30000 });
    ins('message_revoked', { message_row_id: 15, revoked_key_id: 'K15', revoke_timestamp: T + 30400 });
    msg(16, 1, 1, 1, { text_data: 'Egen bild', received_timestamp: T + 16200 });
    media(16, { file_path: 'Media/WhatsApp Images/Sent/IMG-2.jpg', mime_type: '', file_length: 110, file_hash: '47ZeqtAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', width: 40, height: 30 });
    msg(17, 1, 0, 77, { received_timestamp: T + 17500 });
    msg(18, 1, 0, 5, { received_timestamp: T + 18500 });
    ins('message_location', { message_row_id: 18, chat_row_id: 1, latitude: 59.33, longitude: 18.06, place_name: 'Torget' });
    msg(19, 1, 0, 4, { text_data: 'Kim Kontakt', received_timestamp: T + 19500 });
    ins('message_vcard', { _id: 1, message_row_id: 19, vcard: 'BEGIN:VCARD\nFN:Kim Kontakt\nEND:VCARD' });
    msg(20, 1, 0, 0, { text_data: 'Svar', received_timestamp: T + 20500 });
    ins('message_quoted', { message_row_id: 20, chat_row_id: 1, parent_message_chat_row_id: 1, from_me: 1, key_id: 'K10', text_data: 'Hej' });
    msg(30, 2, 1, 7, { status: 6, text_data: 'Klubben', sender_jid_row_id: 5 });
    ins('message_system', { message_row_id: 30, action_type: 11 });
    msg(31, 2, 0, 0, { text_data: 'Från gruppen', sender_jid_row_id: 5, received_timestamp: T + 31500 });
    msg(32, 2, 0, 0, { text_data: 'Från Kim', sender_jid_row_id: 1, received_timestamp: T + 32500 });
    msg(33, 2, 1, 0, { text_data: 'Till alla' });
    ins('receipt_user', { _id: 2, message_row_id: 33, receipt_user_jid_row_id: 5, receipt_timestamp: T + 34000, read_timestamp: T + 39000 });
    ins('receipt_user', { _id: 3, message_row_id: 33, receipt_user_jid_row_id: 1, receipt_timestamp: T + 35000, read_timestamp: T + 36000 });
    ins('wa_contacts', { _id: 1, jid: '46700000001@s.whatsapp.net', is_whatsapp_user: 1, wa_name: 'Kim', number: '+46700000001' });
    ins('wa_contacts', { _id: 2, jid: '999@g.us', is_whatsapp_user: 1, display_name: 'Klubben' });
    ins('wa_contacts', { _id: 3, jid: '46700000009@s.whatsapp.net', is_whatsapp_user: 1 });
    return { db, T };
}

test('Chattar: WhatsApp på Android ger chattar, deltagare, avsändare, typer, tider, sökvägar, plats och kontaktkort', async () => {
    const { db, T } = await whatsappAndroidSample();
    const [store, contacts] = whatsappAndroid.databases;
    const roles = require(path.join(ROOT, 'tools', 'provenance', 'roles.js'));
    const run = (role, params, from) => {
        const q = (from || store).queries.find((x) => x.role === role);
        const res = db.exec(roles.fill(q.sql, params || {}))[0];
        if (!res) return [];
        return res.values.map((r) => Object.fromEntries(Object.entries(q.fields).map(([k, col]) => [k, r[res.columns.indexOf(typeof col === 'string' ? col : col.col)]])));
    };
    const KIM = '46700000001@s.whatsapp.net';
    try {
        // Den enskilda chatten heter som numrets JID, så att namnet ur wa.db passar. Den dolda chatten utan meddelanden är inte med.
        const threads = run('chat-threads');
        assert.deepStrictEqual(threads.map((t) => [t.id, t.name, t.kind, t.address, t.messages, t.archived]), [[2, 'Klubben', 'group', '999@g.us', 4, 1], [1, KIM, 'person', KIM, 11, 0]]);
        assert.deepStrictEqual([threads[1].first, threads[1].last], [T + 10000, T + 20000]);
        for (const t of threads) assert.ok(THREAD_KINDS.includes(t.kind));
        // Telefonens eget konto (lid_me) står inte bland deltagarna: Chattar lägger till det självt.
        assert.deepStrictEqual(run('chat-members').map((m) => [m.threadId, m.id, m.name, m.admin, m.note]), [
            [1, KIM, KIM, null, '111@lid'], [2, '222@lid', '222@lid', 1, null], [2, KIM, KIM, 0, '111@lid'], [3, '333@lid', '333@lid', null, null]]);
        const one = run('chat-messages', { threadId: 1 });
        assert.deepStrictEqual(one.map((m) => [m.id, m.fromMe, m.senderId, m.text, m.kind, m.kindLabel]), [
            [10, 1, null, 'Hej', 'text', 'text'],
            [11, 0, KIM, 'Bildtext', 'image', 'bild'],
            [12, 1, null, null, 'voice', 'röstmeddelande'],
            [13, 0, KIM, 'Läs den', 'file', 'dokument'],
            [14, 0, KIM, null, 'video', 'video'],
            [15, 1, null, null, 'deleted', 'raderat för alla'],
            [16, 1, null, 'Egen bild', 'image', 'bild'],
            [17, 0, KIM, null, 'other', 'typ 77'],
            [18, 0, KIM, null, 'location', 'plats'],
            [19, 0, KIM, 'Kim Kontakt', 'contact', 'kontaktkort'],
            [20, 0, KIM, 'Svar', 'text', 'text']]);
        for (const m of one) assert.ok(CHAT_KINDS.includes(m.kind), m.kind);
        const by = (id) => one.find((m) => m.id === id);
        // Det skickade meddelandet: serverns kvitto, levererat och läst. Inget "kom in på telefonen".
        assert.deepStrictEqual([by(10).written, by(10).arrived, by(10).sentOther, by(10).server, by(10).delivered, by(10).read], [T + 10000, null, null, T + 10000, T + 11000, T + 15000]);
        // received_timestamp är ankomsten bara för mottagna meddelanden. På en skickad mediefil visas den för sig.
        assert.deepStrictEqual([by(11).arrived, by(11).sentOther, by(11).server], [T + 11500, null, null]);
        assert.deepStrictEqual([by(12).arrived, by(12).sentOther], [null, T + 12300]);
        assert.deepStrictEqual([by(15).revoked, by(15).status], [T + 30400, 5]);
        assert.deepStrictEqual([by(20).replyTo, by(20).replyText], [10, 'Hej']);
        // I gruppen står avsändaren på raden: numrets JID när lid är kopplad, annars lid. Flera mottagare: den första tiden.
        const group = run('chat-messages', { threadId: 2 });
        assert.deepStrictEqual(group.map((m) => [m.id, m.senderId, m.kind, m.text, m.action]), [
            [30, '222@lid', 'system', 'Klubben', 11], [31, '222@lid', 'text', 'Från gruppen', null], [32, KIM, 'text', 'Från Kim', null], [33, null, 'text', 'Till alla', null]]);
        assert.deepStrictEqual([group[3].delivered, group[3].read], [T + 34000, T + 36000]);
        // Sökvägen räknas från extraktionens rot. En fil som inte hämtats har ingen, och en tom MIME-typ blir ingen.
        const R = 'data/media/0/Android/media/com.whatsapp/WhatsApp/';
        const att = run('chat-attachments', { threadId: 1 });
        assert.deepStrictEqual(att.map((a) => [a.messageId, a.path, a.mime, a.size, a.duration, a.width, a.name]), [
            [11, R + 'Media/WhatsApp Images/IMG-1.jpg', 'image/jpeg', 100, null, 40, null],
            [12, R + 'Media/WhatsApp Voice Notes/202646/PTT-1.opus', 'audio/ogg; codecs=opus', 50, 3, null, null],
            [13, R + 'Media/WhatsApp Documents/rapport.pdf', 'application/pdf', 70, null, null, 'rapport.pdf'],
            [14, null, 'video/mp4', 900, 7, 64, null],
            [16, R + 'Media/WhatsApp Images/Sent/IMG-2.jpg', null, 110, null, 40, null],
            [18, null, null, null, null, null, 'Torget'],
            [19, null, null, null, null, null, null]]);
        assert.ok(att.slice(0, 5).every((a) => a.sha256b64.length === 44));
        assert.deepStrictEqual([att[5].lat, att[5].lon], [59.33, 18.06]);
        assert.strictEqual(att[6].cardName, 'Kim Kontakt');
        assert.match(att[6].card, /^BEGIN:VCARD/);
        assert.deepStrictEqual(run('chat-attachments', { threadId: 2 }), []);
        assert.deepStrictEqual(run('chat-messages', { threadId: "1' OR '1'='1" }), [], 'ett id med citattecken ger inga rader');
        // Namnen ur wa.db: bara rader som har ett namn blir till namn i Chattar (ChatCore.names hoppar över de tomma).
        assert.deepStrictEqual(run('chat-names', {}, contacts).map((n) => [n.id, n.name]).sort(), [[KIM, 'Kim'], ['46700000009@s.whatsapp.net', null], ['999@g.us', 'Klubben']]);
    } finally {
        db.close();
    }
});

test('Härkomst: WhatsApp på Android ger mediefilerna med sökväg och summor, meddelandena i fönstret, täckningen och namnen', async () => {
    const { db, T } = await whatsappAndroidSample();
    const [store, contacts] = whatsappAndroid.databases;
    const roles = require(path.join(ROOT, 'tools', 'provenance', 'roles.js'));
    const run = (role, params, from) => {
        const q = (from || store).queries.find((x) => x.role === role);
        const res = db.exec(roles.fill(q.sql, params || {}))[0];
        if (!res) return [];
        return res.values.map((r) => Object.fromEntries(Object.entries(q.fields).map(([k, col]) => [k, r[res.columns.indexOf(col)]])));
    };
    const KIM = '46700000001@s.whatsapp.net';
    const ORIGINAL = '57ZeqtAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    try {
        // Bara den skickade bilden som togs i appen har originalets summa.
        db.run('UPDATE message_media SET original_file_hash = ? WHERE message_row_id = 16', [ORIGINAL]);
        const media = run('media');
        assert.deepStrictEqual(media.map((m) => [m.messageId, m.type, m.fromMe, m.date, m.received, m.sender, m.voice, m.mime, m.path, m.size, m.transferred]), [
            [11, 1, 0, T + 11000, T + 11500, KIM, 0, 'image/jpeg', 'Media/WhatsApp Images/IMG-1.jpg', 100, 1],
            // received_timestamp på ett skickat meddelande är ingen ankomst.
            [12, 2, 1, T + 12000, null, 'den här telefonen', 1, 'audio/ogg; codecs=opus', 'Media/WhatsApp Voice Notes/202646/PTT-1.opus', 50, 1],
            [13, 9, 0, T + 13000, T + 13500, KIM, 0, 'application/pdf', 'Media/WhatsApp Documents/rapport.pdf', 70, 1],
            // En fil som aldrig hämtades har ingen sökväg.
            [14, 3, 0, T + 14000, T + 14500, KIM, 0, 'video/mp4', null, 900, 0],
            [16, 1, 1, T + 16000, null, 'den här telefonen', 0, null, 'Media/WhatsApp Images/Sent/IMG-2.jpg', 110, 1]]);
        assert.deepStrictEqual(media.map((m) => [m.chatId, m.chatSubject, m.chatJid, m.group]), Array(5).fill([1, null, KIM, 0]));
        assert.deepStrictEqual(media.map((m) => m.sha256.slice(0, 2)), ['07', '17', '27', '37', '47']);
        assert.deepStrictEqual(media.map((m) => m.original), [null, null, null, null, ORIGINAL]);
        assert.deepStrictEqual([media[1].duration, media[3].duration, media[2].name], [3, 7, 'rapport.pdf']);

        const rows = run('messages', { window: { startMs: T, endMs: T + 60000 } });
        assert.deepStrictEqual(rows.map((r) => r.id), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 30, 31, 32, 33], 'platshållarraden utan chatt är inte med');
        const by = (id) => rows.find((r) => r.id === id);
        assert.deepStrictEqual([by(10).type, by(10).fromMe, by(10).sender, by(10).mediaId, by(10).hasText, by(10).chatJid], [0, 1, 'den här telefonen', null, 1, KIM]);
        assert.deepStrictEqual([by(11).received, by(11).mediaId, by(11).mime, by(11).hasText, by(12).voice, by(12).received, by(14).hasText], [T + 11500, 11, 'image/jpeg', 1, 1, null, 0]);
        // I gruppen står gruppens namn och avsändaren på raden: numrets JID när lid är kopplad, annars lid.
        assert.deepStrictEqual([by(30).type, by(30).group, by(30).chatSubject, by(30).chatJid], [7, 1, 'Klubben', '999@g.us']);
        assert.deepStrictEqual([by(31).sender, by(32).sender, by(33).sender], ['222@lid', KIM, 'den här telefonen']);
        // Fönstret gäller också ankomsten av ett mottaget meddelande, men inte received_timestamp på ett skickat.
        assert.deepStrictEqual(run('messages', { window: { startMs: T + 11400, endMs: T + 11600 } }).map((r) => r.id), [11]);
        assert.deepStrictEqual(run('messages', { window: { startMs: T + 12200, endMs: T + 12400 } }), []);
        assert.deepStrictEqual(run('coverage'), [{ first: T + 10000, last: T + 33000, rows: 15 }]);
        assert.deepStrictEqual(run('names', {}, contacts).map((n) => [n.id, n.name]).sort(), [[KIM, 'Kim'], ['46700000009@s.whatsapp.net', null], ['999@g.us', 'Klubben']]);
    } finally {
        db.close();
    }
});

test('WhatsApp på Android: de synliga queryerna ger riktning, avsändare, kvitton per mottagare, raderat, chattar och medlemmar', async () => {
    const { db, T } = await whatsappAndroidSample();
    const [store, contacts] = whatsappAndroid.databases;
    const roles = require(path.join(ROOT, 'tools', 'provenance', 'roles.js'));
    const run = (id, params, from) => {
        const q = (from || store).queries.find((x) => x.id === id);
        // localtime följer datorns zon: testet läser bara kolumnerna som inte beror på den.
        const res = db.exec(roles.fill(q.sql, params || {}))[0];
        return res ? res.values.map((r) => Object.fromEntries(res.columns.map((c, i) => [c, r[i]]))) : [];
    };
    const all = { window: { startMs: T, endMs: T + 60000 } };
    const KIM = '46700000001@s.whatsapp.net';
    try {
        const rows = run('messages', all);
        assert.deepStrictEqual(rows.map((r) => r.meddelande_id), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 30, 31, 32, 33], 'platshållarraden utan chatt är inte med');
        const by = (id) => rows.find((r) => r.meddelande_id === id);
        assert.deepStrictEqual([by(10).riktning, by(10).typ, by(10).chatt, by(10).fran, by(10).text, by(10).mottaget_lokal], ['skickat', 'text', KIM, 'den här telefonen', 'Hej', null]);
        assert.deepStrictEqual([by(11).riktning, by(11).fran, by(11).mediefil, by(11).tid_utc], ['mottaget', KIM, 'Media/WhatsApp Images/IMG-1.jpg', '2026-11-11 19:56:51']);
        assert.ok(by(11).mottaget_lokal && !by(16).mottaget_lokal, 'bara mottagna meddelanden har en mottagen tid');
        assert.deepStrictEqual([by(30).riktning, by(30).typ, by(30).chatt, by(30).fran], ['system', 'systemmeddelande', 'Klubben', '222@lid']);
        assert.deepStrictEqual([by(32).chatt, by(32).fran, by(33).fran], ['Klubben', KIM, 'den här telefonen']);
        // Fönstret gäller också ankomsten: ett meddelande som skrevs före fönstret men kom in under det är med.
        assert.deepStrictEqual(run('messages', { window: { startMs: T + 11400, endMs: T + 11600 } }).map((r) => r.meddelande_id), [11]);
        const media = run('media', all);
        assert.deepStrictEqual(media.map((r) => [r.meddelande_id, r.riktning, r.typ, r.hamtad, r.langd, r.matt]), [
            [11, 'mottagen', 'bild', 'ja', null, '40 x 30'], [12, 'skickad', 'röstmeddelande', 'ja', '3 s', null], [13, 'mottagen', 'dokument', 'ja', null, null],
            [14, 'mottagen', 'video', 'nej', '7 s', '64 x 48'], [16, 'skickad', 'bild', 'ja', null, '40 x 30']]);
        assert.deepStrictEqual(run('media-by-sha256', { sha256b64: '27ZeqtAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }).map((r) => [r.meddelande_id, r.filnamn]), [[13, 'rapport.pdf']]);
        assert.deepStrictEqual(run('receipts', all).map((r) => [r.meddelande_id, r.mottagare, !!r.levererat_lokal, !!r.last_lokal, r.uppspelat_lokal]), [
            [10, KIM, true, true, null], [33, '222@lid', true, true, null], [33, KIM, true, true, null]]);
        assert.deepStrictEqual(run('deleted').map((r) => [r.meddelande_id, r.riktning, r.skrivet_utc, r.raderat_utc]), [[15, 'skickat', '2026-11-11 19:56:55', '2026-11-11 19:57:10']]);
        assert.deepStrictEqual(run('chats').map((r) => [r.chatt_id, r.slag, r.chatt, r.jid, r.nummer_jid, r.meddelanden, r.arkiverad, r.dold]).sort((a, b) => a[0] - b[0]), [
            [1, 'person', KIM, '111@lid', KIM, 11, null, null], [2, 'grupp', 'Klubben', '999@g.us', null, 4, 'ja', null], [3, 'person', '333@lid', '333@lid', null, 0, null, 'ja']]);
        assert.deepStrictEqual(run('group-members').map((r) => [r.chatt, r.medlem, r.medlem_jid, r.den_har_telefonen, r.roll]), [
            ['Klubben', '222@lid', '222@lid', null, 'skapare'], ['Klubben', KIM, '111@lid', null, 'medlem'], ['Klubben', 'lid_me', 'lid_me', 'ja', 'medlem']]);
        assert.deepStrictEqual(run('contacts', {}, contacts).map((r) => [r.jid, r.namn_i_kontakterna, r.namn_i_whatsapp, r.nummer, r.har_whatsapp]), [
            [KIM, null, 'Kim', '+46700000001', 'ja'], ['999@g.us', 'Klubben', null, null, 'ja'], ['46700000009@s.whatsapp.net', null, null, null, 'ja']]);
        assert.ok(run('tables').some((r) => r.tabell === 'message' && r.rader === 16));
    } finally {
        db.close();
    }
});

// ---------- Telegram på Android ----------

test('Telegram på Android (beta): en okrypterad databas, unixsekunder, rollerna och schemat', async () => {
    assert.deepStrictEqual(telegramAndroid.databases.map((d) => [d.id, d.paths[0], d.derive]), [
        ['telegram-android-cache4', 'data/data/org.telegram.messenger/files/cache4.db', undefined]]);
    for (const db of telegramAndroid.databases) {
        assert.strictEqual(db.cipher, undefined);
        assert.strictEqual(db.chatApp, 'Telegram');
        assert.match(db.label, /^Android — /);
        checkGroup(db.id, db.queries, (q) => q.subtitle);
        for (const q of db.queries) {
            if (/\{\{(cocoa|unixMs)/.test(q.sql)) assert.fail(db.id + '/' + q.id + ': Telegrams tider är unixsekunder');
            if (!q.hidden && /\{\{unixStart/.test(q.sql)) assert.strictEqual(q.timeEpoch, 'unix', q.id + ': timeEpoch');
            if (q.hidden) { assert.strictEqual(q.epoch, 'unixS'); assert.ok(q.fields, q.id + ': fields'); }
            for (const p of q.params || []) if (!/^time(Start|End)$/.test(p)) assert.ok(telegramAndroid.paramLabels[p], q.id + ': etikett för ' + p);
        }
    }
    // Texten läses bara för konstruktorn som är kontrollerad i labbet, och kontrollqueryn visar hur blobben lästes.
    const [cache] = telegramAndroid.databases;
    assert.match(cache.queries.find((q) => q.id === 'messages').sql, /= 'D3B90076' THEN instr\(substr\(hx, 33\), dhex\)/);
    assert.ok(cache.queries.some((q) => q.id === 'message-blob' && q.group === 'advanced'));
    assert.deepStrictEqual(cache.queries.filter((q) => q.hidden && !/^chat-/.test(q.role)).map((q) => q.role), ['messages', 'photo', 'coverage']);
    // Bildens id söks som byte, inte som hextext: en träff mitt i en byte är ingen träff.
    assert.match(cache.queries.find((q) => q.role === 'photo').sql, /instr\(m\.data, unhex\('\{\{idHex\}\}'\)\) > 0/);
    assert.deepStrictEqual(await prepareAll(telegramAndroid, SCHEMAS['telegram-android-cache4']), []);
});

// Telegrams blobbar i den form labbtelefonen hade, med påhittat innehåll. Ett meddelande: konstruktor, flaggor, flaggor, id,
// avsändaren när flaggans bit 8 är satt, chatten, tiden och texten som en sträng med längden först.
const tg = {
    u32: (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; },
    i64: (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; },
    str: (s) => {
        const body = Buffer.from(s, 'utf8');
        const head = body.length < 254 ? Buffer.from([body.length]) : Buffer.from([254, body.length & 255, (body.length >> 8) & 255, body.length >> 16]);
        return Buffer.concat([head, body, Buffer.alloc((4 - (head.length + body.length) % 4) % 4)]);
    },
    peer: (id) => Buffer.concat([tg.u32(id > 0 ? 0x59511722 : 0x36c6019a), tg.i64(Math.abs(id))]),
    message: (m) => Buffer.concat([tg.u32(m.ctor || 0x7600b9d3), tg.u32(m.from ? 0x100 : 0), tg.u32(0), tg.u32(m.id), m.from ? tg.peer(m.from) : Buffer.alloc(0), tg.peer(m.peer),
        m.extra || Buffer.alloc(0), tg.u32(m.date), tg.str(m.text || ''), tg.u32(0x11223344)]),
    service: (m) => Buffer.concat([tg.u32(0x7a800e0a), tg.u32(0x100), tg.u32(m.id), tg.peer(m.from), tg.peer(m.peer), tg.u32(m.date), tg.u32(0x11223344), tg.str('Klubben')]),
    user: (u) => Buffer.concat([tg.u32(u.ctor || 0xb1b8cc83), tg.u32((u.hash ? 1 : 0) | (u.first != null ? 2 : 0) | (u.last != null ? 4 : 0) | (u.username ? 8 : 0)), tg.u32(0), tg.i64(u.id),
        u.hash ? tg.i64(987654321) : Buffer.alloc(0), u.first != null ? tg.str(u.first) : Buffer.alloc(0), u.last != null ? tg.str(u.last) : Buffer.alloc(0),
        u.username ? tg.str(u.username) : Buffer.alloc(0), tg.u32(0x11223344)]),
    chat: (c) => Buffer.concat([tg.u32(c.ctor || 0x41cbf256), tg.u32(0), tg.i64(c.id), tg.str(c.title), tg.u32(0x11223344)]),
};
const TG_SECRET = '4611686018427387911';   // en hemlig chatt: id:t ryms inte i ett JavaScript-tal, så rollerna ger det som text

// cache4.db med labbtelefonens schema och påhittade rader: en enskild chatt, en grupp och en hemlig chatt.
async function telegramAndroidSample() {
    const S = await sqlJs();
    const db = new S.Database();
    Object.values(SCHEMAS['telegram-android-cache4']).forEach((sql) => db.run(sql));
    const ins = (t, row) => db.run('INSERT INTO ' + t + ' (' + Object.keys(row).join(', ') + ') VALUES (' + Object.keys(row).map(() => '?').join(', ') + ')', Object.values(row));
    const T = 1794427000, ME = 1002, KIM = 1001;
    ins('users', { uid: KIM, name: 'kim åkesson;;;kimmy', status: T + 900, data: tg.user({ id: KIM, hash: true, first: 'Kim', last: 'Åkesson', username: 'kimmy' }) });
    ins('users', { uid: ME, name: 'egen lab;;;', status: T + 950, data: tg.user({ id: ME, hash: true, first: 'Egen', last: 'Lab' }) });
    ins('users', { uid: 1003, name: 'robin;;;', status: 0, data: tg.user({ id: 1003, ctor: 0x12345678, first: 'Robin' }) });     // okänd konstruktor: namnet i gemener
    ins('users', { uid: 1004, name: 'sam;;;', status: 0, data: tg.user({ id: 1004, first: 'Sam' }) });                           // utan nyckel och efternamn
    ins('users', { uid: 1005, name: 'alex;;;', status: 0, data: tg.user({ id: 1005, hash: true, first: 'Alexander' }) });        // längden stämmer inte: namnet i gemener
    ins('chats', { uid: 500, name: 'klubben', data: tg.chat({ id: 500, title: 'Klubben' }) });
    ins('chats', { uid: 501, name: 'gamla gruppen', data: tg.chat({ id: 501, ctor: 0x12345678, title: 'Gamla gruppen' }) });
    ins('contacts', { uid: KIM, mutual: 1 });
    const msg = (mid, uid, out, date, data, more) => ins('messages_v2', Object.assign({ mid, uid, read_state: 3, send_state: 0, date, data, out, ttl: 0, media: -1 }, more || {}));
    msg(1, KIM, 1, T + 10, tg.message({ id: 1, from: ME, peer: KIM, date: T + 10, text: 'Hej' }));
    msg(2, KIM, 0, T + 20, tg.message({ id: 2, peer: KIM, date: T + 20, text: 'Hej själv' }));
    msg(3, KIM, 0, T + 30, tg.message({ id: 3, peer: KIM, date: T + 30, text: 'Bildtext' }), { media: 0 });
    msg(4, KIM, 1, T + 40, tg.message({ id: 4, from: ME, peer: KIM, date: T + 40, text: 'å'.repeat(200) }), { read_state: 2 });   // 400 byte: längden står i tre byte
    msg(5, KIM, 0, T + 50, tg.message({ id: 5, peer: KIM, date: T + 50, text: 'Svar', extra: Buffer.concat([tg.u32(0xafbc09db), tg.u32(16), tg.u32(2)]) }));   // ett huvud före tiden
    msg(6, KIM, 0, T + 60, tg.message({ id: 6, peer: KIM, date: T + 60, text: 'Ny version', ctor: 0x12345678 }));                 // okänd konstruktor
    msg(7, KIM, 0, T + 70, tg.message({ id: 7, peer: KIM, date: T + 71, text: 'Annan tid' }));                                    // tiden i blobben är en annan
    msg(8, KIM, 0, T + 80, tg.message({ id: 8, peer: KIM, date: T + 80, text: '' }));                                             // varken text eller rad i media_v4
    msg(9, KIM, 0, T + 90, tg.message({ id: 9, peer: KIM, date: T + 90, text: 'Länk' }));                                         // bara en länk i media_v4
    msg(10, -500, 1, T + 100, tg.service({ id: 10, from: ME, peer: -500, date: T + 100 }), { read_state: 2 });
    msg(11, -500, 1, T + 110, tg.message({ id: 11, from: ME, peer: -500, date: T + 110, text: 'Till gruppen' }), { read_state: 2 });
    msg(12, -500, 0, T + 120, tg.message({ id: 12, from: KIM, peer: -500, date: T + 120, text: 'Från Kim' }));
    msg(13, -500, 0, T + 130, tg.message({ id: 13, from: 1003, peer: -500, date: T + 130, text: '' }), { read_state: 0 });
    msg(14, -500, 0, T + 140, tg.message({ id: 14, from: 1999, peer: -500, date: T + 140, text: 'Okänd' }));                      // avsändaren finns inte i users
    db.run('INSERT INTO messages_v2 (mid, uid, read_state, send_state, date, data, out, ttl, media) VALUES (1, ' + TG_SECRET + ', 3, 0, ?, ?, 0, 0, -1)',
        [T + 150, tg.message({ id: 1, peer: KIM, date: T + 150, text: 'Hemligt', ctor: 0x555555fa })]);
    ins('media_v4', { mid: 3, uid: KIM, date: T + 30, type: 0, data: Buffer.from([1, 2, 3]) });
    ins('media_v4', { mid: 9, uid: KIM, date: T + 90, type: 3, data: Buffer.from([1]) });
    ins('media_v4', { mid: 13, uid: -500, date: T + 130, type: 2, data: Buffer.from([1, 2]) });
    ins('dialogs', { did: KIM, date: T + 90, unread_count: 0, last_mid: 9, inbox_max: 9, outbox_max: 1, pinned: 0, flags: 0, folder_id: 0 });
    ins('dialogs', { did: -500, date: T + 140, unread_count: 1, last_mid: 14, inbox_max: 12, outbox_max: 0, pinned: 1, flags: 0, folder_id: 0 });
    return { db, T, ME, KIM };
}

test('Chattar: Telegram på Android ger chattar, deltagare, avsändare och text ur blobben, och säger när den inte kan läsas', async () => {
    const { db, T, KIM } = await telegramAndroidSample();
    const [cache] = telegramAndroid.databases;
    const roles = require(path.join(ROOT, 'tools', 'provenance', 'roles.js'));
    const run = (role, params) => {
        const q = cache.queries.find((x) => x.role === role);
        const res = db.exec(roles.fill(q.sql, params || {}))[0];
        if (!res) return [];
        return res.values.map((r) => Object.fromEntries(Object.entries(q.fields).map(([k, col]) => [k, r[res.columns.indexOf(col)]])));
    };
    try {
        // Namnen står som de skrivs när blobben kan läsas, annars i gemener som Telegram sparar dem för sökning.
        const threads = run('chat-threads');
        assert.deepStrictEqual(threads.map((t) => [t.id, t.name, t.kind, t.address, t.messages, t.first, t.last]), [
            [TG_SECRET, 'hemlig chatt 7', 'person', 'hemlig chatt', 1, T + 150, T + 150],
            ['-500', 'Klubben', 'group', 'Telegram-id 500', 5, T + 100, T + 140],
            ['1001', 'Kim Åkesson', 'person', '@kimmy', 9, T + 10, T + 90]]);
        for (const t of threads) assert.ok(THREAD_KINDS.includes(t.kind));
        // I gruppen är deltagarna de som skrivit mottagna meddelanden. Telefonens eget konto lägger Chattar till självt.
        assert.deepStrictEqual(run('chat-members').map((m) => [m.threadId, m.id, m.name, m.address, m.note]), [
            ['-500', KIM, 'Kim Åkesson', '@kimmy', 'skrev i gruppen'], ['-500', 1999, 'användare 1999', 'Telegram-id 1999', 'skrev i gruppen'],
            ['-500', 1003, 'robin', 'Telegram-id 1003', 'skrev i gruppen'], ['1001', KIM, 'Kim Åkesson', '@kimmy', null]]);
        const one = run('chat-messages', { threadId: '1001' });
        assert.deepStrictEqual(one.map((m) => [m.id, m.fromMe, m.senderId, m.senderName, m.text, m.kind, m.kindLabel]), [
            [1, 1, null, null, 'Hej', 'text', 'text'],
            [2, 0, KIM, 'Kim Åkesson', 'Hej själv', 'text', 'text'],
            [3, 0, KIM, 'Kim Åkesson', 'Bildtext', 'file', 'bild eller video'],
            [4, 1, null, null, 'å'.repeat(200), 'text', 'text'],
            [5, 0, KIM, 'Kim Åkesson', 'Svar', 'text', 'text'],
            [6, 0, KIM, 'Kim Åkesson', null, 'other', 'okänd konstruktor 78563412'],
            [7, 0, KIM, 'Kim Åkesson', null, 'other', 'texten kunde inte läsas'],
            [8, 0, KIM, 'Kim Åkesson', null, 'other', 'annat innehåll utan text'],
            [9, 0, KIM, 'Kim Åkesson', 'Länk', 'text', 'text']]);
        for (const m of one) { assert.ok(CHAT_KINDS.includes(m.kind), m.kind); assert.strictEqual(m.threadId, '1001'); }
        assert.deepStrictEqual(one.map((m) => m.date), [10, 20, 30, 40, 50, 60, 70, 80, 90].map((s) => T + s));
        assert.deepStrictEqual([one[0].readState, one[3].readState, one[2].mediaRaw, one[0].mediaRaw, one[0].sendState, one[0].ctor], [3, 2, 0, -1, 0, 'D3B90076']);
        // I gruppen står avsändaren i blobben, och ett tjänstemeddelande har ingen text.
        assert.deepStrictEqual(run('chat-messages', { threadId: '-500' }).map((m) => [m.id, m.fromMe, m.senderId, m.senderName, m.text, m.kind, m.kindLabel]), [
            [10, 1, null, null, null, 'system', 'tjänstemeddelande'],
            [11, 1, null, null, 'Till gruppen', 'text', 'text'],
            [12, 0, KIM, 'Kim Åkesson', 'Från Kim', 'text', 'text'],
            [13, 0, 1003, 'robin', null, 'voice', 'röst- eller videomeddelande'],
            [14, 0, 1999, 'användare 1999', 'Okänd', 'text', 'text']]);
        assert.deepStrictEqual(run('chat-messages', { threadId: TG_SECRET }).map((m) => [m.id, m.threadId, m.senderId, m.text, m.kind, m.kindLabel]), [
            [1, TG_SECRET, null, null, 'other', 'okänd konstruktor FA555555']]);
        // Medierna har ingen sökväg: Chattar säger då att databasen inte har någon. En länk räknas inte som media.
        assert.deepStrictEqual(run('chat-attachments', { threadId: '1001' }).map((a) => [a.messageId, a.path, a.name]), [[3, null, 'bild eller video']]);
        assert.deepStrictEqual(run('chat-attachments', { threadId: '-500' }).map((a) => [a.messageId, a.path, a.name]), [[13, null, 'röst- eller videomeddelande']]);
        assert.deepStrictEqual(run('chat-messages', { threadId: "1001' OR '1'='1" }), [], 'ett id med citattecken ger inga rader');
    } finally {
        db.close();
    }
});

// Bilden i ett meddelandes blobb, i den form labbtelefonens mottagna bild hade: mediets konstruktor och flaggor, bildens
// konstruktor och flaggor, id, nyckel, filreferens, tid och storlekarna. Värdena är påhittade.
function tgPhoto(id, sizes) {
    const size = (s) => s.stripped ? Buffer.concat([tg.u32(0xe0b0bc2e), tg.str(s.type), tg.str('abcd')])
        : s.steps ? Buffer.concat([tg.u32(0xfa3efb95), tg.str(s.type), tg.u32(s.w), tg.u32(s.h), tg.u32(0x1cb5c415), tg.u32(s.steps.length)].concat(s.steps.map(tg.u32)))
            : Buffer.concat([tg.u32(0x75c78e60), tg.str(s.type), tg.u32(s.w), tg.u32(s.h), tg.u32(s.size)]);
    return Buffer.concat([tg.u32(0x0badf00d), tg.u32(1), tg.u32(0xfb197a65), tg.u32(0), tg.i64(id), tg.i64(987654321), tg.str('filreferens'), tg.u32(1794427000),
        tg.u32(0x1cb5c415), tg.u32(sizes.length)].concat(sizes.map(size), [tg.u32(2), tg.u32(0x11223344)]));
}

test('Härkomst: Telegram på Android ger meddelandena i fönstret, meddelandet som bär en bilds id och täckningen', async () => {
    const { db, T, KIM } = await telegramAndroidSample();
    const [cache] = telegramAndroid.databases;
    const roles = require(path.join(ROOT, 'tools', 'provenance', 'roles.js'));
    const telegram = require(path.join(ROOT, 'tools', 'provenance', 'telegram.js'));
    const run = (role, params) => {
        const q = cache.queries.find((x) => x.role === role);
        const res = db.exec(roles.fill(q.sql, params || {}))[0];
        if (!res) return [];
        return res.values.map((r) => Object.fromEntries(Object.entries(q.fields).map(([k, col]) => [k, r[res.columns.indexOf(col)]])));
    };
    const ins = (mid, uid, out, date, data, more) => db.run('INSERT INTO messages_v2 (mid, uid, read_state, send_state, date, data, out, ttl, media, is_channel) VALUES (?, ?, 3, 0, ?, ?, ?, 0, ?, ?)',
        [mid, uid, date, data, out, (more || {}).media == null ? -1 : more.media, (more || {}).channel || 0]);
    try {
        const rows = run('messages', { window: { startMs: T * 1000, endMs: (T + 155) * 1000 } });
        assert.deepStrictEqual(rows.map((r) => r.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 1]);
        const by = (id, peer) => rows.find((r) => r.id === id && r.peerId === (peer || '1001'));
        assert.deepStrictEqual([by(2).time, by(2).out, by(2).peerType, by(2).chatName, by(2).sender, by(2).mediaType, by(2).service, by(2).hasText],
            [T + 20, 0, 0, 'Kim Åkesson', 'Kim Åkesson', null, 0, 1]);
        // En länk i media_v4 är ingen mediefil.
        assert.deepStrictEqual([by(1).sender, by(3).mediaType, by(8).hasText, by(9).mediaType], ['den här telefonen', 0, 0, null]);
        assert.deepStrictEqual([by(10, '-500').service, by(10, '-500').peerType, by(10, '-500').chatName, by(10, '-500').sender], [1, 1, 'Klubben', 'den här telefonen']);
        assert.deepStrictEqual([by(12, '-500').sender, by(13, '-500').sender, by(13, '-500').mediaType, by(13, '-500').hasText, by(14, '-500').sender], ['Kim Åkesson', 'robin', 2, 0, 'användare 1999']);
        assert.deepStrictEqual([by(1, TG_SECRET).peerType, by(1, TG_SECRET).chatName, by(1, TG_SECRET).sender, by(1, TG_SECRET).ctor], [3, 'hemlig chatt 7', null, 'FA555555']);
        assert.deepStrictEqual(run('messages', { window: { startMs: (T + 100) * 1000, endMs: (T + 120) * 1000 } }).map((r) => r.id), [10, 11, 12]);
        // En kanal eller supergrupp är märkt på raden.
        ins(20, -600, 0, T + 160, tg.message({ id: 20, from: KIM, peer: -600, date: T + 160, text: 'I kanalen' }), { channel: 1 });
        assert.deepStrictEqual(run('messages', { window: { startMs: (T + 160) * 1000, endMs: (T + 160) * 1000 } }).map((r) => [r.id, r.peerId, r.peerType, r.chatName, r.sender]), [[20, '-600', 2, 'chatt 600', 'Kim Åkesson']]);

        // En mottagen bild: id:t står åtta byte efter bildens konstruktor, och den största storlekens sista steg är filens storlek.
        const ID = 5550001112223334445n;
        const idHex = tg.i64(ID).toString('hex').toUpperCase();
        const sizes = [{ stripped: true, type: 'i' }, { type: 'm', w: 320, h: 240, size: 1234 }, { type: 'y', w: 1280, h: 960, steps: [100, 2000, 54321] }];
        const blob = Buffer.concat([tg.message({ id: 40, peer: KIM, date: T + 170, text: '' }).subarray(0, -4), tgPhoto(ID, sizes)]);
        ins(40, KIM, 0, T + 170, blob, { media: 0 });
        db.run('INSERT INTO media_v4 (mid, uid, date, type, data) VALUES (40, ?, ?, 0, ?)', [KIM, T + 170, blob]);
        const hit = run('photo', { idHex });
        assert.deepStrictEqual(hit.map((r) => [r.id, r.peerId, r.time, r.out, r.peerType, r.chatName, r.sender, r.mediaType, r.hasText, r.idOffset]), [[40, '1001', T + 170, 0, 0, 'Kim Åkesson', 'Kim Åkesson', 0, 0, 52]]);
        assert.match(hit[0].photoHex, /^657A19FB/);
        assert.deepStrictEqual(telegram.parsePhoto(hit[0].photoHex), { id: idHex, sizes: [{ type: 'i', w: null, h: null, size: null }, { type: 'm', w: 320, h: 240, size: 1234 }, { type: 'y', w: 1280, h: 960, size: 54321 }], complete: true });
        // Ett annat id ger ingen rad, och ett id som inte är hexadecimalt ger ingen rad och inget fel.
        assert.deepStrictEqual(run('photo', { idHex: tg.i64(ID + 1n).toString('hex').toUpperCase() }), []);
        assert.deepStrictEqual(run('photo', { idHex: "00' OR '1'='1" }), []);
        assert.deepStrictEqual(run('coverage'), [{ first: T + 10, last: T + 170, rows: 17 }]);
    } finally {
        db.close();
    }
});

test('Telegram på Android: de synliga queryerna ger riktning, chatt, avsändare, text, läst, chattar, användare och hur blobben lästes', async () => {
    const { db, T, ME, KIM } = await telegramAndroidSample();
    const [cache] = telegramAndroid.databases;
    const roles = require(path.join(ROOT, 'tools', 'provenance', 'roles.js'));
    const run = (id, params) => {
        const q = cache.queries.find((x) => x.id === id);
        // localtime följer datorns zon: testet läser bara kolumnerna som inte beror på den.
        const res = db.exec(roles.fill(q.sql, params || {}))[0];
        return res ? res.values.map((r) => Object.fromEntries(res.columns.map((c, i) => [c, r[i]]))) : [];
    };
    try {
        const rows = run('messages', { window: { startMs: T * 1000, endMs: (T + 200) * 1000 } });
        assert.deepStrictEqual(rows.map((r) => r.meddelande_id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 1]);
        const by = (id, chat) => rows.find((r) => r.meddelande_id === id && r.chatt_id === (chat || '1001'));
        assert.deepStrictEqual([by(1).riktning, by(1).typ, by(1).chatt, by(1).fran, by(1).text, by(1).last, by(1).sandning, by(1).tid_utc],
            ['skickat', 'text', 'Kim Åkesson', 'den här telefonen', 'Hej', 'ja', 'skickat', '2026-11-11 19:56:50']);
        assert.deepStrictEqual([by(2).riktning, by(2).fran, by(2).text, by(4).last], ['mottaget', 'Kim Åkesson', 'Hej själv', 'nej']);
        assert.deepStrictEqual([by(3).typ, by(3).text, by(6).typ, by(6).text, by(7).typ, by(8).typ, by(9).typ],
            ['bild eller video', 'Bildtext', 'okänd konstruktor 78563412', null, 'texten kunde inte läsas', 'annat innehåll utan text', 'text']);
        assert.deepStrictEqual([by(10, '-500').riktning, by(10, '-500').typ, by(10, '-500').chatt, by(10, '-500').fran, by(10, '-500').text],
            ['tjänst', 'tjänstemeddelande', 'Klubben', 'den här telefonen', null]);
        assert.deepStrictEqual([by(12, '-500').fran, by(13, '-500').fran, by(13, '-500').typ, by(14, '-500').fran], ['Kim Åkesson', 'robin', 'röst- eller videomeddelande', 'användare 1999']);
        assert.deepStrictEqual([by(1, TG_SECRET).chatt, by(1, TG_SECRET).fran, by(1, TG_SECRET).typ], ['hemlig chatt 7', null, 'okänd konstruktor FA555555']);
        assert.deepStrictEqual(run('messages', { window: { startMs: (T + 100) * 1000, endMs: (T + 120) * 1000 } }).map((r) => r.meddelande_id), [10, 11, 12]);

        assert.deepStrictEqual(run('chats').map((r) => [r.slag, r.chatt, r.anvandarnamn, r.meddelanden, r.olasta, r.last_hit_mottagna, r.last_hit_skickade, r.fast, r.chatt_id]), [
            ['grupp eller kanal', 'Klubben', null, 5, 1, 12, 0, 'ja', '-500'], ['person', 'Kim Åkesson', 'kimmy', 9, 0, 9, 1, null, '1001']]);
        // Användarna: namnet som det skrivs bredvid namnet Telegram sparat för sökning.
        assert.deepStrictEqual(run('users').map((r) => [r.namn, r.namn_i_sokningen, r.anvandarnamn, r.telegram_id, r.i_kontakterna, r.omsesidig, r.har_chatt, r.status_ratt]), [
            ['alex', 'alex', null, 1005, null, null, null, 0], ['Egen Lab', 'egen lab', null, ME, null, null, null, T + 950],
            ['Kim Åkesson', 'kim åkesson', 'kimmy', KIM, 'ja', 'ja', 'ja', T + 900], ['robin', 'robin', null, 1003, null, null, null, 0], ['Sam', 'sam', null, 1004, null, null, null, 0]]);
        assert.deepStrictEqual(run('media').map((r) => [r.meddelande_id, r.chatt_id, r.riktning, r.chatt, r.typ, r.blob_byte]), [
            [3, '1001', 'mottaget', 'Kim Åkesson', 'bild eller video', 3], [9, '1001', 'mottaget', 'Kim Åkesson', 'länk', 1], [13, '-500', 'mottaget', 'Klubben', 'röst- eller videomeddelande', 2]]);
        // Kontrollen: var tiden står i blobben, textens längd och avsändaren.
        const blob = run('message-blob');
        const b = (id, chat) => blob.find((r) => r.meddelande_id === id && r.chatt_id === (chat || '1001'));
        assert.strictEqual(blob.length, 15);
        assert.deepStrictEqual([b(1).konstruktor, b(1).tolkning, b(1).tidens_byte, b(1).textens_langdbyte, b(1).avsandarens_id], ['D3B90076', 'meddelande', 40, 3, ME]);
        assert.deepStrictEqual([b(2).tidens_byte, b(2).textens_langdbyte, b(2).avsandarens_id], [28, 10, null]);
        assert.deepStrictEqual([b(4).textens_langdbyte, b(5).tidens_byte, b(7).tidens_byte, b(7).textens_langdbyte], [254, 40, null, null]);
        assert.deepStrictEqual([b(10, '-500').tolkning, b(10, '-500').avsandarens_id, b(6).tolkning], ['tjänstemeddelande', ME, 'okänd']);
        assert.match(b(1).de_forsta_80_byten, /^D3B9007600010000/);
        assert.strictEqual(run('tables').find((r) => r.tabell === 'messages_v2').rader, 15);
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
