// Kör varje Photos.sqlite-mall mot schemat för de iOS-versioner som bandet täcker.
// Schemat kommer från iLEAPP (se scripts/photos-schema-from-ileapp.js), så en mall som
// använder en tabell eller kolumn som inte finns i en version blir ett testfel.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const { CATALOGS, render } = require(path.join(ROOT, 'scripts', 'sync-query-catalogs.js'));
const catalog = require(path.join(ROOT, 'queries', 'ios', 'photos-sqlite', 'catalog.json'));
const schemas = require('./fixtures/photos-schema.json');

const BAND_VERSIONS = {
    'ios10-13': ['11-13'],
    ios14: ['14'],
    'ios15-16': ['15', '16'],
    'ios17-plus': ['17', '18', '26'],
};

async function loadSql() {
    const vendor = path.join(ROOT, 'tools', 'ios-keychain', 'vendor', 'sqljs');
    const sandbox = { window: {}, atob: (s) => Buffer.from(s, 'base64').toString('binary') };
    vm.runInNewContext(fs.readFileSync(path.join(vendor, 'sql-wasm-binary.js'), 'utf8'), sandbox);
    const initSqlJs = require(path.join(vendor, 'sql-wasm.js'));
    return initSqlJs({ wasmBinary: sandbox.window.SQL_WASM_BINARY });
}

function openSchema(SQL, version) {
    const db = new SQL.Database();
    for (const [table, cols] of Object.entries(schemas[version])) {
        db.run('CREATE TABLE ' + table + ' (' + cols.join(', ') + ')');
    }
    return db;
}

function fillPlaceholders(sql) {
    return sql
        .replace(/\{\{cocoaStart\}\}/g, '0')
        .replace(/\{\{cocoaEnd\}\}/g, '1000000000')
        .replace(/\{\{\w+\}\}/g, 'x');
}

test('catalog.js matchar catalog.json för alla query-kataloger', () => {
    for (const c of CATALOGS) {
        const js = fs.readFileSync(path.join(ROOT, c.dir, 'catalog.js'), 'utf8');
        assert.strictEqual(js, render(c), c.dir + '/catalog.js är inaktuell — kör npm run sync-queries');
    }
});

test('varje band har schema och varje fråga finns i minst ett band', () => {
    assert.deepStrictEqual(catalog.bands.map((b) => b.id).sort(), Object.keys(BAND_VERSIONS).sort());
    for (const q of catalog.questions) {
        const bands = catalog.bands.filter((b) => b.queries.some((x) => x.id === q.id)).map((b) => b.id);
        assert.ok(bands.length, q.id + ' saknar SQL');
        if (q.onlyBands) assert.deepStrictEqual(bands, q.onlyBands, q.id + ': onlyBands stämmer inte med banden');
        for (const name of q.params || []) {
            if (name === 'timeStart' || name === 'timeEnd') continue;
            assert.ok(catalog.paramLabels[name], q.id + ': etikett saknas för ' + name);
        }
    }
});

test('parametrarna i frågan används i SQL:en', () => {
    for (const band of catalog.bands) {
        for (const { id, sql } of band.queries) {
            const q = catalog.questions.find((x) => x.id === id);
            assert.ok(q, band.id + ': ' + id + ' saknas bland questions');
            for (const name of q.params || []) {
                const token = name === 'timeStart' ? '{{cocoaStart}}' : name === 'timeEnd' ? '{{cocoaEnd}}' : '{{' + name + '}}';
                assert.ok(sql.includes(token), band.id + '/' + id + ' använder inte ' + token);
            }
        }
    }
});

test('Photos.sqlite-mallarna körs mot schemat för varje iOS-version', async () => {
    const SQL = await loadSql();
    for (const band of catalog.bands) {
        for (const version of BAND_VERSIONS[band.id]) {
            const db = openSchema(SQL, version);
            for (const { id, sql } of band.queries) {
                assert.doesNotThrow(
                    () => db.exec(fillPlaceholders(sql)),
                    (err) => assert.fail(band.id + '/' + id + ' mot iOS ' + version + ': ' + err.message)
                );
            }
            db.close();
        }
    }
});

test('skaparappens kolumn följer iOS-versionen', () => {
    const sql = (band) => catalog.bands.find((b) => b.id === band).queries.find((q) => q.id === 'full-story').sql;
    assert.match(sql('ios10-13'), /FROM ZGENERICASSET a/);
    assert.match(sql('ios14'), /FROM ZASSET a/);
    assert.match(sql('ios14'), /aa\.ZCREATORBUNDLEID/);
    assert.match(sql('ios15-16'), /aa\.ZIMPORTEDBYBUNDLEIDENTIFIER/);
    assert.doesNotMatch(sql('ios17-plus'), /ZCREATORBUNDLEID/);
});
