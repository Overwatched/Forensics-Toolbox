// bcrypt mot hashar från Pythons bcrypt (4.x) och OpenBSD:s testvektor, och prövningen av många koder.
const test = require('node:test');
const assert = require('node:assert');
const B = require('./bcrypt');

const VECTORS = [
    ['0000', '$2a$06$.IWkh/fV0H5Nf7XQH/ZRpeYXMWZBh7tMV/xRxM8P80ycDJdd1PFo6'],
    ['4711', '$2a$06$nr4tAXAsZVveR/MDnllr1OvMukMwR1bK/BtKvKOqr8nFNBdZ8yH3.'],
    ['', '$2a$04$r0MkUPeFuUFYKI9ZWrq7sO940mvrJSwNFMZDlyiM9KAQ87QpAKyTO'],
    ['lång kod med åäö', '$2a$04$kox1.g/rbjOCccrmsdjMn.KQbILF81mvOBN.T9cPvx.Kb.OhzX.4C'],
    ['U*U', '$2a$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW'],
];

test('rätt kod ger hashen, fel kod gör det inte', () => {
    for (const [code, hash] of VECTORS) {
        assert.ok(B.check(code, hash), code);
        assert.ok(!B.check(code + '1', hash), code + '1');
        const p = B.parse(hash);
        assert.strictEqual(B.hash(code, p.salt, p.cost), hash.replace(/^\$2[by]\$/, '$2a$'));
    }
    assert.strictEqual(B.parse('inte en hash'), null);
    assert.strictEqual(B.parse(VECTORS[0][1]).cost, 6);
});

test('alla fyrsiffriga koder, de vanliga först, och prövningen hittar koden', async () => {
    const all = B.fourDigits();
    assert.strictEqual(all.length, 10000);
    assert.strictEqual(new Set(all).size, 10000);
    assert.deepStrictEqual(all.slice(0, 2), ['0000', '1111']);
    const p = B.parse(VECTORS[1][1]);
    const seen = [];
    const hit = await B.crack(B.hash('4711', p.salt, 4), ['1234', '0001', '4711', '9999'], { workers: 0, onProgress: (n, t) => seen.push([n, t]) });
    assert.strictEqual(hit, '4711');
    assert.strictEqual(await B.crack(B.hash('4711', p.salt, 4), ['1234', '0001'], { workers: 0 }), null);
    assert.ok(seen.length > 0 && seen[seen.length - 1][1] === 4);
});
