// Extraktion: användaren väljer en zip. Innehållsförteckningen gås igenom, katalogernas
// databaser och deras -wal listas, och en vald databas läses ut till minnet och läggs i
// "Kör i appen". Zippen läses bara med File.slice(). Inget packas upp eller sparas på disk.
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var input = $('ex-input');
    var status = $('ex-status');
    var list = $('ex-list');

    var current = null;

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function sizeText(n) {
        if (n >= 1073741824) return (n / 1073741824).toFixed(1).replace('.', ',') + ' GB';
        if (n >= 1048576) return (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
        if (n >= 1024) return Math.round(n / 1024) + ' kB';
        return n + ' byte';
    }

    // Unixtid ur zippen är UTC. Saknas den finns bara DOS-tid, som är lokal tid utan zon.
    function entryTime(e) {
        if (e.mtime) return new Date(e.mtime * 1000).toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
        return e.dosTime ? e.dosTime + ' (zon okänd)' : '';
    }

    function hex(n) { return ('0000000' + n.toString(16)).slice(-8); }

    // Katalogens databaser grupperade per familj. Photos har en databas per iOS-version och
    // samma sökvägar för alla.
    function targets() {
        var app = window.QueriesApp;
        var out = [];
        var byKey = {};
        app.databases().forEach(function (d) {
            if (!d.paths || !d.paths.length) return;
            var key = d.family || d.id;
            if (!byKey[key]) {
                byKey[key] = { key: key, paths: d.paths, dbs: [], title: d.familyTitle || d.label };
                out.push(byKey[key]);
            }
            byKey[key].dbs.push(d);
        });
        return out;
    }

    function dbForVersion(target, version) {
        if (target.dbs.length === 1) return { db: target.dbs[0], guessed: false };
        var major = version ? parseInt(version, 10) : NaN;
        var hit = target.dbs.find(function (d) { return d.ios && major >= d.ios[0] && major <= d.ios[1]; });
        return hit ? { db: hit, guessed: false } : { db: target.dbs[target.dbs.length - 1], guessed: true };
    }

    // lead: rader som ska stå först, t.ex. vilken zip det gäller.
    function zipSource(read, entry, lead) {
        var name = entry.name.slice(entry.name.lastIndexOf('/') + 1);
        return {
            name: name,
            read: async function () {
                var out = await ZipRead.extract(read, entry);
                var line = 'Ur zippen: ' + entry.name + ' (' + entry.size + ' byte, ändrad ' + entryTime(entry) +
                    ', CRC32 ' + hex(entry.crc32) + (out.crcOk ? ' stämmer' : ' STÄMMER INTE') + ')';
                if (!out.crcOk) line += '. Varning: innehållet skiljer sig från det zippen anger.';
                return { bytes: out.bytes, lines: (lead || []).concat([line]) };
            },
        };
    }

    // Etiketten för en träff: katalogens namn, plus var den ligger om det inte är den vanliga platsen.
    function describe(f) {
        var target = targets().find(function (x) { return x.key === f.key; });
        var pick = dbForVersion(target, current.version);
        var notes = [];
        if (!f.primary) notes.push(/Syndication\.photoslibrary/.test(f.db.name) ? 'Delat med dig (Syndication)' : 'annan plats än den vanliga');
        if (f.user) notes.push('användare ' + f.user);
        if (pick.guessed) notes.push('iOS-versionen hittades inte, kontrollera versionen');
        return { db: pick.db, label: pick.db.label, notes: notes, guessed: pick.guessed };
    }

    function summary() {
        var c = current;
        return c.file.name + ' · ' + sizeText(c.file.size) + (c.version ? ' · iOS ' + c.version : '');
    }

    function render() {
        var c = current;
        if (!c.found.length) {
            list.innerHTML = '<p class="muted">Inga av databaserna som Queries har queries för hittades i zippen.</p>';
            return;
        }
        var rows = c.found.map(function (f, i) {
            var d = describe(f);
            var warn = f.journal && f.journal.size ? '-journal finns: databasen kan vara mitt i en transaktion' : '';
            return '<tr' + (c.chosen === i ? ' class="ex-chosen"' : '') + '>' +
                '<td><button type="button" class="ex-use" data-i="' + i + '">' + escapeHtml(d.label) + '</button>' +
                (d.notes.length ? '<div class="ex-note">' + escapeHtml(d.notes.join(' · ')) + '</div>' : '') +
                (warn ? '<div class="run-warn">' + escapeHtml(warn) + '</div>' : '') + '</td>' +
                '<td class="ex-path">' + escapeHtml(f.db.name) + '</td>' +
                '<td>' + sizeText(f.db.size) + '</td>' +
                '<td>' + escapeHtml(entryTime(f.db)) + '</td>' +
                '<td>' + (f.wal ? sizeText(f.wal.size) : '<span class="run-warn">saknas</span>') + '</td>' +
                '</tr>';
        }).join('');
        list.innerHTML = '<div class="ex-summary">' + escapeHtml(summary()) + ' · ' +
            c.scan.count.toLocaleString('sv-SE') + ' poster</div>' +
            '<div class="result-scroll"><table class="ex-table"><thead><tr><th>Databas</th><th>Sökväg i zippen</th>' +
            '<th>Storlek</th><th>Ändrad (enligt zippen)</th><th>-wal</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
        list.querySelectorAll('.ex-use').forEach(function (b) {
            b.addEventListener('click', function () { use(Number(b.getAttribute('data-i'))); });
        });
    }

    // Startsidan visar hela rutan. När en databas är vald krymper den till en rad med byte av
    // databas, och utan extraktion döljs den.
    function layout() {
        var app = window.QueriesApp;
        var inWorkspace = !!app.currentDb();
        var fromZip = app.fromExtraction();
        $('ex-box').classList.toggle('display-none', inWorkspace);
        $('ex-close').classList.toggle('display-none', !current);
        var pickBtn = $('ex-pick');
        pickBtn.textContent = current ? 'Öppna en annan zip…' : 'Öppna extraktion (zip)…';
        pickBtn.classList.toggle('secondary', !!current);
        // I arbetsytan: rullistan under "1. Databas" listar databaserna i extraktionen. Katalogens
        // rullista visas bara när databasen lästs in för hand eller iOS-versionen är okänd.
        var sw = $('ex-switch');
        var guessed = fromZip && current && current.chosen >= 0 && describe(current.found[current.chosen]).guessed;
        sw.classList.toggle('display-none', !inWorkspace || !current);
        $('ex-compact').classList.toggle('display-none', !inWorkspace || !current);
        $('db-select').classList.toggle('display-none', inWorkspace && fromZip && !guessed);
        if (!current || !inWorkspace) return;
        $('ex-compact-name').textContent = summary();
        var html = '';
        current.found.forEach(function (f, i) {
            var d = describe(f);
            html += '<option value="' + i + '"' + (fromZip && current.chosen === i ? ' selected' : '') + '>' +
                escapeHtml(d.label + (d.notes.length ? ' – ' + d.notes.join(', ') : '')) + '</option>';
        });
        html += '<option value="manual"' + (fromZip ? '' : ' selected') + '>Annan databas, filerna läses in för hand…</option>';
        sw.innerHTML = html;
    }

    function use(i) {
        var c = current;
        var f = c.found[i];
        var d = describe(f);
        c.chosen = i;
        window.QueriesApp.selectDb(d.db.id, {
            source: {
                html: 'Databasen' + (f.wal ? ' och <code>-wal</code>' : '') + ' är hämtade ur <code>' +
                    escapeHtml(c.file.name) + '</code>' + (f.wal ? '' : '. Extraktionen har ingen <code>-wal</code>'),
            },
        });
        var zipLine = 'Extraktion: ' + c.file.name + ' (' + c.file.size + ' byte, ändrad ' +
            new Date(c.file.lastModified).toISOString() + ')';
        window.QueriesRun.useSources({
            db: zipSource(c.read, f.db, [zipLine]),
            wal: f.wal ? zipSource(c.read, f.wal) : null,
            zip: c.file.name,
        });
        render();
        layout();
    }

    function close() {
        var wasFromZip = window.QueriesApp.fromExtraction();
        var db = window.QueriesApp.currentDb();
        current = null;
        list.innerHTML = '';
        status.textContent = '';
        window.QueriesApp.setExtraction(null);
        // Rutan Kör i appen ska inte längre peka på zippen.
        if (wasFromZip && db) window.QueriesApp.selectDb(db.id);
        layout();
    }

    async function open(file) {
        close();
        status.textContent = 'Läser zippens innehållsförteckning…';
        var read = ZipRead.fileReader(file);
        var t = targets();
        var started = performance.now();
        var scan = await ZipRead.scan(read, file.size, ZipLocate.keeper(t), function (done, total) {
            status.textContent = 'Läser zippens innehållsförteckning… ' + Math.round(100 * done / total) + ' %';
        });
        var loc = ZipLocate.locate(scan.entries, t);
        var version = null;
        if (loc.systemVersion) {
            try { version = ZipLocate.iosVersion((await ZipRead.extract(read, loc.systemVersion)).bytes); }
            catch (err) { version = null; }
        }
        current = { file: file, read: read, scan: scan, found: loc.found, version: version, chosen: -1 };
        var secs = ((performance.now() - started) / 1000).toFixed(1).replace('.', ',');
        status.textContent = loc.found.length + (loc.found.length === 1 ? ' databas hittades' : ' databaser hittades') +
            ' på ' + secs + ' s.' + (loc.found.length ? ' Välj en här eller bland korten nedan.' : '');
        var families = new Set(loc.found.map(function (f) { return f.key; }));
        window.QueriesApp.setExtraction({
            families: families,
            pick: function (family) {
                var i = current.found.findIndex(function (f) { return f.key === family; });
                if (i >= 0) use(i);
            },
        });
        render();
        layout();
    }

    $('ex-pick').addEventListener('click', function () { input.click(); });
    $('ex-close').addEventListener('click', close);
    $('ex-close-compact').addEventListener('click', close);
    $('ex-switch').addEventListener('change', function () {
        var v = $('ex-switch').value;
        if (v === 'manual') {
            // Samma databas, men utan zippen: Kör i appen väntar på filer.
            var db = window.QueriesApp.currentDb();
            current.chosen = -1;
            window.QueriesApp.selectDb(db.id);
        } else {
            use(Number(v));
        }
    });

    input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        open(file).catch(function (err) {
            current = null;
            list.innerHTML = '';
            window.QueriesApp.setExtraction(null);
            layout();
            status.innerHTML = '<span class="run-warn">' + escapeHtml(err && err.message ? err.message : String(err)) + '</span>';
        });
    });

    document.addEventListener('queries:db-change', function () {
        if (current && !window.QueriesApp.fromExtraction()) current.chosen = -1;
        // Händelsen kommer innan sidan bytt vy, så layouten görs efter.
        setTimeout(function () {
            if (current) render();
            layout();
        }, 0);
    });
})();
