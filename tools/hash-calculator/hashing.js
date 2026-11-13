// Inkrementella hashimplementationer så att stora filer kan läsas i bitar istället för
// att laddas in i minnet i sin helhet. WebCrypto saknar strömmande API, därför finns
// SHA-familjen även som ren JS här. Testerna jämför utfallet mot Nodes crypto.
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.ToolboxHashing = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // Filer under den här gränsen hashas i ett svep med WebCryptos native-implementation,
    // som är betydligt snabbare än JS. Större filer strömmas.
    var ONESHOT_LIMIT = 64 * 1024 * 1024;
    var CHUNK_SIZE = 8 * 1024 * 1024;

    function hex32(n) {
        return (n >>> 0).toString(16).padStart(8, '0');
    }

    // --- Gemensam blockbuffring -------------------------------------------------

    function Buffered(blockSize) {
        this.blockSize = blockSize;
        this.buf = new Uint8Array(blockSize);
        this.bufLen = 0;
        this.totalLen = 0;
    }

    Buffered.prototype.update = function (bytes) {
        this.totalLen += bytes.length;
        var off = 0;
        if (this.bufLen) {
            var take = Math.min(this.blockSize - this.bufLen, bytes.length);
            this.buf.set(bytes.subarray(0, take), this.bufLen);
            this.bufLen += take;
            off = take;
            if (this.bufLen === this.blockSize) {
                this.block(this.buf, 0);
                this.bufLen = 0;
            }
        }
        while (off + this.blockSize <= bytes.length) {
            this.block(bytes, off);
            off += this.blockSize;
        }
        if (off < bytes.length) {
            this.buf.set(bytes.subarray(off), 0);
            this.bufLen = bytes.length - off;
        }
        return this;
    };

    // Lägger till 0x80, nollor och längdfältet. `lengthBytes` är hur många byte
    // längdfältet upptar (8 för MD5/SHA-1/SHA-256, 16 för SHA-512).
    // Paddningen förbrukar tillståndet, så en hasher kan bara summeras en gång.
    Buffered.prototype.padTail = function (lengthBytes, littleEndian) {
        if (this.finalized) throw new Error('digestHex kan bara anropas en gång per hasher');
        this.finalized = true;
        var bitLen = this.totalLen * 8;
        var tail = new Uint8Array(this.blockSize * 2);
        var i = 0;
        tail[i++] = 0x80;
        var used = (this.bufLen + 1 + lengthBytes) % this.blockSize;
        var padZeros = used === 0 ? 0 : this.blockSize - used;
        i += padZeros;
        var lenOff = i;
        i += lengthBytes;

        // Längden i bitar. Vi håller oss inom Number-precision (2^53 bitar = 1 PB fil).
        var lo = bitLen >>> 0;
        var hi = Math.floor(bitLen / 4294967296) >>> 0;
        if (littleEndian) {
            tail[lenOff] = lo & 0xff;
            tail[lenOff + 1] = (lo >>> 8) & 0xff;
            tail[lenOff + 2] = (lo >>> 16) & 0xff;
            tail[lenOff + 3] = (lo >>> 24) & 0xff;
            tail[lenOff + 4] = hi & 0xff;
            tail[lenOff + 5] = (hi >>> 8) & 0xff;
            tail[lenOff + 6] = (hi >>> 16) & 0xff;
            tail[lenOff + 7] = (hi >>> 24) & 0xff;
        } else {
            var end = lenOff + lengthBytes;
            tail[end - 1] = lo & 0xff;
            tail[end - 2] = (lo >>> 8) & 0xff;
            tail[end - 3] = (lo >>> 16) & 0xff;
            tail[end - 4] = (lo >>> 24) & 0xff;
            tail[end - 5] = hi & 0xff;
            tail[end - 6] = (hi >>> 8) & 0xff;
            tail[end - 7] = (hi >>> 16) & 0xff;
            tail[end - 8] = (hi >>> 24) & 0xff;
        }
        this.update(tail.subarray(0, i));
    };

    // --- MD5 --------------------------------------------------------------------

    function Md5() {
        Buffered.call(this, 64);
        this.a = 1732584193;
        this.b = -271733879;
        this.c = -1732584194;
        this.d = 271733878;
    }
    Md5.prototype = Object.create(Buffered.prototype);

    // De 64 stegen står utskrivna, med konstanterna (heltalsdelen av |sin(k + 1)| · 2^32) och vridningarna på
    // plats: en slinga med tabeller är ungefär fyra gånger långsammare, och MD5 räknas på varje fil som bedöms.
    Md5.prototype.block = function (bytes, off) {
        var w0 = bytes[off + 0] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24);
        var w1 = bytes[off + 4] | (bytes[off + 5] << 8) | (bytes[off + 6] << 16) | (bytes[off + 7] << 24);
        var w2 = bytes[off + 8] | (bytes[off + 9] << 8) | (bytes[off + 10] << 16) | (bytes[off + 11] << 24);
        var w3 = bytes[off + 12] | (bytes[off + 13] << 8) | (bytes[off + 14] << 16) | (bytes[off + 15] << 24);
        var w4 = bytes[off + 16] | (bytes[off + 17] << 8) | (bytes[off + 18] << 16) | (bytes[off + 19] << 24);
        var w5 = bytes[off + 20] | (bytes[off + 21] << 8) | (bytes[off + 22] << 16) | (bytes[off + 23] << 24);
        var w6 = bytes[off + 24] | (bytes[off + 25] << 8) | (bytes[off + 26] << 16) | (bytes[off + 27] << 24);
        var w7 = bytes[off + 28] | (bytes[off + 29] << 8) | (bytes[off + 30] << 16) | (bytes[off + 31] << 24);
        var w8 = bytes[off + 32] | (bytes[off + 33] << 8) | (bytes[off + 34] << 16) | (bytes[off + 35] << 24);
        var w9 = bytes[off + 36] | (bytes[off + 37] << 8) | (bytes[off + 38] << 16) | (bytes[off + 39] << 24);
        var w10 = bytes[off + 40] | (bytes[off + 41] << 8) | (bytes[off + 42] << 16) | (bytes[off + 43] << 24);
        var w11 = bytes[off + 44] | (bytes[off + 45] << 8) | (bytes[off + 46] << 16) | (bytes[off + 47] << 24);
        var w12 = bytes[off + 48] | (bytes[off + 49] << 8) | (bytes[off + 50] << 16) | (bytes[off + 51] << 24);
        var w13 = bytes[off + 52] | (bytes[off + 53] << 8) | (bytes[off + 54] << 16) | (bytes[off + 55] << 24);
        var w14 = bytes[off + 56] | (bytes[off + 57] << 8) | (bytes[off + 58] << 16) | (bytes[off + 59] << 24);
        var w15 = bytes[off + 60] | (bytes[off + 61] << 8) | (bytes[off + 62] << 16) | (bytes[off + 63] << 24);
        var a = this.a, b = this.b, c = this.c, d = this.d;
        a = (a + ((b & c) | (~b & d)) + w0 - 680876936) | 0; a = (((a << 7) | (a >>> 25)) + b) | 0;
        d = (d + ((a & b) | (~a & c)) + w1 - 389564586) | 0; d = (((d << 12) | (d >>> 20)) + a) | 0;
        c = (c + ((d & a) | (~d & b)) + w2 + 606105819) | 0; c = (((c << 17) | (c >>> 15)) + d) | 0;
        b = (b + ((c & d) | (~c & a)) + w3 - 1044525330) | 0; b = (((b << 22) | (b >>> 10)) + c) | 0;
        a = (a + ((b & c) | (~b & d)) + w4 - 176418897) | 0; a = (((a << 7) | (a >>> 25)) + b) | 0;
        d = (d + ((a & b) | (~a & c)) + w5 + 1200080426) | 0; d = (((d << 12) | (d >>> 20)) + a) | 0;
        c = (c + ((d & a) | (~d & b)) + w6 - 1473231341) | 0; c = (((c << 17) | (c >>> 15)) + d) | 0;
        b = (b + ((c & d) | (~c & a)) + w7 - 45705983) | 0; b = (((b << 22) | (b >>> 10)) + c) | 0;
        a = (a + ((b & c) | (~b & d)) + w8 + 1770035416) | 0; a = (((a << 7) | (a >>> 25)) + b) | 0;
        d = (d + ((a & b) | (~a & c)) + w9 - 1958414417) | 0; d = (((d << 12) | (d >>> 20)) + a) | 0;
        c = (c + ((d & a) | (~d & b)) + w10 - 42063) | 0; c = (((c << 17) | (c >>> 15)) + d) | 0;
        b = (b + ((c & d) | (~c & a)) + w11 - 1990404162) | 0; b = (((b << 22) | (b >>> 10)) + c) | 0;
        a = (a + ((b & c) | (~b & d)) + w12 + 1804603682) | 0; a = (((a << 7) | (a >>> 25)) + b) | 0;
        d = (d + ((a & b) | (~a & c)) + w13 - 40341101) | 0; d = (((d << 12) | (d >>> 20)) + a) | 0;
        c = (c + ((d & a) | (~d & b)) + w14 - 1502002290) | 0; c = (((c << 17) | (c >>> 15)) + d) | 0;
        b = (b + ((c & d) | (~c & a)) + w15 + 1236535329) | 0; b = (((b << 22) | (b >>> 10)) + c) | 0;
        a = (a + ((b & d) | (c & ~d)) + w1 - 165796510) | 0; a = (((a << 5) | (a >>> 27)) + b) | 0;
        d = (d + ((a & c) | (b & ~c)) + w6 - 1069501632) | 0; d = (((d << 9) | (d >>> 23)) + a) | 0;
        c = (c + ((d & b) | (a & ~b)) + w11 + 643717713) | 0; c = (((c << 14) | (c >>> 18)) + d) | 0;
        b = (b + ((c & a) | (d & ~a)) + w0 - 373897302) | 0; b = (((b << 20) | (b >>> 12)) + c) | 0;
        a = (a + ((b & d) | (c & ~d)) + w5 - 701558691) | 0; a = (((a << 5) | (a >>> 27)) + b) | 0;
        d = (d + ((a & c) | (b & ~c)) + w10 + 38016083) | 0; d = (((d << 9) | (d >>> 23)) + a) | 0;
        c = (c + ((d & b) | (a & ~b)) + w15 - 660478335) | 0; c = (((c << 14) | (c >>> 18)) + d) | 0;
        b = (b + ((c & a) | (d & ~a)) + w4 - 405537848) | 0; b = (((b << 20) | (b >>> 12)) + c) | 0;
        a = (a + ((b & d) | (c & ~d)) + w9 + 568446438) | 0; a = (((a << 5) | (a >>> 27)) + b) | 0;
        d = (d + ((a & c) | (b & ~c)) + w14 - 1019803690) | 0; d = (((d << 9) | (d >>> 23)) + a) | 0;
        c = (c + ((d & b) | (a & ~b)) + w3 - 187363961) | 0; c = (((c << 14) | (c >>> 18)) + d) | 0;
        b = (b + ((c & a) | (d & ~a)) + w8 + 1163531501) | 0; b = (((b << 20) | (b >>> 12)) + c) | 0;
        a = (a + ((b & d) | (c & ~d)) + w13 - 1444681467) | 0; a = (((a << 5) | (a >>> 27)) + b) | 0;
        d = (d + ((a & c) | (b & ~c)) + w2 - 51403784) | 0; d = (((d << 9) | (d >>> 23)) + a) | 0;
        c = (c + ((d & b) | (a & ~b)) + w7 + 1735328473) | 0; c = (((c << 14) | (c >>> 18)) + d) | 0;
        b = (b + ((c & a) | (d & ~a)) + w12 - 1926607734) | 0; b = (((b << 20) | (b >>> 12)) + c) | 0;
        a = (a + (b ^ c ^ d) + w5 - 378558) | 0; a = (((a << 4) | (a >>> 28)) + b) | 0;
        d = (d + (a ^ b ^ c) + w8 - 2022574463) | 0; d = (((d << 11) | (d >>> 21)) + a) | 0;
        c = (c + (d ^ a ^ b) + w11 + 1839030562) | 0; c = (((c << 16) | (c >>> 16)) + d) | 0;
        b = (b + (c ^ d ^ a) + w14 - 35309556) | 0; b = (((b << 23) | (b >>> 9)) + c) | 0;
        a = (a + (b ^ c ^ d) + w1 - 1530992060) | 0; a = (((a << 4) | (a >>> 28)) + b) | 0;
        d = (d + (a ^ b ^ c) + w4 + 1272893353) | 0; d = (((d << 11) | (d >>> 21)) + a) | 0;
        c = (c + (d ^ a ^ b) + w7 - 155497632) | 0; c = (((c << 16) | (c >>> 16)) + d) | 0;
        b = (b + (c ^ d ^ a) + w10 - 1094730640) | 0; b = (((b << 23) | (b >>> 9)) + c) | 0;
        a = (a + (b ^ c ^ d) + w13 + 681279174) | 0; a = (((a << 4) | (a >>> 28)) + b) | 0;
        d = (d + (a ^ b ^ c) + w0 - 358537222) | 0; d = (((d << 11) | (d >>> 21)) + a) | 0;
        c = (c + (d ^ a ^ b) + w3 - 722521979) | 0; c = (((c << 16) | (c >>> 16)) + d) | 0;
        b = (b + (c ^ d ^ a) + w6 + 76029189) | 0; b = (((b << 23) | (b >>> 9)) + c) | 0;
        a = (a + (b ^ c ^ d) + w9 - 640364487) | 0; a = (((a << 4) | (a >>> 28)) + b) | 0;
        d = (d + (a ^ b ^ c) + w12 - 421815835) | 0; d = (((d << 11) | (d >>> 21)) + a) | 0;
        c = (c + (d ^ a ^ b) + w15 + 530742520) | 0; c = (((c << 16) | (c >>> 16)) + d) | 0;
        b = (b + (c ^ d ^ a) + w2 - 995338651) | 0; b = (((b << 23) | (b >>> 9)) + c) | 0;
        a = (a + (c ^ (b | ~d)) + w0 - 198630844) | 0; a = (((a << 6) | (a >>> 26)) + b) | 0;
        d = (d + (b ^ (a | ~c)) + w7 + 1126891415) | 0; d = (((d << 10) | (d >>> 22)) + a) | 0;
        c = (c + (a ^ (d | ~b)) + w14 - 1416354905) | 0; c = (((c << 15) | (c >>> 17)) + d) | 0;
        b = (b + (d ^ (c | ~a)) + w5 - 57434055) | 0; b = (((b << 21) | (b >>> 11)) + c) | 0;
        a = (a + (c ^ (b | ~d)) + w12 + 1700485571) | 0; a = (((a << 6) | (a >>> 26)) + b) | 0;
        d = (d + (b ^ (a | ~c)) + w3 - 1894986606) | 0; d = (((d << 10) | (d >>> 22)) + a) | 0;
        c = (c + (a ^ (d | ~b)) + w10 - 1051523) | 0; c = (((c << 15) | (c >>> 17)) + d) | 0;
        b = (b + (d ^ (c | ~a)) + w1 - 2054922799) | 0; b = (((b << 21) | (b >>> 11)) + c) | 0;
        a = (a + (c ^ (b | ~d)) + w8 + 1873313359) | 0; a = (((a << 6) | (a >>> 26)) + b) | 0;
        d = (d + (b ^ (a | ~c)) + w15 - 30611744) | 0; d = (((d << 10) | (d >>> 22)) + a) | 0;
        c = (c + (a ^ (d | ~b)) + w6 - 1560198380) | 0; c = (((c << 15) | (c >>> 17)) + d) | 0;
        b = (b + (d ^ (c | ~a)) + w13 + 1309151649) | 0; b = (((b << 21) | (b >>> 11)) + c) | 0;
        a = (a + (c ^ (b | ~d)) + w4 - 145523070) | 0; a = (((a << 6) | (a >>> 26)) + b) | 0;
        d = (d + (b ^ (a | ~c)) + w11 - 1120210379) | 0; d = (((d << 10) | (d >>> 22)) + a) | 0;
        c = (c + (a ^ (d | ~b)) + w2 + 718787259) | 0; c = (((c << 15) | (c >>> 17)) + d) | 0;
        b = (b + (d ^ (c | ~a)) + w9 - 343485551) | 0; b = (((b << 21) | (b >>> 11)) + c) | 0;
        this.a = (this.a + a) | 0;
        this.b = (this.b + b) | 0;
        this.c = (this.c + c) | 0;
        this.d = (this.d + d) | 0;
    };

    Md5.prototype.digestHex = function () {
        this.padTail(8, true);
        var out = '';
        var words = [this.a, this.b, this.c, this.d];
        for (var i = 0; i < 4; i++) {
            for (var b = 0; b < 4; b++) {
                out += ((words[i] >>> (b * 8)) & 0xff).toString(16).padStart(2, '0');
            }
        }
        return out;
    };

    // --- SHA-1 ------------------------------------------------------------------

    function Sha1() {
        Buffered.call(this, 64);
        this.h = new Int32Array([1732584193, -271733879, -1732584194, 271733878, -1009589776]);
        this.w = new Int32Array(80);
    }
    Sha1.prototype = Object.create(Buffered.prototype);

    Sha1.prototype.block = function (bytes, off) {
        var w = this.w;
        var i;
        for (i = 0; i < 16; i++) {
            var j = off + i * 4;
            w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
        }
        for (i = 16; i < 80; i++) {
            var x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
            w[i] = (x << 1) | (x >>> 31);
        }
        var a = this.h[0], b = this.h[1], c = this.h[2], d = this.h[3], e = this.h[4];
        for (i = 0; i < 80; i++) {
            var f, k;
            if (i < 20) { f = (b & c) | (~b & d); k = 1518500249; }
            else if (i < 40) { f = b ^ c ^ d; k = 1859775393; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = -1894007588; }
            else { f = b ^ c ^ d; k = -899497514; }
            var t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
            e = d;
            d = c;
            c = (b << 30) | (b >>> 2);
            b = a;
            a = t;
        }
        this.h[0] = (this.h[0] + a) | 0;
        this.h[1] = (this.h[1] + b) | 0;
        this.h[2] = (this.h[2] + c) | 0;
        this.h[3] = (this.h[3] + d) | 0;
        this.h[4] = (this.h[4] + e) | 0;
    };

    Sha1.prototype.digestHex = function () {
        this.padTail(8, false);
        var out = '';
        for (var i = 0; i < 5; i++) out += hex32(this.h[i]);
        return out;
    };

    // --- SHA-256 ----------------------------------------------------------------

    var K256 = new Int32Array([
        0x428a2f98 | 0, 0x71374491 | 0, 0xb5c0fbcf | 0, 0xe9b5dba5 | 0,
        0x3956c25b | 0, 0x59f111f1 | 0, 0x923f82a4 | 0, 0xab1c5ed5 | 0,
        0xd807aa98 | 0, 0x12835b01 | 0, 0x243185be | 0, 0x550c7dc3 | 0,
        0x72be5d74 | 0, 0x80deb1fe | 0, 0x9bdc06a7 | 0, 0xc19bf174 | 0,
        0xe49b69c1 | 0, 0xefbe4786 | 0, 0x0fc19dc6 | 0, 0x240ca1cc | 0,
        0x2de92c6f | 0, 0x4a7484aa | 0, 0x5cb0a9dc | 0, 0x76f988da | 0,
        0x983e5152 | 0, 0xa831c66d | 0, 0xb00327c8 | 0, 0xbf597fc7 | 0,
        0xc6e00bf3 | 0, 0xd5a79147 | 0, 0x06ca6351 | 0, 0x14292967 | 0,
        0x27b70a85 | 0, 0x2e1b2138 | 0, 0x4d2c6dfc | 0, 0x53380d13 | 0,
        0x650a7354 | 0, 0x766a0abb | 0, 0x81c2c92e | 0, 0x92722c85 | 0,
        0xa2bfe8a1 | 0, 0xa81a664b | 0, 0xc24b8b70 | 0, 0xc76c51a3 | 0,
        0xd192e819 | 0, 0xd6990624 | 0, 0xf40e3585 | 0, 0x106aa070 | 0,
        0x19a4c116 | 0, 0x1e376c08 | 0, 0x2748774c | 0, 0x34b0bcb5 | 0,
        0x391c0cb3 | 0, 0x4ed8aa4a | 0, 0x5b9cca4f | 0, 0x682e6ff3 | 0,
        0x748f82ee | 0, 0x78a5636f | 0, 0x84c87814 | 0, 0x8cc70208 | 0,
        0x90befffa | 0, 0xa4506ceb | 0, 0xbef9a3f7 | 0, 0xc67178f2 | 0,
    ]);

    function Sha256() {
        Buffered.call(this, 64);
        this.h = new Int32Array([
            0x6a09e667 | 0, 0xbb67ae85 | 0, 0x3c6ef372 | 0, 0xa54ff53a | 0,
            0x510e527f | 0, 0x9b05688c | 0, 0x1f83d9ab | 0, 0x5be0cd19 | 0,
        ]);
        this.w = new Int32Array(64);
    }
    Sha256.prototype = Object.create(Buffered.prototype);

    Sha256.prototype.block = function (bytes, off) {
        var w = this.w;
        var i;
        for (i = 0; i < 16; i++) {
            var j = off + i * 4;
            w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
        }
        for (i = 16; i < 64; i++) {
            var x = w[i - 15];
            var y = w[i - 2];
            var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
            var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        var a = this.h[0], b = this.h[1], c = this.h[2], d = this.h[3];
        var e = this.h[4], f = this.h[5], g = this.h[6], hh = this.h[7];
        for (i = 0; i < 64; i++) {
            var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            var ch = (e & f) ^ (~e & g);
            var t1 = (hh + S1 + ch + K256[i] + w[i]) | 0;
            var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            var maj = (a & b) ^ (a & c) ^ (b & c);
            var t2 = (S0 + maj) | 0;
            hh = g;
            g = f;
            f = e;
            e = (d + t1) | 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) | 0;
        }
        this.h[0] = (this.h[0] + a) | 0;
        this.h[1] = (this.h[1] + b) | 0;
        this.h[2] = (this.h[2] + c) | 0;
        this.h[3] = (this.h[3] + d) | 0;
        this.h[4] = (this.h[4] + e) | 0;
        this.h[5] = (this.h[5] + f) | 0;
        this.h[6] = (this.h[6] + g) | 0;
        this.h[7] = (this.h[7] + hh) | 0;
    };

    Sha256.prototype.digestHex = function () {
        this.padTail(8, false);
        var out = '';
        for (var i = 0; i < 8; i++) out += hex32(this.h[i]);
        return out;
    };

    // --- SHA-512 / SHA-384 ------------------------------------------------------
    // 64-bitarsord representeras som par av 32-bitarsord (hi, lo) i en Int32Array.

    var K512_HEX = [
        '428a2f98d728ae22', '7137449123ef65cd', 'b5c0fbcfec4d3b2f', 'e9b5dba58189dbbc',
        '3956c25bf348b538', '59f111f1b605d019', '923f82a4af194f9b', 'ab1c5ed5da6d8118',
        'd807aa98a3030242', '12835b0145706fbe', '243185be4ee4b28c', '550c7dc3d5ffb4e2',
        '72be5d74f27b896f', '80deb1fe3b1696b1', '9bdc06a725c71235', 'c19bf174cf692694',
        'e49b69c19ef14ad2', 'efbe4786384f25e3', '0fc19dc68b8cd5b5', '240ca1cc77ac9c65',
        '2de92c6f592b0275', '4a7484aa6ea6e483', '5cb0a9dcbd41fbd4', '76f988da831153b5',
        '983e5152ee66dfab', 'a831c66d2db43210', 'b00327c898fb213f', 'bf597fc7beef0ee4',
        'c6e00bf33da88fc2', 'd5a79147930aa725', '06ca6351e003826f', '142929670a0e6e70',
        '27b70a8546d22ffc', '2e1b21385c26c926', '4d2c6dfc5ac42aed', '53380d139d95b3df',
        '650a73548baf63de', '766a0abb3c77b2a8', '81c2c92e47edaee6', '92722c851482353b',
        'a2bfe8a14cf10364', 'a81a664bbc423001', 'c24b8b70d0f89791', 'c76c51a30654be30',
        'd192e819d6ef5218', 'd69906245565a910', 'f40e35855771202a', '106aa07032bbd1b8',
        '19a4c116b8d2d0c8', '1e376c085141ab53', '2748774cdf8eeb99', '34b0bcb5e19b48a8',
        '391c0cb3c5c95a63', '4ed8aa4ae3418acb', '5b9cca4f7763e373', '682e6ff3d6b2b8a3',
        '748f82ee5defb2fc', '78a5636f43172f60', '84c87814a1f0ab72', '8cc702081a6439ec',
        '90befffa23631e28', 'a4506cebde82bde9', 'bef9a3f7b2c67915', 'c67178f2e372532b',
        'ca273eceea26619c', 'd186b8c721c0c207', 'eada7dd6cde0eb1e', 'f57d4f7fee6ed178',
        '06f067aa72176fba', '0a637dc5a2c898a6', '113f9804bef90dae', '1b710b35131c471b',
        '28db77f523047d84', '32caab7b40c72493', '3c9ebe0a15c9bebc', '431d67c49c100d4c',
        '4cc5d4becb3e42b6', '597f299cfc657e2a', '5fcb6fab3ad6faec', '6c44198c4a475817',
    ];

    function hexPairs(list) {
        var out = new Int32Array(list.length * 2);
        for (var i = 0; i < list.length; i++) {
            out[i * 2] = parseInt(list[i].slice(0, 8), 16) | 0;
            out[i * 2 + 1] = parseInt(list[i].slice(8), 16) | 0;
        }
        return out;
    }

    var K512 = hexPairs(K512_HEX);
    var INIT_512 = [
        '6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1',
        '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179',
    ];
    var INIT_384 = [
        'cbbb9d5dc1059ed8', '629a292a367cd507', '9159015a3070dd17', '152fecd8f70e5939',
        '67332667ffc00b31', '8eb44a8768581511', 'db0c2e0d64f98fa7', '47b5481dbefa4fa4',
    ];

    function rotrHi(hi, lo, n) {
        if (n < 32) return (hi >>> n) | (lo << (32 - n));
        if (n === 32) return lo;
        n -= 32;
        return (lo >>> n) | (hi << (32 - n));
    }
    function rotrLo(hi, lo, n) {
        if (n < 32) return (lo >>> n) | (hi << (32 - n));
        if (n === 32) return hi;
        n -= 32;
        return (hi >>> n) | (lo << (32 - n));
    }

    function Sha512(init, outWords) {
        Buffered.call(this, 128);
        this.h = hexPairs(init);
        this.outWords = outWords;
        this.w = new Int32Array(160);
    }
    Sha512.prototype = Object.create(Buffered.prototype);

    Sha512.prototype.block = function (bytes, off) {
        var w = this.w;
        var i;
        for (i = 0; i < 16; i++) {
            var j = off + i * 8;
            w[i * 2] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
            w[i * 2 + 1] = (bytes[j + 4] << 24) | (bytes[j + 5] << 16) | (bytes[j + 6] << 8) | bytes[j + 7];
        }
        for (i = 16; i < 80; i++) {
            var x2 = w[(i - 15) * 2], x1 = w[(i - 15) * 2 + 1];
            var s0h = rotrHi(x2, x1, 1) ^ rotrHi(x2, x1, 8) ^ (x2 >>> 7);
            var s0l = rotrLo(x2, x1, 1) ^ rotrLo(x2, x1, 8) ^ ((x1 >>> 7) | (x2 << 25));

            var y2 = w[(i - 2) * 2], y1 = w[(i - 2) * 2 + 1];
            var s1h = rotrHi(y2, y1, 19) ^ rotrHi(y2, y1, 61) ^ (y2 >>> 6);
            var s1l = rotrLo(y2, y1, 19) ^ rotrLo(y2, y1, 61) ^ ((y1 >>> 6) | (y2 << 26));

            var ah = w[(i - 16) * 2], al = w[(i - 16) * 2 + 1];
            var bh = w[(i - 7) * 2], bl = w[(i - 7) * 2 + 1];

            var lo = (al >>> 0) + (s0l >>> 0);
            var hi = (ah >>> 0) + (s0h >>> 0) + Math.floor(lo / 4294967296);
            lo = lo >>> 0;
            lo += bl >>> 0;
            hi += (bh >>> 0) + Math.floor(lo / 4294967296);
            lo = lo >>> 0;
            lo += s1l >>> 0;
            hi += (s1h >>> 0) + Math.floor(lo / 4294967296);

            w[i * 2] = hi | 0;
            w[i * 2 + 1] = lo | 0;
        }

        var h = this.h;
        var ah = h[0], al = h[1], bh = h[2], bl = h[3], ch = h[4], cl = h[5], dh = h[6], dl = h[7];
        var eh = h[8], el = h[9], fh = h[10], fl = h[11], gh = h[12], gl = h[13], hh = h[14], hl = h[15];

        for (i = 0; i < 80; i++) {
            var S1h = rotrHi(eh, el, 14) ^ rotrHi(eh, el, 18) ^ rotrHi(eh, el, 41);
            var S1l = rotrLo(eh, el, 14) ^ rotrLo(eh, el, 18) ^ rotrLo(eh, el, 41);
            var chh = (eh & fh) ^ (~eh & gh);
            var chl = (el & fl) ^ (~el & gl);

            var t1l = (hl >>> 0) + (S1l >>> 0);
            var t1h = (hh >>> 0) + (S1h >>> 0) + Math.floor(t1l / 4294967296);
            t1l = t1l >>> 0;
            t1l += chl >>> 0;
            t1h += (chh >>> 0) + Math.floor(t1l / 4294967296);
            t1l = t1l >>> 0;
            t1l += K512[i * 2 + 1] >>> 0;
            t1h += (K512[i * 2] >>> 0) + Math.floor(t1l / 4294967296);
            t1l = t1l >>> 0;
            t1l += w[i * 2 + 1] >>> 0;
            t1h += (w[i * 2] >>> 0) + Math.floor(t1l / 4294967296);
            t1l = t1l | 0;
            t1h = t1h | 0;

            var S0h = rotrHi(ah, al, 28) ^ rotrHi(ah, al, 34) ^ rotrHi(ah, al, 39);
            var S0l = rotrLo(ah, al, 28) ^ rotrLo(ah, al, 34) ^ rotrLo(ah, al, 39);
            var majh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
            var majl = (al & bl) ^ (al & cl) ^ (bl & cl);

            var t2l = (S0l >>> 0) + (majl >>> 0);
            var t2h = (S0h >>> 0) + (majh >>> 0) + Math.floor(t2l / 4294967296);
            t2l = t2l | 0;
            t2h = t2h | 0;

            hh = gh; hl = gl;
            gh = fh; gl = fl;
            fh = eh; fl = el;

            var nl = (dl >>> 0) + (t1l >>> 0);
            var nh = (dh >>> 0) + (t1h >>> 0) + Math.floor(nl / 4294967296);
            eh = nh | 0; el = nl | 0;

            dh = ch; dl = cl;
            ch = bh; cl = bl;
            bh = ah; bl = al;

            nl = (t1l >>> 0) + (t2l >>> 0);
            nh = (t1h >>> 0) + (t2h >>> 0) + Math.floor(nl / 4294967296);
            ah = nh | 0; al = nl | 0;
        }

        var vars = [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl];
        for (i = 0; i < 8; i++) {
            var sl = (h[i * 2 + 1] >>> 0) + (vars[i * 2 + 1] >>> 0);
            var sh = (h[i * 2] >>> 0) + (vars[i * 2] >>> 0) + Math.floor(sl / 4294967296);
            h[i * 2] = sh | 0;
            h[i * 2 + 1] = sl | 0;
        }
    };

    Sha512.prototype.digestHex = function () {
        this.padTail(16, false);
        var out = '';
        for (var i = 0; i < this.outWords * 2; i++) out += hex32(this.h[i]);
        return out;
    };

    // --- CRC-32 -----------------------------------------------------------------

    var CRC32_TABLE = (function () {
        var table = new Uint32Array(256);
        for (var i = 0; i < 256; i++) {
            var c = i;
            for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            table[i] = c >>> 0;
        }
        return table;
    })();

    function Crc32() {
        this.crc = 0xFFFFFFFF;
    }
    Crc32.prototype.update = function (bytes) {
        var crc = this.crc;
        for (var i = 0; i < bytes.length; i++) {
            crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        }
        this.crc = crc;
        return this;
    };
    Crc32.prototype.digestHex = function () {
        return ((this.crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
    };

    // --- Publikt API ------------------------------------------------------------

    var ALGO_IDS = ['md5', 'sha1', 'sha256', 'sha384', 'sha512', 'crc32'];

    // Hex-längd per algoritm, används för att känna igen vilken algoritm en
    // inklistrad jämförelsehash hör till.
    var HEX_LENGTHS = {
        crc32: 8,
        md5: 32,
        sha1: 40,
        sha256: 64,
        sha384: 96,
        sha512: 128,
    };

    var WEBCRYPTO_NAMES = {
        sha1: 'SHA-1',
        sha256: 'SHA-256',
        sha384: 'SHA-384',
        sha512: 'SHA-512',
    };

    function createHasher(id) {
        if (id === 'md5') return new Md5();
        if (id === 'sha1') return new Sha1();
        if (id === 'sha256') return new Sha256();
        if (id === 'sha384') return new Sha512(INIT_384, 6);
        if (id === 'sha512') return new Sha512(INIT_512, 8);
        if (id === 'crc32') return new Crc32();
        throw new Error('Okänd algoritm: ' + id);
    }

    // Hashar en byte-sekvens med rena JS-implementationer. Används av strömningen
    // och av testerna.
    function hashBytes(bytes, ids) {
        var hashers = ids.map(function (id) { return { id: id, h: createHasher(id) }; });
        hashers.forEach(function (entry) { entry.h.update(bytes); });
        var out = {};
        hashers.forEach(function (entry) { out[entry.id] = entry.h.digestHex(); });
        return out;
    }

    function getSubtle() {
        if (typeof crypto !== 'undefined' && crypto && crypto.subtle) return crypto.subtle;
        return null;
    }

    // Snabb väg: WebCrypto för SHA-familjen, JS för MD5/CRC-32.
    async function hashBytesFast(bytes, ids) {
        var subtle = getSubtle();
        if (!subtle) return hashBytes(bytes, ids);

        var out = {};
        var jobs = [];
        ids.forEach(function (id) {
            var name = WEBCRYPTO_NAMES[id];
            if (!name) {
                out[id] = createHasher(id).update(bytes).digestHex();
                return;
            }
            jobs.push(subtle.digest(name, bytes).then(function (buf) {
                out[id] = [].map.call(new Uint8Array(buf), function (b) {
                    return b.toString(16).padStart(2, '0');
                }).join('');
            }));
        });
        await Promise.all(jobs);
        return out;
    }

    // Strömmar en Blob/File i bitar. `onProgress(processedBytes, totalBytes)` anropas
    // efter varje bit, och `shouldCancel()` kan avbryta beräkningen.
    async function hashBlobStreaming(blob, ids, onProgress, shouldCancel) {
        var hashers = ids.map(function (id) { return { id: id, h: createHasher(id) }; });
        var offset = 0;
        var total = blob.size;

        if (onProgress) onProgress(0, total);
        while (offset < total) {
            if (shouldCancel && shouldCancel()) return null;
            var end = Math.min(offset + CHUNK_SIZE, total);
            var chunk = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
            for (var i = 0; i < hashers.length; i++) hashers[i].h.update(chunk);
            offset = end;
            if (onProgress) onProgress(offset, total);
        }

        var out = {};
        hashers.forEach(function (entry) { out[entry.id] = entry.h.digestHex(); });
        return out;
    }

    // Väljer automatiskt mellan snabb engångsberäkning och strömning.
    async function hashBlob(blob, ids, onProgress, shouldCancel) {
        if (blob.size <= ONESHOT_LIMIT) {
            if (onProgress) onProgress(0, blob.size);
            var bytes = new Uint8Array(await blob.arrayBuffer());
            if (shouldCancel && shouldCancel()) return null;
            var result = await hashBytesFast(bytes, ids);
            if (onProgress) onProgress(blob.size, blob.size);
            return result;
        }
        return hashBlobStreaming(blob, ids, onProgress, shouldCancel);
    }

    // Plockar ut hex ur en inklistrad jämförelsehash. Klarar versaler, blanksteg och
    // det "<hash>  <filnamn>"-format som sha256sum skriver.
    function normalizeExpected(text) {
        var trimmed = String(text || '').trim();
        if (!trimmed) return '';
        var firstToken = trimmed.split(/\s+/)[0];
        var cleaned = firstToken.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
        return cleaned;
    }

    // Vilka av algoritmerna kan den här hex-strängen vara? Längden avgör.
    function matchAlgosByLength(hex) {
        return ALGO_IDS.filter(function (id) { return HEX_LENGTHS[id] === hex.length; });
    }

    return {
        ALGO_IDS: ALGO_IDS,
        HEX_LENGTHS: HEX_LENGTHS,
        ONESHOT_LIMIT: ONESHOT_LIMIT,
        CHUNK_SIZE: CHUNK_SIZE,
        createHasher: createHasher,
        hashBytes: hashBytes,
        hashBytesFast: hashBytesFast,
        hashBlob: hashBlob,
        hashBlobStreaming: hashBlobStreaming,
        normalizeExpected: normalizeExpected,
        matchAlgosByLength: matchAlgosByLength,
    };
}));
