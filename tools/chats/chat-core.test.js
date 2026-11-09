'use strict';
// Chattar: konversationen byggs ur WhatsApps chattroller i katalogen, körda mot en påhittad databas med
// labbtelefonens schema. Tider, sökvägar, urval och exporten prövas här; gränssnittet prövas i tests/app.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const core = require('./chat-core.js');
const exp = require('./chat-export.js');
const roles = require('../provenance/roles.js');
const whatsapp = require(path.join(ROOT, 'queries', 'ios', 'whatsapp', 'catalog.json'));
const SCHEMAS = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'chat-schemas.json'));

const COCOA = 978307200;
const cocoa = (iso) => Date.parse(iso) / 1000 - COCOA;
const DB_PATH = 'private/var/mobile/Containers/Shared/AppGroup/66666666-7777-4888-9999-AAAAAAAAAAAA/ChatStorage.sqlite';
const XSS = '<img src=x onerror="window.__x=1">';

let SQLJS = null;
async function sqlJs() {
    if (SQLJS) return SQLJS;
    const dir = path.join(ROOT, 'tools', 'ios-keychain', 'vendor', 'sqljs');
    const ctx = {};
    new Function('window', fs.readFileSync(path.join(dir, 'sql-wasm-binary.js'), 'utf8'))(ctx);
    SQLJS = await require(path.join(dir, 'sql-wasm.js'))({ wasmBinary: ctx.SQL_WASM_BINARY });
    return SQLJS;
}

async function fixture() {
    const S = await sqlJs();
    const db = new S.Database();
    Object.values(SCHEMAS['whatsapp-ios']).forEach((sql) => db.run(sql));
    const ins = (t, row) => db.run('INSERT INTO ' + t + ' (' + Object.keys(row).join(', ') + ') VALUES (' + Object.keys(row).map(() => '?').join(', ') + ')', Object.values(row));
    ins('ZWACHATSESSION', { Z_PK: 3, ZSESSIONTYPE: 0, ZCONTACTJID: '111@lid', ZPARTNERNAME: 'Kim ' + XSS });
    ins('ZWACHATSESSION', { Z_PK: 4, ZSESSIONTYPE: 1, ZCONTACTJID: '9-1@g.us', ZPARTNERNAME: 'Klubben' });
    ins('ZWAGROUPMEMBER', { Z_PK: 7, ZCHATSESSION: 4, ZMEMBERJID: '222@lid', ZCONTACTNAME: 'Lo', ZISADMIN: 1, ZISACTIVE: 1 });
    ins('ZWAGROUPMEMBER', { Z_PK: 8, ZCHATSESSION: 4, ZMEMBERJID: '333@lid', ZFIRSTNAME: 'Mo', ZISACTIVE: 0 });
    // Vintertid den 25 oktober 2026 kl. 03:00 svensk tid: meddelande 2 skrevs 02:30 sommartid, 3 kl. 02:30 vintertid.
    ins('ZWAMESSAGE', { Z_PK: 1, ZCHATSESSION: 3, ZISFROMME: 1, ZMESSAGETYPE: 0, ZTEXT: 'Hej ' + XSS + '\nrad två', ZMESSAGEDATE: cocoa('2026-10-24T20:00:00Z'), ZSENTDATE: cocoa('2026-10-24T20:00:01Z') });
    ins('ZWAMESSAGE', { Z_PK: 2, ZCHATSESSION: 3, ZISFROMME: 0, ZMESSAGETYPE: 1, ZFROMJID: '111@lid', ZMESSAGEDATE: cocoa('2026-10-25T00:30:00Z'), ZSENTDATE: cocoa('2026-10-25T00:29:58Z'), ZMEDIAITEM: 5 });
    ins('ZWAMEDIAITEM', { Z_PK: 5, ZMESSAGE: 2, ZMEDIALOCALPATH: 'Media/111@lid/a/b/bild.jpg', ZFILESIZE: 2048, ZVCARDNAME: '07ZeqtAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', ZVCARDSTRING: 'image/jpeg' });
    ins('ZWAMESSAGE', { Z_PK: 3, ZCHATSESSION: 3, ZISFROMME: 0, ZMESSAGETYPE: 2, ZFROMJID: '111@lid', ZMESSAGEDATE: cocoa('2026-10-25T01:30:00Z'), ZSENTDATE: 0, ZMEDIAITEM: 6 });
    ins('ZWAMEDIAITEM', { Z_PK: 6, ZMESSAGE: 3, ZMEDIALOCALPATH: 'Media/111@lid/c/d/film.mp4', ZFILESIZE: 3 * 1048576, ZMOVIEDURATION: 75, ZVCARDSTRING: 'video/mp4' });
    ins('ZWAMESSAGE', { Z_PK: 4, ZCHATSESSION: 3, ZISFROMME: 1, ZMESSAGETYPE: 4, ZMESSAGEDATE: cocoa('2026-10-26T09:00:00Z'), ZMEDIAITEM: 9 });
    ins('ZWAMEDIAITEM', { Z_PK: 9, ZMESSAGE: 4, ZVCARDNAME: 'Kim Kontakt', ZVCARDSTRING: 'BEGIN:VCARD\nFN:Kim Kontakt\nEND:VCARD' });
    ins('ZWAMESSAGE', { Z_PK: 10, ZCHATSESSION: 4, ZISFROMME: 0, ZMESSAGETYPE: 0, ZGROUPMEMBER: 7, ZTEXT: 'Från Lo', ZMESSAGEDATE: cocoa('2026-10-26T10:00:00Z') });
    return db;
}

