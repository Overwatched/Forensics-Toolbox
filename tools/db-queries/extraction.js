// Källorna i en flik: en extraktion (zip eller UFDR) och en databas från disk. Knappen högst upp tar emot
// båda, och identify.js avgör vad det är: en zip öppnas som extraktion, en databas känns igen på
// schemat och öppnas med sina queries, och en -wal läggs till databasen som redan är öppen. I en zip
// gås innehållsförteckningen igenom och katalogens databaser och deras -wal listas. Allt läses
// bara: zippen med File.slice(), filerna från disk med File.arrayBuffer(). Inget packas upp eller
// sparas på disk. Själva läsningen av zippen ligger i extraction-core.js, som Härkomst också använder.
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var status = $('ex-status');
    var list = $('ex-list');

    // Zippen som är öppen i fliken.
    var current = null;
    // Databasen från disk: { db, wal, journal (File), mismatch, kind, src, opened, found }. found är
    // identify.js slutsats, null när ingen query passar filen.
    var loose = null;

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

    // En zip öppnades eller stängdes här: huvudfönstret och Härkomst får veta det. bar: zippen
    // valdes med knappen i raden högst upp.
    function announceExtraction(file, bar) {
        if (window.parent === window) return;
        window.parent.postMessage({ source: 'forensics-toolbox', type: 'extraction-changed', file: file || null, bar: !!bar }, '*');
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
    function dbById(id) { return window.QueriesApp.databases().find(function (d) { return d.id === id; }) || null; }
    function familyOf(d) { return d.family || d.id; }

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

    function zipIndex(family) {
        return current ? current.found.findIndex(function (f) { return f.key === family; }) : -1;
    }

    // Databasen från disk gäller familjerna den känns igen som. Känns den inte igen gäller den
    // varje databas som inte finns i zippen, så att undersökaren kan välja själv.
    function looseCovers(family) {
        if (!loose) return false;
        return loose.found ? loose.found.families.indexOf(family) >= 0 : zipIndex(family) < 0;
    }

    // Katalogens databas för filen i en familj: den som passade bäst (Photos.sqlite: iOS-versionen).
    function looseDb(family) {
        var id = loose.found.order.find(function (x) { var d = dbById(x); return d && familyOf(d) === family; });
        return dbById(id);
    }

    // Extraktionens operativsystem, när en fil passar både iOS och Android.
    function zipOs() {
        if (!current) return '';
        if (current.version) return 'iOS';
        var d = current.found.length ? window.QueriesApp.databases().find(function (x) { return familyOf(x) === current.found[0].key; }) : null;
        return d ? d.os : '';
    }

    function isoTime(ms) { return new Date(ms).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'; }

    // Vad källan heter i texterna.
    function theZip() { return current && current.report ? 'rapporten' : 'zippen'; }

    // Översikten: zippens databaser i en tabell, och databasen från disk på en rad under.
    function looseLine() {
        var f = loose.found;
        var db = f ? dbById(f.best) : null;
        var names = '<strong>' + escapeHtml(loose.db.name) + '</strong>' + (loose.wal ? ' och <strong>' + escapeHtml(loose.wal.name) + '</strong>' : '');
        var what = db
            ? '<button type="button" class="ex-use" data-loose="1">' + escapeHtml(db.label) + '</button>'
            : '<span class="run-warn">Ingen query i Queries passar filen.</span> Välj en query till vänster för att köra den mot filen ändå.';
        return '<div class="ex-file"><span class="ex-file-label">Från disk</span> ' + names + ' · ' + what +
            ' <button type="button" class="link-btn" data-close-file="1">Stäng filen</button></div>';
    }

    function render() {
        var html = '';
        var c = current;
        if (c && c.report) html += '<p class="muted ex-report-note">' + escapeHtml(UfdrRead.summaryText(c.report) + ' ' + UfdrRead.limitText(c.report)) + '</p>';
        if (c && !c.found.length) html += '<p class="muted">Inga av databaserna som Queries har queries för hittades i ' + theZip() + '.</p>';
        else if (c) {
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
            html += '<div class="ex-summary">' + escapeHtml(summary()) + ' · ' +
                c.scan.count.toLocaleString('sv-SE') + ' poster</div>' +
                '<div class="result-scroll"><table class="ex-table"><thead><tr><th>Databas</th><th>Sökväg i ' + theZip() + '</th>' +
                '<th>Storlek</th><th>Ändrad (filsystemet)</th><th>-wal</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
        }
        list.innerHTML = html + (loose ? looseLine() : '');
    }

    list.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.hasAttribute('data-close-file')) closeLoose();
        else if (b.hasAttribute('data-loose')) { if (loose && loose.found) useLoose(loose.found.best); }
        else if (b.hasAttribute('data-i')) use(Number(b.getAttribute('data-i')));
    });

    // Fristående har Queries en egen rad högst upp med knappen; i Forensics Toolbox finns den i
    // huvudfönstrets rad.
    function renderBar() {
        $('bar-zip').textContent = current ? current.file.name : 'Ingen öppen';
        $('bar-zip').title = current ? current.file.name : '';
        $('bar-meta').textContent = current ? [sizeText(current.file.size), current.version ? 'iOS ' + current.version : ''].filter(Boolean).join(' · ') : '';
        $('ex-close').classList.toggle('display-none', !current);
    }

    // Databasen från disk i källraden och under Om databasen: vad Queries känner igen den som, och
    // om alla queries passar den.
    function looseLayout(db) {
        var f = loose.found;
        var hit = f ? f.ranked.find(function (r) { return r.id === db.id; }) : null;
        var notes = [];
        if (!f) notes.push('<span class="run-warn">Ingen query i Queries passar filen</span>');
        else if (f.byName && loose.kind === 'sqlite') notes.push('<span class="run-warn">Tabellerna finns inte i filen' + (loose.wal ? '' : ': de ligger troligen i -wal') + '</span>');
        else if (!f.byName && !hit) notes.push('<span class="run-warn">Ingen av queryerna passar filen</span>');
        else if (hit && !hit.full) notes.push('<span class="run-warn">' + hit.ok + ' av ' + hit.total + ' queries passar filen</span>');
        if (loose.journal && loose.journal.size) notes.push('<span class="run-warn">-journal finns: databasen kan vara mitt i en transaktion</span>');
        $('ex-notes').innerHTML = notes.join(' · ');
        var known = !f ? 'Ingen query i Queries passar filen.'
            : f.byName ? 'Igenkänd på namnet som ' + escapeHtml(dbById(f.best).label) + '.'
                : 'Igenkänd som ' + escapeHtml(dbById(f.best).label) + ': ' + (f.partial ? f.ok + ' av ' + f.total : 'alla ' + f.total) + ' queries passar filens tabeller.';
        $('about-zip').innerHTML = '<p><strong>Från disk:</strong> <code>' + escapeHtml(loose.db.name) + '</code>, ' + sizeText(loose.db.size) +
            ', ändrad ' + escapeHtml(isoTime(loose.db.lastModified)) + '. ' +
            (loose.wal ? '<code>-wal</code> ' + sizeText(loose.wal.size) + '.' : 'Ingen -wal vald.') + '</p><p>' + known + '</p>';
    }

    // Översikten (ingen databas vald) visar zippens databaser och databasen från disk. I arbetsytan
    // står källan längst ned i queryrutan: platsen i zippen när databasen finns på flera ställen,
    // och noter om platsen eller filen. Om databasen visar posten i zippen eller filen.
    function layout() {
        var app = window.QueriesApp;
        var db = app.currentDb();
        var src = app.source() || {};
        $('ex-box').classList.toggle('display-none', !!db || (!current && !loose && !status.textContent));
        // Med något öppet säger statusraden och listan det som behövs.
        document.querySelector('.start-intro').classList.toggle('display-none', !!(current || loose));
        renderBar();
        var sw = $('ex-switch');
        sw.classList.add('display-none');
        $('ex-notes').innerHTML = '';
        $('about-zip').innerHTML = '';
        $('file-close').classList.toggle('display-none', !(db && src.file && loose));
        if (db && src.file && loose) { looseLayout(db); return; }
        if (!db || !current || !src.zip || current.chosen < 0) return;
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
        var notes = [];
        if (!f.primary) notes.push(escapeHtml(placeNote(f.db.name)));
        if (f.user) notes.push('användare ' + escapeHtml(f.user));
        if (describe(f).guessed && !current.override) notes.push('<span class="run-warn">iOS-versionen står inte i extraktionen: välj den till vänster</span>');
        if (f.journal && f.journal.size) notes.push('<span class="run-warn">-journal finns: databasen kan vara mitt i en transaktion</span>');
        $('ex-notes').innerHTML = notes.join(' · ');
        $('about-zip').innerHTML = '<p><strong>I extraktionen:</strong> <code>' + escapeHtml(f.db.name) + '</code></p>' +
            '<p>' + sizeText(f.db.size) + ', ändrad ' + escapeHtml(entryTime(f.db)) + ' i filsystemet. ' +
            (f.wal ? '<code>-wal</code> ' + sizeText(f.wal.size) + '.' : '<span class="run-warn">Ingen -wal i ' + theZip() + '.</span>') + '</p>';
    }

    // Nyckelfiler som valts i Queries eller kommit från navet: [{ source, apps, error }].
    var keyFiles = [];

    // Nyckelfiler som undersökaren valt gäller extraktionen de valdes för, inte nästa telefon.
    function chosenKeys() {
        return keyFiles.filter(function (k) { return !k.forFile || !current || sameFile(k.forFile, current.file); });
    }

    // Det undersökaren valt går före det programmet hittade själv.
    function cipherFor(db) {
        if (!db || !db.cipher) return null;
        var keys = AppSecrets.keysForProfile(chosenKeys().concat((current && current.secrets) || []), db.cipher);
        return { profile: db.cipher, passphrase: keys ? keys.dbKey : null, source: keys ? keys.source : null, hint: AppSecrets.keyHint(db.cipher) };
    }

    // Nya nyckelfiler: tolkas efter innehållet, och databasen som visas får nyckeln direkt. forFile: extraktionen de
    // hör till. Utan den gäller de den som är öppen.
    async function useKeyFiles(list, share, forFile) {
        var parsed = [];
        for (var i = 0; i < (list || []).length; i++) {
            var one;
            try { one = await ExtractionCore.readKeyFile(new Uint8Array(await list[i].arrayBuffer()), list[i].name); }
            catch (e) { one = { source: list[i].name, apps: {}, error: 'Filen kunde inte läsas: ' + e.message }; }
            one.forFile = forFile || (current ? current.file : null);
            parsed.push(one);
        }
        keyFiles = parsed;
        var db = window.QueriesApp.currentDb ? window.QueriesApp.currentDb() : null;
        if (db && db.cipher) window.QueriesRun.useCipher(cipherFor(db));
        if (share && window.parent !== window) window.parent.postMessage({ source: 'forensics-toolbox', type: 'extraction-keys', files: Array.from(list || []) }, '*');
        return parsed;
    }

    // Det som inte gick att läsa sägs alltid om filen är vald, och om det programmet hittade själv när nyckeln saknas.
    function keyFileErrors() {
        var db = window.QueriesApp.currentDb ? window.QueriesApp.currentDb() : null;
        var c = cipherFor(db);
        return chosenKeys().concat(c && c.passphrase ? [] : (current && current.secrets) || []).filter(function (k) { return k.error; }).map(function (k) { return k.source + ': ' + k.error; });
    }

    // Var programmet letade efter nyckeln, för beskedet när den saknas. null utan öppen extraktion.
    function keySearch() {
        return current ? { word: current.report ? 'rapporten' : 'zippen', search: current.keySearch } : null;
    }

    // dbId: en annan databas i samma familj än den iOS-versionen pekar ut (Photos.sqlite).
    // keepQuery: samma query står kvar om den finns i databasen.
    function use(i, dbId, keepQuery) {
        var c = current;
        var f = c.found[i];
        var d = describe(f);
        var db = (dbId && dbById(dbId)) || d.db;
        c.chosen = i;
        c.override = db !== d.db ? db.id : null;
        window.QueriesApp.selectDb(db.id, { source: { zip: c.file.name }, keepQuery: !!keepQuery });
        var zipLine = (c.report ? 'Rapport (UFDR' + (c.report.paVersion ? ', rapportverktygets version ' + c.report.paVersion : '') + '): ' : 'Extraktion: ') + c.file.name + ' (' + c.file.size + ' byte, ändrad ' +
            new Date(c.file.lastModified).toISOString() + ')';
        // En krypterad databas (Signal) får nyckeln som extraktionsverktyget sparade, eller nyckeln ur
        // en nyckelfil som valts (nyckelringen bredvid zippen på iOS), om den finns.
        var cipher = cipherFor(db);
        window.QueriesRun.useSources({
            // En textfil (eRR.p) läses in som en tabell enligt katalogens databas.
            db: Object.assign(ExtractionCore.zipSource(c.read, f.db, [zipLine]), db.convert ? { convert: db.convert } : {}),
            wal: f.wal ? ExtractionCore.zipSource(c.read, f.wal) : null,
            zip: c.file.name,
            zipFile: c.file,
            cipher: cipher,
        });
        render();
        layout();
    }

    // Databasen från disk blir källan för dbId. Queryn står kvar om den finns i databasen.
    function useLoose(dbId) {
        window.QueriesApp.selectDb(dbId, { source: { file: loose.db.name }, keepQuery: true });
        var d = dbById(dbId);
        var db = d && d.convert ? Object.assign({}, loose.src.db, { convert: d.convert }) : loose.src.db;
        window.QueriesRun.useSources({ db: db, wal: loose.src.wal, mismatch: loose.mismatch, opened: loose.opened });
        render();
        layout();
    }

    // Den visade databasen får sin fil igen efter att en källa stängts: ur zippen om den finns där,
    // annars från disk om filen gäller den, annars ingen.
    function reattach(db) {
        var i = zipIndex(familyOf(db));
        if (looseCovers(familyOf(db))) useLoose(loose.found ? looseDb(familyOf(db)).id : db.id);
        else if (i >= 0) use(i, null, true);
        else window.QueriesApp.selectDb(db.id, { keepQuery: true });
    }

    function closeLoose() {
        if (!loose) return;
        var app = window.QueriesApp;
        var db = app.currentDb();
        var src = app.source();
        loose = null;
        window.QueriesRun.forgetKept();
        announce();
        if (db && src && src.file) reattach(db);
        render();
        layout();
    }

    function close() {
        var app = window.QueriesApp;
        var db = app.currentDb();
        var src = app.source();
        current = null;
        window.QueriesRun.forgetKept();
        // De andra verktygen ska inte fråga här efter databaser som är stängda.
        if (window.DbShare && window.DbShare.client) window.DbShare.client.gone();
        list.innerHTML = '';
        status.textContent = '';
        announce();
        // Källan ska inte längre peka på zippen.
        if (db && src && src.zip) reattach(db);
        render();
        layout();
    }

    // Sidopanelen visar zippens databaser och filens först, och ett klick väljer databasen därifrån.
    function announce() {
        if (!current && !loose) { window.QueriesApp.setExtraction(null); return; }
        var families = new Set();
        if (current) current.found.forEach(function (f) { families.add(f.key); });
        if (loose && loose.found) loose.found.families.forEach(function (k) { families.add(k); });
        window.QueriesApp.setExtraction({
            families: families,
            missingLabel: current ? 'Inte i extraktionen' : 'Andra databaser',
            title: [current ? current.file.name : '', loose ? loose.db.name : ''].filter(Boolean).join(' och '),
            covers: function (family) { return looseCovers(family) || zipIndex(family) >= 0; },
            // Katalogens databas som ett klick väljer: filens version, eller iOS-versionen i extraktionen.
            dbFor: function (family) {
                if (looseCovers(family) && loose.found) return looseDb(family);
                var i = zipIndex(family);
                return i >= 0 ? describe(current.found[i]).db : null;
            },
            pick: function (family, dbId) {
                if (looseCovers(family)) useLoose(loose.found ? looseDb(family).id : dbId);
                else if (zipIndex(family) >= 0) use(zipIndex(family));
            },
            // Samma fil, eller samma post i zippen, med en annan databas i familjen (iOS-versionen i Photos.sqlite).
            repick: function (dbId) {
                var src = window.QueriesApp.source() || {};
                if (src.file && loose) useLoose(dbId);
                else if (src.zip && current && current.chosen >= 0) use(current.chosen, dbId);
                else window.QueriesApp.selectDb(dbId);
            },
        });
    }

    // from: verktyget där zippen öppnades, när Queries följer extraktionen dit.
    async function open(file, from) {
        close();
        status.textContent = 'Läser zippens innehållsförteckning…';
        // En rapport (UFDR) läses in här, och sedan är den en extraktion som en zip.
        var source = await ExtractionCore.openSource(file, { onReport: function (done, total) {
            status.textContent = 'Läser rapportens förteckning över filerna (report.xml)… ' + Math.round(100 * done / total) + ' %';
        }, onTimes: function () { status.textContent = 'Läser filernas tider (metadata.msgpack)…'; } });
        var read = source.read;
        var opened = await ExtractionCore.open(read, file.size, targets(), function (done, total) {
            status.textContent = 'Läser zippens innehållsförteckning… ' + Math.round(100 * done / total) + ' %';
        });
        var secs = opened.seconds.toFixed(1).replace('.', ',');
        // Nycklar till krypterade databaser (Signal), bara om någon sådan databas finns i zippen.
        var search = null;
        var cipherKeys = targets().filter(function (x) { return x.dbs.some(function (d) { return d.cipher; }); }).map(function (x) { return x.key; });
        if (opened.found.some(function (f) { return cipherKeys.indexOf(f.key) >= 0; })) {
            try { search = await ExtractionCore.findKeys(read, file.size, { report: source.report, file: file }); }
            catch (e) { console.warn('Nyckelfilen kunde inte läsas', e); }
        }
        current = {
            file: file, read: read, report: source.report, scan: opened.scan, found: opened.found, version: opened.version, chosen: -1, secrets: search ? search.secrets : [], keySearch: search,
            statusText: (from ? 'Samma extraktion som i ' + from + '. ' : '') +
                opened.found.length + (opened.found.length === 1 ? ' databas hittades' : ' databaser hittades') +
                ' på ' + secs + ' s.' + (opened.found.length ? ' Välj en här eller i listan till vänster.' : ''),
        };
        status.textContent = current.statusText;
        announce();
        // En query som visas utan fil får databasen ur zippen direkt, om den finns där.
        var db = window.QueriesApp.currentDb();
        if (db && !window.QueriesApp.source() && zipIndex(familyOf(db)) >= 0) use(zipIndex(familyOf(db)), null, true);
        render();
        layout();
        // Vad Queries vet om extraktionen, till raden högst upp i huvudfönstret.
        if (window.parent !== window) window.parent.postMessage({ source: 'forensics-toolbox', type: 'extraction-info', file: file, info: { device: current.version ? 'iOS ' + current.version : '' } }, '*');
    }

    // Ett meddelande ovanför arbetsbänken, i samma rad som flikarnas meddelanden.
    function say(html) {
        document.dispatchEvent(new CustomEvent('queries:extraction-note', { detail: { html: html } }));
    }

    async function sniff(file) {
        var head = new Uint8Array(await file.slice(0, 128).arrayBuffer());
        return DbIdentify.kindOf(head, file.name);
    }

    // Knappen högst upp: en extraktion (zip), eller en databas med sin -wal och kanske -shm, som
    // inte behövs. Bara en -wal läggs till databasen från disk som redan är öppen. En fil som inte
    // går att läsa ger ett meddelande ovanför arbetsbänken.
    async function openPicked(files) {
        try {
            await pickFiles(files);
        } catch (err) {
            say('<span class="run-warn">' + escapeHtml(err && err.message ? err.message : String(err)) + '</span>');
        }
    }

    async function pickFiles(files) {
        files = Array.prototype.slice.call(files || []);
        if (!files.length) return;
        var kinds = await Promise.all(files.map(sniff));
        var p = DbIdentify.sortPicked(files.map(function (f, i) { return { name: f.name, kind: kinds[i] }; }));
        if (p.zips.length) {
            if (files.length > 1) { say('<span class="run-warn">Välj en extraktion (zip) eller en databas med sin -wal, inte båda på en gång.</span>'); return; }
            say('');
            var zip = files[p.zips[0]];
            await serial(function () { return open(zip); }).then(function () { announceExtraction(zip, true); }, failed);
            return;
        }
        var wal = p.wal === null ? null : files[p.wal];
        if (p.dbs.length > 1) { say('<span class="run-warn">Välj en databas i taget, med sin -wal.</span>'); return; }
        if (!p.dbs.length) {
            if (wal && loose) return openLoose(loose.db, wal, loose.journal);
            say('<span class="run-warn">Välj själva databasen också, inte bara -wal eller -shm.</span>');
            return;
        }
        return openLoose(files[p.dbs[0]], wal, p.journal === null ? null : files[p.journal]);
    }

    // Ett gzip-komprimerat arkiv (PowerLogs dagsarkiv) packas upp i minnet och öppnas som databasen inuti.
    // Spårbarheten säger det, med det komprimerade arkivets storlek och SHA-256.
    function gzipSource(file) {
        return {
            name: file.name.replace(/\.gz$/i, ''),
            archive: true,
            read: async function () {
                if (typeof DecompressionStream !== 'function') throw new Error('Den här webbläsaren kan inte packa upp gzip.');
                var gz = new Uint8Array(await file.arrayBuffer());
                var bytes = new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
                var sha = await ExtractionCore.sha256(gz);
                return { bytes: bytes, lines: ['Från disk: ' + file.name + ' (' + file.size + ' byte, ändrad ' + new Date(file.lastModified).toISOString() + ', SHA-256 ' + sha + '), gzip-komprimerad och uppackad i minnet (' + bytes.length + ' byte)'] };
            },
        };
    }

    // Läser in filen, provar katalogens queries mot schemat och väljer databasen den känns igen som.
    // En krypterad fil känns igen på namnet. Känns filen inte igen används den för databasen som
    // visas, annars stannar översikten med en rad om filen.
    async function openLoose(dbFile, walFile, journalFile) {
        var app = window.QueriesApp;
        var run = window.QueriesRun;
        var kind = await sniff(dbFile);
        var gz = kind === 'gzip';
        if (gz) kind = 'sqlite';
        var src = { db: gz ? gzipSource(dbFile) : run.fileSource(dbFile), wal: walFile ? run.fileSource(walFile) : null };
        var cur = app.currentDb();
        // Den visade databasen går före när filen passar flera, och dess operativsystem när det inte
        // finns någon zip. Utom när den bara var gissad på namnet, till exempel innan -wal lades till.
        var src0 = app.source() || {};
        var guessed = !!(src0.file && loose && loose.found && loose.found.byName);
        var opts = { name: src.db.name, prefer: cur && !guessed ? cur.id : '', os: zipOs() || (cur && !guessed ? cur.os : '') };
        var opened = null;
        var found = null;
        say('Läser in ' + escapeHtml(dbFile.name) + '…');
        try {
            if (kind === 'sqlite') {
                opened = await run.load(src);
                found = DbIdentify.conclude(DbIdentify.rank(opened.SQL, opened.bytes, app.databases(), opts))
                    || DbIdentify.fromName(dbFile.name, app.databases(), opts);
            } else if (kind === 'text') {
                // En textfil som Queries kan läsa in som tabell (eRR.p) känns igen på namnet.
                found = DbIdentify.fromName(dbFile.name, app.databases().filter(function (d) { return !!d.convert; }), opts);
            } else {
                found = DbIdentify.fromName(dbFile.name, app.databases(), Object.assign({ encrypted: true }, opts));
            }
        } catch (err) {
            say('<span class="run-warn">' + escapeHtml(dbFile.name + ': ' + (err && err.message ? err.message : String(err))) + '</span>');
            return;
        }
        say(kind === 'sqlite' || found ? '' : kind === 'text' ? escapeHtml(dbFile.name) + ' är en textfil som Queries inte känner igen. Queries läser eRR.p från Samsung, med det namnet.'
            : escapeHtml(dbFile.name) + ' är varken en zip eller en vanlig SQLite-databas. Är den krypterad, välj vilken databas det är till vänster och klistra in nyckeln.');
        loose = {
            db: dbFile, wal: walFile || null, journal: journalFile || null, kind: kind, src: src, opened: opened, found: found,
            mismatch: !!walFile && walFile.name.replace(/-wal$/i, '') !== dbFile.name,
        };
        announce();
        if (found) useLoose(found.best);
        else if (cur) useLoose(cur.id);
        else { render(); layout(); }
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
                say(shared.file
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

    // En ny flik börjar med programmets extraktion, utan databasen från disk. Fristående (utan
    // huvudfönstret) ärver den zip som var öppen.
    function fresh() {
        if (current) current.chosen = -1;
        if (loose) { loose = null; announce(); }
    }

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

    // Varje flik har sina egna källor: en query från Härkomst kan komma från en annan zip än den som
    // är öppen i de andra flikarna. En ny flik börjar med programmets extraktion.
    window.QueriesExtraction = {
        ensure: ensure,
        follow: follow,
        followHere: followHere,
        adoptShared: adoptShared,
        fresh: fresh,
        useByPath: useByPath,
        openPicked: openPicked,
        useKeyFiles: useKeyFiles,
        keyFileErrors: keyFileErrors,
        keySearch: keySearch,
        cipherFor: cipherFor,
        snapshot: function () { return { ex: current, chosen: current ? current.chosen : -1, loose: loose }; },
        restore: function (s) {
            var next = s && s.ex ? s.ex : null;
            var nextLoose = s && s.loose ? s.loose : null;
            if (next !== current || nextLoose !== loose) {
                current = next;
                loose = nextLoose;
                list.innerHTML = '';
                status.textContent = current ? current.statusText || '' : '';
                announce();
            }
            if (current) current.chosen = s ? s.chosen : -1;
            setTimeout(function () { render(); layout(); }, 0);
        },
    };

    // Fristående: knappen och Stäng i raden högst upp.
    var input = $('open-input');
    $('open-pick').addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
        var files = Array.prototype.slice.call(input.files || []);
        input.value = '';
        openPicked(files);
    });
    $('ex-close').addEventListener('click', function () { close(); announceExtraction(null); });
    $('file-close').addEventListener('click', closeLoose);
    // Databasen finns på flera ställen i zippen: platsen byts, iOS-versionen och queryn står kvar.
    $('ex-switch').addEventListener('change', function () {
        var i = Number($('ex-switch').value);
        if (current && current.found[i]) use(i, current.override, true);
    });

    // Zippen gick inte att öppna. Felet står i översikten, och ovanför arbetsytan när en query visas.
    function failed(err) {
        var text = '<span class="run-warn">' + escapeHtml(err && err.message ? err.message : String(err)) + '</span>';
        current = null;
        list.innerHTML = '';
        announce();
        render();
        status.innerHTML = text;
        layout();
        if (window.QueriesApp.currentDb()) say(text);
    }

    window.QueriesApp.ready.then(layout);
    document.addEventListener('queries:db-change', function () {
        if (current && !window.QueriesApp.fromExtraction()) current.chosen = -1;
        // Händelsen kommer innan sidan bytt vy, så layouten görs efter.
        setTimeout(function () {
            render();
            layout();
        }, 0);
    });
})();
