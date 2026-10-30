// Tidslinjen: välformad SVG med fem rader, T-strecket, intervall och markörer, närbildens ruta
// i översikten och utskrivna händelser i närbilden. Skärm och lås blir ett band.

const test = require('node:test');
const assert = require('node:assert');
const core = require('./timeline-core');
const tl = require('./timeline-svg');

const T = Date.UTC(2025, 8, 24, 12, 31, 9);
const S = 1000;
const fmt = (ms) => core.formatWithOffset(ms, 120);
const names = (id) => (id === 'com.apple.camera' ? 'Kamera' : id === 'com.toyopagroup.picaboo' ? 'Snapchat' : id);

function model(over) {
    return core.build(Object.assign({
        platform: 'iOS', appNames: names, cameraApps: ['com.apple.camera'],
        file: { pk: 1, filename: 'IMG_0042.HEIC', createdMs: T, addedMs: T + 300, importedBy: 1, importer: 'com.apple.camera' },
        appIntervals: [{ startMs: T - 20 * S, endMs: T + 12 * S, app: 'com.apple.camera', stream: '/app/usage' }, { startMs: T + 60 * S, endMs: T + 120 * S, app: 'com.apple.Preferences', stream: '/app/usage' }],
        screen: [{ startMs: T - 60 * S, endMs: T + 180 * S, on: true, stream: '/display/isBacklit' }],
        lock: [{ startMs: T - 60 * S, endMs: T + 30 * S, locked: false, stream: '/device/isLocked' }, { startMs: T + 30 * S, endMs: T + 180 * S, locked: true, stream: '/device/isLocked' }],
        locations: [{ ms: T + 5 * S, lat: 59.3, lon: 18.1, accuracy: 10, type: 1 }],
        neighbours: [{ pk: 2, filename: 'IMG_0043.HEIC', createdMs: T + 2 * S, importedBy: 1 }],
        exif: { read: true, takenMs: T, takenText: 'x' },
    }, over || {}));
}

const text = (out) => out.replace(/<[^>]*>/g, ' ');

test('översikten har fem rader, T, kamerans intervall, filens markör och närbildens ruta', () => {
    const m = model();
    const out = tl.svg(m, { width: 900, format: fmt, zoom: m.windows[0].closeup, appName: names, footer: 'Forensics Toolbox 1.29' });
    assert.match(out, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="900"/);
    for (const needle of ['>Fil<', '>Appar<', '>Telefon<', '>Position<', 'stroke-dasharray="4 3"', 'T 14:31:09', '<polygon', 'fill="' + tl.COLORS.camera + '"', 'fill="' + tl.COLORS.app + '"',
        'fill="' + tl.COLORS.on + '"', '<circle', 'Forensics Toolbox 1.29', '14:20', '14:45', 'fill-opacity="0.10"', '<title>Närbild 14:29:39 till 14:32:39</title>', '>Närbild<']) {
        assert.ok(out.includes(needle), 'saknar ' + needle);
    }
    for (const gone of ['Lås', 'Skärm', 'Kamera', 'App igång', 'Snapchat']) assert.ok(!out.includes('text-anchor="end">' + gone + '<'), gone + ' ska inte vara en egen rad');
    assert.strictEqual((out.match(/<svg/g) || []).length, 1);
    assert.strictEqual((out.match(/<\/svg>/g) || []).length, 1);
    assert.ok(!/[<>&]/.test(out.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot);/g, '')), 'oescapad text');
});

test('skärm och lås blir ett band med tillståndet i klartext', () => {
    const m = model();
    const w = m.windows[0];
    const segs = tl.phoneSegments(m.events, w);
    assert.deepStrictEqual(segs.map((s) => [s.label, fmt(s.startMs).slice(11), fmt(s.endMs).slice(11)]), [['tänd, olåst', '14:30:09', '14:31:39'], ['tänd, låst', '14:31:39', '14:34:09']]);
    assert.strictEqual(segs[0].fromMs, T - 60 * S);
    const onlyScreen = tl.phoneSegments(m.events.filter((e) => e.kind !== 'lock'), w);
    assert.deepStrictEqual(onlyScreen.map((s) => s.label), ['tänd']);
    assert.deepStrictEqual(tl.phoneSegments(m.events.filter((e) => e.kind !== 'lock' && e.kind !== 'screen'), w), []);
    const out = tl.svg(m, { width: 900, format: fmt, appName: names });
    assert.ok(out.includes('fill="' + tl.COLORS.onLocked + '"'));
    assert.ok(!out.includes('>tänd, olåst<'), 'för smalt för text i översikten: 90 s av 30 min');
    const near = tl.svg(m, { window: w.closeup, labels: true, width: 1100, format: fmt, appName: names });
    assert.ok(near.includes('>tänd, olåst<') && near.includes('>tänd, låst<'), 'i närbilden får bandet sin text');
    const earlier = model({ screen: [{ startMs: T - 10 * 60 * S, endMs: T + 180 * S, on: true, stream: '/display/isBacklit' }], lock: [{ startMs: T - 10 * 60 * S, endMs: T + 180 * S, locked: false, stream: '/device/isLocked' }] });
    const since = tl.svg(earlier, { window: earlier.windows[0].closeup, labels: true, width: 1100, format: fmt, appName: names });
    assert.ok(since.includes('>tänd, olåst sedan 14:21:09<'), 'började bandet före närbilden står det sedan när');
});

