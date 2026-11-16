'use strict';
// Laborationens underlag ur en extraktion: delarna var för sig, och hela läsningen mot en påhittad zip med
// WhatsApp, bildbibliotek och knowledgeC, jämförd med en påhittad logg. Namn, nummer och texter är påhittade.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const L = require('./lab-core.js');
const T = require('./lab-trace.js');
const R = require('./lab-read.js');
const core = require('../db-queries/extraction-core.js');
const { buildZip } = require('../db-queries/fixtures/zip-builder');
const SCHEMAS = require('../db-queries/fixtures/chat-schemas.json');
const cat = (p) => require(path.join(ROOT, 'queries', p, 'catalog.json'));

core.use({ ZipRead: require('../db-queries/zip'), ZipLocate: require('../db-queries/locate'), SqliteWal: require('../db-queries/wal'), ToolboxHashing: require('../hash-calculator/hashing') });
R.use({ ExtractionCore: core, ZipRead: require('../db-queries/zip'), ChatCore: require('../chats/chat-core.js'), ProvenanceRoles: require('../provenance/roles.js'),
    ProvenanceAndroidLogs: require('../provenance/android-logs.js'), ProvenanceCore: require('../provenance/timeline-core.js') });

const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const MIN = 60000;
const cocoa = (ms) => ms / 1000 - 978307200;
const O = { prefix: 'L', width: 2, period: { startMs: T0 - 86400000, endMs: T0 + 86400000 } };

let SQLJS = null;
async function sqlJs() {
    if (SQLJS) return SQLJS;
    const dir = path.join(ROOT, 'tools', 'ios-keychain', 'vendor', 'sqljs');
    const ctx = {};
    new Function('window', fs.readFileSync(path.join(dir, 'sql-wasm-binary.js'), 'utf8'))(ctx);
    SQLJS = await require(path.join(dir, 'sql-wasm.js'))({ wasmBinary: ctx.SQL_WASM_BINARY });
    return SQLJS;
}
function fakeFile(buf, name) {
    const slice = (a, b) => ({ arrayBuffer: async () => buf.buffer.slice(buf.byteOffset + a, buf.byteOffset + Math.min(b, buf.length)) });
    return { name, size: buf.length, lastModified: 1, slice };
}
const inserter = (db) => (t, row) => db.run('INSERT INTO ' + t + ' (' + Object.keys(row).join(', ') + ') VALUES (' + Object.keys(row).map(() => '?').join(', ') + ')', Object.values(row));

test('perioden är loggens tid med ett dygn åt vardera hållet', () => {
    assert.deepStrictEqual(R.period({ started: T0, entries: [{ t: T0 + MIN }, { t: null }, { t: T0 + 5 * MIN }] }), { startMs: T0 - 86400000, endMs: T0 + 5 * MIN + 86400000 });
});

test('meddelandena: koderna tas ur text, bildtext och filnamn, texten sparas inte och gamla meddelanden utan kod utelämnas', () => {
    const time = (key, ms) => ({ key, label: key, col: 'T.' + key, ms });
    const conv = { thread: { key: '7' }, messages: [
        { key: '1', id: 1, fromMe: true, kind: 'text', deleted: false, text: 'L03 hej', sortMs: T0, times: [time('date', T0), time('sent', null)], attachments: [] },
        { key: '2', id: 2, fromMe: false, kind: 'image', deleted: false, text: '', sortMs: T0 + MIN, times: [time('date', T0 + MIN)], attachments: [{ title: 'L04 bild', name: 'x.jpg', kind: 'image' }] },
        { key: '3', id: 3, fromMe: false, kind: 'file', deleted: false, text: '', sortMs: T0 + 2 * MIN, times: [time('date', T0 + 2 * MIN)], attachments: [{ title: '', name: 'L05.pdf', kind: 'file' }] },
        { key: '4', id: 4, fromMe: true, kind: 'other', deleted: false, text: '', sortMs: T0 + 3 * MIN, times: [time('date', T0 + 3 * MIN)], attachments: [{ kind: 'voice' }] },
        { key: '5', id: 5, fromMe: true, kind: 'text', deleted: false, text: 'gammalt utan kod', sortMs: T0 - 40 * 86400000, times: [time('date', T0 - 40 * 86400000)], attachments: [] },
        { key: '6', id: 6, fromMe: true, kind: 'text', deleted: false, text: 'L06 med fel klocka', sortMs: T0 - 40 * 86400000, times: [time('date', T0 - 40 * 86400000)], attachments: [] },
    ] };
    const list = R.messagesOf({ key: 'wa', app: 'WhatsApp' }, conv, 'ChatStorage.sqlite', O, { queryId: 'q' });
    assert.deepStrictEqual(list.map((m) => [m.key, m.codes.join(), m.kind, m.fromMe]), [['wa|7|1', 'L03', 'text', true], ['wa|7|2', 'L04', 'image', false], ['wa|7|3', 'L05', 'file', false], ['wa|7|4', '', 'voice', true], ['wa|7|6', 'L06', 'text', true]]);
    assert.deepStrictEqual(list[0].times, [{ key: 'date', label: 'date', col: 'T.date', ms: T0 }]);
    assert.deepStrictEqual(list[0].ref, { query: { queryId: 'q' }, id: 1 });
    assert.ok(!JSON.stringify(list).includes('hej'), 'texten sparas inte');
});

