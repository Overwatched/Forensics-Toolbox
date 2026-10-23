// Varje databas i Queries ska ha exakt en rekommenderad query som inte är en hjälpfråga,
// och varje query ska säga vad den gör.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const photos = require(path.join(ROOT, 'queries', 'ios', 'photos-sqlite', 'catalog.json'));
const android = require(path.join(ROOT, 'queries', 'android', 'catalog.json'));
const appUsage = require(path.join(ROOT, 'queries', 'app-usage', 'catalog.json'));
const routined = require(path.join(ROOT, 'queries', 'ios', 'routined', 'catalog.json'));

function checkGroup(name, queries, describe) {
    const recommended = queries.filter((q) => q.recommended);
    assert.strictEqual(recommended.length, 1, name + ': ska ha exakt en rekommenderad query');
    assert.notStrictEqual(recommended[0].group, 'advanced', name + ': den rekommenderade får inte vara en hjälpfråga');
    for (const q of queries) {
        const text = String(describe(q) || '').trim();
        assert.ok(text.length >= 20, name + '/' + q.id + ': beskrivningen saknas eller är för kort');
    }
}

test('Android: en rekommenderad query per kategori och beskrivning på alla', () => {
    for (const cat of android.categories) checkGroup('android-' + cat.id, cat.queries, (q) => q.description);
});

test('App-aktivitet: en rekommenderad query per databas och undertext på alla', () => {
    for (const db of appUsage.databases) checkGroup(db.id, db.queries, (q) => q.subtitle);
});

test('routined: en rekommenderad query per databas och undertext på alla', () => {
    for (const db of routined.databases) checkGroup(db.id, db.queries, (q) => q.subtitle);
});

test('routined: positionerna tar bara med kända ZTYPE (1 GNSS, 4 Wi-Fi) och filtrerar på råtiden', () => {
    const q = routined.databases[0].queries.find((x) => x.id === 'locations');
    assert.match(q.sql, /ZTYPE IN \(1, 4\)/);
    assert.match(q.sql, /ZTIMESTAMP BETWEEN \{\{cocoaStart\}\} AND \{\{cocoaEnd\}\}/);
    assert.doesNotMatch(q.sql, /WHERE[\s\S]*localtime/);
});

test('Photos.sqlite: en rekommenderad query i varje band och undertext på alla', () => {
    for (const band of photos.bands) {
        const ids = new Set(band.queries.map((q) => q.id));
        checkGroup('photos-' + band.id, photos.questions.filter((q) => ids.has(q.id)), (q) => q.subtitle);
    }
});

test('hjälpfrågor heter "Hjälp: …" eller "Tips: …"', () => {
    const all = [
        ...photos.questions.map((q) => [q.id, q.label, q.group]),
        ...android.categories.flatMap((c) => c.queries.map((q) => [q.id, q.title, q.group])),
        ...appUsage.databases.flatMap((d) => d.queries.map((q) => [q.id, q.title, q.group])),
        ...routined.databases.flatMap((d) => d.queries.map((q) => [q.id, q.title, q.group])),
    ];
    for (const [id, title, group] of all) {
        if (/^(Hjälp|Tips):/.test(title)) assert.strictEqual(group, 'advanced', id + ': hjälpfråga utan group advanced');
    }
});

// Extraktion: databaserna hittas i en zip på sökvägarna i "paths". De skrivs utan inledande /
// och utan prefix, så att de kan jämföras bakifrån mot namnen i zippen.
test('sökvägar för extraktion: alla SQL-databaser har dem, och de är skrivna utan prefix', () => {
    const groups = [
        ['photos', photos.paths],
        ...appUsage.databases.map((d) => [d.id, d.paths]),
        ...routined.databases.map((d) => [d.id, d.paths]),
        ...android.categories.filter((c) => c.id !== 'usage').map((c) => ['android-' + c.id, c.paths]),
    ];
    for (const [name, paths] of groups) {
        assert.ok(Array.isArray(paths) && paths.length, name + ': paths saknas');
        for (const p of paths) {
            assert.ok(!/^\//.test(p) && !/\s|\(|…/.test(p), name + ': ' + p + ' ska vara en ren sökväg utan inledande /');
        }
    }
    const bands = photos.bands.map((b) => b.ios);
    assert.ok(bands.every((r) => Array.isArray(r) && r.length === 2), 'Photos: varje band behöver ios: [från, till]');
    for (let v = 10; v <= 26; v++) {
        assert.strictEqual(bands.filter((r) => v >= r[0] && v <= r[1]).length, 1, 'Photos: iOS ' + v + ' ska höra till exakt ett band');
    }
});