test('närbilden skriver ut händelserna med klockslag och slår ihop filens tidpunkter', () => {
    const m = model();
    const c = m.windows[0].closeup;
    const out = tl.svg(m, { window: c, labels: true, width: 1100, format: fmt, appName: names, title: 'Närbild' });
    for (const needle of ['IMG_0042.HEIC skapas · EXIF i filen', '>14:31:09<', 'Kamera 14:30:49 → 14:31:21', 'IMG_0043.HEIC', 'Position ±10 m', '>tänd, olåst<', '14:31:00<', '14:31:30<']) {
        assert.ok(out.includes(needle), 'närbilden saknar ' + needle);
    }
    assert.strictEqual((out.match(/IMG_0042\.HEIC skapas/g) || []).length, 1, 'filens tidpunkter ska bli en text');
    assert.ok(out.includes('font-weight="bold">IMG_0042.HEIC skapas'));
    assert.ok(!out.includes('fill-opacity="0.10"'), 'ingen närbildsruta i närbilden själv');
});

test('korta texter per händelsetyp', () => {
    const m = model();
    const sl = (e) => tl.shortLabel(e, m, names);
    assert.strictEqual(sl({ kind: 'file-created' }), 'IMG_0042.HEIC skapas');
    assert.strictEqual(sl({ kind: 'neighbour', text: 'Granne: IMG_0043.HEIC (com.apple.camera)' }), 'IMG_0043.HEIC');
    assert.strictEqual(sl({ kind: 'snap-message', own: false, plain: 'En snap eller bild skickas till den här telefonen i Snapchat från @erik.lind' }), 'Snap från @erik.lind');
    assert.strictEqual(sl({ kind: 'snap-message', own: true, plain: 'En snap eller bild skickas till @erik.lind från den här telefonen' }), 'Snap till @erik.lind');
    assert.strictEqual(sl({ kind: 'snap-read', own: true, plain: 'Mottagaren öppnar den' }), 'Mottagaren öppnar den');
    assert.strictEqual(sl({ kind: 'snap-message', own: true, plain: null }), null, 'meddelandet som cacheraden redan berättar om får ingen egen text');
    assert.strictEqual(sl({ kind: 'snap-cache', context: 3, sent: true, plain: null }), null);
    assert.strictEqual(sl({ kind: 'snap-cache', context: 34, isFile: true }), 'Den bedömda filen spelas in');
    assert.strictEqual(sl({ kind: 'snap-cache', context: 3, sent: true, plain: 'En snap eller bild skickas till @erik.lind från den här telefonen' }), 'Snap till @erik.lind');
    assert.strictEqual(sl({ kind: 'snap-cache', context: 7, plain: null }), null);
    assert.strictEqual(sl({ kind: 'location', ms: T + 5 * S, accuracy: 10 }), 'Position ±10 m');
    assert.strictEqual(sl({ kind: 'screen' }), null);
});

test('tidsstegen ger 4–8 markeringar, även för närbilden', () => {
    assert.strictEqual(tl.tickStep(30 * 60000), 300000);
    assert.strictEqual(tl.tickStep(10 * 60000), 120000);
    assert.strictEqual(tl.tickStep(180 * 1000), 30000);
    assert.strictEqual(tl.tickStep(60 * 1000), 10000);
    assert.strictEqual(tl.tickStep(48 * 3600000), 21600000);
});

test('närbildens texter överlappar inte, med testdatat för kamera och Snapchat', () => {
    const sample = require('./sample-data');
    const snapchat = require('./snapchat');
    const copies = require('./copies');
    const NAMES = { 'com.apple.camera': 'Kamera', 'com.toyopagroup.picaboo': 'Snapchat', 'com.apple.mobileslideshow': 'Bilder', 'com.apple.springboard': 'Hemskärmen' };
    for (const s of [sample.scenario({ snapchat, copies }), sample.snapchatScenario({ snapchat, copies })]) {
        const m = core.build(Object.assign({}, s, { appNames: (id) => NAMES[id] || null, cameraApps: ['com.apple.camera'], windowMs: 15 * 60000, format: fmt }));
        const out = tl.svg(m, { window: m.windows[0].closeup, labels: true, width: 1100, format: fmt, appName: (id) => NAMES[id] || id });
        // Texterna med klockslag är händelsetexterna. Bredden uppskattas som i koden (5,9 px per tecken).
        const re = /<text x="([\d.]+)" y="([\d.]+)"[^>]*?(text-anchor="end")?[^>]*>(<tspan[^>]*>.*?<\/tspan> <tspan[^>]*>\d\d:\d\d:\d\d<\/tspan>)<\/text>/g;
        const rows = {};
        let mm;
        while ((mm = re.exec(out))) {
            const txt = mm[4].replace(/<[^>]+>/g, '');
            const w = txt.length * 5.9;
            const x = Number(mm[1]);
            const box = mm[3] ? [x - w, x] : [x, x + w];
            (rows[mm[2]] = rows[mm[2]] || []).push({ txt, box });
        }
        assert.ok(Object.keys(rows).length >= 3, 'för få textrader: ' + Object.keys(rows).join(','));
        for (const y of Object.keys(rows)) {
            const list = rows[y].sort((a, b) => a.box[0] - b.box[0]);
            for (let i = 1; i < list.length; i++) assert.ok(list[i].box[0] >= list[i - 1].box[1] - 1, 'överlapp på y=' + y + ': "' + list[i - 1].txt + '" och "' + list[i].txt + '"');
        }
        assert.ok(out.includes(m.type.type === 'snapchat' ? 'Den bedömda filen spelas in' : m.file.filename + ' skapas'), 'filens text saknas');
    }
});
