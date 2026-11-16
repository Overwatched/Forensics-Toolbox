// Laboration: vyn som läser in en genomförd laboration. Loggen (den som finns i verktyget eller en sparad fil)
// jämförs med enheternas extraktioner. lab-read.js läser underlaget ur varje extraktion en gång och det hålls i
// minnet, och lab-trace.js söker stegens spår i det. Ett val bland flera möjliga eller en ändrad söktid räknar
// om tabellen ur underlaget, utan att extraktionen läses igen. Extraktionen läses bara, ingenting skrivs i den.
(function () {
    'use strict';

    var Lab = window.LabCore, Trace = window.LabTrace, Read = window.LabRead;
    var inHub = window.parent !== window;
    // T: det som delas med script.js ({ el, soft, copyHtml, printDoc, download, PROGRAM }).
    var T = null, SQL = null;

    // log: { flow, run, name, own (loggen är verktygets egen), count }. info: per enhet { file, busy, stage, frac,
    // error, out (svaret från LabRead.read) }. chosen: { plats: spårets nyckel } för det användaren har valt.
    // open: rader som visas med allt. only: märket som listan är begränsad till. queue: enheter som väntar på läsning.
    var view = { log: null, info: {}, chosen: {}, open: {}, only: '', before: 180, after: 60, result: null, queue: [], working: false };
    var MARK_ORDER = ['sure', 'chosen', 'likely', 'many', 'none', 'wait', 'off'];
    var WINDOW_MAX = 86400;

    function $(id) { return document.getElementById(id); }
    function errText(e) { return e && e.message ? e.message : String(e); }
    function say(id, text) { $(id).textContent = text || ''; }
    function deviceClass(id) {
        var n = view.log.flow.devices.findIndex(function (d) { return d.id === id; });
        return n < 0 ? 'dev-all' : 'dev-' + (n % 4);
    }

    async function loadSql() {
        if (SQL) return SQL;
        if (window.toolboxWasmProblem()) throw new Error(window.toolboxWasmProblem());
        SQL = await initSqlJs({ wasmBinary: window.SQL_WASM_BINARY });
        return SQL;
    }

    // ---------- Loggen ----------

    function setLog(flow, run, name, own) {
        view.log = flow ? { flow: flow, run: run, name: name, own: !!own, count: run.entries.length } : null;
        view.info = {};
        view.chosen = {};
        view.open = {};
        view.only = '';
        view.result = null;
        view.queue = [];
        say('x-log-status', '');
        say('x-status', '');
    }

    // Vyn öppnas. Loggen som finns i verktyget används när ingen annan är öppnad, och följer med när den ändras.
    function enter(flow, run) {
        var has = !!(run && run.entries.length);
        if (view.log && view.log.own && (!has || view.log.run !== run || view.log.count !== run.entries.length)) setLog(null);
        if (!view.log && has) setLog(flow, run, '', true);
        render();
    }

    function openLog(file) {
        if (!file) return;
        if (file.size > 5e6) return say('x-log-status', 'Filen är för stor för att vara en logg.');
        file.text().then(function (text) {
            var back = Lab.fromFile(text);
            if (!back.run || !back.run.entries.length) return say('x-log-status', 'Filen har ett flöde men ingen logg. Välj filen som sparades när laborationen var klar.');
            setLog(back.flow, back.run, file.name, false);
            render();
        }).catch(function (e) { say('x-log-status', errText(e) || 'Filen gick inte att läsa.'); });
    }

    function logLine() {
        var L = view.log, done = L.run.entries.filter(function (e) { return e.status === 'klar'; });
        var last = done.length ? done[done.length - 1].t : L.run.started;
        return L.flow.name + ': ' + done.length + ' av ' + L.flow.steps.length + ' steg gjorda, ' + Lab.dateText(L.run.started, L.run.off) + ' ' +
            Lab.timeText(L.run.started, L.run.off) + '–' + Lab.timeText(last, L.run.off) + ' (UTC' + Lab.offsetText(L.run.off) + ')';
    }

    // ---------- Extraktionerna ----------

    function choose(id, file) {
        view.info[id] = { file: file, busy: true, stage: 'Väntar på sin tur…', frac: null, error: '', out: null };
        Object.keys(view.chosen).forEach(function (slot) { if (slot.split('|')[1] === id) delete view.chosen[slot]; });
        view.queue.push(id);
        rematch();
        render();
        work();
    }

    // En extraktion i taget: varje läsning behöver minnet för sina databaser.
    async function work() {
        if (view.working) return;
        view.working = true;
        try {
            while (view.queue.length) await readOne(view.queue.shift());
        } finally { view.working = false; }
    }

    async function readOne(id) {
        var info = view.info[id], log = view.log;
        if (!info || !info.busy || info.started) return;
        info.started = true;
        var current = function () { return view.log === log && view.info[id] === info; };
        try {
            var sql = await loadSql(), steps = Lab.view(log.flow);
            var out = await Read.read(info.file, {
                prefix: log.flow.prefix, width: steps.length ? steps[0].code.length - log.flow.prefix.length : 2, period: Read.period(log.run), SQL: sql,
                onStage: function (text, frac) {
                    if (!current()) return;
                    info.stage = text || '';
                    info.frac = typeof frac === 'number' ? frac : null;
                    paintStage(id);
                },
            });
            // Loggen eller filen byttes medan den lästes: svaret gäller inte längre.
            if (!current()) return;
            info.out = out;
        } catch (err) {
            if (!current()) return;
            info.error = errText(err);
        }
        info.busy = false;
        rematch();
        render();
    }

    function rematch() {
        var L = view.log, evidence = {}, n = 0;
        if (L) L.flow.devices.forEach(function (d) {
            var i = view.info[d.id];
            if (i && i.out) { evidence[d.id] = i.out.evidence; n++; }
        });
        view.result = n ? Trace.match(L.flow, L.run, evidence, { before: view.before, after: view.after, chosen: view.chosen }) : null;
    }

    // Vad som lästes ur varje extraktion, som det står över tabellen i protokollet.
    function fileTexts() {
        var out = {};
        Object.keys(view.info).forEach(function (id) {
            var i = view.info[id];
            if (!i.out) return;
            out[id] = i.file.name + (i.out.platform ? ' (' + i.out.platform + ')' : '') + '. Läst: ' + (i.out.read.join('; ') || 'ingenting') + '.' +
                (i.out.missing.length ? ' Inte läst: ' + i.out.missing.join('; ') + '.' : '');
        });
        return out;
    }

    // ---------- Det som ritas ----------

    function render() {
        renderTop();
        renderMarks();
        renderSheet();
    }

    function renderTop() {
        var L = view.log;
        $('x-log').textContent = L ? logLine() : 'Öppna filen som sparades när laborationen var klar (Spara loggen som fil under 3 Tabell).';
        $('x-log-name').textContent = L ? (L.own ? 'Loggen som finns här i verktyget.' : L.name) : '';
        $('x-log-open').textContent = L ? 'Öppna en annan logg…' : 'Öppna logg…';
        $('x-log-open').className = L ? 'secondary-btn' : 'primary-btn';
        var host = $('x-devices');
        host.textContent = '';
        if (L) L.flow.devices.forEach(function (d) { host.appendChild(deviceCard(d)); });
    }

    function deviceCard(d) {
        var E = T.el, info = view.info[d.id];
        var input = E('input', { type: 'file', accept: '.zip,application/zip,.ufdr', hidden: true, 'data-pick': d.id });
        var pick = E('button', { type: 'button', class: info ? 'secondary-btn' : 'primary-btn', text: info ? 'Byt extraktion…' : 'Välj extraktion…', 'aria-label': (info ? 'Byt' : 'Välj') + ' extraktion för ' + d.name });
        pick.addEventListener('click', function () { input.click(); });
        input.addEventListener('change', function () {
            var file = input.files[0];
            input.value = '';
            if (file) choose(d.id, file);
        });
        var card = E('section', { class: 'trace-card', 'data-device': d.id }, [E('h2', {}, ['2 Extraktion ', E('span', { class: 'chip ' + deviceClass(d.id), text: d.name })])]);
        if (!info) card.appendChild(E('p', { class: 'hint', text: 'Zip-filen med enhetens filer, eller en rapport (UFDR).' }));
        else if (info.busy) {
            card.appendChild(E('p', { class: 'x-file', text: info.file.name }));
            card.appendChild(E('p', { class: 'x-stage', role: 'status', text: info.stage }));
            card.appendChild(E('progress', { class: 'x-bar', max: 1, 'aria-label': 'Läser extraktionen för ' + d.name }));
        } else {
            card.appendChild(E('p', { class: 'x-file', text: info.file.name + (info.out && info.out.platform ? ' (' + info.out.platform + ')' : '') }));
            if (info.error) card.appendChild(E('p', { class: 'miss', text: 'Gick inte att läsa: ' + info.error }));
            if (info.out && info.out.read.length) card.appendChild(E('p', { class: 'x-read', text: 'Läst: ' + info.out.read.join('; ') + '.' }));
            if (info.out && info.out.missing.length) card.appendChild(E('p', { class: 'miss', text: 'Inte läst: ' + info.out.missing.join('; ') + '.' }));
        }
        card.appendChild(pick);
        card.appendChild(input);
        if (info && info.busy) setTimeout(function () { paintStage(d.id); }, 0);
        return card;
    }

    // Bara raden om vad som läses och stapeln ritas om under läsningen.
    function paintStage(id) {
        var info = view.info[id], card = document.querySelector('#x-devices [data-device="' + id + '"]');
        if (!info || !card) return;
        var text = card.querySelector('.x-stage'), bar = card.querySelector('.x-bar');
        if (text) text.textContent = info.stage;
        if (!bar) return;
        if (info.frac === null) bar.removeAttribute('value');
        else bar.value = Math.max(0, Math.min(1, info.frac));
    }

    // Antalet steg per märke. Ett klick visar bara de stegen.
    function renderMarks() {
        var host = $('x-marks'), res = view.result;
        host.textContent = '';
        $('x-tools').classList.toggle('display-none', !res);
        if (!res) return;
        if (view.only && !res.summary[view.only]) view.only = '';
        MARK_ORDER.forEach(function (k) {
            if (!res.summary[k]) return;
            var m = Trace.MARKS[k];
            var b = T.el('button', { type: 'button', class: 'mark-btn mark-' + k, 'aria-pressed': view.only === k ? 'true' : 'false', title: m.hint + ' Klicka för att bara visa de stegen.',
                text: (m.sign ? m.sign + ' ' : '') + res.summary[k] + ' ' + m.word });
            b.addEventListener('click', function () {
                view.only = view.only === k ? '' : k;
                renderMarks();
                renderSheet();
            });
            host.appendChild(b);
        });
        $('x-before').value = String(view.before);
        $('x-after').value = String(view.after);
    }

    function pressText(ms) {
        var text = Trace.secondsText(Math.abs(ms));
        return ms < -499 ? 'tryckt ' + text + ' före' : 'tryckt ' + text + ' efter';
    }

    function renderSheet() {
        var host = $('x-sheet'), L = view.log, res = view.result, E = T.el, top = host.scrollTop;
        host.textContent = '';
        if (!L) return host.appendChild(E('p', { class: 'empty', text: 'Här jämförs en genomförd laboration med det som står i enheterna. Börja med loggen.' }));
        if (!res) {
            return host.appendChild(E('p', { class: 'empty', text: 'Välj extraktionen för varje enhet. Programmet söker sedan varje stegs spår i den: först koden i meddelandets text, i gruppens namn eller i bilden av rutan, sedan tiden. Extraktionen läses bara.' }));
        }
        var facts = E('dl', { class: 'facts' });
        Trace.facts(L.flow, L.run, res, null).forEach(function (f) {
            if (['Tryck efter telefonens tid', 'Telefonens klocka mot datorns'].indexOf(f[0]) < 0) return;
            facts.appendChild(E('dt', { text: f[0] }));
            facts.appendChild(E('dd', { text: f[1] }));
        });
        host.appendChild(facts);
        var body = E('tbody');
        res.rows.forEach(function (r) { if (!view.only || r.mark === view.only) body.appendChild(rowOf(r)); });
        host.appendChild(E('table', { class: 'protocol trace-table' }, [
            E('thead', {}, [E('tr', {}, ['Kod', 'Steg', 'Loggens tid', 'Telefonens tid och källa', 'Märke'].map(function (h) { return E('th', { text: h }); }))]), body,
        ]));
        host.scrollTop = top;
    }

    function rowOf(r) {
        var E = T.el, open = !!view.open[r.id];
        var shown = r.traces.filter(function (t) { return open || t.mark !== 'none' || t.main; });
        var mark = E('td', { class: 'mark-cell' }, [E('span', { class: 'mark mark-' + r.mark, title: Trace.MARKS[r.mark].hint, text: Trace.markText(r.mark) })]);
        if (r.pressedAfter !== null) {
            mark.appendChild(E('div', { class: 'press', title: 'Loggens tid jämförd med telefonens. Telefonens klocka räknas om till datorns när det finns bilder av rutan.', text: pressText(r.pressedAfter) }));
        }
        if (r.traces.length) {
            var more = E('button', { type: 'button', class: 'link-btn', text: open ? 'Mindre' : 'Mer', 'aria-expanded': open ? 'true' : 'false', 'aria-label': (open ? 'Visa mindre om ' : 'Visa mer om ') + r.code });
            more.addEventListener('click', function () { view.open[r.id] = !open; renderSheet(); });
            mark.appendChild(more);
        }
        return E('tr', { class: r.status === 'klar' ? '' : 'undone', 'data-code': r.code, 'data-mark': r.mark }, [
            E('td', { class: 'nowrap code-cell', text: r.code }),
            E('td', {}, [E('div', {}, [E('span', { class: 'chip ' + deviceClass(r.device), text: r.deviceName })]), T.soft('div', {}, r.text)]),
            E('td', { class: 'nowrap', text: r.logT === null ? (r.status === 'hoppad' ? 'hoppad' : '') : (r.approx ? 'ca ' : '') + Lab.timeText(r.logT, r.off) }),
            E('td', {}, shown.map(function (t) { return traceOf(r, t, open); })),
            mark,
        ]);
    }

    // Ett spår: enheten, tiden och vad tiden är, källan, och det som finns att välja på när spåret inte är säkert.
    function traceOf(r, t, open) {
        var E = T.el, box = E('div', { class: 'trace' });
        var line = E('div', { class: 'trace-line' }, [E('span', { class: 'chip ' + deviceClass(t.device), text: t.deviceName })]);
        if (t.mark === 'none') line.appendChild(E('span', { class: 'mark-none', text: 'inte hittad' }));
        else {
            line.appendChild(E('b', { class: 'nowrap', text: Trace.traceTime(t, r.off) }));
            line.appendChild(E('span', { text: t.what + (t.mark === 'sure' || t.mark === r.mark ? '' : ' (' + Trace.MARKS[t.mark].word + ')') }));
        }
        box.appendChild(line);
        var choosing = !!t.options && (t.mark === 'many' || t.mark === 'chosen' || open);
        if (t.thumb && !choosing) box.appendChild(E('img', { class: 'trace-thumb', src: t.thumb, alt: 'Bilden ur enhetens bibliotek' }));
        if (t.source) box.appendChild(sourceOf(r, t));
        if (choosing) box.appendChild(optionsOf(r, t));
        if (!open) return box;
        var more = [];
        (t.times || []).forEach(function (x) { more.push((x.label || x.key) + ': ' + Lab.dateText(x.ms, r.off) + ' ' + Lab.timeText(x.ms, r.off) + (x.col ? ' · ' + x.col : '')); });
        if (t.qr) more.push('QR-koden i bilden: ' + t.qr.code + ' ' + Lab.timeText(t.qr.t, r.off) + ' på datorns klocka');
        if (t.more) more.push('Koden står i ' + (t.more + 1) + ' meddelanden. Det första visas.');
        if (t.notWhen) more.push('Tiden säger inte när steget gjordes.');
        if (more.length) box.appendChild(E('div', { class: 'trace-more' }, more.map(function (text) { return E('div', { text: text }); })));
        return box;
    }

    // Källan: databasen och kolumnen som tiden står i. I programmet öppnar den raden i Queries.
    function sourceOf(r, t) {
        var ref = t.item && t.item.ref, info = view.info[t.device];
        if (!inHub || !ref || !ref.query || !info || !info.file) return T.el('div', { class: 'trace-source', text: t.source });
        var b = T.el('button', { type: 'button', class: 'link-btn src-btn', text: t.source, title: 'Visa raden i Queries', 'aria-label': 'Visa källan till ' + r.code + ' på ' + t.deviceName + ' i Queries: ' + t.source });
        b.addEventListener('click', function () {
            var q = ref.query;
            window.parent.postMessage({
                source: 'forensics-toolbox', type: 'open-query', file: info.file, path: q.path, walPath: q.walPath, queryId: q.queryId, title: q.title + ': ' + r.code, db: q.db, sql: q.sql,
                from: 'Laboration', timeColumns: q.timeColumns || null,
                mark: { ms: [t.ms], values: ref.id === null || ref.id === undefined ? [] : [String(ref.id)], text: r.code + ' ' + t.what, time: Lab.timeText(t.ms, r.off) },
            }, '*');
        });
        return b;
    }

    function optionsOf(r, t) {
        var E = T.el, picked = t.mark === 'chosen';
        var box = E('div', { class: 'opts', role: 'group', 'aria-label': 'Möjliga spår för ' + r.code + ' på ' + t.deviceName }, [
            E('span', { class: 'opts-label', text: picked ? 'Valt bland ' + t.options.length + ':' : t.options.length + ' möjliga, välj det rätta:' }),
        ]);
        t.options.forEach(function (o) {
            var on = o.key === t.key, time = Lab.timeText(o.ms, r.off) + (o.endMs ? '–' + Lab.timeText(o.endMs, r.off) : '');
            var b = E('button', { type: 'button', class: 'opt' + (on && !picked ? ' proposed' : ''), 'aria-pressed': on && picked ? 'true' : 'false',
                title: o.what + (on ? picked ? '. Klicka för att ta bort valet.' : '. Programmets förslag: klicka för att välja det.' : ''), 'aria-label': time + ' ' + o.what },
            [o.thumb ? E('img', { src: o.thumb, alt: '' }) : null, E('span', { text: time })]);
            b.addEventListener('click', function () {
                if (view.chosen[t.slot] === o.key) delete view.chosen[t.slot];
                else view.chosen[t.slot] = o.key;
                rematch();
                renderMarks();
                renderSheet();
            });
            box.appendChild(b);
        });
        return box;
    }

    // ---------- Det som lämnar vyn ----------

    function parts() { return Trace.protocol(view.log.flow, view.log.run, view.result, fileTexts(), T.PROGRAM); }

    function setWindow(input, key) {
        var n = Math.round(Number(input.value));
        if (!isFinite(n) || n < 0) n = key === 'before' ? 180 : 60;
        view[key] = Math.min(n, WINDOW_MAX);
        input.value = String(view[key]);
        rematch();
        renderMarks();
        renderSheet();
    }

    function init(tools) {
        T = tools;
        $('x-log-open').addEventListener('click', function () { $('x-log-file').click(); });
        $('x-log-file').addEventListener('change', function () { var file = this.files[0]; this.value = ''; openLog(file); });
        $('x-before').addEventListener('change', function () { setWindow(this, 'before'); });
        $('x-after').addEventListener('change', function () { setWindow(this, 'after'); });
        $('x-copy').addEventListener('click', function () {
            if (!view.result) return;
            var p = parts();
            T.copyHtml(p.html, p.text).then(function (ok) { say('x-status', ok ? 'Tabellen är kopierad. Klistra in den i protokollet.' : 'Det gick inte att kopiera. Skriv ut eller spara som CSV i stället.'); });
        });
        $('x-print').addEventListener('click', function () { if (view.result) T.printDoc('Laborationens spår: ' + view.log.flow.name, parts().html); });
        $('x-csv').addEventListener('click', function () {
            if (!view.result) return;
            // Teckenmärket först gör att Excel läser å, ä och ö rätt.
            say('x-status', 'Sparade ' + T.download(String.fromCharCode(0xFEFF) + Trace.toCsv(view.result), 'text/csv;charset=utf-8', Lab.fileName(view.log.flow, view.log.run, 'csv').replace(/\.csv$/, '-spår.csv')));
        });
    }

    window.LabTraceView = { init: init, enter: enter };
})();
