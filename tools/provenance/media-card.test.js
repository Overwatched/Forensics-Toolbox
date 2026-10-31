// Filkortet: filtyp, iOS tumnagelsökväg, vad som visas, kortets rader, tidsökningens klockslag i en zon.

const test = require('node:test');
const assert = require('node:assert');
const media = require('./media-card');

test('filtypen avgörs av ändelsen, skiftlägesokänsligt', () => {
    assert.strictEqual(media.kindOf('DCIM/100APPLE/IMG_0042.JPG'), 'image');
    assert.strictEqual(media.kindOf('IMG_0042.png'), 'image');
    assert.strictEqual(media.kindOf('IMG_0042.HEIC'), 'heic');
    assert.strictEqual(media.kindOf('IMG_0042.MOV'), 'video');
    assert.strictEqual(media.kindOf('clip.mp4'), 'video');
    assert.strictEqual(media.kindOf('e4d2c0b8a6948271605f3e1d2c3b4a59'), null, 'Snapchats cachefiler saknar ändelse');
    assert.strictEqual(media.mimeOf('a/b.HEIC'), 'image/heic');
    assert.strictEqual(media.mimeOf('a/b.mov'), 'video/quicktime');
});

test('iOS egen tumnagel ligger under Thumbnails/V2 med bildens mapp och namn', () => {
    assert.strictEqual(media.thumbnailSuffix('iOS', { directory: 'DCIM/100APPLE', filename: 'IMG_0049.HEIC' }), 'PhotoData/Thumbnails/V2/DCIM/100APPLE/IMG_0049.HEIC/5005.JPG');
    assert.strictEqual(media.thumbnailSuffix('iOS', { directory: 'PhotoData/CPLAssets/group5', filename: 'X.HEIC' }), 'PhotoData/Thumbnails/V2/PhotoData/CPLAssets/group5/X.HEIC/5005.JPG');
    assert.strictEqual(media.thumbnailSuffix('Android', { directory: 'DCIM/Camera', filename: 'a.jpg' }), null);
    assert.strictEqual(media.thumbnailSuffix('iOS', { filename: 'a.jpg' }), null);
    const keep = media.suffixKeeper(['PhotoData/Thumbnails/V2/DCIM/100APPLE/IMG_0049.HEIC/5005.JPG']);
    assert.ok(keep('private/var/mobile/Media/PhotoData/Thumbnails/V2/DCIM/100APPLE/IMG_0049.HEIC/5005.JPG'));
    assert.ok(keep('private/var/mobile/Media/photodata/thumbnails/v2/dcim/100apple/img_0049.heic/5005.jpg'), 'skiftläge');
    assert.ok(!keep('private/var/mobile/Media/PhotoData/Thumbnails/V2/DCIM/100APPLE/IMG_0049.HEIC/5003.JPG'));
    assert.ok(!keep('x/Thumbnails/V2/DCIM/100APPLE/IMG_0049.HEIC/5005.JPG'), 'hela sökvägen måste stämma');
    const pick = media.pickBySuffix([{ name: 'filesystem2-backup/private/var/mobile/Media/DCIM/100APPLE/IMG_1.JPG' }, { name: 'filesystem1/private/var/mobile/Media/DCIM/100APPLE/IMG_1.JPG' }, { name: 'other/IMG_1.JPG' }], 'Media/DCIM/100APPLE/IMG_1.JPG');
    assert.strictEqual(pick.name, 'filesystem1/private/var/mobile/Media/DCIM/100APPLE/IMG_1.JPG', 'den kortaste träffen');
    assert.strictEqual(media.pickBySuffix([{ name: 'a/xIMG_1.JPG' }], 'IMG_1.JPG'), null, 'ingen träff mitt i ett namn');
});

