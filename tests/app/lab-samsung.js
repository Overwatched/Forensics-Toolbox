// Samsungs loggar (SSRM och batterihistoriken) mot en rapport från en Samsung-telefon: filerna läses ur rapporten av
// Härkomst, och det som faktorerna säger jämförs med tider som är kontrollerade mellan källorna: bildens tid i EXIF, SSRM,
// usagestats och rapportverktygets egna tolkningar. Körs bara när FT_LAB_SAMSUNG_REPORT pekar på rapporten. Läser bara filen.
// Samma telefon, en loggad session i en zip (facit/lab-samsung-a33.json), körs när FT_LAB_SAMSUNG_ZIP pekar på zippen.
'use strict';

const path = require('node:path');
const { sleep } = require('./cdp');
const { expect, PROV } = require('./smoke');

async function assess(c, name) {
    await c.ev(PROV, `document.getElementById('zone').value = 'utc', 1`);
    await c.ev(PROV, `document.getElementById('filename').value = ${JSON.stringify(name)}, document.getElementById('run').click(), 1`);
    await sleep(300);
    await c.waitFor(PROV, `!ProvenanceApp.busy() && !document.getElementById('result').classList.contains('display-none') && ProvenanceApp.model() && ProvenanceApp.model().file.filename === ${JSON.stringify(name)}`, 240000, name);
    return c.ev(PROV, `(function(){
        const m = ProvenanceApp.model();
        return { T: m.file.createdMs, type: m.type.type,
            factors: Object.fromEntries(m.factors.map(x => [x.id, { state: x.state, title: x.title, verdictText: x.verdictText, text: x.items.map(i => i.text).join(' | ') }])),
            events: m.events.filter(e => e.kind === 'app' || e.kind === 'screen' || e.kind === 'log-unsure' || e.kind === 'snap-memory').map(e => ({ kind: e.kind, stream: e.stream, app: e.app, on: e.on, ms: e.ms, endMs: e.endMs, cameraOp: !!e.cameraOp, byUid: !!e.byUid, captured: !!e.captured, clockMs: e.clockMs, zoneMs: e.zoneMs, text: e.text, source: ProvenanceReport.sourceText(e.source) })),
            warnings: m.warnings, beta: m.beta, sources: ProvenanceApp.meta().sources.map(s => s.label), coverage: ProvenanceApp.meta().coverage };
    })()`);
}

const iso = (ms) => new Date(ms).toISOString().slice(11, 19);