function exec(db, q, values) {
    const res = db.exec(roles.fill(q.sql, values || {}));
    return res.length ? res[res.length - 1] : { columns: [], values: [] };
}

async function load(threadId) {
    const db = await fixture();
    try {
        const [src] = core.sources([whatsapp]);
        const threads = core.threads(src, exec(db, src.roles.threads));
        const people = core.members(src, exec(db, src.roles.members));
        const thread = threads.find((t) => t.id === threadId);
        const model = core.conversation(src, thread, exec(db, src.roles.messages, { threadId }), exec(db, src.roles.attachments, { threadId }), people[String(threadId)], DB_PATH);
        return { src, threads, people, model };
    } finally {
        db.close();
    }
}

test('källorna: WhatsApp på iOS har alla fyra chattroller och blir en databas att leta efter i extraktionen', () => {
    const list = core.sources([whatsapp, { id: 'x', databases: [{ id: 'utan', label: 'iOS — x', queries: [] }] }]);
    assert.deepStrictEqual(list.map((s) => [s.key, s.app, s.platform, s.title]), [['whatsapp-ios-chat', 'WhatsApp', 'iOS', 'ChatStorage.sqlite (WhatsApp)']]);
    assert.deepStrictEqual(Object.keys(list[0].roles).sort(), ['attachments', 'members', 'messages', 'threads']);
    assert.deepStrictEqual(core.databases(list)[0], { id: 'whatsapp-ios-chat', family: 'whatsapp-ios-chat', familyTitle: 'ChatStorage.sqlite (WhatsApp)', label: 'ChatStorage.sqlite (WhatsApp)', paths: ['ChatStorage.sqlite'], ios: null, cipher: null, derive: null });
});

test('konversationer och deltagare: slag, antal, tider i UTC och gruppens medlemmar', async () => {
    const { threads, people } = await load(3);
    const kim = threads.find((t) => t.id === 3);
    assert.strictEqual(kim.kind, 'person');
    assert.strictEqual(kim.kindText, 'Enskild chatt');
    assert.strictEqual(kim.messages, 4);
    assert.strictEqual(new Date(kim.firstMs).toISOString(), '2026-10-24T20:00:00.000Z');
    assert.strictEqual(new Date(kim.lastMs).toISOString(), '2026-10-26T09:00:00.000Z');
    assert.strictEqual(threads.find((t) => t.id === 4).kind, 'group');
    assert.deepStrictEqual(people['4'].map((p) => [p.name, p.admin, p.active]), [['Lo', true, true], ['Mo', false, false]]);
    assert.deepStrictEqual(people['3'].map((p) => p.address), ['111@lid']);
});

