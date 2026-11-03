// Påhittade testfiler till provkörningarna, utan riktiga data: en liten iOS 17-extraktion (zip) med
// Photos.sqlite, knowledgeC.db med en trasig -wal, SystemVersion.plist och bildfiler, och samma bild
// och knowledgeC.db som lösa filer på disk. Bilden är tools/exif-viewer/fixtures/exif-sample.jpg,
// tagen 2024-06-01 14:34:56 +02:00 med en iPhone 15 Pro. Två poster bär HTML i namnet, så att
// provkörningen märker om något skrivs in i sidan utan att escapas.
// Tre dagar senare: Signals databas (krypterad med SQLCipher som på iOS, nyckeln i en påhittad
// nyckelring bredvid zippen) med en mottagen bild som sparats i bildbiblioteket, och WhatsApps
// databas med en bild vald ur bildbiblioteket och en mottagen bild. Namnen i chattarna bär HTML.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const { buildZip } = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'zip-builder.js'));
const schemas = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'photos-schema.json'));
const chatSchemas = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'chat-schemas.json'));

const COCOA = 978307200;
const T = Date.UTC(2024, 5, 1, 12, 34, 56) / 1000;   // tiden i exif-sample.jpg (14:34:56 +02:00)
const XSS = '<img src=x onerror="window.__ftxss=1;try{top.__ftxss=1}catch(e){}">';
const T2 = T + 3 * 86400;                              // Signal och WhatsApp
const UUID_LIB = '5A5A5A5A-1111-4222-8333-944444444444';  // bildbibliotekets id för IMG_0005
const SIGNAL_KEY = Buffer.from(Array.from({ length: 48 }, (_, i) => (i * 7 + 3) & 255));  // påhittad
const GROUP_SIGNAL = 'AppGroup/11111111-2222-4333-8444-555555555555/';
const GROUP_WA = 'AppGroup/66666666-7777-4888-9999-AAAAAAAAAAAA/';

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
    // Rad 5 är en kamerabild som skickades i WhatsApp; rad 6 sparade Signal ur en mottagen bild.
    const rows = [
        { pk: 1, dir: 'DCIM/100APPLE', name: 'IMG_0001.JPG', at: T, lat: 59.3326, lon: 18.0649 },
        { pk: 2, dir: 'DCIM/101APPLE', name: 'IMG_0001.JPG', at: T + 30 * 86400, lat: null, lon: null },
        { pk: 3, dir: 'DCIM/100APPLE', name: 'IMG_0002.JPG', at: T + 40, lat: 59.3327, lon: 18.0650 },
        { pk: 4, dir: 'DCIM/100APPLE', name: XSS + '.JPG', at: T + 60, lat: null, lon: null },
        { pk: 5, dir: 'DCIM/100APPLE', name: 'IMG_0005.JPG', at: T2, lat: null, lon: null, uuid: UUID_LIB },
        { pk: 6, dir: 'DCIM/100APPLE', name: 'IMG_0006.JPG', at: T2 + 200, lat: null, lon: null, original: 'signal-2024-06-04-143850.jpg', importer: 'org.whispersystems.signal', importedBy: 3 },
    ];
    rows.forEach((r) => {
        insert(db, 'ZASSET', {
            Z_PK: r.pk, ZUUID: r.uuid || '00000000-0000-4000-8000-00000000000' + r.pk, ZDIRECTORY: r.dir, ZFILENAME: r.name, ZDATECREATED: r.at - COCOA, ZADDEDDATE: r.at + 0.3 - COCOA, ZMODIFICATIONDATE: r.at + 5 - COCOA,
            ZSAVEDASSETTYPE: 3, ZKIND: 0, ZKINDSUBTYPE: 0, ZUNIFORMTYPEIDENTIFIER: 'public.jpeg', ZCLOUDLOCALSTATE: 1, ZTRASHEDSTATE: 0, ZHIDDEN: 0,
            ZLATITUDE: r.lat == null ? -180 : r.lat, ZLONGITUDE: r.lon == null ? -180 : r.lon, ZADDITIONALATTRIBUTES: r.pk, ZEXTENDEDATTRIBUTES: r.pk,
        });
        insert(db, 'ZADDITIONALASSETATTRIBUTES', {
            Z_PK: r.pk, ZASSET: r.pk, ZORIGINALFILENAME: r.original || r.name, ZEXIFTIMESTAMPSTRING: '2024:06:01 14:34:56', ZTIMEZONENAME: 'Europe/Stockholm', ZTIMEZONEOFFSET: 7200,
            ZIMPORTEDBY: r.importedBy || 1, ZIMPORTEDBYBUNDLEIDENTIFIER: r.importer || 'com.apple.camera', ZIMPORTEDBYDISPLAYNAME: r.importer ? 'Signal' : 'Kamera',
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

// Signals databas på iOS: en kontakt med HTML i profilnamnet och en mottagen bild (samma bytes som
// IMG_0006.JPG). Krypterad som SQLCipher 4 med rå nyckel och 32 byte okrypterat huvud.
function signalDb(SQL, imageSha) {
    const page = 4096, reserve = 80;
    const head = Buffer.alloc(page);
    head.write('SQLite format 3\0', 0, 'latin1');
    head.writeUInt16BE(page, 16);
    head[18] = 1; head[19] = 1; head[20] = reserve; head[21] = 64; head[22] = 32; head[23] = 32;
    head.writeUInt32BE(1, 24); head.writeUInt32BE(1, 28); head.writeUInt32BE(4, 44); head.writeUInt32BE(1, 56);
    head.writeUInt32BE(1, 92); head.writeUInt32BE(3045000, 96);
    head[100] = 0x0d; head.writeUInt16BE(page - reserve, 105);
    const db = new SQL.Database(new Uint8Array(head));
    Object.values(chatSchemas['signal-ios']).forEach((sql) => db.run(sql));
    const ms = (sec) => Math.round((T2 + sec) * 1000);
    insert(db, 'model_TSThread', { id: 1, recordType: 27, uniqueId: 'tråd-1', contactUUID: 'aci-kim', shouldThreadBeVisible: 1, creationDate: T2 - 600,
        conversationColorName: 'blue', isArchived: 0, lastInteractionRowId: 1, isMarkedUnread: 0, lastVisibleSortIdOnScreenPercentage: 0, lastVisibleSortId: 0, mentionNotificationMode: 0, mutedUntilTimestamp: 0 });
    insert(db, 'model_SignalRecipient', { id: 1, recordType: 31, uniqueId: 'mottagare-1', recipientUUID: 'aci-kim', devices: new Uint8Array(0), status: 0 });
    insert(db, 'model_OWSUserProfile', { id: 1, recordType: 40, uniqueId: 'profil-1', recipientUUID: 'aci-kim', profileName: 'Kim ' + XSS, isStoriesCapable: 1, canReceiveGiftBadges: 0, isPniCapable: 1 });
    insert(db, 'model_TSInteraction', { id: 1, recordType: 19, uniqueId: 'm-1', receivedAtTimestamp: ms(191), timestamp: ms(190), serverTimestamp: ms(190.5), uniqueThreadId: 'tråd-1', authorUUID: 'aci-kim' });
    insert(db, 'Attachment', { id: 1, mimeType: 'image/jpeg', unencryptedByteCount: 1000, sha256ContentHash: imageSha, localRelativeFilePath: 'AB/ABCDEF', encryptionKey: new Uint8Array(64) });
    insert(db, 'MessageAttachmentReference', { ownerType: 0, ownerRowId: 1, attachmentRowId: 1, receivedAtTimestamp: ms(191), threadRowId: 1, idInMessage: 'b1', orderInMessage: 0, renderingFlag: 0, contentType: 2, isViewOnce: 0 });
    const plain = Buffer.from(db.export());
    db.close();
    const key = SIGNAL_KEY.subarray(0, 32), salt = SIGNAL_KEY.subarray(32, 48);
    const macKey = crypto.pbkdf2Sync(key, Buffer.from(salt.map((b) => b ^ 0x3a)), 2, 32, 'sha512');
    const pages = [];
    for (let p = 1; p * page <= plain.length; p++) {
        const src = plain.subarray((p - 1) * page, p * page);
        const start = p === 1 ? 32 : 0;
        const iv = crypto.randomBytes(16);
        const c = crypto.createCipheriv('aes-256-cbc', key, iv);
        c.setAutoPadding(false);
        const data = Buffer.concat([c.update(src.subarray(start, page - reserve)), c.final()]);
        const pn = Buffer.alloc(4); pn.writeUInt32LE(p);
        const mac = crypto.createHmac('sha512', macKey).update(data).update(iv).update(pn).digest();
        const out = Buffer.alloc(page);
        if (p === 1) src.copy(out, 0, 0, 32);
        data.copy(out, start); iv.copy(out, page - reserve); mac.copy(out, page - reserve + 16);
        pages.push(out);
    }
    return Buffer.concat(pages);
}

// Nyckelringen bredvid zippen, som XML-plist: Signals nyckel och en post med HTML i tjänstens namn.
function keychainPlist() {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>genp</key><array>' +
        '<dict><key>svce</key><string>' + XSS.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</string><key>acct</key><string>x</string><key>v_Data</key><data>AAEC</data></dict>' +
        '<dict><key>agrp</key><string>U68MSDN6DR.org.whispersystems.signal</string><key>svce</key><string>GRDBKeyChainService</string><key>acct</key><string>GRDBDatabaseCipherKeySpec</string>' +
        '<key>v_Data</key><data>' + SIGNAL_KEY.toString('base64') + '</data></dict></array><key>inet</key><array/></dict></plist>\n';
}

// WhatsApps databas: IMG_0005 vald ur bildbiblioteket och skickad, och en mottagen bild vars fil
// ligger under Message/Media/. Chattens namn bär HTML.
function whatsappDb(SQL, mediaSha) {
    const db = new SQL.Database();
    Object.values(chatSchemas['whatsapp-ios']).forEach((sql) => db.run(sql));
    const cocoa = (sec) => T2 + sec - COCOA;
    const meta = Buffer.concat([Buffer.from([0xa2, 0x04, 0x20]), Buffer.alloc(32, 9), Buffer.from([0x2b]), Buffer.from(UUID_LIB + '/L0/001')]);
    insert(db, 'ZWACHATSESSION', { Z_PK: 1, ZSESSIONTYPE: 0, ZCONTACTJID: '1@lid', ZPARTNERNAME: 'Lo ' + XSS, ZLASTMESSAGEDATE: cocoa(70) });
    insert(db, 'ZWAMESSAGE', { Z_PK: 1, ZISFROMME: 1, ZMESSAGETYPE: 1, ZMESSAGEDATE: cocoa(10), ZSENTDATE: cocoa(10), ZCHATSESSION: 1, ZMEDIAITEM: 1, ZMESSAGESTATUS: 6 });
    insert(db, 'ZWAMEDIAITEM', { Z_PK: 1, ZMESSAGE: 1, ZMEDIALOCALPATH: 'Media/1@lid/a/b/skickad.jpg', ZFILESIZE: 900, ZVCARDNAME: crypto.createHash('sha256').update('omkodad').digest('base64'), ZVCARDSTRING: 'image/jpeg', ZMETADATA: meta });
    insert(db, 'ZWAMESSAGE', { Z_PK: 2, ZISFROMME: 0, ZMESSAGETYPE: 1, ZMESSAGEDATE: cocoa(70), ZSENTDATE: cocoa(69), ZCHATSESSION: 1, ZMEDIAITEM: 2, ZMESSAGESTATUS: 8, ZFROMJID: '1@lid' });
    insert(db, 'ZWAMEDIAITEM', { Z_PK: 2, ZMESSAGE: 2, ZMEDIALOCALPATH: 'Media/1@lid/c/d/mottagen.jpg', ZFILESIZE: 1000, ZVCARDNAME: mediaSha.toString('base64'), ZVCARDSTRING: 'image/jpeg' });
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
    const signalSaved = other('IMG_0006');
    const waReceived = other('wa-mottagen');
    const sha = (b) => crypto.createHash('sha256').update(b).digest();
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
        { name: P + 'Media/DCIM/100APPLE/IMG_0005.JPG', data: other('IMG_0005'), mtime: T2 + 1 },
        { name: P + 'Media/DCIM/100APPLE/IMG_0006.JPG', data: signalSaved, mtime: T2 + 201 },
        { name: P + 'Containers/Shared/' + GROUP_SIGNAL + 'grdb/signal.sqlite', data: signalDb(SQL, sha(signalSaved)), deflate: true },
        { name: P + 'Containers/Shared/' + GROUP_SIGNAL + 'grdb/signal.sqlite-wal', data: '' },
        { name: P + 'Containers/Shared/' + GROUP_WA + 'ChatStorage.sqlite', data: Buffer.from(whatsappDb(SQL, sha(waReceived))), deflate: true },
        { name: P + 'Containers/Shared/' + GROUP_WA + 'ChatStorage.sqlite-wal', data: '' },
        { name: P + 'Containers/Shared/' + GROUP_WA + 'Message/Media/1@lid/c/d/mottagen.jpg', data: waReceived, mtime: T2 + 71 },
    ]);
    const files = {
        dir,
        zip: path.join(dir, 'Testextraktion-iOS17.zip'),
        image: path.join(dir, 'IMG_0001.JPG'),
        knowledge: path.join(dir, 'knowledgeC.db'),
        keychain: path.join(dir, 'Testextraktion-iOS17_keychain.plist'),
    };
    fs.writeFileSync(files.zip, zip);
    fs.writeFileSync(files.keychain, keychainPlist());
    fs.writeFileSync(files.image, jpeg);
    fs.writeFileSync(files.knowledge, knowledge);
    return { files, T: T * 1000, imageName: 'IMG_0001.JPG', T2: T2 * 1000, waMedia: 'mottagen.jpg' };
}

module.exports = { build, T: T * 1000 };
