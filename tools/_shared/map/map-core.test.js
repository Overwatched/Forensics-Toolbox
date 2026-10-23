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

test('noggrannhetscirkel ligger ungefär på rätt avstånd', () => {
    const ring = map.circlePolygon(18.06, 59.33, 1000);
    assert.strictEqual(ring.length, 65);
    assert.deepStrictEqual(ring[0], ring[ring.length - 1]);
    const edge = { lon: ring[0][0], lat: ring[0][1] };
    assert.ok(Math.abs(map.haversine({ lon: 18.06, lat: 59.33 }, edge) - 1000) < 5);
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

test('en rutt är en linje även när ett uppehåll delar den i turer', () => {
    const walk = [
        pt(1, 59.3303, 18.0586, '2024-06-01 14:00:00'),
        pt(2, 59.3195, 18.0722, '2024-06-01 14:46:00'),
        pt(3, 59.3280, 18.0914, '2024-06-01 18:05:00'),
        pt(4, 59.3157, 18.0339, '2024-06-02 09:32:00'),
    ];
    const r = map.route(walk);
    assert.ok(r.trips.length > 1);
    const drawn = map.routeLines(r, '#ff9f0a');
    assert.strictEqual(drawn.lines.length, 1);
    assert.strictEqual(drawn.lines[0].color, '#ff9f0a');
    assert.deepStrictEqual(drawn.lines[0].coordinates[0], [18.0586, 59.3303]);
    assert.deepStrictEqual(drawn.lines[0].coordinates[drawn.lines[0].coordinates.length - 1], [18.0339, 59.3157]);

    const phone = map.route(walk.map(function (p) { return Object.assign({}, p, { device: 'iPhone' }); }));
    const other = map.route([pt(5, 59.32512, 18.07068, '2024-06-01 14:22:00', '+02:00', 'Samsung')]);
    phone.trips.forEach(function (t) { t.color = '#0a84ff'; });
    other.trips.forEach(function (t) { t.color = '#ff9f0a'; });
    const iphone = map.routeLines(phone, '#ff9f0a');
    assert.strictEqual(iphone.lines.length, 1);
    assert.strictEqual(iphone.lines[0].color, '#0a84ff');
    assert.strictEqual(map.routeLines(other, '#ff9f0a').lines.length, 0);
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

const BUBBLE_POINT = {
    id: 9, name: 'IMG_4101.JPG', path: 'Resa/IMG_4101.JPG', lat: 59.32931, lon: 18.06858,
    taken: { text: '2024-06-01 14:30' }, device: 'iPhone 15 Pro', app: '', accuracy: 8,
};

test('standardbubblan följer panelens kryssrutor och har miniatyren först', () => {
    const cfg = map.defaultBubble({ thumb: true, time: true, name: true });
    assert.deepStrictEqual(cfg.items.map((i) => i.key), ['thumb', 'time', 'name', 'device', 'app', 'pos', 'accuracy', 'note']);
    assert.deepStrictEqual(map.bubbleParts(BUBBLE_POINT, cfg, ''), [
        { thumb: true }, { text: '2024-06-01 14:30' }, { text: 'IMG_4101.JPG' },
    ]);
});

test('bubblans ordning, egna titlar och egna rader', () => {
    const cfg = {
        titles: false,
        items: [
            { key: 'custom', on: true, label: 'Brottsplats', value: '' },
            { key: 'accuracy', on: true, label: 'GPS-fel' },
            { key: 'time', on: true, label: '' },
            { key: 'name', on: false, label: '' },
            { key: 'app', on: true, label: '' },
            { key: 'custom', on: true, label: 'Vittne', value: 'Anna' },
            { key: 'custom', on: true, label: '', value: '' },
        ],
    };
    assert.deepStrictEqual(map.bubbleParts(BUBBLE_POINT, cfg, ''), [
        { text: 'Brottsplats', heading: true },
        { text: 'GPS-fel: 8 m' },
        { text: '2024-06-01 14:30' },
        { text: 'Vittne: Anna' },
    ]);
    cfg.titles = true;
    assert.strictEqual(map.bubbleParts(BUBBLE_POINT, cfg, '')[2].text, 'Tid: 2024-06-01 14:30');
});

test('händelsen kommer från listan och källan från lager eller mapp', () => {
    const cfg = { titles: true, items: [{ key: 'note', on: true, label: '' }] };
    assert.deepStrictEqual(map.bubbleParts(BUBBLE_POINT, cfg, 'Möte'), [{ text: 'Händelse: Möte' }]);
    assert.strictEqual(map.sourceOf(BUBBLE_POINT), 'Resa');
    assert.strictEqual(map.sourceOf({ path: 'IMG.JPG' }), '');
    assert.strictEqual(map.sourceOf({ path: 'Resa/IMG.JPG', layer: 'Testdata · Stockholm' }), 'Testdata · Stockholm');
});

test('varje punkt får ett fast nummer i tidsordning, oberoende av rutten', () => {
    const at = (sort) => ({ sort });
    const a = { id: 1, taken: at('2024-06-01 12:00:00') };
    const b = { id: 2, taken: at('2024-06-01 09:00:00') };
    const c = { id: 3 };
    const d = { id: 4, taken: at('2024-06-01 08:00:00') };
    const e = { id: 5, taken: at('2024-06-01 10:00:00') };
    const f = { id: 6, taken: at('2024-06-01 10:00:00') };
    // Två källor där var och en börjar om på steg 1.
    const steps = [{ point: a, index: 1 }, { point: e, index: 2 }, { point: b, index: 1 }];
    const r = map.numberPoints([a, b, c, d, e, f], steps);
    assert.deepStrictEqual(r.numbers, { 4: 1, 2: 2, 5: 3, 6: 4, 1: 5, 3: 6 });
    assert.deepStrictEqual(r.inRoute, { 1: true, 5: true, 2: true });
    assert.deepStrictEqual(map.numberPoints([a, b, c, d, e, f], []).numbers, r.numbers);
});

test('intervall blir egna rutter och ett nummer hamnar bara i det första', () => {
    assert.strictEqual(map.parseRanges(''), null);
    assert.strictEqual(map.parseRanges('  '), null);
    assert.deepStrictEqual(map.parseRanges('1-12, 20–30'), { ranges: [[1, 12], [20, 30]] });
    assert.deepStrictEqual(map.parseRanges('12-1; 5'), { ranges: [[1, 12], [5, 5]] });
    assert.strictEqual(map.parseRanges('1-').error, true);
    assert.strictEqual(map.parseRanges('0-3').error, true);
    const points = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const numberOf = (p) => ({ a: 1, b: 2, c: 3, d: 4 })[p.id];
    const groups = map.pointsInRanges(points, numberOf, [[1, 2], [2, 4]]);
    assert.deepStrictEqual(groups.map((g) => g.map((p) => p.id)), [['a', 'b'], ['c', 'd']]);
});

test('en rad kan namnge flera rutter', () => {
    assert.deepStrictEqual(map.parseRouteText('punkt 1-10 = rutt A, punkt 11-15 rutt B'), {
        routes: [{ name: 'A', from: 1, to: 10 }, { name: 'B', from: 11, to: 15 }],
    });
    assert.deepStrictEqual(map.parseRouteText('1-10 = Hemfärd'), {
        routes: [{ name: 'Hemfärd', from: 1, to: 10 }],
    });
    assert.strictEqual(map.parseRouteText('1-10').routes[0].name, 'Rutt 1');
    assert.strictEqual(map.parseRouteText('bara text').error, true);
});

test('bakgrund: satellit och hybrid kräver en bildfil', () => {
    assert.strictEqual(map.archiveKind(1), 'vector');
    assert.strictEqual(map.archiveKind(3), 'raster');
    assert.strictEqual(map.archiveKind(0), 'vector');
    assert.deepStrictEqual(map.basemapModes([{ kind: 'vector' }]), ['map']);
    assert.deepStrictEqual(map.basemapModes([{ kind: 'vector' }, { kind: 'raster' }]), ['map', 'satellite', 'hybrid']);
});

test('bakgrund: lagerordning för karta, satellit och hybrid', () => {
    const layers = [
        { id: 'background', type: 'background' },
        { id: 'water', type: 'fill', paint: {} },
        { id: 'roads_minor_casing', type: 'line', paint: {} },
        { id: 'roads_minor', type: 'line', paint: { 'line-width': 2 } },
        { id: 'boundaries', type: 'line', paint: {} },
        { id: 'places_locality', type: 'symbol' },
    ];
    const archives = [
        { kind: 'vector', minZoom: 0, maxZoom: 6, bounds: [-180, -85, 180, 85] },
        { kind: 'raster', minZoom: 10, maxZoom: 17, bounds: [17.9, 59.2, 18.2, 59.4], tileSize: 512 },
        { kind: 'vector', minZoom: 7, maxZoom: 14, bounds: [10, 55, 25, 70] },
    ];
    const style = (mode) => map.basemapStyle({
        archives, layers, mode, glyphs: 'g', sprite: 's', attribution: 'OSM', tileUrl: (i) => 'ftpm://' + i + '/{z}/{x}/{y}',
    });

    const plain = style('map');
    assert.deepStrictEqual(Object.keys(plain.sources), ['pm0', 'pm2']);
    assert.strictEqual(plain.layers.filter((l) => l.type === 'background').length, 1);
    assert.ok(!plain.layers.some((l) => l.type === 'raster'));
    assert.strictEqual(plain.layers.find((l) => l.id === 'pm2-water').minzoom, 7);

    const sat = style('satellite');
    assert.strictEqual(sat.sources.pm1.type, 'raster');
    assert.strictEqual(sat.sources.pm1.tileSize, 512);
    assert.strictEqual(sat.layers[sat.layers.length - 1].id, 'pm1-raster');
    assert.ok(!sat.layers.some((l) => l.type === 'symbol'));

    const hybrid = style('hybrid').layers.map((l) => l.id);
    const at = hybrid.indexOf('pm1-raster');
    assert.ok(hybrid.indexOf('pm0-water') < at);
    assert.ok(hybrid.indexOf('pm0-roads_minor_casing') < at);
    assert.ok(hybrid.indexOf('pm0-roads_minor') > at);
    assert.ok(hybrid.indexOf('pm2-places_locality') > at);
    assert.strictEqual(style('hybrid').layers.find((l) => l.id === 'pm0-roads_minor').paint['line-width'], 2);

    // Utan bildfil faller satellit tillbaka till kartan.
    const noRaster = map.basemapStyle({ archives: [archives[0]], layers, mode: 'satellite', tileUrl: () => 'x' });
    assert.ok(noRaster.layers.some((l) => l.type === 'symbol'));
});

test('rutten fram till tid T slutar vid den uppskattade positionen', () => {
    const r = map.route([
        pt(1, 59.0, 18.0, '2024-06-01 14:00:00'),
        pt(2, 59.2, 18.2, '2024-06-01 15:00:00'),
        pt(3, 59.4, 18.4, '2024-06-01 16:00:00'),
    ]);
    const half = map.routeUntil(r, Date.UTC(2024, 5, 1, 12, 30));
    assert.strictEqual(half.steps.length, 2);
    assert.strictEqual(half.steps[1].partial, true);
    assert.ok(Math.abs(half.steps[1].point.lat - 59.1) < 0.001);
    assert.strictEqual(map.routeLines(half, '#fff').lines[0].coordinates.length, 2);
    assert.strictEqual(map.routeUntil(r, Date.UTC(2024, 5, 1, 13, 0)).steps.length, 2);
    assert.strictEqual(map.routeUntil(r, Date.UTC(2024, 5, 1, 15, 0)).steps.length, 3);
    assert.strictEqual(r.steps.length, 3);
});

test('tid T skrivs i bevisets zon, inte datorns', () => {
    const t = Date.UTC(2024, 5, 1, 12, 30, 5);
    assert.strictEqual(map.formatInstant(t, '+02:00'), '2024-06-01 14:30:05 +02:00');
    assert.strictEqual(map.formatInstant(t, 'UTC'), '2024-06-01 12:30:05 UTC');
    assert.strictEqual(map.formatInstant(t, ''), '2024-06-01 12:30:05 UTC');
    assert.strictEqual(map.formatInstant(t, '-05:00'), '2024-06-01 07:30:05 -05:00');
});

test('visitMinutes: minuter mellan ankomst och avfärd, bara inom samma zon', () => {
    const t = (sort, zone) => ({ sort, zone });
    assert.strictEqual(map.visitMinutes(t('2026-03-11 16:10:00', 'UTC'), t('2026-03-11 16:40:30', 'UTC')), 31);
    assert.strictEqual(map.visitMinutes(t('2026-03-11 16:10:00', 'UTC'), t('2026-03-11 17:40:00', '')), null);
    assert.strictEqual(map.visitMinutes(t('2026-03-11 16:10:00', ''), null), null);
});
