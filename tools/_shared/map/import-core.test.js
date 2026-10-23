const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const imp = require('./import-core.js');
const map = require('./map-core.js');

const dir = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');

test('GPX: spårpunkter, tid och en waypoint', () => {
    const r = imp.parse(read('walk.gpx'), 'walk.gpx');
    assert.strictEqual(r.points.length, 3);
    assert.strictEqual(r.points[0].name, 'Centralstationen');
    assert.strictEqual(r.points[0].taken.zone, '+02:00');
    assert.strictEqual(r.points[2].name, 'Stortorget');
    assert.strictEqual(r.points[2].taken, null);
});

test('KML: punkt, gx:Track och linje', () => {
    const r = imp.parse(read('places.kml'), 'places.kml');
    assert.strictEqual(r.points.length, 5);
    assert.strictEqual(r.points[0].taken.sort, '2024-06-01 14:19:00');
    assert.strictEqual(r.points[1].taken.zone, 'UTC');
    assert.strictEqual(r.points[3].name, 'Linje 1');
});

test('CSV med semikolon och decimalkomma', () => {
    const r = imp.parse(read('points.csv'), 'points.csv');
    assert.strictEqual(r.points.length, 2);
    assert.ok(Math.abs(r.points[0].lat - 59.3303) < 1e-6);
    assert.strictEqual(r.skipped, 1);
    assert.strictEqual(imp.guessColumns(['lon', 'lat', 'tid']).lat, 1);
    const swapped = imp.parseCsv('lat,lon\n118.06,59.33\n');
    assert.strictEqual(swapped.swapped, true);
    assert.ok(Math.abs(swapped.points[0].lat - 59.33) < 1e-6);
});

test('Google Records och semanticSegments', () => {
    const rec = imp.parse(read('records.json'), 'records.json');
    assert.strictEqual(rec.points.length, 1);
    assert.ok(Math.abs(rec.points[0].lat - 59.3303) < 1e-4);
    assert.strictEqual(rec.skipped, 1);
    const sem = imp.parse(read('semantic.json'), 'semantic.json');
    assert.strictEqual(sem.points.length, 2);
    assert.strictEqual(sem.points[0].name, 'Vistelse');
});

test('inklistrad text, tom fil och egen GeoJSON', () => {
    const pasted = imp.parse('59.3293, 18.0686 2024-06-01 14:00\ninte en rad\n0, 0\n', 'klistra.txt');
    assert.strictEqual(pasted.points.length, 1);
    assert.strictEqual(pasted.skipped, 2);
    assert.strictEqual(imp.parse('', 'tom.gpx').points.length, 0);
    const own = JSON.parse(map.toGeoJson([{
        id: 1, path: 'a.jpg', name: 'a.jpg', lat: 59.33, lon: 18.06, source: 'test', device: 'iPhone',
        taken: { sort: '2024-06-01 14:00:00', zone: '+02:00', text: '2024-06-01 14:00:00 +02:00', kind: 'Tagen', source: 'x' },
        software: '', type: 'JPEG', mime: 'image/jpeg',
    }]));
    const back = imp.parse(JSON.stringify(own), 'export.geojson');
    assert.strictEqual(back.points.length, 1);
    assert.ok(Math.abs(back.points[0].lat - 59.33) < 1e-6);
    assert.strictEqual(back.points[0].taken.sort, '2024-06-01 14:00:00');
});

test('epoch i sekunder och millisekunder', () => {
    assert.strictEqual(imp.takenFrom('1717243200').zone, 'UTC');
    assert.strictEqual(imp.takenFrom('1717243200000').sort, imp.takenFrom('1717243200').sort);
});

test('CSV: citerade fält får innehålla avgränsare, radbrytning och ""', () => {
    const text = 'name;lat;lon\n"Hörnet; Sveavägen";59,3301;18,0601\n"Rad\nett ""två""";59,3302;18,0602\n';
    const r = imp.parseCsv(text);
    assert.strictEqual(r.points.length, 2);
    assert.strictEqual(r.points[0].name, 'Hörnet; Sveavägen');
    assert.strictEqual(r.points[1].name, 'Rad\nett "två"');
    assert.strictEqual(r.points[1].lon, 18.0602);
});

test('CSV från routined: UTC-kolumnen väljs, osäkerhet blir noggrannhet och avfärden följer med', () => {
    const text = 'ankomst_lokal,avfard_lokal,latitud,longitud,osakerhet_m,ankomst_utc,avfard_utc\n'
        + '2026-03-11 17:10:00,2026-03-11 17:40:00,59.33,18.06,35,2026-03-11 16:10:00,2026-03-11 16:40:00\n';
    const r = imp.parseCsv(text);
    assert.strictEqual(r.points.length, 1);
    const p = r.points[0];
    assert.strictEqual(p.taken.text, '2026-03-11 16:10:00 UTC');
    assert.strictEqual(p.until.text, '2026-03-11 16:40:00 UTC');
    assert.strictEqual(p.accuracy, 35);
});
