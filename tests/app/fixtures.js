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
// flyttades. Namnen i loggarna bär HTML. Samma telefon finns också med Signals krypterade databaser och logg.
// Snapchat på iOS 26 (en egen zip med nyckelringen bredvid): en snap sparad i Memories, vars fil ligger krypterad i
// cachen med nyckeln i scdb-27, positionen i den krypterade gallery.encrypteddb, och samma bild skickad i en chatt
// strax efter, plus en annan bild skickad före.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const { buildZip } = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'zip-builder.js'));
const { buildUfdr } = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'ufdr-builder.js'));
const { encryptedKeychain, bplist, Uid } = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'keychain-builder.js'));
const cipherBuilder = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'sqlcipher-builder.js'));
const schemas = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'photos-schema.json'));
const chatSchemas = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'chat-schemas.json'));
const TG = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'postbox-encode.js'));
const { powerlogDb } = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'powerlog-fixture.js'));

const COCOA = 978307200;
const PAGE = 4096;
const T = Date.UTC(2024, 5, 1, 12, 34, 56) / 1000;   // tiden i exif-sample.jpg (14:34:56 +02:00)
const XSS = '<img src=x onerror="window.__ftxss=1;try{top.__ftxss=1}catch(e){}">';
const T2 = T + 3 * 86400;                              // Signal och WhatsApp
const UUID_LIB = '5A5A5A5A-1111-4222-8333-944444444444';  // bildbibliotekets id för IMG_0005
const SIGNAL_KEY = Buffer.from(Array.from({ length: 48 }, (_, i) => (i * 7 + 3) & 255));  // påhittad
const HEIC = fs.readFileSync(path.join(ROOT, 'tools', '_shared', 'fixtures', 'prov.heic'));  // 64 × 48 med förhandsbild
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
    const db = emptyDb(SQL, 80);
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
    return cipherPages(plain, { reserve: 80, hmac: 'sha512', key, salt, first: plain.subarray(0, 32) });
}

// En tom databas med sidor om 4096 byte och reserve byte lediga sist i varje sida, som SQLCipher behöver.
function emptyDb(SQL, reserve) {
    const head = Buffer.alloc(PAGE);
    head.write('SQLite format 3\0', 0, 'latin1');
    head.writeUInt16BE(PAGE, 16);
    head[18] = 1; head[19] = 1; head[20] = reserve; head[21] = 64; head[22] = 32; head[23] = 32;
    head.writeUInt32BE(1, 24); head.writeUInt32BE(1, 28); head.writeUInt32BE(4, 44); head.writeUInt32BE(1, 56);
    head.writeUInt32BE(1, 92); head.writeUInt32BE(3045000, 96);
    head[100] = 0x0d; head.writeUInt16BE(PAGE - reserve, 105);
    return new SQL.Database(new Uint8Array(head));
}

