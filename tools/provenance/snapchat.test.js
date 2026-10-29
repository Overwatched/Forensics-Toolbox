// Snapchat-tolkningen: externa nycklar, protobuf (avsändare, medienyckel, användarnamn) och
// händelserna till tidslinjen. Protobufen byggs för hand i samma form som i arroyo.db.

const test = require('node:test');
const assert = require('node:assert');
const snap = require('./snapchat');

function varint(n) { const out = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return out; }
function len(field, bytes) { return [...varint(field * 8 + 2), ...varint(bytes.length), ...bytes]; }
function vint(field, n) { return [...varint(field * 8), ...varint(n)]; }
function str(field, s) { return len(field, [...Buffer.from(s, 'utf8')]); }
const SENDER = Buffer.from('c5ba9ace13844921bcbde4b50503e358', 'hex');
const CONV = Buffer.from('1a23b972b82c5814bc56f87db86fe19b', 'hex');

// 08 04 12 12 0A 10 <16 byte avsändare> … som i riktiga meddelanden.
function message(opts) {
    opts = opts || {};
    const sender = opts.sender || SENDER;
    const inner = [...len(1, [...sender])];
    const parts = [...vint(1, opts.n || 4), ...len(2, inner), ...len(3, [...len(1, [...CONV])])];
    if (opts.media) {
        const keyIv = [...len(1, Array(32).fill(7)), ...len(2, Array(16).fill(9))];
        parts.push(...len(7, [...len(1, keyIv)]));
    }
    if (opts.text) parts.push(...len(4, str(13, opts.text)));
    return Uint8Array.from(parts);
}

test('externa nycklar: meddelande, inspelning, story, skickad snap, url, lins', () => {
    assert.deepStrictEqual(snap.parseExternalKey('1:1A23B972-B82C-5814-BC56-F87DB86FE19B:4:0:0'), { kind: 'message', conversationId: '1a23b972-b82c-5814-bc56-f87db86fe19b', serverMessageId: 4 });
    assert.deepStrictEqual(snap.parseExternalKey('F21A9E0E-8B8B-4377-B21B-4D1E7D74C126~1'), { kind: 'recording', recordingId: 'F21A9E0E-8B8B-4377-B21B-4D1E7D74C126' });
    assert.strictEqual(snap.parseExternalKey('firstframe~W7_EDlXWTBiXAEEniNoMPwAAYd2').kind, 'story');
    assert.deepStrictEqual(snap.parseExternalKey('KKLATTERMUS~4B56F0F3-AFC0-471A-A240-D88C4F161786'), { kind: 'sent', recipient: 'kklattermus', mediaId: '4B56F0F3-AFC0-471A-A240-D88C4F161786' });
    assert.deepStrictEqual(snap.parseExternalKey('SNAPVIDEOFILTERSTATE-KKLATTERMUS~4B56F0F3-AFC0-471A-A240-D88C4F161786'), { kind: 'sent', recipient: 'kklattermus', mediaId: '4B56F0F3-AFC0-471A-A240-D88C4F161786', aux: 'filterstate' });
    assert.strictEqual(snap.parseExternalKey('https://cf-st.sc-cdn.net/d/x').kind, 'url');
    assert.strictEqual(snap.parseExternalKey('lens.data702B6943').kind, 'lens');
    assert.strictEqual(snap.parseExternalKey('').kind, 'other');
    assert.strictEqual(snap.parseExternalKey(null).kind, 'other');
});

test('typkoder: kända får namn, okända visas som typ N', () => {
    assert.strictEqual(snap.contextInfo(3).label, 'chattmedia');
    assert.strictEqual(snap.contextInfo(34).label, 'inspelning med Snapchats kamera');
    assert.strictEqual(snap.contextInfo(99).label, 'typ 99 (okänd)');
    assert.strictEqual(snap.contextInfo(99).known, false);
    assert.strictEqual(snap.contextInfo(99).show, false, 'okända typer visas inte i tidslinjen');
    assert.strictEqual(snap.contextInfo(12).show, false);
});

test('avsändaren läses ur fält 2 → 1 och medienyckeln känns igen', () => {
    const m = message({ media: true });
    assert.strictEqual(snap.senderId(m), 'c5ba9ace13844921bcbde4b50503e358');
    assert.strictEqual(snap.hasMediaKey(m), true);
    assert.strictEqual(snap.hasMediaKey(message({ text: 'hej' })), false);
    assert.strictEqual(snap.senderId(Uint8Array.from([0xff, 0xff, 0xff])), null);
    assert.strictEqual(snap.senderId(null), null);
    assert.strictEqual(snap.senderId(message({ sender: Buffer.alloc(16) })), null, 'bara nollor räknas inte som id');
    // Samma byten som den synliga queryn pekar på: hex(substr(message_content, 7, 16)).
    assert.strictEqual(Buffer.from(m.subarray(2, 6)).toString('hex'), '12120a10');
    assert.strictEqual(Buffer.from(m.subarray(6, 22)).toString('hex'), snap.senderId(m));
});

