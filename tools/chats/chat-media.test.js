'use strict';
// Bilagornas filer: Signals kryptering på iOS och Android, gjord här med Nodes krypto på samma sätt som appen gör,
// ska ge klartexten tillbaka, och SHA-256 jämförs med databasen. Signals chattroller på iOS körs mot labbschemat.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const media = require('./chat-media.js');
const core = require('./chat-core.js');
const roles = require('../provenance/roles.js');

const ROOT = path.join(__dirname, '..', '..');
const signalIos = require(path.join(ROOT, 'queries', 'ios', 'signal', 'catalog.json'));
const signalAndroid = require(path.join(ROOT, 'queries', 'android', 'signal', 'catalog.json'));
const SCHEMAS = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'chat-schemas.json'));

// Som Signal på iOS: IV, AES-256-CBC med PKCS7 över klartexten och utfyllnad, och HMAC-SHA256 över IV och chiffertext.
function iosFile(plain, key, padTo) {
    const iv = crypto.randomBytes(16);
    const padded = Buffer.concat([plain, Buffer.alloc(Math.max(0, (padTo || 0) - plain.length))]);
    const c = crypto.createCipheriv('aes-256-cbc', key.subarray(0, 32), iv);
    const ct = Buffer.concat([c.update(padded), c.final()]);
    const mac = crypto.createHmac('sha256', key.subarray(32)).update(Buffer.concat([iv, ct])).digest();
    return new Uint8Array(Buffer.concat([iv, ct, mac]));
}

test('Signal på iOS: filen dekrypteras med bilagans nyckel och kapas till sin storlek, och en fel nyckel stoppas av HMAC', async () => {
    const key = crypto.randomBytes(64);
    const plain = crypto.randomBytes(5000);
    const file = iosFile(plain, key, 5300);
    const a = { key: key.toString('hex'), size: plain.length, sha256: crypto.createHash('sha256').update(plain).digest('hex') };
    const out = await media.open('signal-ios', file, a);
    assert.ok(Buffer.from(out).equals(plain));
    assert.deepStrictEqual((await media.check(out, a)).ok, true);
    const other = Object.assign({}, a, { key: crypto.randomBytes(64).toString('hex') });
    await assert.rejects(media.open('signal-ios', file, other), /HMAC stämmer inte/);
    await assert.rejects(media.open('signal-ios', file, Object.assign({}, a, { key: 'abcd' })), /2 byte, inte 64/);
});

test('Signal på Android: AES-256-CTR med HMAC-SHA256(modernKey, data_random), utan modernKey sägs det', async () => {
    const modern = crypto.randomBytes(32), random = crypto.randomBytes(32);
    const plain = crypto.randomBytes(3333);
    const key = crypto.createHmac('sha256', modern).update(random).digest();
    const c = crypto.createCipheriv('aes-256-ctr', key, Buffer.alloc(16));
    const file = new Uint8Array(Buffer.concat([c.update(plain), c.final()]));
    const a = { random: random.toString('hex'), size: plain.length };
    const out = await media.open('signal-android', file, a, { modernKey: modern.toString('base64') });
    assert.ok(Buffer.from(out).equals(plain));
    assert.strictEqual((await media.check(out, a)).ok, null, 'ingen summa i databasen');
    assert.strictEqual((await media.check(out, { sha256: 'ab'.repeat(32) })).ok, false);
    await assert.rejects(media.open('signal-android', file, a, {}), /modernKey\) saknas/);
    assert.strictEqual(await media.open(null, file, a), file, 'okrypterade filer lämnas som de är');
});

let SQLJS = null;
async function sqlJs() {
    if (SQLJS) return SQLJS;
    const dir = path.join(ROOT, 'tools', 'ios-keychain', 'vendor', 'sqljs');
    const ctx = {};
    new Function('window', fs.readFileSync(path.join(dir, 'sql-wasm-binary.js'), 'utf8'))(ctx);
    SQLJS = await require(path.join(dir, 'sql-wasm.js'))({ wasmBinary: ctx.SQL_WASM_BINARY });
    return SQLJS;
}

