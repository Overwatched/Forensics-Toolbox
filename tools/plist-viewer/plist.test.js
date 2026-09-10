const test = require('node:test');
const assert = require('node:assert/strict');

require('./plist.js');
const { parsePlistBinary } = globalThis;

// Bygger en minimal bplist00 som innehåller ett enda åttabytes-heltal, så att
// heltalshanteringen kan testas utan en riktig plist-fil.
function bplistWithInt64(value) {
    const total = 8 + 9 + 1 + 32; // header + objekt + offsettabell + trailer
    const bytes = new Uint8Array(total);
    const view = new DataView(bytes.buffer);

    bytes.set([0x62, 0x70, 0x6c, 0x69, 0x73, 0x74, 0x30, 0x30], 0); // "bplist00"

    const objOffset = 8;
    bytes[objOffset] = 0x13; // typ 1 (heltal), 1 << 3 = 8 byte
    view.setBigInt64(objOffset + 1, BigInt(value));

    const tableOffset = objOffset + 9;
    bytes[tableOffset] = objOffset;

    const trailer = tableOffset + 1;
    view.setUint8(trailer + 6, 1); // offsetSize
    view.setUint8(trailer + 7, 1); // refSize
    view.setBigUint64(trailer + 8, 1n); // numObjects
    view.setBigUint64(trailer + 16, 0n); // topObject
    view.setBigUint64(trailer + 24, BigInt(tableOffset));

    return bytes;
}

test('små heltal blir vanliga Number', () => {
    assert.equal(parsePlistBinary(bplistWithInt64(42)), 42);
    assert.equal(parsePlistBinary(bplistWithInt64(0)), 0);
});

test('åttabytes-heltal är signerade', () => {
    // Lästes tidigare som osignerat och gav 18446744073709552000.
    assert.equal(parsePlistBinary(bplistWithInt64(-1)), -1);
    assert.equal(parsePlistBinary(bplistWithInt64(-978307200)), -978307200);
});

test('heltal över 2^53 behåller exakt värde som sträng', () => {
    // Flyttalsvägen avrundade 2^53+1 till 9007199254740992.
    assert.equal(parsePlistBinary(bplistWithInt64(9007199254740993n)), '9007199254740993');
    assert.equal(parsePlistBinary(bplistWithInt64(9223372036854775807n)), '9223372036854775807');
    assert.equal(parsePlistBinary(bplistWithInt64(-9223372036854775808n)), '-9223372036854775808');
});

test('gränsen för säkra heltal', () => {
    assert.equal(parsePlistBinary(bplistWithInt64(9007199254740991n)), 9007199254740991);
    assert.equal(typeof parsePlistBinary(bplistWithInt64(9007199254740991n)), 'number');
    assert.equal(typeof parsePlistBinary(bplistWithInt64(9007199254740992n)), 'string');
});
