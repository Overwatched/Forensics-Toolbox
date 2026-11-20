// Tidslinjens skala: uppehåll trycks ihop, och x och tid går att räkna fram och tillbaka.
const test = require('node:test');
const assert = require('node:assert');
const T = require('./timeline');

const H = 3600000, D = 24 * H;

test('en följd utan långa uppehåll är en del, och x går från 0 till bredden', () => {
    const t0 = Date.UTC(2026, 10, 19, 8);
    const s = T.scale([t0, t0 + 10 * 60000, t0 + 40 * 60000], 500);
    assert.strictEqual(s.segments.length, 1);
    assert.strictEqual(s.breaks.length, 0);
    assert.strictEqual(s.x(t0), 0);
    assert.ok(Math.abs(s.x(t0 + 40 * 60000) - 500) < 1e-6);
    assert.ok(Math.abs(s.ms(250) - (t0 + 20 * 60000)) < 1000);
});

test('en gammal bild långt före resten blir en egen del, med ett brott emellan', () => {
    const old = Date.UTC(2020, 0, 1, 12), t0 = Date.UTC(2026, 10, 19, 8);
    const s = T.scale([old, t0, t0 + H, t0 + 2 * H], 600);
    assert.strictEqual(s.segments.length, 2);
    assert.strictEqual(s.breaks.length, 1);
    assert.ok(s.breaks[0].gapMs > 2000 * D);
    // Den nya delen får det mesta av bredden, och tiden går att räkna tillbaka ur x.
    const seg = s.segments[1];
    assert.ok(seg.x1 - seg.x0 > 300, JSON.stringify(s.segments));
    const x = s.x(t0 + H);
    assert.ok(Math.abs(s.ms(x) - (t0 + H)) < 1000);
    assert.strictEqual(T.scale([], 100), null);
});
