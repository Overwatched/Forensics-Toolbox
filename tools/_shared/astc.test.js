'use strict';
// ASTC och Apples texturfil (.atx): blocken byggs här bit för bit efter Khronos specifikation, och en textur i Apples
// ordning (rutor om 32 × 32 block i Morton-ordning) byggs med enfärgade block.
const test = require('node:test');
const assert = require('node:assert');
const A = require('./astc.js');

// Ett block på 128 bitar: set(start, antal, värde) skriver från den lägsta biten, top(i, antal, värde) skriver vikterna
// bakifrån (vikt 0 överst, med sin lägsta bit i bit 127).
function block() {
    const b = new Uint8Array(16);
    const bit = (i, v) => { if (v) b[i >> 3] |= 1 << (i & 7); else b[i >> 3] &= ~(1 << (i & 7)); };
    return {
        b,
        set(start, n, v) { for (let k = 0; k < n; k++) bit(start + k, (v >> k) & 1); return this; },
        top(start, n, v) { for (let k = 0; k < n; k++) bit(127 - (start + k), (v >> k) & 1); return this; },
    };
}
const pixel = (rgba, w, x, y) => Array.from(rgba.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

function voidExtent(r, g, bl, a) {
    return block().set(0, 9, 0x1fc).set(9, 1, 0).set(10, 2, 3).set(12, 52, (1 << 30) - 1).set(64, 16, r * 257).set(80, 16, g * 257).set(96, 16, bl * 257).set(112, 16, a * 257).b;
}

test('ett enfärgat block (void extent) och ett HDR-block, som ritas i felfärgen', () => {
    const out = A.decode(voidExtent(10, 200, 30, 255), 4, 4, 4, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) assert.deepStrictEqual(pixel(out, 4, x, y), [10, 200, 30, 255]);
    const hdr = block().set(0, 9, 0x1fc).set(9, 1, 1).b;
    assert.deepStrictEqual(pixel(A.decode(hdr, 4, 4, 4, 4), 4, 0, 0), [255, 0, 255, 255]);
    // 16 nollor är ett reserverat blockläge.
    assert.deepStrictEqual(pixel(A.decode(new Uint8Array(16), 4, 4, 4, 4), 4, 2, 2), [255, 0, 255, 255]);
});

test('blockläget: viktrutnätets storlek, nivån och två plan', () => {
    // 4 × 4 vikter med fyra nivåer (2 bitar): A = 2, B = 0, R = 0b100.
    assert.deepStrictEqual(A.blockMode(66), { x: 4, y: 4, dual: false, level: 2, count: 16, bits: 32 });
    assert.strictEqual(A.blockMode(0), null);
    assert.strictEqual(A.iseBits(5, 1), 8);    // fem trits i åtta bitar
    assert.strictEqual(A.iseBits(3, 3), 7);    // tre quints i sju bitar
    assert.strictEqual(A.iseBits(6, 20), 48);
});

test('heltalsföljden: varje kod för trits och quints ger giltiga siffror, och alla kombinationer finns', () => {
    const tr = new Set();
    for (let T = 0; T < 256; T++) { const t = A.trits(T); assert.ok(t.every((v) => v >= 0 && v <= 2), String(T)); tr.add(t.join('')); }
    assert.strictEqual(tr.size, 243);
    const qu = new Set();
    for (let Q = 0; Q < 128; Q++) { const q = A.quints(Q); assert.ok(q.every((v) => v >= 0 && v <= 4), String(Q)); qu.add(q.join('')); }
    assert.strictEqual(qu.size, 125);
});

test('värdena: färger till 0–255 och vikter till 0–64, med specifikationens ordning för trits', () => {
    assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map((v) => A.unquantColor(v, 4)), [0, 255, 51, 204, 102, 153]);
    assert.deepStrictEqual([0, 1, 2, 3].map((v) => A.unquantColor(v, 2)), [0, 85, 170, 255]);
    assert.strictEqual(A.unquantColor(173, 20), 173);
    assert.deepStrictEqual([0, 1, 2, 3].map((v) => A.unquantWeight(v, 2)), [0, 21, 43, 64]);
    assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map((v) => A.unquantWeight(v, 4)).sort((a, b) => a - b), [0, 12, 25, 39, 52, 64]);
    assert.deepStrictEqual([0, 1, 2].map((v) => A.unquantWeight(v, 1)), [0, 32, 64]);
});

