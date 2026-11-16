// Facit mot laborationen Snapchat Memories på labbtelefonen (2026-11-16): Härkomst bedömer Snapchats filer i galleriet
// ur två hela extraktioner, före och efter en ominstallation, och det som programmet säger jämförs med vad som gjordes.
// Körs bara när zipparna finns (FT_LAB_MEMORIES_DIR, annars ~/Documents/Exampleextractions). Läser bara zipparna.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sleep } = require('./cdp');
const { expect, PROV } = require('./smoke');

const facit = require('./facit/lab-snapchat-memories-oneplus.json');

function zipsIn(dir) {
    const d = dir || process.env.FT_LAB_MEMORIES_DIR || path.join(os.homedir(), 'Documents', facit.dir);
    const out = {};
    for (const [k, rel] of Object.entries(facit.zips)) {
        const p = path.join(d, rel);
        if (!fs.existsSync(p)) return null;
        out[k] = p;
    }
    return out;
}

async function openZip(c, zip) {
    await c.nav('Härkomst');
    await c.ev(PROV, `document.getElementById('ex-close') && document.getElementById('ex-close').click(), 1`);
    await c.setFiles(null, '#cb-input', [zip]);
    await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
    await c.waitFor(PROV, `!ProvenanceApp.busy() && /databaser hittades/.test(document.getElementById('ex-status').textContent) && document.getElementById('ex-status').textContent.includes(${JSON.stringify(path.basename(zip))})`, 300000, path.basename(zip));
}

async function assess(c, name) {
    await c.ev(PROV, `document.getElementById('filename').value = ${JSON.stringify(name)}, document.getElementById('run').click(), 1`);
    await sleep(300);
    await c.waitFor(PROV, `!ProvenanceApp.busy() && (!document.getElementById('result').classList.contains('display-none') || !document.getElementById('hits').classList.contains('display-none') || /warn|err/.test(document.getElementById('run-status').innerHTML))`, 300000, name);
    return c.ev(PROV, `(function(){
        const hits = !document.getElementById('hits').classList.contains('display-none') ? Array.from(document.querySelectorAll('#hits tr.pick')).map(tr => tr.innerText) : null;
        const m = ProvenanceApp.model();
        if (hits) return { hits };
        if (!m || m.file.filename !== ${JSON.stringify(name)}) return { error: document.getElementById('run-status').innerText };
        const mem = m.file.memory;
        return { importerFrom: m.file.importerFrom || null,
            memory: mem ? { id: mem.id, by: mem.by, copy: mem.copy, front: mem.front, capturedMs: mem.capturedMs, synced: !!(mem.origin && mem.origin.synced), meo: !!mem.meo, imports: (mem.imports || []).map(i => i.id) } : null,
            imports: (m.file.memoryImports || []).map(i => i.id),
            factors: Object.fromEntries(m.factors.map(f => [f.id, { state: f.state, verdict: f.verdict, text: f.items.map(i => i.text).join(' | ') }])) };
    })()`);
}

function check(f, d) {
    expect(!d.error, f.name + ': ' + d.error);
    expect(!d.hits, f.name + ' gav en vallista');
    const m = d.memory;
    if (f.memory || f.copy || f.meo || f.synced) expect(m, 'Ingen koppling till Memories');
    if (f.memory) expect(String(m.id).startsWith(f.memory), 'Snappen: ' + m.id + ', facit ' + f.memory);
    if (f.by) expect(m.by === f.by, 'Kopplingen: ' + m.by + ', facit ' + f.by);
    if (f.copy) expect(m.copy === f.copy, 'Kopian: ' + m.copy + ', facit ' + f.copy);
    if (f.front != null) expect(m.front === f.front, 'Kameran: ' + (m.front ? 'fram' : 'bak'));
    if (f.meo) expect(m.meo, 'My Eyes Only syns inte');
    if (f.synced) expect(m.synced, 'Raden är inte märkt som hämtad från servern');
    if (f.capturedBetween) {
        const [a, b] = f.capturedBetween.map(Date.parse);
        expect(m.capturedMs >= a && m.capturedMs <= b, 'Tagen ' + new Date(m.capturedMs).toISOString() + ', utanför stegets tid ' + f.capturedBetween.join(' – '));
    }
    (f.imports || []).forEach((id) => expect((m ? m.imports : d.imports).some((x) => String(x).startsWith(id)) || d.imports.some((x) => String(x).startsWith(id)), 'Snapchats egen post ur kamerarullen ' + id + ' saknas'));
    if (f.importer) expect(d.importerFrom === f.importer, 'Skaparappen härleddes inte ur namnet');
    Object.entries(f.factors || {}).forEach(([id, st]) => expect(d.factors[id] && d.factors[id].state === st, 'Faktorn ' + id + ' är ' + (d.factors[id] && d.factors[id].state) + ', väntat ' + st));
    if (f.verdict) ['app', 'camera'].forEach((id) => expect(d.factors[id].verdict === f.verdict && /package-restrictions\.xml/.test(d.factors[id].text), 'Faktorn ' + id + ' säger inte att loggarna rensades: ' + d.factors[id].verdict));
    expect(d.factors.time.text.includes(facit.setting), 'Inställningen ' + facit.setting + ' står inte i Skapandetid');
    return f.step + (m ? ', snap ' + String(m.id).slice(0, 8) + (m.copy ? ', ' + m.copy : '') : '');
}

function scenarios(zips) {
    const out = [];
    const opened = {};
    const ensure = async (c, key) => {
        if (opened.current === key) return;
        opened.before = opened.before || {};
        opened.before[key] = fs.statSync(zips[key]);
        await openZip(c, zips[key]);
        opened.current = key;
    };
    for (const f of facit.files) out.push([f.zip + ' ' + f.name + ': ' + f.what, async ({ c }) => { await ensure(c, f.zip); return check(f, await assess(c, f.name)); }]);
    for (const s of facit.searches) out.push([s.zip + ' sök ' + s.id + ': ' + s.what, async ({ c }) => {
        await ensure(c, s.zip);
        const d = await assess(c, s.id);
        expect(d.hits, 'Ingen vallista: ' + (d.error || 'filen bedömdes direkt'));
        s.paths.forEach((p) => expect(d.hits.some((h) => h.includes(p)), p + ' saknas i listan'));
        expect(d.hits.every((h) => h.split('\t').length > 3), 'Kolumnen Varför saknas');
        return d.hits.length + ' filer';
    }]);
    out.push(['Zipparna är orörda', async () => {
        Object.entries(opened.before || {}).forEach(([k, b]) => {
            const a = fs.statSync(zips[k]);
            expect(b.size === a.size && b.mtimeMs === a.mtimeMs && b.ctimeMs === a.ctimeMs, k + ': storlek, mtime eller ctime har ändrats');
        });
        return Object.keys(opened.before || {}).join(', ');
    }]);
    return out;
}

module.exports = { scenarios, zipsIn, facit };
