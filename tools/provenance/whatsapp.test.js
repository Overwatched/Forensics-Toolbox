// WhatsApp i Härkomst (iOS): SHA-256 i base64, kopplingen till filen (summa, bildbibliotekets post,
// filen under Message/), den möjliga kopplingen för en sparad kamerabild, händelserna och faktorn.
// Raderna efterliknar labbsessionen (iOS 26.4.1, 2026-11-03); namnen är påhittade.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const wa = require('./whatsapp');
const core = require('./timeline-core');

const sha = (s) => crypto.createHash('sha256').update(s).digest();
const T0 = Date.parse('2026-11-03T12:15:00+01:00');
const at = (sec) => T0 + Math.round(sec * 1000);
const UUID_CAM = 'E0A969AD-D0EE-4693-97EE-DEF992DAD88A';

// Mediefilerna: 5 och 8 tagna med WhatsApps kamera, 7 vald ur bildbiblioteket som engångsbild,
// 9 vald ur bildbiblioteket, 14 mottagen. Kontaktkortet (6) har ingen fil.
const MEDIA = [
    { id: 5, messageId: 6, type: 1, fromMe: 1, dateMs: at(3), sentMs: at(3), chatId: 3, chatName: 'Kim', sessionType: 0, sender: 'den här telefonen', path: 'Media/1@lid/a/9/a98f.jpg', size: 44509, mime: 'image/jpeg', sha256: sha('wa-kamera-1').toString('base64'), assetUuid: null },
    { id: 6, messageId: 7, type: 4, fromMe: 1, dateMs: at(19), sentMs: at(19), chatId: 3, chatName: 'Kim', sessionType: 0, sender: 'den här telefonen', path: null, size: 0, mime: null, sha256: null, assetUuid: null },
    { id: 7, messageId: 8, type: 38, fromMe: 1, dateMs: at(30), sentMs: at(30), chatId: 3, chatName: 'Kim', sessionType: 0, sender: 'den här telefonen', path: 'Media/1@lid/1/3/1389.jpg', size: 169863, mime: 'image/jpeg', sha256: sha('engang').toString('base64'), assetUuid: '1CDBE725-88EC-4C02-A4AB-61698641FB82' },
    { id: 8, messageId: 9, type: 1, fromMe: 1, dateMs: at(40), sentMs: at(41), chatId: 3, chatName: 'Kim', sessionType: 0, sender: 'den här telefonen', path: 'Media/1@lid/4/5/4551.jpg', size: 49727, mime: 'image/jpeg', sha256: sha('wa-kamera-2').toString('base64'), assetUuid: null },
    { id: 9, messageId: 10, type: 1, fromMe: 1, dateMs: at(66), sentMs: at(66), chatId: 3, chatName: 'Kim', sessionType: 0, sender: 'den här telefonen', path: 'Media/1@lid/1/3/137d.jpg', size: 55761, mime: 'image/jpeg', sha256: sha('omkodad').toString('base64'), assetUuid: UUID_CAM },
    { id: 14, messageId: 15, type: 1, fromMe: 0, dateMs: at(131), sentMs: at(132), chatId: 3, chatName: 'Kim', sessionType: 0, sender: 'Kim', path: 'Media/1@lid/a/c/ac8f.jpg', size: 274286, mime: 'image/jpeg', sha256: sha('mottagen').toString('base64'), assetUuid: null },
];
const MESSAGES = [
    { id: 5, type: 0, fromMe: 1, dateMs: at(-2), sentMs: at(-2), chatId: 3, chatName: 'Kim', sessionType: 0, mediaId: 4 },
    { id: 6, type: 1, fromMe: 1, dateMs: at(3), sentMs: at(3), chatId: 3, chatName: 'Kim', sessionType: 0, mediaId: 5 },
    { id: 7, type: 4, fromMe: 1, dateMs: at(19), sentMs: at(19), chatId: 3, chatName: 'Kim', sessionType: 0, mediaId: 6 },
    { id: 8, type: 38, fromMe: 1, dateMs: at(30), sentMs: at(30), chatId: 3, chatName: 'Kim', sessionType: 0, mediaId: 7 },
    { id: 9, type: 1, fromMe: 1, dateMs: at(40), sentMs: at(41), chatId: 3, chatName: 'Kim', sessionType: 0, mediaId: 8 },
    { id: 10, type: 1, fromMe: 1, dateMs: at(66), sentMs: at(66), chatId: 3, chatName: 'Kim', sessionType: 0, mediaId: 9 },
    { id: 4, type: 10, fromMe: 0, dateMs: at(-2), chatId: 3, chatName: 'Kim', sessionType: 0 },
    { id: 15, type: 1, fromMe: 0, dateMs: at(131), sentMs: at(132), chatId: 3, chatName: 'Kim', sessionType: 0, sender: 'Kim', mediaId: 14 },
];

test('SHA-256 mellan base64 och hex åt båda hållen, typerna som syns i labbet', () => {
    for (const s of ['a', 'bb', 'ccc', 'wa-kamera-1']) {
        const b = sha(s);
        assert.strictEqual(wa.b64ToHex(b.toString('base64')), b.toString('hex'));
        assert.strictEqual(wa.hexToB64(b.toString('hex')), b.toString('base64'));
    }
    assert.strictEqual(wa.hexToB64('00ff10'), Buffer.from('00ff10', 'hex').toString('base64'));
    assert.strictEqual(wa.hexToB64('zz'), null);
    assert.deepStrictEqual([0, 1, 2, 4, 10, 38, 59].map(wa.typeName), ['text', 'bild', 'video', 'kontaktkort', 'systemmeddelande', 'bild', 'typ 59']);
    assert.strictEqual(wa.kindOf(MEDIA[2]), 'bild', 'typ 38 med image/jpeg är en bild');
});

