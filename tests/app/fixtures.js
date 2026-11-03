// Påhittade testfiler till provkörningarna, utan riktiga data: en liten iOS 17-extraktion (zip) med
// Photos.sqlite, knowledgeC.db med en trasig -wal, SystemVersion.plist och bildfiler, och samma bild
// och knowledgeC.db som lösa filer på disk. Bilden är tools/exif-viewer/fixtures/exif-sample.jpg,
// tagen 2024-06-01 14:34:56 +02:00 med en iPhone 15 Pro. Två poster bär HTML i namnet, så att
// provkörningen märker om något skrivs in i sidan utan att escapas.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const { buildZip } = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'zip-builder.js'));
const schemas = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'photos-schema.json'));

const COCOA = 978307200;
const T = Date.UTC(2024, 5, 1, 12, 34, 56) / 1000;   // tiden i exif-sample.jpg (14:34:56 +02:00)
const XSS = '<img src=x onerror="window.__ftxss=1;try{top.__ftxss=1}catch(e){}">';

async function loadSql() {
    const vendor = path.join(ROOT, 'tools', 'ios-keychain', 'vendor', 'sqljs');
    const sandbox = { window: {}, atob: (s) => Buffer.from(s, 'base64').toString('binary') };
    vm.runInNewContext(fs.readFileSync(path.join(vendor, 'sql-wasm-binary.js'), 'utf8'), sandbox);
    const initSqlJs = require(path.join(vendor, 'sql-wasm.js'));
    return initSqlJs({ wasmBinary: sandbox.window.SQL_WASM_BINARY });
}

function insert(db, table, row) {
    const cols = Object.keys(row);
    db.run('INSERT INTO "' + table + '" (' + cols.map((c) => '"' + c + '"').join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')', cols.map((c) => row[c]));
}

// Photos.sqlite med iOS 17:s schema (ur iLEAPP, fixtures/photos-schema.json). Rad 1 är bilden i zippen;
// rad 2 har samma namn i en annan mapp och en månad senare; rad 3 är grannen; rad 4 har HTML i namnet.
function photosDb(SQL) {
    const db = new SQL.Database();
    for (const [table, cols] of Object.entries(schemas['17'])) db.run('CREATE TABLE "' + table + '" (' + cols.map((c) => '"' + c + '"').join(', ') + ')');
    const rows = [
        { pk: 1, dir: 'DCIM/100APPLE', name: 'IMG_0001.JPG', at: T, lat: 59.3326, lon: 18.0649 },
        { pk: 2, dir: 'DCIM/101APPLE', name: 'IMG_0001.JPG', at: T + 30 * 86400, lat: null, lon: null },
        { pk: 3, dir: 'DCIM/100APPLE', name: 'IMG_0002.JPG', at: T + 40, lat: 59.3327, lon: 18.0650 },
        { pk: 4, dir: 'DCIM/100APPLE', name: XSS + '.JPG', at: T + 60, lat: null, lon: null },
    ];
    rows.forEach((r) => {
        insert(db, 'ZASSET', {
            Z_PK: r.pk, ZDIRECTORY: r.dir, ZFILENAME: r.name, ZDATECREATED: r.at - COCOA, ZADDEDDATE: r.at + 0.3 - COCOA, ZMODIFICATIONDATE: r.at + 5 - COCOA,
            ZSAVEDASSETTYPE: 3, ZKIND: 0, ZKINDSUBTYPE: 0, ZUNIFORMTYPEIDENTIFIER: 'public.jpeg', ZCLOUDLOCALSTATE: 1, ZTRASHEDSTATE: 0, ZHIDDEN: 0,
            ZLATITUDE: r.lat == null ? -180 : r.lat, ZLONGITUDE: r.lon == null ? -180 : r.lon, ZADDITIONALATTRIBUTES: r.pk, ZEXTENDEDATTRIBUTES: r.pk,
        });
        insert(db, 'ZADDITIONALASSETATTRIBUTES', {
            Z_PK: r.pk, ZASSET: r.pk, ZORIGINALFILENAME: r.name, ZEXIFTIMESTAMPSTRING: '2024:06:01 14:34:56', ZTIMEZONENAME: 'Europe/Stockholm', ZTIMEZONEOFFSET: 7200,
            ZIMPORTEDBY: 1, ZIMPORTEDBYBUNDLEIDENTIFIER: 'com.apple.camera', ZIMPORTEDBYDISPLAYNAME: 'Kamera',
        });
        insert(db, 'ZEXTENDEDATTRIBUTES', { Z_PK: r.pk, ZCAMERAMAKE: 'Apple', ZCAMERAMODEL: 'iPhone 15 Pro' });
    });
    const bytes = db.export();
    db.close();
    return bytes;
}

