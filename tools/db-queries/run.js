// Kör i appen: databasen och dess -wal läses in, WAL-ramarna läggs på en kopia i minnet
// och queryn körs med sql.js. Källfilerna öppnas bara för läsning.
(function () {
    'use strict';

    var MAX_SHOWN = 2000;

    var $ = function (id) { return document.getElementById(id); };
    var input = $('run-input');
    var fileList = $('run-file-list');
    var noWalLabel = $('run-nowal-label');
    var noWal = $('run-nowal');
    var runButton = $('run-button');
    var csvButton = $('run-csv');
    var mapButton = $('run-map');
    var status = $('run-status');
    var result = $('run-result');

    var files = { db: null, wal: null };
    var opened = null;
    var last = null;
    var sqlPromise = null;

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

    // En källa är en vald fil eller en post i en zip. read() ger { bytes, lines }, där lines
    // beskriver var bytena kom ifrån (till status och CSV-huvudet).
    function fileSource(file) {
        return {
            name: file.name,
            read: async function () {
                return { bytes: new Uint8Array(await file.arrayBuffer()), lines: [] };
            },
        };
    }

    function closeOpened() {
        opened = null;
    }

    // Exempelbilden "Så kan resultatet se ut" behövs inte när det finns ett riktigt resultat.
    function setResult(html) {
        result.innerHTML = html;
        $('result-preview').classList.toggle('display-none', !!html);
        $('preview-label').classList.toggle('display-none', !!html);
    }

    function clearResult() {
        last = null;
        csvButton.disabled = true;
        mapButton.disabled = true;
        setResult('');
    }

    function updateState() {
        var ready = !!files.db && (!!files.wal || noWal.checked);
        runButton.disabled = !ready;
        noWalLabel.classList.toggle('display-none', !files.db || !!files.wal || !!files.zip);
        $('run-intro').classList.toggle('display-none', !!files.zip);
        $('run-pick').textContent = files.zip ? 'Använd andra filer i stället…' : 'Välj databas och -wal…';
        var html = '';
        var from = files.zip ? ' <span class="muted">ur ' + escapeHtml(files.zip) + '</span>' : '';
        if (files.db) html += '<div><strong>Databas:</strong> ' + escapeHtml(files.db.name) + from + '</div>';
        if (files.wal) html += '<div><strong>-wal:</strong> ' + escapeHtml(files.wal.name) + from + '</div>';
        else if (files.zip && files.db) html += '<div class="run-warn">Extraktionen har ingen -wal för databasen. Allt som finns i databasfilen kommer med.</div>';
        else if (files.db) html += '<div class="run-warn">Ingen -wal vald. Poster som bara finns i -wal kommer att saknas.</div>';
        if (files.mismatch) html += '<div class="run-warn">-wal-filen har inte samma namn som databasen. Kontrollera att de hör ihop.</div>';
        fileList.innerHTML = html;
    }

    function reset() {
        files = { db: null, wal: null };
        noWal.checked = false;
        input.value = '';
        closeOpened();
        clearResult();
        status.textContent = '';
        updateState();
    }

    $('run-pick').addEventListener('click', function () { input.click(); });

    input.addEventListener('change', function () {
        var list = Array.prototype.slice.call(input.files || []);
        if (!list.length) return;
        var pair = QueryRunCore.pairFiles(list.map(function (f) { return f.name; }));
        // Bara en -wal vald: behåll databasen som redan är vald.
        if (pair.db === null && pair.wal !== null && files.db && !files.zip) {
            files.wal = fileSource(list[pair.wal]);
            files.mismatch = list[pair.wal].name.replace(/-wal$/i, '') !== files.db.name;
        } else {
            files = {
                db: pair.db === null ? null : fileSource(list[pair.db]),
                wal: pair.wal === null ? null : fileSource(list[pair.wal]),
                mismatch: pair.mismatch,
            };
        }
        noWal.checked = false;
        closeOpened();
        clearResult();
        status.textContent = files.db ? '' : 'Välj själva databasen också, inte bara -wal eller -shm.';
        updateState();
    });

    noWal.addEventListener('change', updateState);

    async function open() {
        if (opened && opened.dbFile === files.db && opened.walFile === files.wal) return opened;
        closeOpened();
        status.textContent = 'Läser in…';
        var SQL = await loadSqlJs();
        var dbRead = await files.db.read();
        var walRead = files.wal ? await files.wal.read() : null;
        var hashes = await Promise.all([sha256(dbRead.bytes), walRead ? sha256(walRead.bytes) : Promise.resolve('')]);
        var merged = SqliteWal.apply(dbRead.bytes, walRead ? walRead.bytes : new Uint8Array(0));
        if (walRead && merged.stats.error) throw new Error(merged.stats.error);
        opened = {
            SQL: SQL, dbFile: files.db, walFile: files.wal, stats: merged.stats, hashes: hashes, bytes: merged.bytes,
            origin: dbRead.lines.concat(walRead ? walRead.lines : []),
        };
        return opened;
    }

    function walSummary(o) {
        if (!o.walFile) return 'Utan -wal.';
        var s = o.stats;
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
                walSummary(o),
            ];
            if (utc.added) lines.push('Kolumnerna som slutar på (UTC) är omräknade av Forensics Toolbox på samma sätt som i Härkomst. Råvärdet står i kolumnen till vänster.');
            var warn = o.origin.some(function (l) { return /STÄMMER INTE/.test(l); });
            status.innerHTML = lines.map(escapeHtml).join('<br>') +
                '<details class="run-trace"' + (warn ? ' open' : '') + '><summary>' +
                (warn ? '<span class="run-warn">Spårbarhet: CRC stämmer inte, se nedan</span>' : 'Spårbarhet: källa, CRC32 och SHA-256') +
                '</summary>' + hashLines(o).map(escapeHtml).join('<br>') + '</details>';
            if (res.columns.length) renderTable(res);
            csvButton.disabled = !res.columns.length;
            var geo = MapImport.guessColumns(res.columns.map(String));
            mapButton.disabled = !(count && geo.lat >= 0 && geo.lon >= 0);
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

    // Extraktion: databasen och -wal kommer ur en zip. Anropas efter att rätt databas valts,
    // eftersom bytet av databas tömmer rutan.
    function useSources(src) {
        files = { db: src.db, wal: src.wal || null, mismatch: false, zip: src.zip };
        noWal.checked = !src.wal;
        input.value = '';
        closeOpened();
        clearResult();
        status.textContent = '';
        updateState();
        $('run-box').scrollIntoView({ block: 'nearest' });
    }

    // Flikarna: filerna, den inlästa databasen och resultatet följer med fliken.
    function snapshot() {
        return {
            files: files, noWal: noWal.checked, opened: opened, last: last,
            statusHtml: status.innerHTML, resultHtml: result.innerHTML, csv: !csvButton.disabled, map: !mapButton.disabled,
        };
    }

    function restore(s) {
        if (!s) return;
        files = s.files || { db: null, wal: null };
        noWal.checked = !!s.noWal;
        opened = s.opened || null;
        last = s.last || null;
        status.innerHTML = s.statusHtml || '';
        setResult(s.resultHtml || '');
        csvButton.disabled = !s.csv;
        mapButton.disabled = !s.map;
        updateState();
    }

    window.QueriesRun = { useSources: useSources, run: runQuery, snapshot: snapshot, restore: restore };

    document.addEventListener('queries:db-change', reset);
    updateState();
})();
