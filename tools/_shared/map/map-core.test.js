const test = require('node:test');
const assert = require('node:assert');
const core = require('../../exif-viewer/exif-core.js');
const map = require('./map-core.js');

function row(id, path, tags) {
    const name = path.split('/').pop();
    return { id, path, name, summary: core.summarize(core.cleanTags(tags), name) };
}

// Samma promenad: en bild i lokal tid (+02:00), en video i UTC och en bild utan zon.
const PHOTO = row(1, 'case/IMG_0001.JPG', {
    'File:FileType': 'JPEG',
    'File:MIMEType': 'image/jpeg',
    'IFD0:Make': 'Apple',
    'IFD0:Model': 'iPhone 15 Pro',
    'ExifIFD:DateTimeOriginal': '2024:06:01 14:30:00',
    'ExifIFD:OffsetTimeOriginal': '+02:00',
    'Composite:GPSLatitude': '59.3293',
    'Composite:GPSLongitude': '18.0686',
});
const VIDEO = row(2, 'case/IMG_0002.MOV', {
    'File:FileType': 'MOV',
    'File:MIMEType': 'video/quicktime',
    'QuickTime:CreateDate': '2024:06:01 12:40:00',
    'Composite:GPSLatitude': '59.3326',
    'Composite:GPSLongitude': '18.0649',
});
const NOZONE = row(3, 'case/DSC_0003.JPG', {
    'File:FileType': 'JPEG',
    'ExifIFD:DateTimeOriginal': '2024:06:01 14:20:00',
    'Composite:GPSLatitude': '59.3251',
    'Composite:GPSLongitude': '18.0711',
});
const ZERO = row(4, 'case/zero.jpg', {
    'File:FileType': 'JPEG',
    'Composite:GPSLatitude': '0',
    'Composite:GPSLongitude': '0',
});
const NOTIME = row(5, 'case/<map & "x">.png', {
    'File:FileType': 'PNG',
    'Composite:GPSLatitude': '57.7089',
    'Composite:GPSLongitude': '11.9746',
});

test('points: filer med position, utan 0,0', () => {
    const pts = map.points([PHOTO, VIDEO, ZERO, NOTIME, row(6, 'x.txt', { 'File:FileType': 'TXT' })]);
    assert.deepStrictEqual(pts.map((p) => p.id), [1, 2, 5]);
    assert.strictEqual(pts[0].device, 'Apple iPhone 15 Pro');
    assert.strictEqual(pts[1].taken.zone, 'UTC');
});

test('route: UTC-video och lokal bild ordnas efter verklig tidpunkt', () => {
    const r = map.route(map.points([VIDEO, PHOTO, NOZONE, NOTIME]));
    // 14:20 (antagen +02:00) = 12:20Z, 14:30+02:00 = 12:30Z, video 12:40Z
    assert.deepStrictEqual(r.steps.map((s) => s.point.id), [3, 1, 2]);
    assert.strictEqual(r.assumedZone, '+02:00');
    assert.strictEqual(r.assumed, 1);
    assert.strictEqual(r.untimed, 1);
    assert.deepStrictEqual(r.steps.map((s) => s.assumed), [true, false, false]);
    assert.match(map.routeNote(r), /1 filer saknar tidszon och tolkas som \+02:00/);
});

test('route: utan någon tidszon jämförs tiderna som de står', () => {
    const a = row(1, 'a.jpg', { 'ExifIFD:DateTimeOriginal': '2024:01:01 10:00:00', 'Composite:GPSLatitude': '1', 'Composite:GPSLongitude': '1' });
    const b = row(2, 'b.jpg', { 'ExifIFD:DateTimeOriginal': '2024:01:01 09:00:00', 'Composite:GPSLatitude': '2', 'Composite:GPSLongitude': '2' });
    const r = map.route(map.points([a, b]));
    assert.deepStrictEqual(r.steps.map((s) => s.point.id), [2, 1]);
    assert.strictEqual(r.assumedZone, '');
    assert.match(map.routeNote(r), /Ingen fil har tidszon/);
});

test('instant och isoTime', () => {
    assert.strictEqual(map.instant('2024-06-01 14:30:00', '+02:00'), Date.UTC(2024, 5, 1, 12, 30));
    assert.strictEqual(map.instant('2024-06-01 12:40:00.250', 'UTC'), Date.UTC(2024, 5, 1, 12, 40, 0, 250));
    assert.strictEqual(map.instant('nonsens', 'UTC'), null);
    assert.strictEqual(map.isoTime({ sort: '2024-06-01 14:30:00', zone: '+0200' }), '2024-06-01T14:30:00+02:00');
    assert.strictEqual(map.isoTime({ sort: '2024-06-01 12:40:00', zone: 'UTC' }), '2024-06-01T12:40:00Z');
    assert.strictEqual(map.isoTime({ sort: '2024-06-01 12:40:00', zone: '' }), '2024-06-01T12:40:00');
});

test('inTimeRange jämför tiden som den står i filen', () => {
    const t = PHOTO.summary.taken;
    assert.ok(core.inTimeRange(t, '', ''));
    assert.ok(core.inTimeRange(t, '2024-06-01T14:30', '2024-06-01T14:30'));
    assert.ok(!core.inTimeRange(t, '2024-06-01T14:31', ''));
    assert.ok(!core.inTimeRange(t, '', '2024-06-01T14:29'));
    assert.ok(!core.inTimeRange(null, '2024-01-01T00:00', ''));
    assert.ok(core.inTimeRange(VIDEO.summary.taken, '2024-06-01T12:00', '2024-06-01T13:00'));
});

