// Samsungs loggar (SSRM och batterihistoriken) mot en rapport från en Samsung-telefon: filerna läses ur rapporten av
// Härkomst, och det som faktorerna säger jämförs med tider som är kontrollerade mellan källorna: bildens tid i EXIF, SSRM,
// usagestats och rapportverktygets egna tolkningar. Körs bara när FT_LAB_SAMSUNG_REPORT pekar på rapporten. Läser bara filen.
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
            factors: Object.fromEntries(m.factors.map(x => [x.id, { state: x.state, title: x.title, text: x.items.map(i => i.text).join(' | ') }])),
            events: m.events.filter(e => e.kind === 'app' || e.kind === 'screen' || e.kind === 'log-unsure').map(e => ({ kind: e.kind, stream: e.stream, app: e.app, on: e.on, ms: e.ms, endMs: e.endMs, cameraOp: !!e.cameraOp, clockMs: e.clockMs, source: ProvenanceReport.sourceText(e.source) })),
            warnings: m.warnings, beta: m.beta, sources: ProvenanceApp.meta().sources.map(s => s.label), coverage: ProvenanceApp.meta().coverage };
    })()`);
}

const iso = (ms) => new Date(ms).toISOString().slice(11, 19);

function scenarios(report) {
    const open = ['Rapporten öppnas i Härkomst och loggarna hittas', async ({ c }) => {
        await c.nav('Härkomst');
        await c.ev(PROV, `document.getElementById('ex-close').click(), 1`);
        await c.setFiles(null, '#cb-input', [report]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await sleep(1000);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && /databaser hittades/.test(document.getElementById('ex-status').textContent) && document.getElementById('ex-status').textContent.includes(${JSON.stringify(path.basename(report))})`, 300000, 'rapporten');
        const status = await c.ev(PROV, `document.getElementById('ex-status').textContent`);
        expect(/20 SSRM-filer, 40 filer med batterihistorik/.test(status), 'Loggarna: ' + status);
        return status.split(' · ').slice(-1)[0];
    }];
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
    const gap = ['Kamerabilden från december: batterihistoriken har ett hål där, och faktorn säger det', async ({ c }) => {
        const r = await assess(c, '20251204_121339.jpg');
        expect(r.factors.camera.state === 'missing', 'Kamera: ' + JSON.stringify(r.factors.camera));
        expect(/utanför usagestats:s täckning/.test(r.factors.camera.text), 'usagestats: ' + r.factors.camera.text);
        expect(/Batterihistoriken har inga rader från 2025-12-02 [\d:]+ UTC till 2025-12-12 [\d:]+ UTC\./.test(r.factors.camera.text), 'Hålet: ' + r.factors.camera.text);
        expect(!r.warnings.some((w) => /Wellbeing/.test(w)), 'Varningarna: ' + r.warnings);
        return 'hål 2 till 12 december';
    }];
    const speed = ['En ny fråga om samma fil läser inte om loggarna', async ({ c }) => {
        const t0 = Date.now();
        await assess(c, '20260312_133111.jpg');
        const ms = Date.now() - t0;
        expect(ms < 8000, 'Tog ' + ms + ' ms');
        return ms + ' ms';
    }];
    return [open, camera, shot, gap, speed];
}

module.exports = { scenarios, assess };
