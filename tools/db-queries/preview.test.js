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

test('iOS-exempel: Photos-kolumner, tidszon och CASE-text', () => {
    const sql = "SELECT a.ZDIRECTORY, a.ZFILENAME, aa.ZTIMEZONENAME, aa.ZEXIFTIMESTAMPSTRING,\n" +
        "  CASE a.ZKINDSUBTYPE WHEN 10 THEN 'Skärmdump' END AS typ, a.ZHIDDEN FROM ZASSET a";
    const row = preview.exampleRows(preview.columns(sql), { sql, platform: 'iOS', rows: 1 })[0];
    assert.deepStrictEqual(row, ['DCIM/100APPLE', 'IMG_4101.HEIC', 'Europe/Stockholm', '2024:06:01 14:10:12', 'Skärmdump', '0']);
});

test('sluttiden ligger usage_seconds efter starttiden', () => {
    const rows = preview.exampleRows(['ZSTARTDATE', 'ZENDDATE', 'usage_seconds'], { platform: 'iOS', rows: 10 });
    rows.forEach(([start, end, secs]) => {
        const diff = (Date.parse(end.replace(' ', 'T')) - Date.parse(start.replace(' ', 'T'))) / 1000;
        assert.strictEqual(diff, Number(secs), start + ' → ' + end);
    });
});

test('schemafrågor visar tabell- och kolumnnamn', () => {
    const tables = "SELECT name, type FROM sqlite_master WHERE type = 'table'";
    assert.deepStrictEqual(preview.exampleRows(['name', 'type'], { sql: tables, platform: 'iOS', rows: 1 })[0], ['ZASSET', 'table']);
    const cols = preview.exampleRows(preview.columns('PRAGMA table_info(files);'), { sql: 'PRAGMA table_info(files);', rows: 1 })[0];
    assert.deepStrictEqual(cols, ['0', '_id', 'INTEGER', '0', 'NULL', '0']);
});

test('inga kolumner i någon katalog saknar exempelvärde', () => {
    const catalogs = [
        ['iOS', require('../../queries/ios/photos-sqlite/catalog.json')],
        ['iOS', require('../../queries/app-usage/catalog.json')],
        ['Android', android],
    ];
    const missing = [];
    const walk = (o, platform) => {
        if (Array.isArray(o)) return o.forEach((x) => walk(x, platform));
        if (!o || typeof o !== 'object') return;
        if (typeof o.sql === 'string') {
            const cols = preview.columns(o.sql);
            const row = preview.exampleRows(cols, { sql: o.sql, platform, rows: 1 })[0];
            cols.forEach((c, i) => { if (row[i] === '…') missing.push(o.id + ':' + c); });
            return;
        }
        Object.keys(o).forEach((k) => walk(o[k], platform));
    };
    catalogs.forEach(([platform, c]) => walk(c, platform));
    assert.deepStrictEqual(missing, []);
});

test('alla Android-queries med SELECT ger kolumner', () => {
    android.categories.forEach((cat) => cat.queries.forEach((q) => {
        if (!/^\s*SELECT/im.test(q.sql.replace(/--[^\n]*/g, ''))) return;
        assert.ok(preview.columns(q.sql).length > 0, cat.id + '/' + q.id);
    }));
});
