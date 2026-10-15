const test = require('node:test');
const assert = require('node:assert');
const preview = require('./preview.js');
const android = require('../../queries/android/catalog.json');

test('kolumnerna läses ur SELECT, med alias och utan CASE-innehåll', () => {
    const q = android.categories[0].queries.find((x) => x.id === 'by-filename-files');
    const cols = preview.columns(q.sql);
    assert.deepStrictEqual(cols.slice(0, 3), ['_id', '_data', '_display_name']);
    assert.ok(cols.includes('date_taken'));
    assert.ok(cols.includes('owner_package_name'));
    assert.ok(!cols.some((c) => /WHEN|THEN/i.test(c)));
});

test('kommentarer och PRAGMA', () => {
    assert.deepStrictEqual(preview.columns('-- bara text\n-- inget mer'), []);
    assert.strictEqual(preview.columns('PRAGMA table_info(files);')[1], 'name');
    assert.deepStrictEqual(preview.columns('SELECT name FROM sqlite_master'), ['name']);
});

test('exempelrader använder filnamnet och paketet som skrevs in', () => {
    const rows = preview.exampleRows(['_display_name', 'owner_package_name', 'date_added'],
        { filename: 'IMG_0034.JPG', packageName: 'com.whatsapp', rows: 2 });
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0][0], 'IMG_0034.JPG');
    assert.strictEqual(rows[0][1], 'com.whatsapp');
    assert.match(rows[0][2], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('tio exempelrader har giltiga tider och filnamn', () => {
    const rows = preview.exampleRows(['_display_name', 'date_added'], { rows: 10 });
    rows.forEach((r) => {
        assert.match(r[0], /^202406(0[1-9]|10)_14\d{4}\.jpg$/);
        const [, h, m] = /(\d{2}):(\d{2}):\d{2}$/.exec(r[1]);
        assert.ok(Number(h) < 24 && Number(m) < 60, r[1]);
    });
});

test('alla Android-queries med SELECT ger kolumner', () => {
    android.categories.forEach((cat) => cat.queries.forEach((q) => {
        if (!/^\s*SELECT/im.test(q.sql.replace(/--[^\n]*/g, ''))) return;
        assert.ok(preview.columns(q.sql).length > 0, cat.id + '/' + q.id);
    }));
});
