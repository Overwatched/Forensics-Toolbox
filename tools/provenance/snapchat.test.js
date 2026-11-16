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
    assert.strictEqual(cap.plain, 'Den bedömda bilden tas med Snapchats frontkamera');
    assert.match(cap.text, /1080×1920/);
    assert.strictEqual(cap.bold, true);
    const vid = out.events.find((e) => e.kind === 'snap-memory' && e.captured && e.video);
    assert.strictEqual(vid.isFile, false);
    assert.strictEqual(vid.plain, 'En video spelas in med Snapchats bakre kamera');
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

// ---------- Memories på iOS (scdb-27) och skickade snaps i iOS 26 ----------

const SNAP_ID = 'EA2FB166-0000-4000-8000-00000000AAAA';
const OWN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const FRIEND = 'c5ba9ace-1384-4921-bcbd-e4b50503e358';

test('externa nycklar i iOS 26: Memories-filen och förhandsbilden har snappens id, en skickad snap två id:n', () => {
    assert.deepStrictEqual(snap.parseExternalKey('snap-media-' + SNAP_ID.toLowerCase()), { kind: 'memory', snapId: SNAP_ID, part: 'media' });
    assert.deepStrictEqual(snap.parseExternalKey('snap-rendered-lowres-' + SNAP_ID), { kind: 'memory', snapId: SNAP_ID, part: 'lowres' });
    const sent = snap.parseExternalKey('B9870000-1111-4222-8333-444444444444~85350000-5555-4666-8777-888888888888');
    assert.deepStrictEqual(sent, { kind: 'sent', recipient: null, mediaId: '85350000-5555-4666-8777-888888888888', refs: ['b9870000-1111-4222-8333-444444444444', '85350000-5555-4666-8777-888888888888'] });
    // Den äldre formen med användarnamnet först är kvar.
    assert.strictEqual(snap.parseExternalKey('erik.lind~' + SNAP_ID).recipient, 'erik.lind');
    assert.strictEqual(snap.contextInfo(19).show, true);
    assert.strictEqual(snap.contextInfo(26).show, false);
});

test('iOS: cachefilen med snappens id kopplas till snappen i Memories, och tiderna har scdb-27:s kolumner', () => {
    const T = 1794427771328;
    const mem = { id: SNAP_ID, mediaType: 0, front: 0, capturedMs: T, createdMs: T + 10026, zone: 'Europe/Stockholm', width: 1008, height: 1792, latitude: 59.3, longitude: 18.1 };
    const other = { id: 'FFFFFFFF-0000-4000-8000-000000000000', mediaType: 0, front: 1, capturedMs: T + 5000, createdMs: T + 6000 };
    const out = snap.build({
        accountId: OWN, cacheRows: [
            { key: 'ac100f66cf12423f31dc3addae6f1ab9', context: 19, external: 'snap-media-' + SNAP_ID.toLowerCase(), createdMs: T + 10100 },
            { key: '02fe6eaa95b0baaf7eb5c3b345725244', context: 26, external: 'snap-rendered-lowres-' + SNAP_ID.toLowerCase(), createdMs: T + 10100 },
        ],
        memories: [other, mem], fileKey: 'ac100f66cf12423f31dc3addae6f1ab9',
        memoryColumns: { captured: 'ZCAPTURETIMEUTC', created: 'ZCREATETIMEUTC', front: 'ZCAMERAFRONTFACING', type: 'ZMEDIATYPE' },
        sources: { memories: { db: 'scdb-27.sqlite3', table: 'ZGALLERYSNAP' } },
    });
    assert.strictEqual(out.memory.row, mem, 'kopplad på id:t, inte på närmaste tid');
    assert.strictEqual(out.memory.by, 'id');
    assert.strictEqual(out.link.external.kind, 'memory');
    const fileEvents = out.events.filter((e) => e.isFile);
    assert.deepStrictEqual(fileEvents.map((e) => e.kind).sort(), ['snap-cache', 'snap-memory', 'snap-memory']);
    const cap = out.events.find((e) => e.kind === 'snap-memory' && e.captured && e.isFile);
    assert.match(cap.text, /bild tagen med bakre kameran \(ZCAPTURETIMEUTC\), 1008×1792/);
    assert.strictEqual(cap.source.column, 'ZCAPTURETIMEUTC, ZCAMERAFRONTFACING, ZMEDIATYPE');
    assert.strictEqual(cap.source.db, 'scdb-27.sqlite3');
    assert.match(out.events.find((e) => e.kind === 'snap-memory' && !e.captured && e.isFile).text, /sparas i Memories \(ZCREATETIMEUTC\), tidszon Europe\/Stockholm/);
    const cache = out.events.find((e) => e.kind === 'snap-cache' && e.isFile);
    assert.match(cache.text, /typ 19 \(Memories, sparad snap\), snap EA2FB166…/);
    assert.strictEqual(cache.plain, 'Den bedömda filen sparas i Snapchats Memories');
    assert.ok(!out.events.some((e) => e.context === 26), 'förhandsbilden visas inte');
    // Utan raden i Memories: ingen koppling.
    assert.strictEqual(snap.build({ cacheRows: [{ key: 'ac100f66cf12423f31dc3addae6f1ab9', context: 19, external: 'snap-media-' + SNAP_ID, createdMs: T }], memories: [other], fileKey: 'ac100f66cf12423f31dc3addae6f1ab9' }).memory, null);
});

