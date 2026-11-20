// ASTC (LDR, 2D) avkodad i JavaScript, och Apples texturfil (.atx) som iPhonens bakgrund sparas i från iOS 16
// (PosterBoard: RuntimeSnapshot-home.atx och -lock.atx). Utan WebAssembly, så att det fungerar i html-versionen.
// Följer Khronos specifikation för ASTC: blockläget, partitionerna, färgändpunkterna (CEM), heltalsföljden (ISE)
// med trits och quints, vikternas utfyllnad och två plan. HDR ritas i magenta, som specifikationens felfärg.
// Testas i Node (astc.test.js).
(function (root) {
    'use strict';

    // Kvantiseringsnivåerna: [trits, quints, bitar] per nivå, i specifikationens ordning (2, 3, 4, 5, 6, 8 … 256).
    var LEVELS = [
        [0, 0, 1], [1, 0, 0], [0, 0, 2], [0, 1, 0], [1, 0, 1], [0, 0, 3], [0, 1, 1], [1, 0, 2], [0, 0, 4], [0, 1, 2], [1, 0, 3],
        [0, 0, 5], [0, 1, 3], [1, 0, 4], [0, 0, 6], [0, 1, 4], [1, 0, 5], [0, 0, 7], [0, 1, 5], [1, 0, 6], [0, 0, 8],
    ];

    function iseBits(count, level) {
        var t = LEVELS[level];
        return count * t[2] + (t[0] ? Math.floor((8 * count + 4) / 5) : 0) + (t[1] ? Math.floor((7 * count + 2) / 3) : 0);
    }

    // Bitarna i ett block (128 bitar, minst signifikant först). reversed: vikterna läses bakifrån.
    function Bits(bytes, at, reversed) {
        this.b = bytes;
        this.at = at;
        this.rev = reversed;
    }
    Bits.prototype.bit = function (i) {
        if (i < 0 || i > 127) return 0;
        var k = this.rev ? 127 - i : i;
        return (this.b[this.at + (k >> 3)] >> (k & 7)) & 1;
    };
    Bits.prototype.get = function (start, count) {
        var v = 0;
        for (var i = 0; i < count; i++) v |= this.bit(start + i) << i;
        return v >>> 0;
    };

    // En heltalsföljd (ISE) med count värden på nivån level, från bit start till end (bitar efter end är noll).
    function iseDecode(bits, start, end, count, level) {
        var t = LEVELS[level], n = t[2], out = new Array(count), pos = start;
        var read = function (k) {
            var v = 0;
            for (var i = 0; i < k; i++) { if (pos < end) v |= bits.bit(pos) << i; pos++; }
            return v;
        };
        var i, j, m;
        if (t[0]) {
            for (i = 0; i < count; i += 5) {
                m = [0, 0, 0, 0, 0];
                var T = 0;
                m[0] = read(n); T |= read(2);
                m[1] = read(n); T |= read(2) << 2;
                m[2] = read(n); T |= read(1) << 4;
                m[3] = read(n); T |= read(2) << 5;
                m[4] = read(n); T |= read(1) << 7;
                var tr = trits(T);
                for (j = 0; j < 5 && i + j < count; j++) out[i + j] = (tr[j] << n) | m[j];
            }
        } else if (t[1]) {
            for (i = 0; i < count; i += 3) {
                m = [0, 0, 0];
                var Q = 0;
                m[0] = read(n); Q |= read(3);
                m[1] = read(n); Q |= read(2) << 3;
                m[2] = read(n); Q |= read(2) << 5;
                var q = quints(Q);
                for (j = 0; j < 3 && i + j < count; j++) out[i + j] = (q[j] << n) | m[j];
            }
        } else {
            for (i = 0; i < count; i++) out[i] = read(n);
        }
        return out;
    }

    function bitsOf(v, hi, lo) { return (v >> lo) & ((1 << (hi - lo + 1)) - 1); }

    function trits(T) {
        var C, t4, t3, t2, t1, t0;
        if (bitsOf(T, 4, 2) === 7) {
            C = (bitsOf(T, 7, 5) << 2) | bitsOf(T, 1, 0);
            t4 = 2; t3 = 2;
        } else {
            C = bitsOf(T, 4, 0);
            if (bitsOf(T, 6, 5) === 3) { t4 = 2; t3 = bitsOf(T, 7, 7); } else { t4 = bitsOf(T, 7, 7); t3 = bitsOf(T, 6, 5); }
        }
        if (bitsOf(C, 1, 0) === 3) {
            t2 = 2; t1 = bitsOf(C, 4, 4);
            t0 = (bitsOf(C, 3, 3) << 1) | (bitsOf(C, 2, 2) & ~bitsOf(C, 3, 3) & 1);
        } else if (bitsOf(C, 3, 2) === 3) {
            t2 = 2; t1 = 2; t0 = bitsOf(C, 1, 0);
        } else {
            t2 = bitsOf(C, 4, 4); t1 = bitsOf(C, 3, 2);
            t0 = (bitsOf(C, 1, 1) << 1) | (bitsOf(C, 0, 0) & ~bitsOf(C, 1, 1) & 1);
        }
        return [t0, t1, t2, t3, t4];
    }

    function quints(Q) {
        var C, q2, q1, q0;
        if (bitsOf(Q, 2, 1) === 3 && bitsOf(Q, 6, 5) === 0) {
            var q0b = bitsOf(Q, 0, 0);
            q2 = (q0b << 2) | ((bitsOf(Q, 4, 4) & ~q0b & 1) << 1) | (bitsOf(Q, 3, 3) & ~q0b & 1);
            q1 = 4; q0 = 4;
        } else {
            if (bitsOf(Q, 2, 1) === 3) {
                q2 = 4;
                C = (bitsOf(Q, 4, 3) << 3) | ((~bitsOf(Q, 6, 5) & 3) << 1) | bitsOf(Q, 0, 0);
            } else {
                q2 = bitsOf(Q, 6, 5);
                C = bitsOf(Q, 4, 0);
            }
            if (bitsOf(C, 2, 0) === 5) { q1 = 4; q0 = bitsOf(C, 4, 3); } else { q1 = bitsOf(C, 4, 3); q0 = bitsOf(C, 2, 0); }
        }
        return [q0, q1, q2];
    }

    // Bitmönstret B i specifikationens tabeller: en sträng med bitarna från den högsta, där bokstäverna är värdets
    // bitar (b = bit 1, c = bit 2 …) och 0 är noll.
    function layout(pattern, m) {
        var v = 0;
        for (var i = 0; i < pattern.length; i++) {
            var ch = pattern.charAt(i), bit = ch === '0' ? 0 : (m >> (ch.charCodeAt(0) - 97)) & 1;
            v = (v << 1) | bit;
        }
        return v;
    }

    // Färgvärdena till 0–255.
    // Nyckeln är nivån: 4 = 0..5, 6 = 0..9, 7 = 0..11, 9 = 0..19, 10 = 0..23, 12 = 0..39, 13 = 0..47, 15 = 0..79,
    // 16 = 0..95, 18 = 0..159, 19 = 0..191.
    var COLOR_TQ = {
        4: ['000000000', 204], 6: ['000000000', 113], 7: ['b000b0bb0', 93], 9: ['b0000bb00', 54], 10: ['cb000cbcb', 44],
        12: ['cb0000cbc', 26], 13: ['dcb000dcb', 22], 15: ['dcb0000dc', 11], 16: ['edcb000ed', 11], 18: ['edcb0000e', 5],
        19: ['fedcb000f', 5],
    };
    function unquantColor(v, level) {
        var t = LEVELS[level], n = t[2];
        if (!t[0] && !t[1]) return replicate(v, n, 8);
        var tq = COLOR_TQ[level], a = v & 1, D = v >> n, A = a ? 0x1ff : 0;
        var T = D * tq[1] + layout(tq[0], v);
        T ^= A;
        return ((A & 0x80) | (T >> 2)) & 0xff;
    }

    // Vikterna till 0–64.
    var WEIGHT_TQ = { 4: ['0000000', 50], 6: ['0000000', 28], 7: ['b000b0b', 23], 9: ['b0000b0', 13], 10: ['cb000cb', 11] };
    function unquantWeight(v, level) {
        var t = LEVELS[level], n = t[2], w;
        if (level === 1) w = [0, 32, 63][v];
        else if (level === 3) w = [0, 16, 32, 47, 63][v];
        else if (!t[0] && !t[1]) w = replicate(v, n, 6);
        else {
            var tq = WEIGHT_TQ[level], A = v & 1 ? 0x7f : 0, D = v >> n;
            var T = (D * tq[1] + layout(tq[0], v)) ^ A;
            w = (A & 0x20) | (T >> 2);
        }
        return w > 32 ? w + 1 : w;
    }

    function replicate(v, from, to) {
        if (from === 0) return 0;
        var out = 0, have = 0;
        while (have < to) {
            var take = Math.min(from, to - have);
            out = (out << take) | (v >> (from - take));
            have += take;
        }
        return out;
    }

    // Blockläget: viktrutnätets storlek, nivå, två plan. null: ett reserverat läge (felblock).
    function blockMode(mode) {
        var q = (mode >> 4) & 1, H = (mode >> 9) & 1, D = (mode >> 10) & 1, A = (mode >> 5) & 3, x = 0, y = 0, B;
        if (mode & 3) {
            q |= (mode & 3) << 1;
            B = (mode >> 7) & 3;
            switch ((mode >> 2) & 3) {
                case 0: x = B + 4; y = A + 2; break;
                case 1: x = B + 8; y = A + 2; break;
                case 2: x = A + 2; y = B + 8; break;
                default:
                    B &= 1;
                    if (mode & 0x100) { x = B + 2; y = A + 2; } else { x = A + 2; y = B + 6; }
            }
        } else {
            q |= ((mode >> 2) & 3) << 1;
            if (((mode >> 2) & 3) === 0) return null;
            B = (mode >> 9) & 3;
            switch ((mode >> 7) & 3) {
                case 0: x = 12; y = A + 2; break;
                case 1: x = A + 2; y = 12; break;
                case 2: x = A + 6; y = B + 6; D = 0; H = 0; break;
                default:
                    if (((mode >> 5) & 3) === 0) { x = 6; y = 10; } else if (((mode >> 5) & 3) === 1) { x = 10; y = 6; } else return null;
            }
        }
        var level = q - 2 + 6 * H, count = x * y * (D + 1);
        if (level < 0 || level > 11 || count > 64) return null;
        var wbits = iseBits(count, level);
        if (wbits < 24 || wbits > 96) return null;
        return { x: x, y: y, dual: !!D, level: level, count: count, bits: wbits };
    }

    function hash52(p) {
        p >>>= 0;
        p ^= p >>> 15; p = (p - (p << 17)) >>> 0; p = (p + (p << 7)) >>> 0; p = (p + (p << 4)) >>> 0;
        p ^= p >>> 5; p = (p + (p << 16)) >>> 0; p ^= p >>> 7; p ^= p >>> 3;
        p = (p ^ (p << 6)) >>> 0; p ^= p >>> 17;
        return p >>> 0;
    }

    function partitionOf(seed, x, y, count, small) {
        if (small) { x <<= 1; y <<= 1; }
        seed += (count - 1) * 1024;
        var r = hash52(seed);
        var s = [r & 0xf, (r >>> 4) & 0xf, (r >>> 8) & 0xf, (r >>> 12) & 0xf, (r >>> 16) & 0xf, (r >>> 20) & 0xf, (r >>> 24) & 0xf, (r >>> 28) & 0xf,
            (r >>> 18) & 0xf, (r >>> 22) & 0xf, (r >>> 26) & 0xf, ((r >>> 30) | (r << 2)) & 0xf];
        for (var i = 0; i < 12; i++) s[i] *= s[i];
        var sh1, sh2;
        if (seed & 1) { sh1 = seed & 2 ? 4 : 5; sh2 = count === 3 ? 6 : 5; } else { sh1 = count === 3 ? 6 : 5; sh2 = seed & 2 ? 4 : 5; }
        var sh3 = seed & 0x10 ? sh1 : sh2;
        s[0] >>= sh1; s[1] >>= sh2; s[2] >>= sh1; s[3] >>= sh2; s[4] >>= sh1; s[5] >>= sh2; s[6] >>= sh1; s[7] >>= sh2;
        s[8] >>= sh3; s[9] >>= sh3; s[10] >>= sh3; s[11] >>= sh3;
        var a = (s[0] * x + s[1] * y + (r >>> 14)) & 0x3f;
        var b = (s[2] * x + s[3] * y + (r >>> 10)) & 0x3f;
        var c = (s[4] * x + s[5] * y + (r >>> 6)) & 0x3f;
        var d = (s[6] * x + s[7] * y + (r >>> 2)) & 0x3f;
        if (count < 4) d = 0;
        if (count < 3) c = 0;
        if (a >= b && a >= c && a >= d) return 0;
        if (b >= c && b >= d) return 1;
        if (c >= d) return 2;
        return 3;
    }

    function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
    function bts(a, b) {
        // bit_transfer_signed: a får sin högsta bit från b, och blir ett tal med tecken.
        b = (b >> 1) | (a & 0x80);
        a = (a >> 1) & 0x3f;
        if (a & 0x20) a -= 0x40;
        return [a, b];
    }
    function blue(r, g, b, a) { return [(r + b) >> 1, (g + b) >> 1, b, a]; }

    // Ändpunkterna för ett färgläge (CEM). null: HDR, som inte ritas.
    function endpoints(cem, v) {
        var p, s0, s1, L0, L1;
        switch (cem) {
            case 0: return [[v[0], v[0], v[0], 255], [v[1], v[1], v[1], 255]];
            case 1:
                L0 = (v[0] >> 2) | (v[1] & 0xc0);
                L1 = Math.min(255, L0 + (v[1] & 0x3f));
                return [[L0, L0, L0, 255], [L1, L1, L1, 255]];
            case 4: return [[v[0], v[0], v[0], v[2]], [v[1], v[1], v[1], v[3]]];
            case 5:
                p = bts(v[1], v[0]); v[1] = p[0]; v[0] = p[1];
                p = bts(v[3], v[2]); v[3] = p[0]; v[2] = p[1];
                return [[v[0], v[0], v[0], v[2]], [clamp(v[0] + v[1]), clamp(v[0] + v[1]), clamp(v[0] + v[1]), clamp(v[2] + v[3])]];
            case 6:
                return [[(v[0] * v[3]) >> 8, (v[1] * v[3]) >> 8, (v[2] * v[3]) >> 8, 255], [v[0], v[1], v[2], 255]];
            case 8:
                s0 = v[0] + v[2] + v[4]; s1 = v[1] + v[3] + v[5];
                if (s1 >= s0) return [[v[0], v[2], v[4], 255], [v[1], v[3], v[5], 255]];
                return [blue(v[1], v[3], v[5], 255), blue(v[0], v[2], v[4], 255)];
            case 9:
                p = bts(v[1], v[0]); v[1] = p[0]; v[0] = p[1];
                p = bts(v[3], v[2]); v[3] = p[0]; v[2] = p[1];
                p = bts(v[5], v[4]); v[5] = p[0]; v[4] = p[1];
                if (v[1] + v[3] + v[5] >= 0) return [[v[0], v[2], v[4], 255], [clamp(v[0] + v[1]), clamp(v[2] + v[3]), clamp(v[4] + v[5]), 255]];
                return [blue(clamp(v[0] + v[1]), clamp(v[2] + v[3]), clamp(v[4] + v[5]), 255), blue(v[0], v[2], v[4], 255)];
            case 10:
                return [[(v[0] * v[3]) >> 8, (v[1] * v[3]) >> 8, (v[2] * v[3]) >> 8, v[4]], [v[0], v[1], v[2], v[5]]];
            case 12:
                s0 = v[0] + v[2] + v[4]; s1 = v[1] + v[3] + v[5];
                if (s1 >= s0) return [[v[0], v[2], v[4], v[6]], [v[1], v[3], v[5], v[7]]];
                return [blue(v[1], v[3], v[5], v[7]), blue(v[0], v[2], v[4], v[6])];
            case 13:
                p = bts(v[1], v[0]); v[1] = p[0]; v[0] = p[1];
                p = bts(v[3], v[2]); v[3] = p[0]; v[2] = p[1];
                p = bts(v[5], v[4]); v[5] = p[0]; v[4] = p[1];
                p = bts(v[7], v[6]); v[7] = p[0]; v[6] = p[1];
                if (v[1] + v[3] + v[5] >= 0) return [[v[0], v[2], v[4], v[6]], [clamp(v[0] + v[1]), clamp(v[2] + v[3]), clamp(v[4] + v[5]), clamp(v[6] + v[7])]];
                return [blue(clamp(v[0] + v[1]), clamp(v[2] + v[3]), clamp(v[4] + v[5]), clamp(v[6] + v[7])), blue(v[0], v[2], v[4], v[6])];
            default: return null;
        }
    }

    var ERROR = [255, 0, 255, 255];

    // Ett block till RGBA, bw × bh bildpunkter, i out (Uint8ClampedArray, rad för rad med bredden width) från (ox, oy).
    function decodeBlock(bytes, at, bw, bh, out, width, height, ox, oy) {
        var bits = new Bits(bytes, at, false);
        var x, y, k, o;
        var fill = function (c) {
            for (y = 0; y < bh; y++) for (x = 0; x < bw; x++) {
                if (ox + x >= width || oy + y >= height) continue;
                o = ((oy + y) * width + ox + x) * 4;
                out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3];
            }
        };
        // Ett block med en enda färg (void extent).
        if (bits.get(0, 9) === 0x1fc) {
            if (bits.get(9, 1)) { fill(ERROR); return; }
            fill([bits.get(64, 16) >> 8, bits.get(80, 16) >> 8, bits.get(96, 16) >> 8, bits.get(112, 16) >> 8]);
            return;
        }
        var bm = blockMode(bits.get(0, 11));
        if (!bm) { fill(ERROR); return; }
        var parts = bits.get(11, 2) + 1;
        if (parts === 4 && bm.dual) { fill(ERROR); return; }
        var below = 128 - bm.bits, cems = [], configEnd;
        if (parts === 1) {
            cems.push(bits.get(13, 4));
            configEnd = 17;
        } else {
            var low = bits.get(23, 6), base = low & 3;
            configEnd = 29;
            if (base === 0) {
                for (k = 0; k < parts; k++) cems.push(low >> 2);
            } else {
                var extra = 3 * parts - 4;
                below -= extra;
                var enc = low | (bits.get(below, extra) << 6), pos = 2;
                base--;
                for (k = 0; k < parts; k++) { cems.push((((enc >> pos) & 1) + base) << 2); pos++; }
                for (k = 0; k < parts; k++) { cems[k] |= (enc >> pos) & 3; pos += 2; }
            }
        }
        var ccs = -1;
        if (bm.dual) { below -= 2; ccs = bits.get(below, 2); }
        var nValues = 0;
        cems.forEach(function (c) { nValues += 2 * ((c >> 2) + 1); });
        if (nValues > 18) { fill(ERROR); return; }
        var avail = below - configEnd, level = -1;
        for (k = 20; k >= 0; k--) if (iseBits(nValues, k) <= avail) { level = k; break; }
        if (level < 4) { fill(ERROR); return; }
        var raw = iseDecode(bits, configEnd, below, nValues, level);
        var colors = raw.map(function (v) { return unquantColor(v, level); });
        var ends = [], used = 0;
        for (k = 0; k < parts; k++) {
            var n = 2 * ((cems[k] >> 2) + 1), e = endpoints(cems[k], colors.slice(used, used + n));
            used += n;
            if (!e) { fill(ERROR); return; }
            ends.push(e);
        }
        // Vikterna, bakifrån, och utfyllda till varje bildpunkt.
        var wraw = iseDecode(new Bits(bytes, at, true), 0, bm.bits, bm.count, bm.level);
        var W = wraw.map(function (v) { return unquantWeight(v, bm.level); });
        var planes = bm.dual ? 2 : 1;
        var Ds = Math.floor((1024 + (bw >> 1)) / (bw - 1)), Dt = Math.floor((1024 + (bh >> 1)) / (bh - 1));
        var small = bw * bh < 31, seed = parts > 1 ? bits.get(13, 10) : 0;
        var get = function (i, plane) { var j = i * planes + plane; return j < W.length ? W[j] : 0; };
        for (y = 0; y < bh; y++) {
            for (x = 0; x < bw; x++) {
                var gs = (Ds * x * (bm.x - 1) + 32) >> 6, gt = (Dt * y * (bm.y - 1) + 32) >> 6;
                var js = gs >> 4, fs = gs & 15, jt = gt >> 4, ft = gt & 15, v0 = js + jt * bm.x;
                var w11 = (fs * ft + 8) >> 4, w10 = ft - w11, w01 = fs - w11, w00 = 16 - fs - ft + w11;
                var wt = [];
                for (var pl = 0; pl < planes; pl++) {
                    wt.push((get(v0, pl) * w00 + (w01 ? get(v0 + 1, pl) * w01 : 0) + (w10 ? get(v0 + bm.x, pl) * w10 : 0) + (w11 ? get(v0 + bm.x + 1, pl) * w11 : 0) + 8) >> 4);
                }
                if (ox + x >= width || oy + y >= height) continue;
                var part = parts > 1 ? partitionOf(seed, x, y, parts, small) : 0, e0 = ends[part][0], e1 = ends[part][1];
                o = ((oy + y) * width + ox + x) * 4;
                for (var c = 0; c < 4; c++) {
                    var w = c === ccs ? wt[1] : wt[0];
                    var c0 = (e0[c] << 8) | e0[c], c1 = (e1[c] << 8) | e1[c];
                    out[o + c] = ((c0 * (64 - w) + c1 * w + 32) >> 6) >> 8;
                }
            }
        }
    }

    // Blockets plats i datan. linear: rad för rad med stride block per rad. tiled: Apples ordning i grafikminnet, rutor om
    // 32 × 32 block rad för rad, och inom rutan Morton-ordning med y på de jämna bitarna och x på de udda.
    var TILE = 32;
    function morton(x, y) {
        var v = 0;
        for (var k = 0; k < 5; k++) v |= (((y >> k) & 1) << (2 * k)) | (((x >> k) & 1) << (2 * k + 1));
        return v;
    }
    function blockIndex(x, y, stride, layout) {
        if (layout !== 'tiled') return y * stride + x;
        return ((y >> 5) * (stride >> 5) + (x >> 5)) * TILE * TILE + morton(x & 31, y & 31);
    }

    // Ordningen där inga tomma block (16 nollor, ett otillåtet block) hamnar i bilden: utfyllnaden ligger utanför.
    function pickLayout(bytes, bx, by, stride) {
        var canTile = stride % TILE === 0 && Math.ceil(by / TILE) * TILE * stride * 16 <= bytes.length;
        var empties = function (layout) {
            var n = 0;
            for (var y = 0; y < by; y += 3) for (var x = 0; x < bx; x += 3) {
                var at = blockIndex(x, y, stride, layout) * 16, z = true;
                for (var i = 0; i < 16 && z; i++) if (bytes[at + i]) z = false;
                if (z) n++;
            }
            return n;
        };
        if (!canTile) return 'linear';
        return empties('tiled') < empties('linear') ? 'tiled' : 'linear';
    }

    // Hela texturen. opts: { stride, layout } (som standard rad för rad, så många block per rad som bredden kräver).
    function decode(bytes, bw, bh, width, height, opts) {
        opts = opts || {};
        var bx = Math.ceil(width / bw), by = Math.ceil(height / bh), stride = opts.stride || bx, layout = opts.layout || 'linear';
        var out = new Uint8ClampedArray(width * height * 4);
        for (var y = 0; y < by; y++) {
            for (var x = 0; x < bx; x++) {
                var at = blockIndex(x, y, stride, layout) * 16;
                if (at + 16 > bytes.length) continue;
                decodeBlock(bytes, at, bw, bh, out, width, height, x * bw, y * bh);
            }
        }
        return out;
    }

    // ASTC-formaten i OpenGL: 0x93B0–0x93BD (RGBA) och 0x93D0–0x93DD (sRGB), blockstorlekarna i samma ordning.
    var GL_BLOCKS = [[4, 4], [5, 4], [5, 5], [6, 5], [6, 6], [8, 5], [8, 6], [8, 8], [10, 5], [10, 6], [10, 8], [10, 10], [12, 10], [12, 12]];
    function glBlock(format) {
        var i = format >= 0x93d0 ? format - 0x93d0 : format - 0x93b0;
        return i >= 0 && i < GL_BLOCKS.length ? { w: GL_BLOCKS[i][0], h: GL_BLOCKS[i][1], srgb: format >= 0x93d0 } : null;
    }

    function u32(b, at) { return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0; }

    // Apples texturfil: "AAPL\r\n\x1a\n" och sedan delar med längd och namn (HEAD, astc, END). HEAD har formatet och
    // storleken. Ger { width, height, block, data, stride } eller ett fel.
    function parseAtx(bytes) {
        var magic = [0x41, 0x41, 0x50, 0x4c, 0x0d, 0x0a, 0x1a, 0x0a];
        for (var i = 0; i < 8; i++) if (bytes[i] !== magic[i]) throw new Error('Filen är ingen Apple-textur (AAPL saknas i början).');
        var at = 8, head = null, data = null, kind = '';
        while (at + 8 <= bytes.length) {
            var len = u32(bytes, at), tag = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
            var body = at + 8;
            if (tag === 'END ' || body + len > bytes.length) break;
            if (tag === 'HEAD') head = { format: u32(bytes, body + 16), width: u32(bytes, body + 24), height: u32(bytes, body + 28) };
            else if (tag === 'astc') { kind = 'astc'; data = bytes.subarray(body + 4, body + len); }
            else if (!data && /^[a-z0-9]{4}$/.test(tag) && tag !== 'fill') kind = tag;
            at = body + len;
        }
        if (!head) throw new Error('Texturen saknar HEAD.');
        if (!data) throw new Error('Texturen är inte ASTC' + (kind ? ' (' + kind.trim() + ')' : '') + ', och det formatet ritas inte.');
        var block = glBlock(head.format);
        if (!block) throw new Error('Okänt texturformat 0x' + head.format.toString(16) + '.');
        // Raderna är utfyllda till en jämn bredd: antalet block per rad räknas ur datans storlek.
        // I Apples ordning är både bredden och höjden utfyllda till hela rutor om 32 block.
        var bx = Math.ceil(head.width / block.w), by = Math.ceil(head.height / block.h), blocks = Math.floor(data.length / 16);
        var tiledStride = Math.ceil(bx / TILE) * TILE, tiledRows = Math.ceil(by / TILE) * TILE;
        var stride = blocks >= tiledStride * tiledRows && blocks < (tiledStride + TILE) * tiledRows ? tiledStride : Math.max(bx, Math.floor(blocks / by));
        return { width: head.width, height: head.height, block: block, data: data, stride: stride, layout: pickLayout(data, bx, by, stride) };
    }

    // .atx till RGBA: { width, height, rgba, layout }.
    function decodeAtx(bytes) {
        var t = parseAtx(bytes);
        return { width: t.width, height: t.height, layout: t.layout, rgba: decode(t.data, t.block.w, t.block.h, t.width, t.height, { stride: t.stride, layout: t.layout }) };
    }

    var api = { decode: decode, decodeBlock: decodeBlock, parseAtx: parseAtx, decodeAtx: decodeAtx, blockMode: blockMode, iseBits: iseBits, iseDecode: iseDecode, unquantColor: unquantColor, unquantWeight: unquantWeight, partitionOf: partitionOf, Bits: Bits, morton: morton, trits: trits, quints: quints };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Astc = api;
})(typeof window !== 'undefined' ? window : this);
