const test = require('node:test');
const assert = require('node:assert/strict');
const compare = require('./compare.js');

function kinds(result) {
    return result.rows.map(function (row) { return row.kind; });
}

test('identical text has no changes', function () {
    var result = compare.analyzeText('alfa\nbeta\n', 'alfa\nbeta');
    assert.equal(result.identical, true);
    assert.equal(result.added, 0);
    assert.equal(result.removed, 0);
    assert.deepEqual(kinds(result), ['same', 'same']);
});

test('a replaced line is a change with original numbers', function () {
    var result = compare.analyzeText('a\nb\nc\n', 'a\nx\nc\n');
    assert.equal(result.identical, false);
    assert.equal(result.removed, 1);
    assert.equal(result.added, 1);
    assert.deepEqual(kinds(result), ['same', 'change', 'same']);
    assert.equal(result.rows[1].a.num, 2);
    assert.equal(result.rows[1].a.text, 'b');
    assert.equal(result.rows[1].b.text, 'x');
});

test('lines only on one side stay unpaired', function () {
    var result = compare.analyzeText('a\nb\n', 'a\n');
    assert.deepEqual(kinds(result), ['same', 'remove']);
    assert.equal(result.rows[1].b, null);
    var added = compare.analyzeText('a\n', 'a\nb\n');
    assert.deepEqual(kinds(added), ['same', 'add']);
    assert.equal(added.rows[1].a, null);
});

test('ignore blank lines drops empty rows before comparing', function () {
    var result = compare.analyzeText('a\n\nb\n', 'a\nb\n', { ignoreBlank: true });
    assert.equal(result.identical, true);
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[1].a.num, 3);
});

test('CRLF and LF compare as the same lines', function () {
    var result = compare.analyzeText('a\r\nb\r\n', 'a\nb\n');
    assert.equal(result.identical, true);
});

test('NUL in the sample is binary', function () {
    assert.equal(compare.looksBinary(new Uint8Array([0x61, 0x00, 0x62])), true);
    assert.equal(compare.looksBinary(new Uint8Array([0x61, 0x0a, 0x62])), false);
});

test('too-large text is refused before diffing', function () {
    var big = 'x'.repeat(compare.MAX_BYTES + 1);
    var result = compare.analyzeText(big, 'a');
    assert.equal(result.tooLarge, true);
    assert.equal(result.rows, undefined);
});