test('iOS 26: en skickad snap kopplas till meddelandet via local_message_references, och chatten får mottagarens namn', () => {
    const T = 1794427782823;
    const a = 'b9870000-1111-4222-8333-444444444444', b = '85350000-5555-4666-8777-888888888888';
    const refs = new Uint8Array(Buffer.from('\x0a\x24' + a + '\x12\x24' + b.toUpperCase(), 'latin1'));
    const msg = { conversation: 'c0c0c0c0-0000-4000-8000-000000000001', serverId: 6, createdMs: T + 50, content: new Uint8Array(message({ sender: Buffer.from(OWN.replace(/-/g, ''), 'hex') })), refs };
    const out = snap.build({
        accountId: OWN, friends: { [FRIEND.replace(/-/g, '')]: { username: 'anna.berg' } },
        members: { 'c0c0c0c0-0000-4000-8000-000000000001': [OWN, FRIEND] },
        cacheRows: [{ key: '254cb3fb2413cd3c24969cb8fd77be5f', context: 3, external: a.toUpperCase() + '~' + b.toUpperCase(), createdMs: T }],
        messages: [msg], fileKey: '254cb3fb2413cd3c24969cb8fd77be5f',
    });
    assert.strictEqual(out.link.message, msg);
    const e = out.events.find((x) => x.kind === 'snap-cache');
    assert.match(e.text, /skickad till @anna\.berg \(meddelande 6, local_message_references\)/);
    assert.strictEqual(e.plain, 'Den bedömda filen skickas till @anna.berg från den här telefonen');
    assert.strictEqual(e.sentTo, '@anna.berg');
    // Utan meddelandet: skickad, utan mottagare.
    const alone = snap.build({ accountId: OWN, cacheRows: [{ key: 'x', context: 3, external: a + '~' + b, createdMs: T }] });
    assert.match(alone.events[0].text, /typ 3 \(chattmedia\), skickad, nyckel/);
    assert.strictEqual(alone.events[0].plain, 'En snap eller bild skickas från den här telefonen');
});

