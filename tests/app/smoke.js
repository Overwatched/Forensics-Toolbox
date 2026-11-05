// Röktestet: appen startas och varje verktyg laddas, Härkomsts testdata ger resultat och protokoll,
// Queries och Härkomst läser den påhittade extraktionen (fixtures.js), en trasig -wal ger en varning
// i stället för ett stopp, en fil från disk väljer rätt rad, och HTML i filnamn och databaser skrivs
// aldrig in i sidan. Bara påhittade data, så det kan köras överallt, också i CI.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sleep } = require('./cdp');

const VERSION = /Version\s+(\d+\.\d+)/.exec(fs.readFileSync(path.join(__dirname, '..', '..', 'Toolbox.html'), 'utf8'))[1];
const PROV = 'provenance/index.html';
const QUER = 'db-queries/queries.html';

function expect(ok, msg) { if (!ok) throw new Error(msg); }

// Inget HTML ur testfilernas namn har körts, i någon ram.
async function noInjectedScript(c) {
    const frames = (await c.frames()).filter((f) => f.parentId);
    for (const f of [null].concat(frames.map((x) => x.url.split('/tools/')[1] || x.url.split('/documentation/')[1]).filter(Boolean))) {
        const hit = await c.ev(f, 'window.__ftxss || null').catch(() => null);
        expect(!hit, 'HTML ur ett filnamn kördes som skript' + (f ? ' i ' + f : ' i huvudfönstret'));
    }
}

async function factors(c) {
    return c.ev(PROV, `[...document.querySelectorAll('#factors .factor')].map(f => ({ id: f.dataset.factor, state: (f.querySelector('h3 .badge').className.match(/badge (\\w+)/) || [])[1], verdict: f.querySelector('h3 .badge').textContent }))`);
}

// Bedömer ett filnamn i Härkomst. Ger faktorerna per id, typen och chattmeddelandena som är märkta som filens.
async function assessNamed(c, name) {
    await c.ev(PROV, `document.getElementById('filename').value = ${JSON.stringify(name)}, document.getElementById('run').click(), 1`);
    await sleep(300);
    await waitResult(c, name);
    const model = await c.ev(PROV, `({ name: ProvenanceApp.model().file.filename, type: ProvenanceApp.model().type.label, files: ProvenanceApp.model().events.filter(e => e.isFile && /^(sig|wa|tg)-/.test(e.kind)).map(e => e.kind), titles: Object.fromEntries(ProvenanceApp.model().factors.map(f => [f.id, f.title])) })`);
    expect(model.name === name, 'Bedömningen gäller ' + model.name);
    return { f: Object.fromEntries((await factors(c)).map((x) => [x.id, x])), model };
}

async function waitResult(c, label) {
    await c.waitFor(PROV, "!window.ProvenanceApp.busy() && !document.getElementById('result').classList.contains('display-none') && !!window.ProvenanceApp.model()", 90000, label);
}

// Väntar på en nedladdad fil med det namnet i nedladdningsmappen.
async function download(dir, pattern, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 20000)) {
        const f = fs.readdirSync(dir).find((n) => pattern.test(n) && !/\.crdownload$/.test(n));
        if (f) { await sleep(300); return fs.readFileSync(path.join(dir, f), 'utf8'); }
        await sleep(200);
    }
    throw new Error('Ingen nedladdning som matchar ' + pattern);
}

