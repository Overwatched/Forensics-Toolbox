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

    // Windows FILETIME (100 ns sedan 1601-01-01 UTC) -> Unix-sekunder med decimaler. 0 = saknas.
    function filetime(b, at) {
        var v = u32(b, at) + u32(b, at + 4) * 0x100000000;
        return v ? v / 1e7 - 11644473600 : null;
    }

    // Tiderna i ett extrafält: 0x5455 (UT, Unix-sekunder: ändring, och i vissa zippar åtkomst och
    // skapande, enligt flaggorna) och 0x000A (NTFS: ändring, åtkomst och skapande i UTC med 100 ns).
    // Returnerar { m, a, c, field } eller null.
    function readTimes(b, id, body, len) {
        var end = body + len;
        if (id === 0x5455 && len >= 1) {
            var fl = b[body], q = body + 1, t = { m: null, a: null, c: null, field: 'UT' };
            if ((fl & 1) && q + 4 <= end) { t.m = u32(b, q) || null; q += 4; }
            if ((fl & 2) && q + 4 <= end) { t.a = u32(b, q) || null; q += 4; }
            if ((fl & 4) && q + 4 <= end) { t.c = u32(b, q) || null; q += 4; }
            return t;
        }
        if (id === 0x000a && len >= 4) {
            // Fyra reserverade byte, sedan attribut; attribut 1 (24 byte) har ändring, åtkomst och skapande.
            for (var r = body + 4; r + 4 <= end; r += 4 + u16(b, r + 2)) {
                if (u16(b, r) === 1 && u16(b, r + 2) >= 24 && r + 28 <= end) {
                    return { m: filetime(b, r + 4), a: filetime(b, r + 12), c: filetime(b, r + 20), field: 'NTFS' };
                }
            }
        }
        return null;
    }

    // NTFS går före UT, eftersom tiderna är exaktare. only: bara tider som saknas fylls i (den lokala
    // posten kan ha fler UT-tider än innehållsförteckningen).
    function setTimes(e, t, only) {
        if (!t) return;
        if (!only && e.timeField === 'NTFS' && t.field === 'UT') return;
        if (t.m && !(only && e.mtime)) e.mtime = t.m;
        if (t.a && !(only && e.atime)) e.atime = t.a;
        if (t.c && !(only && e.crtime)) e.crtime = t.c;
        if (!e.timeField || t.field === 'NTFS') e.timeField = t.field;
    }

    // Extrafälten: 0x0001 (Zip64-storlekar och offset) och tiderna (UT och NTFS).
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
            } else {
                setTimes(e, readTimes(b, id, body, len));
            }
            at = body + len;
        }
    }

    // Tiderna i den lokala postens extrafält: Info-ZIP skriver bara ändringstiden i
    // innehållsförteckningen och åtkomst och skapande i den lokala posten.
    function readLocalTimes(b, e) {
        var at = 0;
        while (at + 4 <= b.length) {
            var len = u16(b, at + 2);
            if (at + 4 + len > b.length) break;
            setTimes(e, readTimes(b, u16(b, at), at + 4, len), true);
            at += 4 + len;
        }
    }

    // Går igenom hela innehållsförteckningen i bitar och sparar bara poster där keep(namn, storlek, crc32) är sant.
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
                // keep får också storlek och CRC32 ur posten, så att dubbletter av en fil kan
                // hittas utan att alla poster sparas. Zip64-storlekar är 0xFFFFFFFF här.
                if (keep(name, u32(buf, at + 24), u32(buf, at + 16))) {
                    var e = {
                        name: name,
                        flags: u16(buf, at + 8),
                        method: u16(buf, at + 10),
                        dosTime: dosTime(u16(buf, at + 12), u16(buf, at + 14)),
                        crc32: u32(buf, at + 16),
                        compSize: u32(buf, at + 20),
                        size: u32(buf, at + 24),
                        localOffset: u32(buf, at + 42),
                        mtime: null, atime: null, crtime: null, timeField: '',
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

    // Innehållsförteckningen hålls i minnet efter första läsningen, så att varje sökning i zippen
    // (databaserna, filen, kopior, Snapchats poster) läser den ur minnet i stället för från disk.
    // Är den större än gränsen läses den från disk vid varje sökning som förut. Posterna själva
    // läses alltid ur zippen. Ingenting skrivs.
    var MAX_CACHED_DIRECTORY = 512 * 1024 * 1024;
    async function cacheDirectory(read, size, opts, onProgress) {
        opts = opts || {};
        var max = opts.maxBytes || MAX_CACHED_DIRECTORY;
        var dir = await readDirectory(read, size);
        var info = { entries: dir.entries, directorySize: dir.size, zip64: dir.zip64, cached: false, read: read };
        if (dir.size > max) return info;
        var bytes = new Uint8Array(dir.size);
        for (var pos = 0; pos < dir.size; pos += CHUNK) {
            var len = Math.min(CHUNK, dir.size - pos);
            bytes.set(await read(dir.offset + pos, len), pos);
            if (onProgress) onProgress(pos + len, dir.size);
        }
        var start = dir.offset;
        var end = dir.offset + dir.size;
        info.cached = true;
        info.read = async function (offset, length) {
            if (offset >= start && offset + length <= end) return bytes.subarray(offset - start, offset - start + length);
            return read(offset, length);
        };
        return info;
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
        // Saknas åtkomst- eller skapandetid i innehållsförteckningen kan den lokala posten ha dem.
        if (u16(local, 28) && entry.timeField !== 'NTFS' && (!entry.atime || !entry.crtime)) {
            readLocalTimes(await read(entry.localOffset + 30 + u16(local, 26), u16(local, 28)), entry);
        }
        var raw = await read(start, entry.compSize);
        var bytes = entry.method === 8 ? await (opts.inflate || inflateRaw)(raw) : raw;
        if (bytes.length !== entry.size) throw new Error(entry.name + ' har fel storlek efter uppackning.');
        return { bytes: bytes, crcOk: crc32(bytes) === entry.crc32 };
    }

    // Läser en post i bitar och lämnar varje uppackad bit till onChunk(bytes), så att även en post på
    // flera GB kan hashas utan att ligga i minnet. En liten post läses i samma läsning som sin lokala
    // post. Ingen CRC32-kontroll här: den görs när filen läses med extract(). Returnerar antalet
    // uppackade byte. opts.chunk: byte per läsning (testerna använder små bitar).
    var STREAM_CHUNK = 4 * 1024 * 1024;
    var LOCAL_SLACK = 4096;   // den lokala postens namn och extrafält ryms nästan alltid i det här
    async function stream(read, entry, onChunk, opts) {
        opts = opts || {};
        if (entry.flags & 1) throw new Error(entry.name + ' är krypterad i zippen och kan inte läsas.');
        if (entry.method !== 0 && entry.method !== 8) {
            throw new Error(entry.name + ' är komprimerad med metod ' + entry.method + ', som inte stöds (bara lagrad och deflate).');
        }
        var chunk = opts.chunk || STREAM_CHUNK;
        var first = await read(entry.localOffset, entry.compSize <= chunk ? 30 + LOCAL_SLACK + entry.compSize : 30);
        if (first.length < 30 || u32(first, 0) !== SIG_LOCAL) throw new Error('Den lokala posten för ' + entry.name + ' är trasig.');
        var skip = 30 + u16(first, 26) + u16(first, 28);
        var start = entry.localOffset + skip;
        var have = Math.max(0, Math.min(first.length - skip, entry.compSize));
        var pos = 0;
        async function nextPiece() {
            if (pos >= entry.compSize) return null;
            var piece = pos === 0 && have > 0 ? first.subarray(skip, skip + have) : await read(start + pos, Math.min(chunk, entry.compSize - pos));
            if (!piece.length) throw new Error(entry.name + ' slutar i förtid i zippen.');
            pos += piece.length;
            return piece;
        }
        var total = 0;
        if (entry.method === 0) {
            for (var p = await nextPiece(); p; p = await nextPiece()) { total += p.length; onChunk(p); }
        } else {
            if (typeof DecompressionStream !== 'function') throw new Error('Den här webbläsaren kan inte packa upp deflate.');
            var source = new ReadableStream({
                pull: async function (ctrl) {
                    var piece = await nextPiece();
                    if (piece) ctrl.enqueue(piece); else ctrl.close();
                },
            });
            var reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
            for (;;) {
                var r = await reader.read();
                if (r.done) break;
                total += r.value.length;
                onChunk(r.value);
            }
        }
        if (total !== entry.size) throw new Error(entry.name + ' har fel storlek efter uppackning.');
        return total;
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

    var api = { scan: scan, extract: extract, stream: stream, crc32: crc32, fileReader: fileReader, readDirectory: readDirectory, cacheDirectory: cacheDirectory, MAX_ENTRY: MAX_ENTRY, MAX_CACHED_DIRECTORY: MAX_CACHED_DIRECTORY };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ZipRead = api;
})(typeof window !== 'undefined' ? window : this);
