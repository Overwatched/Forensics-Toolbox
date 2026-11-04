// Körningen i Queries: databasen och dess -wal läses in, WAL-ramarna läggs på en kopia i minnet
// och queryn körs med sql.js. Källfilerna öppnas bara för läsning. Källan står längst ned i
// queryrutan, resultatet under den och spårbarheten i fliken Spårbarhet. Filerna väljs med knappen
// högst upp (extraction.js), som också känner igen vilken databas det är.
(function () {
    'use strict';

    var MAX_SHOWN = 2000;
    // Rader som ritas åt gången. Resten ritas när rutan närmar sig slutet, så att en körning och ett flikbyte
    // inte behöver lägga ut tusentals rader som inte syns.
    var ROW_CHUNK = 200;
    // Inlästa databaser som hålls kvar när man byter databas eller flik, så att de inte läses, hashas och
    // dekrypteras om. Så mycket hålls kvar, utöver den som används.
    var KEEP_BYTES = 2 * 1024 * 1024 * 1024;

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
    var hitNote = $('run-hit');
    var preview = $('result-preview');
    var trace = $('run-trace');
    var TRACE_EMPTY = '<p class="muted">Kör queryn, så står källan, CRC32 och SHA-256 för filerna här.</p>';

    var files = { db: null, wal: null };
    var keyRow = $('run-key-row');
    var keyInput = $('run-key');
    var keyNote = $('run-key-note');
    var opened = null;
    var last = null;
    var sqlPromise = null;
    var kept = [];
    // Databasen som hålls öppen mellan körningarna, så att nästa query inte kopierar filen: { o, db, derived, deriveError }.
    var handle = null;
    // Raderna som inte är ritade än: { values, marked, numbered, next, end }.
    var pending = null;
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
        if (window.toolboxWasmProblem()) return Promise.reject(new Error(window.toolboxWasmProblem()));
        if (typeof initSqlJs !== 'function') return Promise.reject(new Error('sql.js kunde inte laddas.'));
        sqlPromise = initSqlJs({ wasmBinary: window.SQL_WASM_BINARY });
        return sqlPromise;
    }

    // En källa är en fil från disk eller en post i en zip. read() ger { bytes, lines }, där lines
    // beskriver var bytena kom ifrån (till spårbarheten och CSV-huvudet).
    function fileSource(file) {
        return {
            name: file.name,
            size: file.size,
            read: async function () {
                var line = 'Från disk: ' + file.name + ' (' + file.size + ' byte, ändrad ' + new Date(file.lastModified).toISOString() + ')';
                return { bytes: await ZipRead.readFile(file), lines: [line] };
            },
        };
    }

    function closeOpened() {
        opened = null;
    }

    // Exempelraderna behövs inte när det finns ett riktigt resultat.
    function setResult(html) {
        pending = null;
        result.innerHTML = html;
        preview.classList.toggle('display-none', !!html);
    }

    function setMapTitle(text) { mapButton.title = text; }

    function clearResult() {
        last = null;
        csvButton.disabled = true;
        mapButton.disabled = true;
        provButton.disabled = true;
        setMapTitle('Kör queryn först. Resultatet går att visa på karta när det har latitud och longitud.');
        csvButton.title = 'Kör queryn först';
        setResult('');
        setHitNote('');
        trace.innerHTML = TRACE_EMPTY;
    }

    function setHitNote(html) {
        hitNote.innerHTML = html;
        hitNote.classList.toggle('display-none', !html);
    }

    // Källan på en rad: filerna och var de kom ifrån.
    function updateState() {
        // Ett packat arkiv (PowerLogs dagsarkiv) är en stängd databas utan -wal.
        var closed = !!(files.db && files.db.archive);
        var ready = !!files.db && (!!files.wal || noWal.checked || closed);
        runButton.disabled = !ready;
        preview.classList.toggle('can-run', ready);
        noWalLabel.classList.toggle('display-none', !files.db || !!files.wal || !!files.zip || closed);
        var name = function (f) { return '<strong>' + escapeHtml(f.name) + '</strong>'; };
        var html;
        if (!files.db) html = 'Ingen databas öppen. Öppna den, eller extraktionen, med knappen högst upp.';
        else {
            html = name(files.db) + (files.wal ? ' och ' + name(files.wal) : '') + (files.zip ? ' ur ' + escapeHtml(files.zip) : ' från disk');
            if (files.cipher && files.cipher.passphrase && !keyInput.value.trim()) html += ', nyckeln ur ' + escapeHtml(files.cipher.source);
            html += '.';
            if (closed) html += ' Arkivet är gzip-komprimerat och packas upp i minnet. Ett arkiv har ingen -wal.';
            else if (!files.wal && files.zip) html += ' <span class="run-warn">Extraktionen har ingen -wal för databasen: allt som finns i databasfilen kommer med.</span>';
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
        try { return await readSources(src, cipher); }
        catch (err) { throw ZipRead.friendlyMemory(err, src.db.name, src.db.size || 0); }
    }

    async function readSources(src, cipher) {
        cipher = cipher || { profile: null, passphrase: null, source: null };
        var SQL = await loadSqlJs();
        var dbRead = await src.db.read();
        var walRead = src.wal ? await src.wal.read() : null;
        var hashes = await Promise.all([ExtractionCore.sha256(dbRead.bytes), walRead ? ExtractionCore.sha256(walRead.bytes) : Promise.resolve('')]);
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
            merged = await SqlCipher.openAsync(dbRead.bytes, walBytes, cipher.passphrase, cipher.profile, SqliteWal);
            origin.push(SqlCipher.summary(merged.stats, cipher.source));
        } else {
            merged = SqliteWal.apply(dbRead.bytes, walBytes, { owned: true });
        }
        // En -wal som inte går att lägga på läses inte, som i SQLite. walSummary säger det vid körningen.
        return {
            SQL: SQL, dbFile: src.db, walFile: src.wal || null, stats: merged.stats, hashes: hashes, bytes: merged.bytes,
            origin: origin, passphrase: cipher.passphrase, encrypted: encrypted,
        };
    }

    function keepKey(cipher) {
        if (!files.db || !files.db.key) return '';
        return [files.db.key, files.wal ? files.wal.key : '', cipher.passphrase || ''].join('\u0000');
    }

    function closeHandle() {
        if (handle) { try { handle.db.close(); } catch (e) { /* redan stängd */ } }
        handle = null;
    }

    // Tar bort de äldsta tills det som hålls kvar får plats. Den senast använda står sist och blir kvar.
    function keep(key, o) {
        kept = kept.filter(function (k) { return k.key !== key; });
        kept.push({ key: key, o: o });
        var total = kept.reduce(function (n, k) { return n + k.o.bytes.length; }, 0);
        while (kept.length > 1 && total > KEEP_BYTES) {
            var old = kept.shift();
            total -= old.o.bytes.length;
            if (handle && handle.o === old.o) closeHandle();
        }
    }

    function forgetKept() {
        closeHandle();
        kept = [];
    }

    async function open() {
        var cipher = currentCipher();
        if (opened && opened.dbFile === files.db && opened.walFile === files.wal && opened.passphrase === cipher.passphrase) return opened;
        closeOpened();
        var key = keepKey(cipher);
        var hit = key ? kept.find(function (k) { return k.key === key; }) : null;
        if (hit) {
            keep(key, hit.o);
            opened = hit.o;
        } else {
            status.textContent = 'Läser in…';
            try {
                try { opened = await load(files, cipher); }
                catch (err) {
                    // Minnet räcker inte: det som hålls kvar släpps, och läsningen görs om en gång.
                    if (!err || err.code !== 'MEMORY' || !kept.length) throw err;
                    forgetKept();
                    opened = await load(files, cipher);
                }
            } catch (err) {
                if (err && err.code === 'ENCRYPTED') { files.encrypted = true; showKeyRow(); }
                throw err;
            }
            if (key) keep(key, opened);
        }
        if (opened.encrypted) { files.encrypted = true; showKeyRow(); }
        return opened;
    }

    // Telegrams databaser: tabellerna tg_… avkodas i minnet ur Telegrams eget format (postbox.js). De
    // avkodade raderna sparas med den öppnade filen, så nästa körning går fortare.
    function attachDerived(db, o, out) {
        try { out.derived = window.TelegramPostbox ? window.TelegramPostbox.attach(db, o.derived || (o.derived = {})) : null; }
        catch (e) { out.derived = null; out.deriveError = 'Telegrams format kunde inte avkodas: ' + (e && e.message ? e.message : e); }
    }

    // SQL som bara läser körs mot en databas som hålls öppen, utan kopia av filen. query_only stoppar
    // skrivningar om något skulle slinka förbi QueryRunCore.readsOnly().
    function openForReading(o) {
        if (handle && handle.o === o) return handle;
        closeHandle();
        var h = { o: o, db: null, derived: null, deriveError: '' };
        try { h.db = new o.SQL.Database(ExtractionCore.noCopy(o.bytes)); }
        catch (err) { throw ZipRead.friendlyMemory(err, o.dbFile.name, o.bytes.length); }
        attachDerived(h.db, o, h);
        h.db.run('PRAGMA query_only = ON');
        handle = h;
        return h;
    }

    // Allt annat körs mot en egen kopia, så att en redigerad query som ändrar något inte påverkar nästa körning.
    function openCopy(o) {
        var h = { o: o, db: null, derived: null, deriveError: '' };
        try { h.db = new o.SQL.Database(o.bytes); }
        catch (err) { throw ZipRead.friendlyMemory(err, o.dbFile.name, o.bytes.length); }
        attachDerived(h.db, o, h);
        return h;
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

    // hits: raderna som ska markeras (en händelse från Härkomst). Då står radnumret först, och raderna som
    // visas väljs runt den första markerade när resultatet är större än det som får plats.
    function renderTable(res, hits) {
        var marked = {};
        (hits || []).forEach(function (n) { marked[n] = true; });
        var numbered = hits !== undefined && hits !== null;
        var win = QueryRunCore.rowWindow(res.values.length, hits, MAX_SHOWN);
        // De markerade raderna ritas direkt, med raderna före dem.
        var lastHit = hits && hits.length ? hits[hits.length - 1] + 1 : win.start;
        var end = Math.min(win.end, Math.max(win.start, lastHit) + ROW_CHUNK);
        setResult('<table><thead><tr>' + (numbered ? '<th class="row-no">Rad</th>' : '') +
            res.columns.map(function (c) { return '<th>' + escapeHtml(c) + '</th>'; }).join('') +
            '</tr></thead><tbody>' + rowsHtml(res.values, win.start, end, marked, numbered) + '</tbody></table>');
        pending = end < win.end ? { values: res.values, marked: marked, numbered: numbered, next: end, end: win.end } : null;
        return win;
    }

    function rowsHtml(values, from, to, marked, numbered) {
        return values.slice(from, to).map(function (r, i) {
            var n = from + i;
            return '<tr' + (marked[n] ? ' class="row-hit"' : '') + '>' + (numbered ? '<td class="row-no">' + (n + 1) + '</td>' : '') + r.map(function (v) {
                return '<td' + (v === null ? ' class="null"' : '') + '>' + escapeHtml(QueryRunCore.cellText(v)) + '</td>';
            }).join('') + '</tr>';
        }).join('');
    }

    function drawMore() {
        if (!pending || result.scrollTop + result.clientHeight < result.scrollHeight - 1000) return;
        var body = result.querySelector('tbody');
        if (!body) { pending = null; return; }
        var to = Math.min(pending.end, pending.next + ROW_CHUNK);
        body.insertAdjacentHTML('beforeend', rowsHtml(pending.values, pending.next, to, pending.marked, pending.numbered));
        pending.next = to;
        if (to >= pending.end) pending = null;
    }

    result.addEventListener('scroll', drawMore);

    // Den första markerade raden mitt i rutan. Ger false när ingen rad är markerad.
    function showHit() {
        var row = result.querySelector('tr.row-hit');
        if (!row) return false;
        result.scrollLeft = 0;
        row.scrollIntoView({ block: 'center' });
        return true;
    }

    function listRows(hits) {
        var shown = hits.slice(0, 6).map(function (n) { return n + 1; });
        var text = shown.length > 1 ? shown.slice(0, -1).join(', ') + ' och ' + shown[shown.length - 1] : String(shown[0]);
        return hits.length > 6 ? text + ' med flera' : text;
    }

    // Raden ovanför tabellen: vilken händelse det gäller och vilka rader som är markerade.
    // fromStart: händelsens tid finns inte i svaret, så raden där den började är markerad.
    function hitText(mark, hits, total, win, fromStart) {
        var what = (mark.text ? '"' + escapeHtml(mark.text) + '"' : 'Händelsen') + (mark.time ? ', ' + escapeHtml(mark.time) : '') + '. ';
        if (!hits.length) {
            return what + '<span class="run-warn">Ingen rad har händelsens tid.</span> Den kan vara räknad ur flera rader. Hela resultatet visas.';
        }
        var rows = hits.length === 1 ? 'Rad ' + (hits[0] + 1) + ' av ' + total + ' är markerad.'
            : hits.length + ' rader av ' + total + ' är markerade, eftersom de har samma tid: ' + listRows(hits) + '.';
        var start = fromStart ? ' Tiden står inte i den här queryn, eftersom slutet kommer ur en annan källa, till exempel att skärmen släcktes. Markeringen visar var det började.' : '';
        var cut = total > win.end - win.start ? ' Raderna ' + (win.start + 1) + '–' + win.end + ' visas. CSV-filen får alla.' : '';
        return what + rows + start + cut + ' <button type="button" class="link-btn" id="run-hit-show">Visa raden</button>';
    }

    // Markerar händelsen i resultatet som visas. Används efter en körning och när samma query klickas på igen.
    function applyMark(mark) {
        if (!last) return false;
        var specs = window.QueriesApp.timeColumns ? window.QueriesApp.timeColumns() : null;
        var hits = QueryRunCore.findRows(last.columns, last.rows, specs, mark);
        var fromStart = false;
        if (!hits.length && mark.startMs !== undefined && mark.startMs !== null) {
            hits = QueryRunCore.findRows(last.columns, last.rows, specs, { ms: [mark.startMs], values: mark.values });
            fromStart = hits.length > 0;
        }
        var win = renderTable({ columns: last.columns, values: last.rows }, hits);
        setHitNote(hitText(mark, hits, last.rows.length, win, fromStart));
        return true;
    }

    async function runQuery(opts) {
        var app = window.QueriesApp;
        var sql = app ? app.currentSql() : '';
        if (!sql.trim() || runButton.disabled) return;
        runButton.disabled = true;
        clearResult();
        // Exempelraderna hör till en query som inte körts: inte under körningen, och inte under ett fel.
        preview.classList.add('display-none');
        try {
            var o = await open();
            var shared = QueryRunCore.readsOnly(sql);
            var h = shared ? openForReading(o) : openCopy(o);
            var started = performance.now();
            var all;
            try { all = h.db.exec(sql); } finally { if (!shared) h.db.close(); }
            var ms = Math.round(performance.now() - started);
            var derived = h.derived;
            var deriveError = h.deriveError;
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
            var deriveWarn = deriveError || (derived && derived.errors ? derived.line : '');
            var geo = MapImport.guessColumns(res.columns.map(String));
            var hasMap = !!(count && geo.lat >= 0 && geo.lon >= 0);
            status.innerHTML = '<span class="result-tag">Resultat</span>' + lines.map(escapeHtml).join(' ') +
                (hasMap ? ' <button type="button" class="link-btn" id="run-map-link">Visa på karta</button>' : '') +
                (o.stats.error ? '<br><span class="run-warn">' + escapeHtml(walSummary(o)) + '</span>' : '') +
                (deriveWarn ? '<br><span class="run-warn">' + escapeHtml(deriveWarn) + '</span>' : '') + (warn
                ? '<br><span class="run-warn">CRC32 stämmer inte för en fil ur zippen.</span> <button type="button" class="link-btn" data-show-pane="trace">Visa spårbarheten</button>'
                : '');
            trace.innerHTML = hashLines(o).concat(derived ? [derived.line] : []).map(escapeHtml).join('<br>');
            if (warn) document.dispatchEvent(new CustomEvent('queries:show-pane', { detail: 'trace' }));
            // Utan rader ger sql.js inga kolumner: exempelraderna ska inte stå kvar under "0 rader".
            if (res.columns.length) {
                if (opts && opts.mark) applyMark(opts.mark);
                else renderTable(res);
            } else setResult('<p class="muted run-empty">Queryn gav inga rader.</p>');
            csvButton.disabled = !res.columns.length;
            csvButton.title = '';
            mapButton.disabled = !hasMap;
            setMapTitle(hasMap ? 'Visar raderna som har en position i verktyget Positioner, som ett eget lager' : count ? 'Resultatet har ingen kolumn med latitud och longitud' : 'Queryn gav inga rader');
            provButton.disabled = !(count && nameColumn(res.columns) >= 0);
        } catch (err) {
            status.innerHTML = '<span class="run-warn">' + escapeHtml(err && err.message ? err.message : String(err)) + '</span>';
        } finally {
            updateState();
        }
    }

    runButton.addEventListener('click', function () { runQuery(); });
    preview.addEventListener('click', function (e) { if (e.target.closest('#preview-run')) runQuery(); });
    hitNote.addEventListener('click', function (e) { if (e.target.closest('#run-hit-show')) showHit(); });
    status.addEventListener('click', function (e) { if (e.target.closest('#run-map-link')) sendToMap(); });

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

    function sendToMap() {
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
    }

    mapButton.addEventListener('click', sendToMap);

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

    // Flikarna: filerna, den inlästa databasen och resultatet följer med fliken. Tabellen flyttas ut ur sidan
    // i stället för att sparas som text, så att bytet inte tolkar om tusentals rader, och rutan står kvar där den var.
    function snapshot() {
        var scrollTop = result.scrollTop;
        var scrollLeft = result.scrollLeft;
        var nodes = document.createDocumentFragment();
        while (result.firstChild) nodes.appendChild(result.firstChild);
        return {
            files: files, noWal: noWal.checked, opened: opened, last: last, keyWanted: keyWanted,
            statusHtml: status.innerHTML, nodes: nodes, pending: pending, scrollTop: scrollTop, scrollLeft: scrollLeft, hitHtml: hitNote.innerHTML, traceHtml: trace.innerHTML,
            csv: !csvButton.disabled, map: !mapButton.disabled, prov: !provButton.disabled, mapTitle: mapButton.title,
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
        result.innerHTML = '';
        if (s.nodes) result.appendChild(s.nodes);
        s.nodes = null;
        pending = s.pending || null;
        preview.classList.toggle('display-none', result.hasChildNodes());
        result.scrollTop = s.scrollTop || 0;
        result.scrollLeft = s.scrollLeft || 0;
        setHitNote(s.hitHtml || '');
        trace.innerHTML = s.traceHtml || TRACE_EMPTY;
        csvButton.disabled = !s.csv;
        mapButton.disabled = !s.map;
        mapButton.title = s.mapTitle || '';
        provButton.disabled = !s.prov;
        updateState();
    }

    window.QueriesRun = {
        useCipher: useCipher,
        useSources: useSources, run: runQuery, snapshot: snapshot, restore: restore,
        load: load, fileSource: fileSource, sql: loadSqlJs,
        mark: applyMark, showHit: showHit, hasResult: function () { return !!last; }, forgetKept: forgetKept,
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
