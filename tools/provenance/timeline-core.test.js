// Kärnan i Härkomst: typ av fil, fönster, händelselista, de tre faktorerna som stöd,
// motsägelse eller saknas, och förklaringens ordförråd. Allt med påhittade rader.

const test = require('node:test');
const assert = require('node:assert');
const core = require('./timeline-core');

const T = Date.UTC(2025, 8, 24, 12, 31, 9, 622);
const S = 1000;
const M = 60 * S;
const NAMES = { 'com.apple.camera': 'Kamera', 'com.toyopagroup.picaboo': 'Snapchat', 'com.apple.mobileslideshow': 'Bilder', 'com.duckduckgo.mobile.ios': 'DuckDuckGo' };
const names = (id) => NAMES[id] || null;
const KC = { db: 'knowledgeC.db', table: 'ZOBJECT' };

function cameraFile(over) {
    return Object.assign({
        pk: 1, filename: 'IMG_0042.HEIC', directory: 'DCIM/100APPLE', createdMs: T, addedMs: T + 300, modifiedMs: T + 300,
        importedBy: 1, importer: 'com.apple.camera', kindSubtype: 0, editor: null, zoneName: 'Europe/Stockholm', zoneOffset: 7200,
        exifTime: '2025:09:24 14:31:09', cameraMake: 'Apple', cameraModel: 'iPhone 13', trashed: 0, hidden: 0, cloudLocalState: 0,
        latitude: 59.33255, longitude: 18.064,
    }, over || {});
}

function input(over) {
    return Object.assign({
        platform: 'iOS', file: cameraFile(), appNames: names, cameraApps: ['com.apple.camera'], windowMs: 15 * M,
        appIntervals: [{ startMs: T - 20 * S, endMs: T + 12 * S, app: 'com.apple.camera', stream: '/app/usage', source: KC }],
        screen: [{ startMs: T - 3 * M, endMs: T + 10 * M, on: true, stream: '/display/isBacklit', source: KC }],
        lock: [{ startMs: T - 3 * M, endMs: T + 10 * M, locked: false, stream: '/device/isLocked', source: KC }],
        exif: { read: true, takenMs: T - 622, takenText: '2025-09-24 14:31:09 +02:00', make: 'Apple', model: 'iPhone 13', sourceTag: 'DateTimeOriginal' },
        fileEntry: { name: 'filesystem1/private/var/mobile/Media/DCIM/100APPLE/IMG_0042.HEIC', size: 1, mtimeMs: T + 1000 },
        coverage: { '/app/usage': { firstMs: T - 20 * 86400 * S, lastMs: T + 5 * 86400 * S, rows: 65 }, '/display/isBacklit': { firstMs: T - 20 * 86400 * S, lastMs: T + 5 * 86400 * S, rows: 305 } },
        neighbours: [], locations: [{ ms: T - 40 * S, lat: 59.33258, lon: 18.06398, accuracy: 8, type: 1 }],
        fileSource: { db: 'Photos.sqlite', table: 'ZASSET', column: 'ZDATECREATED', queryId: 'role-file' },
    }, over || {});
}

const states = (m) => Object.fromEntries(m.factors.map((f) => [f.id, f.state]));

test('kamerabild med alla tre faktorerna: stöd', () => {
    const m = core.build(input());
    assert.strictEqual(m.type.type, 'camera');
    assert.deepStrictEqual(states(m), { time: 'support', app: 'support', camera: 'support', screen: 'support', position: 'support' });
    assert.match(m.summary, /^Materialet är förenligt med att bilden togs med den här telefonens kamera\. Alla/);
    assert.match(m.factors[4].items[0].text, /^Telefonen var \d+ m från bildens position 40 s före bilden \(noggrannhet 8 m\)\.$/);
    assert.deepStrictEqual(m.positions.map((q) => q.kind), ['file', 'phone']);
    assert.strictEqual(m.positions[0].source.column, 'ZLATITUDE, ZLONGITUDE');
    assert.strictEqual(m.windows.length, 1);
    const lines = m.narrative[0].lines.map((l) => l.text);
    assert.deepStrictEqual(lines, ['Skärmen tänds', 'Telefonen låses upp', 'Kamera öppnas', 'Bilden IMG_0042.HEIC tas med kameran', 'Kamera lämnas', 'Skärmen släcks', 'Telefonen låses']);
    assert.ok(m.narrative[0].lines.find((l) => l.bold).text.startsWith('Bilden'));
    assert.ok(!m.alternatives.find((a) => a.id === 'received').for.length);
    assert.ok(m.alternatives.find((a) => a.id === 'received').against.length >= 2);
});