test('bildbiblioteket: sort efter filnamn och märkning, och en fil vars egen tid ligger utanför tas på tiden den lades till', () => {
    const cols = { created: 'ZDATECREATED', added: 'ZADDEDDATE' };
    const ios = R.mediaOf([
        { pk: 1, directory: 'DCIM/100APPLE', filename: 'IMG_0001.HEIC', createdMs: T0, addedMs: T0 + 1000, kindSubtype: 0 },
        { pk: 2, directory: 'DCIM/100APPLE', filename: 'IMG_0002.MOV', createdMs: T0 + MIN, addedMs: T0 + MIN, kindSubtype: 0 },
        { pk: 3, directory: 'DCIM/100APPLE', filename: 'IMG_0003.PNG', createdMs: T0 + 2 * MIN, addedMs: T0 + 2 * MIN, kindSubtype: 10 },
        { pk: 4, directory: 'DCIM/100APPLE', filename: 'IMG_0004.HEIC', createdMs: T0 - 400 * 86400000, addedMs: T0 + 3 * MIN, kindSubtype: 0 },
        { pk: 5, directory: 'DCIM/100APPLE', filename: 'IMG_0005.HEIC', createdMs: T0 - 400 * 86400000, addedMs: T0 - 400 * 86400000, kindSubtype: 0 },
    ], 'iOS', 'Photos.sqlite', O, cols);
    assert.deepStrictEqual(ios.map((m) => [m.key, m.kind, m.ms - T0, m.col, m.what || '']), [
        ['media|1', 'photo', 0, 'ZDATECREATED', ''], ['media|2', 'video', MIN, 'ZDATECREATED', ''], ['media|3', 'screenshot', 2 * MIN, 'ZDATECREATED', ''],
        ['media|4', 'photo', 3 * MIN, 'ZADDEDDATE', 'filen tillagd i biblioteket']]);
    assert.strictEqual(ios[0].path, 'DCIM/100APPLE/IMG_0001.HEIC');
    const android = R.mediaOf([
        { pk: 9, relativePath: 'DCIM/Screenshots/', filename: 'Screenshot_20261112.jpg', createdMs: T0, addedMs: T0 },
        { pk: 8, relativePath: 'DCIM/Camera/', filename: '20261112_130000.mp4', createdMs: T0 - 1000, addedMs: T0 },
    ], 'Android', 'external.db', O, { created: 'datetaken', added: 'date_added' });
    assert.deepStrictEqual(android.map((m) => [m.kind, m.path]), [['video', 'DCIM/Camera/20261112_130000.mp4'], ['screenshot', 'DCIM/Screenshots/Screenshot_20261112.jpg']]);
});

test('lås på iOS: varje byte av läge blir en händelse en gång, och de låsta tiderna sparas', () => {
    const out = R.locksOf([
        { startMs: T0, endMs: T0 + MIN, value: 1 },
        { startMs: T0 + MIN, endMs: T0 + 3 * MIN, value: 0 },
        { startMs: T0 + 3 * MIN, endMs: T0 + 9 * MIN, value: 1 },
    ], 'knowledgeC.db');
    assert.deepStrictEqual(out.events.map((e) => [e.kind, (e.ms - T0) / MIN]), [['lock', 0], ['unlock', 1], ['lock', 3], ['unlock', 9]]);
    assert.deepStrictEqual(out.locks.map((l) => [(l.startMs - T0) / MIN, (l.endMs - T0) / MIN]), [[0, 1], [3, 9]]);
});

