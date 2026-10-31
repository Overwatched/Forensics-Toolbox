// Testdatat ska ge ett fullständigt, tydligt resultat: kamerabild med stöd på alla faktorer,
// Snapchat runt omkring, grannar och positioner, och förklaringen i rätt ordning. Snapchat-
// scenariot ska visa hela betaflödet: fil i Snapchats cache, inspelning, skickad, kopior.

const test = require('node:test');
const assert = require('node:assert');
const core = require('./timeline-core');
const report = require('./report');
const sample = require('./sample-data');
const snapchat = require('./snapchat');
const copies = require('./copies');

const NAMES = { 'com.apple.camera': 'Kamera', 'com.toyopagroup.picaboo': 'Snapchat', 'com.apple.mobileslideshow': 'Bilder', 'com.apple.springboard': 'Hemskärmen' };

const INPUT = { appNames: (id) => NAMES[id] || null, cameraApps: ['com.apple.camera'], windowMs: 15 * 60000, format: (ms) => core.formatWithOffset(ms, 120) };

function build() {
    const s = sample.scenario({ snapchat, copies });
    return core.build(Object.assign({}, s, INPUT));
}

function buildSnap() {
    const s = sample.snapchatScenario({ snapchat, copies });
    return core.build(Object.assign({}, s, INPUT));
}

function metaFor(s) {
    return {
        extraction: s.extraction, deviceLabel: s.deviceLabel, zoneLabel: 'Europe/Stockholm', zoneNote: 'ur bildens ZTIMEZONENAME', toolVersion: '1.28', createdText: 'nu',
        format: (ms) => core.formatWithOffset(ms, 120), formatUtc: core.formatUtc, fileRows: Object.entries(s.file._raw).map(([k, v]) => [k, String(v)]), exifRows: s.exifRows,
        fileEntry: s.fileEntryMeta, sources: s.sources, queries: [], coverage: [], timelinePngs: [], sampleNote: s.note,
    };
}

test('testdatat ger en kamerabild med stöd på alla faktorer', () => {
    const m = build();
    assert.strictEqual(m.type.type, 'camera');
    assert.deepStrictEqual(Object.fromEntries(m.factors.map((f) => [f.id, f.state])), { time: 'support', app: 'support', camera: 'support', screen: 'support', position: 'support' });
    assert.deepStrictEqual(m.positions.map((q) => q.kind), ['file', 'exif', 'phone', 'phone', 'phone', 'phone', 'phone']);
    assert.strictEqual(m.windows.length, 1);
    assert.match(m.summary, /förenligt .* Alla kontrollerade faktorer ger stöd/);
});

test('förklaringen berättar Snapchat-historien i ordning', () => {
    const m = build();
    const lines = m.narrative[0].lines.map((l) => l.text);
    const want = ['En snap eller bild skickas till den här telefonen i Snapchat från @erik.lind', 'Telefonen får en notis om en ny snap', 'Den öppnas på den här telefonen', 'Skärmen tänds', 'Snapchat öppnas', 'Kamera öppnas', 'Bilden IMG_4104.JPG tas med kameran', 'Kamera lämnas', 'En snap eller bild skickas till @erik.lind från den här telefonen', 'Mottagaren öppnar den', 'Snapchat öppnas', 'Skärmen släcks'];
    let at = 0;
    for (const w of want) {
        const i = lines.indexOf(w, at);
        assert.ok(i >= 0, 'saknar "' + w + '" efter rad ' + at + ': ' + lines.join(' | '));
        at = i + 1;
    }
    assert.ok(m.narrative[0].notes.some((n) => /bild(er)? till skapades/.test(n)));
    assert.ok(m.narrative[0].notes.some((n) => /positioner/.test(n)));
    assert.ok(!lines.includes('En snap eller bild skickas från den här telefonen i Snapchat'), 'meddelandet och cacheraden ska ge en mening, inte två');
    assert.strictEqual(m.beta, true);
    assert.strictEqual(m.copies.length, 1);
    assert.ok(m.events.filter((e) => e.lane === 'snapchat').every((e) => e.source.db && e.source.queryId));
});

