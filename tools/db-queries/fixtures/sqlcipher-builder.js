// Bygger SQLCipher-krypterade databaser och -wal till testerna, som Signal skriver dem: Android (SQLCipher 3,
// saltet först i filen) och iOS (SQLCipher 4, rå nyckel med salt, okrypterat huvud).
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SQLJS = path.join(__dirname, '..', '..', 'ios-keychain', 'vendor', 'sqljs');
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

module.exports = { sqlJs, PAGE, makeDb, encryptDb, encryptedWal, makeDbIos, encryptDbIos, encryptedWalIos };
