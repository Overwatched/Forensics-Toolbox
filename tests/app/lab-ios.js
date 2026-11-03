// Kontrollerna mot iOS-labbtelefonen: zippen och nyckelringen väljs tillsammans i raden högst upp,
// Härkomst bedömer filerna och kopplingen till Signal och WhatsApp jämförs med det som står i
// facit/lab-ios-signal-whatsapp.json. Körs bara när labbmappen finns. Läser bara filerna.
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
        return { T: m.file.createdMs, type: m.type.label, factors: f, versions: ProvenanceApp.meta().appVersionsText || '',
            events: m.events.filter(e => /^(sig|wa)-/.test(e.kind)).map(e => ({ kind: e.kind, isFile: !!e.isFile, near: !!e.near, messageId: e.messageId, ms: e.ms, own: !!e.own })) };
    })()`);
}

function check(f, d) {
    const tol = facit.toleranceMs;
    expect(!d.error, f.name + ': ' + d.error);
    if (f.T) expect(d.T != null && Math.abs(d.T - ms(f.T)) <= tol, 'T: ' + iso(d.T) + ', väntat ' + f.T);
    Object.keys(f.factors || {}).forEach((id) => expect(d.factors[id] && d.factors[id].state === f.factors[id], 'Faktorn ' + id + ' är ' + JSON.stringify(d.factors[id]) + ', väntat ' + f.factors[id]));
    Object.keys(f.verdicts || {}).forEach((id) => expect(d.factors[id] && d.factors[id].verdict === f.verdicts[id], 'Svaret för ' + id + ' är ' + JSON.stringify(d.factors[id] && d.factors[id].verdict) + ', väntat ' + f.verdicts[id]));
    if (f.whatsapp) {
        const e = d.events.find((x) => x.kind === 'wa-message' && x.isFile);
        expect(e, 'Inget WhatsApp-meddelande är märkt som filens');
        expect(e.messageId === f.whatsapp.messageId, 'WhatsApp-meddelandet är ' + e.messageId + ', väntat ' + f.whatsapp.messageId);
        expect(e.own === (f.whatsapp.direction === 'out'), 'Riktningen i WhatsApp');
        expect(Math.abs(e.ms - ms(f.whatsapp.at)) <= tol, 'WhatsApp-meddelandets tid ' + iso(e.ms) + ', väntat ' + f.whatsapp.at);
    }
    if (f.nearby) {
        const e = d.events.find((x) => x.kind === 'wa-message' && x.near);
        expect(e && e.messageId === f.nearby.messageId, 'Den möjliga kopplingen är ' + (e ? e.messageId : 'ingen') + ', väntat ' + f.nearby.messageId);
        expect(Math.abs(e.ms - d.T - f.nearby.afterMs) <= tol, 'Meddelandet ' + (e.ms - d.T) + ' ms efter T, väntat ' + f.nearby.afterMs);
    }
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
