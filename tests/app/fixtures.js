// Påhittade testfiler till provkörningarna, utan riktiga data: en liten iOS 17-extraktion (zip) med
// Photos.sqlite, knowledgeC.db med en trasig -wal, SystemVersion.plist och bildfiler, och samma bild
// och knowledgeC.db som lösa filer på disk. Bilden är tools/exif-viewer/fixtures/exif-sample.jpg,
// tagen 2024-06-01 14:34:56 +02:00 med en iPhone 15 Pro. Två poster bär HTML i namnet, så att
// provkörningen märker om något skrivs in i sidan utan att escapas.
// Tre dagar senare: Signals databas (krypterad med SQLCipher som på iOS, nyckeln i en påhittad
// nyckelring bredvid zippen) med en mottagen bild som sparats i bildbiblioteket, och WhatsApps
// databas med en bild vald ur bildbiblioteket och en mottagen bild. Namnen i chattarna bär HTML.
// Fem dagar efter T: Telegrams databaser (i Telegrams eget format, kodat av postbox-encode.js) med en
// bild vald ur bildbiblioteket, en bild tagen med Telegrams kamera (kvar i Telegrams tmp/) och en
// mottagen bild under postbox/media/. PowerLog täcker samma timmar (knowledgeC gör det inte): skärmen,
// låset, kameraappen och Telegram på skärmen och Telegrams kamera när IMG_0008 togs.
// Samsung: en Android-extraktion utan usagestats, med SSRM-loggen och batterihistoriken. Kamerabilden togs när
// bara batterihistoriken täcker tiden, en bild i en chattapp när SSRM gör det, tre bilder där eRR.p säger att telefonen var
// avstängd, inte upplåst eller just startade, och en bild när batterihistorikens klocka
// flyttades. Namnen i loggarna bär HTML.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const { buildZip } = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'zip-builder.js'));
const { buildUfdr } = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'ufdr-builder.js'));
const { encryptedKeychain } = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'keychain-builder.js'));
const schemas = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'photos-schema.json'));
const chatSchemas = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'chat-schemas.json'));
const TG = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'postbox-encode.js'));
const { powerlogDb } = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'powerlog-fixture.js'));