test('kameran till WhatsApp: bildbibliotekets post binder, och fönstret får meddelandet som den bedömda filen', () => {
    const out = wa.build({ sha256: sha('kamerans-original').toString('hex'), uuid: UUID_CAM.toLowerCase(), path: '/private/var/mobile/Media/DCIM/100APPLE/IMG_0033.HEIC', createdMs: at(56), media: MEDIA, messages: MESSAGES });
    assert.strictEqual(out.link.matches.length, 1);
    const m = out.link.matches[0];
    assert.deepStrictEqual([m.messageId, m.by, m.direction, m.who, m.assetUuid], [10, ['asset'], 'out', 'Kim', UUID_CAM]);
    assert.deepStrictEqual(out.link.nearby, []);
    const file = out.events.filter((e) => e.isFile);
    assert.deepStrictEqual(file.map((e) => [e.messageId, e.kind, e.plain]), [[10, 'wa-message', 'Den bedömda filen skickas från den här telefonen i WhatsApp till Kim']]);
    assert.ok(out.events.some((e) => e.messageId === 8 && e.fromLibrary && /vald ur bildbiblioteket/.test(e.plain)));
    assert.ok(!out.events.some((e) => e.messageId === 4), 'systemmeddelandet visas inte');
    assert.strictEqual(out.link.media, 5, 'kontaktkortet räknas inte som mediefil');

    const input = { file: { createdMs: at(56) }, format: (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19), whatsapp: { link: out.link } };
    const f = core.factorWhatsApp(input, { type: 'camera', importer: 'com.apple.camera' });
    assert.deepStrictEqual([f.state, f.verdictText], ['info', 'Skickad i WhatsApp']);
    assert.match(f.plain, /^Filen skickades i WhatsApp till Kim, 10 s efter T\. Den valdes ur bildbiblioteket, så WhatsApp skapade den inte\.$/);
});

test('sparad av WhatsApp: ett skickat meddelande strax efter är en möjlig koppling, bara tiden binder', () => {
    // IMG_0031 (skapad 3 s före meddelande 6) och IMG_0032 (skapad 7 s före meddelande 9). Meddelande 8
    // ligger närmare den andra men valdes ur bildbiblioteket och räknas inte.
    const first = wa.build({ sha256: sha('fullstor-1').toString('hex'), createdMs: at(1), savedByWhatsApp: true, media: MEDIA, messages: MESSAGES });
    assert.deepStrictEqual(first.link.nearby.map((n) => [n.messageId, n.afterMs]), [[6, 2000]]);
    assert.ok(first.events.some((e) => e.messageId === 6 && e.near && !e.isFile));
    const second = wa.build({ sha256: sha('fullstor-2').toString('hex'), createdMs: at(33.8), savedByWhatsApp: true, media: MEDIA, messages: MESSAGES });
    assert.deepStrictEqual(second.link.nearby.map((n) => n.messageId), [9]);
    assert.deepStrictEqual(wa.build({ createdMs: at(33.8), savedByWhatsApp: false, media: MEDIA }).link.nearby, [], 'bara för filer som WhatsApp sparade');
    assert.deepStrictEqual(wa.build({ createdMs: at(300), savedByWhatsApp: true, media: MEDIA }).link.nearby, [], 'inget inom en minut');

    const fmt = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
    const saved = { type: 'saved', importer: 'net.whatsapp.WhatsApp' };
    const f = core.factorWhatsApp({ file: { createdMs: at(1) }, format: fmt, whatsapp: { link: first.link } }, saved);
    assert.deepStrictEqual([f.state, f.verdictText], ['info', 'Möjlig koppling']);
    assert.match(f.plain, /en bild skickades i WhatsApp 2 s senare\. Det kan vara samma bild; bara tiden binder ihop dem\./);
    const none = core.factorWhatsApp({ file: { createdMs: at(300) }, format: fmt, whatsapp: { link: { matches: [], nearby: [], media: 5 } } }, saved);
    assert.deepStrictEqual([none.state, none.verdictText], ['missing', 'Hittas inte']);
});

