// Telegram i Härkomst (iOS): filen själv under postbox/media/, bilder ur bildbiblioteket enligt
// lagringsdatabasen, den möjliga kopplingen för en bild som Telegram sparat, Telegrams kamera,
// händelserna och faktorn. Raderna efterliknar labbsessionen (iOS 26.4.1, Telegram 13.1.2,
// 2026-11-03); namnen är påhittade.

const test = require('node:test');
const assert = require('node:assert');
const tg = require('./telegram');
const core = require('./timeline-core');

const T0 = Date.parse('2026-11-03T12:18:00+01:00');
const at = (sec) => T0 + Math.round(sec * 1000);
const fmt = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const PEER = '37000000001';
const LIB_CAM = 'E0A969AD-D0EE-4693-97EE-DEF992DAD88A';       // kamerabild, vald i Telegram
const LIB_WA = 'E941DA81-9350-4995-B0BD-A64220125303';        // WhatsApps kamerabild, vald i Telegram
const LIB_ONCE = '1CDBE725-88EC-4C02-A4AB-61698641FB82';      // vald som engångsbild
const base = { peerId: PEER, peerType: 0, peerTgId: '7000000002', namespace: 0, chatName: 'Kim' };

const res = (messageId, sec, size, w, h, opts) => Object.assign({}, base, {
    resourceId: 'telegram-cloud-photo-size-4-60' + messageId + '-' + (w > 1000 ? 'w' : 'y'), role: 'bild', size: size, width: w, height: h, messageId: messageId,
    timeMs: at(sec), incoming: 0, media: 'bild', viewOnce: 0, sender: 'den här telefonen',
}, opts || {});
// Resurserna: en per meddelande med media (de mindre storlekarna behövs inte här).
const RESOURCES = [
    res(2, 27, 34707, 960, 1280),
    res(3, 33, 121344, 1440, 2560),
    res(4, 42, 163066, 1440, 2560),
    res(5, 49, 262257, 1152, 2048, { viewOnce: 1 }),
    res(6, 72, 35213, 960, 1280),
    Object.assign({}, base, { resourceId: 'telegram-cloud-document-4-6008', role: 'video', size: 114165, width: 464, height: 848, messageId: 8, timeMs: at(112), incoming: 0, media: 'video', viewOnce: 0, sender: 'den här telefonen' }),
    Object.assign({}, base, { resourceId: 'telegram-cloud-document-size-4-6008-m', role: 'miniatyr', size: null, width: 175, height: 320, messageId: 8, timeMs: at(112), incoming: 0, media: 'video', viewOnce: 0, sender: 'den här telefonen' }),
];
const msg = (id, sec, media, opts) => Object.assign({}, base, { id: id, timeMs: at(sec), incoming: 0, media: media, viewOnce: 0, sender: 'den här telefonen' }, opts || {});
const MESSAGES = [
    msg(1, 11, null, { hasText: 1 }),
    msg(2, 27, 'bild'), msg(3, 33, 'bild'), msg(4, 42, 'bild'), msg(5, 49, 'bild', { viewOnce: 1 }), msg(6, 72, 'bild', { hasText: 1 }),
    msg(7, 91, 'samtal', { action: 14 }), msg(8, 112, 'video'),
];
const store = (uuid, size) => ({ resourceId: 'ph-' + uuid + '_L0_001--123', contentType: 0, size: size, peerId: PEER, peerType: 0, peerTgId: '7000000002', messageNamespace: 0, messageId: null, libraryUuid: uuid });
const STORAGE = [
    store(LIB_CAM, 34707), store(LIB_WA, 121344), store(LIB_ONCE, 262257),
    { resourceId: 'local-file-854', contentType: 1, size: 163066, peerId: PEER, peerType: 0, peerTgId: '7000000002', messageNamespace: 0, messageId: null, libraryUuid: null },
    { resourceId: 'telegram-cloud-photo-size-4-604-w', contentType: 1, size: 0, peerId: PEER, peerType: 0, peerTgId: '7000000002', messageNamespace: 0, messageId: 4, libraryUuid: null },
    { resourceId: 'telegram-cloud-photo-size-4-699-w', contentType: 1, size: 0, peerId: PEER, peerType: 0, peerTgId: '7000000002', messageNamespace: 0, messageId: 99, libraryUuid: null },
];
const ctx = (o) => Object.assign({ resources: RESOURCES, storage: STORAGE, storageRead: true, messages: MESSAGES }, o);

