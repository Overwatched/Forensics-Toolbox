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
    // Större poster läses i bitar till en färdig array: File.arrayBuffer() och Response.arrayBuffer()
    // klarar inte 2 GB i Chromium. Någon fast gräns finns inte. Det som tar stopp är minnet.
    var PIECE = 64 * 1024 * 1024;

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

    // Tiderna i ett extrafält: 0x5455 (UT, Unix-sekunder) och 0x000A (NTFS: ändring, åtkomst och
    // skapande i UTC med 100 ns). UT har ändring, och i vissa zippar åtkomst och fler tider, enligt
    // flaggorna. Med fyra tider (flaggan 8, utanför Info-ZIP:s beskrivning) är den tredje inodens
    // ändringstid (ctime) och den fjärde skapandetiden: så ser det ut i alla poster i en iOS-extraktion
    // (docs/DEVELOPMENT.md). Med tre tider syns det inte i zippen om den tredje är skapad eller ctime.
    // Returnerar { m, a, ctime, c, third, field } eller null.
    function readTimes(b, id, body, len) {
        var end = body + len;
        if (id === 0x5455 && len >= 1) {
            var fl = b[body], q = body + 1, t = { m: null, a: null, ctime: null, c: null, third: null, field: 'UT' };
            if ((fl & 1) && q + 4 <= end) { t.m = u32(b, q) || null; q += 4; }
            if ((fl & 2) && q + 4 <= end) { t.a = u32(b, q) || null; q += 4; }
            if ((fl & 4) && q + 4 <= end) {
                var v3 = u32(b, q) || null;
                q += 4;
                if (fl & 8) t.ctime = v3; else t.third = v3;
            }
            if ((fl & 12) === 12 && q + 4 <= end) { t.c = u32(b, q) || null; q += 4; }
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
        if (t.ctime && !(only && e.ctime)) e.ctime = t.ctime;
        if (t.third && !(only && e.utThird)) e.utThird = t.third;
        // En känd skapandetid gör den osäkra tredje UT-tiden överflödig, och NTFS ersätter UT.
        if (e.crtime) e.utThird = null;
        if (t.field === 'NTFS' && !only) e.ctime = null;
        if (!e.timeField || t.field === 'NTFS') e.timeField = t.field;
    }

    var CUSTOM_LOCATION = 'com.apple.assetsd.customLocation';
    function hasAscii(b, start, len, word) {
        var last = start + len - word.length;
        for (var i = start; i <= last; i++) {
            var j = 0;
            while (j < word.length && b[i + j] === word.charCodeAt(j)) j++;
            if (j === word.length) return true;
        }
        return false;
    }

    // Fältet med rapportens uppgifter i en förteckning som byggts ur en UFDR (ufdr.js). En riktig zip har
    // inget sådant: fältet läses bara i en byggd förteckning, så att en zip inte kan låtsas ha rapportens tider.
    var REPORT_FIELD = 0x5546;
    function applyReportField(e, fields) {
        e.report = fields;
        e.timeField = 'report.xml';
        e.mtime = fields.m ? fields.m / 1000 : null;
        e.atime = fields.a ? fields.a / 1000 : null;
        e.crtime = fields.c ? fields.c / 1000 : null;
        e.ctime = fields.x ? fields.x / 1000 : null;
    }

    // Extrafälten: 0x0001 (Zip64-storlekar och offset), tiderna (UT och NTFS) och 0x4b47 (utökade attribut).
    function readExtra(b, start, end, e, built) {
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
            } else if (id === REPORT_FIELD) {
                if (built) applyReportField(e, JSON.parse(utf8.decode(b.subarray(body, body + len))));
            } else if (id === 0x4b47) {
                // Extraktionsverktygets fält med filens utökade attribut. Attributet finns när platsen satts i Bilder, men också på bilder med GPS i filen.
                if (hasAscii(b, body, len, CUSTOM_LOCATION)) e.customLocation = true;
            } else {
                setTimes(e, readTimes(b, id, body, len));
            }
            at = body + len;
        }
    }

    // Tiderna i den lokala postens extrafält: Info-ZIP skriver bara ändringstiden i
    // innehållsförteckningen och åtkomst och tredje tiden i den lokala posten.
    function readLocalTimes(b, e) {
        var at = 0;
        while (at + 4 <= b.length) {
            var len = u16(b, at + 2);
            if (at + 4 + len > b.length) break;
            setTimes(e, readTimes(b, u16(b, at), at + 4, len), true);
            at += 4 + len;
        }
    }

    // Posten på plats at i innehållsförteckningen, med tiderna och storlekarna ur extrafälten.
    function entryAt(buf, at, name, built) {
        var e = {
            name: name,
            flags: u16(buf, at + 8),
            method: u16(buf, at + 10),
            dosTime: dosTime(u16(buf, at + 12), u16(buf, at + 14)),
            crc32: u32(buf, at + 16),
            compSize: u32(buf, at + 20),
            size: u32(buf, at + 24),
            localOffset: u32(buf, at + 42),
            mtime: null, atime: null, crtime: null, ctime: null, utThird: null, timeField: '',
        };
        var nameLen = u16(buf, at + 28);
        readExtra(buf, at + 46 + nameLen, at + 46 + nameLen + u16(buf, at + 30), e, built);
        return e;
    }

    // En innehållsförteckning i minnet: namnen avkodas och platserna sparas första gången, så att varje
    // ny sökning bara går igenom listan med namn.
    function directoryIndex(d) {
        if (d.names) return d;
        var b = d.bytes;
        var names = [];
        var places = [];
        var at = 0;
        while (at + 46 <= b.length) {
            if (u32(b, at) !== SIG_CENTRAL) throw new Error('Innehållsförteckningen i zippen är trasig (post ' + (names.length + 1) + ').');
            var nameLen = u16(b, at + 28);
            var total = 46 + nameLen + u16(b, at + 30) + u16(b, at + 32);
            if (at + total > b.length) break;
            names.push(utf8.decode(b.subarray(at + 46, at + 46 + nameLen)));
            places.push(at);
            at += total;
        }
        if (at !== b.length) throw new Error('Innehållsförteckningen i zippen slutar mitt i en post.');
        d.names = names;
        d.places = Uint32Array.from(places);
        return d;
    }

    // Posten med filens riktiga tider, när zippen har dem i en egen fil (fs-times.js).
    function withTimes(e, times) { return times ? times.apply(e) : e; }

    // Ett tal ur filnamnet utan mapp, med små bokstäver. Två namn kan få samma tal: uppslaget ger bara
    // vilka poster som är värda att pröva.
    function baseKey(lowerBase) {
        var h = 0x811c9dc5;
        for (var i = 0; i < lowerBase.length; i++) h = Math.imul(h ^ lowerBase.charCodeAt(i), 0x01000193);
        return h >>> 0;
    }
    function lowerBase(name) { return name.slice(name.lastIndexOf('/') + 1).toLowerCase(); }

    // Posternas nummer ordnade i 65 536 fack efter talets översta bitar: start[f]..start[f + 1] i order är fack f.
    function buckets(keys) {
        var start = new Uint32Array(65537);
        for (var i = 0; i < keys.length; i++) start[(keys[i] >>> 16) + 1]++;
        for (var f = 0; f < 65536; f++) start[f + 1] += start[f];
        var next = start.slice(0, 65536);
        var order = new Uint32Array(keys.length);
        for (var k = 0; k < keys.length; k++) order[next[keys[k] >>> 16]++] = k;
        return { start: start, order: order };
    }

    // Uppslaget i förteckningen: efter filnamn (utan mapp, små bokstäver) och efter CRC32. Det byggs första gången
    // en sökning säger vad den letar efter (hints nedan), och ligger sedan kvar så länge förteckningen gör det.
    function lookup(index) {
        if (index.byBase) return index;
        var n = index.names.length;
        var b = index.bytes;
        var bases = new Uint32Array(n);
        var crcs = new Uint32Array(n);
        for (var i = 0; i < n; i++) {
            bases[i] = baseKey(lowerBase(index.names[i]));
            crcs[i] = u32(b, index.places[i] + 16);
        }
        index.byBase = buckets(bases);
        index.byCrc = buckets(crcs);
        return index;
    }

    // Posterna som en sökning med hints kan gälla, i förteckningens ordning. keep.bases är filnamnen (utan mapp,
    // små bokstäver) som keep kan säga ja till, och keep.crc en CRC32 som den också säger ja till. Den som sätter
    // dem lovar att keep säger nej till alla andra poster. keep avgör fortfarande varje post.
    function hinted(index, keep) {
        lookup(index);
        var picked = [];
        var take = function (by, key) {
            var f = key >>> 16;
            for (var i = by.start[f]; i < by.start[f + 1]; i++) picked.push(by.order[i]);
        };
        keep.bases.forEach(function (base) { take(index.byBase, baseKey(String(base))); });
        if (keep.crc != null) take(index.byCrc, keep.crc >>> 0);
        picked.sort(function (x, y) { return x - y; });
        return picked.filter(function (x, i) { return i === 0 || picked[i - 1] !== x; });
    }

    function scanIndexed(d, keep, onProgress, times) {
        var index = directoryIndex(d);
        var b = index.bytes;
        var kept = [];
        var only = Array.isArray(keep.bases) ? hinted(index, keep) : null;
        var count = only ? only.length : index.names.length;
        for (var k = 0; k < count; k++) {
            var i = only ? only[k] : k;
            var at = index.places[i];
            if (keep(index.names[i], u32(b, at + 24), u32(b, at + 16))) kept.push(withTimes(entryAt(b, at, index.names[i], d.built), times));
        }
        if (onProgress) onProgress(index.size, index.size);
        return { entries: kept, count: index.names.length, expected: index.entries, zip64: index.zip64, directorySize: index.size };
    }

    // Går igenom hela innehållsförteckningen i bitar och sparar bara poster där keep(namn, storlek, crc32) är sant.
    // onProgress(lästa byte, totalt) anropas efter varje bit. Är förteckningen i minnet (cacheDirectory)
    // används den färdiga listan med namn, och en sökning efter bestämda filnamn eller en CRC32 (keep.bases,
    // keep.crc, se hinted) slår upp dem i stället för att gå igenom alla poster. Svaret är detsamma.
    async function scan(read, size, keep, onProgress) {
        if (read.directory) return scanIndexed(read.directory, keep, onProgress, read.fsTimes);
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
                if (keep(name, u32(buf, at + 24), u32(buf, at + 16))) kept.push(withTimes(entryAt(buf, at, name), read.fsTimes));
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
    // (databaserna, filen, kopior, Snapchats poster) går mot minnet i stället för disken, och namnen
    // bara avkodas en gång (read.directory, som scan känner igen).
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
        info.read.directory = { bytes: bytes, size: dir.size, entries: dir.entries, zip64: dir.zip64, names: null, places: null };
        info.read.fsTimes = read.fsTimes;
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

    function crcUpdate(c, part) {
        for (var i = 0, n = part.length; i < n; i++) c = CRC_TABLE[(c ^ part[i]) & 0xff] ^ (c >>> 8);
        return c;
    }

    // Bit för bit: en enda slinga över flera GB kan optimeras dåligt i V8 (en gång 149 s mot 14 s på 5 GB).
    function crc32(bytes) {
        var c = 0xffffffff;
        for (var at = 0; at < bytes.length; at += PIECE) c = crcUpdate(c, bytes.subarray(at, at + PIECE));
        return (c ^ 0xffffffff) >>> 0;
    }

    // Släpper fram annat arbete i appen. MessageChannel, eftersom setTimeout bromsas i ett dolt fönster.
    function pause() {
        return new Promise(function (resolve) {
            if (typeof MessageChannel === 'undefined') { resolve(); return; }
            var ch = new MessageChannel();
            ch.port1.onmessage = function () { ch.port1.close(); resolve(); };
            ch.port2.postMessage(0);
        });
    }

    // Väntar tills sidan har ritat, så att en lägestext som just satts syns innan ett arbete utan pauser börjar
    // (en fråga i sql.js, en avkodning). pause() släpper fram annat arbete men lovar ingen ritning: texten före
    // står då kvar på skärmen fast arbetet har gått vidare. I ett dolt fönster ritas inget, och där räcker pause().
    function painted() {
        if (typeof requestAnimationFrame === 'undefined' || typeof document === 'undefined' || document.hidden) return pause();
        return new Promise(function (resolve) {
            var done = false;
            function finish() { if (!done) { done = true; resolve(); } }
            // Sidan ritar direkt efter requestAnimationFrame, och pausen efteråt väntar ut det.
            requestAnimationFrame(function () { pause().then(finish); });
            // Fönstret kan ha dolts under tiden. Då kommer ingen ritning, och arbetet ska inte vänta på den.
            setTimeout(finish, 250);
        });
    }

    function sizeInGb(size) {
        return (size / 1073741824).toFixed(1).replace('.', ',') + ' GB';
    }

    // Slut på minne i en array går att fånga. Då ska beskedet säga vad det gäller och vad som går att göra.
    function isOutOfMemory(err) {
        return err instanceof RangeError && /allocation|memory/i.test(String(err.message));
    }

    function memoryError(name, size) {
        var err = new Error(name + ' är ' + sizeInGb(size) + ' och får inte plats i minnet här. Stäng andra verktyg och program och försök igen. ' +
            'En krypterad databas behöver ungefär dubbelt så mycket ledigt minne som sin storlek.');
        err.code = 'MEMORY';
        return err;
    }

    function friendlyMemory(err, name, size) {
        return isOutOfMemory(err) ? memoryError(name, size) : err;
    }

    function allocate(name, size, opts) {
        try { return opts && opts.alloc ? opts.alloc(size) : new Uint8Array(size); }
        catch (err) { throw friendlyMemory(err, name, size); }
    }

    async function inflateRaw(bytes) {
        if (typeof DecompressionStream !== 'function') throw new Error('Den här webbläsaren kan inte packa upp deflate.');
        var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    // Raden i en rapport utan fil i rapporten. En tom fil har inget att läsa; har filen storlek går den inte att få fram.
    function noData(entry) {
        if (entry.size) throw new Error(entry.name + ' står i report.xml, men filen finns inte i rapporten.');
        return new Uint8Array(0);
    }

    // Läser ut en post till minnet. Returnerar { bytes, crcOk }. opts.inflate och opts.alloc kan bytas ut
    // i testerna, och opts.piece är gränsen för vad som läses på en gång.
    async function extract(read, entry, opts) {
        opts = opts || {};
        if (entry.report && entry.report.noData) return { bytes: noData(entry), crcOk: true };
        if (entry.flags & 1) throw new Error(entry.name + ' är krypterad i zippen och kan inte läsas.');
        if (entry.method !== 0 && entry.method !== 8) {
            throw new Error(entry.name + ' är komprimerad med metod ' + entry.method + ', som inte stöds (bara lagrad och deflate).');
        }
        var local = await read(entry.localOffset, 30);
        if (u32(local, 0) !== SIG_LOCAL) throw new Error('Den lokala posten för ' + entry.name + ' är trasig.');
        var start = entry.localOffset + 30 + u16(local, 26) + u16(local, 28);
        // Saknas åtkomst- eller skapandetid i innehållsförteckningen kan den lokala posten ha dem. Inte i en
        // rapport eller med tiderna ur metadata.msgpack: där är den källan, och den lokala posten säger något annat.
        if (u16(local, 28) && entry.timeField !== 'NTFS' && entry.timeField !== 'metadata.msgpack' && !entry.report && (!entry.atime || !(entry.crtime || entry.utThird))) {
            readLocalTimes(await read(entry.localOffset + 30 + u16(local, 26), u16(local, 28)), entry);
        }
        var piece = opts.piece || PIECE;
        if (entry.size > piece || entry.compSize > piece) return extractInPieces(read, entry, opts);
        var raw = await read(start, entry.compSize);
        var bytes = entry.method === 8 ? await (opts.inflate || inflateRaw)(raw) : raw;
        if (bytes.length !== entry.size) throw new Error(entry.name + ' har fel storlek efter uppackning.');
        return { bytes: bytes, crcOk: crc32(bytes) === entry.crc32 };
    }

    // En stor post. CRC32 räknas under läsningen, så att sidan inte står still under en andra genomgång.
    async function extractInPieces(read, entry, opts) {
        var out = allocate(entry.name, entry.size, opts);
        var at = 0;
        var c = 0xffffffff;
        await stream(read, entry, function (part) {
            if (at + part.length > out.length) throw new Error(entry.name + ' har fel storlek efter uppackning.');
            out.set(part, at);
            at += part.length;
            c = crcUpdate(c, part);
        }, opts.piece ? { chunk: opts.piece } : null);
        return { bytes: out, crcOk: ((c ^ 0xffffffff) >>> 0) === entry.crc32 };
    }

    // Läser en post i bitar och lämnar varje uppackad bit till onChunk(bytes), så att även en post på
    // flera GB kan hashas utan att ligga i minnet. En liten post läses i samma läsning som sin lokala
    // post. Ingen CRC32-kontroll här: den görs när filen läses med extract(). Returnerar antalet
    // uppackade byte. opts.chunk: byte per läsning (testerna använder små bitar).
    var STREAM_CHUNK = 4 * 1024 * 1024;
    var LOCAL_SLACK = 4096;   // den lokala postens namn och extrafält ryms nästan alltid i det här
    async function stream(read, entry, onChunk, opts) {
        opts = opts || {};
        if (entry.report && entry.report.noData) { noData(entry); return 0; }
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

    // En hel fil från disk, i bitar som zippens stora poster. Bara läsning.
    async function readFile(file, opts) {
        var piece = opts && opts.piece || PIECE;
        var out = allocate(file.name, file.size, opts);
        var read = fileReader(file);
        for (var at = 0; at < file.size; at += piece) out.set(await read(at, Math.min(piece, file.size - at)), at);
        return out;
    }

    var api = { scan: scan, extract: extract, stream: stream, crc32: crc32, fileReader: fileReader, readFile: readFile, readDirectory: readDirectory, cacheDirectory: cacheDirectory, pause: pause, painted: painted, friendlyMemory: friendlyMemory, MAX_CACHED_DIRECTORY: MAX_CACHED_DIRECTORY };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ZipRead = api;
})(typeof window !== 'undefined' ? window : this);