test('nyckeln till en sparad snaps fil ur arkivet i ZENCRYPTION, utfyllnaden och bildjämförelsen', () => {
    const key = new Uint8Array(32).fill(7), iv = new Uint8Array(16).fill(9);
    const archive = { $top: { root: { value: 1 } }, $objects: ['$null', { $class: { value: 4 }, KEY: { value: 2 }, IV: { value: 3 }, IS_ENCRYPTED: false }, key, iv, { $classname: 'SCMemoriesSnapEncryption' }] };
    const c = snap.memoryCipher(archive);
    assert.deepStrictEqual([c.key, c.iv, c.encrypted], [key, iv, false]);
    const b64 = { $objects: ['$null', { KEY: Buffer.from(key).toString('base64'), IV: Buffer.from(iv).toString('base64') }] };
    assert.deepStrictEqual(Array.from(snap.memoryCipher(b64).key), Array.from(key));
    assert.strictEqual(snap.memoryCipher({ $objects: ['$null', { KEY: new Uint8Array(16), IV: iv }] }), null, 'fel längd');
    assert.deepStrictEqual(Array.from(snap.unpad(new Uint8Array([1, 2, 3, 1]))), [1, 2, 3]);
    assert.deepStrictEqual(Array.from(snap.unpad(new Uint8Array([1, 2, 2, 2]))), [1, 2], 'två byte med värdet 2');
    assert.deepStrictEqual(Array.from(snap.unpad(new Uint8Array([1, 2, 3, 2]))), [1, 2, 3, 2], 'fel utfyllnad lämnas');
    assert.strictEqual(snap.grayDiff([10, 20, 30], [12, 18, 30]), 4 / 3);
    assert.strictEqual(snap.grayDiff([1, 2], [1]), null);
    assert.strictEqual(snap.SAME_IMAGE_DIFF, 4);
});

test('JPEG utan EXIF och andra APP-segment: den exporterade bilden har samma bytes som filen i Memories', () => {
    const seg = (m, body) => [0xff, m, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
    const core = [...seg(0xdb, [1, 2, 3]), ...seg(0xc0, [4, 5]), ...seg(0xda, [6]), 9, 9, 9, 0xff, 0xd9];
    const memory = new Uint8Array([0xff, 0xd8, ...core]);
    const exported = new Uint8Array([0xff, 0xd8, ...seg(0xe1, [...Buffer.from('Exif\0\0'), 7, 7]), ...seg(0xe0, [8]), ...seg(0xfe, [1]), ...core]);
    assert.deepStrictEqual(Array.from(snap.jpegCore(exported)), Array.from(memory));
    assert.ok(snap.sameBytes(snap.jpegCore(exported), snap.jpegCore(memory)));
    assert.strictEqual(snap.jpegCore(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null, 'inte en JPEG');
    assert.strictEqual(snap.jpegCore(new Uint8Array([0xff, 0xd8, ...seg(0xe1, [1])])), null, 'ingen bilddata');
    assert.ok(!snap.sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3])));
});

test('video i Memories: på Android är tagningstiden inspelningens slut, på iOS är det inte kontrollerat', () => {
    const mem = { id: SNAP_ID, mediaType: 1, front: 0, capturedMs: 1000, createdMs: 2000, duration: 5 };
    const android = snap.build({ memories: [mem] }).events.find((e) => e.captured);
    assert.match(android.text, /video tagen med bakre kameran \(snap_capture_time, inspelningens slut\)/);
    const ios = snap.build({ memories: [mem], memoryColumns: { captured: 'ZCAPTURETIMEUTC', created: 'ZCREATETIMEUTC', front: 'ZCAMERAFRONTFACING', type: 'ZMEDIATYPE' } }).events.find((e) => e.captured);
    assert.match(ios.text, /video tagen med bakre kameran \(ZCAPTURETIMEUTC, start eller slut är inte kontrollerat på iOS\)/);
});

// Labbet 2026-11-16 (Android 13, Snapchat 14.32): inställningen, radernas ursprung, kopian i galleriet och videons längd.
test('inställningen Spara till: värdet i ord, och row_version 0 är standardvärdet', () => {
    const lab = snap.saveSetting({ value: 'MEMORIES_AND_CAMERA_ROLL', version: 8, updatedMs: 1793399506269 });
    assert.deepStrictEqual([lab.label, lab.copies, lab.changed, lab.updatedMs], ['Memories och kamerarullen', true, true, 1793399506269]);
    const samsung = snap.saveSetting({ value: 'MEMORIES', version: 0, updatedMs: 1764851126269 });
    assert.deepStrictEqual([samsung.label, samsung.copies, samsung.changed], ['bara Memories', false, false]);
    assert.strictEqual(snap.saveSetting({ value: 'CAMERA_ROLL', version: 3 }).label, 'bara kamerarullen');
    assert.strictEqual(snap.saveSetting({ value: 'NYTT_VARDE', version: 1 }).known, false);
    assert.strictEqual(snap.saveSetting(null), null);
});

