// PowerLog i Härkomst (iOS): övergångarna blir intervall för skärmen, låset, appen på skärmen och kameran
// per app, glapp bryter dem, och faktorerna säger var uppgiften kommer ifrån. Tiderna efterliknar
// labbsessionen (iOS 26.4.1, 2026-11-03); appnamnen är riktiga bundle-id, inga personer.

const test = require('node:test');
const assert = require('node:assert');
const pl = require('./powerlog');
const core = require('./timeline-core');

const T0 = Date.parse('2026-11-03T11:15:00Z');
const at = (sec) => T0 + Math.round(sec * 1000);
const WA = 'net.whatsapp.WhatsApp';
const TG = 'ph.telegra.Telegraph';

test('övergångar blir intervall som slutar vid nästa läge, vid ett glapp och vid täckningens slut', () => {
    const rows = [{ ms: at(0), value: true }, { ms: at(10), value: true }, { ms: at(20), value: false }, { ms: at(30), value: true }];
    assert.deepStrictEqual(pl.intervals(rows, [], at(100)), [
        { startMs: at(0), endMs: at(20), value: true }, { startMs: at(20), endMs: at(30), value: false }, { startMs: at(30), endMs: at(100), value: true }]);
    // Ett glapp (telefonen avstängd) avslutar läget; efter glappet är det okänt till nästa övergång.
    const gaps = [{ startMs: at(35), endMs: at(5000) }];
    assert.deepStrictEqual(pl.intervals(rows.concat([{ ms: at(6000), value: true }]), gaps, at(7000)).map((iv) => [iv.startMs - T0, iv.endMs - T0, iv.value]), [
        [0, 20000, true], [20000, 30000, false], [30000, 35000, true], [6000000, 7000000, true]]);
    // value null (ingen app) avslutar utan att bli ett intervall.
    assert.deepStrictEqual(pl.intervals([{ ms: at(0), value: 'a' }, { ms: at(5), value: null }, { ms: at(9), value: 'b' }], [], at(12)).map((iv) => iv.value), ['a', 'b']);
});

test('skärmen, låset och appen på skärmen', () => {
    const scr = pl.screen([{ timeMs: at(0), active: 1 }, { timeMs: at(60), active: 0 }], [], at(120));
    assert.deepStrictEqual(scr.map((iv) => [iv.on, (iv.endMs - iv.startMs) / 1000]), [[true, 60], [false, 60]]);
    assert.deepStrictEqual(pl.lock([{ timeMs: at(-10), locked: 0 }], [], at(5)).map((iv) => iv.locked), [false]);
    // Hemskärmen och appväxlaren är ingen app; Face ID ovanpå avslutar inte appen; låsskärmen och en
    // släckt skärm gör det.
    const apps = pl.apps([
        { timeMs: at(0), role: 1, bundle: WA },
        { timeMs: at(5), role: 4, bundle: 'com.apple.LocalAuthenticationUIService' },
        { timeMs: at(10), role: 1, bundle: 'com.apple.springboard.home-screen' },
        { timeMs: at(12), role: 1, bundle: TG },
        { timeMs: at(30), role: 3, bundle: pl.LOCK_SCREEN },
        { timeMs: at(40), role: 1, bundle: 'com.apple.camera' },
    ], [], at(100), [at(50)]);
    assert.deepStrictEqual(apps.map((iv) => [iv.app, (iv.startMs - T0) / 1000, (iv.endMs - T0) / 1000]), [[WA, 0, 10], [TG, 12, 30], ['com.apple.camera', 40, 50]]);
});

test('kameran per app: en session per app, fram- och bakkamera tillsammans, och utan stängning', () => {
    const rows = [
        { timeMs: at(0), app: WA, type: 0, state: 1 }, { timeMs: at(0.3), app: WA, type: 4, state: 1 },
        { timeMs: at(1.9), app: null, type: 4, state: 0 }, { timeMs: at(2.1), app: null, type: 0, state: 0 },
        { timeMs: at(3), app: WA, type: 2, state: 1 }, { timeMs: at(6), app: null, type: 2, state: 0 },
        { timeMs: at(60), app: TG, type: 0, state: 1 },
    ];
    const s = pl.camera(rows, [{ startMs: at(90), endMs: at(9000) }]);
    assert.deepStrictEqual(s.map((c) => [c.app, (c.startMs - T0) / 1000, c.endMs == null ? null : (c.endMs - T0) / 1000, c.sessions]), [
        [WA, 0, 6, 3], [TG, 60, 90, 1]]);
    assert.strictEqual(pl.camera([{ timeMs: at(0), app: TG, type: 0, state: 1 }], [])[0].endMs, null, 'utan stängning och utan glapp är slutet okänt');
});

