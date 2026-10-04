const test = require('node:test');
const assert = require('node:assert/strict');

require('./asn1.js');
const { asn1 } = globalThis.KC;

// Varje dekrypterad keychain-post är en DER-container av {nyckel, värde}-par. Vi
// bygger en sådan container för hand (alla längder < 128, så enbytes-längd räcker).
function der(tag, content) {
    assert.ok(content.length < 128, 'testhjälparen stödjer bara korta längder');
    return [tag, content.length, ...content];
}
function utf8(s) {
    return der(0x0c, [...s].map((c) => c.charCodeAt(0)));
}
function pair(key, valueTlv) {
    return der(0x30, [...utf8(key), ...valueTlv]); // SEQUENCE { key, value }
}
function record(pairs) {
    return Uint8Array.from(der(0x30, pairs.flat()));
}

test('avkodar strängar, heltal och booleaner från en postcontainer', () => {
    const bytes = record([
        pair('acct', utf8('alice')),
        pair('port', der(0x02, [0x01, 0xbb])), // INTEGER 443
        pair('sync', der(0x01, [0x01])),       // BOOLEAN true
    ]);
    const rec = asn1.parseRecord(bytes);
    assert.equal(rec.acct, 'alice');
    assert.equal(rec.port, 443);
    assert.equal(rec.sync, true);
});

test('OCTET STRING behålls som rå bytes', () => {
    const bytes = record([pair('data', der(0x04, [0xde, 0xad, 0xbe, 0xef]))]);
    const rec = asn1.parseRecord(bytes);
    assert.ok(rec.data instanceof Uint8Array);
    assert.deepEqual([...rec.data], [0xde, 0xad, 0xbe, 0xef]);
});

test('negativa heltal tolkas med tvåkomplement', () => {
    const bytes = record([pair('tomb', der(0x02, [0xff]))]); // -1
    assert.equal(asn1.parseRecord(bytes).tomb, -1);
});

test('tom indata ger en tom post', () => {
    assert.deepEqual(asn1.parseRecord(new Uint8Array()), {});
});
