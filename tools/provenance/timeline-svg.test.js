// Tidslinjen: välformad SVG med en rad per jämförelse, band i radens färg för på och grått för av,
// T som kolumn med en prick per rad, kolumnen "Vid T" med faktorns ord, närbildens ruta i
// översikten och utskrivna händelser i närbilden.

const test = require('node:test');
const assert = require('node:assert');
const core = require('./timeline-core');
const tl = require('./timeline-svg');

const T = Date.UTC(2025, 8, 24, 12, 31, 9);
const S = 1000;
const fmt = (ms) => core.formatWithOffset(ms, 120);
const names = (id) => (id === 'com.apple.camera' ? 'Kamera' : id === 'com.toyopagroup.picaboo' ? 'Snapchat' : id === 'com.apple.Preferences' ? 'Inställningar' : id);

function model(over) {
    return core.build(Object.assign({
        platform: 'iOS', appNames: names, cameraApps: ['com.apple.camera'], fileSource: { db: 'Photos.sqlite', table: 'ZASSET', column: 'ZDATECREATED', queryId: 'role-file' },
        file: { pk: 1, filename: 'IMG_0042.HEIC', createdMs: T, addedMs: T + 300, importedBy: 1, importer: 'com.apple.camera', latitude: 59.33255, longitude: 18.064 },
        appIntervals: [{ startMs: T - 20 * S, endMs: T + 12 * S, app: 'com.apple.camera', stream: '/app/usage' }, { startMs: T + 60 * S, endMs: T + 120 * S, app: 'com.apple.Preferences', stream: '/app/usage' }],
        screen: [{ startMs: T - 60 * S, endMs: T + 180 * S, on: true, stream: '/display/isBacklit' }],
        lock: [{ startMs: T - 60 * S, endMs: T + 30 * S, locked: false, stream: '/device/isLocked' }, { startMs: T + 30 * S, endMs: T + 180 * S, locked: true, stream: '/device/isLocked' }],
        locations: [{ ms: T + 5 * S, lat: 59.33258, lon: 18.06398, accuracy: 10, type: 1 }],
        neighbours: [{ pk: 2, filename: 'IMG_0043.HEIC', createdMs: T + 2 * S, importedBy: 1 }],
        exif: { read: true, takenMs: T, takenText: 'x' },
    }, over || {}));
}

