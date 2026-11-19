// Röktestet: appen startas och varje verktyg laddas, Härkomsts testdata ger resultat och protokoll,
// Queries och Härkomst läser den påhittade extraktionen (fixtures.js), en trasig -wal ger en varning
// i stället för ett stopp, en fil från disk väljer rätt rad, och HTML i filnamn och databaser skrivs
// aldrig in i sidan. Bara påhittade data, så det kan köras överallt, också i CI.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sleep } = require('./cdp');
const fixtures = require('./fixtures');
const labTrace = require('./lab-trace-fixture');

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
    return c.ev(PROV, `[...document.querySelectorAll('#factors .factor')].map(f => ({ id: f.dataset.factor, state: (f.querySelector('.qa').className.match(/qa (\\w+)/) || [])[1], verdict: f.querySelector('.qa .answer').lastChild.textContent }))`);
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
            // Frågan och svaret står i en egen ruta i lägets färg, överst i varje faktor.
            const qa = await c.ev(PROV, `[...document.querySelectorAll('#factors .factor')].map(f => { const b = f.querySelector('.qa'), q = b.querySelector('.question'), a = b.querySelector('.answer'), m = ProvenanceApp.model().factors.find(x => x.id === f.dataset.factor);
                return { id: f.dataset.factor, first: f.querySelector('h3').nextElementSibling === b, q: q ? q.textContent : '', wantQ: m.question, a: a.lastChild.textContent, wantA: m.verdict, sign: a.querySelector('.mark-sign').textContent, cls: b.className, state: m.state,
                    bg: getComputedStyle(b).backgroundColor, card: getComputedStyle(f).backgroundColor, bar: parseFloat(getComputedStyle(b).borderLeftWidth), qw: Number(getComputedStyle(q || a).fontWeight), aw: Number(getComputedStyle(a).fontWeight), badge: !!f.querySelector('h3 .badge') }; })`);
            qa.forEach((x) => expect(x.first && x.q && x.q === x.wantQ && x.a === x.wantA && x.sign && x.cls === 'qa ' + x.state && x.bg !== x.card && x.bg !== 'rgba(0, 0, 0, 0)' && x.bar >= 3 && x.qw >= 600 && x.aw >= 700 && !x.badge, btn + ': frågan och svaret i ' + x.id + ': ' + JSON.stringify(x)));
            // Raden som är den bedömda filen är markerad i nyckelhändelserna och i Händelser med källa, och den
            // stora tabellen står rullad så att raden syns när den öppnas.
            const rows = await c.ev(PROV, `(function(){ const m = ProvenanceApp.model(); const d = document.getElementById('details-events'); d.open = true; d.dispatchEvent(new Event('toggle'));
                const box = document.getElementById('events'), marked = [...box.querySelectorAll('tbody tr.ev-file')], br = box.getBoundingClientRect(), rr = marked[0] && marked[0].getBoundingClientRect();
                const out = { want: m.events.filter(e => e.bold).map(e => e.text), got: marked.map(r => r.cells[2].querySelector('strong') ? r.cells[2].textContent : ''), rows: box.querySelectorAll('tbody tr').length,
                    bg: marked[0] ? getComputedStyle(marked[0].cells[0]).backgroundColor : '', plain: getComputedStyle(box.querySelector('tbody tr:not(.ev-file) td')).backgroundColor, inView: !!rr && rr.top >= br.top - 1 && rr.bottom <= br.bottom + 1,
                    key: m.narrative.map((n, i) => [n.lines.filter(l => l.bold).length, document.querySelectorAll('#timelines .narrative[data-i="' + i + '"] tr.ev-file').length]) };
                d.open = false; return out; })()`);
            expect(rows.want.length >= 1 && JSON.stringify(rows.got) === JSON.stringify(rows.want), btn + ': filens rad i Händelser med källa: ' + JSON.stringify(rows));
            expect(rows.bg !== rows.plain && rows.inView, btn + ': filens rad syns inte: ' + JSON.stringify(rows));
            expect(rows.key.every(([a, b]) => a === b) && rows.key.some(([a]) => a > 0), btn + ': filens rad i nyckelhändelserna: ' + JSON.stringify(rows.key));
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
        expect(/Källa: Zippen → filens skapandetid \(UT-fältet, fjärde tiden\)/.test(old.note), 'Raden: ' + old.note);
        // Samma fil i EXIF & karta: varje tid ur zippen säger i klartext vad den är, med fältet inom parentes.
        await c.ev(null, `document.querySelector('#cb-file [data-to="exif"]').click(), 1`);
        await c.waitFor('exif-viewer/index.html', `document.getElementById('detail-name').textContent === 'gammal.jpg' && !document.getElementById('detail').classList.contains('display-none')`, 20000, 'filen öppnad i EXIF & karta');
        const notes = await c.ev('exif-viewer/index.html', `[...document.querySelectorAll('#detail-summary dt')].filter(d => d.nextElementSibling.querySelector('.src') && /filsystemet|ctime/.test(d.textContent)).map(d => d.textContent + ': ' + d.nextElementSibling.querySelector('.src').textContent)`);
        expect(JSON.stringify(notes) === JSON.stringify(['Skapad i filsystemet: zippen, filens skapandetid (UT-fältet, fjärde tiden)', 'Ändrad i filsystemet: zippen, filens ändringstid (UT-fältet)',
            'Metadata ändrad (ctime): zippen, metadata ändrad (UT-fältet, tredje tiden)', 'Senast läst i filsystemet: zippen, senast läst (UT-fältet)']), 'Källorna i EXIF & karta: ' + JSON.stringify(notes));
        await c.ev('exif-viewer/index.html', `document.getElementById('clear').click(), 1`);
        await c.nav('Härkomst');
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
        // Meddelande 1 och 2 kommer från samma avsändare med fem minuters mellanrum och ritas som en följd. Långt från
        // slutet finns knappen till det senaste, och den leder dit.
        const run = await c.ev(CHAT, `['1', '2', '3'].map(i => document.querySelector('#c-msgs .m[data-i="' + i + '"]').className)`);
        expect(/\bmore\b/.test(run[0]) && !/\bcont\b/.test(run[0]) && /\bcont\b/.test(run[1]) && !/\bmore\b/.test(run[1]) && /\bme\b/.test(run[2]) && !/\bcont\b/.test(run[2]), 'Följden: ' + JSON.stringify(run));
        await c.waitFor(CHAT, `!document.getElementById('c-latest').classList.contains('display-none')`, 5000, 'knappen Senaste');
        await c.ev(CHAT, `document.getElementById('c-latest').click(), 1`);
        await c.waitFor(CHAT, `ChatsApp.view().to === ${L.count} && document.getElementById('c-latest').classList.contains('display-none')`, 5000, 'det senaste efter knappen');
        await c.ev(CHAT, `document.getElementById('c-first').click(), 1`);
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

    ['Härkomst: en lista som läser filerna i förväg ger samma rader som utan, och ExifTools workrar lämnas tillbaka', async ({ c }) => {
        await c.nav('Härkomst');
        const ev = (e) => c.ev(PROV, e);
        const names = ['IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0005.JPG', 'IMG_0006.JPG', 'finns-inte.jpg', 'IMG_0007.JPG', 'IMG_0008.JPG', 'IMG_0009.JPG', 'IMG_0010.JPG'];
        const start = (then) => ev(`(function () { const f = document.getElementById('filename'); f.value = ${JSON.stringify(names.join('\n'))}; f.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('run').click(); ${then || ''} return 1; })()`);
        // Workrar som startades för listan och inte hann bli klara stängs när de hör av sig, så det väntas in.
        const idle = async (label) => {
            await c.waitFor(PROV, `!ProvenanceApp.busy() && document.querySelectorAll('#batch-list tbody tr').length === ${names.length} && ProvenanceApp.exif().starting === 0`, 60000, label);
            const pool = await ev(`ProvenanceApp.exif()`);
            expect(pool.working === 0 && pool.waiting === 0 && pool.workers <= 1, 'ExifTool efter ' + label + ': ' + JSON.stringify(pool));
        };
        // Samma lista utan och med läsning i förväg. ExifTools svar och listans bedömda rader glöms före varje gång,
        // så att filerna läses och bedöms båda gångerna.
        const run = async (ahead) => {
            await ev(`ProvenanceApp.forgetTags(), ProvenanceApp.forgetRows(), ProvenanceApp.readAhead(${ahead}), 1`);
            const before = await ev(`ProvenanceApp.work()`);
            await start();
            await sleep(300);
            await idle('listan med ' + ahead + ' rader i förväg');
            const after = await ev(`ProvenanceApp.work()`);
            return { list: await ev(`JSON.stringify(ProvenanceApp.list())`), exif: after.exif - before.exif, asked: after.asked - before.asked, logs: after.logs - before.logs };
        };
        const usual = await ev(`ProvenanceApp.readAhead()`);
        expect(usual > 0, 'Läsningen i förväg är avstängd från början: ' + usual);
        const off = await run(0), on = await run(usual);
        const done = JSON.parse(off.list).filter((r) => r.status === 'done').length;
        expect(done >= 5, 'Listan utan läsning i förväg: ' + JSON.parse(off.list).map((r) => r.name + ' ' + r.status).join(', '));
        expect(on.list === off.list, 'Listan ändrades av läsningen i förväg: ' + JSON.parse(on.list).map((r) => r.name + ' ' + r.status).join(', '));
        // Lika många filer går genom ExifTool, och läsningen i förväg kör inga frågor och läser inga loggar själv.
        expect(off.exif >= done && on.exif === off.exif && on.asked === off.asked && on.logs === off.logs, 'Arbetet utan och med läsning i förväg: ' + JSON.stringify([off, on]).replace(/"list":"(\\.|[^"])*",/g, ''));

        // Avbruten mitt i: det som lästes i förväg blir klart och släpps, och nästa fil bedöms som vanligt.
        await ev(`ProvenanceApp.forgetTags(), ProvenanceApp.forgetRows(), 1`);
        await start(`setTimeout(function () { document.getElementById('batch-stop').click(); }, 30);`);
        await sleep(300);
        await idle('den avbrutna listan');
        const left = (await ev(`ProvenanceApp.list()`)).filter((r) => r.status !== 'done' && r.status !== 'missing').length;
        await ev(`document.getElementById('filename').value = 'IMG_0006.JPG', document.getElementById('run').click(), 1`);
        await sleep(200);
        await waitResult(c, 'filen efter den avbrutna listan');
        return done + ' filer lika med och utan ' + usual + ' rader i förväg, ExifTool ' + on.exif + ' gånger var; ' + left + ' rader blev kvar när listan avbröts';
    }],

    ['Härkomst: en lista som är bedömd visas igen utan att läsas, bara nya namn bedöms, knappen bedömer på nytt, och en lång lista går att avbryta', async ({ c }) => {
        await c.nav('Härkomst');
        const ev = (e) => c.ev(PROV, e);
        const names = ['IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0005.JPG', 'IMG_0006.JPG', 'finns-inte.jpg', 'IMG_0007.JPG'];
        const type = (list, then) => ev(`(function () { const f = document.getElementById('filename'); f.value = ${JSON.stringify(list.join('\n'))}; f.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('run').click(); ${then || ''} return 1; })()`);
        const listed = (n, label) => c.waitFor(PROV, `!ProvenanceApp.busy() && document.querySelectorAll('#batch-list tbody tr').length === ${n} && ProvenanceApp.exif().starting === 0`, 90000, label);
        const state = () => ev(`({ work: ProvenanceApp.work(), list: JSON.stringify(ProvenanceApp.list()), said: document.getElementById('run-status').textContent,
            kept: document.getElementById('batch-kept').classList.contains('display-none') ? '' : document.getElementById('batch-kept-text').textContent,
            rows: [...document.querySelectorAll('#batch-list tbody tr')].map(t => t.getAttribute('data-i') + ' ' + t.innerText.replace(/\\s+/g, ' ').trim().split(' ')[0]) })`);
        const inOrder = (st, list) => st.rows.join('|') === list.map((n, i) => i + ' ' + n).join('|');
        const run = async (list, label) => { const a = await state(); await type(list); await sleep(300); await listed(list.length, label); const b = await state(); return Object.assign(b, { d: Object.fromEntries(Object.keys(b.work).map((k) => [k, b.work[k] - a.work[k]])) }); };
        const setWindow = (v) => ev(`(function () { const w = document.getElementById('window'); w.value = ${JSON.stringify(v)}; w.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);

        // Första gången bedöms alla. Andra gången läses ingen fil och ställs ingen fråga, och listan är densamma.
        await ev(`ProvenanceApp.forgetTags(), ProvenanceApp.forgetRows(), 1`);
        const first = await run(names, 'listan första gången');
        const assessed = JSON.parse(first.list).filter((r) => r.status === 'done').length;
        expect(assessed >= 4 && first.d.rowsKept === 0 && first.d.exif >= assessed && first.d.md5 >= 1 && first.d.md5 + first.d.md5Kept >= assessed && !first.kept && inOrder(first, names), 'Första gången: ' + JSON.stringify(first.d) + ' ' + first.rows.join('|') + ' ' + first.kept);
        const second = await run(names, 'samma lista igen');
        expect(second.d.rowsKept === names.length && second.d.exif === 0 && second.d.exifReused === 0 && second.d.asked === 0 && second.d.reused === 0 && second.d.md5 === 0 && second.d.md5Kept === 0, 'Samma lista lästes eller frågades igen: ' + JSON.stringify(second.d));
        expect(second.list === first.list && inOrder(second, names), 'Listan ändrades av att visas igen: ' + second.rows.join('|'));
        expect(/^Alla 6 filer var redan bedömda med samma fönster, zon och nycklar, och lästes inte igen\. /.test(second.said), 'Lägesraden: ' + second.said);
        expect(/^Alla 6 filer var redan bedömda med samma fönster, zon och nycklar för den här extraktionen\. De visas som de bedömdes då, utan att läsas igen\.$/.test(second.kept), 'Raden om det som redan var bedömt: ' + second.kept);

        // Två namn till: bara de bedöms, och de andra står som förut.
        const more = names.concat(['IMG_0008.JPG', 'finns-inte-heller.jpg']);
        const third = await run(more, 'listan med två namn till');
        expect(third.d.rowsKept === names.length && third.d.exif >= 1 && third.d.exif < assessed && third.d.md5 + third.d.md5Kept === 1, 'Bara de nya namnen ska bedömas: ' + JSON.stringify(third.d));
        expect(JSON.stringify(JSON.parse(third.list).slice(0, names.length)) === first.list && inOrder(third, more), 'De gamla raderna ändrades: ' + third.rows.join('|'));
        expect(/^2 filer genomgångna på .* 6 filer var redan bedömda och lästes inte igen\. /.test(third.said) && /^6 av 8 filer var redan bedömda/.test(third.kept), 'Lägesraden och raden under: ' + third.said + ' / ' + third.kept);

        // En rad som visas igen öppnas som vanligt.
        await ev(`document.querySelector('#batch-list tr.pick[data-i="3"]').click(), 1`);
        await sleep(200);
        await waitResult(c, 'raden som visades igen');
        expect(await ev(`ProvenanceApp.model().file.filename`) === names[3], 'Klicket öppnade en annan fil');
        await ev(`document.getElementById('batch-back').click(), 1`);
        await sleep(200);

        // Ett annat fönster gäller inte det som sparats: alla bedöms. Tillbaka till det första fönstret står de som då.
        const usual = await ev(`document.getElementById('window').value`);
        const other = await ev(`[...document.getElementById('window').options].map(o => o.value).find(v => v !== document.getElementById('window').value)`);
        const w0 = await state();
        await setWindow(other);
        await sleep(300);
        await listed(more.length, 'listan med ett annat fönster');
        const w1 = await state();
        expect(w1.work.rowsKept === w0.work.rowsKept && w1.work.exifReused > w0.work.exifReused && !w1.kept, 'Ett annat fönster ska bedöma alla: ' + JSON.stringify([w0.work, w1.work]) + ' ' + w1.kept);
        await setWindow(usual);
        await sleep(300);
        await listed(more.length, 'listan med det första fönstret');
        const w2 = await state();
        expect(w2.work.rowsKept - w1.work.rowsKept === more.length && w2.list === third.list, 'Det första fönstret ska visa raderna som då: ' + JSON.stringify([w1.work, w2.work]));

        // Knappen bedömer listan på nytt: filerna läses igen, innehållet är detsamma, och MD5 räknas inte en gång till.
        const b0 = await state();
        await ev(`document.getElementById('batch-fresh').click(), 1`);
        await sleep(300);
        await listed(more.length, 'listan bedömd på nytt');
        const b1 = await state();
        expect(b1.work.rowsKept === b0.work.rowsKept && b1.work.exifReused > b0.work.exifReused && !b1.kept && b1.list === third.list, 'Knappen ska bedöma alla på nytt med samma svar: ' + JSON.stringify([b0.work, b1.work]) + ' ' + b1.kept);
        expect(b1.work.md5 === b0.work.md5 && b1.work.md5Kept - b0.work.md5Kept >= assessed + 1, 'MD5 räknades om för samma innehåll: ' + JSON.stringify([b0.work, b1.work]));

        // En lång lista med namn som inte finns läser inget, och släpper ändå fram fönstret: ett klick på Avbryt mitt
        // i listan når fram. Här släpps fönstret fram efter varje rad, så att provet inte beror på hur fort det går.
        const many = Array.from({ length: 3000 }, (_, i) => 'saknas-' + (i + 1) + '.jpg');
        const pace = await ev(`ProvenanceApp.listFree()`);
        expect(pace > 0 && pace <= 100, 'Listan släpper fram fönstret var ' + pace + ':e ms');
        await ev(`ProvenanceApp.listFree(0), 1`);
        try {
            const f0 = await state();
            await type(many, `window.__stopAt = -1; const ch = new MessageChannel(); ch.port1.onmessage = function () {
                const l = ProvenanceApp.list(), n = l ? l.filter(r => r.status === 'missing').length : 0;
                if (ProvenanceApp.busy() && l && l.length === 3000 && n >= 100) { window.__stopAt = n; document.getElementById('batch-stop').click(); return; }
                if (window.__stopAt < 0 && !(l && l.length === 3000 && !ProvenanceApp.busy())) ch.port2.postMessage(0); }; ch.port2.postMessage(0);`);
            await sleep(300);
            await listed(3000, 'den långa listan');
            const f1 = await state();
            const l1 = JSON.parse(f1.list), stopped = l1.filter((r) => r.status === 'stopped').length, missing = l1.filter((r) => r.status === 'missing').length;
            const stopAt = await ev(`window.__stopAt`);
            expect(stopAt >= 100 && stopAt < 3000 && stopped > 0 && missing + stopped === 3000 && missing >= stopAt && missing <= stopAt + 2, 'Avbryt nådde inte fram mitt i listan: tryckt vid ' + stopAt + ', ' + missing + ' genomgångna, ' + stopped + ' avbrutna');
            expect(f1.work.freed - f0.work.freed >= missing && inOrder(f1, many) && /^Avbruten efter \d+ av 3000 filer/.test(f1.said), 'Den avbrutna listan: ' + JSON.stringify(f1.work) + ' ' + f1.said);
            // Samma lista igen: det som hann gås igenom står kvar, resten gås igenom, och raderna står i sin ordning.
            // Nu i vanlig takt: med en paus efter varje rad ritar webbläsaren tabellen en gång per rad, och i Edge på
            // bygget tog de 2 900 rader som var kvar då över 90 sekunder.
            await ev(`ProvenanceApp.listFree(${pace}), 1`);
            const f2 = await run(many, 'den långa listan igen');
            const l2 = JSON.parse(f2.list);
            expect(f2.d.rowsKept === missing && l2.every((r) => r.status === 'missing') && inOrder(f2, many), 'Den långa listan igen: ' + JSON.stringify(f2.d) + ' ' + f2.said);
            return assessed + ' filer bedömda en gång och visade igen utan läsning, två nya namn bedömda för sig, MD5 återanvänd ' + (b1.work.md5Kept - b0.work.md5Kept) + ' gånger, och 3000 namn avbrutna efter ' + missing;
        } finally {
            // Takten går bara att ställa när ingen lista går. En lista som ännu går avbryts därför först, så att
            // proven efter det här inte får vänta på den eller ärver pausen efter varje rad.
            await ev(`ProvenanceApp.busy() && document.getElementById('batch-stop').click(), 1`);
            await c.waitFor(PROV, `!ProvenanceApp.busy()`, 60000, 'listan stannar').catch(() => {});
            await ev(`ProvenanceApp.listFree(${pace}), 1`);
        }
    }],

    ['Härkomst: en rad öppnas ur underlaget som finns kvar i minnet, lika med en ny bedömning, och taket för minnet sägs under listan', async ({ c }) => {
        await c.nav('Härkomst');
        const ev = (e) => c.ev(PROV, e);
        const A = ['IMG_0002.JPG', 'IMG_0005.JPG', 'IMG_0006.JPG'], B = ['IMG_0007.JPG', 'IMG_0008.JPG'], all = A.concat(B);
        const type = (list) => ev(`(function () { const f = document.getElementById('filename'); f.value = ${JSON.stringify(list.join('\n'))}; f.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('run').click(); return 1; })()`);
        const list = async (names, label) => { await type(names); await sleep(300); await c.waitFor(PROV, `!ProvenanceApp.busy() && document.querySelectorAll('#batch-list tbody tr').length === ${names.length} && ProvenanceApp.exif().starting === 0`, 90000, label); };
        const state = () => ev(`({ work: ProvenanceApp.work(), kept: ProvenanceApp.kept(), said: document.getElementById('batch-memory').classList.contains('display-none') ? '' : document.getElementById('batch-memory').textContent })`);
        const delta = (a, b) => Object.fromEntries(Object.keys(b.work).map((k) => [k, b.work[k] - a.work[k]]));
        // Inget lästes och inget frågades: bara räknaren för rader öppnade ur minnet har gått.
        const onlyShown = (d, n) => Object.keys(d).every((k) => d[k] === (k === 'shownKept' ? n : 0));
        // Det som visas, utan tiden då underlaget skapades (den står i tidslinjens rad och i dess bild).
        const view = async () => {
            await c.waitFor(PROV, `[...document.querySelectorAll('#result img')].every((i) => i.complete)`, 30000, 'bilden i kortet');
            return ev(`(function () { const m = ProvenanceApp.meta(); return { name: ProvenanceApp.model().file.filename, model: JSON.stringify(ProvenanceApp.model()),
                meta: JSON.stringify([m.sources, m.queries, m.coverage, m.fileRows, m.exifRows, m.fileEntry, m.thumbnail, m.zoneLabel, m.zoneNote, m.copiesNote, m.fileMissingReason]),
                text: document.getElementById('result').innerText.replace(/skapad [-0-9: ]+UTC/g, 'skapad då'), created: m.createdText,
                pictures: [...document.querySelectorAll('#result img')].map((i) => i.naturalWidth + 'x' + i.naturalHeight).join(), timelines: (m.timelinePngs || []).length + '/' + (m.closeupPngs || []).length }; })()`);
        };
        const same = (a, b) => ['name', 'model', 'meta', 'text', 'pictures', 'timelines'].filter((k) => a[k] !== b[k]);
        const open = async (i, label) => { await ev(`document.querySelector('#batch-list tr.pick[data-i="${i}"]').click(), 1`); await sleep(200); await waitResult(c, label); };
        const back = async () => { await ev(`document.getElementById('batch-back').click(), 1`); await sleep(200); };
        const step = async (id, pos, label) => { await ev(`document.getElementById('${id}').click(), 1`); await sleep(200); await c.waitFor(PROV, `!ProvenanceApp.busy() && /^Fil ${pos} av /.test(document.getElementById('batch-pos').textContent)`, 60000, label); };
        const setWindow = (v) => ev(`(function () { const w = document.getElementById('window'); w.value = ${JSON.stringify(v)}; w.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);

        await ev(`ProvenanceApp.forgetTags(), ProvenanceApp.forgetRows(), ProvenanceApp.kept(null), 1`);
        try {
            // Listan bedöms: hela underlaget för varje bedömd fil finns kvar, och raden under listan säger det.
            await list(all, 'listan');
            const s0 = await state();
            expect(s0.kept.full === all.length && s0.kept.bytes > 0 && s0.kept.bytes < s0.kept.limit, 'Underlagen sparades inte: ' + JSON.stringify(s0.kept));
            expect(/^Hela underlaget för alla 5 bedömda filer finns kvar i minnet \(ungefär [\d,]+ (byte|kB|MB)\)\. En rad öppnas därför utan att filen bedöms igen; bara bilden läses då ur zippen\.$/.test(s0.said), 'Raden om minnet: ' + s0.said);

            // Ett klick visar underlaget utan att fråga databaserna eller ExifTool och utan att räkna summor. Nästa och
            // Föregående likaså, och samma fil visad en gång till är densamma.
            await open(1, 'raden ur minnet');
            const s1 = await state(), a = await view();
            expect(onlyShown(delta(s0, s1), 1) && a.name === all[1] && a.pictures !== '' && a.timelines !== '0/0', 'Klicket läste eller frågade: ' + JSON.stringify(delta(s0, s1)) + ' ' + a.name + ' ' + a.pictures + ' ' + a.timelines);
            await step('batch-next', 3, 'nästa ur minnet');
            const s2 = await state(), n = await view();
            expect(onlyShown(delta(s1, s2), 1) && n.name === all[2], 'Nästa läste eller frågade: ' + JSON.stringify(delta(s1, s2)) + ' ' + n.name);
            await step('batch-prev', 2, 'föregående ur minnet');
            const s3 = await state(), a2 = await view();
            expect(onlyShown(delta(s2, s3), 1) && !same(a, a2).length && a2.created === a.created, 'Samma fil visad igen skiljer sig i ' + same(a, a2).join() + ': ' + JSON.stringify(delta(s2, s3)));

            // Byts fönstret medan filen visas bedöms den på nytt, och tillbaka i listans fönster likaså.
            const usual = await ev(`document.getElementById('window').value`);
            const other = await ev(`[...document.getElementById('window').options].map(o => o.value).find(v => v !== document.getElementById('window').value)`);
            await setWindow(other);
            await sleep(300);
            await waitResult(c, 'filen med ett annat fönster');
            const s4 = await state(), w = await view();
            expect(delta(s3, s4).shownKept === 0 && delta(s3, s4).asked + delta(s3, s4).reused > 0 && w.name === a.name && w.model !== a.model, 'Ett annat fönster ska bedöma filen på nytt: ' + JSON.stringify(delta(s3, s4)));
            await setWindow(usual);
            await sleep(300);
            await waitResult(c, 'filen med listans fönster igen');
            const s5 = await state(), a3 = await view();
            expect(delta(s4, s5).shownKept === 0 && !same(a, a3).length && s5.kept.full === all.length, 'Listans fönster igen skiljer sig i ' + same(a, a3).join() + ': ' + JSON.stringify(delta(s4, s5)));
            await back();

            // Utan sparade underlag bedöms filen i sin helhet vid klicket, som före 1.67, och det som visas är detsamma
            // som ur minnet. Bara tiden då underlaget skapades skiljer.
            await ev(`ProvenanceApp.kept(0), 1`);
            const s6 = await state();
            await open(1, 'raden bedömd i sin helhet');
            const s7 = await state(), f = await view();
            expect(s6.kept.full === 0 && delta(s6, s7).shownKept === 0 && delta(s6, s7).asked + delta(s6, s7).reused > 0 && delta(s6, s7).exif + delta(s6, s7).exifReused === 1, 'Utan sparat underlag ska filen bedömas: ' + JSON.stringify(delta(s6, s7)));
            expect(!same(a, f).length, 'Underlaget ur minnet skiljer sig från en ny bedömning i ' + same(a, f).join());
            await back();
            const s8 = await state();
            expect(s8.kept.full === 0 && /^Hela underlaget för filerna finns inte kvar i minnet, så en fil bedöms i sin helhet när raden öppnas\. Mer sparas inte nu: underlagen får ta högst hälften av det minne webbläsaren ger sidan, här 0 byte\.$/.test(s8.said), 'Raden om minnet utan plats: ' + s8.said);

            // Med plats igen sparas underlaget från klicket, så att raden öppnas ur minnet nästa gång.
            await ev(`ProvenanceApp.kept(null), 1`);
            await open(1, 'raden bedömd och sparad');
            await back();
            const s9 = await state();
            expect(s9.kept.full === 1 && delta(s8, s9).shownKept === 0 && /^Hela underlaget finns kvar i minnet för 1 av 5 bedömda filer \(ungefär [\d,]+ (byte|kB|MB)\), och de raderna öppnas utan att filen bedöms igen\. De övriga bedöms i sin helhet när raden öppnas\.$/.test(s9.said), 'Underlaget från klicket: ' + JSON.stringify(s9.kept) + ' ' + s9.said);
            await open(1, 'raden ur minnet igen');
            const s10 = await state(), r = await view();
            expect(onlyShown(delta(s9, s10), 1) && !same(a, r).length, 'Det sparade underlaget från klicket skiljer sig i ' + same(a, r).join() + ': ' + JSON.stringify(delta(s9, s10)));
            await back();

            // Taket: en nyare lista tar platsen från en äldre, som då bedömer sina filer igen vid klicket.
            await ev(`ProvenanceApp.forgetRows(), 1`);
            await list(A, 'den första listan');
            const sizeA = (await state()).kept.bytes;
            await list(B, 'den andra listan');
            const sizeB = (await state()).kept.bytes - sizeA;
            const roof = Math.max(sizeA, sizeB) + 2000;
            expect(sizeA > 4000 && sizeB > 4000, 'Underlagens storlek: ' + sizeA + ' och ' + sizeB);
            await ev(`ProvenanceApp.forgetRows(), ProvenanceApp.kept(${roof}), 1`);
            await list(A, 'den första listan under taket');
            const t1 = await state();
            expect(t1.kept.full === A.length && /^Hela underlaget för alla 3 bedömda filer/.test(t1.said), 'Den första listan under taket: ' + JSON.stringify(t1.kept) + ' ' + t1.said);
            await list(B, 'den andra listan under taket');
            const t2 = await state();
            expect(t2.kept.full < all.length && t2.kept.bytes <= roof && /^Hela underlaget för alla 2 bedömda filer/.test(t2.said), 'Den nyare listan ska få platsen: ' + JSON.stringify(t2.kept) + ' ' + t2.said);
            await list(A, 'den första listan igen');
            const t3 = await state();
            expect(delta(t2, t3).rowsKept === A.length && t3.kept.full === t2.kept.full && /^Hela underlaget (finns kvar i minnet för [12] av 3 bedömda filer .*De övriga bedöms i sin helhet när raden öppnas\.|för filerna finns inte kvar i minnet, så en fil bedöms i sin helhet när raden öppnas\.)$/.test(t3.said), 'Den äldre listan igen: ' + JSON.stringify(delta(t2, t3)) + ' ' + t3.said);
            await open(0, 'raden som förlorat sitt underlag');
            await back();
            const t4 = await state();
            expect(delta(t3, t4).shownKept === 0 && delta(t3, t4).asked + delta(t3, t4).reused > 0 && t4.kept.bytes <= roof, 'Raden utan underlag ska bedömas: ' + JSON.stringify(delta(t3, t4)) + ' ' + JSON.stringify(t4.kept));
            await open(0, 'raden med sitt underlag igen');
            await back();
            const t5 = await state();
            expect(onlyShown(delta(t4, t5), 1), 'Underlaget från klicket fick inte platsen från den äldre listan: ' + JSON.stringify(delta(t4, t5)) + ' ' + JSON.stringify(t5.kept));

            // Taket inom en lista: det som inte får plats sparas inte, och raden under listan säger taket.
            await ev(`ProvenanceApp.forgetRows(), ProvenanceApp.kept(${sizeA - 2000}), 1`);
            await list(A, 'listan som inte får plats');
            const u = await state();
            expect(u.kept.full > 0 && u.kept.full < A.length && u.kept.bytes <= sizeA - 2000 && new RegExp('^Hela underlaget finns kvar i minnet för ' + u.kept.full + ' av 3 bedömda filer \\(ungefär [\\d,]+ (byte|kB|MB)\\), och de raderna öppnas utan att filen bedöms igen\\. De övriga bedöms i sin helhet när raden öppnas\\. Mer sparas inte nu: underlagen får ta högst hälften av det minne webbläsaren ger sidan, här [\\d,]+ (byte|kB|MB)\\.$').test(u.said),
                'Listan som inte får plats: ' + JSON.stringify(u.kept) + ' ' + u.said);
            return 'en rad öppnad ur minnet utan läsning, lika med en ny bedömning; ' + Math.round(s0.kept.bytes / all.length / 1024) + ' kB per fil; taket hållet mellan två listor och inom en';
        } finally {
            await ev(`ProvenanceApp.busy() || (ProvenanceApp.kept(null), ProvenanceApp.forgetRows()), 1`);
        }
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
        await ev(`ProvenanceApp.forgetRows(), 1`);
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
        expect(all.apps.length === 3 && all.apps.includes('WhatsApp 4'), 'Apparna: ' + all.apps);
        expect(all.kinds.join(', ') === 'Enskilda ' + (all.total - 1) + ', Grupper 1', 'Slagen: ' + all.kinds);
        expect(all.empty === 'Dölj tomma (1)', 'De tomma: ' + all.empty);

        // En app: bara den står kvar, och raden under valen säger hur mycket som visas.
        await press('app', 'WhatsApp');
        const wa = await read();
        expect(wa.apps.includes('WhatsApp 4*') && wa.groups.join() === 'WhatsApp · iOS [4 av 4]', 'Vald app: ' + JSON.stringify(wa));
        expect(wa.count === 'Visar 4 av ' + all.total + ' konversationer. Visa alla' && wa.items.length === 4, 'Raden under valen: ' + wa.count);
        expect(wa.kinds.join(', ') === 'Enskilda 3, Grupper 1', 'Slagen i appen: ' + wa.kinds);
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
        expect(names(await read()).slice(0, 4).join() === 'Dokumentet,Klubben,Lo,Långa', 'Namn A–Ö: ' + names(await read()));
        await sort('recent');
        await c.ev(CHAT, `document.querySelector('#c-list .c-group[data-group="0"]').click(), 1`);
        const folded = await read();
        expect(folded.groups[0] === 'WhatsApp · iOS [4] hopfälld' && folded.items.length === all.total - 4, 'Hopfälld: ' + JSON.stringify(folded.groups) + ', ' + folded.items.length + ' rader');
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

    ['Chattar: telefonen visar apparna med data, appens chattar, en chatt med knappen tillbaka och galleriet ur bildbiblioteket', async ({ c }) => {
        const CHAT = 'chats/index.html';
        const ev = (e) => c.ev(CHAT, e);
        await c.nav('Chattar');
        await c.waitFor(CHAT, `!ChatsApp.busy() && document.querySelectorAll('.c-item').length > 0`, 60000, 'konversationerna');
        expect(await ev(`!document.getElementById('c-device-open').classList.contains('display-none')`), 'Knappen Telefonen syns inte med en extraktion öppen');
        await ev(`document.getElementById('c-device-open').click(), 1`);
        await c.waitFor(CHAT, `ChatsApp.device().photos && ChatsApp.device().photos.state === 'ready'`, 60000, 'bildbiblioteket');
        const home = await ev(`({ d: ChatsApp.device(), apps: [...document.querySelectorAll('#c-device-body .d-app')].map(a => a.getAttribute('aria-label')), title: document.getElementById('c-device-title').textContent,
            sub: document.getElementById('c-device-sub').textContent, foot: document.getElementById('c-device-foot').textContent, frame: document.getElementById('c-device-phone').dataset.frame,
            back: !document.getElementById('c-device-back').classList.contains('display-none'), view: !document.getElementById('c-view').classList.contains('display-none'), empty: !document.getElementById('c-empty').classList.contains('display-none') })`);
        expect(home.d.shown && home.d.screen === 'home' && !home.view && !home.empty && !home.back && home.frame === 'ios' && home.foot === 'Rekonstruktion ur databaserna – inte en skärmbild', 'Hemskärmen: ' + JSON.stringify(home));
        expect(home.apps.some((a) => /^WhatsApp, \d+ chattar?$/.test(a)) && home.apps.includes('Bilder, 10 bilder') && /appar med data$/.test(home.sub), 'Apparna på hemskärmen: ' + JSON.stringify(home.apps) + ' | ' + home.sub);
        // WhatsApp: chattarna med HTML i namnet som text, och en chatt öppnas i telefonvyn med knappen tillbaka.
        await ev(`document.querySelector('[data-device-app="WhatsApp"]').click(), 1`);
        const rows = await ev(`[...document.querySelectorAll('#c-device-body .d-row b')].map(b => b.textContent)`);
        expect(await ev(`ChatsApp.device().screen`) === 'app' && rows.some((r) => r.startsWith('Lo <img')) && await ev(`!document.getElementById('c-device-back').classList.contains('display-none')`), 'WhatsApp i telefonen: ' + JSON.stringify(rows));
        await ev(`[...document.querySelectorAll('#c-device-body .d-row')].find(b => b.querySelector('b').textContent.startsWith('Lo <img') && /2 meddelanden/.test(b.textContent)).click(), 1`);
        await c.waitFor(CHAT, `!ChatsApp.busy() && ChatsApp.view() && ChatsApp.view().n === 2`, 30000, 'chatten ur telefonen');
        const chat = await ev(`({ look: ChatsApp.look(), device: ChatsApp.device().shown, back: !document.getElementById('c-phone-back').classList.contains('display-none'), text: document.getElementById('c-phone-back-text').textContent,
            stage: document.getElementById('c-stage').classList.contains('phone') })`);
        expect(chat.look === 'phone' && chat.stage && !chat.device && chat.back && chat.text === 'WhatsApp', 'Chatten ur telefonen: ' + JSON.stringify(chat));
        await ev(`document.getElementById('c-phone-back').click(), 1`);
        expect(await ev(`ChatsApp.device().shown && ChatsApp.device().screen === 'app' && ChatsApp.device().app === 'WhatsApp'`), 'Tillbaka från chatten ledde inte till WhatsApps lista');
        await ev(`document.getElementById('c-device-back').click(), 1`);
        expect(await ev(`ChatsApp.device().screen === 'home'`), 'Hem ledde inte till hemskärmen');
        // Bilderna: tio i bildbiblioteket. Den riktiga bilden ritas, en trasig fil och HTML i ett namn står som text.
        await ev(`document.querySelector('[data-device-photos]').click(), 1`);
        await c.waitFor(CHAT, `ChatsApp.device().gallery && ChatsApp.device().gallery.tiles === 10 && document.querySelectorAll('#c-device-body .g-tile.has, #c-device-body .g-tile.none').length === 10`, 30000, 'galleriets bilder');
        const g = await ev(`({ g: ChatsApp.device().gallery, months: [...document.querySelectorAll('#c-device-body .g-month')].map(m => m.textContent), sub: document.getElementById('c-device-sub').textContent,
            drawn: [...document.querySelectorAll('#c-device-body .g-tile.has img')].filter(i => i.naturalWidth > 0).length })`);
        expect(g.drawn >= 1 && g.months.length >= 2 && /^10 bilder · Photos\.sqlite/.test(g.sub), 'Galleriet: ' + JSON.stringify(g));
        await ev(`[...document.querySelectorAll('#c-device-body .g-tile')].find(t => t.getAttribute('aria-label') === 'IMG_0002.JPG').click(), 1`);
        const sheet = await ev(`({ shown: !document.getElementById('c-device-sheet').classList.contains('display-none'), rows: Object.fromEntries([...document.querySelectorAll('#c-device-sheet tr')].map(r => [r.cells[0].textContent, r.cells[1].textContent])),
            assess: !!document.querySelector('#c-device-sheet [data-sheet-assess]') })`);
        expect(sheet.shown && /\(ZDATECREATED\)$/.test(sheet.rows.Skapad) && /Media\/DCIM\/100APPLE\/IMG_0002\.JPG/.test(sheet.rows['I zippen']) && sheet.assess, 'Arket med bilden: ' + JSON.stringify(sheet));
        await ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 1`);
        expect(await ev(`document.getElementById('c-device-sheet').classList.contains('display-none')`), 'Esc stängde inte arket');
        // Bedöm i Härkomst: namnet skickas dit och bedöms i samma extraktion.
        await ev(`document.querySelector('#c-device-body .g-tile').click(), 1`);
        const name = await ev(`document.getElementById('c-sheet-title').textContent`);
        await ev(`document.querySelector('#c-device-sheet [data-sheet-assess]').click(), 1`);
        await c.waitFor(PROV, `document.getElementById('filename').value === ${JSON.stringify(name)}`, 15000, 'namnet i Härkomst').catch(async () => {
            throw new Error('Härkomst fick ' + await c.ev(PROV, `document.getElementById('filename').value`) + ', inte ' + name);
        });
        // Listvyn lämnar telefonen: nästa chatt öppnas som lista, utan knappen tillbaka.
        await c.nav('Chattar');
        await ev(`[...document.querySelectorAll('.c-item')].find(b => b.innerText.includes('Långa chatten')).click(), 1`);
        await c.waitFor(CHAT, `!ChatsApp.busy() && ChatsApp.view() && ChatsApp.view().n > 100`, 30000, 'den långa chatten');
        await ev(`document.getElementById('c-look-list').click(), 1`);
        expect(await ev(`ChatsApp.look() === 'list' && !ChatsApp.device().on && document.getElementById('c-phone-back').classList.contains('display-none')`), 'Listvyn lämnade inte telefonen');
        await noInjectedScript(c);
        return home.apps.join(', ') + '; ' + g.drawn + ' av 10 bilder ritade, ' + g.months.length + ' månader';
    }],

    ['HEIC: avkodaren laddas först när den behövs och ritar testfilen i Chattar, Härkomst och EXIF & karta, med förhandsbilden för listor', async ({ c }) => {
        const b64 = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', '_shared', 'fixtures', 'prov.heic')).toString('base64');
        const out = [];
        for (const [title, part] of [['Chattar', 'chats/index.html'], ['Härkomst', PROV], ['EXIF & karta', 'exif-viewer/index.html']]) {
            await c.nav(title);
            await c.waitFor(part, `!!window.Heic`, 30000, 'Heic i ' + title);
            const r = await c.ev(part, `(async function () {
                const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (ch) => ch.charCodeAt(0));
                const before = !!window.LIBHEIF_WORKER_SOURCE, t = performance.now();
                const full = await Heic.toJpeg(bytes, {});
                const small = await Heic.toJpeg(bytes, { preview: true, maxSide: 240 });
                const ms = Math.round(performance.now() - t);
                const bmp = await createImageBitmap(full.blob);
                let bad = '';
                try { await Heic.toJpeg(bytes.slice(0, 60), {}); } catch (e) { bad = e.message; }
                return { is: Heic.is(bytes), before, after: !!window.LIBHEIF_WORKER_SOURCE, ms, type: full.blob.type, full: [full.w, full.h, full.from], small: [small.w, small.h, small.from], drawn: [bmp.width, bmp.height], bad };
            })()`);
            // I en-fil-versionen är avkodaren inlagd från början. Verktygets ram har då FT_PROTOCOL (src/script.js), inte FT_STANDALONE.
            const standalone = await c.ev(part, `window.FT_STANDALONE === true || window.FT_PROTOCOL === 'file:'`).catch(() => false);
            expect(r.is && (standalone || !r.before) && r.after && r.type === 'image/jpeg', title + ': avkodaren laddades inte som väntat: ' + JSON.stringify(r));
            expect(r.full.join() === '64,48,primary' && r.small.join() === '32,24,preview' && r.drawn.join() === '64,48', title + ': bilderna: ' + JSON.stringify(r));
            expect(/HEIC/.test(r.bad), title + ': en trasig fil gav inget fel: ' + r.bad);
            out.push(title + ' ' + r.ms + ' ms');
        }
        return out.join(', ');
    }],

    ['Chattar: en HEIC som skickats som dokument avkodas och visas, märkt som dokument och med filen att spara', async ({ c }) => {
        const CHAT = 'chats/index.html';
        const ev = (e) => c.ev(CHAT, e);
        await c.nav('Chattar');
        await c.waitFor(CHAT, `!ChatsApp.busy() && [...document.querySelectorAll('.c-item')].some(b => b.innerText.includes('Dokumentet'))`, 60000, 'chatten Dokumentet');
        await ev(`[...document.querySelectorAll('.c-item')].find(b => b.innerText.includes('Dokumentet')).click(), 1`);
        await c.waitFor(CHAT, `!ChatsApp.busy() && ChatsApp.view() && ChatsApp.view().n === 1`, 30000, 'meddelandet');
        await c.waitFor(CHAT, `(function(){ const i = document.querySelector('#c-msgs .att-doc img'); return !!i && i.naturalWidth > 0; })()`, 30000, 'bilden i dokumentet');
        const r = await ev(`(function(){ const d = document.querySelector('#c-msgs .att-doc'), i = d.querySelector('img');
            return { tag: d.querySelector('.att-doc-tag').textContent, size: [i.naturalWidth, i.naturalHeight], save: !!d.querySelector('[data-save]'), info: d.querySelector('.att-doc-info').textContent }; })()`);
        expect(r.tag === 'Dokument: en HEIC-bild som skickades som fil' && r.size.join() === '64,48' && r.save && /IMG_0042\.HEIC/.test(r.info), 'Dokumentet: ' + JSON.stringify(r));
        await ev(`document.querySelector('#c-msgs .att-doc .att-img').click(), 1`);
        await c.waitFor(CHAT, `document.getElementById('c-lb-img').naturalWidth === 64`, 15000, 'förstoringen');
        const cap = await ev(`document.getElementById('c-lb-cap').textContent`);
        expect(/^Dokument \(skickad som fil\) · /.test(cap), 'Förstoringens text: ' + cap);
        await ev(`document.getElementById('c-lb-close').click(), 1`);
        return r.tag;
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
            const src = (r) => r && r.source ? [r.source.db, r.source.column].join(' / ') : '';
            return { modified: src(row('fs-modified')), modifiedMs: row('fs-modified') && row('fs-modified').ms, created: src(row('fs-created')), accessed: src(row('fs-accessed')), changed: row('fs-changed') && row('fs-changed').absent, card: document.getElementById('file-card').innerText, path: ProvenanceApp.meta().fileEntry.path }; })()`);
        expect(st.modified === 'Rapporten / filens ändringstid (report.xml, ModifyTime)' && st.modifiedMs === fx.T + 1000, 'Ändrad: ' + JSON.stringify(st));
        expect(st.created === 'Rapporten / filens skapandetid (report.xml, CreationTime)' && st.accessed === 'Rapporten / senast läst (report.xml, AccessTime)', 'Tiderna: ' + JSON.stringify(st));
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
        const repTimes = await c.ev(PROV, `(function(){ const r = ProvenanceApp.model().factors.find(x => x.id === 'time').times.find(x => x.id === 'fs-changed'); return { ms: r.ms, source: r.source ? [r.source.db, r.source.column].join(' / ') : '', path: ProvenanceApp.meta().fileEntry.path, list: document.getElementById('ex-list').innerText }; })()`);
        expect(repTimes.ms && repTimes.source === 'Rapporten / metadata ändrad (report.xml, ChangeTime)', 'ctime ur rapporten: ' + JSON.stringify(repTimes));
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

    ['Härkomst: en sparad snap i Snapchats Memories på iOS hittas på sitt snap-id, dekrypteras, får sin position och kopplas till chatten den skickades i', async ({ c, fx }) => {
        const sc = fx.snapchatIos;
        const name = path.basename(fx.files.snapchatIos);
        await c.nav('Härkomst');
        await c.ev(PROV, `document.getElementById('ex-close').click(), 1`);
        // Nyckelringen ligger bredvid zippen med samma id i namnet, och har Snapchats nyckel till positionerna. En webbläsare
        // får inte se mappen, så där väljs nyckelringen tillsammans med zippen.
        const desktop = await c.ev(null, `!!window.forensicsMedia`);
        await c.setFiles(null, '#cb-input', desktop ? [fx.files.snapchatIos] : [fx.files.snapchatIos, fx.files.snapchatIosKey]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && document.getElementById('ex-status').textContent.includes(${JSON.stringify(name)}) && /databas(er)? hittades/.test(document.getElementById('ex-status').textContent)`, 60000, 'Snapchat-zippen');
        await c.ev(PROV, `document.getElementById('filename').value = ${JSON.stringify(sc.snapId.toLowerCase())}, document.getElementById('run').click(), 1`);
        await sleep(300);
        await waitResult(c, 'snap-id');
        const r = await c.ev(PROV, `(function(){ const m = ProvenanceApp.model(); const mem = m.file.memory || {};
            const f = (id) => (m.factors.find((x) => x.id === id) || { items: [] }).items.map((i) => i.text).join(' | ');
            return { file: m.file.filename, mem: { by: mem.by, captured: mem.capturedMs, created: mem.createdMs, front: mem.front, lat: mem.latitude, lon: mem.longitude, pos: mem.positionSource && mem.positionSource.db, sends: mem.sends || [] },
                app: f('app'), time: f('time'), position: f('position'), warnings: m.warnings,
                bold: m.events.filter((e) => e.bold).map((e) => e.kind),
                sentText: m.events.filter((e) => e.kind === 'snap-cache' && e.sent).map((e) => e.text + ' | ' + e.plain),
                card: document.getElementById('file-card').innerText, preview: !!document.querySelector('#preview-media') }; })()`);
        expect(r.file === sc.memoryKey, 'Snap-id:t pekar inte ut filen i cachen: ' + r.file);
        expect(r.mem.by === 'id' && r.mem.captured === sc.captureMs && r.mem.created === sc.savedMs && r.mem.front === false, 'Snappen i Memories: ' + JSON.stringify(r.mem));
        expect(Math.abs(r.mem.lat - sc.pos.lat) < 1e-9 && Math.abs(r.mem.lon - sc.pos.lon) < 1e-9 && r.mem.pos === 'gallery.encrypteddb', 'Positionen ur gallery.encrypteddb: ' + JSON.stringify(r.mem) + ' ' + r.warnings.join(' '));
        expect(r.mem.sends.length === 1 && r.mem.sends[0].to === 'konto c1c1c1c1…' && r.mem.sends[0].diff < 1, 'Den skickade kopian: ' + JSON.stringify(r.mem.sends));
        expect(/Samma bild skickades i Snapchat till konto c1c1c1c1… .* \(meddelande 6\)\. Bildjämförelse/.test(r.app), 'Snapchat-faktorn: ' + r.app);
        expect(/Filen hör till snappen genom snappens id i cachenyckeln/.test(r.time) && /ZCAPTURETIMEUTC, ZCREATETIMEUTC/.test(r.time), 'Skapandetiden: ' + r.time);
        expect(/gallery\.encrypteddb, snap_location_table/.test(r.position), 'Positionsfaktorn: ' + r.position);
        expect(r.bold.filter((k) => k === 'snap-memory').length === 2, 'Memories-händelserna är inte filens: ' + r.bold.join(', '));
        const same = r.sentText.find((t) => /samma bild/.test(t));
        const other = r.sentText.find((t) => !/samma bild/.test(t));
        expect(same && /skickad till konto c1c1c1c1… \(meddelande 6, local_message_references\)/.test(same) && /Samma bild skickas till konto c1c1c1c1…/.test(same), 'Den skickade kopian i tidslinjen: ' + same);
        expect(other && /Bildjämförelse mot den bedömda snappen i Memories: medelskillnad \d/.test(other), 'Den andra skickade bilden: ' + other);
        expect(/Sökt på snap-id\s+D3D3D3D3-1234-4567-89AB-CDEF01234567 \(samma som filens\)/i.test(r.card), 'Raden om sökningen i filkortet: ' + r.card.slice(0, 400));
        expect(r.card.includes('dekrypterade innehållet') && r.card.includes(sc.contentSha256) && r.card.includes('ZGALLERYSNAP.ZENCRYPTION'), 'Innehållet i filkortet: ' + r.card.slice(0, 900));
        expect(r.preview, 'Den dekrypterade bilden visas inte');
        // En Memories-post med två snaps: den med fil står i listan att välja ur, den andra nämns.
        await c.ev(PROV, `document.getElementById('filename').value = ${JSON.stringify(sc.entry2)}, document.getElementById('run').click(), 1`);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && !document.getElementById('hits').classList.contains('display-none') && document.querySelectorAll('#hits tr.pick').length > 0`, 30000, 'posten med två snaps');
        const entry2 = await c.ev(PROV, `({ rows: [...document.querySelectorAll('#hits tr.pick')].map((r) => r.querySelector('.path').textContent), note: document.getElementById('run-status').textContent })`);
        expect(entry2.rows.length === 1 && entry2.rows[0].endsWith('/' + sc.memory2Key) && /Memories-post med 2 snaps\. 1 av dem har ingen fil/.test(entry2.note), 'Posten med två snaps: ' + JSON.stringify(entry2));
        // Snappen som bara finns på servern: tiderna, kameran och positionen visas, och knappen söker filer kring tagningen.
        await c.ev(PROV, `document.getElementById('filename').value = ${JSON.stringify(sc.snap3)}, document.getElementById('run').click(), 1`);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && document.querySelector('#hits .mem-when')`, 30000, 'snappen utan fil');
        const only = await c.ev(PROV, `({ text: document.getElementById('hits').innerText, status: document.getElementById('run-status').textContent })`);
        expect(only.text.includes(sc.snap3) && only.text.includes(String(sc.pos3.lat.toFixed(6))) && /frontkameran/.test(only.text) && /gallery\.encrypteddb, snap_location_table/.test(only.text), 'Snappen utan fil: ' + only.text.slice(0, 600));
        expect(/cache_controller\.db har ingen fil för snappen/.test(only.text) && /Snapchat sparar Memories på sin server/.test(only.text) && /utan fil i/.test(only.status), 'Beskedet om filen: ' + only.text.slice(0, 900) + ' | ' + only.status);
        await c.ev(PROV, `document.querySelector('#hits .mem-when').click(), 1`);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && document.getElementById('when-date').value !== ''`, 30000, 'sökningen kring tagningen');
        // Fälten står i datorns zon: tillbaka till UTC ska de ge tagningstiden, på sekunden.
        const when = await c.ev(PROV, `(function(){ const d = document.getElementById('when-date').value, t = document.getElementById('when-time').value; return { text: d + ' ' + t, ms: new Date(d + 'T' + t).getTime() }; })()`);
        expect(when.ms === Math.floor(sc.snap3CaptureMs / 1000) * 1000, 'Tiden i sökningen: ' + when.text);
        // Ett id som inte finns i Memories: som ett filnamn som inte finns.
        await c.ev(PROV, `document.getElementById('filename').value = '00000000-0000-4000-8000-000000000000', document.getElementById('run').click(), 1`);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && /Ingen rad med filnamnet 00000000-0000-4000-8000-000000000000/.test(document.getElementById('run-status').textContent)`, 30000, 'okänt id');
        // Queries: positionerna i den krypterade databasen, med samma nyckel.
        await c.nav('Queries');
        await c.ev(QUER, `document.getElementById('tab-new').click(), 1`);
        await c.waitFor(QUER, `/databaser hittades/.test(document.getElementById('ex-status').textContent) && document.getElementById('bar-zip').textContent === ${JSON.stringify(name)}`, 60000, 'zippen i Queries');
        await c.ev(QUER, `(function(){ const b = document.querySelector('.side-db[data-family="snapchat-gallery"]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); return 1; })()`);
        await c.ev(QUER, `document.querySelector('.side-q[data-db="snapchat-gallery"][data-q="locations"]').click(), 1`);
        await sleep(300);
        await c.ev(QUER, `document.getElementById('run-button').click(), 1`);
        await c.waitFor(QUER, `/rad(er)? på/.test(document.getElementById('run-status').textContent) || /run-warn/.test(document.getElementById('run-status').innerHTML)`, 30000, 'positionerna i Queries');
        const q = await c.ev(QUER, `({ rows: document.querySelectorAll('#run-result tbody tr').length, text: document.getElementById('run-result').innerText, status: document.getElementById('run-status').innerText, trace: document.getElementById('run-trace') ? document.getElementById('run-trace').innerText : '' })`);
        expect(q.rows === 2 && q.text.includes(sc.snapId) && q.text.includes(String(sc.pos.lat)) && q.text.includes(sc.snap3), 'Positionerna i Queries: ' + q.rows + ' rader. ' + q.status);
        expect(/Snapchats inställningar för Memories på iOS/.test(q.trace) && /3 index heter sqlcph_autoindex_…/.test(q.trace), 'Spårbarheten i Queries: ' + q.trace.slice(0, 900));
        await c.nav('Härkomst');
        await c.ev(PROV, `document.getElementById('ex-close').click(), 1`);
        return 'snap-id → filen i cachen, dekrypterad, position ur gallery.encrypteddb, samma bild skickad till konto c1c1c1c1…';
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

    ['Samsung med Signal: inläsningen har en egen stapel under listans, loggen söks i tidsdelar med samma svar, meddelandena slås upp i en tabell i minnet, och filen kopplas till valet och meddelandet', async ({ c, fx }) => {
        await c.nav('Härkomst');
        const ev = (e) => c.ev(PROV, e);
        await ev(`document.getElementById('ex-close').click(), 1`);
        await c.setFiles(null, '#cb-input', [fx.files.samsungSignal]);
        await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && document.getElementById('ex-status').textContent.includes('Testextraktion-Samsung-med-Signal.zip') && /databas(er)? hittades/.test(document.getElementById('ex-status').textContent)`, 60000, 'Samsung-zippen med Signal');
        await ev(`(function () { const k = document.getElementById('signal-key'); k.value = ${JSON.stringify(fx.signalAndroidKey)}; k.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
        await c.waitFor(PROV, `/Den inklistrade nyckeln används/.test(document.getElementById('signal-key-note').textContent)`, 10000, 'nyckeln till Signal');

        // Stegets stapel står under listans medan databaserna läses in, och är borta när listan är klar.
        await ev(`(function () { window.__step = []; const box = document.getElementById('run-step'); let last = '';
            new MutationObserver(function () { const t = (box.classList.contains('idle') ? 'vilar' : box.classList.contains('moving') ? 'rörlig' : 'andel') + '|' + box.lastElementChild.textContent; if (t !== last) { last = t; window.__step.push(t); } })
                .observe(box, { attributes: true, subtree: true, childList: true, characterData: true });
            window.__said = []; const line = document.getElementById('run-status');
            new MutationObserver(function () { const t = line.textContent; if (t && t !== window.__said[window.__said.length - 1]) window.__said.push(t); })
                .observe(line, { subtree: true, childList: true, characterData: true }); })(), 1`);
        const before = await ev(`ProvenanceApp.work()`);
        await ev(`(function () { const f = document.getElementById('filename'); f.value = ${JSON.stringify('20260312_133111.jpg\nchatt_kamera.jpg')}; f.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('run').click(); return 1; })()`);
        await sleep(300);
        await c.waitFor(PROV, `!ProvenanceApp.busy() && document.querySelectorAll('#batch-list tbody tr').length === 2`, 90000, 'listan med Signal');
        const steps = await ev(`window.__step`);
        expect(steps.some((x) => /^(rörlig|andel)\|Görs en gång för hela listan/.test(x)) && /^vilar\|/.test(steps[steps.length - 1]), 'Stegets stapel under listan: ' + steps.join(' ; '));
        expect(await ev(`document.querySelector('#run-step .progress-track').getAttribute('role')`) === 'progressbar', 'Stegets stapel saknar sin roll');
        // Den första filen läser in Signals databaser. För den andra står det att filen slås upp, inte att de läses igen.
        const said = await ev(`window.__said`);
        const read = said.findIndex((x) => /Läser Signals databaser \(beta\)/.test(x)), looked = said.findIndex((x) => /Slår upp filen i Signal \(beta\)/.test(x));
        expect(read >= 0 && looked > read && said.filter((x) => /Läser Signals databaser/.test(x)).length === 1, 'Lägesraden för Signal: ' + said.join(' ; ').slice(0, 900));
        const after = await ev(`ProvenanceApp.work()`);
        expect(after.parts - before.parts > 1 && after.byRows - before.byRows === 1, 'Loggen söktes inte i delar efter antal rader: ' + JSON.stringify(before) + ' → ' + JSON.stringify(after));

        // Svaret är det hela frågan ger: valet i galleriet, bilagan och meddelandet, och protokollet har frågan över hela loggen.
        const one = await assessNamed(c, 'chatt_kamera.jpg');
        const d = await ev(`(function(){ const m = ProvenanceApp.model(); return { events: [...document.querySelectorAll('#events tbody tr')].map(r => r.textContent), sql: [...document.querySelectorAll('#sources pre.sql')].map(p => p.textContent), kinds: m.events.filter(e => /^sig-/.test(e.kind)).map(e => e.kind + (e.isFile ? '*' : '')) }; })()`);
        expect(d.events.some((r) => /Den bedömda filen: Signal: bild skickad till Kim/.test(r) && /meddelande 2/.test(r)), 'Meddelandet: ' + d.events.join(' / '));
        expect(d.events.some((r) => /Signals logg: en fil väljs ur galleriet \(MediaStore-id 2\) som bilaga 7/.test(r)) && d.events.some((r) => /Signals logg: kameran och medievalet öppnas/.test(r)) && d.events.some((r) => /Signals logg: meddelande 2 skickat/.test(r)), 'Loggens rader: ' + d.events.join(' / '));
        expect(one.model.files.includes('sig-message') && one.model.files.includes('sig-pick'), 'Filen är inte kopplad: ' + JSON.stringify(one.model.files));
        const whole = d.sql.filter((q) => /FROM log\s+WHERE created_at BETWEEN 0 AND 4102444800000/.test(q));
        expect(whole.length === 1 && !d.sql.some((q) => /FROM log\s+WHERE created_at BETWEEN (?!0 AND 4102444800000)/.test(q)), 'Protokollet ska ha frågan över hela loggen en gång: ' + d.sql.filter((q) => /FROM log/.test(q)).join(' / ').slice(0, 600));
        const again = await ev(`ProvenanceApp.work()`);
        expect(again.parts === after.parts, 'Loggen söktes igen för samma extraktion: ' + JSON.stringify(again));

        // Meddelandena hämtas en gång till en tabell i minnet, och varje fil slås upp där. Protokollet har frågan mot
        // databasen med filens fönster, och källan säger hur svaret hämtades.
        expect(again.indexBuilt - before.indexBuilt === 1 && again.indexed - before.indexed === 3, 'Tabellen byggs en gång och används för varje fil: ' + JSON.stringify(before) + ' → ' + JSON.stringify(again));
        expect(again.indexChecked - before.indexChecked >= 1 && again.indexChecked - before.indexChecked < again.indexed - before.indexed, 'Uppslaget prövas mot databasen tills ett fönster med rader stämt: ' + JSON.stringify(again));
        const msgSql = d.sql.filter((q) => /FROM message m\s+LEFT JOIN thread t/.test(q) && /WHERE m\.date_sent BETWEEN \d+ AND \d+/.test(q));
        expect(msgSql.length === 1 && !/BETWEEN 0 AND 4102444800000/.test(msgSql[0]) && !d.sql.some((q) => /ft_index/.test(q)), 'Protokollet ska ha meddelandefrågan mot databasen med filens fönster: ' + d.sql.filter((q) => /message/.test(q)).join(' / ').slice(0, 600));
        const src = await ev(`({ lookup: [...document.querySelectorAll('#sources dt')].filter(x => x.textContent === 'Uppslag').map(x => x.nextElementSibling.textContent), warnings: ProvenanceApp.model().warnings, report: ProvenanceReport.protocol(ProvenanceApp.model(), ProvenanceApp.meta()) })`);
        expect(src.lookup.length === 1 && /^Svaret på role-messages över hela tiden \(\d+ rader\) lades en gång i en tabell i minnet med index på date_sent och date_received, och filens fönster slogs upp där\./.test(src.lookup[0]), 'Källans rad om uppslaget: ' + JSON.stringify(src.lookup));
        expect(src.report.includes(src.lookup[0]), 'Raden om uppslaget saknas i protokollet');
        expect(!src.warnings.some((w) => /direkt i databasen/.test(w)), 'Tabellen i minnet togs ur bruk: ' + src.warnings.join(' / '));

        // Samma nyckel klistrad en gång till: Signals databaser står kvar, så inget läses in och loggen söks inte igen.
        const paste = (key) => ev(`(function () { const k = document.getElementById('signal-key'); k.value = ${JSON.stringify(key)}; k.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
        const signalNow = async () => { const a = await assessNamed(c, 'chatt_kamera.jpg'); return { msg: a.model.files.includes('sig-message'), work: await ev(`ProvenanceApp.work()`), report: await ev(`ProvenanceReport.protocol(ProvenanceApp.model(), ProvenanceApp.meta())`) }; };
        const k0 = await signalNow();
        expect(k0.msg && /signal-logs\.db/.test(k0.report), 'Signal före nyckelbytet: ' + JSON.stringify(k0.work));
        await paste(fx.signalAndroidKey);
        const k1 = await signalNow();
        expect(k1.msg && k1.work.loaded === k0.work.loaded && k1.work.parts === k0.work.parts && k1.work.indexBuilt === k0.work.indexBuilt, 'Samma nyckel läste in Signals databaser igen: ' + JSON.stringify(k0.work) + ' → ' + JSON.stringify(k1.work));
        // Protokollet utan klockslaget det skapades och utan de ritade bilderna, där klockslaget också står.
        const undated = (t) => t.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/g, '').replace(/src="data:image\/png;base64,[^"]*"/g, '');
        expect(undated(k1.report) === undated(k0.report), 'Protokollet ändrades av att samma nyckel klistrades in igen: ' + k0.report.length + ' och ' + k1.report.length + ' tecken');
        // Listan som bedömdes med nyckeln visas igen utan läsning, eftersom nycklarna är desamma.
        const twoNames = () => ev(`(function () { const f = document.getElementById('filename'); f.value = ${JSON.stringify('20260312_133111.jpg\nchatt_kamera.jpg')}; f.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('run').click(); return 1; })()`);
        const twoListed = async (label) => { await sleep(300); await c.waitFor(PROV, `!ProvenanceApp.busy() && document.querySelectorAll('#batch-list tbody tr').length === 2`, 90000, label); return ev(`({ work: ProvenanceApp.work(), list: JSON.stringify(ProvenanceApp.list()) })`); };
        await twoNames();
        const l1 = await twoListed('listan med samma nyckel');
        expect(l1.work.rowsKept - k1.work.rowsKept === 2, 'Listan med samma nyckel bedömdes igen: ' + JSON.stringify(l1.work));
        // Utan nyckel är databaserna inte inlästa: filen bedöms utan Signal, protokollet nämner dem inte som lästa, och
        // listan bedöms på nytt i stället för att visas som med nyckeln.
        await paste('');
        await c.waitFor(PROV, `!/Den inklistrade nyckeln används/.test(document.getElementById('signal-key-note').textContent)`, 10000, 'nyckeln borttagen');
        const k2 = await signalNow();
        expect(!k2.msg && k2.work.loaded === k1.work.loaded && !/role-messages/.test(k2.report), 'Utan nyckel ska Signal inte vara med: ' + JSON.stringify(k2.work));
        await twoNames();
        const l2 = await twoListed('listan utan nyckel');
        expect(l2.work.rowsKept === l1.work.rowsKept && l2.list !== l1.list, 'Listan utan nyckel visades som med nyckeln: ' + JSON.stringify(l2.work));
        // Samma nyckel tillbaka: databaserna tas fram igen utan att läsas in, och svaret är det förra.
        await paste(fx.signalAndroidKey);
        const k3 = await signalNow();
        expect(k3.msg && undated(k3.report) === undated(k0.report) && k3.work.loaded === k1.work.loaded && k3.work.parts === k1.work.parts && k3.work.indexBuilt === k1.work.indexBuilt, 'Nyckeln tillbaka läste in Signals databaser igen: ' + JSON.stringify(k1.work) + ' → ' + JSON.stringify(k3.work));
        await twoNames();
        const l3 = await twoListed('listan med nyckeln tillbaka');
        expect(l3.work.rowsKept - l2.work.rowsKept === 2 && l3.list === l1.list, 'Listan med nyckeln tillbaka: ' + JSON.stringify(l3.work));
        // En annan nyckel stänger databaserna. Med den rätta nyckeln igen läses de in på nytt.
        await paste(fx.signalAndroidKey.replace(/^[0-9a-f]{4}/, (x) => (x === '0000' ? '1111' : '0000')));
        const k4 = await signalNow();
        expect(!k4.msg, 'En annan nyckel gav ändå Signals meddelanden');
        await paste(fx.signalAndroidKey);
        const k5 = await signalNow();
        expect(k5.msg && k5.work.loaded - k4.work.loaded === 2 && k5.work.indexBuilt - k4.work.indexBuilt === 1, 'Efter en annan nyckel ska Signals två databaser läsas in igen: ' + JSON.stringify(k4.work) + ' → ' + JSON.stringify(k5.work));

        // Ett uppslag som inte ger frågans rader upptäcks vid det första fönstret: tabellen tas ur bruk, källan får en
        // varning, och svaret kommer från databasen som förut.
        await ev(`(function () { const real = ProvenanceRoles.timeIndex; window.__realTimeIndex = real;
            ProvenanceRoles.timeIndex = function (q) { const spec = real(q); return spec && Object.assign({}, spec, { lookup: function (win) { return spec.lookup(win).replace(' ORDER BY rowid', ' ORDER BY rowid LIMIT 0'); } }); }; })(), 1`);
        try {
            await ev(`document.getElementById('ex-close').click(), 1`);
            await c.setFiles(null, '#cb-input', [fx.files.samsungSignal]);
            await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
            await c.waitFor(PROV, `!ProvenanceApp.busy() && /databas(er)? hittades/.test(document.getElementById('ex-status').textContent)`, 60000, 'Samsung-zippen med Signal en gång till');
            await ev(`(function () { const k = document.getElementById('signal-key'); k.value = ${JSON.stringify(fx.signalAndroidKey)}; k.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
            const wrong = await assessNamed(c, 'chatt_kamera.jpg');
            const w = await ev(`({ warnings: ProvenanceApp.model().warnings, events: [...document.querySelectorAll('#events tbody tr')].map(r => r.textContent), lookup: [...document.querySelectorAll('#sources dt')].filter(x => x.textContent === 'Uppslag').length, work: ProvenanceApp.work() })`);
            expect(w.warnings.filter((x) => /Tabellen i minnet över meddelandena gav inte samma rader som frågan mot databasen, så den används inte\. Varje fil söks i stället direkt i databasen\./.test(x)).length === 1, 'Varningen om uppslaget saknas: ' + w.warnings.join(' / '));
            expect(w.events.some((r) => /Den bedömda filen: Signal: bild skickad till Kim/.test(r) && /meddelande 2/.test(r)) && wrong.model.files.includes('sig-message'), 'Svaret ska komma från databasen: ' + w.events.join(' / ').slice(0, 600));
            expect(w.lookup === 0, 'Källan säger att uppslaget användes fast det togs ur bruk');
            // Nästa fil frågar databasen direkt, utan att bygga tabellen igen.
            await assessNamed(c, '20260312_133111.jpg');
            const w2 = await ev(`ProvenanceApp.work()`);
            expect(w2.indexBuilt === w.work.indexBuilt && w2.indexed === w.work.indexed, 'Tabellen användes eller byggdes igen efter felet: ' + JSON.stringify(w.work) + ' → ' + JSON.stringify(w2));
        } finally {
            await ev(`ProvenanceRoles.timeIndex = window.__realTimeIndex, 1`);
        }
        await noInjectedScript(c);
        return 'stapeln ' + steps.length + ' lägen, loggen i ' + (after.parts - before.parts) + ' delar, meddelandena ur tabellen i minnet (' + (again.indexed - before.indexed) + ' uppslag), filen kopplad till val och meddelande';
    }],

    ['Härkomst → EXIF & karta: listan lämnas över som hänvisningar och läses fil för fil, Signals bilaga dekrypteras med bilagenyckeln, och utan nyckel eller extraktion står skälet på raden', async ({ c, fx }) => {
        const EXIF = 'exif-viewer/index.html';
        const NAMES = ['part7.mms', 'chatt_kamera.jpg', '20260312_133111.jpg'];
        const ev = (e) => c.ev(PROV, e);
        const open = async (key) => {
            await c.nav('Härkomst');
            await ev(`document.getElementById('ex-close').click(), 1`);
            await c.setFiles(null, '#cb-input', [fx.files.samsungSignal]);
            await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
            await c.waitFor(PROV, `!ProvenanceApp.busy() && document.getElementById('ex-status').textContent.includes('Testextraktion-Samsung-med-Signal.zip') && /databas(er)? hittades/.test(document.getElementById('ex-status').textContent)`, 60000, 'Samsung-zippen med Signal');
            await ev(`(function () { const k = document.getElementById('signal-key'); k.value = ${JSON.stringify(key)}; k.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
            await c.waitFor(PROV, `/Den inklistrade nyckeln används/.test(document.getElementById('signal-key-note').textContent)`, 10000, 'nyckeln till Signal');
        };
        const card = () => ev(`({ rows: Object.fromEntries([...document.querySelectorAll('#file-card dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent])), text: document.getElementById('file-card').textContent,
            media: !!document.querySelector('#file-card #preview-media'), entry: ProvenanceApp.meta().fileEntry, exif: ProvenanceApp.meta().exifRows.length, report: ProvenanceReport.protocol(ProvenanceApp.model(), ProvenanceApp.meta()) })`);
        const toExif = async () => {
            await c.nav('Härkomst');
            await ev(`(function () { const f = document.getElementById('filename'); f.value = ${JSON.stringify(NAMES.join('\n'))}; f.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('run').click(); return 1; })()`);
            await sleep(300);
            await c.waitFor(PROV, `!ProvenanceApp.busy() && document.querySelectorAll('#batch-list tbody tr').length === 3`, 90000, 'listan med tre filer');
            await ev(`document.getElementById('batch-exif').click(), 1`);
            await c.waitFor(PROV, `/skickades till EXIF/.test(document.getElementById('run-status').textContent)`, 20000, 'listan till EXIF & karta');
            return ev(`document.getElementById('run-status').textContent`);
        };
        // Raderna i EXIF & karta för filerna ur den här extraktionen: flaggorna, miniatyren och radens text.
        const exifRows = () => c.ev(EXIF, `Object.fromEntries([...document.querySelectorAll('table.files tbody tr')].filter(tr => /Testextraktion-Samsung-med-Signal\.zip/.test(tr.innerText)).map(tr => [tr.querySelector('.name').textContent,
            { pending: tr.classList.contains('pending'), flags: [...tr.querySelectorAll('.flag')].map(f => f.textContent), reasons: [...tr.querySelectorAll('.flag')].map(f => f.title).join(' '), thumb: (tr.querySelector('.row-thumb') || {}).src || '', text: tr.innerText }]))`);
        const exifDone = (label) => c.waitFor(EXIF, `(function(){ const rows = [...document.querySelectorAll('table.files tbody tr')].filter(tr => /Testextraktion-Samsung-med-Signal\.zip/.test(tr.innerText)); return rows.length === 3 && rows.every(tr => !tr.classList.contains('pending')); })()`, 60000, label);

        // Utan bilagenyckeln: bilagans fil läses och summorna räknas, och kortet och protokollet säger varför innehållet inte visas.
        await open(fx.signalAndroidKey);
        await assessNamed(c, 'part7.mms');
        let k = await card();
        expect(k.entry && k.entry.sha256 === fx.signalAndroidPartSums.file, 'Filens summa ska vara den för filen som den ligger: ' + JSON.stringify(k.entry));
        expect(/en av Signals bilagor och ligger krypterad i zippen\. Bilagenyckeln \(modernKey\) saknas/.test(k.rows['Innehållet'] || '') && !k.media && k.exif === 0, 'Kortet utan bilagenyckel: ' + JSON.stringify(k.rows) + ' ' + k.exif);
        expect(/<b>Innehållet:<\/b> Filen lästes, men den är en av Signals bilagor och ligger krypterad/.test(k.report), 'Protokollet säger inte att bilagan ligger krypterad');

        // Listan till EXIF & karta: alla tre filerna kommer fram, ingen läses i Härkomst, och bilagan står som krypterad.
        let said = await toExif();
        expect(/^3 filer skickades till EXIF & karta, som läser dem en i taget ur zippen\.$/.test(said), 'Härkomsts rad om överlämningen: ' + said);
        await exifDone('de tre filerna i EXIF & karta');
        let rows = await exifRows();
        expect(NAMES.every((n) => rows[n]), 'Alla tre filerna ska stå i EXIF & karta: ' + Object.keys(rows).join(', '));
        expect(rows['part7.mms'].flags.includes('Krypterad') && /Bilagenyckeln \(modernKey\) saknas/.test(rows['part7.mms'].reasons), 'Bilagan utan nyckel: ' + JSON.stringify(rows['part7.mms']));
        expect(!rows['chatt_kamera.jpg'].flags.includes('Fel') && !rows['chatt_kamera.jpg'].flags.includes('Krypterad'), 'Bilden ur galleriet: ' + JSON.stringify(rows['chatt_kamera.jpg']));
        // Den lilla bilden görs när filen läses, och innehållet ligger inte kvar på raden.
        await c.waitFor(EXIF, `(function(){ const tr = [...document.querySelectorAll('table.files tbody tr')].find(tr => /Testextraktion-Samsung-med-Signal\.zip/.test(tr.innerText) && tr.querySelector('.name').textContent === 'chatt_kamera.jpg'); const t = tr && tr.querySelector('img.row-thumb'); return !!t && /^blob:/.test(t.src) && t.naturalWidth > 0; })()`, 20000, 'miniatyren för en fil ur extraktionen');

        // Med bilagenyckeln efter databasnyckeln: EXIF och bilden läses ur det dekrypterade innehållet, summan jämförs
        // med databasens, och filens egna summor är fortfarande de för filen som den ligger.
        await open(fx.signalAndroidKey + ' ' + fx.signalAndroidModernKey);
        await assessNamed(c, 'part7.mms');
        k = await card();
        expect(k.entry.sha256 === fx.signalAndroidPartSums.file, 'Filens summa ändrades av dekrypteringen: ' + k.entry.sha256);
        expect(/Det som visas är det dekrypterade innehållet/.test(k.rows['Innehållet'] || '') && k.rows['Innehållet'].includes('SHA-256 ' + fx.signalAndroidPartSums.content) && /Summan är densamma som data_hash_end i signal\.db\./.test(k.rows['Innehållet']), 'Raden om innehållet: ' + JSON.stringify(k.rows));
        expect(k.media && k.exif > 0, 'Bilden och taggarna ur det dekrypterade innehållet saknas: ' + k.media + ' ' + k.exif);
        expect(k.report.includes('EXIF-tagg i det dekrypterade innehållet') && k.report.includes(k.rows['Innehållet']) && k.report.includes('SHA-256 ' + fx.signalAndroidPartSums.file), 'Protokollet ska ha både filens summa och raden om innehållet');

        // Samma lista en gång till: raden som stod som krypterad läses om och visar det dekrypterade innehållet.
        await toExif();
        await c.waitFor(EXIF, `[...document.querySelectorAll('table.files tbody tr')].some(tr => tr.querySelector('.name') && tr.querySelector('.name').textContent === 'part7.mms' && [...tr.querySelectorAll('.flag')].some(f => f.textContent === 'Dekrypterat innehåll'))`, 60000, 'bilagan dekrypterad i EXIF & karta');
        await exifDone('listan en gång till');
        rows = await exifRows();
        const part = rows['part7.mms'];
        expect(!part.flags.includes('Krypterad') && !part.flags.includes('Fel filändelse') && !part.flags.includes('Fel') && /JPEG/.test(part.text), 'Bilagan med nyckel: ' + JSON.stringify(part));
        expect(part.reasons.includes('SHA-256 ' + fx.signalAndroidPartSums.content) && /Summan är densamma som data_hash_end/.test(part.reasons), 'Flaggans skäl: ' + part.reasons);
        expect(Object.keys(rows).length === 3, 'Raderna ska inte dubbleras när listan skickas igen: ' + Object.keys(rows).join(', '));

        // Raden öppnas: bilden hämtas ur extraktionen då, och knappen i raden högst upp bedömer filen i Härkomst på namnet.
        await c.ev(EXIF, `[...document.querySelectorAll('table.files tbody tr')].find(tr => /Testextraktion-Samsung-med-Signal\.zip/.test(tr.innerText) && tr.querySelector('.name').textContent === 'part7.mms').click(), 1`);
        await c.waitFor(EXIF, `(function(){ const m = document.querySelector('#detail-media img.media-view'); return !!m && /^blob:/.test(m.src) && m.naturalWidth > 0; })()`, 20000, 'bilden i detaljvyn');
        // Filsystemets tid säger i klartext vad den är, och var den står i zippen inom parentes. Testzippen har bara DOS-tid.
        const fsNote = await c.ev(EXIF, `(function(){ const dt = [...document.querySelectorAll('#detail dt')].find(d => d.textContent === 'Ändrad i filsystemet'); const s = dt && dt.nextElementSibling.querySelector('.src'); return s ? s.textContent : ''; })()`);
        expect(fsNote === 'zippen, filens ändringstid (DOS-tid)', 'Källan för filsystemets tid i EXIF & karta: ' + fsNote);
        const note = await c.ev(EXIF, `document.getElementById('detail-media').textContent + ' | ' + document.getElementById('detail-summary').textContent`);
        expect(/Innehållet läses ur extraktionen genom Härkomst/.test(note) && /Det som visas är det dekrypterade innehållet/.test(note) && /Tredje tiden i zippen|Ändrad i filsystemet/.test(note), 'Detaljvyn för bilagan: ' + note.slice(0, 500));
        await c.ev(EXIF, `document.getElementById('detail-close').click(), 1`);
        await c.ev(EXIF, `[...document.querySelectorAll('table.files tbody tr')].find(tr => /Testextraktion-Samsung-med-Signal\.zip/.test(tr.innerText) && tr.querySelector('.name').textContent === 'chatt_kamera.jpg').click(), 1`);
        await c.waitFor(null, `document.getElementById('cb-file-name').textContent === 'chatt_kamera.jpg'`, 10000, 'filen i raden högst upp');
        await c.ev(null, `document.querySelector('#cb-file [data-to="provenance"]').click(), 1`);
        await waitResult(c, 'chatt_kamera.jpg från EXIF & karta');
        expect(await ev(`ProvenanceApp.model().file.filename`) === 'chatt_kamera.jpg', 'Härkomst bedömde inte filen från EXIF & karta');

        // Filen som visas i Härkomst lämnas över med knappen i raden högst upp, och öppnas i EXIF & karta.
        await assessNamed(c, '20260312_133111.jpg');
        await c.ev(null, `document.querySelector('#cb-file [data-to="exif"]').click(), 1`);
        await c.waitFor(EXIF, `document.getElementById('detail-name').textContent === '20260312_133111.jpg' && !document.getElementById('detail').classList.contains('display-none')`, 20000, 'filen öppnad i EXIF & karta');

        // Stängs extraktionen går filen inte att hämta, och detaljvyn säger varför i stället för att stå tom.
        await c.nav('Härkomst');
        await ev(`document.getElementById('ex-close').click(), 1`);
        await c.nav('EXIF & karta');
        await c.ev(EXIF, `document.getElementById('detail-close').click(), 1`);
        await c.ev(EXIF, `[...document.querySelectorAll('table.files tbody tr')].find(tr => /Testextraktion-Samsung-med-Signal\.zip/.test(tr.innerText) && tr.querySelector('.name').textContent === 'chatt_kamera.jpg').click(), 1`);
        const gone = await c.waitFor(EXIF, `(function(){ const m = document.querySelector('#detail-media .media-miss'); return m ? m.textContent : ''; })()`, 20000, 'skälet när extraktionen är stängd');
        expect(/Innehållet kunde inte visas: Extraktionen som filen kom ifrån är inte längre öppen i Härkomst\. Öppna den där igen, så kan filen läsas\./.test(gone), 'Skälet: ' + gone);
        await c.ev(EXIF, `document.getElementById('detail-close').click(), 1`);
        await noInjectedScript(c);
        return 'tre filer som hänvisningar, bilagan krypterad utan nyckel och dekrypterad med, summan lika med databasens, skälet står när extraktionen är stängd';
    }],

    ['Extraktionen byts och stängs: det som står kvar räknas upp i en fråga, Låt stå kvar märker vyn med var det kommer ifrån, och Rensa alla vyer tömmer Härkomst, EXIF & karta och Positioner', async ({ c, fx }) => {
        const EXIF = 'exif-viewer/index.html';
        const POS = 'positions/index.html';
        const A = 'Testextraktion-iOS17.zip';
        const B = 'Testextraktion-Samsung.zip';
        // Det här scenariot svarar själv på frågan.
        await c.ev(null, `window.__ftAnswer = 'self', 1`);
        try {
            const pick = async (file) => {
                await c.setFiles(null, '#cb-input', [file]);
                await c.ev(null, `document.getElementById('cb-input').dispatchEvent(new Event('change')), 1`);
            };
            // Frågan när vyerna har svarat: null när ingenting står kvar, annars texten och raderna.
            const question = async () => {
                await c.waitFor(null, `document.getElementById('clear-modal').dataset.state !== 'asking'`, 10000, 'vyernas svar');
                return c.ev(null, `(function(){ const m = document.getElementById('clear-modal'); if (m.classList.contains('display-none')) return null;
                    return { text: document.getElementById('clear-modal-text').textContent, note: document.getElementById('clear-modal-note').textContent,
                        rows: Object.fromEntries([...document.querySelectorAll('#clear-modal-list li')].map(li => [li.querySelector('strong').textContent, li.textContent])) }; })()`);
            };
            const answer = (id) => c.ev(null, `document.getElementById('${id}').click(), 1`);
            const strip = () => c.ev(null, `document.getElementById('kept-strip').hidden ? '' : document.getElementById('kept-text').textContent`);
            const opened = (name) => c.waitFor(PROV, `document.readyState === 'complete' && !!window.ProvenanceApp && !ProvenanceApp.busy() && document.getElementById('ex-status').textContent.includes('${name}') && /hittades/.test(document.getElementById('ex-status').textContent)`, 60000, name + ' i Härkomst');
            const exifRows = () => c.ev(EXIF, `document.querySelectorAll('table.files tbody tr').length`);
            const layers = () => c.ev(POS, `document.querySelectorAll('#layer-list .layer').length`);

            // Utgångsläget: ingen extraktion och tomma vyer, vad scenarierna före än har lämnat. En extraktion öppnas
            // och stängs, och står något kvar då rensas det med frågan själv.
            await c.nav('Härkomst');
            const close = async () => {
                await c.ev(null, `document.getElementById('cb-close').click(), 1`);
                if (await question()) await answer('clear-modal-clear');
                await c.waitFor(null, `document.getElementById('clear-modal').dataset.state === ''`, 5000, 'frågan besvarad');
            };
            if (await c.ev(null, `!document.getElementById('cb-close').hidden`)) await close();
            await pick(fx.files.zip);
            if (await question()) await answer('clear-modal-clear');
            await close();
            await c.waitFor(PROV, `document.readyState === 'complete' && !!window.ProvenanceApp && document.getElementById('filename').value === ''`, 30000, 'Härkomst från början');
            await c.nav('EXIF & karta');
            await c.waitFor(EXIF, `document.readyState === 'complete' && !document.querySelectorAll('table.files tbody tr').length`, 30000, 'EXIF & karta från början');
            await c.nav('Positioner');
            await c.waitFor(POS, `document.readyState === 'complete' && !!document.getElementById('layer-list') && !document.querySelectorAll('#layer-list .layer').length`, 30000, 'Positioner från början');
            await c.nav('Härkomst');

            // En första extraktion byter inte bort någon: ingen fråga.
            await pick(fx.files.zip);
            expect(await question() === null, 'Frågan kom när den första extraktionen öppnades');
            await opened(A);

            // En bedömning i Härkomst, filen vidare till EXIF & karta, och testdata i Positioner.
            await c.ev(PROV, `document.getElementById('filename').value = '${fx.imageName}', document.getElementById('run').click(), 1`);
            await c.waitFor(PROV, `!document.getElementById('hits').classList.contains('display-none') && document.querySelectorAll('#hits tr.pick').length`, 60000, 'vallistan');
            await c.ev(PROV, `[...document.querySelectorAll('#hits tr.pick')].find(tr => /100APPLE/.test(tr.innerText)).click(), 1`);
            await waitResult(c, 'bedömningen');
            await c.ev(null, `document.querySelector('#cb-file [data-to="exif"]').click(), 1`);
            await c.waitFor(EXIF, `document.querySelectorAll('table.files tbody tr').length === 1`, 30000, 'filen i EXIF & karta');
            await c.nav('Positioner');
            await c.ev(POS, `document.getElementById('fill-sample').click(), 1`);
            await c.waitFor(POS, `document.querySelectorAll('#layer-list .layer').length > 0`, 20000, 'testdatan i Positioner');
            const sources = await layers();

            // Byte i raden högst upp, med Härkomst framme: Härkomst följer, och frågan räknar upp det som står kvar.
            await c.nav('Härkomst');
            await pick(fx.files.samsung);
            let q = await question();
            expect(q && q.text === A + ' byttes mot ' + B + '. Det här står kvar från förut:', 'Frågan vid bytet: ' + JSON.stringify(q));
            expect(q.rows['Härkomst'] === 'Härkomst: ifyllt i sökfälten: filnamn', 'Härkomst i frågan: ' + q.rows['Härkomst']);
            expect(q.rows['EXIF & karta'] === 'EXIF & karta: 1 fil i listan', 'EXIF & karta i frågan: ' + q.rows['EXIF & karta']);
            expect(/^Positioner: \d+ punkter i \d+ käll(a|or)$/.test(q.rows['Positioner'] || ''), 'Positioner i frågan: ' + q.rows['Positioner']);
            expect(!q.rows['Chattar'], 'Chattar står i frågan: ' + q.rows['Chattar']);
            expect(/^Rensa alla vyer tömmer .*Härkomst.*EXIF & karta och Positioner och ställer tillbaka inställningarna där\.$/.test(q.note), 'Vad Rensa gör: ' + q.note);
            // Härkomst ställer markören i sin ruta när den nya extraktionen är öppnad. Frågan tar tillbaka den.
            await opened(B);
            await c.waitFor(null, `document.activeElement && document.activeElement.id === 'clear-modal-keep'`, 3000, 'markören tillbaka i frågan');
            // Bytet väntar inte på svaret.
            expect(await c.ev(null, `document.getElementById('cb-zip').textContent`) === B, 'Raden högst upp bytte inte');

            // Låt stå kvar: allt står som det stod, och vyerna som inte säger det själva får en rad om var det kommer ifrån.
            await answer('clear-modal-keep');
            expect(await question() === null, 'Frågan står kvar efter svaret');
            await opened(B);
            expect(await c.ev(PROV, `document.getElementById('result').classList.contains('display-none')`), 'Bedömningen ur ' + A + ' visas fortfarande');
            expect(await c.ev(PROV, `document.getElementById('filename').value`) === fx.imageName, 'Filnamnet i Härkomst stod inte kvar');
            expect(await strip() === '', 'Härkomst fick en rad: ' + await strip());
            const said = 'Här står det kvar som visades när ' + A + ' byttes mot ' + B + '.';
            await c.nav('EXIF & karta');
            expect(await strip() === said, 'Raden över EXIF & karta: ' + await strip());
            expect(await exifRows() === 1, 'Filen i EXIF & karta stod inte kvar');
            await c.nav('Positioner');
            expect(await strip() === said, 'Raden över Positioner: ' + await strip());
            expect(await layers() === sources, 'Källorna i Positioner stod inte kvar');

            // Töms vyn med verktygets egen knapp försvinner raden, och Rensa vyn på raden tömmer bara den vyn.
            await c.nav('EXIF & karta');
            await c.ev(EXIF, `document.getElementById('clear').click(), 1`);
            await c.waitFor(null, `document.getElementById('kept-strip').hidden`, 5000, 'raden över en tömd vy');
            await c.nav('Positioner');
            expect(await strip() === said, 'Raden över Positioner försvann med den över EXIF & karta');
            await c.ev(null, `document.getElementById('kept-clear').click(), 1`);
            await c.waitFor(POS, `document.readyState === 'complete' && !!document.getElementById('layer-list') && !document.querySelectorAll('#layer-list .layer').length`, 30000, 'Positioner från början');
            expect(await strip() === '', 'Raden står kvar över en rensad vy: ' + await strip());
            expect(await c.ev(null, `document.querySelector('.tool-frame.is-active').dataset.tool`) === 'tools/positions/index.html', 'Positioner visas inte efter Rensa vyn');
            expect(await c.ev(PROV, `document.getElementById('filename').value`) === fx.imageName, 'Rensa vyn tömde Härkomst också');

            // Stängning: frågan säger det, och Rensa alla vyer tömmer vyerna som stod i den.
            await c.ev(POS, `document.getElementById('fill-sample').click(), 1`);
            await c.waitFor(POS, `document.querySelectorAll('#layer-list .layer').length > 0`, 20000, 'testdatan i Positioner igen');
            await c.nav('Härkomst');
            await c.ev(null, `document.getElementById('cb-close').click(), 1`);
            q = await question();
            expect(q && q.text === B + ' stängdes. Det här står kvar från förut:', 'Frågan vid stängningen: ' + JSON.stringify(q));
            expect(q.rows['Härkomst'] && q.rows['Positioner'] && !q.rows['EXIF & karta'], 'Raderna vid stängningen: ' + JSON.stringify(q.rows));
            await answer('clear-modal-clear');
            await c.waitFor(PROV, `document.readyState === 'complete' && !!window.ProvenanceApp && document.getElementById('filename').value === ''`, 30000, 'Härkomst från början');
            await c.waitFor(POS, `document.readyState === 'complete' && !!document.getElementById('layer-list') && !document.querySelectorAll('#layer-list .layer').length`, 30000, 'Positioner från början');
            expect(await c.ev(null, `document.getElementById('cb-zip').textContent`) === 'Ingen öppen', 'Extraktionen är inte stängd');
            expect(await c.ev(null, `document.querySelector('.tool-frame.is-active').dataset.tool`) === 'tools/provenance/index.html', 'Härkomst visas inte efter rensningen');
            expect(await c.ev(null, `document.querySelectorAll('.tool-frame[data-tool="tools/provenance/index.html"]').length`) === 1, 'Härkomst finns i två ramar');

            // Ingenting står kvar: ett byte frågar inte.
            await pick(fx.files.zip);
            expect(await question() === null, 'Frågan kom fast ingen extraktion var öppen');
            await opened(A);
            await pick(fx.files.samsung);
            q = await question();
            expect(q === null, 'Frågan kom fast ingenting stod kvar: ' + JSON.stringify(q));
            await opened(B);

            // Rensa alla vyer vid ett byte: vyn börjar om och öppnar den nya extraktionen själv.
            await c.ev(PROV, `document.getElementById('filename').value = 'IMG_0001.JPG', 1`);
            await pick(fx.files.zip);
            q = await question();
            expect(q && q.text === B + ' byttes mot ' + A + '. Det här står kvar från förut:' && Object.keys(q.rows).join() === 'Härkomst', 'Frågan vid det andra bytet: ' + JSON.stringify(q));
            await answer('clear-modal-clear');
            await opened(A);
            expect(await c.ev(PROV, `document.getElementById('filename').value`) === '', 'Filnamnet står kvar efter rensningen');
            expect(await c.ev(null, `document.getElementById('cb-zip').textContent`) === A, 'Raden högst upp efter rensningen');

            // Queries: en flik med en databas ur extraktionen behåller den över bytet. Det står i frågan, och fliken
            // säger själv vilken extraktion den har, så den får ingen rad.
            await c.nav('Queries');
            await c.waitFor(QUER, `window.QueriesApp && QueriesApp.databases().length && /databaser hittades/.test(document.getElementById('ex-status').textContent) && document.getElementById('bar-zip').textContent === '${A}'`, 60000, A + ' i Queries');
            await c.ev(QUER, `(function(){ const b = document.querySelector('.side-db[data-family="knowledgec"]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); document.querySelector('.side-q[data-db="knowledgec"][data-q="app-usage"]').click(); return 1; })()`);
            await sleep(300);
            await c.ev(QUER, `document.getElementById('run-button').click(), 1`);
            await c.waitFor(QUER, `/rad(er)? på/.test(document.getElementById('run-status').textContent)`, 30000, 'queryn');
            await c.nav('Härkomst');
            await pick(fx.files.samsung);
            q = await question();
            expect(q && Object.values(q.rows).join() === 'Queries: 1 flik med en databas ur en annan extraktion', 'Queries i frågan: ' + JSON.stringify(q));
            await answer('clear-modal-keep');
            await c.nav('Queries');
            expect(await strip() === '', 'Queries fick en rad: ' + await strip());
            expect(await c.ev(QUER, `document.getElementById('bar-zip').textContent`) === A, 'Fliken i Queries behöll inte sin extraktion');
            await close();
            await c.waitFor(QUER, `document.readyState === 'complete' && !!window.QueriesApp && !QueriesApp.source()`, 30000, 'Queries från början');
            await noInjectedScript(c);
            return 'fråga vid byte och stängning, ingen fråga när inget står kvar, raden över EXIF & karta och Positioner, Queries i frågan, Rensa vyn och Rensa alla vyer';
        } finally {
            await c.ev(null, `window.__ftAnswer = '', 1`);
        }
    }],

    ['Laboration: standardflöden blir steg, tangenterna loggar dem med klockan, väntan stoppar trycken, och tabellen, CSV-filen och loggen stämmer', async ({ c, downloads }) => {
        const LAB = 'lab/index.html';
        const NAME = 'Samsung <img src=x onerror=window.__ftxss=1>';
        await c.nav('Laboration');
        await c.waitFor(LAB, `!!window.LabCore && !!window.LabTraceView && !!document.getElementById('s-new')`, 30000, 'Laboration laddas');
        const ev = (e) => c.ev(LAB, e);
        const key = (k) => ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true })), 1`);
        const text = (id) => ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
        const mode = () => ev(`document.getElementById('view-run').getAttribute('data-mode')`);
        const fits = async (view) => expect(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`), 'Sidan rullar i sidled i vyn ' + view);
        const search = (q) => ev(`(function(){ const i = document.getElementById('s-q'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
        // Frågorna om att ersätta och ta bort besvaras med ja. Det som en tidigare körning lämnade tas bort.
        await ev(`window.confirm = () => true, localStorage.removeItem('ft-laboration-senaste'), localStorage.removeItem('ft-laboration-sparade'), document.getElementById('p-reset').click(), document.getElementById('nav-start').click(), 1`);

        // Startsidan: sökrutan, det nya och de färdiga flödena, utan flikar.
        const start = await ev(`(function(){
            const shown = (id) => !document.getElementById(id).classList.contains('display-none');
            return { start: shown('view-start'), tabs: shown('tabs'), back: shown('nav-start'), cards: [...document.querySelectorAll('#s-flows .flow-card .card-name')].map(e => e.textContent),
                filters: [...document.querySelectorAll('#s-filters .filter')].map(b => b.firstChild.textContent), read: shown('s-read') && document.getElementById('s-an-title').textContent === 'Analysera utförd laboration',
                current: document.getElementById('nav-start').getAttribute('aria-current') };
        })()`);
        expect(start.start && !start.tabs && start.back && start.current === 'page' && start.read && start.cards.length >= 8 && start.cards.includes('Snapchat Memories') && start.filters.join('|') === 'Alla|Färdiga|Mina mallar|Senaste', 'Startsidan: ' + JSON.stringify(start));
        await search('snapchat memories');
        const found = await ev(`[...document.querySelectorAll('#s-flows .flow-card .card-name')].map(e => e.textContent).join('|') + ' / ' + document.getElementById('s-count').textContent`);
        expect(found === 'Snapchat Memories / 1 flöde för ”snapchat memories”', 'Sökningen: ' + found);
        await ev(`document.querySelector('#s-flows .flow-card').click(), 1`);
        const pv = await ev(`({ open: !document.getElementById('s-preview').classList.contains('display-none'), title: document.getElementById('s-pv-title').textContent, steps: document.querySelectorAll('#s-pv-steps .pv-step').length })`);
        expect(pv.open && pv.title === 'Snapchat Memories' && pv.steps === 7, 'Förhandsvisningen: ' + JSON.stringify(pv));
        await key('Escape');
        expect(await ev(`document.getElementById('s-preview').classList.contains('display-none')`), 'Esc stängde inte förhandsvisningen');
        await search('');
        await fits('Start');
        // Öppna fil… på startsidan öppnar ett sparat flöde, här iPhone-labben om Snapchat Memories.
        expect(await ev(`document.getElementById('s-open').getBoundingClientRect().width > 0 && document.getElementById('s-open').textContent.startsWith('Öppna fil')`), 'Startsidan saknar Öppna fil…');
        await c.setFiles(LAB, '#p-file', [path.join(__dirname, '..', '..', 'docs', 'labbar', 'snapchat-memories-iphone-del1.json')]);
        await c.waitFor(LAB, `!document.getElementById('view-plan').classList.contains('display-none') && document.getElementById('p-status').textContent === 'Flödet är öppnat: 16 steg.'`, 10000, 'flödet öppnas från startsidan');
        await ev(`document.getElementById('p-reset').click(), document.getElementById('nav-start').click(), 1`);
        // Knappen till startsidan står på samma plats i varje vy.
        const home = () => ev(`(function(){ const r = document.getElementById('nav-start').getBoundingClientRect(); return r.width > 0 ? Math.round(r.left) + ',' + Math.round(r.top) : 'dold'; })()`);
        const homeAt = await home();

        // Bygg från delar: två enheter, en app och tre delar.
        await ev(`document.getElementById('s-wizard').click(), 1`);
        await c.waitFor(LAB, `!document.getElementById('view-wizard').classList.contains('display-none') && document.getElementById('tabs').classList.contains('display-none')`, 10000, 'guiden öppnas');
        await ev(`(function(){
            const set = (i, v) => { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
            set(document.querySelector('[data-focus="w-dev-0"]'), ${JSON.stringify(NAME)});
            set(document.querySelector('[data-focus="w-dev-1"]'), 'iPhone');
            document.getElementById('w-next').click();
            for (const l of document.querySelectorAll('#w-apps label.tick')) { const box = l.querySelector('input'), on = l.querySelector('.tick-label').textContent === 'WhatsApp'; if (box.checked !== on) box.click(); }
            document.getElementById('w-next').click();
            const want = ['Klockorna i början', 'Text åt båda håll, och läst', 'Lås och avstängning'];
            for (const l of document.querySelectorAll('#w-blocks label.tick')) { const box = l.querySelector('input'), on = want.includes(l.querySelector('.tick-label').textContent); if (box.checked !== on) box.click(); }
            return 1;
        })()`);
        expect(await text('w-preview') === 'Valet ger 15 steg, ungefär 28 minuter varav 18 minuter väntan.', 'Guidens förhandsvisning: ' + await text('w-preview'));
        await fits('Bygg från delar');
        expect(await home() === homeAt, 'Startknappen flyttade sig i guiden: ' + await home() + ' mot ' + homeAt);
        await ev(`document.getElementById('w-create').click(), 1`);
        await c.waitFor(LAB, `!document.getElementById('view-plan').classList.contains('display-none') && document.querySelectorAll('#p-steps .step').length === 15`, 10000, 'Förbered med stegen ur guiden');
        // Ett eget steg läggs in direkt, sist, och texten skrivs i rutan till höger.
        await ev(`document.querySelector('#p-palette .pal-item[data-kind="custom"]').click(), 1`);
        expect(await ev(`(document.activeElement && document.activeElement.getAttribute('data-focus')) || ''`) === 'd-do', 'Det egna stegets text har inte fokus');
        await ev(`(function(){ const t = document.querySelector('#p-detail [data-focus="d-do"]'); t.value = 'Skriv {kod} i Anteckningar.'; t.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
        const plan = await ev(`({ steps: [...document.querySelectorAll('#p-steps .step')].map(s => s.querySelector('.step-code').textContent + ' ' + s.getAttribute('title')), summary: document.getElementById('p-summary').textContent, chip: document.querySelector('#p-steps .chip').textContent,
            say: document.getElementById('d-say').textContent })`);
        expect(plan.steps.length === 16 && /^16 steg, /.test(plan.summary), 'Stegen: ' + plan.steps.length + ', ' + plan.summary);
        expect(plan.steps[2] === 'L03 Skriv L03 till iPhone och skicka. Klart när meddelandet är skickat.' && plan.steps[15] === 'L16 Skriv L16 i Anteckningar. Klart när det är gjort.', 'Koderna i stegen: ' + plan.steps[2] + ' | ' + plan.steps[15]);
        expect(plan.say === 'Under genomförandet står detSkriv L16 i Anteckningar.Klart när det är gjort.', 'Rutan med stegets text: ' + plan.say);
        expect(plan.chip === NAME, 'Enhetens namn visas inte som text: ' + plan.chip);
        await fits('Förbered');
        expect(await home() === homeAt && await ev(`!document.getElementById('nav-start').hasAttribute('aria-current')`), 'Startknappen i Förbered: ' + await home() + ' mot ' + homeAt);

        // Genomför: övningstrycket sparas inte, Enter startar, och varje tangent gör sitt.
        await ev(`document.getElementById('p-start').click(), 1`);
        expect(await text('r-code') === 'ÖVA', 'Före start: ' + await text('r-code'));
        await key(' ');
        expect(/^Bra, trycket kom \d\d:\d\d:\d\d\./.test(await text('r-do')), 'Övningstrycket: ' + await text('r-do'));
        await key('Enter');
        expect(await text('r-code') === 'L01' && /^\d\d:\d\d:\d\d\.\d$/.test(await text('r-clock')), 'Efter start: ' + await text('r-code') + ' ' + await text('r-clock'));
        await fits('Genomför');
        expect(await home() === homeAt, 'Startknappen flyttade sig i Genomför: ' + await home() + ' mot ' + homeAt);
        // Rutan att fotografera har koden, klockan och datumet tätt ihop och är en liten del av vyn. Stegen i listan
        // står med läsbar text, och steget som görs nu med hela sin text.
        const shot = await ev(`(function () {
            const box = (e) => e.getBoundingClientRect(), s = document.getElementById('r-shot'), b = box(s), v = box(document.getElementById('view-run'));
            const inside = ['r-code', 'r-clock', 'r-zone'].filter(id => { const r = box(document.getElementById(id)); return s.contains(document.getElementById(id)) && r.left >= b.left && r.right <= b.right + 0.5 && r.top >= b.top && r.bottom <= b.bottom + 0.5; });
            const now = document.querySelector('#r-list li.current .list-text');
            return { inside: inside.length, share: (b.width * b.height) / (v.width * v.height), zone: document.getElementById('r-zone').textContent, label: s.querySelector('.shot-label').textContent,
                font: parseFloat(getComputedStyle(document.querySelector('#r-list li')).fontSize), cut: now.scrollWidth > now.clientWidth + 1, abort: !document.getElementById('r-abort').classList.contains('display-none') };
        })()`);
        expect(shot.inside === 3 && shot.share < 0.25 && /^\d{4}-\d\d-\d\d · UTC[+-]\d\d:\d\d/.test(shot.zone) && shot.label === 'Rutan att fotografera', 'Rutan att fotografera: ' + JSON.stringify(shot));
        expect(shot.font >= 14 && !shot.cut && shot.abort, 'Listan med stegen: ' + JSON.stringify(shot));
        // QR-koden i rutan är liten och går att läsa i den storlek den visas: stegets kod och datorns klocka i hela sekunder.
        const qr = await ev(`(async function () {
            const svg = document.getElementById('r-qr'), r = svg.getBoundingClientRect(), s = document.getElementById('r-shot').getBoundingClientRect();
            const img = new Image();
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
            await img.decode();
            const side = Math.round(r.width), c = document.createElement('canvas');
            c.width = c.height = side;
            const g = c.getContext('2d');
            g.drawImage(img, 0, 0, side, side);
            const hit = jsQR(g.getImageData(0, 0, side, side).data, side, side);
            return { text: hit ? hit.data : '', now: Math.floor(Date.now() / 1000), side: r.width, inside: r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom, hidden: svg.classList.contains('display-none') };
        })()`);
        const qrAt = Number((/^L01 (\d+)$/.exec(qr.text) || [])[1]);
        expect(!qr.hidden && qr.inside && qr.side <= 140 && Math.abs(qrAt - qr.now) <= 2, 'QR-koden i rutan: ' + JSON.stringify(qr));
        // Avbryt laborationen: loggen tas bort, flödet står kvar och går att ändra, och nästa start börjar om från L01.
        await key(' ');
        expect(await text('r-code') === 'L02', 'Efter ett tryck: ' + await text('r-code'));
        // Startknappen mitt i laborationen: flikarna och raden överst på startsidan leder tillbaka till samma steg.
        await ev(`document.getElementById('nav-start').click(), 1`);
        const away = await ev(`({ tabs: !document.getElementById('tabs').classList.contains('display-none'), name: document.getElementById('tabs-name').textContent,
            current: document.getElementById('s-resume-title').textContent + ' | ' + document.getElementById('s-resume').textContent, running: document.getElementById('s-current').classList.contains('running') })`);
        expect(away.tabs && /^Pågår: Laboration /.test(away.name) && /^Pågår: Laboration .* \| Fortsätt laborationen$/.test(away.current) && away.running, 'Startsidan under laborationen: ' + JSON.stringify(away));
        await ev(`document.querySelector('#s-flows .flow-card').click(), 1`);
        expect(/ pågår\. Den läggs undan under Mina laborationer, med sin logg,/.test(await text('s-pv-note')) && await ev(`!document.getElementById('s-pv-note').classList.contains('display-none')`), 'Förhandsvisningen säger inte att laborationen pågår: ' + await text('s-pv-note'));
        // Mina laborationer: ett nytt flöde lägger undan den som pågår, utan att fråga, och den kommer tillbaka med loggen.
        const other = await text('s-pv-title');
        await ev(`window.__asked = '', window.confirm = (t) => { window.__asked = t; return true; }, document.getElementById('s-use').click(), 1`);
        expect(await ev(`window.__asked`) === '' && await ev(`!document.getElementById('view-plan').classList.contains('display-none')`) && / ligger kvar under Mina laborationer på startsidan\.$/.test(await text('p-note')), 'Ett nytt flöde mitt i laborationen: ' + await text('p-note'));
        const mine = () => ev(`({ shown: !document.getElementById('s-mine').classList.contains('display-none'), current: document.getElementById('s-current').classList.contains('display-none') ? '' : document.getElementById('s-resume-title').textContent,
            shelf: [...document.querySelectorAll('#s-shelf li')].map(li => li.querySelector('b').textContent + ' | ' + li.querySelector('.current-text > span').textContent) })`);
        await ev(`location.reload(), 1`);
        await sleep(500);
        await c.waitFor(LAB, `!!window.LabCore && !!document.getElementById('s-shelf') && !document.getElementById('view-start').classList.contains('display-none')`, 30000, 'startsidan efter omstart');
        let list = await mine();
        expect(list.shown && list.current === 'Förberedd: ' + other && list.shelf.length === 1 &&
            /^Pågår: Laboration \d{4}-\d\d-\d\d \| 1 av 16 steg är gjorda\. Undanlagd \d{4}-\d\d-\d\d \d\d:\d\d\.$/.test(list.shelf[0]), 'Mina laborationer efter omstart: ' + JSON.stringify(list));
        await ev(`window.confirm = () => true, document.querySelector('#s-shelf [data-open]').click(), 1`);
        expect(await text('r-code') === 'L02' && await mode() === 'step', 'Laborationen ur listan: ' + await text('r-code'));
        await ev(`document.getElementById('nav-start').click(), 1`);
        list = await mine();
        expect(/^Pågår: Laboration /.test(list.current) && list.shelf.length === 1 && list.shelf[0].startsWith('Förberedd: ' + other), 'Listan efter bytet: ' + JSON.stringify(list));
        await ev(`window.__asked = '', window.confirm = (t) => { window.__asked = t; return true; }, document.querySelector('#s-shelf [data-drop]').click(), 1`);
        list = await mine();
        expect(/^Flödet .* tas bort\./.test(await ev(`window.__asked`)) && list.shelf.length === 0 && /^Pågår: /.test(list.current), 'Ta bort ur listan: ' + JSON.stringify(list) + ' ' + await ev(`window.__asked`));
        await ev(`document.getElementById('tab-run').click(), 1`);
        expect(await text('r-code') === 'L02', 'Fliken Genomför ledde inte tillbaka: ' + await text('r-code'));
        await ev(`document.getElementById('nav-start').click(), document.getElementById('s-resume').click(), 1`);
        expect(await text('r-code') === 'L02' && await mode() === 'step', 'Fortsätt laborationen ledde inte tillbaka');
        await ev(`window.confirm = (t) => { window.__asked = t; return true; }, document.getElementById('r-abort').click(), 1`);
        const aborted = await ev(`({ asked: window.__asked, plan: !document.getElementById('view-plan').classList.contains('display-none'), locked: !document.getElementById('p-locked').classList.contains('display-none'),
            steps: document.querySelectorAll('#p-steps .step').length, create: !document.querySelector('#p-palette .pal-item').disabled && document.querySelectorAll('#p-steps .handle').length > 0 })`);
        expect(/^Laborationen avbryts och loggen med 1 steg tas bort härifrån\./.test(aborted.asked) && aborted.plan && !aborted.locked && aborted.steps === 16 && aborted.create, 'Efter Avbryt laborationen: ' + JSON.stringify(aborted));
        await ev(`window.confirm = () => true, document.getElementById('p-start').click(), 1`);
        expect(await text('r-code') === 'ÖVA' && await ev(`document.getElementById('r-abort').classList.contains('display-none')`), 'Före en ny start: ' + await text('r-code'));
        await key('Enter');
        expect(await text('r-code') === 'L01', 'Efter en ny start: ' + await text('r-code'));
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
        await ev(`document.getElementById('r-note-text').value = 'En bild för mycket <b>här</b>.', document.getElementById('r-note-device').selectedIndex = [...document.getElementById('r-note-device').options].findIndex(o => /iPhone utöver flödet$/.test(o.text)), 1`);
        await key(' ');
        expect(await text('r-code') === 'L05', 'Ett mellanslag medan anteckningen var öppen räknades som ett tryck');
        await ev(`document.getElementById('r-note-text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })), 1`);
        expect(/^Anteckningen sparades med tiden \d\d:\d\d:\d\d, på en egen rad\.$/.test(await text('r-toast')), 'Anteckningen: ' + await text('r-toast'));
        // En vanlig anteckning står på raden för steget på skärmen, som är förvalt.
        await key('a');
        const places = await ev(`[...document.getElementById('r-note-device').options].map(o => o.text)`);
        expect(places[0] === 'På raden för L05, steget du är på' && places[1] === 'På raden för L04, steget du nyss gjorde' && places.length === 4, 'Valen för anteckningen: ' + places);
        await ev(`document.getElementById('r-note-text').value = 'Skrev fel först.', 1`);
        await ev(`document.getElementById('r-note-text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })), 1`);
        expect(/^Anteckningen sparades med tiden \d\d:\d\d:\d\d, på raden för L05\.$/.test(await text('r-toast')), 'Anteckningen på raden: ' + await text('r-toast'));
        // Väntan efter L07: mellanslag räknas inte förrän den är slut eller avbruten med V.
        await key(' '); await key(' '); await key(' ');
        expect(await mode() === 'wait' && await text('r-code') === 'VÄNTA' && /^Väntan efter L07: [45]:\d\d kvar\.$/.test(await text('r-do')), 'Väntan: ' + await mode() + ', ' + await text('r-do'));
        await key(' ');
        expect(await ev(`document.querySelectorAll('#r-list li.done, #r-list li.skipped').length`) === 7 && /^Väntan pågår, så trycket räknades inte\./.test(await text('r-toast')), 'Ett tryck under väntan räknades: ' + await text('r-toast'));
        await key('v');
        expect(await mode() === 'step' && await text('r-code') === 'L08', 'Efter avbruten väntan: ' + await mode() + ' ' + await text('r-code'));
        const inTable = () => ev(`!document.getElementById('view-table').classList.contains('display-none')`);
        for (let n = 0; n < 40 && !await inTable(); n++) await key(await mode() === 'wait' ? 'v' : ' ');
        // Efter det sista steget visas tabellen av sig själv. Ett fel tryck på det sista steget går att ångra där.
        const next = () => ev(`({ done: document.getElementById('t-done').classList.contains('display-none') ? '' : document.getElementById('t-done-text').textContent, undo: !document.getElementById('t-undo').classList.contains('display-none'),
            blue: [...document.querySelectorAll('.next-steps .primary-btn')].map(b => b.id).join(), did: [...document.querySelectorAll('.next-steps .next.did')].map(x => x.id).join() })`);
        let after = await next();
        expect(await inTable() && /^Laborationen är klar: alla 16 steg är gjorda, det sista \d\d:\d\d:\d\d\.$/.test(after.done) && after.undo && after.blue === 't-save' && after.did === '', 'Efter det sista steget: ' + JSON.stringify(after));
        await ev(`document.getElementById('t-undo').click(), 1`);
        expect(await text('r-code') === 'L16' && await mode() === 'step' && /^Trycket för L16 togs tillbaka\./.test(await text('r-toast')), 'Ångra från tabellen: ' + await text('r-code') + ', ' + await text('r-toast'));
        await key(' ');
        expect(await inTable(), 'Tabellen visades inte efter det sista steget igen');
        await ev(`document.getElementById('tab-run').click(), 1`);
        expect(await text('r-code') === 'KLAR' && await mode() === 'done', 'Genomför efter laborationen: ' + await text('r-code'));
        await ev(`document.getElementById('r-end').click(), 1`);
        expect(!(await next()).undo, 'Ångra står kvar när tabellen öppnas igen');

        // Tabell: en rad per steg och en för anteckningen, i den ordning det gjordes.
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
        expect(/^Anteckning \d\d:\d\d:\d\d: Skrev fel först\.$/.test(row('L05')[4]), 'Anteckningen på L05: ' + row('L05'));
        expect(row('L16')[2] === 'Skriv L16 i Anteckningar.', 'Det egna steget: ' + row('L16'));
        expect(table.facts.Steg === '15 utförda, 1 inte utförda, 2 anteckningar' && /^2 tryck ångrades/.test(table.facts['Ångrat']) && table.facts.Program === 'Forensics Toolbox ' + VERSION, 'Uppgifterna: ' + JSON.stringify(table.facts));
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
        after = await next();
        expect(after.blue === 't-trace' && after.did === 't-n1,t-n2', 'Efter CSV och loggen: ' + JSON.stringify(after));
        expect(log.format === 'forensics-toolbox-laboration' && log.flow.steps.length === 16 && log.run.entries.length === 16 && log.run.undone.length === 2 && log.run.notes.length === 2 && log.run.notes[1].step === log.flow.steps[4].id, 'Loggfilen: ' + Object.keys(log));
        const logFile = path.join(downloads, fs.readdirSync(downloads).find((n) => /^laboration-.*\.json$/.test(n)));
        await ev(`document.getElementById('t-again').click(), 1`);
        expect(await ev(`!document.getElementById('view-plan').classList.contains('display-none') && !document.querySelector('#p-palette .pal-item').disabled`), 'Flödet går inte att köra igen');
        await c.setFiles(LAB, '#p-file', [logFile]);
        await c.waitFor(LAB, `/^Loggen är öppnad: 16 av 16 steg har ett tryck\. Laboration \\d{4}-\\d\\d-\\d\\d ligger kvar under Mina laborationer på startsidan\.$/.test(document.getElementById('p-status').textContent)`, 10000, 'loggen öppnas igen');
        const again = await ev(`[...document.querySelectorAll('.protocol tbody tr')].map(tr => tr.cells[0].textContent + tr.cells[2].textContent).join('|')`);
        expect(again === table.rows.map((r) => r[0] + r[2]).join('|'), 'Tabellen ur den öppnade loggen skiljer sig från den som sparades');
        // Från tabellen går loggen som finns här direkt till jämförelsen med enheterna, utan att öppnas som fil.
        await ev(`document.getElementById('t-trace').click(), 1`);
        const here = await ev(`({ shown: !document.getElementById('view-trace').classList.contains('display-none'), tabs: !document.getElementById('tabs').classList.contains('display-none'), log: document.getElementById('x-log').textContent,
            name: document.getElementById('x-log-name').textContent, chips: [...document.querySelectorAll('#x-devices .trace-card .chip')].map(x => x.textContent), hint: document.querySelector('#x-sheet .empty').textContent,
            tools: !document.getElementById('x-tools').classList.contains('display-none') })`);
        expect(here.shown && here.tabs && !here.tools && /: 15 av 16 steg gjorda, \d{4}-\d\d-\d\d \d\d:\d\d:\d\d–\d\d:\d\d:\d\d \(UTC[+-]\d\d:\d\d\)$/.test(here.log) && here.name === 'Loggen som finns här i verktyget.', 'Loggen i jämförelsen: ' + JSON.stringify(here));
        expect(here.chips.join('|') === NAME + '|iPhone' && /^Välj extraktionen för varje enhet\./.test(here.hint), 'Enheterna i jämförelsen: ' + JSON.stringify(here));
        await fits('Läs in');
        expect(await home() === homeAt && await ev(`document.querySelector('#view-trace .trace-intro h2').textContent`) === 'Analysera utförd laboration', 'Analysens vy: ' + await home() + ' mot ' + homeAt);
        await ev(`document.getElementById('nav-start').click(), 1`);
        // På startsidan står laborationen först, och flödet ligger bland de senaste.
        await ev(`document.querySelector('#s-filters [data-filter="recent"]').click(), 1`);
        const back = await ev(`({ start: !document.getElementById('view-start').classList.contains('display-none'), resume: document.getElementById('s-resume-title').textContent, shown: !document.getElementById('s-current').classList.contains('display-none'),
            recent: [...document.querySelectorAll('#s-flows .flow-card')].map(c => c.querySelector('.card-name').textContent + ' ' + c.querySelector('.card-meta').textContent) })`);
        expect(back.start && back.shown && /^Klar: Laboration \d{4}-\d\d-\d\d$/.test(back.resume) && back.recent.length === 1 && /^Laboration \d{4}-\d\d-\d\d 16 steg /.test(back.recent[0]), 'Startsidan efter en laboration: ' + JSON.stringify(back));
        await ev(`document.querySelector('#s-filters [data-filter="alla"]').click(), document.getElementById('s-resume').click(), 1`);
        expect(await ev(`!document.getElementById('view-table').classList.contains('display-none')`), 'Fortsätt öppnar inte tabellen');
        await sleep(300);
        await noInjectedScript(c);
        await ev(`document.getElementById('tab-plan').click(), document.getElementById('p-reset').click(), localStorage.removeItem('ft-laboration-senaste'), localStorage.removeItem('ft-laboration-sparade'), 1`);
        await c.nav('Härkomst');
        return plan.steps.length + ' steg, ' + table.rows.length + ' rader i tabellen, CSV och logg, QR-koden läst ur rutan';
    }],

    ['Laboration: ett eget flöde byggs av mallar, steg och drag, ändringar går att ångra, och en egen mall ligger kvar efter omstart', async ({ c, downloads }) => {
        const LAB = 'lab/index.html';
        await c.nav('Laboration');
        await c.waitFor(LAB, `!!window.LabCore && !!document.getElementById('s-new')`, 30000, 'Laboration laddas');
        const ev = (e) => c.ev(LAB, e);
        await ev(`window.confirm = () => true, document.getElementById('nav-start').click(), document.getElementById('s-new').click(), 1`);
        await c.waitFor(LAB, `!!document.querySelector('#p-palette .pal-item') && !document.getElementById('view-plan').classList.contains('display-none')`, 10000, 'Förbered öppnas med ett tomt flöde');
        const text = (id) => ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
        const count = (selector) => ev(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
        const key = (k, o) => ev(`(document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body).dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }, ${JSON.stringify(o || {})}))), 1`);
        // Klickar på det första som väljaren ger, eller på knappen med den texten i det.
        const click = async (selector, label) => expect(await ev(`(function(){
            let e = document.querySelector(${JSON.stringify(selector)});
            if (e && ${JSON.stringify(label || '')}) e = [...e.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label || '')});
            if (!e || e.disabled) return false;
            e.click();
            return true;
        })()`), 'Går inte att klicka på ' + selector + (label ? ' ' + label : ''));
        const set = async (selector, value, kind) => expect(await ev(`(function(){
            const e = document.querySelector(${JSON.stringify(selector)});
            if (!e) return false;
            e.value = ${JSON.stringify(value)};
            e.dispatchEvent(new Event(${JSON.stringify(kind || 'input')}, { bubbles: true }));
            return true;
        })()`), 'Hittar inte ' + selector);
        const rename = async (n, name) => {
            await click(`#p-devices .dev-chip:nth-child(${n}) .dev-name`);
            await set(`#p-devices .dev-chip:nth-child(${n}) .dev-input`, name, 'change');
        };
        const groups = () => ev(`[...document.querySelectorAll('#p-steps .group')].map(g => ({
            title: g.querySelector('.block').textContent, meta: g.querySelector('.group-meta').textContent,
            steps: [...g.querySelectorAll('.step')].map(s => s.querySelector('.step-code').textContent + ' ' + s.querySelector('.chip').textContent + ': ' + s.getAttribute('title').replace(/ Klart .*$/, '')),
        }))`);
        const shape = (g) => g.map((x) => x.steps.length).join('+');
        const pick = async (code) => expect(await ev(`(function(){ const r = [...document.querySelectorAll('#p-steps .step')].find(s => s.querySelector('.step-code').textContent === ${JSON.stringify(code)}); if (!r) return false; r.click(); return true; })()`), 'Hittar inte steget ' + code);
        // Ingenting rullar i sidled: inte sidan, inte flödet, listan eller rutan till höger, och ingen rad i dem.
        const fits = async (what) => {
            const wide = await ev(`[document.documentElement, ...document.querySelectorAll('#p-steps, #p-steps .step, #p-steps .group-head, #p-palette, #p-detail, .side, .flow-head, .dev-bar')]
                .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + e.className) + ' ' + e.scrollWidth + '/' + e.clientWidth)`);
            expect(!wide.length, 'Det sticker ut i sidled ' + what + ': ' + wide.join(', '));
        };
        const G1 = '#p-steps .group:nth-of-type(1)', G2 = '#p-steps .group:nth-of-type(2)';
        const own = () => ev(`[...document.querySelectorAll('#p-palette .pal-own .pal-label')].map(e => e.textContent)`);
        const dropOwn = async () => { for (let n = 0; n < 20 && await count('#p-palette .pal-own'); n++) await click('#p-palette .pal-own .icon-btn'); };

        // Det som en tidigare körning lämnade tas bort.
        await dropOwn();
        await rename(1, 'Samsung');
        await rename(2, 'iPhone');
        expect(await ev(`[...document.querySelectorAll('#p-devices .dev-name')].map(b => b.textContent).join()`) === 'Samsung,iPhone', 'Enheternas namn ändrades inte');
        expect(await count('#p-steps .dropzone') === 1 && /^Nästa byggsten hamnar först/.test(await text('p-where')), 'Ett tomt flöde visar inte ytan att släppa på: ' + await text('p-where'));

        // En mall ur listan blir en grupp, med stegen åt båda håll mellan de två enheterna, och gruppen blir vald.
        await click('.pal-item[data-id="chat-text"]');
        let g = await groups();
        expect(g.length === 1 && g[0].title === 'WhatsApp: text åt båda håll, och läst' && g[0].meta === '4 steg · WhatsApp · Samsung och iPhone', 'Mallen: ' + JSON.stringify(g.map((x) => [x.title, x.meta])));
        expect(g[0].steps[0] === 'L01 Samsung: Skriv L01 till iPhone och skicka.' && /^L02 iPhone: Lås upp, öppna WhatsApp och chatten med Samsung/.test(g[0].steps[1]), 'Mallens steg: ' + g[0].steps.slice(0, 2).join(' | '));
        expect(await count(G1 + '.sel') === 1 && await ev(`document.querySelector('#p-detail h2').textContent`) === 'Gruppen', 'Mallens grupp är inte vald');

        // Ett valt steg är märket: nästa byggsten hamnar efter det, och koderna efter räknas om.
        await pick('L01');
        expect(/^Nästa byggsten hamnar efter L01\./.test(await text('p-where')) && await ev(`document.querySelector('#p-detail .detail-head').textContent`) === 'L01Skicka text×', 'Märket efter det valda steget: ' + await text('p-where'));
        await click('.pal-item[data-id="screenshot"]');
        g = await groups();
        expect(shape(g) === '5' && /^L02 Samsung: Öppna WhatsApp och ta en skärmdump/.test(g[0].steps[1]) && g[0].steps[3] === 'L04 iPhone: Skriv L04 till Samsung och skicka.', 'Steget vid märket: ' + g[0].steps.join(' | '));
        await click('#p-undo');
        g = await groups();
        expect(shape(g) === '4' && g[0].steps[2] === 'L03 iPhone: Skriv L03 till Samsung och skicka.' && await text('p-note') === 'Den senaste ändringen togs tillbaka.', 'Ångra: ' + shape(g) + ', ' + await text('p-note'));

        // Väntan väljs i rutan till höger, och syns på raden och i gruppen.
        await pick('L02');
        await set('#p-detail [data-focus="d-wait"]', '180', 'change');
        g = await groups();
        expect(/varav 3 minuter väntan$/.test(await text('p-summary')) && g[0].meta === '4 steg · väntan 3:00 · WhatsApp · Samsung och iPhone' && await ev(`document.querySelector('#p-steps .step.sel .wait-chip').textContent`) === 'väntan 3:00', 'Väntan: ' + await text('p-summary') + ' | ' + g[0].meta);
        // Från och till: samma enhet i båda rutorna byter plats på dem.
        await set('#p-detail [data-focus="d-other"]', await ev(`document.querySelector('#p-detail [data-focus="d-device"]').value`), 'change');
        g = await groups();
        expect(/^L02 Samsung: Lås upp, öppna WhatsApp och chatten med iPhone/.test(g[0].steps[1]), 'Byte av från och till: ' + g[0].steps[1]);
        await click('#p-undo');

        // Gruppen: rubriken, riktningen, en kopia i en annan app, och gruppen som egen mall.
        await click(G1 + ' .group-head .block');
        await set('#p-detail [data-focus="g-title"]', 'Först <img src=x onerror=window.__ftxss=1>');
        await click('#p-detail [data-focus="g-swap"]');
        g = await groups();
        expect(g[0].title === 'Först <img src=x onerror=window.__ftxss=1>' && g[0].steps[0] === 'L01 iPhone: Skriv L01 till Samsung och skicka.' && g[0].meta === '4 steg · väntan 3:00 · WhatsApp · iPhone och Samsung', 'Byt riktning: ' + g[0].title + ' | ' + g[0].steps[0] + ' | ' + g[0].meta);
        await click('#p-detail', 'Kopiera gruppen');
        expect(await count(G2 + '.sel') === 1, 'Kopian är inte vald');
        await set('#p-detail [data-focus="g-app"]', 'Signal', 'change');
        g = await groups();
        expect(shape(g) === '4+4' && /^L06 Samsung: Lås upp, öppna Signal och chatten med iPhone/.test(g[1].steps[1]) && /öppna WhatsApp och/.test(g[0].steps[1]), 'Kopian i en annan app: ' + g[1].steps[1] + ' | ' + g[0].steps[1]);
        await set('#p-detail .tpl-name', 'Min mall');
        await click('#p-detail', 'Spara som mall');
        expect(await text('p-note') === 'Mallen Min mall ligger nu under Mina mallar, här och på startsidan.' && (await own()).join() === 'Min mall', 'Egen mall: ' + await text('p-note') + ' | ' + await own());
        // Esc i ett fält gäller fältet. Utanför fälten tar Esc bort valet.
        await ev(`document.activeElement && document.activeElement.blur(), 1`);
        await key('Escape');
        expect(await count('#p-steps .sel') === 0 && await ev(`document.querySelector('#p-detail h2').textContent`) === 'Steget', 'Esc tog inte bort valet');

        // Drag med pekaren: ett steg till en annan grupp, en grupp till en ny plats och en mall ur listan sist.
        await c.pointerDrag(LAB, G2 + ' .step[data-pos="0"] .handle', G1 + ' .step[data-pos="3"]', 0.8);
        g = await groups();
        expect(shape(g) === '5+3' && g[0].steps[4] === 'L05 iPhone: Skriv L05 till Samsung och skicka.' && /^L06 Samsung: Lås upp, öppna Signal/.test(g[1].steps[0]), 'Steget efter draget: ' + shape(g) + ' | ' + g[0].steps[4] + ' | ' + g[1].steps[0]);
        expect(await count('#p-steps .step.sel') === 1 && await ev(`document.querySelector('#p-steps .step.sel .step-code').textContent`) === 'L05', 'Steget som drogs är inte valt');
        await c.pointerDrag(LAB, G2 + ' .group-head .handle', G1 + ' .group-head', 0.1);
        g = await groups();
        expect(shape(g) === '3+5' && /^Först </.test(g[1].title) && /^L01 Samsung: Lås upp, öppna Signal/.test(g[0].steps[0]), 'Gruppen efter draget: ' + shape(g) + ' | ' + g.map((x) => x.title).join(' | '));
        await key('Escape');
        await c.pointerDrag(LAB, '.pal-item[data-id="camera"]', '#p-steps .end-zone');
        g = await groups();
        expect(g.length === 3 && g[2].title === 'Kamera och skärmdump' && /^\d+ steg$/.test(g[2].meta), 'Mallen efter draget: ' + g.map((x) => x.title + ' (' + x.meta + ')').join(' | '));
        expect(await count('#p-steps .drop-line') === 0 && await count('.drag-ghost') === 0 && await ev(`document.getElementById('p-steps').hasAttribute('data-drag')`) === false, 'Draget lämnade märken efter sig');
        await ev(`document.activeElement && document.activeElement.blur(), 1`);
        await key('z', { ctrlKey: true });
        g = await groups();
        expect(shape(g) === '3+5', 'Ctrl+Z tog inte tillbaka mallen: ' + shape(g));

        // Kontrollen säger vad som ser fel ut, på steget och i knappen överst, och hindrar ingenting.
        await key('Escape');
        await click('.pal-item[data-id="power-on"]');
        const warn = await ev(`({ on: [...document.querySelectorAll('#p-steps .step.has-warn')].map(s => s.querySelector('.step-code').textContent + ': ' + [...s.querySelectorAll('.step-warn')].map(w => w.textContent).join(' / ')), button: document.getElementById('p-check').textContent, hidden: document.getElementById('p-check').classList.contains('display-none') })`);
        expect(warn.on.includes('L09: Enheten har inte stängts av före det här steget.') && !warn.hidden && warn.button === (warn.on.length === 1 ? '1 sak att se över' : warn.on.length + ' saker att se över'), 'Kontrollen: ' + JSON.stringify(warn));
        expect(await ev(`!document.getElementById('p-start').disabled`), 'En varning hindrar genomförandet');
        // Tangenterna: Alt+↑ flyttar det valda steget, och Delete tar bort det.
        await pick('L09');
        await key('ArrowUp', { altKey: true });
        g = await groups();
        expect(/^L08 \S+: Starta enheten/.test(g[1].steps[4]) && await ev(`document.activeElement.classList.contains('step') && document.activeElement.querySelector('.step-code').textContent`) === 'L08', 'Alt+↑: ' + g[1].steps.slice(2).join(' | '));
        await key('Delete');
        g = await groups();
        expect(shape(g) === '3+5' && /^L08 togs bort\./.test(await text('p-note')), 'Delete: ' + shape(g) + ' | ' + await text('p-note'));

        // Ett eget steg efter det valda, som sedan flyttas först.
        await pick('L01');
        await click('.pal-item[data-kind="custom"]');
        await set('#p-detail [data-focus="d-do"]', 'Öppna Kartor och sök efter {kod}.');
        await ev(`document.querySelector('#p-steps .step.sel').focus(), 1`);
        await key('ArrowUp', { altKey: true });
        g = await groups();
        expect(shape(g) === '4+5' && /^L01 \S+: Öppna Kartor och sök efter L01\.$/.test(g[0].steps[0]), 'Det egna steget: ' + shape(g) + ' | ' + g[0].steps[0]);

        // Långa namn utan mellanslag ryms, också i ett smalt fönster där rutan till höger ligger över flödet.
        await fits('före de långa namnen');
        await rename(1, 'W'.repeat(80));
        await click(G2 + ' .group-head .block');
        await set('#p-detail [data-focus="g-title"]', 'M'.repeat(80));
        await fits('med långa namn');
        await c.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 900, deviceScaleFactor: 1, mobile: false });
        await sleep(300);
        await fits('med långa namn i ett smalt fönster');
        expect(await ev(`getComputedStyle(document.getElementById('p-detail')).position === 'fixed' && getComputedStyle(document.getElementById('p-detail')).display !== 'none'`), 'Rutan till höger ligger inte över flödet i ett smalt fönster');
        await key('Escape');
        expect(await ev(`getComputedStyle(document.getElementById('p-detail')).display === 'none'`), 'Rutan till höger står kvar utan något valt i ett smalt fönster');
        await fits('i ett smalt fönster');
        await c.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
        await sleep(300);

        // Efter en omstart av verktyget ligger flödet och den egna mallen kvar, på startsidan och i listan.
        await ev(`location.reload(), 1`);
        await sleep(500);
        await c.waitFor(LAB, `!!window.LabCore && !!document.getElementById('s-new') && !document.getElementById('view-start').classList.contains('display-none')`, 30000, 'startsidan efter omstart');
        expect(await text('s-resume-desc') === '9 steg, inte påbörjat.', 'Startsidan efter omstart: ' + await text('s-resume-desc'));
        await click('#s-filters [data-filter="own"]');
        expect(await ev(`[...document.querySelectorAll('#s-flows .flow-card .card-name')].map(e => e.textContent).join()`) === 'Min mall', 'Den egna mallen står inte på startsidan');
        await click('#s-filters [data-filter="alla"]');
        await click('#s-resume');
        await c.waitFor(LAB, `!!document.querySelector('#p-palette .pal-item') && document.querySelectorAll('#p-steps .step').length === 9`, 30000, 'flödet finns kvar efter omstart');
        await ev(`window.confirm = () => true, 1`);
        expect((await own()).join() === 'Min mall', 'Efter omstart: ' + await own());
        // Mallen sparades ur en grupp i en annan app. Den blir en egen grupp, och appen byts i gruppens ruta.
        await click('#p-palette .pal-own .pal-item');
        await set('#p-detail [data-focus="g-app"]', 'Telegram', 'change');
        g = await groups();
        expect(shape(g) === '4+5+4' && g[2].title === 'Telegram: Min mall' && /öppna Telegram och chatten med/.test(g[2].steps[1]), 'Den egna mallen i flödet: ' + shape(g) + ' | ' + (g[2] || { steps: [] }).title + ' | ' + (g[2] || { steps: [] }).steps.slice(0, 2).join(' | '));

        // Mallarna som fil: sparas, tas bort ur listan och kommer tillbaka när filen öppnas.
        await click('#p-more');
        expect(await ev(`!document.getElementById('p-menu').classList.contains('display-none')`), 'Menyn Mer öppnas inte');
        await click('#p-save-templates');
        expect(await ev(`document.getElementById('p-menu').classList.contains('display-none')`), 'Menyn Mer står kvar');
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
        expect((await own()).length === 1 && shape(await groups()) === '4+5+4', 'En fil med mallar ändrade flödet eller gav en dubblett');
        fs.rmSync(templateFile);

        // Under ett genomförande är flödet låst: inga grepp, inga byggstenar och inga fält att ändra.
        await click('#p-start');
        await ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })), 1`);
        await click('#tab-plan');
        await pick('L01');
        const locked = await ev(`({ handles: document.querySelectorAll('#p-steps .handle').length, open: document.querySelectorAll('#p-palette .pal-item:not([disabled])').length, fields: document.querySelectorAll('#p-detail input:not([disabled]):not(.tpl-name), #p-detail select:not([disabled]), #p-detail textarea:not([disabled])').length,
            actions: document.querySelectorAll('#p-detail .detail-actions').length, steps: document.querySelectorAll('#p-steps .step').length, note: !document.getElementById('p-locked').classList.contains('display-none') })`);
        expect(locked.handles === 0 && locked.open === 0 && locked.fields === 0 && locked.actions === 0 && locked.steps === 13 && locked.note, 'Det låsta flödet: ' + JSON.stringify(locked));

        await sleep(200);
        await noInjectedScript(c);
        await ev(`document.getElementById('p-reset').click(), localStorage.removeItem('ft-laboration-senaste'), localStorage.removeItem('ft-laboration-sparade'), 1`);
        await dropOwn();
        expect(await count('#p-steps .step') === 0 && (await own()).length === 0, 'Städningen efter provet');
        await c.nav('Härkomst');
        return '3 drag med pekaren, ångra, kontroll, tangenter, egen mall kvar efter omstart, mallar som fil, långa namn i smalt fönster';
    }],

    ['Laboration: en genomförd laboration läses in, stegens spår hittas i extraktionen med QR-koden ur bilden, valen räknar om tabellen och källan öppnas i Queries', async ({ c, downloads }) => {
        const LAB = 'lab/index.html';
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-lab-'));
        const files = labTrace.build(await fixtures.loadSql(), dir);
        await c.nav('Laboration');
        await c.waitFor(LAB, `!!window.LabCore && !!window.LabTraceView && !!document.getElementById('s-read')`, 30000, 'Laboration laddas');
        const ev = (e) => c.ev(LAB, e);
        const text = (id) => ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
        const fits = async (what) => expect(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.getElementById('x-sheet').scrollWidth <= document.getElementById('x-sheet').clientWidth + 1`), 'Det rullar i sidled ' + what);
        // Tabellen som den står: per steg märket, och per spår enheten, tiden, vad tiden är, källan och valen.
        const table = () => ev(`[...document.querySelectorAll('#x-sheet .trace-table tbody tr')].map(tr => ({
            code: tr.dataset.code, mark: tr.dataset.mark, markText: tr.querySelector('.mark').textContent, press: (tr.querySelector('.press') || {}).textContent || '', log: tr.cells[2].textContent, step: tr.cells[1].textContent,
            traces: [...tr.querySelectorAll('.trace')].map(t => ({ line: [...t.querySelector('.trace-line').children].map(x => x.textContent).join(' | '), source: (t.querySelector('.src-btn, .trace-source') || {}).textContent || '',
                link: !!t.querySelector('.src-btn'), thumb: ((t.querySelector('.trace-thumb') || {}).src || '').slice(0, 22), opts: [...t.querySelectorAll('.opt')].map(o => o.textContent + (o.getAttribute('aria-pressed') === 'true' ? ' vald' : o.classList.contains('proposed') ? ' förslag' : '')),
                more: [...t.querySelectorAll('.trace-more div')].map(x => x.textContent) })),
        }))`);
        const marks = () => ev(`[...document.querySelectorAll('#x-marks .mark-btn')].map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? ' *' : '')).join(' | ')`);
        const row = (rows, code) => rows.find((r) => r.code === code) || { traces: [{}] };

        // Det andra valet på startsidan. Utan logg finns bara en sak att göra: öppna den.
        await ev(`window.confirm = () => true, document.getElementById('s-read').click(), 1`);
        const empty = await ev(`({ shown: !document.getElementById('view-trace').classList.contains('display-none'), tabs: !document.getElementById('tabs').classList.contains('display-none'), open: document.getElementById('x-log-open').textContent,
            cards: document.querySelectorAll('#x-devices .trace-card').length, hint: document.querySelector('#x-sheet .empty').textContent, tools: !document.getElementById('x-tools').classList.contains('display-none') })`);
        expect(empty.shown && !empty.tabs && empty.open === 'Öppna logg…' && empty.cards === 0 && !empty.tools && /Börja med loggen\.$/.test(empty.hint), 'Läs in utan logg: ' + JSON.stringify(empty));

        // En fil som inte är en logg säger vad som är fel, och loggen ger en ruta per enhet.
        await c.setFiles(LAB, '#x-log-file', [files.zip]);
        await c.waitFor(LAB, `document.getElementById('x-log-status').textContent.length > 5`, 10000, 'felet för en fil som inte är en logg');
        await c.setFiles(LAB, '#x-log-file', [files.log]);
        await c.waitFor(LAB, `document.querySelectorAll('#x-devices .trace-card').length === 2`, 10000, 'loggen öppnas');
        expect(await text('x-log') === 'Prov i två enheter: 7 av 7 steg gjorda, 2026-11-12 13:00:00–13:07:00 (UTC+01:00)' && await text('x-log-name') === 'laboration-prov.json' && await text('x-log-status') === '', 'Loggens rad: ' + await text('x-log') + ' | ' + await text('x-log-name'));
        expect(await ev(`[...document.querySelectorAll('#x-devices .trace-card .chip')].map(x => x.textContent).join('|')`) === 'iPhone|' + labTrace.XSS, 'Enheternas rutor');

        // Extraktionen för den ena enheten: det som lästes står i rutan, och QR-koden är läst ur bilden av rutan.
        await c.setFiles(LAB, '#x-devices [data-device="d1"] input[type="file"]', [files.zip]);
        await c.waitFor(LAB, `document.querySelectorAll('#x-sheet .trace-table tbody tr').length === 7 && !document.querySelector('#x-devices progress')`, 60000, 'extraktionen läses och tabellen visas');
        const card = await ev(`[...document.querySelectorAll('#x-devices [data-device="d1"] p')].map(p => p.textContent)`);
        expect(card[0] === 'Prov-iPhone.zip (iOS)' && card[1] === 'Läst: ChatStorage.sqlite (WhatsApp) (1 chatt av 2, 2 meddelanden); bildbiblioteket (3 filer från laborationen, QR-koden läst i 1); knowledgeC.db (lås och app framme; av och på söks inte på iOS).' && card.length === 2, 'Extraktionens ruta: ' + JSON.stringify(card));
        let rows = await table();
        expect(rows.map((r) => r.code + ' ' + r.mark).join(', ') === 'L01 sure, L02 sure, L03 sure, L04 many, L05 likely, L06 likely, L07 none', 'Märkena: ' + rows.map((r) => r.code + ' ' + r.mark).join(', '));
        expect(await marks() === '✔ 3 säker | ≈ 2 trolig | ? 1 flera möjliga | – 1 inte hittad', 'Märkenas knappar: ' + await marks());
        expect(row(rows, 'L01').log === '13:01:00' && row(rows, 'L01').traces[0].line === 'iPhone | 13:00:50 | skickat' && row(rows, 'L01').traces[0].source === 'ChatStorage.sqlite · ZMESSAGEDATE' && row(rows, 'L01').traces[0].link, 'L01: ' + JSON.stringify(row(rows, 'L01')));
        expect(row(rows, 'L02').traces[0].line === 'iPhone | 13:01:50 | mottaget' && row(rows, 'L02').step.includes(labTrace.XSS), 'L02: ' + JSON.stringify(row(rows, 'L02')));
        expect(row(rows, 'L03').traces[0].line === 'iPhone | 13:02:52 | bilden tagen' && row(rows, 'L03').traces[0].thumb === 'data:image/jpeg;base64' && row(rows, 'L03').traces[0].source === 'Photos.sqlite · ZDATECREATED', 'L03: ' + JSON.stringify(row(rows, 'L03')));
        expect(row(rows, 'L04').traces[0].opts.join(', ') === '13:03:40, 13:03:55 förslag' && /^tryckt \d+ s efter$/.test(row(rows, 'L04').press), 'L04: ' + JSON.stringify(row(rows, 'L04')));
        expect(row(rows, 'L07').traces[0].line === 'iPhone | inte hittad' && row(rows, 'L07').markText.includes('inte hittad'), 'L07: ' + JSON.stringify(row(rows, 'L07')));
        const facts = await ev(`Object.fromEntries([...document.querySelectorAll('#x-sheet .facts dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]))`);
        expect(facts['Telefonens klocka mot datorns'] === 'iPhone +1,5 s (1 bild av rutan). Varje bild är osäker en halv sekund.' && /^Median \d+ s i 2 säkra steg\.$/.test(facts['Tryck efter telefonens tid']), 'Uppgifterna: ' + JSON.stringify(facts));
        await fits('med tabellen');

        // Ett val bland de möjliga räknar om tabellen utan att extraktionen läses igen, och går att ta tillbaka.
        await ev(`document.querySelector('#x-sheet tr[data-code="L04"] .opt').click(), 1`);
        rows = await table();
        expect(row(rows, 'L04').mark === 'chosen' && row(rows, 'L04').traces[0].opts.join(', ') === '13:03:40 vald, 13:03:55' && row(rows, 'L04').traces[0].line === 'iPhone | 13:03:40 | bilden tagen' && /1 vald/.test(await marks()) && !/flera möjliga/.test(await marks()), 'Efter valet: ' + JSON.stringify(row(rows, 'L04')) + ' | ' + await marks());
        expect(!await ev(`!!document.querySelector('#x-devices progress')`), 'Extraktionen lästes om efter ett val');
        await ev(`document.querySelector('#x-sheet tr[data-code="L04"] .opt[aria-pressed="true"]').click(), 1`);
        rows = await table();
        expect(row(rows, 'L04').mark === 'many', 'Valet gick inte att ta tillbaka: ' + JSON.stringify(row(rows, 'L04')));

        // Söktiden står öppet och går att ändra: med 10 s före loggens tid finns bara en bild kvar för L04.
        await ev(`(function(){ const i = document.getElementById('x-before'); i.value = '10'; i.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
        rows = await table();
        expect(row(rows, 'L04').mark === 'likely' && row(rows, 'L04').traces[0].opts.length === 0 && row(rows, 'L04').traces[0].line === 'iPhone | 13:03:55 | bilden tagen', 'Med kortare söktid: ' + JSON.stringify(row(rows, 'L04')));
        await ev(`(function(){ const i = document.getElementById('x-before'); i.value = '180'; i.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);

        // Ett märke i raden överst visar bara de stegen, och Mer visar alla tider i meddelandet med sina kolumner.
        await ev(`document.querySelector('#x-marks .mark-none').click(), 1`);
        rows = await table();
        expect(rows.length === 1 && rows[0].code === 'L07' && / \*$/.test((await marks()).split(' | ').pop()), 'Bara de som inte hittades: ' + rows.map((r) => r.code) + ' | ' + await marks());
        await ev(`document.querySelector('#x-marks .mark-none').click(), 1`);
        await ev(`document.querySelector('#x-sheet tr[data-code="L02"] .mark-cell .link-btn').click(), 1`);
        rows = await table();
        expect(rows.length === 7 && row(rows, 'L02').traces[0].more.some((m) => /: 2026-11-12 13:01:50 · .*ZMESSAGEDATE$/.test(m)) && row(rows, 'L02').traces[0].more.some((m) => /: 2026-11-12 13:02:05 · .*ZSENTDATE$/.test(m)), 'Mer om L02: ' + JSON.stringify(row(rows, 'L02')));
        await ev(`document.querySelector('#x-sheet tr[data-code="L02"] .mark-cell .link-btn').click(), 1`);

        // Ett smalt fönster: ingenting sticker ut i sidled, och ingenting sticker ut ur sin cell (den längsta texten som
        // inte bryts är tiden för appen i förgrunden, från och till, och det bredaste är bilden). Det mäts mot cellens
        // innehåll, innanför dess marginal: i Windows och Linux tar rullningslisten plats som den inte tar i macOS, och
        // det som bara når ut i marginalen här når över kanten där. Tre bredder: 820 med ramens meny bredvid, som ger
        // verktyget 500, 804 som ger det 484 (så mycket som en rullningslist tar), och 640 där menyn är hopfälld.
        for (const width of [820, 804, 640]) {
            await c.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
            await sleep(300);
            await fits('i ett fönster som är ' + width + ' brett');
            const outside = await ev(`[...document.querySelectorAll('#x-sheet .trace-table td')].flatMap(td => { const right = td.getBoundingClientRect().right - parseFloat(getComputedStyle(td).paddingRight);
                return [...td.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > right + 1).map(e => td.parentNode.dataset.code + ' ' + (e.className || e.tagName) + ' +' + Math.round(e.getBoundingClientRect().right - right)); })`);
            expect(!outside.length && row(await table(), 'L06').traces[0].line === 'iPhone | 13:05:40–13:06:20 | appen framme', 'Det sticker ut ur sin cell i ett fönster som är ' + width + ' brett: ' + outside.join(', '));
        }
        await c.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
        await sleep(300);

        // CSV-filen har en rad per spår, också det som inte hittades.
        await ev(`document.getElementById('x-csv').click(), 1`);
        const csv = await download(downloads, /^laboration-2026-11-12-Prov-i-två-enheter-spår\.csv$/);
        const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
        expect(csv.charCodeAt(0) === 0xFEFF && lines.length === 8 && /^Kod;/.test(lines[0]) && /^L01;/.test(lines[1]) && /ChatStorage\.sqlite/.test(lines[1]), 'CSV-filen: ' + lines.length + ' rader, ' + lines[0] + ' | ' + lines[1]);
        expect(/^Sparade laboration-2026-11-12-Prov-i-två-enheter-spår\.csv$/.test(await text('x-status')), 'Raden efter CSV: ' + await text('x-status'));

        // Källan: länken öppnar meddelandets rad i Queries, i samma extraktion, med raden markerad på tiden.
        await ev(`document.querySelector('#x-sheet tr[data-code="L01"] .src-btn').click(), 1`);
        const hit = await c.waitFor(QUER, `(function(){
            const row = document.querySelector('#run-result tr.row-hit');
            return row && { row: row.innerText, hits: document.querySelectorAll('#run-result tr.row-hit').length, src: document.getElementById('run-file-list').innerText, title: document.getElementById('q-title').textContent };
        })()`, 60000, 'den markerade raden i Queries');
        expect(hit.hits === 1 && /L01 Hej från iPhone/.test(hit.row) && /ChatStorage\.sqlite/.test(hit.src) && /: L01$/.test(hit.title), 'Raden i Queries: ' + JSON.stringify(hit));

        // Tillbaka i Laboration står tabellen kvar, och en annan logg börjar om med tomma rutor.
        await c.nav('Laboration');
        expect((await table()).length === 7, 'Tabellen stod inte kvar efter besöket i Queries');
        await noInjectedScript(c);
        await ev(`document.getElementById('nav-start').click(), 1`);
        expect(await ev(`!document.getElementById('view-start').classList.contains('display-none') && !/^(Pågår|Klar): /.test(document.getElementById('s-resume-title').textContent)`), 'Den öppnade loggen blev verktygets egen');
        fs.rmSync(dir, { recursive: true, force: true });
        await c.nav('Härkomst');
        return '7 steg: 3 säkra med QR-koden ur bilden, val, söktid, märken, CSV och källan i Queries';
    }],
];

module.exports = { scenarios, expect, factors, assessNamed, waitResult, download, noInjectedScript, PROV, QUER };