test('vald ur bildbiblioteket: lagringsdatabasens id och samma storlek pekar ut meddelandet', () => {
    const out = tg.build(ctx({ uuid: LIB_CAM.toLowerCase(), createdMs: at(-124) }));
    assert.deepStrictEqual(out.link.picks.map((p) => [p.uuid, p.size, p.messages.map((m) => m.messageId)]), [[LIB_CAM, 34707, [2]]]);
    assert.deepStrictEqual(out.link.nearby, []);
    assert.deepStrictEqual(out.events.filter((e) => e.isFile).map((e) => [e.messageId, e.plain]), [[2, 'Den bedömda filen skickas från den här telefonen i Telegram till Kim']]);
    assert.ok(out.events.find((e) => e.messageId === 3).fromLibrary, 'en annan bild ur biblioteket märks också');
    const f = core.factorTelegram({ file: { createdMs: at(-124) }, format: fmt, telegram: { link: out.link } }, { type: 'camera', importer: 'com.apple.camera' });
    assert.deepStrictEqual([f.state, f.verdictText], ['info', 'Skickad i Telegram']);
    assert.match(f.items[0].text, /ph-E0A969AD.*34707 byte, lika stor som bilden i meddelandet/);
    assert.match(f.plain, /^Filen valdes ur bildbiblioteket och skickades i Telegram till Kim, 2 min 31 s efter T\. Det säger inget om hur den skapades\.$/);
    // Engångsbilden ur bildbiblioteket.
    const once = tg.build(ctx({ uuid: LIB_ONCE, createdMs: at(-1e5) }));
    const fo = core.factorTelegram({ file: { createdMs: at(-1e5) }, format: fmt, telegram: { link: once.link } }, { type: 'saved', importer: 'org.whispersystems.signal' });
    assert.match(fo.plain, /, för engångsvisning\./);
    assert.ok(once.events.find((e) => e.messageId === 5).viewOnce);
});

test('vald ur bildbiblioteket utan meddelande, och flera som passar', () => {
    const lone = tg.build(ctx({ uuid: 'AAAAAAAA-0000-0000-0000-000000000000', storage: STORAGE.concat([store('AAAAAAAA-0000-0000-0000-000000000000', 999)]), createdMs: at(0) }));
    const f = core.factorTelegram({ file: { createdMs: at(0) }, format: fmt, telegram: { link: lone.link } }, { type: 'camera' });
    assert.deepStrictEqual([f.state, f.verdictText], ['info', 'Vald i Telegram']);
    assert.match(f.items[0].text, /Inget meddelande i chatten har en bild av samma storlek/);
    const twin = tg.build(ctx({ uuid: LIB_CAM, resources: RESOURCES.concat([res(9, 200, 34707, 960, 1280)]), createdMs: at(0) }));
    assert.deepStrictEqual(twin.link.picks[0].messages.map((m) => m.messageId), [2, 9]);
    assert.ok(!twin.events.some((e) => e.isFile), 'två som passar: ingen märks som filen');
    const f2 = core.factorTelegram({ file: { createdMs: at(0) }, format: fmt, telegram: { link: twin.link } }, { type: 'camera' });
    assert.match(f2.items[0].text, /2 meddelanden har en bild av samma storlek \(2, 9\)/);
});

test('sparad av Telegram: det första skickade meddelandet strax efter, inte en bild ur biblioteket', () => {
    const saved = { savedByTelegram: true };
    assert.deepStrictEqual(tg.build(ctx(Object.assign({ createdMs: at(40.6) }, saved))).link.nearby.map((n) => [n.messageId, n.afterMs]), [[4, 1400]]);
    // Meddelande 5 ligger närmast men är en bild ur bildbiblioteket (4 ligger mer än 1 s före T).
    assert.deepStrictEqual(tg.build(ctx(Object.assign({ createdMs: at(43.5) }, saved))).link.nearby.map((n) => n.messageId), [6]);
    // En video kopplas till en video.
    assert.deepStrictEqual(tg.build(ctx(Object.assign({ createdMs: at(106), video: true }, saved))).link.nearby.map((n) => [n.messageId, n.kind]), [[8, 'video']]);
    assert.deepStrictEqual(tg.build(ctx({ createdMs: at(40.6) })).link.nearby, [], 'bara för filer som Telegram sparade');
    assert.deepStrictEqual(tg.build(ctx(Object.assign({ createdMs: at(400) }, saved))).link.nearby, [], 'inget inom en minut');

    const type = { type: 'saved', importer: tg.APP };
    const near = tg.build(ctx(Object.assign({ createdMs: at(63), originalFilename: 'camphoto_869693583.jpg', camera: { path: 'Containers/Data/Application/APP/tmp/camphoto_869693583.jpg', same: true } }, saved)));
    const f = core.factorTelegram({ file: { createdMs: at(63) }, format: fmt, telegram: { link: near.link } }, type);
    assert.deepStrictEqual([f.state, f.verdictText], ['info', 'Möjlig koppling']);
    assert.match(f.plain, /en bild skickades i Telegram 9 s senare\. Det kan vara samma bild; bara tiden binder ihop dem\./);
    const none = core.factorTelegram({ file: { createdMs: at(400) }, format: fmt, telegram: { link: tg.build(ctx(Object.assign({ createdMs: at(400) }, saved))).link } }, type);
    assert.deepStrictEqual([none.state, none.verdictText], ['missing', 'Hittas inte']);
});