const rowLabels = (out) => [...out.matchAll(/text-anchor="end"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const ctxFor = (m) => ({ model: m, T: m.windows[0].centerMs, fmt, appName: names, positions: m.positions });

test('översikten har en rad per jämförelse, T-kolumnen, banden i radens färg och kolumnen Vid T', () => {
    const m = model();
    const out = tl.svg(m, { width: 1100, format: fmt, zoom: m.windows[0].closeup, appName: names, footer: 'Forensics Toolbox 1.30' });
    assert.match(out, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1100"/);
    assert.deepStrictEqual(rowLabels(out), ['Fil', 'App', 'Kamera', 'Skärm', 'Lås', 'Position']);
    for (const needle of ['stroke-dasharray="4 3"', 'T 14:31:09', 'Vid T · 14:31:09', '<polygon', 'fill="' + tl.COLORS.camera + '"', 'fill="' + tl.COLORS.phone + '"', 'fill="' + tl.COLORS.off + '"',
        'fill-opacity="0.09"', '<circle', 'Forensics Toolbox 1.30', '14:20', '14:45', 'fill-opacity="0.10"', '<title>Närbild 14:29:39 till 14:32:39</title>', '>Närbild<', '>Stöd<', '>Kamera i förgrunden<', '>tänd<', '>olåst<']) {
        assert.ok(out.includes(needle), 'saknar ' + needle);
    }
    assert.ok(!out.includes('>Snapchat<'), 'ingen Snapchat-rad utan Snapchat-händelser');
    assert.strictEqual((out.match(/<svg/g) || []).length, 1);
    assert.strictEqual((out.match(/<\/svg>/g) || []).length, 1);
    assert.ok(!/[<>&]/.test(out.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot);/g, '')), 'oescapad text');
    // Utan kolumnen blir bilden bara diagrammet.
    const bare = tl.svg(m, { width: 900, format: fmt, appName: names, column: false });
    assert.ok(!bare.includes('Vid T'));
});

test('raderna följer faktorerna: skärmdump utan kamera-rad, Snapchat-rad när händelser finns, inga låsdata ger ingen Lås-rad', () => {
    const m = model();
    assert.deepStrictEqual(tl.rowsFor(m).map((r) => r.id), ['file', 'app', 'camera', 'screen', 'lock', 'location']);
    assert.strictEqual(tl.rowsFor(m).find((r) => r.id === 'camera').factor.id, 'camera');
    assert.strictEqual(tl.rowsFor(m).find((r) => r.id === 'lock').factor, null);
    const noLock = model({ lock: [] });
    assert.ok(!tl.rowsFor(noLock).some((r) => r.id === 'lock'));
    const snap = model({ extraEvents: [{ id: 's1', ms: T + 26 * S, kind: 'snap-cache', lane: 'snapchat', text: 'Snap skickas', context: 3, sent: true, plain: 'En snap skickas till @erik.lind från den här telefonen', source: { db: 'cache_controller.db' } }] });
    assert.ok(tl.rowsFor(snap).some((r) => r.id === 'snapchat'));
    const screenshot = model({ file: { pk: 1, filename: 'IMG_0050.PNG', createdMs: T, addedMs: T + 300, importedBy: 8, importer: 'com.apple.springboard', kindSubtype: 10 } });
    const rows = tl.rowsFor(screenshot);
    assert.ok(rows.some((r) => r.id === 'camera'), 'kameraraden finns med faktorn Inte tillämplig');
    assert.strictEqual(rows.find((r) => r.id === 'camera').factor.state, 'na');
});

test('läget vid T per rad, med faktorns ord och klartext', () => {
    const m = model();
    const ctx = ctxFor(m);
    const at = (id) => tl.stateAt(tl.rowsFor(m).find((r) => r.id === id), ctx);
    assert.deepStrictEqual(at('file'), { state: 'support', l1: 'Skapad · Photos.sqlite', l2: 'EXIF stämmer' });
    assert.deepStrictEqual(at('app'), { state: 'support', l1: 'Kamera i förgrunden', l2: 'sedan 14:30:49 (20 s)' });
    assert.deepStrictEqual(at('camera'), { state: 'support', l1: 'igång', l2: 'sedan 14:30:49 (20 s), 12 s till' });
    assert.deepStrictEqual(at('screen'), { state: 'support', l1: 'tänd', l2: 'sedan 14:30:09 (1 min)' });
    assert.deepStrictEqual(at('lock'), { state: null, l1: 'olåst', l2: 'sedan 14:30:09 (1 min)' });
    assert.deepStrictEqual(at('location'), { state: 'support', l1: '4 m från bilden', l2: '5 s efter T · ±10 m' });
    // Inställningar i förgrunden vid T: kameran "inte igång", skärmen släckt.
    const later = model({ file: { pk: 1, filename: 'IMG_0042.HEIC', createdMs: T + 90 * S, addedMs: T + 90 * S, importedBy: 1, importer: 'com.apple.camera' }, screen: [{ startMs: T - 60 * S, endMs: T + 180 * S, on: false, stream: '/display/isBacklit' }], exif: null, locations: [] });
    const c2 = ctxFor(later);
    const at2 = (id) => tl.stateAt(tl.rowsFor(later).find((r) => r.id === id), c2);
    assert.strictEqual(at2('app').l1, 'Inställningar i förgrunden');
    assert.deepStrictEqual(at2('camera'), { state: 'contradiction', l1: 'inte igång', l2: 'Inställningar i förgrunden' });
    assert.strictEqual(at2('screen').l1, 'släckt');
    assert.strictEqual(at2('location').l1, 'ingen position i fönstret');
    assert.strictEqual(at2('file').l2, 'ingen EXIF-tid');
    // Prickarna i T-kolumnen: fylld = på, vit med grå kant = av, ingen = ingen registrering.
    const mk = (mm, cx, id) => tl.tMarker(tl.rowsFor(mm).find((r) => r.id === id), cx);
    assert.deepStrictEqual(mk(m, ctx, 'camera'), { fill: tl.COLORS.camera });
    assert.deepStrictEqual(mk(m, ctx, 'screen'), { fill: tl.COLORS.phone });
    assert.deepStrictEqual(mk(later, c2, 'camera'), { fill: tl.COLORS.bg, stroke: tl.COLORS.other });
    assert.deepStrictEqual(mk(later, c2, 'screen'), { fill: tl.COLORS.bg, stroke: tl.COLORS.other });
    assert.strictEqual(mk(model({ screen: [] }), ctxFor(model({ screen: [] })), 'screen'), null);
    assert.strictEqual(mk(m, ctx, 'file'), null);
});

test('skärm och lås är egna rader med band i klartext, i närbilden med klockslag', () => {
    const m = model();
    const w = m.windows[0];
    const out = tl.svg(m, { width: 1100, format: fmt, appName: names });
    assert.ok(out.includes('>tänd<') && out.includes('>låst<'), 'orden får plats i översiktens band');
    const near = tl.svg(m, { window: w.closeup, labels: true, width: 1100, format: fmt, appName: names });
    assert.ok(near.includes('>olåst 14:30:09 → 14:31:39<') || near.includes('>olåst sedan 14:30:09<'), 'närbilden skriver klockslag i bandet');
    assert.ok(near.includes('>låst 14:31:39<') || near.includes('>låst<'));
    const earlier = model({ screen: [{ startMs: T - 10 * 60 * S, endMs: T + 180 * S, on: true, stream: '/display/isBacklit' }] });
    const since = tl.svg(earlier, { window: earlier.windows[0].closeup, labels: true, width: 1100, format: fmt, appName: names });
    assert.ok(since.includes('>tänd sedan 14:21:09<'), 'började bandet före närbilden står det sedan när');
});

test('närbilden skriver ut händelserna med klockslag och slår ihop filens tidpunkter', () => {
    const m = model();
    const c = m.windows[0].closeup;
    const out = tl.svg(m, { window: c, labels: true, width: 1100, format: fmt, appName: names, title: 'Närbild' });
    for (const needle of ['IMG_0042.HEIC skapas', '>14:31:09<', '<title>Kamera 2025-09-24 14:30:49 – 2025-09-24 14:31:21</title>', '>Kamera<', 'IMG_0043.HEIC', 'Position ±10 m', 'EXIF i filen', '14:31:00<', '14:31:30<', 'Vid T · 14:31:09']) {
        assert.ok(out.includes(needle), 'närbilden saknar ' + needle);
    }
    assert.strictEqual((out.match(/IMG_0042\.HEIC skapas/g) || []).length, 1, 'filens tidpunkter ska bli en grupp');
    assert.ok(out.includes('font-weight="bold">IMG_0042.HEIC skapas'));
    assert.ok(!out.includes('fill-opacity="0.10"'), 'ingen närbildsruta i närbilden själv');
    // clipPath-id:n skiljer översikt och närbild, så att två bilder på samma sida inte delar id.
    const over = tl.svg(m, { width: 1100, format: fmt, appName: names });
    const ids = (s) => [...s.matchAll(/clipPath id="([^"]+)"/g)].map((x) => x[1]);
    assert.ok(ids(over).length && ids(out).length);
    assert.ok(!ids(over).some((id) => ids(out).includes(id)), 'samma clipPath-id i båda bilderna');
});

test('korta texter per händelsetyp', () => {
    const m = model();
    assert.strictEqual(tl.fileLabel({ kind: 'file-created' }, m), 'IMG_0042.HEIC skapas');
    assert.strictEqual(tl.fileLabel({ kind: 'neighbour', text: 'Granne: IMG_0043.HEIC (com.apple.camera)' }, m), 'IMG_0043.HEIC');
    assert.strictEqual(tl.fileLabel({ kind: 'exif' }, m), 'EXIF i filen');
    assert.strictEqual(tl.snapLabel({ kind: 'snap-message', own: false, plain: 'En snap eller bild skickas till den här telefonen i Snapchat från @erik.lind' }), 'Snap från @erik.lind');
    assert.strictEqual(tl.snapLabel({ kind: 'snap-message', own: true, plain: 'En snap eller bild skickas till @erik.lind från den här telefonen' }), 'Snap till @erik.lind');
    assert.strictEqual(tl.snapLabel({ kind: 'snap-read', own: true, plain: 'Mottagaren öppnar den' }), 'Mottagaren öppnar den');
    assert.strictEqual(tl.snapLabel({ kind: 'snap-message', own: true, plain: null }), 'Snap skickas', 'meddelandet får en kort text, närbilden skriver den inte bredvid cacheradens "Snap till"');
    assert.strictEqual(tl.snapLabel({ kind: 'snap-notification', notifType: '' }), 'Notis från Snapchat');
    assert.strictEqual(tl.snapLabel({ kind: 'snap-cache', context: 3, sent: true, plain: null }), null, 'en skickad cachepost utan egen mening får ingen text');
    assert.strictEqual(tl.snapLabel({ kind: 'snap-cache', context: 34, isFile: true }), 'Den bedömda filen spelas in');
    assert.strictEqual(tl.snapLabel({ kind: 'snap-cache', context: 3, sent: true, plain: 'En snap eller bild skickas till @erik.lind från den här telefonen' }), 'Snap till @erik.lind');
    assert.strictEqual(tl.snapLabel({ kind: 'snap-cache', context: 7, plain: null }), null);
    assert.strictEqual(tl.dur(24000), '24 s');
    assert.strictEqual(tl.dur(185000), '3 min 5 s');
    assert.strictEqual(tl.dur(4320000), '1 tim 12 min');
});

test('tidsstegen ger 4–8 markeringar, även för närbilden', () => {
    assert.strictEqual(tl.tickStep(30 * 60000), 300000);
    assert.strictEqual(tl.tickStep(10 * 60000), 120000);
    assert.strictEqual(tl.tickStep(180 * 1000), 30000);
    assert.strictEqual(tl.tickStep(60 * 1000), 10000);
    assert.strictEqual(tl.tickStep(48 * 3600000), 21600000);
});

test('testdatat: kamerabilden och Snapchat-videon får rätt rader, läge vid T och inga överlappande texter', () => {
    const sample = require('./sample-data');
    const snapchat = require('./snapchat');
    const copies = require('./copies');
    const NAMES = { 'com.apple.camera': 'Kamera', 'com.toyopagroup.picaboo': 'Snapchat', 'com.apple.mobileslideshow': 'Bilder', 'com.apple.springboard': 'Hemskärmen' };
    const appName = (id) => NAMES[id] || id;
    for (const s of [sample.scenario({ snapchat, copies }), sample.snapchatScenario({ snapchat, copies })]) {
        const m = core.build(Object.assign({}, s, { appNames: (id) => NAMES[id] || null, cameraApps: ['com.apple.camera'], windowMs: 15 * 60000, format: fmt }));
        const rows = tl.rowsFor(m);
        assert.deepStrictEqual(rows.map((r) => r.id), ['file', 'app', 'camera', 'screen', 'lock', 'location', 'snapchat']);
        const ctx = { model: m, T: m.windows[0].centerMs, fmt, appName, positions: m.positions };
        const cam = tl.stateAt(rows.find((r) => r.id === 'camera'), ctx);
        const file = tl.stateAt(rows.find((r) => r.id === 'file'), ctx);
        if (m.type.type === 'snapchat') {
            assert.deepStrictEqual(cam, { state: 'support', l1: 'Snapchats kamera', l2: 'inspelning registrerad vid T' });
            assert.strictEqual(file.l1, 'Registrerad · cache_controller.db');
            assert.strictEqual(tl.stateAt(rows.find((r) => r.id === 'snapchat'), ctx).l1, 'Den bedömda filen spelas in');
            assert.strictEqual(tl.stateAt(rows.find((r) => r.id === 'app'), ctx).l1, 'Snapchat i förgrunden');
        } else {
            assert.strictEqual(cam.l1, 'igång');
            assert.strictEqual(file.l1, 'Skapad · Photos.sqlite');
            assert.strictEqual(tl.stateAt(rows.find((r) => r.id === 'snapchat'), ctx).l2, '26 s efter T');
        }
        const out = tl.svg(m, { window: m.windows[0].closeup, labels: true, width: 1100, format: fmt, appName });
        // Texterna med klockslag är händelsetexterna. Bredden uppskattas som i koden (5,9 px per tecken).
        const re = /<text x="([\d.]+)" y="([\d.]+)"[^>]*?(text-anchor="end")?[^>]*>(<tspan[^>]*>.*?<\/tspan> <tspan[^>]*>\d\d:\d\d:\d\d<\/tspan>)<\/text>/g;
        const lines = {};
        let mm;
        while ((mm = re.exec(out))) {
            const txt = mm[4].replace(/<[^>]+>/g, '');
            const w = txt.length * 5.9;
            const x = Number(mm[1]);
            const box = mm[3] ? [x - w, x] : [x, x + w];
            (lines[mm[2]] = lines[mm[2]] || []).push({ txt, box });
        }
        assert.ok(Object.keys(lines).length >= 3, 'för få textrader: ' + Object.keys(lines).join(','));
        for (const y of Object.keys(lines)) {
            const list = lines[y].sort((a, b) => a.box[0] - b.box[0]);
            for (let i = 1; i < list.length; i++) assert.ok(list[i].box[0] >= list[i - 1].box[1] - 1, 'överlapp på y=' + y + ': "' + list[i - 1].txt + '" och "' + list[i].txt + '"');
        }
        assert.ok(out.includes(m.type.type === 'snapchat' ? 'Den bedömda filen spelas in' : m.file.filename + ' skapas'), 'filens text saknas');
        assert.ok(out.includes('>Snapchat<') && out.includes('>Lås<'));
    }
});

test('närbilden: Snapchat-markörerna ligger inte på varandra, har text och förklaras, och kamerans text ligger ovanför bandet', () => {
    const sample = require('./sample-data');
    const snapchat = require('./snapchat');
    const copies = require('./copies');
    const NAMES = { 'com.snapchat.android': 'Snapchat', 'com.toyopagroup.picaboo': 'Snapchat', 'com.apple.camera': 'Kamera' };
    const appName = (id) => NAMES[id] || id;
    const scenarios = { ios: sample.snapchatScenario({ snapchat, copies }), android: sample.androidScenario({ snapchat, copies }) };
    for (const [name, s] of Object.entries(scenarios)) {
        const m = core.build(Object.assign({}, s, { appNames: (id) => NAMES[id] || null, cameraApps: ['com.apple.camera'], windowMs: 15 * 60000, format: fmt }));
        const out = tl.svg(m, { window: m.windows[0].closeup, labels: true, detail: 'all', width: 1100, format: fmt, appName });
        // Snapchat-radens markörer: alla med titel som börjar på Snapchat eller Den bedömda filen, på radens mitt (största cy).
        const marks = [];
        const re = /<(circle|polygon) (?:cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"|points="([\d.]+),([\d.]+)[^"]*")[^>]*><title>(Snapchat|Den bedömda filen)/g;
        let mm;
        while ((mm = re.exec(out))) {
            if (mm[1] === 'circle') marks.push({ x: Number(mm[2]), y: Number(mm[3]), r: Number(mm[4]) });
            else marks.push({ x: Number(mm[5]), y: Number(mm[6]) + 5, r: 5 });
        }
        const rowY = Math.max(...marks.map((k) => Math.round(k.y)));
        const row = marks.filter((k) => Math.abs(k.y - rowY) <= 8).sort((a, b) => a.x - b.x);
        assert.ok(row.length >= 3, name + ': för få markörer i Snapchat-raden');
        for (let i = 1; i < row.length; i++) assert.ok(row[i].x - row[i - 1].x >= Math.min(row[i].r, row[i - 1].r) + 4, name + ': markörerna vid x=' + row[i - 1].x + ' och ' + row[i].x + ' ligger på varandra');
        assert.ok(out.includes('Snap/meddelande') && out.includes('Öppnad'), name + ': Snapchat-markörerna saknas i teckenförklaringen');
        assert.ok(out.includes('Mottagaren öppnar den'), name + ': den lästa snappen saknar text');
        // Kamerans text står ovanför det gråa bandet, inte i det.
        const camText = /<text x="[\d.]+" y="([\d.]+)"[^>]*><tspan font-weight="bold">Den bedömda (?:filen spelas in|bilden tas) med Snapchats kamera/.exec(out);
        assert.ok(camText, name + ': kamerans text saknas');
        const camBand = /<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="18" rx="3" fill="#e5e5ea"[^>]*><title>Inte kameran/.exec(out);
        assert.ok(Number(camText[1]) <= Number(camBand[1]), name + ': kamerans text ligger i bandet');
    }
    const android = core.build(Object.assign({}, scenarios.android, { appNames: (id) => NAMES[id] || null, cameraApps: [], windowMs: 15 * 60000, format: fmt }));
    const labels = tl.legendItems(tl.rowsFor(android), android.events, false).map((it) => it[1]);
    assert.ok(labels.includes('Snapchats register (cache, Memories, filhanterare)'), labels.join(' | '));
});

test('närbilden visar som standard det viktiga: filens händelser med text, sammanhanget blekt och utan text', () => {
    const sample = require('./sample-data');
    const snapchat = require('./snapchat');
    const copies = require('./copies');
    const NAMES = { 'com.snapchat.android': 'Snapchat', 'com.toyopagroup.picaboo': 'Snapchat', 'com.apple.camera': 'Kamera' };
    const appName = (id) => NAMES[id] || id;
    for (const s of [sample.scenario({ snapchat, copies }), sample.androidScenario({ snapchat, copies })]) {
        const m = core.build(Object.assign({}, s, { appNames: (id) => NAMES[id] || null, cameraApps: ['com.apple.camera'], windowMs: 15 * 60000, format: fmt }));
        const opts = { window: m.windows[0].closeup, labels: true, width: 1100, format: fmt, appName };
        const focus = tl.svg(m, opts);
        const all = tl.svg(m, Object.assign({ detail: 'all' }, opts));
        const texts = (out) => (out.match(/<tspan[^>]*>[^<]+<\/tspan> <tspan/g) || []).length;
        assert.ok(texts(focus) < texts(all), 'det viktiga ska ha färre texter än allt');
        assert.ok(focus.includes(m.file.filename.slice(0, 20)), 'filens egen text saknas');
        assert.ok(focus.includes('opacity="0.3"'), 'sammanhanget ska vara blekt');
        assert.ok(/Blek: annan händelse i fönstret \(\d+\)/.test(focus), 'teckenförklaringen ska säga vad blekt betyder');
        assert.ok(!all.includes('opacity="0.3"') && !all.includes('Blek:'));
        // Den bedömda filens Snapchat-händelser och kolumnen Vid T har alltid text.
        m.events.filter((e) => e.isFile && /^snap-/.test(e.kind) && e.ms >= opts.window.startMs && e.ms <= opts.window.endMs).forEach((e) => {
            const l = tl.snapLabel(e);
            if (l) assert.ok(focus.includes(l), 'saknar text för den bedömda filen: ' + l);
        });
        const keep = tl.focusSet(m, opts.window.centerMs, m.positions);
        assert.ok(![...keep].some((e) => e.neighbour), 'grannbilder är sammanhang');
    }
});
