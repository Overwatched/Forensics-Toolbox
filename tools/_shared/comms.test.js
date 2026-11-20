// Meddelanden, samtal och kontakter (queries/comms): katalogen mot labbtelefonernas scheman, rollerna genom ChatCore och
// Comms, och nummermatchningen. Inga data ur telefonerna: bara tabellernas CREATE TABLE och egna rader.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..', '..');
const catalog = require(path.join(ROOT, 'queries', 'comms', 'catalog.json'));
const SCHEMAS = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'comm-schemas.json'));
const Comms = require('./comms.js');
const ChatCore = require('../chats/chat-core.js');
const Roles = require('../provenance/roles.js');
const RunCore = require('../db-queries/run-core.js');

let SQLJS = null;
async function sqlJs() {
    if (SQLJS) return SQLJS;
    const dir = path.join(ROOT, 'tools', 'ios-keychain', 'vendor', 'sqljs');
    const ctx = {};
    new Function('window', fs.readFileSync(path.join(dir, 'sql-wasm-binary.js'), 'utf8'))(ctx);
    SQLJS = await require(path.join(dir, 'sql-wasm.js'))({ wasmBinary: ctx.SQL_WASM_BINARY });
    return SQLJS;
}
async function dbFor(key) {
    const S = await sqlJs();
    const db = new S.Database();
    // Telefonens egna sorteringsregler och funktioner finns inte i sql.js; NOT NULL tas bort så att testets rader
    // bara behöver kolumnerna som frågorna läser. Det läser ingen av frågorna.
    Object.values(SCHEMAS[key]).forEach((sql) => db.run(sql.replace(/COLLATE\s+PHONEBOOK/gi, '').replace(/DEFAULT\s*\(\s*ab_generate_guid\(\)\s*\)/gi, '').replace(/(?<!IS )NOT NULL/gi, '')));
    return db;
}
const dbOf = (id) => catalog.databases.find((d) => d.id === id);
const SCHEMA_OF = { 'ios-sms': 'ios-sms', 'android-sms': 'android-sms', 'android-bugle': 'android-bugle', 'ios-calls': 'ios-calls', 'android-calls': 'android-calls', 'ios-contacts': 'ios-contacts', 'android-contacts': 'android-contacts' };
function exec(db, q, values) {
    const r = db.exec(Roles.fill(q.sql, values || {}));
    return r.length ? r[r.length - 1] : { columns: [], values: [] };
}

// Cocoa-tid i nanosekunder (sms.db) för en UTC-tid.
const COCOA = 978307200;
const ns = (iso) => BigInt(Math.round(Date.parse(iso) / 1000 - COCOA)) * 1000000000n;
const sec = (iso) => Date.parse(iso) / 1000 - COCOA;

// NSAttributedString i typedstream, som iOS 16 och senare sparar i attributedBody: strängen efter NSString och +.
function typedstream(text) {
    const t = Buffer.from(text, 'utf8');
    const len = t.length < 0x80 ? Buffer.from([t.length]) : Buffer.from([0x81, t.length & 0xff, t.length >> 8]);
    return Buffer.concat([Buffer.from([0x04, 0x0b]), Buffer.from('streamtyped'), Buffer.from([0x81, 0xe8, 0x03, 0x84, 0x01, 0x40, 0x84, 0x84, 0x84, 0x12]), Buffer.from('NSAttributedString'),
        Buffer.from([0x00, 0x84, 0x84, 0x08]), Buffer.from('NSObject'), Buffer.from([0x00, 0x85, 0x92, 0x84, 0x84, 0x84, 0x08]), Buffer.from('NSString'), Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]), len, t,
        Buffer.from([0x86, 0x84, 0x02, 0x69, 0x49])]);
}