test('Signal på iOS: trådar, gruppens medlemmar, riktning, enhet, samtal och krypterade bilagor ur rollerna', async () => {
    const S = await sqlJs();
    const db = new S.Database();
    Object.values(SCHEMAS['signal-ios']).forEach((sql) => db.run(sql));
    // Labbschemat har många NOT NULL-kolumner; de som testet inte bryr sig om får ett neutralt värde.
    const ins = (t, given) => {
        const row = Object.assign({}, given);
        for (const [name, type, notnull, dflt, pk] of db.exec('SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(\'' + t + '\')')[0].values) {
            if (notnull && dflt === null && !pk && !(name in row)) row[name] = /BLOB/i.test(type) ? new Uint8Array(0) : /TEXT/i.test(type) ? '' : 0;
        }
        db.run('INSERT INTO ' + t + ' (' + Object.keys(row).map((k) => '"' + k + '"').join(', ') + ') VALUES (' + Object.keys(row).map(() => '?').join(', ') + ')', Object.values(row));
    };
    const ACI = '11111111-1111-4111-8111-111111111111', ACI2 = '22222222-2222-4222-8222-222222222222';
    const base = { recordType: 0, uniqueId: '' };
    ins('model_TSThread', Object.assign({}, base, { id: 3, recordType: 27, uniqueId: 'T3', contactUUID: ACI, shouldThreadBeVisible: 1 }));
    ins('model_TSThread', Object.assign({}, base, { id: 4, recordType: 26, uniqueId: 'T4', name: 'Gruppen', groupModel: new Uint8Array([1]), shouldThreadBeVisible: 1 }));
    ins('model_SignalRecipient', { id: 1, recordType: 31, uniqueId: 'R1', recipientUUID: ACI, recipientPhoneNumber: '+46700000001', devices: new Uint8Array([0]) });
    ins('model_OWSUserProfile', { id: 1, recordType: 51, uniqueId: 'P1', recipientUUID: ACI2, profileName: 'Mo' });
    ins('model_TSGroupMember', { id: 1, recordType: 1, uniqueId: 'G1', groupThreadId: 'T4', uuidString: ACI2, lastInteractionTimestamp: 0 });
    const msg = (row) => ins('model_TSInteraction', Object.assign({ recordType: 19, uniqueId: 'M' + row.id, receivedAtTimestamp: 0, timestamp: 0 }, row));
    msg({ id: 1, uniqueThreadId: 'T3', recordType: 21, body: 'Hej', timestamp: 1790000000000, receivedAtTimestamp: 1790000000000, wasNotCreatedLocally: 1 });
    msg({ id: 2, uniqueThreadId: 'T3', recordType: 19, authorUUID: ACI, body: 'Svar', timestamp: 1790000005000, receivedAtTimestamp: 1790000007000, serverTimestamp: 1790000006000, expiresInSeconds: 60, expireStartedAt: 1790000030000 });
    msg({ id: 3, uniqueThreadId: 'T3', recordType: 20, callType: 3, timestamp: 1790000100000, receivedAtTimestamp: 1790000100000 });
    msg({ id: 4, uniqueThreadId: 'T4', recordType: 19, authorUUID: ACI2, timestamp: 1790000200000, receivedAtTimestamp: 1790000201000 });
    ins('Attachment', { id: 9, mimeType: 'image/jpeg', unencryptedByteCount: 5000, encryptedByteCount: 5376, encryptionKey: new Uint8Array(64).fill(7), sha256ContentHash: new Uint8Array(32).fill(1), localRelativeFilePath: 'ab/cd' });
    ins('MessageAttachmentReference', { ownerType: 0, ownerRowId: 4, attachmentRowId: 9, receivedAtTimestamp: 1790000201000, threadRowId: 4, caption: 'En bild', sourceFilename: 'IMG_1.jpg', renderingFlag: 0, orderInMessage: 0, isViewOnce: 0, ownerIsPastEditRevision: 0 });
    const exec = (q, values) => { const r = db.exec(roles.fill(q.sql, values || {})); return r.length ? r[r.length - 1] : { columns: [], values: [] }; };
    try {
        const [src] = core.sources([signalIos]);
        assert.strictEqual(src.app, 'Signal');
        const threads = core.threads(src, exec(src.roles.threads));
        assert.deepStrictEqual(threads.map((t) => [t.id, t.name, t.kind, t.messages]), [[4, 'Gruppen', 'group', 1], [3, '+46700000001', 'person', 3]]);
        const people = core.members(src, exec(src.roles.members));
        assert.deepStrictEqual(people['4'].map((p) => p.name), ['Mo']);
        const dbPath = '/private/var/mobile/Containers/Shared/AppGroup/X/grdb/signal.sqlite';
        const one = core.conversation(src, threads[1], exec(src.roles.messages, { threadId: 3 }), exec(src.roles.attachments, { threadId: 3 }), people['3'], dbPath);
        assert.deepStrictEqual(one.messages.map((m) => [m.id, m.fromMe, m.kind, m.device]), [[1, true, 'text', 'skickat från en länkad enhet'], [2, false, 'text', ''], [3, false, 'call', '']]);
        const reply = one.messages[1];
        assert.strictEqual(reply.senderName, '+46700000001');
        assert.deepStrictEqual(reply.times.map((t) => [t.key, t.ms]), [['received', 1790000007000], ['sent', 1790000005000], ['server', 1790000006000], ['opened', 1790000030000]]);
        assert.strictEqual(reply.expiresIn, 60);
        assert.strictEqual(one.messages[0].times.find((t) => t.key === 'opened').ms, null, 'skickade meddelanden har ingen öppnad-tid');
        const group = core.conversation(src, threads[0], exec(src.roles.messages, { threadId: 4 }), exec(src.roles.attachments, { threadId: 4 }), people['4'], dbPath);
        const att = group.messages[0].attachments[0];
        assert.strictEqual(group.messages[0].kind, 'image');
        assert.strictEqual(group.messages[0].senderName, 'Mo');
        assert.strictEqual(att.entry, '/private/var/mobile/Containers/Shared/AppGroup/X/attachment_files/ab/cd');
        assert.strictEqual(att.key, '07'.repeat(64));
        assert.strictEqual(att.sha256, '01'.repeat(32));
        assert.strictEqual(att.title, 'En bild');
        assert.strictEqual(src.roles.attachments.decrypt, 'signal-ios');
    } finally {
        db.close();
    }
});

test('Signal på Android: rollerna har dekrypteringen och fälten för data_random', () => {
    const [src] = core.sources([signalAndroid]);
    assert.strictEqual(src.key, 'signal-android-main');
    assert.strictEqual(src.roles.attachments.decrypt, 'signal-android');
    assert.strictEqual(src.roles.attachments.fields.random, 'random_hex');
    assert.match(src.roles.attachments.sql, /'app_parts\/' \|\|/);
});
