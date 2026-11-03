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
    assert.deepStrictEqual([0, 1, 2, 4, 10, 38, 59].map(wa.typeName), ['text', 'bild', 'video', 'kontaktkort', 'systemmeddelande', 'typ 38', 'typ 59']);
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