test('vad som visas: originalet för JPEG, tumnageln för HEIC och video, annars skälet', () => {
    assert.deepStrictEqual(media.previewPlan({ name: 'IMG_1.JPG', size: 2e6, hasBytes: true, thumb: true, maxBytes: 20e6 }).source, 'original');
    assert.strictEqual(media.previewPlan({ name: 'IMG_1.JPG', size: 50e6, hasBytes: true, thumb: true, maxBytes: 20e6 }).source, 'thumbnail', 'stor JPEG: tumnageln');
    assert.strictEqual(media.previewPlan({ name: 'IMG_1.JPG', size: 50e6, hasBytes: true, thumb: false, maxBytes: 20e6 }).source, 'original', 'stor JPEG utan tumnagel visas ändå');
    const heic = media.previewPlan({ name: 'IMG_1.HEIC', size: 2e6, hasBytes: true, thumb: true, maxBytes: 20e6 });
    assert.strictEqual(heic.source, 'thumbnail');
    assert.strictEqual(heic.note, 'Telefonens egen miniatyr av bilden.');
    const mov = media.previewPlan({ name: 'IMG_1.MOV', size: 2e6, hasBytes: true, thumb: true, maxBytes: 20e6 });
    assert.strictEqual(mov.source, 'thumbnail');
    assert.strictEqual(mov.note, 'Telefonens egen miniatyr av videon.');
    assert.strictEqual(media.previewPlan({ name: 'clip.mp4', size: 2e6, hasBytes: true, thumb: false, maxBytes: 20e6 }).source, 'video');
    assert.strictEqual(media.previewPlan({ name: 'IMG_1.MOV', size: 2e6, hasBytes: true, thumb: false, maxBytes: 20e6 }).source, 'none', 'MOV utan tumnagel: inget');
    const none = media.previewPlan({ name: 'IMG_1.HEIC', size: 2e6, hasBytes: true, thumb: false, maxBytes: 20e6 });
    assert.strictEqual(none.source, 'none');
    assert.match(none.note, /HEIC/);
    assert.match(media.previewPlan({ name: 'IMG_1.JPG', size: 2e6, hasBytes: false, thumb: false }).note, /lästes inte/);
    assert.match(media.previewPlan({ name: 'e4d2c0b8', size: 100, hasBytes: true, thumb: false }).note, /kan inte visas/);
});

test('kortets rader: namn, sökväg, storlek, hashar och ett urval EXIF', () => {
    const exif = [['ExifIFD:DateTimeOriginal', '2024:06:01 14:31:30'], ['ExifIFD:OffsetTimeOriginal', '+02:00'], ['IFD0:Make', 'Apple'], ['IFD0:Model', 'iPhone 15 Pro'], ['IFD0:Software', '17.5.1'],
        ['File:MIMEType', 'image/jpeg'], ['File:ImageWidth', '4032'], ['File:ImageHeight', '3024'], ['Composite:GPSLatitude', '59 deg 19\' 57.18" N'], ['Composite:GPSLongitude', '18 deg 3\' 50.40" E'], ['ExifIFD:LensModel', 'iPhone 15 Pro back camera']];
    const rows = media.cardRows({ path: 'fs/private/var/mobile/Media/DCIM/100APPLE/IMG_4104.JPG', size: 2437118, mtime: '2024-06-01 12:31:31 UTC', crc32: 'deadbeef', crcOk: true, md5: 'm'.repeat(32), sha256: 's'.repeat(64) }, exif, { sizeText: (b) => (b / 1048576).toFixed(1) + ' MB' });
    const obj = Object.fromEntries(rows);
    assert.strictEqual(obj.Filnamn, 'IMG_4104.JPG');
    assert.strictEqual(obj.Storlek, '2.3 MB (2437118 byte)');
    assert.strictEqual(obj.MD5, 'm'.repeat(32));
    assert.strictEqual(obj['SHA-256'], 's'.repeat(64));
    assert.strictEqual(obj['Tagen (EXIF)'], '2024:06:01 14:31:30');
    assert.strictEqual(obj['Tidszon (EXIF)'], '+02:00');
    assert.strictEqual(obj.Kamera, 'Apple iPhone 15 Pro');
    assert.strictEqual(obj.Objektiv, 'iPhone 15 Pro back camera');
    assert.strictEqual(obj.Mått, '4032 × 3024');
    assert.strictEqual(obj.Filtyp, 'image/jpeg');
    assert.strictEqual(obj['Position (EXIF)'], '59 deg 19\' 57.18" N, 18 deg 3\' 50.40" E');
    assert.deepStrictEqual(rows.map((r) => r[0]).slice(0, 7), ['Filnamn', 'Sökväg i zippen', 'Storlek', 'Ändrad enligt zippen', 'CRC32', 'MD5', 'SHA-256']);
    const bare = media.cardRows({ path: 'a/b.mp4', size: 10, mtime: '', crc32: '00000001', crcOk: false }, [], {});
    assert.strictEqual(Object.fromEntries(bare).CRC32, '00000001 (stämmer inte med zippen)');
    assert.strictEqual(Object.fromEntries(bare).MD5, 'inte beräknad');
    assert.deepStrictEqual(media.cardRows(null, [], {}), []);
    assert.deepStrictEqual(media.exifSummary([['QuickTime:CreateDate', '2024:06:01 12:38:16'], ['QuickTime:ImageWidth', '1080'], ['QuickTime:ImageHeight', '1920']]), [['Tagen (EXIF)', '2024:06:01 12:38:16'], ['Mått', '1080 × 1920']]);
});