test('meddelandena: ordning, riktning, typ, tider med kolumn och rått värde, bilagornas sökväg och SHA-256', async () => {
    const { model } = await load(3);
    assert.deepStrictEqual(model.messages.map((m) => [m.id, m.fromMe, m.kind]), [[1, true, 'text'], [2, false, 'image'], [3, false, 'video'], [4, true, 'contact']]);
    const [first, image, video, card] = model.messages;
    assert.strictEqual(first.text, 'Hej ' + XSS + '\nrad två');
    assert.strictEqual(first.sortLabel, 'Skrivet eller mottaget');
    assert.deepStrictEqual(first.times.map((t) => [t.key, t.col, new Date(t.ms).toISOString()]), [
        ['date', 'ZMESSAGEDATE', '2026-10-24T20:00:00.000Z'], ['sent', 'ZSENTDATE', '2026-10-24T20:00:01.000Z']]);
    assert.strictEqual(video.times[1].ms, null, 'ZSENTDATE 0 är ingen tid');
    assert.strictEqual(video.times[1].raw, 0);
    assert.strictEqual(image.senderName, 'Kim ' + XSS);
    assert.strictEqual(image.attachments.length, 1);
    const a = image.attachments[0];
    assert.strictEqual(a.entry, 'private/var/mobile/Containers/Shared/AppGroup/66666666-7777-4888-9999-AAAAAAAAAAAA/Message/Media/111@lid/a/b/bild.jpg');
    assert.strictEqual(a.kind, 'image');
    assert.strictEqual(a.sha256, 'd3b65eaad0'.padEnd(64, '0'));
    assert.strictEqual(video.attachments[0].kind, 'video');
    assert.strictEqual(video.attachments[0].duration, 75);
    assert.strictEqual(card.attachments[0].kind, 'contact');
    assert.strictEqual(card.attachments[0].cardName, 'Kim Kontakt');
    assert.ok(first.details.some((d) => /ZMESSAGETYPE/.test(d.label) && d.value === 0));
    assert.strictEqual(model.group, false);
});

test('sökvägar: fileRoot räknas från databasens mapp, också uppåt', () => {
    assert.strictEqual(core.resolvePath('a/b/grdb/signal.sqlite', '..', 'attachment_files/12/x'), 'a/b/attachment_files/12/x');
    assert.strictEqual(core.resolvePath('d/org.thoughtcrime.securesms/databases/signal.db', '..', 'app_parts/part1.mms'), 'd/org.thoughtcrime.securesms/app_parts/part1.mms');
    assert.strictEqual(core.resolvePath('g/ChatStorage.sqlite', '.', './Message/x.jpg'), 'g/Message/x.jpg');
    assert.strictEqual(core.resolvePath('g/ChatStorage.sqlite', '.', null), null);
});

test('tider: UTC och svensk tid över skiftet till vintertid, och inskrivna tider tillbaka till UTC', () => {
    const se = core.formatter('Europe/Stockholm');
    assert.strictEqual(se(Date.parse('2026-10-25T00:30:00Z')), '2026-10-25 02:30:00');
    assert.strictEqual(se(Date.parse('2026-10-25T01:30:00Z')), '2026-10-25 02:30:00');
    assert.strictEqual(core.formatter('UTC')(Date.parse('2026-10-25T01:30:00Z')), '2026-10-25 01:30:00');
    assert.strictEqual(core.offsetText('Europe/Stockholm', Date.parse('2026-07-01T12:00:00Z')), '+02:00');
    assert.strictEqual(core.offsetText('Europe/Stockholm', Date.parse('2026-12-01T12:00:00Z')), '+01:00');
    assert.strictEqual(core.parseLocal('2026-07-01 14:00', 'Europe/Stockholm'), Date.parse('2026-07-01T12:00:00Z'));
    assert.strictEqual(core.parseLocal('2026-12-01 13:00:05', 'Europe/Stockholm'), Date.parse('2026-12-01T12:00:05Z'));
    assert.strictEqual(core.parseLocal('2026-12-01T13:00', 'UTC'), Date.parse('2026-12-01T13:00:00Z'));
    assert.strictEqual(core.parseLocal('igår', 'UTC'), null);
    assert.strictEqual(core.zoneName('UTC'), 'UTC');
});