test('exporterna fungerar på testdatat och märker det som påhittat', () => {
    const s = sample.scenario({ snapchat, copies });
    const m = build();
    const meta = metaFor(s);
    const p = report.protocol(m, meta);
    const e = report.explanation(m, meta);
    assert.ok(p.includes('Påhittade testdata'));
    assert.ok(e.includes('Påhittade testdata'));
    assert.ok(p.includes('ZIMPORTEDBYBUNDLEIDENTIFIER'));
    assert.ok(!e.includes('ZIMPORTEDBY'));
    assert.ok(e.includes('Snapchat öppnas'));
    assert.ok(p.includes('Betafunktion'));
    assert.ok(p.includes('Var filen finns i extraktionen') && p.includes('photospicker'));
    assert.ok(e.includes('Exakt samma fil finns också som en kopia en app fick ur bildbiblioteket.'));
    assert.ok(!e.includes('photospicker'));
    assert.ok(e.includes('@erik.lind'));
});

test('Snapchat-testdatat är en inspelning utanför biblioteket med stöd på alla faktorer', () => {
    const m = buildSnap();
    assert.strictEqual(m.type.type, 'snapchat');
    assert.strictEqual(m.type.origin, 'recorded');
    assert.strictEqual(m.type.label, 'Snapchat-media utanför bildbiblioteket');
    assert.ok(m.type.reasons.some((r) => /MEDIA_CONTEXT_TYPE 34/.test(r)) && m.type.reasons.some((r) => /recorded_videos/.test(r)), m.type.reasons.join(' | '));
    assert.deepStrictEqual(Object.fromEntries(m.factors.map((f) => [f.id, f.state])), { time: 'support', app: 'support', camera: 'support', screen: 'support', position: 'info' });
    assert.strictEqual(m.factors.find((f) => f.id === 'camera').title, 'Snapchats kamera');
    assert.strictEqual(m.factors.find((f) => f.id === 'app').title, 'Snapchat igång');
    assert.match(m.factors.find((f) => f.id === 'position').plain, /^Filen saknar positionsuppgift/);
    assert.match(m.summary, /förenligt med att filen skapades med Snapchat på den här telefonen\. Alla kontrollerade faktorer ger stöd/);
    assert.strictEqual(m.windows.length, 1);
    assert.strictEqual(m.beta, true);
    assert.deepStrictEqual(m.copies.map((c) => c.area), ['snapchat', 'snapchat']);
    assert.ok(m.copies.some((c) => /recorded_videos/.test(c.name)) && m.copies.some((c) => /appbehållare/.test(c.label)));
    const file = m.events.filter((e) => e.isFile);
    assert.ok(file.length === 1 && file[0].kind === 'snap-cache' && file[0].context === 34, JSON.stringify(file));
    assert.ok(m.events.filter((e) => e.lane === 'snapchat').every((e) => e.source.db && e.source.queryId));
    assert.ok(m.events.some((e) => e.neighbour && /IMG_4104/.test(e.text)), 'bilden i biblioteket strax före ska synas som granne');
});

test('Snapchat-testdatats förklaring berättar inspelningen, sändningen och läsningen i ordning', () => {
    const m = buildSnap();
    const lines = m.narrative[0].lines.map((l) => l.text);
    const want = ['En snap eller bild skickas till den här telefonen i Snapchat från @erik.lind', 'Den öppnas på den här telefonen', 'Snapchat öppnas', 'Kamera öppnas', 'Kamera lämnas',
        'En snap eller bild skickas till @erik.lind från den här telefonen', 'Mottagaren öppnar den', 'Snapchat öppnas', 'Den bedömda videon spelas in med Snapchats kamera',
        'En snap eller bild skickas till @erik.lind från den här telefonen', 'Mottagaren öppnar den', 'Skärmen släcks'];
    let at = 0;
    for (const w of want) {
        const i = lines.indexOf(w, at);
        assert.ok(i >= 0, 'saknar "' + w + '" efter rad ' + at + ': ' + lines.join(' | '));
        at = i + 1;
    }
    assert.ok(!lines.some((l) => /SNAPVIDEOFILTERSTATE|filterstate/i.test(l)), 'hjälpraden för filtret ska inte få en egen mening');
    assert.ok(m.narrative[0].notes.some((n) => n === '2 bilder i biblioteket skapades inom 7 minuter från filen.'), m.narrative[0].notes.join(' | '));
    const alts = Object.fromEntries(m.alternatives.map((a) => [a.id, a]));
    assert.ok(alts.received.against.includes('Registrerad som inspelning med Snapchats kamera på den här telefonen.') && !alts.received.against.some((t) => /^Kameran var igång/.test(t)), JSON.stringify(alts.received));
    assert.ok(alts.synced.against.includes('Snapchats kamera användes för filen enligt Snapchats register.'), JSON.stringify(alts.synced));
    assert.strictEqual(lines.filter((l) => l === 'En snap eller bild skickas från den här telefonen i Snapchat').length, 0, 'meddelandet och cacheraden ska ge en mening');
});