const T0 = Date.parse('2026-11-16T20:46:12.512Z');
const local = { id: '0b09cbdd-c180-5e94-9b13-6f9856d2b313', mediaType: 0, capturedMs: T0, createdMs: T0 + 3945, front: 0 };
const synced = Object.assign({}, local, { createdMs: T0 });
const roll = { id: '26753c8c-0000-0000-0000-000000000000', mediaType: 0, capturedMs: Date.parse('2026-11-16T20:46:16Z'), createdMs: Date.parse('2026-11-16T21:12:58.591Z'), cameraRollId: '1000000100', entryId: 'featured' };

test('ursprunget: sparad på telefonen, hämtad från servern eller en bild ur kamerarullen', () => {
    assert.strictEqual(snap.memoryOrigin(local).local, true);
    assert.strictEqual(snap.memoryOrigin(synced).synced, true);
    const r = snap.memoryOrigin(roll);
    assert.deepStrictEqual([r.cameraRoll, r.mediaStoreId, r.featured, r.local], [true, 1000000100, true, false]);
    // Android 16 (Samsung): camera_roll_id är ett uuid, inte MediaStores _id.
    assert.strictEqual(snap.memoryOrigin(Object.assign({}, roll, { cameraRollId: '7b373245-1dc5-4f8e-aaf9-1c90112a72d5' })).mediaStoreId, null);
    const meo = snap.memoryOrigin({ capturedMs: 1, createdMs: 2, private: 1, copyFrom: '20da2619-695a-157f-6bc2-6f38423f79c5' });
    assert.deepStrictEqual([meo.private, meo.copyOf], [true, '20da2619-695a-157f-6bc2-6f38423f79c5']);
});

test('kopian i galleriet: samma sekund som snappen sparades är den automatiska, senare är en export', () => {
    const added = (iso) => Date.parse(iso);
    assert.strictEqual(snap.copyKind(local, added('2026-11-16T20:46:16Z')), 'auto');
    assert.strictEqual(snap.copyKind(local, added('2026-11-16T20:51:48Z')), 'export');
    // En rad från servern har ingen sparad-tid, så det går inte att säga.
    assert.strictEqual(snap.copyKind(synced, added('2026-11-16T20:46:16Z')), null);
    // En rad ur kamerarullen är inte filens ursprung och kopplas inte på tiden.
    assert.strictEqual(snap.linkMemory([roll], { addedMs: roll.createdMs, video: false }), null);
    assert.strictEqual(snap.linkMemory([local, roll], { addedMs: added('2026-11-16T20:46:16Z'), video: false }).row, local);
});

test('en exporterad video kopplas på längden när en enda video har den', () => {
    const v1 = { id: 'a', mediaType: 1, duration: 6.609 };
    const v2 = { id: 'b', mediaType: 1, duration: 5.41 };
    const hit = snap.linkVideoByDuration([v1, v2], { durationMs: 6618 });
    assert.deepStrictEqual([hit.row, hit.by, hit.diffMs], [v1, 'duration', 9]);
    assert.strictEqual(snap.linkVideoByDuration([v1, Object.assign({}, v1, { id: 'c' })], { durationMs: 6618 }), null);
    assert.strictEqual(snap.linkVideoByDuration([v1], { durationMs: 6900 }), null);
});

test('Snapchats namn i galleriet, som säger att filen är Snapchats när owner_package_name är tom', () => {
    assert.ok(snap.isGalleryName('DCIM/Snapchat/', 'Snapchat-962738617.jpg'));
    assert.ok(snap.isGalleryName('DCIM/Snapchat', 'Snapchat-254258240.mp4'));
    assert.ok(!snap.isGalleryName('DCIM/Camera/', 'Snapchat-962738617.jpg'));
    assert.ok(!snap.isGalleryName('DCIM/Snapchat/', 'IMG_0001.jpg'));
});