test('mottagen fil: samma summa, eller WhatsApps egen fil under Message/', () => {
    const fmt = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
    // En kopia med samma innehåll någon annanstans i zippen.
    const copy = wa.build({ sha256: sha('mottagen').toString('hex'), createdMs: at(131), media: MEDIA, messages: MESSAGES });
    assert.deepStrictEqual(copy.link.matches.map((m) => [m.messageId, m.by, m.direction]), [[15, ['sha256'], 'in']]);
    const asCamera = core.factorWhatsApp({ file: { createdMs: at(131) }, format: fmt, whatsapp: { link: copy.link } }, { type: 'camera' });
    assert.deepStrictEqual([asCamera.state, asCamera.verdictText], ['contradiction', 'Togs emot i WhatsApp']);
    // Filen själv: sökvägen slutar med Message/ + ZMEDIALOCALPATH.
    const path = '/private/var/mobile/Containers/Shared/AppGroup/A225/Message/Media/1@lid/a/c/ac8f.jpg';
    const own = wa.build({ sha256: sha('mottagen').toString('hex'), path, createdMs: at(132), media: MEDIA, messages: MESSAGES });
    assert.deepStrictEqual(own.link.matches[0].by, ['sha256', 'path']);
    assert.ok(!wa.build({ path: '/x/NotMessage/Media/1@lid/a/c/ac8f.jpg', media: MEDIA }).link.matches.length, 'bara under Message/');
    const chat = { app: wa.APP, appName: 'WhatsApp', direction: 'in', who: 'Kim', messageId: 15, path: 'Message/Media/1@lid/a/c/ac8f.jpg', source: 'ChatStorage.sqlite' };
    const type = core.classify({ createdMs: at(132), filename: 'ac8f.jpg', chatMedia: chat }, 'iOS');
    assert.deepStrictEqual([type.type, type.importer, type.label], ['saved', wa.APP, 'WhatsApp-media utanför bildbiblioteket']);
    assert.strictEqual(core.hypothesis(type), 'att filen togs emot i WhatsApp på den här telefonen från Kim');
    const f = core.factorWhatsApp({ file: { createdMs: at(132) }, format: fmt, whatsapp: { link: own.link } }, type);
    assert.deepStrictEqual([f.state, f.verdictText], ['support', 'Mottagen i WhatsApp']);
    assert.match(f.plain, /^Filen är WhatsApps kopia i meddelande 15, mottaget från Kim /);
    // Kameran frågas inte för en fil som kom med WhatsApp.
    const model = core.build({ platform: 'iOS', file: { createdMs: at(132), filename: 'ac8f.jpg', chatMedia: chat }, format: fmt, whatsapp: { link: own.link }, events: [] });
    const cam = model.factors.find((x) => x.id === 'camera');
    assert.deepStrictEqual([cam.state, cam.plain], ['na', 'Filen togs emot i WhatsApp, så frågan om kameran ställs inte.']);
    assert.strictEqual(model.factors.find((x) => x.id === 'whatsapp').state, 'support');
});

test('inget i WhatsApp, och felet när databasen inte går att läsa', () => {
    const fmt = (ms) => new Date(ms).toISOString();
    const none = core.factorWhatsApp({ file: { createdMs: at(0) }, format: fmt, whatsapp: { link: { matches: [], nearby: [], media: 5 } } }, { type: 'camera' });
    assert.deepStrictEqual([none.state, none.verdictText], ['info', 'Inte i WhatsApp']);
    assert.match(none.items[0].text, /WhatsApps 5 mediefiler/);
    const err = core.factorWhatsApp({ file: { createdMs: at(0) }, whatsapp: { error: 'trasig' } }, { type: 'camera' });
    assert.deepStrictEqual([err.state, err.verdictText], ['missing', 'Kunde inte läsas']);
    assert.match(wa.mediaText(MEDIA[5], fmt), /^WhatsApp-bild \(image\/jpeg, 274286 byte\) i meddelande 15, mottagen från Kim .*Message\/Media\/1@lid\/a\/c\/ac8f\.jpg\.$/);
});

test('böjningen: ett meddelande skickat, en bild skickad, ett kontaktkort skickat', () => {
    const out = wa.build({ media: MEDIA, messages: MESSAGES });
    const text = (id) => out.events.find((e) => e.messageId === id).text;
    assert.strictEqual(text(5), 'WhatsApp: meddelande skickat till Kim (meddelande 5)');
    assert.strictEqual(text(6), 'WhatsApp: bild skickad till Kim (meddelande 6)');
    assert.strictEqual(text(7), 'WhatsApp: kontaktkort skickat till Kim (meddelande 7)');
    assert.strictEqual(text(15), 'WhatsApp: bild mottagen från Kim (meddelande 15)');
});