test('exporterna fungerar på Snapchat-testdatat', () => {
    const s = sample.snapchatScenario({ snapchat, copies });
    const m = buildSnap();
    const meta = metaFor(s);
    const p = report.protocol(m, meta);
    const e = report.explanation(m, meta);
    for (const w of ['Påhittade testdata', 'Betafunktion', 'CACHE_KEY', 'MEDIA_CONTEXT_TYPE', 'recorded_videos', 'Var filen finns i extraktionen', 'cache_controller.db', 'arroyo.db']) assert.ok(p.includes(w), 'protokollet saknar ' + w);
    for (const w of ['Påhittade testdata', 'Snapchats kamera', '@erik.lind', 'Exakt samma fil finns också bland Snapchats inspelade videor och i Snapchat.']) assert.ok(e.includes(w), 'förklaringen saknar ' + w);
    for (const w of ['CACHE_KEY', 'MEDIA_CONTEXT_TYPE', 'recorded_videos']) assert.ok(!e.includes(w), 'förklaringen ska inte innehålla ' + w);
});

test('kamerascenariot och Snapchat-scenariot delar samma telefonlogg och Snapchat-historia', () => {
    const a = sample.scenario({ snapchat, copies });
    const b = sample.snapchatScenario({ snapchat, copies });
    assert.deepStrictEqual(a.appIntervals, b.appIntervals);
    assert.deepStrictEqual(a.locations, b.locations);
    assert.strictEqual(sample.T2 - sample.T, (6 * 60 + 46) * 1000);
    assert.strictEqual(b.file.createdMs, sample.T2);
    assert.strictEqual(b.file.filename, b.file.snapchatCache.key);
    assert.strictEqual(a.extraEvents.filter((e) => e.isFile).length, 0, 'i kamerascenariot är ingen Snapchat-rad den bedömda filen');
    assert.strictEqual(b.extraEvents.filter((e) => e.isFile).length, 1);
});

test('Android-scenariot: selfie med Snapchats frontkamera, T ur date_added, Memories, usagestats och appops', () => {
    const s = sample.androidScenario({ snapchat, copies });
    const names = { 'com.snapchat.android': 'Snapchat', 'com.google.android.GoogleCamera': 'Pixel-kamera' };
    const m = core.build(Object.assign({}, s, { appNames: (id) => names[id] || null, cameraApps: ['com.google.android.GoogleCamera'], windowMs: 15 * 60000, format: (ms) => core.formatWithOffset(ms, 120) }));
    assert.strictEqual(m.platform, 'Android');
    assert.strictEqual(m.type.type, 'saved');
    assert.ok(m.type.memory && m.type.memory.front);
    assert.ok(m.type.reasons.some((r) => /datetaken saknas/.test(r)));
    const st = Object.fromEntries(m.factors.map((f) => [f.id, f.state]));
    assert.deepStrictEqual(st, { time: 'support', app: 'support', camera: 'support', screen: 'support', position: 'info' });
    assert.match(m.summary, /frontkamera/);
    assert.match(m.factors.find((f) => f.id === 'camera').items[0].text, /appops/);
    assert.ok(m.events.some((e) => e.kind === 'file-captured'));
    assert.ok(m.events.some((e) => e.kind === 'app' && e.cameraOp && e.app === 'com.snapchat.android' && e.merged === 2), 'de två kameraoperationerna i följd slås ihop');
    assert.ok(m.events.some((e) => e.kind === 'snap-memory' && e.isFile && e.captured));
    assert.ok(m.events.some((e) => e.kind === 'snap-message' && e.own === false && /@erik\.lind/.test(e.text)));
    assert.ok(m.events.some((e) => e.kind === 'snap-journal'));
    assert.ok(m.positions.some((p) => p.kind === 'memory'));
    assert.strictEqual(core.logInfo(s).label, 'usagestats');
    assert.ok(m.beta);
    const proto = report.protocol(m, metaFor(s));
    assert.match(proto, /date_added/);
    assert.match(proto, /Memories/);
    assert.match(proto, /Android 14/);
    const expl = report.explanation(m, metaFor(s));
    assert.doesNotMatch(expl, /usagestats|appops|memories_snap/);
    assert.match(expl, /frontkamera/);
    assert.ok(s.exifRows.some((r) => r[0] === 'ExifIFD:UserComment' && r[1].length > 40));
});
