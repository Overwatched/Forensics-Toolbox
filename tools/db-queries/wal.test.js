// -wal-filen läggs på databasen: rader som bara finns i WAL ska synas, och en ofullständig
// transaktion i slutet ska inte räknas.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const wal = require('./wal');

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { /* äldre Node */ }

const SQLJS = path.join(__dirname, '..', 'ios-keychain', 'vendor', 'sqljs');

async function openSqlJs(bytes) {
    const ctx = {};
    new Function('window', fs.readFileSync(path.join(SQLJS, 'sql-wasm-binary.js'), 'utf8'))(ctx);
    const initSqlJs = require(path.join(SQLJS, 'sql-wasm.js'));
    const SQL = await initSqlJs({ wasmBinary: ctx.SQL_WASM_BINARY });
    return new SQL.Database(bytes);
}

// Databas i WAL-läge där de senaste raderna bara finns i -wal. Filerna kopieras medan
// anslutningen är öppen, så att ingen checkpoint hinner köras.
function makeWalDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wal-test-'));
    const file = path.join(dir, 'Cache.sqlite');
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;');
    db.exec('CREATE TABLE ZRTCLLOCATIONMO (Z_PK INTEGER PRIMARY KEY, ZTIMESTAMP REAL, ZLATITUDE REAL, ZLONGITUDE REAL, ZHORIZONTALACCURACY REAL, ZTYPE INTEGER)');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const insert = db.prepare('INSERT INTO ZRTCLLOCATIONMO (ZTIMESTAMP, ZLATITUDE, ZLONGITUDE, ZHORIZONTALACCURACY, ZTYPE) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < 50; i++) insert.run(795000000 + i * 60, 59.33 + i / 1000, 18.06, 5, i % 2 ? 1 : 4);
    const bytes = { db: fs.readFileSync(file), wal: fs.readFileSync(file + '-wal') };
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    return bytes;
}

test('rader som bara finns i -wal syns efter att ramarna lagts på', { skip: !DatabaseSync && 'node:sqlite saknas' }, async () => {
    const files = makeWalDb();
    const before = await openSqlJs(wal.apply(files.db, new Uint8Array(0)).bytes);
    assert.strictEqual(before.exec('SELECT count(*) FROM ZRTCLLOCATIONMO')[0].values[0][0], 0);

    const merged = wal.apply(files.db, files.wal);
    assert.strictEqual(merged.stats.error, '');
    assert.ok(merged.stats.appliedFrames > 0);
    assert.strictEqual(merged.stats.ignoredFrames, 0);
    const db = await openSqlJs(merged.bytes);
    assert.strictEqual(db.exec('SELECT count(*) FROM ZRTCLLOCATIONMO')[0].values[0][0], 50);
});

test('källbuffertarna ändras inte', { skip: !DatabaseSync && 'node:sqlite saknas' }, () => {
    const files = makeWalDb();
    const db = Buffer.from(files.db);
    const w = Buffer.from(files.wal);
    wal.apply(db, w);
    assert.ok(db.equals(files.db));
    assert.ok(w.equals(files.wal));
});

test('en trasig ram stoppar inläsningen, och ramar utan commit räknas inte', { skip: !DatabaseSync && 'node:sqlite saknas' }, () => {
    const files = makeWalDb();
    const full = wal.apply(files.db, files.wal).stats;
    const head = wal.readHeader(files.wal);
    const frame = 24 + head.pageSize;
    const cut = files.wal.subarray(0, 32 + (full.walFrames - 1) * frame);
    const partial = wal.apply(files.db, cut).stats;
    assert.ok(partial.appliedFrames < full.appliedFrames);

    assert.strictEqual(partial.uncommittedFrames, partial.validFrames - partial.appliedFrames);

    const broken = Buffer.from(files.wal);
    broken[32 + 24 + 10] ^= 0xff;
    const stats = wal.apply(files.db, broken).stats;
    assert.strictEqual(stats.validFrames, 0);
    assert.strictEqual(stats.appliedFrames, 0);
    assert.strictEqual(stats.brokenFrames, full.walFrames);

    // Ny omgång: nytt salt i huvudet gör att alla ramar räknas som äldre.
    const older = Buffer.from(files.wal);
    older.writeUInt32BE((older.readUInt32BE(16) ^ 1) >>> 0, 16);
    const sum = [0, 0];
    for (let i = 0; i < 24; i += 8) {
        const le = older.readUInt32BE(0) === 0x377f0682;
        const x0 = le ? older.readUInt32LE(i) : older.readUInt32BE(i);
        const x1 = le ? older.readUInt32LE(i + 4) : older.readUInt32BE(i + 4);
        sum[0] = (sum[0] + x0 + sum[1]) >>> 0;
        sum[1] = (sum[1] + x1 + sum[0]) >>> 0;
    }
    older.writeUInt32BE(sum[0], 24);
    older.writeUInt32BE(sum[1], 28);
    const old = wal.apply(files.db, older).stats;
    assert.strictEqual(old.error, '');
    assert.strictEqual(old.oldFrames, full.walFrames);
});

test('fel fil som -wal ger ett tydligt fel', () => {
    const r = wal.apply(new Uint8Array(4096), new Uint8Array(64).fill(7));
    assert.match(r.stats.error, /magiskt tal/);
});