test('en annan app var igång, inte kameran: motsägelse', () => {
    const m = core.build(input({ appIntervals: [{ startMs: T - 60 * S, endMs: T + 60 * S, app: 'com.toyopagroup.picaboo', stream: '/app/usage', source: KC }] }));
    assert.strictEqual(states(m).app, 'contradiction');
    assert.strictEqual(states(m).camera, 'contradiction');
    assert.match(m.factors[1].items[0].text, /Snapchat/);
    assert.match(m.summary, /inte förenligt/);
});

test('inget knowledgeC alls: saknas, och förklaringen säger att tystnad inte är bevis', () => {
    const m = core.build(input({ appIntervals: [], screen: [], lock: [], coverage: {}, missingDbs: { '/app/usage': true, '/display/isBacklit': true } }));
    assert.deepStrictEqual(states(m), { time: 'support', app: 'missing', camera: 'missing', screen: 'missing', position: 'support' });
    assert.match(m.factors[1].items[0].text, /finns inte i extraktionen/);
    assert.match(m.factors[1].plain, /Det betyder inte att ingen app var öppen/);
    assert.match(m.summary, /förenligt .* men 2 faktorer går inte att bedöma/);
});

test('fönstret utanför strömmens täckning: saknas med täckningen utskriven', () => {
    const cov = { '/app/usage': { firstMs: T + 86400 * S, lastMs: T + 10 * 86400 * S, rows: 65 } };
    const m = core.build(input({ appIntervals: [], screen: [], lock: [], coverage: cov }));
    assert.strictEqual(states(m).app, 'missing');
    assert.match(m.factors[1].items[0].text, /utanför knowledgeC:s täckning \(2025-09-25 12:31:09 UTC till/);
});

test('skärmen släckt vid T: motsägelse', () => {
    const m = core.build(input({ screen: [{ startMs: T - 3 * M, endMs: T + 2 * M, on: false, stream: '/display/isBacklit', source: KC }] }));
    assert.strictEqual(states(m).screen, 'contradiction');
});

test('Snapchat-bild: kameran är inte tillämplig, skaparappen bedöms i stället', () => {
    const file = cameraFile({ importedBy: 3, importer: 'com.toyopagroup.picaboo', cameraMake: null, cameraModel: null });
    const m = core.build(input({ file, exif: { read: true, takenMs: null }, appIntervals: [{ startMs: T - 40 * S, endMs: T + 5 * S, app: 'com.toyopagroup.picaboo', stream: '/app/usage', source: KC }] }));
    assert.strictEqual(m.type.type, 'saved');
    assert.strictEqual(states(m).app, 'support');
    assert.strictEqual(m.factors[2].title, 'Skaparappen igång');
    assert.strictEqual(states(m).camera, 'support');
    assert.match(m.factors[2].items[m.factors[2].items.length - 1].text, /egen process/);
    assert.match(m.narrative[0].lines.find((l) => l.bold).text, /^Bilden IMG_0042\.HEIC sparas av Snapchat$/);
    assert.match(m.summary, /sparades på den här telefonen av Snapchat/);
});

test('skärmdump: kameran inte tillämplig, appen på skärmen är upplysningen', () => {
    const file = cameraFile({ filename: 'IMG_0020.PNG', importedBy: 8, importer: 'com.apple.springboard', kindSubtype: 10, cameraMake: null, cameraModel: null });
    const m = core.build(input({ file, exif: { read: true, takenMs: null }, appIntervals: [{ startMs: T - 40 * S, endMs: T + 5 * S, app: 'com.toyopagroup.picaboo', stream: '/app/usage', source: KC }] }));
    assert.strictEqual(m.type.type, 'screenshot');
    assert.deepStrictEqual(m.type.reasons, ['ZIMPORTEDBY 8', 'skaparappen är com.apple.springboard', 'ZKINDSUBTYPE 10']);
    assert.strictEqual(states(m).camera, 'na');
    assert.strictEqual(states(m).app, 'info');
    assert.match(m.factors[1].plain, /Snapchat öppen på skärmen/);
    assert.match(m.narrative[0].lines.find((l) => l.bold).text, /^Skärmdumpen IMG_0020\.PNG tas$/);
    assert.match(m.factors[0].items[1].text, /normalt för en skärmdump/);
});

test('EXIF i filen skiljer sig från databasen: motsägelse i skapandetiden', () => {
    const m = core.build(input({ exif: { read: true, takenMs: T - 3 * 3600 * S, takenText: '2025-09-24 11:31:09 +02:00', make: 'Samsung', model: 'SM-G991B' } }));
    assert.strictEqual(states(m).time, 'contradiction');
    assert.ok(m.factors[0].items.some((i) => /EXIF-tiden i själva filen .* skiljer sig 3 h 0 min/.test(i.text)));
    assert.ok(m.factors[0].items.some((i) => /Make\/Model i filen \(Samsung SM-G991B\) skiljer sig/.test(i.text)));
});

test('mottagen bild: två fönster, och alternativet "mottagen" får stöd', () => {
    const file = cameraFile({ importedBy: 3, importer: 'net.whatsapp.WhatsApp', addedMs: T + 2 * 86400 * S, modifiedMs: T + 2 * 86400 * S, cameraMake: 'samsung', cameraModel: 'SM-G991B' });
    const m = core.build(input({ file, exif: null, appIntervals: [{ startMs: T + 2 * 86400 * S - 30 * S, endMs: T + 2 * 86400 * S + 30 * S, app: 'net.whatsapp.WhatsApp', stream: '/app/usage', source: KC }], screen: [], lock: [] }));
    assert.strictEqual(m.windows.length, 2);
    assert.strictEqual(m.windows[1].id, 'added');
    assert.ok(m.type.flags.includes('received-later'));
    assert.strictEqual(states(m).time, 'contradiction');
    const received = m.alternatives.find((a) => a.id === 'received');
    assert.ok(received.for.some((t) => /2 dygn/.test(t)));
    assert.deepStrictEqual(m.narrative[1].lines.map((l) => l.text), ['net.whatsapp.WhatsApp öppnas', 'Bilden läggs till i Bilder', 'net.whatsapp.WhatsApp lämnas']);
    assert.ok(m.factors[0].items.some((i) => /Själva filen lästes inte/.test(i.text)));
});

test('grannar räknas i förklaringen men listas inte rad för rad', () => {
    const neighbours = [1, 2, 3].map((i) => ({ pk: 10 + i, filename: 'IMG_004' + (2 + i) + '.HEIC', createdMs: T + i * 900, addedMs: T + i * 900, importedBy: 1, importer: 'com.apple.camera' }));
    const m = core.build(input({ neighbours: neighbours.concat([{ pk: 1, filename: 'IMG_0042.HEIC', createdMs: T, importedBy: 1 }]) }));
    assert.strictEqual(m.events.filter((e) => e.neighbour).length, 3);
    assert.deepStrictEqual(m.narrative[0].notes, ['3 bilder till skapades inom en minut från bilden.', 'Telefonen registrerade 1 position 2025-09-24 12:30:29 UTC.']);
    assert.ok(!m.narrative[0].lines.some((l) => /IMG_0043/.test(l.text)));
});

test('Android: Wellbeing-händelser blir intervall, och en kamerabild under DCIM/Camera bedöms', () => {
    const file = { pk: 7, filename: 'PXL_20250924_123109.jpg', relativePath: 'DCIM/Camera/', importer: 'com.google.android.GoogleCamera', createdMs: T, addedMs: T + 2 * S, modifiedMs: T + 2 * S };
    const ev = [
        { ms: T - 30 * S, type: 15, app: 'android' }, { ms: T - 25 * S, type: 18, app: 'android' },
        { ms: T - 20 * S, type: 1, app: 'com.google.android.GoogleCamera' }, { ms: T + 15 * S, type: 2, app: 'com.google.android.GoogleCamera' },
        { ms: T + 15 * S, type: 1, app: 'com.whatsapp' }, { ms: T + 40 * S, type: 23, app: 'com.whatsapp' }, { ms: T + 50 * S, type: 16, app: 'android' },
    ];
    const iv = core.intervalsFromEvents(ev, T + 15 * M, { db: 'app_usage', table: 'events' });
    assert.deepStrictEqual(iv.apps.map((a) => [a.app, a.endMs - a.startMs]), [['com.google.android.GoogleCamera', 35 * S], ['com.whatsapp', 25 * S]]);
    // Skärmen släcks vid T+50 s och förblir släckt till fönstrets slut (öppet intervall).
    assert.deepStrictEqual(iv.screen.map((s) => [s.on, s.endMs - s.startMs, !!s.openEnded]), [[true, 80 * S, false], [false, 15 * M - 50 * S, true]]);
    assert.strictEqual(iv.lock[0].locked, false);
    const m = core.build({ platform: 'Android', file, appNames: (id) => ({ 'com.google.android.GoogleCamera': 'Pixel-kameran', 'com.whatsapp': 'WhatsApp' }[id] || null),
        cameraApps: ['com.google.android.GoogleCamera'], appIntervals: iv.apps, screen: iv.screen, lock: iv.lock, exif: null, coverage: { wellbeing: { firstMs: T - 86400 * S, lastMs: T + 86400 * S, rows: 100 } } });
    assert.strictEqual(m.type.type, 'camera');
    assert.deepStrictEqual(states(m), { time: 'support', app: 'support', camera: 'support', screen: 'support', position: 'missing' });
    assert.deepStrictEqual(m.narrative[0].lines.map((l) => l.text), ['Skärmen tänds', 'Telefonen låses upp', 'Pixel-kameran öppnas', 'Bilden PXL_20250924_123109.jpg tas med kameran', 'Pixel-kameran lämnas', 'WhatsApp öppnas', 'WhatsApp lämnas', 'Skärmen släcks']);
});

test('Android utan skärmhändelser: skärmen saknas, inte motsägelse', () => {
    const file = { pk: 7, filename: 'PXL_1.jpg', relativePath: 'DCIM/Camera/', importer: 'com.google.android.GoogleCamera', createdMs: T, addedMs: T };
    const m = core.build({ platform: 'Android', file, appNames: () => null, cameraApps: ['com.google.android.GoogleCamera'],
        appIntervals: [{ startMs: T - S, endMs: T + S, app: 'com.google.android.GoogleCamera', stream: 'wellbeing' }], screen: [], lock: [], exif: null, coverage: { wellbeing: { firstMs: T - 86400 * S, lastMs: T + 86400 * S, rows: 10 } } });
    assert.strictEqual(states(m).screen, 'missing');
    assert.strictEqual(states(m).camera, 'support');
});

test('täta intervall från samma app slås ihop, olika appar inte', () => {
    const merged = core.mergeIntervals([
        { startMs: 0, endMs: 1000, app: 'a', stream: 's' }, { startMs: 1500, endMs: 3000, app: 'a', stream: 's' },
        { startMs: 3100, endMs: 4000, app: 'b', stream: 's' }, { startMs: 9000, endMs: 9500, app: 'a', stream: 's' },
    ]);
    assert.deepStrictEqual(merged.map((m) => [m.app, m.startMs, m.endMs]), [['a', 0, 3000], ['b', 3100, 4000], ['a', 9000, 9500]]);
});

test('utan skapandetid bedöms bara tiden, och det sägs', () => {
    const m = core.build(input({ file: cameraFile({ createdMs: null }) }));
    assert.strictEqual(m.factors.length, 1);
    assert.strictEqual(m.factors[0].state, 'missing');
    assert.ok(m.warnings.some((w) => /Skapandetiden saknas/.test(w)));
});

test('tidsformat och varaktighet', () => {
    assert.strictEqual(core.formatWithOffset(Date.UTC(2025, 8, 24, 12, 31, 9), 120), '2025-09-24 14:31:09');
    assert.strictEqual(core.formatUtc(Date.UTC(2025, 8, 24, 12, 31, 9)), '2025-09-24 12:31:09 UTC');
    assert.strictEqual(core.duration(300), '0 s');
    assert.strictEqual(core.duration(61 * S), '1 min 1 s');
    assert.strictEqual(core.duration(2 * 86400 * S + 3 * 3600 * S), '2 dygn 3 h');
    assert.strictEqual(core.appName('x.y', names), 'x.y');
});

test('position: telefonen långt från bildens position är en motsägelse, och EXIF jämförs med databasen', () => {
    const far = core.build(input({ locations: [{ ms: T + 20 * S, lat: 59.36, lon: 18.10, accuracy: 10, type: 1 }, { ms: T + 5 * M, lat: 59.361, lon: 18.101, accuracy: 10, type: 1 }] }));
    assert.strictEqual(states(far).position, 'contradiction');
    assert.match(far.factors[4].items[0].text, /^Telefonen var \d,\d km från bildens position 20 s efter bilden\.$/);
    assert.match(far.factors[4].items[1].text, /^0 av 2 registrerade positioner/);
    assert.match(far.summary, /inte förenligt/);
    assert.ok(far.alternatives.find((a) => a.id === 'received').for.some((t) => /km från bildens position/.test(t)));

    const exif = core.build(input({ exif: { read: true, takenMs: T, takenText: 'x', make: 'Apple', model: 'iPhone 13', position: { lat: 59.3326, lon: 18.0641, accuracy: 5, source: 'Composite:GPSPosition' } } }));
    assert.deepStrictEqual(exif.positions.map((q) => q.kind), ['file', 'exif', 'phone']);
    assert.strictEqual(exif.factors[4].items[0].state, 'support');
    assert.match(exif.factors[4].items[0].text, /Positionen i EXIF i filen ligger \d+ m från positionen i databasen/);

    const mid = core.build(input({ locations: [{ ms: T - 30 * S, lat: 59.3300, lon: 18.064, accuracy: 10, type: 1 }] }));
    assert.strictEqual(states(mid).position, 'info');
    assert.match(mid.factors[4].items[0].text, /GPS-fel/);
});

test('position: fil utan position, och ingen routined alls', () => {
    const noFile = core.build(input({ file: cameraFile({ latitude: -180, longitude: -180 }) }));
    assert.strictEqual(states(noFile).position, 'info');
    assert.match(noFile.factors[4].items[0].text, /^Filen har ingen position\. Telefonen registrerade 1 position i fönstret/);
    const none = core.build(input({ locations: [], missingDbs: { routined: true } }));
    assert.strictEqual(states(none).position, 'missing');
    assert.match(none.factors[4].items[0].text, /Cache\.sqlite finns inte i extraktionen/);
    assert.deepStrictEqual(core.build(input({ file: cameraFile({ latitude: -180, longitude: -180 }), locations: [] })).positions, []);
});
