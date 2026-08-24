const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeBytes, parseInputText, extractHex } = require('./protobuf.js');

function hex(str) {
    const clean = str.replace(/\s+/g, '');
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
}

test('varint field 1 = 150 (08 96 01)', () => {
    const result = decodeBytes(hex('08 96 01'));
    assert.equal(result.fields[0].field, 1);
    assert.equal(result.fields[0].kind, 'varint');
    assert.equal(result.fields[0].value, 150);
    assert.equal(result.json['1'], 150);
});

test('string field 2 = testing', () => {
    const result = decodeBytes(hex('12 07 74 65 73 74 69 6e 67'));
    assert.equal(result.fields[0].kind, 'string');
    assert.equal(result.fields[0].value, 'testing');
    assert.equal(result.json['2'], 'testing');
});

test('nested message', () => {
    // field 3 = message { field 1 = 1 }
    const result = decodeBytes(hex('1a 02 08 01'));
    assert.equal(result.fields[0].kind, 'message');
    assert.deepEqual(result.json['3'], { '1': 1 });
});

test('hex paste with spaces', () => {
    const result = parseInputText('08 96 01');
    assert.equal(result.inputKind, 'hex');
    assert.equal(result.json['1'], 150);
});

test('sqlite X\'hex\' literal', () => {
    const result = parseInputText("X'089601'");
    assert.equal(result.inputKind, 'hex');
    assert.equal(result.json['1'], 150);
});

test('base64 paste', () => {
    const result = parseInputText('CJYB');
    assert.equal(result.json['1'], 150);
});

test('length-prefixed varint payload', () => {
    // varint length 3 + 08 96 01
    const result = decodeBytes(hex('03 08 96 01'));
    assert.equal(result.lengthPrefixed, true);
    assert.equal(result.json['1'], 150);
});

test('extractHex ignores ordinary sentences', () => {
    assert.equal(extractHex('hello world'), null);
});

test('escaped \\x bytes', () => {
    const result = parseInputText('\\x08\\x96\\x01');
    assert.equal(result.inputKind, 'hex');
    assert.equal(result.json['1'], 150);
});

test('rejects empty', () => {
    assert.throws(() => decodeBytes(new Uint8Array()), /Tom/);
});
