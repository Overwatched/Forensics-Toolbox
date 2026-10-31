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

test('Android: avsändare ur sender_id, egen telefon ur created_on_device, media ur remote_media_count, chattnyckel', () => {
    assert.deepStrictEqual(snap.parseExternalKey('chat_snap.chat_snap-nGJdelEzP6e2A8Di5zMiF'), { kind: 'chat', snapId: 'nGJdelEzP6e2A8Di5zMiF' });
    assert.deepStrictEqual(snap.parseExternalKey('c4f0411b-047d-741a-3cd1-6feea93c03bf'), { kind: 'uuid', id: 'c4f0411b-047d-741a-3cd1-6feea93c03bf' });
    assert.strictEqual(snap.appId('Android'), 'com.snapchat.android');
    assert.strictEqual(snap.appId('iOS'), snap.PICABOO);
    assert.ok(snap.isSnapchatApp('com.snapchat.android') && snap.isSnapchatApp(snap.PICABOO) && !snap.isSnapchatApp('com.whatsapp'));
    const OWN = 'd57a4e83-bf02-4da2-8fb7-ca65be939d22', LABZY = '3c75669d-69da-4918-aab6-a8419bf9ba50';
    const friends = {};
    friends[snap.hexId(LABZY)] = { username: 'labzy2026', displayName: 'Labzy' };
    const out = snap.build({
        app: 'com.snapchat.android', accountId: OWN, friends: friends,
        messages: [
            { conversation: '12a1429e', serverId: 7, createdMs: 1793404122558, readMs: null, content: new Uint8Array([8, 7]), senderId: OWN, createdOnDevice: 1, remoteMediaCount: 1, isSaved: 0 },
            { conversation: '12a1429e', serverId: 9, createdMs: 1793404168858, readMs: 1793404179333, content: new Uint8Array([8, 9]), senderId: LABZY, createdOnDevice: 0, remoteMediaCount: 1, isSaved: 1 },
            { conversation: '12a1429e', serverId: 1, createdMs: 1793399534613, readMs: null, content: new Uint8Array([8, 1]), senderId: OWN, createdOnDevice: 1, remoteMediaCount: 0, isSaved: 0 },
        ],
        cacheRows: [{ key: '15116568751943e94ff764a3d4c183d5', context: 3, external: 'chat_snap.chat_snap-nGJdelEzP6e2A8Di5zMiF', createdMs: 1793404170349 }],
        notifications: [{ ms: 1793404168966, type: 'snap', category: null }],
        sources: { messages: { db: 'arroyo.db', table: 'conversation_message', queryId: 'role-messages' } },
    });
    const msgs = out.events.filter((e) => e.kind === 'snap-message');
    assert.strictEqual(msgs.length, 3);
    const sent = msgs.find((e) => e.serverId === 7);
    assert.strictEqual(sent.own, true);
    assert.strictEqual(sent.app, 'com.snapchat.android');
    assert.strictEqual(sent.plain, 'En snap eller bild skickas från den här telefonen i Snapchat');
    assert.match(sent.source.column, /sender_id/);
    const recv = msgs.find((e) => e.serverId === 9);
    assert.strictEqual(recv.own, false);
    assert.match(recv.text, /@labzy2026/);
    assert.match(recv.text, /sparad i chatten/);
    assert.strictEqual(recv.saved, true);
    const text = msgs.find((e) => e.serverId === 1);
    assert.strictEqual(text.hasMediaKey, false);
    assert.strictEqual(text.plain, 'Ett meddelande skickas från den här telefonen i Snapchat');
    assert.ok(out.events.some((e) => e.kind === 'snap-read' && e.plain === 'Den öppnas på den här telefonen'));
    const cache = out.events.find((e) => e.kind === 'snap-cache');
    assert.match(cache.text, /chattsnap nGJdelEz/);
    assert.strictEqual(cache.app, 'com.snapchat.android');
    const notif = out.events.find((e) => e.kind === 'snap-notification');
    assert.strictEqual(notif.text, 'Snapchat-notis: snap');
});

