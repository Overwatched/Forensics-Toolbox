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
    assert.deepStrictEqual(merged.stats.cipher, { profile: 'Signal', settings: 'Signals inställningar', pages: older.length / PAGE, badHmac: 0, walPages: newer.length / PAGE, walBadHmac: 0 });
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

// ---------- Signal på iOS: SQLCipher 4, rå nyckel med salt, okrypterat huvud ----------

const RESERVE_IOS = 80;
const HEADER_IOS = 32;

function emptyDbWithReserveIos() {
    const b = Buffer.from(emptyDbWithReserve());
    b[20] = RESERVE_IOS;
    b.writeUInt16BE(PAGE - RESERVE_IOS, 105);
    return new Uint8Array(b);
}

async function makeDbIos(rows) {
    const S = await sqlJs();
    const db = new S.Database(emptyDbWithReserveIos());
    db.run('CREATE TABLE model_TSInteraction (id INTEGER PRIMARY KEY, recordType INTEGER, timestamp INTEGER, body TEXT)');
    for (let i = 1; i <= rows; i++) db.run('INSERT INTO model_TSInteraction (recordType, timestamp, body) VALUES (21, ?, ?)', [1793703400000 + i * 1000, 'meddelande ' + i + ' ' + 'y'.repeat(200)]);
    const bytes = db.export();
    db.close();
    return bytes;
}

// Krypterar som SQLCipher 4 med rå nyckel: de första 32 byten på sida 1 står kvar, resten av sidan
// (utom reserven) blir AES-256-CBC, sedan IV och HMAC-SHA512(data, IV, sidnummer LE).
function keysIos(raw) {
    const key = raw.subarray(0, 32), salt = raw.subarray(32, 48);
    const macKey = crypto.pbkdf2Sync(key, Buffer.from(salt.map((b) => b ^ 0x3a)), 2, 32, 'sha512');
    return { key, macKey };
}
function encryptPageIos(k, page, pgno) {
    const start = pgno === 1 ? HEADER_IOS : 0;
    const iv = crypto.randomBytes(16);
    const c = crypto.createCipheriv('aes-256-cbc', k.key, iv);
    c.setAutoPadding(false);
    const data = Buffer.concat([c.update(Buffer.from(page.subarray(start, PAGE - RESERVE_IOS))), c.final()]);
    const pn = Buffer.alloc(4); pn.writeUInt32LE(pgno);
    const mac = crypto.createHmac('sha512', k.macKey).update(data).update(iv).update(pn).digest();
    const out = Buffer.alloc(PAGE);
    if (pgno === 1) Buffer.from(page.subarray(0, HEADER_IOS)).copy(out, 0);
    data.copy(out, start);
    iv.copy(out, PAGE - RESERVE_IOS);
    mac.copy(out, PAGE - RESERVE_IOS + 16);
    return out;
}
function encryptDbIos(plain, raw) {
    const k = keysIos(raw);
    const pages = [];
    for (let p = 1; p * PAGE <= plain.length; p++) pages.push(encryptPageIos(k, plain.subarray((p - 1) * PAGE, p * PAGE), p));
    return { bytes: new Uint8Array(Buffer.concat(pages)), k };
}
function encryptedWalIos(k, newer) {
    const head = Buffer.alloc(32);
    head.writeUInt32BE(0x377f0682, 0); head.writeUInt32BE(3007000, 4); head.writeUInt32BE(PAGE, 8);
    head.writeUInt32BE(1, 12); head.writeUInt32BE(0x0a0b0c0d, 16); head.writeUInt32BE(0x01020304, 20);
    let sum = walChecksum(head.subarray(0, 24), [0, 0]);
    head.writeUInt32BE(sum[0], 24); head.writeUInt32BE(sum[1], 28);
    const frames = [head];
    const count = newer.length / PAGE;
    for (let p = 1; p <= count; p++) {
        const data = encryptPageIos(k, newer.subarray((p - 1) * PAGE, p * PAGE), p);
        const fh = Buffer.alloc(24);
        fh.writeUInt32BE(p, 0); fh.writeUInt32BE(p === count ? count : 0, 4);
        fh.writeUInt32BE(0x0a0b0c0d, 8); fh.writeUInt32BE(0x01020304, 12);
        sum = walChecksum(fh.subarray(0, 8), sum);
        sum = walChecksum(data, sum);
        fh.writeUInt32BE(sum[0], 16); fh.writeUInt32BE(sum[1], 20);
        frames.push(fh, data);
    }
    return new Uint8Array(Buffer.concat(frames));
}

test('HMAC och PBKDF2 med SHA-512 som Nodes crypto (block 128 byte)', () => {
    const data = crypto.randomBytes(500);
    for (const len of [16, 64, 128, 200]) {
        const k = crypto.randomBytes(len);
        assert.deepStrictEqual(Buffer.from(sc.hmac('sha512', k, [data.subarray(0, 7), data.subarray(7)])), crypto.createHmac('sha512', k).update(data).digest(), 'nyckel ' + len + ' byte');
    }
    const key = crypto.randomBytes(32), salt = crypto.randomBytes(16);
    assert.deepStrictEqual(Buffer.from(sc.pbkdf2('sha512', key, salt, 2, 32)), crypto.pbkdf2Sync(key, salt, 2, 32, 'sha512'));
});

