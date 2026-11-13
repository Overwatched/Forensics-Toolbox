// Laboration: tre vyer över samma flöde. Förbered bygger stegen, Genomför visar ett steg i taget med datorns
// klocka och loggar trycken, Tabell visar loggen som den ska stå i protokollet. Allt räknande görs i lab-core.js.
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

    // edit: steget som ändras ({ id, draft }) eller skrivs nytt ({ id: '', target, draft }). groupEdit: gruppen vars
    // ruta är öppen. mark: platsen där nästa byggsten hamnar. history: flödet före varje ändring, för Ångra.
    // templates: de egna mallarna. closed: grupper vars steg är dolda. drag: det som dras just nu. quick: om det
    // färdiga upplägget visas (null: bara när flödet är tomt). note: klockan när A trycktes. remark: raden vars
    // anmärkning ändras i tabellen. practice: antal övningstryck före start.
    var state = { flow: null, run: null, setup: null, view: 'plan', edit: null, groupEdit: null, mark: null, history: [], templates: [], closed: {}, palClosed: {}, drag: null, quick: null, flash: null, focus: null, said: '',
        note: null, remark: '', practice: 0, practiceAt: null, toast: '', wasWaiting: false, stored: true };

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

    function show(view) {
        state.view = view;
        ['plan', 'run', 'table'].forEach(function (v) {
            $('view-' + v).classList.toggle('display-none', v !== view);
            $('tab-' + v).classList.toggle('active', v === view);
            $('tab-' + v).setAttribute('aria-selected', v === view ? 'true' : 'false');
        });
        dropFocus();
        if (view === 'run') { try { window.focus(); } catch (e) { /* ramen får fokus när användaren klickar */ } }
        render();
    }

    function render() {
        if (state.view === 'plan') { renderSetup(); renderSteps(); }
        else if (state.view === 'run') renderRun();
        else renderTable();
    }

    // En knapp som behåller fokus skulle ta nästa mellanslag som ett klick på sig själv.
    function dropFocus() {
        var a = document.activeElement;
        if (a && a.tagName === 'BUTTON') a.blur();
    }

    function status(id, text) { $(id).textContent = text || ''; }

    // ---------- Förbered: valen ----------

    function allApps() { return Lab.cleanApps(Lab.APPS.concat(state.setup.extra)); }
    function chosenApps() { return allApps().filter(function (a) { return state.setup.apps.indexOf(a) >= 0; }); }
    function spec() {
        return { name: state.flow.name, prefix: state.flow.prefix, devices: state.flow.devices.map(function (d) { return d.name; }), pair: state.setup.pair, apps: chosenApps(), blocks: state.setup.blocks };
    }

    // De två enheter och den app som en chattmall eller ett chattsteg från byggstenarna får.
    function context() {
        var d = state.flow.devices, p = state.setup.pair;
        var a = d[Math.min(p[0], d.length - 1)], b = d[Math.min(p[1], d.length - 1)];
        return { a: a ? a.id : '', b: b && b !== a ? b.id : '', app: state.setup.app };
    }

    function tick(checked, label, desc, disabled, onChange) {
        var box = el('input', { type: 'checkbox', checked: checked, disabled: disabled });
        box.addEventListener('change', function () { onChange(box.checked); });
        return el('label', { class: 'tick' }, [box, el('span', {}, [el('span', { class: 'tick-label', text: label }), desc ? el('span', { class: 'tick-desc', text: desc }) : null])]);
    }

    function toggle(list, value, on) {
        var at = list.indexOf(value);
        if (on && at < 0) list.push(value);
        if (!on && at >= 0) list.splice(at, 1);
    }

    function renderSetup() {
        var locked = !!state.run, flow = state.flow;
        $('p-locked').classList.toggle('display-none', !locked);
        $('p-name').value = flow.name;
        $('p-prefix').value = flow.prefix;
        $('p-app').value = state.setup.app;
        ['p-name', 'p-prefix', 'p-device-add', 'p-app-own', 'p-app-add', 'p-create', 'p-app', 'p-search', 'p-quick-open'].forEach(function (id) { $(id).disabled = locked; });
        $('p-device-add').disabled = locked || flow.devices.length >= Lab.LIMITS.devices;
        // Det färdiga upplägget visas av sig självt så länge flödet är tomt, och annars när det har öppnats.
        var quick = !locked && (state.quick === true || (state.quick !== false && !flow.groups.length));
        $('p-quick').classList.toggle('display-none', !quick);
        $('p-quick-open').setAttribute('aria-expanded', quick ? 'true' : 'false');

        var host = $('p-devices');
        host.textContent = '';
        flow.devices.forEach(function (d, n) {
            var input = el('input', { type: 'text', value: d.name, maxLength: Lab.LIMITS.name, disabled: locked, autocomplete: 'off', 'aria-label': 'Enhet ' + (n + 1) });
            var renamed = function () { renderPair(); renderPreview(); if (!state.edit && !state.groupEdit) renderSteps(); save(); };
            input.addEventListener('input', function () { d.name = Lab.clip(input.value, Lab.LIMITS.name); renamed(); });
            input.addEventListener('change', function () { d.name = d.name.trim() || 'Enhet ' + (n + 1); input.value = d.name; renamed(); });
            var remove = el('button', { type: 'button', class: 'icon-btn', text: '−', title: 'Ta bort enheten', 'aria-label': 'Ta bort enheten ' + d.name, disabled: locked || flow.devices.length < 2 });
            remove.addEventListener('click', function () {
                var used = flow.steps.filter(function (s) { return s.device === d.id; }).length;
                if (used && !confirm(used + ' steg görs på ' + d.name + ' och tas bort tillsammans med enheten. Fortsätta?')) return;
                remember();
                Lab.removeDevice(flow, d.id);
                state.setup.pair = [0, 1];
                state.edit = state.groupEdit = null;
                changed();
            });
            host.appendChild(el('div', { class: 'row' }, [el('span', { class: 'dot dev-' + (n % 4) }), input, remove]));
        });
        renderPair();

        host = $('p-apps');
        host.textContent = '';
        allApps().forEach(function (app) {
            host.appendChild(tick(state.setup.apps.indexOf(app) >= 0, app, '', locked, function (on) { toggle(state.setup.apps, app, on); save(); renderPreview(); }));
        });
        var list = $('l-apps');
        list.textContent = '';
        allApps().concat(['Kamera', 'Bilder', 'Inställningar']).forEach(function (app) { list.appendChild(el('option', { value: app })); });

        host = $('p-blocks');
        host.textContent = '';
        var kind = null;
        Lab.BLOCKS.forEach(function (b) {
            if ((b.kind || '') !== kind && b.id !== 'clock-start') {
                kind = b.kind || '';
                host.appendChild(el('p', { class: 'tick-head', text: kind === 'chat' ? 'I varje vald app' : 'På enheterna' }));
            }
            host.appendChild(tick(state.setup.blocks.indexOf(b.id) >= 0, b.label, b.desc, locked, function (on) { toggle(state.setup.blocks, b.id, on); save(); renderPreview(); }));
        });
        renderPreview();
        renderPalette();
    }

    function renderPair() {
        var devices = state.flow.devices;
        ['p-pair-a', 'p-pair-b'].forEach(function (id, side) {
            var select = $(id);
            select.textContent = '';
            devices.forEach(function (d, n) { select.appendChild(el('option', { value: String(n), text: d.name || 'Enhet ' + (n + 1) })); });
            select.value = String(Math.min(state.setup.pair[side], devices.length - 1));
            select.disabled = !!state.run || devices.length < 2;
        });
    }

    function renderPreview() {
        var e = Lab.estimate(Lab.buildFlow(spec()));
        var same = state.flow.devices.length > 1 && $('p-pair-a').value === $('p-pair-b').value;
        $('p-preview').textContent = same ? 'Välj två olika enheter för chattarna.' : e.steps ? 'Valet ger ' + sizeText(e) + '.' : 'Valet ger inga steg.';
    }

    function createSteps() {
        var next = Lab.buildFlow(spec());
        if (!next.steps.length) return status('p-status', 'Valet ger inga steg. Kryssa för minst en del.');
        if (state.flow.steps.length && !confirm('Stegen som finns nu ersätts av ' + next.steps.length + ' nya. Fortsätta?')) return;
        remember();
        state.flow = next;
        state.edit = state.groupEdit = state.mark = state.quick = null;
        status('p-status', next.steps.length + ' steg skapades.');
        changed();
    }

    // ---------- Förbered: byggstenarna ----------

    var CAMERA = ['photo', 'video', 'screenshot', 'edit-date'];
    var STEP_KINDS = [
        ['Chatt', function (a) { return !!a.chat; }],
        ['Kamera och bilder', function (a) { return CAMERA.indexOf(a.id) >= 0; }],
        ['Enheten', function (a) { return !a.chat && CAMERA.indexOf(a.id) < 0 && a.id !== 'custom'; }],
    ];

    // En byggsten i listan: ett klick lägger den vid märket i flödet, och den går att dra till en plats.
    function palItem(kind, id, label, desc, showDesc) {
        var b = el('button', { type: 'button', class: 'pal-item pal-' + kind, draggable: !state.run, disabled: !!state.run, 'data-kind': kind, 'data-id': id, title: desc || '' },
            [el('span', { class: 'pal-label', text: label }), desc && showDesc ? el('span', { class: 'pal-desc', text: desc }) : null]);
        b.addEventListener('click', function () { place(kind, id, mark()); });
        b.addEventListener('dragstart', function (e) { startDrag({ kind: kind, id: id }, e); });
        b.addEventListener('dragend', endDrag);
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
            var remove = el('button', { type: 'button', class: 'icon-btn', text: '−', title: 'Ta bort mallen', 'aria-label': 'Ta bort mallen ' + t.label });
            remove.addEventListener('click', function () {
                if (!confirm('Mallen ' + t.label + ' tas bort från datorn. Steg som redan ligger i ett flöde står kvar. Fortsätta?')) return;
                state.templates = state.templates.filter(function (x) { return x.id !== t.id; });
                saveTemplates();
                renderPalette();
            });
            host.appendChild(el('div', { class: 'pal-own' }, [palItem('template', t.id, t.label, t.desc || t.steps.length + ' steg', true), remove]));
        });

        var extra = [['custom', 'x', 'Eget steg', 'Ett steg med din egen text.'], ['group', 'x', 'Ny grupp', 'En tom grupp med en egen rubrik, att fylla med steg.'],
            ['wait', 'x', 'Väntan', 'En väntan efter steget före märket. Under väntan tas inga tryck emot.']].filter(function (x) { return hit(x[2], x[3]); });
        if (extra.length) head('Eget');
        extra.forEach(function (x) { host.appendChild(palItem(x[0], x[1], x[2], x[3], true)); });

        STEP_KINDS.forEach(function (k) {
            var actions = Lab.ACTIONS.filter(function (a) { return k[1](a) && hit(a.label, a.do); });
            if (actions.length) head('Steg: ' + k[0]);
            actions.forEach(function (a) { host.appendChild(palItem('action', a.id, a.label, a.do.replace(/\{kod\}/g, 'koden').replace(/\{förra\}/g, 'koden före').replace(/\{andra\}/g, 'den andra enheten').replace(/\{app\}/g, 'appen').replace(/\{enhet\}/g, 'enheten'), false)); });
        });
        if (!top.firstChild) top.appendChild(el('p', { class: 'hint', text: 'Ingen byggsten heter så.' }));
    }

    function templateById(id) {
        return Lab.BLOCKS.concat(state.templates).filter(function (t) { return t.id === id; })[0] || null;
    }

    // ---------- Förbered: märket, ändringar och Ångra ----------

    function groupIndex(id) { return state.flow.groups.findIndex(function (g) { return g.id === id; }); }
    function groupSteps(id) { return state.flow.steps.filter(function (s) { return s.group === id; }); }

    // Märket är platsen där nästa byggsten hamnar: { at } mellan två grupper, eller { group, pos } i en grupp.
    // Ett märke som inte längre stämmer med flödet gäller inte, och då är platsen sist.
    function mark() {
        var m = state.mark, flow = state.flow;
        if (m && m.group && groupIndex(m.group) >= 0) return { group: m.group, pos: Math.min(m.pos, groupSteps(m.group).length) };
        if (m && m.at != null && m.at <= flow.groups.length) return { at: m.at };
        return { at: flow.groups.length };
    }
    function sameTarget(x, y) { return !!x && !!y && (x.group ? x.group === y.group && x.pos === y.pos : !y.group && x.at === y.at); }

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
        if (fn() === false) state.history.pop();
        changed();
    }

    function undo() {
        if (state.run || !state.history.length) return;
        state.flow = JSON.parse(state.history.pop());
        state.edit = state.groupEdit = state.mark = null;
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

    // Lägger en byggsten på platsen t. kind: template (en mall blir en grupp), action (ett steg), custom (ett eget
    // steg, som först skrivs i formuläret), group (en tom grupp) och wait (väntan efter steget före platsen).
    function place(kind, id, t) {
        if (state.run) return;
        var flow = state.flow, c = context();
        if (kind === 'custom') {
            state.edit = { id: '', target: t, draft: newDraft(t) };
            state.groupEdit = null;
            say('');
            return renderSteps();
        }
        change(function () {
            if (kind === 'template') {
                var tpl = templateById(id), index = t.group ? groupIndex(t.group) + 1 : t.at;
                var made = tpl ? Lab.insertTemplate(flow, tpl, c, index) : null;
                if (!made) {
                    say(!tpl ? 'Mallen finns inte kvar.' : tpl.kind === 'chat' && !(c.a && c.b) ? 'En chattmall behöver två olika enheter. Välj dem under Chattsteg görs i.' :
                        'Mallen ryms inte. Ett flöde har högst ' + Lab.LIMITS.steps + ' steg och ' + Lab.LIMITS.groups + ' grupper.');
                    return false;
                }
                state.mark = { at: index + 1 };
                state.flash = made.group.id;
                say(made.missing ? made.missing + ' steg i mallen är skrivna för fler enheter än flödet har. De ligger nu på ' + flow.devices[0].name + '.' :
                    t.group ? 'Mallen blev en egen grupp, efter gruppen där märket stod.' : '');
            } else if (kind === 'group') {
                var g = Lab.addGroup(flow, { title: 'Ny grupp', a: c.a, b: c.b }, t.group ? groupIndex(t.group) + 1 : t.at);
                if (!g) { say('Flödet har redan ' + Lab.LIMITS.groups + ' grupper.'); return false; }
                state.groupEdit = g.id;
                state.edit = null;
                state.mark = { group: g.id, pos: 0 };
                state.flash = g.id;
            } else if (kind === 'wait') {
                var before = stepBefore(t);
                if (!before) { say('En väntan ligger efter ett steg. Sätt märket efter steget som väntan ska följa på.'); return false; }
                if (!before.wait) Lab.updateStep(flow, before.id, { wait: 60 });
                state.flash = before.id;
                say('Väntan ligger efter steget före märket. Ändra längden i rutan.');
            } else {
                var a = Lab.ACTION[id], p = a ? stepPlace(t) : null, group = p && flow.groups[groupIndex(p.group)];
                if (!group) return false;
                var o = { group: p.group, pos: p.pos };
                if (!group.a && c.a) o.device = c.a;
                if (!group.a && c.b && a.chat) o.other = c.b;
                if ((a.chat || a.needsApp) && !group.app) o.app = c.app;
                var step = Lab.addStep(flow, a.id, o);
                if (!step) { say('Flödet har redan ' + Lab.LIMITS.steps + ' steg.'); return false; }
                // Gruppens första chattsteg ger gruppen dess app, så att appen sedan går att byta för hela gruppen.
                if (a.chat && !group.app && step.app && groupSteps(group.id).filter(function (s) { return Lab.ACTION[s.action].chat; }).length === 1) group.app = step.app;
                state.closed[p.group] = false;
                state.mark = { group: p.group, pos: p.pos + 1 };
                state.flash = step.id;
            }
        });
    }

    // ---------- Förbered: dra och släpp ----------

    // Det som dras är { kind, id }: en byggsten ur listan (kind som i place), ett steg i flödet (step) eller en hel
    // grupp (move-group). Mallar och grupper släpps mellan grupper, steg var som helst.
    function wholeGroup(kind) { return kind === 'template' || kind === 'group' || kind === 'move-group'; }

    function startDrag(what, e) {
        if (state.run) return e.preventDefault();
        state.drag = what;
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'copyMove';
            try { e.dataTransfer.setData('text/plain', what.kind); } catch (err) { /* draget fungerar ändå */ }
        }
        // Luckorna görs större först när draget har börjat. En ändring av sidan i samma ögonblick avbryter draget.
        setTimeout(function () { if (state.drag) $('p-steps').setAttribute('data-drag', wholeGroup(what.kind) ? 'group' : 'step'); }, 0);
    }

    function clearOver() {
        Array.prototype.forEach.call($('p-steps').querySelectorAll('.slot.over'), function (s) { s.classList.remove('over'); });
    }

    function endDrag() {
        state.drag = null;
        $('p-steps').removeAttribute('data-drag');
        clearOver();
    }

    // Platsen under pekaren. Över en lucka gäller luckan. Över ett steg gäller luckan före eller efter det, och över
    // en grupp dess början eller slut, beroende på vilken halva pekaren är i.
    function targetAt(e) {
        var whole = wholeGroup(state.drag.kind), flow = state.flow;
        var node = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentNode;
        if (!node || !node.closest) return null;
        var upper = function (box) { var r = box.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; };
        var slot = node.closest('.slot'), row = node.closest('.step, .wait-row'), box = node.closest('.group');
        var at = box ? groupIndex(box.getAttribute('data-group')) : -1;
        if (slot && slot.hasAttribute('data-at')) return { at: Number(slot.getAttribute('data-at')) };
        if (at < 0) return { at: flow.groups.length };
        var id = flow.groups[at].id, count = groupSteps(id).length;
        if (whole) return { at: upper(box) ? at : at + 1 };
        if (slot) return { group: id, pos: Number(slot.getAttribute('data-pos')) };
        if (row) return { group: id, pos: Number(row.getAttribute('data-pos')) + (row.classList.contains('step') && upper(row) ? 0 : 1) };
        return { group: id, pos: node.closest('.group-head') ? 0 : count };
    }

    function slotFor(t) {
        return $('p-steps').querySelector(t.group ? '.slot[data-group="' + t.group + '"][data-pos="' + t.pos + '"]' : '.slot[data-at="' + t.at + '"]');
    }

    function onDragOver(e) {
        if (!state.drag) return;
        var t = targetAt(e);
        if (!t) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = state.drag.kind === 'step' || state.drag.kind === 'move-group' ? 'move' : 'copy';
        var slot = slotFor(t);
        if (slot && slot.classList.contains('over')) return;
        clearOver();
        if (slot) slot.classList.add('over');
    }

    function onDrop(e) {
        if (!state.drag) return;
        e.preventDefault();
        var d = state.drag, t = targetAt(e), flow = state.flow;
        endDrag();
        if (!t) return;
        if (d.kind === 'step') {
            change(function () {
                var p = stepPlace(t);
                if (!p) return false;
                var from = groupSteps(p.group).findIndex(function (s) { return s.id === d.id; });
                Lab.moveStepTo(flow, d.id, p.group, from >= 0 && from < p.pos ? p.pos - 1 : p.pos);
                state.edit = state.mark = null;
                state.flash = d.id;
            });
        } else if (d.kind === 'move-group') {
            change(function () {
                var from = groupIndex(d.id);
                if (from < 0 || t.at == null) return false;
                Lab.moveGroup(flow, d.id, from < t.at ? t.at - 1 : t.at);
                state.mark = null;
                state.flash = d.id;
            });
        } else place(d.kind, d.id, t);
    }

    // ---------- Förbered: flödet ----------

    function button(cls, text, title, onClick, label) {
        var b = el('button', { type: 'button', class: cls, text: text, title: title, 'aria-label': label || title });
        b.addEventListener('click', onClick);
        return b;
    }

    // En lucka i flödet: en plats att släppa på och att sätta märket på. På märket står vad som går att lägga dit.
    function slot(t, marked) {
        var attrs = t.group ? { 'data-group': t.group, 'data-pos': String(t.pos) } : { 'data-at': String(t.at) };
        var node = el('div', Object.assign({ class: 'slot' + (marked ? ' marked' : '') + (t.group ? '' : ' slot-group') }, attrs));
        if (state.run) return node;
        if (!marked) {
            node.appendChild(button('slot-add', '+', 'Lägg till här', function () { state.mark = t; state.edit = null; say(''); renderSteps(); }));
            return node;
        }
        node.appendChild(el('span', { class: 'slot-text', text: 'Nästa byggsten hamnar här.' }));
        node.appendChild(button('link-btn', 'Eget steg', 'Skriv ett eget steg här', function () { place('custom', 'x', t); }));
        node.appendChild(button('link-btn', 'Ny grupp', 'En tom grupp här', function () { place('group', 'x', t); }));
        return node;
    }

    // Väntan efter ett steg står på en egen rad, där längden går att ändra och väntan går att ta bort.
    function waitRow(s, pos) {
        var minutes = s.wait % 60 === 0;
        var size = el('input', { type: 'number', class: 'wait-size', value: String(minutes ? s.wait / 60 : s.wait), min: '1', max: String(Lab.LIMITS.wait), step: '1', 'aria-label': 'Väntans längd efter ' + s.code, disabled: !!state.run });
        var unit = el('select', { class: 'wait-unit', 'aria-label': 'Enhet för väntan efter ' + s.code, disabled: !!state.run });
        [['60', 'minuter'], ['1', 'sekunder']].forEach(function (u) { unit.appendChild(el('option', { value: u[0], text: u[1] })); });
        unit.value = minutes ? '60' : '1';
        var set = function () {
            var n = Math.round(Number(size.value) * Number(unit.value));
            change(function () { Lab.updateStep(state.flow, s.id, { wait: n > 0 ? n : s.wait }); });
        };
        size.addEventListener('change', set);
        unit.addEventListener('change', set);
        var row = el('div', { class: 'wait-row', 'data-pos': String(pos), 'data-wait': s.id }, [el('span', { class: 'wait-label', text: 'Väntan' }), size, unit,
            el('span', { class: 'hint', text: 'Under väntan tas inga tryck emot.' })]);
        if (!state.run) row.appendChild(button('icon-btn', '−', 'Ta bort väntan', function () { change(function () { Lab.updateStep(state.flow, s.id, { wait: 0 }); }); }, 'Ta bort väntan efter ' + s.code));
        return row;
    }

    function stepRow(s, pos, warnings) {
        var locked = !!state.run, flow = state.flow;
        var line = el('p', { class: 'step-do' });
        s.parts.forEach(function (p) { line.appendChild(p.code ? el('b', { class: 'code-in', text: p.text }) : document.createTextNode(p.text)); });
        if (!s.do) line.appendChild(el('i', { text: 'Ingen text ännu.' }));
        var text = el('div', { class: 'step-text' }, [line, el('p', { class: 'step-press', text: 'Klart ' + s.press + '.' })]);
        warnings.forEach(function (w) { text.appendChild(el('p', { class: 'step-warn', text: w.text })); });
        var row = el('div', { class: 'step' + (warnings.length ? ' has-warn' : ''), 'data-step': s.id, 'data-pos': String(pos), draggable: !locked }, [
            el('span', { class: 'step-code', text: s.code }),
            el('span', { class: 'step-who' }, [el('span', { class: 'chip ' + deviceClass(s.device), text: s.deviceName }), s.app ? el('span', { class: 'step-app', text: s.app }) : null]),
            text,
        ]);
        if (locked) return row;
        row.addEventListener('dragstart', function (e) {
            // Ett drag som börjar i ett fält eller på en knapp är inte ett drag av steget.
            if (e.target !== row) return;
            startDrag({ kind: 'step', id: s.id }, e);
        });
        row.addEventListener('dragend', endDrag);
        var move = function (dir) { return function () { change(function () { state.edit = null; state.mark = null; state.flash = s.id; return Lab.moveStep(flow, s.id, dir); }); }; };
        row.appendChild(el('span', { class: 'step-tools' }, [
            button('icon-btn', '↑', 'Flytta upp', move(-1), 'Flytta upp ' + s.code),
            button('icon-btn', '↓', 'Flytta ner', move(1), 'Flytta ner ' + s.code),
            button('icon-btn', 'Ändra', 'Ändra steget', function () {
                var raw = flow.steps.filter(function (x) { return x.id === s.id; })[0];
                state.edit = { id: s.id, draft: draftOf(raw) };
                state.groupEdit = null;
                renderSteps();
            }, 'Ändra ' + s.code),
            button('icon-btn', '−', 'Ta bort steget', function () { change(function () { state.edit = null; Lab.removeStep(flow, s.id); }); }, 'Ta bort ' + s.code),
        ]));
        return row;
    }

    function groupHead(g, n, count) {
        var locked = !!state.run, flow = state.flow, closed = !!state.closed[g.id];
        var names = [g.a, g.b].map(function (id) { return (flow.devices.filter(function (d) { return d.id === id; })[0] || {}).name || ''; });
        // Appen och paret står bara på en grupp där något steg görs mot den andra enheten.
        var chat = g.steps.some(function (s) { return !!s.other; });
        var meta = g.steps.length + ' steg' + (g.waitS ? ' · väntan ' + Lab.spanText(g.waitS) : '') + (chat && g.app ? ' · ' + g.app : '') + (chat && names[0] && names[1] ? ' · ' + names[0] + ' och ' + names[1] : '');
        var fold = button('fold-btn', closed ? '▸' : '▾', closed ? 'Visa stegen' : 'Dölj stegen', function () { state.closed[g.id] = !closed; renderSteps(); }, (closed ? 'Visa stegen i ' : 'Dölj stegen i ') + g.title);
        fold.setAttribute('aria-expanded', closed ? 'false' : 'true');
        var head = el('div', { class: 'group-head', draggable: !locked }, [fold, el('h3', { class: 'block', text: g.title }), el('span', { class: 'group-meta', text: meta })]);
        if (locked) return head;
        head.addEventListener('dragstart', function (e) { if (e.target === head) startDrag({ kind: 'move-group', id: g.id }, e); });
        head.addEventListener('dragend', endDrag);
        var move = function (to) { return function () { change(function () { state.mark = null; state.flash = g.id; return Lab.moveGroup(flow, g.id, to); }); }; };
        var up = button('icon-btn', '↑', 'Flytta gruppen upp', move(n - 1), 'Flytta upp gruppen ' + g.title);
        var down = button('icon-btn', '↓', 'Flytta gruppen ner', move(n + 1), 'Flytta ner gruppen ' + g.title);
        up.disabled = n === 0;
        down.disabled = n === count - 1;
        head.appendChild(el('span', { class: 'step-tools' }, [up, down,
            button('icon-btn', 'Ändra', 'Ändra gruppen: rubrik, app, enheter, kopia och mall', function () {
                state.groupEdit = state.groupEdit === g.id ? null : g.id;
                state.edit = null;
                renderSteps();
            }, 'Ändra gruppen ' + g.title),
            button('icon-btn', '−', 'Ta bort gruppen och dess steg', function () {
                change(function () { state.edit = state.groupEdit = null; Lab.removeGroup(flow, g.id); });
                if (g.steps.length) say('Gruppen ' + g.title + ' och dess ' + g.steps.length + ' steg togs bort. Ångra lägger tillbaka dem.');
            }, 'Ta bort gruppen ' + g.title),
        ]));
        return head;
    }

    function renderSteps() {
        var host = $('p-steps'), locked = !!state.run, flow = state.flow, ed = state.edit;
        var groups = Lab.outline(flow), warnings = Lab.check(flow), m = mark(), keep = host.scrollTop;
        var total = flow.steps.length;
        host.textContent = '';
        host.classList.toggle('is-empty', !groups.length);
        $('p-summary').textContent = total ? sizeText(Lab.estimate(flow)) : 'Inga steg ännu';
        $('p-add').disabled = locked || total >= Lab.LIMITS.steps;
        $('p-undo').disabled = locked || !state.history.length;
        $('p-print').disabled = !total;
        $('p-start').disabled = !total;
        $('p-start').textContent = state.run ? 'Tillbaka till genomförandet' : 'Till genomförandet';
        $('p-check').classList.toggle('display-none', !warnings.length);
        $('p-check').textContent = warnings.length === 1 ? '1 sak att se över' : warnings.length + ' saker att se över';
        $('p-note').textContent = state.said || '';
        if (!groups.length && !ed) {
            host.appendChild(el('p', { class: 'empty', text: locked ? 'Flödet har inga steg.' :
                'Flödet är tomt. Klicka på en byggsten till vänster eller dra den hit, så hamnar den här. En mall ger en hel grupp av steg, och med Eget steg skriver du själv vad som ska göras.' }));
        }
        var newHere = function (t) { return ed && !ed.id && sameTarget(ed.target, t); };
        var put = function (parent, t) {
            if (newHere(t)) parent.appendChild(editor());
            parent.appendChild(slot(t, !locked && !ed && sameTarget(m, t)));
        };
        put(host, { at: 0 });
        groups.forEach(function (g, n) {
            var box = el('section', { class: 'group', 'data-group': g.id }, [groupHead(g, n, groups.length)]);
            if (state.groupEdit === g.id && !locked) box.appendChild(groupPanel(g));
            if (!state.closed[g.id]) {
                var body = el('div', { class: 'group-body' });
                put(body, { group: g.id, pos: 0 });
                g.steps.forEach(function (s, pos) {
                    if (ed && ed.id === s.id) body.appendChild(editor());
                    else body.appendChild(stepRow(s, pos, warnings.filter(function (w) { return w.step === s.id; })));
                    if (s.wait) body.appendChild(waitRow(s, pos));
                    put(body, { group: g.id, pos: pos + 1 });
                });
                if (!g.steps.length) body.appendChild(el('p', { class: 'step-warn group-empty', text: 'Gruppen har inga steg ännu. Klicka på en byggsten eller dra ett steg hit.' }));
                box.appendChild(body);
            }
            host.appendChild(box);
            put(host, { at: n + 1 });
        });
        host.scrollTop = keep;
        var show = host.querySelector('.editor, .group-panel');
        var lit = state.flash ? host.querySelector('[data-step="' + state.flash + '"], [data-group="' + state.flash + '"].group') : null;
        state.flash = null;
        if (lit) lit.classList.add('flash');
        if (lit || show) (lit || show).scrollIntoView({ block: 'nearest' });
        if (state.focus) {
            var f = host.querySelector('[data-focus="' + state.focus + '"]');
            state.focus = null;
            if (f) f.focus();
        }
    }

    // ---------- Förbered: gruppens ruta och stegets formulär ----------

    function field(label, control, wide) { return el('label', { class: 'ed-field' + (wide ? ' wide' : '') }, [el('span', { class: 'field', text: label }), control]); }

    function deviceSelect(value, none, all) {
        var select = el('select', {});
        if (none) select.appendChild(el('option', { value: '', text: none }));
        state.flow.devices.forEach(function (x) { select.appendChild(el('option', { value: x.id, text: x.name })); });
        if (all) select.appendChild(el('option', { value: Lab.ALL, text: 'Alla enheter' }));
        select.value = value || '';
        return select;
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
        say((merged.added ? 'Mallen ' + tpl.label + ' ligger nu under Mina mallar.' : 'En mall med samma innehåll fanns redan under Mina mallar.') +
            (stored ? '' : ' Den här webbläsaren sparar inte mellan omstarter, så spara mallarna som fil.'));
    }

    function groupPanel(g) {
        var flow = state.flow, form = el('form', { class: 'group-panel', autocomplete: 'off' });
        var apply = function (key, o) {
            change(function () {
                state.focus = key;
                if (Lab.updateGroup(flow, g.id, o)) return true;
                say('Gruppen ändrades inte. De två enheterna måste vara olika.');
                return false;
            });
        };
        var title = el('input', { type: 'text', value: g.title, maxLength: Lab.LIMITS.name, 'data-focus': 'g-title' });
        title.addEventListener('change', function () { apply('g-title', { title: title.value }); });
        var app = el('input', { type: 'text', value: g.app, maxLength: Lab.LIMITS.name, list: 'l-apps', 'data-focus': 'g-app', placeholder: 'Ingen' });
        app.addEventListener('change', function () { apply('g-app', { app: app.value }); });
        var a = deviceSelect(g.a, 'Ingen'), b = deviceSelect(g.b, 'Ingen');
        a.setAttribute('data-focus', 'g-a');
        b.setAttribute('data-focus', 'g-b');
        a.addEventListener('change', function () { apply('g-a', { a: a.value }); });
        b.addEventListener('change', function () { apply('g-b', { b: b.value }); });
        form.appendChild(field('Rubrik', title, true));
        form.appendChild(field('App för gruppens chattsteg', app));
        form.appendChild(el('span', {}));
        form.appendChild(field('Från, den som börjar', a));
        form.appendChild(field('Till, den andra', b));
        form.appendChild(el('p', { class: 'hint wide', text: 'Ett byte här ändrar alla steg i gruppen: stegen som gjordes på den ena enheten görs på den nya, och stegen i gruppens app görs i den nya appen.' }));

        var swap = button('secondary-btn', 'Byt riktning', 'De två enheterna byter plats i alla gruppens steg', function () { apply('g-swap', { swap: true }); });
        swap.disabled = !(g.a && g.b);
        swap.setAttribute('data-focus', 'g-swap');
        var copy = button('secondary-btn', 'Kopiera gruppen', 'En kopia av gruppen, direkt efter den', function () {
            change(function () {
                var made = Lab.copyGroup(flow, g.id);
                if (!made) { say('Kopian ryms inte. Ett flöde har högst ' + Lab.LIMITS.steps + ' steg och ' + Lab.LIMITS.groups + ' grupper.'); return false; }
                state.groupEdit = made.id;
                state.flash = made.id;
                say('Kopian ligger efter gruppen. Byt app eller enheter i den här rutan.');
            });
        });
        var name = el('input', { type: 'text', value: g.title, maxLength: Lab.LIMITS.name, 'aria-label': 'Namn på mallen', class: 'tpl-name' });
        var store = button('secondary-btn', 'Spara som mall', 'Gruppen sparas under Mina mallar, och går sedan att lägga in för andra enheter och appar', function () {
            saveAsTemplate({ group: g.id }, name.value || g.title);
        });
        store.disabled = !g.steps.length;
        var close = button('primary-btn', 'Klar', 'Stäng rutan', function () { state.groupEdit = null; renderSteps(); });
        form.appendChild(el('div', { class: 'inline wide wrap' }, [swap, copy]));
        form.appendChild(el('div', { class: 'inline wide wrap' }, [el('span', { class: 'field', text: 'Mallens namn' }), name, store]));
        form.appendChild(el('div', { class: 'inline wide' }, [close]));
        form.addEventListener('submit', function (e) { e.preventDefault(); });
        form.addEventListener('keydown', function (e) { if (e.key === 'Escape') { state.groupEdit = null; renderSteps(); } });
        return form;
    }

    function draftOf(s) { return { action: s.action, device: s.device, other: s.other, app: s.app, do: s.do, done: s.done, press: s.press, wait: s.wait }; }

    // Ett eget steg börjar på samma enhet som steget före platsen, annars på den första av de två som chattar.
    function newDraft(t) {
        var prev = stepBefore(t), c = context(), g = t.group ? state.flow.groups[groupIndex(t.group)] : null;
        var device = prev && prev.device !== Lab.ALL ? prev.device : (g && g.a) || c.a || Lab.ALL;
        return { action: 'custom', device: device, other: '', app: '', do: '', done: '', press: Lab.ACTION.custom.press, wait: 0 };
    }

    function editor() {
        var ed = state.edit, d = ed.draft, flow = state.flow, a = Lab.ACTION[d.action] || Lab.ACTION.custom;
        var form = el('form', { class: 'editor', autocomplete: 'off' });
        var bind = function (control, key) { control.addEventListener('input', function () { d[key] = control.value; }); return control; };
        var uses = function (word) { return (d.do + ' ' + d.done).indexOf('{' + word + '}') >= 0; };
        var more = el('details', { class: 'more wide' }, [el('summary', { text: 'Mer: app, den andra enheten, väntan och texten i protokollet' })]);
        var grid = el('div', { class: 'more-grid' });
        more.appendChild(grid);
        more.open = !!ed.more;
        more.addEventListener('toggle', function () { ed.more = more.open; });

        form.appendChild(el('p', { class: 'ed-title wide', text: ed.id ? 'Ändra steget: ' + a.label : 'Eget steg' }));
        var what = bind(el('textarea', { value: d.do, rows: 2, maxLength: Lab.LIMITS.text, placeholder: 'Till exempel: Öppna Kartor och sök efter Stockholm.', 'data-focus': 'ed-do' }), 'do');
        form.appendChild(field('Vad ska göras?', what, true));
        form.appendChild(field('Görs på', bind(deviceSelect(d.device, '', true), 'device')));
        var other = field('Den andra enheten', bind(deviceSelect(d.other, 'Ingen'), 'other'));
        var app = field('App', bind(el('input', { type: 'text', value: d.app, maxLength: Lab.LIMITS.name, list: 'l-apps' }), 'app'));
        // Det som steget använder står framme, och resten ligger under Mer.
        (a.chat || uses('andra') ? form : grid).appendChild(other);
        (a.chat || a.needsApp || uses('app') ? form : grid).appendChild(app);
        grid.appendChild(field('Väntan efter steget, sekunder', bind(el('input', { type: 'number', value: String(d.wait || 0), min: '0', max: String(Lab.LIMITS.wait), step: '1' }), 'wait')));
        grid.appendChild(field('Mellanslag trycks', bind(el('input', { type: 'text', value: d.press, maxLength: Lab.LIMITS.text }), 'press')));
        grid.appendChild(field('I protokollet, i förfluten tid', bind(el('textarea', { value: d.done, rows: 2, maxLength: Lab.LIMITS.text, placeholder: 'Tomt ger samma text som ovan' }), 'done'), true));
        grid.appendChild(el('p', { class: 'hint wide', text: 'I texterna byts {kod} mot stegets kod, {förra} mot koden före, {andra} mot den andra enheten, {enhet} mot enheten och {app} mot appen.' }));
        if (ed.id) {
            var name = el('input', { type: 'text', value: a.id === 'custom' ? Lab.clip(d.do, 40).trim() : a.label, maxLength: Lab.LIMITS.name, 'aria-label': 'Namn på mallen', class: 'tpl-name' });
            var store = button('secondary-btn', 'Spara steget som mall', 'Steget sparas under Mina mallar, som det står i flödet nu', function () { saveAsTemplate({ step: ed.id }, name.value); });
            grid.appendChild(el('div', { class: 'inline wide wrap' }, [el('span', { class: 'field', text: 'Mallens namn' }), name, store]));
        }
        form.appendChild(more);

        var note = el('p', { class: 'status', role: 'status' });
        var cancel = button('secondary-btn', 'Avbryt', 'Stäng utan att spara', function () { state.edit = null; renderSteps(); });
        form.appendChild(el('div', { class: 'inline wide' }, [el('button', { type: 'submit', class: 'primary-btn', text: ed.id ? 'Spara steget' : 'Lägg till steget' }), cancel, note]));
        form.addEventListener('keydown', function (e) { if (e.key === 'Escape') { state.edit = null; renderSteps(); } });
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (!String(d.do).trim()) { note.textContent = 'Skriv vad som ska göras.'; what.focus(); return; }
            change(function () {
                state.edit = null;
                if (ed.id) { Lab.updateStep(flow, ed.id, d); state.flash = ed.id; return; }
                var p = stepPlace(ed.target);
                var step = p ? Lab.addStep(flow, 'custom', Object.assign({}, d, { group: p.group, pos: p.pos })) : null;
                if (!step) { say('Flödet har redan ' + Lab.LIMITS.steps + ' steg.'); return false; }
                state.closed[p.group] = false;
                state.mark = { group: p.group, pos: p.pos + 1 };
                state.flash = step.id;
            });
        });
        if (!ed.shown) { ed.shown = true; state.focus = 'ed-do'; }
        return form;
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
            state.edit = state.groupEdit = state.mark = state.quick = null;
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
        state.edit = state.groupEdit = null;
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
            else { Lab.press(flow, run, now, kind); state.toast = ''; }
        } else if (kind === 'undo') {
            state.toast = Lab.undo(run, now) ? 'Trycket för ' + last + ' togs tillbaka. Det står kvar i loggfilen som ångrat.' : 'Det finns inget tryck att ångra.';
        } else if (kind === 'approx') {
            var marked = Lab.toggleApprox(run);
            state.toast = marked === null ? 'Det finns inget gjort steg att märka.' : marked ? 'Tiden för ' + last + ' är märkt som ungefärlig.' : 'Märket är borta: tiden för ' + last + ' gäller som den är.';
        } else if (kind === 'cut') {
            state.toast = Lab.cutWait(run, now) ? 'Väntan avbröts. Det står på raden i tabellen.' : 'Ingen väntan pågår.';
        } else if (kind === 'note') {
            return openNote(now);
        }
        save();
        renderRun();
    }

    function openNote(now) {
        state.note = now;
        $('r-note-label').textContent = 'Anteckning med tiden ' + Lab.timeText(now.t, now.off) + ', när du tryckte A';
        var select = $('r-note-device');
        select.textContent = '';
        select.appendChild(el('option', { value: '', text: 'Nej, bara en anteckning' }));
        state.flow.devices.forEach(function (d) { select.appendChild(el('option', { value: d.id, text: 'Ja, på ' + d.name })); });
        $('r-note-text').value = '';
        $('r-note').classList.remove('display-none');
        $('r-note-text').focus();
    }

    // Loggen tas bort och flödet står kvar, olåst.
    function dropRun() {
        state.run = null;
        state.remark = '';
        state.toast = '';
        save();
    }

    function closeNote(saveIt) {
        if (saveIt && state.note && state.run) {
            var ok = Lab.addNote(state.flow, state.run, state.note, $('r-note-text').value, $('r-note-device').value);
            state.toast = ok ? 'Anteckningen sparades med tiden ' + Lab.timeText(state.note.t, state.note.off) + '.' : 'En tom anteckning sparas inte.';
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
        var mode = !steps.length ? 'empty' : !run ? 'practice' : done ? 'done' : waiting ? 'wait' : 'step';
        var prev = run && run.entries.length ? steps[run.entries.length - 1] : null;
        state.wasWaiting = waiting;
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
            $('r-count').textContent = 'Steg ' + (s.n + 1) + ' av ' + steps.length + ' · ' + s.block;
            if (mode === 'wait') {
                device.appendChild(el('span', { class: 'chip dev-all', text: 'Rör inte enheterna' }));
                $('r-do').textContent = '';
                $('r-do').appendChild(document.createTextNode('Väntan efter ' + prev.code + ': '));
                $('r-do').appendChild(el('b', { id: 'r-left', class: 'code-in', text: Lab.spanText(Math.ceil((run.waitUntil - now.t) / 1000)) }));
                $('r-do').appendChild(document.createTextNode(' kvar.'));
                $('r-press').textContent = 'Mellanslag gäller igen när tiden är ute.';
                $('r-next').textContent = 'Sedan ' + s.code + ' på ' + s.deviceName + ': ' + s.do;
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

    function paintClock(now) {
        var run = state.run;
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
        if (state.run && Lab.isWaiting(state.run, now.t) !== state.wasWaiting) renderRun();
        else paintClock(now);
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
        ['t-copy', 't-print', 't-csv', 't-save', 't-again'].forEach(function (id) { $(id).disabled = !run; });
        if (!run) {
            host.appendChild(el('p', { class: 'empty', text: 'Tabellen fylls när laborationen har startat under 2 Genomför. En sparad logg öppnas under 1 Förbered.' }));
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

        $('p-name').addEventListener('input', function () { state.flow.name = Lab.clip(this.value, Lab.LIMITS.name); save(); });
        $('p-name').addEventListener('change', function () { state.flow.name = state.flow.name.trim() || 'Laboration'; this.value = state.flow.name; save(); });
        $('p-prefix').addEventListener('change', function () { state.flow.prefix = Lab.cleanPrefix(this.value); this.value = state.flow.prefix; changed(); });
        $('p-device-add').addEventListener('click', function () { change(function () { Lab.addDevice(state.flow, 'Telefon ' + (state.flow.devices.length + 1)); }); });
        ['p-pair-a', 'p-pair-b'].forEach(function (id, side) {
            $(id).addEventListener('change', function () {
                // Den som väljer samma enhet i båda rutorna menar att de två ska byta plats.
                var n = Number(this.value) || 0, pair = state.setup.pair;
                if (n === pair[1 - side]) pair[1 - side] = pair[side];
                pair[side] = n;
                save();
                renderPair();
                renderPreview();
            });
        });
        $('p-pair-swap').addEventListener('click', function () { state.setup.pair.reverse(); save(); renderPair(); renderPreview(); });
        $('p-app').addEventListener('change', function () {
            state.setup.app = Lab.cleanApps([this.value])[0] || state.setup.app;
            this.value = state.setup.app;
            save();
        });
        $('p-search').addEventListener('input', renderPalette);
        $('p-quick-open').addEventListener('click', function () { state.quick = $('p-quick').classList.contains('display-none'); renderSetup(); });
        $('p-quick-close').addEventListener('click', function () { state.quick = false; renderSetup(); });
        $('p-undo').addEventListener('click', undo);
        $('p-check').addEventListener('click', function () {
            var first = $('p-steps').querySelector('.step-warn');
            if (!first) {
                // Varningen står i en grupp vars steg är dolda.
                state.closed = {};
                renderSteps();
                first = $('p-steps').querySelector('.step-warn');
            }
            if (first) first.scrollIntoView({ block: 'center' });
        });
        $('p-steps').addEventListener('dragover', onDragOver);
        $('p-steps').addEventListener('drop', onDrop);
        $('p-save-templates').addEventListener('click', saveTemplateFile);
        document.addEventListener('keydown', function (e) {
            var tag = e.target && e.target.tagName;
            if (state.view !== 'plan' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || String(e.key).toLowerCase() !== 'z') return;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            e.preventDefault();
            undo();
        });
        var addApp = function () {
            var name = Lab.cleanApps([$('p-app-own').value])[0];
            if (!name) return;
            var known = allApps().filter(function (a) { return a.toLowerCase() === name.toLowerCase(); })[0];
            if (!known) state.setup.extra.push(name);
            toggle(state.setup.apps, known || name, true);
            $('p-app-own').value = '';
            changed();
        };
        $('p-app-add').addEventListener('click', addApp);
        $('p-app-own').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addApp(); } });
        $('p-create').addEventListener('click', createSteps);
        $('p-add').addEventListener('click', function () { place('custom', 'x', mark()); });
        $('p-print').addEventListener('click', function () { printDoc(state.flow.name, Lab.checklist(state.flow)); });
        $('p-start').addEventListener('click', function () { show('run'); });
        $('p-open').addEventListener('click', function () { $('p-file').click(); });
        $('p-file').addEventListener('change', function () { var file = this.files[0]; this.value = ''; openFile(file); });
        $('p-save').addEventListener('click', function () { status('p-status', 'Flödet sparades utan logg: ' + saveFile(false)); });
        $('p-reset').addEventListener('click', function () {
            if ((state.run || state.flow.steps.length) && !confirm(state.run ? 'Flödet och loggen tas bort härifrån. Spara loggen som fil först. Fortsätta?' : 'Namnet, enheterna och stegen tas bort. Dina egna mallar ligger kvar. Fortsätta?')) return;
            fresh();
            state.edit = state.groupEdit = state.mark = state.quick = null;
            state.history = [];
            state.closed = {};
            status('p-status', '');
            say('');
            changed();
        });

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

        $('t-copy').addEventListener('click', function () {
            var p = Lab.protocol(state.flow, state.run, PROGRAM);
            copyHtml(p.html, p.text).then(function (ok) { status('t-status', ok ? 'Tabellen är kopierad. Klistra in den i protokollet.' : 'Det gick inte att kopiera. Skriv ut eller spara som CSV i stället.'); });
        });
        $('t-print').addEventListener('click', function () { printDoc('Laboration: ' + state.flow.name, Lab.protocol(state.flow, state.run, PROGRAM).html); });
        $('t-csv').addEventListener('click', function () {
            // Teckenmärket först gör att Excel läser å, ä och ö rätt.
            status('t-status', 'Sparade ' + download(String.fromCharCode(0xFEFF) + Lab.toCsv(state.flow, state.run), 'text/csv;charset=utf-8', Lab.fileName(state.flow, state.run, 'csv')));
        });
        $('t-save').addEventListener('click', function () { status('t-status', 'Sparade ' + saveFile(true)); });
        $('t-again').addEventListener('click', function () {
            if (!confirm('Loggen tas bort härifrån och flödet kan köras igen. Spara loggen som fil först. Fortsätta?')) return;
            dropRun();
            status('t-status', '');
            show('plan');
        });
        setInterval(tickClock, 100);
    }

    loadTemplates();
    if (!restore()) fresh();
    wire();
    show(state.run && !Lab.isDone(state.flow, state.run) ? 'run' : 'plan');
})();