// knowledgeC.db: kameran i förgrunden runt T, sedan Bilder; skärmen tänd och olåst. Täckning från dagen före.
function knowledgeDb(SQL) {
    const db = new SQL.Database();
    db.run('CREATE TABLE ZOBJECT (Z_PK INTEGER PRIMARY KEY, ZSTREAMNAME TEXT, ZSTARTDATE REAL, ZENDDATE REAL, ZCREATIONDATE REAL, ZVALUESTRING TEXT, ZVALUEINTEGER INTEGER, ZVALUEDOUBLE REAL, ZSECONDSFROMGMT INTEGER)');
    const rows = [
        ['/app/usage', T - 86400, T - 86300, 'com.apple.mobilesafari', null],
        ['/app/usage', T - 30, T + 20, 'com.apple.camera', null],
        ['/app/usage', T + 25, T + 60, 'com.apple.mobileslideshow', null],
        ['/display/isBacklit', T - 86400, T - 86000, null, 1],
        ['/display/isBacklit', T - 120, T + 300, null, 1],
        ['/device/isLocked', T - 86400, T - 86000, null, 0],
        ['/device/isLocked', T - 100, T + 300, null, 0],
    ];
    rows.forEach((r) => insert(db, 'ZOBJECT', { ZSTREAMNAME: r[0], ZSTARTDATE: r[1] - COCOA, ZENDDATE: r[2] - COCOA, ZCREATIONDATE: r[2] - COCOA, ZVALUESTRING: r[3], ZVALUEINTEGER: r[4], ZSECONDSFROMGMT: 7200 }));
    const bytes = db.export();
    db.close();
    return bytes;
}

// routined Cache.sqlite: telefonens positioner runt T, några meter från bildens.
function routinedDb(SQL) {
    const db = new SQL.Database();
    db.run('CREATE TABLE ZRTCLLOCATIONMO (Z_PK INTEGER PRIMARY KEY, ZTIMESTAMP REAL, ZLATITUDE REAL, ZLONGITUDE REAL, ZHORIZONTALACCURACY REAL, ZALTITUDE REAL, ZSPEED REAL, ZCOURSE REAL, ZTYPE INTEGER)');
    [[-300, 59.3329, 18.0655], [-20, 59.3327, 18.0650], [45, 59.3326, 18.0648], [400, 59.3335, 18.0670]].forEach((r) =>
        insert(db, 'ZRTCLLOCATIONMO', { ZTIMESTAMP: T + r[0] - COCOA, ZLATITUDE: r[1], ZLONGITUDE: r[2], ZHORIZONTALACCURACY: 8, ZALTITUDE: 20, ZSPEED: 0.5, ZCOURSE: -1, ZTYPE: 1 }));
    const bytes = db.export();
    db.close();
    return bytes;
}

// En -wal med giltigt magiskt tal och sidstorlek men fel checksumma i huvudet: SQLite hoppar över den.
function brokenWal() {
    const b = Buffer.alloc(32 + 24 + 4096);
    b.writeUInt32BE(0x377f0682, 0);
    b.writeUInt32BE(3007000, 4);
    b.writeUInt32BE(4096, 8);
    b.writeUInt32BE(0xdeadbeef, 24);
    b.writeUInt32BE(0xdeadbeef, 28);
    return b;
}

// Bygger filerna i en ny tillfällig mapp. Returnerar sökvägarna och de kända värdena.
async function build() {
    const SQL = await loadSql();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-provkorning-'));
    const jpeg = fs.readFileSync(path.join(ROOT, 'tools', 'exif-viewer', 'fixtures', 'exif-sample.jpg'));
    // Andra bytes än bilden (en kommentar efter slutmarkören), så att kopiorna inte blir samma fil.
    const other = (tag) => Buffer.concat([jpeg, Buffer.from(tag)]);
    const photos = Buffer.from(photosDb(SQL));
    const knowledge = Buffer.from(knowledgeDb(SQL));
    const P = 'filesystem1/private/var/mobile/';
    const zip = buildZip([
        { name: 'filesystem1/System/Library/CoreServices/SystemVersion.plist', data: '<?xml version="1.0"?><plist><dict><key>ProductVersion</key><string>17.5.1</string></dict></plist>' },
        { name: P + 'Media/PhotoData/Photos.sqlite', data: photos, deflate: true },
        { name: P + 'Media/PhotoData/Photos.sqlite-wal', data: '' },
        { name: P + 'Library/CoreDuet/Knowledge/knowledgeC.db', data: knowledge, deflate: true },
        { name: P + 'Library/CoreDuet/Knowledge/knowledgeC.db-wal', data: brokenWal() },
        { name: P + 'Library/Caches/com.apple.routined/Cache.sqlite', data: Buffer.from(routinedDb(SQL)), deflate: true },
        { name: P + 'Library/Caches/com.apple.routined/Cache.sqlite-wal', data: '' },
        { name: P + 'Media/DCIM/100APPLE/IMG_0001.JPG', data: jpeg, mtime: T + 1 },
        { name: P + 'Media/DCIM/100APPLE/IMG_0002.JPG', data: other('IMG_0002'), mtime: T + 41 },
        { name: P + 'Media/DCIM/101APPLE/IMG_0001.JPG', data: other('101APPLE'), mtime: T + 30 * 86400 },
        { name: P + 'Library/Caches/' + XSS + '.jpg', data: other('xss'), mtime: T + 10 },
    ]);
    const files = {
        dir,
        zip: path.join(dir, 'Testextraktion-iOS17.zip'),
        image: path.join(dir, 'IMG_0001.JPG'),
        knowledge: path.join(dir, 'knowledgeC.db'),
    };
    fs.writeFileSync(files.zip, zip);
    fs.writeFileSync(files.image, jpeg);
    fs.writeFileSync(files.knowledge, knowledge);
    return { files, T: T * 1000, imageName: 'IMG_0001.JPG' };
}

module.exports = { build, T: T * 1000 };