test('mottagen fil med bibliotekets id är sparad dit, inte vald därifrån, och typ 38 är engångsvisning', () => {
    const uuid = '0D8E64D2-4038-4259-BD53-8B7AC769EF32';
    const media = [{ id: 19, messageId: 19, type: 1, fromMe: 0, dateMs: at(10), chatId: 3, chatName: 'Kim', sessionType: 0, sender: 'Kim', path: 'Media/1@lid/5/0/5077.jpg', size: 94446, mime: 'image/jpeg', assetUuid: uuid }];
    const out = wa.build({ uuid: uuid, savedByWhatsApp: true, createdMs: at(10), media: media, messages: [{ id: 19, type: 1, fromMe: 0, dateMs: at(10), chatId: 3, chatName: 'Kim', sessionType: 0, sender: 'Kim', mediaId: 19 }] });
    assert.match(out.events[0].text, /sparad i bildbiblioteket/);
    assert.doesNotMatch(out.events[0].text, /vald ur/);
    assert.strictEqual(out.events[0].fromLibrary, false);
    const f = core.factorWhatsApp({ file: { createdMs: at(10) }, whatsapp: { link: out.link } }, { type: 'saved', importer: wa.APP });
    assert.match(f.items[0].text, /sparad i bildbiblioteket \(samma post/);
    const once = wa.build({ messages: [MESSAGES[3]], media: MEDIA }).events[0];
    assert.ok(once.viewOnce);
    assert.match(once.text, /engångsvisning/);
    assert.deepStrictEqual([38, 39, 1].map(wa.isViewOnce), [true, true, false]);
});

test('en bild vald ur biblioteket behåller den möjliga kopplingen till kamerameddelandet', () => {
    const media = [
        { id: 1, messageId: 1, type: 1, fromMe: 1, dateMs: at(2), sentMs: at(2), chatId: 3, chatName: 'Kim', sessionType: 0, path: 'Media/a.jpg', size: 9, mime: 'image/jpeg' },
        { id: 2, messageId: 2, type: 1, fromMe: 1, dateMs: at(20), sentMs: at(20), chatId: 3, chatName: 'Kim', sessionType: 0, path: 'Media/b.jpg', size: 9, mime: 'image/jpeg', assetUuid: UUID_CAM },
    ];
    const out = wa.build({ uuid: UUID_CAM, savedByWhatsApp: true, createdMs: at(0), media: media, messages: [] });
    assert.deepStrictEqual(out.link.matches.map((m) => m.messageId), [2]);
    assert.deepStrictEqual(out.link.nearby.map((m) => m.messageId), [1]);
    const f = core.factorWhatsApp({ file: { createdMs: at(0) }, whatsapp: { link: out.link } }, { type: 'saved', importer: wa.APP });
    assert.strictEqual(f.verdictText, 'Skickad i WhatsApp');
    assert.match(f.items[1].text, /skickades också .*meddelande 1\)/);
});

test('tilläggets logg: mottaget i bakgrunden, inte i databasen, med zonen ur filens ändringstid', () => {
    const name = 'x/Logs/ServiceExtension_2/whatsapp-2026-11-04-10-42-45-2199-ServiceExtension-0-launch.log';
    const text = '10:42:45.955 [ 1] [main] LL_A start\n10:42:48.267 [ 2] [net] LL_N xmpp//< recv < [media/ id=AC5997993A5F57B10D5B6261890AF112 f=****:0@lid [enc {1251b}]]\n10:42:52.100 [ 2] [net] LL_A slut\n';
    const mtimeMs = Date.parse('2026-11-04T10:42:52+01:00');
    const rows = wa.parseExtensionLog(text, { name: name, mtimeMs: mtimeMs });
    assert.deepStrictEqual(rows.map((r) => [r.kind, r.stanzaId, r.ms]), [['media', 'AC5997993A5F57B10D5B6261890AF112', Date.parse('2026-11-04T10:42:48.267+01:00')]]);
    assert.deepStrictEqual(wa.parseExtensionLog(text, { name: 'utan-datum.log', mtimeMs: mtimeMs }), []);
    const out = wa.build({ media: [], messages: [], extensionLog: rows, stanzaIds: ['ANNAT'] });
    assert.strictEqual(out.link.pending, 1);
    assert.strictEqual(out.events[0].kind, 'wa-pending');
    assert.match(out.events[0].text, /finns inte i ChatStorage/);
    assert.strictEqual(wa.build({ media: [], messages: [], extensionLog: rows, stanzaIds: [rows[0].stanzaId] }).link.pending, 0);
    const f = core.factorWhatsApp({ file: { createdMs: at(0) }, whatsapp: { link: out.link } }, { type: 'camera' });
    assert.match(f.items[0].text, /1 meddelande med media togs emot i bakgrunden/);
});

test('en kamerafil i WhatsApps tmp utan meddelande: inget meddelande, ingen slutsats om att den inte skickats', () => {
    const t = { type: 'saved', importer: wa.APP, chatTemp: { app: wa.APP, appName: 'WhatsApp', path: 'tmp/documents/Camera/a.jpg' } };
    const f = core.factorWhatsApp({ file: { createdMs: at(0) }, whatsapp: { link: wa.build({ savedByWhatsApp: true, createdMs: at(0), media: [], messages: [] }).link } }, t);
    assert.deepStrictEqual([f.state, f.verdictText], ['info', 'Inget meddelande']);
    assert.match(f.items[0].text, /tillfälliga mapp/);
});

// ---------- Android ----------
// Raderna efterliknar labbet med två telefoner (Android 16, WhatsApp 2.26.43, 2026-11-11): en bild tagen med
// WhatsApps kamera (21), en mottagen bild (22), ett röstmeddelande (23), en video som inte hämtats (24), en
// kamerabild skickad som dokument (25) och ett mottaget dokument i en grupp (26). Namn och id:n är påhittade.