const fmt = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const NAMES_MAP = { [WA]: 'WhatsApp', [TG]: 'Telegram', 'com.apple.camera': 'Kamera' };
const NAMES = (id) => NAMES_MAP[id] || id;
const base = (T, extra) => Object.assign({ platform: 'iOS', file: { createdMs: T, filename: 'IMG_0031.JPG', importer: WA, importedBy: 3 }, format: fmt, appNames: NAMES,
    appIntervals: [{ startMs: at(-60), endMs: at(60), app: WA, stream: '/app/usage' }], screen: [], lock: [], cameraUse: [], coverage: {}, missingDbs: {} }, extra);

test('kamerafaktorn: appens egen kamera enligt PowerLog, och en session strax efter T räknas inte', () => {
    const cam = [{ startMs: at(0.056), endMs: at(2.141), app: WA, stream: 'PowerLog' }];
    const yes = core.build(base(at(1.429), { cameraUse: cam })).factors.find((f) => f.id === 'camera');
    assert.deepStrictEqual([yes.state, yes.title], ['support', 'Kamera igång']);
    assert.match(yes.items[0].text, /^WhatsApp använde kameran .* enligt PowerLog \(PLCameraAgent\), vilket täcker tidpunkten\.$/);
    // Bilden skapades 3,8 s efter en session och 3 s före nästa: inte igång vid T, men strax före (texten avrundar).
    const two = [{ startMs: at(34.48), endMs: at(36.24), app: TG, stream: 'PowerLog' }, { startMs: at(43.04), endMs: at(44.7), app: TG, stream: 'PowerLog' }];
    const tg = core.build(base(at(40.02), { file: { createdMs: at(40.02), filename: 'IMG_0034.JPG', importer: TG, importedBy: 3 }, cameraUse: two, appIntervals: [{ startMs: at(-60), endMs: at(60), app: TG, stream: '/app/usage' }] }))
        .factors.find((f) => f.id === 'camera');
    assert.strictEqual(tg.state, 'info');
    assert.match(tg.items[0].text, /Telegram använde kameran .*11:15:34 UTC till .*11:15:36 UTC enligt PowerLog \(PLCameraAgent\), 4 s före tidpunkten\./);
    // Telegrams kamerabild: PowerLogs session och filen i tmp/ i samma faktor.
    const link = { camera: { name: 'camphoto_1.jpg', video: false, path: 'tmp/camphoto_1.jpg', same: true }, matches: [], picks: [], nearby: [] };
    const both = core.build(base(at(3.4), { file: { createdMs: at(3.4), filename: 'IMG_0035.JPG', importer: TG, importedBy: 3 }, telegram: { link }, cameraUse: [{ startMs: at(-4), endMs: at(4.3), app: TG, stream: 'PowerLog' }] }))
        .factors.find((f) => f.id === 'camera');
    assert.deepStrictEqual([both.title, both.state, both.items.length], ['Telegrams kamera', 'support', 2]);
    assert.match(both.items[0].text, /enligt PowerLog/);
});

test('skärmfaktorn: två källor som säger samma sak, olika, och PowerLogs glapp när inget finns', () => {
    const on = (stream, a, b, v) => ({ startMs: at(a), endMs: at(b), on: v, stream });
    const same = core.build(base(at(1), { screen: [on('/display/isBacklit', -30, 30, true), on('PowerLog', -20, 40, true)] })).factors.find((f) => f.id === 'screen');
    assert.deepStrictEqual([same.state, same.items[0].text], ['support', 'Skärmen var tänd vid tidpunkten (/display/isBacklit, PowerLog).']);
    const mixed = core.build(base(at(1), { screen: [on('/display/isBacklit', -30, 30, true), on('PowerLog', -20, 40, false)] })).factors.find((f) => f.id === 'screen');
    assert.strictEqual(mixed.state, 'info');
    assert.match(mixed.items[0].text, /tänd enligt \/display\/isBacklit, släckt enligt PowerLog/);
    // En övergång nära T i samma källa är inte två källor som säger olika: tänd inom marginalen räknas.
    const edge = core.build(base(at(1), { screen: [on('PowerLog', -30, 3, false), on('PowerLog', 3, 40, true)], lock: [{ startMs: at(-30), endMs: at(-1), locked: true, stream: 'PowerLog' }, { startMs: at(-1), endMs: at(40), locked: false, stream: 'PowerLog' }] }))
        .factors.find((f) => f.id === 'screen');
    assert.deepStrictEqual([edge.state, edge.items[0].text], ['support', 'Skärmen var tänd vid tidpunkten (PowerLog).']);
    assert.match(edge.items[1].text, /^Telefonen var olåst vid tidpunkten \(PowerLog\)\./);
    const gap = { firstMs: at(-86400), lastMs: at(86400), rows: 10, gaps: [{ startMs: at(-3600), endMs: at(3600) }] };
    const none = core.build(base(at(1), { coverage: { PowerLog: gap }, appIntervals: [] })).factors.find((f) => f.id === 'screen');
    assert.strictEqual(none.state, 'missing');
    assert.match(none.items[0].text, /PowerLog har ett glapp från .* till .*: telefonen var avstängd eller PowerLog skrev inte\.$/);
});