test('urval: valda meddelanden, ett tidsspann eller alla', async () => {
    const { model } = await load(3);
    assert.deepStrictEqual(core.pick(model.messages, { ids: ['4', '2'] }).map((m) => m.id), [2, 4]);
    assert.deepStrictEqual(core.pick(model.messages, { fromMs: Date.parse('2026-10-25T00:00:00Z'), toMs: Date.parse('2026-10-25T23:59:59Z') }).map((m) => m.id), [2, 3]);
    assert.deepStrictEqual(core.pick(model.messages, { fromMs: Date.parse('2026-10-26T00:00:00Z') }).map((m) => m.id), [4]);
    assert.strictEqual(core.pick(model.messages).length, 4);
});

test('export: källa, deltagare, bubblor, inbäddad bild och spårbarhet, med all text escapad', async () => {
    const { model } = await load(3);
    const list = core.pick(model.messages, { ids: ['1', '2', '3'] });
    const entry = list[1].attachments[0].entry;
    const out = exp.html({
        model, messages: list, zone: 'Europe/Stockholm', selection: '3 valda meddelanden',
        meta: { extraction: 'lab.zip (100 byte)', dbPath: DB_PATH, version: '1.56', exportedMs: Date.parse('2026-11-09T10:00:00Z') },
        media: { [entry]: { dataUrl: 'data:image/jpeg;base64,AAAA' } },
    });
    assert.ok(!out.includes(XSS), 'ingen oescapad HTML ur databasen');
    assert.ok(out.includes('Hej &lt;img src=x onerror=&quot;window.__x=1&quot;&gt;<br>rad två'));
    assert.ok(out.includes('<img src="data:image/jpeg;base64,AAAA"'));
    assert.ok(out.includes('Video: film.mp4, video/mp4, 1:15, 3,0 MB'));
    assert.ok(out.includes('3 av 4, 2026-10-24 22:00:00 – 2026-10-25 02:30:00'));
    assert.ok(out.includes('Europe/Stockholm (UTC+02:00 vid det första meddelandet)'));
    assert.ok(out.includes(DB_PATH));
    assert.ok(out.includes('ZSENTDATE = 0'), 'råvärdet för en saknad tid');
    assert.ok(out.includes('2026-10-25T01:30:00.000Z'));
    assert.ok(out.includes('SHA-256 d3b65eaad'));
    assert.ok(out.includes('1.56'));
    assert.ok(!out.includes('Kontaktkort'), 'kontaktkortet var inte valt');
    assert.match(exp.fileName(model, 'html', Date.UTC(2026, 10, 9, 10, 0)), /^WhatsApp-Kim__img_src=x_onerror=_window\.__x=1_-\d{8}-\d{4}\.html$/);
});

test('export: avsändarens namn i en grupp', async () => {
    const { model } = await load(4);
    assert.strictEqual(model.group, true);
    const out = exp.html({ model, messages: model.messages, zone: 'UTC', selection: 'hela konversationen', meta: {} });
    assert.ok(out.includes('<div class="who">Lo</div>'));
    assert.ok(out.includes('Mo — 333@lid (har lämnat)'));
    assert.ok(out.includes('Lo — 222@lid (administratör)'));
});

