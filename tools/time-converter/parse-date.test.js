// Datumsträngar i Time Converter: zonen i texten gäller, utan zon antas datorns zon (och det
// sägs), och tvetydiga datum som 01/02/2026 avvisas i stället för att läsas amerikanskt.

const test = require('node:test');
const assert = require('node:assert');
const { parseDateText } = require('./parse-date');

test('zonen i texten gäller', () => {
    assert.strictEqual(parseDateText('2026-10-31T14:30:00Z').date.toISOString(), '2026-10-31T14:30:00.000Z');
    assert.strictEqual(parseDateText('2026-10-31 14:30:00 UTC').date.toISOString(), '2026-10-31T14:30:00.000Z');
    const plus = parseDateText('2026-07-01T14:30:00+02:00');
    assert.strictEqual(plus.date.toISOString(), '2026-07-01T12:30:00.000Z');
    assert.strictEqual(plus.zone, 'UTC+02:00');
    assert.strictEqual(parseDateText('2026-07-01T14:30:00-0700').date.toISOString(), '2026-07-01T21:30:00.000Z');
    assert.strictEqual(parseDateText('2026-07-01T14:30:00.123456Z').date.toISOString(), '2026-07-01T14:30:00.123Z');
    assert.strictEqual(parseDateText('Sat, 31 Oct 2026 14:30:00 GMT').date.toISOString(), '2026-10-31T14:30:00.000Z');
});

test('utan zon antas datorns zon, för både datum med tid och ensamt datum', () => {
    const t = parseDateText('2026-07-01 14:30:00');
    assert.strictEqual(t.assumed, true);
    assert.strictEqual(t.date.getTime(), new Date(2026, 6, 1, 14, 30, 0).getTime());
    const d = parseDateText('2026-10-31');
    assert.strictEqual(d.assumed, true);
    assert.strictEqual(d.dateOnly, true);
    assert.strictEqual(d.date.getTime(), new Date(2026, 9, 31).getTime(), 'lokal midnatt, inte UTC som Date gör');
});

test('tvetydiga och omöjliga datum avvisas med en förklaring', () => {
    assert.match(parseDateText('01/02/2026').error, /1 februari och 2 januari/);
    assert.match(parseDateText('31.10.2026 14:30').error, /ÅÅÅÅ-MM-DD/);
    assert.match(parseDateText('2026-02-30').error, /finns inte/);
    assert.match(parseDateText('2026-10-31 25:00').error || '', /finns inte/);
    assert.match(parseDateText('October 31, 2026 14:30').error, /saknar tidszon/);
    assert.strictEqual(parseDateText('hej'), null);
    assert.strictEqual(parseDateText(''), null);
});
