const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const hashing = require('./hashing.js');

// Längder som täcker de känsliga fallen kring blockgräns och paddning:
// tomt, under/över 64- och 128-bytesblock, och precis där längdfältet inte får plats.
const LENGTHS = [
    0, 1, 3, 55, 56, 57, 63, 64, 65, 111, 112, 113, 119, 120, 127, 128, 129,
    200, 255, 256, 1000, 4096, 100000,
];

function bytesOfLength(n) {
    // Deterministisk pseudoslump så att ett fel alltid går att återskapa.
    const out = Buffer.alloc(n);
    let x = 0x12345678;
    for (let i = 0; i < n; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        out[i] = (x >>> 16) & 0xff;
    }
    return out;
}

function nodeHash(algo, buf) {
    return crypto.createHash(algo).update(buf).digest('hex');
}

const NODE_NAMES = {
    md5: 'md5',
    sha1: 'sha1',
    sha256: 'sha256',
    sha384: 'sha384',
    sha512: 'sha512',
};

test('JS-implementationerna matchar Nodes crypto för alla längder', () => {
    for (const len of LENGTHS) {
        const buf = bytesOfLength(len);
        const bytes = new Uint8Array(buf);
        for (const [id, nodeName] of Object.entries(NODE_NAMES)) {
            const mine = hashing.createHasher(id).update(bytes).digestHex();
            assert.equal(mine, nodeHash(nodeName, buf), `${id} vid längd ${len}`);
        }
    }
});

test('kända testvektorer för tom sträng och "abc"', () => {
    const empty = new Uint8Array(0);
    const abc = new Uint8Array([0x61, 0x62, 0x63]);

    assert.equal(hashing.createHasher('md5').update(empty).digestHex(),
        'd41d8cd98f00b204e9800998ecf8427e');
    assert.equal(hashing.createHasher('sha1').update(abc).digestHex(),
        'a9993e364706816aba3e25717850c26c9cd0d89d');
    assert.equal(hashing.createHasher('sha256').update(abc).digestHex(),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(hashing.createHasher('sha384').update(abc).digestHex(),
        'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed'
        + '8086072ba1e7cc2358baeca134c825a7');
    assert.equal(hashing.createHasher('sha512').update(abc).digestHex(),
        'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a'
        + '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f');
});

test('CRC-32 mot känd vektor och mot zlib', () => {
    const check = new Uint8Array(Buffer.from('123456789'));
    assert.equal(hashing.createHasher('crc32').update(check).digestHex(), 'cbf43926');

    if (typeof zlib.crc32 === 'function') {
        const buf = bytesOfLength(5000);
        const mine = hashing.createHasher('crc32').update(new Uint8Array(buf)).digestHex();
        assert.equal(mine, (zlib.crc32(buf) >>> 0).toString(16).padStart(8, '0'));
    }
});

test('resultatet är oberoende av hur indata delas upp i bitar', () => {
    const buf = bytesOfLength(50000);
    const bytes = new Uint8Array(buf);
    const splits = [[1, 63, 1], [64, 64], [127, 1], [128], [3, 5, 7, 11], [49999, 1]];

    for (const id of Object.keys(NODE_NAMES).concat('crc32')) {
        const oneShot = hashing.createHasher(id).update(bytes).digestHex();
        for (const pattern of splits) {
            const hasher = hashing.createHasher(id);
            let off = 0;
            let p = 0;
            while (off < bytes.length) {
                const size = Math.min(pattern[p % pattern.length], bytes.length - off);
                hasher.update(bytes.subarray(off, off + size));
                off += size;
                p++;
            }
            assert.equal(hasher.digestHex(), oneShot, `${id} med uppdelning ${pattern}`);
        }
    }
});

test('hashBytesFast ger samma svar som ren JS', async () => {
    const bytes = new Uint8Array(bytesOfLength(9999));
    const ids = ['md5', 'sha1', 'sha256', 'sha384', 'sha512', 'crc32'];
    const fast = await hashing.hashBytesFast(bytes, ids);
    const slow = hashing.hashBytes(bytes, ids);
    assert.deepEqual(fast, slow);
});

test('hashBlobStreaming ger samma svar som engångsberäkning', async () => {
    const buf = bytesOfLength(300000);
    const blob = new Blob([buf]);
    const ids = ['md5', 'sha1', 'sha256', 'sha512', 'crc32'];

    const streamed = await hashing.hashBlobStreaming(blob, ids);
    const direct = hashing.hashBytes(new Uint8Array(buf), ids);
    assert.deepEqual(streamed, direct);
});

test('strömningen rapporterar progress och går att avbryta', async () => {
    const blob = new Blob([bytesOfLength(200000)]);
    const seen = [];
    await hashing.hashBlobStreaming(blob, ['md5'], (done, total) => {
        seen.push([done, total]);
    });
    assert.equal(seen[0][0], 0);
    assert.equal(seen[seen.length - 1][0], blob.size);
    assert.ok(seen.every(([, total]) => total === blob.size));

    const cancelled = await hashing.hashBlobStreaming(blob, ['md5'], null, () => true);
    assert.equal(cancelled, null);
});

test('hashBlob ger rätt svar på den snabba engångsvägen', async () => {
    const buf = bytesOfLength(1024);
    assert.ok(buf.length <= hashing.ONESHOT_LIMIT);
    const result = await hashing.hashBlob(new Blob([buf]), ['sha256', 'md5']);
    assert.equal(result.sha256, nodeHash('sha256', buf));
    assert.equal(result.md5, nodeHash('md5', buf));
});

test('normalizeExpected plockar ut hex ur klistrad text', () => {
    assert.equal(hashing.normalizeExpected('  D41D8CD98F00B204E9800998ECF8427E '),
        'd41d8cd98f00b204e9800998ecf8427e');
    // Formatet som sha256sum/md5sum skriver: hash, blanksteg, filnamn.
    assert.equal(
        hashing.normalizeExpected('d41d8cd98f00b204e9800998ecf8427e  bevis.dd'),
        'd41d8cd98f00b204e9800998ecf8427e');
    // Kolonseparerad hex förekommer i vissa verktygsutskrifter.
    assert.equal(hashing.normalizeExpected('AA:BB:CC:DD'), 'aabbccdd');
    assert.equal(hashing.normalizeExpected('   '), '');
});

test('matchAlgosByLength känner igen algoritm på hex-längd', () => {
    assert.deepEqual(hashing.matchAlgosByLength('a'.repeat(32)), ['md5']);
    assert.deepEqual(hashing.matchAlgosByLength('a'.repeat(64)), ['sha256']);
    assert.deepEqual(hashing.matchAlgosByLength('a'.repeat(128)), ['sha512']);
    assert.deepEqual(hashing.matchAlgosByLength('a'.repeat(8)), ['crc32']);
    assert.deepEqual(hashing.matchAlgosByLength('a'.repeat(9)), []);
});
