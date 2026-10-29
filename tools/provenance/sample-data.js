// Testdata för Härkomst: samma påhittade promenad i Stockholm 1 juni 2024 som i EXIF & karta.
// Anna tar IMG_4104.JPG vid Sergels torg mitt i en Snapchat-session. Raderna är påhittade
// men har samma form som rollqueryernas rader, så hela flödet går att prova utan extraktion.
(function (root) {
    'use strict';

    var COCOA = 978307200;
    var T = Date.UTC(2024, 5, 1, 12, 31, 30);   // 14:31:30 i Europe/Stockholm
    var S = 1000;
    var M = 60 * S;

    var KC = function (stream, cols, queryId) { return { db: 'knowledgeC.db', table: 'ZOBJECT', stream: stream, column: cols, queryId: queryId }; };
    var USAGE = KC('/app/usage', 'ZSTARTDATE, ZENDDATE, ZVALUESTRING', 'role-app-usage');
    var SCREEN = KC('/display/isBacklit', 'ZSTARTDATE, ZENDDATE, ZVALUEINTEGER', 'role-screen');
    var LOCK = KC('/device/isLocked', 'ZSTARTDATE, ZENDDATE, ZVALUEINTEGER', 'role-lock');
    var PHOTOS = { db: 'Photos.sqlite', table: 'ZASSET', column: 'ZDATECREATED', queryId: 'role-file' };
    var ROUTINED = { db: 'Cache.sqlite', table: 'ZRTCLLOCATIONMO', column: 'ZTIMESTAMP, ZLATITUDE, ZLONGITUDE', queryId: 'role-location' };

    function cocoa(ms) { return Math.round(ms / 10) / 100 - COCOA; }

    function asset(pk, name, ms, importer, importedBy, kindSubtype) {
        return {
            pk: pk, directory: 'DCIM/100APPLE', filename: name, originalFilename: name,
            createdMs: ms, addedMs: ms + 300, modifiedMs: ms + 300, importedBy: importedBy, importer: importer,
            kindSubtype: kindSubtype || 0, trashed: 0,
        };
    }

    function scenario() {
        var file = asset(4104, 'IMG_4104.JPG', T, 'com.apple.camera', 1, 0);
        Object.assign(file, {
            exifTime: '2024:06:01 14:31:30', zoneName: 'Europe/Stockholm', zoneOffset: 7200, editor: null, savedAssetType: 3,
            kind: 0, uti: 'public.jpeg', hidden: 0, cloudLocalState: 0, latitude: 59.33255, longitude: 18.064,
            cameraMake: 'Apple', cameraModel: 'iPhone 15 Pro',
        });
        file._raw = {
            Z_PK: 4104, ZDIRECTORY: 'DCIM/100APPLE', ZFILENAME: 'IMG_4104.JPG', ZORIGINALFILENAME: 'IMG_4104.JPG',
            ZDATECREATED: cocoa(T), ZADDEDDATE: cocoa(T + 300), ZMODIFICATIONDATE: cocoa(T + 300),
            ZEXIFTIMESTAMPSTRING: '2024:06:01 14:31:30', ZTIMEZONENAME: 'Europe/Stockholm', ZTIMEZONEOFFSET: 7200,
            ZIMPORTEDBY: 1, ZIMPORTEDBYBUNDLEIDENTIFIER: 'com.apple.camera', ZIMPORTEDBYDISPLAYNAME: 'Kamera', ZEDITORBUNDLEID: null,
            ZSAVEDASSETTYPE: 3, ZKIND: 0, ZKINDSUBTYPE: 0, ZUNIFORMTYPEIDENTIFIER: 'public.jpeg', ZTRASHEDSTATE: 0, ZHIDDEN: 0, ZCLOUDLOCALSTATE: 0,
            ZLATITUDE: 59.33255, ZLONGITUDE: 18.064, ZCAMERAMAKE: 'Apple', ZCAMERAMODEL: 'iPhone 15 Pro',
        };

        var snapchat = 'com.toyopagroup.picaboo';
        var camera = 'com.apple.camera';
        var photosApp = 'com.apple.mobileslideshow';
        var iv = function (start, end, app) { return { startMs: T + start, endMs: T + end, app: app, stream: '/app/usage', source: USAGE }; };

        return {
            platform: 'iOS',
            note: 'Påhittade testdata: samma promenad i Stockholm som i EXIF & karta. Inget kommer från en riktig telefon.',
            file: file,
            fileSource: PHOTOS,
            neighbourSource: { db: 'Photos.sqlite', table: 'ZASSET', column: 'ZDATECREATED', queryId: 'role-neighbours' },
            locationSource: ROUTINED,
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
                asset(4103, 'IMG_4103.JPG', T - 12 * M - 25 * S, camera, 1, 0),
                asset(4105, 'IMG_4105.JPG', T + 33 * M + 32 * S, camera, 1, 0),
                asset(4113, 'IMG_4113.PNG', T + 4 * M + 12 * S, 'com.apple.springboard', 8, 10),
            ],
            appIntervals: [
                iv(-11 * M - 28 * S, -8 * M - 50 * S, snapchat),
                iv(-1 * M - 55 * S, -32 * S, snapchat),
                iv(-31 * S, 24 * S, camera),
                iv(26 * S, 3 * M + 48 * S, snapchat),
                iv(4 * M + 2 * S, 4 * M + 20 * S, 'com.apple.springboard'),
                iv(4 * M + 31 * S, 5 * M + 46 * S, photosApp),
                iv(5 * M + 46 * S, 9 * M + 10 * S, snapchat),
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
            extraction: { name: 'Testdata (påhittad extraktion)', size: 0, lastModified: '' },
            deviceLabel: 'iOS 17.5.1 (påhittad)',
            sources: [
                { label: 'Photos.sqlite (testdata)', path: 'testdata/private/var/mobile/Media/PhotoData/Photos.sqlite', size: 0, mtime: '', crc32: 'påhittad', crcOk: true, sha256: 'påhittad', walPath: 'testdata/private/var/mobile/Media/PhotoData/Photos.sqlite-wal', walCrc32: 'påhittad', walSha256: 'påhittad', walSummary: '-wal: påhittad testdata.', warnings: [] },
                { label: 'knowledgeC.db (testdata)', path: 'testdata/private/var/mobile/Library/CoreDuet/Knowledge/knowledgeC.db', size: 0, mtime: '', crc32: 'påhittad', crcOk: true, sha256: 'påhittad', walPath: 'testdata/private/var/mobile/Library/CoreDuet/Knowledge/knowledgeC.db-wal', walCrc32: 'påhittad', walSha256: 'påhittad', walSummary: '-wal: påhittad testdata.', warnings: [] },
                { label: 'Cache.sqlite (routined, testdata)', path: 'testdata/private/var/mobile/Library/Caches/com.apple.routined/Cache.sqlite', size: 0, mtime: '', crc32: 'påhittad', crcOk: true, sha256: 'påhittad', walPath: '', walCrc32: '', walSha256: '', walSummary: '-wal: påhittad testdata.', warnings: [] },
            ],
            fileEntryMeta: { path: 'testdata/private/var/mobile/Media/DCIM/100APPLE/IMG_4104.JPG', size: 2437118, mtime: '2024-06-01 12:31:31 UTC', crc32: 'påhittad', crcOk: true, sha256: 'påhittad' },
        };
    }

    var api = { scenario: scenario, T: T };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceSample = api;
})(typeof window !== 'undefined' ? window : this);