test('FlatBuffer-strängar: längd, bytes och nolla, som i snapchatter.p', () => {
    function fstr(s) { const b = Buffer.from(s, 'utf8'); const len = Buffer.alloc(4); len.writeUInt32LE(b.length); return Buffer.concat([len, b, Buffer.from([0]), Buffer.alloc((4 - (b.length + 1) % 4) % 4)]); }
    const fb = Buffer.concat([Buffer.from([0x28, 0, 0, 0, 0x24, 0, 0x24, 0]), fstr('teamsnapchat'), fstr('Team Snapchat'), fstr('84ee8839-3911-492d-8b94-72dd80f3713a'), Buffer.from([1, 2, 3])]);
    assert.deepStrictEqual(snap.flatStrings(Uint8Array.from(fb)), ['teamsnapchat', 'Team Snapchat', '84ee8839-3911-492d-8b94-72dd80f3713a']);
    const n = snap.friendNames(Uint8Array.from(fb));
    assert.strictEqual(n.username, 'teamsnapchat');
    assert.strictEqual(n.displayName, 'Team Snapchat');
});

test('användarnamn och visningsnamn ur en protobuf (reservläsning)', () => {
    const p = Uint8Array.from([...str(1, 'anna.svensson'), ...str(2, 'anna.svensson'), ...str(3, 'Anna S'), ...len(4, [...SENDER]), ...str(9, '84ee8839-3911-492d-8b94-72dd80f3713a')]);
    const n = snap.friendNames(p);
    assert.strictEqual(n.username, 'anna.svensson');
    assert.strictEqual(n.displayName, 'Anna S');
    assert.deepStrictEqual(snap.friendNames(Uint8Array.from([0xff])), { username: null, displayName: null, strings: [] });
    // Inte protobuf, men strängarna finns i bytena: reservläsningen hittar dem ändå.
    const odd = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('kalle.anka\u0000'), Buffer.from([0x01]), Buffer.from('Kalle Anka')]);
    assert.strictEqual(snap.friendNames(Uint8Array.from(odd)).username, 'kalle.anka');
    assert.strictEqual(snap.friendNames(Uint8Array.from(odd)).displayName, 'Kalle Anka');
});

test('kontots uuid och cachenyckeln ur sökvägar', () => {
    const names = ['x/Documents/com.snap.file_manager_3_SCContent_64777a71-413a-4e22-8acc-49d462732ce3/c59503f8d37f48cc8a3aefb4aba984fb'];
    assert.strictEqual(snap.accountId(names), '64777a71-413a-4e22-8acc-49d462732ce3');
    assert.strictEqual(snap.accountId(['a/b']), null);
    assert.strictEqual(snap.cacheKeyFromPath(names[0]), 'c59503f8d37f48cc8a3aefb4aba984fb');
    assert.strictEqual(snap.cacheKeyFromPath(names[0] + '_PREFETCH'), 'c59503f8d37f48cc8a3aefb4aba984fb');
    assert.strictEqual(snap.cacheKeyFromPath('x/Documents/com.snap.file_manager_4_SCContent_/0dcba6e4f68e24573668d07ac1f11443_193536-1141136'), '0dcba6e4f68e24573668d07ac1f11443');
    assert.strictEqual(snap.cacheKeyFromPath('x/DCIM/100APPLE/IMG_0001.HEIC'), null);
    assert.ok(snap.isRecordingPath('x/Library/Caches/user_scoped/abc/recorded_videos/recorded-11548.737872.mp4'));
});

