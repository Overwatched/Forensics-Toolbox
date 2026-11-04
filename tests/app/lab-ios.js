// Kontrollerna mot iOS-labbtelefonen: zippen och nyckelringen väljs tillsammans i raden högst upp,
// Härkomst bedömer filerna och kopplingen till Signal, WhatsApp och Telegram jämförs med det som står
// i facit/lab-ios-signal-whatsapp.json. Körs bara när labbmappen finns. Läser bara filerna.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const facit = require('./facit/lab-ios-signal-whatsapp.json');
const { sleep } = require('./cdp');
const { expect, PROV } = require('./smoke');

const ms = (iso) => Date.parse(iso);
const iso = (t) => t == null ? 'saknas' : new Date(t).toISOString();

// Zippen och nyckelringen i labbmappen, en av varje. Namnen bär telefonens enhets-id och står därför
// inte i facit.
function labFiles(dir) {
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { return null; }
    const one = (re) => { const m = names.filter((n) => re.test(n)); return m.length === 1 ? path.join(dir, m[0]) : null; };
    const zip = one(/_fs\.zip$/);
    const keychain = one(/_keychain\.plist$/);
    return zip && keychain ? { zip, keychain } : null;
}

async function assess(c, name) {
    await c.ev(PROV, `document.getElementById('filename').value = ${JSON.stringify(name)}, document.getElementById('run').click(), 1`);
    await sleep(300);
    await c.waitFor(PROV, `!ProvenanceApp.busy() && (!document.getElementById('result').classList.contains('display-none') || !document.getElementById('hits').classList.contains('display-none') || /warn|err/.test(document.getElementById('run-status').innerHTML))`, 180000, name);
    return c.ev(PROV, `(function(){
        const m = ProvenanceApp.model();
        if (!m || m.file.filename !== ${JSON.stringify(name)}) return { error: document.getElementById('run-status').innerText };
        const f = Object.fromEntries(m.factors.map(x => [x.id, { state: x.state, verdict: x.verdictText || '' }]));
        const cam = m.factors.find(x => x.id === 'camera');
        return { T: m.file.createdMs, type: m.type.label, factors: f, titles: Object.fromEntries(m.factors.map(x => [x.id, x.title])), versions: ProvenanceApp.meta().appVersionsText || '',
            cameraText: cam ? cam.items.map(i => i.text).join(' ') : '',
            events: m.events.filter(e => /^(sig|wa|tg)-/.test(e.kind)).map(e => ({ kind: e.kind, isFile: !!e.isFile, near: !!e.near, messageId: e.messageId, ms: e.ms, own: !!e.own, viewOnce: !!e.viewOnce })) };
    })()`);
}

function check(f, d) {
    const tol = facit.toleranceMs;
    expect(!d.error, f.name + ': ' + d.error);
    if (f.T) expect(d.T != null && Math.abs(d.T - ms(f.T)) <= tol, 'T: ' + iso(d.T) + ', väntat ' + f.T);
    Object.keys(f.factors || {}).forEach((id) => expect(d.factors[id] && d.factors[id].state === f.factors[id], 'Faktorn ' + id + ' är ' + JSON.stringify(d.factors[id]) + ', väntat ' + f.factors[id]));
    Object.keys(f.verdicts || {}).forEach((id) => expect(d.factors[id] && d.factors[id].verdict === f.verdicts[id], 'Svaret för ' + id + ' är ' + JSON.stringify(d.factors[id] && d.factors[id].verdict) + ', väntat ' + f.verdicts[id]));
    // Meddelandet som är märkt som filens, och den möjliga kopplingen, i WhatsApp och Telegram.
    const linked = (want, kind, app) => {
        if (!want) return;
        const e = d.events.find((x) => x.kind === kind && x.isFile);
        expect(e, 'Inget ' + app + '-meddelande är märkt som filens');
        expect(e.messageId === want.messageId, app + '-meddelandet är ' + e.messageId + ', väntat ' + want.messageId);
        expect(e.own === (want.direction === 'out'), 'Riktningen i ' + app);
        expect(Math.abs(e.ms - ms(want.at)) <= tol, app + '-meddelandets tid ' + iso(e.ms) + ', väntat ' + want.at);
        if (want.viewOnce) expect(e.viewOnce, app + '-meddelandet är inte märkt för engångsvisning');
    };
    const nearby = (want, kind, app) => {
        if (!want) return;
        const e = d.events.find((x) => x.kind === kind && x.near);
        expect(e && e.messageId === want.messageId, 'Den möjliga kopplingen i ' + app + ' är ' + (e ? e.messageId : 'ingen') + ', väntat ' + want.messageId);
        expect(Math.abs(e.ms - d.T - want.afterMs) <= tol, 'Meddelandet ' + (e.ms - d.T) + ' ms efter T, väntat ' + want.afterMs);
    };
    linked(f.whatsapp, 'wa-message', 'WhatsApp');
    linked(f.telegram, 'tg-message', 'Telegram');
    nearby(f.nearby, 'wa-message', 'WhatsApp');
    nearby(f.telegramNearby, 'tg-message', 'Telegram');
    if (f.cameraTitle) expect(d.titles.camera === f.cameraTitle, 'Kamerafaktorn heter ' + d.titles.camera + ', väntat ' + f.cameraTitle);
    if (f.cameraText) expect(new RegExp(f.cameraText).test(d.cameraText), 'Kamerafaktorn säger: ' + d.cameraText);
    if (f.typeLabel) expect(d.type === f.typeLabel, 'Typen är ' + d.type);
    (facit.versions || []).forEach((v) => expect(d.versions.includes(v), 'Appversionen ' + v + ' saknas i protokollet: ' + d.versions));
    return 'T ' + (d.T ? iso(d.T).slice(11, 23) + 'Z' : '–');
}

function scenarios(dir) {
    const { zip, keychain } = labFiles(dir);
    const zipName = path.basename(zip);
    const stats = () => [zip, keychain].map((p) => { const s = fs.statSync(p); return [s.size, s.mtimeMs, s.ctimeMs].join('/'); }).join(' ');
    let before = null;
    const open = ['Labbzippen och nyckelringen öppnas tillsammans i Härkomst', async ({ c }) => {
        before = stats();
        await c.nav('Härkomst');
        await c.setFiles(null, '#cb-input', [zip, keychain]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && /databaser hittades/.test(document.getElementById('ex-status').textContent) && document.getElementById('ex-status').textContent.includes(${JSON.stringify(zipName)})`, 300000, 'labbzippen');
        const note = await c.waitFor(PROV, `/Nyckeln läses ur/.test(document.getElementById('signal-key-note').textContent) && document.getElementById('signal-key-note').textContent`, 20000, 'nyckelringen');
        expect(note.includes(path.basename(keychain)), 'Nyckelns källa: ' + note);
        return 'zippen och nyckelringen';
    }];
    const files = facit.files.map((f) => [f.name + ': ' + f.what, async ({ c }) => check(f, await assess(c, f.name))]);
    const untouched = ['Labbzippen och nyckelringen är orörda', async () => {
        expect(before && before === stats(), 'Storlek, mtime eller ctime har ändrats');
        return 'storlek, mtime och ctime';
    }];
    return [open].concat(files, [untouched]);
}

module.exports = { scenarios, labFiles };