const KIM = '111@lid';
const ALEX = '222@lid';
const NAMES = { [KIM]: 'Kim', [ALEX]: 'Alex' };
const ZIP_WA = 'Dump/data/media/0/Android/media/com.whatsapp/WhatsApp/';
const b64 = (s) => sha(s).toString('base64');
const hex = (s) => sha(s).toString('hex');
const chatKim = { chatId: 3, chatSubject: null, chatJid: KIM, group: 0 };
const chatClub = { chatId: 4, chatSubject: 'Klubben', chatJid: '120363000000000001@g.us', group: 1 };
const MEDIA_A = [
    Object.assign({ messageId: 21, type: 1, fromMe: 1, dateMs: at(11), receivedMs: null, sender: 'den här telefonen', voice: 0, mime: 'image/jpeg', path: 'Media/WhatsApp Images/Sent/IMG-20261111-WA0001.jpg', size: 80123, sha256: b64('skickad kopia'), original: b64('originalet'), transferred: 1 }, chatKim),
    Object.assign({ messageId: 22, type: 1, fromMe: 0, dateMs: at(58), receivedMs: at(60), sender: KIM, voice: 0, mime: 'image/jpeg', path: 'Media/WhatsApp Images/IMG-20261111-WA0002.jpg', size: 91234, sha256: b64('mottagen bild'), original: null, transferred: 1 }, chatKim),
    Object.assign({ messageId: 23, type: 2, fromMe: 1, dateMs: at(90), receivedMs: null, sender: 'den här telefonen', voice: 1, mime: 'audio/ogg; codecs=opus', path: 'Media/WhatsApp Voice Notes/202646/PTT-20261111-WA0003.opus', size: 0, sha256: b64('röst'), original: null, transferred: 1 }, chatKim),
    Object.assign({ messageId: 24, type: 3, fromMe: 0, dateMs: at(118), receivedMs: at(120), sender: KIM, voice: 0, mime: 'video/mp4', path: null, size: 2345678, sha256: b64('video'), original: null, transferred: 0 }, chatKim),
    Object.assign({ messageId: 25, type: 9, fromMe: 1, dateMs: at(150), receivedMs: null, sender: 'den här telefonen', voice: 0, mime: 'image/jpeg', path: 'Media/WhatsApp Documents/Sent/DOC-20261111-WA0004.jpg', size: 3456789, sha256: b64('kamerabild'), original: null, transferred: 1 }, chatKim),
    Object.assign({ messageId: 26, type: 9, fromMe: 0, dateMs: at(178), receivedMs: at(180), sender: ALEX, voice: 0, mime: 'application/pdf', path: 'Media/WhatsApp Documents/rapport.pdf', size: 4567, sha256: b64('pdf'), original: null, transferred: 1 }, chatClub),
];
const msgA = (m, over) => Object.assign({ id: m.messageId, type: m.type, fromMe: m.fromMe, dateMs: m.dateMs, receivedMs: m.receivedMs, chatId: m.chatId, chatSubject: m.chatSubject, chatJid: m.chatJid, group: m.group, sender: m.sender, voice: m.voice, mime: m.mime, mediaId: m.messageId, hasText: 0 }, over || {});
const MESSAGES_A = MEDIA_A.map((m) => msgA(m)).concat([
    Object.assign({ id: 20, type: 0, fromMe: 1, dateMs: at(5), receivedMs: null, sender: 'den här telefonen', voice: 0, mime: null, mediaId: null, hasText: 1 }, chatKim),
    Object.assign({ id: 27, type: 15, fromMe: 0, dateMs: at(198), receivedMs: at(200), sender: KIM, voice: 0, mime: null, mediaId: null, hasText: 0 }, chatKim),
    Object.assign({ id: 28, type: 7, fromMe: 0, dateMs: at(1), receivedMs: at(1), sender: null, voice: 0, mime: null, mediaId: null, hasText: 0 }, chatKim),
    Object.assign({ id: 29, type: 99, fromMe: 0, dateMs: at(210), receivedMs: null, sender: KIM, voice: 0, mime: null, mediaId: null, hasText: 0 }, chatKim),
]);
const buildA = (ctx) => wa.buildAndroid(Object.assign({ media: MEDIA_A, messages: MESSAGES_A, names: NAMES }, ctx));
const factorA = (out, type, T) => core.factorWhatsApp({ file: { createdMs: T == null ? at(0) : T }, whatsapp: { link: out.link } }, type);
const textA = (f) => f.items.map((i) => i.text).join(' ');

test('Android: filen kopplas på sin summa, på originalets summa och på sin sökväg under WhatsApp/Media/', () => {
    const by = (ctx) => wa.matchAndroid(ctx, MEDIA_A).map((x) => [x.row.messageId, x.by]);
    assert.deepStrictEqual(by({ sha256: hex('mottagen bild'), path: ZIP_WA + 'Media/WhatsApp Images/IMG-20261111-WA0002.jpg' }), [[22, ['sha256', 'path']]]);
    assert.deepStrictEqual(by({ sha256: hex('originalet'), path: ZIP_WA + 'Media/WhatsApp Images/IMG-20261111-WA0000.jpeg' }), [[21, ['original']]]);
    assert.deepStrictEqual(by({ sha256: hex('kamerabild').toUpperCase(), path: 'Dump/data/media/0/DCIM/Camera/20261111_101500.jpg' }), [[25, ['sha256']]]);
    // Bara sökvägen: en fil som ändrats efter att den sparades har en annan summa.
    assert.deepStrictEqual(by({ sha256: hex('något annat'), path: ZIP_WA + 'Media/WhatsApp Documents/rapport.pdf' }), [[26, ['path']]]);
    // Samma slut på sökvägen i en annan mapp är inte WhatsApps fil, och en summa som inte är SHA-256 jämförs inte.
    assert.deepStrictEqual(by({ path: 'Dump/data/media/0/Kopior/Media/WhatsApp Documents/rapport.pdf' }), []);
    assert.deepStrictEqual(by({ sha256: 'abc', path: null }), []);
    assert.strictEqual(wa.APP_ANDROID, 'com.whatsapp');
});

