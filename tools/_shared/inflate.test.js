'use strict';
// Inflate mot Nodes zlib: gzip, zlib och rå DEFLATE, med fasta och dynamiska block, okomprimerade block och långa
// upprepningar, och fel på trasig data.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const Inflate = require('./inflate.js');

const samples = [
    Buffer.alloc(0),
    Buffer.from('Hej! Åäö och en anteckning med ☐ och ☑.'),
    Buffer.from('abc'.repeat(5000)),
    crypto.randomBytes(70000),
    Buffer.concat([Buffer.from('början '), crypto.randomBytes(300), Buffer.from(' mitten '.repeat(400)), Buffer.alloc(40000, 7)]),
];

test('gzip, zlib och rå DEFLATE ger samma byte som zlib, på alla nivåer', () => {
    for (const s of samples) {
        for (const level of [0, 1, 6, 9]) {
            assert.deepStrictEqual(Buffer.from(Inflate.gunzip(zlib.gzipSync(s, { level }))), s, 'gzip ' + level + ' ' + s.length);
            assert.deepStrictEqual(Buffer.from(Inflate.gunzip(zlib.deflateSync(s, { level }))), s, 'zlib ' + level);
            assert.deepStrictEqual(Buffer.from(Inflate.raw(zlib.deflateRawSync(s, { level }))), s, 'rå ' + level);
        }
        assert.deepStrictEqual(Buffer.from(Inflate.raw(zlib.deflateRawSync(s, { strategy: zlib.constants.Z_FIXED }))), s, 'fasta block');
    }
});

test('trasig data ger ett fel, inte fel byte', () => {
    const gz = zlib.gzipSync(Buffer.from('en text som komprimeras '.repeat(50)));
    assert.throws(() => Inflate.gunzip(gz.subarray(0, 20)), /DEFLATE/);
    assert.throws(() => Inflate.raw(Buffer.from([0xff, 0xff, 0xff])), /DEFLATE/);
});