const COCOA = 978307200;
const T = Date.UTC(2024, 5, 1, 12, 34, 56) / 1000;   // tiden i exif-sample.jpg (14:34:56 +02:00)
const XSS = '<img src=x onerror="window.__ftxss=1;try{top.__ftxss=1}catch(e){}">';
const T2 = T + 3 * 86400;                              // Signal och WhatsApp
const UUID_LIB = '5A5A5A5A-1111-4222-8333-944444444444';  // bildbibliotekets id för IMG_0005
const SIGNAL_KEY = Buffer.from(Array.from({ length: 48 }, (_, i) => (i * 7 + 3) & 255));  // påhittad
const GROUP_SIGNAL = 'AppGroup/11111111-2222-4333-8444-555555555555/';
const GROUP_WA = 'AppGroup/66666666-7777-4888-9999-AAAAAAAAAAAA/';
const T3 = T + 5 * 86400;                              // Telegram
const UUID_TG = '7B7B7B7B-2222-4333-8444-955555555555';   // bildbibliotekets id för IMG_0007
const GROUP_TG = 'AppGroup/BBBBBBBB-CCCC-4DDD-8EEE-FFFFFFFFFFFF/';
const APP_TG = 'Application/12121212-3434-4565-8787-909090909090/';
const TG_MEDIA = 'telegram-cloud-photo-size-4-777-y';
const GUID_PL = '13131313-2424-4535-8646-757575757575/';

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
    // Rad 7 är en kamerabild som valdes i Telegram; rad 8 tog Telegrams kamera. Rad 9 är gammal men kom till
    // telefonen vid T, då telefonen har händelser; när den skapades har telefonen inga. Dess ändringstid ligger
    // långt från båda: i biblioteket ger den ingen egen tidslinje. Rad 10 har händelser vid båda sina tidpunkter.
    const rows = [
        { pk: 1, dir: 'DCIM/100APPLE', name: 'IMG_0001.JPG', at: T, lat: 59.3326, lon: 18.0649 },
        { pk: 2, dir: 'DCIM/101APPLE', name: 'IMG_0001.JPG', at: T + 30 * 86400, lat: null, lon: null },
        { pk: 3, dir: 'DCIM/100APPLE', name: 'IMG_0002.JPG', at: T + 40, lat: 59.3327, lon: 18.0650 },
        { pk: 4, dir: 'DCIM/100APPLE', name: XSS + '.JPG', at: T + 60, lat: null, lon: null },
        { pk: 5, dir: 'DCIM/100APPLE', name: 'IMG_0005.JPG', at: T2, lat: null, lon: null, uuid: UUID_LIB },
        { pk: 6, dir: 'DCIM/100APPLE', name: 'IMG_0006.JPG', at: T2 + 200, lat: null, lon: null, original: 'signal-2024-06-04-143850.jpg', importer: 'org.whispersystems.signal', importedBy: 3, display: 'Signal' },
        { pk: 7, dir: 'DCIM/100APPLE', name: 'IMG_0007.JPG', at: T3, lat: null, lon: null, uuid: UUID_TG },
        { pk: 8, dir: 'DCIM/100APPLE', name: 'IMG_0008.JPG', at: T3 + 300, lat: null, lon: null, original: 'camphoto_123456.jpg', importer: 'ph.telegra.Telegraph', importedBy: 3, display: 'Telegram' },
        { pk: 9, dir: 'DCIM/100APPLE', name: 'IMG_0009.JPG', at: T - 400 * 86400, added: T + 30, lat: null, lon: null },
        { pk: 10, dir: 'DCIM/100APPLE', name: 'IMG_0010.JPG', at: T - 86400 + 200, added: T + 30, lat: null, lon: null, uuid: '00000000-0000-4000-8000-000000000010' },
    ];
    rows.forEach((r) => {
        insert(db, 'ZASSET', {
            Z_PK: r.pk, ZUUID: r.uuid || '00000000-0000-4000-8000-00000000000' + r.pk, ZDIRECTORY: r.dir, ZFILENAME: r.name, ZDATECREATED: r.at - COCOA, ZADDEDDATE: (r.added || r.at + 0.3) - COCOA, ZMODIFICATIONDATE: r.at + 5 - COCOA,
            ZSAVEDASSETTYPE: 3, ZKIND: 0, ZKINDSUBTYPE: 0, ZUNIFORMTYPEIDENTIFIER: 'public.jpeg', ZCLOUDLOCALSTATE: 1, ZTRASHEDSTATE: 0, ZHIDDEN: 0,
            ZLATITUDE: r.lat == null ? -180 : r.lat, ZLONGITUDE: r.lon == null ? -180 : r.lon, ZADDITIONALATTRIBUTES: r.pk, ZEXTENDEDATTRIBUTES: r.pk,
        });
        insert(db, 'ZADDITIONALASSETATTRIBUTES', {
            Z_PK: r.pk, ZASSET: r.pk, ZORIGINALFILENAME: r.original || r.name, ZEXIFTIMESTAMPSTRING: '2024:06:01 14:34:56', ZTIMEZONENAME: 'Europe/Stockholm', ZTIMEZONEOFFSET: 7200,
            ZIMPORTEDBY: r.importedBy || 1, ZIMPORTEDBYBUNDLEIDENTIFIER: r.importer || 'com.apple.camera', ZIMPORTEDBYDISPLAYNAME: r.display || 'Kamera',
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

// Telegrams meddelandedatabas och lagringsdatabas: IMG_0007 vald ur bildbiblioteket och skickad
// (resursen ph-<ZUUID> och bilden i meddelande 1 är lika stora), en bild skickad 5 s efter IMG_0008
// och en mottagen bild vars fil ligger under postbox/media/. Kontaktens namn bär HTML.
function telegramDbs(SQL) {
    const LO = TG.peer(0, 7000000003);
    const ME = TG.peer(0, 9000000001);
    const img = (photoId, s, size) => TG.image({ photoId: photoId, sizes: [{ s: 'm', w: 240, h: 320, size: 4000 }, { s: s, w: 960, h: 1280, size: size }] });
    const messages = [
        { peer: LO, timestamp: T3 + 150, id: 1, author: ME, media: [img(701, 'y', 34707)] },
        { peer: LO, timestamp: T3 + 305, id: 2, author: ME, text: 'Titta', media: [img(702, 'y', 35213)] },
        { peer: LO, timestamp: T3 + 400, id: 3, incoming: true, author: LO, media: [img(777, 'y', 2000)] },
    ];
    const peers = [{ peer: LO, value: TG.user({ id: 7000000003, fn: 'Lo', ln: XSS }) }, { peer: ME, value: TG.user({ id: 9000000001, fn: 'Jag' }) }];
    return {
        postbox: Buffer.from(TG.postboxDb(SQL, { messages, peers })),
        storage: Buffer.from(TG.storageDb(SQL, { entries: [
            { id: 'ph-' + UUID_TG + '_L0_001--8097', contentType: 0, size: 34707, refs: [{ peer: LO, messageId: 0 }] },
            { id: 'telegram-cloud-photo-size-4-701-y', contentType: 1, refs: [{ peer: LO, messageId: 1 }] },
            { id: TG_MEDIA, contentType: 1, refs: [{ peer: LO, messageId: 3 }] },
        ] })),
    };
}

// PowerLog runt T3: kameraappen tar IMG_0007, Telegram är på skärmen och dess kamera är igång när
// IMG_0008 tas (T3+300). PowerLogs egen tid går 15 minuter fel, som på labbtelefonen.
function powerlog(SQL) {
    const hb = [];
    for (let t = T3 - 7200; t <= T3 + 7200; t += 600) hb.push(t);
    return Buffer.from(powerlogDb(SQL, {
        offsets: [{ at: T3 - 7200, system: -903.4 }],
        backlight: [{ t: T3 - 100, active: 1 }, { t: T3 + 900, active: 0 }],
        lock: [{ t: T3 - 120, locked: 0 }, { t: T3 + 905, locked: 1 }],
        screen: [{ t: T3 - 6, bundle: 'com.apple.camera' }, { t: T3 + 6, bundle: 'com.apple.springboard.home-screen' }, { t: T3 + 280, bundle: 'ph.telegra.Telegraph' }, { t: T3 + 420, bundle: 'com.apple.springboard.home-screen' }],
        camera: [{ t: T3 - 4, app: 'com.apple.camera', state: 1 }, { t: T3 + 3, state: 0 }, { t: T3 + 296, app: 'ph.telegra.Telegraph', state: 1 }, { t: T3 + 302, state: 0 }],
        heartbeat: hb,
    }));
}

// En binär plist med en dict av strängar, som behållarens metadata (.com.apple.mobile_container_manager.metadata.plist).
function bplistDict(obj) {
    const keys = Object.keys(obj);
    const n = keys.length;
    const objs = [Buffer.concat([Buffer.from([0xd0 | n]), Buffer.from(keys.map((_, i) => 1 + i)), Buffer.from(keys.map((_, i) => 1 + n + i))])];
    keys.concat(keys.map((k) => obj[k])).forEach((s) => {
        const b = Buffer.from(String(s), 'ascii');
        objs.push(b.length < 15 ? Buffer.concat([Buffer.from([0x50 | b.length]), b]) : Buffer.concat([Buffer.from([0x5f, 0x10, b.length]), b]));
    });
    let off = 8;
    const offsets = objs.map((o) => { const x = off; off += o.length; return x; });
    const trailer = Buffer.alloc(32);
    trailer[6] = 1; trailer[7] = 1;
    trailer.writeBigUInt64BE(BigInt(objs.length), 8);
    trailer.writeBigUInt64BE(BigInt(off), 24);
    return Buffer.concat([Buffer.from('bplist00', 'ascii')].concat(objs, [Buffer.from(offsets), trailer]));
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
// Samma filer som rapporten Physical Analyzer skulle skriva om extraktionen, utan det som valts bort
// (IMG_0002.JPG). Samma innehåll ligger en gång och listas under RelatedNodes, en tom fil har ingen post,
// och nyckelringen och en dekrypterad kopia finns med, men är inga filer på telefonen.
// ufed: en rapport ur en zip med extra/. Telefonens filer ligger under /root/ och har ctime, nyckelringen ligger högst upp.
function reportRows(entries, keychain, ufed) {
    const first = new Map();
    const rows = [];
    const fsName = ufed ? 'EXTRACTION_FFS.zip' : undefined;
    entries.forEach((e) => {
        if (/IMG_0002\.JPG$/.test(e.name)) return;
        const data = Buffer.from(e.data);
        const secs = e.mtime || (e.ut && e.ut.m);
        const m = secs ? secs * 1000 : undefined;
        const row = {
            path: (ufed ? '/root/' : '/') + e.name.replace(/^filesystem1\//, ''), data, c: m === undefined ? undefined : m - 1000, m, a: m === undefined ? undefined : m + 1000,
            x: ufed && m !== undefined ? m + 2000 : undefined, fs: fsName,
            tag: /\.(jpg|heic|png)$/i.test(e.name) ? 'Image' : /sqlite|\.db|db_sqlite|PLSQL/.test(e.name) ? 'Database' : 'Configuration',
            origin: /IMG_0001\.JPG$/.test(e.name) ? 'Device Captured' : undefined, originReason: /IMG_0001\.JPG$/.test(e.name) ? 'Native Camera App' : undefined,
        };
        if (!data.length) { row.member = null; row.local = 'files\\Configuration\\tom-fil'; rows.push(row); return; }
        const key = crypto.createHash('sha256').update(data).digest('hex');
        const owner = first.get(key);
        if (owner) { owner.related = (owner.related || []).concat([Object.assign(row, { member: 'files\\' + owner.tag + '\\' + path.basename(owner.path) })]); return; }
        first.set(key, row);
        rows.push(row);
    });
    rows.push(ufed ? { path: '/backup_keychain_v2.plist', data: keychain, tag: 'Configuration', fs: fsName } : { path: '/Imported Test Keychain/Testrapport_keychain.plist', data: keychain, tag: 'Configuration', fs: 'Keychain' });
    rows.push({ path: (ufed ? '/root' : '') + '/private/var/mobile/Containers/Shared/' + GROUP_SIGNAL + 'grdb/signal.sqlite/signal.sqlite.decrypted', data: 'dekrypterad kopia', tag: 'Database', embedded: true, fs: fsName });
    return rows;
}

// ---------- Samsung ----------

const TS = Date.UTC(2026, 2, 12, 12, 31, 11) / 1000;    // kamerabilden: bara batterihistoriken täcker tiden
const TS2 = Date.UTC(2026, 4, 22, 10, 24, 58) / 1000;   // bilden i chattappen: SSRM täcker tiden
const TS3 = Date.UTC(2026, 8, 30, 7, 44, 50) / 1000;    // batterihistorikens klocka flyttades
const TS_OFF = Date.UTC(2026, 9, 7, 8, 0, 0) / 1000;    // telefonen avstängd enligt eRR.p
const TS_BFU = Date.UTC(2026, 9, 11, 8, 0, 0) / 1000;   // igång, inte upplåst sedan start
const TS_NEAR = Date.UTC(2026, 9, 10, 6, 0, 20) / 1000; // strax efter en start
const CHAT = 'org.example.chat';

// external.db med raderna som Härkomst frågar efter.
function mediaStoreDb(SQL) {
    const db = new SQL.Database();
    db.run('CREATE TABLE files (_id INTEGER PRIMARY KEY, _data TEXT, _display_name TEXT, relative_path TEXT, mime_type TEXT, owner_package_name TEXT, datetaken INTEGER, date_added INTEGER, date_modified INTEGER, is_trashed INTEGER, is_pending INTEGER, _size INTEGER)');
    [[1, '20260312_133111.jpg', 'DCIM/Camera/', 'com.sec.android.app.camera', TS], [2, 'chatt_kamera.jpg', 'Pictures/Chatten/', CHAT, TS2], [3, '20260930_094450.jpg', 'DCIM/Camera/', 'com.sec.android.app.camera', TS3],
        [4, '20261007_100000.jpg', 'DCIM/Camera/', 'com.sec.android.app.camera', TS_OFF], [5, '20261011_100000.jpg', 'DCIM/Camera/', 'com.sec.android.app.camera', TS_BFU], [6, '20261010_080020.jpg', 'DCIM/Camera/', 'com.sec.android.app.camera', TS_NEAR]].forEach(([id, name, dir, owner, t]) => {
        insert(db, 'files', { _id: id, _data: '/storage/emulated/0/' + dir + name, _display_name: name, relative_path: dir, mime_type: 'image/jpeg', owner_package_name: owner, datetaken: t * 1000, date_added: t + 1, date_modified: t + 1, is_trashed: 0, is_pending: 0, _size: 1000 });
    });
    const out = db.export();
    db.close();
    return out;
}

function samsungEntries(SQL, jpeg) {
    const other = (tag) => Buffer.concat([jpeg, Buffer.from(tag)]);
    const rtc = (localText, utcText) => localText + ' [RTC] 148911.38 37981.19    ' + utcText + ' ' + Date.parse(utcText.replace(' ', 'T') + 'Z') / 1000;
    const ssrm = [
        rtc('2026-05-22 11:00:00', '2026-05-22 09:00:00'),
        '2026-05-22 12:18:40 [VER] A000XXU1 START',
        '2026-05-22 12:18:41 [SET] [] [LCD] ON  [sleep_count = 107, sleep_time_sec = 1500]',
        '2026-05-22 12:21:10 [PKG] ' + CHAT,
        '2026-05-22 12:24:57 [SET] [ND0XOXOMOXXXXXWXX / Wifi:"' + XSS + '",5180MHz] camera running :: true  client : ' + CHAT,
        '2026-05-22 12:25:00 [SET] [ND0XOXOMXXXXXXWXX / Wifi:"' + XSS + '",5180MHz] camera running :: false  client : ' + CHAT,
        '2026-05-22 12:26:05 [SET] [ND0XXXOMXXXXXXWXX / Wifi:"' + XSS + '",5180MHz] [LCD] OFF',
    ].join('\n');
    // Äldre formen: tiden räknas från ankaret. Skärmen är tänd, kameraappen i förgrunden och kameran på vid 12:31:11 UTC (13:31:11 lokalt).
    const march = [
        'Battery History (86% used, 3560KB used of 4096KB, 2669 strings using 209KB):',
        '                    0 (20) TIME: 2026-03-12-13-30-00-000',
        '            +10s000ms (2) 090 +screen',
        '            +50s000ms (2) 090 +top=u0a96:"com.sec.android.app.camera"',
        '          +1m05s000ms (1) 090 +camera',
        '          +1m20s000ms (1) 090 -camera',
        '          +1m21s000ms (2) 090 -top=u0a96:"com.sec.android.app.camera"',
        '          +1m21s000ms (2) 090 +top=u0a128:"' + XSS + '"',
        '          +1m40s000ms (2) 090 -screen',
        '          +2m00s000ms (20) TIME: 2026-03-12-13-32-00-000',
        '',
        'Per process state tracking available: true',
    ].join('\n');
    // Nyare formen, med en sen skrivning som flyttar tiden 162 s och ett ankare som flyttar tillbaka den. T är lokalt 09:44:50.
    const sept = [
        '  09-30 09:40:00.000 RESET:TIME: 2026-09-30-09-40-00-000',
        '  09-30 09:40:10.000 060 84800018 +running wake_reason=0:"186 wlan_mbox_irq"',
        '  09-30 09:42:52.000 TIME: 2026-09-30-09-42-52-000',
        '  09-30 09:42:52.000 060 04800018 -running',
        '  09-30 09:44:40.000 060 80800018 +screen',
        '  09-30 09:44:45.000 060 80800018 +top=u0a96:"com.sec.android.app.camera"',
        '  09-30 09:44:48.000 060 80800018 +camera',
        '  09-30 09:44:55.000 060 80800018 -camera',
        '  09-30 09:45:00.000 060 80800018 -screen',
        '  09-30 09:43:18.000 TIME: 2026-09-30-09-43-18-000',
    ].join('\n');
    // Filen med starter och nedstängningar, och batterihistoriken som täcker tiden: nedstängd 5 oktober, start 10 oktober, första appen 12 oktober.
    const errRows = [
        '2026-01-10 09:00:00+0100 |    ON    | RP    | A000XXU1 [0]',
        '2026-02-01 09:00:00+0100 | SHUTDOWN |       | REASON: no power',
        '2023-10-12 16:49:57+0200 | SHUTDOWN |       | REASON: no power',
        '2026-02-02 09:00:00+0100 |    ON    | RP    | A000XXU1 [0]',
        '2026-10-05 12:00:01+0200 | SHUTDOWN |       | REASON: no power',
        '2026-10-05 12:30:00+0000 |   LPM    |',
        '2026-10-10 08:00:40+0200 |    ON    | RP    | A000XXU1 <b>1</b> [1]',
    ];
    const errFile = Buffer.concat([Buffer.from([0x4c, 0x4f, 0x47, 0x4d, errRows.length, 0, 0, 0, errRows.length - 1, 0, 0, 0]), Buffer.from('\n\n\n\n' + errRows.join('\n') + '\n', 'latin1')]);
    const october = [
        '  09-30 09:43:20.000 RESET:TIME: 2026-09-30-09-43-20-000',
        '  10-05 12:00:00.000 050 04000000 stats=0:"shutdown"',
        '  10-05 12:00:00.100 SHUTDOWN',
        '  10-05 12:00:00.200 START',
        '  10-10 08:00:00.000 TIME: 2026-10-10-08-00-00-000',
        '  10-10 08:00:10.000 050 80800018 +top=1000:"com.android.settings"',
        '  10-12 09:00:00.000 050 80800018 -top=1000:"com.android.settings"',
        '  10-12 09:00:00.000 050 80800018 +top=u0a96:"com.sec.android.app.launcher"',
        '  10-20 09:59:00.000 TIME: 2026-10-20-09-59-00-000',
    ].join('\n');
    return [
        { name: 'data/data/com.android.providers.media.module/databases/external.db', data: Buffer.from(mediaStoreDb(SQL)), deflate: true },
        { name: 'data/system/users/service/data/eRR.p', data: errFile, mtime: Date.UTC(2026, 9, 10, 6, 0, 40) / 1000 },
        { name: 'data/log/batterystats/newbatterystats261020100000', data: october, mtime: Date.UTC(2026, 9, 20, 8, 0, 0) / 1000 },
        { name: 'data/media/0/DCIM/Camera/20261007_100000.jpg', data: other('samsung-off'), mtime: TS_OFF + 1 },
        { name: 'data/media/0/DCIM/Camera/20261011_100000.jpg', data: other('samsung-bfu'), mtime: TS_BFU + 1 },
        { name: 'data/media/0/DCIM/Camera/20261010_080020.jpg', data: other('samsung-near'), mtime: TS_NEAR + 1 },
        { name: 'data/media/0/DCIM/Camera/20260312_133111.jpg', data: other('samsung-1'), mtime: TS + 1 },
        { name: 'data/media/0/Pictures/Chatten/chatt_kamera.jpg', data: other('samsung-2'), mtime: TS2 + 1 },
        { name: 'data/media/0/DCIM/Camera/20260930_094450.jpg', data: other('samsung-3'), mtime: TS3 + 1 },
        { name: 'data/data/com.sec.android.sdhms/ssrm_heating_0.log', data: ssrm, mtime: TS2 + 3600 },
        { name: 'data/log/batterystats/newbatterystats260312133200', data: march, mtime: Date.UTC(2026, 2, 12, 12, 32, 0) / 1000 },
        // En fil som spänner över bytet till sommartid, och en fil efter den med samma zon som nästa.
        { name: 'data/log/batterystats/newbatterystats260522121000', data: ['  05-22 12:05:00.000 RESET:TIME: 2026-05-22-12-05-00-000', '  05-22 12:05:10.000 060 80800018 +screen', '  05-22 12:05:20.000 060 80800018 -screen'].join('\n'), mtime: Date.UTC(2026, 4, 22, 10, 10, 0) / 1000 },
        { name: 'data/log/batterystats/newbatterystats260930093000', data: ['  09-30 09:29:00.000 RESET:TIME: 2026-09-30-09-29-00-000', '  09-30 09:29:30.000 060 84800018 status=full'].join('\n'), mtime: Date.UTC(2026, 8, 30, 7, 30, 0) / 1000 },
        { name: 'data/log/batterystats/newbatterystats260930094318', data: sept, mtime: Date.UTC(2026, 8, 30, 7, 43, 18) / 1000 },
    ];
}

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
    const tgCamera = other('IMG_0008');
    const tg = telegramDbs(SQL);
    const sha = (b) => crypto.createHash('sha256').update(b).digest();
    const P = 'filesystem1/private/var/mobile/';
    const entries = [
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
        // Bilagans krypterade fil. Inte en fil ExifTool känner igen.
        { name: P + 'Containers/Shared/' + GROUP_SIGNAL + 'attachment_files/AB/ABCDEF', data: crypto.randomBytes(4096), mtime: T2 },
        { name: P + 'Containers/Shared/' + GROUP_WA + 'ChatStorage.sqlite', data: Buffer.from(whatsappDb(SQL, sha(waReceived))), deflate: true },
        { name: P + 'Containers/Shared/' + GROUP_WA + 'ChatStorage.sqlite-wal', data: '' },
        { name: P + 'Containers/Shared/' + GROUP_WA + 'Message/Media/1@lid/c/d/mottagen.jpg', data: waReceived, mtime: T2 + 71 },
        { name: P + 'Media/DCIM/100APPLE/IMG_0007.JPG', data: other('IMG_0007'), mtime: T3 + 1 },
        { name: P + 'Media/DCIM/100APPLE/IMG_0008.JPG', data: tgCamera, mtime: T3 + 301 },
        { name: P + 'Media/DCIM/100APPLE/IMG_0009.JPG', data: other('IMG_0009'), mtime: T + 10 * 86400 },
        { name: P + 'Media/DCIM/100APPLE/IMG_0010.JPG', data: other('IMG_0010'), mtime: T + 31 },
        // Utanför biblioteket: tiden i filen är två år gammal, och filen skapades i filsystemet vid T.
        { name: P + 'Containers/Data/' + APP_TG + 'Documents/gammal.jpg', data: Buffer.from(jpeg.toString('latin1').split('2024:06:01').join('2022:06:01'), 'latin1'), ut: { m: T + 31, a: T + 40, c: T + 31, b: T + 31 } },
        { name: P + 'Containers/Shared/' + GROUP_TG + 'telegram-data/account-1/postbox/db/db_sqlite', data: tg.postbox, deflate: true },
        { name: P + 'Containers/Shared/' + GROUP_TG + 'telegram-data/account-1/postbox/db/db_sqlite-wal', data: '' },
        { name: P + 'Containers/Shared/' + GROUP_TG + 'telegram-data/account-1/postbox/media/storage/db/db_sqlite', data: tg.storage, deflate: true },
        { name: P + 'Containers/Shared/' + GROUP_TG + 'telegram-data/account-1/postbox/media/storage/db/db_sqlite-wal', data: '' },
        { name: P + 'Containers/Shared/' + GROUP_TG + 'telegram-data/account-1/postbox/media/' + TG_MEDIA, data: other('tg-mottagen'), mtime: T3 + 401 },
        { name: P + 'Containers/Data/' + APP_TG + '.com.apple.mobile_container_manager.metadata.plist', data: bplistDict({ MCMMetadataIdentifier: 'ph.telegra.Telegraph' }) },
        { name: P + 'Containers/Data/' + APP_TG + 'tmp/camphoto_123456.jpg', data: tgCamera, mtime: T3 + 300 },
        { name: 'filesystem1/private/var/containers/Shared/SystemGroup/' + GUID_PL + 'Library/BatteryLife/CurrentPowerlog.PLSQL', data: powerlog(SQL), deflate: true },
        { name: 'filesystem1/private/var/containers/Shared/SystemGroup/' + GUID_PL + 'Library/BatteryLife/CurrentPowerlog.PLSQL-wal', data: '' },
    ];
    const zip = buildZip(entries);
    // Mappar för var nyckeln kan ligga. Zippen överst har ingen nyckelfil bredvid sig, så att det som väljs prövas.
    ['nycklar', 'ufed', 'ufed-rapport', 'bredvid', 'flera', 'ingen'].forEach((d) => fs.mkdirSync(path.join(dir, d)));
    const DEVICE = '00008030-0000000000000001';
    const files = {
        dir,
        zip: path.join(dir, 'Testextraktion-iOS17.zip'),
        ufdr: path.join(dir, 'Testrapport_Report.ufdr'),
        image: path.join(dir, 'IMG_0001.JPG'),
        knowledge: path.join(dir, 'knowledgeC.db'),
        keychain: path.join(dir, 'nycklar', 'Testextraktion-iOS17_keychain.plist'),
        // Som en extraktion med nyckelringen krypterad under extra/ i zippen.
        ufed: path.join(dir, 'ufed', 'EXTRACTION_FFS.zip'),
        // Rapporten ur en sådan extraktion.
        ufedReport: path.join(dir, 'ufed-rapport', 'Rapport-ur-zip-med-extra_Report.ufdr'),
        // Nyckelringen bredvid zippen, med samma id i namnet, och en annan telefons bredvid den.
        beside: path.join(dir, 'bredvid', DEVICE + '_fs.zip'),
        besideKey: DEVICE + '_keychain.plist',
        // Två nyckelfiler som inget knyter till zippen.
        many: path.join(dir, 'flera', 'Flera-telefoner.zip'),
        // Ingen nyckel någonstans.
        noKey: path.join(dir, 'ingen', 'Ingen-nyckel.zip'),
        powerlogArchive: path.join(dir, 'powerlog_2024-06-06_ABCDEF12.PLSQL.gz'),
        samsung: path.join(dir, 'Testextraktion-Samsung.zip'),
    };
    fs.writeFileSync(files.zip, zip);
    fs.writeFileSync(files.ufdr, buildUfdr(reportRows(entries, keychainPlist())).buf);
    fs.writeFileSync(files.keychain, keychainPlist());
    const sealed = encryptedKeychain([
        { svce: XSS, acct: 'x', value: Buffer.from('AAEC') },
        { svce: 'GRDBKeyChainService', acct: 'GRDBDatabaseCipherKeySpec', agrp: 'U68MSDN6DR.org.whispersystems.signal', value: SIGNAL_KEY },
    ]);
    fs.writeFileSync(files.ufed, buildZip(entries.concat([{ name: 'extra/KeychainDump/backup_keychain_v2.plist', deflate: true, data: sealed }])));
    fs.writeFileSync(files.ufedReport, buildUfdr(reportRows(entries, sealed, true)).buf);
    fs.writeFileSync(files.beside, zip);
    fs.writeFileSync(path.join(dir, 'bredvid', files.besideKey), keychainPlist());
    fs.writeFileSync(path.join(dir, 'bredvid', '00008030-0000000000000002_keychain.plist'), 'en annan telefons nyckelring, ska inte läsas');
    fs.writeFileSync(files.many, zip);
    fs.writeFileSync(files.noKey, zip);
    fs.writeFileSync(path.join(dir, 'flera', 'a_keychain.plist'), keychainPlist());
    fs.writeFileSync(path.join(dir, 'flera', 'b_keychain.plist'), keychainPlist());
    fs.writeFileSync(files.image, jpeg);
    fs.writeFileSync(files.knowledge, knowledge);
    fs.writeFileSync(files.powerlogArchive, require('node:zlib').gzipSync(powerlog(SQL)));
    fs.writeFileSync(files.samsung, buildZip(samsungEntries(SQL, jpeg)));
    return { files, T: T * 1000, imageName: 'IMG_0001.JPG', T2: T2 * 1000, waMedia: 'mottagen.jpg', T3: T3 * 1000, tgMedia: TG_MEDIA, TS: TS * 1000, TS2: TS2 * 1000, TS3: TS3 * 1000 };
}

module.exports = { build, loadSql, T: T * 1000 };
