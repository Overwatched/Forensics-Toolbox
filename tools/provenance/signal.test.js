// Signal i Härkomst: SHA-256 ur base64, loggraderna (val ur galleriet, Signals kamera, redigering,
// sändning, sparande, radering för alla), kopplingen mellan filen och bilagorna och händelserna.
// Raderna efterliknar en labbsession (Android 13, Signal 8.33, 2026-11-02); namnen är påhittade.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const sig = require('./signal');
const core = require('./timeline-core');

const sha = (s) => crypto.createHash('sha256').update(s).digest();
const b64 = (s) => sha(s).toString('base64');
const hex = (s) => sha(s).toString('hex');
const T0 = Date.parse('2026-11-02T18:48:00+01:00');
const at = (sec) => T0 + Math.round(sec * 1000);
const line = (ms, text) => ({ timeMs: ms, body: '[8.33.2] [main ] 2026-11-02 18:48:00.000 GMT+01:00 D ' + text });

const RECIPIENTS = { 2: { name: 'Jag' }, 3: { name: 'Kim' }, 10: { name: null, groupTitle: 'biljakt' } };
// Bilaga 3: originalet DCIM-bilden, omkodad. Bilaga 6: mottagen. Bilaga 15: vidarebefordrad kopia av 6.
const ATTACHMENTS = [
    { id: 3, messageId: 7, contentType: 'image/jpeg', size: 333153, width: 1200, height: 1600, dataFile: '/data/user/0/org.thoughtcrime.securesms/app_parts/part2114.mms', hashStart: b64('kamerabild'), hashEnd: b64('omkodad'), type: 0xa00017, threadRecipient: 3, fromId: 2, toId: 3, sentMs: at(52.556), receivedMs: at(52.559), serverMs: -1 },
    { id: 6, messageId: 12, contentType: 'image/jpeg', size: 33248, width: 1600, height: 900, dataFile: 'part1043.mms', hashStart: b64('mottagen'), hashEnd: b64('mottagen'), type: 0xa00014, threadRecipient: 3, fromId: 3, toId: 2, sentMs: at(120.488), receivedMs: at(120.375), serverMs: at(118.993) },
    { id: 14, messageId: 18, contentType: 'image/jpeg', size: 382756, width: 2268, height: 4032, dataFile: 'part3501.mms', hashStart: b64('hd'), hashEnd: b64('hd'), type: 0xa00014, threadRecipient: 3, fromId: 3, toId: 2, sentMs: at(300), receivedMs: at(301.5), serverMs: at(300.2), viewOnce: 1 },
    { id: 15, messageId: 19, contentType: 'image/jpeg', size: 33248, width: 1600, height: 900, dataFile: 'part1043.mms', hashStart: b64('mottagen'), hashEnd: b64('mottagen'), type: 0xa00017, threadRecipient: 10, fromId: 2, toId: 10, sentMs: at(400), receivedMs: at(400), serverMs: -1 },
];
const MESSAGES = [
    { id: 7, type: 0xa00017, threadRecipient: 3, fromId: 2, toId: 3, sentMs: at(52.556), receivedMs: at(52.559), serverMs: -1, attachments: 1 },
    { id: 12, type: 0xa00014, threadRecipient: 3, fromId: 3, toId: 2, sentMs: at(120.488), receivedMs: at(120.375), serverMs: at(118.993), attachments: 1 },
    { id: 15, type: 0xa00017, threadRecipient: 3, fromId: 2, toId: 3, sentMs: at(200), receivedMs: at(200), serverMs: -1, attachments: 0, deletedBy: 2 },
    { id: 18, type: 0xa00014, threadRecipient: 3, fromId: 3, toId: 2, sentMs: at(300), receivedMs: at(301.5), serverMs: at(300.2), attachments: 1, viewOnce: 1 },
    { id: 19, type: 0xa00017, threadRecipient: 10, fromId: 2, toId: 10, sentMs: at(400), receivedMs: at(400), serverMs: -1, attachments: 1 },
];
const LOG = [
    line(at(-20), 'BaseActivity: [MediaSendV3Activity] onCreate()'),
    line(at(-1), 'AttachmentTable: Inserting attachment content://org.thoughtcrime.securesms.blob/blob/single-session-disk/image%2Fjpeg/null/1453622/********-****-****-****-*********f33 for pre-upload.'),
    line(at(-0.9), 'AttachmentTable: [insertAttachmentsForMessage] Inserted attachment at AttachmentId::10'),
    line(at(7), 'AttachmentTable: [deleteAttachment] attachmentId: AttachmentId::10'),
    line(at(7.01), 'AttachmentTable: Inserting attachment content://org.thoughtcrime.securesms.blob/blob/single-session-disk/image%2Fjpeg/null/233086/********-****-****-****-*********43f for pre-upload.'),
    line(at(7.02), 'AttachmentTable: [insertAttachmentsForMessage] Inserted attachment at AttachmentId::11'),
    line(at(49.179), 'AttachmentTable: Inserting attachment content://media/external/images/media/1000000094 for pre-upload.'),
    line(at(49.179), 'AttachmentTable: [insertAttachmentWithData] Inserting attachment for messageId -8675309. (MessageId: -8675309, content://media/external/images/media/1000000094)'),
    line(at(49.218), 'AttachmentTable: [insertAttachmentsForMessage] Inserted attachment at AttachmentId::3'),
    line(at(52.796), 'IndividualSendJobV2: [' + at(52.556) + '][7] Sent message.'),
    line(at(121), 'AttachmentDownloadJob: onAdded() messageId: 12  attachmentId: AttachmentId::6  manual: false'),
    line(at(135.230), 'AttachmentSaver: Saving 1 attachments to device storage.'),
    line(at(135.300), 'SaveAttachmentUtil: Save attachments completed (1 of 1 saved successfully).'),
    line(at(150), 'CameraScreenViewModel: Video recording started'),
    line(at(154.4), 'CameraScreenViewModel: Video recording succeeded. bytes: 2270820'),
    line(at(197), 'AttachmentTable: Inserting attachment content://media/external/images/media/1000000094 for pre-upload.'),
    line(at(197.04), 'AttachmentTable: [insertAttachmentsForMessage] Inserted attachment at AttachmentId::9'),
    line(at(200.3), 'IndividualSendJobV2: [' + at(200) + '][15] Sent message.'),
    line(at(399.9), 'MultiselectForwardActiv: State change: SendPending'),
    line(at(400.02), 'AttachmentTable: [insertAttachmentWithData] Found that the new attachment hash matches the DATA_HASH_START of AttachmentId::6. Using all of it\'s fields.'),
    line(at(500), 'AttachmentTable: [deleteAttachmentsForMessage] mmsId: 15'),
    line(at(500.05), 'Job: [JOB::e62a947c][RemoteDeleteSendJob] onSubmit() (Time Since Submission: 2 ms)'),
];
const wall = (ms) => core.formatWithOffset(ms, 60) + '.' + String(ms % 1000).padStart(3, '0');