test('Android: händelserna säger vad som skickades och togs emot, med tiden på den här telefonen', () => {
    const out = buildA({});
    const ev = (id) => out.events.find((e) => e.messageId === id);
    assert.deepStrictEqual(out.events.map((e) => e.messageId), [20, 21, 22, 23, 24, 25, 26, 27, 29]);
    assert.strictEqual(ev(20).text, 'WhatsApp: meddelande skickat till Kim (meddelande 20)');
    assert.strictEqual(ev(21).text, 'WhatsApp: bild skickad till Kim (meddelande 21)');
    assert.strictEqual(ev(22).text, 'WhatsApp: bild mottagen från Kim (meddelande 22)');
    assert.strictEqual(ev(23).text, 'WhatsApp: röstmeddelande skickat till Kim (meddelande 23)');
    assert.strictEqual(ev(24).text, 'WhatsApp: video mottagen från Kim (meddelande 24), inte hämtad till telefonen');
    assert.strictEqual(ev(25).text, 'WhatsApp: bild skickad som dokument till Kim (meddelande 25)');
    assert.strictEqual(ev(26).text, 'WhatsApp: dokument mottaget från Alex i gruppen Klubben (meddelande 26)');
    assert.strictEqual(ev(27).text, 'WhatsApp: meddelande mottaget från Kim (meddelande 27), raderat för alla');
    assert.strictEqual(ev(29).text, 'WhatsApp: meddelande av typ 99 mottaget från Kim (meddelande 29)');
    // Ett mottaget meddelande står på tiden då det kom in, ett skickat på tiden då det skrevs.
    assert.deepStrictEqual([ev(22).ms, ev(22).source.column, ev(22).own], [at(60), 'received_timestamp', false]);
    assert.deepStrictEqual([ev(21).ms, ev(21).source.column, ev(21).own, ev(21).active], [at(11), 'timestamp', true, true]);
    assert.deepStrictEqual([ev(29).ms, ev(29).source.column], [at(210), 'timestamp']);
    assert.deepStrictEqual([ev(22).kind, ev(22).lane, ev(22).app, ev(22).source.db, ev(22).source.table], ['wa-message', 'whatsapp', 'com.whatsapp', 'msgstore.db', 'message']);
    assert.strictEqual(ev(22).plain, 'En bild tas emot i WhatsApp från Kim');
    assert.strictEqual(ev(20).plain, null);
    assert.ok(out.events.every((e) => !e.isFile));
    assert.deepStrictEqual([out.link.android, out.link.media, out.link.matches.length, out.link.shaKnown], [true, 6, 0, false]);
    // Utan wa.db visas kontot med sitt id, och fönstret väljer händelserna.
    assert.strictEqual(wa.buildAndroid({ media: MEDIA_A, messages: MESSAGES_A }).events[2].text, 'WhatsApp: bild mottagen från 111@lid (meddelande 22)');
    assert.deepStrictEqual(buildA({ keep: (ms) => ms >= at(60) && ms <= at(120) }).events.map((e) => e.messageId), [22, 23, 24]);
});

test('Android: den bedömda filens meddelande pekas ut, och originalet till en skickad bild sägs vara originalet', () => {
    const recv = buildA({ sha256: hex('mottagen bild'), path: ZIP_WA + 'Media/WhatsApp Images/IMG-20261111-WA0002.jpg' });
    const e = recv.events.find((x) => x.messageId === 22);
    assert.strictEqual(e.text, 'Den bedömda filen: WhatsApp: bild mottagen från Kim (meddelande 22)');
    assert.strictEqual(e.plain, 'Den bedömda filen tas emot i WhatsApp från Kim');
    assert.deepStrictEqual([e.isFile, e.bold], [true, true]);
    assert.deepStrictEqual(recv.link.matches.map((m) => [m.messageId, m.by, m.direction, m.who, m.kind, m.document, m.path, m.dateMs, m.sentMs, m.fetched]),
        [[22, ['sha256', 'path'], 'in', 'Kim', 'bild', false, 'WhatsApp/Media/WhatsApp Images/IMG-20261111-WA0002.jpg', at(60), null, true]]);
    assert.strictEqual(recv.link.shaKnown, true);

    const orig = buildA({ sha256: hex('originalet'), path: ZIP_WA + 'Media/WhatsApp Images/IMG-20261111-WA0000.jpeg' });
    const o = orig.events.find((x) => x.messageId === 21);
    assert.strictEqual(o.text, 'WhatsApp: bild skickad till Kim (meddelande 21); den bedömda filen är originalet till den');
    assert.strictEqual(o.plain, 'En kopia av den bedömda filen skickas från den här telefonen i WhatsApp till Kim');
    assert.deepStrictEqual(orig.link.matches.map((m) => [m.messageId, m.by, m.direction, m.sentMs]), [[21, ['original'], 'out', at(11)]]);
});

test('Android: fler händelser än tidslinjen rymmer kortas kring T, och filens meddelande står kvar', () => {
    const many = [];
    for (let i = 0; i < 60; i++) many.push(Object.assign({ id: 100 + i, type: 0, fromMe: i % 2, dateMs: at(1000 + i * 10), receivedMs: null, sender: KIM, voice: 0, mime: null, mediaId: null, hasText: 1 }, chatKim));
    const out = buildA({ sha256: hex('mottagen bild'), messages: MESSAGES_A.concat(many), centerMs: at(1300) });
    assert.strictEqual(out.events.length, 40);
    assert.ok(out.events.some((e) => e.isFile && e.messageId === 22));
    assert.deepStrictEqual(out.notes, ['29 WhatsApp-händelser till i fönstret visas inte.']);
});

