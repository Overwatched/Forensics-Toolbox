// Körningen i Queries: databasen och dess -wal läses in, WAL-ramarna läggs på en kopia i minnet
// och queryn körs med sql.js. Källfilerna öppnas bara för läsning. Källan står längst ned i
// queryrutan, resultatet under den och spårbarheten i fliken Spårbarhet. Filerna väljs med knappen
// högst upp (extraction.js), som också känner igen vilken databas det är.
(function () {
    'use strict';

    var MAX_SHOWN = 2000;

    var $ = function (id) { return document.getElementById(id); };
    var fileList = $('run-file-list');
    var noWalLabel = $('run-nowal-label');
    var noWal = $('run-nowal');
    var runButton = $('run-button');
    var csvButton = $('run-csv');
    var mapButton = $('run-map');
    var provButton = $('run-provenance');
    var status = $('run-status');
    // Kolumnerna med filnamn i Photos.sqlite och MediaStore: de kan bedömas i Härkomst.
    var NAME_COLUMN = /^(ZFILENAME|_display_name|filename)$/i;
    var MAX_NAMES = 400;
    function nameColumn(columns) {
        for (var i = 0; i < columns.length; i++) if (NAME_COLUMN.test(String(columns[i]))) return i;
        return -1;
    }
    var result = $('run-result');
    var trace = $('run-trace');
    var TRACE_EMPTY = '<p class="muted">Kör queryn, så står källan, CRC32 och SHA-256 för filerna här.</p>';

    var files = { db: null, wal: null };
    var keyRow = $('run-key-row');
    var keyInput = $('run-key');
    var keyNote = $('run-key-note');
    var opened = null;
    var last = null;
    var sqlPromise = null;
    // Undersökaren vill klistra in en annan nyckel än den ur extraktionen.
    var keyWanted = false;

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function loadSqlJs() {
        if (sqlPromise) return sqlPromise;
        if (typeof initSqlJs !== 'function') return Promise.reject(new Error('sql.js kunde inte laddas.'));
        sqlPromise = initSqlJs({ wasmBinary: window.SQL_WASM_BINARY });
        return sqlPromise;
    }

    async function sha256(buf) {
        if (!window.crypto || !crypto.subtle) return '';
        var digest = await crypto.subtle.digest('SHA-256', buf);
        return Array.prototype.map.call(new Uint8Array(digest), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    }

    // En källa är en fil från disk eller en post i en zip. read() ger { bytes, lines }, där lines
    // beskriver var bytena kom ifrån (till spårbarheten och CSV-huvudet).
    function fileSource(file) {
        return {
            name: file.name,
            read: async function () {
                var line = 'Från disk: ' + file.name + ' (' + file.size + ' byte, ändrad ' + new Date(file.lastModified).toISOString() + ')';
                return { bytes: new Uint8Array(await file.arrayBuffer()), lines: [line] };
            },
        };
    }

    function closeOpened() {
        opened = null;
    }

    // Exempelraderna behövs inte när det finns ett riktigt resultat.
    function setResult(html) {
        result.innerHTML = html;
        $('result-preview').classList.toggle('display-none', !!html);
    }

    function clearResult() {
        last = null;
        csvButton.disabled = true;
        mapButton.disabled = true;
        provButton.disabled = true;
        setResult('');
        trace.innerHTML = TRACE_EMPTY;
    }

    // Källan på en rad: filerna och var de kom ifrån.
    function updateState() {
        var ready = !!files.db && (!!files.wal || noWal.checked);
        runButton.disabled = !ready;
        noWalLabel.classList.toggle('display-none', !files.db || !!files.wal || !!files.zip);
        var name = function (f) { return '<strong>' + escapeHtml(f.name) + '</strong>'; };
        var html;
        if (!files.db) html = 'Ingen databas öppen. Öppna den, eller extraktionen, med knappen högst upp.';
        else {
            html = name(files.db) + (files.wal ? ' och ' + name(files.wal) : '') + (files.zip ? ' ur ' + escapeHtml(files.zip) : ' från disk');
            if (files.cipher && files.cipher.passphrase && !keyInput.value.trim()) html += ', nyckeln ur ' + escapeHtml(files.cipher.source);
            html += '.';
            if (!files.wal && files.zip) html += ' <span class="run-warn">Extraktionen har ingen -wal för databasen: allt som finns i databasfilen kommer med.</span>';
            else if (!files.wal && !noWal.checked) html += ' <span class="run-warn">Ingen -wal vald: poster som bara finns i -wal kommer att saknas.</span>';
            if (files.mismatch) html += ' <span class="run-warn">-wal har inte samma namn som databasen. Kontrollera att de hör ihop.</span>';
        }
        fileList.innerHTML = html;
        showKeyRow();
    }

    function reset() {
        files = { db: null, wal: null };
        noWal.checked = false;
        keyWanted = false;
        closeOpened();
        clearResult();
        status.textContent = '';
        updateState();
    }

    // En ny nyckel gäller vid nästa körning: databasen läses då in igen.
    keyInput.addEventListener('input', function () { closeOpened(); updateState(); });
    $('run-key-other').addEventListener('click', function () {
        keyWanted = true;
        showKeyRow();
        keyInput.focus();
    });

    noWal.addEventListener('change', updateState);

    // Den krypterade databasens nyckel: inklistrad, ur extraktionen (files.cipher) eller, för en fil från
    // disk, ur en nyckelfil som valts (nyckelringen på iOS).
    function currentCipher() {
        var db = window.QueriesApp && window.QueriesApp.currentDb ? window.QueriesApp.currentDb() : null;
        var profile = (files.cipher && files.cipher.profile) || (db && db.cipher) || 'signal';
        var typed = keyInput.value.trim() ? AppSecrets.parseManual(keyInput.value).dbKey : null;
        if (typed) return { profile: profile, passphrase: typed, source: 'inklistrad' };
        if (files.cipher && files.cipher.passphrase) return files.cipher;
        var fromFiles = !files.zip && window.QueriesExtraction && window.QueriesExtraction.cipherFor ? window.QueriesExtraction.cipherFor(db) : null;
        if (fromFiles && fromFiles.passphrase) return fromFiles;
        return { profile: profile, passphrase: null, source: null };
    }

    // En ny nyckel ur en nyckelfil för databasen som visas: den läses in igen vid nästa körning.
    function useCipher(cipher) {
        if (files.zip) files.cipher = cipher || null;
        closeOpened();
        updateState();
    }

    // Nyckelrutan visas när nyckeln inte finns i extraktionen, eller när någon vill använda en annan.
    function showKeyRow() {
        var db = window.QueriesApp && window.QueriesApp.currentDb ? window.QueriesApp.currentDb() : null;
        var need = !!(db && db.cipher) || !!files.encrypted;
        var ios = !!(db && db.cipher === 'signal-ios');
        var c = currentCipher();
        var zipKey = !!(c.passphrase && c.source !== 'inklistrad');
        var show = need && (!zipKey || keyWanted || !!keyInput.value.trim());
        keyRow.classList.toggle('display-none', !show);
        $('run-key-other').classList.toggle('display-none', !need || !zipKey || show);
        keyInput.placeholder = ios ? "96 hextecken, gärna som x'…'" : '64 hextecken, eller Signal-posten ur secrets.json';
        var bad = window.QueriesExtraction && window.QueriesExtraction.keyFileErrors ? window.QueriesExtraction.keyFileErrors() : [];
        keyNote.textContent = (zipKey ? 'Går före nyckeln ur ' + c.source + '. Sparas inte.'
            : ios ? 'Nyckeln ligger i nyckelringen bredvid zippen (…_keychain.plist). Välj den med Nyckelfil…, eller klistra in den här. Den sparas inte.'
                : files.zip ? 'Extraktionen har ingen nyckel (extra/Secrets/secrets.json). Klistra in den här. Den sparas inte.'
                    : 'Klistra in den här, eller välj en nyckelfil. Den sparas inte.') + (bad.length ? ' ' + bad.join(' ') : '');
    }

    $('run-keyfile-pick').addEventListener('click', function () { $('run-keyfile').click(); });
    $('run-keyfile').addEventListener('change', function () {
        var picked = Array.prototype.slice.call($('run-keyfile').files || []);
        $('run-keyfile').value = '';
        if (!picked.length || !window.QueriesExtraction) return;
        window.QueriesExtraction.useKeyFiles(picked, true).then(showKeyRow).catch(function (err) { console.warn('Nyckelfilen kunde inte läsas', err); });
    });

    // Läser databasen och -wal, räknar SHA-256 och lägger WAL-ramarna på en kopia i minnet. En
    // krypterad databas dekrypteras med cipher.passphrase; utan nyckel kastas ett fel med code
    // 'ENCRYPTED'. Används också när en fil öppnas, så att schemat kan provas (extraction.js).
    async function load(src, cipher) {
        cipher = cipher || { profile: null, passphrase: null, source: null };
        var SQL = await loadSqlJs();
        var dbRead = await src.db.read();
        var walRead = src.wal ? await src.wal.read() : null;
        var hashes = await Promise.all([sha256(dbRead.bytes), walRead ? sha256(walRead.bytes) : Promise.resolve('')]);
        var walBytes = walRead ? walRead.bytes : new Uint8Array(0);
        var merged;
        var origin = dbRead.lines.concat(walRead ? walRead.lines : []);
        var encrypted = dbRead.bytes.length >= 16 && SqlCipher.isEncrypted(dbRead.bytes, cipher.profile);
        if (encrypted) {
            if (!cipher.passphrase) {
                var err = new Error(src.db.name + ' är krypterad (SQLCipher). ' + (cipher.profile === 'signal-ios' ? 'Välj nyckelringen (…_keychain.plist bredvid zippen) med Nyckelfil…, eller klistra in nyckeln i rutan Nyckel under Källa.' : 'Klistra in nyckeln i rutan Nyckel under Källa.'));
                err.code = 'ENCRYPTED';
                throw err;
            }
            merged = SqlCipher.open(dbRead.bytes, walBytes, cipher.passphrase, cipher.profile, SqliteWal);
            origin.push(SqlCipher.summary(merged.stats, cipher.source));
        } else {
            merged = SqliteWal.apply(dbRead.bytes, walBytes);
        }
        // En -wal som inte går att lägga på läses inte, som i SQLite. walSummary säger det vid körningen.
        return {
            SQL: SQL, dbFile: src.db, walFile: src.wal || null, stats: merged.stats, hashes: hashes, bytes: merged.bytes,
            origin: origin, passphrase: cipher.passphrase, encrypted: encrypted,
        };
    }

    async function open() {
        var cipher = currentCipher();
        if (opened && opened.dbFile === files.db && opened.walFile === files.wal && opened.passphrase === cipher.passphrase) return opened;
        closeOpened();
        status.textContent = 'Läser in…';
        try {
            opened = await load(files, cipher);
        } catch (err) {
            if (err && err.code === 'ENCRYPTED') { files.encrypted = true; showKeyRow(); }
            throw err;
        }
        if (opened.encrypted) { files.encrypted = true; showKeyRow(); }
        return opened;
    }

    function walSummary(o) {
        if (!o.walFile) return 'Utan -wal.';
        var s = o.stats;
        if (s.error) return '-wal lades inte på: ' + s.error + '. Databasen lästes utan den, som SQLite gör med en sådan fil, så poster som bara finns i -wal saknas.';
        if (s.empty) return '-wal är tom (0 byte), så det fanns inga ramar att lägga på.';
        var text = '-wal: ' + s.appliedFrames + ' av ' + s.walFrames + ' ramar lades på (' + s.commits + ' commit, ' + s.pages + ' sidor).';
        if (s.uncommittedFrames) text += ' ' + s.uncommittedFrames + ' ramar hörde till en transaktion som aldrig blev klar och lades inte på.';
        if (s.oldFrames) text += ' ' + s.oldFrames + ' ramar är kvar från en äldre omgång av -wal (redan överförda till databasen eller ersatta) och lades inte på. De kan innehålla äldre versioner av sidor.';
        if (s.brokenFrames) text += ' ' + s.brokenFrames + ' ramar från och med en trasig ram lades inte på.';
        return text;
    }

    function hashLines(o) {
        var out = o.origin.slice();
        if (o.hashes[0]) out.push('SHA-256 ' + o.dbFile.name + ': ' + o.hashes[0]);
        if (o.hashes[1]) out.push('SHA-256 ' + o.walFile.name + ': ' + o.hashes[1]);
        return out;
    }

    function renderTable(res) {
        var shown = res.values.slice(0, MAX_SHOWN);
        setResult('<table><thead><tr>' +
            res.columns.map(function (c) { return '<th>' + escapeHtml(c) + '</th>'; }).join('') +
            '</tr></thead><tbody>' +
            shown.map(function (r) {
                return '<tr>' + r.map(function (v) {
                    return '<td' + (v === null ? ' class="null"' : '') + '>' + escapeHtml(QueryRunCore.cellText(v)) + '</td>';
                }).join('') + '</tr>';
            }).join('') +
            '</tbody></table>');
    }

    async function runQuery() {
        var app = window.QueriesApp;
        var sql = app ? app.currentSql() : '';
        if (!sql.trim() || runButton.disabled) return;
        runButton.disabled = true;
        clearResult();
        try {
            var o = await open();
            // En ny kopia för varje körning, så att en redigerad query som ändrar något
            // inte påverkar nästa körning.
            var db = new o.SQL.Database(o.bytes);
            var started = performance.now();
            var all;
            try { all = db.exec(sql); } finally { db.close(); }
            var ms = Math.round(performance.now() - started);
            var raw = all.length ? all[all.length - 1] : { columns: [], values: [] };
            // En query från Härkomst får tiden i UTC bredvid varje tidskolumn, så att raderna går att jämföra.
            var utc = QueryRunCore.withUtcColumns(raw.columns, raw.values, app.timeColumns ? app.timeColumns() : null);
            var res = { columns: utc.columns, values: utc.rows };
            last = { columns: res.columns, rows: res.values, sql: sql, opened: o };
            var count = res.values.length;
            var lines = [
                count + (count === 1 ? ' rad' : ' rader') + ' på ' + ms + ' ms'
                    + (count > MAX_SHOWN ? ', de första ' + MAX_SHOWN + ' visas. CSV-filen får alla.' : '.'),
            ];
            // En -wal som inte kunde läggas på är en varning, inte en upplysning.
            if (!o.stats.error) lines.push(walSummary(o));
            if (utc.added) lines.push('Kolumnerna som slutar på (UTC) är omräknade av Forensics Toolbox på samma sätt som i Härkomst. Råvärdet står i kolumnen till vänster.');
            var warn = o.origin.some(function (l) { return /STÄMMER INTE/.test(l); });
            status.innerHTML = lines.map(escapeHtml).join(' ') +
                (o.stats.error ? '<br><span class="run-warn">' + escapeHtml(walSummary(o)) + '</span>' : '') + (warn
                ? '<br><span class="run-warn">CRC32 stämmer inte för en fil ur zippen.</span> <button type="button" class="link-btn" data-show-pane="trace">Visa spårbarheten</button>'
                : '');
            trace.innerHTML = hashLines(o).map(escapeHtml).join('<br>');
            if (warn) document.dispatchEvent(new CustomEvent('queries:show-pane', { detail: 'trace' }));
            // Utan rader ger sql.js inga kolumner: exempelraderna ska inte stå kvar under "0 rader".
            if (res.columns.length) renderTable(res);
            else setResult('<p class="muted run-empty">Queryn gav inga rader.</p>');
            csvButton.disabled = !res.columns.length;
            var geo = MapImport.guessColumns(res.columns.map(String));
            mapButton.disabled = !(count && geo.lat >= 0 && geo.lon >= 0);
            provButton.disabled = !(count && nameColumn(res.columns) >= 0);
        } catch (err) {
            status.innerHTML = '<span class="run-warn">' + escapeHtml(err && err.message ? err.message : String(err)) + '</span>';
        } finally {
            updateState();
        }
    }

    runButton.addEventListener('click', runQuery);

    function stamp() {
        var d = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };
        return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
    }

    function baseName() {
        var app = window.QueriesApp;
        var q = app && app.currentQuery();
        return (files.db ? files.db.name.replace(/\.[^.]+$/, '') : 'query') + (q ? '-' + q.id : '');
    }

    // SQL, filer, hash och WAL står överst som kommentarer, så att CSV-filen visar hur den togs fram.
    csvButton.addEventListener('click', function () {
        if (!last) return;
        var o = last.opened;
        var head = ['Forensics Toolbox, Queries ' + new Date().toISOString(), 'Databas: ' + o.dbFile.name,
            o.walFile ? '-wal: ' + o.walFile.name : 'Utan -wal', walSummary(o)].concat(hashLines(o))
            .concat(['SQL:']).concat(last.sql.split('\n'));
        var text = '﻿' + head.map(function (l) { return '# ' + l; }).join('\r\n') + '\r\n'
            + QueryRunCore.toCsv(last.columns, last.rows);
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
        a.download = baseName() + '-' + stamp() + '.csv';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });

    mapButton.addEventListener('click', function () {
        if (!last) return;
        var app = window.QueriesApp;
        var db = app.currentDb();
        var q = app.currentQuery();
        var label = (db ? db.label : 'Query') + (q ? ' – ' + q.title : '');
        var out = QueryRunCore.toPoints(last.columns, last.rows, { importer: MapImport, title: q && q.title, source: label });
        if (!out.points.length) {
            status.textContent = 'Inga rader med giltig latitud och longitud.';
            return;
        }
        window.parent.postMessage({
            source: 'forensics-toolbox', type: 'positions',
            layerKey: 'query-' + (db ? db.id : '') + '-' + (q ? q.id : ''), layerName: label,
            points: out.points, noun: ['position', 'positioner'],
        }, '*');
        var text = out.points.length + (out.points.length === 1 ? ' position' : ' positioner') + ' skickades till Positioner.';
        if (out.skipped) text += ' ' + out.skipped + ' rader utan giltig position hoppades över.';
        if (window.parent === window) text = 'Öppna Queries inifrån Forensics Toolbox för att visa resultatet i Positioner.';
        status.textContent = text;
    });

    // Filnamnen i resultatet till Härkomst, som bedömer dem i en lista. Zippens namn följer med, så att
    // Härkomst kan säga till om den har en annan zip öppen.
    provButton.addEventListener('click', function () {
        if (!last) return;
        var i = nameColumn(last.columns);
        if (i < 0) return;
        var seen = {};
        var names = [];
        last.rows.forEach(function (r) {
            var v = r[i];
            if (v == null || v === '' || seen[v]) return;
            seen[v] = true;
            names.push(String(v));
        });
        if (!names.length) { status.textContent = 'Resultatet har inga filnamn.'; return; }
        window.parent.postMessage({ source: 'forensics-toolbox', type: 'names-for', to: 'provenance', names: names.slice(0, MAX_NAMES), zipName: files.zip || '' }, '*');
        status.textContent = (names.length > MAX_NAMES ? 'De första ' + MAX_NAMES + ' av ' + names.length : names.length) + (names.length === 1 ? ' filnamn skickades' : ' filnamn skickades') + ' till Härkomst.';
    });

    // Databasen och -wal ur en zip (src.zip) eller från disk. Anropas efter att rätt databas valts,
    // eftersom bytet av databas tömmer rutan. Ur zippen finns ingen -wal att välja; från disk måste
    // undersökaren bocka i att det inte finns någon. src.opened: filerna är redan inlästa.
    function useSources(src) {
        files = { db: src.db, wal: src.wal || null, mismatch: !!src.mismatch, zip: src.zip, cipher: src.cipher || null };
        noWal.checked = !!src.zip && !src.wal;
        closeOpened();
        if (src.opened && src.opened.dbFile === files.db && src.opened.walFile === files.wal) opened = src.opened;
        clearResult();
        status.textContent = '';
        updateState();
    }

    // Flikarna: filerna, den inlästa databasen och resultatet följer med fliken.
    function snapshot() {
        return {
            files: files, noWal: noWal.checked, opened: opened, last: last, keyWanted: keyWanted,
            statusHtml: status.innerHTML, resultHtml: result.innerHTML, traceHtml: trace.innerHTML,
            csv: !csvButton.disabled, map: !mapButton.disabled, prov: !provButton.disabled,
        };
    }

    function restore(s) {
        if (!s) return;
        files = s.files || { db: null, wal: null };
        noWal.checked = !!s.noWal;
        opened = s.opened || null;
        last = s.last || null;
        keyWanted = !!s.keyWanted;
        status.innerHTML = s.statusHtml || '';
        setResult(s.resultHtml || '');
        trace.innerHTML = s.traceHtml || TRACE_EMPTY;
        csvButton.disabled = !s.csv;
        mapButton.disabled = !s.map;
        provButton.disabled = !s.prov;
        updateState();
    }

    window.QueriesRun = {
        useCipher: useCipher,
        useSources: useSources, run: runQuery, snapshot: snapshot, restore: restore,
        load: load, fileSource: fileSource, sql: loadSqlJs,
    };

    document.addEventListener('queries:db-change', reset);
    // En annan query i samma databas: filerna och den inlästa databasen står kvar, resultatet töms.
    document.addEventListener('queries:query-change', function () {
        clearResult();
        status.textContent = '';
    });
    clearResult();
    updateState();
})();
