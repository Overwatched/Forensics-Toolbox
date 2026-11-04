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