test('Android, faktorn: WhatsApps egen fil är mottagen eller skickad i meddelandet som databasen pekar ut', () => {
    const p = 'WhatsApp/Media/WhatsApp Images/IMG-20261111-WA0002.jpg';
    const chat = { app: wa.APP_ANDROID, appName: 'WhatsApp', direction: 'in', who: 'Kim', messageId: 22, path: p, source: 'msgstore.db', inLibrary: true };
    const type = core.classify({ importer: wa.APP_ANDROID, relativePath: 'Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/', filename: 'IMG-20261111-WA0002.jpg', createdFrom: 'date_added', chatMedia: chat }, 'Android');
    assert.deepStrictEqual([type.type, type.label, type.importer], ['saved', 'WhatsApp-media', 'com.whatsapp']);
    assert.deepStrictEqual(type.reasons, ['filen är WhatsApps egen (' + p + ')', 'meddelande 22, mottaget från Kim (msgstore.db)', 'owner_package_name är com.whatsapp', 'datetaken saknas i MediaStore, så T är date_added']);
    assert.strictEqual(core.classify({ chatMedia: Object.assign({}, chat, { inLibrary: false }) }, 'Android').label, 'WhatsApp-media utanför bildbiblioteket');

    const f = factorA(buildA({ sha256: hex('mottagen bild'), path: ZIP_WA + p.slice(9) }), type, at(60));
    assert.deepStrictEqual([f.id, f.title, f.state, f.verdictText], ['whatsapp', 'WhatsApp', 'support', 'Mottagen i WhatsApp']);
    assert.match(f.items[0].text, /^Mottagen från Kim 11:16:00 \(meddelande 22, bild\): samma SHA-256 som mediefilen \(file_hash\), filen är WhatsApps egen \(WhatsApp\/Media\/WhatsApp Images\/IMG-20261111-WA0002\.jpg\)\.$/);
    assert.strictEqual(f.items.length, 1);
    assert.match(f.plain, /^Filen är WhatsApps kopia i meddelande 22, mottaget från Kim /);
    assert.doesNotMatch(textA(f) + f.plain, /ZUUID|ChatStorage|ServiceExtension|bildbibliotekets post/);

    // Samma fil med en annan summa än databasens: sökvägen binder, och det sägs.
    const changed = factorA(buildA({ sha256: hex('ändrad'), path: ZIP_WA + p.slice(9) }), type, at(60));
    assert.deepStrictEqual([changed.state, changed.items.length, changed.items[1].state], ['support', 2, 'info']);
    assert.match(changed.items[1].text, /bara sökvägen binder/);

    // Den skickade kopian under Sent/.
    const sentChat = Object.assign({}, chat, { direction: 'out', messageId: 21, path: 'WhatsApp/Media/WhatsApp Images/Sent/IMG-20261111-WA0001.jpg' });
    const sent = factorA(buildA({ sha256: hex('skickad kopia'), path: ZIP_WA + 'Media/WhatsApp Images/Sent/IMG-20261111-WA0001.jpg' }), core.classify({ importer: wa.APP_ANDROID, chatMedia: sentChat }, 'Android'), at(11));
    assert.deepStrictEqual([sent.state, sent.verdictText], ['support', 'Skickad i WhatsApp']);
    assert.match(sent.items[0].text, /^Skickad till Kim .*\(meddelande 21, bild\)/);
});

test('Android, faktorn: originalet, kamerabilden som skickades som dokument, en mottagen fil bland kamerabilderna och ingen träff', () => {
    const saved = { type: 'saved', importer: wa.APP_ANDROID, chat: null };
    const orig = factorA(buildA({ sha256: hex('originalet'), path: ZIP_WA + 'Media/WhatsApp Images/IMG-20261111-WA0000.jpeg' }), saved, at(0));
    assert.deepStrictEqual([orig.state, orig.verdictText], ['support', 'Original till en skickad fil']);
    assert.match(orig.items[0].text, /^Skickad till Kim .*\(meddelande 21, bild\): samma SHA-256 som originalet till det som skickades \(original_file_hash\)\.$/);
    assert.match(orig.items[1].text, /valts ur galleriet är inte kontrollerad/);
    assert.match(orig.plain, /^Filen är originalet till en bild som skickades i WhatsApp till Kim, 11 s efter T\. WhatsApp sparade originalet\.$/);

    const cam = { type: 'camera', importer: 'com.sec.android.app.camera', chat: null };
    const doc = factorA(buildA({ sha256: hex('kamerabild'), path: 'Dump/data/media/0/DCIM/Camera/20261111_101500.jpg' }), cam, at(100));
    assert.deepStrictEqual([doc.state, doc.verdictText], ['info', 'Skickad i WhatsApp']);
    assert.match(doc.items[0].text, /\(meddelande 25, bild som dokument\): samma SHA-256 som mediefilen \(file_hash\)\.$/);
    assert.match(doc.plain, /^Filen skickades i WhatsApp till Kim som dokument, 50 s efter T\. Det säger inget om hur den skapades\.$/);

    const got = factorA(buildA({ sha256: hex('mottagen bild'), path: 'Dump/data/media/0/DCIM/Camera/kopia.jpg' }), cam, at(300));
    assert.deepStrictEqual([got.state, got.verdictText, got.items[0].state], ['contradiction', 'Togs emot i WhatsApp', 'contradiction']);
    assert.match(got.plain, /inte en bild från telefonens kamera/);

    const lost = factorA(buildA({ sha256: hex('okänd'), path: ZIP_WA + 'Media/WhatsApp Images/IMG-20261111-WA0009.jpg' }), saved);
    assert.deepStrictEqual([lost.state, lost.verdictText], ['missing', 'Hittas inte']);
    assert.match(lost.items[0].text, /owner_package_name\), men varken summan eller sökvägen finns bland WhatsApps 6 mediefiler i msgstore\.db/);

    const none = factorA(buildA({ sha256: hex('okänd'), path: 'Dump/data/media/0/DCIM/Camera/a.jpg' }), cam);
    assert.deepStrictEqual([none.state, none.verdictText], ['info', 'Inte i WhatsApp']);
    assert.match(none.items[0].text, /file_hash eller original_file_hash/);

    const err = core.factorWhatsApp({ file: { createdMs: at(0) }, whatsapp: { error: 'WhatsApps databaser kunde inte läsas: trasig' } }, cam);
    assert.deepStrictEqual([err.state, err.verdictText], ['missing', 'Kunde inte läsas']);
});

