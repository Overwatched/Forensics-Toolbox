// Laboration: tre vyer över samma flöde. Förbered bygger stegen, Genomför visar ett steg i taget med datorns
// klocka och loggar trycken, Tabell visar loggen som den ska stå i protokollet. Allt räknande görs i lab-core.js.
// Flödet och loggen sparas i webbläsarens lagring efter varje ändring, så att en omstart inte tappar något.
(function () {
    'use strict';

    var Lab = window.LabCore;
    var VERSION = new URLSearchParams(location.search).get('version') || '';
    var PROGRAM = 'Forensics Toolbox' + (VERSION ? ' ' + VERSION : '');
    var STORE = 'ft-laboration';
    var DEFAULT_BLOCKS = ['clock-start', 'chat-text', 'chat-media', 'chat-group', 'chat-delete', 'camera', 'lock-power', 'clock-end'];
    var ZONE = '';
    try { ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { ZONE = ''; }

    // edit: steget som ändras eller läggs till, { id, at, draft }. note: klockan när A trycktes. remark: raden vars
    // anmärkning ändras i tabellen. practice: antal övningstryck före start.
    var state = { flow: null, run: null, setup: null, view: 'plan', edit: null, note: null, remark: '', practice: 0, practiceAt: null, toast: '', wasWaiting: false, stored: true };

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
        return {
            pair: [pair[0] || 0, pair.length > 1 ? pair[1] : 1],
            apps: s.apps ? Lab.cleanApps(s.apps) : ['WhatsApp', 'Signal'],
            extra: Lab.cleanApps(s.extra),
            blocks: (Array.isArray(s.blocks) ? s.blocks : DEFAULT_BLOCKS).filter(function (id) { return ids.indexOf(id) >= 0; }),
        };
    }

    function save() {
        try {
            localStorage.setItem(STORE, JSON.stringify({ file: Lab.toFile(state.flow, state.run, PROGRAM, Lab.clockNow()), setup: state.setup }));
            state.stored = true;
        } catch (e) { state.stored = false; }
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
        ['p-name', 'p-prefix', 'p-device-add', 'p-app-own', 'p-app-add', 'p-create'].forEach(function (id) { $(id).disabled = locked; });
        $('p-device-add').disabled = locked || flow.devices.length >= Lab.LIMITS.devices;

        var host = $('p-devices');
        host.textContent = '';
        flow.devices.forEach(function (d, n) {
            var input = el('input', { type: 'text', value: d.name, maxLength: Lab.LIMITS.name, disabled: locked, autocomplete: 'off', 'aria-label': 'Enhet ' + (n + 1) });
            var renamed = function () { renderPair(); renderPreview(); if (!state.edit) renderSteps(); save(); };
            input.addEventListener('input', function () { d.name = Lab.clip(input.value, Lab.LIMITS.name); renamed(); });
            input.addEventListener('change', function () { d.name = d.name.trim() || 'Enhet ' + (n + 1); input.value = d.name; renamed(); });
            var remove = el('button', { type: 'button', class: 'icon-btn', text: '✕', title: 'Ta bort enheten', 'aria-label': 'Ta bort enheten ' + d.name, disabled: locked || flow.devices.length < 2 });
            remove.addEventListener('click', function () {
                var used = flow.steps.filter(function (s) { return s.device === d.id; }).length;
                if (used && !confirm(used + ' steg görs på ' + d.name + ' och tas bort tillsammans med enheten. Fortsätta?')) return;
                Lab.removeDevice(flow, d.id);
                state.setup.pair = [0, 1];
                state.edit = null;
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
    }

    function renderPair() {
        var devices = state.flow.devices;
        $('p-pair').classList.toggle('display-none', devices.length < 2);
        ['p-pair-a', 'p-pair-b'].forEach(function (id, side) {
            var select = $(id);
            select.textContent = '';
            devices.forEach(function (d, n) { select.appendChild(el('option', { value: String(n), text: d.name || 'Enhet ' + (n + 1) })); });
            select.value = String(Math.min(state.setup.pair[side], devices.length - 1));
            select.disabled = !!state.run;
        });
    }

    function renderPreview() {
        var e = Lab.estimate(Lab.buildFlow(spec()));
        var same = state.flow.devices.length > 1 && $('p-pair-a').value === $('p-pair-b').value;
        $('p-preview').textContent = same ? 'Välj två olika enheter för chattarna.' : e.steps ? 'Valet ger ' + sizeText(e) + '.' : 'Valet ger inga steg.';
    }

    function createSteps() {
        var next = Lab.buildFlow(spec());
        if (!next.steps.length) return status('p-status', 'Valet ger inga steg. Kryssa för minst ett standardflöde.');
        if (state.flow.steps.length && !confirm('Stegen som finns nu ersätts av ' + next.steps.length + ' nya. Fortsätta?')) return;
        state.flow = next;
        state.edit = null;
        status('p-status', next.steps.length + ' steg skapades.');
        changed();
    }

    // ---------- Förbered: stegen ----------

    function renderSteps() {
        var host = $('p-steps'), locked = !!state.run, steps = Lab.view(state.flow), block = null, ed = state.edit;
        host.textContent = '';
        $('p-summary').textContent = steps.length ? sizeText(Lab.estimate(state.flow)) : 'Inga steg ännu';
        $('p-add').disabled = locked || steps.length >= Lab.LIMITS.steps;
        $('p-print').disabled = !steps.length;
        $('p-start').disabled = !steps.length;
        $('p-start').textContent = state.run ? 'Tillbaka till genomförandet' : 'Till genomförandet';
        if (!steps.length && !ed) {
            host.appendChild(el('p', { class: 'empty', text: 'Välj enheter, appar och standardflöden till vänster och tryck Skapa stegen. Egna steg läggs till ett i taget med Lägg till steg.' }));
        }
        steps.forEach(function (s, n) {
            if (ed && !ed.id && ed.at === n) host.appendChild(editor());
            if (s.block !== block) {
                block = s.block;
                host.appendChild(el('h3', { class: 'block', text: block }));
            }
            var line = el('p', { class: 'step-do' });
            s.parts.forEach(function (p) { line.appendChild(p.code ? el('b', { class: 'code-in', text: p.text }) : document.createTextNode(p.text)); });
            var row = el('div', { class: 'step', 'data-step': s.id }, [
                el('span', { class: 'step-code', text: s.code }),
                el('span', { class: 'step-who' }, [el('span', { class: 'chip ' + deviceClass(s.device), text: s.deviceName }), s.app ? el('span', { class: 'step-app', text: s.app }) : null]),
                el('div', { class: 'step-text' }, [line, el('p', { class: 'step-press', text: 'Klart ' + s.press + '.' + (s.wait ? ' Därefter väntan ' + Lab.spanText(s.wait) + '.' : '') })]),
            ]);
            if (!locked) {
                var tools = el('span', { class: 'step-tools' });
                [['Ändra', 'Ändra steget', function () { state.edit = { id: s.id, at: n, draft: draftOf(state.flow.steps[n]) }; }],
                    ['↑', 'Flytta upp', function () { Lab.moveStep(state.flow, s.id, -1); }],
                    ['↓', 'Flytta ner', function () { Lab.moveStep(state.flow, s.id, 1); }],
                    ['+', 'Nytt steg efter det här', function () { state.edit = { id: '', at: n + 1, draft: newDraft(n + 1) }; }],
                    ['✕', 'Ta bort steget', function () { Lab.removeStep(state.flow, s.id); }],
                ].forEach(function (b) {
                    var button = el('button', { type: 'button', class: 'icon-btn', text: b[0], title: b[1], 'aria-label': b[1] + ' ' + s.code });
                    button.addEventListener('click', function () {
                        if (b[0] !== 'Ändra' && b[0] !== '+') state.edit = null;
                        b[2]();
                        changed();
                    });
                    tools.appendChild(button);
                });
                row.appendChild(tools);
            }
            host.appendChild(row);
            if (ed && ed.id === s.id) host.appendChild(editor());
        });
        if (ed && !ed.id && ed.at >= steps.length) host.appendChild(editor());
        var form = host.querySelector('.editor');
        if (form) form.scrollIntoView({ block: 'nearest' });
    }

    function draftOf(s) { return { action: s.action, device: s.device, other: s.other, app: s.app, do: s.do, done: s.done, press: s.press, wait: s.wait }; }

    // Ett nytt steg börjar som en byggsten, på samma enhet och i samma app som steget före.
    function newDraft(at) {
        var flow = state.flow, prev = flow.steps[at - 1];
        var a = Lab.ACTION[flow.devices.length > 1 ? 'text' : 'photo'];
        var device = prev && prev.device !== Lab.ALL ? prev.device : flow.devices[0] ? flow.devices[0].id : Lab.ALL;
        var others = flow.devices.filter(function (d) { return d.id !== device; });
        return { action: a.id, device: device, other: prev && prev.other && prev.other !== device ? prev.other : others[0] ? others[0].id : '',
            app: a.app || (prev && prev.app) || chosenApps()[0] || '', do: a.do, done: a.done, press: a.press, wait: 0 };
    }

    function field(label, control, wide) { return el('label', { class: 'ed-field' + (wide ? ' wide' : '') }, [el('span', { class: 'field', text: label }), control]); }

    function editor() {
        var ed = state.edit, d = ed.draft, flow = state.flow;
        var form = el('form', { class: 'editor', autocomplete: 'off' });
        var bind = function (control, key) { control.addEventListener('input', function () { d[key] = control.value; }); return control; };

        if (!ed.id) {
            var action = el('select', {});
            [['Chatt', true], ['Enhet', false]].forEach(function (g) {
                var group = el('optgroup', { label: g[0] });
                Lab.ACTIONS.filter(function (a) { return !!a.chat === g[1]; }).forEach(function (a) { group.appendChild(el('option', { value: a.id, text: a.label })); });
                action.appendChild(group);
            });
            action.value = d.action;
            action.addEventListener('change', function () {
                var a = Lab.ACTION[action.value];
                d.action = a.id;
                d.do = a.do;
                d.done = a.done;
                d.press = a.press;
                d.app = a.app || (a.chat || a.needsApp ? d.app || chosenApps()[0] || '' : '');
                renderSteps();
            });
            form.appendChild(field('Byggsten', action, true));
        }

        var device = el('select', {}), other = el('select', {});
        flow.devices.forEach(function (x) {
            device.appendChild(el('option', { value: x.id, text: x.name }));
            other.appendChild(el('option', { value: x.id, text: x.name }));
        });
        device.appendChild(el('option', { value: Lab.ALL, text: 'Alla enheter' }));
        other.insertBefore(el('option', { value: '', text: 'Ingen' }), other.firstChild);
        device.value = d.device;
        other.value = d.other;
        form.appendChild(field('Görs på', bind(device, 'device')));
        form.appendChild(field('Den andra enheten', bind(other, 'other')));
        form.appendChild(field('App', bind(el('input', { type: 'text', value: d.app, maxLength: Lab.LIMITS.name, list: 'l-apps' }), 'app')));
        form.appendChild(field('Väntan efter steget, sekunder', bind(el('input', { type: 'number', value: String(d.wait || 0), min: '0', max: String(Lab.LIMITS.wait), step: '1' }), 'wait')));
        form.appendChild(field('Gör så här', bind(el('textarea', { value: d.do, rows: 2, maxLength: Lab.LIMITS.text }), 'do'), true));
        form.appendChild(field('I protokollet, i förfluten tid', bind(el('textarea', { value: d.done, rows: 2, maxLength: Lab.LIMITS.text, placeholder: 'Tomt ger samma text som ovan' }), 'done'), true));
        form.appendChild(field('Mellanslag trycks', bind(el('input', { type: 'text', value: d.press, maxLength: Lab.LIMITS.text }), 'press'), true));
        form.appendChild(el('p', { class: 'hint wide', text: '{kod} byts mot stegets kod, {förra} mot koden före, {andra} mot den andra enheten, {enhet} mot enheten och {app} mot appen.' }));
        var note = el('p', { class: 'status', role: 'status' });
        var cancel = el('button', { type: 'button', class: 'secondary-btn', text: 'Avbryt' });
        cancel.addEventListener('click', function () { state.edit = null; renderSteps(); });
        form.appendChild(el('div', { class: 'inline wide' }, [el('button', { type: 'submit', class: 'primary-btn', text: ed.id ? 'Spara steget' : 'Lägg till steget' }), cancel, note]));
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (!String(d.do).trim()) { note.textContent = 'Skriv vad som ska göras.'; return; }
            if (ed.id) Lab.updateStep(flow, ed.id, d);
            else Lab.addStep(flow, d.action, d, ed.at);
            state.edit = null;
            changed();
        });
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
        return download(JSON.stringify(Lab.toFile(state.flow, run, PROGRAM, Lab.clockNow()), null, 2), 'application/json', Lab.fileName(state.flow, run, 'json'));
    }

    function openFile(file) {
        if (!file) return;
        if (file.size > 5e6) return status('p-status', 'Filen är för stor för att vara ett flöde eller en logg.');
        file.text().then(function (text) {
            var back = Lab.fromFile(text);
            if ((state.run || state.flow.steps.length) && !confirm('Det som finns här nu ersätts av filens innehåll. Fortsätta?')) return;
            state.flow = back.flow;
            state.run = back.run;
            state.edit = null;
            state.setup.pair = [0, 1];
            save();
            status('p-status', back.run ? 'Loggen är öppnad: ' + back.run.entries.length + ' av ' + back.flow.steps.length + ' steg har ett tryck.' : 'Flödet är öppnat: ' + back.flow.steps.length + ' steg.');
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
        state.edit = null;
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
        $('p-device-add').addEventListener('click', function () { Lab.addDevice(state.flow, 'Telefon ' + (state.flow.devices.length + 1)); changed(); });
        ['p-pair-a', 'p-pair-b'].forEach(function (id, side) {
            $(id).addEventListener('change', function () { state.setup.pair[side] = Number(this.value) || 0; save(); renderPreview(); });
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
        $('p-add').addEventListener('click', function () {
            var at = state.flow.steps.length;
            state.edit = { id: '', at: at, draft: newDraft(at) };
            renderSteps();
        });
        $('p-print').addEventListener('click', function () { printDoc(state.flow.name, Lab.checklist(state.flow)); });
        $('p-start').addEventListener('click', function () { show('run'); });
        $('p-open').addEventListener('click', function () { $('p-file').click(); });
        $('p-file').addEventListener('change', function () { var file = this.files[0]; this.value = ''; openFile(file); });
        $('p-save').addEventListener('click', function () { status('p-status', 'Flödet sparades utan logg: ' + saveFile(false)); });
        $('p-reset').addEventListener('click', function () {
            if ((state.run || state.flow.steps.length) && !confirm(state.run ? 'Flödet och loggen tas bort härifrån. Spara loggen som fil först. Fortsätta?' : 'Stegen tas bort. Fortsätta?')) return;
            fresh();
            state.edit = null;
            status('p-status', '');
            changed();
        });

        document.addEventListener('keydown', onKey);
        Array.prototype.forEach.call(document.querySelectorAll('#view-run .key[data-act]'), function (b) {
            b.addEventListener('click', function () { act(b.getAttribute('data-act')); });
        });
        $('r-end').addEventListener('click', function () { show('table'); });
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
            state.run = null;
            state.remark = '';
            state.toast = '';
            save();
            status('t-status', '');
            show('plan');
        });
        setInterval(tickClock, 100);
    }

    if (!restore()) fresh();
    wire();
    show(state.run && !Lab.isDone(state.flow, state.run) ? 'run' : 'plan');
})();