test('Telegrams kamera: namnet och samma fil i tmp/', () => {
    const cam = (c) => tg.build(ctx({ createdMs: at(63), savedByTelegram: true, originalFilename: 'camphoto_869693583.jpg', camera: c })).link.camera;
    const same = core.factorTelegramCamera(cam({ path: 'Containers/Data/Application/APP/tmp/camphoto_869693583.jpg', same: true }));
    assert.deepStrictEqual([same.title, same.state], ['Telegrams kamera', 'support']);
    assert.strictEqual(same.plain, 'Bilden togs med Telegrams kamera på den här telefonen.');
    const gone = core.factorTelegramCamera(cam(null));
    assert.deepStrictEqual([gone.state, gone.items[0].text], ['info', 'Originalnamnet camphoto_869693583.jpg är namnet Telegrams kamera ger en bild. Filen finns inte kvar i Telegrams tmp/.']);
    assert.match(core.factorTelegramCamera(cam({ path: 'tmp/camphoto_869693583.jpg', same: false })).items[0].text, /har en annan SHA-256\.$/);
    assert.match(core.factorTelegramCamera(cam({ path: 'tmp/camphoto_869693583.jpg', same: null })).items[0].text, /summorna kunde inte jämföras\.$/);
    assert.strictEqual(tg.build(ctx({ createdMs: at(63), savedByTelegram: true, originalFilename: '1d3e3590bc01ac93127041ea5da7a7b7.jpg' })).link.camera, null);
    assert.ok(tg.isCameraName('camvideo_45e3d7d1.mp4') && !tg.isCameraName('IMG_0035.JPG'));
    // I hela bedömningen ersätter Telegrams kamera skaparappen.
    const model = core.build({ platform: 'iOS', file: { createdMs: at(63), filename: 'IMG_0035.JPG', importer: tg.APP, importedBy: 3 }, format: fmt,
        telegram: { link: tg.build(ctx({ createdMs: at(63), savedByTelegram: true, originalFilename: 'camphoto_869693583.jpg', camera: { path: 'tmp/camphoto_869693583.jpg', same: true } })).link } });
    const c = model.factors.find((x) => x.id === 'camera');
    assert.deepStrictEqual([c.title, c.state, c.verdict], ['Telegrams kamera', 'support', 'Telegrams kamera']);
    assert.ok(model.factors.some((x) => x.id === 'telegram') && model.beta);
});

test('Telegrams egen fil under postbox/media/ hör till sitt meddelande', () => {
    const p = '/private/var/mobile/Containers/Shared/AppGroup/GROUP/telegram-data/account-1/postbox/media/telegram-cloud-photo-size-4-604-w';
    assert.strictEqual(tg.resourceFromPath(p + '_partial'), 'telegram-cloud-photo-size-4-604-w');
    assert.strictEqual(tg.resourceFromPath(p + '_partial.meta'), null);
    assert.strictEqual(tg.resourceFromPath('/x/media/telegram-cloud-photo-size-4-604-w'), null);
    const out = tg.build(ctx({ path: p, createdMs: at(42) }));
    assert.deepStrictEqual(out.link.matches.map((m) => [m.messageId, m.by, m.direction, m.path]), [[4, ['path'], 'out', 'postbox/media/telegram-cloud-photo-size-4-604-w']]);
    const chat = { app: tg.APP, appName: 'Telegram', direction: 'out', who: 'Kim', messageId: 4, path: 'postbox/media/telegram-cloud-photo-size-4-604-w', source: 'db_sqlite, t7' };
    const type = core.classify({ createdMs: at(42), filename: 'telegram-cloud-photo-size-4-604-w', chatMedia: chat }, 'iOS');
    assert.deepStrictEqual([type.importer, type.label], [tg.APP, 'Telegram-media utanför bildbiblioteket']);
    const f = core.factorTelegram({ file: { createdMs: at(42) }, format: fmt, telegram: { link: out.link } }, type);
    assert.deepStrictEqual([f.state, f.verdictText], ['support', 'Skickad i Telegram']);
    assert.match(f.plain, /^Filen är Telegrams kopia i meddelande 4, skickat till Kim /);
    // Meddelandet finns inte kvar i t7, men lagringsdatabasen säger vilket det var.
    const goneP = p.replace('604-w', '699-w');
    const gone = tg.build(ctx({ path: goneP, createdMs: at(42) }));
    assert.deepStrictEqual(gone.link.matches.map((m) => [m.messageId, m.by, m.gone]), [[99, ['path', 'storage'], true]]);
    const fg = core.factorTelegram({ file: { createdMs: at(42) }, format: fmt, telegram: { link: gone.link } }, Object.assign({}, type, { chat: Object.assign({}, chat, { messageId: 99 }) }));
    assert.deepStrictEqual([fg.state, fg.verdictText], ['info', 'Meddelandet finns inte kvar']);
    assert.match(fg.items[0].text, /meddelande 99 i chatten Telegram-id 7000000002, men meddelandet finns inte kvar i t7/);
});

