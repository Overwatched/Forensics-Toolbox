// Kör i appen: CSV-filen går att läsa tillbaka och positionerna får tid, zon och noggrannhet.
// Hur valda filer paras ihop testas i identify.test.js.

const test = require('node:test');
const assert = require('node:assert');
const run = require('./run-core');
const imp = require('../_shared/map/import-core');

test('CSV citerar komma, citattecken och radbrytning', () => {
    const csv = run.toCsv(['a', 'b'], [['x,y', 'säger "hej"'], [null, 'rad\nbrytning']]);
    assert.strictEqual(csv, 'a,b\r\n"x,y","säger ""hej"""\r\n,"rad\nbrytning"\r\n');
    const back = imp.splitRows(csv).rows;
    assert.deepStrictEqual(back[1], ['x,y', 'säger "hej"']);
});

test('CSV: en cell som kan bli en formel får en apostrof, tal lämnas', () => {
    const csv = run.toCsv(['namn', 'tal'], [['=HYPERLINK("http://x")', -73.98], ['@SUM(A1)', '+46701234567'], ['-1+1', '1e-5'], ['\tdold', 'vanlig']]);
    const rows = csv.trim().split('\r\n').slice(1);
    assert.deepStrictEqual(rows, ['"\'=HYPERLINK(""http://x"")",-73.98', "'@SUM(A1),+46701234567", "'-1+1,1e-5", "'\tdold,vanlig"]);
});

test('positioner: UTC-tid, noggrannhet och typ', () => {
    const cols = ['tid_lokal', 'tid_utc', 'latitud', 'longitud', 'noggrannhet_m', 'typ'];
    const rows = [
        ['2026-03-11 17:10:00', '2026-03-11 16:10:00', 59.33, 18.06, 8, 'GNSS'],
        ['2026-03-11 17:11:00', '2026-03-11 16:11:00', null, null, 8, 'Wi-Fi'],
    ];
    const out = run.toPoints(cols, rows, { importer: imp, source: 'Cache.sqlite' });
    assert.strictEqual(out.points.length, 1);
    assert.strictEqual(out.skipped, 1);
    const p = out.points[0];
    assert.strictEqual(p.taken.text, '2026-03-11 16:10:00 UTC');
    assert.strictEqual(p.accuracy, 8);
    assert.strictEqual(p.type, 'GNSS');
    assert.strictEqual(p.visit, false);
});

test('besök: avfärd följer med, och ett pågående besök saknar avfärd', () => {
    const cols = ['ankomst_lokal', 'avfard_lokal', 'minuter', 'latitud', 'longitud', 'osakerhet_m', 'ankomst_utc', 'avfard_utc'];
    const rows = [
        ['2026-03-11 17:10:00', '2026-03-11 17:40:00', 30, 59.33, 18.06, 40, '2026-03-11 16:10:00', '2026-03-11 16:40:00'],
        ['2026-03-11 18:00:00', null, 'Pågår', 59.34, 18.07, 40, '2026-03-11 17:00:00', null],
    ];
    const out = run.toPoints(cols, rows, { importer: imp });
    assert.strictEqual(out.points.length, 2);
    assert.strictEqual(out.points[0].until.text, '2026-03-11 16:40:00 UTC');
    assert.strictEqual(out.points[1].until, null);
    assert.ok(out.points.every((p) => p.visit && p.accuracy === 40));
});

test('tiderna från Härkomst räknas om till UTC i en kolumn bredvid råvärdet', () => {
    const out = run.withUtcColumns(['Z_PK', 'ZDATECREATED', 'ZFILENAME'], [[1, 780995148, 'IMG_0049.HEIC'], [2, null, 'x']], [{ col: 'ZDATECREATED', epoch: 'cocoa' }]);
    assert.deepStrictEqual(out.columns, ['Z_PK', 'ZDATECREATED', 'ZDATECREATED (UTC)', 'ZFILENAME']);
    assert.deepStrictEqual(out.rows[0], [1, 780995148, '2025-10-01 07:05:48 UTC', 'IMG_0049.HEIC']);
    assert.strictEqual(out.rows[1][2], null);
    assert.strictEqual(out.added, 1);
    assert.strictEqual(run.epochText(1717245690000, 'unixMs'), '2024-06-01 12:41:30 UTC');
    assert.strictEqual(run.epochText(1717245690, 'unixAuto'), '2024-06-01 12:41:30 UTC');
    assert.strictEqual(run.epochText(1717245690, 'unix'), '2024-06-01 12:41:30 UTC');
    const same = run.withUtcColumns(['a'], [[1]], null);
    assert.deepStrictEqual(same.columns, ['a']);
});

test('tiderna räknas som i Härkomst (roles.js toMs)', () => {
    const roles = require('../provenance/roles');
    for (const [value, epoch] of [[783786259.482, 'cocoa'], ['783786259.482', 'cocoa'], [1793783388284, 'unixMs'], [1793783388.5, 'unixS'], [1793783388, 'unix'], [1793783388284, 'unixAuto'], [1793783388, 'unixAuto'], [0, 'cocoa'], [null, 'cocoa'], ['', 'unixMs'], ['text', 'cocoa']]) {
        assert.strictEqual(run.epochMs(value, epoch), roles.toMs(value, epoch), value + ' ' + epoch);
    }
    assert.strictEqual(run.epochText(783786259, 'cocoa'), '2025-11-02 14:24:19 UTC');
    assert.strictEqual(run.epochText(0, 'cocoa'), null);
});

