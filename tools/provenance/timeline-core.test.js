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
    assert.match(m.factors[2].items[m.factors[2].items.length - 1].text, /egen kamera/);
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
    assert.ok(m.factors[0].items.some((i) => /^Tiden i filen \(EXIF\) är 2025-09-24 11:31:09 \+02:00: 3 h 0 min före Skapad\./.test(i.text)));
    assert.ok(m.factors[0].items.some((i) => /^Kameramodellen i filen \(Make\/Model Samsung SM-G991B\) är inte densamma/.test(i.text)));
});

test('mottagen bild: två fönster, och alternativet "mottagen" får stöd', () => {
    const file = cameraFile({ importedBy: 3, importer: 'net.whatsapp.WhatsApp', addedMs: T + 2 * 86400 * S, modifiedMs: T + 2 * 86400 * S, cameraMake: 'samsung', cameraModel: 'SM-G991B' });
    const m = core.build(input({ file, exif: null, appIntervals: [{ startMs: T + 2 * 86400 * S - 30 * S, endMs: T + 2 * 86400 * S + 30 * S, app: 'net.whatsapp.WhatsApp', stream: '/app/usage', source: KC }], screen: [], lock: [] }));
    assert.strictEqual(m.windows.length, 2);
    assert.strictEqual(m.windows[1].id, 'added');
    assert.ok(m.type.flags.includes('received-later'));
    // En sparad fil får bära en äldre tid: det säger inte emot att appen sparade den.
    assert.strictEqual(states(m).time, 'support');
    assert.strictEqual(m.factors[0].verdict, 'Tiderna passar en sparad fil');
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

test('position: bara fönstret runt T jämförs, positioner när filen kom till telefonen räknas inte', () => {
    const later = T + 3 * 86400 * S;
    const m = core.build(input({ file: cameraFile({ addedMs: later, modifiedMs: later }), locations: [{ ms: later + 30 * S, lat: 59.36, lon: 18.10, accuracy: 10, type: 1 }] }));
    assert.deepStrictEqual(m.windows.map((w) => w.id), ['created', 'added']);
    assert.strictEqual(states(m).position, 'missing');
    const items = m.factors[4].items.map((i) => i.text);
    assert.match(items[0], /^Telefonen har inga registrerade positioner i fönstret/);
    assert.strictEqual(items[items.length - 1], '1 position till ligger i fönstret när filen kom till telefonen. De visas på kartan men räknas inte här, eftersom de inte gäller T.');
    assert.strictEqual(m.positions.filter((q) => q.kind === 'phone').length, 1);
    // Med en position i fönstret runt T jämförs bara den, och den andra nämns.
    const both = core.build(input({ file: cameraFile({ addedMs: later, modifiedMs: later }), locations: [{ ms: T - 40 * S, lat: 59.33258, lon: 18.06398, accuracy: 8, type: 1 }, { ms: later + 30 * S, lat: 59.36, lon: 18.10, accuracy: 10, type: 1 }] }));
    assert.strictEqual(states(both).position, 'support');
    assert.match(both.factors[4].items[0].text, /40 s före bilden/);
    assert.ok(!both.factors[4].items.some((i) => /av 2 registrerade/.test(i.text)));
    assert.ok(core.inWindows(T, both.windows) && core.inWindows(later, both.windows) && !core.inWindows(T + 86400 * S, both.windows));
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

test('varje fönster har en närbild, och förklaringens rader vet sin källa och om de ligger i närbilden', () => {
    const m = core.build(input());
    const w = m.windows[0];
    assert.deepStrictEqual([w.closeup.startMs, w.closeup.centerMs, w.closeup.endMs], [T - 90 * S, T, T + 90 * S]);
    assert.strictEqual(core.windows({ createdMs: T }, 5 * M)[0].closeup.endMs - T, 30 * S, 'minst 30 s åt varje håll');
    assert.strictEqual(core.windows({ createdMs: T }, 24 * 60 * M)[0].closeup.endMs - T, 144 * M);
    const lines = m.narrative[0].lines;
    const file = lines.find((l) => l.bold);
    assert.deepStrictEqual(file.source, { db: 'Photos.sqlite', table: 'ZASSET', column: 'ZDATECREATED', queryId: 'role-file' });
    assert.strictEqual(file.near, true);
    const cam = lines.find((l) => l.text === 'Kamera öppnas');
    assert.strictEqual(cam.source, KC);
    assert.strictEqual(cam.kind, 'app');
    assert.strictEqual(lines.find((l) => l.text === 'Skärmen tänds').near, false, '3 min före T ligger utanför närbilden');
    assert.ok(lines.every((l) => typeof l.near === 'boolean'));
});

test('Tillagd före Skapad sägs som före, inte efter', () => {
    const m = core.build(input({ file: cameraFile({ addedMs: T - 2 * 3600 * S, modifiedMs: T - 2 * 3600 * S }) }));
    const item = m.factors[0].items[0];
    assert.strictEqual(item.state, 'info');
    assert.match(item.text, /^Filen lades till i biblioteket 2 h 0 min före Skapad\. Filen lades alltså till innan den skapades\./);
    const close = core.build(input({ file: cameraFile({ addedMs: T - 20 * S }) }));
    assert.match(close.factors[0].items[0].text, /^Filen lades till i biblioteket 20 s före Skapad \(inom en minut\)\.$/);
    const same = core.build(input({ file: cameraFile({ addedMs: T }) })).factors[0];
    assert.match(same.items[0].text, /^Filen lades till i biblioteket samma sekund som Skapad \(inom en minut\)\.$/);
    const sec = Math.floor(T / 1000) * 1000;
    const tenths = core.build(input({ file: cameraFile({ createdMs: sec + 533, addedMs: sec + 870 }) }));
    assert.match(tenths.factors[0].items[0].text, /^Filen lades till i biblioteket 0,3 s efter Skapad \(inom en minut\)\.$/);
    // Hela sekunder i ena tiden (date_added på Android, zippens tider): inga påhittade tiondelar.
    const whole = core.build(input({ file: cameraFile({ createdMs: sec + 700, addedMs: sec + 1000 }), fileEntry: { name: 'x', size: 1, mtimeMs: sec + 1000 } }));
    assert.match(whole.factors[0].items[0].text, /samma sekund som Skapad \(inom en minut\)\.$/);
    assert.ok(whole.factors[0].items.some((i) => i.text === 'Filen ändrades i filsystemet samma sekund som Skapad.'));
});

test('ett hopslaget intervall med öppet slut är fortfarande öppet, och får ingen påhittad sluttid', () => {
    const merged = core.mergeIntervals([
        { startMs: 0, endMs: 1000, app: 'a', stream: 's' },
        { startMs: 1500, endMs: 60000, app: 'a', stream: 's', openEnded: true },
    ]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].openEnded, true);
    const m = core.build(input({ appIntervals: [
        { startMs: T - 20 * S, endMs: T - 19 * S, app: 'com.apple.camera', stream: '/app/usage', source: KC },
        { startMs: T - 18 * S, endMs: T + 5 * M, app: 'com.apple.camera', stream: '/app/usage', source: KC, openEnded: true },
    ] }));
    assert.ok(!m.narrative[0].lines.some((l) => l.text === 'Kamera lämnas'), 'slutet är okänt');
});

test('en databas som inte gick att läsa sägs som oläst, inte som saknad', () => {
    const m = core.build(input({ appIntervals: [], screen: [], lock: [], coverage: {}, locations: [], missingDbs: { '/app/usage': 'unread', '/display/isBacklit': 'unread', routined: 'unread' } }));
    assert.match(m.factors[1].items[0].text, /^knowledgeC kunde inte läsas/);
    assert.match(m.factors[3].items[0].text, /^knowledgeC kunde inte läsas/);
    assert.match(m.factors[4].items.map((i) => i.text).join(' '), /routined Cache\.sqlite kunde inte läsas/);
});

test('filsystemets skapandetid jämförs med Skapad, men motsäger inget', () => {
    const same = core.build(input({ fileEntry: { name: 'x', size: 1, mtimeMs: T + 1000, createdMs: T, timeField: 'NTFS-fältet' } }));
    const item = same.factors[0].items.find((i) => /^Filen skapades i filsystemet/.test(i.text));
    assert.strictEqual(item.state, 'support');
    assert.strictEqual(item.text, 'Filen skapades i filsystemet samma sekund som Skapad.');
    const later = core.build(input({ fileEntry: { name: 'x', size: 1, mtimeMs: T, createdMs: T + 3 * 86400 * S, timeField: 'UT-fältet' } }));
    const late = later.factors[0].items.find((i) => /^Filen skapades i filsystemet/.test(i.text));
    assert.strictEqual(late.state, 'info');
    assert.match(late.text, /3 dygn 0 h efter Skapad/);
    assert.match(late.text, /kopieras, tas emot eller återställs/);
    assert.notStrictEqual(later.factors[0].state, 'contradiction');
    // En kopia med källans ändringstid: ändringen ligger före skapandetiden.
    assert.ok(later.factors[0].items.some((i) => /ändringstid ligger 3 dygn 0 h före skapandetiden i filsystemet/.test(i.text)));
});

test('ctime och den osäkra tredje UT-tiden står i tabellen, utan slutsats', () => {
    const D = 86400 * S;
    const ctime = core.build(input({ fileEntry: { name: 'x', size: 1, mtimeMs: T, createdMs: T, changedMs: T + D, timeField: 'UT-fältet' } })).factors[0];
    const c = ctime.times.find((r) => r.id === 'fs-changed');
    assert.strictEqual(c.label, 'Metadata ändrad (ctime)');
    assert.match(c.note, /säger inte när filen kom till/);
    assert.strictEqual(c.deltaMs, D);
    assert.strictEqual(c.gap, '+1 dygn 0 h');
    assert.deepStrictEqual(c.source, { db: 'Zippen', table: 'UT-fältet', column: 'tredje tiden' });
    assert.ok(!ctime.items.some((i) => /ctime|kopieras, tas emot eller återställs/.test(i.text)));
    const third = core.build(input({ fileEntry: { name: 'x', size: 1, mtimeMs: T, thirdMs: T + D, timeField: 'UT-fältet' } })).factors[0];
    const t = third.times.find((r) => r.id === 'fs-third');
    assert.strictEqual(t.label, 'Tredje tiden i zippen (skapad eller ctime)');
    assert.match(t.note, /^Zippen säger inte vilken av dem det är\.$/);
    assert.ok(!third.times.some((r) => r.id === 'fs-created'), 'den osäkra tiden heter inte skapad');
});

test('sammanfattningen säger inom en minut bara när Tillagd ligger nära Skapad', () => {
    const close = core.build(input()).factors[0];
    assert.match(close.plain, /lades till i biblioteket inom en minut från skapandetiden/);
    const later = core.build(input({ file: cameraFile({ addedMs: T + 10 * 60 * S }) })).factors[0];
    assert.strictEqual(later.state, 'support');
    assert.doesNotMatch(later.plain, /inom en minut/);
});

test('Android: förgrundsloggen slutar före T men kameraappen använde kameran vid T: appen var igång, ingen annan app förlängs', () => {
    // usagestats skrevs senast T−90 s: Signal öppnades före det och har inget slut. Intervallet slutar där loggen slutar.
    const usEnd = T - 90 * S;
    const ev = [{ ms: T - 100 * S, type: 1, app: 'org.thoughtcrime.securesms' }];
    const iv = core.intervalsFromEvents(ev, usEnd, { db: 'usagestats', table: 'daily' });
    assert.deepStrictEqual(iv.apps.map((a) => [a.app, a.endMs, !!a.openEnded]), [['org.thoughtcrime.securesms', usEnd, true]]);
    const file = { pk: 97, filename: '2026-11-02-20-42-21-357.mp4', relativePath: 'DCIM/Camera/', importer: 'org.lineageos.aperture', createdMs: T, addedMs: T - 3 * S };
    const m = core.build({ platform: 'Android', file, appNames: (id) => ({ 'org.lineageos.aperture': 'Aperture', 'org.thoughtcrime.securesms': 'Signal' }[id] || null),
        cameraApps: ['org.lineageos.aperture'], appIntervals: iv.apps.map((a) => Object.assign({ stream: 'usagestats' }, a)), screen: [], lock: [], exif: null,
        cameraUse: [{ startMs: T - 6 * S, endMs: T + 4 * S, app: 'org.lineageos.aperture', source: { db: 'appops', table: 'discrete' } }],
        coverage: { usagestats: { firstMs: T - 86400 * S, lastMs: usEnd, rows: 50 } }, androidLog: 'usagestats' });
    const app = m.factors.find((f) => f.id === 'app');
    assert.strictEqual(app.state, 'support');
    assert.strictEqual(app.items[0].text, 'Aperture använde kameran vid tidpunkten (appops), så appen var igång.');
    assert.match(app.items[1].text, /^Förgrundsloggen: Tidpunkten ligger utanför/);
    assert.deepStrictEqual(app.via, { l1: 'Aperture använder kameran', l2: 'appops, ingen förgrundslogg' });
    // Skärmen: ingen skärmlogg vid T, men kameran användes. Kameravyn kräver tänd skärm.
    const screen = m.factors.find((f) => f.id === 'screen');
    assert.strictEqual(screen.state, 'support');
    assert.strictEqual(screen.items[0].text, 'Aperture använde kameran vid tidpunkten (appops). Kameravyn visas bara med tänd skärm.');
    // Utan kameraanvändning vid T: saknas, inte "en annan app var igång".
    const m2 = core.build(Object.assign({}, { platform: 'Android', file, appNames: () => null, cameraApps: ['org.lineageos.aperture'], appIntervals: iv.apps, screen: [], lock: [], exif: null, cameraUse: [], coverage: { usagestats: { firstMs: T - 86400 * S, lastMs: usEnd, rows: 50 } }, androidLog: 'usagestats' }));
    assert.strictEqual(m2.factors.find((f) => f.id === 'app').state, 'missing');
});

test('Android: en fil som en app sparade, utan förgrundslogg vid T men med appens egen loggrad vid T: appen användes och skärmen var tänd', () => {
    const usEnd = T - 30 * S;
    const file = { pk: 96, filename: 'signal-2026-11-02-20-41-09-488.jpg', relativePath: 'Pictures/Signal/', importer: 'org.thoughtcrime.securesms', createdMs: T, addedMs: T, createdFrom: 'date_added' };
    const saved = { ms: T + 300, kind: 'sig-saved', lane: 'signal', app: 'org.thoughtcrime.securesms', active: true, activeText: 'en bilaga sparades till galleriet', isFile: true,
        text: 'Signals logg: 1 av 1 bilagor sparade till galleriet', plain: 'Den bedömda filen sparas ur Signal till galleriet', source: { db: 'signal-logs.db', table: 'log' } };
    const incoming = { ms: T - 15 * S, kind: 'sig-message', lane: 'signal', app: 'org.thoughtcrime.securesms', own: false, active: false, text: 'Signal: bild mottagen', plain: 'En bild tas emot i Signal', source: { db: 'signal.db', table: 'message' } };
    const base = { platform: 'Android', file, appNames: (id) => ({ 'org.thoughtcrime.securesms': 'Signal' }[id] || null), cameraApps: ['org.lineageos.aperture'],
        appIntervals: [{ startMs: T - 60 * S, endMs: usEnd, app: 'org.thoughtcrime.securesms', stream: 'usagestats', openEnded: true }], screen: [], lock: [], exif: null,
        coverage: { usagestats: { firstMs: T - 86400 * S, lastMs: usEnd, rows: 50 } }, androidLog: 'usagestats' };
    const m = core.build(Object.assign({}, base, { extraEvents: [incoming, saved] }));
    const app = m.factors.find((f) => f.id === 'app');
    assert.strictEqual(app.state, 'support');
    assert.strictEqual(app.items[0].text, 'Signal användes vid tidpunkten: en bilaga sparades till galleriet (signal-logs.db).');
    assert.deepStrictEqual(app.via, { l1: 'Signal: en bilaga sparades till galleriet', l2: 'signal-logs.db, ingen förgrundslogg' });
    const screen = m.factors.find((f) => f.id === 'screen');
    assert.strictEqual(screen.state, 'support');
    assert.strictEqual(screen.items[0].text, 'Signal användes vid tidpunkten: en bilaga sparades till galleriet (signal-logs.db). Det görs med tänd skärm.');
    // Ett mottaget meddelande är ingen åtgärd i appen: utan loggraden vid T saknas registreringar.
    const m2 = core.build(Object.assign({}, base, { extraEvents: [incoming] }));
    assert.strictEqual(m2.factors.find((f) => f.id === 'app').state, 'missing');
    assert.strictEqual(m2.factors.find((f) => f.id === 'screen').state, 'missing');
});

test('ZIMPORTEDBY 8 räcker inte för en skärmdump: Safari och en dubblett i Bilder', () => {
    const safari = core.classify({ importedBy: 8, importer: 'com.apple.mobilesafari', kindSubtype: 0 }, 'iOS');
    assert.deepStrictEqual([safari.type, safari.label], ['saved', 'Sparad ur en app']);
    const dup = core.classify({ importedBy: 8, importer: 'com.apple.mobileslideshow', kindSubtype: 2 }, 'iOS');
    assert.deepStrictEqual([dup.type, dup.transfer, dup.label], ['saved', 'photos', 'Skapad i Bilder (till exempel en dubblett)']);
    assert.strictEqual(core.classify({ importedBy: 8, importer: 'com.apple.springboard', kindSubtype: 10 }, 'iOS').type, 'screenshot');
    assert.strictEqual(core.classify({ importedBy: 8, kindSubtype: 10 }, 'iOS').type, 'screenshot');
});

test('AirDrop: ZIMPORTEDBY 13 gäller också när en dubblett skrivit om skaparappen, och kameran och appen frågas inte', () => {
    const rewritten = core.classify({ importedBy: 13, importer: 'com.apple.mobileslideshow' }, 'iOS');
    assert.deepStrictEqual([rewritten.transfer, rewritten.importer, rewritten.label], ['airdrop', 'com.apple.sharingd', 'Mottagen med AirDrop']);
    const m = core.build(input({ file: cameraFile({ importedBy: 13, importer: 'com.apple.sharingd', addedMs: T + 400 * 86400 * S }), appIntervals: [] }));
    assert.strictEqual(states(m).camera, 'na');
    assert.strictEqual(states(m).app, 'na');
    assert.match(m.summary, /togs emot med AirDrop/);
});

test('en mottagen fil som sparats: kameran frågas inte', () => {
    const m = core.build(input({ file: cameraFile({ importedBy: 3, importer: 'net.whatsapp.WhatsApp' }), appIntervals: [], whatsapp: { link: { matches: [{ direction: 'in', who: 'Kim', messageId: 19, by: ['sha256'], dateMs: T }], nearby: [], media: 1 } } }));
    assert.strictEqual(states(m).camera, 'na');
    assert.match(m.factors.find((f) => f.id === 'camera').items[0].text, /togs emot i WhatsApp från Kim \(meddelande 19\)/);
});

test('filsystemets skapandetid: HEIC skrivs färdig senare, och en kopia kan behålla källans tid', () => {
    const heic = core.build(input({ fileEntry: { name: 'x/IMG_1.HEIC', size: 1, mtimeMs: T + 30 * S, createdMs: T + 30 * S } }));
    assert.match(heic.factors[0].items.find((i) => /^Filen skapades i filsystemet/.test(i.text)).text, /iOS skriver HEIC-filen färdigt efter att bilden tagits \(5–50 s i labbet/);
    // Inom samma sekund finns inget att förklara.
    const direct = core.build(input({ fileEntry: { name: 'x/IMG_3.HEIC', size: 1, mtimeMs: T + 100, createdMs: T + 100 } }));
    assert.doesNotMatch(direct.factors[0].items.find((i) => /^Filen skapades i filsystemet/.test(i.text)).text, /iOS skriver/);
    const copy = core.build(input({ file: cameraFile({ addedMs: T + 400 * 86400 * S }), fileEntry: { name: 'x/IMG_2.HEIC', size: 1, mtimeMs: T, createdMs: T } }));
    assert.match(copy.factors[0].items.find((i) => /^Filen skapades i filsystemet/.test(i.text)).text, /kan behålla källans tid/);
});

test('en annan dag än T i bildens fasta zon visar zonen', () => {
    const fmt = (ms) => core.formatWithOffset(ms, 120);
    const at = core.stamper({ file: { createdMs: T }, format: fmt, fixedZone: 'GMT+0200' });
    assert.match(at(T + 86400 * 400 * S), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(GMT\+0200\)$/);
    assert.match(at(T + S), /^\d{2}:\d{2}:\d{2}$/);
    assert.doesNotMatch(core.stamper({ file: { createdMs: T }, format: fmt })(T + 86400 * 400 * S), /GMT/);
});

test('Raderade, redigering och flaggorna i klartext', () => {
    const m = core.build(input({ file: cameraFile({ trashed: 1, trashedAtMs: T + M, adjustedAtMs: T + 2 * M, editor: 'com.apple.mobileslideshow' }) }));
    const row = (id) => m.factors[0].times.find((r) => r.id === id);
    assert.deepStrictEqual([row('trashed').label, row('trashed').source.column, row('trashed').ms], ['Flyttad till Raderade', 'ZTRASHEDDATE', T + M]);
    assert.deepStrictEqual([row('adjusted').label, row('adjusted').source.column, row('adjusted').ms], ['Redigerad i biblioteket', 'ZADJUSTMENTTIMESTAMP', T + 2 * M]);
    assert.match(row('adjusted').note, /PhotoData\/Mutations/);
    assert.strictEqual(core.flagText(['trashed', 'edited']), 'i Raderade, redigerad');
});

test('positionen: bara i databasen, och en plats satt i Bilder väger inte', () => {
    const only = core.build(input());
    assert.match(only.factors.find((f) => f.id === 'position').items.map((i) => i.text).join(' '), /finns i bildbiblioteket men inte i filen/);
    const far = core.build(input({ fileEntry: { name: 'x/a.JPG', size: 1, mtimeMs: T, customLocation: true }, file: cameraFile({ latitude: 12.6, longitude: -8 }) }));
    const pos = far.factors.find((f) => f.id === 'position');
    assert.strictEqual(pos.state, 'info');
    assert.match(pos.items.map((i) => i.text).join(' '), /customLocation/);
    assert.match(pos.plain, /satt i efterhand/);
});

test('tänd skärm med låst telefon: aviseringar tänder skärmen', () => {
    const m = core.build(input({ lock: [{ startMs: T - 3 * M, endMs: T + 10 * M, locked: true, stream: '/device/isLocked', source: KC }] }));
    const f = m.factors.find((x) => x.id === 'screen');
    assert.match(f.items.map((i) => i.text).join(' '), /Aviseringar tänder skärmen/);
    assert.match(f.plain, /låst/);
});

test('en kamerafil i en chattapps tmp', () => {
    const t = core.classify({ importer: 'net.whatsapp.WhatsApp', chatTemp: { app: 'net.whatsapp.WhatsApp', appName: 'WhatsApp', path: 'tmp/documents/Camera/a.jpg' } }, 'iOS');
    assert.deepStrictEqual([t.type, t.label, t.importer], ['saved', 'WhatsApps tillfälliga fil', 'net.whatsapp.WhatsApp']);
    assert.strictEqual(core.hypothesis(t, () => null), 'att filen skapades med WhatsApp på den här telefonen');
});

// ---------- Filens tider och vad de betyder ----------

const timeFactor = (over) => core.build(input(over)).factors.find((f) => f.id === 'time');
const AIRDROP = { importedBy: 13, importer: 'com.apple.sharingd' };
const DUPLICATE = { importedBy: 8, importer: 'com.apple.mobileslideshow' };

test('AirDrop och dubblett: en sen Tillagd är vad man väntar sig, och sammanvägningen säger inte emot det', () => {
    const late = T + 410 * 86400 * S;
    const air = core.build(input({ file: cameraFile(Object.assign({}, AIRDROP, { addedMs: late, modifiedMs: late })) }));
    const f = air.factors[0];
    assert.strictEqual(air.type.label, 'Mottagen med AirDrop');
    assert.strictEqual(f.state, 'support');
    assert.strictEqual(f.verdict, 'Tiderna passar en mottagen fil');
    assert.match(f.meaning, /^Förenligt med att filen togs emot med AirDrop/);
    assert.match(f.items[0].text, /^Filen lades till i biblioteket 410 dygn 0 h efter Skapad, som väntat: en fil som tas emot med AirDrop behåller avsändarens tid\.$/);
    assert.match(f.plain, /som väntat för en fil som tas emot med AirDrop/);
    assert.doesNotMatch(air.summary, /inte förenligt/);
    assert.match(air.summary, /^Materialet är förenligt med att filen togs emot med AirDrop/);
    const dup = core.build(input({ file: cameraFile(Object.assign({}, DUPLICATE, { addedMs: late, modifiedMs: late })) }));
    assert.strictEqual(dup.factors[0].verdict, 'Tiderna passar en dubblett');
    assert.doesNotMatch(dup.summary, /inte förenligt/);
});

test('kamerabild och skärmdump: en sen Tillagd säger fortfarande emot hypotesen', () => {
    const late = T + 2 * 86400 * S;
    const cam = core.build(input({ file: cameraFile({ addedMs: late, modifiedMs: late }) }));
    assert.strictEqual(cam.factors[0].state, 'contradiction');
    assert.match(cam.summary, /^Materialet är inte förenligt med att bilden togs/);
    const shot = core.build(input({ file: cameraFile({ importedBy: 8, importer: 'com.apple.springboard', kindSubtype: 10, addedMs: late, modifiedMs: late }), exif: { read: true } }));
    assert.strictEqual(shot.factors[0].state, 'contradiction');
});

test('en tid som ändrats i Bilder: tiderna går isär, men det väger inte mot hypotesen, och biblioteket visar vilken som är ändrad', () => {
    const changed = T + 86360 * S;
    const f = timeFactor({ file: cameraFile(Object.assign({}, AIRDROP, { createdMs: changed, addedMs: T + 5 * M, modifiedMs: T + 5 * M, createdSource: 1 })) });
    assert.strictEqual(f.state, 'info');
    assert.strictEqual(f.verdict, 'Tiderna går isär');
    assert.match(f.meaning, /^Skillnaden väger inte mot att filen togs emot med AirDrop på den här telefonen, men den behöver förklaras\.$/);
    assert.match(f.items.find((i) => /^Tiden i filen/.test(i.text)).text, /ZEXIFTIMESTAMPSTRING\) är kvar på filens tid, så Skapad ser ut att ha ändrats i efterhand/);
    assert.match(f.plain, /^Tiderna går isär: tiden i filen ligger 23 h 59 min före Skapad, och Skapad ser ut att ha ändrats i efterhand\.$/);
    assert.match(f.times.find((r) => r.id === 'created').note, /ZDATECREATEDSOURCE 1 säger att tiden kom ur filen, men den är inte längre densamma/);
    const orig = f.times.find((r) => r.id === 'original');
    assert.deepStrictEqual([orig.label, orig.source.column], ['Originaltid i biblioteket', 'ZEXIFTIMESTAMPSTRING']);
    // Samma sak på en kamerabild.
    assert.strictEqual(timeFactor({ file: cameraFile({ createdMs: changed, addedMs: T + 300, createdSource: 1 }) }).state, 'info');
    // Står bibliotekets kopia inte kvar är förklaringen okänd: då säger tiden emot en kamerabild.
    const other = timeFactor({ file: cameraFile({ createdMs: changed, addedMs: T + 300, createdSource: 1, exifTime: '2025:09:25 14:30:29' }) });
    assert.strictEqual(other.state, 'contradiction');
    assert.match(other.items.find((i) => i.state === 'contradiction').text, /kan bero på att filen har redigerats/);
});

test('samma källa räknas inte två gånger: Skapad hämtad ur filen eller filsystemet är ingen bekräftelse', () => {
    const fromFile = timeFactor({ file: cameraFile({ createdSource: 1 }) });
    const info = fromFile.items.find((i) => /ZDATECREATEDSOURCE 1/.test(i.text));
    assert.strictEqual(info.state, 'info');
    assert.match(info.text, /visar bara att tiden inte har ändrats i biblioteket/);
    assert.ok(!fromFile.items.some((i) => /^Tiden i filen/.test(i.text) && i.state === 'support'));
    assert.match(fromFile.plain, /Skapandetiden är hämtad ur tiden i filen\.$/);
    assert.match(fromFile.times.find((r) => r.id === 'created').note, /^Hämtad ur tiden i filen \(ZDATECREATEDSOURCE 1\)\.$/);
    // Bara den jämförelsen: då är det en upplysning och inget stöd.
    const alone = timeFactor({ file: cameraFile({ createdSource: 1, addedMs: T + 10 * M }), fileEntry: null });
    assert.strictEqual(alone.state, 'info');
    // Inom en minut men mer än kopians marginal: tiden är ändrad.
    assert.strictEqual(timeFactor({ file: cameraFile({ createdSource: 1, createdMs: T + 39 * S, addedMs: T + 39 * S, exifTime: '2025:09:24 14:31:09' }) }).verdict, 'Tiderna går isär');

    const saved = { importedBy: 3, importer: 'org.whispersystems.signal', createdSource: 3, exifTime: null };
    const fromFs = timeFactor({ file: cameraFile(Object.assign({ addedMs: T + 4 * S }, saved)), exif: { read: true }, fileEntry: { name: 'x/IMG_5.JPG', size: 1, mtimeMs: T, createdMs: T - 300, timeField: 'UT-fältet' } });
    const fsItem = fromFs.items.find((i) => /ZDATECREATEDSOURCE 3/.test(i.text));
    assert.strictEqual(fsItem.state, 'info');
    assert.match(fsItem.text, /T säger alltså när filen skrevs till telefonen, inte när bilden togs/);
    assert.strictEqual(fromFs.state, 'support', 'Tillagd inom en minut är en egen källa');
    assert.match(fromFs.plain, /Filen har ingen egen tid, så det syns inte när bilden togs\.$/);
    // En mottagen fil har avsändarens tid: T säger inte heller när filen kom hit.
    const received = timeFactor({ file: cameraFile(Object.assign({}, AIRDROP, { createdSource: 3, addedMs: T + 40 * 86400 * S, exifTime: null })), exif: { read: true }, fileEntry: { name: 'x/IMG_6.AVIF', size: 1, mtimeMs: T, createdMs: T, timeField: 'UT-fältet' } });
    assert.match(received.items.find((i) => /ZDATECREATEDSOURCE 3/.test(i.text)).text, /T säger varken när bilden togs eller när filen kom till telefonen/);
    assert.strictEqual(received.verdict, 'Tiderna passar en mottagen fil');
    // Skiljer filsystemet sig från en tid som ska vara hämtad ur det är tiden ändrad.
    const moved = timeFactor({ file: cameraFile(Object.assign({ addedMs: T + 4 * S }, saved)), exif: { read: true }, fileEntry: { name: 'x/IMG_5.JPG', size: 1, mtimeMs: T - 9 * 3600 * S, createdMs: T - 9 * 3600 * S } });
    assert.strictEqual(moved.verdict, 'Tiderna går isär');
    assert.match(moved.plain, /så Skapad eller filen har ändrats i efterhand\.$/);
});

test('utan rad i biblioteket jämförs T inte med sig själv', () => {
    const none = { addedMs: null, modifiedMs: null, importedBy: null, importer: '', cameraMake: null, cameraModel: null };
    // T är tiden i filen: filsystemet är den enda andra källan.
    const taken = { read: true, takenMs: T, takenText: '2025-09-24 14:31:09.622 +02:00', sourceTag: 'Composite:SubSecDateTimeOriginal' };
    const fileSource = { db: 'bildfilen', table: 'a.jpg', column: 'Composite:SubSecDateTimeOriginal' };
    const noFs = core.build(input({ file: cameraFile(none), exif: taken, fileSource, fileEntry: null }));
    assert.strictEqual(noFs.factors[0].state, 'info');
    assert.strictEqual(noFs.factors[0].verdict, 'Kan inte jämföras');
    assert.match(noFs.factors[0].items[0].text, /^Filen har ingen rad i biblioteket, så T är tiden i filen \(Composite:SubSecDateTimeOriginal\)\.$/);
    assert.match(noFs.factors[0].plain, /inga andra tider/);
    assert.ok(!noFs.factors[0].items.some((i) => /^Tiden i filen/.test(i.text)), 'tiden jämförs inte med sig själv');
    assert.ok(!noFs.events.some((e) => e.kind === 'exif'));
    assert.strictEqual(noFs.events.find((e) => e.kind === 'file-created').text, 'Tiden i filen (Composite:SubSecDateTimeOriginal)');
    const withFs = core.build(input({ file: cameraFile(none), exif: taken, fileSource, fileEntry: { name: 'x', size: 1, mtimeMs: T, createdMs: T + 400, timeField: 'UT-fältet' } }));
    assert.strictEqual(withFs.factors[0].state, 'support');
    assert.strictEqual(withFs.factors[0].items.find((i) => /^Filen skapades/.test(i.text)).text, 'Filen skapades i filsystemet samma sekund som tiden i filen.');
    assert.match(withFs.factors[0].plain, /tiden inuti filen stämmer med filsystemets tid/);
    assert.strictEqual(withFs.factors[0].times.find((r) => r.isT).id, 'file-time');
    // T är ändringstiden: bara filsystemets egna tider finns, och de säger inget mer.
    const fs = core.build(input({ file: cameraFile(none), exif: { read: true }, fileSource: { db: 'zippen', table: 'x', column: 'ändringstid' }, fileEntry: { name: 'x', size: 1, mtimeMs: T, createdMs: T, changedMs: T + 1000, timeField: 'UT-fältet' } }));
    assert.strictEqual(fs.factors[0].state, 'info');
    assert.strictEqual(fs.factors[0].verdict, 'Kan inte jämföras');
    assert.match(fs.factors[0].plain, /bara filsystemets tider/);
    assert.strictEqual(fs.factors[0].times.find((r) => r.isT).id, 'fs-modified');
    assert.strictEqual(fs.events.find((e) => e.kind === 'file-created').text, 'Ändrad i filsystemet (ändringstid)');
    assert.ok(!fs.events.some((e) => e.kind === 'fs-mtime'));
    // Ingen faktor stöder att en okänd fil är en kamerabild.
    assert.strictEqual(fs.type.type, 'unknown');
    assert.doesNotMatch(fs.summary, /kamera/);
    assert.match(fs.summary, /att filen kom till på den här telefonen/);
});

test('video: QuickTime har hela sekunder, så en liten skillnad mot Skapad är ingen ändring', () => {
    const exif = { read: true, takenMs: T + 30 * S, takenText: '2025-09-24 12:31:39 UTC', sourceTag: 'QuickTime:CreateDate' };
    const near = timeFactor({ file: cameraFile({ createdSource: 1 }), exif });
    assert.strictEqual(near.state, 'support');
    assert.ok(near.items.some((i) => /ZDATECREATEDSOURCE 1/.test(i.text)));
    // Samma skillnad i EXIF är en ändring.
    assert.strictEqual(timeFactor({ file: cameraFile({ createdSource: 1, exifTime: null }), exif: Object.assign({}, exif, { sourceTag: 'ExifIFD:DateTimeOriginal' }) }).state, 'contradiction');
});

test('en tid utan zon: en skillnad jämnt på timmen ser ut som en tidszon, inte som en ändring', () => {
    const shot = { importedBy: 8, importer: 'com.apple.springboard', kindSubtype: 10 };
    const exif = { read: true, takenMs: T + 2 * 3600 * S, takenText: '2025-09-24 14:31:09 (zon antagen: UTC)', sourceTag: 'ExifIFD:DateTimeOriginal', zoneAssumed: true };
    const f = timeFactor({ file: cameraFile(shot), exif });
    assert.strictEqual(f.state, 'support');
    const item = f.items.find((i) => /^Tiden i filen/.test(i.text));
    assert.strictEqual(item.state, 'info');
    assert.match(item.text, /2 h 0 min efter Skapad, jämnt på kvarten\. Filen anger ingen tidszon/);
    // Med en zon i filen är samma skillnad en riktig skillnad.
    assert.strictEqual(timeFactor({ file: cameraFile(shot), exif: Object.assign({}, exif, { zoneAssumed: false }) }).state, 'contradiction');
    // Inte jämnt på kvarten: inte en zon.
    assert.strictEqual(timeFactor({ file: cameraFile(shot), exif: Object.assign({}, exif, { takenMs: T + 2 * 3600 * S + 7 * M }) }).state, 'contradiction');
});

test('tabellen: tidsordning, T markerad, källor och bara det som säger något', () => {
    const file = cameraFile({ createdMs: T, addedMs: T + 337, modifiedMs: T + 5 * M, createdSource: 1, exifTime: '2025:09:24 14:31:09' });
    const exif = {
        read: true, takenMs: T, takenText: '2025-09-24 14:31:09.622 +02:00', sourceTag: 'Composite:SubSecDateTimeOriginal',
        times: [
            { label: 'Tagen enligt EXIF', text: '2025-09-24 14:31:09.622 +02:00', source: 'Composite:SubSecDateTimeOriginal', ms: T, primary: true },
            { label: 'Digitaliserad enligt EXIF', text: '2025-09-24 14:31:09 +02:00', source: 'ExifIFD:CreateDate', ms: T - 622 },
            { label: 'Ändrad enligt EXIF', text: '2025-09-24 16:00:00', source: 'IFD0:ModifyDate', ms: T + 3600 * S, assumed: true, zoneLabel: 'bildens zon' },
        ],
    };
    const fe = { name: 'x/IMG_0042.HEIC', size: 1, mtimeMs: Math.floor(T / 1000) * 1000 + 9000, createdMs: Math.floor(T / 1000) * 1000 + 9000, changedMs: T + 86400 * S, accessedMs: T + 2 * 86400 * S, timeField: 'UT-fältet' };
    const rows = timeFactor({ file, exif, fileEntry: fe }).times;
    assert.deepStrictEqual(rows.map((r) => r.id), ['file-time', 'created', 'added', 'fs-created', 'fs-modified', 'modified', 'file-IFD0:ModifyDate', 'fs-changed', 'fs-accessed']);
    assert.deepStrictEqual(rows.filter((r) => r.isT).map((r) => r.id), ['created']);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.strictEqual(by.created.gap, 'T');
    assert.strictEqual(by['file-time'].gap, '0 s');
    assert.strictEqual(by.added.gap, '+0,3 s');
    assert.strictEqual(by['fs-created'].gap, '+8 s', 'hela sekunder i filsystemet: inga tiondelar');
    assert.strictEqual(by.modified.gap, '+5 min 0 s');
    // Inom samma sekund ligger filen före biblioteket, och hela sekunder hamnar inte före tiondelar.
    assert.deepStrictEqual(core.build(input({ file: cameraFile({ createdMs: 5000533, addedMs: 5000900 }), exif: { read: true, takenMs: 5000533, takenText: 'x', sourceTag: 'ExifIFD:DateTimeOriginal' }, fileEntry: { name: 'x', size: 1, mtimeMs: 5000000, createdMs: 5000000 } })).factors[0].times.slice(0, 5).map((r) => r.id), ['file-time', 'created', 'added', 'fs-created', 'fs-modified']);
    assert.strictEqual(by.created.label, 'Skapad enligt biblioteket');
    assert.deepStrictEqual(by.created.source, { db: 'Photos.sqlite', table: 'ZASSET', column: 'ZDATECREATED', queryId: 'role-file' });
    assert.deepStrictEqual(by.added.source, { db: 'Photos.sqlite', table: 'ZASSET', column: 'ZADDEDDATE', queryId: 'role-file' });
    assert.deepStrictEqual(by['file-time'].source, { db: 'Filen', column: 'Composite:SubSecDateTimeOriginal' });
    assert.strictEqual(by['file-time'].note, 'I filen: 2025-09-24 14:31:09.622 +02:00.');
    assert.match(by['file-IFD0:ModifyDate'].note, /Filen anger ingen tidszon, så tiden är tolkad i bildens zon\./);
    assert.match(by.modified.note, /filer som ingen har rört/);
    assert.deepStrictEqual(by['fs-accessed'].source, { db: 'Zippen', table: 'UT-fältet', column: 'andra tiden' });
    assert.ok(!rows.some((r) => r.id === 'original'), 'originaltiden visas bara när den skiljer sig');
});

test('tabellen: det som saknas står kvar, och skärmdump, video, Android och DOS-tid får rätt ord', () => {
    const noTime = timeFactor({ exif: { read: true }, fileEntry: null }).times;
    assert.deepStrictEqual(noTime.filter((r) => r.absent).map((r) => [r.label, r.absent]), [['Tid i filen', 'Filen har ingen egen tid.'], ['Filsystemets tider', 'Filen hittades inte i zippen.']]);
    const unread = timeFactor({ exif: { read: false }, fileMissingReason: 'filen är för stor', fileEntry: null }).times;
    assert.strictEqual(unread.find((r) => r.id === 'file-time').absent, 'Filen lästes inte: filen är för stor.');
    // QuickTime säger inte EXIF.
    const video = timeFactor({ exif: { read: true, takenMs: T, takenText: '2025-09-24 12:31:09 UTC', sourceTag: 'QuickTime:CreateDate' } });
    assert.strictEqual(video.times.find((r) => r.id === 'file-time').label, 'Skapad enligt QuickTime');
    assert.ok(video.items.some((i) => /^Tiden i filen \(QuickTime\) är 2025-09-24 12:31:09 UTC: /.test(i.text)));
    // Android.
    const android = core.build(input({ platform: 'Android', file: cameraFile({ relativePath: 'DCIM/Camera/', addedMs: T + 2 * S, modifiedMs: T + 2 * S }), fileSource: { db: 'external.db', table: 'files', column: 'datetaken' } })).factors[0].times;
    assert.strictEqual(android.find((r) => r.id === 'created').label, 'Tagen enligt MediaStore');
    assert.deepStrictEqual([android.find((r) => r.id === 'added').label, android.find((r) => r.id === 'added').source.column], ['Lades till i galleriet', 'date_added']);
    assert.deepStrictEqual([android.find((r) => r.id === 'modified').label, android.find((r) => r.id === 'modified').source.column], ['Ändrad i galleriet', 'date_modified']);
    // Bara DOS-tid: ingen zon, så ingen tid att räkna med.
    const dos = timeFactor({ fileEntry: { name: 'x', size: 1, mtimeMs: null, mtimeText: '2025-09-24 14:31:09 (zon okänd)' } }).times.find((r) => r.id === 'fs-modified');
    assert.deepStrictEqual([dos.ms, dos.text, dos.source.column], [null, '2025-09-24 14:31:09 (zon okänd)', 'DOS-tid']);
    // Utanför biblioteket.
    const out = timeFactor({ file: cameraFile({ addedMs: null, modifiedMs: null, importedBy: null, importer: '' }), fileSource: { db: 'zippen', table: 'x', column: 'ändringstid' }, fileEntry: { name: 'x', size: 1, mtimeMs: T } }).times;
    assert.strictEqual(out.find((r) => r.id === 'library').absent, 'Filen har ingen rad där.');
});

test('skillnaden mot T i tabellen', () => {
    assert.strictEqual(core.gapText(0, false), '0 s');
    assert.strictEqual(core.gapText(400, false), 'samma sekund');
    assert.strictEqual(core.gapText(-125, true), '−0,1 s');
    assert.strictEqual(core.gapText(2, true), '+0,002 s');
    assert.strictEqual(core.gapText(9467, false), '+9 s');
    assert.strictEqual(core.gapText(-86360177, false), '−23 h 59 min');
    assert.strictEqual(core.gapText(439 * 86400000, false), '+439 dygn 0 h');
});