test('Signal på iOS: rå nyckel och okrypterat huvud, samma bytes tillbaka, fel nyckel och fel längd sägs', async () => {
    const plain = await makeDbIos(40);
    const raw = crypto.randomBytes(48);
    const hex = raw.toString('hex');
    const enc = encryptDbIos(plain, raw).bytes;
    // Båda börjar som SQLite; bara den krypterade räknas som krypterad.
    assert.ok(sc.isPlain(enc) && sc.isPlain(plain));
    assert.ok(sc.isEncrypted(enc) && sc.isEncrypted(enc, 'signal-ios'));
    assert.ok(!sc.isEncrypted(plain) && !sc.isEncrypted(plain, 'signal-ios'), 'okrypterad med 80 byte reserv');
    assert.ok(sc.isEncrypted(encryptDb(await makeDb(3), PASS, crypto.randomBytes(16)).bytes), 'Android: saltet först');

    const dec = sc.decryptDatabase(enc, hex, 'signal-ios');
    assert.deepStrictEqual(Buffer.from(dec.bytes), Buffer.from(plain));
    assert.deepStrictEqual(dec.stats, { pages: plain.length / PAGE, badHmac: 0 });
    assert.deepStrictEqual(Buffer.from(sc.decryptDatabase(enc, "x'" + hex.toUpperCase() + "'", 'signal-ios').bytes), Buffer.from(plain), "x'…' som i SQLCipher");

    assert.throws(() => sc.decryptDatabase(enc, crypto.randomBytes(48).toString('hex'), 'signal-ios'), /Nyckeln passar inte.*Signals inställningar på iOS/);
    assert.throws(() => sc.decryptDatabase(enc, hex.slice(0, 64), 'signal-ios'), /saknar saltet/);
    assert.throws(() => sc.decryptDatabase(plain, hex, 'signal-ios'), /inte krypterad/);
    // Androids inställningar på en iOS-databas: HMAC stämmer inte.
    assert.throws(() => sc.decryptDatabase(enc, hex.slice(0, 64), 'signal'), /Nyckeln passar inte/);
});

test('Signal på iOS med -wal: ramarna dekrypteras, också sida 1 med sitt huvud', async () => {
    const S = await sqlJs();
    const older = await makeDbIos(4);
    const newer = await makeDbIos(50);
    const raw = crypto.randomBytes(48);
    const { bytes: enc, k } = encryptDbIos(older, raw);
    const merged = sc.open(enc, encryptedWalIos(k, newer), raw.toString('hex'), 'signal-ios', wal);
    assert.strictEqual(merged.stats.error, '');
    assert.deepStrictEqual(merged.stats.cipher, { profile: 'Signal (iOS)', settings: 'Signals inställningar på iOS', pages: older.length / PAGE, badHmac: 0, walPages: newer.length / PAGE, walBadHmac: 0 });
    const db = new S.Database(merged.bytes);
    assert.deepStrictEqual(db.exec('SELECT count(*), max(timestamp) FROM model_TSInteraction')[0].values[0], [50, 1793703400000 + 50 * 1000]);
    db.close();
    assert.match(sc.summary(merged.stats, 'nyckelringen'), /^Dekrypterad i minnet \(SQLCipher, Signals inställningar på iOS\) med nyckeln ur nyckelringen: \d+ sidor och \d+ sidor ur -wal\. Kontrollsumman \(HMAC\) stämde för alla sidor\.$/);
});

// ---------- openAsync (WebCrypto) ----------

// WebCrypto med räknare, så att testet ser att den snabba vägen faktiskt används.
function countingSubtle() {
    const s = crypto.webcrypto.subtle;
    const calls = { decrypt: 0, sign: 0 };
    return { calls, importKey: (...a) => s.importKey(...a), encrypt: (...a) => s.encrypt(...a),
        decrypt: (...a) => { calls.decrypt++; return s.decrypt(...a); }, sign: (...a) => { calls.sign++; return s.sign(...a); } };
}

