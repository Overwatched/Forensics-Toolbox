// Extraktion: användaren väljer en zip. Innehållsförteckningen gås igenom, katalogernas
// databaser och deras -wal listas, och en vald databas läses ut till minnet och blir queryns
// källa. Zippen läses bara med File.slice(). Inget packas upp eller sparas på disk.
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

    // Översikten (ingen databas vald) visar zippens databaser. I arbetsytan står källan längst ned i
    // queryrutan: platsen i zippen när databasen finns på flera ställen, och noter om platsen.
    // Om databasen visar posten i zippen.
    function layout() {
        var app = window.QueriesApp;
        var db = app.currentDb();
        var hub = document.body.classList.contains('in-hub');
        $('ex-box').classList.toggle('display-none', !!db || (hub && !current && !status.textContent));
        // Med en extraktion öppen säger statusraden det som behövs.
        document.querySelector('.start-intro').classList.toggle('display-none', !!current);
        $('ex-close').classList.toggle('display-none', !current);
        var pickBtn = $('ex-pick');
        pickBtn.textContent = current ? 'Öppna en annan zip…' : 'Öppna extraktion (zip)…';
        pickBtn.classList.toggle('secondary', !!current);
        var sw = $('ex-switch');
        var notes = $('ex-notes');
        var about = $('about-zip');
        sw.classList.add('display-none');
        notes.innerHTML = '';
        about.innerHTML = '';
        if (!db || !current || !app.fromExtraction() || current.chosen < 0) return;
        var f = current.found[current.chosen];
        var same = [];
        current.found.forEach(function (x, i) { if (x.key === f.key) same.push(i); });
        if (same.length > 1) {
            sw.innerHTML = same.map(function (i) {
                var name = current.found[i].db.name;
                return '<option value="' + i + '"' + (i === current.chosen ? ' selected' : '') + ' title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
            }).join('');
            sw.classList.remove('display-none');
        }
        var list = [];
        if (!f.primary) list.push(escapeHtml(placeNote(f.db.name)));
        if (f.user) list.push('användare ' + escapeHtml(f.user));
        if (describe(f).guessed && !current.override) list.push('<span class="run-warn">iOS-versionen står inte i extraktionen: välj den till vänster</span>');
        if (f.journal && f.journal.size) list.push('<span class="run-warn">-journal finns: databasen kan vara mitt i en transaktion</span>');
        notes.innerHTML = list.join(' · ');
        about.innerHTML = '<p><strong>I extraktionen:</strong> <code>' + escapeHtml(f.db.name) + '</code></p>' +
            '<p>' + sizeText(f.db.size) + ', ändrad ' + escapeHtml(entryTime(f.db)) + ' enligt zippen. ' +
            (f.wal ? '<code>-wal</code> ' + sizeText(f.wal.size) + '.' : '<span class="run-warn">Ingen -wal i zippen.</span>') + '</p>';
    }

    // dbId: en annan databas i samma familj än den iOS-versionen pekar ut (Photos.sqlite).
    function use(i, dbId) {
        var c = current;
        var f = c.found[i];
        var d = describe(f);
        var db = (dbId && window.QueriesApp.databases().find(function (x) { return x.id === dbId; })) || d.db;
        c.chosen = i;
        c.override = db !== d.db ? db.id : null;
        window.QueriesApp.selectDb(db.id, { source: { zip: c.file.name } });
        var zipLine = 'Extraktion: ' + c.file.name + ' (' + c.file.size + ' byte, ändrad ' +
            new Date(c.file.lastModified).toISOString() + ')';
        // En krypterad databas (Signal) får nyckeln som extraktionsverktyget sparade, om den finns.
        var cipher = null;
        if (db.cipher) {
            var keys = AppSecrets.signalKeys(c.secrets || []);
            cipher = { profile: db.cipher, passphrase: keys ? keys.dbKey : null, source: keys ? keys.source : null };
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
        // Källan ska inte längre peka på zippen.
        if (wasFromZip && db) window.QueriesApp.selectDb(db.id);
        layout();
    }

    // Sidopanelen visar zippens databaser först, och ett klick väljer databasen ur zippen.
    function announce() {
        window.QueriesApp.setExtraction(current ? {
            families: new Set(current.found.map(function (f) { return f.key; })),
            title: current.file.name,
            // Katalogens databas som ett klick väljer, för iOS-versionen i extraktionen.
            dbFor: function (family) {
                var f = current.found.find(function (x) { return x.key === family; });
                return f ? describe(f).db : null;
            },
            pick: function (family) {
                var i = current.found.findIndex(function (f) { return f.key === family; });
                if (i >= 0) use(i);
            },
            // Samma post i zippen med en annan databas i familjen (iOS-versionen i Photos.sqlite).
            repick: function (dbId) {
                if (current.chosen >= 0) use(current.chosen, dbId);
                else window.QueriesApp.selectDb(dbId);
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
                ' på ' + secs + ' s.' + (opened.found.length ? ' Välj en här eller i listan till vänster.' : ''),
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
    // Databasen finns på flera ställen i zippen: platsen byts, iOS-versionen står kvar.
    $('ex-switch').addEventListener('change', function () {
        var i = Number($('ex-switch').value);
        if (current && current.found[i]) use(i, current.override);
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

    window.QueriesApp.ready.then(layout);
    document.addEventListener('queries:db-change', function () {
        if (current && !window.QueriesApp.fromExtraction()) current.chosen = -1;
        // Händelsen kommer innan sidan bytt vy, så layouten görs efter.
        setTimeout(function () {
            if (current) render();
            layout();
        }, 0);
    });
})();