test('händelserna: inspelning, skickad snap, mottagen snap, läst, notis, och den bedömda filen märks', () => {
    const T = Date.UTC(2025, 7, 19, 10, 19, 55);
    const ctx = {
        accountId: '64777a71-413a-4e22-8acc-49d462732ce3',
        fileKey: '25BBAD89E029C7C33D8AFC1E60D512F1',
        friends: { c5ba9ace13844921bcbde4b50503e358: { username: 'kklattermus', displayName: 'Klätter Mus' } },
        cacheRows: [
            { key: '25bbad89e029c7c33d8afc1e60d512f1', context: 34, external: 'F21A9E0E-8B8B-4377-B21B-4D1E7D74C126~1', createdMs: T, deletedMs: null },
            { key: '8c7334521e17ca3c95e15dc9bfcf6c19', context: 3, external: 'KKLATTERMUS~4B56F0F3-AFC0-471A-A240-D88C4F161786', createdMs: T + 2000, deletedMs: null },
            { key: '5fc2c59ec4c4aaaaaaaaaaaaaaaaaaaa', context: 3, external: 'SNAPVIDEOFILTERSTATE-KKLATTERMUS~4B56F0F3-AFC0-471A-A240-D88C4F161786', createdMs: T + 2000, deletedMs: T + 3000 },
            { key: '3175fbdf4d33aaaaaaaaaaaaaaaaaaaa', context: 34, external: '', createdMs: T + 1000, deletedMs: T + 2000 },
            { key: 'a32c9f6b2c90db8e948b44278d9b4d42', context: 3, external: '1:1a23b972-b82c-5814-bc56-f87db86fe19b:4:0:0', createdMs: T + 600000, deletedMs: T + 900000 },
            { key: 'f08841916c935be2c6b78fabb7b1f94e', context: 1, external: 'lens.data', createdMs: T + 1000, deletedMs: null },
        ],
        messages: [
            { conversation: '1a23b972-b82c-5814-bc56-f87db86fe19b', serverId: 3, clientId: 5, createdMs: T + 3000, readMs: T + 53000, content: message({ n: 3, sender: Buffer.from('64777a71413a4e228acc49d462732ce3', 'hex'), media: true }) },
            { conversation: '1a23b972-b82c-5814-bc56-f87db86fe19b', serverId: 4, clientId: 6, createdMs: T + 500000, readMs: null, content: message({ n: 4, media: true }) },
        ],
        notifications: [{ ms: T + 500500, type: 'snap', category: 1 }],
    };
    const out = snap.build(ctx);
    const texts = out.events.map((e) => e.plain).filter(Boolean);
    assert.deepStrictEqual(texts, [
        'Den bedömda videon spelas in med Snapchats kamera',
        'En snap eller bild skickas till @kklattermus från den här telefonen',
        'Mottagaren öppnar den',
        'En snap eller bild skickas till den här telefonen i Snapchat från @kklattermus',
        'Telefonen får en notis om en ny snap',
        'En bild eller video ur Snapchat-chatten läggs i appens cache',
    ]);
    assert.strictEqual(out.events[0].isFile, true);
    assert.strictEqual(out.events[0].bold, true);
    assert.ok(out.link && out.link.context.code === 34 && out.link.external.kind === 'recording');
    assert.strictEqual(out.hidden, 1, 'linsen visas inte');
    assert.match(out.notes[0], /1 cacheposter .*\(1\)/);
    assert.ok(out.events.every((e) => e.source && e.source.db && e.source.column), 'varje händelse har källa');
    assert.match(out.events.find((e) => e.kind === 'snap-message').source.column, /protobuf/);
    assert.ok(out.events.some((e) => e.kind === 'snap-cache-deleted' && e.ms === T + 900000), 'raderingen av den mottagna filen finns med');
    assert.ok(out.events.filter((e) => e.kind === 'snap-cache' && e.context === 34 && !e.plain).length === 1, 'den tillfälliga inspelningsposten får ingen mening');
});

test('den bedömda filen som mottagen snap kopplas till meddelandet och avsändaren', () => {
    const T = Date.UTC(2025, 7, 20, 7, 18, 40);
    const out = snap.build({
        accountId: '64777a71-413a-4e22-8acc-49d462732ce3', fileKey: 'a32c9f6b2c90db8e948b44278d9b4d42',
        friends: { c5ba9ace13844921bcbde4b50503e358: { username: 'kklattermus' } },
        cacheRows: [{ key: 'a32c9f6b2c90db8e948b44278d9b4d42', context: 3, external: '1:1a23b972-b82c-5814-bc56-f87db86fe19b:4:0:0', createdMs: T }],
        messages: [{ conversation: '1a23b972-b82c-5814-bc56-f87db86fe19b', serverId: 4, createdMs: T - 75000000, readMs: T, content: message({ n: 4, media: true }) }],
    });
    assert.ok(out.link.message, 'meddelandet hittas via EXTERNAL_KEY');
    const msg = out.events.find((e) => e.kind === 'snap-message');
    assert.strictEqual(msg.isFile, true);
    assert.strictEqual(msg.plain, 'Den bedömda filen skickas till den här telefonen i Snapchat från @kklattermus');
    assert.strictEqual(out.events.find((e) => e.kind === 'snap-read').plain, 'Den öppnas på den här telefonen');
});

test('fler än 40 händelser kapas, men den bedömda filen behålls', () => {
    const rows = [];
    for (let i = 0; i < 60; i++) rows.push({ key: 'k' + i, context: 16, external: 'video~x', createdMs: 1000 + i * 1000 });
    rows.push({ key: 'mine', context: 3, external: 'x', createdMs: 99999 });
    const out = snap.build({ cacheRows: rows, fileKey: 'mine', centerMs: 30000 });
    assert.strictEqual(out.events.length, 40);
    assert.ok(out.events.some((e) => e.isFile));
    assert.match(out.notes[0], /21 Snapchat-händelser/);
    // De närmast T behålls: 30 s ± 20 s, inte de första.
    assert.ok(out.events.every((e) => e.isFile || Math.abs(e.ms - 30000) <= 20000), 'de som behålls ligger nära T');
});
