// Protokollet innehåller allt: hashar, sökvägar, kolumnnamn, query-id och SQL. Förklaringen
// innehåller inget av det, men samma fakta i vanlig svenska.

const test = require('node:test');
const assert = require('node:assert');
const core = require('./timeline-core');
const report = require('./report');

const T = Date.UTC(2025, 8, 24, 12, 31, 9);
const S = 1000;
const KC = { db: 'knowledgeC.db', table: 'ZOBJECT', stream: '/app/usage', column: 'ZSTARTDATE, ZENDDATE, ZVALUESTRING', queryId: 'role-app-usage' };
const SHA = 'a'.repeat(64);

function model(over) {
    return core.build(Object.assign({
        platform: 'iOS', appNames: (id) => ({ 'com.apple.camera': 'Kamera' }[id] || null), cameraApps: ['com.apple.camera'],
        file: { pk: 1, filename: 'IMG_0042.HEIC', directory: 'DCIM/100APPLE', createdMs: T, addedMs: T + 300, modifiedMs: T + 300, importedBy: 1, importer: 'com.apple.camera', zoneName: 'Europe/Stockholm', zoneOffset: 7200, cameraMake: 'Apple', cameraModel: 'iPhone 13', latitude: 59.33255, longitude: 18.064 },
        locations: [{ ms: T - 40 * S, lat: 59.33258, lon: 18.06398, accuracy: 8, type: 1, source: { db: 'Cache.sqlite', table: 'ZRTCLLOCATIONMO', column: 'ZTIMESTAMP, ZLATITUDE, ZLONGITUDE', queryId: 'role-location' } }],
        fileSource: { db: 'Photos.sqlite', table: 'ZASSET', column: 'ZDATECREATED', queryId: 'role-file' },
        appIntervals: [{ startMs: T - 20 * S, endMs: T + 12 * S, app: 'com.apple.camera', stream: '/app/usage', source: KC }],
        screen: [{ startMs: T - 60 * S, endMs: T + 60 * S, on: true, stream: '/display/isBacklit', source: Object.assign({}, KC, { stream: '/display/isBacklit', queryId: 'role-screen' }) }],
        exif: { read: true, takenMs: T, takenText: '2025-09-24 14:31:09 +02:00', make: 'Apple', model: 'iPhone 13' },
    }, over || {}));
}

const META = {
    extraction: { name: 'EXTRACTION_FFS.zip', size: 23630000000, lastModified: '2026-03-05T08:30:32.000Z' },
    deviceLabel: 'iOS 26.0', zoneLabel: 'Europe/Stockholm', zoneNote: 'ur bildens ZTIMEZONENAME', toolVersion: '1.26', createdText: '2026-10-29 10:00',
    format: (ms) => core.formatWithOffset(ms, 120), formatUtc: core.formatUtc,
    fileRows: [['ZFILENAME', 'IMG_0042.HEIC'], ['ZIMPORTEDBYBUNDLEIDENTIFIER', 'com.apple.camera']],
    exifRows: [['ExifIFD:DateTimeOriginal', '2025:09:24 14:31:09']],
    fileEntry: { path: 'filesystem1/private/var/mobile/Media/DCIM/100APPLE/IMG_0042.HEIC', size: 2000000, mtime: '2025-09-24 12:31:10 UTC', crc32: 'deadbeef', sha256: SHA },
    sources: [
        { label: 'Photos.sqlite', path: 'filesystem1/private/var/mobile/Media/PhotoData/Photos.sqlite', size: 100, mtime: 'x', crc32: '00000001', sha256: SHA, walPath: 'filesystem1/private/var/mobile/Media/PhotoData/Photos.sqlite-wal', walCrc32: '00000002', walSha256: 'b'.repeat(64), walSummary: '-wal: 12 av 12 ramar lades på (3 commit, 10 sidor).', warnings: [] },
        { label: 'knowledgeC.db', path: 'filesystem1/private/var/mobile/Library/CoreDuet/Knowledge/knowledgeC.db', size: 100, mtime: 'x', crc32: '00000003', sha256: 'c'.repeat(64), walSummary: 'Utan -wal.', warnings: ['knowledgeC.db lästes utan -wal: extraktionen har ingen. Poster som bara fanns i -wal kan saknas.'] },
    ],
    queries: [{ id: 'role-app-usage', db: 'knowledgeC.db', title: 'Härkomst: /app/usage i tidsfönstret', sql: "SELECT ZSTARTDATE FROM ZOBJECT WHERE ZSTREAMNAME = '/app/usage'" }],
    coverage: [['/app/usage', '2025-09-04 00:00:00 UTC', '2025-10-01 00:00:00 UTC', 65]],
    timelinePngs: ['data:image/png;base64,AAAA'],
    closeupPngs: ['data:image/png;base64,CCCC'],
    mapPng: 'data:image/png;base64,BBBB',
};

