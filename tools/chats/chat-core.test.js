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
    assert.ok(more >= 5 && more <= 6, 'tio bilder är 5–6 sidor till: ' + more);
    // Stående bilder i full storlek i vart tredje meddelande: 106 sidor i utskriften.
    const pictures = msgs(300, (i) => (i % 3 === 0 ? 0 : 3 + (i * 7) % 25), 2);
    const est = exp.estimate(pictures, 100, 0).pages;
    assert.ok(Math.abs(est - 106) / 106 <= 0.15, 'stående bilder: ' + est + ', utskriften 106');
    assert.deepStrictEqual(exp.estimate(pictures, 100, 0, 'list'), exp.estimate(pictures, 100, 0), 'listan är utseendet när inget annat sägs');
});

test('exportens uppskattning för telefonvyn: två smala remsor på sidan ger färre sidor, och filen är stilmallen större', () => {
    const words = 'hej då kanske imorgon middag klockan sju tåget är sent jag ringer sen okej bra tack ses vi där'.split(' ');
    const msgs = (n, len, times) => Array.from({ length: n }, (_, i) => ({ text: Array.from({ length: len(i) }, (_, k) => words[(i + k * 3) % words.length]).join(' '), attachments: [], times: new Array(times).fill({}) }));
    const near = (got, want, why, slack) => assert.ok(Math.abs(got - want) / want <= (slack || 0.1), why + ': ' + got + ', utskriften ' + want);
    // Samma meddelanden som för listan, utskrivna i telefonvyn: 63, 68 och 82 sidor, och 306 kB för de korta.
    const short = msgs(600, (i) => 3 + (i * 7) % 25, 2);
    const phone = exp.estimate(short, 0, 0, 'phone'), list = exp.estimate(short, 0, 0);
    near(phone.pages, 63, 'korta');
    near(phone.bytes, 306049, 'korta, byte');
    assert.strictEqual(phone.bytes, list.bytes + 6500 + 4 * 600, 'stilmallen och numret vid varje bubbla');
    assert.ok(phone.pages < list.pages, 'färre sidor än listan: ' + phone.pages + ' mot ' + list.pages);
    near(exp.estimate(msgs(400, (i) => 40 + (i % 60), 2), 0, 0, 'phone').pages, 68, 'långa');
    near(exp.estimate(msgs(600, (i) => 3 + (i * 7) % 25, 4), 0, 0, 'phone').pages, 82, 'fyra tider');
    // Bilderna är smala i ramen: stående bilder i vart tredje meddelande blev 44 sidor, mot 106 i listan.
    const pictures = msgs(300, (i) => (i % 3 === 0 ? 0 : 3 + (i * 7) % 25), 2);
    near(exp.estimate(pictures, 100, 0, 'phone').pages, 44, 'stående bilder', 0.15);
    assert.strictEqual(exp.estimate(pictures, 16, 0, 'phone').pages - exp.estimate(pictures, 0, 0, 'phone').pages, 2, 'åtta bilder på en sida');
    assert.strictEqual(exp.estimate([{ text: 'hej', attachments: [] }], 0, 0, 'phone').pages, 1);
});

// ---------- Telefonvyn i exporten ----------

const PHONE_FOOT = '<div class="phone-foot"><span>Rekonstruktion ur databasen – inte en skärmbild</span></div>';

