// Telegrams format: klasserna, nycklarna, meddelandena, kontakterna, lagringsdatabasen och tabellerna
// i minnet. Databaserna är påhittade och kodade av fixtures/postbox-encode.js i labbtelefonens form.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const PB = require('./postbox');
const E = require('./fixtures/postbox-encode');

const ROOT = path.join(__dirname, '..', '..');
let SQLJS = null;
async function sqlJs() {
    if (SQLJS) return SQLJS;
    const dir = path.join(ROOT, 'tools', 'ios-keychain', 'vendor', 'sqljs');
    const ctx = {};
    new Function('window', fs.readFileSync(path.join(dir, 'sql-wasm-binary.js'), 'utf8'))(ctx);
    SQLJS = await require(path.join(dir, 'sql-wasm.js'))({ wasmBinary: ctx.SQL_WASM_BINARY });
    return SQLJS;
}

const ME = E.peer(0, 9000000001);
const KIM = E.peer(0, 7000000002);
const T = 1793000000;

function rows(db, sql) {
    const r = db.exec(sql)[0];
    return r ? r.values.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, v[i]]))) : [];
}

test('klasserna känns igen på MurmurHash3 av namnet, som i labbet', () => {
    assert.strictEqual(PB.classHash('TelegramMediaImage'), 0x8bae2094);
    assert.strictEqual(PB.classHash('TelegramMediaFile'), 0x27ae4838);
    assert.strictEqual(PB.classHash('TelegramMediaAction'), 0xbc780781);
    assert.strictEqual(PB.classHash('TelegramUser'), 0x9e68a52b);
    assert.strictEqual(PB.classHash('AutoclearTimeoutMessageAttribute'), 0x5a18f7fc);
    assert.strictEqual(PB.className(0x12345678), '#12345678');
});

test('peer-id: typen i bit 32–34 och id:t i resten, också över 2^53', () => {
    assert.deepStrictEqual(PB.peerParts(37064771074), { type: 0, id: '7000000002' });
    assert.deepStrictEqual(PB.peerParts(E.peer(2, 1234567)), { type: 2, id: '1234567' });
    const big = (1n << 50n) + 5n;
    assert.deepStrictEqual(PB.peerParts(E.peer(1, big)), { type: 1, id: big.toString() });
});

test('nyckeln i t7 är peer, namnrymd, tid och id i big endian', () => {
    const k = PB.decodeKey(E.messageKey({ peer: KIM, namespace: 0, timestamp: T, id: 42 }));
    assert.strictEqual(k.peer, KIM);
    assert.strictEqual(k.timestamp, T);
    assert.strictEqual(k.id, 42);
    assert.throws(() => PB.decodeKey(new Uint8Array(19)), /20 byte/);
});

test('en skickad bild: största storleken, resurserna och engångsvisning', () => {
    const m = { peer: KIM, timestamp: T, id: 5, author: ME, attributes: [E.viewOnce(), E.consumed(false), E.entities()],
        media: [E.image({ photoId: 600, sizes: [{ s: 'm', w: 180, h: 320, size: 9000 }, { s: 'w', w: 1152, h: 2048, size: 262257 }] })] };
    const out = PB.messageRows(E.messageKey(m), E.messageValue(m));
    const r = out.message;
    assert.strictEqual(r.decode_error, null);
    assert.strictEqual(r.incoming, 0);
    assert.strictEqual(r.peer_tg_id, '7000000002');
    assert.strictEqual(r.author_tg_id, '9000000001');
    assert.strictEqual(r.media, 'bild');
    assert.strictEqual(r.media_classes, 'TelegramMediaImage');
    assert.deepStrictEqual([r.media_width, r.media_height, r.media_size], [1152, 2048, 262257]);
    assert.strictEqual(r.view_once, 1);
    assert.strictEqual(r.consumed, 0);
    assert.deepStrictEqual(out.resources.map((x) => [x.resource_id, x.size]), [
        ['telegram-cloud-photo-size-4-600-m', 9000], ['telegram-cloud-photo-size-4-600-w', 262257]]);
});

