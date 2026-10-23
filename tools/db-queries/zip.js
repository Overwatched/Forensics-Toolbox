// Läser poster ur en zip-fil utan att packa upp den. All läsning går genom read(offset, length),
// som i appen är File.slice() och i testerna en Buffer. Det finns inget sätt att skriva tillbaka.
//
// Klarar Zip64 (zippar över 4 GB och fler än 65 535 poster), lagrade och deflate-komprimerade
// poster. Testas i Node.
(function (root) {
    'use strict';

    var SIG_EOCD = 0x06054b50;
    var SIG_ZIP64_LOCATOR = 0x07064b50;
    var SIG_ZIP64_EOCD = 0x06064b50;
    var SIG_CENTRAL = 0x02014b50;
    var SIG_LOCAL = 0x04034b50;
    var CHUNK = 8 * 1024 * 1024;
    // sql.js håller hela databasen i minnet, två gånger under inläsningen.
    var MAX_ENTRY = 1536 * 1024 * 1024;

    function u16(b, at) { return b[at] | (b[at + 1] << 8); }
    function u32(b, at) { return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0; }
    // Talen i zippar ryms gott i en double (2^53 byte).
    function u64(b, at) { return u32(b, at) + u32(b, at + 4) * 0x100000000; }

    var utf8 = new TextDecoder('utf-8');

    // Zip-filens slut: EOCD ligger inom de sista 64 KB (plus kommentar). Vid Zip64 pekar en
    // locator strax före på den riktiga posten med 64-bitarstal.
    async function readDirectory(read, size) {
        var tailLen = Math.min(size, 65557);
        var tailStart = size - tailLen;
        var tail = await read(tailStart, tailLen);
        var at = -1;
        for (var i = tail.length - 22; i >= 0; i--) {
            if (u32(tail, i) === SIG_EOCD && i + 22 + u16(tail, i + 20) <= tail.length) { at = i; break; }
        }
        if (at < 0) throw new Error('Det här är ingen zip-fil, eller så är den avkortad (slutet saknas).');
        var dir = {
            entries: u16(tail, at + 10),
            size: u32(tail, at + 12),
            offset: u32(tail, at + 16),
            zip64: false,
        };
        var locAt = at - 20;
        if (locAt >= 0 && u32(tail, locAt) === SIG_ZIP64_LOCATOR) {
            var recOffset = u64(tail, locAt + 8);
            var rec = await read(recOffset, 56);
            if (u32(rec, 0) !== SIG_ZIP64_EOCD) throw new Error('Zip64-huvudet i slutet av zippen är trasigt.');
            dir.entries = u64(rec, 32);
            dir.size = u64(rec, 40);
            dir.offset = u64(rec, 48);
            dir.zip64 = true;
        }
        if (dir.offset + dir.size > size) throw new Error('Innehållsförteckningen pekar utanför zip-filen. Är zippen avkortad?');
        return dir;
    }

    // DOS-tid är lokal tid utan zon. Den används bara när zippen saknar unixtid.
    function dosTime(time, date) {
        if (!date) return '';
        var pad = function (n) { return String(n).padStart(2, '0'); };
        return (1980 + (date >> 9)) + '-' + pad((date >> 5) & 15) + '-' + pad(date & 31) + ' ' +
            pad(time >> 11) + ':' + pad((time >> 5) & 63) + ':' + pad((time & 31) * 2);
    }

    // Extrafälten: 0x0001 (Zip64-storlekar och offset) och 0x5455 (unixtid för ändring).
    function readExtra(b, start, end, e) {
        var at = start;
        while (at + 4 <= end) {
            var id = u16(b, at);
            var len = u16(b, at + 2);
            var body = at + 4;
            if (body + len > end) break;
            if (id === 0x0001) {
                var p = body;
                if (e.size === 0xffffffff && p + 8 <= body + len) { e.size = u64(b, p); p += 8; }
                if (e.compSize === 0xffffffff && p + 8 <= body + len) { e.compSize = u64(b, p); p += 8; }
                if (e.localOffset === 0xffffffff && p + 8 <= body + len) { e.localOffset = u64(b, p); p += 8; }
            } else if (id === 0x5455 && len >= 5 && (b[body] & 1)) {
                e.mtime = u32(b, body + 1);
            }
            at = body + len;
        }
    }

    // Går igenom hela innehållsförteckningen i bitar och sparar bara poster där keep(namn) är sant.
    // onProgress(lästa byte, totalt) anropas efter varje bit.
    async function scan(read, size, keep, onProgress) {
        var dir = await readDirectory(read, size);
        var kept = [];
        var count = 0;
        var buf = new Uint8Array(0);
        var pos = dir.offset;
        var end = dir.offset + dir.size;
        for (;;) {
            var at = 0;
            while (at + 46 <= buf.length) {
                if (u32(buf, at) !== SIG_CENTRAL) {
                    throw new Error('Innehållsförteckningen i zippen är trasig (post ' + (count + 1) + ').');
                }
                var nameLen = u16(buf, at + 28);
                var extraLen = u16(buf, at + 30);
                var commentLen = u16(buf, at + 32);
                var total = 46 + nameLen + extraLen + commentLen;
                if (at + total > buf.length) break;
                count++;
                var name = utf8.decode(buf.subarray(at + 46, at + 46 + nameLen));
                if (keep(name)) {
                    var e = {
                        name: name,
                        flags: u16(buf, at + 8),
                        method: u16(buf, at + 10),
                        dosTime: dosTime(u16(buf, at + 12), u16(buf, at + 14)),
                        crc32: u32(buf, at + 16),
                        compSize: u32(buf, at + 20),
                        size: u32(buf, at + 24),
                        localOffset: u32(buf, at + 42),
                        mtime: null,
                    };
                    readExtra(buf, at + 46 + nameLen, at + 46 + nameLen + extraLen, e);
                    kept.push(e);
                }
                at += total;
            }
            buf = buf.subarray(at);
            if (pos >= end) break;
            // En post är högst 46 + 3 * 65 535 byte, mindre än en bit, så en bit till räcker alltid.
            var len = Math.min(CHUNK, end - pos);
            var chunk = await read(pos, len);
            pos += len;
            var joined = new Uint8Array(buf.length + chunk.length);
            joined.set(buf);
            joined.set(chunk, buf.length);
            buf = joined;
            if (onProgress) onProgress(pos - dir.offset, dir.size);
        }
        if (buf.length) throw new Error('Innehållsförteckningen i zippen slutar mitt i en post.');
        return { entries: kept, count: count, expected: dir.entries, zip64: dir.zip64, directorySize: dir.size };
    }

    var CRC_TABLE = (function () {
        var t = new Uint32Array(256);
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            t[n] = c >>> 0;
        }
        return t;
    })();

    function crc32(bytes) {
        var c = 0xffffffff;
        for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    }

    async function inflateRaw(bytes) {
        if (typeof DecompressionStream !== 'function') throw new Error('Den här webbläsaren kan inte packa upp deflate.');
        var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    // Läser ut en post till minnet. Returnerar { bytes, crcOk }. opts.inflate kan bytas ut i testerna.
    async function extract(read, entry, opts) {
        opts = opts || {};
        if (entry.flags & 1) throw new Error(entry.name + ' är krypterad i zippen och kan inte läsas.');
        if (entry.method !== 0 && entry.method !== 8) {
            throw new Error(entry.name + ' är komprimerad med metod ' + entry.method + ', som inte stöds (bara lagrad och deflate).');
        }
        if (entry.size > MAX_ENTRY) {
            throw new Error(entry.name + ' är ' + Math.round(entry.size / 1048576) + ' MB. Filer över 1,5 GB kan inte köras i appen.');
        }
        var local = await read(entry.localOffset, 30);
        if (u32(local, 0) !== SIG_LOCAL) throw new Error('Den lokala posten för ' + entry.name + ' är trasig.');
        var start = entry.localOffset + 30 + u16(local, 26) + u16(local, 28);
        var raw = await read(start, entry.compSize);
        var bytes = entry.method === 8 ? await (opts.inflate || inflateRaw)(raw) : raw;
        if (bytes.length !== entry.size) throw new Error(entry.name + ' har fel storlek efter uppackning.');
        return { bytes: bytes, crcOk: crc32(bytes) === entry.crc32 };
    }

    // read(offset, length) för en File: läser bara den biten. Chromium vägrar läsa om filen
    // ändrats efter att den valdes, och det blir ett begripligt fel här.
    function fileReader(file) {
        return async function (offset, length) {
            try {
                return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
            } catch (err) {
                throw new Error(file.name + ' kunde inte läsas. Den kan ha ändrats, flyttats eller kopieras fortfarande. Välj den igen.');
            }
        };
    }

    var api = { scan: scan, extract: extract, crc32: crc32, fileReader: fileReader, readDirectory: readDirectory, MAX_ENTRY: MAX_ENTRY };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ZipRead = api;
})(typeof window !== 'undefined' ? window : this);