// Krypterar sidorna som SQLCipher: AES-256-CBC, och sist i sidan IV och HMAC över data, IV och sidnumret.
// o.first är det som står okrypterat först i filen (saltet, eller hela det okrypterade huvudet).
function cipherPages(plain, o) {
    const macKey = crypto.pbkdf2Sync(o.key, Buffer.from(o.salt.map((b) => b ^ 0x3a)), 2, 32, o.hmac);
    const pages = [];
    for (let p = 1; p * PAGE <= plain.length; p++) {
        const src = plain.subarray((p - 1) * PAGE, p * PAGE);
        const start = p === 1 ? o.first.length : 0;
        const iv = crypto.randomBytes(16);
        const c = crypto.createCipheriv('aes-256-cbc', o.key, iv);
        c.setAutoPadding(false);
        const data = Buffer.concat([c.update(src.subarray(start, PAGE - o.reserve)), c.final()]);
        const pn = Buffer.alloc(4); pn.writeUInt32LE(p);
        const mac = crypto.createHmac(o.hmac, macKey).update(data).update(iv).update(pn).digest();
        const out = Buffer.alloc(PAGE);
        if (p === 1) o.first.copy(out);
        data.copy(out, start); iv.copy(out, PAGE - o.reserve); mac.copy(out, PAGE - o.reserve + 16);
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
    longChat(db);
    // En HEIC-bild skickad som dokument (typ 8, MIME application/octet-stream) dagen före: Chattar visar bilden märkt
    // som dokument. Dagen före, så att Queries sökning på T2:s dag bara träffar Lo.
    insert(db, 'ZWACHATSESSION', { Z_PK: 4, ZSESSIONTYPE: 0, ZCONTACTJID: '4@lid', ZPARTNERNAME: 'Dokumentet', ZLASTMESSAGEDATE: cocoa(-86400) });
    insert(db, 'ZWAMESSAGE', { Z_PK: 4, ZISFROMME: 0, ZMESSAGETYPE: 8, ZMESSAGEDATE: cocoa(-86400), ZSENTDATE: cocoa(-86401), ZCHATSESSION: 4, ZMEDIAITEM: 4, ZMESSAGESTATUS: 8, ZFROMJID: '4@lid' });
    insert(db, 'ZWAMEDIAITEM', { Z_PK: 4, ZMESSAGE: 4, ZMEDIALOCALPATH: 'Media/4@lid/e/f/IMG_0042.HEIC', ZFILESIZE: HEIC.length, ZVCARDNAME: crypto.createHash('sha256').update(HEIC).digest('base64'), ZVCARDSTRING: 'application/octet-stream' });
    // En grupp utan meddelanden, för Chattars lista: slaget Grupper, Dölj tomma och sökning på en deltagares nummer.
    insert(db, 'ZWACHATSESSION', { Z_PK: 3, ZSESSIONTYPE: 1, ZCONTACTJID: '120363041234567890@g.us', ZPARTNERNAME: 'Klubben' });
    insert(db, 'ZWAGROUPMEMBER', { Z_PK: 1, ZCHATSESSION: 3, ZMEMBERJID: '46701234567@s.whatsapp.net', ZCONTACTNAME: 'Mo Månsson', ZISADMIN: 1, ZISACTIVE: 1 });
    const bytes = db.export();
    db.close();
    return bytes;
}

// En lång chatt i WhatsApp för Chattars block, sökning och datum: 3 000 meddelanden var femte minut med start
// 40 dagar före T2, och ett uppehåll på två dygn efter meddelande 1 500. Ordet "nålen" står i tre av dem.
// Långt från T och T2, så att inget annat test ser raderna.
const LONG = { count: 3000, start: T2 - 40 * 86400, step: 300, gapAfter: 1500, gap: 2 * 86400, needles: [100, 1500, 2900] };
function longTime(i) { return LONG.start + i * LONG.step + (i >= LONG.gapAfter ? LONG.gap : 0); }
function longChat(db) {
    insert(db, 'ZWACHATSESSION', { Z_PK: 2, ZSESSIONTYPE: 0, ZCONTACTJID: '2@lid', ZPARTNERNAME: 'Långa chatten', ZLASTMESSAGEDATE: longTime(LONG.count - 1) - COCOA });
    const words = 'hej då kanske imorgon middag klockan sju tåget är sent jag ringer sen okej bra tack ses vi där'.split(' ');
    db.run('BEGIN');
    const st = db.prepare('INSERT INTO ZWAMESSAGE (Z_PK, ZCHATSESSION, ZISFROMME, ZMESSAGETYPE, ZTEXT, ZMESSAGEDATE, ZSENTDATE, ZFROMJID, ZMESSAGESTATUS) VALUES (?, 2, ?, 0, ?, ?, ?, ?, 6)');
    for (let i = 0; i < LONG.count; i++) {
        const text = (LONG.needles.includes(i) ? 'nålen ' : '') + Array.from({ length: 3 + (i * 7) % 20 }, (_, k) => words[(i + k * 3) % words.length]).join(' ');
        const t = longTime(i) - COCOA;
        st.run([1000 + i, i % 3 === 0 ? 1 : 0, text, t, t, i % 3 === 0 ? null : '2@lid']);
    }
    st.free();
    db.run('COMMIT');
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
// Byte utan mönster, men samma varje gång. Slumpade byte tolkar ExifTool ungefär en gång av hundra som en
// MP3-fil, och då faller testet som väntar sig en fil som inte går att tolka.
function noise(length) {
    const parts = [];
    for (let i = 0; i * 32 < length; i++) parts.push(crypto.createHash('sha256').update('brus ' + i).digest());
    return Buffer.concat(parts).subarray(0, length);
}

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
// ---------- Snapchat Memories på iOS 26 ----------

const T4 = T + 7 * 86400;                              // Snapchat Memories
const SC_APP = 'Application/5C5C5C5C-0000-4111-8222-933333333333/';
const SC_ACCOUNT = 'a0a0a0a0-1111-4222-8333-b4b4b4b4b4b4';   // det egna kontot (mappen SCContent_<konto>)
const SC_FRIEND = 'c1c1c1c1-5555-4666-8777-d8d8d8d8d8d8';
const SC_CONV = 'e2e2e2e2-9999-4aaa-8bbb-f0f0f0f0f0f0';
const SC_SNAP = 'D3D3D3D3-1234-4567-89AB-CDEF01234567';
// En Memories-post med två snaps en timme senare: den ena har sin fil i cachen, den andra finns bara på Snapchats server.
const SC_ENTRY2 = 'E5E5E5E5-1234-4567-89AB-CDEF01234567';
const SC_SNAP2 = 'D4D4D4D4-1234-4567-89AB-CDEF01234567';
const SC_SNAP3 = 'D5D5D5D5-1234-4567-89AB-CDEF01234567';
const SC_POS3 = { lat: 59.34012, lon: 18.07021 };
const SC_KEYS = { memory: '1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a', memory2: '6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f', lowres: '2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b', capture: '3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c', sent: '4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d', other: '5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e' };
const SC_REFS = { sent: ['F1F1F1F1-0000-4000-8000-000000000001', 'F1F1F1F1-0000-4000-8000-000000000002'], other: ['F1F1F1F1-0000-4000-8000-000000000001', 'F1F1F1F1-0000-4000-8000-000000000003'] };
const SC_MEDIA_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 11 + 5) & 255));   // påhittad
const SC_MEDIA_IV = Buffer.from(Array.from({ length: 16 }, (_, i) => (i * 13 + 1) & 255));
const SC_GALLERY_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 17 + 9) & 255));
const SC_POS = { lat: 59.33258, lon: 18.06490 };