test('tidsökningen: klockslag i en zon blir UTC, även över sommartid och med fast förskjutning', () => {
    const p = media.parseLocal('2024-06-01T14:31');
    assert.deepStrictEqual(p, { y: 2024, mo: 6, d: 1, h: 14, mi: 31, s: 0, dateOnly: false });
    assert.deepStrictEqual(media.parseLocal('2024-06-01 14:31:30').s, 30);
    assert.strictEqual(media.parseLocal('2024-13-01T14:31'), null);
    assert.strictEqual(media.parseLocal(''), null);
    assert.strictEqual(media.toUtcMs(media.parseLocal('2024-06-01T14:31:30'), { name: 'Europe/Stockholm' }), Date.UTC(2024, 5, 1, 12, 31, 30), 'sommartid +02:00');
    assert.strictEqual(media.toUtcMs(media.parseLocal('2024-01-15T14:31:30'), { name: 'Europe/Stockholm' }), Date.UTC(2024, 0, 15, 13, 31, 30), 'normaltid +01:00');
    assert.strictEqual(media.toUtcMs(media.parseLocal('2024-06-01T14:31:30'), { name: 'UTC' }), Date.UTC(2024, 5, 1, 14, 31, 30));
    assert.strictEqual(media.toUtcMs(media.parseLocal('2024-06-01T14:31:30'), { offsetMinutes: 120 }), Date.UTC(2024, 5, 1, 12, 31, 30), 'fast förskjutning');
    assert.strictEqual(media.toUtcMs(media.parseLocal('2024-06-01T14:31:30'), { name: 'Nowhere/Nope', offsetMinutes: 60 }), Date.UTC(2024, 5, 1, 13, 31, 30), 'okänd zon: förskjutningen');
    assert.strictEqual(media.zoneOffsetAt('Europe/Stockholm', Date.UTC(2024, 5, 1, 12, 0, 0)), 120);
    assert.strictEqual(media.zoneOffsetAt('America/New_York', Date.UTC(2024, 0, 15, 12, 0, 0)), -300);
    assert.strictEqual(media.toUtcMs(null, {}), null);
});

test('tidsökningen: svensk skrivning med eller utan klockslag, bara ett datum ger hela dygnet i zonen', () => {
    assert.deepStrictEqual(media.parseLocal('2026-10-31'), { y: 2026, mo: 10, d: 31, h: 0, mi: 0, s: 0, dateOnly: true }, 'bara datum');
    assert.deepStrictEqual(media.parseLocal(' 2026-10-31 14.30 '), { y: 2026, mo: 10, d: 31, h: 14, mi: 30, s: 0, dateOnly: false }, 'punkt som avskiljare');
    assert.deepStrictEqual(media.parseLocal('2026-10-31 kl. 9:05:07').h, 9, 'kl. och timme utan nolla');
    assert.strictEqual(media.parseLocal('2026-10-31 kl 23.59.59').s, 59);
    assert.strictEqual(media.parseLocal('10/31/2026 2:30 PM'), null, 'amerikansk ordning avvisas');
    assert.strictEqual(media.parseLocal('31.10.2026'), null);
    assert.strictEqual(media.parseLocal('2026-02-30'), null, 'datum som inte finns');
    assert.strictEqual(media.parseLocal('2026-10-31 24:00'), null);
    assert.strictEqual(media.parseLocal('2026-10-31 14'), null, 'timme utan minuter');
    // Två fält: klockslaget får vara tomt, eller stå i datumfältet.
    assert.strictEqual(media.parseWhen('2026-10-31', '').dateOnly, true);
    assert.strictEqual(media.parseWhen('2026-10-31', '14:30').dateOnly, false);
    assert.strictEqual(media.parseWhen('2026-10-31 14:30', '').mi, 30);
    assert.strictEqual(media.parseWhen('', '14:30'), null, 'klockslag utan datum');
    assert.strictEqual(media.parseWhen('2026-10-31', 'eftermiddag'), null);
    assert.strictEqual(media.dateText(media.parseLocal('2026-01-05')), '2026-01-05');
    assert.strictEqual(media.timeText(media.parseLocal('2026-01-05 9:05')), '09:05:00');
    // Hela dygnet i zonen, också när sommartiden slår om (23 respektive 25 timmar).
    const day = media.dayRange(media.parseLocal('2026-10-31'), { name: 'Europe/Stockholm' });
    assert.strictEqual(day.startMs, Date.UTC(2026, 9, 30, 23, 0, 0), 'normaltid: dygnet börjar 23:00 UTC kvällen före');
    assert.strictEqual(day.endMs, Date.UTC(2026, 9, 31, 23, 0, 0) - 1);
    const spring = media.dayRange(media.parseLocal('2026-03-29'), { name: 'Europe/Stockholm' });
    assert.strictEqual(spring.endMs - spring.startMs + 1, 23 * 3600000, 'omställningsdygnet i mars är 23 timmar');
    const autumn = media.dayRange(media.parseLocal('2026-10-25'), { name: 'Europe/Stockholm' });
    assert.strictEqual(autumn.endMs - autumn.startMs + 1, 25 * 3600000, 'omställningsdygnet i oktober är 25 timmar');
    const utc = media.dayRange(media.parseLocal('2026-10-31'), { name: 'UTC' });
    assert.strictEqual(utc.startMs, Date.UTC(2026, 9, 31));
    assert.strictEqual(media.dayRange(null, {}), null);
});