test('händelserna: en rad från servern får ingen sparad-tid, en bild ur kamerarullen ingen tagning, och ingen mening säger "på den här telefonen"', () => {
    const ev = snap.build({ memories: [synced, roll, Object.assign({}, local, { id: 'x', private: 1, copyFrom: 'y' })] }).events;
    assert.strictEqual(ev.filter((e) => e.memoryId === synced.id && !e.captured).length, 0);
    assert.match(ev.find((e) => e.memoryId === synced.id).text, /hämtad från Snapchats server/);
    assert.deepStrictEqual(ev.filter((e) => e.memoryId === roll.id).map((e) => [e.captured, e.fromCameraRoll]), [[false, true]]);
    assert.ok(ev.every((e) => !/den här telefonen/.test(e.plain || '')));
    assert.match(ev.find((e) => e.memoryId === 'x' && !e.captured).text, /i My Eyes Only/);
});

test('rad från servern: Memories-postens tid är tiden då snappen sparades, och kopian känns igen på den', () => {
    const fromServer = Object.assign({}, synced, { entryCreatedMs: T0 + 3949 });
    const o = snap.memoryOrigin(fromServer);
    assert.deepStrictEqual([o.synced, o.savedMs, o.savedFrom], [true, T0 + 3949, 'entry']);
    assert.strictEqual(snap.copyKind(fromServer, Date.parse('2026-11-16T20:46:16Z')), 'auto');
    const ev = snap.build({ memories: [fromServer] }).events.find((e) => !e.captured);
    assert.deepStrictEqual([ev.ms, ev.source.column], [T0 + 3949, 'memories_entry.create_time']);
    assert.strictEqual(snap.linkMemory([fromServer], { addedMs: Date.parse('2026-11-16T20:46:16Z'), video: false }).deltaMs, 3949 - 3488);
});

test('meddelanden från kontot: den här telefonen, Snapchat för webben, en annan enhet, eller okänt efter en ominstallation', () => {
    const OWN = 'd57a4e83-bf02-4da2-8fb7-ca65be939d22';
    const ctx = { accountId: OWN, installMs: Date.parse('2026-11-16T21:12:04Z') };
    const own = OWN.replace(/-/g, '');
    const web = Uint8Array.from(len(1, str(4, 'https://www.snapchat.com/web/mobile-landing.html?ref=web_snap_context')));
    const at = (iso) => Date.parse(iso);
    assert.strictEqual(snap.sentFrom({ createdOnDevice: 1, createdMs: at('2026-11-16T20:49:01Z') }, own, ctx).device, 'this');
    assert.strictEqual(snap.sentFrom({ createdOnDevice: 0, createdMs: at('2026-11-16T22:16:10Z'), content: web }, own, ctx).device, 'web');
    assert.strictEqual(snap.sentFrom({ createdOnDevice: 0, createdMs: at('2026-11-16T22:11:51Z') }, own, ctx).device, 'other');
    assert.strictEqual(snap.sentFrom({ createdOnDevice: 0, createdMs: at('2026-11-16T20:49:01Z') }, own, ctx).device, 'unknown');
    assert.strictEqual(snap.sentFrom({ createdOnDevice: 0 }, '3c75669d8b0b4ec1a9f1e3d1c0b2a4f5', ctx).ownAccount, false);
    // I tidslinjen är ett meddelande från kontot skickat (▲) också när en annan enhet skapade det.
    const out = snap.build(Object.assign({}, ctx, { messages: [{ conversation: '12a1429e-0000-0000-0000-000000000000', serverId: 15, createdMs: at('2026-11-16T22:16:10Z'), senderId: OWN, createdOnDevice: 0, remoteMediaCount: 1, content: web }] }));
    const m = out.events.find((e) => e.kind === 'snap-message');
    assert.deepStrictEqual([m.own, m.device], [true, 'web']);
    assert.match(m.text, /Snapchat för webben/);
    assert.match(m.plain, /inte från den här telefonen/);
});
