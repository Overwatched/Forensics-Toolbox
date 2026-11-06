// Filernas tider i en zip som har metadata bredvid filsystemet: metadataN/metadata.msgpack hör till filesystemN/.
// I sådana zippar håller zippens egna tidsfält bara åtkomsttiden, tre gånger om, så det är bara här de riktiga
// tiderna finns. Filen är en karta från sökväg (utan filesystemN/) till btime, mtime, ctime och atime i
// nanosekunder, mode och xattr. Prövat på två extraktioner från iPhone, med 100 % av filerna i kartan
// (docs/DEVELOPMENT.md). Läses en gång och hålls i minnet. Inget skrivs. Testas i Node.
(function (root) {
    'use strict';

    // ZipRead är global i webbläsaren. I Node skickas den in med use().
    var deps = {};
    function dep(name) {
        if (deps[name]) return deps[name];
        if (typeof root[name] !== 'undefined') return root[name];
        throw new Error(name + ' saknas');
    }

    var META_RE = /^metadata(\d+)\/metadata\.msgpack$/;
    var HEAD_RE = /^(extra\/|filesystem\d*\/|metadata\d+\/|version$|Log\.txt$)/;
    var CUSTOM_LOCATION = 'com.apple.assetsd.customLocation';
    var S_IFMT = 61440;
    var S_IFDIR = 16384;

    var utf8 = new TextDecoder('utf-8');

    function u16(b, at) { return (b[at] << 8) | b[at + 1]; }
    function u32(b, at) { return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0; }

    // Var nästa värde slutar. Rekursivt för kartor och listor, som inte är djupa här.
    function skip(b, at) {
        var c = b[at++];
        if (c <= 0x7f || c >= 0xe0 || c === 0xc0 || c === 0xc2 || c === 0xc3) return at;
        if (c >= 0xa0 && c <= 0xbf) return at + (c & 0x1f);
        var n = -1;
        if (c >= 0x80 && c <= 0x8f) n = (c & 15) * 2;
        else if (c >= 0x90 && c <= 0x9f) n = c & 15;
        else if (c === 0xdc) { n = u16(b, at); at += 2; }
        else if (c === 0xdd) { n = u32(b, at); at += 4; }
        else if (c === 0xde) { n = u16(b, at) * 2; at += 2; }
        else if (c === 0xdf) { n = u32(b, at) * 2; at += 4; }
        if (n >= 0) { for (var i = 0; i < n; i++) at = skip(b, at); return at; }
        switch (c) {
            case 0xc4: case 0xd9: return at + 1 + b[at];
            case 0xc5: case 0xda: return at + 2 + u16(b, at);
            case 0xc6: case 0xdb: return at + 4 + u32(b, at);
            case 0xc7: return at + 2 + b[at];
            case 0xc8: return at + 3 + u16(b, at);
            case 0xc9: return at + 5 + u32(b, at);
            case 0xcc: case 0xd0: return at + 1;
            case 0xcd: case 0xd1: return at + 2;
            case 0xca: case 0xce: case 0xd2: return at + 4;
            case 0xcb: case 0xcf: case 0xd3: return at + 8;
            case 0xd4: return at + 2;
            case 0xd5: return at + 3;
            case 0xd6: return at + 5;
            case 0xd7: return at + 9;
            case 0xd8: return at + 17;
        }
        throw new Error('metadata.msgpack går inte att tolka (byte ' + c + ').');
    }

    // Antal par i kartan vid at: [par, plats efter huvudet], eller null om det inte är en karta.
    function mapHead(b, at) {
        var c = b[at];
        if (c >= 0x80 && c <= 0x8f) return [c & 15, at + 1];
        if (c === 0xde) return [u16(b, at + 1), at + 3];
        if (c === 0xdf) return [u32(b, at + 1), at + 5];
        return null;
    }

    // En sträng vid at: [början, längd]. Null om det inte är en sträng.
    function strHead(b, at) {
        var c = b[at];
        if (c >= 0xa0 && c <= 0xbf) return [at + 1, c & 0x1f];
        if (c === 0xd9) return [at + 2, b[at + 1]];
        if (c === 0xda) return [at + 3, u16(b, at + 1)];
        if (c === 0xdb) return [at + 5, u32(b, at + 1)];
        return null;
    }

    function isWord(b, s, n, word) {
        if (n !== word.length) return false;
        for (var i = 0; i < n; i++) if (b[s + i] !== word.charCodeAt(i)) return false;
        return true;
    }

    // Nanosekunder som ett heltal till närmaste millisekund, exakt: 2^32 = 4294 * 10^6 + 967296. Noll och mindre är
    // ingen tid. Att bara kapa ger en skillnad på 1 ms mot bildbiblioteket och rapporter, där tiden också är avrundad.
    function nsToMs(b, at) {
        var c = b[at];
        if (c <= 0x7f) return c ? 0 : null;
        if (c === 0xcc) return null;
        if (c === 0xcd) return null;
        if (c === 0xce) return Math.round(u32(b, at + 1) / 1e6);
        if (c === 0xcf || c === 0xd3) {
            var hi = u32(b, at + 1), lo = u32(b, at + 5);
            if (c === 0xd3 && hi >= 0x80000000) return null;
            if (!hi && !lo) return null;
            return hi * 4294 + Math.floor((hi * 967296 + lo + 500000) / 1e6);
        }
        return null;
    }

    // Kartan i filen: bara filer, inte kataloger. Returnerar { map: sökväg -> rad, times: [btime, mtime, ctime, atime] per
    // rad i ms med NaN för ingen tid, custom: rader med attributet för en plats satt i Bilder, count }.
    function parse(b) {
        var top = mapHead(b, 0);
        if (!top) throw new Error('metadata.msgpack är ingen karta.');
        var pairs = top[0];
        var at = top[1];
        var map = new Map();
        var times = new Float64Array(pairs * 4);
        var custom = new Set();
        var row = 0;
        for (var i = 0; i < pairs; i++) {
            var key = strHead(b, at);
            if (!key) throw new Error('metadata.msgpack har en post utan sökväg.');
            var keyAt = key[0], keyLen = key[1];
            at = keyAt + keyLen;
            var head = mapHead(b, at);
            if (!head) { at = skip(b, at); continue; }
            var fields = head[0];
            at = head[1];
            var bt = null, mt = null, ct = null, atm = null, mode = null, hasCustom = false;
            for (var f = 0; f < fields; f++) {
                var name = strHead(b, at);
                if (!name) throw new Error('metadata.msgpack har ett fält utan namn.');
                var s = name[0], n = name[1];
                at = s + n;
                if (n === 5) {
                    if (isWord(b, s, n, 'btime')) bt = nsToMs(b, at);
                    else if (isWord(b, s, n, 'mtime')) mt = nsToMs(b, at);
                    else if (isWord(b, s, n, 'ctime')) ct = nsToMs(b, at);
                    else if (isWord(b, s, n, 'atime')) atm = nsToMs(b, at);
                    else if (isWord(b, s, n, 'xattr')) {
                        var xh = mapHead(b, at);
                        if (xh) {
                            var xat = xh[1];
                            for (var x = 0; x < xh[0]; x++) {
                                var xk = strHead(b, xat);
                                if (!xk) break;
                                if (isWord(b, xk[0], xk[1], CUSTOM_LOCATION)) hasCustom = true;
                                xat = skip(b, xk[0] + xk[1]);
                            }
                        }
                    }
                } else if (n === 4 && isWord(b, s, n, 'mode')) {
                    var mc = b[at];
                    mode = mc <= 0x7f ? mc : mc === 0xcd ? u16(b, at + 1) : mc === 0xce ? u32(b, at + 1) : null;
                }
                at = skip(b, at);
            }
            if (mode !== null && (mode & S_IFMT) === S_IFDIR) continue;
            map.set(utf8.decode(b.subarray(keyAt, keyAt + keyLen)), row);
            times[row * 4] = bt === null ? NaN : bt;
            times[row * 4 + 1] = mt === null ? NaN : mt;
            times[row * 4 + 2] = ct === null ? NaN : ct;
            times[row * 4 + 3] = atm === null ? NaN : atm;
            if (hasCustom) custom.add(row);
            row++;
        }
        return { map: map, times: times, custom: custom, count: row };
    }

    function sec(ms) { return ms === ms ? ms / 1000 : null; }

    // Sätter de riktiga tiderna på en post under filesystemN/. En post utan rad får inga tider: fälten i zippen säger inget.
    function applyTo(parts, e) {
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i];
            if (e.name.indexOf(p.prefix) !== 0) continue;
            var row = p.table.map.get(e.name.slice(p.prefix.length));
            var t = p.table.times;
            e.utThird = null;
            e.dosTime = '';
            e.timeField = 'metadata.msgpack';
            if (row === undefined) { e.crtime = e.mtime = e.ctime = e.atime = null; return e; }
            e.crtime = sec(t[row * 4]);
            e.mtime = sec(t[row * 4 + 1]);
            e.ctime = sec(t[row * 4 + 2]);
            e.atime = sec(t[row * 4 + 3]);
            if (p.table.custom.has(row)) e.customLocation = true;
            return e;
        }
        return e;
    }

    function firstName(head) {
        if (head.length < 30 || head[0] !== 0x50 || head[1] !== 0x4b) return '';
        var len = head[26] | (head[27] << 8);
        return utf8.decode(head.subarray(30, Math.min(30 + len, head.length)));
    }

    // Tiderna i zippen, eller null när den inte har någon sådan fil. Letar bara i zippar som börjar som de här gör, för
    // att slippa läsa innehållsförteckningen en extra gång i andra. opts.onStart() när filen ska läsas.
    async function load(read, size, opts) {
        var ZipRead = dep('ZipRead');
        var head = await read(0, Math.min(size, 512));
        if (!HEAD_RE.test(firstName(head))) return null;
        var scan = await ZipRead.scan(read, size, function (n) { return META_RE.test(n); });
        if (!scan.entries.length) return null;
        if (opts && opts.onStart) opts.onStart();
        var parts = [];
        var count = 0;
        for (var i = 0; i < scan.entries.length; i++) {
            var e = scan.entries[i];
            var table = parse((await ZipRead.extract(read, e)).bytes);
            count += table.count;
            parts.push({ prefix: 'filesystem' + META_RE.exec(e.name)[1] + '/', table: table });
        }
        return { count: count, apply: function (entry) { return applyTo(parts, entry); } };
    }

    var api = {
        use: function (d) { Object.keys(d).forEach(function (k) { deps[k] = d[k]; }); },
        load: load, parse: parse, nsToMs: nsToMs,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.FsTimes = api;
})(typeof window !== 'undefined' ? window : this);