test('SHA-256 ur base64, riktning, filnamnet för sparade bilagor', () => {
    assert.strictEqual(sig.b64ToHex(b64('x')), hex('x'));
    assert.strictEqual(sig.b64ToHex(sha('x').toString('base64').replace(/=+$/, '')), hex('x'));
    assert.strictEqual(sig.b64ToHex(null), null);
    assert.strictEqual(sig.direction(0xa00014), 'in');
    assert.strictEqual(sig.direction(0xa00017), 'out');
    assert.strictEqual(sig.direction(0xa90017), 'out');
    assert.strictEqual(sig.direction(27), 'draft');
    assert.deepStrictEqual(sig.savedNameTime('signal-2026-11-02-20-41-09-488.jpg'), { text: '2026-11-02 20:41:09.488', ms: true });
    assert.deepStrictEqual(sig.savedNameTime('signal-2024-01-05-121530.mp4'), { text: '2024-01-05 12:15:30', ms: false });
    assert.strictEqual(sig.savedNameTime('IMG_0001.JPG'), null);
});

test('loggen: val ur galleriet med MediaStore-id, Signals kamera, redigering, sparande, radering för alla', () => {
    const ev = sig.parseLog(LOG);
    const picks = ev.filter((e) => e.kind === 'pick');
    assert.deepStrictEqual(picks.map((p) => [p.source, p.attachmentId, p.mediaId || null, !!p.discarded, !!p.edited]), [
        ['capture', 10, null, true, false],
        ['capture', 11, null, false, true],
        ['gallery', 3, 1000000094, false, false],
        ['gallery', 9, 1000000094, false, false],
    ]);
    assert.strictEqual(picks[0].size, 1453622);
    assert.deepStrictEqual(ev.filter((e) => e.kind === 'sent').map((e) => [e.messageId, e.sentMs]), [[7, at(52.556)], [15, at(200)]]);
    assert.deepStrictEqual(ev.find((e) => e.kind === 'delete'), { ms: at(500), kind: 'delete', messageId: 15, forAll: true });
    assert.deepStrictEqual(ev.find((e) => e.kind === 'saved'), { ms: at(135.3), kind: 'saved', saved: 1, of: 1 });
    assert.strictEqual(ev.find((e) => e.kind === 'video').bytes, 2270820);
    assert.ok(ev.some((e) => e.kind === 'forward') && ev.some((e) => e.kind === 'reuse' && e.templateId === 6));
    assert.ok(!ev.some((e) => e.kind === 'remote-delete'));
});

