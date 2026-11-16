// QR-koden i rutan att fotografera: stegets kod och datorns klocka som en liten QR-kod, så att programmet
// kan läsa dem ur bilden i extraktionen. Bara det som behövs här: version 1–6 och felrättning M. En text med
// bara siffror, versaler A–Z, mellanslag och $%*+-./: skrivs tätare (11 bitar per två tecken), så att koden
// och klockan ryms i den minsta QR-koden. Annan text skrivs som byte (UTF-8).
// Ingen DOM. Testas i Node, där koden läses tillbaka med läsaren i tools/QR2URL/jsQR.js.
(function (root) {
    'use strict';

    // Per version: [antal datakodord per block, antal block, antal felrättande kodord per block], nivå M.
    var BLOCKS = [null, [16, 1, 10], [28, 1, 16], [44, 1, 26], [32, 2, 18], [43, 2, 24], [27, 4, 16]];
    var MAX_VERSION = BLOCKS.length - 1;

    // Räkning i GF(256) med polynomet x^8 + x^4 + x^3 + x^2 + 1.
    var EXP = [], LOG = [];
    (function () {
        var x = 1;
        for (var i = 0; i < 255; i++) {
            EXP[i] = x;
            LOG[x] = i;
            x <<= 1;
            if (x & 0x100) x ^= 0x11D;
        }
    })();
    function mul(a, b) { return a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0; }

    // De felrättande kodorden: resten när datan delas med polynomet som har rötterna 1, α, α² …
    function errorWords(data, count) {
        var gen = [1], i, j;
        for (i = 0; i < count; i++) {
            var next = gen.concat([0]);
            for (j = 0; j < gen.length; j++) next[j + 1] ^= mul(gen[j], EXP[i]);
            gen = next;
        }
        var rem = new Array(count).fill(0);
        data.forEach(function (byte) {
            var factor = byte ^ rem.shift();
            rem.push(0);
            for (j = 0; j < count; j++) rem[j] ^= mul(gen[j + 1], factor);
        });
        return rem;
    }

    function utf8(text) {
        var s = unescape(encodeURIComponent(String(text))), out = [];
        for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
        return out;
    }

    var ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
    function isAlnum(text) {
        for (var i = 0; i < text.length; i++) if (ALNUM.indexOf(text[i]) < 0) return false;
        return text.length > 0;
    }

    // Texten som bitar: läget (4 bitar), längden och innehållet. Version 1–6 har samma bredd på längden.
    function dataBits(text) {
        var bits = [], i;
        var push = function (value, n) { for (var k = n - 1; k >= 0; k--) bits.push((value >>> k) & 1); };
        text = String(text);
        if (isAlnum(text)) {
            push(2, 4);
            push(text.length, 9);
            for (i = 0; i + 1 < text.length; i += 2) push(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11);
            if (i < text.length) push(ALNUM.indexOf(text[i]), 6);
        } else {
            var bytes = utf8(text);
            push(4, 4);
            push(bytes.length, 8);
            bytes.forEach(function (x) { push(x, 8); });
        }
        return bits;
    }

    // Antal bitar som ryms i en version.
    function capacity(version) { return BLOCKS[version][0] * BLOCKS[version][1] * 8; }

    function versionFor(bitCount) {
        for (var v = 1; v <= MAX_VERSION; v++) if (bitCount <= capacity(v)) return v;
        return 0;
    }

    // Alla kodord i den ordning de läggs ut: blockens datakodord om vartannat, sedan de felrättande likadant.
    function codewords(bits, version) {
        var spec = BLOCKS[version], total = spec[0] * spec[1], i, b;
        bits = bits.slice();
        for (i = Math.min(4, total * 8 - bits.length); i > 0; i--) bits.push(0);
        while (bits.length % 8) bits.push(0);
        var data = [];
        for (i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
        for (i = 0; data.length < total; i++) data.push(i % 2 ? 0x11 : 0xEC);

        var blocks = [], ecs = [], out = [];
        for (b = 0; b < spec[1]; b++) {
            blocks.push(data.slice(b * spec[0], (b + 1) * spec[0]));
            ecs.push(errorWords(blocks[b], spec[2]));
        }
        for (i = 0; i < spec[0]; i++) for (b = 0; b < spec[1]; b++) out.push(blocks[b][i]);
        for (i = 0; i < spec[2]; i++) for (b = 0; b < spec[1]; b++) out.push(ecs[b][i]);
        return out;
    }

    function maskBit(mask, x, y) {
        switch (mask) {
            case 0: return (x + y) % 2 === 0;
            case 1: return y % 2 === 0;
            case 2: return x % 3 === 0;
            case 3: return (x + y) % 3 === 0;
            case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            case 5: return (x * y) % 2 + (x * y) % 3 === 0;
            case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
            default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
        }
    }

    // Rutnätet för en mask: de fasta mönstren, kodorden i sicksack och formatbitarna.
    function build(words, version, mask) {
        var size = 17 + 4 * version, m = [], fixed = [], x, y, i;
        for (y = 0; y < size; y++) { m.push(new Array(size).fill(false)); fixed.push(new Array(size).fill(false)); }
        var set = function (px, py, dark) { if (px >= 0 && py >= 0 && px < size && py < size) { m[py][px] = dark; fixed[py][px] = true; } };

        for (i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
        [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
            for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
                var d = Math.max(Math.abs(dx), Math.abs(dy));
                set(c[0] + dx, c[1] + dy, d !== 2 && d !== 4);
            }
        });
        if (version > 1) {
            var c = size - 7;
            for (y = -2; y <= 2; y++) for (x = -2; x <= 2; x++) set(c + x, c + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
        }

        // Formatet: felrättningens nivå (M är 0) och masken, med tio kontrollbitar, på två ställen.
        var rem = mask;
        for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        var format = ((mask << 10) | rem) ^ 0x5412;
        var bit = function (n) { return ((format >>> n) & 1) === 1; };
        for (i = 0; i <= 5; i++) set(8, i, bit(i));
        set(8, 7, bit(6));
        set(8, 8, bit(7));
        set(7, 8, bit(8));
        for (i = 9; i < 15; i++) set(14 - i, 8, bit(i));
        for (i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
        for (i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
        set(8, size - 8, true);

        var n = 0, total = words.length * 8;
        for (var right = size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (var vert = 0; vert < size; vert++) {
                for (var j = 0; j < 2; j++) {
                    x = right - j;
                    y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
                    if (fixed[y][x]) continue;
                    var dark = n < total && ((words[n >>> 3] >>> (7 - (n & 7))) & 1) === 1;
                    n++;
                    m[y][x] = dark !== maskBit(mask, x, y);
                }
            }
        }
        return m;
    }

    // Hur svårläst ett rutnät är, efter standardens fyra regler: långa rader i samma färg, fyrkanter i samma
    // färg, mönster som liknar hörnens ögon och obalans mellan mörkt och ljust.
    function penalty(m) {
        var size = m.length, score = 0, x, y, dark = 0;
        var line = function (get) {
            var run = 1, bits = '';
            for (var i = 0; i < size; i++) {
                bits += get(i) ? '1' : '0';
                if (i && get(i) === get(i - 1)) run++;
                else { if (run >= 5) score += run - 2; run = 1; }
            }
            if (run >= 5) score += run - 2;
            ['10111010000', '00001011101'].forEach(function (p) {
                for (var at = bits.indexOf(p); at >= 0; at = bits.indexOf(p, at + 1)) score += 40;
            });
        };
        for (y = 0; y < size; y++) line(function (i) { return m[y][i]; });
        for (x = 0; x < size; x++) line(function (i) { return m[i][x]; });
        for (y = 0; y < size; y++) for (x = 0; x < size; x++) {
            if (m[y][x]) dark++;
            if (x + 1 < size && y + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
        }
        return score + Math.floor(Math.abs(dark * 20 / (size * size) - 10)) * 10;
    }

    // Texten som rutnät: rader av true (mörk) och false. null när texten inte ryms.
    function encode(text) {
        var bits = dataBits(text), version = versionFor(bits.length);
        if (!version) return null;
        var words = codewords(bits, version), best = null, low = Infinity;
        for (var mask = 0; mask < 8; mask++) {
            var m = build(words, version, mask), p = penalty(m);
            if (p < low) { low = p; best = m; }
        }
        return best;
    }

    // Rutnätet som en SVG-bana, med den ljusa kanten som en läsare behöver runt om (fyra rutor).
    function svgPath(m) {
        var d = '';
        m.forEach(function (row, y) {
            for (var x = 0; x < row.length; x++) {
                if (!row[x]) continue;
                var w = 1;
                while (x + w < row.length && row[x + w]) w++;
                d += 'M' + (x + 4) + ' ' + (y + 4) + 'h' + w + 'v1h-' + w + 'z';
                x += w - 1;
            }
        });
        return { d: d, size: m.length + 8 };
    }

    var api = { encode: encode, svgPath: svgPath };
    root.LabQr = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