test('ingen koppling, lagringsdatabasen saknas och felet', () => {
    const out = tg.build(ctx({ uuid: 'BBBBBBBB-0000-0000-0000-000000000000', createdMs: at(0), storage: [], storageRead: false }));
    const f = core.factorTelegram({ file: { createdMs: at(0) }, format: fmt, telegram: { link: out.link } }, { type: 'camera' });
    assert.deepStrictEqual([f.state, f.verdictText], ['info', 'Ingen koppling']);
    assert.match(f.items[0].text, /Telegrams 6 meddelanden med media\. Telegrams lagringsdatabas finns inte i zippen/);
    const err = core.factorTelegram({ file: { createdMs: at(0) }, telegram: { error: 'trasig' } }, { type: 'camera' });
    assert.deepStrictEqual([err.state, err.verdictText], ['missing', 'Kunde inte läsas']);
});

test('böjningen och motparten: meddelande skickat, bild skickad, samtal, grupp', () => {
    const out = tg.build({ messages: MESSAGES.concat([
        Object.assign(msg(20, 130, 'bild', { incoming: 1, sender: 'Alex' }), { peerType: 1, chatName: 'Klubben' }),
    ]), resources: RESOURCES, storage: STORAGE });
    const text = (id) => out.events.find((e) => e.messageId === id).text;
    assert.strictEqual(text(1), 'Telegram: meddelande skickat till Kim (meddelande 1)');
    assert.strictEqual(text(2), 'Telegram: bild skickad till Kim (meddelande 2), vald ur bildbiblioteket');
    assert.strictEqual(text(5), 'Telegram: bild skickad till Kim (meddelande 5), vald ur bildbiblioteket, engångsvisning');
    assert.strictEqual(text(7), 'Telegram: samtal till Kim, ingen längd registrerad (meddelande 7)');
    assert.strictEqual(text(8), 'Telegram: video skickad till Kim (meddelande 8)');
    assert.strictEqual(text(20), 'Telegram: bild mottagen från Alex i gruppen Klubben (meddelande 20)');
    assert.strictEqual(out.events.find((e) => e.messageId === 7).call, true);
});

test('en bild vald ur biblioteket behåller den möjliga kopplingen till kamerameddelandet', () => {
    const resources = [res(11, 21, 94297, 960, 1280), res(12, 49, 441431, 1920, 2560)];
    const out = tg.build({ uuid: LIB_CAM, savedByTelegram: true, createdMs: at(18), originalFilename: 'camphoto_1.jpg', resources: resources, storage: [store(LIB_CAM, 441431)], storageRead: true, messages: [] });
    assert.deepStrictEqual(out.link.picks[0].messages.map((m) => m.messageId), [12]);
    assert.deepStrictEqual(out.link.nearby.map((m) => m.messageId), [11]);
    const f = core.factorTelegram({ file: { createdMs: at(18) }, format: fmt, telegram: { link: out.link } }, { type: 'saved', importer: tg.APP });
    assert.strictEqual(f.verdictText, 'Skickad i Telegram');
    assert.match(f.items[1].text, /skickades också .*meddelande 11\)/);
});

test('en kamerafil i Telegrams tmp utan meddelande', () => {
    const t = { type: 'saved', importer: tg.APP, chatTemp: { app: tg.APP, appName: 'Telegram', path: 'tmp/camphoto_1.jpg' } };
    const out = tg.build({ savedByTelegram: true, createdMs: at(500), originalFilename: 'camphoto_1.jpg', resources: RESOURCES, storage: [], storageRead: true, messages: [] });
    const f = core.factorTelegram({ file: { createdMs: at(500) }, format: fmt, telegram: { link: out.link } }, t);
    assert.deepStrictEqual([f.state, f.verdictText], ['info', 'Inget meddelande']);
});