test('ett block med RGB-ändpunkter (CEM 8) och vikter på två bitar: ändpunkterna och en blandning', () => {
    // Blockläge 66 (4 × 4 vikter, två bitar), en partition, CEM 8, sex färgvärden på åtta bitar från bit 17.
    const k = block().set(0, 11, 66).set(11, 2, 0).set(13, 4, 8);
    [20, 220, 40, 200, 60, 180].forEach((v, i) => k.set(17 + 8 * i, 8, v));
    // Vikterna: rad 0 = 0, rad 1 = 3 (64), rad 2 = 1 (21), rad 3 = 2 (43).
    for (let i = 0; i < 16; i++) k.top(2 * i, 2, [0, 3, 1, 2][i >> 2]);
    const out = A.decode(k.b, 4, 4, 4, 4);
    assert.deepStrictEqual(pixel(out, 4, 0, 0), [20, 40, 60, 255]);
    assert.deepStrictEqual(pixel(out, 4, 3, 1), [220, 200, 180, 255]);
    // (c0 · (64 − w) + c1 · w + 32) / 64 i 16 bitar, de översta åtta bitarna.
    const mix = (c0, c1, w) => ((((c0 * 257) * (64 - w) + (c1 * 257) * w + 32) >> 6) >> 8);
    assert.deepStrictEqual(pixel(out, 4, 1, 2), [mix(20, 220, 21), mix(40, 200, 21), mix(60, 180, 21), 255]);
    assert.deepStrictEqual(pixel(out, 4, 2, 3), [mix(20, 220, 43), mix(40, 200, 43), mix(60, 180, 43), 255]);
    // Summan av den andra ändpunkten är mindre: blå drar mot de andra (blue contract) och ändpunkterna byter plats.
    const sw = block().set(0, 11, 66).set(13, 4, 8);
    [200, 10, 200, 10, 200, 10].forEach((v, i) => sw.set(17 + 8 * i, 8, v));
    assert.deepStrictEqual(pixel(A.decode(sw.b, 4, 4, 4, 4), 4, 0, 0), [10, 10, 10, 255]);
});

test('Apples texturfil: HEAD, astc-delen och rutor om 32 × 32 block i Morton-ordning', () => {
    // 136 × 8 bildpunkter = 34 × 2 block, utfyllt till 64 × 32 block (två rutor i bredd, en i höjd).
    const w = 136, h = 8, stride = 64, rows = 32, data = new Uint8Array(stride * rows * 16);
    const color = (x, y) => [x * 7 % 256, y * 90 + 20, 255 - x * 5 % 256, 255];
    for (let y = 0; y < 2; y++) for (let x = 0; x < 34; x++) {
        const at = (((y >> 5) * (stride >> 5) + (x >> 5)) * 1024 + A.morton(x & 31, y & 31)) * 16;
        data.set(voidExtent(...color(x, y)), at);
    }
    const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
    const head = Buffer.concat([u32(1), u32(0), u32(0), u32(0), u32(0x93b0), u32(0x1908), u32(w), u32(h), u32(1), u32(0), u32(1), u32(1), Buffer.alloc(36)]);
    const chunk = (tag, body) => Buffer.concat([u32(body.length), Buffer.from(tag, 'latin1'), body]);
    const file = new Uint8Array(Buffer.concat([Buffer.from('AAPL\r\n\x1a\n', 'latin1'), chunk('HEAD', head), chunk('astc', Buffer.concat([u32(data.length), Buffer.from(data)])), chunk('END ', Buffer.alloc(0))]));
    const t = A.parseAtx(file);
    assert.deepStrictEqual([t.width, t.height, t.block.w, t.block.h, t.stride, t.layout], [136, 8, 4, 4, 64, 'tiled']);
    const img = A.decodeAtx(file);
    for (const [x, y] of [[0, 0], [33, 1], [32, 0], [5, 1], [31, 1]]) assert.deepStrictEqual(pixel(img.rgba, w, x * 4 + 1, y * 4 + 2), color(x, y), x + ',' + y);
    assert.throws(() => A.parseAtx(new Uint8Array(16)), /AAPL saknas/);
});
