// Extraktion: användaren väljer en zip. Innehållsförteckningen gås igenom, katalogernas
// databaser och deras -wal listas, och en vald databas läses ut till minnet och läggs i
// "Kör i appen". Zippen läses bara med File.slice(). Inget packas upp eller sparas på disk.
// Själva läsningen ligger i extraction-core.js, som Härkomst också använder.
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var input = $('ex-input');
    var status = $('ex-status');
    var list = $('ex-list');

    var current = null;

    // Huvudfönstrets extraktion: zippen som senast öppnades eller stängdes i något verktyg, med
    // löpnummer. Öppningar görs i tur och ordning, så att en query från Härkomst och läget från
    // huvudfönstret inte läser samma zip två gånger samtidigt.
    var shared = { seq: 0, file: null, from: '' };
    var chain = Promise.resolve();
    function serial(fn) {
        var p = chain.then(fn);
        chain = p.catch(function () {});
        return p;
    }

    // Undersökaren öppnade eller stängde en zip här: huvudfönstret och Härkomst får veta det.
    function announceExtraction(file) {
        if (window.parent === window) return;
        window.parent.postMessage({ source: 'forensics-toolbox', type: 'extraction-changed', file: file || null }, '*');
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    var sizeText = ExtractionCore.sizeText;
    var entryTime = ExtractionCore.entryTime;

    function targets() { return ExtractionCore.targets(window.QueriesApp.databases()); }

    // Var en databas på en annan sökväg än katalogens första ligger. MediaStore ligger i
    // mediemodulen från Android 11, och det är den vanliga platsen där.
    function placeNote(name) {
        if (/Syndication\.photoslibrary/.test(name)) return 'Delat med dig (Syndication)';
        if (/providers\.media\.module\//.test(name)) return 'mediemodulen, Android 11 och senare';
        return 'annan plats än den vanliga';
    }

    // Etiketten för en träff: katalogens namn, plus var den ligger om det inte är den vanliga platsen.
    function describe(f) {
        var target = targets().find(function (x) { return x.key === f.key; });
        var pick = ExtractionCore.dbForVersion(target, current.version);
        var notes = [];
        if (!f.primary) notes.push(placeNote(f.db.name));
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
        // En krypterad databas (Signal) får nyckeln som extraktionsverktyget sparade, om den finns.
        var cipher = null;
        if (d.db.cipher) {
            var keys = AppSecrets.signalKeys(c.secrets || []);
            cipher = { profile: d.db.cipher, passphrase: keys ? keys.dbKey : null, source: keys ? keys.source : null };
        }
        window.QueriesRun.useSources({
            db: ExtractionCore.zipSource(c.read, f.db, [zipLine]),
            wal: f.wal ? ExtractionCore.zipSource(c.read, f.wal) : null,
            zip: c.file.name,
            cipher: cipher,
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

    // Korten på startsidan märks med vad som finns i zippen, och ett klick väljer databasen ur den.
    function announce() {
        window.QueriesApp.setExtraction(current ? {
            families: new Set(current.found.map(function (f) { return f.key; })),
            pick: function (family) {
                var i = current.found.findIndex(function (f) { return f.key === family; });
                if (i >= 0) use(i);
            },
        } : null);
    }

    // from: verktyget där zippen öppnades, när Queries följer extraktionen dit.
    async function open(file, from) {
        close();
        status.textContent = 'Läser zippens innehållsförteckning…';
        var read = ZipRead.fileReader(file);
        var opened = await ExtractionCore.open(read, file.size, targets(), function (done, total) {
            status.textContent = 'Läser zippens innehållsförteckning… ' + Math.round(100 * done / total) + ' %';
        });
        var secs = opened.seconds.toFixed(1).replace('.', ',');
        // Nycklar till krypterade databaser (Signal), bara om någon sådan databas finns i zippen.
        var secrets = [];
        var cipherKeys = targets().filter(function (x) { return x.dbs.some(function (d) { return d.cipher; }); }).map(function (x) { return x.key; });
        if (opened.found.some(function (f) { return cipherKeys.indexOf(f.key) >= 0; })) {
            try {
                var sEntries = await ExtractionCore.find(read, file.size, AppSecrets.isSecretsPath);
                if (sEntries.length) secrets.push(AppSecrets.fromSecretsFile((await ExtractionCore.readEntry(read, sEntries[0])).bytes, sEntries[0].name));
            } catch (e) { console.warn('Nyckelfilen kunde inte läsas', e); }
        }
        current = {
            file: file, read: read, scan: opened.scan, found: opened.found, version: opened.version, chosen: -1, secrets: secrets,
            statusText: (from ? 'Samma extraktion som i ' + from + '. ' : '') +
                opened.found.length + (opened.found.length === 1 ? ' databas hittades' : ' databaser hittades') +
                ' på ' + secs + ' s.' + (opened.found.length ? ' Välj en här eller bland korten nedan.' : ''),
        };
        status.textContent = current.statusText;
        announce();
        render();
        layout();
        // Vad Queries vet om extraktionen, till raden högst upp i huvudfönstret.
        if (window.parent !== window) window.parent.postMessage({ source: 'forensics-toolbox', type: 'extraction-info', file: file, info: { device: current.version ? 'iOS ' + current.version : '' } }, '*');
    }

    // Från Härkomst: samma zip (namn, storlek och ändringstid) öppnas bara en gång.
    function sameFile(a, b) { return !!a && !!b && a.name === b.name && a.size === b.size && a.lastModified === b.lastModified; }

    function ensure(file) {
        return serial(function () {
            if (current && sameFile(current.file, file)) return null;
            return open(file);
        });
    }

    // Fliken har en databas ur zippen och är då ett eget dokument: den behåller sin zip.
    function tabUsesZip() {
        return !!current && !!window.QueriesApp.currentDb() && window.QueriesApp.fromExtraction();
    }

    function offer(html) {
        document.dispatchEvent(new CustomEvent('queries:extraction-note', { detail: { html: html } }));
    }

    // Läget från huvudfönstret, när Queries visas. En ändring som redan setts görs inte om, och en
    // flik som använder en databas ur sin zip byts inte: där erbjuds bytet i stället.
    function follow(msg) {
        if (!(msg.seq > shared.seq)) return Promise.resolve();
        shared = { seq: msg.seq, file: msg.file || null, from: msg.from || '' };
        return serial(function () {
            if (shared.file ? current && sameFile(current.file, shared.file) : !current) return null;
            // Byte eller stängning i raden högst upp gäller fliken som visas, även om den använder en databas.
            if (tabUsesZip() && !msg.force) {
                var where = shared.from ? ' i ' + shared.from : '';
                offer(shared.file
                    ? escapeHtml(shared.file.name) + ' öppnades' + escapeHtml(where) + '. Den här fliken använder fortfarande ' + escapeHtml(current.file.name) +
                        '. <button type="button" class="link-btn" data-follow="1">Byt till ' + escapeHtml(shared.file.name) + ' här</button> · + Ny flik använder den.'
                    : 'Extraktionen stängdes' + escapeHtml(where) + '. Den här fliken använder fortfarande ' + escapeHtml(current.file.name) + '.');
                return null;
            }
            return shared.file ? open(shared.file, shared.from).catch(failed) : close();
        });
    }

    // Erbjudandet ovan: fliken byter till programmets extraktion.
    function followHere() {
        return serial(function () {
            if (!shared.file) return null;
            return open(shared.file, shared.from).catch(failed);
        });
    }

    // En ny flik börjar med programmets extraktion. Fristående (utan huvudfönstret) ärver den
    // fliken som var öppen.
    function adoptShared() {
        if (!shared.seq) return Promise.resolve();
        return serial(function () {
            if (shared.file ? current && sameFile(current.file, shared.file) : !current) return null;
            return shared.file ? open(shared.file, shared.from).catch(failed) : close();
        });
    }

    // Databasen på exakt den sökvägen i zippen. false om Queries inte hittade den.
    function useByPath(path) {
        if (!current) return false;
        var i = current.found.findIndex(function (f) { return f.db.name === path; });
        if (i < 0) return false;
        use(i);
        return true;
    }

    // Varje flik har sin egen extraktion: en query från Härkomst kan komma från en annan zip än
    // den som är öppen i de andra flikarna. En ny flik börjar med programmets extraktion.
    window.QueriesExtraction = {
        ensure: ensure,
        follow: follow,
        followHere: followHere,
        adoptShared: adoptShared,
        useByPath: useByPath,
        snapshot: function () { return { ex: current, chosen: current ? current.chosen : -1 }; },
        restore: function (s) {
            var next = s && s.ex ? s.ex : null;
            if (next !== current) {
                current = next;
                list.innerHTML = '';
                status.textContent = current ? current.statusText || '' : '';
                announce();
            }
            if (current) current.chosen = s ? s.chosen : -1;
            setTimeout(function () { if (current) render(); layout(); }, 0);
        },
    };

    $('ex-pick').addEventListener('click', function () { input.click(); });
    function closeHere() { close(); announceExtraction(null); }
    $('ex-close').addEventListener('click', closeHere);
    $('ex-close-compact').addEventListener('click', closeHere);
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
        serial(function () { return open(file); }).then(function () { announceExtraction(file); }, failed);
    });

    function failed(err) {
        current = null;
        list.innerHTML = '';
        window.QueriesApp.setExtraction(null);
        layout();
        status.innerHTML = '<span class="run-warn">' + escapeHtml(err && err.message ? err.message : String(err)) + '</span>';
    }

    document.addEventListener('queries:db-change', function () {
        if (current && !window.QueriesApp.fromExtraction()) current.chosen = -1;
        // Händelsen kommer innan sidan bytt vy, så layouten görs efter.
        setTimeout(function () {
            if (current) render();
            layout();
        }, 0);
    });
})();