test('katalogen: sju databaser, varje query går att förbereda mot labbtelefonernas scheman, och rollerna har sina fält', async () => {
    assert.deepStrictEqual(catalog.databases.map((d) => d.id), ['ios-sms', 'android-sms', 'android-bugle', 'ios-calls', 'android-calls', 'ios-contacts', 'android-contacts']);
    const errors = [];
    for (const d of catalog.databases) {
        const db = await dbFor(SCHEMA_OF[d.id]);
        for (const q of d.queries) {
            try { db.prepare(q.sql.replace(/\{\{\w+\}\}/g, '0')).free(); } catch (e) { errors.push(d.id + '/' + q.id + ': ' + e.message); }
            if (q.hidden) assert.ok(q.fields && q.epoch, d.id + '/' + q.id + ': fields och epoch');
            else assert.ok(q.subtitle && q.returns, d.id + '/' + q.id + ': subtitle och returns');
        }
        db.close();
        assert.ok(d.source && d.blurb && d.paths.length, d.id);
    }
    assert.deepStrictEqual(errors, []);
    // Chattar: tre databaser med chattroller i appen Meddelanden; Telefonen: två med samtal och två med kontakter.
    const chats = ChatCore.sources([catalog]);
    assert.deepStrictEqual(chats.map((s) => s.key + ':' + s.app), ['ios-sms:Meddelanden', 'android-sms:Meddelanden', 'android-bugle:Meddelanden']);
    assert.deepStrictEqual(Comms.sources(catalog).map((s) => s.key + ':' + s.kind), ['ios-calls:calls', 'android-calls:calls', 'ios-contacts:contacts', 'android-contacts:contacts']);
    for (const s of Comms.sources(catalog).filter((x) => x.kind === 'contacts')) assert.ok(s.roles.points, s.key + ': contact-points');
});

test('tidsformatet cocoaAuto: nanosekunder och sekunder sedan 2001, i Härkomst och i Queries', () => {
    const ms = Date.parse('2026-11-03T10:55:31Z');
    assert.strictEqual(Roles.toMs(815396131000000000, 'cocoaAuto'), ms);
    assert.strictEqual(Roles.toMs(815396131, 'cocoaAuto'), ms);
    assert.strictEqual(Roles.toMs(0, 'cocoaAuto'), null);
    assert.strictEqual(RunCore.epochText(815396131000000000, 'cocoaAuto'), '2026-11-03 10:55:31 UTC');
});

