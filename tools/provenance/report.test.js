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
        file: { pk: 1, filename: 'IMG_0042.HEIC', directory: 'DCIM/100APPLE', createdMs: T, addedMs: T + 300, modifiedMs: T + 300, importedBy: 1, importer: 'com.apple.camera', zoneName: 'Europe/Stockholm', zoneOffset: 7200, cameraMake: 'Apple', cameraModel: 'iPhone 13' },
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
};

test('protokollet innehåller källor, hashar, sökvägar, kolumnnamn, query-id, SQL och bilden', () => {
    const html = report.protocol(model(), META);
    for (const needle of [SHA, 'b'.repeat(64), 'deadbeef', 'filesystem1/private/var/mobile/Media/DCIM/100APPLE/IMG_0042.HEIC', 'ZDATECREATED', 'role-app-usage', "ZSTREAMNAME = '/app/usage'",
        '12 av 12 ramar', 'utan -wal', 'knowledgeC.db → ZOBJECT /app/usage → ZSTARTDATE, ZENDDATE, ZVALUESTRING', 'data:image/png;base64,AAAA', 'Europe/Stockholm', '2025-09-24 14:31:09', '2025-09-24 12:31:09 UTC',
        'Kamerabild', 'ZIMPORTEDBY 1', 'Stöd', 'Alternativa förklaringar', 'Strömmarnas täckning', 'iOS 26.0', 'Forensics Toolbox 1.26']) {
        assert.ok(html.includes(needle), 'protokollet saknar: ' + needle);
    }
    assert.match(html, /<table style="border-collapse: collapse/);
    assert.match(html, /<h1 style=/);
    assert.ok(!/<script/i.test(html));
});

test('förklaringen har samma fakta i klartext och inget tekniskt', () => {
    const html = report.explanation(model(), META);
    for (const needle of ['Kamera öppnas', 'Bilden IMG_0042.HEIC tas med kameran', 'Kamera lämnas', 'Skärmen tänds', '14:30:49', 'Vad det betyder', 'kamerabild', 'förenligt med att bilden togs', 'Europe/Stockholm',
        'utan sin senaste loggfil', 'data:image/png;base64,AAAA', 'säger inte vem som höll i telefonen']) {
        assert.ok(html.includes(needle), 'förklaringen saknar: ' + needle);
    }
    for (const forbidden of [SHA, 'deadbeef', 'filesystem1', 'ZDATECREATED', 'ZOBJECT', 'role-', 'com.apple', 'SELECT', 'CRC', 'SHA', '/app/usage', 'ZIMPORTEDBY']) {
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