test('toKml: giltig struktur, escaping och rutt', () => {
    const kml = map.toKml(map.points([PHOTO, VIDEO, NOTIME]), { title: 'Ärende <1>' });
    assert.match(kml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<kml xmlns="http:\/\/www.opengis.net\/kml\/2.2">/);
    assert.match(kml, /<name>Ärende &lt;1&gt;<\/name>/);
    assert.match(kml, /<name>&lt;map &amp; &quot;x&quot;&gt;.png<\/name>/);
    assert.match(kml, /<TimeStamp><when>2024-06-01T14:30:00\+02:00<\/when><\/TimeStamp>/);
    assert.match(kml, /<TimeStamp><when>2024-06-01T12:40:00Z<\/when><\/TimeStamp>/);
    assert.match(kml, /<coordinates>18.0686,59.3293<\/coordinates>/);
    assert.match(kml, /<LineString><tessellate>1<\/tessellate><coordinates>18.0686,59.3293 18.0649,59.3326<\/coordinates>/);
    assert.strictEqual((kml.match(/<Placemark>/g) || []).length, 4);
    assert.ok(!/[<]script/i.test(kml));
});

test('toGeoJson: punkter med ordning och en rutt', () => {
    const fc = JSON.parse(map.toGeoJson(map.points([PHOTO, VIDEO, NOZONE]), { tool: 'test' }));
    assert.strictEqual(fc.type, 'FeatureCollection');
    assert.strictEqual(fc.features.length, 4);
    assert.deepStrictEqual(fc.features[0].geometry.coordinates, [18.0686, 59.3293]);
    assert.strictEqual(fc.features[0].properties.ordning, '2');
    assert.strictEqual(fc.features[2].properties.tidszon_antagen, 'ja');
    const line = fc.features[3];
    assert.strictEqual(line.geometry.type, 'LineString');
    assert.deepStrictEqual(line.geometry.coordinates[0], [18.0711, 59.3251]);
    assert.strictEqual(fc.metadata.tool, 'test');
});

function pt(id, lat, lon, sort, zone, device) {
    return {
        id: id, path: id + '.jpg', name: id + '.jpg', lat: lat, lon: lon, source: 'test', device: device || 'iPhone',
        taken: { sort: sort, zone: zone || '+02:00', text: sort, kind: 'Tagen', source: 'test' }, mime: 'image/jpeg',
    };
}

test('sträcka, fart och orimlig förflyttning', () => {
    // Centralstationen till Slussen är ungefär 1,3 km.
    const a = pt(1, 59.3303, 18.0586, '2024-06-01 14:00:00');
    const b = pt(2, 59.3195, 18.0722, '2024-06-01 14:20:00');
    const r = map.route([a, b]);
    assert.ok(Math.abs(r.totalMeters - 1300) < 250, r.totalMeters);
    assert.ok(r.steps[1].fromPrev.kmh < 20);
    assert.strictEqual(r.implausible, 0);
    assert.match(map.legText(r.steps[1].fromPrev), /Från föregående:/);

    const jump = map.route([
        pt(1, 59.33, 18.06, '2024-06-01 14:00:00'),
        pt(2, 57.70, 11.97, '2024-06-01 14:10:00'),
    ]);
    assert.strictEqual(jump.implausible, 1);

    const gpsHop = map.route([
        pt(1, 59.33000, 18.06000, '2024-06-01 14:00:00'),
        pt(2, 59.33080, 18.06000, '2024-06-01 14:00:05'),
    ]);
    assert.strictEqual(gpsHop.implausible, 0);
});

test('turer vid uppehåll, vistelse och en rutt per enhet', () => {
    const walk = [
        pt(1, 59.3303, 18.0586, '2024-06-01 14:00:00'),
        pt(2, 59.3251, 18.0707, '2024-06-01 14:22:00'),
        pt(3, 59.32512, 18.07068, '2024-06-01 14:31:00'),
        pt(4, 59.3280, 18.0914, '2024-06-01 18:05:00'),
        pt(5, 59.3157, 18.0339, '2024-06-02 09:32:00', '+02:00', 'Samsung'),
    ];
    const r = map.route(walk);
    assert.strictEqual(r.trips.length, 3);
    assert.ok(r.stays.length >= 1);
    const groups = map.routesBy(walk, 'device');
    assert.deepStrictEqual(groups.map((g) => g.name).sort(), ['Samsung', 'iPhone']);
});

test('position vid tid T är interpolerad mellan punkterna', () => {
    const r = map.route([
        pt(1, 59.0, 18.0, '2024-06-01 14:00:00'),
        pt(2, 59.2, 18.2, '2024-06-01 15:00:00'),
    ]);
    const mid = map.positionAt(r, Date.UTC(2024, 5, 1, 12, 30));
    assert.strictEqual(mid.interpolated, true);
    assert.ok(Math.abs(mid.lat - 59.1) < 0.001);
    const gpx = map.toGpx(r.steps.map((s) => s.point));
    assert.strictEqual((gpx.match(/<trkseg>/g) || []).length, 1);
    assert.match(gpx, /<trkpt lat="59" lon="18"/);
});