test('Snapchat: texten ur message_content (fält 4.4.2.1), namnen ur kontodatabasen och konversationens namn ur deltagarna', () => {
    // Protobuf för 4 { 4 { 2 { 1: "Hej på dig" } } } med ett annat fält före.
    const enc = (field, bytes) => Buffer.concat([Buffer.from([(field << 3) | 2, bytes.length]), bytes]);
    const text = Buffer.from('Hej på dig', 'utf8');
    const content = new Uint8Array(Buffer.concat([Buffer.from([0x08, 0x05]), enc(4, enc(4, Buffer.concat([enc(3, Buffer.from('x')), enc(2, enc(1, text))])))]));
    assert.strictEqual(core.snapText(content), 'Hej på dig');
    assert.strictEqual(core.snapText(new Uint8Array([0x08, 0x01])), '');
    assert.strictEqual(core.snapText(null), '');
    const snapchat = require(path.join(ROOT, 'queries', 'android', 'snapchat', 'catalog.json'));
    const list = core.sources([snapchat]);
    const names = list.find((s) => s.key === 'snapchat-android-friends');
    const chat = list.find((s) => s.key === 'snapchat-android-arroyo');
    assert.strictEqual(names.namesOnly, true);
    assert.strictEqual(chat.roles.messages.textFrom, 'snapchat');
    const map = core.names(names, { columns: ['userId', 'display_name', 'username'], values: [['74D7B649-DB5A-41C1-B3D2-0F8EE62276DF', 'Kim K', 'kimk'], ['x', '', '']] });
    assert.deepStrictEqual(Object.keys(map), ['74d7b649db5a41c1b3d20f8ee62276df']);
    const threads = [{ key: 'c1', name: 'c1' }];
    const people = { c1: [{ id: '74d7b649-db5a-41c1-b3d2-0f8ee62276df', name: '74d7b649-db5a-41c1-b3d2-0f8ee62276df' }] };
    core.applyNames(chat, threads, people, map);
    assert.strictEqual(people.c1[0].name, 'Kim K (@kimk)');
    assert.strictEqual(threads[0].name, 'Kim K (@kimk)');
    const msg = { columns: ['message_id', 'thread_id', 'from_me', 'sender_text', 'text_placeholder', 'message_content', 'kind', 'kind_label', 'creation_timestamp', 'read_timestamp'],
        values: [[1, 'c1', 0, '74d7b649-db5a-41c1-b3d2-0f8ee62276df', null, content, 'text', null, 1790000000000, 0]] };
    const model = core.conversation(chat, Object.assign({ kind: 'person' }, threads[0]), msg, null, people.c1, 'd/arroyo.db', { names: map });
    assert.strictEqual(model.messages[0].text, 'Hej på dig');
    assert.strictEqual(model.messages[0].senderName, 'Kim K (@kimk)');
    assert.strictEqual(model.messages[0].times[1].ms, null, 'read_timestamp 0 är ingen tid');
});

test('en chatt med 300 000 meddelanden byggs utan att anropsstacken tar slut', () => {
    const [src] = core.sources([whatsapp]);
    const n = 300000;
    const values = new Array(n);
    for (let i = 0; i < n; i++) values[i] = [i + 1, 1, i % 2, null, null, 'x', 'text', 'text', 0, 0, null, null, 800000000 + i, 0, null, null];
    const cols = ['message_id', 'chat_id', 'ZISFROMME', 'sender_jid', 'sender_name', 'ZTEXT', 'kind', 'kind_label', 'ZMESSAGETYPE', 'view_once', 'ZMESSAGESTATUS', 'ZSTARRED', 'ZMESSAGEDATE', 'ZSENTDATE', 'ZSTANZAID', 'ZGROUPEVENTTYPE'];
    const model = core.conversation(src, { id: 1, key: '1', name: 'Stor', kind: 'person' }, { columns: cols, values }, null, [], 'g/ChatStorage.sqlite');
    assert.strictEqual(model.messages.length, n);
    assert.strictEqual(model.firstMs, (800000000 + 978307200) * 1000);
    assert.strictEqual(model.lastMs, (800000000 + n - 1 + 978307200) * 1000);
    // Raden sparas inte en gång till: tiderna har sina råa värden, och det räcker för klockan och exporten.
    assert.ok(!('raw' in model.messages[0]) && !('_raw' in model.messages[0]));
});

test('stora chattar: rollen läses i omgångar med en paus emellan och ger samma rader som exec', async () => {
    const db = await fixture();
    try {
        const [src] = core.sources([whatsapp]);
        const sql = roles.fill(src.roles.messages.sql, { threadId: 3 });
        const whole = db.exec(sql)[0];
        const sliced = await core.readRows(db, sql, { sliceMs: 0, onSlice: () => Promise.resolve() });
        assert.deepStrictEqual(sliced, { columns: whole.columns, values: whole.values });
        const att = roles.fill(src.roles.attachments.sql, { threadId: 3 });
        const model = core.conversation(src, { id: 3, key: '3', name: 'Kim', kind: 'person' }, sliced, await core.readRows(db, att), [], DB_PATH);
        assert.deepStrictEqual(model.messages.map((m) => m.id), [1, 2, 3, 4]);
        assert.ok(model.messages[1].attachments.length === 1 && !('raw' in model.messages[1].attachments[0]));
        // En fråga utan rader har ändå kolumnerna.
        assert.deepStrictEqual(await core.readRows(db, roles.fill(src.roles.messages.sql, { threadId: 99 })), { columns: whole.columns, values: [] });
    } finally {
        db.close();
    }
});