function openIn(file, what) {
    return [what + ' öppnas i Härkomst och loggarna hittas', async ({ c }) => {
        await c.nav('Härkomst');
        await c.ev(PROV, `document.getElementById('ex-close').click(), 1`);
        await c.setFiles(null, '#cb-input', [file]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await sleep(1000);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && /databaser hittades/.test(document.getElementById('ex-status').textContent) && document.getElementById('ex-status').textContent.includes(${JSON.stringify(path.basename(file))})`, 300000, what);
        const status = await c.ev(PROV, `document.getElementById('ex-status').textContent`);
        expect(/20 SSRM-filer, 40 filer med batterihistorik/.test(status), 'Loggarna: ' + status);
        return status.split(' · ').slice(-1)[0];
    }];
}

// Bilderna som ligger kvar i både rapporten och zippen, och ger samma svar i båda.
function sharedScenarios() {
    const camera = ['Kamerabilden från mars: bara batterihistoriken täcker tiden, och kameran var på när bilden togs', async ({ c }) => {
        const r = await assess(c, '20260312_133111.jpg');
        expect(r.T === Date.UTC(2026, 2, 12, 12, 31, 11, 726), 'T: ' + new Date(r.T).toISOString());
        expect(r.factors.app.state === 'support' && r.factors.camera.state === 'support' && r.factors.screen.state === 'support', 'Faktorerna: ' + JSON.stringify(r.factors));
        const cam = r.events.find((e) => e.cameraOp && e.ms <= r.T && r.T <= e.endMs);
        expect(cam && cam.stream === 'batterihistoriken' && cam.app === 'com.sec.android.app.camera', 'Kameran: ' + JSON.stringify(cam));
        expect(iso(cam.ms) === '12:31:03' && iso(cam.endMs) === '12:31:16', 'Tiderna: ' + iso(cam.ms) + ' ' + iso(cam.endMs));
        expect(/newbatterystats260317080553 rad 2699–2718/.test(cam.source) && /\+camera/.test(cam.source) && /-camera/.test(cam.source), 'Råraden: ' + cam.source);
        expect(r.sources.some((s) => /newbatterystats260317080553/.test(s)), 'Källan: ' + r.sources.join(', '));
        expect(!r.events.some((e) => e.kind === 'log-unsure'), 'Osäkra rader: ' + JSON.stringify(r.events.filter((e) => e.kind === 'log-unsure')));
        return 'kameran ' + iso(cam.ms) + '–' + iso(cam.endMs) + ' UTC';
    }];
    const gap = ['Kamerabilden från december: batterihistoriken har ett hål där, och faktorn säger det', async ({ c }) => {
        const r = await assess(c, '20251204_121339.jpg');
        expect(r.factors.camera.state === 'missing', 'Kamera: ' + JSON.stringify(r.factors.camera));
        expect(/utanför usagestats:s täckning/.test(r.factors.camera.text), 'usagestats: ' + r.factors.camera.text);
        expect(/Batterihistoriken har inga rader från 2025-12-02 [\d:]+ UTC till 2025-12-12 [\d:]+ UTC\./.test(r.factors.camera.text), 'Hålet: ' + r.factors.camera.text);
        expect(!r.warnings.some((w) => /Wellbeing/.test(w)), 'Varningarna: ' + r.warnings);
        return 'hål 2 till 12 december';
    }];
    return { camera, gap };
}

function scenarios(report) {
    const { camera, gap } = sharedScenarios();
    const shot = ['Skärmdumpen från september: usagestats går först, batterihistorikens flyttade klocka räknas inte', async ({ c }) => {
        const r = await assess(c, 'Screenshot_20260930_094637.jpg');
        expect(r.type === 'screenshot', 'Typ: ' + r.type);
        expect(r.factors.app.state === 'info' && /Solflare \(usagestats\)/.test(r.factors.app.text), 'App: ' + r.factors.app.text);
        expect(r.factors.screen.state === 'support' && /usagestats/.test(r.factors.screen.text), 'Skärm: ' + r.factors.screen.text);
        expect(!/räknas inte/.test(r.factors.screen.text), 'Noten när en säker källa svarar: ' + r.factors.screen.text);
        const unsure = r.events.filter((e) => e.kind === 'log-unsure');
        expect(unsure.length >= 1 && unsure.every((e) => e.stream === 'batterihistoriken' && e.clockMs > 150000), 'Osäkra rader: ' + JSON.stringify(unsure));
        expect(!r.events.some((e) => e.stream === 'batterihistoriken' && e.kind !== 'log-unsure'), 'Batterihistoriken räknades i ett avsnitt med flyttad klocka');
        return unsure.length + ' rader utan betydelse för bedömningen';
    }];
    const speed = ['En ny fråga om samma fil läser inte om loggarna', async ({ c }) => {
        const t0 = Date.now();
        await assess(c, '20260312_133111.jpg');
        const ms = Date.now() - t0;
        expect(ms < 8000, 'Tog ' + ms + ' ms');
        return ms + ' ms';
    }];
    return [openIn(report, 'Rapporten'), camera, shot, gap, speed];
}

// Den loggade sessionen: kamera-appen, Signals kamera, en bild ur kamerarullen och Snapchats kamera.
function zipScenarios(zip, facit) {
    const at = (t) => Date.parse(t);
    const tol = facit.toleranceMs;
    const near = (a, b, what) => expect(a != null && Math.abs(a - at(b)) <= tol, what + ': ' + (a == null ? 'saknas' : new Date(a).toISOString()) + ', facit ' + b);
    const cams = (r, stream, app) => r.events.filter((e) => e.cameraOp && e.stream === stream && e.app === app);
    const { camera, gap } = sharedScenarios();
    const photo = ['Bilden med kamera-appen: fyra loggar är överens, och Samsungs kamera-app står på SSRM:s kamerarad', async ({ c }) => {
        const f = facit.files.camera;
        const r = await assess(c, f.name);
        expect(Math.abs(r.T - at(f.T)) <= 1, 'T: ' + new Date(r.T).toISOString());
        expect(r.factors.app.state === 'support' && r.factors.camera.state === 'support' && r.factors.screen.state === 'support', 'Faktorerna: ' + JSON.stringify(r.factors));
        ['SSRM', 'batterihistoriken', 'appops'].forEach((s) => expect(cams(r, s, 'com.sec.android.app.camera').some((e) => e.ms <= r.T && r.T <= e.endMs), s + ' täcker inte T: ' + JSON.stringify(cams(r, s, 'com.sec.android.app.camera'))));
        expect(/SSRM, camera running/.test(r.factors.camera.text) && /appops/.test(r.factors.camera.text) && /usagestats/.test(r.factors.camera.text) && /batterihistoriken, \+camera, med appens uid/.test(r.factors.camera.text), 'Källorna: ' + r.factors.camera.text);
        // Telefonen låg på laddning med skärmen tänd i 28 dagar över sommartidens slut. Den raden är osäker, men den slutar före T.
        const unsure = r.events.filter((e) => e.kind === 'log-unsure' && e.ms <= r.T && r.T <= e.endMs);
        expect(!unsure.length, 'Osäkra rader vid T: ' + JSON.stringify(unsure));
        expect(r.events.some((e) => e.kind === 'screen' && e.stream === 'SSRM' && e.on && e.ms <= r.T && r.T <= e.endMs), 'SSRM:s skärmrad räknas inte');
        return 'T ' + iso(r.T) + ' UTC';
    }];
    const sessions = ['Kameran sex gånger: SSRM och batterihistoriken säger samma app och samma tider, också när kameran öppnades utan någon bild', async ({ c }) => {
        const r = await assess(c, facit.files.signalCamera.name);
        facit.cameraSessions.forEach((s) => {
            const mid = (at(s.ssrm[0]) + at(s.ssrm[1])) / 2;
            const bat = cams(r, 'batterihistoriken', s.app).find((e) => e.ms <= mid && mid <= e.endMs);
            expect(bat, s.app + ' saknas i batterihistoriken vid ' + s.ssrm[0]);
            expect(bat.byUid, 'Batterihistoriken ska säga appen med uid: ' + bat.text);
            near(bat.ms, s.battery[0], 'Batterihistoriken börjar');
            near(bat.endMs, s.battery[1], 'Batterihistoriken slutar');
            const ss = cams(r, 'SSRM', s.app).filter((e) => e.ms <= at(s.ssrm[1]) && at(s.ssrm[0]) <= e.endMs);
            expect(ss.length, s.app + ' saknas i SSRM vid ' + s.ssrm[0]);
            near(ss[0].ms, s.ssrm[0], 'SSRM börjar');
            near(ss[ss.length - 1].endMs, s.ssrm[1], 'SSRM slutar');
            // Signals andra gång är två öppningar med en sekund emellan, så mitten kan ligga mellan dem.
            expect(cams(r, 'appops', s.app).some((e) => e.ms <= at(s.ssrm[0]) + 1000 && at(s.ssrm[0]) + 1000 <= e.endMs), s.app + ' saknas i appops vid ' + s.ssrm[0]);
        });
        return facit.cameraSessions.length + ' gånger';
    }];
    const fore = ['Förgrunden: en app som byter aktivitet ligger kvar i usagestats, som i SSRM och batterihistoriken', async ({ c }) => {
        const r = await assess(c, facit.files.signalCamera.name);
        const usage = r.events.filter((e) => e.kind === 'app' && !e.cameraOp && e.stream === 'usagestats');
        facit.foreground.forEach((f) => {
            const hit = usage.filter((e) => e.app === f.app && e.ms <= at(f.from) + 1000 && at(f.to) - 1000 <= e.endMs);
            expect(hit.length === 1, f.app + ' är inte ett sammanhängande intervall ' + f.from + ' till ' + f.to + ': ' + JSON.stringify(usage.filter((e) => e.app === f.app).map((e) => [iso(e.ms), iso(e.endMs)])));
        });
        return facit.foreground.length + ' intervall';
    }];
    const signalCam = ['Signals kamera: kameran täcker bilagan, och appen är Signal', async ({ c }) => {
        const f = facit.files.signalCamera;
        const r = await assess(c, f.name);
        expect(Math.abs(r.T - at(f.T)) <= 1000, 'T: ' + new Date(r.T).toISOString());
        expect(r.factors.camera.state === 'support' && /Signal använde kameran/.test(r.factors.camera.text), 'Kamera: ' + JSON.stringify(r.factors.camera));
        expect(/Igång vid tidpunkten: Signal/.test(r.factors.app.text), 'App: ' + r.factors.app.text);
        return 'T ' + iso(r.T) + ' UTC';
    }];
    const signalRoll = ['Bilden ur kamerarullen: kameran står inte registrerad, och det sägs inte tala emot något', async ({ c }) => {
        const f = facit.files.signalAttached;
        const r = await assess(c, f.name);
        expect(Math.abs(r.T - at(f.T)) <= 1000, 'T: ' + new Date(r.T).toISOString());
        expect(r.factors.camera.state === 'info' && /Kameran är inte registrerad/.test(r.factors.camera.text), 'Kamera: ' + JSON.stringify(r.factors.camera));
        expect(r.events.some((e) => e.kind === 'app' && !e.cameraOp && e.stream === 'usagestats' && e.app === 'org.thoughtcrime.securesms' && e.ms <= r.T && r.T <= e.endMs), 'Signal i förgrunden vid T saknas');
        return 'T ' + iso(r.T) + ' UTC';
    }];
    const snap = ['Snapchats kamera: tre loggar namnger Snapchat vid tagningen, också medan behörighetsfrågan låg överst', async ({ c }) => {
        const f = facit.files.snapchat;
        const r = await assess(c, f.name);
        expect(Math.abs(r.T - at(f.T)) <= 1, 'T: ' + new Date(r.T).toISOString());
        const memory = r.events.find((e) => e.kind === 'snap-memory' && e.captured);
        near(memory && memory.ms, f.capturedInMemories, 'Tagen enligt Memories');
        expect(r.type === 'snapchat' && r.factors.camera.state === 'support' && r.factors.camera.verdictText === 'Kameran var på', 'Kamera: ' + JSON.stringify(r.factors.camera));
        ['batterihistoriken \\(\\+camera, med appens uid\\)', 'SSRM \\(camera running\\)', 'appops \\(op 26\\)'].forEach((s) => expect(new RegExp('Snapchat använde kameran .*enligt ' + s).test(r.factors.camera.text), s + ': ' + r.factors.camera.text));
        expect(!r.events.some((e) => e.cameraOp && e.app === 'com.google.android.permissioncontroller'), 'Behörighetsfrågan ska inte stå som appen bakom kameran');
        return 'T ' + iso(r.T) + ' UTC';
    }];
    return [openIn(zip, 'Zippen'), photo, sessions, fore, signalCam, signalRoll, snap, camera, gap];
}

module.exports = { scenarios, zipScenarios, assess };