test('originalet i galleriet: skickat i meddelande 7, valt i loggen, och skickat igen i ett meddelande som raderades', () => {
    const out = sig.build({ sha256: hex('kamerabild'), mediaId: 1000000094, fileName: '2026-11-02-18-48-36-195.jpg', attachments: ATTACHMENTS, messages: MESSAGES, recipients: RECIPIENTS, log: LOG, wall });
    assert.deepStrictEqual(out.link.matches.map((m) => [m.attachmentId, m.messageId, m.on, m.transformed, m.direction, m.who]), [[3, 7, 'start', true, 'out', 'Kim']]);
    assert.strictEqual(out.link.picks.length, 2);
    assert.deepStrictEqual(out.link.picks[0], { ms: at(49.179), source: 'gallery', attachmentId: 3, messageId: 7, discarded: false, sentLater: null, deletedLater: null });
    assert.deepStrictEqual(out.link.picks[1].sentLater, { ms: at(200.3), messageId: 15 });
    assert.deepStrictEqual(out.link.picks[1].deletedLater, { ms: at(500), forAll: true });
    const fileEvents = out.events.filter((e) => e.isFile).map((e) => e.plain);
    assert.deepStrictEqual(fileEvents, [
        'Den bedömda filen väljs i Signal',
        'Den bedömda filen skickas från den här telefonen i Signal till Kim',
        'Den bedömda filen väljs i Signal',
        'Den bedömda filen skickas från den här telefonen i Signal till Kim (meddelandet raderades senare för alla)',
    ]);
    const plains = out.events.filter((e) => e.plain && !e.isFile).map((e) => e.plain);
    assert.ok(plains.includes('Bilden redigeras i Signal innan den skickas'));
    assert.ok(plains.includes('En bild tas emot i Signal från Kim för engångsvisning'));
    assert.ok(plains.includes('En bild skickas från den här telefonen i Signal till gruppen biljakt'));
    assert.ok(plains.includes('Ett meddelande raderas för alla i Signal'));
    assert.ok(plains.includes('En video spelas in med Signals kamera'));
    const recv = out.events.find((e) => e.kind === 'sig-message' && e.messageId === 12);
    assert.strictEqual(recv.text, 'Signal: bild mottagen från Kim (meddelande 12); avsändarens klocka ' + wall(at(120.488)) + ', servern ' + wall(at(118.993)));
});

test('sparad ur Signal: samma innehåll som den mottagna bilagan, sparad i loggen, filnamnet bär avsändarens tid', () => {
    const name = 'signal-' + wall(at(120.488)).replace(' ', '-').replace(/:/g, '-').replace('.', '-') + '.jpg';
    const out = sig.build({ sha256: hex('mottagen'), mediaId: 1000000096, fileName: name, fileAddedMs: at(135), savedBySignal: true, attachments: ATTACHMENTS, messages: MESSAGES, recipients: RECIPIENTS, log: LOG, wall });
    assert.deepStrictEqual(out.link.matches.map((m) => [m.attachmentId, m.on, m.direction, m.who]), [[6, 'both', 'in', 'Kim'], [15, 'both', 'out', 'gruppen biljakt']]);
    assert.deepStrictEqual(out.link.saved, { ms: at(135.3) });
    assert.deepStrictEqual(out.link.nameMatch, { attachmentId: 6, messageId: 12 });
    assert.ok(out.events.some((e) => e.kind === 'sig-saved' && e.isFile && e.plain === 'Den bedömda filen sparas ur Signal till galleriet'));
    // keep: bara händelserna i fönstret.
    const kept = sig.build({ sha256: hex('mottagen'), attachments: ATTACHMENTS, messages: MESSAGES, recipients: RECIPIENTS, log: LOG, wall, keep: (ms) => ms >= at(100) && ms <= at(160) });
    assert.ok(kept.events.length && kept.events.every((e) => e.ms >= at(100) && e.ms <= at(160)));
});