test('stora chattar: 1 000 rader ger en paus var 128:e rad, och ett avbrott släpper satsen', async () => {
    const S = await sqlJs();
    const db = new S.Database();
    try {
        db.run('CREATE TABLE t (a INTEGER, b TEXT)');
        db.run('BEGIN');
        for (let i = 0; i < 1000; i++) db.run('INSERT INTO t VALUES (?, ?)', [i, 'rad ' + i]);
        db.run('COMMIT');
        const seen = [];
        const all = await core.readRows(db, 'SELECT a, b FROM t ORDER BY a;', { sliceMs: 0, onSlice: (n) => { seen.push(n); return Promise.resolve(); } });
        assert.strictEqual(all.values.length, 1000);
        assert.deepStrictEqual(all.values[999], [999, 'rad 999']);
        assert.deepStrictEqual(seen, [128, 256, 384, 512, 640, 768, 896]);
        // Avbrutet efter 256 rader: felet kommer fram, och satsen är släppt (annars är tabellen låst för DROP).
        await assert.rejects(core.readRows(db, 'SELECT a FROM t', { sliceMs: 0, onSlice: (n) => { if (n >= 256) throw Object.assign(new Error('Avbrutet.'), { cancelled: true }); } }), (e) => e.cancelled === true);
        db.run('DROP TABLE t');
        // Utan onSlice läses allt på en gång.
        db.run('CREATE TABLE u (x)');
        assert.deepStrictEqual(await core.readRows(db, 'SELECT x FROM u'), { columns: ['x'], values: [] });
    } finally {
        db.close();
    }
});

test('sök i konversationen: text, bildtext, filnamn och kontaktkort, utan skillnad på stora och små bokstäver', () => {
    const msgs = [
        { text: 'Ses vid HAMNEN', attachments: [] },
        { text: '', attachments: [{ title: 'Utsikt från hamnen', name: 'IMG_0001.JPG', cardName: '' }] },
        { text: 'Inget här', attachments: [{ title: '', name: '', cardName: 'Kim Kontakt' }] },
        { text: 'Åka till Älvsjö', attachments: [] },
    ];
    const index = core.searchIndex(msgs);
    assert.deepStrictEqual(core.findAll(index, 'hamnen'), [0, 1]);
    assert.deepStrictEqual(core.findAll(index, 'img_0001'), [1]);
    assert.deepStrictEqual(core.findAll(index, 'kontakt'), [2]);
    assert.deepStrictEqual(core.findAll(index, 'älvsjö'), [3]);
    assert.deepStrictEqual(core.findAll(index, '   '), []);
    assert.deepStrictEqual(core.findAll(index, 'finns inte'), []);
    // Träffarna märks i texten som den står.
    assert.deepStrictEqual(core.marks('Hamnen och hamnen', 'HAMN'), [{ text: 'Hamn', hit: true }, { text: 'en och ', hit: false }, { text: 'hamn', hit: true }, { text: 'en', hit: false }]);
    assert.deepStrictEqual(core.marks('Inget', 'x'), [{ text: 'Inget', hit: false }]);
    assert.deepStrictEqual(core.marks('', 'x'), [{ text: '', hit: false }]);
    assert.deepStrictEqual(core.marks('Text', ''), [{ text: 'Text', hit: false }]);
    // Ett tecken som blir två med små bokstäver: platserna går inte att lita på, så inget märks.
    assert.deepStrictEqual(core.marks('İstanbul', 'stan'), [{ text: 'İstanbul', hit: false }]);
});

test('gå till datum: det tidigaste meddelandet från tiden och framåt, också när ordningen inte följer tiden', () => {
    const msgs = [{ sortMs: null }, { sortMs: 100 }, { sortMs: 300 }, { sortMs: 200 }, { sortMs: 300 }];
    assert.strictEqual(core.atOrAfter(msgs, 0), 1);
    assert.strictEqual(core.atOrAfter(msgs, 150), 3);
    assert.strictEqual(core.atOrAfter(msgs, 300), 2);
    assert.strictEqual(core.atOrAfter(msgs, 301), -1);
    assert.strictEqual(core.atOrAfter([], 0), -1);
});

