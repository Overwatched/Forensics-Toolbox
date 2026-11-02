// SQLCipher med Signals inställningar: AES, HMAC och PBKDF2 jämförs med Nodes crypto, och en
// databas som krypteras här i testet (med Nodes crypto, alltså oberoende av modulen) ska bli
// samma databas igen, även med en -wal där de senaste raderna bara finns i ramarna.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sc = require('./sqlcipher');
const wal = require('./wal');

const SQLJS = path.join(__dirname, '..', 'ios-keychain', 'vendor', 'sqljs');
let SQL = null;
async function sqlJs() {
    if (SQL) return SQL;
    const ctx = {};
    new Function('window', fs.readFileSync(path.join(SQLJS, 'sql-wasm-binary.js'), 'utf8'))(ctx);
    SQL = await require(path.join(SQLJS, 'sql-wasm.js'))({ wasmBinary: ctx.SQL_WASM_BINARY });
    return SQL;
}

const PAGE = 4096;
const RESERVE = 48;

// En tom databas med 48 byte reserv per sida, som SQLCipher kräver. sql.js fyller den sedan.
function emptyDbWithReserve() {
    const b = Buffer.alloc(PAGE);
    b.write('SQLite format 3\0', 0, 'latin1');
    b.writeUInt16BE(PAGE, 16);
    b[18] = 1; b[19] = 1; b[20] = RESERVE; b[21] = 64; b[22] = 32; b[23] = 32;
    b.writeUInt32BE(1, 24); b.writeUInt32BE(1, 28); b.writeUInt32BE(4, 44); b.writeUInt32BE(1, 56);
    b.writeUInt32BE(1, 92); b.writeUInt32BE(3045000, 96);
    b[100] = 0x0d; b.writeUInt16BE(PAGE - RESERVE, 105);
    return new Uint8Array(b);
}

async function makeDb(rows) {
    const S = await sqlJs();
    const db = new S.Database(emptyDbWithReserve());
    db.run('CREATE TABLE message (_id INTEGER PRIMARY KEY, date_sent INTEGER, body TEXT)');
    for (let i = 1; i <= rows; i++) db.run('INSERT INTO message (date_sent, body) VALUES (?, ?)', [1793641670834 + i * 1000, 'meddelande ' + i + ' ' + 'x'.repeat(200)]);
    const bytes = db.export();
    db.close();
    return bytes;
}

// Krypterar som SQLCipher: saltet först i filen, varje sida AES-256-CBC + IV + HMAC-SHA1(data, IV, sidnummer LE).
function keys(passphrase, salt) {
    const key = crypto.pbkdf2Sync(Buffer.from(passphrase, 'utf8'), salt, 1, 32, 'sha1');
    const macKey = crypto.pbkdf2Sync(key, Buffer.from(salt.map((b) => b ^ 0x3a)), 2, 32, 'sha1');
    return { key, macKey };
}
function encryptPage(k, page, pgno, salt) {
    const start = pgno === 1 ? 16 : 0;
    const iv = crypto.randomBytes(16);
    const c = crypto.createCipheriv('aes-256-cbc', k.key, iv);
    c.setAutoPadding(false);
    const data = Buffer.concat([c.update(Buffer.from(page.subarray(start, PAGE - RESERVE))), c.final()]);
    const pn = Buffer.alloc(4); pn.writeUInt32LE(pgno);
    const mac = crypto.createHmac('sha1', k.macKey).update(data).update(iv).update(pn).digest();
    const out = Buffer.alloc(PAGE);
    if (pgno === 1) salt.copy(out, 0);
    data.copy(out, start);
    iv.copy(out, PAGE - RESERVE);
    mac.copy(out, PAGE - RESERVE + 16);
    return out;
}
function encryptDb(plain, passphrase, salt) {
    const k = keys(passphrase, salt);
    const pages = [];
    for (let p = 1; p * PAGE <= plain.length; p++) pages.push(encryptPage(k, plain.subarray((p - 1) * PAGE, p * PAGE), p, salt));
    return { bytes: new Uint8Array(Buffer.concat(pages)), k };
}

