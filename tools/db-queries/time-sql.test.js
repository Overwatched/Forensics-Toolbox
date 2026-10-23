// Tidsspannet står som datum med zon i SQL:en, och SQLite räknar fram samma sekunder
// som förut.

process.env.TZ = 'Europe/Stockholm';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const t = require('./time-sql');

const SQLJS = path.join(__dirname, '..', 'ios-keychain', 'vendor', 'sqljs');

async function sqlite() {
    const ctx = {};
    new Function('window', fs.readFileSync(path.join(SQLJS, 'sql-wasm-binary.js'), 'utf8'))(ctx);
    const SQL = await require(path.join(SQLJS, 'sql-wasm.js'))({ wasmBinary: ctx.SQL_WASM_BINARY });
    return new SQL.Database();
}

test('datum utan klockslag tar med hela dagen, med sommar- och vintertid', () => {
    assert.deepStrictEqual(t.parse('2026-03-04', false), { unix: 1772578800, text: '2026-03-04 00:00:00', offset: '+01:00' });
    assert.strictEqual(t.parse('2026-03-04', true).text, '2026-03-04 23:59:59');
    assert.strictEqual(t.parse('2026-07-01 14:30', false).offset, '+02:00');
    assert.strictEqual(t.parse('2026-03-04 24:00', true).text, '2026-03-04 23:59:59');
});

test('unixtid blir UTC, och felaktiga datum avvisas', () => {
    assert.deepStrictEqual(t.parse('1772578800', false), { unix: 1772578800, text: '2026-03-03 23:00:00', offset: '+00:00' });
    assert.strictEqual(t.parse('1772578800000', false).unix, 1772578800);
    assert.strictEqual(t.parse('2026-02-30', false), null);
    assert.strictEqual(t.parse('i går', false), null);
    assert.strictEqual(t.parse('', false), null);
});

test('SQLite räknar fram samma tal som datumet i SQL:en', async () => {
    const db = await sqlite();
    const one = (sql) => db.exec('SELECT ' + sql)[0].values[0][0];
    const start = t.parse('2026-03-04 00:00', false);
    const lit = t.literal(start, false);
    assert.strictEqual(lit, '2026-03-04 00:00:00+01:00');
    assert.strictEqual(one(t.expr('unix', lit)), start.unix);
    assert.strictEqual(one(t.expr('cocoa', lit)), start.unix - 978307200);
    assert.strictEqual(one(t.expr('unixMs', lit)), start.unix * 1000);
    assert.strictEqual(one(t.expr('unix', t.literal(null, false))), 0);
    assert.strictEqual(one(t.expr('unix', t.literal(null, true))), 4102444800);
});