test('usagestats: lås, upplåsning, av och på, och upplåsningen efter en start räknas en gång', () => {
    const e = (type, s) => ({ type, ms: T0 + s * 1000, pkg: 'android' });
    const decoded = [{ events: [e(17, 0), e(18, 30), e(26, 60), e(27, 120), e(28, 140), e(18, 141), e(17, 200), e(18, 400 * 86400)] }];
    const iv = { lock: [{ startMs: T0, endMs: T0 + 30000, locked: true }, { startMs: T0 + 30000, endMs: T0 + 60000, locked: false }],
        apps: [{ startMs: T0 + 31000, endMs: T0 + 50000, app: 'com.whatsapp' }, { startMs: T0 + 150000, endMs: T0 + 190000, app: 'org.telegram.messenger', openEnded: true }] };
    const out = R.usageOf(decoded, iv, O);
    assert.deepStrictEqual(out.events.map((x) => [x.kind, (x.ms - T0) / 1000]), [['lock', 0], ['unlock', 30], ['off', 60], ['on', 120], ['unlock', 140], ['lock', 200]]);
    assert.strictEqual(out.events[2].col, 'händelse 26 (DEVICE_SHUTDOWN)');
    // Raden om starten skrivs först när telefonen låses upp, och det står vid den.
    assert.deepStrictEqual(out.events.map((x) => !!x.late), [false, false, false, true, false, false]);
    assert.strictEqual(out.events[3].what, 'startad; raden skrivs vid första upplåsningen efter starten');
    // En avstängning eller start på två rader tätt efter varandra räknas en gång; en ny en minut senare är en ny.
    const twice = R.usageOf([{ events: [e(26, 60), e(26, 61.7), e(27, 120), e(27, 124), e(26, 180)] }], { lock: [], apps: [] }, O);
    assert.deepStrictEqual(twice.events.map((x) => [x.kind, (x.ms - T0) / 1000]), [['off', 60], ['on', 120], ['off', 180]]);
    assert.deepStrictEqual(out.locks.map((l) => [l.startMs - T0, l.endMs - T0]), [[0, 30000]]);
    assert.deepStrictEqual(out.apps.map((a) => [a.app, a.endMs === null]), [['com.whatsapp', false], ['org.telegram.messenger', true]]);
});