test('protokollet innehåller källor, hashar, sökvägar, kolumnnamn, query-id, SQL och bilden', () => {
    const html = report.protocol(model(), META);
    for (const needle of [SHA, 'b'.repeat(64), 'deadbeef', 'filesystem1/private/var/mobile/Media/DCIM/100APPLE/IMG_0042.HEIC', 'ZDATECREATED', 'role-app-usage', "ZSTREAMNAME = '/app/usage'",
        '12 av 12 ramar', 'utan -wal', 'knowledgeC.db → ZOBJECT /app/usage → ZSTARTDATE, ZENDDATE, ZVALUESTRING', 'data:image/png;base64,AAAA', 'Europe/Stockholm', '2025-09-24 14:31:09', '2025-09-24 12:31:09 UTC',
        'Kamerabild', 'ZIMPORTEDBY 1', 'Stöd', 'Alternativa förklaringar', 'Strömmarnas täckning', 'iOS 26.0', 'Forensics Toolbox 1.26',
        '2. Underlag för bedömning', 'Den slutliga bedömningen gör undersökaren', 'Programmets sammanvägning:', 'Undersökarens bedömning', 'Ej ifylld.', 'data:image/png;base64,CCCC', 'Närbild:',
        '4. Positioner', 'Bilden enligt databasen', 'Telefonen (GNSS)', '59.332550', 'Cache.sqlite → ZRTCLLOCATIONMO → ZTIMESTAMP, ZLATITUDE, ZLONGITUDE', 'role-location', 'data:image/png;base64,BBBB', 'ZLATITUDE, ZLONGITUDE']) {
        assert.ok(html.includes(needle), 'protokollet saknar: ' + needle);
    }
    assert.match(html, /<table style="border-collapse: collapse/);
    assert.match(html, /<h1 style=/);
    assert.ok(!/<script/i.test(html));
});

test('förklaringen har samma fakta i klartext och inget tekniskt', () => {
    const html = report.explanation(model(), META);
    for (const needle of ['Kamera öppnas', 'Bilden IMG_0042.HEIC tas med kameran', 'Kamera lämnas', 'Skärmen tänds', '14:30:49', 'Vad det betyder', 'kamerabild', 'förenligt med att bilden togs', 'Europe/Stockholm',
        'utan sin senaste loggfil', 'data:image/png;base64,AAAA', 'säger inte vem som höll i telefonen', 'Var telefonen var', 'data:image/png;base64,BBBB', 'Telefonen var på samma plats som bilden togs',
        'Den slutliga bedömningen gör undersökaren', 'Programmets sammanvägning:', 'Undersökarens bedömning', 'Ej ifylld.', 'data:image/png;base64,CCCC', 'Närbild på tiden närmast bilden']) {
        assert.ok(html.includes(needle), 'förklaringen saknar: ' + needle);
    }
    for (const forbidden of [SHA, 'deadbeef', 'filesystem1', 'ZDATECREATED', 'ZOBJECT', 'role-', 'com.apple', 'SELECT', 'CRC', 'SHA', '/app/usage', 'ZIMPORTEDBY', 'ZLATITUDE', '59.33']) {
        assert.ok(!html.includes(forbidden), 'förklaringen innehåller ' + forbidden);
    }
});

test('förklaringen utan -wal-varning nämner inte loggfilen, och två fönster får två rubriker', () => {
    const meta = Object.assign({}, META, { sources: [META.sources[0]], timelinePngs: [] });
    const m = model({ appNames: (id) => ({ 'net.whatsapp.WhatsApp': 'WhatsApp' }[id] || null), file: { pk: 1, filename: 'IMG_1.JPG', createdMs: T, addedMs: T + 3 * 86400 * S, importedBy: 3, importer: 'net.whatsapp.WhatsApp' }, exif: null, appIntervals: [], screen: [] });
    const html = report.explanation(m, meta);
    assert.ok(!html.includes('loggfil'));
    assert.match(html, /1\. När filen skapades, 2025-09-24/);
    assert.match(html, /2\. När filen kom till telefonen, 2025-09-27/);
    assert.ok(!html.includes('net.whatsapp'));
    assert.ok(html.includes('WhatsApp'));
});

test('ren text och fristående fil', () => {
    const html = report.explanation(model(), META);
    const text = report.plainText(html);
    assert.ok(text.includes('Kamera öppnas'));
    assert.ok(!/<[a-z]/.test(text));
    assert.ok(text.includes('[tidslinje]'));
    const file = report.standalone('Härkomst', html);
    assert.match(file, /^<!DOCTYPE html>\n<html lang="sv"><head><meta charset="utf-8"><title>Härkomst<\/title>/);
});

test('undersökarens egen bedömning skrivs ut i båda exporterna, och utan närbild saknas bara den bilden', () => {
    const meta = Object.assign({}, META, { ownAssessment: 'Jag bedömer att bilden togs med telefonen. Kontrollerat mot knowledgeC 2026-10-30.', closeupPngs: [] });
    const p = report.protocol(model(), meta);
    const e = report.explanation(model(), meta);
    for (const html of [p, e]) {
        assert.ok(html.includes('Kontrollerat mot knowledgeC 2026-10-30.'));
        assert.ok(!html.includes('Ej ifylld'));
        assert.ok(!html.includes('CCCC'));
        assert.ok(html.indexOf('Undersökarens bedömning') > html.indexOf('Programmets sammanvägning'), 'undersökarens text kommer efter programmets');
    }
    assert.ok(e.indexOf('Undersökarens bedömning') > e.indexOf('Den slutliga bedömningen gör undersökaren'));
});

test('undersökarens bockar per faktor skrivs ut med klockslag i protokollet och som en mening i förklaringen', () => {
    const at = Date.UTC(2026, 9, 30, 7, 15, 0);
    const meta = Object.assign({}, META, { checks: { time: at, camera: at + 60000 } });
    const p = report.protocol(model(), meta);
    assert.ok(p.includes('<b>Undersökarens kontroll:</b> kontrollerad 2026-10-30 09:15:00'));
    assert.ok(p.includes('<b>Undersökarens kontroll:</b> ej kontrollerad'));
    assert.strictEqual((p.match(/Undersökarens kontroll:/g) || []).length, 5);
    assert.ok(p.includes('Undersökaren har kontrollerat 2 av 5 faktorer mot källorna: Skapandetid, Kamera igång.'));
    const e = report.explanation(model(), meta);
    assert.ok(e.includes('Undersökaren har kontrollerat 2 av 5 faktorer mot källorna: Skapandetid, Kamera igång.'));
    const none = report.explanation(model(), META);
    assert.ok(!none.includes('har kontrollerat'), 'utan bockar sägs inget i förklaringen');
    assert.ok(report.protocol(model(), META).includes('Undersökaren har kontrollerat 0 av 5 faktorer mot källorna.'));
});

test('MD5, telefonens tumnagel och bilden: protokollet får allt, förklaringen bara bilden, och bara när den begärts', () => {
    const meta = Object.assign({}, META, {
        fileEntry: Object.assign({}, META.fileEntry, { md5: 'd'.repeat(32) }),
        thumbnail: { path: 'filesystem1/private/var/mobile/Media/PhotoData/Thumbnails/V2/DCIM/100APPLE/IMG_0042.HEIC/5005.JPG', size: 48213, crc32: 'cafe0001', sha256: 'e'.repeat(64) },
        previewPng: 'data:image/jpeg;base64,PPPP', previewNote: 'Telefonens egen miniatyr av bilden.',
    });
    const p = report.protocol(model(), meta);
    for (const needle of ['MD5 ' + 'd'.repeat(32), 'Telefonens egen tumnagel i zippen', 'Thumbnails/V2/DCIM/100APPLE/IMG_0042.HEIC/5005.JPG', '48213 byte', 'cafe0001', 'e'.repeat(64), 'data:image/jpeg;base64,PPPP', 'Telefonens egen miniatyr av bilden.', 'max-width: 360px']) {
        assert.ok(p.includes(needle), 'protokollet saknar: ' + needle);
    }
    assert.ok(p.indexOf('data:image/jpeg;base64,PPPP') < p.indexOf('2. Underlag för bedömning'), 'bilden står under 1. Filen');
    const e = report.explanation(model(), meta);
    assert.ok(e.includes('data:image/jpeg;base64,PPPP') && e.includes('Telefonens egen miniatyr av bilden.'));
    assert.ok(e.indexOf('data:image/jpeg;base64,PPPP') < e.indexOf('data:image/png;base64,AAAA'), 'bilden kommer före tidslinjen');
    for (const forbidden of ['Thumbnails', 'MD5', 'd'.repeat(32), 'e'.repeat(64), '5005.JPG']) assert.ok(!e.includes(forbidden), 'förklaringen innehåller ' + forbidden);
    assert.ok(report.plainText(e).includes('[bilden]'));
    // Utan begäran: ingen bild, men hashar och tumnagelns sökväg står kvar i protokollet.
    const quiet = Object.assign({}, meta, { previewPng: null });
    assert.ok(!report.protocol(model(), quiet).includes('PPPP') && !report.explanation(model(), quiet).includes('PPPP'));
    assert.ok(report.protocol(model(), quiet).includes('5005.JPG'));
    assert.ok(!report.explanation(model(), quiet).includes('[bilden]'));
});