const scenarios = [
    ['Alla verktyg laddas utan fel', async ({ c }) => {
        const items = await c.ev(null, `[...document.querySelectorAll('.nav-item[data-type="frame"]')].map(e => ({ title: (e.querySelector('.nav-item-title') || e).textContent.trim(), src: e.dataset.src }))`);
        expect(items.length >= 15, 'Bara ' + items.length + ' verktyg i sidopanelen');
        for (const it of items) {
            await c.nav(it.title);
            const part = it.src.split('?')[0].replace(/^tools\/|^documentation\//, '');
            await c.waitFor(part, 'document.readyState === "complete"', 30000, it.title + ' laddas');
        }
        return items.length + ' verktyg';
    }],

    ['Härkomst: de tre testdatan ger underlag och protokoll', async ({ c, downloads }) => {
        await c.nav('Härkomst');
        const out = [];
        for (const [btn, n] of [['fill-sample', 5], ['fill-sample-snap', 5], ['fill-sample-android', 5]]) {
            await c.ev(PROV, `document.getElementById('${btn}').click(), 1`);
            await sleep(300);
            await waitResult(c, btn);
            const f = await factors(c);
            expect(f.length >= n, btn + ': ' + f.length + ' faktorer');
            expect(f.every((x) => x.state), btn + ': faktor utan läge');
            const summary = await c.ev(PROV, `document.querySelector('#summary .summary-text').textContent`);
            expect(/förenligt|går inte att bedöma/.test(summary), btn + ': sammanvägningen saknas');
            out.push(btn.replace('fill-sample', 'testdata') + ' ' + f.map((x) => x.state).join('/'));
        }
        await c.ev(PROV, `document.getElementById('own-assessment').value = 'Provkörningens bedömning.', document.getElementById('own-assessment').dispatchEvent(new Event('input')), 1`);
        await c.ev(PROV, `document.getElementById('save-protocol').click(), 1`);
        const html = await download(downloads, /^harkomst-.*-protokoll-.*\.html$/);
        for (const want of ['Underlag för bedömning', 'Programmets sammanvägning', 'Undersökarens bedömning', 'Provkörningens bedömning.', 'Bilaga: SQL', 'Forensics Toolbox ' + VERSION + ', verktyget Härkomst']) {
            expect(html.includes(want), 'Protokollet saknar "' + want + '"');
        }
        return out.join(', ');
    }],

    ['Queries: extraktionen öppnas, en trasig -wal ger en varning och noll rader sägs ut', async ({ c, fx }) => {
        await c.nav('Queries');
        await c.waitFor(QUER, 'window.QueriesApp && QueriesApp.databases().length', 30000, 'katalogen');
        const label = await c.ev(null, `document.getElementById('cb-open').textContent`);
        expect(/extraktion eller databas/.test(label), 'Knappen högst upp heter ' + label);
        await c.setFiles(null, '#cb-input', [fx.files.zip]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await c.waitFor(QUER, `/databaser hittades/.test(document.getElementById('ex-status').textContent)`, 60000, 'zippen i Queries');
        const meta = await c.waitFor(null, `/iOS 17\\.5\\.1/.test(document.getElementById('cb-zip-meta').textContent) && document.getElementById('cb-zip-meta').textContent`, 10000, 'iOS-versionen i raden högst upp');
        expect(/iOS 17\.5\.1/.test(meta), 'iOS-versionen saknas: ' + meta);
        const fams = await c.ev(QUER, `[...document.querySelectorAll('.side-db')].map(b => b.dataset.family)`);
        expect(fams.includes('photos') && fams.includes('knowledgec'), 'Databaserna i sidopanelen: ' + fams.join(' '));

        const run = async (q) => {
            await c.ev(QUER, `(function(){ const b = document.querySelector('.side-db[data-family="knowledgec"]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); return 1; })()`);
            await c.ev(QUER, `document.querySelector('.side-q[data-db="knowledgec"][data-q="${q}"]').click(), 1`);
            await sleep(300);
            await c.ev(QUER, `document.getElementById('run-button').click(), 1`);
            await c.waitFor(QUER, `/rad(er)? på/.test(document.getElementById('run-status').textContent) || /run-warn/.test(document.getElementById('run-status').innerHTML)`, 30000, 'körningen ' + q);
            return c.ev(QUER, `({ status: document.getElementById('run-status').innerText, rows: document.querySelectorAll('#run-result tbody tr').length, empty: !!document.querySelector('#run-result .run-empty'), preview: !document.getElementById('result-preview').classList.contains('display-none') })`);
        };
        const usage = await run('app-usage');
        expect(usage.rows === 3, 'app-usage gav ' + usage.rows + ' rader: ' + usage.status);
        expect(/-wal lades inte på: Fel checksumma i -wal-huvudet/.test(usage.status), 'Varningen om -wal saknas: ' + usage.status);
        const focus = await run('app-infocus');
        expect(focus.rows === 0 && focus.empty && !focus.preview, 'Noll rader visas inte som noll: ' + JSON.stringify(focus));
        await noInjectedScript(c);
        return 'app-usage 3 rader med -wal-varning, app-infocus 0 rader';
    }],

    ['Queries: en lös databas känns igen på schemat', async ({ c, fx }) => {
        await c.setFiles(null, '#cb-input', [fx.files.knowledge]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await c.waitFor(QUER, `QueriesApp.source() && QueriesApp.source().file === 'knowledgeC.db'`, 30000, 'den lösa filen');
        const db = await c.ev(QUER, `QueriesApp.currentDb() && QueriesApp.currentDb().id`);
        expect(db === 'knowledgec', 'Kändes igen som ' + db);
        await c.ev(QUER, `document.getElementById('file-close').click(), 1`);
        return 'knowledgeC.db';
    }],

    ['Queries: ett komprimerat PowerLog-arkiv packas upp i minnet och känns igen', async ({ c, fx }) => {
        await c.setFiles(null, '#cb-input', [fx.files.powerlogArchive]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await c.waitFor(QUER, `QueriesApp.source() && /powerlog_/.test(QueriesApp.source().file || '')`, 30000, 'arkivet');
        const db = await c.ev(QUER, `QueriesApp.currentDb() && QueriesApp.currentDb().id`);
        expect(db === 'powerlog', 'Kändes igen som ' + db);
        await c.ev(QUER, `document.querySelector('.side-q[data-db="powerlog"][data-q="pl-offsets"]').click(), 1`);
        await sleep(300);
        await c.ev(QUER, `document.getElementById('run-button').click(), 1`);
        await c.waitFor(QUER, `/rad(er)? på/.test(document.getElementById('run-status').textContent) || /run-warn/.test(document.getElementById('run-status').innerHTML)`, 30000, 'körningen');
        const trace = await c.ev(QUER, `document.getElementById('run-trace').innerText`);
        expect(/gzip-komprimerad och uppackad i minnet/.test(trace), 'Spårbarheten säger inte att arkivet packades upp: ' + trace.slice(0, 300));
        await c.ev(QUER, `document.getElementById('file-close').click(), 1`);
        return 'powerlog_….PLSQL.gz';
    }],

    ['Härkomst: filen i extraktionen bedöms, och -wal-varningen följer med till protokollet', async ({ c, fx, downloads }) => {
        await c.nav('Härkomst');
        // Härkomst visar testdatan och byter inte bort den av sig själv: bytet erbjuds på en rad.
        const offer = await c.waitFor(PROV, `!document.getElementById('ex-follow').classList.contains('display-none') && document.getElementById('ex-follow').innerText`, 10000, 'erbjudandet att byta');
        expect(/Testextraktion-iOS17\.zip öppnades\./.test(offer), 'Erbjudandet: ' + offer);
        await c.ev(PROV, `document.getElementById('ex-follow-btn').click(), 1`);
        await c.waitFor(PROV, `/databaser hittades/.test(document.getElementById('ex-status').textContent)`, 60000, 'zippen i Härkomst');
        await c.ev(PROV, `document.getElementById('filename').value = '${fx.imageName}', document.getElementById('run').click(), 1`);
        await c.waitFor(PROV, `!document.getElementById('hits').classList.contains('display-none') && document.querySelectorAll('#hits tr.pick').length`, 60000, 'vallistan');
        const rows = await c.ev(PROV, `[...document.querySelectorAll('#hits tr.pick')].map(tr => tr.innerText.replace(/\\s+/g, ' '))`);
        expect(rows.length === 2, 'Vallistan har ' + rows.length + ' rader');
        await c.ev(PROV, `[...document.querySelectorAll('#hits tr.pick')].find(tr => /100APPLE/.test(tr.innerText)).click(), 1`);
        await waitResult(c, 'bedömningen');
        const f = await factors(c);
        const byId = Object.fromEntries(f.map((x) => [x.id, x.state]));
        for (const id of ['time', 'app', 'camera', 'screen', 'position']) expect(byId[id] === 'support', 'Faktorn ' + id + ' är ' + byId[id] + ' (' + JSON.stringify(f) + ')');
        const m = await c.ev(PROV, `({ T: ProvenanceApp.model().file.createdMs, warnings: ProvenanceApp.model().warnings, path: ProvenanceApp.meta().fileEntry && ProvenanceApp.meta().fileEntry.path, md5: ProvenanceApp.meta().fileEntry && ProvenanceApp.meta().fileEntry.md5 })`);
        expect(m.T === fx.T, 'T är ' + new Date(m.T).toISOString());
        expect(/100APPLE\/IMG_0001\.JPG$/.test(m.path) && /^[0-9a-f]{32}$/.test(m.md5), 'Filkortet: ' + m.path + ' ' + m.md5);
        expect(m.warnings.some((w) => /knowledgeC\.db-wal lades inte på: Fel checksumma/.test(w)), 'Varningen om knowledgeC:s -wal saknas: ' + m.warnings.join(' | '));
        await c.ev(PROV, `document.getElementById('save-protocol').click(), 1`);
        const html = await download(downloads, /^harkomst-IMG_0001-protokoll-.*\.html$/);
        expect(/knowledgeC\.db-wal lades inte på/.test(html), 'Protokollet saknar -wal-varningen');
        expect(html.includes('Testextraktion-iOS17.zip') && html.includes('iOS 17.5.1'), 'Protokollet saknar extraktionen eller versionen');
        return 'T ' + new Date(m.T).toISOString() + ', fem faktorer förenliga';
    }],

    ['Härkomst: tabellen över filens tider har källor, och valet av zon ändrar inte slutsatsen', async ({ c, fx }) => {
        const read = () => c.ev(PROV, `(function(){
            const f = ProvenanceApp.model().factors.find(x => x.id === 'time');
            return { state: f.state, verdict: f.verdict, rows: f.times.map(r => [r.id, r.ms]), cells: [...document.querySelectorAll('.factor-times table.times tbody tr')].map(tr => tr.innerText.replace(/\\s+/g, ' ')),
                t: document.querySelector('.factor-times tr.time-t') && document.querySelector('.factor-times tr.time-t').innerText, head: document.querySelector('.factor-times th').innerText, link: !!document.querySelector('.factor-times .to-queries'),
                card: [...document.querySelectorAll('.file-facts dt')].map(d => d.textContent) };
        })()`);
        const before = await read();
        expect(before.cells.length === before.rows.length && before.rows.length >= 5, 'Tabellen: ' + JSON.stringify(before.cells));
        expect(before.rows.find((r) => r[0] === 'created')[1] === fx.T * 1000 || before.rows.find((r) => r[0] === 'created')[1] === fx.T, 'Skapad: ' + JSON.stringify(before.rows));
        expect(/Skapad enligt biblioteket \(T\)/.test(before.t), 'Raden med T: ' + before.t);
        expect(/^Tid \(/.test(before.head) && before.link, 'Rubriken eller länken: ' + before.head);
        expect(!before.card.some((x) => /Tagen|Tidszon|Skapad|Ändrad/.test(x)), 'Kortet har tider: ' + before.card);
        await c.ev(PROV, `(function(){ const s = document.getElementById('zone'); s.value = 'utc'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
        await sleep(500);
        await waitResult(c, 'bedömningen i UTC');
        const utc = await read();
        expect(utc.state === before.state && utc.verdict === before.verdict, 'I UTC: ' + utc.verdict + ', annars ' + before.verdict);
        expect(JSON.stringify(utc.rows) === JSON.stringify(before.rows), 'Tiderna flyttades med zonen');
        expect(/^Tid \(UTC\)/.test(utc.head), 'Rubriken: ' + utc.head);
        await c.ev(PROV, `(function(){ const s = document.getElementById('zone'); s.value = 'file'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
        await sleep(500);
        await waitResult(c, 'bedömningen i bildens zon');
        // Källan öppnar raden i Queries, som i händelselistan.
        const id = await c.ev(PROV, `(function(){ const b = document.querySelector('.factor-times tr.time-t .to-queries'); if (!b) return ''; b.click(); return b.innerText; })()`);
        expect(/ZDATECREATED/.test(id), 'Källan: ' + id);
        const hit = await c.waitFor(QUER, `(function(){ const row = document.querySelector('#run-result tr.row-hit'); return row && row.innerText; })()`, 60000, 'den markerade raden i Queries');
        expect(new RegExp(fx.imageName.replace('.', '\\.')).test(hit), 'Den markerade raden: ' + hit);
        await c.nav('Härkomst');
        return before.rows.length + ' rader, samma slutsats i UTC';
    }],

    ['Härkomst: en fil från disk väljer raden i rätt mapp utan vallista', async ({ c, fx }) => {
        await c.setFiles(PROV, '#disk-input', [fx.files.image]);
        await c.ev(PROV, `document.getElementById('disk-input').dispatchEvent(new Event('change')), 1`);
        await sleep(500);
        await waitResult(c, 'fil från disk');
        const st = await c.ev(PROV, `({ hits: !document.getElementById('hits').classList.contains('display-none'), pk: ProvenanceApp.model().file.pk, path: ProvenanceApp.meta().fileEntry.path })`);
        expect(!st.hits, 'Vallistan visades fast innehållet bara finns i 100APPLE');
        expect(String(st.pk) === '1' && /100APPLE/.test(st.path), 'Fel rad: ' + JSON.stringify(st));
        return 'rad 1, ' + st.path.split('/').slice(-2).join('/');
    }],

    ['Härkomst: Signal och WhatsApp på iOS, med nyckelringen bredvid zippen', async ({ c, fx }) => {
        // Nyckelringen väljs ensam i raden högst upp och följer extraktionen som redan är öppen.
        await c.setFiles(null, '#cb-input', [fx.files.keychain]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await c.waitFor(PROV, `/Nyckeln läses ur Testextraktion-iOS17_keychain\\.plist/.test(document.getElementById('signal-key-note').textContent)`, 20000, 'nyckelringen i Härkomst');
        const assessOne = async (name) => {
            await c.ev(PROV, `document.getElementById('filename').value = ${JSON.stringify(name)}, document.getElementById('run').click(), 1`);
            await sleep(300);
            await waitResult(c, name);
            const model = await c.ev(PROV, `({ name: ProvenanceApp.model().file.filename, type: ProvenanceApp.model().type.label, files: ProvenanceApp.model().events.filter(e => e.isFile && /^(sig|wa)-/.test(e.kind)).map(e => e.kind) })`);
            expect(model.name === name, 'Bedömningen gäller ' + model.name);
            return { f: Object.fromEntries((await factors(c)).map((x) => [x.id, x])), model };
        };
        // Sparad ur Signal: samma bytes som den mottagna bilagan i den krypterade databasen.
        const sig = await assessOne('IMG_0006.JPG');
        expect(sig.f.signal && sig.f.signal.state === 'support' && /Mottagen i Signal/.test(sig.f.signal.verdict), 'Signal: ' + JSON.stringify(sig.f.signal));
        expect(sig.model.files.includes('sig-message'), 'Meddelandet i Signal är inte märkt som filens');
        // Vald ur bildbiblioteket och skickad i WhatsApp: bibliotekets id i mediefilens metadata.
        const lib = await assessOne('IMG_0005.JPG');
        expect(lib.f.whatsapp && lib.f.whatsapp.state === 'info' && /Skickad i WhatsApp/.test(lib.f.whatsapp.verdict), 'WhatsApp: ' + JSON.stringify(lib.f.whatsapp));
        // WhatsApps egen mottagna fil under Message/: prövas som mottagen, och kameran frågas inte.
        const own = await assessOne(fx.waMedia);
        expect(own.f.whatsapp && own.f.whatsapp.state === 'support', 'WhatsApps fil: ' + JSON.stringify(own.f.whatsapp));
        expect(own.f.camera && own.f.camera.state === 'na', 'Kameran för WhatsApps fil: ' + JSON.stringify(own.f.camera));
        expect(/WhatsApp-media/.test(own.model.type), 'Typen: ' + own.model.type);
        await noInjectedScript(c);
        return 'Signal förenligt, WhatsApp skickad och mottagen';
    }],

    ['Härkomst: Telegram på iOS, med en bild ur bildbiblioteket, Telegrams kamera och Telegrams egen fil', async ({ c, fx }) => {
        // Vald ur bildbiblioteket och skickad: lagringsdatabasens ph-<ZUUID> och en bild av samma storlek.
        const lib = await assessNamed(c, 'IMG_0007.JPG');
        expect(lib.f.telegram && lib.f.telegram.state === 'info' && /Skickad i Telegram/.test(lib.f.telegram.verdict), 'Telegram: ' + JSON.stringify(lib.f.telegram));
        expect(lib.model.files.includes('tg-message'), 'Meddelandet i Telegram är inte märkt som filens');
        // Telegrams kamera: originalnamnet camphoto_… och samma fil kvar i Telegrams tmp/.
        const cam = await assessNamed(c, 'IMG_0008.JPG');
        expect(cam.model.titles.camera === 'Telegrams kamera' && cam.f.camera && cam.f.camera.state === 'support', 'Kameran: ' + JSON.stringify(cam.f.camera) + ' ' + cam.model.titles.camera);
        expect(cam.f.telegram && /Möjlig koppling/.test(cam.f.telegram.verdict), 'Telegram: ' + JSON.stringify(cam.f.telegram));
        // PowerLog: Telegrams kamera var igång när bilden togs, skärmen var tänd och Telegram på skärmen
        // (knowledgeC täcker inte de här timmarna).
        const camText = await c.ev(PROV, `ProvenanceApp.model().factors.find(f => f.id === 'camera').items.map(i => i.text).join(' ')`);
        expect(/Telegram använde kameran .* enligt PowerLog \(PLCameraAgent\), vilket täcker tidpunkten/.test(camText), 'PowerLogs kamera saknas: ' + camText);
        expect(cam.f.screen && cam.f.screen.state === 'support', 'Skärmen: ' + JSON.stringify(cam.f.screen));
        expect(cam.f.app && cam.f.app.state === 'support', 'Appen: ' + JSON.stringify(cam.f.app));
        // Telegrams egen mottagna fil under postbox/media/: prövas som mottagen, och kameran frågas inte.
        const own = await assessNamed(c, fx.tgMedia);
        expect(own.f.telegram && own.f.telegram.state === 'support' && /Mottagen i Telegram/.test(own.f.telegram.verdict), 'Telegrams fil: ' + JSON.stringify(own.f.telegram));
        expect(own.f.camera && own.f.camera.state === 'na', 'Kameran för Telegrams fil: ' + JSON.stringify(own.f.camera));
        expect(/Telegram-media/.test(own.model.type), 'Typen: ' + own.model.type);
        const derived = await c.ev(PROV, `ProvenanceApp.meta().sources.filter(s => /Telegrams format avkodat i minnet/.test(s.derived || '')).length`);
        expect(derived === 1, 'Protokollets källor säger inte att Telegrams format avkodades');
        await noInjectedScript(c);
        return 'skickad ur biblioteket, Telegrams kamera, mottagen fil';
    }],

    ['Härkomst → Queries: källan öppnar rätt databas och markerar händelsens rad', async ({ c, fx }) => {
        await assessNamed(c, 'IMG_0006.JPG');
        const click = async (kind) => {
            const hit = await c.ev(PROV, `(function(){
                const e = ProvenanceApp.model().events.find((x) => x.kind === ${JSON.stringify(kind)} && x.source && x.source.queryId);
                if (!e) return null;
                document.getElementById('details-events').open = true;
                const b = document.querySelector('#events .to-queries[data-event="' + e.id + '"]');
                if (!b) return { ms: e.ms, label: '' };
                b.click();
                return { ms: e.ms, label: b.textContent };
            })()`);
            expect(hit && hit.label, 'Ingen länk för ' + kind + ': ' + JSON.stringify(hit));
            const r = await c.waitFor(QUER, `(function(){
                const n = document.getElementById('run-hit');
                const row = document.querySelector('#run-result tr.row-hit');
                return n && !n.classList.contains('display-none') && row && { note: n.innerText, hits: document.querySelectorAll('#run-result tr.row-hit').length, src: document.getElementById('run-file-list').innerText, row: row.innerText, title: document.getElementById('q-title').textContent };
            })()`, 30000, 'markeringen för ' + kind);
            await c.ev(QUER, `document.getElementById('run-hit').classList.add('display-none'), 1`);
            await c.nav('Härkomst');
            return Object.assign(r, { ms: hit.ms });
        };
        // role-messages körs mot Signal, WhatsApp, Telegram och Snapchat: källan ska öppna sin egen databas.
        const sig = await click('sig-message');
        expect(/^signal\.sqlite/.test(sig.src), 'Signals källa öppnade ' + sig.src);
        expect(sig.hits === 1, 'Signal: ' + sig.hits + ' rader markerade');
        expect(/Rad \d+ av \d+ är markerad/.test(sig.note), 'Raden ovanför tabellen: ' + sig.note);
        expect(sig.row.includes(new Date(sig.ms).toISOString().slice(0, 19).replace('T', ' ')), 'Den markerade raden har inte händelsens tid: ' + sig.row);
        const photos = await click('file-created');
        expect(/^Photos\.sqlite/.test(photos.src) && photos.hits === 1, 'Filens rad: ' + photos.src + ', ' + photos.hits);
        const again = await click('file-created');
        expect(again.hits === 1, 'Samma query igen: ' + again.hits);
        return 'Signal rad markerad i signal.sqlite, filens rad i Photos.sqlite';
    }],

    ['Queries: exempelraderna är märkta, och resultatet går att visa på karta', async ({ c }) => {
        await c.nav('Queries');
        await c.ev(QUER, `document.getElementById('tab-new') && document.getElementById('tab-new').click(), 1`);
        await sleep(300);
        await c.ev(QUER, `(function(){ const b = document.querySelector('.side-db[data-family="routined-cache"]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); document.querySelector('.side-q[data-db="routined-cache"][data-q="locations"]').click(); return 1; })()`);
        await sleep(300);
        const before = await c.ev(QUER, `({ tag: document.querySelector('#result-preview .preview-tag') && document.querySelector('#result-preview .preview-tag').textContent, text: document.getElementById('result-preview').innerText, shown: !document.getElementById('result-preview').classList.contains('display-none'), rows: document.querySelectorAll('#result-preview tbody tr').length, status: document.getElementById('run-status').innerText, map: document.getElementById('run-map').disabled, run: !!document.getElementById('preview-run').offsetParent, real: document.querySelectorAll('#run-result tbody tr').length })`);
        expect(before.shown && /exempel/i.test(before.tag), 'Exempelraderna är inte märkta: ' + JSON.stringify(before));
        expect(/inte körd/i.test(before.text) && /påhittade/.test(before.text), 'Texten: ' + before.text);
        expect(before.map && before.real === 0 && !before.status, 'Före körningen: ' + JSON.stringify(before));
        expect(before.run, 'Knappen Kör query i exempelrutan syns inte');
        // Knappen i exempelrutan kör queryn.
        await c.ev(QUER, `document.getElementById('preview-run').click(), 1`);
        await c.waitFor(QUER, `/rad(er)? på/.test(document.getElementById('run-status').textContent)`, 30000, 'körningen');
        const after = await c.ev(QUER, `({ preview: !document.getElementById('result-preview').classList.contains('display-none'), rows: document.querySelectorAll('#run-result tbody tr').length, tag: document.querySelector('#run-status .result-tag') && document.querySelector('#run-status .result-tag').textContent, map: document.getElementById('run-map').disabled, link: !!document.getElementById('run-map-link') })`);
        expect(!after.preview && after.rows > 0 && /resultat/i.test(after.tag), 'Efter körningen: ' + JSON.stringify(after));
        expect(!after.map && after.link, 'Kartan går inte att nå: ' + JSON.stringify(after));
        await c.ev(QUER, `document.getElementById('run-map-link').click(), 1`);
        const active = await c.waitFor(null, `document.querySelector('.tool-frame.is-active').getAttribute('data-tool').includes('positions') && document.querySelector('.tool-frame.is-active').getAttribute('data-tool')`, 10000, 'Positioner');
        await c.waitFor('positions/index.html', `/lades till som källan|uppdaterades/.test(document.body.innerText)`, 15000, 'positionerna i Positioner');
        const text = await c.ev('positions/index.html', `document.body.innerText`);
        expect(new RegExp(after.rows + ' position').test(text), 'Positioner säger inte ' + after.rows + ' positioner');
        expect(/Cache\.sqlite/.test(text), 'Lagret saknar källan');
        void active;
        await c.nav('Queries');
        return after.rows + ' positioner i Positioner';
    }],

    ['Queries: en inläst databas läses inte om, och en query som skriver påverkar inte nästa', async ({ c }) => {
        await c.nav('Queries');
        const pick = (fam, q) => c.ev(QUER, `(function(){ const b = document.querySelector('.side-db[data-family="${fam}"]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); document.querySelector('.side-q[data-db="${fam}"][data-q="${q}"]').click(); return 1; })()`);
        const runIt = () => c.ev(QUER, `(async () => { await QueriesRun.run(); return { status: document.getElementById('run-status').innerText, rows: document.querySelectorAll('#run-result tbody tr').length, first: (document.querySelector('#run-result tbody td') || {}).innerText, trace: document.getElementById('run-trace').innerText }; })()`);
        // Allt som läses ur filen går genom slice().
        await c.ev(QUER, `(function(){ if (!window.__sliceCount) { const orig = Blob.prototype.slice; window.__sliceCount = { n: 0 }; Blob.prototype.slice = function () { window.__sliceCount.n++; return orig.apply(this, arguments); }; } return 1; })()`);
        await pick('routined-cache', 'locations');
        await sleep(200);
        const first = await runIt();
        await pick('knowledgec', 'app-usage');
        await sleep(200);
        const other = await runIt();
        expect(other.rows > 0, 'knowledgeC: ' + other.status);
        await c.ev(QUER, `window.__sliceCount.n = 0, 1`);
        await pick('routined-cache', 'locations');
        await sleep(200);
        const again = await runIt();
        const reads = await c.ev(QUER, `window.__sliceCount.n`);
        expect(reads === 0, 'Databasen lästes om: ' + reads + ' läsningar');
        expect(again.rows === first.rows && again.trace === first.trace, 'Samma databas gav något annat: ' + JSON.stringify([first, again]));
        // Skrivande SQL får en egen kopia.
        const edit = (sql) => c.ev(QUER, `(async () => { const t = document.getElementById('sql-out'); if (t.classList.contains('display-none')) document.getElementById('edit-button').click(); t.value = ${JSON.stringify(sql)}; t.dispatchEvent(new Event('input', { bubbles: true })); await QueriesRun.run(); return { status: document.getElementById('run-status').innerText, cell: (document.querySelector('#run-result tbody td') || {}).innerText }; })()`);
        const count = 'SELECT count(*) AS antal FROM ZRTCLLOCATIONMO';
        const before = await edit(count);
        const wrote = await edit('DELETE FROM ZRTCLLOCATIONMO; ' + count);
        expect(wrote.cell === '0', 'Raderingen i kopian: ' + JSON.stringify(wrote));
        const after = await edit(count);
        expect(after.cell === before.cell && Number(after.cell) > 0, 'En query som skriver ändrade nästa: ' + JSON.stringify([before, after]));
        return 'ingen ny läsning, ' + after.cell + ' rader kvar efter DELETE i kopian';
    }],

    ['Härkomst: en lista från disk fyller rutan och bedöms, och en bild letas fortfarande upp', async ({ c, fx }) => {
        await c.nav('Härkomst');
        const list = path.join(fx.files.dir, 'lista.csv');
        fs.writeFileSync(list, '# ärendet\nFilnamn;Storlek\nIMG_0006.JPG;12\nfinns-inte.jpg;13\nIMG_0006.JPG;12\n');
        await c.setFiles(PROV, '#disk-input', [list]);
        await c.ev(PROV, `document.getElementById('disk-input').dispatchEvent(new Event('change')), 1`);
        await sleep(300);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && document.querySelectorAll('#batch-list tbody tr').length === 2`, 60000, 'listan');
        const r = await c.ev(PROV, `({ box: document.getElementById('filename').value, note: document.getElementById('batch-note').textContent, rows: [...document.querySelectorAll('#batch-list tbody tr')].map(t => t.innerText.replace(/\\s+/g, ' ')) })`);
        expect(r.box === 'IMG_0006.JPG\nfinns-inte.jpg', 'Rutan: ' + r.box);
        expect(/lista\.csv: 2 filnamn ur kolumnen Filnamn/.test(r.note), 'Raden under listan: ' + r.note);
        expect(r.rows.some((t) => /finns-inte\.jpg/.test(t)), 'Raderna: ' + r.rows.join(' | '));
        // En bild är fortfarande en bild.
        await c.setFiles(PROV, '#disk-input', [fx.files.image]);
        await c.ev(PROV, `document.getElementById('disk-input').dispatchEvent(new Event('change')), 1`);
        await sleep(300);
        await waitResult(c, 'bilden från disk');
        const fileName = await c.ev(PROV, `ProvenanceApp.model().file.filename`);
        expect(fileName === fx.imageName, 'Bilden från disk bedömdes som ' + fileName);
        return r.rows.length + ' rader ur listan';
    }],

    ['Queries: Telegrams meddelanden avkodas i minnet, och spårbarheten säger det', async ({ c, fx }) => {
        await c.nav('Queries');
        await c.ev(QUER, `(function(){ const b = document.querySelector('.side-db[data-family="telegram-ios-postbox"]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); return 1; })()`);
        await c.ev(QUER, `document.querySelector('.side-q[data-db="telegram-ios-postbox"][data-q="messages"]').click(), 1`);
        await sleep(300);
        const day = new Date(fx.T3).toISOString().slice(0, 10);
        await c.ev(QUER, `(function(){ const s = document.querySelector('[data-param="timeStart"]'), e = document.querySelector('[data-param="timeEnd"]'); s.value = '${day} 00:00'; e.value = '${day} 23:59'; s.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('input')); return 1; })()`);
        await c.ev(QUER, `document.getElementById('run-button').click(), 1`);
        await c.waitFor(QUER, `/rad(er)? på/.test(document.getElementById('run-status').textContent) || /run-warn/.test(document.getElementById('run-status').innerHTML)`, 30000, 'körningen');
        const r = await c.ev(QUER, `({ status: document.getElementById('run-status').innerText, rows: document.querySelectorAll('#run-result tbody tr').length, trace: document.getElementById('run-trace') ? document.getElementById('run-trace').innerText : '' })`);
        expect(r.rows === 3, 'Telegrams meddelanden: ' + r.rows + ' rader. ' + r.status);
        expect(/Telegrams format avkodat i minnet: tg_message \(3 meddelanden ur t7\)/.test(r.trace), 'Spårbarheten säger inte att formatet avkodades: ' + r.trace.slice(0, 300));
        await noInjectedScript(c);
        return '3 meddelanden, avkodade i minnet';
    }],

    ['Queries: PowerLogs kamera per app med tiden rättad med PowerLogs förskjutning', async ({ c, fx }) => {
        await c.nav('Queries');
        await c.ev(QUER, `(function(){ const b = document.querySelector('.side-db[data-family="powerlog"]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); return 1; })()`);
        await c.ev(QUER, `document.querySelector('.side-q[data-db="powerlog"][data-q="pl-camera"]').click(), 1`);
        await sleep(300);
        const day = new Date(fx.T3).toISOString().slice(0, 10);
        await c.ev(QUER, `(function(){ const s = document.querySelector('[data-param="timeStart"]'), e = document.querySelector('[data-param="timeEnd"]'); s.value = '${day} 00:00'; e.value = '${day} 23:59'; s.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('input')); return 1; })()`);
        await c.ev(QUER, `document.getElementById('run-button').click(), 1`);
        await c.waitFor(QUER, `/rad(er)? på/.test(document.getElementById('run-status').textContent) || /run-warn/.test(document.getElementById('run-status').innerHTML)`, 30000, 'körningen');
        const r = await c.ev(QUER, `({ status: document.getElementById('run-status').innerText, cols: [...document.querySelectorAll('#run-result thead th')].map(t => t.textContent), rows: [...document.querySelectorAll('#run-result tbody tr')].map(tr => [...tr.children].map(td => td.textContent)) })`);
        expect(r.rows.length === 4, 'PowerLogs kamera: ' + r.rows.length + ' rader. ' + r.status);
        // Telegrams kamera startar T3+296 s i rätt tid; PowerLogs egen tid går 903,4 s före.
        const utc = r.cols.indexOf('tid_utc');
        const want = new Date(fx.T3 + 296000).toISOString().slice(0, 19).replace('T', ' ');
        expect(r.rows.some((row) => row[utc] && row[utc].startsWith(want) && row.includes('ph.telegra.Telegraph')), 'Rättad tid ' + want + ' saknas: ' + JSON.stringify(r.rows.map((row) => row[utc])));
        return '4 rader, rättad tid';
    }],

    ['Queries: Signals databas på iOS dekrypteras med nyckelringen från raden högst upp', async ({ c, fx }) => {
        await c.nav('Queries');
        await c.ev(QUER, `(function(){ const b = document.querySelector('.side-db[data-family="signal-ios-main"]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); return 1; })()`);
        await c.ev(QUER, `document.querySelector('.side-q[data-db="signal-ios-main"][data-q="messages"]').click(), 1`);
        await sleep(300);
        const day = new Date(fx.T2).toISOString().slice(0, 10);
        await c.ev(QUER, `(function(){ const s = document.querySelector('[data-param="timeStart"]'), e = document.querySelector('[data-param="timeEnd"]'); s.value = '${day} 00:00'; e.value = '${day} 23:59'; s.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('input')); return 1; })()`);
        await c.ev(QUER, `document.getElementById('run-button').click(), 1`);
        await c.waitFor(QUER, `/rad(er)? på/.test(document.getElementById('run-status').textContent) || /run-warn/.test(document.getElementById('run-status').innerHTML)`, 30000, 'körningen');
        const r = await c.ev(QUER, `({ status: document.getElementById('run-status').innerText, rows: document.querySelectorAll('#run-result tbody tr').length, trace: document.getElementById('run-trace') ? document.getElementById('run-trace').innerText : '' })`);
        expect(r.rows === 1, 'Signals meddelanden: ' + r.rows + ' rader. ' + r.status);
        expect(/Signals inställningar på iOS/.test(r.trace + r.status), 'Spårbarheten säger inte hur databasen dekrypterades: ' + (r.trace + r.status).slice(0, 300));
        await noInjectedScript(c);
        return '1 meddelande, dekrypterad med nyckelringen';
    }],

    ['Härkomst: sökning på tid listar filerna, och HTML i namnen körs inte', async ({ c }) => {
        // Bytet av zon gör om bedömningen som visas: sökningen startas när den är klar.
        await c.ev(PROV, `(function(){ const z = document.getElementById('zone'); z.value = 'utc'; z.dispatchEvent(new Event('change')); document.getElementById('when-date').value = '2024-06-01'; document.getElementById('when-time').value = '12:35'; return 1; })()`);
        await sleep(300);
        await c.waitFor(PROV, `!window.ProvenanceApp.busy()`, 60000, 'bedömningen görs om i UTC');
        await c.ev(PROV, `document.getElementById('run-time').click(), 1`);
        try {
            await c.waitFor(PROV, `!window.ProvenanceApp.busy() && document.querySelectorAll('#hits tr.pick').length > 0 && document.querySelectorAll('#hits-entries tr.pick').length > 0`, 60000, 'tidsökningen');
        } catch (e) {
            throw new Error(e.message + ': ' + await c.ev(PROV, `document.getElementById('run-status').innerText`));
        }
        const n = await c.ev(PROV, `({ lib: document.querySelectorAll('#hits tr.pick').length, entries: document.querySelectorAll('#hits-entries tr.pick').length, html: /<img src=x/.test(document.getElementById('hits').textContent) })`);
        expect(n.lib === 3, 'Bilder i biblioteket: ' + n.lib);
        expect(n.html, 'Namnet med HTML visas inte som text');
        await sleep(500);
        await noInjectedScript(c);
        return n.lib + ' bilder i biblioteket, ' + n.entries + (n.entries === 1 ? ' fil' : ' filer') + ' utanför';
    }],

    ['EXIF & karta, Positioner och Time Converter fungerar med testdata', async ({ c }) => {
        await c.nav('EXIF & karta');
        await c.ev('exif-viewer/index.html', `document.getElementById('fill-sample').click(), 1`);
        await c.waitFor('exif-viewer/index.html', `document.body.innerText.includes('IMG_4101.JPG')`, 30000, 'EXIF-testdatan');
        // Tiderna i filen står för sig, med tagg och UTC, och filsystemets tider säger att de gäller filen på datorn.
        await c.waitFor('exif-viewer/index.html', `[...document.querySelectorAll('table tbody tr')].some(tr => /IMG_4101\\.JPG/.test(tr.innerText) && /Tagen/.test(tr.innerText))`, 60000, 'EXIF-raden');
        await c.ev('exif-viewer/index.html', `[...document.querySelectorAll('table tbody tr')].find(tr => /IMG_4101\\.JPG/.test(tr.innerText)).click(), 1`);
        const detail = await c.waitFor('exif-viewer/index.html', `(function(){
            const dts = [...document.querySelectorAll('#detail-summary dt')];
            if (!dts.some(d => d.textContent === 'Tider inuti filen')) return null;
            const taken = dts.find(d => d.textContent === 'Tagen enligt EXIF');
            return { labels: dts.map(d => d.textContent), taken: taken && taken.nextElementSibling.textContent };
        })()`, 10000, 'tiderna i EXIF-rutan');
        expect(/ExifIFD:DateTimeOriginal|Composite:SubSecDateTimeOriginal/.test(detail.taken || ''), 'Tiden i filen: ' + JSON.stringify(detail));
        expect(detail.labels.includes('Filsystemets tider för filen på den här datorn'), 'Filsystemets tider: ' + detail.labels);
        expect(!detail.labels.includes('Skapad'), 'En rad heter bara Skapad: ' + detail.labels);
        await c.ev('exif-viewer/index.html', `(function(){ const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Stäng' && x.offsetParent); if (b) b.click(); return 1; })()`);
        await c.nav('Positioner');
        await c.ev('positions/index.html', `document.getElementById('fill-sample').click(), 1`);
        await sleep(1500);
        await c.nav('Time Converter');
        await c.ev('time-converter/time.html', `(function(){ const i = document.getElementById('raw-input'); i.value = '738937296'; i.dispatchEvent(new Event('input')); document.getElementById('convert-button').click(); return 1; })()`);
        await c.waitFor('time-converter/time.html', `/2024-06-01/.test(document.body.innerText)`, 10000, 'Time Converter');
        return 'ok';
    }],
];

module.exports = { scenarios, expect, factors, assessNamed, waitResult, download, noInjectedScript, PROV, QUER };
