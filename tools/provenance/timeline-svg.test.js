// Tidslinjen: välformad SVG med en rad per källa, T-strecket, intervall och markörer.

const test = require('node:test');
const assert = require('node:assert');
const core = require('./timeline-core');
const tl = require('./timeline-svg');

const T = Date.UTC(2025, 8, 24, 12, 31, 9);
const S = 1000;

test('svg innehåller rader, T, kamerans intervall och filens markör', () => {
    const m = core.build({
        platform: 'iOS', appNames: () => null, cameraApps: ['com.apple.camera'],
        file: { pk: 1, filename: 'IMG_0042.HEIC', createdMs: T, addedMs: T + 300, importedBy: 1, importer: 'com.apple.camera' },
        appIntervals: [{ startMs: T - 20 * S, endMs: T + 12 * S, app: 'com.apple.camera', stream: '/app/usage' }, { startMs: T + 60 * S, endMs: T + 120 * S, app: 'com.apple.Preferences', stream: '/app/usage' }],
        screen: [{ startMs: T - 60 * S, endMs: T + 180 * S, on: true, stream: '/display/isBacklit' }],
        locations: [{ ms: T + 5 * S, lat: 59.3, lon: 18.1, accuracy: 10, type: 1 }],
        neighbours: [{ pk: 2, filename: 'IMG_0043.HEIC', createdMs: T + 2 * S, importedBy: 1 }],
        exif: { read: true, takenMs: T, takenText: 'x' },
    });
    const out = tl.svg(m, { width: 900, format: (ms) => core.formatWithOffset(ms, 120), appName: (id) => (id === 'com.apple.camera' ? 'Kamera' : id), footer: 'Forensics Toolbox 1.26' });
    assert.match(out, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="900"/);
    for (const needle of ['>Fil<', '>App igång<', '>Kamera<', '>Skärm<', '>Position<', 'stroke-dasharray="4 3"', 'T 14:31:09', '<polygon', 'fill="#30d158"', 'fill="#0a84ff"', 'fill="#ffd60a"', '<circle', 'Forensics Toolbox 1.26', '14:20', '14:45']) {
        assert.ok(out.includes(needle), 'saknar ' + needle);
    }
    assert.ok(!out.includes('>Lås<'), 'låsraden visas bara när det finns låshändelser');
    assert.strictEqual((out.match(/<svg/g) || []).length, 1);
    assert.strictEqual((out.match(/<\/svg>/g) || []).length, 1);
    assert.ok(!/[<>&]/.test(out.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot);/g, '')), 'oescapad text');
});

test('tidsstegen ger 4–8 markeringar', () => {
    assert.strictEqual(tl.tickStep(30 * 60000), 300000);
    assert.strictEqual(tl.tickStep(10 * 60000), 120000);
    assert.strictEqual(tl.tickStep(48 * 3600000), 21600000);
});
