// Facit mot labben Tor Browser (OnePlus, Android 13, 2026-11-21): Telefonen visar det som finns kvar efter Quit
// (bokmärket, nedladdningen i MediaStore, Tors state-fil och fenix_preferences.xml), inga besök, och Härkomst säger att
// filen i Download laddades ner i Tor Browser utan adress. Körs bara när zippen finns. Läser bara zippen.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { expect, PROV } = require('./smoke');
const { labPath } = require('./lab-paths');
const facit = require('./facit/lab-tor-oneplus.json');

function zipPath() {
    const p = process.env.FT_LAB_TOR_ZIP || labPath(path.join(facit.dir, facit.zip));
    return fs.existsSync(p) ? p : null;
}

const CHAT = 'chats/index.html';
const between = (ms, pair) => ms >= Date.parse(pair[0]) && ms <= Date.parse(pair[1]);

function scenarios(zip) {
    let before = null;
    const open = async (c) => {
        before = before || fs.statSync(zip);
        await c.nav('Härkomst');
        await c.ev(PROV, `document.getElementById('ex-close') && document.getElementById('ex-close').click(), 1`);
        await c.setFiles(null, '#cb-input', [zip]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && document.getElementById('ex-status').textContent.includes(${JSON.stringify(path.basename(zip))}) && /databas(er)? hittades/.test(document.getElementById('ex-status').textContent)`, 300000, path.basename(zip));
    };
    const b = facit.browser;
    return [
        ['Telefonen: ' + b.name + ' med bokmärket, nedladdningen ur MediaStore och Om appen, utan besök', async ({ c }) => {
            await open(c);
            await c.nav('Chattar');
            await c.waitFor(CHAT, `!ChatsApp.busy() && ChatsApp.device().web && ChatsApp.device().web.state === 'ready'`, 300000, 'webbhistoriken');
            const r = await c.ev(CHAT, `(function(){ const w = ChatsApp.state().web, x = w.browsers.find(y => y.id === ${JSON.stringify(b.id)}); return x && { name: x.name, errors: w.errors,
                visits: x.visits.length, bookmarks: x.bookmarks.map(y => ({ title: y.title, url: y.url, ms: y.ms })), downloads: (x.downloads || []).map(y => ({ name: y.name, ms: y.ms, url: y.url, store: !!y.fromStore })),
                about: Object.fromEntries(x.about.map(y => [y.label, y.ms != null ? new Date(y.ms).toISOString() : y.value])), thumbs: (x.thumbs || []).length }; })()`);
            expect(r && r.name === b.name && !r.errors.length, 'Webbläsaren: ' + JSON.stringify(r));
            expect(r.visits === b.visits, 'Besök: ' + r.visits);
            b.bookmarks.forEach((f) => expect(r.bookmarks.some((x) => x.title === f.title && x.url === f.url && between(x.ms, f.addedBetween)), 'Bokmärket ' + f.url + ': ' + JSON.stringify(r.bookmarks)));
            b.downloads.forEach((f) => expect(r.downloads.some((x) => x.name === f.name && x.store && !x.url && between(x.ms, f.addedBetween)), 'Nedladdningen ' + f.name + ': ' + JSON.stringify(r.downloads)));
            Object.entries(b.about).forEach(([label, want]) => {
                const got = r.about[label];
                expect(got !== undefined, label + ' saknas: ' + JSON.stringify(r.about));
                expect(/T\d\d:/.test(want) ? Date.parse(got) === Date.parse(want) : got === want, label + ': ' + got + ', facit ' + want);
            });
            expect(r.thumbs === b.thumbs, 'Flikbilder: ' + r.thumbs);
            return r.bookmarks.length + ' bokmärke, ' + r.downloads.length + ' nedladdning, ' + Object.keys(r.about).length + ' rader i Om appen, ' + r.visits + ' besök';
        }],
        ['Härkomst: ' + facit.provenance.file + ' laddades ner i Tor Browser, utan adress', async ({ c }) => {
            await open(c);
            await c.ev(PROV, `document.getElementById('filename').value = ${JSON.stringify(facit.provenance.file)}, document.getElementById('run').click(), 1`);
            await c.waitFor(PROV, "!window.ProvenanceApp.busy() && !document.getElementById('result').classList.contains('display-none') && !!window.ProvenanceApp.model()", 300000, facit.provenance.file);
            const w = await c.ev(PROV, `(function(){ const f = ProvenanceApp.model().factors.find(x => x.id === 'web'); return f && { verdict: f.verdictText, text: f.items.map(i => i.text).join(' | ') }; })()`);
            expect(w && w.verdict === facit.provenance.verdict && /download_uri och referer_uri i MediaStore är tomma/.test(w.text) && /privat läge/.test(w.text), 'Webbläsaren: ' + JSON.stringify(w));
            return w.verdict;
        }],
        ['Zippen är orörd (Tor)', async () => {
            const after = fs.statSync(zip);
            expect(before && before.size === after.size && before.mtimeMs === after.mtimeMs, 'Zippen ändrades');
            return 'orörd';
        }],
    ];
}

module.exports = { scenarios, zipPath, facit };