// En påhittad iPhone: WhatsApp med två kodade meddelanden och ett gammalt, ett bildbibliotek med två bilder från
// laborationen och knowledgeC med lås och app.
async function iphoneZip() {
    const S = await sqlJs();
    const wa = new S.Database();
    Object.values(SCHEMAS['whatsapp-ios']).forEach((sql) => wa.run(sql));
    let ins = inserter(wa);
    ins('ZWACHATSESSION', { Z_PK: 3, ZSESSIONTYPE: 0, ZCONTACTJID: '111@lid', ZPARTNERNAME: 'Kim Påhittad' });
    ins('ZWACHATSESSION', { Z_PK: 4, ZSESSIONTYPE: 0, ZCONTACTJID: '222@lid', ZPARTNERNAME: 'Gammal chatt' });
    ins('ZWAMESSAGE', { Z_PK: 1, ZCHATSESSION: 3, ZISFROMME: 1, ZMESSAGETYPE: 0, ZTEXT: 'L01 Hej från iPhone', ZMESSAGEDATE: cocoa(T0 + 50000), ZSENTDATE: cocoa(T0 + 51000) });
    ins('ZWAMESSAGE', { Z_PK: 2, ZCHATSESSION: 3, ZISFROMME: 0, ZMESSAGETYPE: 0, ZFROMJID: '111@lid', ZTEXT: 'L02 svar', ZMESSAGEDATE: cocoa(T0 + 110000), ZSENTDATE: cocoa(T0 + 125000) });
    ins('ZWAMESSAGE', { Z_PK: 3, ZCHATSESSION: 4, ZISFROMME: 1, ZMESSAGETYPE: 0, ZTEXT: 'hemligt och gammalt', ZMESSAGEDATE: cocoa(T0 - 90 * 86400000) });
    const ph = new S.Database();
    ph.run('CREATE TABLE ZASSET (Z_PK INTEGER PRIMARY KEY, ZDIRECTORY TEXT, ZFILENAME TEXT, ZDATECREATED REAL, ZADDEDDATE REAL, ZKINDSUBTYPE INTEGER, ZTRASHEDSTATE INTEGER, ZADDITIONALATTRIBUTES INTEGER)');
    ph.run('CREATE TABLE ZADDITIONALASSETATTRIBUTES (Z_PK INTEGER PRIMARY KEY, ZASSET INTEGER, ZIMPORTEDBY INTEGER, ZIMPORTEDBYBUNDLEIDENTIFIER TEXT)');
    ins = inserter(ph);
    ins('ZASSET', { Z_PK: 1, ZDIRECTORY: 'DCIM/100APPLE', ZFILENAME: 'IMG_0001.JPG', ZDATECREATED: cocoa(T0 + 3 * MIN - 8000), ZADDEDDATE: cocoa(T0 + 3 * MIN - 7000), ZKINDSUBTYPE: 0, ZTRASHEDSTATE: 0 });
    ins('ZASSET', { Z_PK: 2, ZDIRECTORY: 'DCIM/100APPLE', ZFILENAME: 'IMG_0002.HEIC', ZDATECREATED: cocoa(T0 + 4 * MIN - 5000), ZADDEDDATE: cocoa(T0 + 4 * MIN - 5000), ZKINDSUBTYPE: 0, ZTRASHEDSTATE: 0 });
    ins('ZASSET', { Z_PK: 3, ZDIRECTORY: 'DCIM/100APPLE', ZFILENAME: 'IMG_0000.JPG', ZDATECREATED: cocoa(T0 - 300 * 86400000), ZADDEDDATE: cocoa(T0 - 300 * 86400000), ZKINDSUBTYPE: 0, ZTRASHEDSTATE: 0 });
    const kc = new S.Database();
    kc.run('CREATE TABLE ZOBJECT (Z_PK INTEGER PRIMARY KEY, ZSTREAMNAME TEXT, ZSTARTDATE REAL, ZENDDATE REAL, ZVALUEINTEGER INTEGER, ZVALUESTRING TEXT)');
    ins = inserter(kc);
    ins('ZOBJECT', { ZSTREAMNAME: '/device/isLocked', ZSTARTDATE: cocoa(T0 + 5 * MIN - 4000), ZENDDATE: cocoa(T0 + 6 * MIN - 3000), ZVALUEINTEGER: 1 });
    ins('ZOBJECT', { ZSTREAMNAME: '/app/usage', ZSTARTDATE: cocoa(T0 + 6 * MIN + 2000), ZENDDATE: cocoa(T0 + 7 * MIN + 20000), ZVALUESTRING: 'com.example.dagbok' });
    const M = 'private/var/mobile/';
    const files = [
        { name: M + 'Containers/Shared/AppGroup/66666666-7777-4888-9999-AAAAAAAAAAAA/ChatStorage.sqlite', data: Buffer.from(wa.export()) },
        { name: M + 'Media/PhotoData/Photos.sqlite', data: Buffer.from(ph.export()) },
        { name: M + 'Library/CoreDuet/Knowledge/knowledgeC.db', data: Buffer.from(kc.export()) },
        { name: M + 'Media/DCIM/100APPLE/IMG_0001.JPG', data: Buffer.from('bild 1') },
        { name: M + 'Media/DCIM/100APPLE/IMG_0002.HEIC', data: Buffer.from('bild 2 i ett format som inte visas') },
        { name: M + 'Media/PhotoData/Thumbnails/V2/DCIM/100APPLE/IMG_0002.HEIC/5005.JPG', data: Buffer.from('kopian av bild 2') },
        { name: M + 'Media/PhotoData/Thumbnails/V2/DCIM/100APPLE/IMG_0001.JPG/5005.JPG', data: Buffer.from('kopian av bild 1') },
    ];
    [wa, ph, kc].forEach((d) => d.close());
    return buildZip(files);
}