test('träffarna sorteras närmast tidpunkten först och avståndet skrivs i klartext', () => {
    const T = Date.UTC(2024, 5, 1, 12, 31, 30);
    const rows = media.nearestFirst([{ filename: 'a', createdMs: T + 125000 }, { filename: 'b', createdMs: T - 4000 }, { filename: 'c', createdMs: null }, { filename: 'd', createdMs: T + 4000 }], T);
    assert.deepStrictEqual(rows.map((r) => r.filename), ['b', 'd', 'a'], 'null faller bort, före går före efter vid samma avstånd');
    assert.strictEqual(rows[0].deltaMs, -4000);
    assert.strictEqual(media.deltaText(-4000), '4 s före');
    assert.strictEqual(media.deltaText(125000), '2 min 5 s efter');
    assert.strictEqual(media.deltaText(0), 'vid tidpunkten');
    assert.strictEqual(media.deltaText(-7260000), '2 tim 1 min före');
    const keep = media.mediaKeeper();
    assert.ok(keep('private/var/mobile/Library/SMS/Attachments/ab/11/IMG_0001.JPG'));
    assert.ok(keep('x/Documents/com.snap.file_manager_3_SCContent_u/e4d2c0b8'));
    assert.ok(!keep('private/var/mobile/Media/DCIM/100APPLE/IMG_0001.JPG'), 'biblioteket täcks av databasen');
    assert.ok(!keep('private/var/mobile/Media/PhotoData/Thumbnails/V2/DCIM/100APPLE/IMG_0001.JPG/5005.JPG'));
    assert.ok(!keep('a/b/'));
    assert.ok(!keep('a/b.sqlite'));
});

test('en zip-posts ändringstid: unixtiden om den finns, annars DOS-tiden tolkad i zonen och märkt', () => {
    assert.deepStrictEqual(media.entryMs({ mtime: 1717245090, dosTime: '2024-06-01 14:31:30' }, { name: 'Europe/Stockholm' }), { ms: 1717245090000, assumed: false });
    assert.deepStrictEqual(media.entryMs({ mtime: null, dosTime: '2024-06-01 14:31:30' }, { name: 'Europe/Stockholm' }), { ms: Date.UTC(2024, 5, 1, 12, 31, 30), assumed: true });
    assert.deepStrictEqual(media.entryMs({ mtime: null, dosTime: '2024-06-01 14:31:30' }, { name: 'UTC' }), { ms: Date.UTC(2024, 5, 1, 14, 31, 30), assumed: true });
    assert.strictEqual(media.entryMs({ mtime: null, dosTime: '' }, {}), null);
    assert.strictEqual(media.entryMs(null, {}), null);
});

test('data-URL för bilden i exporterna', () => {
    const url = media.dataUrl(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg');
    assert.strictEqual(url, 'data:image/jpeg;base64,/9j/4A==');
});

test('UserComment: Snapchats user agent avkodas ur base64, andra kommentarer visas rått', () => {
    const b64 = 'CkkKR1NuYXBjaGF0LzE0LjMwLjAuNTQgKEFDMjAwMzsgQW5kcm9pZCAxMyNmOGZiNzRkMDQwIzMzOyBnemlwKSBWL01VU0hST09N';
    assert.strictEqual(media.decodeUserComment(b64), 'Snapchat/14.30.0.54 (AC2003; Android 13#f8fb74d040#33; gzip) V/MUSHROOM (base64 i taggen)');
    assert.strictEqual(media.decodeUserComment('Shot on iPhone'), 'Shot on iPhone');
    assert.strictEqual(media.decodeUserComment(''), null);
    assert.strictEqual(media.decodeUserComment('(Binary data 12 bytes)'), null);
    const rows = media.exifSummary([['EXIF:UserComment', b64], ['EXIF:ImageWidth', '1080'], ['EXIF:ImageHeight', '1920']]);
    assert.deepStrictEqual(rows, [['Mått', '1080 × 1920'], ['App (UserComment)', 'Snapchat/14.30.0.54 (AC2003; Android 13#f8fb74d040#33; gzip) V/MUSHROOM (base64 i taggen)']]);
    assert.deepStrictEqual(media.exifSummary([['QuickTime:Description', b64]])[0][1].slice(0, 19), 'Snapchat/14.30.0.54');
});