test('faktorn Signal: läget följer filens typ', () => {
    const input = (link, file) => ({ format: (ms) => wall(ms).slice(0, 19), file: Object.assign({ pk: 1000000094, addedMs: at(135) }, file || {}), signal: { link } });
    const camera = { type: 'camera', importer: 'org.lineageos.aperture' };
    const saved = { type: 'saved', importer: 'org.thoughtcrime.securesms' };
    const sentLink = sig.build({ sha256: hex('kamerabild'), mediaId: 1000000094, attachments: ATTACHMENTS, messages: MESSAGES, recipients: RECIPIENTS, log: LOG, wall }).link;
    const recvLink = sig.build({ sha256: hex('mottagen'), attachments: ATTACHMENTS.slice(1, 2), messages: MESSAGES, recipients: RECIPIENTS, log: [], wall }).link;
    const none = sig.build({ sha256: hex('ingen'), attachments: ATTACHMENTS, messages: [], recipients: RECIPIENTS, log: [], wall }).link;

    const f1 = core.factorSignal(input(sentLink, { createdMs: at(36.195) }), camera);
    assert.strictEqual(f1.state, 'info');
    assert.strictEqual(f1.verdictText, 'Skickad i Signal');
    assert.match(f1.items[0].text, /^Skickad till Kim \d\d:\d\d:\d\d \(meddelande 7\)\. Filen är originalet; Signal skickade en omkodad kopia \(1200×1600\)\.$/);
    assert.ok(f1.items.some((i) => /^Vald ur galleriet i Signal \d\d:\d\d:\d\d \(Signals logg\)\.$/.test(i.text)));
    assert.ok(f1.items.some((i) => /skickad .* \(meddelande 15, raderat för alla .*\) \(Signals logg\)/.test(i.text)));
    assert.strictEqual(f1.plain, 'Filen skickades i Signal till Kim, 16 s efter T. Den valdes ur galleriet, så Signal skapade den inte.');

    const f2 = core.factorSignal(input(recvLink), camera);
    assert.strictEqual(f2.state, 'contradiction');
    assert.strictEqual(f2.plain, 'Filen är samma bild som togs emot i Signal från Kim, inte en bild från telefonens kamera.');

    const f3 = core.factorSignal(input(recvLink), saved);
    assert.strictEqual(f3.state, 'support');
    assert.strictEqual(f3.verdictText, 'Mottagen i Signal');

    const f4 = core.factorSignal(input(none), saved);
    assert.strictEqual(f4.state, 'missing');
    assert.strictEqual(f4.items[0].text, 'Filens SHA-256 finns inte bland Signals 4 bilagor. Meddelandet kan ha raderats.');
    assert.strictEqual(core.factorSignal(input(none), camera).verdictText, 'Inte i Signal');
    assert.strictEqual(core.factorSignal({ format: wall, file: {}, signal: { error: 'krypterad utan nyckel' } }, camera).state, 'missing');
});

test('hashsökningen: SHA-256 mot databasens summor, MD5 efter dekryptering, och meningen om bilagan', async () => {
    const hashing = require('../hash-calculator/hashing');
    const hs = require('./hash-search');
    const content = { 6: Buffer.from('mottagen'), 3: Buffer.from('omkodad'), 14: Buffer.from('hd'), 15: Buffer.from('mottagen') };
    const deps = { algoOf: hs.algoOf, hasher: (a) => hashing.createHasher(a), plain: async (a) => content[a.id] ? new Uint8Array(content[a.id]) : null };
    const md5 = crypto.createHash('md5').update('omkodad').digest('hex');
    const out = await sig.findByHash([hex('kamerabild'), md5.toUpperCase(), hex('finns inte')], ATTACHMENTS, deps);
    assert.deepStrictEqual(Object.keys(out.found).sort(), [hex('kamerabild'), md5].sort());
    assert.strictEqual(out.found[hex('kamerabild')][0].on, 'start');
    assert.strictEqual(out.found[md5][0].attachment.id, 3);
    assert.strictEqual(out.decrypted, 4);
    const ctx = { recipients: RECIPIENTS, wall: (ms) => core.formatWithOffset(ms, 60) };
    assert.strictEqual(sig.attachmentText(out.found[hex('kamerabild')][0], ctx),
        'originalet till bilaga 3 (image/jpeg, 1200×1600, 333153 byte) i meddelande 7, skickad till Kim ' + core.formatWithOffset(at(52.556), 60) + ', före Signals omkodning. Originalet finns inte bland Signals filer, bara den omkodade versionen.');
    const recv = (await sig.findByHash([hex('mottagen')], ATTACHMENTS, deps)).found[hex('mottagen')];
    assert.match(sig.attachmentText(recv[0], ctx), /^bilaga 6 \(image\/jpeg, 1600×900, 33248 byte\) i meddelande 12, mottagen från Kim .* \(avsändarens klocka .*\)\. Bilagan ligger krypterad i app_parts\/part1043\.mms\.$/);
    // Bara SHA-256: inget dekrypteras.
    let calls = 0;
    const only = await sig.findByHash([hex('hd')], ATTACHMENTS, Object.assign({}, deps, { plain: async () => { calls++; return null; } }));
    assert.strictEqual(calls, 0);
    assert.strictEqual(only.found[hex('hd')][0].attachment.id, 14);
});