test('hela läsningen: en påhittad iPhone läses och loggens steg hittas i den, med källan till varje spår', async () => {
    const S = await sqlJs();
    const zip = await iphoneZip();
    const buf = Buffer.isBuffer(zip) ? zip : zip.buf;
    const stages = [], seen = [];
    const out = await R.read(fakeFile(buf, 'iphone.zip'), Object.assign({}, O, {
        SQL: S, onStage: (text) => stages.push(text),
        catalogs: { chats: [cat('ios/whatsapp')], photos: cat('ios/photos-sqlite'), appUsage: cat('app-usage'), android: cat('android') },
        // Bilden "avkodas" här: innehållet säger vilken fil som lästes, och bild 1 bär QR-koden för L03.
        picture: async (bytes, name) => { const text = Buffer.from(bytes).toString(); seen.push(text); return { text: text === 'bild 1' ? L.shotText('L03', T0 + 3 * MIN - 9000) : null, thumb: 'data:' + name.length }; },
    }));
    assert.strictEqual(out.platform, 'iOS');
    assert.deepStrictEqual(out.missing, []);
    assert.deepStrictEqual(out.read, ['ChatStorage.sqlite (WhatsApp) (1 chatt av 2, 2 meddelanden)', 'bildbiblioteket (2 filer från laborationen, QR-koden läst i 1)', 'knowledgeC.db (lås och app framme; av och på söks inte på iOS)']);
    // Bild 1 visas som den är, bild 2 (HEIC) läses ur telefonens JPEG-kopia.
    assert.deepStrictEqual(seen, ['bild 1', 'kopian av bild 2']);
    assert.ok(!JSON.stringify(out.evidence).includes('Hej från'), 'ingen meddelandetext i underlaget');
    assert.ok(stages.some((s) => /läser chatt 1 av 1/.test(s)) && stages.some((s) => /Läser bild 2 av 2/.test(s)), stages.join(' | '));

    const flow = L.emptyFlow('Prov', 'L', ['iPhone', 'Samsung']);
    [['text', { device: 'd1', other: 'd2', app: 'WhatsApp' }], ['text', { device: 'd2', other: 'd1', app: 'WhatsApp' }], ['photo', { device: 'd1' }], ['photo', { device: 'd1' }],
        ['lock', { device: 'd1' }], ['unlock', { device: 'd1' }], ['open-app', { device: 'd1', app: 'Dagbok' }]].forEach((s) => L.addStep(flow, s[0], s[1]));
    const run = L.newRun(() => T0, 'Europe/Stockholm');
    run.entries = flow.steps.map((s, i) => ({ step: s.id, status: 'klar', t: T0 + (i + 1) * MIN, off: 60 }));
    const res = T.match(flow, run, { d1: out.evidence });
    assert.deepStrictEqual(res.rows.map((r) => [r.code, r.mark, r.best && r.best.what, r.best && r.best.source]), [
        ['L01', 'sure', 'skickat', 'ChatStorage.sqlite · ZMESSAGEDATE'],
        ['L02', 'sure', 'mottaget', 'ChatStorage.sqlite · ZMESSAGEDATE'],
        ['L03', 'sure', 'bilden tagen', 'Photos.sqlite · ZDATECREATED'],
        ['L04', 'likely', 'bilden tagen', 'Photos.sqlite · ZDATECREATED'],
        ['L05', 'likely', 'låst', 'knowledgeC.db · /device/isLocked · ZSTARTDATE'],
        ['L06', 'likely', 'upplåst', 'knowledgeC.db · /device/isLocked · ZENDDATE'],
        ['L07', 'likely', 'appen framme', 'knowledgeC.db · /app/usage'],
    ]);
    // Telefonens klocka mot datorns ur QR-bilden: bilden togs 1 s efter klockan i koden, minus den halva sekunden.
    assert.deepStrictEqual(res.clocks, { d1: { ms: 500, n: 1 } });
    // Källan går att öppna: samma query som lästes, med chattens id ifyllt och raden att markera.
    const ref = res.rows[0].best.item.ref;
    assert.strictEqual(ref.id, 1);
    assert.strictEqual(ref.query.path, 'private/var/mobile/Containers/Shared/AppGroup/66666666-7777-4888-9999-AAAAAAAAAAAA/ChatStorage.sqlite');
    assert.ok(/ZCHATSESSION = '3'/.test(ref.query.sql) && !/\{\{/.test(ref.query.sql), ref.query.sql.slice(0, 200));
    assert.strictEqual(res.rows[2].best.thumb, 'data:' + 'private/var/mobile/Media/DCIM/100APPLE/IMG_0001.JPG'.length);
    assert.ok(/ZDATECREATED BETWEEN/.test(res.rows[2].best.item.ref.query.sql));
});

test('en fil utan kända databaser läses utan fel och säger att inget hittades', async () => {
    const S = await sqlJs();
    const zip = buildZip([{ name: 'annat/readme.txt', data: Buffer.from('x') }]);
    const out = await R.read(fakeFile(Buffer.isBuffer(zip) ? zip : zip.buf, 'tom.zip'), Object.assign({}, O, { SQL: S,
        catalogs: { chats: [cat('ios/whatsapp')], photos: cat('ios/photos-sqlite'), appUsage: cat('app-usage'), android: cat('android') } }));
    assert.strictEqual(out.platform, null);
    assert.deepStrictEqual(out.read, []);
    assert.deepStrictEqual(out.missing, ['ingen av databaserna som programmet känner till finns i filen']);
});