test('Android: kameran frågas inte för WhatsApps egen fil, men för originalet frågas den', () => {
    const base = { platform: 'Android', appNames: (id) => (id === 'com.whatsapp' ? 'WhatsApp' : id), appIntervals: [], screen: [], lock: [], locations: [], neighbours: [], windowMs: 15 * 60000 };
    const chat = { app: wa.APP_ANDROID, appName: 'WhatsApp', direction: 'in', who: 'Kim', messageId: 22, path: 'WhatsApp/Media/WhatsApp Images/IMG-20261111-WA0002.jpg', source: 'msgstore.db', inLibrary: true };
    const recv = buildA({ sha256: hex('mottagen bild'), path: ZIP_WA + 'Media/WhatsApp Images/IMG-20261111-WA0002.jpg' });
    const own = core.build(Object.assign({}, base, { file: { createdMs: at(60), addedMs: at(60), importer: wa.APP_ANDROID, filename: 'IMG-20261111-WA0002.jpg', chatMedia: chat }, whatsapp: { link: recv.link }, extraEvents: recv.events }));
    const cam = own.factors.find((f) => f.id === 'camera');
    assert.strictEqual(cam.state, 'na');
    assert.match(cam.items[0].text, /WhatsApps kopia av en fil som togs emot i appen \(meddelande 22\)/);
    assert.strictEqual(own.factors.find((f) => f.id === 'whatsapp').verdictText, 'Mottagen i WhatsApp');
    assert.strictEqual(own.beta, true);

    const o = buildA({ sha256: hex('originalet'), path: ZIP_WA + 'Media/WhatsApp Images/IMG-20261111-WA0000.jpeg' });
    const orig = core.build(Object.assign({}, base, { file: { createdMs: at(0), addedMs: at(0), importer: wa.APP_ANDROID, filename: 'IMG-20261111-WA0000.jpeg', relativePath: 'Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/' }, whatsapp: { link: o.link }, extraEvents: o.events }));
    assert.strictEqual(orig.type.type, 'saved');
    assert.strictEqual(orig.type.chat, null);
    assert.notStrictEqual(orig.factors.find((f) => f.id === 'camera').state, 'na');
    assert.strictEqual(orig.factors.find((f) => f.id === 'whatsapp').verdictText, 'Original till en skickad fil');
});

test('Android: en mening om en mediefil som hittats på sin summa eller på originalets', () => {
    const fmt = (ms) => new Date(ms).toISOString();
    assert.strictEqual(wa.mediaTextAndroid(MEDIA_A[1], fmt, 'sha256', NAMES),
        'WhatsApp-bild (image/jpeg, 91234 byte) i meddelande 22, mottagen från Kim ' + fmt(at(60)) + '. Filen ligger under WhatsApp/Media/WhatsApp Images/IMG-20261111-WA0002.jpg.');
    assert.strictEqual(wa.mediaTextAndroid(MEDIA_A[0], fmt, 'original', NAMES),
        'WhatsApp-bild (image/jpeg, 80123 byte) i meddelande 21, skickad till Kim ' + fmt(at(11)) + '. Summan är originalets (original_file_hash): det som skickades är en kopia gjord av filen. Kopian ligger under WhatsApp/Media/WhatsApp Images/Sent/IMG-20261111-WA0001.jpg.');
    assert.match(wa.mediaTextAndroid(MEDIA_A[3], fmt, 'sha256', NAMES), /^WhatsApp-video \(video\/mp4, 2345678 byte\) i meddelande 24, mottagen från Kim .* Filen hämtades aldrig till telefonen\.$/);
    assert.match(wa.mediaTextAndroid(MEDIA_A[5], fmt, 'sha256', NAMES), /^WhatsApp-dokument \(application\/pdf, 4567 byte\) i meddelande 26, mottaget från Alex i gruppen Klubben /);
    assert.match(wa.mediaTextAndroid(MEDIA_A[2], fmt, 'sha256', {}), /^WhatsApp-röstmeddelande .* skickat till 111@lid /);
});
