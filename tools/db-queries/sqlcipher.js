// SQLCipher-krypterade databaser (Signal på Android och iOS) i läsbar form. Sidorna dekrypteras i
// minnet, -wal-ramarna likaså (via SqliteWal.apply), och resultatet är en vanlig SQLite-databas
// för sql.js. Källfilerna ändras aldrig. AES-256 (CBC för sidorna, CTR för Signals bilagor),
// HMAC och PBKDF2 finns i ren JS, så att allt går likadant i Node och i webbläsaren, och openAsync
// gör samma sak med WebCrypto, mångdubbelt snabbare, när det finns. SHA-1, SHA-256 och SHA-512
// kommer från ToolboxHashing. Testas i Node mot Nodes crypto och FIPS-197:s testvektor.
(function (root) {
    'use strict';

    // Inställningar per app. Signal på Android: lösenordet är databasnyckelns hex (64 tecken),
    // nyckeln tas fram med PBKDF2-HMAC-SHA1 i 1 varv, varje sida har HMAC-SHA1 och sidstorleken är
    // 4096. Reserven i slutet av varje sida är IV (16) + HMAC (20), avrundat till hela block: 48.
    // Kontrollerat mot Signal 8.33 på en labbtelefon (Android 13) och Signal 8.10 i en verklig extraktion.
    // Signal på iOS: SQLCipher 4 med en rå nyckel. Nyckeln i nyckelringen är 48 byte, AES-nyckeln (32)
    // och saltet (16). De första 32 byten i filen är okrypterade (SQLite-huvudet), så saltet står inte
    // i filen. Varje sida har HMAC-SHA512, HMAC-nyckeln tas fram med PBKDF2-HMAC-SHA512 i 2 varv och
    // reserven är IV (16) + HMAC (64) = 80. Kontrollerat mot en labbtelefon (iOS 26.4.1, 2026-11-03).
    var PROFILES = {
        signal: { id: 'signal', label: 'Signal', settings: 'Signals inställningar', pageSize: 4096, kdf: 'sha1', kdfIter: 1, hmac: 'sha1', hmacLen: 20, fastIter: 2, saltMask: 0x3a, keyIsHex: true },
        'signal-ios': { id: 'signal-ios', label: 'Signal (iOS)', settings: 'Signals inställningar på iOS', pageSize: 4096, rawKey: true, kdf: 'sha512', hmac: 'sha512', hmacLen: 64, fastIter: 2, saltMask: 0x3a, header: 32 },
    };
    var BTREE_PAGE_TYPES = [2, 5, 10, 13];
    var HEADER = 'SQLite format 3\u0000';

    function hashing() {
        var h = root.ToolboxHashing || (typeof module !== 'undefined' && module.exports ? require('../hash-calculator/hashing.js') : null);
        if (!h) throw new Error('ToolboxHashing saknas (hashing.js).');
        return h;
    }

    // ---------- AES-256 ----------

    var SBOX = new Uint8Array(256);
    var ISBOX = new Uint8Array(256);
    var TE = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    var TD = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];

    function xtime(b) { return ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 0xff; }
    function gmul(a, b) {
        var r = 0;
        while (b) { if (b & 1) r ^= a; a = xtime(a); b >>= 1; }
        return r;
    }
    function rotl8(x, n) { return ((x << n) | (x >> (8 - n))) & 0xff; }
    function rotr32(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

    (function tables() {
        // S-boxen: multiplikativ invers i GF(2^8) (p går igenom gruppen med generatorn 3, q är
        // dess invers) följd av den affina avbildningen.
        var p = 1, q = 1;
        do {
            p = p ^ xtime(p);
            q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff;
            if (q & 0x80) q ^= 0x09;
            SBOX[p] = q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63;
        } while (p !== 1);
        SBOX[0] = 0x63;
        for (var i = 0; i < 256; i++) ISBOX[SBOX[i]] = i;
        for (var x = 0; x < 256; x++) {
            var s = SBOX[x];
            var e = ((gmul(s, 2) << 24) | (s << 16) | (s << 8) | gmul(s, 3)) >>> 0;
            var si = ISBOX[x];
            var d = ((gmul(si, 14) << 24) | (gmul(si, 9) << 16) | (gmul(si, 13) << 8) | gmul(si, 11)) >>> 0;
            for (var k = 0; k < 4; k++) {
                TE[k][x] = rotr32(e, 8 * k);
                TD[k][x] = rotr32(d, 8 * k);
            }
        }
    })();

    function subWord(w) {
        return ((SBOX[w >>> 24] << 24) | (SBOX[(w >>> 16) & 255] << 16) | (SBOX[(w >>> 8) & 255] << 8) | SBOX[w & 255]) >>> 0;
    }

    // Nyckelschemat för AES-256 (14 rundor): 60 ord för kryptering och de inversa rundnycklarna
    // (InvMixColumns på de mittersta) för dekryptering.
    function expandKey(key) {
        if (!key || key.length !== 32) throw new Error('AES-256 kräver en nyckel på 32 byte.');
        var w = new Uint32Array(60);
        for (var i = 0; i < 8; i++) w[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
        var rcon = 1;
        for (i = 8; i < 60; i++) {
            var t = w[i - 1];
            if (i % 8 === 0) {
                t = subWord(((t << 8) | (t >>> 24)) >>> 0) ^ (rcon << 24);
                rcon = xtime(rcon);
            } else if (i % 8 === 4) {
                t = subWord(t);
            }
            w[i] = (w[i - 8] ^ t) >>> 0;
        }
        var dk = new Uint32Array(60);
        for (var r = 0; r <= 14; r++) {
            for (var j = 0; j < 4; j++) {
                var v = w[4 * (14 - r) + j];
                if (r > 0 && r < 14) v = (TD[0][SBOX[v >>> 24]] ^ TD[1][SBOX[(v >>> 16) & 255]] ^ TD[2][SBOX[(v >>> 8) & 255]] ^ TD[3][SBOX[v & 255]]) >>> 0;
                dk[4 * r + j] = v;
            }
        }
        return { enc: w, dec: dk };
    }

    function readWord(b, at) { return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0; }
    function writeWord(b, at, v) { b[at] = v >>> 24; b[at + 1] = (v >>> 16) & 255; b[at + 2] = (v >>> 8) & 255; b[at + 3] = v & 255; }

    // Ett block (16 byte) från in[inAt] till out[outAt].
    function encryptBlock(ks, input, inAt, out, outAt) {
        var k = ks.enc;
        var s0 = readWord(input, inAt) ^ k[0], s1 = readWord(input, inAt + 4) ^ k[1], s2 = readWord(input, inAt + 8) ^ k[2], s3 = readWord(input, inAt + 12) ^ k[3];
        var t0, t1, t2, t3;
        for (var r = 1; r < 14; r++) {
            t0 = TE[0][s0 >>> 24] ^ TE[1][(s1 >>> 16) & 255] ^ TE[2][(s2 >>> 8) & 255] ^ TE[3][s3 & 255] ^ k[4 * r];
            t1 = TE[0][s1 >>> 24] ^ TE[1][(s2 >>> 16) & 255] ^ TE[2][(s3 >>> 8) & 255] ^ TE[3][s0 & 255] ^ k[4 * r + 1];
            t2 = TE[0][s2 >>> 24] ^ TE[1][(s3 >>> 16) & 255] ^ TE[2][(s0 >>> 8) & 255] ^ TE[3][s1 & 255] ^ k[4 * r + 2];
            t3 = TE[0][s3 >>> 24] ^ TE[1][(s0 >>> 16) & 255] ^ TE[2][(s1 >>> 8) & 255] ^ TE[3][s2 & 255] ^ k[4 * r + 3];
            s0 = t0 >>> 0; s1 = t1 >>> 0; s2 = t2 >>> 0; s3 = t3 >>> 0;
        }
        writeWord(out, outAt, ((SBOX[s0 >>> 24] << 24) | (SBOX[(s1 >>> 16) & 255] << 16) | (SBOX[(s2 >>> 8) & 255] << 8) | SBOX[s3 & 255]) ^ k[56]);
        writeWord(out, outAt + 4, ((SBOX[s1 >>> 24] << 24) | (SBOX[(s2 >>> 16) & 255] << 16) | (SBOX[(s3 >>> 8) & 255] << 8) | SBOX[s0 & 255]) ^ k[57]);
        writeWord(out, outAt + 8, ((SBOX[s2 >>> 24] << 24) | (SBOX[(s3 >>> 16) & 255] << 16) | (SBOX[(s0 >>> 8) & 255] << 8) | SBOX[s1 & 255]) ^ k[58]);
        writeWord(out, outAt + 12, ((SBOX[s3 >>> 24] << 24) | (SBOX[(s0 >>> 16) & 255] << 16) | (SBOX[(s1 >>> 8) & 255] << 8) | SBOX[s2 & 255]) ^ k[59]);
    }

    function decryptBlock(ks, input, inAt, out, outAt) {
        var k = ks.dec;
        var s0 = readWord(input, inAt) ^ k[0], s1 = readWord(input, inAt + 4) ^ k[1], s2 = readWord(input, inAt + 8) ^ k[2], s3 = readWord(input, inAt + 12) ^ k[3];
        var t0, t1, t2, t3;
        for (var r = 1; r < 14; r++) {
            t0 = TD[0][s0 >>> 24] ^ TD[1][(s3 >>> 16) & 255] ^ TD[2][(s2 >>> 8) & 255] ^ TD[3][s1 & 255] ^ k[4 * r];
            t1 = TD[0][s1 >>> 24] ^ TD[1][(s0 >>> 16) & 255] ^ TD[2][(s3 >>> 8) & 255] ^ TD[3][s2 & 255] ^ k[4 * r + 1];
            t2 = TD[0][s2 >>> 24] ^ TD[1][(s1 >>> 16) & 255] ^ TD[2][(s0 >>> 8) & 255] ^ TD[3][s3 & 255] ^ k[4 * r + 2];
            t3 = TD[0][s3 >>> 24] ^ TD[1][(s2 >>> 16) & 255] ^ TD[2][(s1 >>> 8) & 255] ^ TD[3][s0 & 255] ^ k[4 * r + 3];
            s0 = t0 >>> 0; s1 = t1 >>> 0; s2 = t2 >>> 0; s3 = t3 >>> 0;
        }
        writeWord(out, outAt, ((ISBOX[s0 >>> 24] << 24) | (ISBOX[(s3 >>> 16) & 255] << 16) | (ISBOX[(s2 >>> 8) & 255] << 8) | ISBOX[s1 & 255]) ^ k[56]);
        writeWord(out, outAt + 4, ((ISBOX[s1 >>> 24] << 24) | (ISBOX[(s0 >>> 16) & 255] << 16) | (ISBOX[(s3 >>> 8) & 255] << 8) | ISBOX[s2 & 255]) ^ k[57]);
        writeWord(out, outAt + 8, ((ISBOX[s2 >>> 24] << 24) | (ISBOX[(s1 >>> 16) & 255] << 16) | (ISBOX[(s0 >>> 8) & 255] << 8) | ISBOX[s3 & 255]) ^ k[58]);
        writeWord(out, outAt + 12, ((ISBOX[s3 >>> 24] << 24) | (ISBOX[(s2 >>> 16) & 255] << 16) | (ISBOX[(s1 >>> 8) & 255] << 8) | ISBOX[s0 & 255]) ^ k[59]);
    }

    // CBC utan utfyllnad: data är hela block.
    function cbcDecrypt(ks, iv, data) {
        if (data.length % 16) throw new Error('CBC-data måste vara hela block (16 byte).');
        var out = new Uint8Array(data.length);
        var prev = iv;
        var prevAt = 0;
        for (var at = 0; at < data.length; at += 16) {
            decryptBlock(ks, data, at, out, at);
            for (var i = 0; i < 16; i++) out[at + i] ^= prev[prevAt + i];
            prev = data;
            prevAt = at;
        }
        return out;
    }

    // CTR som Javas AES/CTR/NoPadding: räknaren är hela blocket, stor endian.
    function ctr(ks, iv, data) {
        var counter = new Uint8Array(16);
        counter.set(iv);
        var stream = new Uint8Array(16);
        var out = new Uint8Array(data.length);
        for (var at = 0; at < data.length; at += 16) {
            encryptBlock(ks, counter, 0, stream, 0);
            var n = Math.min(16, data.length - at);
            for (var i = 0; i < n; i++) out[at + i] = data[at + i] ^ stream[i];
            for (var c = 15; c >= 0; c--) { counter[c] = (counter[c] + 1) & 255; if (counter[c]) break; }
        }
        return out;
    }

    // ---------- HMAC och PBKDF2 ----------

    function hexToBytes(hex) {
        var s = String(hex || '').replace(/\s+/g, '');
        if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error('Ogiltig hex.');
        var out = new Uint8Array(s.length / 2);
        for (var i = 0; i < out.length; i++) out[i] = parseInt(s.substr(2 * i, 2), 16);
        return out;
    }
    function bytesToHex(b) {
        var s = '';
        for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
        return s;
    }
    function utf8(text) {
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
        return Uint8Array.from(Buffer.from(text, 'utf8'));
    }
    function base64ToBytes(text) {
        var s = String(text || '').replace(/[\s=]+/g, '').replace(/-/g, '+').replace(/_/g, '/');
        if (typeof atob === 'function') {
            var pad = s + '==='.slice((s.length + 3) % 4);
            var bin = atob(pad);
            var out = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            return out;
        }
        return Uint8Array.from(Buffer.from(s, 'base64'));
    }

    function digest(id, parts) {
        var h = hashing().createHasher(id);
        parts.forEach(function (p) { h.update(p); });
        return hexToBytes(h.digestHex());
    }

    // HMAC med SHA-1 eller SHA-256 (block 64 byte) eller SHA-512 (block 128 byte). parts:
    // Uint8Array:er som räknas i följd.
    function hmac(id, key, parts) {
        var block = id === 'sha512' || id === 'sha384' ? 128 : 64;
        if (key.length > block) key = digest(id, [key]);
        var ipad = new Uint8Array(block);
        var opad = new Uint8Array(block);
        for (var i = 0; i < block; i++) {
            var k = i < key.length ? key[i] : 0;
            ipad[i] = k ^ 0x36;
            opad[i] = k ^ 0x5c;
        }
        var inner = digest(id, [ipad].concat(parts));
        return digest(id, [opad, inner]);
    }

    function pbkdf2(id, password, salt, iterations, length) {
        var out = new Uint8Array(length);
        var done = 0;
        for (var block = 1; done < length; block++) {
            var idx = new Uint8Array([block >>> 24, (block >>> 16) & 255, (block >>> 8) & 255, block & 255]);
            var u = hmac(id, password, [salt, idx]);
            var t = u.slice();
            for (var i = 1; i < iterations; i++) {
                u = hmac(id, password, [u]);
                for (var j = 0; j < t.length; j++) t[j] ^= u[j];
            }
            var n = Math.min(t.length, length - done);
            out.set(t.subarray(0, n), done);
            done += n;
        }
        return out;
    }

    // ---------- SQLCipher ----------

    function isPlain(bytes) {
        if (!bytes || bytes.length < 16) return false;
        for (var i = 0; i < 16; i++) if (bytes[i] !== HEADER.charCodeAt(i)) return false;
        return true;
    }

    function profileOf(name) {
        var p = PROFILES[name || 'signal'];
        if (!p) throw new Error('Okänd SQLCipher-profil: ' + name);
        return p;
    }

    function reserveOf(profile) { return Math.ceil((16 + profile.hmacLen) / 16) * 16; }

    function u16(b, at) { return (b[at] << 8) | b[at + 1]; }

    // Ser byten från at ut som huvudet för ett b-träd i en okrypterad sida? Typ, första fria block,
    // var cellerna börjar och fragmenterade byte ska alla vara rimliga. Slumpmässiga (krypterade)
    // byte klarar det nästan aldrig.
    function looksLikeBtree(b, at, usable) {
        if (BTREE_PAGE_TYPES.indexOf(b[at]) < 0) return false;
        var free = u16(b, at + 1), content = u16(b, at + 5) || 65536;
        return (free === 0 || (free > at && free < usable)) && content <= usable && b[at + 7] <= 60;
    }

    // Är filen krypterad med SQLCipher? Utan okrypterat huvud börjar den med saltet i stället för
    // "SQLite format 3". Med okrypterat huvud (Signal på iOS) börjar den som SQLite, men byte 20
    // anger en reserv för IV och HMAC (profilens, eller minst 32 byte), och sidan efter huvudet är
    // krypterad, så b-trädets huvud på plats 100 ser inte ut som ett.
    function isEncrypted(bytes, profileName) {
        if (!bytes || bytes.length < 16) return false;
        if (!isPlain(bytes)) return true;
        if (bytes.length < 108) return false;
        var p = profileName ? PROFILES[profileName] : null;
        var reserve = bytes[20];
        if (p && p.header ? reserve !== reserveOf(p) : reserve < 32) return false;
        var size = u16(bytes, 16) === 1 ? 65536 : u16(bytes, 16);
        return !looksLikeBtree(bytes, 100, size - reserve);
    }

    // Nycklarna för en databas. passphrase är texten appen ger SQLCipher. Signal på Android: nyckelns
    // hex, saltet är de 16 första byten i filen. En rå nyckel (Signal på iOS) är 96 hextecken, med
    // eller utan x'…': AES-nyckeln och saltet. 64 hextecken räcker bara när saltet står i filen.
    function keysFor(db, passphrase, profile) {
        var salt, key;
        if (profile.rawKey) {
            var raw = hexToBytes(String(passphrase).trim().replace(/^x'/i, '').replace(/'$/, ''));
            if (raw.length === 48) salt = raw.slice(32, 48);
            else if (raw.length === 32 && !profile.header) salt = db.slice(0, 16);
            else throw new Error(raw.length === 32 ? 'Nyckeln saknar saltet. Med okrypterat huvud står saltet inte i filen, och nyckeln ska vara 48 byte (96 hextecken).' : 'Nyckeln ska vara 48 byte (96 hextecken), inte ' + raw.length + '.');
            key = raw.slice(0, 32);
        } else {
            salt = db.subarray(0, 16);
            key = pbkdf2(profile.kdf, utf8(String(passphrase)), salt, profile.kdfIter, 32);
        }
        var macSalt = new Uint8Array(16);
        for (var i = 0; i < 16; i++) macSalt[i] = salt[i] ^ profile.saltMask;
        var macKey = pbkdf2(profile.kdf, key, macSalt, profile.fastIter, 32);
        return { aes: expandKey(key), key: key, macKey: macKey, salt: salt.slice() };
    }

    // En dekrypterad sida i full storlek: på sida 1 står "SQLite format 3" i stället för saltet (med
    // okrypterat huvud står huvudet kvar), och reserven (IV och HMAC) blir nollor. SQLite läser
    // reservens storlek i byte 20.
    function decryptPage(keys, profile, page, pgno) {
        var size = profile.pageSize;
        var reserve = reserveOf(profile);
        var start = pgno === 1 ? (profile.header || 16) : 0;
        var end = size - reserve;
        var data = page.subarray(start, end);
        var iv = page.subarray(end, end + 16);
        var mac = page.subarray(end + 16, end + 16 + profile.hmacLen);
        var pn = new Uint8Array([pgno & 255, (pgno >>> 8) & 255, (pgno >>> 16) & 255, pgno >>> 24]);
        var calc = hmac(profile.hmac, keys.macKey, [data, iv, pn]);
        var ok = calc.length >= profile.hmacLen;
        for (var i = 0; ok && i < profile.hmacLen; i++) if (calc[i] !== mac[i]) ok = false;
        var plain = cbcDecrypt(keys.aes, iv, data);
        var out = new Uint8Array(size);
        if (pgno === 1 && profile.header) {
            out.set(page.subarray(0, start), 0);
            out.set(plain, start);
        } else if (pgno === 1) {
            for (var h = 0; h < 16; h++) out[h] = HEADER.charCodeAt(h);
            out.set(plain, 16);
        } else {
            out.set(plain, 0);
        }
        return { bytes: out, hmacOk: ok };
    }

    // Dekrypterar hela databasfilen. Stämmer inte HMAC för sida 1 är nyckeln (eller profilen)
    // fel, och då kastas ett fel i klartext. Returnerar { bytes, keys, stats: { pages, badHmac } }.
    function checkDatabase(db, profile) {
        if (!isEncrypted(db, profile.id)) throw new Error('Databasen är inte krypterad.');
        if (db.length < profile.pageSize || db.length % profile.pageSize) throw new Error('Filens storlek (' + db.length + ' byte) är inte ett helt antal sidor på ' + profile.pageSize + ' byte. Är det en SQLCipher-databas?');
    }

    function wrongKey(profile) {
        return new Error('Nyckeln passar inte: kontrollsumman (HMAC) för första sidan stämmer inte. Fel nyckel, eller andra SQLCipher-inställningar än ' + profile.settings + '.');
    }

    function decryptDatabase(db, passphrase, profileName) {
        var profile = profileOf(profileName);
        db = db instanceof Uint8Array ? db : new Uint8Array(db);
        checkDatabase(db, profile);
        var keys = keysFor(db, passphrase, profile);
        var pages = db.length / profile.pageSize;
        var out = new Uint8Array(db.length);
        var bad = 0;
        for (var p = 1; p <= pages; p++) {
            var r = decryptPage(keys, profile, db.subarray((p - 1) * profile.pageSize, p * profile.pageSize), p);
            if (p === 1 && !r.hmacOk) throw wrongKey(profile);
            if (!r.hmacOk) bad++;
            out.set(r.bytes, (p - 1) * profile.pageSize);
        }
        return { bytes: out, keys: keys, profile: profile, stats: { pages: pages, badHmac: bad } };
    }

    // Dekrypterar sidorna i -wal när ramarna läggs på (SqliteWal.apply med opts.page). Räknar
    // sidor och HMAC-fel i stats.
    function walPageDecryptor(keys, profile, stats) {
        return function (page, pgno) {
            var r = decryptPage(keys, profile, page, pgno);
            stats.walPages = (stats.walPages || 0) + 1;
            if (!r.hmacOk) stats.walBadHmac = (stats.walBadHmac || 0) + 1;
            return r.bytes;
        };
    }

    // Databasen och dess -wal dekrypterade och sammanlagda. wal får vara tom. Returnerar som
    // SqliteWal.apply: { bytes, stats }, med stats.cipher = { profile, pages, badHmac, walPages, walBadHmac }.
    function open(db, wal, passphrase, profileName, SqliteWal) {
        var dec = decryptDatabase(db, passphrase, profileName);
        var cipherStats = { profile: dec.profile.label, settings: dec.profile.settings, pages: dec.stats.pages, badHmac: dec.stats.badHmac, walPages: 0, walBadHmac: 0 };
        var Wal = SqliteWal || root.SqliteWal || (typeof module !== 'undefined' && module.exports ? require('./wal.js') : null);
        var merged = Wal.apply(dec.bytes, wal || new Uint8Array(0), { owned: true, page: walPageDecryptor(dec.keys, dec.profile, cipherStats) });
        merged.stats.cipher = cipherStats;
        return merged;
    }

    // ---------- Samma sak med WebCrypto ----------

    // Sidor per anrop till AES (8 MB med sidor på 4096 byte).
    var BATCH_PAGES = 2048;
    var SUBTLE_HASH = { sha1: 'SHA-1', sha256: 'SHA-256', sha512: 'SHA-512' };

    function subtleOf(opts) {
        if (opts && opts.subtle !== undefined) return opts.subtle;
        var c = root.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
        return c && c.subtle ? c.subtle : null;
    }

    async function subtleKeys(subtle, keys, profile) {
        return {
            aes: await subtle.importKey('raw', keys.key, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']),
            mac: await subtle.importKey('raw', keys.macKey, { name: 'HMAC', hash: SUBTLE_HASH[profile.hmac] }, false, ['sign']),
        };
    }

    // Släpper fram annat arbete i appen. WebCrypto-svaren körs före allt annat, så utan en paus står
    // sidan still tills hela databasen är klar. MessageChannel, eftersom setTimeout bromsas i ett dolt fönster.
    function yieldToApp() {
        return new Promise(function (resolve) {
            if (typeof MessageChannel === 'undefined') { resolve(); return; }
            var ch = new MessageChannel();
            ch.port1.onmessage = function () { ch.port1.close(); resolve(); };
            ch.port2.postMessage(0);
        });
    }

    // Dekrypterar en bit sidor (inte sida 1, som har ett huvud) till dest på platserna destAt, och
    // kontrollerar varje sidas HMAC. Returnerar om HMAC stämde, per sida.
    //
    // AES-CBC körs i ett enda anrop på sidorna i följd. Varje block dekrypteras och blandas med blocket
    // före, så allt utom första blocket i en sida blir rätt av sig själv. Första blocket har blandats med
    // slutet av sidan före i stället för med sidans IV, och rättas här. WebCrypto kräver PKCS#7, så ett
    // sista block läggs till: krypterat med det sista blocket som IV blir det precis utfyllnaden.
    async function decryptBatch(subtle, sk, profile, pages, pgnos, dest, destAt) {
        var size = profile.pageSize;
        var end = size - reserveOf(profile);
        var n = pages.length;
        var stream = new Uint8Array(n * size + 16);
        for (var s = 0; s < n; s++) stream.set(pages[s], s * size);
        var padding = await subtle.encrypt({ name: 'AES-CBC', iv: stream.slice(n * size - 16, n * size) }, sk.aes, new Uint8Array(0));
        stream.set(new Uint8Array(padding), n * size);
        var plain = new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv: stream.slice(end, end + 16) }, sk.aes, stream));
        var msgSize = end + 16 + 4;
        var msgs = new Uint8Array(n * msgSize);
        var macs = new Array(n);
        for (var i = 0; i < n; i++) {
            var off = i * size;
            var to = destAt[i];
            dest.set(plain.subarray(off, off + end), to);
            if (i) for (var k = 0; k < 16; k++) dest[to + k] ^= stream[off - 16 + k] ^ stream[off + end + k];
            // HMAC över data, IV och sidnumret (little endian).
            var m = i * msgSize;
            msgs.set(stream.subarray(off, off + end + 16), m);
            var pgno = pgnos[i];
            msgs[m + end + 16] = pgno & 255;
            msgs[m + end + 17] = (pgno >>> 8) & 255;
            msgs[m + end + 18] = (pgno >>> 16) & 255;
            msgs[m + end + 19] = pgno >>> 24;
            macs[i] = subtle.sign('HMAC', sk.mac, msgs.subarray(m, m + msgSize));
        }
        var results = await Promise.all(macs);
        return results.map(function (buf, j) {
            var calc = new Uint8Array(buf);
            var at = j * size + end + 16;
            if (calc.length < profile.hmacLen) return false;
            for (var x = 0; x < profile.hmacLen; x++) if (calc[x] !== stream[at + x]) return false;
            return true;
        });
    }

    // Sidorna 2 och framåt i bitar, med en paus efter varje bit.
    async function decryptRest(subtle, keys, profile, db, out, opts) {
        var sk = await subtleKeys(subtle, keys, profile);
        var size = profile.pageSize;
        var pages = db.length / size;
        var batch = opts && opts.batchPages || BATCH_PAGES;
        var bad = 0;
        for (var p = 2; p <= pages; p += batch) {
            var list = [], pgnos = [], destAt = [];
            for (var q = p; q < p + batch && q <= pages; q++) {
                list.push(db.subarray((q - 1) * size, q * size));
                pgnos.push(q);
                destAt.push((q - 1) * size);
            }
            var ok = await decryptBatch(subtle, sk, profile, list, pgnos, out, destAt);
            ok.forEach(function (x) { if (!x) bad++; });
            if (opts && opts.onProgress) opts.onProgress(Math.min(p + batch - 1, pages), pages);
            await yieldToApp();
        }
        return bad;
    }

    // Slut på minne blir inte bättre av ett försök till i ren JS: det felet ska fram som det är.
    function isOutOfMemory(err) {
        return err instanceof RangeError && /allocation|memory/i.test(String(err.message));
    }

    // Sidorna 2 och framåt i ren JS, som decryptRest: i bitar, med förlopp och en paus efter varje bit, så att
    // sidan ritar och svarar under tiden. Omkring 30 MB i sekunden, mot flera hundra med WebCrypto.
    var SLOW_PAGES = 256;
    async function decryptRestSlow(keys, profile, db, out, opts) {
        var size = profile.pageSize;
        var pages = db.length / size;
        var batch = opts && opts.slowPages || SLOW_PAGES;
        var bad = 0;
        for (var p = 2; p <= pages; p++) {
            var r = decryptPage(keys, profile, db.subarray((p - 1) * size, p * size), p);
            if (!r.hmacOk) bad++;
            out.set(r.bytes, (p - 1) * size);
            if (p % batch === 0 || p === pages) {
                if (opts && opts.onProgress) opts.onProgress(p, pages, { slow: true });
                await yieldToApp();
            }
        }
        return bad;
    }

    // Som decryptDatabase. Utan WebCrypto, eller om ett anrop misslyckas, går det i ren JS i samma array, i bitar.
    // opts: { onProgress(sidor, alla, { slow } när det går i ren JS), subtle, batchPages, slowPages }.
    async function decryptDatabaseAsync(db, passphrase, profileName, opts) {
        var profile = profileOf(profileName);
        db = db instanceof Uint8Array ? db : new Uint8Array(db);
        checkDatabase(db, profile);
        var keys = keysFor(db, passphrase, profile);
        var pages = db.length / profile.pageSize;
        var out = new Uint8Array(db.length);
        var first = decryptPage(keys, profile, db.subarray(0, profile.pageSize), 1);
        if (!first.hmacOk) throw wrongKey(profile);
        out.set(first.bytes, 0);
        var subtle = subtleOf(opts);
        var bad = null;
        if (subtle) {
            try { bad = await decryptRest(subtle, keys, profile, db, out, opts); }
            catch (e) { if (isOutOfMemory(e)) throw e; }
        }
        if (bad === null) bad = await decryptRestSlow(keys, profile, db, out, opts);
        return { bytes: out, keys: keys, profile: profile, stats: { pages: pages, badHmac: bad } };
    }

    // Ramarna som ska läggas på, dekrypterade i förväg. Sida 1 har ett huvud och dekrypteras när den läggs på.
    async function decryptWalFrames(subtle, dec, wal, frames, opts) {
        var done = {};
        if (!subtle) return done;
        var profile = dec.profile;
        var size = profile.pageSize;
        var list = frames.filter(function (f) { return f.page > 1; });
        var batch = opts && opts.batchPages || BATCH_PAGES;
        try {
            var sk = await subtleKeys(subtle, dec.keys, profile);
            var dest = new Uint8Array(list.length * size);
            for (var i = 0; i < list.length; i += batch) {
                var part = list.slice(i, i + batch);
                var ok = await decryptBatch(subtle, sk, profile,
                    part.map(function (f) { return wal.subarray(f.at, f.at + size); }),
                    part.map(function (f) { return f.page; }), dest,
                    part.map(function (f, j) { return (i + j) * size; }));
                part.forEach(function (f, j) { done[f.at] = { bytes: dest.subarray((i + j) * size, (i + j + 1) * size), hmacOk: ok[j] }; });
                await yieldToApp();
            }
        } catch (e) {
            if (isOutOfMemory(e)) throw e;
            return {};
        }
        return done;
    }

    // Som open, och med samma resultat, men med WebCrypto när det finns. opts som decryptDatabaseAsync.
    async function openAsync(db, wal, passphrase, profileName, SqliteWal, opts) {
        var dec = await decryptDatabaseAsync(db, passphrase, profileName, opts);
        var cipherStats = { profile: dec.profile.label, settings: dec.profile.settings, pages: dec.stats.pages, badHmac: dec.stats.badHmac, walPages: 0, walBadHmac: 0 };
        var Wal = SqliteWal || root.SqliteWal || (typeof module !== 'undefined' && module.exports ? require('./wal.js') : null);
        var walBytes = wal instanceof Uint8Array ? wal : new Uint8Array(wal || 0);
        var planned = Wal.plan(dec.bytes, walBytes);
        var done = await decryptWalFrames(subtleOf(opts), dec, walBytes, planned.frames, opts);
        var slow = walPageDecryptor(dec.keys, dec.profile, cipherStats);
        var merged = Wal.apply(dec.bytes, walBytes, { plan: planned, owned: true, page: function (page, pgno) {
            var r = done[page.byteOffset - walBytes.byteOffset];
            if (!r) return slow(page, pgno);
            cipherStats.walPages++;
            if (!r.hmacOk) cipherStats.walBadHmac++;
            return r.bytes;
        } });
        merged.stats.cipher = cipherStats;
        return merged;
    }

    // Raden till protokollet om hur databasen dekrypterades.
    function summary(stats, keySource) {
        var c = stats && stats.cipher;
        if (!c) return '';
        var from = keySource === 'inklistrad' ? 'den inklistrade nyckeln' : 'nyckeln ur ' + (keySource || 'okänd källa');
        var text = 'Dekrypterad i minnet (SQLCipher, ' + (c.settings || c.profile + 's inställningar') + ') med ' + from + ': ' + c.pages + ' sidor' + (c.walPages ? ' och ' + c.walPages + ' sidor ur -wal' : '') + '.';
        var bad = c.badHmac + c.walBadHmac;
        text += bad ? ' Kontrollsumman (HMAC) stämde inte för ' + bad + ' sidor: de kan vara skadade.' : ' Kontrollsumman (HMAC) stämde för alla sidor.';
        return text;
    }

    var api = {
        PROFILES: PROFILES, isPlain: isPlain, isEncrypted: isEncrypted, decryptDatabase: decryptDatabase, decryptDatabaseAsync: decryptDatabaseAsync, decryptPage: decryptPage, keysFor: keysFor, open: open, openAsync: openAsync, summary: summary,
        expandKey: expandKey, encryptBlock: encryptBlock, decryptBlock: decryptBlock, cbcDecrypt: cbcDecrypt, ctr: ctr,
        hmac: hmac, pbkdf2: pbkdf2, hexToBytes: hexToBytes, bytesToHex: bytesToHex, base64ToBytes: base64ToBytes, utf8: utf8, reserveOf: reserveOf,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.SqlCipher = api;
})(typeof window !== 'undefined' ? window : this);