// En PNG i en enda grå ton: en bild som inte liknar fotot.
function grayPng(w, h, tone) {
    const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
    const raw = Buffer.alloc((w + 1) * h, tone); for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', require('node:zlib').deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Meddelandets protobuf som i arroyo.db: 08 04 12 12 0A 10 <avsändare, 16 byte> och konversationen i fält 3.
function snapMessageContent(sender) {
    const id = (u) => Buffer.from(u.replace(/-/g, ''), 'hex');
    return Buffer.concat([Buffer.from([0x08, 0x04, 0x12, 0x12, 0x0a, 0x10]), id(sender), Buffer.from([0x1a, 0x12, 0x0a, 0x10]), id(SC_CONV)]);
}

async function snapchatIosEntries(SQL, jpeg, photos) {
    const ms = (s) => Math.round(s * 1000);
    const capture = T4, saved = T4 + 10, sentAt = T4 + 11, otherAt = T4 - 30;
    // cache_controller.db: filen i Memories (typ 19), förhandsbilden (26), tagningen (34) och två skickade snaps (3).
    const cache = new SQL.Database();
    cache.run('CREATE TABLE CACHE_FILE_CLAIM (USER_ID TEXT, CACHE_KEY TEXT, MEDIA_CONTEXT_TYPE INTEGER, EXTERNAL_KEY TEXT, IS_AUTHORITATIVE INTEGER, EXPIRATION_TIMESTAMP_MILLIS INTEGER, DELETED_TIMESTAMP_MILLIS INTEGER, CONTENT_CLAIM_METADATA BLOB, CONTENT_ATTRIBUTION BLOB, CREATION_TIMESTAMP_MILLIS INTEGER)');
    cache.run('CREATE TABLE CACHE_FILE_METADATA (USER_ID TEXT, CACHE_KEY TEXT, STORAGE_TYPE INTEGER, TYPE INTEGER, FILE_SIZE_BYTES INTEGER, TOTAL_DISK_USED_BYTES INTEGER, KNOWN_CONTENT_LENGTH_BYTES INTEGER, LAST_READ_TIMESTAMP_MILLIS INTEGER, DELETED_TIMESTAMP_MILLIS INTEGER, CHILDREN BLOB, CONTENT_RETRIEVAL_METADATA BLOB, SHARD_INDEX INTEGER, CONTENT_LIFECYCLE INTEGER)');
    const memoryFile = (() => { const c = crypto.createCipheriv('aes-256-cbc', SC_MEDIA_KEY, SC_MEDIA_IV); return Buffer.concat([c.update(jpeg), c.final()]); })();
    const files = {
        [SC_KEYS.memory]: { type: 19, ext: 'snap-media-' + SC_SNAP.toLowerCase(), at: saved + 0.1, data: memoryFile },
        [SC_KEYS.memory2]: { type: 19, ext: 'snap-media-' + SC_SNAP2.toLowerCase(), at: T4 + 3610, data: (() => { const c = crypto.createCipheriv('aes-256-cbc', SC_MEDIA_KEY, SC_MEDIA_IV); return Buffer.concat([c.update(grayPng(48, 64, 90)), c.final()]); })() },
        [SC_KEYS.lowres]: { type: 26, ext: 'snap-rendered-lowres-' + SC_SNAP.toLowerCase(), at: saved + 0.1, data: noise(4096) },
        [SC_KEYS.capture]: { type: 34, ext: '9A9A9A9A-0000-4000-8000-000000000009~1', at: capture, data: Buffer.concat([jpeg, Buffer.from('tagning')]) },
        [SC_KEYS.sent]: { type: 3, ext: SC_REFS.sent.join('~'), at: sentAt, data: Buffer.concat([jpeg, Buffer.from('skickad')]) },
        [SC_KEYS.other]: { type: 3, ext: SC_REFS.other.join('~'), at: otherAt, data: grayPng(48, 64, 200) },
    };
    Object.keys(files).forEach((k) => {
        const f = files[k];
        cache.run('INSERT INTO CACHE_FILE_CLAIM VALUES (?, ?, ?, ?, 1, ?, NULL, NULL, NULL, ?)', [SC_ACCOUNT, k, f.type, f.ext, ms(f.at + 86400 * 30), ms(f.at)]);
        cache.run('INSERT INTO CACHE_FILE_METADATA VALUES (?, ?, 0, 0, ?, ?, ?, ?, NULL, NULL, NULL, 0, 0)', [SC_ACCOUNT, k, f.data.length, f.data.length, f.data.length, ms(f.at)]);
    });
    // arroyo.db: vännen skriver först i konversationen, sedan skickas två snaps från telefonen.
    const arroyo = new SQL.Database();
    arroyo.run('CREATE TABLE required_values (key TEXT PRIMARY KEY, value TEXT)');
    arroyo.run("INSERT INTO required_values VALUES ('USERID', ?)", [SC_ACCOUNT]);
    arroyo.run('CREATE TABLE conversation_message (client_conversation_id TEXT, client_message_id INTEGER, server_message_id INTEGER, message_content BLOB, message_state_type TEXT, creation_timestamp INTEGER, read_timestamp INTEGER, local_message_references BLOB, sender_id TEXT, content_type INTEGER, created_on_device INTEGER, is_saved INTEGER)');
    const refs = (pair) => Buffer.concat([Buffer.from('3\x02\0\0\0\0\0\0bplist00', 'latin1'), Buffer.from(pair.join('\x00'), 'ascii')]);
    arroyo.run('INSERT INTO conversation_message VALUES (?, 1, 3, ?, ?, ?, NULL, NULL, ?, 1, 0, 0)', [SC_CONV, snapMessageContent(SC_FRIEND), 'COMMITTED', ms(T4 - 600), SC_FRIEND]);
    arroyo.run('INSERT INTO conversation_message VALUES (?, 2, 4, ?, ?, ?, NULL, ?, ?, 0, 1, 0)', [SC_CONV, snapMessageContent(SC_ACCOUNT), 'COMMITTED', ms(otherAt) + 400, refs(SC_REFS.other), SC_ACCOUNT]);
    arroyo.run('INSERT INTO conversation_message VALUES (?, 3, 6, ?, ?, ?, ?, ?, ?, 0, 1, 0)', [SC_CONV, snapMessageContent(SC_ACCOUNT), 'COMMITTED', ms(sentAt) + 500, ms(sentAt) + 30000, refs(SC_REFS.sent), SC_ACCOUNT]);
    // scdb-27.sqlite3 (Core Data): snappen med Cocoa-tider och nyckeln till filen i ett arkiv.
    const scdb = new SQL.Database();
    // Kolumnerna efter ZCREATETIMEUTC och ZENCRYPTION (ZMEDIAFORMAT, text, My Eyes Only, posten sparad) som i scdb-27 på labbtelefonen 2026-11-19.
    scdb.run('CREATE TABLE ZGALLERYENTRY (Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, ZENTRYID VARCHAR, ZCREATETIMEUTC TIMESTAMP, ZISPRIVATE INTEGER DEFAULT 0, ZDUPLICATETIMEUTC TIMESTAMP)');
    scdb.run('CREATE TABLE ZGALLERYSNAP (Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, ZENTRY INTEGER, ZSNAPID VARCHAR, ZMEDIAID VARCHAR, ZMEDIATYPE INTEGER, ZCREATETIMEUTC TIMESTAMP, ZCAPTURETIMEUTC TIMESTAMP, ZTIMEZONENAME VARCHAR, ZWIDTH INTEGER, ZHEIGHT INTEGER, ZDURATION FLOAT, ZCAMERAFRONTFACING INTEGER, ZHASLOCATION INTEGER, ZSERVLETMEDIAFORMAT VARCHAR, ZENCRYPTION BLOB, ZMEDIAFORMAT INTEGER DEFAULT 1, ZHASOVERLAYIMAGE INTEGER DEFAULT 0, ZDUPLICATEDFROMSNAPID VARCHAR)');
    const archive = bplist({ $version: 100000, $archiver: 'NSKeyedArchiver', $top: { root: new Uid(1) },
        $objects: ['$null', { $class: new Uid(4), KEY: new Uid(2), IV: new Uid(3) }, SC_MEDIA_KEY, SC_MEDIA_IV, { $classname: 'SCMemoriesSnapEncryption', $classes: ['SCMemoriesSnapEncryption', 'NSObject'] }] });
    scdb.run('INSERT INTO ZGALLERYENTRY VALUES (1, 2, ?, ?, 0, ?)', [SC_SNAP, saved - COCOA, saved - COCOA]);
    scdb.run("INSERT INTO ZGALLERYSNAP VALUES (1, 6, 1, ?, ?, 0, ?, ?, 'Europe/Stockholm', 640, 480, 10.0, 0, 1, 'image_jpeg', ?, 1, 0, NULL)", [SC_SNAP, SC_SNAP, saved - COCOA, capture + 0.328 - COCOA, archive]);
    scdb.run('INSERT INTO ZGALLERYENTRY VALUES (2, 2, ?, ?, 0, ?)', [SC_ENTRY2, T4 + 3610 - COCOA, T4 + 3610 - COCOA]);
    scdb.run("INSERT INTO ZGALLERYSNAP VALUES (2, 6, 2, ?, ?, 0, ?, ?, 'Europe/Stockholm', 48, 64, 10.0, 0, 0, 'image_png', ?, 1, 0, NULL)", [SC_SNAP2, SC_SNAP2, T4 + 3610 - COCOA, T4 + 3600 - COCOA, archive]);
    scdb.run("INSERT INTO ZGALLERYSNAP VALUES (3, 6, 2, ?, ?, 0, ?, ?, 'Europe/Stockholm', 1080, 1920, 10.0, 1, 1, 'image_jpeg', ?, 1, 0, NULL)", [SC_SNAP3, SC_SNAP3, T4 + 3612 - COCOA, T4 + 3605 - COCOA, archive]);
    // gallery.encrypteddb: positionen under samma snap-id, krypterad med nyckeln i nyckelringen.
    const galleryPlain = await cipherBuilder.makeSnapGallery([{ snapId: SC_SNAP, lat: SC_POS.lat, lon: SC_POS.lon, key: SC_MEDIA_KEY, iv: SC_MEDIA_IV }, { snapId: SC_SNAP3, lat: SC_POS3.lat, lon: SC_POS3.lon }]);
    const gallery = cipherBuilder.encryptSnapGallery(galleryPlain, SC_GALLERY_KEY, Buffer.from(Array.from({ length: 16 }, (_, i) => 200 - i)));
    const D = 'filesystem1/private/var/mobile/Containers/Data/' + SC_APP + 'Documents/';
    const acct = '9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f';
    const entries = [
        { name: 'filesystem1/System/Library/CoreServices/SystemVersion.plist', data: '<?xml version="1.0"?><plist><dict><key>ProductVersion</key><string>26.4.1</string></dict></plist>' },
        // Bildbiblioteket, som i varje riktig extraktion. Snappen finns inte där.
        { name: 'filesystem1/private/var/mobile/Media/PhotoData/Photos.sqlite', data: photos, deflate: true },
        { name: 'filesystem1/private/var/mobile/Containers/Data/' + SC_APP + '.com.apple.mobile_container_manager.metadata.plist', data: bplistDict({ MCMMetadataIdentifier: 'com.toyopagroup.picaboo' }) },
        { name: D + 'global_scoped/cachecontroller/cache_controller.db', data: Buffer.from(cache.export()), deflate: true },
        { name: D + 'global_scoped/cachecontroller/cache_controller.db-wal', data: '' },
        { name: D + 'user_scoped/' + acct + '/arroyo/arroyo.db', data: Buffer.from(arroyo.export()), deflate: true },
        { name: D + 'gallery_data_object/1/' + acct + '/scdb-27.sqlite3', data: Buffer.from(scdb.export()), deflate: true },
        { name: D + 'gallery_encrypted_db/3/' + acct + '/gallery.encrypteddb', data: Buffer.from(gallery) },
    ].concat(Object.keys(files).map((k) => ({ name: D + 'com.snap.file_manager_3_SCContent_' + SC_ACCOUNT + '/' + k, data: files[k].data, mtime: Math.round(files[k].at) })));
    [cache, arroyo, scdb].forEach((db) => db.close());
    const keychain = '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>genp</key><array>' +
        '<dict><key>agrp</key><string>3MY7A92V5W.com.toyopagroup.picaboo</string><key>svce</key><string>com.toyopagroup.picaboo</string><key>acct</key><string>egocipher.key.avoidkeyderivation</string>' +
        '<key>v_Data</key><data>' + SC_GALLERY_KEY.toString('base64') + '</data></dict></array><key>inet</key><array/></dict></plist>\n';
    return { entries, keychain, info: { snapId: SC_SNAP, entry2: SC_ENTRY2, snap2: SC_SNAP2, snap3: SC_SNAP3, memory2Key: SC_KEYS.memory2, snap3CaptureMs: ms(T4 + 3605), pos3: SC_POS3, memoryKey: SC_KEYS.memory, sentKey: SC_KEYS.sent, otherKey: SC_KEYS.other, friend: SC_FRIEND, captureMs: ms(capture + 0.328), savedMs: ms(saved), sentMs: ms(sentAt), pos: SC_POS,
        contentSha256: crypto.createHash('sha256').update(jpeg).digest('hex') } };
}

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

// Samma telefon, men inget i loggarna säger vilken zon tiderna står i: SSRM utan [RTC] och batterifilerna utan
// ändringstid. Telefonens inställda zon finns (persistent_properties: en post per egenskap, namnet i fält 1, värdet i fält 2).
function samsungNoZoneEntries(SQL, jpeg) {
    const str = (no, s) => [(no << 3) | 2, Buffer.byteLength(s), ...Buffer.from(s)];
    const record = (k, v) => { const inner = [...str(1, k), ...str(2, v)]; return [(1 << 3) | 2, inner.length, ...inner]; };
    const props = Buffer.from([...record('persist.sys.locale', 'sv-SE'), ...record('persist.sys.timezone', 'Europe/Stockholm')]);
    return samsungEntries(SQL, jpeg).map((e) => {
        if (/ssrm_heating/.test(e.name)) return Object.assign({}, e, { data: String(e.data).split('\n').filter((l) => !/\[RTC\]/.test(l)).join('\n') });
        if (/newbatterystats/.test(e.name)) return { name: e.name, data: e.data };
        return e;
    }).concat([{ name: 'data/property/persistent_properties', data: props }]);
}

// Samma telefon med Signal: signal.db och signal-logs.db, krypterade som Signal gör på Android (nyckeln ur
// lösenordet i ett varv PBKDF2, HMAC-SHA1, 48 byte reserv, saltet först i filen). Tabellerna är påhittade och har
// bara kolumnerna som Härkomsts frågor läser. Bilden i chattappen väljs ur galleriet två minuter efter att den
// togs och skickas till en kontakt med HTML i namnet. Loggen har rader över två månader, med index på tiden
// som i appen, så att frågan över hela loggen körs i flera tidsdelar.
const SIGNAL_ANDROID_KEY = crypto.createHash('sha256').update('påhittad nyckel till Signal på Android').digest('hex');
// Bilagenyckeln (modernKey) och bilagans fil under app_parts/, krypterad som Signal gör på Android: nyckeln är
// HMAC-SHA256(modernKey, data_random), AES-256-CTR med noll-IV, och filen är utfylld efter innehållet. Gjord med
// Nodes crypto, inte med programmets egen kod, så att testet inte jämför programmet med sig självt.
const SIGNAL_ANDROID_MODERN = crypto.createHash('sha256').update('påhittad bilagenyckel till Signal på Android').digest();
const SIGNAL_ANDROID_PART = 'data/data/org.thoughtcrime.securesms/app_parts/part7.mms';

function signalAndroidPart(picture, random) {
    const key = crypto.createHmac('sha256', SIGNAL_ANDROID_MODERN).update(random).digest();
    const cipher = crypto.createCipheriv('aes-256-ctr', key, Buffer.alloc(16));
    return Buffer.concat([cipher.update(Buffer.concat([picture, Buffer.alloc(37)])), cipher.final()]);
}

function signalAndroidCipher(plain, name) {
    const salt = crypto.createHash('sha256').update('salt ' + name).digest().subarray(0, 16);
    return cipherPages(plain, { reserve: 48, hmac: 'sha1', key: crypto.pbkdf2Sync(Buffer.from(SIGNAL_ANDROID_KEY, 'utf8'), salt, 1, 32, 'sha1'), salt, first: salt });
}

function signalAndroidEntries(SQL, jpeg) {
    const entries = samsungEntries(SQL, jpeg);
    const picture = entries.find((e) => /chatt_kamera\.jpg$/.test(e.name)).data;
    const hash = crypto.createHash('sha256').update(picture).digest('base64');
    const ms = (sec) => (TS2 + sec) * 1000;

    const main = emptyDb(SQL, 48);
    main.run('CREATE TABLE recipient (_id INTEGER PRIMARY KEY, type INTEGER DEFAULT 0, nickname_joined_name TEXT, system_joined_name TEXT, profile_joined_name TEXT, username TEXT, e164 TEXT)');
    main.run('CREATE TABLE groups (_id INTEGER PRIMARY KEY, recipient_id INTEGER, title TEXT)');
    main.run('CREATE TABLE thread (_id INTEGER PRIMARY KEY, recipient_id INTEGER)');
    main.run('CREATE TABLE message (_id INTEGER PRIMARY KEY, date_sent INTEGER, date_received INTEGER, date_server INTEGER, type INTEGER, thread_id INTEGER, from_recipient_id INTEGER, to_recipient_id INTEGER, view_once INTEGER DEFAULT 0, deleted_by INTEGER, body TEXT)');
    main.run('CREATE TABLE attachment (_id INTEGER PRIMARY KEY, message_id INTEGER, content_type TEXT, file_name TEXT, data_size INTEGER, width INTEGER, height INTEGER, data_file TEXT, data_random BLOB, data_hash_start TEXT, data_hash_end TEXT, upload_timestamp INTEGER, transform_properties TEXT, fast_preflight_id TEXT)');
    insert(main, 'recipient', { _id: 1, type: 0, profile_joined_name: 'Telefonens ägare' });
    insert(main, 'recipient', { _id: 2, type: 0, profile_joined_name: 'Kim ' + XSS });
    insert(main, 'thread', { _id: 1, recipient_id: 2 });
    // Ett äldre meddelande, så att databasen täcker tiden före bilden, och meddelandet med bilden (typ 23: skickat).
    insert(main, 'message', { _id: 1, date_sent: ms(-40 * 86400), date_received: ms(-40 * 86400), date_server: ms(-40 * 86400) + 150, type: 10485783, thread_id: 1, from_recipient_id: 1, to_recipient_id: 2, body: 'x' });
    insert(main, 'message', { _id: 2, date_sent: ms(125), date_received: ms(125), date_server: ms(125) + 150, type: 10485783, thread_id: 1, from_recipient_id: 1, to_recipient_id: 2, body: 'x' });
    insert(main, 'attachment', { _id: 7, message_id: 2, content_type: 'image/jpeg', data_size: picture.length, width: 8, height: 8, data_file: '/data/user/0/org.thoughtcrime.securesms/app_parts/part7.mms',
        data_random: new Uint8Array(32), data_hash_start: hash, data_hash_end: hash, upload_timestamp: ms(126) });
    const mainBytes = Buffer.from(main.export());
    main.close();

    const logs = emptyDb(SQL, 48);
    logs.run('CREATE TABLE log (_id INTEGER PRIMARY KEY, created_at INTEGER, keep_longer INTEGER DEFAULT 0, body TEXT, size INTEGER)');
    logs.run('CREATE INDEX log_created_at_keep_longer_index ON log (created_at, keep_longer)');
    const line = (t, text) => '[8.33.2] [main ] ' + new Date(t + 7200000).toISOString().replace('T', ' ').replace('Z', '') + ' GMT+02:00 I ' + text;
    const add = logs.prepare('INSERT INTO log (created_at, body, size) VALUES (?, ?, ?)');
    const row = (t, text) => add.run([t, line(t, text), 200]);
    // Rader som frågan inte letar efter, en var halvtimme från 40 dygn före bilden till 20 dygn efter.
    for (let t = ms(-40 * 86400); t <= ms(20 * 86400); t += 1800000) row(t, 'IncomingMessageObserver: Network: true, Foreground: 0, FCM: true, Registered: true');
    row(ms(110), 'BaseActivity: [MediaSendV3Activity] onCreate()');
    row(ms(120), 'AttachmentTable: Inserting attachment content://media/external/images/media/2 for pre-upload.');
    row(ms(120) + 200, 'AttachmentTable: [insertAttachmentWithData] Inserted attachment at AttachmentId::7');
    row(ms(125) + 900, 'IndividualSendJobV2: [' + ms(125) + '][2] Sent message.');
    add.free();
    const logBytes = Buffer.from(logs.export());
    logs.close();

    const dir = 'data/data/org.thoughtcrime.securesms/databases/';
    return entries.concat([
        { name: SIGNAL_ANDROID_PART, data: signalAndroidPart(picture, Buffer.alloc(32)) },
        { name: dir + 'signal.db', data: signalAndroidCipher(mainBytes, 'signal.db') },
        { name: dir + 'signal-logs.db', data: signalAndroidCipher(logBytes, 'signal-logs.db'), deflate: true },
    ]);
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
        { name: P + 'Containers/Shared/' + GROUP_SIGNAL + 'attachment_files/AB/ABCDEF', data: noise(4096), mtime: T2 },
        { name: P + 'Containers/Shared/' + GROUP_WA + 'ChatStorage.sqlite', data: Buffer.from(whatsappDb(SQL, sha(waReceived))), deflate: true },
        { name: P + 'Containers/Shared/' + GROUP_WA + 'ChatStorage.sqlite-wal', data: '' },
        { name: P + 'Containers/Shared/' + GROUP_WA + 'Message/Media/1@lid/c/d/mottagen.jpg', data: waReceived, mtime: T2 + 71 },
        { name: P + 'Containers/Shared/' + GROUP_WA + 'Message/Media/4@lid/e/f/IMG_0042.HEIC', data: HEIC, mtime: T2 - 86400 },
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
    ['nycklar', 'ufed', 'ufed-rapport', 'bredvid', 'flera', 'ingen', 'snapchat'].forEach((d) => fs.mkdirSync(path.join(dir, d)));
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
        samsungNoZone: path.join(dir, 'Testextraktion-Samsung-utan-zon.zip'),
        samsungSignal: path.join(dir, 'Testextraktion-Samsung-med-Signal.zip'),
        // Snapchat Memories på iOS 26, med nyckelringen bredvid (samma id i namnet).
        snapchatIos: path.join(dir, 'snapchat', '00008030-0000000000000003_fs.zip'),
        snapchatIosKey: path.join(dir, 'snapchat', '00008030-0000000000000003_keychain.plist'),
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
    fs.writeFileSync(files.samsungNoZone, buildZip(samsungNoZoneEntries(SQL, jpeg)));
    const snapIos = await snapchatIosEntries(SQL, jpeg, photos);
    fs.writeFileSync(files.snapchatIos, buildZip(snapIos.entries));
    fs.writeFileSync(files.snapchatIosKey, snapIos.keychain);
    const signalEntries = signalAndroidEntries(SQL, jpeg);
    fs.writeFileSync(files.samsungSignal, buildZip(signalEntries));
    const sum = (data) => crypto.createHash('sha256').update(data).digest('hex');
    const signalAndroidPartSums = { file: sum(signalEntries.find((e) => e.name === SIGNAL_ANDROID_PART).data), content: sum(signalEntries.find((e) => /chatt_kamera\.jpg$/.test(e.name)).data) };
    return { files, snapchatIos: snapIos.info, signalAndroidKey: SIGNAL_ANDROID_KEY, signalAndroidModernKey: SIGNAL_ANDROID_MODERN.toString('base64'), signalAndroidPartSums, T: T * 1000, imageName: 'IMG_0001.JPG', T2: T2 * 1000, waMedia: 'mottagen.jpg', T3: T3 * 1000, tgMedia: TG_MEDIA, TS: TS * 1000, TS2: TS2 * 1000, TS3: TS3 * 1000,
        longChat: { count: LONG.count, needles: LONG.needles, gapAfter: LONG.gapAfter, timeMs: (i) => longTime(i) * 1000 } };
}

module.exports = { build, loadSql, T: T * 1000 };
