'use strict';
// Underlaget till provkörningen av Laborations inläsning: loggen från en påhittad genomförd laboration och en
// påhittad iPhone som zip, med WhatsApp, bildbibliotek och knowledgeC. Den första bilden i biblioteket är en bild
// av rutan att fotografera, med QR-koden för steget i sig. Namn, nummer och texter är påhittade.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const L = require(path.join(ROOT, 'tools', 'lab', 'lab-core.js'));
const Qr = require(path.join(ROOT, 'tools', 'lab', 'qr-encode.js'));
const { buildZip } = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'zip-builder.js'));
const SCHEMAS = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'chat-schemas.json'));

// 2026-11-12 13:00:00 i loggens zon (UTC+01:00). Steg n trycks n minuter senare.
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const MIN = 60000;
const XSS = 'Samsung <img src=x onerror=window.__ftxss=1>';
const cocoa = (ms) => ms / 1000 - 978307200;
const inserter = (db) => (t, row) => db.run('INSERT INTO ' + t + ' (' + Object.keys(row).join(', ') + ') VALUES (' + Object.keys(row).map(() => '?').join(', ') + ')', Object.values(row));

// En bild (BMP, 24 bitar) med QR-koden en bit in på en ljus yta, som på ett foto av skärmen.
function qrPicture(text) {
    const m = Qr.encode(text), scale = 6, w = 480, h = 360, x0 = 150, y0 = 90, row = Math.ceil(w * 3 / 4) * 4;
    const head = Buffer.alloc(54), body = Buffer.alloc(row * h, 0xE6);
    head.write('BM');
    head.writeUInt32LE(54 + body.length, 2);
    head.writeUInt32LE(54, 10);
    head.writeUInt32LE(40, 14);
    head.writeInt32LE(w, 18);
    head.writeInt32LE(h, 22);
    head.writeUInt16LE(1, 26);
    head.writeUInt16LE(24, 28);
    head.writeUInt32LE(body.length, 34);
    const dot = (x, y, v) => { const at = (h - 1 - y) * row + x * 3; body[at] = body[at + 1] = body[at + 2] = v; };
    // Den vita rutan runt koden, och koden i den.
    const side = (m.length + 8) * scale;
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) dot(x0 + x, y0 + y, 0xFF);
    m.forEach((line, my) => line.forEach((on, mx) => {
        if (!on) return;
        for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) dot(x0 + (mx + 4) * scale + x, y0 + (my + 4) * scale + y, 0x10);
    }));
    return Buffer.concat([head, body]);
}

// Flödet: text åt båda håll, en bild av rutan, en bild till (två finns att välja på), lås, en app och en video
// som inte finns i telefonen.
function logFile() {
    const flow = L.emptyFlow('Prov i två enheter', 'L', ['iPhone', XSS]);
    [['text', { device: 'd1', other: 'd2', app: 'WhatsApp' }], ['text', { device: 'd2', other: 'd1', app: 'WhatsApp' }], ['photo', { device: 'd1' }], ['photo', { device: 'd1' }],
        ['lock', { device: 'd1' }], ['open-app', { device: 'd1', app: 'Dagbok' }], ['video', { device: 'd1' }]].forEach((s) => L.addStep(flow, s[0], s[1]));
    const run = L.newRun({ t: T0, off: 60 }, 'Europe/Stockholm');
    run.entries = flow.steps.map((s, i) => ({ step: s.id, status: 'klar', t: T0 + (i + 1) * MIN, off: 60 }));
    return JSON.stringify(L.toFile(flow, run, 'Forensics Toolbox prov', { t: T0 + 10 * MIN, off: 60 }, []));
}