// En -wal med krypterade ramar: alla sidor i den nyare databasen, sista ramen är commit.
function walChecksum(buf, s) {
    let [s0, s1] = s;
    for (let i = 0; i < buf.length; i += 8) {
        s0 = (s0 + buf.readUInt32LE(i) + s1) >>> 0;
        s1 = (s1 + buf.readUInt32LE(i + 4) + s0) >>> 0;
    }
    return [s0, s1];
}
function encryptedWal(k, newer, salt) {
    const head = Buffer.alloc(32);
    head.writeUInt32BE(0x377f0682, 0); head.writeUInt32BE(3007000, 4); head.writeUInt32BE(PAGE, 8);
    head.writeUInt32BE(1, 12); head.writeUInt32BE(0x11223344, 16); head.writeUInt32BE(0x55667788, 20);
    let sum = walChecksum(head.subarray(0, 24), [0, 0]);
    head.writeUInt32BE(sum[0], 24); head.writeUInt32BE(sum[1], 28);
    const frames = [head];
    const count = newer.length / PAGE;
    for (let p = 1; p <= count; p++) {
        const data = encryptPage(k, newer.subarray((p - 1) * PAGE, p * PAGE), p, salt);
        const fh = Buffer.alloc(24);
        fh.writeUInt32BE(p, 0); fh.writeUInt32BE(p === count ? count : 0, 4);
        fh.writeUInt32BE(0x11223344, 8); fh.writeUInt32BE(0x55667788, 12);
        sum = walChecksum(fh.subarray(0, 8), sum);
        sum = walChecksum(data, sum);
        fh.writeUInt32BE(sum[0], 16); fh.writeUInt32BE(sum[1], 20);
        frames.push(fh, data);
    }
    return new Uint8Array(Buffer.concat(frames));
}

const PASS = 'a3f00d9478eb7753e39c5a41a670c93e0de07a916fc97f3a79fed11daa0ecc5a';

