// Flikar i Queries: varje flik har sin egen databas, query, SQL och sitt eget resultat. Läget
// sparas när man byter flik och läggs tillbaka när man kommer tillbaka, så att en query från
// Härkomst öppnas i en ny flik utan att det man redan har uppe försvinner. Extraktionen (zippen)
// är gemensam för alla flikar.
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var bar = $('tabs');
    var note = $('tab-note');

    var seq = 1;
    var tabs = [{ id: 1, snap: null, key: null }];
    var active = 0;

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function capture() {
        return {
            app: window.QueriesApp.snapshot(),
            run: window.QueriesRun.snapshot(),
            ex: window.QueriesExtraction.snapshot(),
        };
    }

    function restore(snap) {
        window.QueriesApp.restore(snap ? snap.app : null);
        if (snap) {
            window.QueriesRun.restore(snap.run);
            window.QueriesExtraction.restore(snap.ex);
            window.scrollTo(0, snap.app && snap.app.scrollY || 0);
        }
    }

    function setNote(html) {
        note.innerHTML = html || '';
        note.classList.toggle('display-none', !html);
    }

    function render() {
        var html = tabs.map(function (t, i) {
            var l = window.QueriesApp.tabLabel(i === active ? null : t.snap && t.snap.app);
            var title = l.title + (l.sub ? ' · ' + l.sub : '');
            return '<div class="q-tab' + (i === active ? ' active' : '') + '" role="tab" aria-selected="' + (i === active) + '">' +
                '<button type="button" class="q-tab-pick" data-i="' + i + '" title="' + escapeHtml(title) + '">' +
                (l.fromProvenance ? '<span class="q-tab-from">Härkomst</span>' : '') +
                '<span class="q-tab-title">' + escapeHtml(l.title) + '</span>' +
                (l.sub ? '<span class="q-tab-sub">' + escapeHtml(l.sub) + '</span>' : '') + '</button>' +
                (tabs.length > 1 ? '<button type="button" class="q-tab-close" data-i="' + i + '" title="Stäng fliken" aria-label="Stäng fliken">×</button>' : '') +
                '</div>';
        }).join('');
        bar.innerHTML = html + '<button type="button" class="q-tab-new secondary" id="tab-new" title="Ny flik med startsidan. Flikarna du har uppe finns kvar.">+ Ny flik</button>';
    }

    function activate(i) {
        if (i === active || !tabs[i]) return;
        tabs[active].snap = capture();
        active = i;
        setNote('');
        restore(tabs[i].snap);
        render();
    }

    function newTab(key) {
        tabs[active].snap = capture();
        tabs.push({ id: ++seq, snap: null, key: key || null });
        active = tabs.length - 1;
        setNote('');
        restore(null);
        render();
    }

    function close(i) {
        if (tabs.length < 2) return;
        if (i === active) {
            tabs.splice(i, 1);
            active = Math.min(i, tabs.length - 1);
            restore(tabs[active].snap);
        } else {
            tabs.splice(i, 1);
            if (i < active) active--;
        }
        setNote('');
        render();
    }

    // Fliken är tom när den visar startsidan: då används den i stället för att öppna en ny.
    function activeIsBlank() {
        return !window.QueriesApp.currentDb();
    }

    // { file, path, walPath, queryId, title, db, sql, from, timeColumns } från Härkomst via huvudfönstret.
    async function openFromProvenance(d) {
        await window.QueriesApp.ready;
        var key = [d.file.name, d.file.size, d.file.lastModified, d.path, d.sql].join('\u0000');
        var existing = tabs.findIndex(function (t) { return t.key === key; });
        if (existing >= 0) {
            activate(existing);
            setNote('Queryn <code>' + escapeHtml(d.queryId) + '</code> var redan öppen, så den fliken visas.');
            return;
        }
        var opened = !activeIsBlank();
        if (opened) newTab(key);
        else tabs[active].key = key;
        try {
            await window.QueriesExtraction.ensure(d.file);
        } catch (err) {
            setNote('<span class="run-warn">Zippen kunde inte öppnas: ' + escapeHtml(err && err.message ? err.message : String(err)) + '</span>');
            return;
        }
        if (!window.QueriesExtraction.useByPath(d.path)) {
            tabs[active].key = null;
            setNote('<span class="run-warn">Databasen ' + escapeHtml(d.path) + ' finns inte bland databaserna som Queries letar efter i zippen. SQL:en står i Härkomsts protokoll.</span>');
            render();
            return;
        }
        window.QueriesApp.showCustom({ queryId: d.queryId, title: d.title, db: d.db, from: d.from, timeColumns: d.timeColumns || null }, d.sql);
        setNote(opened
            ? 'Öppnad i en ny flik. Flikarna du hade uppe finns kvar ovanför.'
            : 'Queryn från Härkomst körs mot samma zip.');
        render();
        await window.QueriesRun.run();
        var box = $('run-box');
        if (box) box.scrollIntoView({ block: 'start' });
    }

    bar.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.id === 'tab-new') { newTab(); return; }
        var i = Number(b.getAttribute('data-i'));
        if (b.classList.contains('q-tab-close')) close(i);
        else activate(i);
    });

    // Fliken byter namn när databas eller query byts.
    document.addEventListener('queries:db-change', function () { setTimeout(render, 0); });
    document.addEventListener('queries:query-change', function () { setTimeout(render, 0); });

    window.QueriesTabs = { openFromProvenance: openFromProvenance, newTab: newTab, count: function () { return tabs.length; } };
    window.QueriesApp.ready.then(render);
})();