function iphoneZip(SQL, jpeg) {
    const wa = new SQL.Database();
    Object.values(SCHEMAS['whatsapp-ios']).forEach((sql) => wa.run(sql));
    let ins = inserter(wa);
    ins('ZWACHATSESSION', { Z_PK: 3, ZSESSIONTYPE: 0, ZCONTACTJID: '111@lid', ZPARTNERNAME: 'Kim Påhittad' });
    ins('ZWACHATSESSION', { Z_PK: 4, ZSESSIONTYPE: 0, ZCONTACTJID: '222@lid', ZPARTNERNAME: 'Gammal chatt' });
    ins('ZWAMESSAGE', { Z_PK: 1, ZCHATSESSION: 3, ZISFROMME: 1, ZMESSAGETYPE: 0, ZTEXT: 'L01 Hej från iPhone', ZMESSAGEDATE: cocoa(T0 + 50000), ZSENTDATE: cocoa(T0 + 51000) });
    ins('ZWAMESSAGE', { Z_PK: 2, ZCHATSESSION: 3, ZISFROMME: 0, ZMESSAGETYPE: 0, ZFROMJID: '111@lid', ZTEXT: 'L02 svar', ZMESSAGEDATE: cocoa(T0 + 110000), ZSENTDATE: cocoa(T0 + 125000) });
    ins('ZWAMESSAGE', { Z_PK: 3, ZCHATSESSION: 4, ZISFROMME: 1, ZMESSAGETYPE: 0, ZTEXT: 'gammalt och utanför laborationen', ZMESSAGEDATE: cocoa(T0 - 90 * 86400000) });
    const ph = new SQL.Database();
    ph.run('CREATE TABLE ZASSET (Z_PK INTEGER PRIMARY KEY, ZDIRECTORY TEXT, ZFILENAME TEXT, ZDATECREATED REAL, ZADDEDDATE REAL, ZKINDSUBTYPE INTEGER, ZTRASHEDSTATE INTEGER, ZADDITIONALATTRIBUTES INTEGER)');
    ph.run('CREATE TABLE ZADDITIONALASSETATTRIBUTES (Z_PK INTEGER PRIMARY KEY, ZASSET INTEGER, ZIMPORTEDBY INTEGER, ZIMPORTEDBYBUNDLEIDENTIFIER TEXT)');
    ins = inserter(ph);
    // Bild 1 togs 2 s efter klockan i dess QR-kod. Bild 2 och 3 ligger båda nära det fjärde steget.
    const photo = (pk, name, ms) => ins('ZASSET', { Z_PK: pk, ZDIRECTORY: 'DCIM/100APPLE', ZFILENAME: name, ZDATECREATED: cocoa(ms), ZADDEDDATE: cocoa(ms + 1000), ZKINDSUBTYPE: 0, ZTRASHEDSTATE: 0 });
    photo(1, 'IMG_0001.JPG', T0 + 3 * MIN - 8000);
    photo(2, 'IMG_0002.JPG', T0 + 4 * MIN - 20000);
    photo(3, 'IMG_0003.JPG', T0 + 4 * MIN - 5000);
    photo(4, 'IMG_0000.JPG', T0 - 300 * 86400000);
    const kc = new SQL.Database();
    kc.run('CREATE TABLE ZOBJECT (Z_PK INTEGER PRIMARY KEY, ZSTREAMNAME TEXT, ZSTARTDATE REAL, ZENDDATE REAL, ZVALUEINTEGER INTEGER, ZVALUESTRING TEXT)');
    ins = inserter(kc);
    ins('ZOBJECT', { ZSTREAMNAME: '/device/isLocked', ZSTARTDATE: cocoa(T0 + 5 * MIN - 4000), ZENDDATE: cocoa(T0 + 6 * MIN - 30000), ZVALUEINTEGER: 1 });
    ins('ZOBJECT', { ZSTREAMNAME: '/app/usage', ZSTARTDATE: cocoa(T0 + 6 * MIN - 20000), ZENDDATE: cocoa(T0 + 6 * MIN + 20000), ZVALUESTRING: 'com.example.dagbok' });
    const M = 'private/var/mobile/';
    const zip = buildZip([
        { name: M + 'Containers/Shared/AppGroup/66666666-7777-4888-9999-AAAAAAAAAAAA/ChatStorage.sqlite', data: Buffer.from(wa.export()), deflate: true },
        { name: M + 'Media/PhotoData/Photos.sqlite', data: Buffer.from(ph.export()), deflate: true },
        { name: M + 'Library/CoreDuet/Knowledge/knowledgeC.db', data: Buffer.from(kc.export()), deflate: true },
        { name: M + 'Media/DCIM/100APPLE/IMG_0001.JPG', data: qrPicture(L.shotText('L03', T0 + 3 * MIN - 10000)), deflate: true },
        { name: M + 'Media/DCIM/100APPLE/IMG_0002.JPG', data: jpeg },
        { name: M + 'Media/DCIM/100APPLE/IMG_0003.JPG', data: Buffer.concat([jpeg, Buffer.from('IMG_0003')]) },
    ]);
    [wa, ph, kc].forEach((d) => d.close());
    return Buffer.isBuffer(zip) ? zip : zip.buf;
}

// Skriver loggen och zippen i mappen och säger var de ligger.
function build(SQL, dir) {
    const jpeg = fs.readFileSync(path.join(ROOT, 'tools', 'exif-viewer', 'fixtures', 'exif-sample.jpg'));
    const files = { log: path.join(dir, 'laboration-prov.json'), zip: path.join(dir, 'Prov-iPhone.zip') };
    fs.writeFileSync(files.log, logFile());
    fs.writeFileSync(files.zip, iphoneZip(SQL, jpeg));
    return files;
}

module.exports = { build, logFile, iphoneZip, qrPicture, T0, MIN, XSS };
