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
        'fill-opacity="0.09"', '<circle', 'Forensics Toolbox 1.30', '14:20', '14:45', 'fill-opacity="0.10"', '<title>Närbild 14:29:39 till 14:32:39</title>', '>Närbild<', '>Förenligt<', '>Kamera i förgrunden<', '>tänd<', '>olåst<']) {
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
    assert.strictEqual(at2('file').l2, 'ingen tid i filen');
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
    assert.strictEqual(tl.fileLabel({ kind: 'file-created', source: { db: 'zippen' } }, m), 'IMG_0042.HEIC ändras i filsystemet');
    assert.strictEqual(tl.fileLabel({ kind: 'file-created', source: { db: 'rapporten' } }, m), 'IMG_0042.HEIC ändras i filsystemet');
    assert.strictEqual(tl.fileLabel({ kind: 'file-created', source: { db: 'bildfilen' } }, m), 'IMG_0042.HEIC tiden i filen');
    assert.strictEqual(tl.fileLabel({ kind: 'file-created', source: { db: 'Photos.sqlite' } }, m), 'IMG_0042.HEIC skapas');
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

// ---------- En annan tidpunkt än T ----------

const FAR = 400 * 86400 * S;
function twoMoments(over) {
    const later = T + FAR;
    return model(Object.assign({
        file: { pk: 1, filename: 'IMG_0044.HEIC', createdMs: T, addedMs: later, importedBy: 1, importer: 'com.apple.camera', latitude: 59.33255, longitude: 18.064 },
        appIntervals: [{ startMs: later - 20 * S, endMs: later + 12 * S, app: 'com.apple.Preferences', stream: '/app/usage' }],
        screen: [{ startMs: later - 60 * S, endMs: later + 180 * S, on: true, stream: '/display/isBacklit' }],
        lock: [],
        locations: [{ ms: later + 5 * S, lat: 59.33258, lon: 18.06398, accuracy: 10, type: 1 }],
        neighbours: [],
    }, over || {}));
}

test('tidslinjen vid en annan tidpunkt kallar den inte T och har inga bedömningsord', () => {
    const m = twoMoments();
    assert.deepStrictEqual(m.windows.map((w) => w.id), ['created', 'added']);
    const later = tl.svg(m, { window: m.windows[1], format: fmt, appName: names, footer: '' });
    const texts = [...later.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((x) => x[1].replace(/<[^>]+>/g, ''));
    assert.ok(texts.some((t) => /^\d\d:\d\d:\d\d filen kom till telefonen$/.test(t)), texts.join(' | '));
    assert.ok(texts.some((t) => /^Läget · \d\d:\d\d:\d\d$/.test(t)), texts.join(' | '));
    assert.ok(!texts.some((t) => /^T \d\d:/.test(t) || /^Vid T/.test(t)), 'T står på fel tid');
    for (const word of Object.values(tl.STATE_LABEL)) assert.ok(!texts.includes(word), 'bedömningsordet ' + word);
    // Avståndet till T är det enda som nämner T.
    assert.deepStrictEqual(texts.filter((t) => /(^| )T( |$)/.test(t)), ['400 dygn efter T']);
    assert.ok(texts.includes('Filen kom till telefonen'));
    assert.ok(texts.includes('Tidpunkten'), 'teckenförklaringen');
    assert.ok(texts.includes('tänd') && texts.includes('närmaste position'), texts.join(' | '));
    // T ser ut som förut.
    const atT = tl.svg(m, { window: m.windows[0], format: fmt, appName: names, footer: '' });
    assert.ok(atT.includes('Vid T · ') && atT.includes('>T ' + fmt(T).slice(11, 19) + '<'), 'T-tidslinjen');
    assert.ok(Object.values(tl.STATE_LABEL).some((w) => atT.includes('>' + w + '<')), 'T-tidslinjen har bedömningsorden');
});

test('närbilden vid en annan tidpunkt säger samma sak som översikten', () => {
    const m = twoMoments();
    const w = m.windows[1];
    const close = tl.svg(m, { window: w.closeup, stateWindow: w, labels: true, format: fmt, appName: names, footer: '' });
    assert.ok(close.includes('Läget · ') && close.includes(' filen kom till telefonen<') && !close.includes('Vid T'));
});

test('kolumnen vid T visar inte vanliga händelser från en annan tidpunkt, men väl det som rör filen', () => {
    const later = T + FAR;
    const msg = (over) => Object.assign({ kind: 'wa-message', lane: 'whatsapp', ms: later, own: true, media: true, mediaKind: 'bild', plain: 'x', text: 'x', source: {} }, over);
    const other = twoMoments({ extraEvents: [msg({})] });
    const row = (m) => tl.rowsFor(m).find((r) => r.id === 'whatsapp');
    const ctx = (m) => ({ model: m, T, atT: true, window: m.windows[0], fmt, appName: names, positions: m.positions });
    assert.strictEqual(tl.stateAt(row(other), ctx(other)).l1, '–', 'ett meddelande långt från T');
    const mine = twoMoments({ extraEvents: [msg({ isFile: true })] });
    const s = tl.stateAt(row(mine), ctx(mine));
    assert.strictEqual(s.l1, 'Filen skickas i WhatsApp');
    assert.strictEqual(s.l2, '400 dygn efter T');
    const atOther = tl.stateAt(row(other), { model: other, T: later, atT: false, window: other.windows[1], fmt, appName: names, positions: other.positions });
    assert.strictEqual(atOther.state, null);
    assert.strictEqual(atOther.l2, 'vid tidpunkten');
});

test('klippområdena har egna id per tidslinje', () => {
    const m = twoMoments();
    const a = tl.svg(m, { window: m.windows[1], prefix: 'w1o', format: fmt, appName: names, footer: '' });
    const b = tl.svg(m, { window: m.windows[1], prefix: 'w0o', format: fmt, appName: names, footer: '' });
    const ids = (x) => [...x.matchAll(/<clipPath id="([^"]+)"/g)].map((y) => y[1]);
    assert.ok(ids(a).length > 0 && ids(a).every((i) => i.startsWith('w1o')) && ids(b).every((i) => i.startsWith('w0o')));
});

test('långa tider står i dygn', () => {
    assert.strictEqual(tl.dur(47 * 3600 * S), '47 tim');
    assert.strictEqual(tl.dur(48 * 3600 * S), '2 dygn');
    assert.strictEqual(tl.dur(410 * 86400 * S + 20 * 3600 * S), '410 dygn 20 tim');
});

test('kameran utan känd app ritas utan appnamn, och en rad med osäker tid ritas inte', () => {
    const m = model({
        platform: 'Android', appIntervals: [], screen: [], lock: [], locations: [], neighbours: [], samsung: { battery: true },
        cameraUse: [{ startMs: T - 5 * S, endMs: T + 5 * S, app: null, stream: 'batterihistoriken', source: { db: 'batterihistoriken' } }],
        logUnsure: [{ what: 'app', startMs: T + 30 * S, endMs: T + 40 * S, app: 'com.example.osaker', stream: 'batterihistoriken', clockMs: 163000, zoneMs: 0, source: { db: 'batterihistoriken' } }],
    });
    const out = tl.svg(m, m.windows[0], { format: fmt, appName: names, labels: true });
    assert.ok(!/null/.test(out), 'null i tidslinjen');
    assert.ok(/Kameran på /.test(out), 'kameran saknas i tidslinjen');
    assert.ok(!/com\.example\.osaker/.test(out), 'raden med osäker tid ritades');
    const row = tl.rowsFor(m).find((r) => r.id === 'camera');
    assert.strictEqual(tl.stateAt(row, { model: m, T, fmt, appName: names }).l1, 'på');
});

test('kameraband ur flera källor ovanpå varandra: texten står en gång', () => {
    const src = { db: 'x' };
    const M = 60 * S;
    const m = model({
        platform: 'Android', cameraApps: ['com.example.camera'], screen: [], lock: [], locations: [], neighbours: [], samsung: { battery: true },
        appIntervals: [{ startMs: T - 9 * M, endMs: T + 9 * M, app: 'com.example.camera', stream: 'batterihistoriken', source: src }],
        cameraUse: [
            { startMs: T - 8 * M, endMs: T + 8 * M, app: 'com.example.camera', stream: 'batterihistoriken', source: src },
            { startMs: T - 8 * M, endMs: T + 8 * M, app: 'com.example.camera', stream: 'SSRM', source: src },
        ],
    });
    const out = tl.svg(m, { format: fmt, appName: names });
    const texts = (out.match(/<text[^>]*>[^<]*<\/text>/g) || []).map((t) => t.replace(/<[^>]+>/g, ''));
    assert.strictEqual(texts.filter((t) => t === 'används').length, 1, texts.join(' | '));
    assert.ok(!texts.some((t) => /^igång sedan/.test(t)), texts.join(' | '));
    const labelled = (tl.svg(m, { format: fmt, appName: names, labels: true }).match(/<text[^>]*>[^<]*<\/text>/g) || []).map((t) => t.replace(/<[^>]+>/g, ''));
    assert.strictEqual(labelled.filter((t) => t === 'används').length, 1, labelled.join(' | '));
});

test('skärm, lås och app ur flera källor ovanpå varandra: texten står en gång, på det längsta bandet', () => {
    const src = { db: 'x' };
    const M = 60 * S;
    const base = { platform: 'Android', cameraApps: ['com.example.camera'], locations: [], neighbours: [], samsung: { battery: true }, lock: [], appIntervals: [], cameraUse: [] };
    const svgOf = (over) => tl.svg(model(Object.assign({}, base, over)), { format: fmt, appName: names, labels: true });
    // Klippytan runt bandets text: { x, w } per text som börjar med ordet. Kolumnen Vid T har ingen sådan.
    const labelsOf = (out, word) => [...out.matchAll(new RegExp('<clipPath id="[^"]+"><rect x="([\\d.]+)" y="[\\d.-]+" width="([\\d.]+)"[^>]*/></clipPath><g clip-path="[^"]+"><text[^>]*>' + word.replace(/\./g, '\\.'), 'g'))].map((m) => ({ x: Number(m[1]), w: Number(m[2]) }));
    const on = (from, to, stream) => ({ startMs: T + from * M, endMs: T + to * M, on: true, stream, source: src });
    const out = svgOf({
        screen: [{ startMs: T - 9 * M, endMs: T - 3 * M, on: false, stream: 'batterihistoriken', source: src }, on(-3, 6, 'batterihistoriken'), on(-2, 2, 'usagestats'), on(-2.5, 7, 'SSRM')],
        lock: [{ startMs: T - 3 * M, endMs: T + 4 * M, locked: false, stream: 'usagestats', source: src }, { startMs: T - 2 * M, endMs: T + 3 * M, locked: false, stream: 'annan', source: src }],
        appIntervals: [
            { startMs: T - 6 * M, endMs: T + 6 * M, app: 'org.example.chat', stream: 'usagestats', source: src },
            { startMs: T - 14 * M, endMs: T - 5 * M, app: 'org.example.chat', stream: 'SSRM', source: src },
            { startMs: T - 8 * M, endMs: T - 3 * M, app: 'com.example.other', stream: 'SSRM', source: src },
        ],
    });
    const tand = labelsOf(out, 'tänd'), slackt = labelsOf(out, 'släckt');
    assert.strictEqual(tand.length, 1, 'en text för den tända skärmen');
    // SSRM är längst, 9,5 minuter mot den släckta tidens sex. Den släckta tidens text står kvar: den säger något annat.
    assert.strictEqual(slackt.length, 1);
    assert.ok(Math.abs(tand[0].w / slackt[0].w - 9.5 / 6) < 0.02, JSON.stringify([tand, slackt]));
    assert.strictEqual(labelsOf(out, 'olåst').length, 1);
    // Samma app två gånger ger en text, en annan app sin egen.
    assert.strictEqual(labelsOf(out, 'org.example.chat').length, 1, 'samma app');
    assert.strictEqual(labelsOf(out, 'com.example.other').length, 1, 'en annan app');
    // Två lika långa: den första, så att bilden inte ändras av ordningen i listan.
    const first = labelsOf(svgOf({ screen: [on(-3, 3, 'a')] }), 'tänd');
    const two = labelsOf(svgOf({ screen: [on(-3, 3, 'a'), on(-2, 4, 'b')] }), 'tänd');
    assert.deepStrictEqual(two, first);
    // Band som inte möts har var sin text.
    assert.strictEqual(labelsOf(svgOf({ screen: [on(-6, -2, 'a'), on(2, 6, 'a')] }), 'tänd').length, 2);
    // Band som bara rör vid varandra möts inte.
    assert.strictEqual(labelsOf(svgOf({ screen: [on(-6, 0, 'a'), on(0, 6, 'a')] }), 'tänd').length, 2);
});

test('raden Telefonen: bara när eRR.p säger något, med bandet och raderna', () => {
    const w = { id: 'T', startMs: 0, endMs: 3600000, centerMs: 1800000, closeup: { startMs: 900000, endMs: 2700000 }, label: 'när filen skapades' };
    const base = { platform: 'Android', file: { filename: 'a.jpg', createdMs: 1800000 }, type: { type: 'camera' }, windows: [w], moments: [], factors: [], events: [], positions: [] };
    const row = (m) => tl.rowsFor(m).find((r) => r.id === 'power');
    assert.ok(!row(base), 'igång som vanligt ger ingen rad');
    const factor = { id: 'power', title: 'Telefonen igång', state: 'contradiction', verdict: 'Avstängd', items: [], plain: '' };
    assert.ok(row(Object.assign({}, base, { factors: [factor] })).factor === factor);
    const off = { id: 1, kind: 'power-off', lane: 'power', ms: 600000, endMs: 3000000, stream: 'eRR.p', text: 'Telefonen avstängd', source: {} };
    assert.ok(row(Object.assign({}, base, { events: [off] })), 'en händelse i fönstret ger raden utan faktor');
    const unsure = Object.assign({}, off, { id: 2, unsure: true, ms: 0, endMs: 300000 });
    const down = { id: 3, kind: 'power', lane: 'power', ms: 600000, what: 'SHUTDOWN', reason: 'no power', text: 'Telefonen stängs av', source: {} };
    const crash = { id: 4, kind: 'power', lane: 'power', ms: 3000000, what: 'ON', crash: true, text: 'Telefonen startar om', source: {} };
    const m = Object.assign({}, base, { factors: [factor], events: [off, unsure, down, crash] });
    const rows = tl.rowsFor(m);
    assert.deepStrictEqual(rows.slice(0, 3).map((r) => r.id), ['file', 'power', 'app'], 'överst, före apparna');
    const fmt = (ms) => new Date(ms).toISOString();
    const out = tl.svg(m, { format: fmt, appName: (a) => a, labels: true });
    assert.ok(out.includes('>Telefonen<'), 'radens namn');
    assert.ok(/avstängd 1970-01-01T00:10:00\.000Z – 1970-01-01T00:50:00\.000Z/.test(out), 'bandet har sin tid i texten för musen');
    assert.ok(/kanske avstängd 1970-01-01T00:00:00\.000Z/.test(out), 'det osäkra bandet');
    assert.ok(out.includes('Av: no power') && out.includes('Start efter krasch'), 'raderna står utskrivna');
    assert.ok(out.includes('>Avstängd<'), 'läget vid T');
    assert.ok(!/undefined/.test(out));
    assert.ok(out.includes('Start eller nedstängning') && out.includes('>Avstängd<'), 'teckenförklaringen');
    assert.ok(!tl.svg(base, { format: fmt, appName: (a) => a, labels: true }).includes('Start eller nedstängning'), 'bara när raden finns');
    // Radens text står ovanför bandet, så att den inte hamnar ovanpå bandets egen text.
    const y = (word) => Number(new RegExp('<text[^>]* y="([\\d.-]+)"[^>]*>(?:<tspan[^>]*>)?' + word).exec(out)[1]);
    const closeup = tl.svg(Object.assign({}, m, { events: [off, down] }), { format: fmt, appName: (a) => a, labels: true });
    const yIn = (word) => Number(new RegExp('<text[^>]* y="([\\d.-]+)"[^>]*>(?:<tspan[^>]*>)?' + word).exec(closeup)[1]);
    const top = Number(/<rect x="[\d.]+" y="([\d.-]+)"[^>]*><title>avstängd /.exec(closeup)[1]);
    assert.ok(yIn('Av: no power') < top, 'texten ovanför bandet: ' + yIn('Av: no power') + ' ' + top);
    assert.ok(y('Av: no power') < y('avstängd'));
});
