const test = require('node:test');
const assert = require('node:assert');
const Qr = require('./qr-encode.js');
const jsQR = require('../QR2URL/jsQR.js');

// Rutnätet som en bild med vit kant, så som läsaren får det: scale bildpunkter per ruta.
function picture(m, scale) {
    const side = (m.length + 8) * scale, data = new Uint8ClampedArray(side * side * 4).fill(255);
    m.forEach((row, y) => row.forEach((dark, x) => {
        if (!dark) return;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
            const i = (((y + 4) * scale + dy) * side + (x + 4) * scale + dx) * 4;
            data[i] = data[i + 1] = data[i + 2] = 0;
        }
    }));
    return { data, side };
}

function read(text, scale) {
    const m = Qr.encode(text);
    assert.ok(m, 'texten ryms: ' + text);
    const p = picture(m, scale || 4), got = jsQR(p.data, p.side, p.side);
    return got ? got.data : null;
}

test('koden och klockan ryms i den minsta QR-koden och läses tillbaka', () => {
    for (const text of ['L01 1794812345', 'ABC123 1794812345', 'L75 1794816000']) {
        assert.strictEqual(Qr.encode(text).length, 21, text);
        assert.strictEqual(read(text), text);
        assert.strictEqual(read(text, 2), text);
    }
});

test('en kodbokstav med å, ä eller ö skrivs som byte och läses tillbaka', () => {
    assert.strictEqual(Qr.encode('ÅÄÖ12 1794812345').length, 25);
    assert.strictEqual(read('ÅÄÖ12 1794812345'), 'ÅÄÖ12 1794812345');
    assert.strictEqual(read('små bokstäver och 123'), 'små bokstäver och 123');
});

test('alla längder läses tillbaka, i båda skrivsätten och över gränserna mellan storlekarna', () => {
    for (let n = 1; n <= 106; n++) {
        let bytes = '', dense = '';
        for (let k = 0; k < n; k++) {
            bytes += String.fromCharCode(33 + ((n * 31 + k * 17 + k * k) % 94));
            dense += '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'[(n * 7 + k * 13) % 45];
        }
        assert.strictEqual(read(bytes), bytes, 'byte, ' + n + ' tecken');
        assert.strictEqual(read(dense), dense, 'tätt, ' + n + ' tecken');
    }
});

test('en text som inte ryms ger ingen kod', () => {
    assert.strictEqual(Qr.encode('x'.repeat(107)), null);
    assert.ok(Qr.encode('x'.repeat(106)));
});

test('banan till bilden har den ljusa kanten med och en rektangel per mörk rad av rutor', () => {
    const m = Qr.encode('L01 1794812345'), p = Qr.svgPath(m);
    assert.strictEqual(p.size, 29);
    // Ögat uppe till vänster börjar fyra rutor in och är sju rutor brett.
    assert.ok(p.d.startsWith('M4 4h7v1h-7z'), p.d.slice(0, 30));
    const dark = m.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
    const drawn = (p.d.match(/h(\d+)v1/g) || []).reduce((sum, part) => sum + Number(part.slice(1, -2)), 0);
    assert.strictEqual(drawn, dark);
});
