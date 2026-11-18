// Laboration. Startsidan har en sökruta bland flödena (de färdiga, de egna mallarna och de senast genomförda), ett
// tomt flöde, guiden Bygg från delar och inläsningen av en genomförd laboration.
// En ny laboration är tre vyer över samma flöde: Förbered bygger stegen, Genomför visar ett steg i taget med
// datorns klocka och loggar trycken, Tabell visar loggen som den ska stå i protokollet. Allt räknande görs i
// lab-core.js. En genomförd laboration läses in i trace-view.js, som jämför loggen med enheternas extraktioner.
// Flödet och loggen sparas i webbläsarens lagring efter varje ändring, så att en omstart inte tappar något.
// De egna mallarna sparas för sig, så att de finns kvar när flödet byts eller töms.
(function () {
    'use strict';

    var Lab = window.LabCore;
    var VERSION = new URLSearchParams(location.search).get('version') || '';
    var PROGRAM = 'Forensics Toolbox' + (VERSION ? ' ' + VERSION : '');
    var STORE = 'ft-laboration';
    var TEMPLATE_STORE = 'ft-laboration-mallar';
    var DEFAULT_BLOCKS = ['clock-start', 'chat-text', 'chat-media', 'chat-group', 'chat-delete', 'camera', 'lock-power', 'clock-end'];
    var ZONE = '';
    try { ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { ZONE = ''; }

    // sel: det valda i Förbered, { step } eller { group }; nästa byggsten hamnar efter det. typing: ett fält till
    // höger skrivs i, och det är en ändring för Ångra tills fokus lämnar det. devEdit: enheten vars namn ändras.
    // history: flödet före varje ändring, för Ångra. templates: de egna mallarna. recent: de senast genomförda
    // flödena. closed: grupper vars steg är dolda. q, filter, cards och preview: startsidans sökning, val, kort
    // och förhandsvisning. wiz: guiden. note: klockan när A trycktes. remark: raden vars anmärkning ändras i
    // tabellen. practice: antal övningstryck före start. shot: koden som står i rutan att fotografera medan ett
    // steg pågår, och qr: texten i QR-koden som är ritad.
    var state = { flow: null, run: null, setup: null, view: 'start', sel: null, typing: false, devEdit: null, keepFocus: false, moreOpen: false, history: [], templates: [], recent: [], closed: {}, palClosed: {},
        q: '', filter: 'alla', cards: [], preview: null, wiz: null, flash: null, focus: null, said: '',
        note: null, remark: '', practice: 0, practiceAt: null, toast: '', wasWaiting: false, stored: true, justDone: false, savedLog: false, copied: false, shot: '', qr: '' };

    function $(id) { return document.getElementById(id); }

    function el(tag, props, kids) {
        var node = document.createElement(tag);
        Object.keys(props || {}).forEach(function (k) {
            if (k === 'text') node.textContent = props[k];
            else if (k === 'class') node.className = props[k];
            else if (k === 'list' || k.indexOf('-') > 0 || !(k in node)) node.setAttribute(k, props[k]);
            else node[k] = props[k];
        });
        (kids || []).forEach(function (kid) { if (kid) node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid); });
        return node;
    }

    // Text i en tabellcell: ett mycket långt ord får brytas, så att tabellen håller sig inom sidan.
    function soft(tag, props, text) {
        var node = el(tag, props);
        Lab.softParts(text).forEach(function (part, n) {
            if (n) node.appendChild(document.createElement('wbr'));
            node.appendChild(document.createTextNode(part));
        });
        return node;
    }

    function minutes(seconds) { return Math.round(seconds / 60); }
    function sizeText(e) { return e.steps + ' steg, ungefär ' + Math.ceil(e.totalS / 60) + ' minuter varav ' + minutes(e.waitS) + ' minuter väntan'; }
    function deviceClass(id) {
        var n = state.flow.devices.findIndex(function (d) { return d.id === id; });
        return n < 0 ? 'dev-all' : 'dev-' + (n % 4);
    }

    // ---------- Lagringen ----------

    function fresh() {
        var now = Lab.clockNow();
        state.flow = Lab.emptyFlow('Laboration ' + Lab.dateText(now.t, now.off), 'L', ['Telefon 1', 'Telefon 2']);
        state.run = null;
        state.setup = cleanSetup(null);
    }

    function cleanSetup(s) {
        s = s || {};
        var ids = Lab.BLOCKS.map(function (b) { return b.id; });
        var pair = Array.isArray(s.pair) ? s.pair.map(function (n) { return Number(n) >= 0 ? Math.floor(Number(n)) : 0; }) : [0, 1];
        var apps = s.apps ? Lab.cleanApps(s.apps) : ['WhatsApp', 'Signal'];
        return {
            pair: [pair[0] || 0, pair.length > 1 ? pair[1] : 1],
            // app: appen som ett chattsteg eller en chattmall ur byggstenarna görs i.
            app: Lab.cleanApps([s.app])[0] || apps[0] || Lab.APPS[0],
            apps: apps,
            extra: Lab.cleanApps(s.extra),
            blocks: (Array.isArray(s.blocks) ? s.blocks : DEFAULT_BLOCKS).filter(function (id) { return ids.indexOf(id) >= 0; }),
        };
    }

    function save() {
        try {
            localStorage.setItem(STORE, JSON.stringify({ file: Lab.toFile(state.flow, state.run, PROGRAM, Lab.clockNow(), state.templates), setup: state.setup }));
            state.stored = true;
        } catch (e) { state.stored = false; }
    }

    // De egna mallarna ligger under en egen nyckel, i samma form som filen med mallar.
    function saveTemplates() {
        try {
            localStorage.setItem(TEMPLATE_STORE, JSON.stringify(Lab.templatesToFile(state.templates, PROGRAM, Lab.clockNow())));
            return true;
        } catch (e) { return false; }
    }

    function loadTemplates() {
        try {
            var o = JSON.parse(localStorage.getItem(TEMPLATE_STORE) || 'null');
            state.templates = o ? Lab.mergeTemplates([], o.mallar).list : [];
        } catch (e) { state.templates = []; }
    }

    // Mallar ur en fil läggs till datorns. En mall som fick ett nytt id får det också i flödets grupper.
    function takeTemplates(list, flow) {
        var merged = Lab.mergeTemplates(state.templates, list);
        state.templates = merged.list;
        if (flow) flow.groups.forEach(function (g) { if (merged.renamed[g.template]) g.template = merged.renamed[g.template]; });
        if (merged.added) saveTemplates();
        return merged.added;
    }

    // Det sparade läses som en fil från någon annan: samma kontroller, och ett trasigt innehåll ger ett tomt flöde.
    function restore() {
        try {
            var o = JSON.parse(localStorage.getItem(STORE) || 'null');
            if (!o) return false;
            var back = Lab.fromFile(JSON.stringify(o.file));
            state.flow = back.flow;
            state.run = back.run;
            state.setup = cleanSetup(o.setup);
            return true;
        } catch (e) { return false; }
    }

    function changed() { save(); render(); }

    // ---------- Vyerna ----------

    var VIEWS = ['start', 'wizard', 'plan', 'run', 'table', 'trace'];

    function show(view) {
        if (view !== 'table') state.justDone = false;
        state.view = view;
        VIEWS.forEach(function (v) { $('view-' + v).classList.toggle('display-none', v !== view); });
        ['plan', 'run', 'table'].forEach(function (v) {
            $('tab-' + v).classList.toggle('active', v === view);
            $('tab-' + v).setAttribute('aria-selected', v === view ? 'true' : 'false');
        });
        // De tre flikarna hör till laborationen i verktyget. De står kvar i alla vyer så länge den finns, så att det
        // alltid går att komma tillbaka till den. Utanför dess egna vyer står namnet före flikarna.
        var own = view === 'plan' || view === 'run' || view === 'table', any = !!state.run || state.flow.steps.length > 0;
        $('tabs').classList.toggle('display-none', !own && !any);
        $('tabs-name').classList.toggle('display-none', own || !any);
        $('tabs-name').textContent = labLabel() + ': ' + state.flow.name;
        $('tabs-name').title = $('tabs-name').textContent;
        // Knappen till startsidan står alltid på samma plats. På startsidan är den markerad.
        $('nav-start').classList.toggle('on', view === 'start');
        if (view === 'start') $('nav-start').setAttribute('aria-current', 'page'); else $('nav-start').removeAttribute('aria-current');
        closeMenu();
        closePreview();
        dropFocus();
        if (view === 'run') { try { window.focus(); } catch (e) { /* ramen får fokus när användaren klickar */ } }
        render();
    }

    function render() {
        if (state.view === 'start') renderStart();
        else if (state.view === 'wizard') renderWizard();
        else if (state.view === 'plan') renderPlan();
        else if (state.view === 'run') renderRun();
        else if (state.view === 'table') renderTable();
        else window.LabTraceView.enter(state.flow, state.run);
    }

    // En knapp som behåller fokus skulle ta nästa mellanslag som ett klick på sig själv.
    function dropFocus() {
        var a = document.activeElement;
        if (a && a.tagName === 'BUTTON') a.blur();
    }

    function status(id, text) { $(id).textContent = text || ''; }
    function today() { var now = Lab.clockNow(); return Lab.dateText(now.t, now.off); }
    function copyOf(flow) { return JSON.parse(JSON.stringify(flow)); }

    // Fältet med data-focus = state.focus får fokus när det har ritats.
    function applyFocus() {
        if (!state.focus) return;
        var f = document.querySelector('[data-focus="' + state.focus + '"]');
        state.focus = null;
        if (f) { f.focus(); if (f.select && f.tagName === 'INPUT') f.select(); }
    }

    // Flödet ersätts av ett annat. Det som finns här ersätts bara om användaren säger ja.
    function mayReplace() {
        if (state.run) return confirm('Laborationen som finns här, med sin logg, tas bort och ersätts. Spara loggen som fil under 3 Tabell först om du vill ha den kvar. Fortsätta?');
        if (state.flow.steps.length) return confirm('Flödet som finns nu, ' + state.flow.name + ' med ' + state.flow.steps.length + ' steg, ersätts. Fortsätta?');
        return true;
    }
    function useFlow(flow, said) {
        if (!mayReplace()) return false;
        state.flow = flow;
        state.run = null;
        state.history = [];
        state.sel = null;
        state.closed = {};
        state.flash = null;
        state.remark = '';
        save();
        show('plan');
        say(said || '');
        return true;
    }

    // Vad laborationen i verktyget är: pågår, klar eller ett flöde som inte har börjat.
    function labLabel() {
        return !state.run ? 'Flödet' : Lab.isDone(state.flow, state.run) ? 'Klar' : 'Pågår';
    }

    // ---------- Startsidan ----------

    var RECENT_STORE = 'ft-laboration-senaste';
    var FILTERS = [['alla', 'Alla'], ['ready', 'Färdiga'], ['own', 'Mina mallar'], ['recent', 'Senaste']];
    var KIND_TEXT = { ready: 'Färdigt', own: 'Egen mall', recent: 'Senaste' };
    var TOOL_APPS = ['Kamera', 'Bilder', 'Inställningar'];

    // De senaste flödena som har genomförts, som filer utan logg. De läses som en fil från någon annan.
    function loadRecent() {
        try {
            var list = JSON.parse(localStorage.getItem(RECENT_STORE) || '[]');
            state.recent = (Array.isArray(list) ? list : []).slice(0, 6).map(function (x) {
                try { return { at: Lab.clip(x.at, 20), flow: Lab.fromFile(JSON.stringify(x.file)).flow }; } catch (e) { return null; }
            }).filter(Boolean);
        } catch (e) { state.recent = []; }
    }
    function sameFlow(a, b) {
        var sig = function (f) { return f.name + '|' + f.devices.length + '|' + f.steps.map(function (s) { return s.action + ' ' + s.do + ' ' + s.app; }).join('|'); };
        return sig(a) === sig(b);
    }
    function rememberRecent(flow) {
        var copy = copyOf(flow);
        state.recent = [{ at: today(), flow: copy }].concat(state.recent.filter(function (r) { return !sameFlow(r.flow, copy); })).slice(0, 6);
        try {
            localStorage.setItem(RECENT_STORE, JSON.stringify(state.recent.map(function (r) { return { at: r.at, file: Lab.toFile(copyOf(r.flow), null, PROGRAM, Lab.clockNow(), []) }; })));
        } catch (e) { /* listan finns kvar tills verktyget stängs */ }
    }

    // Korten på startsidan: de senaste flödena, de egna mallarna och de färdiga flödena. flow byggs på nytt varje
    // gång, så att ett kort aldrig delar något med flödet i verktyget.
    function catalog() {
        var out = [];
        state.recent.forEach(function (r, n) { out.push({ key: 'recent-' + n, kind: 'recent', label: r.flow.name, desc: 'Startad ' + r.at + '.', at: r.at, flow: copyOf(r.flow) }); });
        state.templates.forEach(function (t) {
            var flow = Lab.emptyFlow(t.label, 'L', ['Telefon 1', 'Telefon 2']), ids = flow.devices.map(function (d) { return d.id; });
            Lab.insertTemplate(flow, t, { a: ids[0], b: ids[1], app: state.setup.app });
            out.push({ key: 'own-' + t.id, kind: 'own', label: t.label, desc: t.desc || 'Egen mall, sparad på den här datorn.', tpl: t, flow: flow });
        });
        Lab.READY.forEach(function (r) { out.push({ key: 'ready-' + r.id, kind: 'ready', label: r.label, desc: r.desc, flow: Lab.readyFlow(r.id, r.label + ' ' + today()) }); });
        return out;
    }
    function appsOf(flow) {
        return Lab.cleanApps(flow.steps.filter(function (s) { return s.app && TOOL_APPS.indexOf(s.app) < 0; }).map(function (s) { return s.app; }));
    }
    function hits(item, words) {
        if (!words.length) return true;
        var f = item.flow;
        var hay = [item.label, item.desc].concat(appsOf(f), f.groups.map(function (g) { return g.title; }), f.steps.map(function (s) { return (Lab.ACTION[s.action] || {}).label + ' ' + s.do; })).join(' ').toLowerCase();
        return words.every(function (w) { return hay.indexOf(w) >= 0; });
    }

    function renderStart() {
        var words = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean), all = catalog();
        var found = all.filter(function (x) { return hits(x, words); });
        var shown = found.filter(function (x) { return state.filter === 'alla' || x.kind === state.filter; });
        state.cards = all;

        var filters = $('s-filters');
        filters.textContent = '';
        FILTERS.forEach(function (f) {
            var n = f[0] === 'alla' ? found.length : found.filter(function (x) { return x.kind === f[0]; }).length;
            var b = el('button', { type: 'button', class: 'filter', 'aria-pressed': state.filter === f[0] ? 'true' : 'false', 'data-filter': f[0] }, [f[1], el('span', { text: String(n) })]);
            b.addEventListener('click', function () { state.filter = f[0]; renderStart(); });
            filters.appendChild(b);
        });

        // Det som redan finns i verktyget står först, så att det går att fortsätta där man var.
        var flow = state.flow, run = state.run, n = flow.steps.length, current = $('s-current');
        current.classList.toggle('display-none', !run && !n);
        current.classList.toggle('running', !!run && !Lab.isDone(flow, run));
        $('s-resume-title').textContent = labLabel() + ': ' + flow.name;
        if (run && !Lab.isDone(flow, run)) {
            $('s-resume-desc').textContent = run.entries.length + ' av ' + n + ' steg är gjorda. Loggen ligger kvar tills du avbryter laborationen eller börjar en ny.';
            $('s-resume').textContent = 'Fortsätt laborationen';
        } else if (run) {
            $('s-resume-desc').textContent = 'Laborationen är gjord. Tabellen och loggen finns kvar.';
            $('s-resume').textContent = 'Visa tabellen';
        } else {
            $('s-resume-desc').textContent = n + ' steg, inte påbörjat.';
            $('s-resume').textContent = 'Fortsätt i Förbered';
        }

        $('s-an-note').textContent = run && run.entries.length ? 'Loggen från ' + flow.name + ' finns redan här, med ' + run.entries.length + ' av ' + n + ' steg.' : '';
        $('s-count').textContent = words.length ? shown.length + (shown.length === 1 ? ' flöde' : ' flöden') + ' för ”' + state.q.trim() + '”' : 'Flöden att utgå från';
        var host = $('s-flows');
        host.textContent = '';
        shown.forEach(function (x) {
            var e = Lab.estimate(x.flow), apps = appsOf(x.flow);
            var meta = el('span', { class: 'card-meta' }, [e.steps + ' steg · ungefär ' + Math.max(1, Math.ceil(e.totalS / 60)) + ' min · ' + x.flow.devices.length + (x.flow.devices.length === 1 ? ' enhet' : ' enheter')]);
            apps.forEach(function (a) { meta.appendChild(el('span', { class: 'tag', text: a })); });
            var card = el('button', { type: 'button', class: 'flow-card', 'data-key': x.key }, [
                el('span', { class: 'card-top' }, [el('span', { class: 'card-name', text: x.label }), el('span', { class: 'card-kind kind-' + x.kind, text: KIND_TEXT[x.kind] })]),
                el('span', { class: 'card-desc', text: x.desc }), meta,
            ]);
            card.addEventListener('click', function () { openPreview(x.key); });
            host.appendChild(card);
        });
        if (!shown.length) {
            var none = el('p', { class: 'no-hits' }, [words.length ? 'Inget flöde matchar. Prova ett annat ord, eller börja med ett tomt flöde.' :
                state.filter === 'own' ? 'Här hamnar grupper och steg som du sparar som mall i Förbered.' : 'Här hamnar flödena du har genomfört.']);
            host.appendChild(none);
        }
    }

    // Förhandsvisningen: flödets steg innan det används.
    function openPreview(key) {
        var x = (state.cards || []).filter(function (c) { return c.key === key; })[0];
        if (!x) return;
        state.preview = x;
        var e = Lab.estimate(x.flow);
        $('s-pv-title').textContent = x.label;
        $('s-pv-desc').textContent = x.desc;
        $('s-pv-meta').textContent = e.steps + ' steg, ungefär ' + Math.max(1, Math.ceil(e.totalS / 60)) + ' minuter' + (e.waitS ? ' varav ' + Math.round(e.waitS / 60) + ' minuter väntan' : '') + '. ' +
            x.flow.devices.map(function (d) { return d.name; }).join(', ') + '.';
        $('s-pv-drop').classList.toggle('display-none', x.kind !== 'own');
        // Ett nytt flöde ersätter laborationen i verktyget. Det ska synas innan knappen trycks, inte bara i frågan.
        var busy = state.run && !Lab.isDone(state.flow, state.run);
        $('s-pv-note').classList.toggle('display-none', !state.run);
        $('s-pv-note').textContent = !state.run ? '' : busy ? 'Laborationen ' + state.flow.name + ' pågår här. Använd flödet ersätter den och dess logg. Gå tillbaka till den med Fortsätt laborationen på startsidan, eller med flikarna högst upp.' :
            'Laborationen ' + state.flow.name + ' och dess logg ersätts. Spara loggen som fil under 3 Tabell först om du vill ha den kvar.';
        var host = $('s-pv-steps');
        host.textContent = '';
        Lab.outline(x.flow).forEach(function (g) {
            host.appendChild(el('p', { class: 'pv-group', text: g.title }));
            g.steps.forEach(function (s) {
                host.appendChild(el('div', { class: 'pv-step' }, [el('b', { text: s.code }), el('span', {}, [el('span', { class: 'chip ' + deviceClassIn(x.flow, s.device), text: s.deviceName }), ' ' + s.do])]));
            });
        });
        $('s-preview').classList.remove('display-none');
        $('s-use').focus();
    }
    function closePreview() {
        state.preview = null;
        $('s-preview').classList.add('display-none');
    }
    function deviceClassIn(flow, id) {
        var n = flow.devices.findIndex(function (d) { return d.id === id; });
        return n < 0 ? 'dev-all' : 'dev-' + (n % 4);
    }
    function usePreview() {
        var x = state.preview;
        if (!x) return;
        var flow = copyOf(x.flow);
        if (x.kind === 'own') flow.name = x.label + ' ' + today();
        closePreview();
        useFlow(flow, x.kind === 'recent' ? 'Samma flöde som ' + x.at + '. Ändra fritt innan du genomför det.' : 'Flödet är ditt. Ändra, flytta och lägg till steg fritt.');
    }

    // ---------- Guiden: Bygg från delar ----------

    var WIZ = ['Enheter', 'Appar', 'Delar'];

    function allApps() { return Lab.cleanApps(Lab.APPS.concat(state.setup.extra)); }
    function chosenApps() { return allApps().filter(function (a) { return state.setup.apps.indexOf(a) >= 0; }); }
    function wizNames() { return state.wiz.devices.map(function (n, i) { return Lab.clip(n, Lab.LIMITS.name).trim() || 'Enhet ' + (i + 1); }); }
    function spec() {
        var names = wizNames(), pair = state.setup.pair.map(function (p) { return Math.min(p, names.length - 1); });
        if (pair[0] === pair[1]) pair = [0, 1];
        return { name: 'Laboration ' + today(), prefix: 'L', devices: names, pair: pair, apps: names.length > 1 ? chosenApps() : [], blocks: state.setup.blocks };
    }

    function tick(checked, label, desc, disabled, onChange) {
        var box = el('input', { type: 'checkbox', checked: checked, disabled: disabled });
        box.addEventListener('change', function () { onChange(box.checked); });
        return el('label', { class: 'tick' + (disabled ? ' off' : '') }, [box, el('span', {}, [el('span', { class: 'tick-label', text: label }), desc ? el('span', { class: 'tick-desc', text: desc }) : null])]);
    }

    function toggle(list, value, on) {
        var at = list.indexOf(value);
        if (on && at < 0) list.push(value);
        if (!on && at >= 0) list.splice(at, 1);
    }

    function openWizard() {
        state.wiz = { step: 0, devices: ['Telefon 1', 'Telefon 2'] };
        show('wizard');
    }

    function renderWizard() {
        var w = state.wiz, body = $('w-body'), two = w.devices.length > 1;
        var nav = $('w-steps');
        nav.textContent = '';
        WIZ.forEach(function (t, i) { nav.appendChild(el('li', { class: i === w.step ? 'on' : i < w.step ? 'done' : '', text: (i + 1) + ' ' + t })); });
        body.textContent = '';
        if (w.step === 0) {
            body.appendChild(el('h3', { text: 'Vilka enheter är med?' }));
            body.appendChild(el('p', { class: 'hint', text: 'Namnen står på varje steg, så att det syns vilken enhet du ska ta i. De går att ändra efteråt.' }));
            w.devices.forEach(function (name, i) {
                var input = el('input', { type: 'text', value: name, maxLength: Lab.LIMITS.name, autocomplete: 'off', 'aria-label': 'Enhet ' + (i + 1), 'data-focus': 'w-dev-' + i });
                input.addEventListener('input', function () { w.devices[i] = input.value; renderWizardPreview(); });
                var remove = button('icon-btn', '−', 'Ta bort enheten', function () { w.devices.splice(i, 1); renderWizard(); }, 'Ta bort enhet ' + (i + 1));
                remove.disabled = w.devices.length < 2;
                body.appendChild(el('div', { class: 'wiz-dev' }, [el('span', { class: 'dot dev-' + (i % 4) }), input, remove]));
            });
            var add = button('secondary-btn', 'Lägg till enhet', 'En enhet till', function () { w.devices.push('Telefon ' + (w.devices.length + 1)); state.focus = 'w-dev-' + (w.devices.length - 1); renderWizard(); });
            add.disabled = w.devices.length >= Lab.LIMITS.devices;
            body.appendChild(el('div', { class: 'inline' }, [add]));
        } else if (w.step === 1) {
            body.appendChild(el('h3', { text: 'Vilka appar ska ni chatta i?' }));
            body.appendChild(el('p', { class: 'hint', text: two ? 'Chattstegen görs en gång i varje app du väljer. Välj ingen om laborationen inte har någon chatt.' : 'En chatt behöver två enheter. Gå tillbaka och lägg till en till, eller fortsätt utan chatt.' }));
            var ticks = el('div', { class: 'ticks', id: 'w-apps' });
            allApps().forEach(function (app) {
                ticks.appendChild(tick(state.setup.apps.indexOf(app) >= 0, app, '', !two, function (on) { toggle(state.setup.apps, app, on); save(); renderWizardPreview(); }));
            });
            body.appendChild(ticks);
            var own = el('input', { type: 'text', maxLength: Lab.LIMITS.name, placeholder: 'Annan app', autocomplete: 'off', 'aria-label': 'Annan app', disabled: !two });
            var addApp = function () {
                var name = Lab.cleanApps([own.value])[0];
                if (!name) return;
                var known = allApps().filter(function (a) { return a.toLowerCase() === name.toLowerCase(); })[0];
                if (!known) state.setup.extra.push(name);
                toggle(state.setup.apps, known || name, true);
                save();
                renderWizard();
            };
            own.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addApp(); } });
            var addBtn = button('secondary-btn', 'Lägg till', 'Lägg till appen', addApp);
            addBtn.disabled = !two;
            body.appendChild(el('div', { class: 'inline wiz-dev' }, [own, addBtn]));
            if (w.devices.length > 2) {
                var names = wizNames();
                var pick = function (side) {
                    var select = el('select', { 'aria-label': side ? 'Den andra enheten i chattarna' : 'Den första enheten i chattarna' });
                    names.forEach(function (n, i) { select.appendChild(el('option', { value: String(i), text: n })); });
                    select.value = String(Math.min(state.setup.pair[side], names.length - 1));
                    select.addEventListener('change', function () {
                        var v = Number(select.value) || 0, pair = state.setup.pair;
                        if (v === pair[1 - side]) pair[1 - side] = pair[side];
                        pair[side] = v;
                        save();
                        renderWizard();
                    });
                    return select;
                };
                body.appendChild(el('div', { class: 'inline wrap' }, [el('span', { class: 'field', text: 'Chattarna går mellan' }), pick(0), el('span', { class: 'field', text: 'och' }), pick(1)]));
            }
        } else {
            body.appendChild(el('h3', { text: 'Vad ska laborationen visa?' }));
            body.appendChild(el('p', { class: 'hint', text: 'Delarna läggs efter varandra i den här ordningen, och chattarna görs app för app. Allt går att ändra, flytta och ta bort efteråt.' }));
            var parts = el('div', { class: 'ticks', id: 'w-blocks' }), kind = null, chat = two && chosenApps().length > 0;
            Lab.BLOCKS.forEach(function (b) {
                if ((b.kind || '') !== kind && b.id !== 'clock-start') {
                    kind = b.kind || '';
                    parts.appendChild(el('p', { class: 'tick-head', text: kind === 'chat' ? 'I varje vald app' : 'På enheterna' }));
                }
                var off = b.kind === 'chat' && !chat;
                parts.appendChild(tick(state.setup.blocks.indexOf(b.id) >= 0 && !off, b.label, off ? (two ? 'Välj en app i steget före.' : 'Kräver två enheter.') : b.desc, off, function (on) { toggle(state.setup.blocks, b.id, on); save(); renderWizardPreview(); }));
            });
            body.appendChild(parts);
        }
        $('w-prev').disabled = w.step === 0;
        $('w-next').classList.toggle('display-none', w.step === WIZ.length - 1);
        $('w-create').classList.toggle('display-none', w.step !== WIZ.length - 1);
        renderWizardPreview();
        applyFocus();
    }
    function renderWizardPreview() {
        var e = Lab.estimate(Lab.buildFlow(spec()));
        $('w-preview').textContent = state.wiz.step < WIZ.length - 1 ? '' : e.steps ? 'Valet ger ' + sizeText(e) + '.' : 'Valet ger inga steg. Kryssa för minst en del.';
        $('w-create').disabled = !e.steps;
    }
    function createFromWizard() {
        var next = Lab.buildFlow(spec());
        if (!next.steps.length) return;
        useFlow(next, next.steps.length + ' steg skapades. Klicka på ett steg för att ändra det.');
    }

    // ---------- Förbered: det valda och märket ----------

    function groupIndex(id) { return state.flow.groups.findIndex(function (g) { return g.id === id; }); }
    function groupSteps(id) { return state.flow.steps.filter(function (s) { return s.group === id; }); }
    function stepById(id) { return state.flow.steps.filter(function (s) { return s.id === id; })[0] || null; }

    // Det valda är { step } eller { group }. Ett val som inte längre finns i flödet gäller inte.
    function selected() {
        var s = state.sel;
        if (s && s.step && stepById(s.step)) return s;
        if (s && s.group && groupIndex(s.group) >= 0) return s;
        return null;
    }
    function select(sel) {
        state.sel = sel;
        state.typing = false;
        renderSteps();
        renderDetail();
    }

    // Märket är platsen där nästa byggsten hamnar: efter det valda steget, sist i den valda gruppen, annars sist.
    // whole: det som läggs in är en hel grupp, och den hamnar efter gruppen där märket står.
    function mark(whole) {
        var sel = selected();
        if (sel && sel.step) {
            var s = stepById(sel.step);
            return whole ? { at: groupIndex(s.group) + 1 } : { group: s.group, pos: groupSteps(s.group).indexOf(s) + 1 };
        }
        if (sel && sel.group) return whole ? { at: groupIndex(sel.group) + 1 } : { group: sel.group, pos: groupSteps(sel.group).length };
        return { at: state.flow.groups.length };
    }

    function renderWhere() {
        var host = $('p-where'), sel = selected(), flow = state.flow;
        host.textContent = '';
        if (state.run) return host.appendChild(document.createTextNode('Flödet är låst under genomförandet.'));
        if (!flow.steps.length && !flow.groups.length) return host.appendChild(document.createTextNode('Nästa byggsten hamnar först i flödet.'));
        if (!sel) return host.appendChild(document.createTextNode('Nästa byggsten hamnar sist. Välj ett steg för att lägga in efter det.'));
        var code = sel.step ? (Lab.view(flow).filter(function (v) { return v.id === sel.step; })[0] || {}).code : '';
        var g = flow.groups[groupIndex(sel.step ? stepById(sel.step).group : sel.group)];
        host.appendChild(document.createTextNode('Nästa byggsten hamnar '));
        host.appendChild(el('b', { text: sel.step ? 'efter ' + code : 'sist i ' + g.title }));
        host.appendChild(document.createTextNode('. '));
        host.appendChild(button('link-btn', 'Sist i stället', 'Lägg nästa byggsten sist i flödet', function () { select(null); }));
    }

    function say(text) {
        state.said = text || '';
        $('p-note').textContent = state.said;
    }

    function remember() {
        state.history.push(JSON.stringify(state.flow));
        if (state.history.length > 50) state.history.shift();
    }

    // En ändring i flödet: läget före sparas för Ångra, och sidan ritas om. fn svarar false om inget ändrades.
    function change(fn) {
        if (state.run) return;
        remember();
        say('');
        state.typing = false;
        if (fn() === false) state.history.pop();
        changed();
    }

    function undo() {
        if (state.run || !state.history.length) return;
        state.flow = JSON.parse(state.history.pop());
        state.typing = false;
        say('Den senaste ändringen togs tillbaka.');
        changed();
    }

    // Platsen för ett steg. Mellan två grupper hamnar steget sist i gruppen ovanför, och allra överst i en ny grupp.
    function stepPlace(t) {
        if (t.group) return { group: t.group, pos: t.pos };
        var g = state.flow.groups[t.at - 1] || Lab.addGroup(state.flow, { title: 'Egna steg' }, 0);
        return g ? { group: g.id, pos: groupSteps(g.id).length } : null;
    }

    // Steget som står närmast före en plats, i hela flödets ordning.
    function stepBefore(t) {
        var flow = state.flow, at = t.group ? groupIndex(t.group) : t.at, n = 0;
        flow.groups.slice(0, at).forEach(function (g) { n += groupSteps(g.id).length; });
        return flow.steps[n + (t.group ? t.pos : 0) - 1] || null;
    }

    // De två enheter och den app som en ny chattmall eller ett nytt chattsteg får: gruppens där märket står,
    // annars de två första enheterna och appen som det chattades i senast.
    function context(t) {
        var flow = state.flow, ids = flow.devices.map(function (d) { return d.id; });
        var gid = t.group || (flow.groups[t.at - 1] || {}).id;
        var g = Lab.outline(flow).filter(function (x) { return x.id === gid; })[0] || null;
        var last = flow.steps.filter(function (s) { return Lab.ACTION[s.action].chat && s.app; }).pop();
        var a = g && g.a ? g.a : ids[0] || '';
        var b = g && g.b && g.b !== a ? g.b : ids.filter(function (x) { return x !== a; })[0] || '';
        return { a: a, b: b, app: (g && g.app) || (last && last.app) || state.setup.app };
    }

    function templateById(id) {
        return Lab.BLOCKS.concat(state.templates).filter(function (t) { return t.id === id; })[0] || null;
    }

    // Lägger en byggsten på platsen t (annars vid märket). kind: template (en mall blir en grupp), action (ett
    // steg), custom (ett eget steg, vars text skrivs i rutan till höger) och group (en tom grupp).
    function place(kind, id, t) {
        if (state.run) return;
        var flow = state.flow, whole = kind === 'template' || kind === 'group';
        t = t || mark(whole);
        var c = context(t);
        change(function () {
            if (kind === 'template') {
                var tpl = templateById(id), index = t.group ? groupIndex(t.group) + 1 : t.at;
                var made = tpl ? Lab.insertTemplate(flow, tpl, c, index) : null;
                if (!made) {
                    say(!tpl ? 'Mallen finns inte kvar.' : tpl.kind === 'chat' && !(c.a && c.b) ? 'En chattmall behöver två enheter. Lägg till en enhet med + Enhet.' :
                        'Mallen ryms inte. Ett flöde har högst ' + Lab.LIMITS.steps + ' steg och ' + Lab.LIMITS.groups + ' grupper.');
                    return false;
                }
                state.sel = { group: made.group.id };
                state.flash = made.group.id;
                if (made.missing) say(made.missing + ' steg i mallen är skrivna för fler enheter än flödet har. De ligger nu på ' + flow.devices[0].name + '.');
            } else if (kind === 'group') {
                var g = Lab.addGroup(flow, { title: 'Ny grupp', a: c.a, b: c.b }, t.group ? groupIndex(t.group) + 1 : t.at);
                if (!g) { say('Flödet har redan ' + Lab.LIMITS.groups + ' grupper.'); return false; }
                state.sel = { group: g.id };
                state.flash = g.id;
                state.focus = 'g-title';
            } else {
                var a = Lab.ACTION[kind === 'custom' ? 'custom' : id], p = a ? stepPlace(t) : null, group = p && flow.groups[groupIndex(p.group)];
                if (!group) return false;
                var prev = stepBefore({ group: p.group, pos: p.pos });
                var o = { group: p.group, pos: p.pos };
                if (!group.a) o.device = a.chat ? c.a : prev && prev.device !== Lab.ALL ? prev.device : c.a;
                if (!group.a && a.chat && c.b) o.other = c.b;
                if ((a.chat || a.needsApp) && !group.app) o.app = c.app;
                var step = Lab.addStep(flow, a.id, o);
                if (!step) { say('Flödet har redan ' + Lab.LIMITS.steps + ' steg.'); return false; }
                // Gruppens första chattsteg ger gruppen dess app, så att appen sedan går att byta för hela gruppen.
                if (a.chat && !group.app && step.app && groupSteps(group.id).filter(function (s) { return Lab.ACTION[s.action].chat; }).length === 1) group.app = step.app;
                state.closed[p.group] = false;
                state.sel = { step: step.id };
                state.flash = step.id;
                if (kind === 'custom') state.focus = 'd-do';
            }
        });
    }

    // ---------- Förbered: ritningen ----------

    function button(cls, text, title, onClick, label) {
        var b = el('button', { type: 'button', class: cls, text: text, title: title, 'aria-label': label || title });
        b.addEventListener('click', onClick);
        return b;
    }

    function renderPlan() {
        var flow = state.flow, locked = !!state.run;
        $('p-locked').classList.toggle('display-none', !locked);
        if (document.activeElement !== $('p-name')) $('p-name').value = flow.name;
        if (document.activeElement !== $('p-prefix')) $('p-prefix').value = flow.prefix;
        ['p-name', 'p-prefix', 'p-search'].forEach(function (id) { $(id).disabled = locked; });
        $('p-device-add').disabled = locked || flow.devices.length >= Lab.LIMITS.devices;
        var list = $('l-apps');
        list.textContent = '';
        allApps().concat(TOOL_APPS).forEach(function (app) { list.appendChild(el('option', { value: app })); });
        renderDevices();
        renderPalette();
        renderSteps();
        renderDetail();
        applyFocus();
    }

    // Enheterna står som märken ovanför flödet. Namnet ändras på plats, och × tar bort enheten.
    function renderDevices() {
        var host = $('p-devices'), flow = state.flow, locked = !!state.run;
        host.textContent = '';
        flow.devices.forEach(function (d, n) {
            var chip = el('span', { class: 'dev-chip' }, [el('span', { class: 'dot dev-' + (n % 4) })]);
            if (state.devEdit === d.id && !locked) {
                var input = el('input', { type: 'text', class: 'dev-input', value: d.name, maxLength: Lab.LIMITS.name, autocomplete: 'off', 'aria-label': 'Namn på enhet ' + (n + 1), 'data-focus': 'dev-' + d.id });
                var done = function () {
                    if (state.devEdit !== d.id) return;
                    state.devEdit = null;
                    d.name = Lab.clip(input.value, Lab.LIMITS.name).trim() || 'Enhet ' + (n + 1);
                    save();
                    renderPlan();
                };
                input.addEventListener('input', function () { d.name = Lab.clip(input.value, Lab.LIMITS.name); save(); renderSteps(); });
                input.addEventListener('change', done);
                input.addEventListener('blur', done);
                input.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); done(); } });
                chip.appendChild(input);
            } else {
                var name = button('dev-name', d.name, 'Byt namn på enheten', function () { state.devEdit = d.id; state.focus = 'dev-' + d.id; renderDevices(); applyFocus(); }, 'Byt namn på ' + d.name);
                name.disabled = locked;
                chip.appendChild(name);
                if (!locked && flow.devices.length > 1) {
                    chip.appendChild(button('dev-x', '×', 'Ta bort enheten', function () {
                        var used = flow.steps.filter(function (s) { return s.device === d.id; }).length;
                        if (used && !confirm(used + ' steg görs på ' + d.name + ' och tas bort tillsammans med enheten. Fortsätta?')) return;
                        change(function () { Lab.removeDevice(flow, d.id); });
                        if (used) say(d.name + ' och dess ' + used + ' steg togs bort. Ångra lägger tillbaka dem.');
                    }, 'Ta bort enheten ' + d.name));
                }
            }
            host.appendChild(chip);
        });
    }

    var CAMERA = ['photo', 'video', 'screenshot', 'edit-date'];
    var STEP_KINDS = [
        ['Chatt', function (a) { return !!a.chat; }],
        ['Kamera och bilder', function (a) { return CAMERA.indexOf(a.id) >= 0; }],
        ['Enheten', function (a) { return !a.chat && CAMERA.indexOf(a.id) < 0 && a.id !== 'custom'; }],
    ];

    // En byggsten i listan: ett klick lägger den vid märket, och den går att dra till en plats i flödet.
    function palItem(kind, id, label, desc, showDesc) {
        var b = el('button', { type: 'button', class: 'pal-item pal-' + kind, disabled: !!state.run, 'data-kind': kind, 'data-id': id, title: desc || '' },
            [el('span', { class: 'pal-label', text: label }), desc && showDesc ? el('span', { class: 'pal-desc', text: desc }) : null]);
        b.addEventListener('click', function () { place(kind, id); });
        return b;
    }

    function renderPalette() {
        var top = $('p-palette'), q = $('p-search').value.trim().toLowerCase(), host = top;
        var hit = function (label, desc) { return !q || (label + ' ' + (desc || '')).toLowerCase().indexOf(q) >= 0; };
        // Varje rubrik går att fälla ihop, och står kvar så tills den fälls ut. En sökning visar allt som träffar.
        var head = function (text) {
            var box = el('details', { class: 'pal-sec' }, [el('summary', { class: 'pal-head', text: text })]);
            box.open = !!q || !state.palClosed[text];
            box.addEventListener('toggle', function () { if (box.isConnected && !$('p-search').value.trim()) state.palClosed[text] = !box.open; });
            top.appendChild(box);
            host = box;
        };
        top.textContent = '';

        var mallar = Lab.BLOCKS.filter(function (b) { return hit(b.label, b.desc); });
        if (mallar.length) head('Mallar');
        mallar.forEach(function (b) { host.appendChild(palItem('template', b.id, b.label, b.desc, true)); });

        var own = state.templates.filter(function (t) { return hit(t.label, t.desc); });
        if (own.length || !q) head('Mina mallar');
        if (!state.templates.length && !q) host.appendChild(el('p', { class: 'hint', text: 'Här hamnar grupper och steg som du sparar som mall. De ligger kvar på datorn till nästa gång.' }));
        own.forEach(function (t) {
            var remove = el('button', { type: 'button', class: 'icon-btn', text: '−', title: 'Ta bort mallen', 'aria-label': 'Ta bort mallen ' + t.label, disabled: !!state.run });
            remove.addEventListener('click', function () {
                if (!confirm('Mallen ' + t.label + ' tas bort från datorn. Steg som redan ligger i ett flöde står kvar. Fortsätta?')) return;
                state.templates = state.templates.filter(function (x) { return x.id !== t.id; });
                saveTemplates();
                renderPalette();
            });
            host.appendChild(el('div', { class: 'pal-own' }, [palItem('template', t.id, t.label, t.desc || t.steps.length + ' steg', true), remove]));
        });

        STEP_KINDS.forEach(function (k) {
            var actions = Lab.ACTIONS.filter(function (a) { return k[1](a) && hit(a.label, a.do); });
            if (actions.length) head(k[0]);
            actions.forEach(function (a) { host.appendChild(palItem('action', a.id, a.label, a.do.replace(/\{kod\}/g, 'koden').replace(/\{förra\}/g, 'koden före').replace(/\{andra\}/g, 'den andra enheten').replace(/\{app\}/g, 'appen').replace(/\{enhet\}/g, 'enheten'), false)); });
        });

        var extra = [['custom', 'x', 'Eget steg', 'Ett steg med din egen text.'], ['group', 'x', 'Ny grupp', 'En tom grupp med en egen rubrik, att fylla med steg.']].filter(function (x) { return hit(x[2], x[3]); });
        if (extra.length) head('Eget');
        extra.forEach(function (x) { host.appendChild(palItem(x[0], x[1], x[2], x[3], true)); });
        if (!top.firstChild) top.appendChild(el('p', { class: 'hint', text: 'Ingen byggsten heter så.' }));
        renderWhere();
    }

    function stepRow(s, pos, warnings, sel) {
        var locked = !!state.run, a = Lab.ACTION[s.action] || Lab.ACTION.custom, flow = state.flow;
        var title = s.action === 'custom' ? s.do || 'Eget steg utan text' : a.label;
        var meta = el('span', { class: 'step-meta' }, [el('span', { class: 'chip ' + deviceClass(s.device), text: s.deviceName })]);
        if (s.other) {
            meta.appendChild(el('span', { class: 'arrow', text: '→', 'aria-label': 'till' }));
            meta.appendChild(el('span', { class: 'chip ' + deviceClass(s.other), text: Lab.deviceName(flow, s.other) }));
        }
        if (s.app) meta.appendChild(el('span', { class: 'step-app', text: s.app }));
        var text = el('span', { class: 'step-text' }, [el('span', { class: 'step-title', text: title }), meta]);
        warnings.forEach(function (w) { text.appendChild(el('span', { class: 'step-warn', text: w.text })); });
        return el('div', { class: 'step' + (warnings.length ? ' has-warn' : '') + (sel && sel.step === s.id ? ' sel' : ''), 'data-step': s.id, 'data-pos': String(pos), tabindex: '0', title: s.do + ' Klart ' + s.press + '.' }, [
            locked ? el('span', { class: 'handle-space' }) : el('button', { type: 'button', class: 'handle', 'data-drag': 'step', 'data-id': s.id, title: 'Dra för att flytta. Alt+↑ och Alt+↓ flyttar det valda steget.', 'aria-label': 'Flytta ' + s.code + ' ' + title, tabindex: '-1' }),
            el('span', { class: 'step-code', text: s.code }),
            text,
            el('span', { class: 'step-end' }, [s.wait ? el('span', { class: 'wait-chip', text: 'väntan ' + Lab.spanText(s.wait) }) : null]),
        ]);
    }

    function groupHead(g, warnings) {
        var locked = !!state.run, flow = state.flow, closed = !!state.closed[g.id];
        var names = [g.a, g.b].map(function (id) { return Lab.deviceName(flow, id); });
        // Appen och paret står bara på en grupp där något steg görs mot den andra enheten.
        var chat = g.steps.some(function (s) { return !!s.other; });
        var meta = g.steps.length + ' steg' + (g.waitS ? ' · väntan ' + Lab.spanText(g.waitS) : '') + (chat && g.app ? ' · ' + g.app : '') + (chat && names[0] && names[1] ? ' · ' + names[0] + ' och ' + names[1] : '');
        var fold = button('fold-btn', closed ? '▸' : '▾', closed ? 'Visa stegen' : 'Dölj stegen', function () { state.closed[g.id] = !closed; renderSteps(); }, (closed ? 'Visa stegen i ' : 'Dölj stegen i ') + g.title);
        fold.setAttribute('aria-expanded', closed ? 'false' : 'true');
        return el('div', { class: 'group-head', 'data-head': g.id }, [
            locked ? null : el('button', { type: 'button', class: 'handle', 'data-drag': 'move-group', 'data-id': g.id, title: 'Dra för att flytta gruppen. Alt+↑ och Alt+↓ flyttar den valda gruppen.', 'aria-label': 'Flytta gruppen ' + g.title, tabindex: '-1' }),
            fold, el('h3', { class: 'block', text: g.title }), el('span', { class: 'group-meta', text: meta }),
            warnings.length ? el('span', { class: 'step-warn', text: warnings.map(function (w) { return w.text; }).join(' ') }) : null,
        ]);
    }

    function link(text, onClick) { return button('link-btn', text, text, onClick); }

    function renderSteps() {
        var host = $('p-steps'), locked = !!state.run, flow = state.flow, sel = selected();
        var groups = Lab.outline(flow), warnings = Lab.check(flow), keep = host.scrollTop, total = flow.steps.length;
        $('p-summary').textContent = total ? sizeText(Lab.estimate(flow)) : 'Inga steg ännu';
        $('p-undo').disabled = locked || !state.history.length;
        $('p-print').disabled = !total;
        $('p-start').disabled = !total;
        $('p-start').textContent = state.run ? 'Tillbaka till genomförandet' : 'Till genomförandet';
        $('p-check').classList.toggle('display-none', !warnings.length);
        $('p-check').textContent = warnings.length === 1 ? '1 sak att se över' : warnings.length + ' saker att se över';
        $('p-ready').textContent = total && !warnings.length && !locked ? 'Redo att genomföra' : '';
        $('p-note').textContent = state.said || '';
        host.textContent = '';
        host.classList.toggle('is-empty', !groups.length);
        if (!groups.length) {
            host.appendChild(el('div', { class: 'dropzone' }, locked ? [el('b', { text: 'Flödet har inga steg.' })] : [
                el('b', { text: 'Flödet är tomt' }),
                el('span', { text: 'Dra hit en byggsten, eller klicka på en till vänster. En mall ger en hel grupp av steg.' }),
                el('span', { class: 'hint' }, ['Eller ', link('välj ett färdigt flöde', function () { show('start'); }), ' eller ', link('bygg från delar', openWizard), '.']),
            ]));
        }
        groups.forEach(function (g) {
            var box = el('section', { class: 'group' + (sel && sel.group === g.id ? ' sel' : ''), 'data-group': g.id }, [groupHead(g, warnings.filter(function (w) { return w.group === g.id && !w.step; }))]);
            if (!state.closed[g.id]) {
                var body = el('div', { class: 'group-body' });
                g.steps.forEach(function (s, pos) { body.appendChild(stepRow(s, pos, warnings.filter(function (w) { return w.step === s.id; }), sel)); });
                if (!g.steps.length) body.appendChild(el('p', { class: 'group-empty', text: 'Gruppen har inga steg ännu. Klicka på en byggsten eller dra ett steg hit.' }));
                box.appendChild(body);
            }
            host.appendChild(box);
        });
        if (groups.length && !locked) host.appendChild(el('div', { class: 'end-zone', text: 'Släpp här för att lägga sist' }));
        host.scrollTop = keep;
        var lit = state.flash ? host.querySelector('[data-step="' + state.flash + '"], .group[data-group="' + state.flash + '"] > .group-head') : null;
        state.flash = null;
        if (lit) { lit.classList.add('flash'); lit.scrollIntoView({ block: 'nearest' }); }
        // Det valda steget behåller fokus när flödet ritas om, så att tangenterna fortsätter att gälla det.
        if (state.keepFocus && sel && sel.step) {
            var row = host.querySelector('[data-step="' + sel.step + '"]');
            if (row) { row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest' }); }
        }
        state.keepFocus = false;
        renderWhere();
    }

    // ---------- Förbered: det valda steget eller gruppen ----------

    function field(label, control, wide) { return el('label', { class: 'ed-field' + (wide ? ' wide' : '') }, [el('span', { class: 'field', text: label }), control]); }

    function deviceSelect(value, none, all) {
        var select = el('select', {});
        if (none) select.appendChild(el('option', { value: '', text: none }));
        state.flow.devices.forEach(function (x) { select.appendChild(el('option', { value: x.id, text: x.name })); });
        if (all) select.appendChild(el('option', { value: Lab.ALL, text: 'Alla enheter' }));
        select.value = value || '';
        return select;
    }

    var WAITS = [0, 30, 60, 120, 180, 300, 600, 900, 1800];
    function waitSelect(value) {
        var select = el('select', {}), list = WAITS.indexOf(value) < 0 ? WAITS.concat([value]).sort(function (x, y) { return x - y; }) : WAITS;
        list.forEach(function (w) { select.appendChild(el('option', { value: String(w), text: w ? (w < 60 ? w + ' sekunder' : w % 60 ? Lab.spanText(w) : w / 60 + (w === 60 ? ' minut' : ' minuter')) : 'Ingen väntan' })); });
        select.value = String(value || 0);
        return select;
    }

    // En ändring från rutan till höger. Medan det skrivs i ett fält är det en ändring för Ångra, inte en per tecken.
    function editStep(id, o, typing) {
        if (state.run) return;
        if (!typing || !state.typing) remember();
        state.typing = !!typing;
        say('');
        Lab.updateStep(state.flow, id, o);
        save();
        renderSteps();
        if (typing) refreshSay(); else { renderDetail(); }
    }
    function editGroup(id, o, typing) {
        if (state.run) return;
        if (!typing || !state.typing) remember();
        state.typing = !!typing;
        say('');
        if (!Lab.updateGroup(state.flow, id, o)) say('Gruppen ändrades inte. De två enheterna måste vara olika.');
        save();
        renderSteps();
        if (!typing) renderDetail();
    }

    function sayParts(v) {
        var box = el('div', { class: 'say', id: 'd-say' }, [el('small', { text: 'Under genomförandet står det' })]);
        var line = el('span', {});
        v.parts.forEach(function (p) { line.appendChild(p.code ? el('b', { class: 'code-in', text: p.text }) : document.createTextNode(p.text)); });
        if (!v.do) line.appendChild(el('i', { text: 'Ingen text ännu.' }));
        box.appendChild(line);
        box.appendChild(el('span', { class: 'press', text: 'Klart ' + v.press + '.' + (v.wait ? ' Sedan väntan ' + Lab.spanText(v.wait) + '.' : '') }));
        return box;
    }
    function refreshSay() {
        var box = $('d-say'), sel = selected();
        if (!box || !sel || !sel.step) return;
        var v = Lab.view(state.flow).filter(function (x) { return x.id === sel.step; })[0];
        if (v) box.replaceWith(sayParts(v));
    }

    function renderDetail() {
        var host = $('p-detail'), sel = selected();
        host.textContent = '';
        host.classList.toggle('open', !!sel);
        if (!sel) {
            host.appendChild(el('h2', { text: 'Steget' }));
            host.appendChild(el('p', { class: 'hint', text: 'Klicka på ett steg eller en grupp i flödet för att ändra det. Det du ändrar syns direkt i flödet.' }));
            host.appendChild(el('ul', { class: 'tips' }, [
                el('li', { text: 'Dra i greppet till vänster på ett steg eller en grupp för att flytta det.' }),
                el('li', { text: 'Alt+↑ och Alt+↓ flyttar det valda, och Delete tar bort det.' }),
                el('li', { text: 'Ctrl+Z ångrar den senaste ändringen.' }),
            ]));
        } else if (sel.step) stepDetail(host, sel.step);
        else groupDetail(host, sel.group);
        applyFocus();
    }

    function detailHead(host, code, title, what) {
        host.appendChild(el('div', { class: 'detail-head' }, [code ? el('span', { class: 'step-code', text: code }) : null, el('h2', { text: title }),
            button('icon-btn', '×', 'Stäng', function () { select(null); }, 'Stäng ' + what)]));
    }

    function stepDetail(host, id) {
        var flow = state.flow, raw = stepById(id), v = Lab.view(flow).filter(function (x) { return x.id === id; })[0], a = Lab.ACTION[raw.action] || Lab.ACTION.custom;
        var locked = !!state.run, custom = a.id === 'custom';
        var uses = function (word) { return (raw.do + ' ' + raw.done).indexOf('{' + word + '}') >= 0; };
        var text = function (tag, key, props) {
            var c = el(tag, Object.assign({ value: raw[key], maxLength: key === 'app' ? Lab.LIMITS.name : Lab.LIMITS.text, disabled: locked, 'data-focus': 'd-' + key }, props || {}));
            c.addEventListener('input', function () { var o = {}; o[key] = c.value; editStep(id, o, true); });
            return c;
        };
        detailHead(host, v.code, custom ? 'Eget steg' : a.label, 'steget');
        Lab.check(flow).filter(function (w) { return w.step === id; }).forEach(function (w) { host.appendChild(el('p', { class: 'step-warn', text: w.text })); });
        if (custom) host.appendChild(field('Vad ska göras?', text('textarea', 'do', { rows: 3, placeholder: 'Till exempel: Öppna Kartor och sök efter {kod}.' })));

        if (a.chat || uses('andra')) {
            var from = deviceSelect(raw.device), to = deviceSelect(raw.other, 'Ingen');
            from.disabled = to.disabled = locked;
            from.setAttribute('data-focus', 'd-device');
            to.setAttribute('data-focus', 'd-other');
            // Den som väljer samma enhet i båda rutorna menar att de två ska byta plats.
            from.addEventListener('change', function () { state.focus = 'd-device'; editStep(id, from.value === raw.other ? { device: from.value, other: raw.device } : { device: from.value }); });
            to.addEventListener('change', function () { state.focus = 'd-other'; editStep(id, to.value === raw.device ? { device: raw.other || raw.device, other: to.value } : { other: to.value }); });
            var swap = button('icon-btn swap-btn', '⇄', 'Byt håll mellan enheterna', function () { state.focus = 'd-swap'; editStep(id, { device: raw.other, other: raw.device }); });
            swap.disabled = locked || !raw.other || raw.device === Lab.ALL;
            swap.setAttribute('data-focus', 'd-swap');
            host.appendChild(el('div', { class: 'swap' }, [field('Från', from), swap, field('Till', to)]));
        } else {
            var on = deviceSelect(raw.device, '', true);
            on.disabled = locked;
            on.setAttribute('data-focus', 'd-device');
            on.addEventListener('change', function () { state.focus = 'd-device'; editStep(id, { device: on.value }); });
            host.appendChild(field('Görs på', on));
        }
        if (a.chat || a.needsApp || uses('app') || custom || raw.app) host.appendChild(field('App', text('input', 'app', { type: 'text', list: 'l-apps', placeholder: custom ? 'Ingen' : 'Välj eller skriv' })));
        var wait = waitSelect(raw.wait);
        wait.disabled = locked;
        wait.setAttribute('data-focus', 'd-wait');
        wait.addEventListener('change', function () { state.focus = 'd-wait'; editStep(id, { wait: Number(wait.value) }); });
        host.appendChild(field('Väntan efter steget', wait));
        host.appendChild(sayParts(v));

        var more = el('details', { class: 'more' }, [el('summary', { text: 'Mer: texterna och mallen' })]);
        more.open = !!state.moreOpen;
        more.addEventListener('toggle', function () { state.moreOpen = more.open; });
        if (!custom) more.appendChild(field('Vad ska göras?', text('textarea', 'do', { rows: 3 })));
        more.appendChild(field('Tryck klart …', text('input', 'press', { type: 'text' })));
        more.appendChild(field('I protokollet, i förfluten tid', text('textarea', 'done', { rows: 2, placeholder: 'Tomt ger samma text som ovan' })));
        more.appendChild(el('p', { class: 'hint', text: 'I texterna byts {kod} mot stegets kod, {förra} mot koden före, {andra} mot den andra enheten, {enhet} mot enheten och {app} mot appen.' }));
        var name = el('input', { type: 'text', value: custom ? Lab.clip(raw.do, 40).trim() : a.label, maxLength: Lab.LIMITS.name, 'aria-label': 'Namn på mallen', class: 'tpl-name' });
        more.appendChild(el('div', { class: 'inline wrap' }, [name, button('secondary-btn', 'Spara steget som mall', 'Steget sparas under Mina mallar, som det står i flödet nu', function () { saveAsTemplate({ step: id }, name.value); })]));
        host.appendChild(more);
        if (locked) return;
        host.appendChild(el('div', { class: 'inline wrap detail-actions' }, [
            button('secondary-btn', 'Duplicera', 'En kopia av steget, direkt efter det', function () {
                change(function () { var c = Lab.duplicateStep(flow, id); if (!c) return false; state.sel = { step: c.id }; state.flash = c.id; });
            }),
            button('secondary-btn danger', 'Ta bort', 'Ta bort steget (Delete)', function () { removeSelected(); }),
        ]));
    }

    function groupDetail(host, id) {
        var flow = state.flow, g = Lab.outline(flow).filter(function (x) { return x.id === id; })[0], locked = !!state.run;
        detailHead(host, '', 'Gruppen', 'gruppen');
        var title = el('input', { type: 'text', value: g.title, maxLength: Lab.LIMITS.name, disabled: locked, 'data-focus': 'g-title' });
        title.addEventListener('input', function () { editGroup(id, { title: title.value }, true); });
        host.appendChild(field('Rubrik', title));
        var app = el('input', { type: 'text', value: g.app, maxLength: Lab.LIMITS.name, list: 'l-apps', disabled: locked, placeholder: 'Ingen', 'data-focus': 'g-app' });
        app.addEventListener('change', function () { state.focus = 'g-app'; editGroup(id, { app: app.value }); });
        host.appendChild(field('App för gruppens chattsteg', app));
        if (flow.devices.length > 1) {
            var a = deviceSelect(g.a, 'Ingen'), b = deviceSelect(g.b, 'Ingen');
            a.disabled = b.disabled = locked;
            a.setAttribute('data-focus', 'g-a');
            b.setAttribute('data-focus', 'g-b');
            a.addEventListener('change', function () { state.focus = 'g-a'; editGroup(id, { a: a.value }); });
            b.addEventListener('change', function () { state.focus = 'g-b'; editGroup(id, { b: b.value }); });
            var swap = button('icon-btn swap-btn', '⇄', 'De två enheterna byter plats i alla gruppens steg', function () { state.focus = 'g-swap'; editGroup(id, { swap: true }); }, 'Byt riktning');
            swap.disabled = locked || !(g.a && g.b);
            swap.setAttribute('data-focus', 'g-swap');
            host.appendChild(el('div', { class: 'swap' }, [field('Från, den som börjar', a), swap, field('Till, den andra', b)]));
        }
        host.appendChild(el('p', { class: 'hint', text: g.steps.length + ' steg. Ett byte här ändrar alla steg i gruppen: stegen som gjordes på den ena enheten görs på den nya, och stegen i gruppens app görs i den nya appen.' }));
        var name = el('input', { type: 'text', value: g.title, maxLength: Lab.LIMITS.name, 'aria-label': 'Namn på mallen', class: 'tpl-name' });
        var store = button('secondary-btn', 'Spara som mall', 'Gruppen sparas under Mina mallar, och går sedan att lägga in för andra enheter och appar', function () { saveAsTemplate({ group: id }, name.value || g.title); });
        store.disabled = !g.steps.length;
        host.appendChild(el('div', { class: 'inline wrap' }, [name, store]));
        if (locked) return;
        host.appendChild(el('div', { class: 'inline wrap detail-actions' }, [
            button('secondary-btn', 'Kopiera gruppen', 'En kopia av gruppen, direkt efter den', function () {
                change(function () {
                    var made = Lab.copyGroup(flow, id);
                    if (!made) { say('Kopian ryms inte. Ett flöde har högst ' + Lab.LIMITS.steps + ' steg och ' + Lab.LIMITS.groups + ' grupper.'); return false; }
                    state.sel = { group: made.id };
                    state.flash = made.id;
                });
                if (selected() && selected().group !== id) say('Kopian ligger efter gruppen. Byt app eller enheter till höger.');
            }),
            button('secondary-btn danger', 'Ta bort gruppen', 'Gruppen och dess steg tas bort (Delete)', function () { removeSelected(); }),
        ]));
    }

    // Sparar en grupp ({ group: id }) eller ett steg ({ step: id }) som en egen mall på datorn.
    function saveAsTemplate(from, label) {
        var flow = state.flow, id = 'egen-' + Date.now().toString(36);
        var tpl = Lab.templateFrom(flow, from, { id: id, label: Lab.clip(label, Lab.LIMITS.name).trim(), desc: '' });
        if (!tpl) return say(from.group && groupSteps(from.group).length > Lab.LIMITS.templateSteps ? 'En mall har högst ' + Lab.LIMITS.templateSteps + ' steg.' : 'Det finns inga steg att göra en mall av.');
        var merged = Lab.mergeTemplates(state.templates, [tpl]);
        var final = merged.renamed[id] || id;
        if (!merged.added && !merged.renamed[id]) return say('Det ryms inte fler än ' + Lab.LIMITS.templates + ' egna mallar. Ta bort någon först.');
        state.templates = merged.list;
        var g = from.group ? flow.groups[groupIndex(from.group)] : null;
        if (g) g.template = final;
        var stored = saveTemplates();
        save();
        renderPalette();
        say((merged.added ? 'Mallen ' + tpl.label + ' ligger nu under Mina mallar, här och på startsidan.' : 'En mall med samma innehåll fanns redan under Mina mallar.') +
            (stored ? '' : ' Den här webbläsaren sparar inte mellan omstarter, så spara mallarna som fil.'));
    }

    function removeSelected() {
        var sel = selected(), flow = state.flow;
        if (!sel || state.run) return;
        if (sel.step) {
            var code = (Lab.view(flow).filter(function (v) { return v.id === sel.step; })[0] || {}).code;
            change(function () { Lab.removeStep(flow, sel.step); state.sel = null; });
            say(code + ' togs bort. Ångra lägger tillbaka det.');
        } else {
            var g = flow.groups[groupIndex(sel.group)], n = groupSteps(sel.group).length;
            change(function () { Lab.removeGroup(flow, sel.group); state.sel = null; });
            say('Gruppen ' + g.title + (n ? ' och dess ' + n + ' steg' : '') + ' togs bort. Ångra lägger tillbaka ' + (n ? 'dem' : 'den') + '.');
        }
    }

    // Alt+↑ och Alt+↓: det valda steget eller den valda gruppen flyttas en plats.
    function moveSelected(dir) {
        var sel = selected(), flow = state.flow;
        if (!sel || state.run) return;
        state.keepFocus = true;
        if (sel.step) change(function () { state.flash = sel.step; return Lab.moveStep(flow, sel.step, dir); });
        else {
            var at = groupIndex(sel.group) + dir;
            if (at < 0 || at >= flow.groups.length) return;
            change(function () { state.flash = sel.group; return Lab.moveGroup(flow, sel.group, at); });
        }
    }

    // ---------- Förbered: menyn Mer ----------

    function closeMenu() {
        if (!$('p-menu')) return;
        $('p-menu').classList.add('display-none');
        $('p-more').setAttribute('aria-expanded', 'false');
    }
    function toggleMenu() {
        var open = $('p-menu').classList.contains('display-none');
        $('p-menu').classList.toggle('display-none', !open);
        $('p-more').setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    // ---------- Förbered: dra och släpp ----------

    // Draget görs med pekaren, så att det fungerar likadant med mus, penna och finger. Det som dras är { kind, id }:
    // ett steg (step) eller en grupp (move-group) i flödet, med greppet, eller en byggsten ur listan (kind som i
    // place). Mallar och grupper släpps mellan grupper, steg var som helst. En linje visar var det hamnar.
    var drag = null, swallowClick = false;
    function wholeGroup(kind) { return kind === 'template' || kind === 'group' || kind === 'move-group'; }

    function onPointerDown(e) {
        if (state.view !== 'plan' || state.run || e.button > 0 || !e.target.closest) return;
        var h = e.target.closest('#view-plan .handle[data-drag]');
        // En byggsten dras med mus eller penna. Med fingret rullar listan, och ett tryck lägger in byggstenen.
        var p = !h && e.pointerType !== 'touch' ? e.target.closest('#p-palette .pal-item') : null;
        if (!h && !p) return;
        if (h) e.preventDefault();
        drag = {
            kind: h ? h.getAttribute('data-drag') : p.getAttribute('data-kind'), id: h ? h.getAttribute('data-id') : p.getAttribute('data-id'),
            x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false, target: null,
            label: h ? h.getAttribute('aria-label').replace(/^Flytta (gruppen )?/, '') : p.querySelector('.pal-label').textContent,
            source: h ? h.closest(h.getAttribute('data-drag') === 'step' ? '.step' : '.group') : null,
        };
    }

    function onPointerMove(e) {
        if (!drag) return;
        if (!drag.active) {
            if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 6) return;
            drag.active = true;
            drag.ghost = el('div', { class: 'drag-ghost', text: drag.label });
            document.body.appendChild(drag.ghost);
            if (drag.source) drag.source.classList.add('dragging');
            $('p-steps').setAttribute('data-drag', wholeGroup(drag.kind) ? 'group' : 'step');
            document.body.classList.add('is-dragging');
            requestAnimationFrame(autoScroll);
        }
        e.preventDefault();
        drag.x = e.clientX;
        drag.y = e.clientY;
        drag.ghost.style.transform = 'translate(' + (e.clientX + 14) + 'px, ' + (e.clientY - 14) + 'px)';
        aim();
    }

    function aim() {
        drag.target = targetAt(drag.x, drag.y);
        showLine(drag.target);
    }

    // Nära flödets över- eller nederkant rullar flödet medan något dras.
    function autoScroll() {
        if (!drag || !drag.active) return;
        var host = $('p-steps'), r = host.getBoundingClientRect(), v = 0;
        if (drag.x > r.left - 40 && drag.x < r.right + 40) {
            if (drag.y < r.top + 36) v = -Math.ceil((r.top + 36 - drag.y) / 3);
            else if (drag.y > r.bottom - 36) v = Math.ceil((drag.y - r.bottom + 36) / 3);
        }
        if (v) { host.scrollTop += Math.max(-24, Math.min(24, v)); aim(); }
        requestAnimationFrame(autoScroll);
    }

    function onPointerUp() { finishDrag(false); }

    function finishDrag(cancel) {
        var d = drag;
        drag = null;
        if (!d || !d.active) return;
        // Klicket som kommer efter släppet är inte ett klick på det som ligger under pekaren.
        swallowClick = true;
        setTimeout(function () { swallowClick = false; }, 0);
        d.ghost.remove();
        if (d.source) d.source.classList.remove('dragging');
        $('p-steps').removeAttribute('data-drag');
        document.body.classList.remove('is-dragging');
        showLine(null);
        if (!cancel && d.target) drop(d, d.target);
    }

    // Platsen under pekaren, eller null utanför flödet. Mellan grupperna gäller den närmaste kanten. För ett steg
    // gäller gruppen under pekaren: överst om pekaren står på rubriken, annars före raden vars mitt är under pekaren.
    function targetAt(x, y) {
        var host = $('p-steps'), box = host.getBoundingClientRect();
        if (x < box.left - 40 || x > box.right + 40 || y < box.top - 40 || y > box.bottom + 40) return null;
        var sections = Array.prototype.slice.call(host.querySelectorAll('.group'));
        if (!sections.length) return { at: 0 };
        if (wholeGroup(drag.kind)) {
            var best = { at: sections.length, d: Infinity };
            sections.forEach(function (sec, i) {
                var r = sec.getBoundingClientRect(), d = Math.abs(y - r.top);
                if (d < best.d) best = { at: i, d: d };
                if (i === sections.length - 1 && Math.abs(y - r.bottom) < best.d) best = { at: i + 1, d: Math.abs(y - r.bottom) };
            });
            return { at: best.at };
        }
        for (var i = 0; i < sections.length; i++) {
            var r = sections[i].getBoundingClientRect();
            if (y >= r.bottom && i < sections.length - 1) continue;
            var sec = sections[i], id = sec.getAttribute('data-group');
            // I luckan ovanför en grupp hamnar steget sist i gruppen före.
            if (y < r.top && i > 0) { var prev = sections[i - 1].getAttribute('data-group'); return { group: prev, pos: groupSteps(prev).length }; }
            if (state.closed[id]) return { group: id, pos: groupSteps(id).length };
            if (y < sec.querySelector('.group-head').getBoundingClientRect().bottom) return { group: id, pos: 0 };
            var rows = sec.querySelectorAll('.step');
            for (var k = 0; k < rows.length; k++) {
                var rr = rows[k].getBoundingClientRect();
                if (y < rr.top + rr.height / 2) return { group: id, pos: k };
            }
            return { group: id, pos: groupSteps(id).length };
        }
        return null;
    }

    function showLine(t) {
        var host = $('p-steps'), line = host.querySelector('.drop-line'), zone = host.querySelector('.dropzone');
        if (zone) zone.classList.toggle('drop-over', !!t);
        if (!t || zone) { if (line) line.remove(); return; }
        if (!line) { line = el('div', { class: 'drop-line' }); host.appendChild(line); }
        var hb = host.getBoundingClientRect(), y = function (v) { return v - hb.top + host.scrollTop; }, top;
        if (t.at != null) {
            var secs = host.querySelectorAll('.group');
            top = t.at < secs.length ? y(secs[t.at].getBoundingClientRect().top) - 6 : y(secs[secs.length - 1].getBoundingClientRect().bottom) + 2;
        } else {
            var sec = host.querySelector('.group[data-group="' + t.group + '"]'), rows = sec.querySelectorAll('.step');
            if (!rows.length) top = y(sec.querySelector('.group-head').getBoundingClientRect().bottom) + 1;
            else top = t.pos < rows.length ? y(rows[t.pos].getBoundingClientRect().top) - 4 : y(rows[rows.length - 1].getBoundingClientRect().bottom) + 1;
        }
        line.style.top = top + 'px';
        line.classList.toggle('line-group', t.at != null);
    }

    function drop(d, t) {
        var flow = state.flow;
        if (d.kind === 'step') {
            change(function () {
                var p = stepPlace(t);
                if (!p) return false;
                var from = groupSteps(p.group).findIndex(function (s) { return s.id === d.id; });
                if (from >= 0 && (p.pos === from || p.pos === from + 1)) return false;
                Lab.moveStepTo(flow, d.id, p.group, from >= 0 && from < p.pos ? p.pos - 1 : p.pos);
                state.sel = { step: d.id };
                state.flash = d.id;
            });
        } else if (d.kind === 'move-group') {
            change(function () {
                var from = groupIndex(d.id);
                if (from < 0 || t.at == null || t.at === from || t.at === from + 1) return false;
                Lab.moveGroup(flow, d.id, from < t.at ? t.at - 1 : t.at);
                state.sel = { group: d.id };
                state.flash = d.id;
            });
        } else place(d.kind, d.id, t);
    }

    // ---------- Filer, kopiering och utskrift ----------

    function download(text, type, name) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: type }));
        a.download = name;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        return name;
    }

    function saveFile(withRun) {
        var run = withRun ? state.run : null;
        return download(JSON.stringify(Lab.toFile(state.flow, run, PROGRAM, Lab.clockNow(), state.templates), null, 2), 'application/json', Lab.fileName(state.flow, run, 'json'));
    }

    function saveTemplateFile() {
        if (!state.templates.length) return status('p-status', 'Det finns inga egna mallar att spara.');
        var now = Lab.clockNow();
        status('p-status', 'Mallarna sparades: ' + download(JSON.stringify(Lab.templatesToFile(state.templates, PROGRAM, now), null, 2), 'application/json', 'laboration-mallar-' + Lab.dateText(now.t, now.off) + '.json'));
    }

    function isTemplateFile(text) {
        try { return JSON.parse(text).format === Lab.TEMPLATES; } catch (e) { return false; }
    }

    function openFile(file) {
        if (!file) return;
        if (file.size > 5e6) return status('p-status', 'Filen är för stor för att vara ett flöde eller en logg.');
        file.text().then(function (text) {
            // En fil med bara mallar läggs till Mina mallar, och flödet som finns här rörs inte.
            if (isTemplateFile(text)) {
                var list = Lab.templatesFromFile(text), added = takeTemplates(list, null);
                status('p-status', added ? added + (added === 1 ? ' mall' : ' mallar') + ' lades till under Mina mallar.' : 'Mallarna i filen fanns redan under Mina mallar.');
                return render();
            }
            var back = Lab.fromFile(text);
            if ((state.run || state.flow.steps.length) && !confirm('Det som finns här nu ersätts av filens innehåll. Fortsätta?')) return;
            var added = takeTemplates(back.templates || [], back.flow);
            // Ångra lägger tillbaka flödet som fanns före filen, men aldrig över en logg.
            if (!state.run && !back.run && state.flow.steps.length) remember(); else state.history = [];
            state.flow = back.flow;
            state.run = back.run;
            // En logg som öppnas ur en fil finns redan som fil.
            state.savedLog = !!back.run;
            state.copied = false;
            state.sel = null;
            state.closed = {};
            state.setup.pair = [0, 1];
            save();
            status('p-status', (back.run ? 'Loggen är öppnad: ' + back.run.entries.length + ' av ' + back.flow.steps.length + ' steg har ett tryck.' : 'Flödet är öppnat: ' + back.flow.steps.length + ' steg.') +
                (added ? ' ' + added + (added === 1 ? ' mall' : ' mallar') + ' följde med och ligger under Mina mallar.' : ''));
            show(back.run ? 'table' : 'plan');
        }).catch(function (e) { status('p-status', e && e.message ? e.message : 'Filen gick inte att läsa.'); });
    }

    async function copyHtml(html, text) {
        try {
            if (navigator.clipboard && window.ClipboardItem) {
                await navigator.clipboard.write([new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([text], { type: 'text/plain' }),
                })]);
                return true;
            }
        } catch (e) { console.warn('clipboard.write misslyckades, provar execCommand:', e && e.message); }
        var stage = $('copy-stage');
        stage.innerHTML = html;
        var range = document.createRange();
        range.selectNodeContents(stage);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { console.warn('execCommand copy misslyckades:', e && e.message); }
        sel.removeAllRanges();
        stage.innerHTML = '';
        return ok;
    }

    // Utskriften går genom en dold ram. I utskriftsdialogen kan den sparas som PDF.
    function printDoc(title, body) {
        var frame = $('l-print');
        frame.onload = function () {
            frame.onload = null;
            try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { console.warn('utskriften misslyckades:', e && e.message); }
        };
        frame.srcdoc = '<!DOCTYPE html><html lang="sv"><head><meta charset="utf-8"><title>' + Lab.esc(title) + '</title>' +
            '<style>@page { margin: 14mm; } body { margin: 0; } table { width: 100%; } tr { break-inside: avoid; }</style></head><body>' + body + '</body></html>';
    }

    // ---------- Genomför ----------

    function start() {
        if (state.run || !state.flow.steps.length) return;
        state.run = Lab.newRun(Lab.clockNow(), ZONE);
        state.sel = null;
        rememberRecent(state.flow);
        state.history = [];
        state.practice = 0;
        state.toast = '';
        save();
        renderRun();
    }

    // Ett tryck, från tangenten eller knappen. Klockan läses först av allt.
    function act(kind) {
        var now = Lab.clockNow(), run = state.run, flow = state.flow;
        dropFocus();
        if (kind === 'start') return start();
        if (!run) {
            if (kind === 'klar' && flow.steps.length) { state.practice++; state.practiceAt = now; }
            return renderRun();
        }
        var last = run.entries.length ? Lab.view(flow)[run.entries.length - 1].code : '';
        if (kind === 'klar' || kind === 'hoppad') {
            if (Lab.isDone(flow, run)) state.toast = 'Alla steg är redan gjorda.';
            else if (Lab.isWaiting(run, now.t)) state.toast = 'Väntan pågår, så trycket räknades inte. V avbryter väntan.';
            else {
                Lab.press(flow, run, now, kind);
                state.toast = '';
                // Det sista steget: laborationen är klar och tabellen visas, utom när en väntan följer på steget.
                if (Lab.isDone(flow, run) && !Lab.isWaiting(run, now.t)) { save(); return finish(); }
            }
        } else if (kind === 'undo') {
            state.toast = Lab.undo(run, now) ? 'Trycket för ' + last + ' togs tillbaka. Det står kvar i loggfilen som ångrat.' : 'Det finns inget tryck att ångra.';
        } else if (kind === 'approx') {
            var marked = Lab.toggleApprox(run);
            state.toast = marked === null ? 'Det finns inget gjort steg att märka.' : marked ? 'Tiden för ' + last + ' är märkt som ungefärlig.' : 'Märket är borta: tiden för ' + last + ' gäller som den är.';
        } else if (kind === 'cut') {
            state.toast = Lab.cutWait(run, now) ? 'Väntan avbröts. Det står på raden i tabellen.' : 'Ingen väntan pågår.';
            if (Lab.isDone(flow, run)) { save(); return finish(); }
        } else if (kind === 'note') {
            return openNote(now);
        }
        save();
        renderRun();
    }

    function openNote(now) {
        state.note = now;
        $('r-note-label').textContent = 'Anteckning med tiden ' + Lab.timeText(now.t, now.off) + ', när du tryckte A';
        // Steget på skärmen står först och är valt. Ett steg som just gjordes går också att välja.
        var flow = state.flow, run = state.run, steps = Lab.view(flow), n = run.entries.length;
        var places = [];
        if (Lab.isWaiting(run, now.t)) {
            places.push([steps[n - 1], 'väntan efter steget pågår']);
            if (steps[n]) places.push([steps[n], 'nästa steg']);
        } else if (Lab.isDone(flow, run)) {
            places.push([steps[steps.length - 1], 'det sista steget']);
        } else {
            places.push([steps[n], 'steget du är på']);
            if (n) places.push([steps[n - 1], 'steget du nyss gjorde']);
        }
        var select = $('r-note-device');
        select.textContent = '';
        places.forEach(function (p) { select.appendChild(el('option', { value: 'step:' + p[0].id, text: 'På raden för ' + p[0].code + ', ' + p[1] })); });
        flow.devices.forEach(function (d) { select.appendChild(el('option', { value: 'device:' + d.id, text: 'På en egen rad: något jag gjorde på ' + d.name + ' utöver flödet' })); });
        $('r-note-text').value = '';
        $('r-note').classList.remove('display-none');
        $('r-note-text').focus();
    }

    // Alla steg är gjorda. Tabellen visas med det som är kvar att göra.
    function finish() {
        state.justDone = true;
        state.savedLog = false;
        state.copied = false;
        state.toast = '';
        show('table');
    }

    // Ett fel tryck på det sista steget tas tillbaka från tabellen.
    function undoLast() {
        var run = state.run, steps = Lab.view(state.flow);
        if (!run || !run.entries.length) return;
        var last = steps[run.entries.length - 1].code;
        if (Lab.undo(run, Lab.clockNow())) state.toast = 'Trycket för ' + last + ' togs tillbaka. Det står kvar i loggfilen som ångrat.';
        save();
        show('run');
    }

    // Loggen tas bort och flödet står kvar, olåst.
    function dropRun() {
        state.run = null;
        state.savedLog = false;
        state.copied = false;
        state.remark = '';
        state.toast = '';
        save();
    }

    function closeNote(saveIt) {
        if (saveIt && state.note && state.run) {
            var where = $('r-note-device').value, device = where.indexOf('device:') === 0 ? where.slice(7) : '', step = where.indexOf('step:') === 0 ? where.slice(5) : '';
            var ok = Lab.addNote(state.flow, state.run, state.note, $('r-note-text').value, device, step);
            var on = ok && !device ? Lab.view(state.flow).filter(function (x) { return x.id === state.run.notes[state.run.notes.length - 1].step; })[0] : null;
            state.toast = !ok ? 'En tom anteckning sparas inte.' : 'Anteckningen sparades med tiden ' + Lab.timeText(state.note.t, state.note.off) + (on ? ', på raden för ' + on.code : ', på en egen rad') + '.';
            save();
        }
        state.note = null;
        $('r-note').classList.add('display-none');
        if (document.activeElement) document.activeElement.blur();
        renderRun();
    }

    function setParts(node, parts) {
        node.textContent = '';
        parts.forEach(function (p) { node.appendChild(p.code ? el('b', { class: 'code-in', text: p.text }) : document.createTextNode(p.text)); });
    }

    function renderRun() {
        var flow = state.flow, run = state.run, steps = Lab.view(flow), now = Lab.clockNow();
        var done = !!run && Lab.isDone(flow, run), waiting = !!run && Lab.isWaiting(run, now.t);
        var s = run && !done ? steps[run.entries.length] : null;
        // En väntan efter det sista steget räknas ner. Sedan är laborationen klar.
        var mode = !steps.length ? 'empty' : !run ? 'practice' : waiting ? 'wait' : done ? 'done' : 'step';
        var prev = run && run.entries.length ? steps[run.entries.length - 1] : null;
        state.wasWaiting = waiting;
        state.shot = mode === 'step' ? s.code : '';
        $('view-run').setAttribute('data-mode', mode);

        var device = $('r-device');
        device.textContent = '';
        $('r-next').textContent = '';
        if (mode === 'empty') {
            $('r-code').textContent = '–';
            $('r-count').textContent = '';
            $('r-do').textContent = 'Det finns inga steg ännu. Gör flödet under 1 Förbered.';
            $('r-press').textContent = '';
        } else if (mode === 'practice') {
            $('r-code').textContent = 'ÖVA';
            $('r-count').textContent = 'Före start. ' + steps.length + ' steg väntar.';
            $('r-do').textContent = state.practice ? 'Bra, trycket kom ' + Lab.timeText(state.practiceAt.t, state.practiceAt.off) + '. Så gör du efter varje steg: direkt när det är gjort, innan du lägger ifrån dig enheten.' :
                'Öva först: tryck mellanslag nu. Ingenting sparas förrän du startar.';
            $('r-press').textContent = 'Tryck Enter när enheterna ligger framme. Då sparas starttiden och ' + steps[0].code + ' visas.';
        } else if (mode === 'done') {
            $('r-code').textContent = 'KLAR';
            $('r-count').textContent = steps.length + ' av ' + steps.length + ' steg';
            $('r-do').textContent = 'Alla steg är gjorda. Tabellen finns under 3 Tabell.';
            $('r-press').textContent = 'Spara loggen som fil där, så finns den kvar utanför programmet.';
        } else {
            $('r-code').textContent = mode === 'wait' ? 'VÄNTA' : s.code;
            $('r-count').textContent = s ? 'Steg ' + (s.n + 1) + ' av ' + steps.length + ' · ' + s.block : steps.length + ' av ' + steps.length + ' steg';
            if (mode === 'wait') {
                device.appendChild(el('span', { class: 'chip dev-all', text: 'Rör inte enheterna' }));
                $('r-do').textContent = '';
                $('r-do').appendChild(document.createTextNode('Väntan efter ' + prev.code + ': '));
                $('r-do').appendChild(el('b', { id: 'r-left', class: 'code-in', text: Lab.spanText(Math.ceil((run.waitUntil - now.t) / 1000)) }));
                $('r-do').appendChild(document.createTextNode(' kvar.'));
                $('r-press').textContent = s ? 'Mellanslag gäller igen när tiden är ute.' : 'V avbryter väntan.';
                $('r-next').textContent = s ? 'Sedan ' + s.code + ' på ' + s.deviceName + ': ' + s.do : 'Sedan är laborationen klar och tabellen visas.';
            } else {
                device.appendChild(el('span', { class: 'chip ' + deviceClass(s.device), text: s.deviceName }));
                if (s.app) device.appendChild(el('span', { class: 'run-app', text: s.app }));
                setParts($('r-do'), s.parts);
                $('r-press').textContent = 'Tryck mellanslag ' + s.press + '.' + (s.wait ? ' Sedan räknas en väntan på ' + Lab.spanText(s.wait) + ' ner.' : '');
                var next = steps[s.n + 1];
                if (next) $('r-next').textContent = 'Sedan ' + next.code + ' på ' + next.deviceName + '.';
            }
        }

        var showKey = { klar: mode === 'practice' || mode === 'step', hoppad: mode === 'step', note: !!run, approx: !!prev, undo: !!prev, cut: mode === 'wait', start: mode === 'practice' };
        Array.prototype.forEach.call(document.querySelectorAll('#view-run .key[data-act]'), function (b) { b.classList.toggle('display-none', !showKey[b.getAttribute('data-act')]); });
        $('r-end').classList.toggle('display-none', !run);
        $('r-abort').classList.toggle('display-none', !run);
        $('r-store').classList.toggle('display-none', state.stored);
        status('r-toast', state.toast);

        var list = $('r-list'), current = null;
        list.textContent = '';
        steps.forEach(function (x, n) {
            var e = run ? run.entries[n] : null;
            var mark = !e ? '' : e.status === 'hoppad' ? 'hoppad' : (e.approx ? 'ca ' : '') + Lab.timeText(e.t, e.off);
            var li = el('li', { class: (e ? e.status === 'hoppad' ? 'skipped' : 'done' : '') + (s && x.id === s.id ? ' current' : '') }, [
                el('b', { text: x.code }), el('span', { class: 'chip ' + deviceClass(x.device), text: x.deviceName }), el('span', { class: 'list-text', text: (x.app ? x.app + ': ' : '') + x.do }), el('span', { class: 'list-time', text: mark }),
            ]);
            if (s && x.id === s.id) current = li;
            list.appendChild(li);
        });
        if (current) list.scrollTop = current.offsetTop - list.clientHeight / 2;
        else if (done) list.scrollTop = list.scrollHeight;
        paintClock(now);
    }

    // QR-koden med stegets kod och klockan. Den ritas om när sekunden byts, inte oftare: en kod som byts mitt i
    // en exponering går inte att läsa ur bilden.
    function paintQr(now) {
        var qr = $('r-qr'), text = state.shot ? Lab.shotText(state.shot, now.t) : '';
        if (text === state.qr) return;
        state.qr = text;
        var grid = text ? LabQr.encode(text) : null;
        qr.classList.toggle('display-none', !grid);
        if (!grid) return;
        var p = LabQr.svgPath(grid);
        qr.setAttribute('viewBox', '0 0 ' + p.size + ' ' + p.size);
        qr.querySelector('path').setAttribute('d', p.d);
    }

    function paintClock(now) {
        var run = state.run;
        paintQr(now);
        $('r-clock').textContent = Lab.isoLocal(now.t, now.off).slice(11, 21);
        $('r-zone').textContent = Lab.dateText(now.t, now.off) + ' · UTC' + Lab.offsetText(now.off) + (ZONE ? ' · ' + ZONE : '');
        $('r-focus').classList.toggle('display-none', document.hasFocus());
        var last = run && run.entries[run.entries.length - 1];
        $('r-since').textContent = run ? 'Sedan ' + (last ? 'förra trycket' : 'starten') + ': ' + Lab.spanText((now.t - (last ? last.t : run.started)) / 1000) : 'Datorns klocka';
        var left = $('r-left');
        if (left && run) left.textContent = Lab.spanText(Math.ceil((run.waitUntil - now.t) / 1000));
    }

    function tickClock() {
        if (state.view !== 'run') return;
        var now = Lab.clockNow();
        if (state.run && Lab.isWaiting(state.run, now.t) !== state.wasWaiting) {
            if (state.wasWaiting && Lab.isDone(state.flow, state.run)) { state.wasWaiting = false; return finish(); }
            renderRun();
        } else paintClock(now);
    }

    function onKey(e) {
        if (state.view !== 'run' || e.ctrlKey || e.metaKey || e.altKey) return;
        // Medan anteckningen skrivs gäller tangenterna den, också när fokus står på en av dess knappar.
        if (state.note) {
            if (e.key === 'Escape') { e.preventDefault(); closeNote(false); }
            return;
        }
        var tag = e.target && e.target.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
        var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        var kind = { ' ': 'klar', Spacebar: 'klar', Enter: 'start', Backspace: 'undo', h: 'hoppad', a: 'note', t: 'approx', v: 'cut' }[key];
        if (!kind) return;
        e.preventDefault();
        // En tangent som hålls nere är ett tryck, inte många.
        if (!e.repeat) act(kind);
    }

    // ---------- Tabell ----------

    function renderTable() {
        var host = $('t-sheet'), run = state.run, flow = state.flow;
        host.textContent = '';
        ['t-copy', 't-print', 't-csv', 't-save', 't-trace', 't-again'].forEach(function (id) { $(id).disabled = !run; });
        renderNext();
        if (!run) {
            host.appendChild(el('p', { class: 'empty', text: 'Tabellen fylls när laborationen har startat under 2 Genomför. En sparad logg öppnas under Mer i 1 Förbered.' }));
            return;
        }
        var left = flow.steps.length - run.entries.length;
        if (left) host.appendChild(el('p', { class: 'notice', text: 'Laborationen är inte klar: ' + left + ' steg är kvar. De står som inte utförda tills de är gjorda.' }));
        host.appendChild(el('h2', { text: 'Laboration: ' + flow.name }));
        var facts = el('dl', { class: 'facts' });
        Lab.facts(flow, run, PROGRAM).slice(1).forEach(function (f) {
            facts.appendChild(el('dt', { text: f[0] }));
            facts.appendChild(el('dd', { text: f[1] }));
        });
        host.appendChild(facts);

        var body = el('tbody');
        Lab.rows(flow, run).forEach(function (r) {
            var cells = Lab.cells(r);
            var remark = el('td', { class: 'remark' }, [soft('span', {}, cells[4])]);
            if (r.kind === 'step' || r.kind === 'skipped') remark.appendChild(remarkTool(r));
            body.appendChild(el('tr', { class: r.done ? '' : 'undone' }, [
                el('td', { class: 'nowrap', text: cells[0] }), soft('td', {}, cells[1]), soft('td', {}, cells[2]), el('td', { class: 'nowrap code-cell', text: cells[3] }), remark,
            ]));
        });
        host.appendChild(el('table', { class: 'protocol' }, [el('thead', {}, [el('tr', {}, Lab.HEAD.map(function (h) { return el('th', { text: h }); }))]), body]));
    }

    // Det som återstår efter laborationen, i den ordning det görs. Den första knappen som inte är gjord är den blå.
    function renderNext() {
        var run = state.run, done = !!run && Lab.isDone(state.flow, run);
        var first = !run ? '' : !state.savedLog ? 't-save' : !state.copied ? 't-copy' : 't-trace';
        ['t-save', 't-copy', 't-trace'].forEach(function (id) { $(id).className = id === first ? 'primary-btn' : 'secondary-btn'; });
        $('t-n1').classList.toggle('did', state.savedLog);
        $('t-n2').classList.toggle('did', state.copied);
        var line = $('t-done');
        line.classList.toggle('display-none', !done);
        $('t-undo').classList.toggle('display-none', !state.justDone);
        if (done) {
            var e = run.entries[run.entries.length - 1];
            $('t-done-text').textContent = 'Laborationen är klar: alla ' + state.flow.steps.length + ' steg är gjorda, det sista ' + Lab.timeText(e.t, e.off) + '.';
        }
    }

    // Den egna anmärkningen skrivs efteråt på raden. Tiderna går inte att ändra.
    function remarkTool(r) {
        var entry = state.run.entries.filter(function (e) { return e.step === r.step; })[0];
        if (state.remark !== r.step) {
            var open = el('button', { type: 'button', class: 'link-btn', text: entry.remark ? 'Ändra' : 'Anmärkning', 'aria-label': 'Egen anmärkning på ' + r.code });
            open.addEventListener('click', function () { state.remark = r.step; renderTable(); });
            return open;
        }
        var input = el('input', { type: 'text', value: entry.remark || '', maxLength: Lab.LIMITS.text, 'aria-label': 'Egen anmärkning på ' + r.code });
        var form = el('form', { class: 'inline remark-form', autocomplete: 'off' }, [input, el('button', { type: 'submit', class: 'secondary-btn', text: 'Spara' })]);
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            Lab.setRemark(state.run, r.step, input.value);
            state.remark = '';
            changed();
        });
        input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { state.remark = ''; renderTable(); } });
        setTimeout(function () { input.focus(); }, 0);
        return form;
    }

    // ---------- Händelser ----------

    function wire() {
        ['plan', 'run', 'table'].forEach(function (v) { $('tab-' + v).addEventListener('click', function () { show(v); }); });
        $('nav-start').addEventListener('click', function () { show('start'); });
        $('t-trace').addEventListener('click', function () { show('trace'); });
        window.LabTraceView.init({ el: el, soft: soft, copyHtml: copyHtml, printDoc: printDoc, download: download, PROGRAM: PROGRAM });

        // Startsidan
        $('s-q').addEventListener('input', function () { state.q = this.value; renderStart(); });
        $('s-new').addEventListener('click', function () {
            useFlow(Lab.emptyFlow('Laboration ' + today(), 'L', ['Telefon 1', 'Telefon 2']), 'Ett tomt flöde. Klicka på en byggsten till vänster eller dra den till flödet.');
        });
        $('s-wizard').addEventListener('click', openWizard);
        $('s-resume').addEventListener('click', function () { show(state.run ? (Lab.isDone(state.flow, state.run) ? 'table' : 'run') : 'plan'); });
        $('s-read').addEventListener('click', function () { show('trace'); });
        $('s-use').addEventListener('click', usePreview);
        $('s-pv-close').addEventListener('click', closePreview);
        $('s-preview').addEventListener('click', function (e) { if (e.target === this) closePreview(); });
        $('s-pv-drop').addEventListener('click', function () {
            var x = state.preview;
            if (!x || !x.tpl || !confirm('Mallen ' + x.label + ' tas bort från datorn. Steg som redan ligger i ett flöde står kvar. Fortsätta?')) return;
            state.templates = state.templates.filter(function (t) { return t.id !== x.tpl.id; });
            saveTemplates();
            closePreview();
            renderStart();
        });

        // Guiden
        $('w-cancel').addEventListener('click', function () { show('start'); });
        $('w-prev').addEventListener('click', function () { state.wiz.step = Math.max(0, state.wiz.step - 1); renderWizard(); });
        $('w-next').addEventListener('click', function () { state.wiz.step = Math.min(WIZ.length - 1, state.wiz.step + 1); renderWizard(); });
        $('w-create').addEventListener('click', createFromWizard);

        // Förbered
        $('p-name').addEventListener('input', function () { state.flow.name = Lab.clip(this.value, Lab.LIMITS.name); save(); });
        $('p-name').addEventListener('change', function () { state.flow.name = state.flow.name.trim() || 'Laboration'; this.value = state.flow.name; save(); });
        $('p-prefix').addEventListener('change', function () { remember(); state.flow.prefix = Lab.cleanPrefix(this.value); this.value = state.flow.prefix; save(); renderSteps(); renderDetail(); });
        $('p-device-add').addEventListener('click', function () {
            var d;
            change(function () { d = Lab.addDevice(state.flow, 'Telefon ' + (state.flow.devices.length + 1)); if (!d) return false; });
            if (d) { state.devEdit = d.id; state.focus = 'dev-' + d.id; renderDevices(); applyFocus(); }
        });
        $('p-search').addEventListener('input', renderPalette);
        $('p-undo').addEventListener('click', undo);
        $('p-check').addEventListener('click', function () {
            var w = Lab.check(state.flow)[0];
            if (!w) return;
            if (w.group) state.closed[w.group] = false;
            state.flash = w.step || w.group;
            select(w.step ? { step: w.step } : { group: w.group });
        });
        $('p-more').addEventListener('click', function (e) { e.stopPropagation(); toggleMenu(); });
        $('p-menu').addEventListener('click', function (e) { if (e.target.closest('.menu-item')) closeMenu(); });
        document.addEventListener('click', function (e) {
            if (!$('p-menu').classList.contains('display-none') && !e.target.closest('.menu-wrap')) closeMenu();
        });
        $('p-steps').addEventListener('click', function (e) {
            if (e.target.closest('button, a, input, select, textarea')) return;
            var row = e.target.closest('.step'), head = e.target.closest('.group-head');
            if (row) select({ step: row.getAttribute('data-step') });
            else if (head) select({ group: head.getAttribute('data-head') });
            else if (selected()) select(null);
        });
        $('p-steps').addEventListener('keydown', function (e) {
            var row = e.target.closest && e.target.closest('.step');
            if (row && (e.key === 'Enter' || e.key === ' ') && !e.altKey) { e.preventDefault(); state.keepFocus = true; select({ step: row.getAttribute('data-step') }); }
        });
        // Fokus lämnar rutan till höger: nästa ändring där blir en egen ändring för Ångra.
        $('p-detail').addEventListener('focusout', function () { state.typing = false; });
        $('p-save-templates').addEventListener('click', saveTemplateFile);
        $('p-print').addEventListener('click', function () { printDoc(state.flow.name, Lab.checklist(state.flow)); });
        $('p-start').addEventListener('click', function () { show('run'); });
        $('p-open').addEventListener('click', function () { $('p-file').click(); });
        $('p-file').addEventListener('change', function () { var file = this.files[0]; this.value = ''; openFile(file); });
        $('p-save').addEventListener('click', function () { status('p-status', 'Flödet sparades utan logg: ' + saveFile(false)); });
        $('p-reset').addEventListener('click', function () {
            if ((state.run || state.flow.steps.length) && !confirm(state.run ? 'Flödet och loggen tas bort härifrån. Spara loggen som fil först. Fortsätta?' : 'Namnet, enheterna och stegen tas bort. Dina egna mallar ligger kvar. Fortsätta?')) return;
            fresh();
            state.sel = null;
            state.history = [];
            state.closed = {};
            status('p-status', '');
            say('');
            changed();
        });

        // Dra och släpp
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('pointermove', onPointerMove, { passive: false });
        document.addEventListener('pointerup', onPointerUp);
        document.addEventListener('pointercancel', function () { finishDrag(true); });
        document.addEventListener('click', function (e) { if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
        // Ett finger som drar i greppet ska inte rulla sidan.
        document.addEventListener('touchmove', function (e) { if (drag && drag.active) e.preventDefault(); }, { passive: false });

        // Tangenterna i Förbered och på startsidan.
        document.addEventListener('keydown', function (e) {
            var tag = e.target && e.target.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
            if (e.key === 'Escape') {
                if (drag && drag.active) { e.preventDefault(); return finishDrag(true); }
                if (state.preview) { e.preventDefault(); return closePreview(); }
                if (!$('p-menu').classList.contains('display-none')) { e.preventDefault(); return closeMenu(); }
                if (state.view === 'plan' && selected() && !typing) { e.preventDefault(); return select(null); }
            }
            if (state.view !== 'plan' || typing) return;
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'z') { e.preventDefault(); return undo(); }
            if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); return moveSelected(e.key === 'ArrowUp' ? -1 : 1); }
            if (e.key === 'Delete' && selected()) { e.preventDefault(); removeSelected(); }
        });

        // Genomför
        document.addEventListener('keydown', onKey);
        Array.prototype.forEach.call(document.querySelectorAll('#view-run .key[data-act]'), function (b) {
            b.addEventListener('click', function () { act(b.getAttribute('data-act')); });
        });
        $('r-end').addEventListener('click', function () { show('table'); });
        $('r-abort').addEventListener('click', function () {
            var n = state.run ? state.run.entries.length : 0;
            if (!confirm('Laborationen avbryts och loggen' + (n ? ' med ' + n + ' steg' : '') + ' tas bort härifrån. Flödet står kvar och kan ändras och köras igen. Fortsätta?')) return;
            closeNote(false);
            dropRun();
            show('plan');
        });
        $('r-focus').addEventListener('click', function () { dropFocus(); paintClock(Lab.clockNow()); });
        $('r-note').addEventListener('submit', function (e) { e.preventDefault(); closeNote(true); });
        $('r-note-cancel').addEventListener('click', function () { closeNote(false); });
        $('r-note').addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); closeNote(false); }
            else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName === 'TEXTAREA') { e.preventDefault(); closeNote(true); }
        });

        // Tabell
        $('t-copy').addEventListener('click', function () {
            var p = Lab.protocol(state.flow, state.run, PROGRAM);
            copyHtml(p.html, p.text).then(function (ok) {
                if (ok) { state.copied = true; renderNext(); }
                status('t-status', ok ? 'Tabellen är kopierad. Klistra in den i protokollet.' : 'Det gick inte att kopiera. Skriv ut eller spara som CSV i stället.');
            });
        });
        $('t-print').addEventListener('click', function () { printDoc('Laboration: ' + state.flow.name, Lab.protocol(state.flow, state.run, PROGRAM).html); state.copied = true; renderNext(); });
        $('t-csv').addEventListener('click', function () {
            // Teckenmärket först gör att Excel läser å, ä och ö rätt.
            status('t-status', 'Sparade ' + download(String.fromCharCode(0xFEFF) + Lab.toCsv(state.flow, state.run), 'text/csv;charset=utf-8', Lab.fileName(state.flow, state.run, 'csv')));
            state.copied = true;
            renderNext();
        });
        $('t-save').addEventListener('click', function () { status('t-status', 'Sparade ' + saveFile(true)); state.savedLog = true; renderNext(); });
        $('t-undo').addEventListener('click', undoLast);
        $('t-again').addEventListener('click', function () {
            if (!confirm('Loggen tas bort härifrån och flödet kan köras igen. Spara loggen som fil först. Fortsätta?')) return;
            dropRun();
            status('t-status', '');
            show('plan');
        });
        setInterval(tickClock, 100);
    }

    loadTemplates();
    loadRecent();
    if (!restore()) fresh();
    wire();
    // En laboration som pågår öppnas där den är. Annars börjar verktyget på startsidan.
    show(state.run && !Lab.isDone(state.flow, state.run) ? 'run' : 'start');
})();