// ---------- Android ----------
// Raderna efterliknar labbet med två telefoner (Android 16, Telegram med versionskod 73031, 2026-11-11): en
// mottagen bild under Telegrams mapp, med bildens id i filnamnet och i meddelandets blobb. Id:n, namn och
// storlekar är påhittade.

const TG_DIR = 'Dump/data/media/0/Android/data/org.telegram.messenger/files/Telegram/Telegram Images/';
const PHOTO_ID = 5550001112223334445n;
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(n); return b; };
// Telegrams strängar: längden i en byte, innehållet, och utfyllnad till fyra byte.
const tlStr = (s) => { const body = Buffer.from(s, 'latin1'); const pad = (4 - ((1 + body.length) % 4)) % 4; return Buffer.concat([Buffer.from([body.length]), body, Buffer.alloc(pad)]); };
const sizeHex = (s) => (s.stripped ? Buffer.concat([u32(0xe0b0bc2e), tlStr(s.type), tlStr('abc')])
    : s.steps ? Buffer.concat([u32(0xfa3efb95), tlStr(s.type), u32(s.w), u32(s.h), u32(0x1cb5c415), u32(s.steps.length)].concat(s.steps.map(u32)))
        : s.unknown ? u32(0x0badf00d) : Buffer.concat([u32(0x75c78e60), tlStr(s.type), u32(s.w), u32(s.h), u32(s.size)]));
// En bild som den står i blobben, från bildens konstruktor: flaggor, id, åtkomstnyckel, filreferens, datum och storlekar.
const photoHex = (id, sizes) => Buffer.concat([u32(0xfb197a65), u32(0), i64(id), i64(77n), tlStr('filreferens'), u32(1794400000), u32(0x1cb5c415), u32(sizes.length)].concat(sizes.map(sizeHex))).toString('hex').toUpperCase();
const SIZES = [{ stripped: true, type: 'i' }, { type: 'm', w: 320, h: 240, size: 1234 }, { type: 'y', w: 1280, h: 960, steps: [9000, 30000, 54321] }];
const idHexOf = (id) => i64(id).toString('hex').toUpperCase();
const rowA = (id, sec, over) => Object.assign({ id: id, peerId: '7000000002', timeMs: at(sec), out: 0, peerType: 0, chatName: 'Kim', sender: 'Kim', mediaType: null, service: 0, hasText: 1, ctor: '7600B9D3' }, over || {});
const photoRow = (over) => rowA(40, 170, Object.assign({ mediaType: 0, hasText: 0, idOffset: 52, photoHex: photoHex(PHOTO_ID, SIZES) }, over || {}));
const MESSAGES_A = [
    rowA(38, 150, { out: 1, sender: 'den här telefonen' }),
    rowA(39, 160),
    rowA(40, 170, { mediaType: 0, hasText: 0 }),
    rowA(41, 180, { out: 1, sender: 'den här telefonen', mediaType: 2, hasText: 0 }),
    rowA(42, 190, { peerId: '-1000000000005', peerType: 1, chatName: 'Klubben', sender: 'Alex', mediaType: 1 }),
    rowA(43, 200, { peerId: '-1000000000006', peerType: 2, chatName: 'Nyheter', sender: 'Nyheter', mediaType: 0 }),
    rowA(44, 210, { service: 1, hasText: 0 }),
    rowA(45, 220, { mediaType: 9 }),
];

test('Android: filnamnet under Telegrams mapp bär bildens id med omvänt tecken och storlekens bokstav', () => {
    const n = tg.parseFileName(TG_DIR + '-5550001112223334445_121.jpg');
    assert.deepStrictEqual(n, { idHex: idHexOf(PHOTO_ID), sizeType: 'y', path: 'org.telegram.messenger/files/Telegram/Telegram Images/-5550001112223334445_121.jpg' });
    // Ett positivt tal i namnet är ett negativt id, och en kod som inte är en liten bokstav ger ingen storlek.
    assert.deepStrictEqual([tg.parseFileName(TG_DIR + '5550001112223334445_109.JPG').idHex, tg.parseFileName(TG_DIR + '5550001112223334445_109.JPG').sizeType], [idHexOf(-PHOTO_ID), 'm']);
    assert.strictEqual(tg.parseFileName(TG_DIR + '-5550001112223334445_33.jpg').sizeType, null);
    // Andra filer: utanför Telegrams mapp, ett annat namn, en annan filtyp, ett tal som inte ryms i 64 bitar.
    assert.strictEqual(tg.parseFileName('Dump/data/media/0/DCIM/Camera/-5550001112223334445_121.jpg'), null);
    assert.strictEqual(tg.parseFileName(TG_DIR + 'IMG_20261111_101500_123.jpg'), null);
    assert.strictEqual(tg.parseFileName(TG_DIR + '-5550001112223334445_121.mp4'), null);
    assert.strictEqual(tg.parseFileName(TG_DIR + '-99999999999999999999_121.jpg'), null);
    assert.strictEqual(tg.parseFileName(null), null);
    assert.strictEqual(tg.APP_ANDROID, 'org.telegram.messenger');
});

