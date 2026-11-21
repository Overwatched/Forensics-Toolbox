// Påhittade poster i webbläsarnas cache, i samma form som på telefonerna (tools/_shared/webcache.js läser dem):
// en WebKit-post (NetworkCache Version 17) och en fil <hash>_0 i Chromiums simple cache.
'use strict';

const crypto = require('node:crypto');

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function i64(n) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; }
function f64(n) { const b = Buffer.alloc(8); b.writeDoubleLE(n); return b; }
function str(s) {
    if (s === null) return Buffer.from([0xff, 0xff, 0xff, 0xff]);
    const t = Buffer.from(String(s), 'latin1');
    return Buffer.concat([u32(t.length), Buffer.from([1]), t]);
}
const sha1 = (b) => crypto.createHash('sha1').update(b).digest();

// { url, mime, body (Buffer), inline, ms, headers: { name: value }, partition } → { record, blobName, blob }.
function webkitRecord(o) {
    const body = Buffer.from(o.body);
    const head = [Buffer.from([0]), str(o.url), str(o.mime), u64(body.length), str(null), str('HTTP/1.1')];
    Object.entries(o.headers || {}).forEach(([k, v]) => head.push(str(k), str(v)));
    const header = Buffer.concat(head);
    const hash = sha1(body);
    const meta = Buffer.concat([
        u32(17), str(o.partition || ''), str('Resource'), str(o.url), str(null), Buffer.alloc(40),
        f64((o.ms || Date.UTC(2026, 10, 3, 10, 0)) / 1000), sha1(header), u64(header.length), hash, u64(body.length),
        Buffer.from([o.inline === false ? 0 : 1]), Buffer.alloc(20),
    ]);
    const record = Buffer.concat([meta, header].concat(o.inline === false ? [] : [body]));
    return { record, blobName: hash.toString('hex').toUpperCase(), blob: o.inline === false ? body : null };
}

const SIMPLE_MAGIC = Buffer.from([0x30, 0x5c, 0x72, 0xa7, 0x1b, 0x6d, 0xfb, 0xfc]);
const EOF_MAGIC = Buffer.from([0xd8, 0x41, 0x0d, 0x97, 0x45, 0x6f, 0xfa, 0xf4]);
const WIN_EPOCH_US = 11644473600000000n;

// { url, body (Buffer, som den kom: gärna gzip), headers: 'HTTP/1.1 200\0content-type:text/html\0…', ms } → Buffer.
function chromiumEntry(o) {
    const key = Buffer.from('1/0/_dk_https://example.org https://example.org ' + o.url, 'latin1');
    const us = BigInt(o.ms || Date.UTC(2026, 10, 11, 13, 8)) * 1000n + WIN_EPOCH_US;
    const raw = Buffer.from(o.headers + '\0\0', 'latin1');
    const payload = Buffer.concat([u32(0x82476d03), u32(6), i64(us - 40000n), i64(us), raw]);
    const stream0 = Buffer.concat([u32(payload.length), payload]);
    return Buffer.concat([
        SIMPLE_MAGIC, u32(5), u32(key.length), u32(0), u32(0), key, Buffer.from(o.body),
        EOF_MAGIC, u32(1), u32(0), u32(0), u32(0),
        stream0, crypto.createHash('sha256').update(key).digest(),
        EOF_MAGIC, u32(3), u32(0), u32(stream0.length), u32(0),
    ]);
}

module.exports = { webkitRecord, chromiumEntry };