test('export i delar: samma fil som i ett stycke, med förlopp per block och numreringen i hela urvalet', async () => {
    const { model } = await load(3);
    const entry = model.messages[1].attachments[0].entry;
    const opts = { model, messages: model.messages, zone: 'Europe/Stockholm', selection: 'Hela konversationen', meta: { extraction: 'lab.zip', dbPath: DB_PATH, exportedMs: 0 }, media: { [entry]: { dataUrl: 'data:image/jpeg;base64,AAAA' } } };
    assert.strictEqual((await exp.parts(opts)).join(''), exp.html(opts));
    // 2 500 meddelanden: tre block bubblor och tre block spårbarhet.
    const many = [];
    for (let i = 0; i < 2500; i++) many.push(Object.assign({}, model.messages[0], { id: i + 1, key: String(i + 1), sortMs: Date.parse('2026-10-24T20:00:00Z') + i * 3600000 }));
    const big = Object.assign({}, opts, { messages: many, media: {} });
    const steps = [];
    const parts = await exp.parts(big, (stage, done, total) => { steps.push(stage + ' ' + done + '/' + total); return Promise.resolve(); });
    assert.deepStrictEqual(steps, ['messages 1000/2500', 'messages 2000/2500', 'messages 2500/2500', 'trace 1000/2500', 'trace 2000/2500', 'trace 2500/2500']);
    const text = parts.join('');
    assert.strictEqual(text, exp.html(big));
    assert.ok(text.includes('<tr><td>1001</td><td>1001</td>') && text.includes('<tr><td>2500</td><td>2500</td>'));
    // Datumet skrivs en gång per dag, också över gränsen mellan två block.
    assert.strictEqual((text.match(/<div class="day">/g) || []).length, new Set(many.map((m) => core.formatter('Europe/Stockholm')(m.sortMs).slice(0, 10))).size);
    // Ett avbrott i ett block stoppar bygget.
    await assert.rejects(exp.parts(big, (stage, done) => { if (done >= 2000) throw new Error('Avbrutet.'); }), /Avbrutet/);
});

test('exportens uppskattning: följer utskrifterna den kalibrerades mot, och växer med text, tider och bilder', () => {
    const words = 'hej då kanske imorgon middag klockan sju tåget är sent jag ringer sen okej bra tack ses vi där'.split(' ');
    // Samma påhittade meddelanden som i kalibreringen: 600 korta med två tider blev 83 sidor och 297 kB, 400 långa
    // 80 sidor, och 600 korta med fyra tider 103 sidor.
    const msgs = (n, len, times) => Array.from({ length: n }, (_, i) => ({ text: Array.from({ length: len(i) }, (_, k) => words[(i + k * 3) % words.length]).join(' '), attachments: [], times: new Array(times).fill({}) }));
    const near = (got, want, why) => assert.ok(Math.abs(got - want) / want <= 0.1, why + ': ' + got + ', utskriften ' + want);
    const short = exp.estimate(msgs(600, (i) => 3 + (i * 7) % 25, 2), 0, 0);
    near(short.pages, 83, 'korta');
    near(short.bytes, 297111, 'korta, byte');
    near(exp.estimate(msgs(400, (i) => 40 + (i % 60), 2), 0, 0).pages, 80, 'långa');
    near(exp.estimate(msgs(600, (i) => 3 + (i * 7) % 25, 4), 0, 0).pages, 103, 'fyra tider');
    assert.strictEqual(exp.estimate([{ text: 'hej', attachments: [] }], 0, 0).pages, 1);
    const hundred = exp.estimate(msgs(100, () => 3, 2), 0, 0);
    const images = exp.estimate(msgs(100, () => 3, 2), 10, 30 * 1048576);
    assert.strictEqual(images.bytes, hundred.bytes + 40 * 1048576, 'bilderna blir base64 i filen, en tredjedel större');
    const more = images.pages - hundred.pages;
    assert.ok(more >= 4 && more <= 5, 'tio bilder är 4–5 sidor till: ' + more);
});