test('Android: bilden läses ur blobben, och det som inte är en bild i känd form läses inte', () => {
    const hex = photoHex(PHOTO_ID, SIZES);
    assert.deepStrictEqual(tg.parsePhoto(hex), { id: idHexOf(PHOTO_ID), complete: true,
        sizes: [{ type: 'i', w: null, h: null, size: null }, { type: 'm', w: 320, h: 240, size: 1234 }, { type: 'y', w: 1280, h: 960, size: 54321 }] });
    assert.deepStrictEqual(tg.parsePhoto(hex.toLowerCase()).id, idHexOf(PHOTO_ID));
    // Avklippt mitt i den sista storleken, och en storlek av okänd sort: det som lästes står kvar, och complete är falskt.
    const cut = tg.parsePhoto(hex.slice(0, -16));
    assert.deepStrictEqual([cut.sizes.map((s) => s.type), cut.complete], [['i', 'm'], false]);
    const odd = tg.parsePhoto(photoHex(PHOTO_ID, [{ type: 'm', w: 320, h: 240, size: 1234 }, { unknown: true }, { type: 'y', w: 1, h: 1, size: 1 }]));
    assert.deepStrictEqual([odd.sizes.length, odd.complete], [1, false]);
    assert.strictEqual(tg.parsePhoto('0DF0AD0B' + hex.slice(8)), null);
    assert.strictEqual(tg.parsePhoto(hex.slice(0, 40)), null);
    assert.strictEqual(tg.parsePhoto('inte hex'), null);
    assert.strictEqual(tg.parsePhoto(null), null);
});

test('Android: meddelandet som bär bilden, med filens storlek mot storleken i meddelandet', () => {
    const path = TG_DIR + '-5550001112223334445_121.jpg';
    const one = (ctx) => tg.matchAndroid(Object.assign({ path: path, photo: [photoRow()] }, ctx));
    assert.deepStrictEqual(one({ size: 54321 }).matches.map((x) => [x.row.id, x.size.size, x.sizeOk]), [[40, 54321, true]]);
    assert.strictEqual(one({ size: 54000 }).matches[0].sizeOk, false);
    assert.strictEqual(one({}).matches[0].sizeOk, null);
    // Storleken m i namnet jämförs med m i meddelandet, och en bokstav som meddelandet saknar kan inte jämföras.
    assert.strictEqual(tg.matchAndroid({ path: TG_DIR + '-5550001112223334445_109.jpg', photo: [photoRow()], size: 1234 }).matches[0].sizeOk, true);
    assert.deepStrictEqual(tg.matchAndroid({ path: TG_DIR + '-5550001112223334445_120.jpg', photo: [photoRow()], size: 1234 }).matches.map((x) => [x.size, x.sizeOk]), [[null, null]]);
    // Id:t på ett annat ställe i blobben (inte på en fyrbytesgräns, eller inte efter bildens konstruktor) räknas inte som bilden.
    assert.deepStrictEqual(one({ photo: [photoRow({ idOffset: 53 })] }), { matches: [], unread: 1 });
    assert.deepStrictEqual(one({ photo: [photoRow({ photoHex: 'AABBCCDD' + photoHex(PHOTO_ID, SIZES).slice(8) })] }), { matches: [], unread: 1 });
    assert.deepStrictEqual(one({ photo: [photoRow({ photoHex: photoHex(PHOTO_ID + 1n, SIZES) })] }), { matches: [], unread: 1 });
    assert.deepStrictEqual(tg.matchAndroid({ path: 'Dump/data/media/0/DCIM/Camera/a.jpg', photo: [photoRow()] }), { matches: [], unread: 0 });
});