test('AES-256: FIPS-197 C.3 åt båda hållen', () => {
    const ks = sc.expandKey(sc.hexToBytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'));
    const out = new Uint8Array(16);
    sc.encryptBlock(ks, sc.hexToBytes('00112233445566778899aabbccddeeff'), 0, out, 0);
    assert.strictEqual(sc.bytesToHex(out), '8ea2b7ca516745bfeafc49904b496089');
    const back = new Uint8Array(16);
    sc.decryptBlock(ks, out, 0, back, 0);
    assert.strictEqual(sc.bytesToHex(back), '00112233445566778899aabbccddeeff');
});

test('CBC och CTR som Nodes crypto, HMAC och PBKDF2 likaså', () => {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const plain = crypto.randomBytes(4048);
    const c = crypto.createCipheriv('aes-256-cbc', key, iv); c.setAutoPadding(false);
    const enc = Buffer.concat([c.update(plain), c.final()]);
    assert.deepStrictEqual(Buffer.from(sc.cbcDecrypt(sc.expandKey(key), iv, enc)), plain);

    const odd = crypto.randomBytes(1000 + 7);
    const zero = Buffer.alloc(16);
    const ctr = crypto.createCipheriv('aes-256-ctr', key, zero);
    assert.deepStrictEqual(Buffer.from(sc.ctr(sc.expandKey(key), zero, odd)), Buffer.concat([ctr.update(odd), ctr.final()]));
    // Räknaren går över bytegränsen som i Java (hela blocket, stor endian).
    const nearWrap = Buffer.from('000000000000000000000000000000ff', 'hex');
    const ctr2 = crypto.createCipheriv('aes-256-ctr', key, nearWrap);
    assert.deepStrictEqual(Buffer.from(sc.ctr(sc.expandKey(key), nearWrap, odd)), Buffer.concat([ctr2.update(odd), ctr2.final()]));

    for (const id of ['sha1', 'sha256']) {
        const k = crypto.randomBytes(id === 'sha1' ? 100 : 32);
        assert.deepStrictEqual(Buffer.from(sc.hmac(id, k, [plain.subarray(0, 10), plain.subarray(10, 99)])), crypto.createHmac(id, k).update(plain.subarray(0, 99)).digest());
    }
    for (const iter of [1, 2, 1000]) {
        assert.deepStrictEqual(Buffer.from(sc.pbkdf2('sha1', Buffer.from('lösen'), Buffer.from('saltsaltsaltsalt'), iter, 32)), crypto.pbkdf2Sync('lösen', 'saltsaltsaltsalt', iter, 32, 'sha1'));
    }
});

test('Signals databas: dekrypteras till samma bytes, fel nyckel och skadad sida märks', async () => {
    const plain = await makeDb(40);
    assert.ok(plain.length >= 3 * PAGE, 'flera sidor');
    const salt = crypto.randomBytes(16);
    const enc = encryptDb(plain, PASS, salt).bytes;
    assert.ok(!sc.isPlain(enc) && sc.isPlain(plain));

    const dec = sc.decryptDatabase(enc, PASS, 'signal');
    assert.deepStrictEqual(Buffer.from(dec.bytes), Buffer.from(plain));
    assert.deepStrictEqual(dec.stats, { pages: plain.length / PAGE, badHmac: 0 });

    assert.throws(() => sc.decryptDatabase(enc, PASS.replace(/^a/, 'b'), 'signal'), /Nyckeln passar inte/);
    assert.throws(() => sc.decryptDatabase(plain, PASS, 'signal'), /inte krypterad/);

    const broken = enc.slice();
    broken[2 * PAGE + 100] ^= 1;
    assert.strictEqual(sc.decryptDatabase(broken, PASS, 'signal').stats.badHmac, 1);
});

test('Signals databas med -wal: ramarna dekrypteras och läggs på, raderna i -wal syns', async () => {
    const S = await sqlJs();
    const older = await makeDb(5);
    const newer = await makeDb(60);
    const salt = crypto.randomBytes(16);
    const { bytes: enc, k } = encryptDb(older, PASS, salt);
    const encWal = encryptedWal(k, newer, salt);
    const merged = sc.open(enc, encWal, PASS, 'signal', wal);
    assert.strictEqual(merged.stats.error, '');
    assert.strictEqual(merged.stats.appliedFrames, newer.length / PAGE);
    assert.deepStrictEqual(merged.stats.cipher, { profile: 'Signal', pages: older.length / PAGE, badHmac: 0, walPages: newer.length / PAGE, walBadHmac: 0 });
    const db = new S.Database(merged.bytes);
    const res = db.exec('SELECT count(*), max(date_sent) FROM message')[0].values[0];
    db.close();
    assert.deepStrictEqual(res, [60, 1793641670834 + 60 * 1000]);
    assert.match(sc.summary(merged.stats, 'extra/Secrets/secrets.json'), /^Dekrypterad i minnet \(SQLCipher, Signals inställningar\) med nyckeln ur extra\/Secrets\/secrets\.json: \d+ sidor och \d+ sidor ur -wal\. Kontrollsumman \(HMAC\) stämde för alla sidor\.$/);

    // Utan -wal: bara den äldre databasen.
    const only = sc.open(enc, new Uint8Array(0), PASS, 'signal', wal);
    const db2 = new S.Database(only.bytes);
    assert.strictEqual(db2.exec('SELECT count(*) FROM message')[0].values[0][0], 5);
    db2.close();
});

test('base64 utan utfyllnad och URL-säker, som i Signals nycklar', () => {
    const raw = crypto.randomBytes(32);
    assert.deepStrictEqual(Buffer.from(sc.base64ToBytes(raw.toString('base64').replace(/=+$/, ''))), raw);
    assert.deepStrictEqual(Buffer.from(sc.base64ToBytes(raw.toString('base64url'))), raw);
});
