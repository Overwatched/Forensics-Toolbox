// DEFLATE (RFC 1951) med gzip- och zlib-huvud, synkront. Webbläsarens DecompressionStream är asynkron, men
// Queries avkodar en databas medan den öppnas (som Telegrams tabeller), och det sker synkront. Används för
// små poster: anteckningarnas text i NoteStore.sqlite. Testas i Node mot zlib (inflate.test.js).
//
//   Inflate.raw(bytes)    rå DEFLATE
//   Inflate.gunzip(bytes) gzip (1f 8b), zlib (78 ..) eller rå, efter huvudet
(function (root) {
    'use strict';

    var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    var ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

    // Ett Huffman-träd som antal per längd och symbolerna i ordning (som i zlibs puff.c).
    function tree(lengths, n) {
        var count = new Uint16Array(16), symbol = new Uint16Array(n), offs = new Uint16Array(16), i;
        for (i = 0; i < n; i++) count[lengths[i]]++;
        count[0] = 0;
        for (i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
        for (i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
        return { count: count, symbol: symbol };
    }

    var FIXED = (function () {
        var l = new Uint8Array(288), i;
        for (i = 0; i < 144; i++) l[i] = 8;
        for (; i < 256; i++) l[i] = 9;
        for (; i < 280; i++) l[i] = 7;
        for (; i < 288; i++) l[i] = 8;
        var d = new Uint8Array(30);
        for (i = 0; i < 30; i++) d[i] = 5;
        return { lit: tree(l, 288), dist: tree(d, 30) };
    })();

    function raw(input) {
        var src = input instanceof Uint8Array ? input : new Uint8Array(input);
        var pos = 0, bitBuf = 0, bitCnt = 0;
        var out = new Uint8Array(Math.max(1024, src.length * 4)), outLen = 0;
        function need(n) {
            if (outLen + n <= out.length) return;
            var bigger = new Uint8Array(Math.max(out.length * 2, outLen + n));
            bigger.set(out.subarray(0, outLen));
            out = bigger;
        }
        function bits(n) {
            while (bitCnt < n) {
                if (pos >= src.length) throw new Error('DEFLATE: datan tar slut');
                bitBuf |= src[pos++] << bitCnt;
                bitCnt += 8;
            }
            var v = bitBuf & ((1 << n) - 1);
            bitBuf >>>= n;
            bitCnt -= n;
            return v;
        }
        function decode(t) {
            var code = 0, first = 0, index = 0;
            for (var len = 1; len < 16; len++) {
                code |= bits(1);
                var c = t.count[len];
                if (code - c < first) return t.symbol[index + (code - first)];
                index += c;
                first += c;
                first <<= 1;
                code <<= 1;
            }
            throw new Error('DEFLATE: ogiltig kod');
        }
        function block(lit, dist) {
            for (;;) {
                var sym = decode(lit);
                if (sym < 256) { need(1); out[outLen++] = sym; continue; }
                if (sym === 256) return;
                sym -= 257;
                if (sym >= 29) throw new Error('DEFLATE: ogiltig längd');
                var len = LEN_BASE[sym] + bits(LEN_EXTRA[sym]);
                var ds = decode(dist);
                if (ds >= 30) throw new Error('DEFLATE: ogiltigt avstånd');
                var d = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
                if (d > outLen) throw new Error('DEFLATE: avståndet pekar före början');
                need(len);
                for (var k = 0; k < len; k++) { out[outLen] = out[outLen - d]; outLen++; }
            }
        }
        var last;
        do {
            last = bits(1);
            var type = bits(2);
            if (type === 0) {
                bitBuf = 0; bitCnt = 0;
                if (pos + 4 > src.length) throw new Error('DEFLATE: datan tar slut');
                var len = src[pos] | (src[pos + 1] << 8), nlen = src[pos + 2] | (src[pos + 3] << 8);
                pos += 4;
                if ((len ^ 0xffff) !== nlen) throw new Error('DEFLATE: fel längd i ett okomprimerat block');
                if (pos + len > src.length) throw new Error('DEFLATE: datan tar slut');
                need(len);
                out.set(src.subarray(pos, pos + len), outLen);
                outLen += len; pos += len;
            } else if (type === 1) {
                block(FIXED.lit, FIXED.dist);
            } else if (type === 2) {
                var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4, i;
                var cl = new Uint8Array(19);
                for (i = 0; i < hclen; i++) cl[ORDER[i]] = bits(3);
                var clTree = tree(cl, 19);
                var lens = new Uint8Array(hlit + hdist);
                for (i = 0; i < hlit + hdist;) {
                    var s = decode(clTree);
                    if (s < 16) { lens[i++] = s; continue; }
                    var rep = 0, val = 0;
                    if (s === 16) { if (!i) throw new Error('DEFLATE: upprepning utan värde'); val = lens[i - 1]; rep = 3 + bits(2); }
                    else if (s === 17) rep = 3 + bits(3);
                    else rep = 11 + bits(7);
                    if (i + rep > hlit + hdist) throw new Error('DEFLATE: för många längder');
                    while (rep--) lens[i++] = val;
                }
                block(tree(lens.subarray(0, hlit), hlit), tree(lens.subarray(hlit), hdist));
            } else {
                throw new Error('DEFLATE: ogiltig blocktyp');
            }
        } while (!last);
        return out.slice(0, outLen);
    }

    function gunzip(input) {
        var b = input instanceof Uint8Array ? input : new Uint8Array(input);
        if (b.length >= 18 && b[0] === 0x1f && b[1] === 0x8b) {
            if (b[2] !== 8) throw new Error('gzip: okänd komprimering ' + b[2]);
            var flags = b[3], p = 10;
            if (flags & 4) p += 2 + (b[p] | (b[p + 1] << 8));
            if (flags & 8) { while (p < b.length && b[p]) p++; p++; }
            if (flags & 16) { while (p < b.length && b[p]) p++; p++; }
            if (flags & 2) p += 2;
            return raw(b.subarray(p));
        }
        if (b.length >= 2 && (b[0] & 0x0f) === 8 && ((b[0] << 8) | b[1]) % 31 === 0) return raw(b.subarray(2));
        return raw(b);
    }

    var api = { raw: raw, gunzip: gunzip };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Inflate = api;
})(typeof window !== 'undefined' ? window : this);
