// Bilagornas filer i Chattar: dekryptering när appen krypterar dem på telefonen (rollens decrypt) och kontroll av
// SHA-256 mot databasen. Testas i Node.
//  - signal-ios: filen är IV (16 byte) + AES-256-CBC + HMAC-SHA256 (32 byte) över IV och chiffertext. Nyckeln är
//    bilagans encryptionKey (64 byte: AES, sedan HMAC). Klartexten kapas till unencryptedByteCount. Kontrollerat mot
//    labbtelefonens elva filer: MAC och SHA-256 stämmer för alla.
//  - signal-android: AES-256-CTR med noll-IV och nyckeln HMAC-SHA256(modernKey, data_random), som i Härkomst.
(function (root) {
    'use strict';

    var node = typeof module !== 'undefined' && module.exports;
    var SqlCipher = node ? require('../db-queries/sqlcipher.js') : root.SqlCipher;
    function subtle() {
        if (root.crypto && root.crypto.subtle) return root.crypto.subtle;
        if (node) return require('node:crypto').webcrypto.subtle;
        throw new Error('WebCrypto saknas, så filen kan inte dekrypteras.');
    }

    function hexToBytes(hex) {
        var s = String(hex || '');
        if (!/^([0-9a-f]{2})*$/i.test(s)) throw new Error('Nyckeln är inte hex.');
        var out = new Uint8Array(s.length / 2);
        for (var i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
        return out;
    }

    function toHex(buf) {
        var b = new Uint8Array(buf), out = '';
        for (var i = 0; i < b.length; i++) out += ('0' + b[i].toString(16)).slice(-2);
        return out;
    }

    async function sha256Hex(bytes) { return toHex(await subtle().digest('SHA-256', bytes)); }

    async function signalIos(bytes, keyHex, plainLength) {
        var key = hexToBytes(keyHex);
        if (key.length !== 64) throw new Error('Bilagans nyckel är ' + key.length + ' byte, inte 64.');
        if (bytes.length < 64 || (bytes.length - 48) % 16 !== 0) throw new Error('Filen har inte formen IV, AES-CBC och HMAC (' + bytes.length + ' byte).');
        var s = subtle();
        var body = bytes.subarray(0, bytes.length - 32), mac = bytes.subarray(bytes.length - 32);
        var hk = await s.importKey('raw', key.subarray(32, 64), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        if (!(await s.verify('HMAC', hk, mac, body))) throw new Error('Filens HMAC stämmer inte med bilagans nyckel.');
        var ak = await s.importKey('raw', key.subarray(0, 32), { name: 'AES-CBC' }, false, ['decrypt']);
        var plain = new Uint8Array(await s.decrypt({ name: 'AES-CBC', iv: bytes.subarray(0, 16) }, ak, bytes.subarray(16, bytes.length - 32)));
        return plainLength > 0 && plainLength <= plain.length ? plain.subarray(0, plainLength) : plain;
    }

    function signalAndroid(bytes, modernKeyB64, randomHex, plainLength) {
        if (!modernKeyB64) throw new Error('Bilagenyckeln (modernKey) saknas, så filen kan inte dekrypteras.');
        if (!randomHex) throw new Error('data_random saknas för bilagan.');
        var key = SqlCipher.hmac('sha256', SqlCipher.base64ToBytes(modernKeyB64), [hexToBytes(randomHex)]);
        var plain = SqlCipher.ctr(SqlCipher.expandKey(key), new Uint8Array(16), bytes);
        return plainLength > 0 && plainLength <= plain.length ? plain.subarray(0, plainLength) : plain;
    }

    // Filens innehåll som appen ser det. kind: rollens decrypt (eller inget). ctx: { modernKey } för Android.
    async function open(kind, bytes, a, ctx) {
        if (!kind) return bytes;
        if (kind === 'signal-ios') return signalIos(bytes, a.key, a.size);
        if (kind === 'signal-android') return signalAndroid(bytes, ctx && ctx.modernKey, a.random, a.size);
        throw new Error('Okänd kryptering för bilagor: ' + kind);
    }

    // SHA-256 för innehållet och om den stämmer med databasen: ok är true, false eller null (databasen har ingen summa).
    async function check(bytes, a) {
        var hash = await sha256Hex(bytes);
        return { hash: hash, ok: a.sha256 ? hash === String(a.sha256).toLowerCase() : null };
    }

    var api = { open: open, check: check, sha256Hex: sha256Hex, signalIos: signalIos, signalAndroid: signalAndroid, hexToBytes: hexToBytes };
    if (node) module.exports = api;
    else root.ChatMedia = api;
})(typeof window !== 'undefined' ? window : this);