test('Android: händelserna i fönstret, med filens meddelande utpekat', () => {
    const out = tg.buildAndroid({ path: TG_DIR + '-5550001112223334445_121.jpg', size: 54321, photo: [photoRow()], messages: MESSAGES_A });
    const ev = (id) => out.events.find((e) => e.messageId === id);
    assert.deepStrictEqual(out.events.map((e) => e.messageId), [38, 39, 40, 41, 42, 43, 44, 45]);
    assert.strictEqual(ev(38).text, 'Telegram: meddelande skickat till Kim (meddelande 38)');
    assert.strictEqual(ev(39).text, 'Telegram: meddelande mottaget från Kim (meddelande 39)');
    assert.strictEqual(ev(40).text, 'Den bedömda filen: Telegram: bild mottagen från Kim (meddelande 40)');
    assert.strictEqual(ev(41).text, 'Telegram: röst- eller videomeddelande skickat till Kim (meddelande 41)');
    assert.strictEqual(ev(42).text, 'Telegram: fil mottagen från Alex i gruppen Klubben (meddelande 42)');
    assert.strictEqual(ev(43).text, 'Telegram: bild eller video mottagen från gruppen eller kanalen Nyheter (meddelande 43)');
    assert.strictEqual(ev(44).text, 'Telegram: tjänstemeddelande mottaget från Kim (meddelande 44)');
    assert.strictEqual(ev(45).text, 'Telegram: media mottagen från Kim (meddelande 45)');
    assert.deepStrictEqual([ev(40).isFile, ev(40).bold, ev(40).plain], [true, true, 'Den bedömda filen tas emot i Telegram från Kim']);
    assert.deepStrictEqual([ev(40).kind, ev(40).lane, ev(40).app, ev(40).ms, ev(40).source.db, ev(40).source.table, ev(40).source.column], ['tg-message', 'telegram', 'org.telegram.messenger', at(170), 'cache4.db', 'messages_v2', 'date']);
    assert.deepStrictEqual([ev(38).own, ev(38).active, ev(39).own, ev(39).active], [true, true, false, false]);
    assert.strictEqual(ev(43).plain, 'En bild eller video tas emot i Telegram från gruppen eller kanalen Nyheter');
    assert.deepStrictEqual(out.link.matches.map((m) => [m.messageId, m.direction, m.who, m.kind, m.size, m.width, m.height, m.timeMs, m.by, m.path, m.sizeType, m.sizeOk, m.fileSize]),
        [[40, 'in', 'Kim', 'bild', 54321, 1280, 960, at(170), ['path'], 'org.telegram.messenger/files/Telegram/Telegram Images/-5550001112223334445_121.jpg', 'y', true, 54321]]);
    assert.deepStrictEqual([out.link.android, out.link.idInName, out.link.unread], [true, true, 0]);
    // Samma meddelande-id i en annan chatt är inte filens meddelande.
    const other = tg.buildAndroid({ path: TG_DIR + '-5550001112223334445_121.jpg', photo: [photoRow()], messages: [rowA(40, 170, { peerId: '7000000009', chatName: 'Alex', sender: 'Alex' })] });
    assert.strictEqual(other.events[0].isFile, false);
    assert.deepStrictEqual(tg.buildAndroid({ path: 'x/a.jpg', messages: MESSAGES_A, keep: (ms) => ms >= at(160) && ms <= at(180) }).events.map((e) => e.messageId), [39, 40, 41]);
});

test('Android: fler händelser än tidslinjen rymmer kortas kring T', () => {
    const many = [];
    for (let i = 0; i < 70; i++) many.push(rowA(100 + i, 1000 + i * 10));
    const out = tg.buildAndroid({ path: TG_DIR + '-5550001112223334445_121.jpg', photo: [photoRow()], messages: MESSAGES_A.concat(many), centerMs: at(1300) });
    assert.strictEqual(out.events.length, 40);
    assert.ok(out.events.some((e) => e.isFile));
    assert.deepStrictEqual(out.notes, ['38 Telegram-händelser till i fönstret visas inte.']);
});

