// Kör i appen: filerna paras ihop, CSV-filen går att läsa tillbaka och positionerna
// får tid, zon och noggrannhet.

const test = require('node:test');
const assert = require('node:assert');
const run = require('./run-core');
const imp = require('../_shared/map/import-core');

test('databas och -wal paras ihop, -shm hoppas över', () => {
    const p = run.pairFiles(['Cache.sqlite-shm', 'Cache.sqlite-wal', 'Cache.sqlite']);
    assert.deepStrictEqual([p.db, p.wal, p.other, p.mismatch], [2, 1, [0], false]);
    assert.strictEqual(run.pairFiles(['Cache.sqlite', 'Local.sqlite-wal']).mismatch, true);
    assert.strictEqual(run.pairFiles(['Cache.sqlite-wal']).db, null);
});

test('CSV citerar komma, citattecken och radbrytning', () => {
    const csv = run.toCsv(['a', 'b'], [['x,y', 'säger "hej"'], [null, 'rad\nbrytning']]);
    assert.strictEqual(csv, 'a,b\r\n"x,y","säger ""hej"""\r\n,"rad\nbrytning"\r\n');
    const back = imp.splitRows(csv).rows;
    assert.deepStrictEqual(back[1], ['x,y', 'säger "hej"']);
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
