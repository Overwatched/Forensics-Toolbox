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
                card: [...document.querySelectorAll('.file-times dt')].map((d, i) => d.textContent + ' ' + document.querySelectorAll('.file-times dd')[i].textContent), cardTitle: [...document.querySelectorAll('.file-facts-title')].map(d => d.textContent).join(' | ') };
        })()`);
        const before = await read();
        expect(before.cells.length === before.rows.length && before.rows.length >= 5, 'Tabellen: ' + JSON.stringify(before.cells));
        expect(before.rows.find((r) => r[0] === 'created')[1] === fx.T * 1000 || before.rows.find((r) => r[0] === 'created')[1] === fx.T, 'Skapad: ' + JSON.stringify(before.rows));
        expect(/Skapad enligt biblioteket \(T\)/.test(before.t), 'Raden med T: ' + before.t);
        expect(/^Tid \(/.test(before.head) && before.link, 'Rubriken eller länken: ' + before.head);
        // Punkt 3 har samma tider som tabellen, så att det syns att filen har tider.
        expect(before.card.length === before.rows.length, 'Tiderna på kortet: ' + before.card.length + ', i tabellen ' + before.rows.length);
        expect(before.card.some((x) => /^Skapad enligt biblioteket \(T\) \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(x)), 'T på kortet: ' + before.card);
        expect(before.cells.every((cell, i) => cell.includes(before.card[i].replace(/^.*? (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}.*)$/, '$1'))), 'Kortet och tabellen skiljer sig: ' + JSON.stringify([before.card, before.cells]));
        expect(/Filens tider \(/.test(before.cardTitle), 'Rubriken på kortet: ' + before.cardTitle);
        await c.ev(PROV, `(function(){ const s = document.getElementById('zone'); s.value = 'utc'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
        await sleep(500);
        await waitResult(c, 'bedömningen i UTC');
        const utc = await read();
        expect(utc.state === before.state && utc.verdict === before.verdict, 'I UTC: ' + utc.verdict + ', annars ' + before.verdict);
        expect(JSON.stringify(utc.rows) === JSON.stringify(before.rows), 'Tiderna flyttades med zonen');
        expect(/^Tid \(UTC\)/.test(utc.head), 'Rubriken: ' + utc.head);
        expect(/Filens tider \(UTC\)/.test(utc.cardTitle), 'Kortet följer inte zonen: ' + utc.cardTitle);
        expect(utc.cells.every((cell, i) => cell.includes(utc.card[i].replace(/^.*? (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}.*)$/, '$1'))), 'Kortet och tabellen skiljer sig i UTC: ' + JSON.stringify([utc.card, utc.cells]));
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

    ['Härkomst: filens tidpunkter väljs med knappar, T står bara på T, och protokollet har alla tidslinjer', async ({ c, fx, downloads }) => {
        await c.nav('Härkomst');
        const view = () => c.ev(PROV, `(function () {
            const box = document.getElementById('timelines');
            const list = [...box.querySelectorAll('.timeline')];
            const shown = list.filter((t) => !t.classList.contains('display-none'));
            return {
                buttons: [...box.querySelectorAll('button.moment')].map((b) => ({ title: b.querySelector('strong').textContent, sub: b.querySelector('span').textContent, on: b.classList.contains('on'), pressed: b.getAttribute('aria-pressed') })),
                note: (box.querySelector('.moment-note') || {}).textContent || '',
                all: list.length, shown: shown.length,
                texts: shown[0] ? [...shown[0].querySelector('.timeline-svg svg').querySelectorAll('text')].map((x) => x.textContent) : [],
                close: shown[0] ? [...shown[0].querySelectorAll('.timeline-svg svg')[1].querySelectorAll('text')].map((x) => x.textContent) : [],
                clips: [...box.querySelectorAll('clipPath')].map((x) => x.id),
                height: shown[0] ? shown[0].getBoundingClientRect().height : 0,
                factors: document.getElementById('factors').innerText,
            };
        })()`);
        const on = (v) => JSON.stringify(v.buttons.map((b) => b.on));
        const PILLS = ['Förenligt', 'Inte förenligt', 'Saknas', 'Upplysning', 'Inte tillämplig'];
        const notAtT = (v, label) => [v.texts, v.close].forEach((texts) => {
            expect(texts.some((t) => /^\d\d:\d\d:\d\d /.test(t) && t.endsWith(label)), 'Markeringen: ' + texts.join(' | '));
            expect(texts.some((t) => /^Läget · /.test(t)), 'Kolumnen: ' + texts.join(' | '));
            expect(!texts.some((t) => /^T \d\d:/.test(t) || /^Vid T/.test(t)), 'T står på fel tid: ' + texts.join(' | '));
            expect(!texts.some((t) => PILLS.includes(t)), 'Bedömningsord utanför T: ' + texts.join(' | '));
        });
        const atT = (v) => expect(v.texts.some((t) => /^Vid T · /.test(t)) && v.texts.some((t) => /^T \d\d:/.test(t)) && v.texts.some((t) => PILLS.includes(t)), 'T-tidslinjen: ' + v.texts.join(' | '));

        // Tiderna ligger nära varandra: inga knappar, och samma tidslinje som förut.
        await assessNamed(c, 'IMG_0005.JPG');
        const one = await view();
        expect(one.buttons.length === 0 && one.all === 1 && one.shown === 1 && !one.note, 'En tidpunkt: ' + JSON.stringify(one.buttons));
        atT(one);

        // Telefonen har händelser vid båda: T visas först. Tidslinjerna får inte dela klippområden, för då klipps banden
        // i den ena efter den andra.
        await assessNamed(c, 'IMG_0010.JPG');
        const both = await view();
        expect(on(both) === '[true,false]' && both.all === 2 && both.shown === 1, 'Startvalet med händelser vid båda: ' + JSON.stringify(both.buttons));
        atT(both);
        expect(both.buttons.every((b) => /\d+ händelser? på telefonen$/.test(b.sub)), 'Händelserna: ' + JSON.stringify(both.buttons));
        expect(both.clips.length >= 4 && new Set(both.clips).size === both.clips.length, 'Klippområdena: ' + both.clips.join(' '));

        // Telefonen har inga händelser vid T: den andra tidpunkten visas först.
        await assessNamed(c, 'IMG_0009.JPG');
        const first = await view();
        expect(JSON.stringify(first.buttons.map((b) => b.title)) === JSON.stringify(['När filen skapades (T)', 'När filen kom till telefonen']), 'Knapparna: ' + JSON.stringify(first.buttons));
        expect(/inga registrerade händelser$/.test(first.buttons[0].sub) && /\d+ händelser? på telefonen$/.test(first.buttons[1].sub), 'Händelserna: ' + JSON.stringify(first.buttons));
        expect(on(first) === '[false,true]' && first.buttons[1].pressed === 'true' && first.all === 2 && first.shown === 1, 'Startvalet: ' + JSON.stringify(first.buttons));
        notAtT(first, ' filen kom till telefonen');
        expect(first.note.includes('400 dygn') && first.note.includes('efter T') && first.note.includes('Källa: Photos.sqlite → ZASSET → ZADDEDDATE') && first.note.includes('Bedömningen ovan gäller T') && first.note.includes('Båda tidslinjerna'), 'Raden: ' + first.note);

        // Knappen byter tidslinje och inget annat.
        await c.ev(PROV, `document.querySelector('button.moment[data-moment="0"]').click(), 1`);
        const second = await view();
        expect(on(second) === '[true,false]' && second.shown === 1 && second.height > 100, 'Efter klicket: ' + JSON.stringify(second.buttons));
        atT(second);
        expect(second.factors === first.factors, 'Bedömningen ändrades av knappen');
        expect(/vid T/.test(second.note) && !second.note.includes('ZADDEDDATE'), 'Raden: ' + second.note);

        // Valet står kvar när tidslinjerna ritas om, med Det viktiga och Allt och med en annan zon.
        await c.ev(PROV, `[...document.querySelectorAll('#timelines .seg button.detail')].find((b) => !b.classList.contains('on')).click(), 1`);
        await sleep(300);
        await c.waitFor(PROV, `document.querySelectorAll('#timelines button.moment').length === 2 && !ProvenanceApp.busy()`, 20000, 'omritningen');
        expect(on(await view()) === '[true,false]', 'Valet efter Allt');
        await c.ev(PROV, `(function () { const z = document.getElementById('zone'); z.value = 'utc'; z.dispatchEvent(new Event('change')); return 1; })()`);
        await sleep(300);
        await waitResult(c, 'zonen');
        const utc = await view();
        expect(on(utc) === '[true,false]' && utc.shown === 1, 'Valet efter zonen: ' + JSON.stringify(utc.buttons));
        atT(utc);

        // Protokollet har båda, vilken knapp som än är vald.
        for (const old of fs.readdirSync(downloads)) if (/^harkomst-IMG_0009-protokoll-/.test(old)) fs.unlinkSync(path.join(downloads, old));
        await c.ev(PROV, `document.getElementById('save-protocol').click(), 1`);
        const html = await download(downloads, /^harkomst-IMG_0009-protokoll-.*\.html$/);
        expect(html.includes('Översikt när filen skapades (T):') && html.includes('Översikt när filen kom till telefonen:') && html.includes('Bedömningen i avsnitt 2 gäller T.'), 'Protokollet saknar en tidslinje');
        const images = (html.match(/<img[^>]+src="data:image\/png/g) || []).length;
        expect(images >= 4, 'Protokollet har ' + images + ' bilder');

        // En annan fil börjar om från programmets startval.
        await assessNamed(c, 'IMG_0005.JPG');
        await assessNamed(c, 'IMG_0009.JPG');
        expect(on(await view()) === '[false,true]', 'Startvalet efter en annan fil');
        await c.ev(PROV, `(function () { const z = document.getElementById('zone'); z.value = 'file'; z.dispatchEvent(new Event('change')); return 1; })()`);
        await sleep(300);
        await waitResult(c, 'zonen');

        // Utanför biblioteket: tiden i filen är två år gammal, och filsystemets tid blir den andra tidpunkten.
        await assessNamed(c, 'gammal.jpg');
        const old = await view();
        const T = await c.ev(PROV, `ProvenanceApp.model().file.createdMs`);
        expect(T === Date.UTC(2022, 5, 1, 12, 34, 56), 'T är ' + new Date(T).toISOString());
        expect(JSON.stringify(old.buttons.map((b) => b.title)) === JSON.stringify(['Enligt tiden i filen (T)', 'När filen skapades i filsystemet']), 'Knapparna: ' + JSON.stringify(old.buttons));
        expect(on(old) === '[false,true]' && /inga registrerade händelser$/.test(old.buttons[0].sub) && /\d+ händelser? på telefonen$/.test(old.buttons[1].sub), 'Startvalet: ' + JSON.stringify(old.buttons));
        notAtT(old, ' filen skapades i filsystemet');
        expect(old.texts.includes('Filen skapades i filsystemet') && old.texts.includes('731 dygn efter T'), 'Filens rad: ' + old.texts.join(' | '));
        expect(/Källa: Zippen → .*fjärde tiden/.test(old.note), 'Raden: ' + old.note);
        return 'två tidpunkter i biblioteket och utanför, ' + images + ' bilder i protokollet';
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

    ['Härkomst: Signal och WhatsApp på iOS, med nyckelringen vald i raden högst upp', async ({ c, fx }) => {
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

    ['Chattar: WhatsApp-chatten som bubblor med bilden, tiderna och källan, export med spårbarhet, och Queries öppnar chatten vid raden', async ({ c, fx, downloads }) => {
        const CHAT = 'chats/index.html';
        await c.nav('Chattar');
        await c.waitFor(CHAT, `document.querySelectorAll('.c-item').length > 0`, 60000, 'konversationerna');
        const list = await c.ev(CHAT, `[...document.querySelectorAll('.c-item')].map(b => b.innerText.replace(/\\s+/g, ' '))`);
        const wa = list.findIndex((t) => /^Lo /.test(t));
        expect(wa >= 0, 'WhatsApp-chatten saknas: ' + JSON.stringify(list));
        await c.ev(CHAT, `document.querySelectorAll('.c-item')[${wa}].click(), 1`);
        await c.waitFor(CHAT, `document.querySelectorAll('#c-msgs .m').length === 2`, 30000, 'bubblorna');
        await c.waitFor(CHAT, `(document.querySelector('.att-img img') || {}).src && document.querySelector('.att-img img').src.startsWith('blob:') && document.querySelector('.att-img img').naturalWidth > 0`, 30000, 'bilden');
        const v = await c.ev(CHAT, `({ me: document.querySelectorAll('#c-msgs .m.me').length, missing: (document.querySelector('.att-missing') || {}).textContent || '', title: document.getElementById('c-title').textContent, sub: document.getElementById('c-sub').textContent, note: document.getElementById('c-note').textContent })`);
        expect(v.me === 1, 'Egna meddelanden: ' + v.me);
        expect(/skickad\.jpg finns inte i zippen/.test(v.missing), 'Den saknade filen: ' + v.missing);
        expect(v.title.startsWith('Lo <img'), 'Namnet skrivs som text: ' + v.title);
        expect(/1 bilaga finns i databasen men inte i zippen/.test(v.note), 'Anteckningen: ' + v.note);
        await c.ev(CHAT, `document.querySelectorAll('#c-msgs .clock')[1].click(), 1`);
        const pop = await c.ev(CHAT, `document.getElementById('c-pop').innerText`);
        const iso = new Date(fx.T2 + 70000).toISOString();
        expect(pop.includes('Skrivet eller mottaget') && pop.includes('ZMESSAGEDATE') && pop.includes(iso), 'Tiderna: ' + pop);
        expect(/Message\/Media\/1@lid\/c\/d\/mottagen\.jpg/.test(pop), 'Bilagans sökväg: ' + pop);
        await c.ev(CHAT, `document.body.click(), 1`);
        // Export av hela konversationen som HTML.
        await c.ev(CHAT, `document.getElementById('c-export-open').click(), 1`);
        await c.ev(CHAT, `document.getElementById('c-export-html').click(), 1`);
        const html = await download(downloads, /^WhatsApp-.*\.html$/, 20000);
        expect(html.includes('data:image/jpeg;base64,'), 'Bilden är inte inbäddad');
        expect(html.includes('<h2>Spårbarhet</h2>') && html.includes('ChatStorage.sqlite') && html.includes('ZMESSAGEDATE'), 'Spårbarheten saknas');
        expect(!html.includes('<img src=x onerror'), 'HTML ur databasen står oescapad i exporten');
        expect(html.includes('Filen finns inte i extraktionen'), 'Den saknade filen sägs inte i exporten');
        await noInjectedScript(c);
        // Queries: raden i meddelandequeryn öppnar chatten vid meddelandet.
        await c.nav('Queries');
        await c.ev(QUER, `(function(){ const b = document.querySelector('.side-db[data-family="whatsapp-ios-chat"]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); return 1; })()`);
        await c.ev(QUER, `document.querySelector('.side-q[data-db="whatsapp-ios-chat"][data-q="messages"]').click(), 1`);
        await sleep(300);
        const day = new Date(fx.T2).toISOString().slice(0, 10);
        await c.ev(QUER, `(function(){ const s = document.querySelector('[data-param="timeStart"]'), e = document.querySelector('[data-param="timeEnd"]'); s.value = '${day} 00:00'; e.value = '${day} 23:59'; s.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('input')); return 1; })()`);
        await c.ev(QUER, `document.getElementById('run-button').click(), 1`);
        await c.waitFor(QUER, `document.querySelectorAll('#run-result .chat-open').length === 2`, 30000, 'knapparna Chatt');
        await c.ev(QUER, `document.querySelectorAll('#run-result .chat-open')[1].click(), 1`);
        await c.waitFor(CHAT, `!!document.querySelector('#c-msgs .m.flash[data-key="2"]')`, 30000, 'meddelandet i Chattar');
        return '2 bubblor, bilden visas, export med spårbarhet, raden i Queries öppnar chatten';
    }],

    ['Chattar: en lång chatt ritas i block, och Första, sökningen, datumet och exportens varning når hela chatten', async ({ c, fx }) => {
        const CHAT = 'chats/index.html';
        const L = fx.longChat;
        const plain = (s) => String(s).replace(/\s+/g, ' ');
        await c.nav('Chattar');
        await c.waitFor(CHAT, `!ChatsApp.busy() && [...document.querySelectorAll('.c-item')].some(b => b.innerText.includes('Långa chatten'))`, 60000, 'den långa chatten i listan');
        await c.ev(CHAT, `(function(){ const z = document.getElementById('c-zone'); z.value = 'UTC'; z.dispatchEvent(new Event('change')); [...document.querySelectorAll('.c-item')].find(b => b.innerText.includes('Långa chatten')).click(); return 1; })()`);
        await c.waitFor(CHAT, `!ChatsApp.busy() && ChatsApp.view() && ChatsApp.view().n === ${L.count}`, 60000, 'den långa chatten');
        let v = await c.ev(CHAT, `ChatsApp.view()`);
        expect(v.drawn <= 500 && v.to === L.count, 'Sidan efter öppningen: ' + JSON.stringify(v));
        expect(await c.ev(CHAT, `!!document.querySelector('#c-msgs .m[data-i="${L.count - 1}"]')`), 'Det senaste meddelandet är inte ritat');
        // Från början och nedåt: nya block ritas och gamla tas bort, så att sidan aldrig har fler än 1 500 meddelanden.
        await c.ev(CHAT, `document.getElementById('c-first').click(), 1`);
        v = await c.ev(CHAT, `({ v: ChatsApp.view(), first: document.querySelector('#c-msgs .m').dataset.i })`);
        expect(v.v.from === 0 && v.first === '0', 'Första: ' + JSON.stringify(v));
        const blocks = await c.ev(CHAT, `(async function(){ const box = document.getElementById('c-msgs'); let most = 0; for (let k = 0; k < 10; k++) { box.scrollTop = box.scrollHeight; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); most = Math.max(most, ChatsApp.view().drawn); } return { most, v: ChatsApp.view() }; })()`);
        expect(blocks.most <= 1500 && blocks.v.from > 0 && blocks.v.to > 1500, 'Blocken: ' + JSON.stringify(blocks));
        // Sökningen når hela chatten, också det som inte är ritat. Den första träffen är den första från det som syns.
        await c.ev(CHAT, `document.getElementById('c-first').click(), 1`);
        const find = (q) => c.ev(CHAT, `(function(){ const f = document.getElementById('c-find'); f.value = ${JSON.stringify(q)}; f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 1; })()`);
        const found = () => c.ev(CHAT, `({ count: document.getElementById('c-find-count').textContent, hit: (document.querySelector('#c-msgs .m.hit') || { dataset: {} }).dataset.i, marks: [...document.querySelectorAll('#c-msgs mark')].map(m => m.textContent) })`);
        await find('NÅLEN');
        let s = await found();
        expect(plain(s.count) === '1 av 3' && s.hit === String(L.needles[0]) && s.marks.includes('nålen'), 'Sökningen: ' + JSON.stringify(s));
        await c.ev(CHAT, `document.getElementById('c-find-next').click(), document.getElementById('c-find-next').click(), 1`);
        s = await found();
        expect(plain(s.count) === '3 av 3' && s.hit === String(L.needles[2]), 'Två träffar framåt: ' + JSON.stringify(s));
        await c.ev(CHAT, `document.getElementById('c-find-next').click(), 1`);
        expect(plain((await found()).count) === '1 av 3', 'Efter den sista kommer den första');
        await find('finns inte i chatten');
        expect((await found()).count === 'Inga träffar', 'Ingen träff');
        await find('');
        // Gå till datum: en dag i uppehållet visar det första meddelandet efter det och säger det.
        const gapDay = new Date(L.timeMs(L.gapAfter - 1) + 86400000).toISOString().slice(0, 10);
        const nextDay = new Date(L.timeMs(L.gapAfter)).toISOString().slice(0, 10);
        await c.ev(CHAT, `(function(){ const d = document.getElementById('c-date'); d.value = '${gapDay}'; d.dispatchEvent(new Event('change')); return 1; })()`);
        const day = await c.ev(CHAT, `(function(){ const box = document.getElementById('c-msgs'), el = box.querySelector('.m[data-i="${L.gapAfter}"]'); return { toast: document.getElementById('toast').textContent, y: el ? Math.round(el.getBoundingClientRect().top - box.getBoundingClientRect().top) : null }; })()`);
        expect(day.toast.includes('Inga meddelanden ' + gapDay) && day.toast.includes('Närmast efter: ' + nextDay), 'Datumet i uppehållet: ' + day.toast);
        expect(day.y !== null && day.y >= 0 && day.y < 120, 'Meddelandet efter uppehållet står inte överst: ' + JSON.stringify(day));
        // Exporten: uppskattningen följer urvalet, och en utskrift av hela chatten varnar först.
        await c.ev(CHAT, `document.getElementById('c-export-open').click(), 1`);
        const est = plain(await c.ev(CHAT, `document.getElementById('c-export-estimate').textContent`));
        expect(/^Urvalet: 3 000 meddelanden\. Filen blir omkring [\d,]+ (kB|MB), och en utskrift omkring [\d ]+ sidor\.$/.test(est), 'Uppskattningen: ' + est);
        await c.ev(CHAT, `document.getElementById('c-export-print').click(), 1`);
        await sleep(200);
        const warn = await c.ev(CHAT, `({ text: document.getElementById('c-export-status').textContent, button: document.getElementById('c-export-print').textContent, frame: (document.getElementById('c-print').srcdoc || '').length })`);
        expect(/sidor utskrivet/.test(warn.text) && warn.button === 'Skriv ut ändå' && warn.frame === 0, 'Utskriftens varning: ' + JSON.stringify(warn));
        // Ett annat urval tar bort varningen.
        await c.ev(CHAT, `(function(){ const r = document.querySelector('input[name="c-scope"][value="range"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
        expect(await c.ev(CHAT, `document.getElementById('c-export-print').textContent`) === 'Skriv ut / PDF…', 'Varningen gäller bara urvalet den visades för');
        await c.ev(CHAT, `document.getElementById('c-export-cancel').click(), 1`);
        await c.ev(CHAT, `(function(){ const z = document.getElementById('c-zone'); z.value = 'local'; z.dispatchEvent(new Event('change')); return 1; })()`);
        await noInjectedScript(c);
        return 'block om högst 1 500 av 3 000, sökningen och datumet når hela chatten, utskriften varnar';
    }],

    ['Härkomst: en fil som lästs läses inte om, en fråga för hela extraktionen körs en gång, och listan ritas inte om', async ({ c }) => {
        await c.nav('Härkomst');
        const ev = (e) => c.ev(PROV, e);
        const work = () => ev(`ProvenanceApp.work()`);
        const queries = () => ev(`JSON.stringify(ProvenanceApp.meta().queries.map(q => [q.id, q.db, q.sql, [...q.times].sort()]))`);
        const underlay = () => ev(`JSON.stringify([ProvenanceApp.model().factors, ProvenanceApp.model().explanation, ProvenanceApp.meta().exifRows, ProvenanceApp.meta().fileEntry])`);
        const single = async () => {
            await ev(`document.getElementById('filename').value = 'IMG_0006.JPG', document.getElementById('run').click(), 1`);
            await sleep(200);
            await waitResult(c, 'filen ensam');
        };
        // Samma fil två gånger: andra gången läser ExifTool inget, frågorna som gäller hela extraktionen körs inte,
        // och protokollets frågor och underlaget är desamma.
        await single();
        const w1 = await work(), q1 = await queries(), u1 = await underlay();
        await single();
        const w2 = await work(), q2 = await queries(), u2 = await underlay();
        expect(w1.exif > 0 && w2.exif === w1.exif && w2.exifReused > w1.exifReused, 'ExifTool lästes om: ' + JSON.stringify([w1, w2]));
        expect(w2.reused > w1.reused, 'Frågorna för hela extraktionen kördes om: ' + JSON.stringify([w1, w2]));
        expect(q2 === q1, 'Protokollets frågor ändrades av återanvändningen: ' + q1.length + ' och ' + q2.length + ' tecken');
        expect(u2 === u1, 'Underlaget ändrades av återanvändningen');

        // I listan: ett klick på en rad läser inte filen i ExifTool igen, och vägen tillbaka ritar inte om de andra raderna.
        await ev(`document.getElementById('filename').value = 'IMG_0006.JPG\\nfinns-inte.jpg\\nfinns-inte-heller.jpg', document.getElementById('run').click(), 1`);
        await sleep(300);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && document.querySelectorAll('#batch-list tbody tr').length === 3`, 60000, 'listan');
        const rows = await ev(`[...document.querySelectorAll('#batch-list tbody tr')].map(t => t.className + ': ' + t.innerText.replace(/\\s+/g, ' '))`);
        expect(/^batch-row pick: +IMG_0006\.JPG/.test(rows[0]) && /^batch-row: +finns-inte\.jpg Finns inte/.test(rows[1]) && /^batch-row: +finns-inte-heller\.jpg Finns inte/.test(rows[2]), 'Raderna efter körningen: ' + rows.join(' | '));
        const w3 = await work();
        await ev(`document.querySelector('#batch-list tbody').rows[2].dataset.kvar = 'ja', document.querySelector('#batch-list tr.pick').click(), 1`);
        await sleep(200);
        await waitResult(c, 'raden i listan');
        const w4 = await work(), u4 = await underlay();
        expect(w4.exif === w3.exif && w3.exif === w1.exif, 'Klicket läste filen i ExifTool igen: ' + JSON.stringify([w1, w3, w4]));
        expect(u4 === u1, 'Underlaget ur listan skiljer sig från filen ensam');
        await ev(`document.getElementById('batch-back').click(), 1`);
        await sleep(200);
        const back = await ev(`({ shown: !document.getElementById('batch-box').classList.contains('display-none'), kept: document.querySelector('#batch-list tbody').rows[2].dataset.kvar || '', rows: [...document.querySelectorAll('#batch-list tbody tr')].map(t => t.className + ': ' + t.innerText.replace(/\\s+/g, ' ')) })`);
        expect(back.shown && back.kept === 'ja', 'Listan ritades om på vägen tillbaka: ' + JSON.stringify(back));
        expect(back.rows.join(' | ') === rows.join(' | '), 'Raderna ändrades på vägen tillbaka: ' + back.rows.join(' | '));
        return 'andra gången: ' + (w2.reused - w1.reused) + ' svar återanvända, ' + (w2.asked - w1.asked) + ' frågor körda, ExifTool 0 gånger';
    }],

    ['Härkomst: listan visar förloppet och faktorernas lägen i ord, går att söka och välja i, och ett namn med flera träffar blir en rad per träff', async ({ c, downloads }) => {
        await c.nav('Härkomst');
        const ev = (e) => c.ev(PROV, e);
        const rows = () => ev(`[...document.querySelectorAll('#batch-list tbody tr')].map(t => ({ hidden: t.classList.contains('display-none'), text: t.innerText.replace(/\\s+/g, ' ').trim(),
            marks: [...t.querySelectorAll('td.f-col .mark')].map(m => m.className.replace('mark ', '') + '=' + m.textContent), titles: [...t.querySelectorAll('td.f-col .mark')].filter(m => m.title).length }))`);
        const shown = async () => (await rows()).filter((r) => !r.hidden).map((r) => r.text.split(' ')[0]);
        const tools = () => ev(`({ chips: [...document.querySelectorAll('#batch-chips .chip')].filter(b => !b.classList.contains('display-none')).map(b => (b.getAttribute('aria-pressed') === 'true' ? '>' : '') + b.textContent.trim()),
            shown: document.getElementById('batch-shown').textContent, hits: document.getElementById('batch-hits').classList.contains('display-none') ? '' : document.getElementById('batch-hits-text').textContent,
            expand: document.getElementById('batch-expand').textContent, note: document.getElementById('batch-note').textContent, search: document.getElementById('batch-filter').value })`);
        const search = (text) => ev(`(function () { const f = document.getElementById('batch-filter'); f.value = ${JSON.stringify(text)}; f.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
        const chip = (group) => ev(`document.querySelector('#batch-chips .chip[data-group="${group}"]').click(), 1`);
        const bar = () => ev(`window.__bar.splice(0)`);
        const listed = (n, label) => c.waitFor(PROV, `!ProvenanceApp.busy() && document.querySelectorAll('#batch-list tbody tr').length === ${n}`, 60000, label);
        // Namnen skrivs i rutan, som av en användare, så att raden om en tidigare listfil inte följer med.
        const type = async (list) => {
            await ev(`(function () { const f = document.getElementById('filename'); f.value = ${JSON.stringify(list.join('\n'))}; f.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('run').click(); return 1; })()`);
            await sleep(300);
        };

        // Stapeln under lägesraden följer med medan listan körs, och är borta när den är klar.
        await ev(`(function () { window.__bar = []; const box = document.getElementById('run-progress'), track = box.firstElementChild; let last = '';
            new MutationObserver(function () { const t = [box.className, track.firstElementChild.style.width, track.getAttribute('aria-valuenow'), box.lastElementChild.textContent].join('|'); if (t !== last) { last = t; window.__bar.push(t); } })
                .observe(box, { attributes: true, subtree: true, childList: true, characterData: true }); })(), 1`);
        const names = ['IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0006.JPG', 'IMG_0009.JPG', 'finns-inte.jpg'];
        await type(names);
        await listed(5, 'listan');
        const ran = await bar();
        // Tiden som är kvar står med först när listan har gått i två sekunder, så den är inte med i jämförelsen.
        expect(ran.includes('progress|0%|0|0 av 5 klara') && ran.some((x) => /^progress\|80%\|80\|4 av 5 klara( · |$)/.test(x)) && /^progress idle\|/.test(ran[ran.length - 1]), 'Förloppet under listan: ' + ran.join(' ; '));
        expect(await ev(`document.querySelector('#run-progress .progress-track').getAttribute('role')`) === 'progressbar', 'Stapeln saknar sin roll');

        // Varje faktor står med tecken och ord, rubrikerna säger vilken faktor det är, och förklaringen har alla fem lägen.
        let r = await rows();
        const done = r.filter((x) => x.marks.length);
        expect(done.length === 3 && done.every((x) => x.marks.length === 5 && x.titles === 5), 'Märkena: ' + JSON.stringify(r.map((x) => x.marks)));
        const WORDS = { support: '✓Förenligt', contradiction: '✕Inte förenligt', missing: '?Saknas', info: 'iUpplysning', na: '–Inte tillämplig' };
        const odd = done.flatMap((x) => x.marks).filter((m) => WORDS[m.split('=')[0]] !== m.split('=')[1]);
        expect(!odd.length, 'Ett läge utan sitt tecken och ord: ' + odd.join(', '));
        expect(done.flatMap((x) => x.marks).some((m) => /^contradiction=/.test(m)) && done.flatMap((x) => x.marks).some((m) => /^support=/.test(m)), 'Testdatan har inte både förenligt och inte förenligt: ' + JSON.stringify(done.map((x) => x.marks)));
        expect(await ev(`document.querySelectorAll('#batch-list .dot').length`) === 0, 'Prickarna står kvar');
        const legend = await ev(`({ items: [...document.querySelectorAll('#batch-legend .legend-item')].map(e => e.innerText.replace(/\\s+/g, ' ').trim()), head: document.querySelector('#batch-legend .legend-head').textContent,
            cols: [...document.querySelectorAll('#batch-list thead th.f-col')].map(h => h.textContent).join() })`);
        expect(legend.items.length === 5 && /^✓ ?Förenligt stämmer med/.test(legend.items[0]) && /^✕ ?Inte förenligt stämmer inte/.test(legend.items[1]) && /^\? ?Saknas registreringar saknas/.test(legend.items[2]), 'Förklaringen: ' + legend.items.join(' | '));
        expect(legend.cols === 'Skapad,App,Kamera,Skärm,Position' && /^Skapad, App, Kamera, Skärm och Position är faktorerna/.test(legend.head), 'Rubrikerna: ' + legend.cols + ' | ' + legend.head);

        // Rubrikraden står kvar när listan rullas, och i en smal ruta rullar bara listan i sidled, i sin egen ruta.
        const fit = await ev(`(function () {
            const box = document.getElementById('container'), list = document.getElementById('batch-list'), keep = [box.style.maxWidth, list.style.maxHeight];
            box.style.maxWidth = '620px'; list.style.maxHeight = '150px';
            list.scrollTop = 120;
            const out = { scrolled: list.scrollTop, head: Math.round(list.querySelector('thead th.f-col').getBoundingClientRect().top - list.getBoundingClientRect().top),
                wide: [document.documentElement, ...document.querySelectorAll('#batch-box, #batch-box .box-head, .batch-tools, #batch-chips, #batch-legend, #batch-hits, #batch-note')]
                    .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => (e.id || e.className || e.tagName) + ' ' + e.scrollWidth + '/' + e.clientWidth),
                cut: [...list.querySelectorAll('td.f-col, th.f-col')].filter(e => e.scrollWidth > e.clientWidth + 1).length };
            list.scrollTop = 0; box.style.maxWidth = keep[0]; list.style.maxHeight = keep[1];
            return out; })()`);
        expect(fit.scrolled > 50 && fit.head === 0, 'Rubrikraden följde med när listan rullades: ' + JSON.stringify(fit));
        expect(!fit.wide.length && !fit.cut, 'Det sticker ut i sidled i en smal ruta: ' + JSON.stringify(fit));

        // Urvalet: grupperna med antal, bara de som har rader. Sökningen går på namn, mapp, typ och appen som sparade filen.
        let t = await tools();
        expect(t.chips.join(' | ') === '>Alla 5 | Med underlag 3 | Något inte förenligt 2 | Flera träffar 1 | Finns inte 1' && t.shown === '', 'Urvalet: ' + t.chips.join(' | ') + ' | ' + t.shown);
        await search('signal');
        expect((await shown()).join() === 'IMG_0006.JPG' && (await tools()).shown === 'Visar 1 av 5. Exporterna tar hela listan.', 'Sökningen på appen: ' + await shown() + ' | ' + (await tools()).shown);
        await search('  DCIM kamerabild ');
        expect((await shown()).join() === 'IMG_0002.JPG,IMG_0009.JPG', 'Sökningen på mapp och typ: ' + await shown());
        await search('finns inte');
        expect((await shown()).join() === 'finns-inte.jpg', 'Sökningen på radens läge: ' + await shown());
        await search('');
        await chip('contradiction');
        expect((await shown()).join() === 'IMG_0002.JPG,IMG_0009.JPG' && (await tools()).chips[2] === '>Något inte förenligt 2', 'Gruppen: ' + await shown() + ' | ' + (await tools()).chips.join(' | '));

        // Föregående och Nästa går bara mellan raderna som visas, och urvalet står kvar på vägen tillbaka.
        await ev(`document.querySelectorAll('#batch-list tbody tr')[1].click(), 1`);
        await sleep(200);
        await waitResult(c, 'raden i urvalet');
        let nav = await ev(`({ pos: document.getElementById('batch-pos').textContent, prev: document.getElementById('batch-prev').disabled, next: document.getElementById('batch-next').disabled })`);
        expect(/^Fil 2 av 5 i listan: IMG_0002\.JPG/.test(nav.pos) && nav.prev && !nav.next, 'Raden i urvalet: ' + JSON.stringify(nav));
        await ev(`document.getElementById('batch-next').click(), 1`);
        await sleep(200);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && /^Fil 4 av 5/.test(document.getElementById('batch-pos').textContent)`, 60000, 'nästa i urvalet');
        nav = await ev(`({ name: ProvenanceApp.model().file.filename, next: document.getElementById('batch-next').disabled })`);
        expect(nav.name === 'IMG_0009.JPG' && nav.next, 'Nästa hoppade inte över raderna utanför urvalet: ' + JSON.stringify(nav));
        await ev(`document.getElementById('batch-back').click(), 1`);
        await sleep(200);
        expect((await shown()).join() === 'IMG_0002.JPG,IMG_0009.JPG', 'Urvalet efter vägen tillbaka: ' + await shown());

        // Exporten tar hela listan, också när ett urval visas.
        await ev(`document.getElementById('batch-save').click(), 1`);
        const saved = await download(downloads, /^harkomst-lista-.*\.html$/);
        for (const n of names) expect(saved.includes(n), 'Den sparade listan saknar ' + n + ' när ett urval visas');
        for (const f of fs.readdirSync(downloads)) if (/^harkomst-lista-/.test(f)) fs.unlinkSync(path.join(downloads, f));

        // Namnet som finns på två rader i bildbiblioteket: erbjudandet står ovanför listan, och varje träff blir en egen rad som bedöms.
        await chip('ambiguous');
        t = await tools();
        expect((await shown()).join() === 'IMG_0001.JPG' && /^En rad har flera träffar\./.test(t.hits) && t.expand === 'Visa alla 2 träffar som egna rader', 'Flera träffar: ' + JSON.stringify(t));
        const before = await ev(`ProvenanceApp.work()`);
        await bar();
        await ev(`document.getElementById('batch-expand').click(), 1`);
        await sleep(300);
        await listed(6, 'en rad per träff');
        r = await rows();
        t = await tools();
        expect(/^IMG_0001\.JPG .*träff 1 av 2 .*DCIM\/100APPLE\/IMG_0001\.JPG/.test(r[0].text) && /^IMG_0001\.JPG .*träff 2 av 2 .*DCIM\/101APPLE\/IMG_0001\.JPG/.test(r[1].text) && r[0].marks.length === 5 && r[1].marks.length === 5,
            'Träffarna som egna rader: ' + r.slice(0, 2).map((x) => x.text).join(' | '));
        expect(r.slice(2).map((x) => x.text.split(' ')[0]).join() === names.slice(1).join() && r.every((x) => !x.hidden), 'Raderna efter träffarna: ' + r.map((x) => (x.hidden ? '(gömd) ' : '') + x.text.split(' ')[0]).join());
        expect(t.chips.join(' | ') === '>Alla 6 | Med underlag 5 | Något inte förenligt 2 | Finns inte 1' && t.hits === '' && /^6 filer, /.test(t.note), 'Urvalet efter träffarna: ' + JSON.stringify(t));
        // Bara de nya raderna bedömdes: stapeln räknade två filer, och filerna som redan var lästa lästes inte om.
        const again = await bar();
        const after = await ev(`ProvenanceApp.work()`);
        expect(again.includes('progress|50%|50|1 av 2 klara') && !again.some((x) => /av 6 klara/.test(x)), 'Förloppet för träffarna: ' + again.join(' ; '));
        expect(after.exif - before.exif <= 2, 'Hela listan lästes om för träffarna: ' + JSON.stringify([before, after]));

        // En ny tidszon gör om listan med träffarna som egna rader, och sökningen står kvar.
        await search('101apple');
        await ev(`(function () { const z = document.getElementById('zone'); z.value = 'utc'; z.dispatchEvent(new Event('change')); return 1; })()`);
        await sleep(300);
        await listed(6, 'listan i en ny zon');
        t = await tools();
        r = await rows();
        expect(t.search === '101apple' && t.shown === 'Visar 1 av 6. Exporterna tar hela listan.' && r.filter((x) => !x.hidden).length === 1 && /träff 2 av 2/.test(r[1].text) && / UTC /.test(r[1].text), 'Listan i en ny zon: ' + JSON.stringify(t) + ' | ' + r[1].text);
        await ev(`(function () { const z = document.getElementById('zone'); z.value = 'file'; z.dispatchEvent(new Event('change')); return 1; })()`);
        await sleep(300);
        await listed(6, 'listan i filens zon');
        // En ny lista börjar utan urval. Namnet finns på två ställen i zippen utanför bildbiblioteket: träffarna skiljs åt på sökvägen.
        await type(['db_sqlite', 'IMG_0002.JPG']);
        await listed(2, 'en ny lista');
        t = await tools();
        expect(t.search === '' && t.shown === '' && t.chips.join(' | ') === '>Alla 2 | Med underlag 1 | Något inte förenligt 1 | Flera träffar 1' && t.expand === 'Visa alla 2 träffar som egna rader', 'En ny lista: ' + JSON.stringify(t));
        await ev(`document.getElementById('batch-expand').click(), 1`);
        await sleep(300);
        await listed(3, 'en rad per post i zippen');
        r = await rows();
        expect(/^db_sqlite .*träff 1 av 2 .*postbox\/db\/db_sqlite /.test(r[0].text) && /^db_sqlite .*träff 2 av 2 .*postbox\/media\/storage\/db\/db_sqlite /.test(r[1].text) && /^IMG_0002\.JPG /.test(r[2].text), 'Posterna som egna rader: ' + r.map((x) => x.text).join(' | '));
        // Raden öppnar just den posten.
        await ev(`document.querySelectorAll('#batch-list tbody tr')[1].click(), 1`);
        await sleep(200);
        await waitResult(c, 'träffens rad');
        const opened = await ev(`(ProvenanceApp.meta().fileEntry || {}).path || ''`);
        expect(/postbox\/media\/storage\/db\/db_sqlite$/.test(opened), 'Raden för träff 2 öppnade ' + opened);
        await ev(`document.getElementById('batch-back').click(), 1`);
        await sleep(200);
        return 'stapeln i ' + ran.length + ' lägen, 5 lägen med tecken och ord, 2 träffar som egna rader';
    }],

    ['Chattar: listan väljs på app, slag och tomma, ett nummer hittar gruppen genom deltagaren, och en databas fälls ihop', async ({ c }) => {
        const CHAT = 'chats/index.html';
        await c.nav('Chattar');
        await c.waitFor(CHAT, `!ChatsApp.busy() && ChatsApp.state().dbs.length > 0 && ChatsApp.state().dbs.every(d => d.state === 'ready')`, 60000, 'databaserna i Chattar');
        // Det sidan visar, bredvid det listan räknade fram.
        const read = () => c.ev(CHAT, `(function(){
            const text = (el) => el ? el.innerText.replace(/\\s+/g, ' ').trim() : '';
            const chips = (id) => [...document.querySelectorAll('#' + id + ' .c-chip')].map(b => text(b) + (b.getAttribute('aria-pressed') === 'true' ? '*' : ''));
            const v = ChatsApp.list();
            return {
                apps: chips('c-app-chips'), kinds: chips('c-kind-chips'), count: text(document.getElementById('c-count')),
                empty: document.getElementById('c-hide-empty-row').classList.contains('display-none') ? '' : text(document.getElementById('c-hide-empty-text')),
                // Rubriken visas med versaler: textContent har den som den är skriven.
                groups: [...document.querySelectorAll('#c-list .c-group')].map(b => b.querySelector('.c-group-name').textContent + ' [' + b.querySelector('.c-group-count').textContent + ']' + (b.getAttribute('aria-expanded') === 'true' ? '' : ' hopfälld')),
                items: [...document.querySelectorAll('#c-list .c-item')].map(text), none: text(document.querySelector('#c-list > .c-list-empty')),
                query: document.getElementById('c-search').value, total: v.total, shown: v.shown, filtered: v.filtered,
            };
        })()`);
        const press = (what, value) => c.ev(CHAT, `[...document.querySelectorAll('#c-${what}-chips .c-chip')].find(b => b.dataset.${what} === ${JSON.stringify(value)}).click(), 1`);
        const search = (q) => c.ev(CHAT, `(function(){ const s = document.getElementById('c-search'); s.value = ${JSON.stringify(q)}; s.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
        const names = (s) => s.items.map((t) => t.split(' ')[0]);

        // Från början: allt visas, och varje app och slag säger hur många konversationer det har.
        const all = await read();
        expect(!all.filtered && all.count === '' && all.items.length === all.total && all.total === all.shown, 'Från början: ' + JSON.stringify(all));
        expect(all.apps.length === 3 && all.apps.includes('WhatsApp 3'), 'Apparna: ' + all.apps);
        expect(all.kinds.join(', ') === 'Enskilda ' + (all.total - 1) + ', Grupper 1', 'Slagen: ' + all.kinds);
        expect(all.empty === 'Dölj tomma (1)', 'De tomma: ' + all.empty);

        // En app: bara den står kvar, och raden under valen säger hur mycket som visas.
        await press('app', 'WhatsApp');
        const wa = await read();
        expect(wa.apps.includes('WhatsApp 3*') && wa.groups.join() === 'WhatsApp · iOS [3 av 3]', 'Vald app: ' + JSON.stringify(wa));
        expect(wa.count === 'Visar 3 av ' + all.total + ' konversationer. Visa alla' && wa.items.length === 3, 'Raden under valen: ' + wa.count);
        expect(wa.kinds.join(', ') === 'Enskilda 2, Grupper 1', 'Slagen i appen: ' + wa.kinds);
        // Appen och slaget tillsammans, och sedan utan de tomma.
        await press('kind', 'group');
        const groups = await read();
        expect(groups.items.join() === 'Klubben Grupp 0 meddelanden' && groups.kinds.includes('Grupper 1*'), 'Gruppen: ' + JSON.stringify(groups));
        await c.ev(CHAT, `document.getElementById('c-hide-empty').click(), 1`);
        const hidden = await read();
        expect(hidden.items.length === 0 && hidden.none === 'Ingen konversation i urvalet.' && hidden.count.startsWith('Visar 0 av '), 'Utan de tomma: ' + JSON.stringify(hidden));
        // Visa alla tar bort varje val.
        await c.ev(CHAT, `document.getElementById('c-reset').click(), 1`);
        const reset = await read();
        expect(JSON.stringify(reset) === JSON.stringify(all), 'Efter Visa alla: ' + JSON.stringify(reset));

        // Numret står hos en deltagare, skrivet på ett annat sätt än i databasen (46701234567@s.whatsapp.net).
        await search('070-123 45 67');
        const byNumber = await read();
        expect(byNumber.items.join() === 'Klubben Grupp 0 meddelanden Deltagare: Mo Månsson', 'Numret: ' + JSON.stringify(byNumber.items));
        expect(byNumber.count === 'Visar 1 av ' + all.total + ' konversationer. Visa alla', 'Raden under valen: ' + byNumber.count);
        // Två ord: båda ska finnas, i namnet eller hos en deltagare.
        await search('klubb månsson');
        expect(names(await read()).join() === 'Klubben', 'Namn och deltagare');
        await search('långa månsson');
        const nothing = await read();
        expect(nothing.items.length === 0 && nothing.none === 'Ingen konversation matchar sökningen. Den letar i namn, nummer och deltagare, inte i meddelandenas text. Ett nummer hittas bara om databasen har det.', 'Utan träff: ' + JSON.stringify(nothing));
        // Pil ned i sökrutan går till listan.
        await search('');
        const focus = await c.ev(CHAT, `(function(){ const s = document.getElementById('c-search'); s.focus(); s.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); return document.activeElement.className; })()`);
        expect(focus === 'c-group', 'Pil ned gav fokus till ' + focus);

        // Namn A–Ö i svensk ordning, och en databas som fälls ihop tar sina rader med sig.
        const sort = (value) => c.ev(CHAT, `(function(){ const s = document.getElementById('c-sort'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
        await sort('name');
        expect(names(await read()).slice(0, 3).join() === 'Klubben,Lo,Långa', 'Namn A–Ö: ' + names(await read()));
        await sort('recent');
        await c.ev(CHAT, `document.querySelector('#c-list .c-group[data-group="0"]').click(), 1`);
        const folded = await read();
        expect(folded.groups[0] === 'WhatsApp · iOS [3] hopfälld' && folded.items.length === all.total - 3, 'Hopfälld: ' + JSON.stringify(folded.groups) + ', ' + folded.items.length + ' rader');
        await c.ev(CHAT, `document.querySelector('#c-list .c-group[data-group="0"]').click(), 1`);
        expect(JSON.stringify(await read()) === JSON.stringify(all), 'Utfälld igen');
        await noInjectedScript(c);
        return all.total + ' konversationer i ' + all.apps.length + ' appar, numret hittar gruppen genom deltagaren';
    }],

    ['Chattar: telefonvyn ställer chatten i en ram märkt som rekonstruktion, platsen står kvar vid bytet, och exporten får samma utseende', async ({ c, fx, downloads }) => {
        const CHAT = 'chats/index.html';
        const L = fx.longChat;
        const LABEL = 'Rekonstruktion ur databasen – inte en skärmbild';
        await c.nav('Chattar');
        await c.waitFor(CHAT, `!ChatsApp.busy() && [...document.querySelectorAll('.c-item')].some(b => b.innerText.includes('Långa chatten'))`, 60000, 'den långa chatten i listan');
        const open = async (start, n) => {
            await c.ev(CHAT, `[...document.querySelectorAll('.c-item')].find(b => b.innerText.startsWith(${JSON.stringify(start)})).click(), 1`);
            await c.waitFor(CHAT, `!ChatsApp.busy() && ChatsApp.view() && ChatsApp.view().n === ${n} && document.getElementById('c-title').textContent.startsWith(${JSON.stringify(start)})`, 60000, 'chatten ' + start);
        };
        // Klicket, och två ritade bilder efter det, så att det som sidan gör efter klicket har hunnit ske.
        const click = (id) => c.ev(CHAT, `(async function(){ document.getElementById(${JSON.stringify(id)}).click(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return 1; })()`);
        // Ramen, huvudet och foten som de visas, och var i chatten sidan står.
        const read = () => c.ev(CHAT, `(function(){
            const box = document.getElementById('c-msgs'), phone = document.getElementById('c-phone'), foot = document.getElementById('c-phone-foot'), b = box.getBoundingClientRect();
            const shown = (el) => getComputedStyle(el).display !== 'none';
            const list = [...box.querySelectorAll('.m')], top = list.find(m => m.getBoundingClientRect().bottom > b.top), last = list[list.length - 1];
            return {
                look: ChatsApp.look(), stage: document.getElementById('c-stage').classList.contains('phone'), frame: phone.dataset.frame, width: phone.getBoundingClientRect().width,
                pressed: ['c-look-list', 'c-look-phone'].map(id => document.getElementById(id).getAttribute('aria-pressed')).join(),
                head: shown(phone.querySelector('.c-phone-head')), foot: shown(foot) ? foot.textContent : '',
                avatar: document.getElementById('c-phone-avatar').textContent, name: document.getElementById('c-phone-name').textContent, tags: document.getElementById('c-phone-name').children.length, sub: document.getElementById('c-phone-sub').textContent,
                atEnd: box.scrollHeight - box.scrollTop - box.clientHeight < 2, lastShown: !!last && Number(last.dataset.i) === ChatsApp.view().n - 1 && last.getBoundingClientRect().bottom <= b.bottom + 1,
                top: top ? { i: Number(top.dataset.i), y: Math.round((top.getBoundingClientRect().top - b.top) * 10) / 10, h: Math.round(top.getBoundingClientRect().height * 10) / 10 } : null,
            };
        })()`);

        // Listan från början: ingen ram, och chatten står vid sitt slut.
        await open('Långa chatten', L.count);
        await click('c-last');
        await c.waitFor(CHAT, `ChatsApp.view().to === ${L.count}`, 30000, 'slutet av chatten');
        const before = await read();
        expect(before.look === 'list' && !before.stage && !before.head && before.foot === '' && before.pressed === 'true,false', 'Listan från början: ' + JSON.stringify(before));
        expect(before.atEnd && before.lastShown, 'Chatten står inte vid sitt slut: ' + JSON.stringify(before));

        // Telefon: ramen har en telefons bredd, huvudet säger vem chatten är med och foten vad vyn är.
        // Chatten står kvar vid sitt slut.
        await click('c-look-phone');
        const phone = await read();
        expect(phone.look === 'phone' && phone.stage && phone.pressed === 'false,true', 'Efter Telefon: ' + JSON.stringify(phone));
        expect(phone.frame === 'ios' && Math.abs(phone.width - 414.4) < 1, 'Ramen: ' + phone.frame + ', ' + phone.width + ' px');
        expect(phone.head && phone.avatar === 'L' && phone.name === 'Långa chatten' && phone.sub === '2@lid', 'Huvudet: ' + JSON.stringify(phone));
        expect(phone.foot === LABEL, 'Foten: ' + phone.foot);
        expect(phone.atEnd && phone.lastShown, 'Chatten står inte kvar vid slutet: ' + JSON.stringify(phone));

        // Mitt i chatten: meddelandet som kanten skär står kvar överst i båda utseendena, skuret på samma ställe, fast
        // raderna bryts olika. Kanten ställs nära slutet av det högsta meddelandet som syns: i listan är det kortare,
        // och med samma avstånd till kanten som förut hamnade det helt ovanför den.
        const CUT = 0.85;
        const cutAt = await c.ev(CHAT, `(async function(){
            const box = document.getElementById('c-msgs');
            const frames = async () => { for (let k = 0; k < 3; k++) await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); };
            box.scrollTop = Math.round(box.scrollHeight / 2) + 7;
            await frames();
            const b = box.getBoundingClientRect();
            const tall = [...box.querySelectorAll('.m')].map(m => ({ m, r: m.getBoundingClientRect() })).filter(x => x.r.top >= b.top && x.r.top < b.bottom).sort((x, y) => y.r.height - x.r.height)[0];
            box.scrollTop += tall.r.top - b.top + ${CUT} * tall.r.height;
            await frames();
            return Number(tall.m.dataset.i);
        })()`);
        const mid = await read();
        await click('c-look-list');
        const midList = await read();
        await click('c-look-phone');
        const midPhone = await read();
        const tops = JSON.stringify([mid.top, midList.top, midPhone.top]);
        expect(mid.top && midList.top && midPhone.top && !mid.atEnd && midList.look === 'list' && midPhone.look === 'phone', 'Bytet mitt i chatten: ' + JSON.stringify([mid, midList, midPhone]));
        expect(mid.top.i === cutAt && Math.abs(-mid.top.y / mid.top.h - CUT) < 0.05, 'Kanten står inte nära slutet av meddelandet ' + cutAt + ': ' + tops);
        expect(midList.top.i === mid.top.i && midPhone.top.i === mid.top.i, 'Ett annat meddelande står överst efter bytet: ' + tops);
        expect(midList.top.h < mid.top.h - 10, 'Meddelandet är inte kortare i listan, så det svåra fallet prövas inte: ' + tops);
        expect(Math.abs(midList.top.y + CUT * midList.top.h) <= 3 && Math.abs(midPhone.top.y - mid.top.y) <= 2, 'Meddelandet skärs inte på samma ställe efter bytet: ' + tops);

        // Exportrutan föreslår utseendet som visas, och uppskattningen följer valet: två smala remsor på sidan ger
        // färre sidor än listan. Valet i rutan ändrar inte det som visas.
        const estimate = async () => {
            const v = await c.ev(CHAT, `({ look: document.querySelector('input[name="c-look"]:checked').value, text: document.getElementById('c-export-estimate').textContent })`);
            const m = /^Urvalet: 3 000 meddelanden\. Filen blir omkring [\d,]+ (?:kB|MB), och en utskrift omkring ([\d ]+) sidor\.$/.exec(v.text.replace(/\s+/g, ' '));
            expect(m, 'Uppskattningen: ' + v.text);
            return { look: v.look, pages: Number(m[1].replace(/ /g, '')), text: v.text };
        };
        await click('c-export-open');
        const asPhone = await estimate();
        await c.ev(CHAT, `document.querySelector('input[name="c-look"][value="list"]').click(), 1`);
        await c.waitFor(CHAT, `document.getElementById('c-export-estimate').textContent !== ${JSON.stringify(asPhone.text)}`, 5000, 'uppskattningen för listan');
        const asList = await estimate();
        expect(asPhone.look === 'phone' && asList.look === 'list' && asPhone.pages < asList.pages, 'Sidorna: telefon ' + asPhone.pages + ', lista ' + asList.pages);
        await click('c-export-cancel');
        expect(await c.ev(CHAT, `ChatsApp.look()`) === 'phone', 'Valet i exportrutan ändrade utseendet på skärmen');

        // En annan chatt öppnas i samma utseende. Namnet ur databasen skrivs som text, och bubblorna med bilden
        // håller sig inom ramen.
        await open('Lo ', 2);
        await c.waitFor(CHAT, `(document.querySelector('.att-img img') || {}).naturalWidth > 0`, 30000, 'bilden i telefonvyn');
        const lo = await read();
        expect(lo.look === 'phone' && lo.frame === 'ios' && lo.avatar === 'L' && lo.name.startsWith('Lo <img') && lo.tags === 0 && lo.sub === '1@lid', 'Huvudet för chatten med Lo: ' + JSON.stringify(lo));
        const fits = await c.ev(CHAT, `(function(){ const p = document.getElementById('c-msgs').getBoundingClientRect(); return [...document.querySelectorAll('#c-msgs .b')].map(b => b.getBoundingClientRect()).filter(r => r.left < p.left || r.right > p.right).length; })()`);
        expect(fits === 0, fits + ' bubblor sticker ut ur ramen');

        // Exporten: samma ram i filen, märkt som rekonstruktion, och numren som leder till tabellen Spårbarhet.
        // Den förra exporten av samma chatt tas bort först, så att det är den nya filen som läses.
        for (const n of fs.readdirSync(downloads)) if (/^WhatsApp-.*\.html$/.test(n)) fs.unlinkSync(path.join(downloads, n));
        await click('c-export-open');
        expect(await c.ev(CHAT, `document.querySelector('input[name="c-look"]:checked').value`) === 'phone', 'Exportrutan föreslår inte utseendet som visas');
        await c.ev(CHAT, `document.getElementById('c-export-html').click(), 1`);
        const html = await download(downloads, /^WhatsApp-.*\.html$/, 20000);
        await c.waitFor(CHAT, `!ChatsApp.busy()`, 20000, 'exporten');
        expect(html.includes('<div class="phone ios" data-app="WhatsApp">') && html.includes('<span class="avatar">L</span>'), 'Ramen saknas i exporten');
        expect(html.includes('<div class="phone-foot"><span>' + LABEL + '</span></div>'), 'Märkningen som rekonstruktion saknas i exporten');
        expect(html.includes('<tr><th>Utseende</th><td>Telefon: en rekonstruktion ur databasen, ingen skärmbild</td></tr>'), 'Raden Utseende saknas i exporten');
        expect((html.match(/<span class="no">#\d+<\/span>/g) || []).join() === '<span class="no">#1</span>,<span class="no">#2</span>', 'Numren vid bubblorna i exporten');
        expect(html.includes('<h2>Spårbarhet</h2>') && html.includes('data:image/jpeg;base64,') && html.includes('ZMESSAGEDATE'), 'Spårbarheten eller bilden saknas i exporten');
        expect(!html.includes('<img src=x onerror'), 'HTML ur databasen står oescapad i exporten');
        expect(await c.ev(CHAT, `ChatsApp.look()`) === 'phone', 'Exporten ändrade utseendet på skärmen');

        // Tillbaka till listan: ramen, huvudet och foten är borta.
        await click('c-look-list');
        const after = await read();
        expect(after.look === 'list' && !after.stage && !after.head && after.foot === '' && after.pressed === 'true,false', 'Tillbaka i listan: ' + JSON.stringify(after));
        await noInjectedScript(c);
        return 'ramen ' + Math.round(phone.width) + ' px, platsen står kvar vid bytet, ' + asPhone.pages + ' sidor som telefon mot ' + asList.pages + ' som lista, exporten har ramen och numren';
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

    ['Rapport (UFDR): öppnas som en extraktion, med telefonens sökvägar, namngivna tider och nyckelringen ur rapporten', async ({ c, fx, downloads }) => {
        await c.nav('Härkomst');
        await c.setFiles(null, '#cb-input', [fx.files.ufdr]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && /report\\.xml: \\d+ filer från telefonen/.test(document.getElementById('ex-status').textContent)`, 60000, 'rapporten i Härkomst');
        const list = await c.ev(PROV, `document.getElementById('ex-list').innerText`);
        expect(/Rapport i UFDR-format, rapportverktygets version 10\.11\.0\.3022/.test(list), 'Rapporten: ' + list);
        expect(!/cellebrite|physical analyzer/i.test(list), 'Verktygets namn står i texten: ' + list);
        expect(/säger inte att den saknades på telefonen/.test(list) && /ctime/.test(list), 'Vad en rapport inte kan säga: ' + list);
        expect(/1 filer som rapportverktyget utvunnit/.test(list), 'Det utvunna: ' + list);
        expect(/Sökväg i rapporten/.test(list), 'Tabellen: ' + list);
        const note = await c.waitFor(PROV, `/Nyckeln läses ur/.test(document.getElementById('signal-key-note').textContent) && document.getElementById('signal-key-note').textContent`, 20000, 'nyckelringen');
        expect(/Testrapport_keychain\.plist i rapporten/.test(note), 'Nyckeln: ' + note);

        // Filen med de namngivna tiderna. Samma T som ur zippen, och ctime sägs saknas i stället för att gissas.
        // Namnet finns i två mappar, så en vallista visas först.
        const first = async () => {
            await c.ev(PROV, `document.getElementById('filename').value = '${fx.imageName}', document.getElementById('run').click(), 1`);
            await c.waitFor(PROV, `!document.getElementById('hits').classList.contains('display-none') && document.querySelectorAll('#hits tr.pick').length`, 60000, 'vallistan');
            await c.ev(PROV, `[...document.querySelectorAll('#hits tr.pick')].find(tr => /100APPLE/.test(tr.innerText)).click(), 1`);
            await sleep(300);
            await waitResult(c, 'bedömningen');
        };
        await first();
        const T = await c.ev(PROV, `ProvenanceApp.model().file.createdMs`);
        expect(T === fx.T, 'T är ' + new Date(T).toISOString());
        const st = await c.ev(PROV, `(function(){ const t = ProvenanceApp.model().factors.find(x => x.id === 'time'); const row = (id) => t.times.find(r => r.id === id);
            const src = (r) => r && r.source ? [r.source.db, r.source.table, r.source.column].join(' / ') : '';
            return { modified: src(row('fs-modified')), modifiedMs: row('fs-modified') && row('fs-modified').ms, created: src(row('fs-created')), accessed: src(row('fs-accessed')), changed: row('fs-changed') && row('fs-changed').absent, card: document.getElementById('file-card').innerText, path: ProvenanceApp.meta().fileEntry.path }; })()`);
        expect(st.modified === 'Rapporten / report.xml / ModifyTime' && st.modifiedMs === fx.T + 1000, 'Ändrad: ' + JSON.stringify(st));
        expect(st.created === 'Rapporten / report.xml / CreationTime' && st.accessed === 'Rapporten / report.xml / AccessTime', 'Tiderna: ' + JSON.stringify(st));
        expect(/Rapporten anger ingen sådan tid/.test(st.changed || ''), 'ctime: ' + JSON.stringify(st));
        expect(/^\/private\/var\/mobile\/Media\/DCIM\/100APPLE\/IMG_0001\.JPG$/.test(st.path), 'Sökvägen är telefonens: ' + st.path);
        expect(/Post i rapporten/.test(st.card) && /samma som filens/.test(st.card) && /Device Captured, Native Camera App/.test(st.card), 'Kortet: ' + st.card);

        // Nyckeln ur rapporten låser upp Signal, och samma innehåll på två ställen hittas som kopia.
        const sig = await assessNamed(c, 'IMG_0006.JPG');
        expect(sig.f.signal && sig.f.signal.state === 'support', 'Signal: ' + JSON.stringify(sig.f.signal));
        const cam = await assessNamed(c, 'IMG_0008.JPG');
        const copies = await c.ev(PROV, `(ProvenanceApp.model().copies || []).map(x => x.name)`);
        expect(copies.some((n) => /tmp\/camphoto_123456\.jpg$/.test(n)), 'Kopian under RelatedNodes: ' + copies);
        expect(cam.model.titles.camera === 'Telegrams kamera', 'Kameran: ' + cam.model.titles.camera);

        // Det utvalda: filen finns i biblioteket men inte i rapporten, och det sägs som det är.
        const gone = await assessNamed(c, 'IMG_0002.JPG');
        expect(gone.model.name === 'IMG_0002.JPG', 'Bedömningen: ' + JSON.stringify(gone.model));
        const reason = await c.ev(PROV, `ProvenanceApp.meta().fileMissingReason`);
        expect(/finns inte i rapporten \(den kan ha valts bort/.test(reason), 'Skälet: ' + reason);
        await c.ev(PROV, `document.getElementById('filename').value = 'finns-inte.jpg', document.getElementById('run').click(), 1`);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && /finns-inte\.jpg/.test(document.getElementById('run-status').textContent)`, 30000, 'namnet utan träff');
        const none = await c.ev(PROV, `document.getElementById('run-status').textContent`);
        expect(/ingen fil med det namnet i rapporten/.test(none) && /säger inte att filen saknades på telefonen/.test(none), 'Utan träff: ' + none);

        // Protokollet säger vad källan är.
        await first();
        // Protokollet ur zippen ligger kvar i mappen från ett tidigare steg, med samma namn.
        fs.readdirSync(downloads).filter((n) => /^harkomst-IMG_0001-protokoll-/.test(n)).forEach((n) => fs.unlinkSync(path.join(downloads, n)));
        await c.ev(PROV, `document.getElementById('save-protocol').click(), 1`);
        const html = await download(downloads, /^harkomst-IMG_0001-protokoll-.*\.html$/);
        expect(html.includes('Källan är en rapport') && html.includes('Bildfilen i rapporten') && html.includes('Testrapport_Report.ufdr'), 'Protokollet saknar rapporten');
        expect(html.includes('Post i rapporten'), 'Protokollet saknar raderna ur rapporten');
        expect(!/cellebrite|physical analyzer/i.test(html), 'Verktygets namn står i protokollet');

        // Queries läser samma rapport. Fliken har en databas ur zippen och byter inte av sig själv, så en ny flik tar rapporten.
        await c.nav('Queries');
        await c.ev(QUER, `document.getElementById('tab-new').click(), 1`);
        await c.waitFor(QUER, `/databaser hittades/.test(document.getElementById('ex-status').textContent) && document.getElementById('bar-zip').textContent === 'Testrapport_Report.ufdr'`, 60000, 'rapporten i Queries');
        await c.ev(QUER, `(function(){ const b = document.querySelector('.side-db[data-family="knowledgec"]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); document.querySelector('.side-q[data-db="knowledgec"][data-q="app-usage"]').click(); return 1; })()`);
        await sleep(300);
        await c.ev(QUER, `document.getElementById('run-button').click(), 1`);
        await c.waitFor(QUER, `/rad(er)? på/.test(document.getElementById('run-status').textContent)`, 30000, 'queryn');
        const q = await c.ev(QUER, `({ rows: document.querySelectorAll('#run-result tbody tr').length, status: document.getElementById('run-status').innerText, trace: document.getElementById('run-trace').textContent })`);
        expect(q.rows === 3, 'app-usage ur rapporten: ' + q.rows + ' rader. ' + q.status);
        expect(/Rapport \(UFDR, rapportverktygets version 10\.11\.0\.3022\)/.test(q.trace) && /Ur rapporten: \/private\/var\/mobile\/Library\/CoreDuet\/Knowledge\/knowledgeC\.db \(posten files\//.test(q.trace), 'Spårbarheten: ' + q.trace.slice(0, 400));
        await noInjectedScript(c);
        return 'tider, nyckel, kopia, urval, protokoll och Queries';
    }],

    ['Nyckelringen som väljs med zippen i Queries följer med till ett verktyg som öppnas senare', async ({ c, fx }) => {
        await c.nav('Queries');
        await c.setFiles(null, '#cb-input', [fx.files.zip, fx.files.keychain]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await c.waitFor(QUER, `/databaser hittades/.test(document.getElementById('ex-status').textContent) && document.getElementById('bar-zip').textContent === 'Testextraktion-iOS17.zip'`, 60000, 'zippen i Queries');
        await sleep(300);
        // Härkomst laddas om, som när den öppnas först nu: då har den bara det huvudfönstret minns.
        await c.ev(PROV, `location.reload(), 1`);
        await sleep(800);
        await c.waitFor(PROV, `window.ProvenanceApp && /databaser hittades/.test(document.getElementById('ex-status').textContent)`, 60000, 'zippen i Härkomst');
        const note = await c.waitFor(PROV, `/Nyckeln läses ur/.test(document.getElementById('signal-key-note').textContent) && document.getElementById('signal-key-note').textContent`, 10000, 'nyckelringen i Härkomst');
        expect(/Testextraktion-iOS17_keychain\.plist/.test(note), 'Nyckeln: ' + note);
        return 'nyckeln läses i Härkomst';
    }],

    ['Nyckeln hittas själv: krypterad under extra/, bredvid zippen, och annars sägs var programmet letade', async ({ c, fx }) => {
        await c.nav('Härkomst');
        const desktop = await c.ev(null, `!!window.forensicsMedia`);
        const pick = async (files) => {
            await c.setFiles(null, '#cb-input', files);
            await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        };
        const noteAfter = async (file) => {
            const name = path.basename(file);
            await c.waitFor(PROV, `!window.ProvenanceApp.busy() && document.getElementById('ex-status').textContent.includes(${JSON.stringify(name)}) && !document.getElementById('signal-key-row').classList.contains('display-none') && !!document.getElementById('signal-key-note').textContent`, 60000, name + ' i Härkomst');
            return c.ev(PROV, `document.getElementById('signal-key-note').textContent`);
        };
        // Under extra/ i zippen, med posterna krypterade: dekrypteras i sidan, och Signal går att läsa med nyckeln.
        await pick([fx.files.ufed]);
        const inZip = await noteAfter(fx.files.ufed);
        expect(/Nyckeln läses ur extra\/KeychainDump\/backup_keychain_v2\.plist i zippen\./.test(inZip), 'Under extra/: ' + inZip);
        const sig = await assessNamed(c, 'IMG_0006.JPG');
        expect(sig.f.signal && sig.f.signal.state === 'support' && /Mottagen i Signal/.test(sig.f.signal.verdict), 'Signal: ' + JSON.stringify(sig.f.signal));
        // Protokollets EXIF-tabell har bara det som står i filen: ExifTools System:-taggar gäller körningen.
        const tags = await c.ev(PROV, `ProvenanceApp.meta().exifRows.map(r => r[0])`);
        expect(tags.length && !tags.some((t) => /^System:/.test(t)), 'EXIF-raderna: ' + tags);
        // Bilagans krypterade fil: läst, men inget ExifTool kan tolka, och kopplad till meddelandet med sin plats.
        const part = await assessNamed(c, 'ABCDEF');
        expect(part.f.signal && part.f.signal.verdict === 'Mottagen i Signal', 'Signal: ' + JSON.stringify(part.f.signal));
        const partFile = await c.ev(PROV, `(function(){ const m = ProvenanceApp.model(), t = m.factors.find(x => x.id === 'time'); return { row: t.times.find(r => r.id === 'file-time').absent, sha: ProvenanceApp.meta().fileEntry.sha256, signal: m.factors.find(x => x.id === 'signal').items.map(i => i.text).join(' ') }; })()`);
        expect(/Filen är bilagans krypterade fil hos Signal\./.test(partFile.signal), 'Signal: ' + partFile.signal);
        expect(/^Filen lästes, men ExifTool kunde inte tolka innehållet/.test(partFile.row) && /^[0-9a-f]{64}$/.test(partFile.sha), 'Filen: ' + JSON.stringify(partFile));
        // Rapporten ur samma sorts zip: telefonens filer under /root/, nyckelringen högst upp och ctime i rapporten.
        await pick([fx.files.ufedReport]);
        const inReport = await noteAfter(fx.files.ufedReport);
        expect(/Nyckeln läses ur backup_keychain_v2\.plist i rapporten\./.test(inReport), 'I rapporten: ' + inReport);
        const rep = await assessNamed(c, 'IMG_0006.JPG');
        expect(rep.f.signal && rep.f.signal.state === 'support' && /Mottagen i Signal/.test(rep.f.signal.verdict), 'Signal ur rapporten: ' + JSON.stringify(rep.f.signal));
        const repTimes = await c.ev(PROV, `(function(){ const r = ProvenanceApp.model().factors.find(x => x.id === 'time').times.find(x => x.id === 'fs-changed'); return { ms: r.ms, source: r.source ? [r.source.db, r.source.table, r.source.column].join(' / ') : '', path: ProvenanceApp.meta().fileEntry.path, list: document.getElementById('ex-list').innerText }; })()`);
        expect(repTimes.ms && repTimes.source === 'Rapporten / report.xml / ChangeTime', 'ctime ur rapporten: ' + JSON.stringify(repTimes));
        expect(/^\/root\/private\/var\/mobile\//.test(repTimes.path), 'Sökvägen: ' + repTimes.path);
        expect(!/backup_keychain_v2/.test(repTimes.list) && !/ctime/.test(repTimes.list), 'Listan: ' + repTimes.list);
        // Det undersökaren väljer går före det programmet hittade.
        await pick([fx.files.keychain]);
        await c.waitFor(PROV, `/Nyckeln läses ur Testextraktion-iOS17_keychain\\.plist/.test(document.getElementById('signal-key-note').textContent)`, 20000, 'den valda nyckelfilen');
        // Bredvid zippen. Den valda filen hörde till den förra extraktionen och följer inte med.
        await pick([fx.files.beside]);
        const near = await noteAfter(fx.files.beside);
        if (desktop) {
            expect(near.includes('Nyckeln läses ur ' + fx.files.besideKey + ' bredvid zippen.'), 'Bredvid: ' + near);
            const again = await assessNamed(c, 'IMG_0006.JPG');
            expect(again.f.signal && again.f.signal.state === 'support', 'Signal med nyckeln bredvid: ' + JSON.stringify(again.f.signal));
        } else {
            expect(/Ingen nyckel hittades under extra\/ i zippen\. En webbläsare får inte se mappen där zippen ligger\. Välj nyckelringen/.test(near), 'I webbläsaren: ' + near);
        }
        // Två filer som inget knyter till zippen: ingen väljs, och båda nämns.
        await pick([fx.files.many]);
        const many = await noteAfter(fx.files.many);
        expect(!/Nyckeln läses ur/.test(many), 'Ingen ska väljas: ' + many);
        if (desktop) expect(/Bredvid zippen ligger a_keychain\.plist, b_keychain\.plist, men inget visar att de hör till den\. Välj nyckelringen/.test(many), 'Flera: ' + many);
        // Reserven: filen väljs, eller nyckeln klistras in.
        await c.setFiles(PROV, '#signal-keyfile', [fx.files.keychain]);
        await c.ev(PROV, `document.getElementById('signal-keyfile').dispatchEvent(new Event('change')), 1`);
        await c.waitFor(PROV, `/Nyckeln läses ur Testextraktion-iOS17_keychain\\.plist/.test(document.getElementById('signal-key-note').textContent)`, 20000, 'Nyckelfil…');
        const pasted = await c.ev(PROV, `(function(){ const i = document.getElementById('signal-key'); i.value = "x'" + 'ab'.repeat(48) + "'"; i.dispatchEvent(new Event('input', { bubbles: true })); const t = document.getElementById('signal-key-note').textContent; i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return t; })()`);
        expect(/inklistrade nyckeln/.test(pasted), 'Inklistrad: ' + pasted);
        // Queries letar på samma sätt, och säger samma sak.
        await c.nav('Queries');
        await pick([fx.files.ufed]);
        await c.waitFor(QUER, `/databaser hittades/.test(document.getElementById('ex-status').textContent) && document.getElementById('bar-zip').textContent === 'EXTRACTION_FFS.zip'`, 60000, 'zippen i Queries');
        await c.ev(QUER, `(function(){ const b = document.querySelector('.side-db[data-family="signal-ios-main"]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); return 1; })()`);
        await c.ev(QUER, `document.querySelector('.side-q[data-db="signal-ios-main"][data-q="messages"]').click(), 1`);
        await sleep(300);
        const day = new Date(fx.T2).toISOString().slice(0, 10);
        await c.ev(QUER, `(function(){ const s = document.querySelector('[data-param="timeStart"]'), e = document.querySelector('[data-param="timeEnd"]'); s.value = '${day} 00:00'; e.value = '${day} 23:59'; s.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
        await c.ev(QUER, `document.getElementById('run-button').click(), 1`);
        await c.waitFor(QUER, `/rad(er)? på/.test(document.getElementById('run-status').textContent) || /run-warn/.test(document.getElementById('run-status').innerHTML)`, 30000, 'körningen i Queries');
        const rows = await c.ev(QUER, `document.querySelectorAll('#run-result tbody tr').length`);
        expect(rows === 1, 'Signal i Queries med nyckeln under extra/: ' + rows + ' rader');
        await pick([fx.files.noKey]);
        await c.waitFor(QUER, `document.getElementById('bar-zip').textContent === 'Ingen-nyckel.zip'`, 60000, 'nästa zip i Queries');
        const q = await c.waitFor(QUER, `(function(){ const n = document.getElementById('run-key-note'); return n && /Ingen nyckel hittades/.test(n.textContent) && n.textContent; })()`, 20000, 'beskedet i Queries');
        expect(desktop ? /under extra\/ i zippen eller bredvid den\./.test(q) : /under extra\/ i zippen\. En webbläsare/.test(q), 'Queries: ' + q);
        await c.nav('Härkomst');
        await noInjectedScript(c);
        return desktop ? 'under extra/, bredvid zippen, flera, och reserven' : 'under extra/ och reserven, i webbläsaren utan mappen';
    }],

    ['Verktygen delar på läsningen: det Chattar har läst och dekrypterat läser Härkomst och Queries inte om', async ({ c, fx }) => {
        const CHAT = 'chats/index.html';
        // En zip som inget verktyg har läst förut, vald med Chattar framme: Chattar läser databaserna genast,
        // Härkomst först när en fil bedöms och Queries när en query körs.
        const name = 'Delad-läsning.zip';
        const zip = path.join(fx.files.dir, name);
        fs.writeFileSync(zip, fs.readFileSync(fx.files.ufed));
        await c.nav('Chattar');
        await c.setFiles(null, '#cb-input', [zip]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await c.waitFor(CHAT, `!ChatsApp.busy() && ChatsApp.state().zip && ChatsApp.state().zip.file.name === ${JSON.stringify(name)} && ChatsApp.state().dbs.length > 0 && ChatsApp.state().dbs.every(d => d.state === 'ready')`, 60000, 'zippen i Chattar');
        const first = await c.ev(CHAT, `ChatsApp.state().dbs.map(d => ({ app: d.src.app, by: d.loaded ? d.loaded.sharedBy : null, cipher: !!(d.loaded && d.loaded.stats.cipher) }))`);
        const signal = first.find((d) => d.app === 'Signal');
        expect(signal && signal.cipher && signal.by === '', 'Chattar läste inte Signals databas själv: ' + JSON.stringify(first));

        // Härkomst: bedömningen får samma svar, och protokollets källa säger vem som läste databasen och när.
        await c.nav('Härkomst');
        await c.waitFor(PROV, `!ProvenanceApp.busy() && document.getElementById('ex-status').textContent.includes(${JSON.stringify(name)}) && /Nyckeln läses ur/.test(document.getElementById('signal-key-note').textContent)`, 60000, 'zippen i Härkomst');
        const sig = await assessNamed(c, 'IMG_0006.JPG');
        expect(sig.f.signal && sig.f.signal.state === 'support' && /Mottagen i Signal/.test(sig.f.signal.verdict), 'Signal: ' + JSON.stringify(sig.f.signal));
        const sources = await c.ev(PROV, `ProvenanceApp.meta().sources.map(s => ({ path: s.path, shared: s.shared, cipher: s.cipher, sha256: s.sha256, crcOk: s.crcOk }))`);
        const src = sources.find((s) => /signal\.sqlite$/.test(s.path));
        expect(src && /^Läst ur zippen av Chattar \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\. Verktygen delar på läsningen: /.test(src.shared), 'Signals källa i Härkomst: ' + JSON.stringify(src));
        expect(src.cipher && /^[0-9a-f]{64}$/.test(src.sha256) && src.crcOk === true, 'Kontrollerna följer inte med: ' + JSON.stringify(src));
        const shown = await c.ev(PROV, `[...document.querySelectorAll('#sources dt')].filter(dt => dt.textContent === 'Läsning').map(dt => dt.nextElementSibling.textContent)`);
        expect(shown.some((t) => /^Läst ur zippen av Chattar /.test(t)), 'Raden Läsning syns inte bland källorna: ' + JSON.stringify(shown));

        // Queries: samma databas en tredje gång, utan ny läsning. Spårbarheten säger det.
        await c.nav('Queries');
        await c.ev(QUER, `document.getElementById('tab-new').click(), 1`);
        await c.waitFor(QUER, `/databaser hittades/.test(document.getElementById('ex-status').textContent) && document.getElementById('bar-zip').textContent === ${JSON.stringify(name)}`, 60000, 'zippen i Queries');
        await c.ev(QUER, `(function(){ const b = document.querySelector('.side-db[data-family="signal-ios-main"]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); return 1; })()`);
        await c.ev(QUER, `document.querySelector('.side-q[data-db="signal-ios-main"][data-q="messages"]').click(), 1`);
        await sleep(300);
        const day = new Date(fx.T2).toISOString().slice(0, 10);
        await c.ev(QUER, `(function(){ const s = document.querySelector('[data-param="timeStart"]'), e = document.querySelector('[data-param="timeEnd"]'); s.value = '${day} 00:00'; e.value = '${day} 23:59'; s.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
        await c.ev(QUER, `document.getElementById('run-button').click(), 1`);
        await c.waitFor(QUER, `/rad(er)? på/.test(document.getElementById('run-status').textContent) || /run-warn/.test(document.getElementById('run-status').innerHTML)`, 30000, 'körningen i Queries');
        const q = await c.ev(QUER, `({ rows: document.querySelectorAll('#run-result tbody tr').length, status: document.getElementById('run-status').innerText, trace: document.getElementById('run-trace') ? document.getElementById('run-trace').innerText : '' })`);
        expect(q.rows === 1, 'Signals meddelanden: ' + q.rows + ' rader. ' + q.status);
        expect(/Läst ur zippen av Chattar \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\. Verktygen delar på läsningen/.test(q.trace), 'Spårbarheten i Queries: ' + q.trace.slice(0, 600));
        await c.nav('Härkomst');
        await noInjectedScript(c);
        return 'Signals databas lästes och dekrypterades en gång, av Chattar';
    }],

    ['Samsung: batterihistoriken och SSRM ger app, kamera och skärm, med råraderna, och en flyttad klocka räknas inte', async ({ c, fx, downloads }) => {
        await c.nav('Härkomst');
        // Härkomst behåller det som visas när en annan zip väljs, så det som är öppet stängs först.
        await c.ev(PROV, `document.getElementById('ex-close').click(), 1`);
        await c.setFiles(null, '#cb-input', [fx.files.samsung]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && document.getElementById('ex-status').textContent.includes('Testextraktion-Samsung.zip') && /databas(er)? hittades/.test(document.getElementById('ex-status').textContent)`, 60000, 'Samsung-zippen');
        const status = await c.ev(PROV, `document.getElementById('ex-status').textContent`);
        expect(/1 SSRM-fil, 5 filer med batterihistorik, eRR\.p/.test(status), 'Raden om loggarna: ' + status);
        const detail = () => c.ev(PROV, `(function(){ const m = ProvenanceApp.model(); return { factors: Object.fromEntries(m.factors.map(f => [f.id, { state: f.state, text: f.items.map(i => i.text).join(' ') }])), events: [...document.querySelectorAll('#events tbody tr')].map(r => r.textContent), sql: [...document.querySelectorAll('#sources pre.sql')].map(p => p.textContent).join(' '), sources: [...document.querySelectorAll('#sources h4')].map(h => h.textContent), kinds: m.events.map(e => e.kind + '/' + (e.stream || '')), beta: m.beta, warnings: m.warnings, narrative: m.narrative.flatMap(n => n.lines.map(l => l.text)) }; })()`);

        // Bara batterihistoriken täcker tiden.
        const one = await assessNamed(c, '20260312_133111.jpg');
        expect(one.f.app.state === 'support' && one.f.camera.state === 'support' && one.f.screen.state === 'support', 'Batterihistoriken: ' + JSON.stringify(one.f));
        let d = await detail();
        expect(/Samsung Kamera|Kameran var igång vid tidpunkten \(batterihistoriken\)/.test(d.factors.app.text), 'App: ' + d.factors.app.text);
        expect(/använde kameran .*\(batterihistoriken, \+camera/.test(d.factors.camera.text), 'Kamera: ' + d.factors.camera.text);
        expect(/Inget steg över 5 s/.test(d.factors.camera.text), 'Klockan: ' + d.factors.camera.text);
        expect(d.events.some((r) => /Kameran på, Samsung Kamera i förgrunden/.test(r) && /newbatterystats260312133200 rad 5–6/.test(r) && /\+1m05s000ms \(1\) 090 \+camera/.test(r) && /-camera/.test(r)), 'Råraden i händelserna: ' + d.events.join(' / '));
        expect(/under log\/batterystats\//.test(d.sql) && /ankare rad 2/.test(d.sql) && /TIME: 2026-03-12-13-30-00-000/.test(d.sql), 'Bilagan saknar råraderna: ' + d.sql.slice(-900));
        expect(d.sources.some((s) => /batterihistoriken newbatterystats260312133200/.test(s)), 'Källorna: ' + d.sources);
        expect(d.beta, 'Märkt beta');
        expect(d.narrative.includes('Samsung Kamera startar kameran') && d.narrative.includes('Samsung Kamera stänger kameran'), 'Förklaringen: ' + d.narrative);

        // SSRM täcker tiden och nämner appen som använde kameran. Nätets namn bär HTML, och raden skrivs ut som text.
        const two = await assessNamed(c, 'chatt_kamera.jpg');
        expect(two.f.camera.state === 'support' && two.f.app.state === 'support' && two.f.screen.state === 'support', 'SSRM: ' + JSON.stringify(two.f));
        d = await detail();
        expect(/org\.example\.chat använde kameran .* enligt SSRM \(camera running\)/.test(d.factors.camera.text), 'Kamera: ' + d.factors.camera.text);
        expect(d.factors.app.text.includes('(SSRM)') && d.factors.screen.text.includes('(SSRM)'), 'App och skärm: ' + d.factors.app.text + ' / ' + d.factors.screen.text);
        expect(d.events.some((r) => /ssrm_heating_0\.log rad 5–6/.test(r) && /camera running :: true/.test(r)), 'Råraden: ' + d.events.join(' / '));
        await noInjectedScript(c);

        // Klockan flyttades 162 s i avsnittet kring T: raderna står i händelserna men räknas inte.
        const three = await assessNamed(c, '20260930_094450.jpg');
        expect(three.f.camera.state === 'missing' && three.f.app.state === 'missing' && three.f.screen.state === 'missing', 'Flyttad klocka: ' + JSON.stringify(three.f));
        d = await detail();
        ['app', 'camera', 'screen'].forEach((id) => expect(/Batterihistoriken har rader kring tidpunkten, men de räknas inte: klockan flyttades 2 min 42 s/.test(d.factors[id].text), id + ': ' + d.factors[id].text));
        expect(d.events.some((r) => /tiden osäker/.test(r) && /\+camera/.test(r)), 'Raderna: ' + d.events.join(' / '));
        expect(!d.kinds.some((k) => k === 'app/batterihistoriken' || k === 'screen/batterihistoriken'), 'Osäkra rader räknades: ' + d.kinds);
        expect(/klockan kan ligga 2 min 42 s fel/.test(d.sql), 'Bilagan saknar klockan: ' + d.sql.slice(-900));

        // Protokollet har samma uppgifter.
        fs.readdirSync(downloads).filter((n) => /^harkomst-20260930_094450-protokoll-/.test(n)).forEach((n) => fs.unlinkSync(path.join(downloads, n)));
        await c.ev(PROV, `document.getElementById('save-protocol').click(), 1`);
        const html = await download(downloads, /^harkomst-20260930_094450-protokoll-.*\.html$/);
        expect(html.includes('tiden osäker') && html.includes('newbatterystats260930094318') && html.includes('batterihistoriken'), 'Protokollet saknar raderna');
        await noInjectedScript(c);

        // eRR.p: telefonen avstängd vid T. Raden ur filen bär HTML, och skrivs ut som text.
        const off = await assessNamed(c, '20261007_100000.jpg');
        expect(off.f.power && off.f.power.state === 'contradiction', 'Avstängd: ' + JSON.stringify(off.f));
        d = await detail();
        expect(/Telefonen gick ner 2026-10-05 10:00:01 UTC \(eRR\.p: SHUTDOWN, no power \(batteriet tog slut\)\), och nästa tecken på att den var igång är 2026-10-10 06:00:00 UTC \(batterihistoriken: START, newbatterystats261020100000 rad 5\)/.test(d.factors.power.text), 'Faktorn: ' + d.factors.power.text);
        expect(/Telefonen var avstängd vid tiden enligt eRR\.p/.test(d.factors.camera.text), 'Kamera: ' + d.factors.camera.text);
        expect(d.events.some((r) => /Telefonen avstängd/.test(r) && /eRR\.p rad 9/.test(r)), 'Bandet: ' + d.events.join(' / '));
        expect(d.sources.some((s) => /^eRR\.p/.test(s)), 'Källorna: ' + d.sources);
        expect(/system\/users\/service\/data\/eRR\.p \(\d+ byte, CRC32 [0-9a-f]+\)/.test(d.sql) && /Rader med fel klocka:/.test(d.sql) && /2023-10-12 16:49:57/.test(d.sql) && /off: 2026-10-05 10:00:01 UTC/.test(d.sql), 'Bilagan: ' + d.sql.slice(-900));
        const svgRows = await c.ev(PROV, `[...document.querySelectorAll('#timelines svg text, #timeline svg text')].map(t => t.textContent).join(' | ')`);
        expect(/Telefonen/.test(svgRows) && /avstängd/i.test(svgRows), 'Tidslinjen: ' + svgRows.slice(0, 400));
        const summary = await c.ev(PROV, `document.getElementById('summary').textContent`);
        expect(/inte förenligt med att bilden togs/.test(summary), 'Sammanvägningen: ' + summary);

        // Igång men inte upplåst: skärmen före upplåsningen är ingen app.
        const bfu = await assessNamed(c, '20261011_100000.jpg');
        expect(bfu.f.power && bfu.f.power.state === 'contradiction', 'Inte upplåst: ' + JSON.stringify(bfu.f));
        d = await detail();
        expect(/Telefonen startade 2026-10-10 06:00:00 UTC .* och låstes upp första gången 2026-10-12 07:00:00 UTC \(batterihistoriken: första appen efter starten, com\.sec\.android\.app\.launcher/.test(d.factors.power.text), 'Faktorn: ' + d.factors.power.text);
        expect(!d.kinds.includes('app/batterihistoriken'), 'Skärmen före upplåsningen står som en app: ' + d.kinds);
        expect(d.kinds.includes('lock/eRR.p'), 'Låset: ' + d.kinds);
        expect(d.factors.app.state === 'missing' && /hade inte låsts upp sedan start/.test(d.factors.app.text), 'App: ' + JSON.stringify(d.factors.app));

        // Strax efter starten går det inte att säga vilken sida tiden hör till, och raden står i händelserna och förklaringen.
        const near = await assessNamed(c, '20261010_080020.jpg');
        expect(near.f.power && near.f.power.state === 'info', 'Nära: ' + JSON.stringify(near.f));
        d = await detail();
        expect(/nära starten 2026-10-10 06:00:00 UTC/.test(d.factors.power.text), 'Faktorn: ' + d.factors.power.text);
        expect(d.events.some((r) => /Telefonen startar \(eRR\.p: ON\)/.test(r) && /eRR\.p rad 11/.test(r) && /<b>1<\/b>/.test(r)), 'Raden: ' + d.events.join(' / '));
        expect(d.narrative.includes('Telefonen startar'), 'Förklaringen: ' + d.narrative);
        await noInjectedScript(c);

        fs.readdirSync(downloads).filter((n) => /^harkomst-20261010_080020-protokoll-/.test(n)).forEach((n) => fs.unlinkSync(path.join(downloads, n)));
        await c.ev(PROV, `document.getElementById('save-protocol').click(), 1`);
        const nearHtml = await download(downloads, /^harkomst-20261010_080020-protokoll-.*\.html$/);
        expect(nearHtml.includes('Telefonen igång') && nearHtml.includes('Nära en omstart') && nearHtml.includes('eRR.p rad 11') && !nearHtml.includes('<b>1</b>'), 'Protokollet saknar raden, eller skriver den som HTML');

        // Raden ur eRR.p öppnas i Queries: filen läses in som tabellen err, och raden markeras och skrivs som text.
        const toQ = await c.ev(PROV, `(function(){
            const e = ProvenanceApp.model().events.find((x) => x.kind === 'power' && x.source && x.source.queryId === 'err-p');
            if (!e) return null;
            document.getElementById('details-events').open = true;
            const b = document.querySelector('#events .to-queries[data-event="' + e.id + '"]');
            if (!b) return { label: '' };
            b.click();
            return { label: b.textContent };
        })()`);
        expect(toQ && toQ.label, 'Ingen länk till Queries för eRR.p: ' + JSON.stringify(toQ));
        const inQ = await c.waitFor(QUER, `(function(){
            const row = document.querySelector('#run-result tr.row-hit');
            return row && { row: row.innerText, html: row.innerHTML, src: document.getElementById('run-file-list').innerText, status: document.getElementById('run-status').innerText, hits: document.querySelectorAll('#run-result tr.row-hit').length };
        })()`, 30000, 'raden ur eRR.p i Queries');
        expect(/^eRR\.p ur Testextraktion-Samsung\.zip/.test(inQ.src) && /Filen är text/.test(inQ.src), 'Källan i Queries: ' + inQ.src);
        expect(inQ.hits === 1 && inQ.row.includes('<b>1</b>') && !inQ.html.includes('<b>1</b>'), 'Raden: ' + inQ.row);
        expect(/eRR\.p är text: \d+ rader, 1 med fel klocka lästes in i tabellen err i minnet/.test(inQ.status), 'Raden om filen: ' + inQ.status);
        await c.nav('Härkomst');
        return 'batterihistoriken, SSRM, en flyttad klocka och eRR.p, också i Queries';
    }],

    ['Samsung: säger ingen logg sin zon står raderna med telefonens inställda zon som antagande, och räknas inte', async ({ c, fx }) => {
        await c.nav('Härkomst');
        await c.ev(PROV, `document.getElementById('ex-close').click(), 1`);
        await c.setFiles(null, '#cb-input', [fx.files.samsungNoZone]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && document.getElementById('ex-status').textContent.includes('Testextraktion-Samsung-utan-zon.zip') && /databas(er)? hittades/.test(document.getElementById('ex-status').textContent)`, 60000, 'Samsung-zippen utan zon');
        const detail = () => c.ev(PROV, `(function(){ const m = ProvenanceApp.model(); return { factors: Object.fromEntries(m.factors.map(f => [f.id, { state: f.state, text: f.items.map(i => i.text).join(' ') }])), warnings: m.warnings, kinds: m.events.map(e => e.kind + '/' + (e.stream || '')),
            events: [...document.querySelectorAll('#events tbody tr')].map(r => r.textContent) }; })()`);

        // SSRM har raderna kring tiden, men ingen rad [RTC]: zonen är telefonens inställda, som antagande.
        const one = await assessNamed(c, 'chatt_kamera.jpg');
        expect(one.f.camera.state === 'missing' && one.f.app.state === 'missing' && one.f.screen.state === 'missing', 'Antagen zon gav stöd: ' + JSON.stringify(one.f));
        let d = await detail();
        expect(/Med telefonens inställda zon Europe\/Stockholm som antagande har SSRM de här raderna kring tidpunkten: org\.example\.chat i förgrunden 2026-05-22 10:21:10 UTC till/.test(d.factors.camera.text) && /kontrollera zonen först/.test(d.factors.camera.text), 'Kamera: ' + d.factors.camera.text);
        expect(/SSRM går inte att lägga i tiden: loggen säger inte vilken tidszon/.test(d.factors.camera.text) && !/har inget om det vid tidpunkten/.test(d.factors.camera.text), 'Täckningen: ' + d.factors.camera.text);
        expect(/räknas inte i bedömningen: kontrollera zonen först/.test(d.factors.app.text) && /de här raderna kring tidpunkten: Skärmen tänd/.test(d.factors.screen.text), 'App och skärm: ' + d.factors.app.text + ' / ' + d.factors.screen.text);
        expect(d.events.some((r) => /SSRM, zonen antagen: Europe\/Stockholm/.test(r) && /camera running :: true/.test(r)), 'Raderna: ' + d.events.join(' / '));
        expect(!d.kinds.some((k) => /^(app|screen)\/(SSRM|batterihistoriken)$/.test(k)), 'Rader med antagen zon räknades: ' + d.kinds);
        expect(d.warnings.some((w) => /^Samsungs loggar: \d+ rader kring tidpunkten har ingen tidszon som loggarna själva visar\. De står bland händelserna med telefonens inställda zon Europe\/Stockholm som antagande och räknas inte i bedömningen\. Kontrollera zonen/.test(w)), 'Varningen: ' + d.warnings.join(' / '));
        expect(!d.warnings.some((w) => /så de används inte/.test(w)), 'Rader tappades: ' + d.warnings.join(' / '));

        // Batterihistoriken: filens ändringstid saknas, så inget säger filens zon.
        const two = await assessNamed(c, '20260312_133111.jpg');
        expect(two.f.camera.state === 'missing' && two.f.app.state === 'missing' && two.f.screen.state === 'missing', 'Antagen zon gav stöd: ' + JSON.stringify(two.f));
        d = await detail();
        expect(/Europe\/Stockholm som antagande har batterihistoriken de här raderna kring tidpunkten/.test(d.factors.camera.text), 'Kamera: ' + d.factors.camera.text);
        expect(d.events.some((r) => /batterihistoriken, zonen antagen: Europe\/Stockholm/.test(r) && /\+camera/.test(r)), 'Raderna: ' + d.events.join(' / '));
        await noInjectedScript(c);
        return 'SSRM utan [RTC] och batterifiler utan ändringstid: raderna visas, räknas inte, och varningen säger antagandet';
    }],

    ['Laboration: standardflöden blir steg, tangenterna loggar dem med klockan, väntan stoppar trycken, och tabellen, CSV-filen och loggen stämmer', async ({ c, downloads }) => {
        const LAB = 'lab/index.html';
        const NAME = 'Samsung <img src=x onerror=window.__ftxss=1>';
        await c.nav('Laboration');
        await c.waitFor(LAB, `!!window.LabCore && document.querySelectorAll('#p-blocks input').length > 5`, 30000, 'Laboration laddas');
        const ev = (e) => c.ev(LAB, e);
        const key = (k) => ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true })), 1`);
        const text = (id) => ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
        const mode = () => ev(`document.getElementById('view-run').getAttribute('data-mode')`);
        const fits = async (view) => expect(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`), 'Sidan rullar i sidled i vyn ' + view);
        // Frågorna om att ersätta och ta bort besvaras med ja. Det som en tidigare körning lämnade i lagringen tas bort.
        await ev(`window.confirm = () => true, document.getElementById('p-reset').click(), 1`);

        // Förbered: två enheter, en app och tre standardflöden, och ett eget steg sist.
        await ev(`(function(){
            const set = (i, v) => { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); };
            const names = document.querySelectorAll('#p-devices input');
            set(names[0], ${JSON.stringify(NAME)});
            set(document.querySelectorAll('#p-devices input')[1], 'iPhone');
            const want = ['WhatsApp', 'Klockorna i början', 'Text åt båda håll, och läst', 'Lås och avstängning'];
            for (const l of document.querySelectorAll('#p-apps label.tick, #p-blocks label.tick')) {
                const box = l.querySelector('input'), on = want.includes(l.querySelector('.tick-label').textContent);
                if (box.checked !== on) box.click();
            }
            return 1;
        })()`);
        expect(await text('p-preview') === 'Valet ger 15 steg, ungefär 28 minuter varav 18 minuter väntan.', 'Förhandsvisningen: ' + await text('p-preview'));
        await ev(`document.getElementById('p-create').click(), document.getElementById('p-add').click(), 1`);
        await ev(`(function(){
            const what = document.querySelector('.editor textarea');
            what.value = 'Skriv {kod} i Anteckningar.'; what.dispatchEvent(new Event('input', { bubbles: true }));
            document.querySelector('.editor button[type="submit"]').click();
            return 1;
        })()`);
        const plan = await ev(`({ steps: [...document.querySelectorAll('#p-steps .step')].map(s => s.querySelector('.step-code').textContent + ' ' + s.querySelector('.step-do').textContent), summary: document.getElementById('p-summary').textContent, chip: document.querySelector('#p-steps .chip').textContent })`);
        expect(plan.steps.length === 16 && /^16 steg, /.test(plan.summary), 'Stegen: ' + plan.steps.length + ', ' + plan.summary);
        expect(plan.steps[2] === 'L03 Skriv L03 till iPhone och skicka.' && plan.steps[15] === 'L16 Skriv L16 i Anteckningar.', 'Koderna i stegen: ' + plan.steps[2] + ' | ' + plan.steps[15]);
        expect(plan.chip === NAME, 'Enhetens namn visas inte som text: ' + plan.chip);
        await fits('Förbered');

        // Genomför: övningstrycket sparas inte, Enter startar, och varje tangent gör sitt.
        await ev(`document.getElementById('p-start').click(), 1`);
        expect(await text('r-code') === 'ÖVA', 'Före start: ' + await text('r-code'));
        await key(' ');
        expect(/^Bra, trycket kom \d\d:\d\d:\d\d\./.test(await text('r-do')), 'Övningstrycket: ' + await text('r-do'));
        await key('Enter');
        expect(await text('r-code') === 'L01' && /^\d\d:\d\d:\d\d\.\d$/.test(await text('r-clock')), 'Efter start: ' + await text('r-code') + ' ' + await text('r-clock'));
        await fits('Genomför');
        await key(' '); await key(' ');
        await key('h');
        await key(' ');
        await key('t');
        expect(await text('r-toast') === 'Tiden för L04 är märkt som ungefärlig.', 'T: ' + await text('r-toast'));
        await key(' ');
        await key('Backspace');
        expect(await text('r-code') === 'L05' && /^Trycket för L05 togs tillbaka\./.test(await text('r-toast')), 'Ångra: ' + await text('r-code') + ', ' + await text('r-toast'));
        // Anteckningen får tiden då A trycktes, och tangenterna gäller den tills den är sparad.
        await key('a');
        expect(await ev(`document.activeElement.id`) === 'r-note-text', 'Anteckningens ruta har inte fokus');
        await ev(`document.getElementById('r-note-text').value = 'En bild för mycket <b>här</b>.', document.getElementById('r-note-device').selectedIndex = 2, 1`);
        await key(' ');
        expect(await text('r-code') === 'L05', 'Ett mellanslag medan anteckningen var öppen räknades som ett tryck');
        await ev(`document.getElementById('r-note-text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })), 1`);
        expect(/^Anteckningen sparades med tiden \d\d:\d\d:\d\d\.$/.test(await text('r-toast')), 'Anteckningen: ' + await text('r-toast'));
        // Väntan efter L07: mellanslag räknas inte förrän den är slut eller avbruten med V.
        await key(' '); await key(' '); await key(' ');
        expect(await mode() === 'wait' && await text('r-code') === 'VÄNTA' && /^Väntan efter L07: [45]:\d\d kvar\.$/.test(await text('r-do')), 'Väntan: ' + await mode() + ', ' + await text('r-do'));
        await key(' ');
        expect(await ev(`document.querySelectorAll('#r-list li.done, #r-list li.skipped').length`) === 7 && /^Väntan pågår, så trycket räknades inte\./.test(await text('r-toast')), 'Ett tryck under väntan räknades: ' + await text('r-toast'));
        await key('v');
        expect(await mode() === 'step' && await text('r-code') === 'L08', 'Efter avbruten väntan: ' + await mode() + ' ' + await text('r-code'));
        for (let n = 0; n < 40 && await mode() !== 'done'; n++) await key(await mode() === 'wait' ? 'v' : ' ');
        expect(await text('r-code') === 'KLAR', 'Flödet blev inte klart: ' + await text('r-code'));

        // Tabell: en rad per steg och en för anteckningen, i den ordning det gjordes.
        await ev(`document.getElementById('r-end').click(), 1`);
        const table = await ev(`({
            head: [...document.querySelectorAll('.protocol th')].map(th => th.textContent),
            rows: [...document.querySelectorAll('.protocol tbody tr')].map(tr => [...tr.cells].map(td => (td.firstElementChild && td.classList.contains('remark') ? td.firstElementChild : td).textContent)),
            facts: Object.fromEntries([...document.querySelectorAll('.facts dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent])),
        })`);
        expect(table.head.join('|') === 'Tid|Enhet|Åtgärd|Kod|Anmärkning', 'Rubrikerna: ' + table.head);
        expect(table.rows.length === 17, 'Rader i tabellen: ' + table.rows.length);
        const row = (code) => table.rows.find((r) => r[3] === code) || [];
        expect(/^\d\d:\d\d:\d\d$/.test(row('L01')[0]) && row('L01')[1] === NAME && row('L01')[2] === 'Tog en bild av skärmen med kameran.', 'Första raden: ' + row('L01'));
        expect(row('L03')[0] === 'inte utförd' && /^Hoppades över \d\d:\d\d:\d\d\.$/.test(row('L03')[4]), 'Det överhoppade steget: ' + row('L03'));
        expect(/^ca \d\d:\d\d:\d\d$/.test(row('L04')[0]) && /^Tiden är ungefärlig/.test(row('L04')[4]), 'Den ungefärliga tiden: ' + row('L04'));
        expect(/^Väntan därefter avbröts efter 0:0\d av 5:00\.$/.test(row('L07')[4]) && row('L07')[1] === 'Alla enheter', 'Raden med väntan: ' + row('L07'));
        const note = table.rows.findIndex((r) => r[2] === 'Utöver flödet: En bild för mycket <b>här</b>.');
        expect(note === 4 && table.rows[note][1] === 'iPhone' && table.rows[note][3] === '', 'Anteckningen står på rad ' + note);
        expect(row('L16')[2] === 'Skriv L16 i Anteckningar.', 'Det egna steget: ' + row('L16'));
        expect(table.facts.Steg === '15 utförda, 1 inte utförda, 1 anteckning' && /^1 tryck ångrades/.test(table.facts['Ångrat']) && table.facts.Program === 'Forensics Toolbox ' + VERSION, 'Uppgifterna: ' + JSON.stringify(table.facts));
        expect(/^Datorns klocka, tidszon .*\(UTC[+-]\d\d:\d\d\)\./.test(table.facts.Klocka), 'Klockan: ' + table.facts.Klocka);
        await fits('Tabell');

        // Filerna: CSV med en rad per tabellrad, och loggen som går att öppna igen.
        await ev(`document.getElementById('t-csv').click(), 1`);
        const csv = await download(downloads, /^laboration-\d{4}-\d\d-\d\d-.*\.csv$/);
        const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
        expect(csv.charCodeAt(0) === 0xFEFF && lines[0] === 'Datum;Tid;UTC;Enhet;App;Åtgärd;Kod;Status;Anmärkning' && lines.length === 18, 'CSV-filen: ' + lines.length + ' rader, ' + lines[0]);
        expect(/^\d{4}-\d\d-\d\d;\d\d:\d\d:\d\d;\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z;Samsung <img /.test(lines[1]) && /;L04;utförd, tiden ungefärlig;/.test(lines[4]), 'Raderna i CSV-filen: ' + lines[1] + ' | ' + lines[4]);
        await ev(`document.getElementById('t-save').click(), 1`);
        const log = JSON.parse(await download(downloads, /^laboration-\d{4}-\d\d-\d\d-.*\.json$/));
        expect(log.format === 'forensics-toolbox-laboration' && log.flow.steps.length === 16 && log.run.entries.length === 16 && log.run.undone.length === 1 && log.run.notes.length === 1, 'Loggfilen: ' + Object.keys(log));
        const logFile = path.join(downloads, fs.readdirSync(downloads).find((n) => /^laboration-.*\.json$/.test(n)));
        await ev(`document.getElementById('t-again').click(), 1`);
        expect(await ev(`!document.getElementById('view-plan').classList.contains('display-none') && !document.getElementById('p-create').disabled`), 'Flödet går inte att köra igen');
        await c.setFiles(LAB, '#p-file', [logFile]);
        await c.waitFor(LAB, `/^Loggen är öppnad: 16 av 16 steg har ett tryck\.$/.test(document.getElementById('p-status').textContent)`, 10000, 'loggen öppnas igen');
        const again = await ev(`[...document.querySelectorAll('.protocol tbody tr')].map(tr => tr.cells[0].textContent + tr.cells[2].textContent).join('|')`);
        expect(again === table.rows.map((r) => r[0] + r[2]).join('|'), 'Tabellen ur den öppnade loggen skiljer sig från den som sparades');
        await sleep(300);
        await noInjectedScript(c);
        await ev(`document.getElementById('tab-plan').click(), document.getElementById('p-reset').click(), 1`);
        await c.nav('Härkomst');
        return plan.steps.length + ' steg, ' + table.rows.length + ' rader i tabellen, CSV och logg';
    }],

    ['Laboration: ett eget flöde byggs av mallar, steg och drag, ändringar går att ångra, och en egen mall ligger kvar efter omstart', async ({ c, downloads }) => {
        const LAB = 'lab/index.html';
        await c.nav('Laboration');
        await c.waitFor(LAB, `!!window.LabCore && !!document.querySelector('#p-palette .pal-item')`, 30000, 'Laboration laddas');
        const ev = (e) => c.ev(LAB, e);
        const text = (id) => ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
        const count = (selector) => ev(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
        // Klickar på det första som väljaren ger, eller på knappen med den texten i det.
        const click = async (selector, label) => expect(await ev(`(function(){
            let e = document.querySelector(${JSON.stringify(selector)});
            if (e && ${JSON.stringify(label || '')}) e = [...e.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label || '')});
            if (!e || e.disabled) return false;
            e.click();
            return true;
        })()`), 'Går inte att klicka på ' + selector + (label ? ' ' + label : ''));
        const set = async (selector, value) => expect(await ev(`(function(){
            const e = document.querySelector(${JSON.stringify(selector)});
            if (!e) return false;
            e.value = ${JSON.stringify(value)};
            e.dispatchEvent(new Event('input', { bubbles: true }));
            e.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        })()`), 'Hittar inte ' + selector);
        const groups = () => ev(`[...document.querySelectorAll('#p-steps .group')].map(g => ({
            title: g.querySelector('.block').textContent, meta: g.querySelector('.group-meta').textContent,
            steps: [...g.querySelectorAll('.step')].map(s => s.querySelector('.step-code').textContent + ' ' + s.querySelector('.chip').textContent + ': ' + s.querySelector('.step-do').textContent),
        }))`);
        const shape = (g) => g.map((x) => x.steps.length).join('+');
        // Ingenting rullar i sidled: inte sidan, inte flödet eller listan, och ingen rad i dem.
        const fits = async (what) => {
            const wide = await ev(`[document.documentElement, ...document.querySelectorAll('#p-steps, #p-steps .step, #p-steps .group-head, #p-steps .group-panel, #p-palette, .side, .main-head')]
                .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + e.className) + ' ' + e.scrollWidth + '/' + e.clientWidth)`);
            expect(!wide.length, 'Det sticker ut i sidled ' + what + ': ' + wide.join(', '));
        };
        const G1 = '#p-steps .group:nth-of-type(1)', G2 = '#p-steps .group:nth-of-type(2)';
        const own = () => ev(`[...document.querySelectorAll('#p-palette .pal-own .pal-label')].map(e => e.textContent)`);
        const dropOwn = async () => { for (let n = 0; n < 20 && await count('#p-palette .pal-own'); n++) await click('#p-palette .pal-own .icon-btn'); };

        // Det som en tidigare körning lämnade tas bort, och frågorna besvaras med ja.
        await ev(`window.confirm = () => true, document.getElementById('p-reset').click(), 1`);
        await dropOwn();
        await set('#p-devices > :nth-child(1) input', 'Samsung');
        await set('#p-devices > :nth-child(2) input', 'iPhone');
        expect(await ev(`!document.getElementById('p-quick').classList.contains('display-none')`), 'Ett tomt flöde visar inte det färdiga upplägget');
        // Valen i upplägget är fler än som ryms, och knappen som skapar stegen ska ändå synas utan att rulla.
        expect(await ev(`(function(){ const b = document.getElementById('p-create').getBoundingClientRect(), q = document.getElementById('p-quick').getBoundingClientRect(); return b.height > 0 && b.bottom <= q.bottom && q.bottom <= innerHeight; })()`), 'Knappen Skapa stegen syns inte i det färdiga upplägget');
        await click('#p-quick-close');

        // En mall ur listan blir en grupp, med stegen åt båda håll mellan de två valda enheterna.
        await click('.pal-item[data-id="chat-text"]');
        let g = await groups();
        expect(g.length === 1 && g[0].title === 'WhatsApp: text åt båda håll, och läst' && g[0].meta === '4 steg · WhatsApp · Samsung och iPhone', 'Mallen: ' + JSON.stringify(g.map((x) => [x.title, x.meta])));
        expect(g[0].steps[0] === 'L01 Samsung: Skriv L01 till iPhone och skicka.' && /^L02 iPhone: Lås upp, öppna WhatsApp och chatten med Samsung/.test(g[0].steps[1]), 'Mallens steg: ' + g[0].steps.slice(0, 2).join(' | '));
        expect(await ev(`document.getElementById('p-quick').classList.contains('display-none')`), 'Det färdiga upplägget står kvar när flödet har steg');

        // Plus sätter märket, och nästa byggsten hamnar där. Koderna efter räknas om.
        await click(G1 + ' .slot[data-pos="1"] .slot-add');
        expect(await ev(`(document.querySelector('#p-steps .slot.marked') || {}).dataset.pos + ' ' + (document.querySelector('#p-steps .slot.marked .slot-text') || {}).textContent`) === '1 Nästa byggsten hamnar här.', 'Märket står inte där plus trycktes');
        await click('.pal-item[data-id="screenshot"]');
        g = await groups();
        expect(shape(g) === '5' && /^L02 Samsung: Öppna WhatsApp och ta en skärmdump/.test(g[0].steps[1]) && g[0].steps[3] === 'L04 iPhone: Skriv L04 till Samsung och skicka.', 'Steget vid märket: ' + g[0].steps.join(' | '));
        await click('#p-undo');
        g = await groups();
        expect(shape(g) === '4' && g[0].steps[2] === 'L03 iPhone: Skriv L03 till Samsung och skicka.' && await text('p-note') === 'Den senaste ändringen togs tillbaka.', 'Ångra: ' + shape(g) + ', ' + await text('p-note'));

        // Väntan läggs efter steget före märket, och längden ändras på raden.
        await click(G1 + ' .slot[data-pos="2"] .slot-add');
        await click('.pal-item[data-kind="wait"]');
        expect(await ev(`[...document.querySelectorAll('#p-steps .wait-row')].map(r => r.previousElementSibling.querySelector('.step-code').textContent + ' ' + r.querySelector('.wait-size').value + ' ' + r.querySelector('.wait-unit').value).join()`) === 'L02 1 60', 'Väntan hamnade inte efter L02');
        await set('#p-steps .wait-size', '3');
        g = await groups();
        expect(/varav 3 minuter väntan$/.test(await text('p-summary')) && g[0].meta === '4 steg · väntan 3:00 · WhatsApp · Samsung och iPhone', 'Väntans längd: ' + await text('p-summary') + ' | ' + g[0].meta);

        // Gruppens ruta: rubriken, riktningen, en kopia i en annan app, och gruppen som egen mall.
        await click(G1 + ' .group-head', 'Ändra');
        await set(G1 + ' .group-panel [data-focus="g-title"]', 'Först <img src=x onerror=window.__ftxss=1>');
        await click(G1 + ' .group-panel', 'Byt riktning');
        g = await groups();
        expect(g[0].title === 'Först <img src=x onerror=window.__ftxss=1>' && g[0].steps[0] === 'L01 iPhone: Skriv L01 till Samsung och skicka.' && g[0].meta === '4 steg · väntan 3:00 · WhatsApp · iPhone och Samsung', 'Byt riktning: ' + g[0].title + ' | ' + g[0].steps[0] + ' | ' + g[0].meta);
        await click(G1 + ' .group-panel', 'Kopiera gruppen');
        expect(await count(G1 + ' .group-panel') === 0 && await count(G2 + ' .group-panel') === 1, 'Kopians ruta är inte öppen');
        await set(G2 + ' .group-panel [data-focus="g-app"]', 'Signal');
        g = await groups();
        expect(shape(g) === '4+4' && /^L06 Samsung: Lås upp, öppna Signal och chatten med iPhone/.test(g[1].steps[1]) && /öppna WhatsApp och/.test(g[0].steps[1]), 'Kopian i en annan app: ' + g[1].steps[1] + ' | ' + g[0].steps[1]);
        await set(G2 + ' .group-panel .tpl-name', 'Min mall');
        await click(G2 + ' .group-panel', 'Spara som mall');
        expect(await text('p-note') === 'Mallen Min mall ligger nu under Mina mallar.' && (await own()).join() === 'Min mall', 'Egen mall: ' + await text('p-note') + ' | ' + await own());
        await click(G2 + ' .group-panel', 'Klar');
        expect(await count('#p-steps .group-panel') === 0, 'Rutan stängdes inte');

        // Riktiga drag: ett steg till en annan grupp, en grupp till en ny plats och en mall ur listan till flödets slut.
        expect(await c.drag(LAB, G2 + ' .step[data-pos="0"]', G1 + ' .step[data-pos="3"]', 0.8), 'Steget gick inte att dra');
        g = await groups();
        expect(shape(g) === '5+3' && g[0].steps[4] === 'L05 iPhone: Skriv L05 till Samsung och skicka.' && /^L06 Samsung: Lås upp, öppna Signal/.test(g[1].steps[0]), 'Steget efter draget: ' + shape(g) + ' | ' + g[0].steps[4] + ' | ' + g[1].steps[0]);
        expect(await c.drag(LAB, G2 + ' .group-head', G1 + ' .group-head', 0.2), 'Gruppen gick inte att dra');
        g = await groups();
        expect(shape(g) === '3+5' && /^Först </.test(g[1].title) && /^L01 Samsung: Lås upp, öppna Signal/.test(g[0].steps[0]), 'Gruppen efter draget: ' + shape(g) + ' | ' + g.map((x) => x.title).join(' | '));
        expect(await c.drag(LAB, '.pal-item[data-id="camera"]', '#p-steps .slot[data-at="2"]'), 'Mallen gick inte att dra');
        g = await groups();
        expect(g.length === 3 && g[2].title === 'Kamera och skärmdump' && /^\d+ steg$/.test(g[2].meta), 'Mallen efter draget: ' + g.map((x) => x.title + ' (' + x.meta + ')').join(' | '));
        expect(await count('#p-steps .slot.over') === 0 && await ev(`document.getElementById('p-steps').hasAttribute('data-drag')`) === false, 'Draget lämnade märken efter sig');
        await ev(`document.activeElement && document.activeElement.blur(), document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })), 1`);
        g = await groups();
        expect(shape(g) === '3+5', 'Ctrl+Z tog inte tillbaka mallen: ' + shape(g));

        // Kontrollen säger vad som ser fel ut, på steget och i knappen överst, och hindrar ingenting.
        expect(await ev(`(document.querySelector('#p-steps .slot.marked') || { dataset: {} }).dataset.at`) === '2', 'Märket står inte sist efter Ångra');
        await click('.pal-item[data-id="power-on"]');
        const warn = await ev(`({ on: [...document.querySelectorAll('#p-steps .step.has-warn')].map(s => s.querySelector('.step-code').textContent + ': ' + [...s.querySelectorAll('.step-warn')].map(w => w.textContent).join(' / ')), button: document.getElementById('p-check').textContent, hidden: document.getElementById('p-check').classList.contains('display-none') })`);
        expect(warn.on.includes('L09: Enheten har inte stängts av före det här steget.') && !warn.hidden && warn.button === (warn.on.length === 1 ? '1 sak att se över' : warn.on.length + ' saker att se över'), 'Kontrollen: ' + JSON.stringify(warn));
        expect(await ev(`!document.getElementById('p-start').disabled`), 'En varning hindrar genomförandet');

        // Ett eget steg skrivs där märket står.
        await click(G1 + ' .slot[data-pos="0"] .slot-add');
        await click('#p-steps .slot.marked', 'Eget steg');
        await set('#p-steps .editor textarea', 'Öppna Kartor och sök efter {kod}.');
        await click('#p-steps .editor button[type="submit"]');
        g = await groups();
        expect(shape(g) === '4+6' && /^L01 \S+: Öppna Kartor och sök efter L01\.$/.test(g[0].steps[0]) && await count('#p-steps .editor') === 0, 'Det egna steget: ' + shape(g) + ' | ' + g[0].steps[0]);

        // Långa namn utan mellanslag ryms, också i ett smalt fönster.
        await fits('före de långa namnen');
        await set('#p-devices > :nth-child(1) input', 'W'.repeat(80));
        await click(G2 + ' .group-head', 'Ändra');
        await set(G2 + ' .group-panel [data-focus="g-title"]', 'M'.repeat(80));
        await fits('med långa namn');
        await c.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 900, deviceScaleFactor: 1, mobile: false });
        await sleep(300);
        await fits('med långa namn i ett smalt fönster');
        await click(G2 + ' .group-panel', 'Klar');
        await fits('i ett smalt fönster');
        await c.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
        await sleep(300);

        // Efter en omstart av verktyget ligger flödet och den egna mallen kvar, och mallen går att lägga in igen.
        await ev(`location.reload(), 1`);
        await sleep(500);
        await c.waitFor(LAB, `!!window.LabCore && !!document.querySelector('#p-palette .pal-item') && document.querySelectorAll('#p-steps .step').length === 10`, 30000, 'flödet finns kvar efter omstart');
        await ev(`window.confirm = () => true, 1`);
        expect((await own()).join() === 'Min mall' && await ev(`document.getElementById('p-quick').classList.contains('display-none')`), 'Efter omstart: ' + await own());
        // Mallen sparades ur en grupp i en annan app och åt andra hållet. Den följer appen och enheterna som är valda nu.
        await set('#p-app', 'Telegram');
        await click('#p-palette .pal-own .pal-item');
        g = await groups();
        expect(shape(g) === '4+6+4' && g[2].title === 'Telegram: Min mall' && /^L11 W+: Skriv L11 till iPhone och skicka\.$/.test(g[2].steps[0]) && /^L12 iPhone: Lås upp, öppna Telegram och chatten med W+,/.test(g[2].steps[1]), 'Den egna mallen i flödet: ' + shape(g) + ' | ' + (g[2] || { steps: [] }).title + ' | ' + (g[2] || { steps: [] }).steps.slice(0, 2).join(' | '));

        // Mallarna som fil: sparas, tas bort ur listan och kommer tillbaka när filen öppnas.
        await click('#p-save-templates');
        const stored = JSON.parse(await download(downloads, /^laboration-mallar-\d{4}-\d\d-\d\d.*\.json$/));
        expect(stored.format === 'forensics-toolbox-laboration-mallar' && stored.mallar.length === 1 && stored.mallar[0].label === 'Min mall' && stored.mallar[0].steps.length === 4, 'Filen med mallar: ' + JSON.stringify(stored).slice(0, 300));
        const templateFile = path.join(downloads, fs.readdirSync(downloads).find((n) => /^laboration-mallar-.*\.json$/.test(n)));
        await dropOwn();
        expect((await own()).length === 0, 'Mallen gick inte att ta bort');
        await c.setFiles(LAB, '#p-file', [templateFile]);
        await c.waitFor(LAB, `document.getElementById('p-status').textContent === '1 mall lades till under Mina mallar.'`, 10000, 'mallarna öppnas ur filen');
        expect((await own()).join() === 'Min mall', 'Mallen ur filen: ' + await own());
        await c.setFiles(LAB, '#p-file', [templateFile]);
        await c.waitFor(LAB, `document.getElementById('p-status').textContent === 'Mallarna i filen fanns redan under Mina mallar.'`, 10000, 'samma mallar öppnas en gång till');
        expect((await own()).length === 1 && shape(await groups()) === '4+6+4', 'En fil med mallar ändrade flödet eller gav en dubblett');
        fs.rmSync(templateFile);

        // Under ett genomförande är flödet låst: inga plus, inga drag och inga byggstenar.
        await click('#p-start');
        await ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })), 1`);
        await click('#tab-plan');
        const locked = await ev(`({ plus: document.querySelectorAll('#p-steps .slot-add').length, drag: document.querySelectorAll('#p-steps [draggable="true"], #p-palette [draggable="true"]').length, open: document.querySelectorAll('#p-palette .pal-item:not([disabled])').length, tools: document.querySelectorAll('#p-steps .step-tools').length, steps: document.querySelectorAll('#p-steps .step').length, note: !document.getElementById('p-locked').classList.contains('display-none') })`);
        expect(locked.plus === 0 && locked.drag === 0 && locked.open === 0 && locked.tools === 0 && locked.steps === 14 && locked.note, 'Det låsta flödet: ' + JSON.stringify(locked));

        await sleep(200);
        await noInjectedScript(c);
        await ev(`document.getElementById('p-reset').click(), 1`);
        await dropOwn();
        expect(await count('#p-steps .step') === 0 && (await own()).length === 0, 'Städningen efter provet');
        await c.nav('Härkomst');
        return '3 drag, ångra, kontroll, egen mall kvar efter omstart, mallar som fil, långa namn i smalt fönster';
    }],
];

module.exports = { scenarios, expect, factors, assessNamed, waitResult, download, noInjectedScript, PROV, QUER };