test('openAsync: samma bytes och siffror som open, över bitgränser, med skadade sidor (Android och iOS)', async () => {
    const raw = crypto.randomBytes(48);
    const cases = [
        { profile: 'signal', pass: PASS, enc: encryptDb(await makeDb(60), PASS, crypto.randomBytes(16)).bytes },
        { profile: 'signal-ios', pass: raw.toString('hex'), enc: encryptDbIos(await makeDbIos(60), raw).bytes },
    ];
    for (const c of cases) {
        const pages = c.enc.length / PAGE;
        assert.ok(pages >= 4, 'flera sidor');
        const broken = c.enc.slice();
        broken[2 * PAGE + 100] ^= 1;          // data i sida 3
        broken[3 * PAGE + PAGE - 60] ^= 1;    // HMAC eller IV i sida 4
        for (const [enc, label] of [[c.enc, 'hel'], [broken, 'skadad']]) {
            const want = sc.open(enc, new Uint8Array(0), c.pass, c.profile, wal);
            for (const batchPages of [1, 2, 3, undefined]) {
                const subtle = countingSubtle();
                const got = await sc.openAsync(enc, new Uint8Array(0), c.pass, c.profile, wal, { subtle, batchPages });
                assert.deepStrictEqual(Buffer.from(got.bytes), Buffer.from(want.bytes), c.profile + ' ' + label + ', ' + batchPages + ' sidor per bit');
                assert.deepStrictEqual(got.stats, want.stats);
                assert.strictEqual(subtle.calls.sign, pages - 1, 'HMAC kontrolleras för varje sida utom den första');
                assert.ok(subtle.calls.decrypt >= 1);
            }
        }
        assert.strictEqual(sc.open(broken, new Uint8Array(0), c.pass, c.profile, wal).stats.cipher.badHmac, 2);
    }
});

test('openAsync: samma fel som open, fel nyckel och fel storlek', async () => {
    const plain = await makeDb(10);
    const enc = encryptDb(plain, PASS, crypto.randomBytes(16)).bytes;
    await assert.rejects(sc.openAsync(enc, new Uint8Array(0), PASS.replace(/^a/, 'b'), 'signal', wal), /Nyckeln passar inte/);
    await assert.rejects(sc.openAsync(plain, new Uint8Array(0), PASS, 'signal', wal), /inte krypterad/);
    await assert.rejects(sc.openAsync(enc.slice(0, PAGE + 7), new Uint8Array(0), PASS, 'signal', wal), /helt antal sidor/);
});

test('openAsync: går i ren JS utan WebCrypto och när WebCrypto misslyckas, med samma resultat', async () => {
    const enc = encryptDb(await makeDb(30), PASS, crypto.randomBytes(16)).bytes;
    const want = sc.open(enc, new Uint8Array(0), PASS, 'signal', wal);
    const without = await sc.openAsync(enc, new Uint8Array(0), PASS, 'signal', wal, { subtle: null });
    assert.deepStrictEqual(Buffer.from(without.bytes), Buffer.from(want.bytes));
    const failing = { importKey: () => Promise.reject(new Error('går inte')) };
    const after = await sc.openAsync(enc, new Uint8Array(0), PASS, 'signal', wal, { subtle: failing });
    assert.deepStrictEqual(Buffer.from(after.bytes), Buffer.from(want.bytes));
    assert.deepStrictEqual(after.stats, want.stats);
});

test('openAsync: ramarna i -wal, också sida 1 med sitt huvud och en skadad ram, som open', async () => {
    const raw = crypto.randomBytes(48);
    const { bytes: encIos, k: kIos } = encryptDbIos(await makeDbIos(4), raw);
    const walIos = encryptedWalIos(kIos, await makeDbIos(50));
    const salt = crypto.randomBytes(16);
    const { bytes: enc, k } = encryptDb(await makeDb(5), PASS, salt);
    const walAndroid = encryptedWal(k, await makeDb(60), salt);
    for (const [db, w, pass, profile] of [[encIos, walIos, raw.toString('hex'), 'signal-ios'], [enc, walAndroid, PASS, 'signal']]) {
        const want = sc.open(db, w, pass, profile, wal);
        assert.ok(want.stats.appliedFrames > 1);
        for (const batchPages of [1, 2, undefined]) {
            const got = await sc.openAsync(db, w, pass, profile, wal, { batchPages });
            assert.deepStrictEqual(Buffer.from(got.bytes), Buffer.from(want.bytes), profile);
            assert.deepStrictEqual(got.stats, want.stats);
        }
        // Tom och trasig -wal.
        for (const other of [new Uint8Array(0), new Uint8Array(100)]) {
            const a = sc.open(db, other, pass, profile, wal);
            const b = await sc.openAsync(db, other, pass, profile, wal);
            assert.deepStrictEqual(Buffer.from(b.bytes), Buffer.from(a.bytes));
            assert.deepStrictEqual(b.stats, a.stats);
        }
    }
});

test('openAsync: rapporterar hur långt den kommit', async () => {
    const enc = encryptDb(await makeDb(40), PASS, crypto.randomBytes(16)).bytes;
    const pages = enc.length / PAGE;
    const seen = [];
    await sc.openAsync(enc, new Uint8Array(0), PASS, 'signal', wal, { batchPages: 2, onProgress: (done, total) => seen.push([done, total]) });
    assert.deepStrictEqual(seen[seen.length - 1], [pages, pages]);
    assert.ok(seen.every((x, i) => !i || x[0] > seen[i - 1][0]));
});
