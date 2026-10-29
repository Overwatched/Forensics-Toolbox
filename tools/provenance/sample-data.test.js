// Testdatat ska ge ett fullständigt, tydligt resultat: kamerabild med stöd på alla faktorer,
// Snapchat runt omkring, grannar och positioner, och förklaringen i rätt ordning.

const test = require('node:test');
const assert = require('node:assert');
const core = require('./timeline-core');
const report = require('./report');
const sample = require('./sample-data');

const NAMES = { 'com.apple.camera': 'Kamera', 'com.toyopagroup.picaboo': 'Snapchat', 'com.apple.mobileslideshow': 'Bilder', 'com.apple.springboard': 'Hemskärmen' };

function build() {
    const s = sample.scenario();
    return core.build(Object.assign({}, s, { appNames: (id) => NAMES[id] || null, cameraApps: ['com.apple.camera'], windowMs: 15 * 60000, format: (ms) => core.formatWithOffset(ms, 120) }));
}

test('testdatat ger en kamerabild med stöd på alla faktorer', () => {
    const m = build();
    assert.strictEqual(m.type.type, 'camera');
    assert.deepStrictEqual(Object.fromEntries(m.factors.map((f) => [f.id, f.state])), { time: 'support', app: 'support', camera: 'support', screen: 'support' });
    assert.strictEqual(m.windows.length, 1);
    assert.match(m.summary, /förenligt .* Alla kontrollerade faktorer ger stöd/);
});

test('förklaringen berättar Snapchat-historien i ordning', () => {
    const m = build();
    const lines = m.narrative[0].lines.map((l) => l.text);
    const want = ['Skärmen tänds', 'Snapchat öppnas', 'Kamera öppnas', 'Bilden IMG_4104.JPG tas med kameran', 'Kamera lämnas', 'Snapchat öppnas', 'Skärmen släcks'];
    let at = 0;
    for (const w of want) {
        const i = lines.indexOf(w, at);
        assert.ok(i >= 0, 'saknar "' + w + '" efter rad ' + at + ': ' + lines.join(' | '));
        at = i + 1;
    }
    assert.ok(m.narrative[0].notes.some((n) => /bild(er)? till skapades/.test(n)));
    assert.ok(m.narrative[0].notes.some((n) => /positioner/.test(n)));
});

test('exporterna fungerar på testdatat och märker det som påhittat', () => {
    const s = sample.scenario();
    const m = build();
    const meta = {
        extraction: s.extraction, deviceLabel: s.deviceLabel, zoneLabel: 'Europe/Stockholm', zoneNote: 'ur bildens ZTIMEZONENAME', toolVersion: '1.26', createdText: 'nu',
        format: (ms) => core.formatWithOffset(ms, 120), formatUtc: core.formatUtc, fileRows: Object.entries(s.file._raw).map(([k, v]) => [k, String(v)]), exifRows: s.exifRows,
        fileEntry: s.fileEntryMeta, sources: s.sources, queries: [], coverage: [], timelinePngs: [], sampleNote: s.note,
    };
    const p = report.protocol(m, meta);
    const e = report.explanation(m, meta);
    assert.ok(p.includes('Påhittade testdata'));
    assert.ok(e.includes('Påhittade testdata'));
    assert.ok(p.includes('ZIMPORTEDBYBUNDLEIDENTIFIER'));
    assert.ok(!e.includes('ZIMPORTEDBY'));
    assert.ok(e.includes('Snapchat öppnas'));
});
