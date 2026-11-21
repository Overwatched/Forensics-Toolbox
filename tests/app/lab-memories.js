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
        // Telefonens namn snapchat-memory-<snap-id>.<ändelse> söks på id:t.
        const byId = m && m.file.memory && String(m.file.memory.id).toUpperCase().indexOf(${JSON.stringify(name.toUpperCase().replace(/^SNAPCHAT-MEMORY-/, '').replace(/\.[A-Z0-9]+$/, ''))}) === 0;
        if (!m || (m.file.filename !== ${JSON.stringify(name)} && !byId)) return { error: document.getElementById('run-status').innerText };
        const mem = m.file.memory;
        const meta = ProvenanceApp.meta && ProvenanceApp.meta();
        return { importerFrom: m.file.importerFrom || null, content: (meta && meta.fileEntry && meta.fileEntry.contentNote) || null,
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
    if (f.decrypted) expect(d.content && d.content.includes(f.decrypted), 'Innehållet dekrypterades inte: ' + d.content);
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
    // Telefonen: Snapchat öppnas via sökningen (appen ligger ofta på en annan sida av hemskärmen).
    const PH = 'chats/index.html';
    const snapchatApp = async (c) => {
        await c.nav('Telefonen');
        await c.waitFor(PH, `ChatsApp.state().device.info && ChatsApp.state().device.info.state === 'ready'`, 180000, 'telefonen');
        await c.ev(PH, `document.querySelector('[data-device-search]').click(), 1`);
        await sleep(300);
        await c.ev(PH, `(function(){ const i = document.querySelector('#c-device-body .d-q'); i.value = 'Snapchat'; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
        await c.waitFor(PH, `!!document.querySelector('#c-device-body [data-device-app="Snapchat"]')`, 30000, 'Snapchat i sökningen');
        await c.ev(PH, `document.querySelector('#c-device-body [data-device-app="Snapchat"]').click(), 1`);
    };
    if (facit.phone) out.push([facit.phone.zip + ' Telefonen: ' + facit.phone.what, async ({ c }) => {
        await ensure(c, facit.phone.zip);
        await snapchatApp(c);
        await c.waitFor(PH, `!!document.querySelector('[data-device-memories]')`, 120000, 'länken Memories');
        await c.ev(PH, `document.querySelector('[data-device-memories]').click(), 1`);
        const r = await c.waitFor(PH, `(function(){ const t = document.querySelectorAll('.m-tile').length, d = [...document.querySelectorAll('.m-img')].filter(x => x.style.backgroundImage || x.querySelector('video')).length;
            return t && d >= ${facit.phone.drawn} && { tiles: t, drawn: d, locked: document.querySelectorAll('.m-img.locked').length, meo: document.querySelectorAll('.m-tile.meo').length, map: (document.querySelector('[data-memories-map]') || {}).textContent || '' }; })()`, 120000, 'Memories ritade');
        expect(r.tiles === facit.phone.memories && r.meo === facit.phone.meo && r.locked === (facit.phone.locked != null ? facit.phone.locked : facit.phone.meo) && r.map.includes('(' + facit.phone.located + ')'), 'Memories: ' + JSON.stringify(r));
        // En snap i My Eyes Only: bilden visas, och Bedöm i Härkomst och den dekrypterade filen (som från EXIF) ger snappen där.
        let meoDone = '';
        if (facit.phone.meoOpen) {
            const id = facit.phone.meoOpen;
            await c.ev(PH, `[...document.querySelectorAll('.m-tile.meo')].find(t => t.dataset.memoryId.startsWith(${JSON.stringify(id)})).click(), 1`);
            const img = await c.waitFor(PH, `(function(){ const i = document.querySelector('#m-view img'); return i && i.naturalWidth > 0 && i.naturalWidth; })()`, 30000, 'bilden i My Eyes Only');
            const full = await c.ev(PH, `document.querySelector('[data-memory-assess]').dataset.memoryAssess`);
            await c.ev(PH, `document.querySelector('[data-memory-assess]').click(), 1`);
            const viaButton = await c.waitFor(PROV, `(function(){ const m = ProvenanceApp.model(); return !ProvenanceApp.busy() && m && m.file.memory && m.file.memory.id === ${JSON.stringify(full)} && !!m.file.memory.meo; })()`, 120000, 'Bedöm i Härkomst');
            await c.ev('exif-viewer/index.html', `window.parent.postMessage({ source: 'forensics-toolbox', type: 'file-for', to: 'provenance', files: [{ file: new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], 'snapchat-memory-' + ${JSON.stringify(full)} + '.jpg') }] }, '*'), 1`).catch(async () => {
                await c.nav('EXIF'); await sleep(500);
                return c.ev('exif-viewer/index.html', `window.parent.postMessage({ source: 'forensics-toolbox', type: 'file-for', to: 'provenance', files: [{ file: new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], 'snapchat-memory-' + ${JSON.stringify(full)} + '.jpg') }] }, '*'), 1`);
            });
            await sleep(800);
            const viaFile = await c.waitFor(PROV, `(function(){ const m = ProvenanceApp.model(); return !ProvenanceApp.busy() && document.getElementById('filename').value === ${JSON.stringify(full)} && m && m.file.memory && m.file.memory.id === ${JSON.stringify(full)}; })()`, 120000, 'den dekrypterade filen i Härkomst');
            expect(img > 0 && viaButton && viaFile, 'My Eyes Only: ' + JSON.stringify({ img, viaButton, viaFile }));
            meoDone = ', snappen i My Eyes Only visas och bedöms i Härkomst';
        }
        return r.tiles + ' minnen, ' + r.drawn + ' dekrypterade, ' + r.meo + ' i My Eyes Only' + meoDone;
    }]);
    if (facit.meo) out.push([facit.meo.zip + ' Telefonen: ' + facit.meo.what, async ({ c }) => {
        await ensure(c, facit.meo.zip);
        await snapchatApp(c);
        await c.waitFor(PH, `!!document.querySelector('[data-app-info="Snapchat"]')`, 120000, 'Inställningar i Snapchat');
        await c.ev(PH, `document.querySelector('[data-app-info="Snapchat"]').click(), 1`);
        await c.waitFor(PH, `!!document.querySelector('[data-meo-crack]')`, 60000, 'raden My Eyes Only');
        await c.ev(PH, `document.querySelector('[data-meo-crack]').click(), 1`);
        await c.waitFor(PH, `(function(){ const m = ChatsApp.state().device.meo; const k = m && Object.keys(m)[0]; return k && m[k].state === 'done'; })()`, 300000, 'koden');
        const code = await c.ev(PH, `(function(){ const m = ChatsApp.state().device.meo; return m[Object.keys(m)[0]].code; })()`);
        // Koden jämförs med labbanteckningarna i labbmappen och skrivs inte ut.
        const dir = path.dirname(path.dirname(zips[facit.meo.zip]));
        const notes = fs.readdirSync(dir, { recursive: true }).filter((f) => /\.(json|txt|md)$/i.test(String(f))).map((f) => { try { return fs.readFileSync(path.join(dir, String(f)), 'utf8'); } catch (e) { return ''; } }).join('\n');
        expect(/^\d{4}$/.test(code || '') && notes.includes(code), 'Koden hittades inte, eller står inte i labbanteckningarna');
        return 'koden hittad och stämmer med labbanteckningarna';
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
