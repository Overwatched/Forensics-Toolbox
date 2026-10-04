const test = require('node:test');
const assert = require('node:assert/strict');

require('./bplist.js');
const { bplist } = globalThis.KC;

// Bygger minimala bplist00-buffertar för hand så att objekttyperna kan testas utan
// en riktig .plist-fil (samma grepp som plist-visarens test).
function bplistSingle(objBytes) {
    const objOff = 8;
    const offTableOff = objOff + objBytes.length;
    const total = offTableOff + 1 + 32;
    const b = new Uint8Array(total);
    b.set([0x62, 0x70, 0x6c, 0x69, 0x73, 0x74, 0x30, 0x30], 0); // "bplist00"
    b.set(objBytes, objOff);
    b[offTableOff] = objOff; // enda offset, 1 byte
    const dv = new DataView(b.buffer);
    const tr = offTableOff + 1;
    dv.setUint8(tr + 6, 1); // offsetSize
    dv.setUint8(tr + 7, 1); // refSize
    dv.setBigUint64(tr + 8, 1n); // numObjects
    dv.setBigUint64(tr + 16, 0n); // topObject
    dv.setBigUint64(tr + 24, BigInt(offTableOff));
    return b;
}

test('läser en ASCII-sträng', () => {
    assert.equal(bplist.parse(bplistSingle([0x52, 0x68, 0x69])), 'hi'); // 0x5_ = ASCII, längd 2
});

test('läser ett tvåbytes-heltal (big-endian)', () => {
    assert.equal(bplist.parse(bplistSingle([0x11, 0x03, 0xe8])), 1000); // 0x1_ = int, 2 byte
});

test('läser booleanerna true/false', () => {
    assert.equal(bplist.parse(bplistSingle([0x09])), true);
    assert.equal(bplist.parse(bplistSingle([0x08])), false);
});

test('läser en dict med referenser', () => {
    // obj0: dict{ ref1 -> ref2 }, obj1: "k", obj2: true
    const b = new Uint8Array(14 + 3 + 32);
    b.set([0x62, 0x70, 0x6c, 0x69, 0x73, 0x74, 0x30, 0x30], 0);
    b.set([0xd1, 0x01, 0x02], 8);  // obj0 @8: dict, nyckelref=1, värderef=2
    b.set([0x51, 0x6b], 11);       // obj1 @11: ASCII "k"
    b.set([0x09], 13);             // obj2 @13: true
    b.set([8, 11, 13], 14);        // offsettabell @14
    const dv = new DataView(b.buffer);
    const tr = 17;
    dv.setUint8(tr + 6, 1);
    dv.setUint8(tr + 7, 1);
    dv.setBigUint64(tr + 8, 3n);   // numObjects
    dv.setBigUint64(tr + 16, 0n);  // topObject
    dv.setBigUint64(tr + 24, 14n); // offTableOff
    assert.deepEqual(bplist.parse(b), { k: true });
});

test('UID exponeras så NSKeyedArchiver kan slå upp referenser', () => {
    const uid = new bplist.UID(7);
    assert.equal(uid.value, 7);
});