test('händelsens rad: tiden väljer, och värdena skiljer rader med samma tid', () => {
    const cols = ['id', 'app', 'start', 'slut'];
    const specs = [{ col: 'start', epoch: 'unixMs' }, { col: 'slut', epoch: 'unixMs' }];
    const rows = [[1, 'a', 1000, 2000], [2, 'b', 3000, 4000], [3, 'c', 3000, 5000], [4, 'd', 6000, null]];
    assert.deepStrictEqual(run.findRows(cols, rows, specs, { ms: [1000] }), [0]);
    assert.deepStrictEqual(run.findRows(cols, rows, specs, { ms: [5000] }), [2], 'sluttiden räknas också');
    assert.deepStrictEqual(run.findRows(cols, rows, specs, { ms: [3000] }), [1, 2]);
    assert.deepStrictEqual(run.findRows(cols, rows, specs, { ms: [3000], values: ['c'] }), [2]);
    assert.deepStrictEqual(run.findRows(cols, rows, specs, { ms: [3000], values: ['z'] }), [1, 2], 'inget värde passar: tiden får avgöra');
    assert.deepStrictEqual(run.findRows(cols, rows, specs, { ms: [3000], values: [3] }), [2], 'tal jämförs som text');
    assert.deepStrictEqual(run.findRows(cols, rows, specs, { ms: [9999] }), []);
    assert.deepStrictEqual(run.findRows(cols, rows, null, { ms: [1000] }), []);
    assert.deepStrictEqual(run.findRows(cols, rows, [{ col: 'saknas', epoch: 'unixMs' }], { ms: [1000] }), []);
});

test('händelsens rad i en query från Härkomst, med tidskolumnerna i UTC bredvid', () => {
    const specs = [{ col: 'ZSTARTDATE', epoch: 'cocoa' }];
    const utc = run.withUtcColumns(['ZSTARTDATE', 'app'], [[783786259.482, 'a'], [783786300, 'b']], specs);
    assert.deepStrictEqual(utc.columns, ['ZSTARTDATE', 'ZSTARTDATE (UTC)', 'app']);
    assert.deepStrictEqual(run.findRows(utc.columns, utc.rows, specs, { ms: [Math.round((783786300 + 978307200) * 1000)] }), [1]);
});

test('raderna som visas: de första, eller runt den markerade', () => {
    assert.deepStrictEqual(run.rowWindow(10, [], 2000), { start: 0, end: 10 });
    assert.deepStrictEqual(run.rowWindow(5000, null, 2000), { start: 0, end: 2000 });
    assert.deepStrictEqual(run.rowWindow(5000, [1999], 2000), { start: 0, end: 2000 });
    assert.deepStrictEqual(run.rowWindow(5000, [2000], 2000), { start: 1000, end: 3000 });
    assert.deepStrictEqual(run.rowWindow(5000, [4999], 2000), { start: 3000, end: 5000 });
});

test('bara läsande SQL får köras mot en databas som hålls öppen', () => {
    for (const sql of ['SELECT 1', ' select * from t;', 'WITH x AS (SELECT 1) SELECT * FROM x', "-- kommentar\nSELECT 'DELETE FROM t'", '/* drop */ SELECT 1', 'SELECT "update" FROM t', 'SELECT name FROM pragma_table_info(\'t\')', "SELECT CASE WHEN a THEN 'x' END FROM t"]) {
        assert.ok(run.readsOnly(sql), sql);
    }
    for (const sql of ['DELETE FROM t', 'SELECT 1; DELETE FROM t', 'WITH x AS (SELECT 1) DELETE FROM t', 'PRAGMA table_info(t)', 'PRAGMA query_only = OFF', 'SELECT 1; PRAGMA query_only = OFF', 'CREATE TEMP TABLE x (a)', 'ATTACH DATABASE \'x\' AS y', 'VACUUM', 'BEGIN', '', null]) {
        assert.ok(!run.readsOnly(sql), String(sql));
    }
});

test('positioner: time_zone_id är inte en tid, och tagen_utc är det', () => {
    const cols = ['tagen_lokal', 'time_zone_id', 'latitude', 'longitude', 'tagen_utc'];
    const out = run.toPoints(cols, [['2024-06-01 16:00:00', 'Europe/Stockholm', 59.33, 18.06, '2024-06-01 14:00:00']], { importer: imp });
    assert.strictEqual(out.columns.time, 4);
    assert.strictEqual(out.points[0].taken.zone || 'UTC', 'UTC');
    assert.ok(/14:00/.test(out.points[0].taken.text), out.points[0].taken.text);
});

test('positioner: radens övriga kolumner följer med till punktens ruta', () => {
    const cols = ['ankomst_utc', 'avfard_utc', 'latitud', 'longitud', 'osakerhet_m', 'konfidens', 'blob', 'tom', 'ingen'];
    const out = run.toPoints(cols, [['2024-06-01 14:00:00', '2024-06-01 15:00:00', 59.33, 18.06, 8, 1, new Uint8Array(3), '', null]], { importer: imp });
    assert.deepStrictEqual(out.points[0].extra, [['konfidens', '1'], ['blob', '(blob, 3 byte)']]);
});
