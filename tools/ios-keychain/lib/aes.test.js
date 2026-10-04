const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

require('./aes.js');
const { aes } = globalThis.KC;

// AES här är handskriven (WebCrypto saknar rå CBC utan padding och den blank-IV-GCM
// som iOS-backuper använder), så kärnan verifieras mot publicerade testvektorer och
// mot Nodes crypto — på samma sätt som hash-räknarens rena implementationer.

function hexToBytes(h) {
    return Uint8Array.from(h.replace(/\s+/g, '').match(/../g).map((x) => parseInt(x, 16)));
}
function toHex(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
    return s;
}

test('AES-128 enblockskryptering (FIPS-197 C.1)', () => {
    const key = hexToBytes('000102030405060708090a0b0c0d0e0f');
    const pt = hexToBytes('00112233445566778899aabbccddeeff');
    const out = new Uint8Array(16);
    new aes.AES(key).encryptBlock(pt, 0, out, 0);
    assert.equal(toHex(out), '69c4e0d86a7b0430d8cdb78070b4c55a');
});

test('AES-256 enblockskryptering (FIPS-197 C.3)', () => {
    const key = hexToBytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
    const pt = hexToBytes('00112233445566778899aabbccddeeff');
    const out = new Uint8Array(16);
    new aes.AES(key).encryptBlock(pt, 0, out, 0);
    assert.equal(toHex(out), '8ea2b7ca516745bfeafc49904b496089');
});

test('decryptBlock är inversen av encryptBlock', () => {
    const key = hexToBytes('000102030405060708090a0b0c0d0e0f');
    const ct = hexToBytes('69c4e0d86a7b0430d8cdb78070b4c55a');
    const out = new Uint8Array(16);
    new aes.AES(key).decryptBlock(ct, 0, out, 0);
    assert.equal(toHex(out), '00112233445566778899aabbccddeeff');
});

test('RFC 3394 key unwrap (128-bitars KEK, 128-bitars nyckel)', () => {
    const kek = hexToBytes('000102030405060708090A0B0C0D0E0F');
    const wrapped = hexToBytes('1FA68B0A8112B447AEF34BD8FB5A7B829D3E862371D2CFE5');
    const key = aes.keyUnwrap(kek, wrapped);
    assert.equal(toHex(key), '00112233445566778899aabbccddeeff');
});

test('RFC 3394 key unwrap (256-bitars KEK, 256-bitars nyckel)', () => {
    const kek = hexToBytes('000102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F');
    const wrapped = hexToBytes(
        '28C9F404C4B810F4CBCCB35CFB87F8263F5786E2D80ED326CBC7F0E71A99F43BFB988B9B7A02DD21');
    const key = aes.keyUnwrap(kek, wrapped);
    assert.equal(toHex(key), '00112233445566778899aabbccddeeff000102030405060708090a0b0c0d0e0f');
});

test('key unwrap med fel KEK ger null', () => {
    const wrapped = hexToBytes('1FA68B0A8112B447AEF34BD8FB5A7B829D3E862371D2CFE5');
    const wrongKek = hexToBytes('0102030405060708090a0b0c0d0e0f00');
    assert.equal(aes.keyUnwrap(wrongKek, wrapped), null);
});

test('rå CBC-dekryptering matchar Nodes AES-256-CBC', () => {
    // Manifest.db dekrypteras med rå CBC (ingen padding), så vi jämför mot Node
    // med nollställd IV och avstängd auto-padding.
    const key = crypto.randomBytes(32);
    const plain = crypto.randomBytes(64);
    const iv = Buffer.alloc(16, 0);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    cipher.setAutoPadding(false);
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    const got = aes.cbcDecrypt(new Uint8Array(key), new Uint8Array(ct));
    assert.equal(toHex(got), plain.toString('hex'));
});

test('unpadPkcs7 tar bort giltig padding och avvisar trasig', () => {
    const body = Uint8Array.from([1, 2, 3]);
    const padded = Uint8Array.from([1, 2, 3, 5, 5, 5, 5, 5]);
    assert.equal(toHex(aes.unpadPkcs7(padded)), toHex(body));
    assert.equal(aes.unpadPkcs7(Uint8Array.from([1, 2, 3, 4, 9])), null);
    assert.equal(aes.unpadPkcs7(Uint8Array.from([])), null);
});