test('mottagen video, samtal, text och vidarebefordran', () => {
    const vid = { peer: KIM, timestamp: T + 60, id: 8, incoming: true, author: KIM, media: [E.video({ fileId: 77, size: 114165, w: 464, h: 848, dur: 2.334 })] };
    const v = PB.messageRows(E.messageKey(vid), E.messageValue(vid));
    assert.strictEqual(v.message.incoming, 1);
    assert.strictEqual(v.message.media, 'video');
    assert.strictEqual(v.message.media_mime, 'video/mp4');
    assert.strictEqual(v.message.media_duration, 2.334);
    assert.strictEqual(v.message.media_file_name, 'video.mp4');
    assert.deepStrictEqual(v.resources.map((x) => [x.resource_id, x.role]), [['telegram-cloud-document-4-77', 'video'], ['telegram-cloud-document-size-4-77-m', 'miniatyr']]);

    const c = { peer: KIM, timestamp: T + 90, id: 9, author: ME, globalTags: 1, media: [E.call({ id: 3, discard: 0 })] };
    const cr = PB.messageRows(E.messageKey(c), E.messageValue(c)).message;
    assert.deepStrictEqual([cr.media, cr.action, cr.call_duration, cr.call_discard, cr.global_tags], ['samtal', 14, null, 0, 1]);

    const f = { peer: KIM, timestamp: T + 99, id: 10, author: ME, text: 'Hej <b>då</b>', forward: { author: KIM, date: T - 500, source: KIM } };
    const fr = PB.messageRows(E.messageKey(f), E.messageValue(f)).message;
    assert.strictEqual(fr.text, 'Hej <b>då</b>');
    assert.strictEqual(fr.media, null);
    assert.strictEqual(fr.forward_author_id, KIM.toString());
    assert.strictEqual(fr.forward_date, T - 500);
});

test('en trasig post ger nyckelns uppgifter och felet, inget undantag', () => {
    const m = { peer: KIM, timestamp: T, id: 3, author: ME, text: 'x' };
    const value = E.messageValue(m).subarray(0, 20);
    const r = PB.messageRows(E.messageKey(m), value).message;
    assert.strictEqual(r.id, 3);
    assert.strictEqual(r.timestamp, T);
    assert.match(r.decode_error, /tar slut/);
});

test('tabellerna i minnet: meddelanden, resurser och kontakter, och raden till spårbarheten', async () => {
    const SQL = await sqlJs();
    const msgs = [
        { peer: KIM, timestamp: T, id: 1, author: ME, text: 'Hej' },
        { peer: KIM, timestamp: T + 16, id: 2, author: ME, media: [E.image({ photoId: 601, sizes: [{ s: 'y', w: 960, h: 1280, size: 34707 }] })] },
        { peer: KIM, timestamp: T + 20, id: 3, author: ME, value: Buffer.from([1, 2, 3]) },
    ];
    const peers = [{ peer: KIM, value: E.user({ id: 7000000002, fn: 'Kim', ln: 'Test', p: '46700000000' }) }, { peer: E.peer(2, 55), value: E.channel({ id: 55, title: 'Kanalen' }) }];
    const db = new SQL.Database(E.postboxDb(SQL, { messages: msgs, peers }));
    const cache = {};
    const info = PB.attach(db, cache);
    assert.strictEqual(info.kind, 'postbox');
    assert.deepStrictEqual(info.tables, ['tg_message', 'tg_resource', 'tg_peer']);
    assert.strictEqual(info.errors, 1);
    assert.match(info.line, /3 meddelanden ur t7.*1 resurser.*2 kontakter.*finns inte i filen.*1 post kunde inte avkodas/);
    const m = rows(db, 'SELECT id, media, text, decode_error FROM tg_message ORDER BY id');
    assert.deepStrictEqual(m.map((x) => [x.id, x.media, x.text]), [[1, null, 'Hej'], [2, 'bild', ''], [3, null, null]]);
    assert.match(m[2].decode_error, /typ 1/);
    assert.deepStrictEqual(rows(db, 'SELECT name, phone, kind FROM tg_peer ORDER BY peer_type').map((x) => [x.name, x.phone, x.kind]), [['Kim Test', '46700000000', 'användare'], ['Kanalen', null, 'kanal']]);
    // Tabellerna är tillfälliga: de finns inte i filens schema.
    assert.strictEqual(rows(db, "SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'tg_%'")[0].n, 0);
    db.close();
    // En ny kopia läser de sparade raderna.
    const db2 = new SQL.Database(E.postboxDb(SQL, { messages: [], peers: [] }));
    assert.strictEqual(PB.attach(db2, cache).tables.length, 3);
    assert.strictEqual(rows(db2, 'SELECT count(*) AS n FROM tg_message')[0].n, 3);
    db2.close();
});

