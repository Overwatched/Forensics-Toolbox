// Testdata för Härkomst: samma påhittade promenad i Stockholm 1 juni 2024 som i EXIF & karta.
// Anna tar IMG_4104.JPG vid Sergels torg mitt i en Snapchat-session, och några minuter senare
// spelar hon in en video med Snapchats kamera och skickar den till Erik. Två scenarier delar
// samma telefonlogg: kamerabilden i biblioteket (scenario) och Snapchat-videon utanför
// biblioteket (snapchatScenario). Raderna är påhittade men har samma form som rollqueryernas
// rader, så hela flödet går att prova utan extraktion.
(function (root) {
    'use strict';

    var COCOA = 978307200;
    var T = Date.UTC(2024, 5, 1, 12, 31, 30);   // 14:31:30 i Europe/Stockholm: IMG_4104.JPG tas
    var S = 1000;
    var M = 60 * S;
    var T2 = T + 6 * M + 46 * S;               // 14:38:16: videon spelas in med Snapchats kamera

    var KC = function (stream, cols, queryId) { return { db: 'knowledgeC.db', table: 'ZOBJECT', stream: stream, column: cols, queryId: queryId }; };
    var USAGE = KC('/app/usage', 'ZSTARTDATE, ZENDDATE, ZVALUESTRING', 'role-app-usage');
    var SCREEN = KC('/display/isBacklit', 'ZSTARTDATE, ZENDDATE, ZVALUEINTEGER', 'role-screen');
    var LOCK = KC('/device/isLocked', 'ZSTARTDATE, ZENDDATE, ZVALUEINTEGER', 'role-lock');
    var PHOTOS = { db: 'Photos.sqlite', table: 'ZASSET', column: 'ZDATECREATED', queryId: 'role-file' };
    var NEIGHBOURS = { db: 'Photos.sqlite', table: 'ZASSET', column: 'ZDATECREATED', queryId: 'role-neighbours' };
    var ROUTINED = { db: 'Cache.sqlite', table: 'ZRTCLLOCATIONMO', column: 'ZTIMESTAMP, ZLATITUDE, ZLONGITUDE', queryId: 'role-location' };
    var CACHE_SRC = { db: 'cache_controller.db', table: 'CACHE_FILE_CLAIM', column: 'CREATION_TIMESTAMP_MILLIS', queryId: 'role-cache-key' };

    var PICABOO = 'com.toyopagroup.picaboo';
    var CAMERA = 'com.apple.camera';
    var PHOTOS_APP = 'com.apple.mobileslideshow';
    var SPRINGBOARD = 'com.apple.springboard';

    // Snapchat (beta): konto, vän, konversation och appbehållare. Allt påhittat.
    var ACCOUNT_UUID = '2b7e1d0c-3f4a-4b5c-9d6e-7f8a9b0c1d2e';
    var ACCOUNT = ACCOUNT_UUID.replace(/-/g, '');
    var ERIK = '9e6f7a8b1c2d4e3f8a9b0c1d2e3f4a5b';
    var CONVERSATION = '6f1e2d3c-4b5a-4968-8776-655443322110';
    var APP_GUID = '61AE6288-182A-4DBE-A56C-CA2590D52576';
    var MOBILE = 'testdata/private/var/mobile/';
    var APP_DIR = MOBILE + 'Containers/Data/Application/' + APP_GUID + '/';
    var CACHE_DIR = 'Documents/com.snap.file_manager_3_SCContent_' + ACCOUNT_UUID + '/';
    // Den bedömda filen i Snapchat-scenariot: en inspelning med Snapchats kamera.
    var REC = { key: 'e4d2c0b8a6948271605f3e1d2c3b4a59', id: '5A1F0C3E-7B2D-4E6F-9A8B-0C1D2E3F4A5B', size: 3184726, crc32: 0x3f9a1c27 };
    var SENT2 = '8C4D2E1F-3A5B-4C6D-8E9F-0A1B2C3D4E5F';

    function cocoa(ms) { return Math.round(ms / 10) / 100 - COCOA; }

    // Meddelandets protobuf byggs för hand: 08 0c 12 12 0a 10 <avsändar-uuid> … plus nyckel och IV som i riktiga snaps.
    function hexBytes(h) { var out = []; for (var i = 0; i < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16)); return out; }
    function lenField(field, bytes) { return [field * 8 + 2, bytes.length].concat(bytes); }
    function messageContent(senderHex) {
        var inner = lenField(1, hexBytes(senderHex));
        var keyIv = lenField(1, Array(32).fill(7)).concat(lenField(2, Array(16).fill(9)));
        return Uint8Array.from([8, 12].concat(lenField(2, inner)).concat(lenField(7, lenField(1, keyIv))));
    }

    // Snapchats register i rollqueryernas form. Erik skickar en snap som öppnas, Anna svarar med
    // en snap strax efter IMG_4104, spelar sedan in en video med Snapchats kamera och skickar den.
    // fileKey är den bedömda cachefilens nyckel, eller null när den bedömda filen ligger i biblioteket.
    function snapchatContext(fileKey) {
        var friends = {};
        friends[ERIK] = { username: 'erik.lind', displayName: 'Erik Lind' };
        return {
            accountId: ACCOUNT_UUID, fileKey: fileKey, centerMs: fileKey ? T2 : T, friends: friends,
            cacheRows: [
                { key: '0a1b2c3d4e5f60718293a4b5c6d7e8f9', context: 3, external: '1:' + CONVERSATION + ':12:0:0', createdMs: T - 6 * M, deletedMs: null, user: ACCOUNT_UUID },
                { key: '7d1f3a9c2b4e5f60718293a4b5c6d7e8', context: 3, external: 'ERIK.LIND~4B56F0F3-AFC0-471A-A240-D88C4F161786', createdMs: T + 26 * S, deletedMs: null, user: ACCOUNT_UUID },
                { key: REC.key, context: 34, external: REC.id + '~1', createdMs: T2, deletedMs: null, size: REC.size, lastReadMs: T2 + 2 * S, user: ACCOUNT_UUID },
                { key: 'b1c2d3e4f5a60718293a4b5c6d7e8f90', context: 3, external: 'ERIK.LIND~' + SENT2, createdMs: T2 + 2 * S, deletedMs: null, user: ACCOUNT_UUID },
                { key: 'c3d4e5f6a7b80918273645a5b6c7d8e9', context: 3, external: 'SNAPVIDEOFILTERSTATE-ERIK.LIND~' + SENT2, createdMs: T2 + 2 * S, deletedMs: null, user: ACCOUNT_UUID },
            ],
            messages: [
                { conversation: CONVERSATION, serverId: 12, clientId: 7, createdMs: T - 6 * M - 4 * S, readMs: T - 6 * M, content: messageContent(ERIK) },
                { conversation: CONVERSATION, serverId: 13, clientId: 8, createdMs: T + 27 * S, readMs: T + 71 * S, content: messageContent(ACCOUNT) },
                { conversation: CONVERSATION, serverId: 14, clientId: 9, createdMs: T2 + 3 * S, readMs: T2 + 45 * S, content: messageContent(ACCOUNT) },
            ],
            notifications: [{ ms: T - 6 * M - 3 * S, type: 'snap', category: 1 }],
            sources: {
                cache: { db: 'cache_controller.db', table: 'CACHE_FILE_CLAIM + CACHE_FILE_METADATA', queryId: 'role-cache-window' },
                messages: { db: 'arroyo.db', table: 'conversation_message', queryId: 'role-messages' },
                notifications: { db: 'nse_db.sqlite', table: 'ProcessedNotifications', queryId: 'role-notifications' },
            },
        };
    }
    // Snap är modulen snapchat.js, skickad av den som anropar (ingen require här: filen körs i webbläsaren).
    function snapchatSample(Snap, fileKey) {
        if (!Snap) return { events: [], notes: [], link: null };
        return Snap.build(snapchatContext(fileKey));
    }

    function asset(pk, name, ms, importer, importedBy, kindSubtype) {
        return {
            pk: pk, directory: 'DCIM/100APPLE', filename: name, originalFilename: name,
            createdMs: ms, addedMs: ms + 300, modifiedMs: ms + 300, importedBy: importedBy, importer: importer,
            kindSubtype: kindSubtype || 0, trashed: 0,
        };
    }

    // Telefonens egen logg: knowledgeC och routined. Samma i båda scenarierna.
    function phoneLog() {
        var iv = function (start, end, app) { return { startMs: T + start, endMs: T + end, app: app, stream: '/app/usage', source: USAGE }; };
        return {
            appIntervals: [
                iv(-11 * M - 28 * S, -8 * M - 50 * S, PICABOO),
                iv(-1 * M - 55 * S, -32 * S, PICABOO),
                iv(-31 * S, 24 * S, CAMERA),
                iv(26 * S, 3 * M + 48 * S, PICABOO),
                iv(4 * M + 2 * S, 4 * M + 20 * S, SPRINGBOARD),
                iv(4 * M + 31 * S, 5 * M + 46 * S, PHOTOS_APP),
                iv(5 * M + 46 * S, 9 * M + 10 * S, PICABOO),
            ],
            screen: [
                { startMs: T - 15 * M, endMs: T - 11 * M - 40 * S, on: false, stream: '/display/isBacklit', source: SCREEN },
                { startMs: T - 11 * M - 40 * S, endMs: T - 8 * M - 45 * S, on: true, stream: '/display/isBacklit', source: SCREEN },
                { startMs: T - 8 * M - 45 * S, endMs: T - 2 * M - 5 * S, on: false, stream: '/display/isBacklit', source: SCREEN },
                { startMs: T - 2 * M - 5 * S, endMs: T + 9 * M + 15 * S, on: true, stream: '/display/isBacklit', source: SCREEN },
                { startMs: T + 9 * M + 15 * S, endMs: T + 15 * M, on: false, stream: '/display/isBacklit', source: SCREEN },
            ],
            lock: [
                { startMs: T - 15 * M, endMs: T - 11 * M - 36 * S, locked: true, stream: '/device/isLocked', source: LOCK },
                { startMs: T - 11 * M - 36 * S, endMs: T - 8 * M - 44 * S, locked: false, stream: '/device/isLocked', source: LOCK },
                { startMs: T - 8 * M - 44 * S, endMs: T - 2 * M - 1 * S, locked: true, stream: '/device/isLocked', source: LOCK },
                { startMs: T - 2 * M - 1 * S, endMs: T + 9 * M + 17 * S, locked: false, stream: '/device/isLocked', source: LOCK },
                { startMs: T + 9 * M + 17 * S, endMs: T + 15 * M, locked: true, stream: '/device/isLocked', source: LOCK },
            ],
            locations: [
                { ms: T - 9 * M - 50 * S, lat: 59.33426, lon: 18.0632, accuracy: 10, type: 1 },
                { ms: T - 4 * M - 10 * S, lat: 59.33330, lon: 18.06360, accuracy: 14, type: 1 },
                { ms: T - 40 * S, lat: 59.33258, lon: 18.06398, accuracy: 8, type: 1 },
                { ms: T + 3 * M + 5 * S, lat: 59.33254, lon: 18.06405, accuracy: 12, type: 4 },
                { ms: T + 8 * M + 20 * S, lat: 59.33240, lon: 18.06470, accuracy: 9, type: 1 },
            ],
            coverage: {
                '/app/usage': { firstMs: T - 26 * 86400 * S, lastMs: T + 3 * 86400 * S, rows: 1412 },
                '/app/inFocus': { firstMs: null, lastMs: null, rows: 0 },
                '/display/isBacklit': { firstMs: T - 26 * 86400 * S, lastMs: T + 3 * 86400 * S, rows: 2390 },
                '/device/isLocked': { firstMs: T - 26 * 86400 * S, lastMs: T + 3 * 86400 * S, rows: 1105 },
            },
            locationSource: ROUTINED,
            platform: 'iOS',
            snapchatAccount: ACCOUNT_UUID,
            extraction: { name: 'Testdata (påhittad extraktion)', size: 0, lastModified: '' },
            deviceLabel: 'iOS 17.5.1 (påhittad)',
            sources: SOURCES,
        };
    }

    function dbSource(label, path, wal) {
        return { label: label, path: path, size: 0, mtime: '', crc32: 'påhittad', crcOk: true, sha256: 'påhittad',
            walPath: wal ? path + '-wal' : '', walCrc32: wal ? 'påhittad' : '', walSha256: wal ? 'påhittad' : '', walSummary: '-wal: påhittad testdata.', warnings: [] };
    }
    var SOURCES = [
        dbSource('Photos.sqlite (testdata)', MOBILE + 'Media/PhotoData/Photos.sqlite', true),
        dbSource('knowledgeC.db (testdata)', MOBILE + 'Library/CoreDuet/Knowledge/knowledgeC.db', true),
        dbSource('Cache.sqlite (routined, testdata)', MOBILE + 'Library/Caches/com.apple.routined/Cache.sqlite', false),
        dbSource('cache_controller.db (Snapchat, testdata)', APP_DIR + 'Documents/global_scoped/cachecontroller/cache_controller.db', true),
        dbSource('arroyo.db (Snapchat chatt, testdata)', APP_DIR + 'Documents/user_scoped/' + ACCOUNT_UUID + '/arroyo/arroyo.db', true),
        dbSource('primary.docobjects (Snapchat konton, testdata)', APP_DIR + 'Documents/user_scoped/' + ACCOUNT_UUID + '/DocObjects/primary.docobjects', true),
        dbSource('nse_db.sqlite (Snapchat notiser, testdata)', MOBILE + 'Containers/Shared/AppGroup/9B130154-B641-4454-B8CB-DDED0F382A08/User/' + ACCOUNT_UUID + '/databases/nse_db.sqlite', true),
    ];

    // deps.snapchat: modulen ProvenanceSnapchat, för Snapchat-händelserna i testdatat.
    function scenario(deps) {
        var file = asset(4104, 'IMG_4104.JPG', T, CAMERA, 1, 0);
        Object.assign(file, {
            exifTime: '2024:06:01 14:31:30', zoneName: 'Europe/Stockholm', zoneOffset: 7200, editor: null, savedAssetType: 3,
            kind: 0, uti: 'public.jpeg', hidden: 0, cloudLocalState: 0, latitude: 59.33255, longitude: 18.064,
            cameraMake: 'Apple', cameraModel: 'iPhone 15 Pro',
        });
        file._raw = {
            Z_PK: 4104, ZDIRECTORY: 'DCIM/100APPLE', ZFILENAME: 'IMG_4104.JPG', ZORIGINALFILENAME: 'IMG_4104.JPG',
            ZDATECREATED: cocoa(T), ZADDEDDATE: cocoa(T + 300), ZMODIFICATIONDATE: cocoa(T + 300),
            ZEXIFTIMESTAMPSTRING: '2024:06:01 14:31:30', ZTIMEZONENAME: 'Europe/Stockholm', ZTIMEZONEOFFSET: 7200,
            ZIMPORTEDBY: 1, ZIMPORTEDBYBUNDLEIDENTIFIER: CAMERA, ZIMPORTEDBYDISPLAYNAME: 'Kamera', ZEDITORBUNDLEID: null,
            ZSAVEDASSETTYPE: 3, ZKIND: 0, ZKINDSUBTYPE: 0, ZUNIFORMTYPEIDENTIFIER: 'public.jpeg', ZTRASHEDSTATE: 0, ZHIDDEN: 0, ZCLOUDLOCALSTATE: 0,
            ZLATITUDE: 59.33255, ZLONGITUDE: 18.064, ZCAMERAMAKE: 'Apple', ZCAMERAMODEL: 'iPhone 15 Pro',
        };
        var snap = snapchatSample(deps && deps.snapchat || root.ProvenanceSnapchat, null);

        return Object.assign({
            kind: 'camera',
            extraEvents: snap.events,
            extraNotes: snap.notes,
            copies: [{
                name: MOBILE + 'Containers/Shared/AppGroup/1A79BE73-8D07-45B5-BC79-BBB0DFC3B273/File Provider Storage/photospicker/uuid=22AEE635-96CF-4365-9E74-8A92BE6BA0C5&code=001&library=1&type=1&mode=1&loc=true&cap=true.pvt/IMG_4104.JPG',
                size: 2437118, crc32: 'påhittad', mtime: '2024-06-01 12:33:02 UTC', area: 'picker', label: 'Bildväljaren (kopia som en app fick välja ur biblioteket)', plain: 'som en kopia en app fick ur bildbiblioteket', shaOk: true,
            }],
            note: 'Påhittade testdata: samma promenad i Stockholm som i EXIF & karta. Inget kommer från en riktig telefon.',
            file: file,
            fileSource: PHOTOS,
            neighbourSource: NEIGHBOURS,
            exif: {
                read: true, takenMs: T, takenText: '2024-06-01 14:31:30 +02:00', sourceTag: 'ExifIFD:DateTimeOriginal',
                make: 'Apple', model: 'iPhone 15 Pro', software: '17.5.1',
                position: { lat: 59.33257, lon: 18.06402, accuracy: 12, source: 'Composite:GPSPosition' },
                source: { db: 'bildfilen', table: 'IMG_4104.JPG', column: 'ExifIFD:DateTimeOriginal' },
            },
            exifRows: [
                ['ExifIFD:DateTimeOriginal', '2024:06:01 14:31:30'], ['ExifIFD:OffsetTimeOriginal', '+02:00'], ['ExifIFD:CreateDate', '2024:06:01 14:31:30'],
                ['IFD0:Make', 'Apple'], ['IFD0:Model', 'iPhone 15 Pro'], ['IFD0:Software', '17.5.1'], ['File:MIMEType', 'image/jpeg'],
                ['Composite:GPSLatitude', '59 deg 19\' 57.18" N'], ['Composite:GPSLongitude', '18 deg 3\' 50.40" E'],
            ],
            fileEntry: { name: 'filesystem1/private/var/mobile/Media/DCIM/100APPLE/IMG_4104.JPG', size: 2437118, mtimeMs: T + 1000 },
            neighbours: [
                asset(4103, 'IMG_4103.JPG', T - 12 * M - 25 * S, CAMERA, 1, 0),
                asset(4105, 'IMG_4105.JPG', T + 33 * M + 32 * S, CAMERA, 1, 0),
                asset(4113, 'IMG_4113.PNG', T + 4 * M + 12 * S, SPRINGBOARD, 8, 10),
            ],
            fileEntryMeta: { path: 'testdata/private/var/mobile/Media/DCIM/100APPLE/IMG_4104.JPG', size: 2437118, mtime: '2024-06-01 12:31:31 UTC', crc32: 'påhittad', crcOk: true, md5: 'påhittad', sha256: 'påhittad' },
        }, phoneLog());
    }

    // Snapchat-scenariot (beta): den bedömda filen är videon Anna spelar in med Snapchats kamera
    // 14:38:16 och skickar till Erik. Den ligger i Snapchats cache utan rad i Photos.sqlite, så
    // tidpunkten kommer ur cache_controller.db och filnamnet är cachenyckeln. Samma bytes finns
    // också i recorded_videos och i appens Library/Caches, som i en riktig extraktion.
    // deps.snapchat: ProvenanceSnapchat. deps.copies: ProvenanceCopies, för platsens betydelse.
    function snapchatScenario(deps) {
        var Snap = deps && deps.snapchat || root.ProvenanceSnapchat;
        var Copies = deps && deps.copies || root.ProvenanceCopies;
        var zipPath = APP_DIR + CACHE_DIR + REC.key;
        var snap = snapchatSample(Snap, REC.key);
        var link = snap.link;
        var file = {
            filename: REC.key, directory: APP_DIR + CACHE_DIR.slice(0, -1), createdMs: T2, addedMs: null, modifiedMs: null,
            importer: PICABOO, zoneName: null, zoneOffset: null,
            snapchatCache: {
                key: REC.key, path: CACHE_DIR + REC.key, size: REC.size, crc32: REC.crc32,
                context: link ? link.context.code : 34, label: link ? link.context.label : 'inspelning med Snapchats kamera', known: true,
                external: link ? link.external : { kind: 'recording', recordingId: REC.id }, own: null, who: null, recordingCopy: true,
            },
            _raw: {
                'Sökväg i zippen': zipPath, Plats: 'Snapchat, cache (file_manager)',
                CACHE_KEY: REC.key, MEDIA_CONTEXT_TYPE: 34, EXTERNAL_KEY: REC.id + '~1',
                CREATION_TIMESTAMP_MILLIS: T2, EXPIRATION_TIMESTAMP_MILLIS: T2 + 7 * 86400 * S, DELETED_TIMESTAMP_MILLIS: null,
                FILE_SIZE_BYTES: REC.size, LAST_READ_TIMESTAMP_MILLIS: T2 + 2 * S, USER_ID: ACCOUNT_UUID,
            },
        };
        var classify = function (name) { return Copies ? Copies.classifyPath(name, { snapchatContainers: [APP_GUID] }) : { area: 'snapchat', label: 'Snapchat', plain: 'i Snapchat' }; };
        var copy = function (name) { var c = classify(name); return { name: name, size: REC.size, crc32: 'påhittad', mtime: '2024-06-01 12:38:15 UTC', area: c.area, label: c.label, plain: c.plain, shaOk: true }; };

        return Object.assign({
            kind: 'snapchat',
            extraEvents: snap.events,
            extraNotes: snap.notes,
            copies: [
                copy(APP_DIR + 'Library/Caches/user_scoped/' + ACCOUNT_UUID + '/recorded_videos/recorded-184562.mp4'),
                copy(APP_DIR + 'Library/Caches/' + REC.id + '.mp4'),
            ],
            note: 'Påhittade testdata: en video som spelas in med Snapchats kamera på samma promenad i Stockholm och skickas till en vän. Filen ligger i Snapchats cache, inte i bildbiblioteket. Inget kommer från en riktig telefon.',
            file: file,
            fileSource: CACHE_SRC,
            neighbourSource: NEIGHBOURS,
            exif: { read: true, takenMs: null, takenText: null, sourceTag: null, make: null, model: null, software: null, position: null, source: { db: 'bildfilen', table: REC.key, column: '' } },
            exifRows: [
                ['File:FileType', 'MP4'], ['File:MIMEType', 'video/mp4'], ['QuickTime:MajorBrand', 'MP4 v2 [ISO 14496-14]'],
                ['QuickTime:Duration', '0:00:08'], ['QuickTime:ImageWidth', '1080'], ['QuickTime:ImageHeight', '1920'], ['QuickTime:VideoFrameRate', '30'],
            ],
            fileEntry: { name: zipPath, size: REC.size, mtimeMs: T2 + S },
            neighbours: [
                asset(4104, 'IMG_4104.JPG', T, CAMERA, 1, 0),
                asset(4113, 'IMG_4113.PNG', T + 4 * M + 12 * S, SPRINGBOARD, 8, 10),
            ],
            fileEntryMeta: { path: zipPath, size: REC.size, mtime: '2024-06-01 12:38:17 UTC', crc32: 'påhittad', crcOk: true, md5: 'påhittad', sha256: 'påhittad' },
        }, phoneLog());
    }

    // ---------- Android (beta): selfie med Snapchats frontkamera, sparad till galleriet ----------

    // Samma promenad, men på en Android-telefon: tio minuter efter IMG_4104 tar Anna en selfie med
    // Snapchats frontkamera, sparar den till Memories och galleriet och skickar den till Erik.
    // MediaStore-raden saknar datetaken (så ser Snapchats exporter ut), T blir date_added, och raden i
    // Memories som sparades i samma sekund ger tagningstiden, kameran, positionen och tidszonen.
    // App, skärm och lås kommer ur usagestats, kameran per app ur appops.
    var T3 = T + 10 * M;                                   // 14:41:30: selfien tas
    var ANDROID_SNAP = 'com.snapchat.android';
    var ANDROID_CAMERA = 'com.google.android.GoogleCamera';
    var LAUNCHER = 'com.google.android.apps.nexuslauncher';
    var SYSTEMUI = 'com.android.systemui';
    var SNAP_FILE = 'Snapchat-1717245690.jpg';
    var MEM_ID = '4669844f-2375-6c4f-5de8-14894448591e';
    var ANDROID_APP = 'data/data/com.snapchat.android/';
    var MEDIASTORE = { db: 'MediaStore / filer (external.db)', table: 'files', column: 'date_added (datetaken saknas)', queryId: 'role-file' };
    var MS_NEIGHBOURS = { db: 'MediaStore / filer (external.db)', table: 'files', column: 'datetaken', queryId: 'role-neighbours' };
    var USAGESTATS = { db: 'usagestats', table: 'daily/1717192800000', column: 'event_log: typ 1/2/23 (app), 15/16 (skärm), 17/18 (låsskärm)', queryId: 'usagestats-daily' };
    var APPOPS = { db: 'appops', table: 'discrete/1717247700000tl … 1717249500000tl (3 filer)', column: 'op 26 (CAMERA): nt (start), nd (längd ms) per paket', queryId: 'appops-discrete' };
    var MEMORIES_SRC = { db: 'memories.db', table: 'memories_snap', column: 'snap_capture_time, create_time, front_facing, latitude, longitude', queryId: 'role-memories' };
    var UA = 'Snapchat/13.5.0.42 (Pixel 8; Android 14#UQ1A.240205.004#34; gzip) V/MUSHROOM';
    // EXIF UserComment som Snapchat skriver: base64 av en protobuf { 1: { 1: user agent } }.
    function uaBase64() {
        var bytes = []; for (var i = 0; i < UA.length; i++) bytes.push(UA.charCodeAt(i));
        var proto = lenField(1, lenField(1, bytes));
        var bin = ''; for (var j = 0; j < proto.length; j++) bin += String.fromCharCode(proto[j]);
        return typeof btoa === 'function' ? btoa(bin) : '';
    }

    function androidSnapchatContext() {
        var friends = {};
        friends[ERIK] = { username: 'erik.lind', displayName: 'Erik Lind' };
        var erikUuid = ERIK.slice(0, 8) + '-' + ERIK.slice(8, 12) + '-' + ERIK.slice(12, 16) + '-' + ERIK.slice(16, 20) + '-' + ERIK.slice(20);
        return {
            app: ANDROID_SNAP, accountId: ACCOUNT_UUID, friends: friends, centerMs: T3 + S,
            file: { addedMs: T3 + S, createdMs: T3 + S, video: false },
            cacheRows: [
                { key: '96ccba52c4ad30d3905afa6ab7182fd1', context: 5, external: '4e473a5b-6477-20b6-84e2-f721685555df', createdMs: T3 + 9 * S, expiresMs: T3 + 86400 * S, deletedMs: null, size: 124638 },
                { key: '15116568751943e94ff764a3d4c183d5', context: 3, external: 'chat_snap.chat_snap-nGJdelEzP6e2A8Di5zMiF', createdMs: T3 - 6 * M + 2 * S, expiresMs: T3 + 14 * 86400 * S, deletedMs: null, size: 79904 },
            ],
            messages: [
                { conversation: CONVERSATION, serverId: 21, createdMs: T3 - 6 * M, readMs: T3 - 5 * M - 40 * S, content: Uint8Array.from([8, 21]), senderId: erikUuid, createdOnDevice: 0, remoteMediaCount: 1, isSaved: 0 },
                { conversation: CONVERSATION, serverId: 22, createdMs: T3 + 12 * S, readMs: T3 + 48 * S, content: Uint8Array.from([8, 22]), senderId: ACCOUNT_UUID, createdOnDevice: 1, remoteMediaCount: 1, isSaved: 0 },
            ],
            notifications: [{ ms: T3 - 6 * M + 1 * S, type: 'snap', category: null }],
            memories: [{ id: MEM_ID, mediaType: 0, front: 1, capturedMs: T3, createdMs: T3 + 1300, width: 1080, height: 1920, duration: 0, hasLocation: 1, latitude: 59.33251, longitude: 18.06412, zone: 'Europe/Stockholm', userAgent: UA }],
            journal: [{ key: 'C025B6FFB844EF85C721AA05B78DA32D.posted_story_snap', timeMs: T3 - 3 * M - 20 * S, size: 975137, path: '/data/data/com.snapchat.android/files/file_manager/posted_story_snap' }],
            sources: {
                cache: { db: 'cache_controller.db', table: 'CACHE_FILE_CLAIM + CACHE_FILE_METADATA', queryId: 'role-cache-window' },
                messages: { db: 'arroyo.db', table: 'conversation_message', queryId: 'role-messages' },
                notifications: { db: 'client_notifications.db', table: 'Notifications', queryId: 'role-notifications' },
                memories: MEMORIES_SRC,
                journal: { db: 'journal.db', table: 'journal_entry + journal', queryId: 'role-journal' },
            },
        };
    }

    function logSource(label, path) {
        return { label: label, path: path, size: 0, mtime: '', crc32: 'påhittad', crcOk: true, sha256: 'påhittad', walPath: '', walCrc32: '', walSha256: '', walSummary: 'Binär fil, ingen WAL.', warnings: [] };
    }
    var ANDROID_SOURCES = [
        dbSource('MediaStore external.db (testdata)', 'data/data/com.android.providers.media.module/databases/external.db', true),
        logSource('usagestats mappings (testdata)', 'data/system_ce/0/usagestats/mappings'),
        logSource('usagestats daily/1717192800000 (testdata)', 'data/system_ce/0/usagestats/daily/1717192800000'),
        logSource('appops discrete/1717247700000tl (testdata)', 'data/system/appops/discrete/1717247700000tl'),
        dbSource('cache_controller.db (Snapchat, testdata)', ANDROID_APP + 'databases/native_content_manager/cache_controller.db', true),
        dbSource('arroyo.db (Snapchat chatt, testdata)', ANDROID_APP + 'databases/arroyo.db', true),
        dbSource('main.db (Snapchat konton, testdata)', ANDROID_APP + 'databases/main.db', true),
        dbSource('client_notifications.db (Snapchat notiser, testdata)', ANDROID_APP + 'databases/client_notifications.db', true),
        dbSource('memories.db (Snapchat Memories, testdata)', ANDROID_APP + 'databases/memories.db', true),
        dbSource('journal.db (Snapchats filhanterare, testdata)', ANDROID_APP + 'databases/journal.db', true),
    ];

    // Telefonens egen logg på Android: usagestats (app, skärm, lås) och appops (kameran per app).
    function androidPhoneLog() {
        var iv = function (start, end, app) { return { startMs: T3 + start, endMs: T3 + end, app: app, stream: 'usagestats', source: USAGESTATS }; };
        var sc = function (start, end, on) { return { startMs: T3 + start, endMs: T3 + end, on: on, stream: 'usagestats', source: USAGESTATS }; };
        var lk = function (start, end, locked) { return { startMs: T3 + start, endMs: T3 + end, locked: locked, stream: 'usagestats', source: USAGESTATS }; };
        var cam = function (start, end, app) { return { startMs: T3 + start, endMs: T3 + end, app: app, source: APPOPS }; };
        return {
            appIntervals: [
                iv(-12 * M - 10 * S, -11 * M - 50 * S, LAUNCHER), iv(-11 * M - 50 * S, -8 * M - 30 * S, ANDROID_SNAP),
                iv(-2 * M - 6 * S, -2 * M - 2 * S, LAUNCHER), iv(-2 * M - 2 * S, 3 * M + 40 * S, ANDROID_SNAP),
                iv(3 * M + 40 * S, 3 * M + 44 * S, LAUNCHER), iv(3 * M + 44 * S, 4 * M + 30 * S, ANDROID_CAMERA), iv(4 * M + 30 * S, 5 * M + 10 * S, LAUNCHER),
            ],
            screen: [sc(-15 * M, -12 * M - 20 * S, false), sc(-12 * M - 20 * S, -8 * M - 20 * S, true), sc(-8 * M - 20 * S, -2 * M - 14 * S, false), sc(-2 * M - 14 * S, 5 * M + 12 * S, true), sc(5 * M + 12 * S, 15 * M, false)],
            lock: [lk(-15 * M, -12 * M - 12 * S, true), lk(-12 * M - 12 * S, -8 * M - 18 * S, false), lk(-8 * M - 18 * S, -2 * M - 8 * S, true), lk(-2 * M - 8 * S, 5 * M + 14 * S, false), lk(5 * M + 14 * S, 15 * M, true)],
            // Kameravyn visas när Snapchat öppnas, igen för selfien (bak- och frontkameran i följd), och Pixel-kameran efteråt.
            cameraUse: [cam(-2 * M + 4 * S, -1 * M - 40 * S, ANDROID_SNAP), cam(-11 * S, -7 * S, ANDROID_SNAP), cam(-7 * S, 5 * S, ANDROID_SNAP), cam(3 * M + 46 * S, 4 * M + 20 * S, ANDROID_CAMERA)],
            androidLog: 'usagestats',
            locations: [],
            coverage: {
                usagestats: { firstMs: T3 - 7 * 86400 * S, lastMs: T3 + 5 * M + 14 * S, rows: 812 },
                appops: { firstMs: T3 - 6 * 86400 * S, lastMs: T3 + 4 * M + 20 * S, rows: 3310 },
            },
            missingDbs: {},
            platform: 'Android',
            snapchatAccount: ACCOUNT_UUID,
            extraction: { name: 'Testdata (påhittad Android-extraktion)', size: 0, lastModified: '' },
            deviceLabel: 'Android 14 (påhittad)',
            sources: ANDROID_SOURCES,
        };
    }

    function androidAsset(pk, name, rel, ms, importer) {
        return { pk: pk, path: '/storage/emulated/0/' + rel + name, filename: name, relativePath: rel, importer: importer, createdMs: ms, addedMs: ms + S, modifiedMs: ms + S, trashed: 0, pending: 0 };
    }

    // deps.snapchat: ProvenanceSnapchat, för Snapchat-händelserna, Memories-kopplingen och journalen.
    function androidScenario(deps) {
        var Snap = deps && deps.snapchat || root.ProvenanceSnapchat;
        var snap = Snap ? Snap.build(androidSnapchatContext()) : { events: [], notes: [], memory: null };
        var added = T3 + S;
        var file = {
            pk: 1000000090, path: '/storage/emulated/0/DCIM/Snapchat/' + SNAP_FILE, filename: SNAP_FILE, relativePath: 'DCIM/Snapchat/', mime: 'image/jpeg', importer: ANDROID_SNAP,
            createdMs: added, createdFrom: 'date_added', addedMs: added, modifiedMs: added, trashed: 0, pending: 0, size: 1131041,
            zoneName: 'Europe/Stockholm', zoneOffset: null, zoneSource: 'Snapchats Memories (time_zone_id)', capturedMs: T3,
            memory: { id: MEM_ID, video: false, front: true, capturedMs: T3, createdMs: T3 + 1300, deltaMs: 300, latitude: 59.33251, longitude: 18.06412, zone: 'Europe/Stockholm', width: 1080, height: 1920, duration: 0, userAgent: UA, source: MEMORIES_SRC },
            _raw: {
                _id: 1000000090, _data: '/storage/emulated/0/DCIM/Snapchat/' + SNAP_FILE, _display_name: SNAP_FILE, relative_path: 'DCIM/Snapchat/', mime_type: 'image/jpeg',
                owner_package_name: ANDROID_SNAP, datetaken: null, date_added: Math.floor(added / 1000), date_modified: Math.floor(added / 1000), is_trashed: 0, is_pending: 0, _size: 1131041,
                'memories_snap._id': MEM_ID, 'memories_snap.snap_capture_time': T3, 'memories_snap.create_time': T3 + 1300, 'memories_snap.front_facing': 1, 'memories_snap.media_type': 0,
                'memories_snap.time_zone_id': 'Europe/Stockholm', 'memories_snap.latitude': 59.33251, 'memories_snap.longitude': 18.06412, 'memories_snap.snap_create_user_agent': UA,
            },
        };
        return Object.assign({
            kind: 'android',
            extraEvents: snap.events,
            extraNotes: ['Telefonens logg över vilken app som använde kameran sparas i cirka sju dagar. Kameran igång betyder att kameravyn visades, inte att en bild togs.'].concat(snap.notes),
            snapchatMemory: snap.memory,
            copies: [],
            note: 'Påhittade testdata: en selfie med Snapchats frontkamera på en Android-telefon, sparad till Memories och galleriet, på samma promenad i Stockholm. Inget kommer från en riktig telefon.',
            file: file,
            fileSource: MEDIASTORE,
            neighbourSource: MS_NEIGHBOURS,
            exif: { read: true, takenMs: null, takenText: '', sourceTag: '', make: '', model: '', software: '', position: null, source: { db: 'bildfilen', table: SNAP_FILE, column: 'EXIF' } },
            exifRows: [
                ['File:FileType', 'JPEG'], ['File:MIMEType', 'image/jpeg'], ['IFD0:ImageWidth', '1080'], ['IFD0:ImageHeight', '1920'], ['IFD0:Orientation', 'Horizontal (normal)'],
                ['ExifIFD:UserComment', uaBase64()],
            ],
            fileEntry: { name: 'data/media/0/DCIM/Snapchat/' + SNAP_FILE, size: 1131041, mtimeMs: added },
            neighbours: [
                androidAsset(1000000085, 'PXL_20240601_123012345.jpg', 'DCIM/Camera/', T3 - 11 * M - 18 * S, ANDROID_CAMERA),
                androidAsset(1000000091, 'Screenshot_20240601-144402.png', 'Pictures/Screenshots/', T3 + 2 * M + 32 * S, SYSTEMUI),
                androidAsset(1000000092, 'PXL_20240601_124545678.jpg', 'DCIM/Camera/', T3 + 4 * M + 15 * S, ANDROID_CAMERA),
            ],
            fileEntryMeta: { path: 'testdata/data/media/0/DCIM/Snapchat/' + SNAP_FILE, size: 1131041, mtime: '2024-06-01 12:41:31 UTC', crc32: 'påhittad', crcOk: true, md5: 'påhittad', sha256: 'påhittad' },
        }, androidPhoneLog());
    }

    var api = { scenario: scenario, snapchatScenario: snapchatScenario, androidScenario: androidScenario, T: T, T2: T2, T3: T3 };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceSample = api;
})(typeof window !== 'undefined' ? window : this);