test('export som telefon: ramen, märkningen som rekonstruktion, klockslaget i bubblan och numret som leder till spårbarheten', async () => {
    const { model } = await load(3);
    const list = core.pick(model.messages, { ids: ['1', '2', '4'] });
    const entry = list[1].attachments[0].entry;
    const opts = {
        model, messages: list, zone: 'Europe/Stockholm', selection: '3 valda meddelanden',
        meta: { extraction: 'lab.zip (100 byte)', dbPath: DB_PATH, version: '1.56', exportedMs: Date.parse('2026-11-10T10:00:00Z') },
        media: { [entry]: { dataUrl: 'data:image/jpeg;base64,AAAA' } },
    };
    const plain = exp.html(opts), out = exp.html(Object.assign({ look: 'phone' }, opts));
    assert.ok(!out.includes(XSS), 'ingen oescapad HTML ur databasen');
    // Ramen följer plattformen, och i huvudet står bara det databasen har: namnet och adressen.
    assert.ok(out.includes('<div class="strip"><div class="phone ios" data-app="WhatsApp"><div class="phone-head"><span class="avatar">K</span>' +
        '<span class="phone-names"><b>Kim &lt;img src=x onerror=&quot;window.__x=1&quot;&gt;</b><small>111@lid</small></span></div><div class="phone-body">'));
    // Märkningen står på tre ställen: i inledningen, i tabellen överst och i ramens fot.
    assert.ok(out.includes('uppställt som i en telefon. Det är en rekonstruktion och ingen skärmbild'));
    assert.ok(out.includes('Telefonens textstorlek, tema och appversion är inte kända'));
    assert.ok(out.includes('<tr><th>Utseende</th><td>Telefon: en rekonstruktion ur databasen, ingen skärmbild</td></tr>'));
    assert.ok(out.includes(PHONE_FOOT + '</div></div><h2>Spårbarhet</h2>'), 'foten stänger ramen före spårbarheten');
    assert.strictEqual(out.split('<div class="strip">').length, 2, 'en ram');
    // Bubblan har klockslaget, utan sekunder och id, och numret utanför är raden i spårbarheten.
    assert.ok(out.includes('<div class="meta-line">22:00</div></div><span class="no">#1</span></div>'));
    assert.ok(!/class="meta-line">[^<]* · id /.test(out), 'inget id i bubblan');
    assert.deepStrictEqual(out.match(/<span class="no">#\d+<\/span>/g), ['<span class="no">#1</span>', '<span class="no">#2</span>', '<span class="no">#3</span>']);
    assert.ok(out.includes('<tr><td>3</td><td>4</td><td>skickat</td>'), 'rad 3 är meddelandet med id 4');
    assert.ok(out.includes('<img src="data:image/jpeg;base64,AAAA"'));
    assert.ok(out.includes('Kontaktkort: Kim Kontakt'));
    // Spårbarheten är densamma som i listan, och listan har ingenting av telefonvyn.
    const trace = (text) => text.slice(text.indexOf('<h2>Spårbarhet</h2>'));
    assert.strictEqual(trace(out), trace(plain));
    assert.ok(plain.includes('<div class="meta-line">2026-10-24 22:00:00 · id 1</div></div></div>'));
    assert.ok(!/phone|Utseende|class="no"|class="strip"/.test(plain), 'listan har varken ram, nummer eller stilmallen för dem');
    assert.strictEqual(exp.html(Object.assign({ look: 'list' }, opts)), plain);
});

test('export som telefon: ramen för Android och för en okänd plattform, gruppens huvud och ett tomt urval utan ram', async () => {
    const { model } = await load(3);
    const group = (await load(4)).model;
    const as = (m, platform) => Object.assign({}, m, { source: Object.assign({}, m.source, { platform }) });
    const html = (m, messages) => exp.html({ model: m, messages: messages || m.messages, zone: 'UTC', selection: 'Hela konversationen', meta: {}, look: 'phone' });
    assert.deepStrictEqual(exp.phone(model), { frame: 'ios', initial: 'K', name: 'Kim ' + XSS, sub: '111@lid', label: 'Rekonstruktion ur databasen – inte en skärmbild' });
    assert.strictEqual(exp.phone(as(model, 'Android')).frame, 'android');
    assert.strictEqual(exp.phone(as(model, '')).frame, 'plain');
    assert.ok(html(as(model, 'Android')).includes('<div class="phone android" data-app="WhatsApp">'));
    assert.ok(html(as(model, '')).includes('<div class="phone plain" data-app="WhatsApp">'));
    // En grupp: slaget och antalet deltagare, med den här telefonen räknad.
    assert.deepStrictEqual([exp.phone(group).initial, exp.phone(group).sub], ['K', 'Grupp · 3 deltagare']);
    const out = html(group);
    assert.ok(out.includes('<b>Klubben</b><small>Grupp · 3 deltagare</small>'));
    assert.ok(out.includes('<div class="who">Lo</div>'));
    // Ett nummer som namn får # i ringen, och adressen skrivs inte två gånger.
    const number = { thread: { name: '+46700000005', address: '+46700000005', kindText: 'Enskild chatt' }, source: { platform: 'iOS' }, group: false, members: [] };
    assert.deepStrictEqual([exp.phone(number).initial, exp.phone(number).sub], ['#', 'Enskild chatt']);
    assert.strictEqual(exp.phone(Object.assign({}, number, { thread: { name: '', kindText: 'Enskild chatt' } })).initial, '?');
    assert.strictEqual(exp.phone(Object.assign({}, number, { thread: { name: 'åsa', kindText: 'Enskild chatt' } })).initial, 'Å');
    // Utan meddelanden i urvalet ritas ingen ram.
    const empty = html(model, []);
    assert.ok(empty.includes('<p class="small">Inga meddelanden i urvalet.</p><h2>Spårbarhet</h2>'));
    assert.ok(!empty.includes('<div class="strip">') && !empty.includes('<div class="phone-foot">'));
});

test('export som telefon: ett samtal eller en systemrad från telefonen står i mitten, och i listan som förut', async () => {
    const { model } = await load(3);
    const call = Object.assign({}, model.messages[0], { kind: 'call', kindLabel: 'Samtal', text: 'Röstsamtal, 2:05', attachments: [] });
    const opts = { model, messages: [call, model.messages[0]], zone: 'UTC', selection: '2 valda meddelanden', meta: {} };
    const phone = exp.html(Object.assign({ look: 'phone' }, opts)), plain = exp.html(opts);
    assert.ok(phone.includes('<div class="msg sys"><div class="bubble"><div class="txt">Röstsamtal, 2:05</div>'));
    assert.ok(phone.includes('<div class="msg me"><div class="bubble"><div class="txt">Hej '), 'ett vanligt meddelande från telefonen står till höger');
    assert.ok(plain.includes('<div class="msg me sys"><div class="bubble"><div class="txt">Röstsamtal, 2:05</div>'));
});

test('export som telefon i delar: samma fil som i ett stycke, en ram runt alla block och numren i hela urvalet', async () => {
    const { model } = await load(3);
    const many = [];
    for (let i = 0; i < 2500; i++) many.push(Object.assign({}, model.messages[0], { id: 5000 + i, key: String(5000 + i), sortMs: Date.parse('2026-10-24T20:00:00Z') + i * 3600000 }));
    const big = { model, messages: many, zone: 'Europe/Stockholm', selection: 'Hela konversationen', meta: { extraction: 'lab.zip', dbPath: DB_PATH, exportedMs: 0 }, media: {}, look: 'phone' };
    const steps = [];
    const text = (await exp.parts(big, (stage, done, total) => { steps.push(stage + ' ' + done + '/' + total); })).join('');
    assert.strictEqual(text, exp.html(big));
    assert.deepStrictEqual(steps, ['messages 1000/2500', 'messages 2000/2500', 'messages 2500/2500', 'trace 1000/2500', 'trace 2000/2500', 'trace 2500/2500']);
    assert.strictEqual(text.split('<div class="strip">').length, 2, 'en ram, inte en per block');
    assert.strictEqual(text.split(PHONE_FOOT).length, 2);
    assert.strictEqual((text.match(/<span class="no">#\d+<\/span>/g) || []).length, 2500);
    assert.ok(text.includes('<span class="no">#1001</span>') && text.includes('<tr><td>1001</td><td>6000</td>'), 'numret 1001 är raden 1001, med id 6000');
    assert.ok(text.includes('<span class="no">#2500</span>') && text.includes('<tr><td>2500</td><td>7499</td>'));
});

// ---------- Listan med konversationer ----------

// Två appar i tre databaser, som listan får dem: Signal med fem trådar, WhatsApp med två, och en Telegram som inte är läst.
const ACI = { kim: 'a1b2c3d4-0000-4000-8000-0000000000ed', mo: '5e6f7a8b-1111-4111-8111-111111111111', lo: '9c0d1e2f-2222-4222-8222-222222222222' };
function listFixture() {
    const t = (key, name, kind, messages, lastMs, address) => ({ id: key, key: String(key), name, kind, kindText: core.THREAD_KIND[kind], address: address || '', messages, firstMs: lastMs, lastMs });
    const signal = [
        t(1, 'Kim Karlsson', 'person', 12, 9000, '+46701234567'),
        t(2, 'Klubben', 'group', 340, 8000),
        t(3, 'Styrelsen', 'group', 0, null),
        t(4, 'Lo', 'person', 3, 7000, ACI.lo),
        t(5, 'Anteckningar', 'self', 1, 7000),
    ];
    const signalPeople = {
        2: [{ id: ACI.kim, name: 'Kim Karlsson', address: '+46701234567' }, { id: ACI.mo, name: 'Mo Månsson', address: '+46 70 999 88 77' }],
        3: [{ id: ACI.mo, name: 'Mo Månsson', address: '+46 70 999 88 77' }],
    };
    const whatsapp = [t(10, 'Kimmen', 'person', 2, 9500, '46701234567@s.whatsapp.net'), t(11, 'Ärtan', 'group', 0, null, '120363041234567890@g.us')];
    return [
        { app: 'Signal', threads: signal, index: core.listIndex(signal, signalPeople) },
        { app: 'WhatsApp', threads: whatsapp, index: core.listIndex(whatsapp, { 11: [{ id: '199912345678901@lid', name: 'Lo', address: '199912345678901@lid' }] }) },
        { app: 'Telegram', threads: null, index: null },
    ];
}
const namesIn = (view) => view.groups.map((g) => g.items.map((i) => i.thread.name));
const counts = (list, key) => Object.fromEntries(list.map((x) => [x[key], x.count]));

test('listan: utan val står allt i databasens ordning, med antal för varje app och slag', () => {
    const view = core.listView(listFixture(), {});
    assert.deepStrictEqual(namesIn(view), [['Kim Karlsson', 'Klubben', 'Lo', 'Anteckningar', 'Styrelsen'], ['Kimmen', 'Ärtan'], []]);
    assert.deepStrictEqual(view.groups.map((g) => [g.visible, g.total]), [[true, 5], [true, 2], [true, null]]);
    // Telegram är inte läst än: appen finns att välja, men utan antal.
    assert.deepStrictEqual(counts(view.apps, 'app'), { Signal: 5, WhatsApp: 2, Telegram: null });
    assert.deepStrictEqual(view.kinds, [{ kind: 'person', text: 'Enskilda', count: 3 }, { kind: 'group', text: 'Grupper', count: 3 }, { kind: 'self', text: 'Till mig själv', count: 1 }]);
    assert.deepStrictEqual([view.total, view.shown, view.empty, view.filtered], [7, 7, 2, false]);
    assert.deepStrictEqual(core.listView([], {}), { groups: [], apps: [], empty: 0, total: 0, shown: 0, kinds: [], filtered: false });
});

test('listan: sök på namn, på nummer hur det än skrivs och på deltagare, och alla ord ska finnas', () => {
    const find = (query) => core.listView(listFixture(), { query });
    // Utan skillnad på stora och små bokstäver. Klubben heter inte Kim, men har Kim som deltagare.
    assert.deepStrictEqual(find('KIM').groups.map((g) => g.items.map((i) => [i.thread.name, i.who])), [[['Kim Karlsson', []], ['Klubben', ['Kim Karlsson']]], [['Kimmen', []]], []]);
    // Numret står som +46701234567 i Signal och som 46701234567@s.whatsapp.net i WhatsApp. Klubben har det hos en deltagare.
    for (const typed of ['070-123 45 67', '0701234567', '+46 70 123 45 67', '0046701234567', '46701234567', '123 45 67']) {
        assert.deepStrictEqual(namesIn(find(typed)), [['Kim Karlsson', 'Klubben'], ['Kimmen'], []], typed);
    }
    const viaMember = find('070 999 88 77').groups[0].items;
    assert.deepStrictEqual(viaMember.map((i) => [i.thread.name, i.who]), [['Klubben', ['Mo Månsson']], ['Styrelsen', ['Mo Månsson']]], 'deltagaren som gav träffen följer med');
    // Båda orden ska finnas: Kim och Mo är med i Klubben, och Kim Karlssons egen chatt har ingen Mo.
    assert.deepStrictEqual(find('kim mo').groups[0].items.map((i) => [i.thread.name, i.who]), [['Klubben', ['Kim Karlsson', 'Mo Månsson']]]);
    // Ett id hittas helt eller från sin början, med minst åtta tecken. Ord söks inte i det: två tecken ur ett UUID
    // finns i de flesta, och domänen i ett JID står i varje rad.
    assert.deepStrictEqual(namesIn(find(ACI.lo)), [['Lo'], [], []], 'hela id:t');
    assert.deepStrictEqual(namesIn(find(ACI.lo.slice(0, 8).toUpperCase())), [['Lo'], [], []], 'början av det');
    assert.deepStrictEqual(find(ACI.kim).groups[0].items.map((i) => [i.thread.name, i.who]), [['Klubben', ['Kim Karlsson']]], 'deltagarens id');
    for (const piece of ['ed', 'a1b2', '0000-4000', 'whatsapp', 'net', 'g.us', 'lid']) assert.deepStrictEqual(namesIn(find(piece)), [[], [], []], piece);
    assert.deepStrictEqual(namesIn(find('46701234567@s.whatsapp.net')), [[], ['Kimmen'], []]);
    assert.deepStrictEqual(namesIn(find('120363041234567890@g.us')), [[], ['Ärtan'], []]);
    assert.deepStrictEqual(namesIn(find('12036304')), [[], ['Ärtan'], []]);
    // Siffrorna i en grupps id eller ett lid är inget telefonnummer.
    assert.deepStrictEqual(namesIn(find('1234567890')), [[], [], []]);
    assert.deepStrictEqual([find('finns inte').shown, find('finns inte').total, find('finns inte').filtered], [0, 7, true]);
    assert.deepStrictEqual(namesIn(find('   ')), namesIn(find('')), 'bara mellanrum är ingen sökning');
    // Siffrorna som står intill varandra är ett nummer, och två hela nummer är två.
    assert.deepStrictEqual(core.searchTerms('Kim 070-123 45 67  Lo'), [{ text: 'kim', digits: '', typed: '' }, { text: '070-123 45 67', digits: '701234567', typed: '0701234567' }, { text: 'lo', digits: '', typed: '' }]);
    assert.deepStrictEqual(core.searchTerms('0701234567 0709998877'), [{ text: '0701234567', digits: '701234567', typed: '0701234567' }, { text: '0709998877', digits: '709998877', typed: '0709998877' }]);
    assert.deepStrictEqual(namesIn(find('0701234567 0709998877')), [['Klubben'], [], []], 'gruppen där båda numren är med');
    // Hela numret ska finnas hos samma deltagare: bitar hos var sin räcker inte.
    assert.deepStrictEqual(namesIn(find('070 123 88 77')), [[], [], []]);
    // Medan numret skrivs: nollan först hindrar inte träffen.
    for (const typed of ['07', '070', '070 1', '070-12', '070 123 4']) assert.ok(namesIn(find(typed))[0].includes('Kim Karlsson'), typed);
    // Färre än fyra siffror hittas i början av ett nummer, inte mitt i det: annars träffar 45 vart tionde nummer.
    assert.deepStrictEqual(namesIn(find('4567')), [['Kim Karlsson', 'Klubben'], ['Kimmen'], []]);
    for (const typed of ['45', '567', '234']) assert.deepStrictEqual(namesIn(find(typed)), [[], [], []], typed);
    assert.deepStrictEqual(namesIn(find('+46')), [['Kim Karlsson', 'Klubben', 'Styrelsen'], ['Kimmen'], []]);
    // Namnet i listan söks som det står, också när det är ett nummer. En deltagares nummer söks som nummer, och
    // dess radnummer i databasen inte alls.
    const rows = [
        { key: '1', name: '+46700000125', kind: 'person', address: '+46700000125', messages: 1, lastMs: 3 },
        { key: '2', name: 'Grupp 12', kind: 'group', address: '', messages: 1, lastMs: 2 },
        { key: '3', name: 'Padel', kind: 'group', address: '', messages: 1, lastMs: 1 },
    ];
    const rowList = [{ app: 'Signal', threads: rows, index: core.listIndex(rows, { 3: [{ id: '17', name: '+46700000125', address: '+46700000125' }] }) }];
    const inRows = (query) => namesIn(core.listView(rowList, { query }))[0];
    assert.deepStrictEqual(inRows('125'), ['+46700000125']);
    assert.deepStrictEqual(inRows('12'), ['+46700000125', 'Grupp 12']);
    assert.deepStrictEqual(inRows('0125'), ['+46700000125', 'Padel']);
    assert.deepStrictEqual(inRows('070'), ['+46700000125', 'Padel']);
    assert.deepStrictEqual(inRows('17'), []);
    // Bara nollor är inget riktnummer: två finns i namnet som står i listan, fyra också mitt i deltagarens nummer.
    assert.deepStrictEqual([inRows('00'), inRows('0000')], [['+46700000125'], ['+46700000125', 'Padel']]);
    // Telegram: användarnamn och Telegram-id står i adressen, med text före.
    const tg = [
        { key: '1', name: 'Hemliga', kind: 'person', address: 'hemlig chatt, @kalle99', messages: 1, lastMs: 3 },
        { key: '2', name: 'användare 55512345', kind: 'person', address: 'Telegram-id 55512345', messages: 1, lastMs: 2 },
        { key: '3', name: 'Kanalen', kind: 'channel', address: '', messages: 1, lastMs: 1 },
    ];
    const tgPeople = { 3: [{ id: '8589934593', name: 'Telegram-id 99887766', address: '99887766' }, { id: '8589934594', name: '8589934594', address: '@anna_andersson_1985_stockholm' }] };
    const tgList = [{ app: 'Telegram', threads: tg, index: core.listIndex(tg, tgPeople) }];
    const inTg = (query) => namesIn(core.listView(tgList, { query }))[0];
    assert.deepStrictEqual([inTg('kalle'), inTg('@kalle99'), inTg('55512345'), inTg('99887766'), inTg('8877'), inTg('8589')], [['Hemliga'], ['Hemliga'], ['användare 55512345'], ['Kanalen'], ['Kanalen'], []]);
    // Ett långt användarnamn är en text, hur många siffror det än har i sig, och hela id:t hittar sin deltagare.
    assert.deepStrictEqual([inTg('andersson'), inTg('8589934594')], [['Kanalen'], ['Kanalen']]);
    // Ett namn med @ i är en text som alla andra: det är bara efter siffror som @ inleder en domän.
    const mail = [
        { key: '1', name: 'anna@firma.se', kind: 'person', address: '46700000001@s.whatsapp.net', messages: 1, lastMs: 2 },
        { key: '2', name: 'status@broadcast', kind: 'status', address: 'status@broadcast', messages: 1, lastMs: 1 },
    ];
    const inMail = (query) => namesIn(core.listView([{ app: 'WhatsApp', threads: mail, index: core.listIndex(mail, {}) }], { query }))[0];
    assert.deepStrictEqual([inMail('firma'), inMail('status'), inMail('whatsapp')], [['anna@firma.se'], ['status@broadcast'], []]);
    // Vad som går att söka på: namnet som det står, numren som siffror och id:n från sin början. Årtalet i ett namn
    // och siffrorna i ett ACI är inga nummer, och samma deltagare i två konversationer är en post.
    assert.deepStrictEqual(core.listIndex([{ key: '1', name: 'Lag 2012', address: '1b2c3d4e-0000-4000-8000-123456789012' }], {})[0].own,
        { texts: ['lag 2012'], nums: [], ids: ['1b2c3d4e-0000-4000-8000-123456789012'] });
    assert.deepStrictEqual(core.listIndex([{ key: '1', name: 'Kim', address: '46701234567@s.whatsapp.net' }], { 1: [{ id: '17', name: '+46 70-999 88 77', address: '@mo99' }] })[0],
        { own: { texts: ['kim'], nums: ['46701234567'], ids: ['46701234567@s.whatsapp.net'] }, who: [{ name: '+46 70-999 88 77', texts: ['@mo99'], nums: ['46709998877'], ids: ['+46 70-999 88 77', '17'] }] });
    const shared = listFixture()[0].index;
    assert.strictEqual(shared[1].who[1], shared[2].who[0]);
    // WhatsApp skriver ett okänt nummer som namn med riktningstecken runt, hårda mellanrum och ett hårt streck.
    const odd = [{ key: '1', name: '\u202a+46\u00a070\u2011123\u00a045\u00a067\u202c', kind: 'person', address: '', messages: 1, lastMs: 1 }];
    const oddList = [{ app: 'WhatsApp', threads: odd, index: core.listIndex(odd, {}) }];
    for (const typed of ['0701234567', '+46 70-123 45 67', '\u202a+46\u00a070\u2011123\u00a045\u00a067\u202c', '70-123']) assert.strictEqual(core.listView(oddList, { query: typed }).shown, 1, JSON.stringify(typed));
});

test('listan: app, slag och Dölj tomma, och talet vid varje val är vad valet skulle visa', () => {
    const pick = (opts) => core.listView(listFixture(), opts);
    const groups = pick({ kind: 'group' });
    assert.deepStrictEqual(namesIn(groups), [['Klubben', 'Styrelsen'], ['Ärtan'], []]);
    assert.deepStrictEqual(counts(groups.apps, 'app'), { Signal: 2, WhatsApp: 1, Telegram: null }, 'apparna räknar bara grupperna');
    assert.deepStrictEqual(counts(groups.kinds, 'kind'), { person: 3, group: 3, self: 1 }, 'slagen räknas som om ett annat slag valdes');
    assert.deepStrictEqual([groups.shown, groups.empty, groups.filtered], [3, 2, true]);

    const wa = pick({ app: 'WhatsApp' });
    assert.deepStrictEqual(wa.groups.map((g) => g.visible), [false, true, false]);
    assert.deepStrictEqual([wa.shown, wa.empty], [2, 1]);
    assert.deepStrictEqual(counts(wa.kinds, 'kind'), { person: 1, group: 1, self: 0 }, 'ett slag som bara finns i en annan app står kvar med noll');
    assert.deepStrictEqual(counts(wa.apps, 'app'), { Signal: 5, WhatsApp: 2, Telegram: null });

    const full = pick({ hideEmpty: true });
    assert.deepStrictEqual(namesIn(full), [['Kim Karlsson', 'Klubben', 'Lo', 'Anteckningar'], ['Kimmen'], []]);
    assert.deepStrictEqual([full.shown, full.empty, full.total], [5, 2, 7], 'empty är vad Dölj tomma tar bort, också när den är vald');
    assert.deepStrictEqual(counts(full.kinds, 'kind'), { person: 3, group: 1, self: 1 });

    const all = pick({ app: 'Signal', kind: 'group', hideEmpty: true, query: 'mo' });
    assert.deepStrictEqual(namesIn(all), [['Klubben'], [], []]);
    assert.deepStrictEqual([all.shown, all.empty], [1, 1]);
    // En konversation utan känt antal är inte tom.
    const unknown = [{ app: 'Telegram', threads: [{ key: '1', name: 'Okänt antal', kind: 'person', address: '', messages: null, lastMs: null }] }];
    unknown[0].index = core.listIndex(unknown[0].threads, {});
    assert.deepStrictEqual([core.listView(unknown, { hideEmpty: true }).shown, core.listView(unknown, {}).empty], [1, 0]);
});

test('listan: senaste först, flest meddelanden eller namn i svensk ordning, och lika står kvar i databasens ordning', () => {
    const order = (sort) => namesIn(core.listView(listFixture(), { sort }))[0];
    assert.deepStrictEqual(order('recent'), ['Kim Karlsson', 'Klubben', 'Lo', 'Anteckningar', 'Styrelsen'], 'utan tid sist; Lo och Anteckningar har samma tid');
    assert.deepStrictEqual(order('messages'), ['Klubben', 'Kim Karlsson', 'Lo', 'Anteckningar', 'Styrelsen']);
    assert.deepStrictEqual(order('name'), ['Anteckningar', 'Kim Karlsson', 'Klubben', 'Lo', 'Styrelsen']);
    const names = ['Östen', 'adam 10', 'Åsa', 'Zara', 'Ärla', 'Adam', 'adam 2', '+46701234567'];
    const threads = names.map((name, i) => ({ key: String(i), name, kind: 'person', address: '', messages: 1, lastMs: i }));
    const view = core.listView([{ app: 'Signal', threads, index: core.listIndex(threads, {}) }], { sort: 'name' });
    assert.deepStrictEqual(namesIn(view)[0], ['+46701234567', 'Adam', 'adam 2', 'adam 10', 'Zara', 'Åsa', 'Ärla', 'Östen']);
    assert.deepStrictEqual(core.LIST_SORTS.map((s) => s[0]), ['recent', 'messages', 'name']);
    // Ordningen ändrar inte trådarna som listan fick.
    assert.deepStrictEqual(threads.map((t) => t.name), names);
});