test('Android, faktorn: Telegrams egen bildfil, ett meddelande som inte finns kvar och en fil som inte kan kopplas', () => {
    const path = TG_DIR + '-5550001112223334445_121.jpg';
    const rel = 'org.telegram.messenger/files/Telegram/Telegram Images/-5550001112223334445_121.jpg';
    const chat = { app: tg.APP_ANDROID, appName: 'Telegram', direction: 'in', who: 'Kim', messageId: 40, path: rel, source: 'cache4.db' };
    const type = core.classify({ chatMedia: chat }, 'Android');
    assert.deepStrictEqual([type.type, type.label, type.importer], ['saved', 'Telegram-media utanför bildbiblioteket', 'org.telegram.messenger']);
    assert.deepStrictEqual(type.reasons, ['filen är Telegrams egen (' + rel + ')', 'meddelande 40, mottaget från Kim (cache4.db)']);
    const factor = (ctx, t) => core.factorTelegram({ file: { createdMs: at(170) }, format: fmt, telegram: { link: tg.buildAndroid(Object.assign({ path: path, messages: [] }, ctx)).link } }, t || type);

    const f = factor({ size: 54321, photo: [photoRow()] });
    assert.deepStrictEqual([f.id, f.title, f.state, f.verdictText], ['telegram', 'Telegram', 'support', 'Mottagen i Telegram']);
    assert.strictEqual(f.items[0].text, 'Filen är Telegrams egen (' + rel + '): namnet bär bildens id, och id:t står i meddelande 40, mottaget från Kim ' + fmt(at(170)).slice(11) + ' (cache4.db → messages_v2.data).');
    assert.deepStrictEqual([f.items[1].state, f.items[1].text], ['support', 'Bildens storlek y är 54321 byte enligt meddelandet, och filen är lika stor.']);
    assert.strictEqual(f.items.length, 2);
    assert.match(f.plain, /^Filen är Telegrams kopia av bilden i meddelande 40, mottaget från Kim /);
    assert.doesNotMatch(f.items.map((i) => i.text).join(' ') + f.plain, /postbox|lagringsdatabas|t7|ZUUID/);

    const small = factor({ size: 54000, photo: [photoRow()] });
    assert.deepStrictEqual([small.state, small.items[1].state], ['support', 'info']);
    assert.match(small.items[1].text, /54321 byte enligt meddelandet, men filen är 54000 byte/);
    assert.match(factor({ photo: [photoRow()] }).items[1].text, /^Bildens storlek kunde inte läsas ur meddelandet/);
    const twice = factor({ size: 54321, photo: [photoRow(), photoRow({ id: 41, idOffset: 53 })] });
    assert.match(twice.items[2].text, /^Id:t står också i 1 meddelandes blobb, men inte som en bild/);

    // Skickad: meddelandet säger det, och hypotesen följer med. I labbet är bara en mottagen bild kontrollerad.
    const sent = factor({ size: 54321, photo: [photoRow({ out: 1, sender: 'den här telefonen' })] }, core.classify({ chatMedia: Object.assign({}, chat, { direction: 'out' }) }, 'Android'));
    assert.deepStrictEqual([sent.verdictText, sent.items[0].text.indexOf('skickat till Kim') > 0], ['Skickad i Telegram', true]);

    const loose = { type: 'unknown', importer: '', chat: null };
    const gone = factor({ size: 54321, photo: [] }, loose);
    assert.deepStrictEqual([gone.state, gone.verdictText], ['info', 'Meddelandet finns inte kvar']);
    assert.match(gone.items[0].text, /inget meddelande i cache4\.db har den bilden/);
    const stray = factor({ size: 54321, photo: [photoRow({ idOffset: 53 })] }, loose);
    assert.match(stray.items[0].text, /Id:t står också i 1 meddelandes blobb/);

    const none = factor({ path: 'Dump/data/media/0/DCIM/Camera/a.jpg' }, { type: 'camera', importer: 'com.sec.android.app.camera', chat: null });
    assert.deepStrictEqual([none.state, none.verdictText], ['info', 'Ingen koppling']);
    assert.match(none.items[0].text, /^Filen är inte en av Telegrams egna bildfiler/);
    assert.match(none.plain, /Det betyder inte att den aldrig skickades där\.$/);
    const owned = factor({ path: 'Dump/data/media/0/Pictures/Telegram/IMG_20261111_101500_123.jpg' }, { type: 'saved', importer: tg.APP_ANDROID, chat: null });
    assert.match(owned.items[0].text, /^Telegram äger filen enligt MediaStore \(owner_package_name\), men den är inte/);
});

test('Android: kameran frågas inte för en bild som togs emot i Telegram, och hypotesen säger varifrån', () => {
    const path = TG_DIR + '-5550001112223334445_121.jpg';
    const out = tg.buildAndroid({ path: path, size: 54321, photo: [photoRow()], messages: MESSAGES_A });
    const chat = { app: tg.APP_ANDROID, appName: 'Telegram', direction: 'in', who: 'Kim', messageId: 40, path: out.link.matches[0].path, source: 'cache4.db' };
    const m = core.build({ platform: 'Android', appNames: (id) => (id === tg.APP_ANDROID ? 'Telegram' : id), appIntervals: [], screen: [], lock: [], locations: [], neighbours: [], windowMs: 15 * 60000, format: fmt,
        file: { createdMs: at(170), filename: '-5550001112223334445_121.jpg', chatMedia: chat }, telegram: { link: out.link }, extraEvents: out.events });
    assert.strictEqual(m.factors.find((f) => f.id === 'camera').state, 'na');
    assert.strictEqual(m.factors.find((f) => f.id === 'telegram').verdictText, 'Mottagen i Telegram');
    assert.strictEqual(m.beta, true);
    assert.ok(m.events.some((e) => e.kind === 'tg-message' && e.isFile));
});
