// Facit mot laborationerna Snapchat Memories: Härkomst bedömer Snapchats filer i galleriet och sparade snaps på sitt id,
// och det som programmet säger jämförs med vad som gjordes. OnePlus (Android, 2026-11-16): två hela extraktioner, före och
// efter en ominstallation, i FT_LAB_MEMORIES_DIR. iPhone (iOS, 2026-11-19): en hel extraktion efter två laborationer, i
// FT_LAB_MEMORIES_IOS_DIR. Annars mappen i facit (dir) under "1 Labbar", se lab-paths.js.
// Körs bara när zipparna finns. Läser bara zipparna.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sleep } = require('./cdp');
const { expect, PROV } = require('./smoke');

const { labPath } = require('./lab-paths');
const facitAndroid = require('./facit/lab-snapchat-memories-oneplus.json');
const facitIos = require('./facit/lab-snapchat-memories-iphone.json');

function zipsIn(dir, facit) {
    facit = facit || facitAndroid;
    const d = dir || (facit === facitIos ? process.env.FT_LAB_MEMORIES_IOS_DIR : process.env.FT_LAB_MEMORIES_DIR)
        || labPath(facit.dir);
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
        // Ett snap-id bedömer snappens fil i cachen, som har ett annat namn.
        const byId = m && m.file.memory && String(m.file.memory.id).toUpperCase().indexOf(${JSON.stringify(name.toUpperCase())}) === 0;
        if (!m || (m.file.filename !== ${JSON.stringify(name)} && !byId)) return { error: document.getElementById('run-status').innerText };
        const mem = m.file.memory;
        return { importerFrom: m.file.importerFrom || null,
            memory: mem ? { id: mem.id, by: mem.by, copy: mem.copy, front: mem.front, capturedMs: mem.capturedMs, savedMs: mem.savedMs, video: !!mem.video, sends: (mem.sends || []).length,
                synced: !!(mem.origin && mem.origin.synced), meo: !!mem.meo, imports: (mem.imports || []).map(i => i.id) } : null,
            imports: (m.file.memoryImports || []).map(i => i.id),
            factors: Object.fromEntries(m.factors.map(f => [f.id, { state: f.state, verdict: f.verdict, text: f.items.map(i => i.text).join(' | ') }])) };
    })()`);
}

function check(f, d, facit) {
    expect(!d.error, f.name + ': ' + d.error);
    expect(!d.hits, f.name + ' gav en vallista');
    const m = d.memory;
    if (f.memory || f.copy || f.meo || f.synced) expect(m, 'Ingen koppling till Memories');
    if (f.memory) expect(String(m.id).startsWith(f.memory), 'Snappen: ' + m.id + ', facit ' + f.memory);
    if (f.by) expect(m.by === f.by, 'Kopplingen: ' + m.by + ', facit ' + f.by);
    if (f.copy) expect(m.copy === f.copy, 'Kopian: ' + m.copy + ', facit ' + f.copy);
    if (f.front != null) expect(m.front === f.front, 'Kameran: ' + (m.front ? 'fram' : 'bak'));
    if (f.video != null) expect(m.video === f.video, 'Sorten: ' + (m.video ? 'video' : 'bild'));
    if (f.sends != null) expect(m.sends === f.sends, 'Skickade snaps med samma bild: ' + m.sends + ', facit ' + f.sends);
    if (f.savedBetween) {
        const [a, b] = f.savedBetween.map(Date.parse);
        expect(m.savedMs >= a && m.savedMs <= b, 'Sparad ' + new Date(m.savedMs).toISOString() + ', utanför ' + f.savedBetween.join(' – '));
    }
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

function scenarios(zips, facit) {
    facit = facit || facitAndroid;
    const out = [];
    const opened = {};
    const ensure = async (c, key) => {
        if (opened.current === key) return;
        opened.before = opened.before || {};
        opened.before[key] = fs.statSync(zips[key]);
        await openZip(c, zips[key]);
        opened.current = key;
    };
    for (const f of facit.files) out.push([f.zip + ' ' + f.name + ': ' + f.what, async ({ c }) => { await ensure(c, f.zip); return check(f, await assess(c, f.name), facit); }]);
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

module.exports = { scenarios, zipsIn, facit: facitAndroid, facitIos };