test('lagringsdatabasen: resurs, chatt, meddelande och bildbibliotekets id', async () => {
    const SQL = await sqlJs();
    const UUID = 'E0A969AD-D0EE-4693-97EE-DEF992DAD88A';
    const db = new SQL.Database(E.storageDb(SQL, { entries: [
        { id: 'ph-' + UUID + '_L0_001--6908267387152587113', contentType: 0, size: 34707, refs: [{ peer: KIM, messageId: 0 }] },
        { id: 'telegram-cloud-photo-size-4-601-y', contentType: 1, refs: [{ peer: KIM, messageId: 2 }] },
        { id: 'telegram-cloud-document-1-99', contentType: 0 },
    ] }));
    const info = PB.attach(db);
    assert.strictEqual(info.kind, 'storage');
    const s = rows(db, 'SELECT resource_id, size, peer_tg_id, message_id, library_uuid FROM tg_storage ORDER BY resource_id');
    assert.deepStrictEqual(s.map((x) => [x.resource_id.slice(0, 26), x.size, x.peer_tg_id, x.message_id, x.library_uuid]), [
        ['ph-E0A969AD-D0EE-4693-97EE', 34707, '7000000002', null, UUID],
        ['telegram-cloud-document-1-', 0, null, null, null],
        ['telegram-cloud-photo-size-', 0, '7000000002', 2, null],
    ]);
    db.close();
});

test('bara Telegrams databaser får tabellerna', async () => {
    const SQL = await sqlJs();
    assert.strictEqual(PB.kindOf({ __meta_fulltext_tables: 1, t2: 1, t3: 1 }), null);
    assert.strictEqual(PB.kindOf({ __meta_fulltext_tables: 1, t2: 1, t7: 1, t15: 1, t16: 1 }), 'postbox');
    assert.strictEqual(PB.kindOf({ __meta_fulltext_tables: 1, t15: 1, t16: 1, t17: 1 }), 'storage');
    assert.strictEqual(PB.kindOf({ t2: 1, t7: 1 }), null);
    const db = new SQL.Database();
    db.run('CREATE TABLE t7 (key BLOB, value BLOB)');
    assert.strictEqual(PB.attach(db), null);
    // kindIn frågar databasen själv, utan att avkoda något: verktygen visar raden om avkodningen först när den behövs.
    assert.strictEqual(PB.kindIn(db), null);
    db.close();
    const postbox = new SQL.Database(E.postboxDb(SQL, { messages: [], peers: [] }));
    assert.strictEqual(PB.kindIn(postbox), 'postbox');
    assert.strictEqual(rows(postbox, "SELECT count(*) AS n FROM sqlite_temp_master WHERE name LIKE 'tg_%'")[0].n, 0);
    postbox.close();
    const storage = new SQL.Database(E.storageDb(SQL, { entries: [] }));
    assert.strictEqual(PB.kindIn(storage), 'storage');
    storage.close();
    // En stängd databas är ingen av Telegrams, och ger inget undantag.
    assert.strictEqual(PB.kindIn(storage), null);
});

test('avkodningen växer linjärt: 150 000 meddelanden med bilder går på några sekunder', async () => {
    const S = await sqlJs();
    const db = new S.Database(E.postboxDb(S, {}));
    const value = new Uint8Array(E.messageValue({ peer: KIM, namespace: 0, timestamp: T, id: 1, author: ME,
        media: [E.image({ photoId: 600, sizes: [{ s: 'm', w: 180, h: 320, size: 9000 }, { s: 'w', w: 1152, h: 2048, size: 262257 }] })] }));
    const insert = db.prepare('INSERT INTO t7 VALUES (?, ?)');
    db.run('BEGIN');
    for (let id = 1; id <= 150000; id++) insert.run([new Uint8Array(E.messageKey({ peer: KIM, namespace: 0, timestamp: T + id, id })), value]);
    db.run('COMMIT');
    insert.free();
    const started = Date.now();
    const out = PB.attach(db);
    const ms = Date.now() - started;
    assert.strictEqual(out.kind, 'postbox');
    assert.strictEqual(rows(db, 'SELECT count(*) AS n FROM tg_message')[0].n, 150000);
    assert.strictEqual(rows(db, 'SELECT count(*) AS n FROM tg_resource')[0].n, 300000);
    db.close();
    // Med en lista som kopieras för varje meddelande tog det här över en halv minut.
    assert.ok(ms < 15000, 'Avkodningen tog ' + ms + ' ms');
});