test('sms.db: texten ur attributedBody, Nyligen raderade, ångrat och redigerat, gruppens avsändare och bilagans fil', async () => {
    const db = await dbFor('ios-sms');
    db.run("INSERT INTO handle (ROWID, id, service, country) VALUES (1, '+46701234567', 'iMessage', 'se'), (2, '+46739876543', 'SMS', 'se')");
    db.run("INSERT INTO chat (ROWID, guid, style, chat_identifier, service_name, display_name) VALUES (1, 'iMessage;-;+46701234567', 45, '+46701234567', 'iMessage', ''), (2, 'iMessage;+;chat99', 43, 'chat99', 'iMessage', 'Familjen')");
    db.run('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (1, 1), (2, 1), (2, 2)');
    const ins = db.prepare('INSERT INTO message (ROWID, guid, text, attributedBody, handle_id, service, is_from_me, date, date_read, date_delivered, date_edited, date_retracted, item_type, associated_message_type, cache_has_attachments, thread_originator_guid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const T = (s) => ns('2026-11-03T10:' + s + 'Z').toString();
    const long = 'Lång text '.repeat(20).trim();
    ins.run([1, 'G1', null, typedstream('Hej från attributedBody'), 1, 'iMessage', 0, T('00:00'), T('00:30'), 0, 0, 0, 0, 0, 0, null]);
    ins.run([2, 'G2', 'Svar', null, 1, 'iMessage', 1, T('01:00'), 0, T('01:02'), T('02:00'), 0, 0, 0, 0, 'G1']);
    ins.run([3, 'G3', null, typedstream(long), 1, 'iMessage', 0, T('03:00'), 0, 0, 0, 0, 0, 0, 0, null]);
    ins.run([4, 'G4', null, null, 1, 'iMessage', 1, T('04:00'), 0, 0, 0, T('04:30'), 0, 0, 0, null]);
    ins.run([5, 'G5', '￼', null, 1, 'iMessage', 0, T('05:00'), 0, 0, 0, 0, 0, 0, 1, null]);
    ins.run([6, 'G6', 'Raderad men kvar', null, 1, 'iMessage', 0, T('06:00'), 0, 0, 0, 0, 0, 0, 0, null]);
    ins.run([7, 'G7', 'I gruppen', null, 2, 'SMS', 0, T('07:00'), 0, 0, 0, 0, 0, 0, 0, null]);
    ins.run([8, 'G8', 'Gillade "Svar"', null, 1, 'iMessage', 0, T('08:00'), 0, 0, 0, 0, 0, 2000, 0, null]);
    ins.free();
    db.run('INSERT INTO chat_message_join (chat_id, message_id, message_date) VALUES (1, 1, 0), (1, 2, 0), (1, 3, 0), (1, 4, 0), (1, 5, 0), (1, 8, 0), (2, 7, 0)');
    db.run('INSERT INTO chat_recoverable_message_join (chat_id, message_id, delete_date) VALUES (1, 6, ?)', [T('09:00')]);
    db.run("INSERT INTO attachment (ROWID, guid, filename, mime_type, transfer_name, total_bytes) VALUES (1, 'A1', '~/Library/SMS/Attachments/ab/11/A1/IMG_0001.HEIC', 'image/heic', 'IMG_0001.HEIC', 1234)");
    db.run('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (5, 1)');
    db.run("INSERT INTO deleted_messages (ROWID, guid) VALUES (1, 'GONE-1')");

    const src = ChatCore.sources([catalog]).find((s) => s.key === 'ios-sms');
    const threads = ChatCore.threads(src, exec(db, src.roles.threads));
    assert.deepStrictEqual(threads.map((t) => [t.key, t.name, t.kind, t.messages]), [['1', '+46701234567', 'person', 7], ['2', 'Familjen', 'group', 1]]);
    assert.strictEqual(threads[0].lastMs, Date.parse('2026-11-03T10:08:00Z'));
    const members = ChatCore.members(src, exec(db, src.roles.members));
    assert.deepStrictEqual(members['2'].map((p) => p.id), ['+46701234567', '+46739876543']);
    const dbPath = 'filesystem1/private/var/mobile/Library/SMS/sms.db';
    const model = ChatCore.conversation(src, threads[0], exec(db, src.roles.messages, { threadId: '1' }), exec(db, src.roles.attachments, { threadId: '1' }), members['1'], dbPath, {});
    const byId = Object.fromEntries(model.messages.map((m) => [m.key, m]));
    assert.strictEqual(byId['1'].text, 'Hej från attributedBody');
    assert.strictEqual(byId['3'].text, long, 'en längd över 127 byte (0x81 och två byte)');
    assert.strictEqual(byId['2'].fromMe, true);
    assert.strictEqual(byId['2'].edited, 'redigerat');
    assert.strictEqual(byId['2'].replyTo, '1');
    assert.strictEqual(byId['4'].kind, 'deleted');
    assert.strictEqual(byId['4'].kindLabel, 'Ångrat av avsändaren');
    assert.strictEqual(byId['5'].kind, 'image');
    assert.strictEqual(byId['5'].attachments[0].entry, 'filesystem1/private/var/mobile/Library/SMS/Attachments/ab/11/A1/IMG_0001.HEIC');
    assert.strictEqual(byId['6'].deleted, true, 'meddelandet i Nyligen raderade');
    assert.strictEqual(byId['6'].text, 'Raderad men kvar');
    assert.strictEqual(byId['6'].times.find((t) => t.key === 'deletedAt').ms, Date.parse('2026-11-03T10:09:00Z'));
    assert.strictEqual(byId['8'].kind, 'system');
    assert.strictEqual(byId['1'].sortMs, Date.parse('2026-11-03T10:00:00Z'));
    assert.strictEqual(byId['1'].times.find((t) => t.key === 'read').ms, Date.parse('2026-11-03T10:00:30Z'));
    assert.strictEqual(byId['1'].senderName, '+46701234567');
    // Queries: samma text och raderingarna.
    const q = (id) => dbOf('ios-sms').queries.find((x) => x.id === id);
    const all = db.exec(q('sms-messages').sql.replace('{{cocoaStart}}', '0').replace('{{cocoaEnd}}', '9e12'))[0];
    const textCol = all.columns.indexOf('text');
    assert.ok(all.values.some((r) => r[textCol] === 'Hej från attributedBody'));
    const del = db.exec(q('sms-deleted').sql)[0];
    assert.deepStrictEqual(del.values.map((r) => r[0]).sort(), ['i Nyligen raderade', 'raderat helt (deleted_messages)', 'redigerat', 'ångrat av avsändaren']);
    db.close();
});

test('mmssms.db: SMS och MMS i samma tråd, MMS-texten ur part, avsändaren ur addr och bilagan i app_parts', async () => {
    const db = await dbFor('android-sms');
    db.run("INSERT INTO canonical_addresses (_id, address) VALUES (1, '+46701234567'), (2, '0739876543')");
    db.run("INSERT INTO threads (_id, date, message_count, recipient_ids, snippet) VALUES (1, 1793974026000, 3, '1', 'x'), (2, 1793974026000, 0, '1 2', '')");
    const t0 = Date.parse('2026-11-03T10:00:00Z');
    db.run('INSERT INTO sms (_id, thread_id, address, date, date_sent, type, body, read) VALUES (1, 1, ?, ?, ?, 1, ?, 1), (2, 1, ?, ?, 0, 2, ?, 1)', ['+46701234567', t0, t0 - 2000, 'Hej', '+46701234567', t0 + 60000, 'Hej själv']);
    db.run('INSERT INTO pdu (_id, thread_id, date, date_sent, msg_box, read, sub) VALUES (5, 1, ?, 0, 1, 0, ?)', [t0 / 1000 + 120, 'Bild']);
    db.run("INSERT INTO part (_id, mid, seq, ct, text) VALUES (10, 5, 0, 'application/smil', '<smil/>'), (11, 5, 1, 'text/plain', 'Titta')");
    db.run("INSERT INTO part (_id, mid, seq, ct, name, _data) VALUES (12, 5, 2, 'image/jpeg', 'IMG.jpg', '/data/user_de/0/com.android.providers.telephony/app_parts/PART_123')");
    db.run("INSERT INTO addr (_id, msg_id, address, type) VALUES (1, 5, '+46701234567', 137), (2, 5, 'insert-address-token', 151)");
    const src = ChatCore.sources([catalog]).find((s) => s.key === 'android-sms');
    const threads = ChatCore.threads(src, exec(db, src.roles.threads));
    assert.deepStrictEqual(threads.map((t) => [t.key, t.name, t.kind, t.messages]), [['1', '+46701234567', 'person', 3], ['2', '+46701234567, 0739876543', 'group', 0]]);
    assert.strictEqual(threads[0].firstMs, t0);
    assert.strictEqual(threads[1].firstMs, null, 'en tom tråd har ingen tid');
    const dbPath = 'Dump/data/user_de/0/com.android.providers.telephony/databases/mmssms.db';
    const model = ChatCore.conversation(src, threads[0], exec(db, src.roles.messages, { threadId: '1' }), exec(db, src.roles.attachments, { threadId: '1' }), [], dbPath, {});
    assert.deepStrictEqual(model.messages.map((m) => [m.key, m.fromMe, m.kind, m.text]), [['s1', false, 'text', 'Hej'], ['s2', true, 'text', 'Hej själv'], ['m5', false, 'image', 'Titta']]);
    assert.strictEqual(model.messages[2].senderName, '+46701234567');
    assert.strictEqual(model.messages[2].sortMs, t0 + 120000);
    assert.strictEqual(model.messages[0].times.find((t) => t.key === 'sent').ms, t0 - 2000);
    assert.strictEqual(model.messages[2].attachments[0].entry, 'Dump/data/user_de/0/com.android.providers.telephony/app_parts/PART_123');
    db.close();
});

test('bugle_db: motparter och egna nummer, händelser i appen, texten ur parts och raden i mmssms.db', async () => {
    const db = await dbFor('android-bugle');
    db.run("INSERT INTO participants (_id, sub_id, normalized_destination, display_destination, full_name) VALUES (1, -1, '+46722000000', '+46722000000', NULL), (2, -2, '+46701234567', '070-123 45 67', 'Anna'), (3, -2, 'SIGNAL', 'SIGNAL', NULL)");
    db.run("INSERT INTO conversations (_id, sms_thread_id, name, participant_count, participant_normalized_destination, archive_status, sort_timestamp) VALUES (1, 4, 'Anna', 1, '+46701234567', 0, 0), (2, 5, 'SIGNAL', 1, 'SIGNAL', 1, 0)");
    db.run('INSERT INTO conversation_participants (conversation_id, participant_id) VALUES (1, 2), (2, 3)');
    const t0 = Date.parse('2026-11-03T10:00:00Z');
    db.run("INSERT INTO messages (_id, conversation_id, sender_id, received_timestamp, sent_timestamp, message_protocol, message_status, read, sms_message_uri) VALUES (1, 1, 2, ?, ?, 0, 100, 1, 'content://sms/1'), (2, 1, 1, ?, ?, 0, 1, 1, 'content://sms/2'), (3, 1, 1, ?, ?, 5, 259, 0, NULL)", [t0, t0 - 1000, t0 + 1000, t0 + 1000, t0 + 2000, t0 + 2000]);
    db.run("INSERT INTO parts (_id, message_id, text, content_type) VALUES (1, 1, 'Hej', 'text/plain'), (2, 2, 'Hej då', 'text/plain')");
    const src = ChatCore.sources([catalog]).find((s) => s.key === 'android-bugle');
    const threads = ChatCore.threads(src, exec(db, src.roles.threads));
    assert.deepStrictEqual(threads.map((t) => [t.key, t.name, t.archived]), [['1', 'Anna', false], ['2', 'SIGNAL', true]]);
    const members = ChatCore.members(src, exec(db, src.roles.members));
    assert.deepStrictEqual(members['1'].map((p) => [p.id, p.name]), [['+46701234567', 'Anna']]);
    const model = ChatCore.conversation(src, threads[0], exec(db, src.roles.messages, { threadId: '1' }), exec(db, src.roles.attachments, { threadId: '1' }), members['1'], 'x/bugle_db', {});
    assert.deepStrictEqual(model.messages.map((m) => [m.key, m.fromMe, m.kind, m.text, m.senderName]), [['1', false, 'text', 'Hej', 'Anna'], ['2', true, 'text', 'Hej då', ''], ['3', false, 'system', '', '']]);
    assert.strictEqual(model.messages[2].kindLabel, 'Händelse i appen (status 259)');
    assert.ok(model.messages[0].details.some((d) => d.value === 'content://sms/1'));
    db.close();
});

test('CallHistory: riktning, besvarat, appen utan utvecklarens prefix, fler deltagare och tiden', async () => {
    const db = await dbFor('ios-calls');
    const ins = db.prepare('INSERT INTO ZCALLRECORD (Z_PK, Z_ENT, Z_OPT, ZDATE, ZDURATION, ZADDRESS, ZNAME, ZORIGINATED, ZANSWERED, ZCALLTYPE, ZSERVICE_PROVIDER, ZREAD, ZUNIQUE_ID, ZISO_COUNTRY_CODE) VALUES (?, 2, 1, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)');
    ins.run([1, sec('2026-11-03T10:00:00Z'), 65.4, '+46701234567', null, 1, 0, 1, 'com.apple.Telephony', 'U1', 'se']);
    ins.run([2, sec('2026-11-03T11:00:00Z'), 0, '+46701234567', null, 0, 0, 1, 'com.apple.Telephony', 'U2', 'se']);
    ins.run([3, sec('2026-11-03T12:00:00Z'), 4, 'F027F3F0-2DFF-4643-9A35-4EFBC6593B67', 'Deltagare 3', 0, 1, 0, 'U68MSDN6DR.org.whispersystems.signal', 'U3', null]);
    ins.free();
    db.run("INSERT INTO ZHANDLE (Z_PK, Z_ENT, Z_OPT, ZTYPE, ZVALUE, ZNORMALIZEDVALUE) VALUES (1, 4, 1, 1, 'F027F3F0-2DFF-4643-9A35-4EFBC6593B67', 'f027'), (2, 4, 1, 2, '+46739876543', '+46739876543')");
    db.run('INSERT INTO Z_2REMOTEPARTICIPANTHANDLES (Z_2REMOTEPARTICIPANTCALLS, Z_4REMOTEPARTICIPANTHANDLES) VALUES (3, 1), (3, 2)');
    const src = Comms.sources(catalog).find((s) => s.key === 'ios-calls');
    const calls = Comms.calls(src, exec(db, src.roles.calls));
    assert.deepStrictEqual(calls.map((c) => [c.id, c.direction, c.app, c.type]), [['3', 'in', 'org.whispersystems.signal', 'app'], ['2', 'missed', 'com.apple.Telephony', 'telefon'], ['1', 'out', 'com.apple.Telephony', 'telefon']]);
    assert.strictEqual(calls[2].ms, Date.parse('2026-11-03T10:00:00Z'));
    assert.strictEqual(Comms.durationText(calls[2].duration), '1:05');
    assert.deepStrictEqual(calls[0].others, ['+46739876543'], 'motparten själv räknas inte som fler deltagare');
    db.close();
});

test('calllog.db: typerna, appen ur subscription_component_name och dolt nummer', async () => {
    const db = await dbFor('android-calls');
    const t0 = Date.parse('2026-11-03T10:00:00Z');
    db.run("INSERT INTO calls (_id, number, date, duration, type, presentation, subscription_component_name, name, countryiso, features) VALUES (1, '0701234567', ?, 30, 2, 1, 'com.android.phone/com.android.services.telephony.TelephonyConnectionService', 'Anna', 'SE', 0), (2, '', ?, 0, 3, 2, 'com.android.phone/x', NULL, 'SE', 0), (3, '+46739876543', ?, 12, 1, 1, 'com.whatsapp/com.whatsapp.voipcalling.SelfManagedConnectionService', NULL, NULL, 1)", [t0, t0 + 1000, t0 + 2000]);
    const src = Comms.sources(catalog).find((s) => s.key === 'android-calls');
    const calls = Comms.calls(src, exec(db, src.roles.calls));
    assert.deepStrictEqual(calls.map((c) => [c.id, c.direction, c.app, c.type, c.hidden]), [['3', 'in', 'com.whatsapp', 'video', ''], ['2', 'missed', 'com.android.phone', 'telefon', 'dolt nummer'], ['1', 'out', 'com.android.phone', 'telefon', '']]);
    assert.strictEqual(calls[2].ms, t0);
    db.close();
});

test('kontakterna på iOS och Android: nummer och e-post med etikett, konto, raderad, och uppslag på olika skrivsätt', async () => {
    const ios = await dbFor('ios-contacts');
    ios.run("INSERT INTO ABStore (ROWID, Name, Type) VALUES (0, '', 0), (1, 'Card', 4)");
    ios.run("INSERT INTO ABPerson (ROWID, First, Last, Organization, Note, CreationDate, ModificationDate, StoreID) VALUES (1, 'Anna', 'Svensson', 'Exempel AB', 'Granne', ?, ?, 1), (2, NULL, NULL, 'Bilverkstan', NULL, ?, ?, 0)", [sec('2025-01-01T00:00:00Z'), sec('2026-11-01T00:00:00Z'), sec('2025-01-01T00:00:00Z'), sec('2025-01-01T00:00:00Z')]);
    ios.run("INSERT INTO ABMultiValueLabel (ROWID, value) VALUES (1, '_$!<Mobile>!$_'), (2, '_$!<Home>!$_')");
    ios.run("INSERT INTO ABMultiValue (UID, record_id, property, identifier, label, value) VALUES (1, 1, 3, 0, 1, '070-123 45 67'), (2, 1, 4, 0, 2, 'Anna@Example.org'), (3, 2, 3, 0, NULL, '+46 8 123 456 78')");
    let src = Comms.sources(catalog).find((s) => s.key === 'ios-contacts');
    const a = Comms.contacts(src, exec(ios, src.roles.contacts), exec(ios, src.roles.points));
    assert.deepStrictEqual(a.list.map((k) => [k.name, k.account]), [['Anna Svensson', 'Card'], ['Bilverkstan', 'På telefonen']]);
    assert.deepStrictEqual(a.list[0].phones, [{ label: 'Mobile', value: '070-123 45 67', account: '' }]);
    assert.strictEqual(a.list[0].modifiedMs, Date.parse('2026-11-01T00:00:00Z'));
    assert.strictEqual(Comms.lookup(a.index, '+46701234567').name, 'Anna Svensson');
    assert.strictEqual(Comms.lookup(a.index, '0046701234567@s.whatsapp.net').name, 'Anna Svensson');
    assert.strictEqual(Comms.lookup(a.index, 'anna@example.org').name, 'Anna Svensson');
    assert.strictEqual(Comms.lookup(a.index, '0812345678').name, 'Bilverkstan');
    assert.strictEqual(Comms.lookup(a.index, 'SIGNAL'), null);
    ios.close();

    const and = await dbFor('android-contacts');
    and.run("INSERT INTO accounts (_id, account_name, account_type) VALUES (1, 'anna@gmail.com', 'com.google'), (2, 'WhatsApp', 'com.whatsapp')");
    and.run("INSERT INTO mimetypes (_id, mimetype) VALUES (1, 'vnd.android.cursor.item/phone_v2'), (2, 'vnd.android.cursor.item/email_v2'), (3, 'vnd.android.cursor.item/name'), (4, 'vnd.android.cursor.item/organization'), (5, 'vnd.android.cursor.item/note')");
    and.run("INSERT INTO raw_contacts (_id, account_id, contact_id, display_name, deleted, starred, times_contacted, last_time_contacted) VALUES (1, 1, 7, 'Erik Lind', 0, 1, 3, 1793974026000), (2, 2, 7, 'Erik Lind', 0, 0, 0, 0), (3, 1, 8, 'Borttagen', 1, 0, 0, 0)");
    and.run("INSERT INTO data (_id, raw_contact_id, mimetype_id, data1, data2) VALUES (1, 1, 1, '073-987 65 43', 2), (2, 2, 1, '+46739876543', 2), (3, 1, 2, 'erik@example.org', 1), (4, 1, 4, 'Firma', NULL), (5, 3, 1, '0700000000', 1)");
    src = Comms.sources(catalog).find((s) => s.key === 'android-contacts');
    const b = Comms.contacts(src, exec(and, src.roles.contacts), exec(and, src.roles.points));
    assert.deepStrictEqual(b.list.map((k) => [k.name, k.account, k.starred, k.deleted]), [['Borttagen', 'com.google', false, true], ['Erik Lind', 'com.google,com.whatsapp', true, false]]);
    assert.deepStrictEqual(b.list[1].phones.map((p) => [p.label, p.value, p.account]), [['Mobil', '073-987 65 43', 'com.google'], ['Mobil', '+46739876543', 'com.whatsapp']]);
    assert.strictEqual(b.list[1].org, 'Firma');
    assert.strictEqual(b.list[1].lastContactedMs, 1793974026000);
    assert.strictEqual(Comms.lookup(b.index, '0739876543').name, 'Erik Lind');
    and.close();
});

test('ChatCore.applyContacts: nummer får kontaktens namn, ett namn som appen själv har behålls', () => {
    const nameOf = (v) => (Comms.phoneKey(v) === '701234567' ? 'Anna Svensson' : '');
    const threads = [{ key: '1', id: 1, kind: 'person', name: '+46701234567', address: '+46701234567' }, { key: '2', id: 2, kind: 'person', name: 'Anna i WhatsApp', address: '46701234567@s.whatsapp.net' }, { key: '3', id: 3, kind: 'group', name: 'Familjen', address: '' }];
    const people = { 1: [{ id: '+46701234567', name: '+46701234567', address: '+46701234567' }], 3: [{ id: '46701234567@s.whatsapp.net', name: '46701234567@s.whatsapp.net', address: '' }, { id: 'x', name: 'Kim', address: '+46701234567' }] };
    ChatCore.applyContacts(threads, people, nameOf);
    assert.deepStrictEqual(threads.map((t) => t.name), ['Anna Svensson', 'Anna i WhatsApp', 'Familjen']);
    assert.deepStrictEqual(people[3].map((p) => p.name), ['Anna Svensson', 'Kim']);
    assert.strictEqual(people[1][0].named, 'contacts');
});

test('phoneKey: de nio sista siffrorna, e-post med gemener, inga nycklar för korta nummer och namn', () => {
    assert.strictEqual(Comms.phoneKey('+46 70-123 45 67'), '701234567');
    assert.strictEqual(Comms.phoneKey('0701234567'), '701234567');
    assert.strictEqual(Comms.phoneKey('tel:+46701234567'), '701234567');
    assert.strictEqual(Comms.phoneKey('46701234567@s.whatsapp.net'), '701234567');
    assert.strictEqual(Comms.phoneKey('Anna@Example.ORG'), 'anna@example.org');
    assert.strictEqual(Comms.phoneKey('72400'), '');
    assert.strictEqual(Comms.phoneKey('SIGNAL'), '');
    assert.strictEqual(Comms.phoneKey('F027F3F0-2DFF-4643-9A35-4EFBC6593B67'), '');
    assert.strictEqual(Comms.durationText(3723), '1:02:03');
});