test('Android: Memories ger tagning och sparning, kopplas till filen i galleriet, journalen ger story-posten', () => {
    const memories = [
        { id: 'A', mediaType: 0, front: 1, capturedMs: 1793404131479, createdMs: 1793404132805, width: 1080, height: 1920, hasLocation: 1, latitude: 59.464596, longitude: 17.8125206, zone: 'Europe/Stockholm' },
        { id: 'B', mediaType: 1, front: 0, capturedMs: 1793404110546, createdMs: 1793404118356, width: 720, height: 1280, duration: 5.41, hasLocation: 1, latitude: 59.464596, longitude: 17.8125206 },
    ];
    const out = snap.build({
        app: 'com.snapchat.android', memories: memories, file: { addedMs: 1793404132000, video: false },
        journal: [
            { key: 'C025B6FF.posted_story_snap', timeMs: 1793399329955, size: 975137, path: '/data/data/com.snapchat.android/files/file_manager/posted_story_snap' },
            { key: 'X.bitmoji_avatar', timeMs: 1793399525684, path: '/data/data/com.snapchat.android/files/file_manager/bitmoji_avatar' },
        ],
    });
    assert.ok(out.memory);
    assert.strictEqual(out.memory.row.id, 'A');
    assert.strictEqual(out.memory.deltaMs, 805);
    const cap = out.events.find((e) => e.kind === 'snap-memory' && e.captured && e.isFile);
    assert.strictEqual(cap.ms, 1793404131479);
    assert.strictEqual(cap.plain, 'Den bedömda bilden tas med Snapchats frontkamera på den här telefonen');
    assert.match(cap.text, /1080×1920/);
    assert.strictEqual(cap.bold, true);
    const vid = out.events.find((e) => e.kind === 'snap-memory' && e.captured && e.video);
    assert.strictEqual(vid.isFile, false);
    assert.strictEqual(vid.plain, 'En video spelas in med Snapchats bakre kamera på den här telefonen');
    assert.match(vid.text, /inspelningens slut/);
    assert.match(vid.text, /5,4 s/);
    assert.strictEqual(out.events.filter((e) => e.kind === 'snap-memory' && !e.captured).length, 2);
    const story = out.events.find((e) => e.kind === 'snap-journal');
    assert.strictEqual(story.folder, 'posted_story_snap');
    assert.strictEqual(story.plain, 'En story-snap lagras av Snapchat på den här telefonen');
    assert.ok(out.notes.some((n) => /1 poster i Snapchats filhanterare/.test(n)));
    // Videon kopplas inte till en bildfil, och utanför 5 s ingen koppling.
    assert.strictEqual(snap.linkMemory(memories, { addedMs: 1793404118000, video: false }), null);
    assert.strictEqual(snap.linkMemory(memories, { addedMs: 1793404118000, video: true }).row.id, 'B');
    assert.strictEqual(snap.linkMemory(memories, { addedMs: 1793404200000, video: false }), null);
});

test('Android: chattmediets nyckel kopplas till meddelandet via id:t i protobufen', () => {
    const SNAP = 'nGJdelEzP6e2A8Di5zMiF';
    const content = Uint8Array.from([...len(4, [...len(3, [...str(1, SNAP + '2'), ...str(2, 'msmnZ7L4agNy70i1XLsDvMVZQIY7iLwgD434Yqr+kJc=')])])]);
    const other = Uint8Array.from([...len(4, [...str(1, 'UUtlM1m1pSfSzl9wR2ixS_1')])]);
    const LABZY = '3c75669d-69da-4918-aab6-a8419bf9ba50';
    const messages = [
        { conversation: '12a1429e', serverId: 7, createdMs: 1793404122558, content: other, senderId: 'd57a4e83-bf02-4da2-8fb7-ca65be939d22', createdOnDevice: 1, remoteMediaCount: 1 },
        { conversation: '12a1429e', serverId: 9, createdMs: 1793404168858, readMs: 1793404179333, content: content, senderId: LABZY, createdOnDevice: 0, remoteMediaCount: 1, isSaved: 1 },
    ];
    assert.strictEqual(snap.messageForSnapId(messages, SNAP).serverId, 9);
    assert.strictEqual(snap.messageForSnapId(messages, 'finnsinte'), null);
    const out = snap.build({ app: 'com.snapchat.android', accountId: 'd57a4e83-bf02-4da2-8fb7-ca65be939d22', messages: messages, fileKey: '15116568751943e94ff764a3d4c183d5',
        cacheRows: [{ key: '15116568751943e94ff764a3d4c183d5', context: 3, external: 'chat_snap.chat_snap-' + SNAP, createdMs: 1793404170349 }] });
    assert.ok(out.link && out.link.message);
    assert.strictEqual(out.link.message.serverId, 9);
    assert.strictEqual(out.link.external.kind, 'chat');
    const fileEv = out.events.find((e) => e.kind === 'snap-cache' && e.isFile);
    assert.match(fileEv.text, /meddelande 9/);
    assert.strictEqual(fileEv.plain, 'Den bedömda filen läggs i Snapchat-chattens cache');
    assert.ok(out.events.some((e) => e.kind === 'snap-message' && e.isFile && e.own === false));
});
