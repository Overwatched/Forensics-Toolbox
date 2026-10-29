// Härkomst: öppnar extraktionen med samma moduler som Queries, hämtar filens rad, kör
// rollqueryerna ur katalogerna mot databaserna (med -wal), läser EXIF ur bildfilen i zippen,
// och visar tidslinjen, faktorerna och förklaringen. Zippen läses bara via File.slice().
// Inget sparas på disk utom de exporter användaren själv laddar ner.
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var MAX_MEDIA = 200 * 1024 * 1024;
    var TIME_KEYS = ['created', 'added', 'modified'];

    var state = {
        sources: null, databases: null, targets: null, toolVersion: '',
        zip: null,           // { file, read, found, version, platform, zipLine, snapEntries }
        loaded: {},          // zip-postens namn -> laddad databas (bytes, stats, hashes, sqlDb …)
        exif: null,          // ExifTool-motorn
        model: null, meta: null, pngs: [],
    };
    var SQL = null;

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function showToast(text) {
        var t = $('toast');
        t.textContent = text || 'Kopierat';
        t.classList.add('show');
        setTimeout(function () { t.classList.remove('show'); }, 1400);
    }

    function setStatus(id, html, kind) {
        $(id).innerHTML = kind ? '<span class="' + kind + '">' + html + '</span>' : html;
    }

    // ---------- Appnamn och kameraappar ur App-ID-katalogen ----------

    function appName(id) {
        if (!id || !window.AppIds) return null;
        var r = window.AppIds.resolveId(id);
        return r && r.entry && r.match === 'exakt' ? r.entry.name : null;
    }

    function cameraApps() {
        var out = ['com.apple.camera'];
        (window.AppIds ? window.AppIds.APPS : []).forEach(function (a) {
            if (!/camera|kamera/i.test(a.id + ' ' + a.name) || !/system/.test(a.category)) return;
            if (a.android) out.push(a.android);
            if (a.ios && a.ios.bundleId) out.push(a.ios.bundleId);
        });
        return out;
    }

    // ---------- Tidszon ----------

    function offsetText(minutes) {
        var sign = minutes < 0 ? '-' : '+';
        var abs = Math.abs(minutes);
        return 'UTC' + sign + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0');
    }

    function zoneFormatter(name, offsetMinutes) {
        if (name) {
            try {
                var f = new Intl.DateTimeFormat('sv-SE', { timeZone: name, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
                f.format(0);
                return function (ms) { return f.format(new Date(ms)).replace(',', ''); };
            } catch (e) { /* okänt zonnamn: fast förskjutning */ }
        }
        return function (ms) { return ProvenanceCore.formatWithOffset(ms, offsetMinutes || 0); };
    }

    function localZone() {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
    }

    function fillZoneSelect(file) {
        var sel = $('zone');
        var opts = [];
        if (file && (file.zoneName || file.zoneOffset != null)) {
            var label = file.zoneName || offsetText(Number(file.zoneOffset) / 60);
            opts.push({ value: 'file', label: 'Bildens zon: ' + label });
        }
        var local = localZone();
        opts.push({ value: 'local', label: 'Datorns zon: ' + (local || offsetText(-new Date().getTimezoneOffset())) });
        opts.push({ value: 'utc', label: 'UTC' });
        var current = sel.value;
        sel.innerHTML = opts.map(function (o) { return '<option value="' + o.value + '">' + escapeHtml(o.label) + '</option>'; }).join('');
        // Bildens egen zon är standard så länge användaren inte själv valt något annat.
        var keep = zoneTouched && opts.some(function (o) { return o.value === current; });
        sel.value = keep ? current : opts[0].value;
    }
    var zoneTouched = false;

    function zoneChoice(file) {
        var v = $('zone').value;
        if (v === 'file' && file && (file.zoneName || file.zoneOffset != null)) {
            var minutes = file.zoneOffset != null ? Math.round(Number(file.zoneOffset) / 60) : 0;
            return { label: file.zoneName || offsetText(minutes), note: 'ur bildens ' + (file.zoneName ? 'ZTIMEZONENAME' : 'ZTIMEZONEOFFSET'), format: zoneFormatter(file.zoneName, minutes), offsetMinutes: minutes };
        }
        if (v === 'utc') return { label: 'UTC', note: '', format: zoneFormatter('UTC', 0), offsetMinutes: 0 };
        var local = localZone();
        return { label: local || offsetText(-new Date().getTimezoneOffset()), note: 'datorns tidszon, antagen', format: zoneFormatter(local, -new Date().getTimezoneOffset()), offsetMinutes: -new Date().getTimezoneOffset() };
    }

    // ---------- Extraktionen ----------

    function sourceByKey(key) { return state.sources.find(function (s) { return s.key === key; }); }
    function hitFor(key) { return state.zip ? state.zip.found.find(function (f) { return f.key === key; }) || null : null; }

    function renderFound() {
        var z = state.zip;
        var rows = z.found.map(function (f) {
            var src = sourceByKey(f.key);
            var note = /Syndication\.photoslibrary/.test(f.db.name) ? ' (Delat med dig, används inte)' : f.user ? ' (användare ' + f.user + ')' : '';
            if (src && src.beta) note += ' (beta)';
            return '<tr><td>' + escapeHtml(src ? src.title : f.key) + escapeHtml(note) + '</td><td class="path">' + escapeHtml(f.db.name) + '</td>' +
                '<td>' + escapeHtml(ExtractionCore.sizeText(f.db.size)) + '</td><td>' + escapeHtml(ExtractionCore.entryTime(f.db)) + '</td>' +
                '<td>' + (f.wal ? escapeHtml(ExtractionCore.sizeText(f.wal.size)) : '<span class="warn">saknas</span>') + '</td></tr>';
        }).join('');
        $('ex-list').innerHTML = z.found.length
            ? '<div class="result-scroll"><table><thead><tr><th>Databas</th><th>Sökväg i zippen</th><th>Storlek</th><th>Ändrad (enligt zippen)</th><th>-wal</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
            : '<p class="muted">Ingen av databaserna hittades i zippen.</p>';
    }

    async function openZip(file) {
        closeZip();
        setStatus('ex-status', 'Läser zippens innehållsförteckning…');
        var read = ZipRead.fileReader(file);
        var opened = await ExtractionCore.open(read, file.size, state.targets, function (done, total) {
            setStatus('ex-status', 'Läser zippens innehållsförteckning… ' + Math.round(100 * done / total) + ' %');
        });
        var keys = opened.found.map(function (f) { return f.key; });
        var platform = keys.indexOf('photos') >= 0 ? 'iOS' : keys.indexOf('android-mediastore') >= 0 ? 'Android' : null;
        state.zip = {
            file: file, read: read, found: opened.found, version: opened.version, platform: platform,
            zipLine: 'Extraktion: ' + file.name + ' (' + file.size + ' byte, ändrad ' + new Date(file.lastModified).toISOString() + ')',
        };
        var text = opened.found.length + (opened.found.length === 1 ? ' databas' : ' databaser') + ' hittades på ' + opened.seconds.toFixed(1).replace('.', ',') + ' s. ' +
            file.name + ' · ' + ExtractionCore.sizeText(file.size) + (opened.version ? ' · iOS ' + opened.version : platform === 'Android' ? ' · Android' : '');
        if (!platform) text += ' Varken Photos.sqlite eller MediaStore hittades, så ingen fil kan bedömas.';
        setStatus('ex-status', escapeHtml(text));
        renderFound();
        $('ex-close').classList.remove('display-none');
        $('ex-pick').textContent = 'Öppna en annan zip…';
        $('file-box').classList.toggle('display-none', !platform);
        fillZoneSelect(null);
        if (platform) $('filename').focus();
    }

    function closeZip() {
        Object.keys(state.loaded).forEach(function (k) { if (state.loaded[k].sqlDb) state.loaded[k].sqlDb.close(); });
        state.loaded = {};
        state.zip = null;
        state.model = null;
        if (mapView) mapView.setPoints([], '');
        $('ex-list').innerHTML = '';
        setStatus('ex-status', '');
        $('ex-close').classList.add('display-none');
        $('ex-pick').textContent = 'Öppna extraktion (zip)…';
        $('file-box').classList.add('display-none');
        $('result').classList.add('display-none');
        $('hits').classList.add('display-none');
        $('copies-box').classList.add('display-none');
        setStatus('run-status', '');
    }

    // ---------- Databaser och rollqueryer ----------

    async function loadSql() {
        if (SQL) return SQL;
        if (typeof initSqlJs !== 'function') throw new Error('sql.js kunde inte laddas.');
        SQL = await initSqlJs({ wasmBinary: window.SQL_WASM_BINARY });
        return SQL;
    }

    async function loadDb(hit, label) {
        var key = hit.db.name;
        if (state.loaded[key]) return state.loaded[key];
        await loadSql();
        var loaded = await ExtractionCore.loadDatabase(state.zip.read, hit, [state.zip.zipLine]);
        loaded.label = label;
        loaded.sqlDb = new SQL.Database(loaded.bytes);
        state.loaded[key] = loaded;
        return loaded;
    }

    // Kör en rollquery och ger raderna med fältkartans namn. Varje körning sparas till protokollet.
    function runRole(loaded, query, values, timeKeys, run) {
        var sql = ProvenanceRoles.fill(query.sql, values);
        var all = loaded.sqlDb.exec(sql);
        var res = all.length ? all[all.length - 1] : { columns: [], values: [] };
        run.queries.push({ id: query.id, db: loaded.label, title: query.title, sql: sql });
        return { rows: ProvenanceRoles.mapRows(query, res, timeKeys), result: res, sql: sql };
    }

    function coverageFrom(rows, keyField) {
        var out = {};
        rows.forEach(function (r) {
            var key = keyField ? r[keyField] : 'all';
            out[key] = { firstMs: ProvenanceRoles.toMs(r.first, r._epoch), lastMs: ProvenanceRoles.toMs(r.last, r._epoch), rows: Number(r.rows) };
        });
        return out;
    }

    function mapCoverage(query, result) {
        var rows = ProvenanceRoles.mapRows(query, result, ['first', 'last']);
        var out = {};
        rows.forEach(function (r) {
            out[r.stream || 'all'] = { firstMs: r.firstMs, lastMs: r.lastMs, rows: Number(r.rows) };
        });
        return out;
    }

    // ---------- Bildfilen i zippen och EXIF ----------

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('Kunde inte ladda ' + src)); };
            document.head.appendChild(s);
        });
    }

    async function exifEngine() {
        if (state.exif) return state.exif;
        if (!window.EXIFTOOL_WORKER_SOURCE) await loadScript('../exif-viewer/vendor/exiftool/exiftool-worker.js');
        if (!window.EXIFTOOL_WASM_GZ) await loadScript('../exif-viewer/vendor/exiftool/zeroperl-wasm.js');
        var url = URL.createObjectURL(new Blob([window.EXIFTOOL_WORKER_SOURCE], { type: 'text/javascript' }));
        var worker = new Worker(url);
        var engine = { worker: worker, pending: {}, next: 1 };
        await new Promise(function (resolve, reject) {
            worker.onmessage = function (event) {
                var msg = event.data || {};
                if (msg.type === 'ready') { URL.revokeObjectURL(url); resolve(); }
                else if (msg.type === 'init-error') reject(new Error('ExifTool kunde inte starta: ' + msg.error));
                else if (msg.type === 'result' && engine.pending[msg.id]) {
                    var p = engine.pending[msg.id];
                    delete engine.pending[msg.id];
                    if (msg.ok) p.resolve(msg.tags || {}); else p.reject(new Error(msg.error || 'ExifTool misslyckades'));
                }
            };
            worker.onerror = function (event) {
                event.preventDefault();
                Object.keys(engine.pending).forEach(function (id) { engine.pending[id].reject(new Error('ExifTool avbröts: ' + (event.message || 'okänt fel'))); });
                engine.pending = {};
                state.exif = null;
            };
            worker.postMessage({ type: 'init', wasmGz: window.EXIFTOOL_WASM_GZ });
        });
        state.exif = engine;
        return engine;
    }

    async function readTags(bytes, name) {
        var engine = await exifEngine();
        var id = engine.next++;
        return new Promise(function (resolve, reject) {
            engine.pending[id] = { resolve: resolve, reject: reject };
            engine.worker.postMessage({ type: 'parse', id: id, file: new File([bytes], name), unknown: false });
        });
    }

    // EXIF-tiden i filen -> UTC-millisekunder. Utan zon i taggen antas bevisets zon.
    function exifTakenMs(taken, offsetMinutes) {
        if (!taken || !taken.sort) return { ms: null, assumed: false };
        var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d+)?/.exec(taken.sort);
        if (!m) return { ms: null, assumed: false };
        var base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + (m[7] ? Math.round(Number(m[7]) * 1000) : 0);
        var z = taken.zone || '';
        if (z === 'UTC') return { ms: base, assumed: false };
        var zm = /^([+\-])(\d{2}):?(\d{2})$/.exec(z);
        if (zm) return { ms: base - (zm[1] === '-' ? -1 : 1) * (Number(zm[2]) * 60 + Number(zm[3])) * 60000, assumed: false };
        return { ms: base - (offsetMinutes || 0) * 60000, assumed: true };
    }

    var EXIF_ROW_RE = /DateTimeOriginal|CreateDate|CreationDate|OffsetTime|:Make$|:Model$|Software|ModifyDate|GPS(Latitude|Longitude)$|ImageWidth$|ImageHeight$|FileType$|MIMEType$|UserComment|HostComputer|LensModel/;

    function mediaSuffix(file, platform) {
        if (platform === 'Android') {
            var p = String(file.path || '');
            var m = /(?:emulated\/\d+|sdcard|storage\/[^/]+)\/(.+)$/.exec(p);
            if (m) return m[1];
            if (file.relativePath) return String(file.relativePath).replace(/\/?$/, '/') + file.filename;
            return null;
        }
        if (!file.directory || !file.filename) return null;
        return 'Media/' + file.directory + '/' + file.filename;
    }

    async function findMedia(file, platform) {
        var suffix = mediaSuffix(file, platform);
        if (!suffix) return { entry: null, reason: 'sökvägen i databasen går inte att tolka', paired: null };
        var stem = suffix.replace(/\.[^.]+$/, '');
        var lowerSuffix = suffix.toLowerCase();
        var lowerStem = stem.toLowerCase();
        var entries = await ExtractionCore.find(state.zip.read, state.zip.file.size, function (name) {
            var n = name.toLowerCase();
            return n.endsWith('/' + lowerSuffix) || n === lowerSuffix || /\.(mov|mp4)$/.test(n) && (n.endsWith('/' + lowerStem + '.mov') || n.endsWith('/' + lowerStem + '.mp4'));
        });
        entries.sort(function (a, b) { return a.name.length - b.name.length; });
        var entry = entries.find(function (e) { return e.name.toLowerCase().endsWith(lowerSuffix); }) || null;
        var paired = /\.(heic|jpg|jpeg|png)$/i.test(suffix) ? entries.find(function (e) { return e !== entry && /\.(mov|mp4)$/i.test(e.name); }) || null : null;
        return { entry: entry, paired: paired, reason: entry ? '' : 'filen finns inte i zippen (iCloud-optimerad, raderad eller utanför extraktionen)' };
    }

    async function readMedia(entry) {
        if (entry.size > MAX_MEDIA) return { bytes: null, reason: 'filen är ' + ExtractionCore.sizeText(entry.size) + ', över gränsen på 200 MB för EXIF-läsning' };
        var r = await ExtractionCore.readEntry(state.zip.read, entry);
        var sha = await ExtractionCore.sha256(r.bytes);
        return { bytes: r.bytes, crcOk: r.crcOk, sha256: sha, line: r.line };
    }

    // ---------- Bedömningen ----------

    async function assess(fileRow, fileQuery, windowMs, run) {
        var z = state.zip;
        var platform = z.platform;
        var zone = zoneChoice(fileRow);
        var fmt = zone.format;
        var cams = cameraApps();
        var wins = ProvenanceCore.windows(fileRow, windowMs);
        var range = { startMs: Math.min.apply(null, wins.map(function (w) { return w.startMs; })), endMs: Math.max.apply(null, wins.map(function (w) { return w.endMs; })) };
        var input = {
            platform: platform, file: fileRow, appNames: appName, cameraApps: cams, windowMs: windowMs, format: fmt,
            fileSource: run.fileSource || { db: run.fileLabel, table: platform === 'Android' ? 'files' : fileQuery.sql.indexOf('ZGENERICASSET') >= 0 ? 'ZGENERICASSET' : 'ZASSET', column: fileQuery.fields.created.col || fileQuery.fields.created, queryId: fileQuery.id },
            appIntervals: [], screen: [], lock: [], locations: [], neighbours: [], coverage: {}, missingDbs: {}, warnings: [], copies: [], extraEvents: [], extraNotes: [],
        };
        var meta = { sources: [], queries: run.queries, coverage: [], fileRows: [], exifRows: [], fileEntry: null, fileMissingReason: '', timelinePngs: [], copiesNote: '' };

        // Grannar ur samma databas som filen, eller ur bildbiblioteket när filen ligger utanför det.
        var fileRoles = run.fileRoles || {};
        var nbRoles = run.neighbourRoles || fileRoles;
        if (nbRoles.neighbours) {
            input.neighbours = runRole(run.neighbourDb || run.fileDb, nbRoles.neighbours, { window: range }, ['created', 'added'], run).rows;
            input.neighbourSource = run.neighbourSource || { db: run.fileLabel, table: input.fileSource.table, column: nbRoles.neighbours.fields.created, queryId: nbRoles.neighbours.id };
        }
        var seq = /^(.*?)(\d+)(\.[^.]+)$/.exec(fileRow.filename || '');
        if (fileRoles.sequence && seq) {
            var n = Number(seq[2]);
            var width = seq[2].length;
            var prev = seq[1] + String(n - 1).padStart(width, '0');
            var next = seq[1] + String(n + 1).padStart(width, '0');
            var seqRows = runRole(run.fileDb, fileRoles.sequence, { prevStem: prev, nextStem: next }, ['created', 'added'], run).rows;
            var seen = {};
            input.neighbours.forEach(function (r) { seen[r.pk] = true; });
            seqRows.forEach(function (r) { if (!seen[r.pk]) input.neighbours.push(r); });
        }

        // App, skärm, lås: knowledgeC på iOS, Wellbeing på Android.
        if (platform === 'iOS') {
            var kc = hitFor('knowledgec');
            if (kc) {
                var kcSrc = sourceByKey('knowledgec');
                var kcDb = await loadDb(kc, kcSrc.title);
                var mk = function (stream, cols, qid) { return { db: 'knowledgeC.db', table: 'ZOBJECT', stream: stream, column: cols, queryId: qid }; };
                ['app-usage', 'app-infocus'].forEach(function (role) {
                    var q = kcSrc.roles[role];
                    if (!q) return;
                    var stream = role === 'app-usage' ? '/app/usage' : '/app/inFocus';
                    runRole(kcDb, q, { window: range }, ['start', 'end'], run).rows.forEach(function (r) {
                        if (r.startMs == null || r.endMs == null) return;
                        input.appIntervals.push({ startMs: r.startMs, endMs: r.endMs, app: r.value, stream: stream, source: mk(stream, 'ZSTARTDATE, ZENDDATE, ZVALUESTRING', q.id) });
                    });
                });
                if (kcSrc.roles.screen) {
                    runRole(kcDb, kcSrc.roles.screen, { window: range }, ['start', 'end'], run).rows.forEach(function (r) {
                        if (r.startMs == null || r.endMs == null) return;
                        input.screen.push({ startMs: r.startMs, endMs: r.endMs, on: Number(r.value) === 1, stream: '/display/isBacklit', source: mk('/display/isBacklit', 'ZSTARTDATE, ZENDDATE, ZVALUEINTEGER', kcSrc.roles.screen.id) });
                    });
                }
                if (kcSrc.roles.lock) {
                    runRole(kcDb, kcSrc.roles.lock, { window: range }, ['start', 'end'], run).rows.forEach(function (r) {
                        if (r.startMs == null || r.endMs == null) return;
                        input.lock.push({ startMs: r.startMs, endMs: r.endMs, locked: Number(r.value) === 1, stream: '/device/isLocked', source: mk('/device/isLocked', 'ZSTARTDATE, ZENDDATE, ZVALUEINTEGER', kcSrc.roles.lock.id) });
                    });
                }
                if (kcSrc.roles.coverage) {
                    var cov = runRole(kcDb, kcSrc.roles.coverage, {}, ['first', 'last'], run).rows;
                    cov.forEach(function (r) {
                        input.coverage[r.stream] = { firstMs: r.firstMs, lastMs: r.lastMs, rows: Number(r.rows) };
                        meta.coverage.push([r.stream, r.firstMs ? ProvenanceCore.formatUtc(r.firstMs) : '', r.lastMs ? ProvenanceCore.formatUtc(r.lastMs) : '', Number(r.rows)]);
                    });
                    ['/app/usage', '/app/inFocus', '/display/isBacklit', '/device/isLocked'].forEach(function (s) { if (!input.coverage[s]) input.coverage[s] = { firstMs: null, lastMs: null, rows: 0 }; });
                }
                input.warnings = input.warnings.concat(kcDb.warnings);
            } else {
                input.missingDbs['/app/usage'] = true;
                input.missingDbs['/display/isBacklit'] = true;
            }
            var rt = hitFor('routined-cache');
            if (rt) {
                var rtSrc = sourceByKey('routined-cache');
                var rtDb = await loadDb(rt, rtSrc.title);
                if (rtSrc.roles.location) {
                    input.locationSource = { db: 'Cache.sqlite', table: 'ZRTCLLOCATIONMO', column: 'ZTIMESTAMP, ZLATITUDE, ZLONGITUDE', queryId: rtSrc.roles.location.id };
                    runRole(rtDb, rtSrc.roles.location, { window: range }, ['time'], run).rows.forEach(function (r) {
                        if (r.timeMs == null) return;
                        input.locations.push({ ms: r.timeMs, lat: Number(r.latitude), lon: Number(r.longitude), accuracy: Number(r.accuracy), type: Number(r.type) });
                    });
                }
                input.warnings = input.warnings.concat(rtDb.warnings);
            } else {
                input.missingDbs.routined = true;
            }
        } else {
            input.missingDbs.routined = true;
            var wb = hitFor('wellbeing');
            if (wb) {
                var wbSrc = sourceByKey('wellbeing');
                var wbDb = await loadDb(wb, wbSrc.title);
                var wbSource = { db: 'app_usage', table: 'events', column: 'timestamp, type, package_name', queryId: wbSrc.roles['app-events'].id };
                var ev = runRole(wbDb, wbSrc.roles['app-events'], { window: range }, ['time'], run).rows
                    .filter(function (r) { return r.timeMs != null; })
                    .map(function (r) { return { ms: r.timeMs, type: Number(r.type), app: r.app }; });
                var iv = ProvenanceCore.intervalsFromEvents(ev, range.endMs, wbSource);
                input.appIntervals = iv.apps;
                input.screen = iv.screen;
                input.lock = iv.lock;
                if (wbSrc.roles.coverage) {
                    var wcov = runRole(wbDb, wbSrc.roles.coverage, {}, ['first', 'last'], run).rows[0];
                    if (wcov) {
                        input.coverage.wellbeing = { firstMs: wcov.firstMs, lastMs: wcov.lastMs, rows: Number(wcov.rows) };
                        meta.coverage.push(['Wellbeing events', wcov.firstMs ? ProvenanceCore.formatUtc(wcov.firstMs) : '', wcov.lastMs ? ProvenanceCore.formatUtc(wcov.lastMs) : '', Number(wcov.rows)]);
                    }
                }
                input.warnings = input.warnings.concat(wbDb.warnings);
            } else {
                input.missingDbs.wellbeing = true;
            }
        }

        // Snapchats egna register (beta): cachade filer, meddelanden, konton och notiser i fönstret.
        if (platform === 'iOS') {
            try { await addSnapchat(input, meta, range, run); }
            catch (e) { input.warnings.push('Snapchats register kunde inte läsas: ' + e.message); console.warn(e); }
        }

        // Bildfilen: EXIF, CRC32, SHA-256 och filsystemets tid.
        setStatus('run-status', 'Läser bildfilen ur zippen…');
        input.exif = null;
        var fileSha = '';
        try {
            var media = run.mediaEntry ? { entry: run.mediaEntry, paired: null, reason: '' } : await findMedia(fileRow, platform);
            if (media.entry) {
                var read = await readMedia(media.entry);
                meta.fileEntry = { path: media.entry.name, size: media.entry.size, mtime: ExtractionCore.entryTime(media.entry), crc32: ExtractionCore.hex(media.entry.crc32), crcOk: read.crcOk, sha256: read.sha256 || '' };
                input.fileEntry = { name: media.entry.name, size: media.entry.size, mtimeMs: media.entry.mtime ? media.entry.mtime * 1000 : null };
                fileSha = read.sha256 || '';
                if (read.bytes) {
                    setStatus('run-status', 'Läser EXIF ur bildfilen…');
                    var tags = await readTags(read.bytes, fileRow.filename);
                    var sum = ExifCore.summarize(tags, fileRow.filename);
                    var taken = exifTakenMs(sum.taken, zone.offsetMinutes);
                    input.exif = {
                        read: true, takenMs: taken.ms, takenText: sum.taken ? sum.taken.text + (taken.assumed ? ' (zon antagen: ' + zone.label + ')' : '') : '',
                        position: sum.position && !sum.position.zero ? { lat: sum.position.lat, lon: sum.position.lon, accuracy: sum.position.accuracy, source: sum.position.source } : null,
                        sourceTag: sum.taken ? sum.taken.source : '', make: tags['IFD0:Make'] || tags['QuickTime:Make'] || '', model: tags['IFD0:Model'] || tags['QuickTime:Model'] || '',
                        software: sum.software ? sum.software.text : '', source: { db: 'bildfilen', table: media.entry.name.slice(media.entry.name.lastIndexOf('/') + 1), column: sum.taken ? sum.taken.source : 'EXIF' },
                    };
                    Object.keys(tags).sort().forEach(function (k) { if (EXIF_ROW_RE.test(k)) meta.exifRows.push([k, String(tags[k])]); });
                } else {
                    input.exif = { read: false };
                    input.fileMissingReason = read.reason;
                    meta.fileMissingReason = read.reason;
                }
                if (media.paired && media.paired.size <= MAX_MEDIA) {
                    try {
                        var pr = await ExtractionCore.readEntry(state.zip.read, media.paired);
                        var ptags = await readTags(pr.bytes, media.paired.name.slice(media.paired.name.lastIndexOf('/') + 1));
                        var psum = ExifCore.summarize(ptags, media.paired.name);
                        var pt = exifTakenMs(psum.taken, zone.offsetMinutes);
                        if (pt.ms) input.pairedVideo = { name: media.paired.name.slice(media.paired.name.lastIndexOf('/') + 1), takenMs: pt.ms, source: { db: 'bildfilen', table: media.paired.name.slice(media.paired.name.lastIndexOf('/') + 1), column: psum.taken.source } };
                    } catch (e) { input.warnings.push('Live Photo-videon kunde inte läsas: ' + e.message); }
                }
            } else {
                input.exif = { read: false };
                input.fileMissingReason = media.reason;
                meta.fileMissingReason = 'Bildfilen lästes inte: ' + media.reason + '.';
            }
        } catch (err) {
            input.exif = { read: false };
            input.fileMissingReason = err.message;
            meta.fileMissingReason = 'Bildfilen kunde inte läsas: ' + err.message;
        }

        // Var finns filen? Alla poster med samma storlek och CRC32, bekräftade med SHA-256.
        if (meta.fileEntry) {
            try {
                setStatus('run-status', 'Letar efter kopior av filen i zippen…');
                input.copies = await findCopies({ name: meta.fileEntry.path, size: meta.fileEntry.size, crc32: parseInt(meta.fileEntry.crc32, 16) }, fileSha);
            } catch (e) { input.warnings.push('Sökningen efter kopior misslyckades: ' + e.message); }
        } else {
            meta.copiesNote = 'Filen lästes inte ur zippen, så inga kopior söktes.';
        }

        // Spårbarheten till protokollet.
        Object.keys(state.loaded).forEach(function (k) {
            var l = state.loaded[k];
            meta.sources.push({
                label: l.label, path: l.dbEntry.name, size: l.dbEntry.size, mtime: ExtractionCore.entryTime(l.dbEntry), crc32: ExtractionCore.hex(l.dbEntry.crc32), crcOk: l.crcOk, sha256: l.hashes.db,
                walPath: l.walEntry ? l.walEntry.name : '', walCrc32: l.walEntry ? ExtractionCore.hex(l.walEntry.crc32) : '', walSha256: l.hashes.wal, walSummary: ExtractionCore.walSummary(l), warnings: l.warnings,
            });
        });
        meta.extraction = { name: z.file.name, size: z.file.size, lastModified: new Date(z.file.lastModified).toISOString() };
        meta.deviceLabel = z.version ? 'iOS ' + z.version : platform;
        await finalize(input, meta, zone);
    }

    // ---------- Snapchat (beta) ----------

    var SNAP_KEYS = { cache: 'snapchat-cache', messages: 'snapchat-arroyo', friends: 'snapchat-friends', notifications: 'snapchat-notifications' };

    // Alla poster i Snapchats file_manager-mappar och recorded_videos, en gång per zip.
    async function snapEntries() {
        var z = state.zip;
        if (z.snapEntries) return z.snapEntries;
        z.snapEntries = await ExtractionCore.find(z.read, z.file.size, function (name) {
            return /com\.snap\.file_manager_\d+_SCContent_|\/recorded_videos\//.test(name) && name.charAt(name.length - 1) !== '/';
        });
        return z.snapEntries;
    }

    async function snapDb(key) {
        var hit = hitFor(key);
        if (!hit) return null;
        return loadDb(hit, sourceByKey(key).title);
    }

    // Läser Snapchats fyra databaser (de som finns) och lägger händelserna i fönstret till input.
    // Är den bedömda filen en cachefil fylls file.snapchatCache i ur registerraden och chatten.
    async function addSnapchat(input, meta, range, run) {
        var cacheHit = hitFor(SNAP_KEYS.cache);
        var msgHit = hitFor(SNAP_KEYS.messages);
        if (!cacheHit && !msgHit) {
            if (input.file.snapchatCache) input.warnings.push('Filen ligger i Snapchats mapp, men cache_controller.db hittades inte i zippen.');
            return;
        }
        setStatus('run-status', 'Läser Snapchats register (beta)…');
        var entries = await snapEntries();
        var ctx = { accountId: ProvenanceSnapchat.accountId(entries.map(function (e) { return e.name; })), cacheRows: [], messages: [], friends: {}, notifications: [], fileKey: null, sources: {}, centerMs: input.file.createdMs };
        var sc = input.file.snapchatCache || null;
        if (sc) ctx.fileKey = sc.key;

        if (cacheHit) {
            var cacheDb = await snapDb(SNAP_KEYS.cache);
            var cacheSrc = sourceByKey(SNAP_KEYS.cache);
            var mapRow = function (r) { return { key: r.key, context: Number(r.context), external: r.external, createdMs: r.createdMs, expiresMs: r.expiresMs, deletedMs: r.deletedMs, size: r.size, lastReadMs: r.lastReadMs, user: r.user, _raw: r._raw }; };
            ctx.sources.cache = { db: 'cache_controller.db', table: 'CACHE_FILE_CLAIM + CACHE_FILE_METADATA', queryId: cacheSrc.roles['cache-window'].id };
            ctx.cacheRows = runRole(cacheDb, cacheSrc.roles['cache-window'], { window: range }, ['created', 'expires', 'deleted', 'lastRead'], run).rows.map(mapRow);
            if (sc && cacheSrc.roles['cache-key']) {
                var own = runRole(cacheDb, cacheSrc.roles['cache-key'], { cacheKey: sc.key }, ['created', 'expires', 'deleted', 'lastRead'], run).rows.map(mapRow);
                own.forEach(function (r) { if (!ctx.cacheRows.some(function (x) { return x.key === r.key && x.external === r.external; })) ctx.cacheRows.push(r); });
                if (own[0]) sc.row = own[0];
            }
            if (cacheSrc.roles.coverage) {
                var cov = runRole(cacheDb, cacheSrc.roles.coverage, {}, ['first', 'last'], run).rows[0];
                if (cov) meta.coverage.push(['Snapchat cache_controller', cov.firstMs ? ProvenanceCore.formatUtc(cov.firstMs) : '', cov.lastMs ? ProvenanceCore.formatUtc(cov.lastMs) : '', Number(cov.rows)]);
            }
            input.warnings = input.warnings.concat(cacheDb.warnings);
        }
        if (msgHit) {
            var msgDb = await snapDb(SNAP_KEYS.messages);
            var msgSrc = sourceByKey(SNAP_KEYS.messages);
            ctx.sources.messages = { db: 'arroyo.db', table: 'conversation_message', queryId: msgSrc.roles.messages.id };
            // Är meddelandena redan hämtade (chattmedia, brett fönster) används de i stället för en ny körning.
            var msgRows = run.snapMessages && run.snapMessageRange && run.snapMessageRange.startMs <= range.startMs && run.snapMessageRange.endMs >= range.endMs
                ? run.snapMessages : runRole(msgDb, msgSrc.roles.messages, { window: range }, ['created', 'read'], run).rows;
            ctx.messages = msgRows.map(function (r) {
                return { conversation: r.conversation, serverId: r.serverId == null ? null : Number(r.serverId), clientId: r.clientId, createdMs: r.createdMs, readMs: r.readMs, state: r.state, content: r.content };
            });
            if (msgSrc.roles.coverage) {
                var mcov = runRole(msgDb, msgSrc.roles.coverage, {}, ['first', 'last'], run).rows[0];
                if (mcov) meta.coverage.push(['Snapchat arroyo (meddelanden kvar)', mcov.firstMs ? ProvenanceCore.formatUtc(mcov.firstMs) : '', mcov.lastMs ? ProvenanceCore.formatUtc(mcov.lastMs) : '', Number(mcov.rows)]);
            }
            input.warnings = input.warnings.concat(msgDb.warnings);
        }
        if (hitFor(SNAP_KEYS.friends)) {
            var frDb = await snapDb(SNAP_KEYS.friends);
            var frSrc = sourceByKey(SNAP_KEYS.friends);
            runRole(frDb, frSrc.roles.friends, {}, [], run).rows.forEach(function (r) {
                var id = String(r.userId || '').replace(/-/g, '').toLowerCase();
                if (id) ctx.friends[id] = ProvenanceSnapchat.friendNames(r.p);
            });
        }
        if (hitFor(SNAP_KEYS.notifications)) {
            var nDb = await snapDb(SNAP_KEYS.notifications);
            var nSrc = sourceByKey(SNAP_KEYS.notifications);
            ctx.sources.notifications = { db: 'nse_db.sqlite', table: 'ProcessedNotifications', queryId: nSrc.roles.notifications.id };
            ctx.notifications = runRole(nDb, nSrc.roles.notifications, { window: range }, ['time'], run).rows.map(function (r) { return { ms: r.timeMs, type: r.type, category: r.category, id: r.id }; });
            input.warnings = input.warnings.concat(nDb.warnings);
        }

        var out = ProvenanceSnapchat.build(ctx);
        input.extraEvents = out.events;
        input.extraNotes = out.notes;
        input.snapchatAccount = ctx.accountId;
        if (sc) {
            var link = out.link;
            if (link) {
                sc.context = link.context.code;
                sc.label = link.context.label;
                sc.known = link.context.known;
                sc.external = link.external;
                if (link.message) {
                    sc.messageCreatedMs = link.message.createdMs || sc.messageCreatedMs || null;
                    var info = ProvenanceSnapchat.messageInfo(link.message.content);
                    sc.own = !!(info.senderId && ctx.accountId && info.senderId === ctx.accountId.replace(/-/g, ''));
                    var f = info.senderId && ctx.friends[info.senderId];
                    sc.who = sc.own ? 'det egna kontot' : f && f.username ? '@' + f.username : info.senderId ? 'konto ' + ProvenanceSnapchat.uuidText(info.senderId).slice(0, 8) + '…' : null;
                }
                sc.recordingCopy = entries.some(function (e) { return ProvenanceSnapchat.isRecordingPath(e.name) && e.size === sc.size && e.crc32 === sc.crc32; });
            } else {
                input.warnings.push('Ingen rad i cache_controller för cachenyckeln ' + sc.key + '. Tidpunkten kommer från ' + (input.fileSource.column || 'filen') + '.');
            }
        }
    }

    // ---------- Bildbiblioteket och Snapchats behållare ----------

    // Bildbibliotekets databas (Photos.sqlite på iOS, MediaStore på Android) med rollqueryerna för
    // versionen, eller null när den inte finns i zippen.
    function libraryPick() {
        var z = state.zip;
        var key = z.platform === 'iOS' ? 'photos' : 'android-mediastore';
        var hit = z.found.find(function (f) { return f.key === key && f.primary; }) || hitFor(key);
        var src = sourceByKey(key);
        if (!hit || !src) return null;
        var dbPick = ExtractionCore.dbForVersion(state.targets.find(function (t) { return t.key === key; }), z.version);
        var roles = ProvenanceRoles.rolesFor(src, { dbId: dbPick.db.id, version: z.version });
        var table = z.platform === 'Android' ? 'files' : roles.file && roles.file.sql.indexOf('ZGENERICASSET') >= 0 ? 'ZGENERICASSET' : 'ZASSET';
        return { key: key, hit: hit, src: src, roles: roles, table: table, guessed: !!(dbPick.guessed && src.bands) };
    }

    // GUID:erna för Snapchats appbehållare och appgrupp, lästa ur var dess databaser hittades, så
    // att en fil i t.ex. Library/Caches i den behållaren märks som Snapchat i "Var finns filen?".
    function placeOpts() {
        var guids = [];
        Object.keys(SNAP_KEYS).forEach(function (k) {
            var hit = hitFor(SNAP_KEYS[k]);
            var m = hit && /Containers\/(?:Data\/Application|Shared\/AppGroup)\/([0-9A-Fa-f-]{36})\//.exec(hit.db.name);
            if (m && guids.indexOf(m[1]) < 0) guids.push(m[1]);
        });
        return { snapchatContainers: guids };
    }

    // ---------- Var finns filen? ----------

    // Alla poster med samma storlek och CRC32 som filen (ur innehållsförteckningen), de första tio
    // bekräftade med SHA-256. Returnerar raderna som modellen och protokollet använder.
    async function findCopies(file, fileSha) {
        var z = state.zip;
        var entries = await ExtractionCore.find(z.read, z.file.size, ProvenanceCopies.keeper(file.size, file.crc32, []));
        var opts = placeOpts();
        var list = ProvenanceCopies.findCopies(entries, file, opts);
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            var cls = ProvenanceCopies.classifyPath(e.name, opts);
            var shaOk = null;
            if (i < 10 && fileSha && e.size <= MAX_MEDIA) {
                try { shaOk = (await ExtractionCore.sha256((await ExtractionCore.readEntry(z.read, e)).bytes)) === fileSha; } catch (err) { shaOk = null; }
            }
            out.push({ name: e.name, size: e.size, crc32: ExtractionCore.hex(e.crc32), mtime: ExtractionCore.entryTime(e), mtimeMs: e.mtime ? e.mtime * 1000 : null, area: cls.area, label: cls.label, plain: cls.plain, shaOk: shaOk, entry: e });
        }
        return out;
    }

    function renderCopies(model) {
        var box = $('copies-box');
        var list = model.copies || [];
        box.classList.remove('display-none');
        if (!list.length) {
            $('copies').innerHTML = '<p class="muted">' + escapeHtml(state.meta.copiesNote || 'Ingen annan post i zippen har samma storlek och CRC32 som filen.') + '</p>';
            return;
        }
        $('copies').innerHTML = '<table><thead><tr><th>Sökväg i zippen</th><th>Plats</th><th>Storlek</th><th>Ändrad (enligt zippen)</th><th>CRC32</th><th>SHA-256</th></tr></thead><tbody>' +
            list.map(function (c) {
                return '<tr><td class="path">' + escapeHtml(c.name) + '</td><td>' + escapeHtml(c.label) + '</td><td>' + escapeHtml(ExtractionCore.sizeText(c.size)) + '</td><td>' + escapeHtml(c.mtime) + '</td><td class="path">' + escapeHtml(c.crc32) + '</td>' +
                    '<td>' + (c.shaOk === true ? '<span class="ok">samma som filen</span>' : c.shaOk === false ? '<span class="err">skiljer sig</span>' : '<span class="muted">inte kontrollerad</span>') + '</td></tr>';
            }).join('') + '</tbody></table>';
    }

    // ---------- Fil utanför bildbiblioteket ----------

    function dirName(name) { return name.slice(0, name.lastIndexOf('/')); }

    // Bedömer en post i zippen som inte har någon rad i Photos: i första hand en fil i Snapchats
    // cache, vars tidpunkt kommer ur cache_controller. Annars används EXIF-tiden eller zippens ändringstid.
    // priorQueries: queries som redan körts (sökningen i bildbiblioteket utan träff), så att de står i protokollet.
    async function assessEntry(entry, windowMs, priorQueries) {
        var z = state.zip;
        var runLog = { queries: (priorQueries || []).slice(), fileDb: null, fileLabel: '', fileRoles: null, mediaEntry: entry };
        var name = ExtractionCore.baseName(entry.name);
        var cacheKey = ProvenanceSnapchat.cacheKeyFromPath(entry.name);
        var fileRow = { filename: name, directory: dirName(entry.name), createdMs: null, addedMs: null, modifiedMs: null, importer: null, _raw: {}, zoneName: null, zoneOffset: null };
        var cls = ProvenanceCopies.classifyPath(entry.name, placeOpts());
        var tSource = null;

        // En inspelning i recorded_videos, eller en annan fil i Snapchats behållare, har ofta samma
        // bytes som en cachefil: nyckeln hämtas via kopian.
        if (!cacheKey && (ProvenanceSnapchat.isRecordingPath(entry.name) || cls.area === 'snapchat')) {
            var twins = (await snapEntries()).filter(function (e) { return e.size === entry.size && e.crc32 === entry.crc32 && ProvenanceSnapchat.cacheKeyFromPath(e.name); });
            if (twins.length) cacheKey = ProvenanceSnapchat.cacheKeyFromPath(twins[0].name);
        }
        if (cacheKey || cls.area === 'snapchat') {
            fileRow.snapchatCache = { key: cacheKey, path: entry.name.replace(/^.*?(Documents|Library)\//, '$1/'), size: entry.size, crc32: entry.crc32, context: null, label: null, known: false, external: null, own: null, who: null, recordingCopy: false };
            fileRow.importer = ProvenanceSnapchat.PICABOO;
            var cacheHit = hitFor(SNAP_KEYS.cache);
            if (cacheKey && cacheHit) {
                var cacheDb = await snapDb(SNAP_KEYS.cache);
                var cacheSrc = sourceByKey(SNAP_KEYS.cache);
                var rows = runRole(cacheDb, cacheSrc.roles['cache-key'], { cacheKey: cacheKey }, ['created', 'expires', 'deleted', 'lastRead'], runLog).rows;
                if (rows[0] && rows[0].createdMs) {
                    fileRow.createdMs = rows[0].createdMs;
                    fileRow._raw = Object.assign({ CACHE_KEY: cacheKey }, rows[0]._raw);
                    tSource = { db: 'cache_controller.db', table: 'CACHE_FILE_CLAIM', column: 'CREATION_TIMESTAMP_MILLIS', queryId: cacheSrc.roles['cache-key'].id };
                    // Chattmedia: meddelandet kan ha skickats långt före hämtningen. Det får ett eget fönster.
                    var ext = ProvenanceSnapchat.parseExternalKey(rows[0].external);
                    if (ext.kind === 'message' && hitFor(SNAP_KEYS.messages)) {
                        var msgDb = await snapDb(SNAP_KEYS.messages);
                        var msgSrc = sourceByKey(SNAP_KEYS.messages);
                        var wide = { startMs: fileRow.createdMs - 30 * 86400000, endMs: fileRow.createdMs + 86400000 };
                        runLog.snapMessages = runRole(msgDb, msgSrc.roles.messages, { window: wide }, ['created', 'read'], runLog).rows;
                        runLog.snapMessageRange = wide;
                        var linked = runLog.snapMessages.find(function (r) { return String(r.conversation).toLowerCase() === ext.conversationId && Number(r.serverId) === ext.serverMessageId; });
                        if (linked && linked.createdMs) {
                            fileRow.snapchatCache.messageCreatedMs = linked.createdMs;
                            fileRow.extraWindows = [{ id: 'message', label: 'när meddelandet skickades', centerMs: linked.createdMs }];
                        }
                    }
                }
            }
        }
        if (!fileRow.createdMs) {
            // Ingen registerrad: tiden inuti filen om den finns, annars zippens ändringstid.
            var zone0 = zoneChoice(fileRow);
            if (entry.size <= MAX_MEDIA) {
                try {
                    var r = await ExtractionCore.readEntry(z.read, entry);
                    var tags = await readTags(r.bytes, name);
                    var sum = ExifCore.summarize(tags, name);
                    var taken = exifTakenMs(sum.taken, zone0.offsetMinutes);
                    if (taken.ms) { fileRow.createdMs = taken.ms; tSource = { db: 'bildfilen', table: name, column: sum.taken.source }; }
                } catch (e) { /* ingen EXIF */ }
            }
            if (!fileRow.createdMs && entry.mtime) { fileRow.createdMs = entry.mtime * 1000; tSource = { db: 'zippen', table: entry.name, column: 'ändringstid' }; }
        }
        if (!fileRow.createdMs) { setStatus('run-status', 'Filen har varken registerrad, EXIF-tid eller ändringstid, så ingen tidslinje kan byggas.', 'warn'); return; }
        fileRow._raw = Object.assign({ 'Sökväg i zippen': entry.name, Plats: cls.label }, fileRow._raw);
        runLog.fileSource = tSource;
        runLog.fileLabel = tSource.db;
        // Bilderna i biblioteket runt tidpunkten visas även för en fil utanför biblioteket.
        var lib = libraryPick();
        if (lib && lib.roles.neighbours) {
            runLog.neighbourDb = await loadDb(lib.hit, lib.src.title);
            runLog.neighbourRoles = { neighbours: lib.roles.neighbours };
            runLog.neighbourSource = { db: lib.src.title, table: lib.table, column: lib.roles.neighbours.fields.created, queryId: lib.roles.neighbours.id };
        }
        fillZoneSelect(fileRow);
        setStatus('run-status', 'Hämtar registreringar…');
        await assess(fileRow, null, windowMs, runLog);
    }

    // Filnamnet finns inte i biblioteket: sök hela zippen på namnet.
    async function runOutsideLibrary(filename, windowMs, priorQueries) {
        var z = state.zip;
        setStatus('run-status', 'Ingen rad i bildbiblioteket. Söker filnamnet i hela zippen…');
        var entries = await ExtractionCore.find(z.read, z.file.size, ProvenanceCopies.keeper(null, null, [filename]));
        var hits = ProvenanceCopies.byName(entries, filename);
        if (!hits.length) { setStatus('run-status', 'Ingen rad med filnamnet ' + escapeHtml(filename) + ' i bildbiblioteket, och ingen fil med det namnet i zippen. Namnet måste vara exakt, med ändelse.', 'warn'); return; }
        if (hits.length === 1) { await assessEntry(hits[0], windowMs, priorQueries); return; }
        renderEntryHits(hits, 'Filnamnet finns på ' + hits.length + ' ställen i zippen, men inte i bildbiblioteket. Välj vilken post som ska bedömas.', function (e) { assessEntry(e, Number($('window').value) * 60000, priorQueries).then(function () { setStatus('run-status', ''); }).catch(function (err) { setStatus('run-status', escapeHtml(err.message), 'err'); }); });
    }

    function renderEntryHits(hits, text, onPick) {
        var opts = placeOpts();
        $('hits').innerHTML = '<table><thead><tr><th>Sökväg i zippen</th><th>Plats</th><th>Storlek</th><th>Ändrad (enligt zippen)</th><th>CRC32</th></tr></thead><tbody>' +
            hits.map(function (e, i) {
                var cls = ProvenanceCopies.classifyPath(e.name, opts);
                return '<tr class="pick" data-i="' + i + '"><td class="path">' + escapeHtml(e.name) + '</td><td>' + escapeHtml(cls.label) + '</td><td>' + escapeHtml(ExtractionCore.sizeText(e.size)) + '</td><td>' + escapeHtml(ExtractionCore.entryTime(e)) + '</td><td class="path">' + escapeHtml(ExtractionCore.hex(e.crc32)) + '</td></tr>';
            }).join('') + '</tbody></table>';
        $('hits').classList.remove('display-none');
        $('hits').querySelectorAll('tr.pick').forEach(function (tr) {
            tr.addEventListener('click', function () { $('hits').classList.add('display-none'); onPick(hits[Number(tr.getAttribute('data-i'))]); });
        });
        setStatus('run-status', escapeHtml(text));
    }

    // ---------- Fil från disk ----------

    // Räknar storlek, CRC32 och SHA-256 på en fil från disk och letar efter samma innehåll i zippen.
    // En träff i bildbiblioteket bedöms via Photos som vanligt, andra träffar som poster i zippen.
    async function runDiskFile(file) {
        var z = state.zip;
        if (!z || !z.platform) { setStatus('run-status', 'Öppna en extraktion först.', 'warn'); return; }
        if (file.size > MAX_MEDIA) { setStatus('run-status', 'Filen är ' + ExtractionCore.sizeText(file.size) + ', över gränsen på 200 MB.', 'warn'); return; }
        $('run').disabled = true;
        $('hits').classList.add('display-none');
        $('result').classList.add('display-none');
        try {
            setStatus('run-status', 'Räknar CRC32 och SHA-256 på ' + escapeHtml(file.name) + '…');
            var bytes = new Uint8Array(await file.arrayBuffer());
            var crc = ZipRead.crc32(bytes);
            var sha = await ExtractionCore.sha256(bytes);
            setStatus('run-status', 'Söker samma innehåll i zippen…');
            var entries = await ExtractionCore.find(z.read, z.file.size, ProvenanceCopies.keeper(file.size, crc, []));
            var hits = ProvenanceCopies.findCopies(entries, { name: '', size: file.size, crc32: crc }, placeOpts());
            var head = file.name + ': ' + file.size + ' byte, CRC32 ' + ExtractionCore.hex(crc) + ', SHA-256 ' + sha + '. ';
            if (!hits.length) { setStatus('run-status', escapeHtml(head) + 'Ingen post i zippen har samma storlek och CRC32, så filen finns inte byte för byte i extraktionen.', 'warn'); return; }
            var pick = async function (e) {
                $('hits').classList.add('display-none');
                var cls = ProvenanceCopies.classifyPath(e.name, placeOpts());
                if (cls.area === 'library' && /\/DCIM\//.test(e.name)) {
                    $('filename').value = ExtractionCore.baseName(e.name);
                    await run();
                } else {
                    await assessEntry(e, Number($('window').value) * 60000);
                    setStatus('run-status', '');
                }
            };
            if (hits.length === 1) { setStatus('run-status', escapeHtml(head) + 'Samma innehåll finns på ett ställe i zippen.'); await pick(hits[0]); return; }
            renderEntryHits(hits, head + 'Samma innehåll finns på ' + hits.length + ' ställen i zippen. Välj vilken post som ska bedömas.', function (e) { pick(e).catch(function (err) { setStatus('run-status', escapeHtml(err.message), 'err'); }); });
        } catch (err) {
            console.error(err);
            setStatus('run-status', escapeHtml(err && err.message ? err.message : String(err)), 'err');
        } finally {
            $('run').disabled = false;
        }
    }

    // Det sista steget, gemensamt för en riktig extraktion och testdatat: modellen byggs,
    // protokollets huvud fylls i och allt ritas.
    async function finalize(input, meta, zone) {
        var fileRow = input.file;
        var fmt = zone.format;
        var model = ProvenanceCore.build(input);
        Object.keys(fileRow._raw || {}).forEach(function (col) {
            var v = fileRow._raw[col];
            meta.fileRows.push([col, v === null ? 'NULL' : String(v)]);
        });
        TIME_KEYS.forEach(function (k) {
            if (fileRow[k + 'Ms']) meta.fileRows.push([k + ' (tolkad)', fmt(fileRow[k + 'Ms']) + ' · ' + ProvenanceCore.formatUtc(fileRow[k + 'Ms'])]);
        });
        meta.zoneLabel = zone.label;
        meta.zoneNote = zone.note;
        meta.toolVersion = state.toolVersion;
        meta.createdText = new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
        meta.format = fmt;
        meta.formatUtc = ProvenanceCore.formatUtc;
        state.model = model;
        state.meta = meta;
        await render();
    }

    // Testdata: samma påhittade promenad i Stockholm som i EXIF & karta, utan extraktion. Två
    // scenarier: kamerabilden IMG_4104.JPG i biblioteket, och (kind 'snapchat') videon som spelas in
    // med Snapchats kamera strax efter och bara finns i Snapchats cache. Rollqueryernas SQL i
    // protokollet är den riktiga ur katalogerna, ifylld för fönstret, i samma ordning som en körning.
    async function fillSample(kind) {
        closeZip();
        var deps = { snapchat: window.ProvenanceSnapchat, copies: window.ProvenanceCopies };
        var s = kind === 'snapchat' ? ProvenanceSample.snapchatScenario(deps) : ProvenanceSample.scenario(deps);
        fillZoneSelect(s.file);
        var zone = zoneChoice(s.file);
        var windowMs = Number($('window').value) * 60000;
        var wins = ProvenanceCore.windows(s.file, windowMs);
        var range = { startMs: wins[0].startMs, endMs: wins[wins.length - 1].endMs };
        var queries = [];
        var push = function (key, role, dbName, values) {
            try {
                var q = sourceByKey(key).roles[role];
                if (q) queries.push({ id: q.id, db: dbName, title: q.title, sql: ProvenanceRoles.fill(q.sql, values) });
            } catch (e) { /* katalogen saknas: protokollet får ingen SQL för den */ }
        };
        try {
            var pr = ProvenanceRoles.rolesFor(sourceByKey('photos'), { version: '17.5.1' });
            queries.push({ id: pr.file.id, db: 'Photos.sqlite', title: pr.file.title, sql: ProvenanceRoles.fill(pr.file.sql, { filename: s.file.filename }) });
            if (s.kind === 'snapchat') push('snapchat-cache', 'cache-key', 'cache_controller.db', { cacheKey: s.file.filename });
            queries.push({ id: pr.neighbours.id, db: 'Photos.sqlite', title: pr.neighbours.title, sql: ProvenanceRoles.fill(pr.neighbours.sql, { window: range }) });
        } catch (e) { /* katalogerna saknas: protokollet får ingen SQL-bilaga */ }
        ['app-usage', 'screen', 'lock', 'coverage'].forEach(function (r) { push('knowledgec', r, 'knowledgeC.db', { window: range }); });
        push('routined-cache', 'location', 'Cache.sqlite', { window: range });
        push('snapchat-cache', 'cache-window', 'cache_controller.db', { window: range });
        push('snapchat-arroyo', 'messages', 'arroyo.db', { window: range });
        push('snapchat-friends', 'friends', 'primary.docobjects', {});
        push('snapchat-notifications', 'notifications', 'nse_db.sqlite', { window: range });
        var input = Object.assign({}, s, {
            appNames: appName, cameraApps: cameraApps(), windowMs: windowMs, format: zone.format, missingDbs: {},
            warnings: [s.note],
        });
        var meta = {
            sources: s.sources, queries: queries, fileRows: [], exifRows: s.exifRows, fileEntry: s.fileEntryMeta, fileMissingReason: '', timelinePngs: [], copiesNote: '',
            coverage: Object.keys(s.coverage).filter(function (k) { return s.coverage[k].rows; }).map(function (k) { return [k, ProvenanceCore.formatUtc(s.coverage[k].firstMs), ProvenanceCore.formatUtc(s.coverage[k].lastMs), s.coverage[k].rows]; }),
            extraction: s.extraction, deviceLabel: s.deviceLabel, sampleNote: s.note,
        };
        var hint = s.kind === 'snapchat'
            ? ' Filen är videon som spelas in med Snapchats kamera 14:38:16 och skickas till Erik. Den har ingen rad i Photos.sqlite, så filnamnet är cachenyckeln och tiden kommer ur cache_controller.db.'
            : ' Filen är IMG_4104.JPG vid Sergels torg, tagen mitt i en Snapchat-session.';
        setStatus('ex-status', escapeHtml(s.note + hint));
        $('file-box').classList.remove('display-none');
        $('filename').value = s.file.filename;
        setStatus('run-status', '');
        await finalize(input, meta, zone);
    }

    // ---------- Körningen ----------

    async function run() {
        var z = state.zip;
        if (!z || !z.platform) { setStatus('run-status', 'Öppna en extraktion först, eller fyll med testdata.', 'warn'); return; }
        var filename = $('filename').value.trim();
        if (!filename) { setStatus('run-status', 'Ange ett filnamn.', 'warn'); return; }
        $('run').disabled = true;
        $('hits').classList.add('display-none');
        $('result').classList.add('display-none');
        try {
            var runLog = { queries: [] };
            var windowMs = Number($('window').value) * 60000;
            var lib = libraryPick();
            if (!lib) {
                setStatus('run-status', 'Bildbibliotekets databas finns inte i zippen. Söker filnamnet i hela zippen…');
                await runOutsideLibrary(filename, windowMs, []);
                return;
            }
            var src = lib.src;
            var roles = lib.roles;
            setStatus('run-status', 'Läser ' + src.title + ' och -wal…');
            var db = await loadDb(lib.hit, src.title);
            runLog.fileDb = db;
            runLog.fileLabel = src.title;
            runLog.fileRoles = roles;
            if (lib.guessed) runLog.guessed = true;
            var hits = runRole(db, roles.file, { filename: filename }, TIME_KEYS, runLog).rows;
            // Exakt ZFILENAME först. En träff på ZORIGINALFILENAME är ofta en molnkopia med annat namn.
            hits.sort(function (a, b) { return (b.filename === filename) - (a.filename === filename) || (a.createdMs || 0) - (b.createdMs || 0); });
            if (!hits.length) {
                await runOutsideLibrary(filename, windowMs, runLog.queries);
                return;
            }
            if (hits.length === 1) {
                fillZoneSelect(hits[0]);
                setStatus('run-status', 'Hämtar registreringar…');
                await assess(hits[0], roles.file, windowMs, runLog);
                setStatus('run-status', '');
                return;
            }
            fillZoneSelect(hits[0]);
            renderHits(hits, function (row) {
                $('hits').classList.add('display-none');
                setStatus('run-status', 'Hämtar registreringar…');
                var log = { queries: runLog.queries.slice(), fileDb: db, fileLabel: src.title, fileRoles: roles };
                assess(row, roles.file, Number($('window').value) * 60000, log).then(function () { setStatus('run-status', ''); })
                    .catch(function (err) { setStatus('run-status', escapeHtml(err.message), 'err'); });
            });
            setStatus('run-status', hits.length + ' rader har det filnamnet. Välj vilken som ska bedömas.');
        } catch (err) {
            console.error(err);
            setStatus('run-status', escapeHtml(err && err.message ? err.message : String(err)), 'err');
        } finally {
            $('run').disabled = false;
        }
    }

    function renderHits(hits, onPick) {
        var fmt = ProvenanceCore.formatUtc;
        $('hits').innerHTML = '<table><thead><tr><th>Filnamn</th><th>Mapp</th><th>Skapad (UTC)</th><th>Tillagd (UTC)</th><th>Skaparapp</th></tr></thead><tbody>' +
            hits.map(function (h, i) {
                return '<tr class="pick" data-i="' + i + '"><td>' + escapeHtml(h.filename) + '</td><td>' + escapeHtml(h.directory || h.relativePath || '') + '</td><td>' +
                    (h.createdMs ? fmt(h.createdMs) : '') + '</td><td>' + (h.addedMs ? fmt(h.addedMs) : '') + '</td><td>' + escapeHtml(h.importer || '') + '</td></tr>';
            }).join('') + '</tbody></table>';
        $('hits').classList.remove('display-none');
        $('hits').querySelectorAll('tr.pick').forEach(function (tr) {
            tr.addEventListener('click', function () { onPick(hits[Number(tr.getAttribute('data-i'))]); });
        });
    }

    // ---------- Kartan ----------

    var mapView = null;

    function ensureMap() {
        if (mapView) return mapView;
        if (typeof ToolboxMap === 'undefined') return null;
        mapView = ToolboxMap.create({
            host: $('map-host'), routeOn: false,
            openExternal: function (href, title) { window.parent.postMessage({ source: 'forensics-toolbox', type: 'open-external', href: href, title: title }, '*'); },
        });
        mapView.setMenu(false);
        return mapView;
    }

    // Nålar med noggrannhetsring för alla punkter. Bara bildens nål får en bubbla med vad och när.
    function applyBubbles(mv, pts) {
        var standard = MapCore.defaultBubble({});
        standard.pin = true;
        standard.ring = true;
        standard.leader = false;
        var perPoint = {};
        pts.forEach(function (p) {
            if (p.source === 'Telefonen (routined)') return;
            var cfg = MapCore.defaultBubble({ note: true, time: true });
            cfg.pin = true;
            cfg.leader = true;
            cfg.ring = true;
            perPoint[p.id] = cfg;
        });
        mv.setBubbles(standard, perPoint, {});
    }

    // Punkterna i samma form som Positioner använder: bilden som röd nål med sin egen källa,
    // telefonens positioner som egen källa med noggrannhetsring.
    function mapPoints(model, fmt) {
        var pts = [];
        model.positions.forEach(function (q, i) {
            // EXIF-positionen ritas bara när den skiljer sig från databasens, annars ligger två nålar på varandra.
            if (q.kind === 'exif' && q.distanceM != null && q.distanceM <= 50) return;
            var taken = q.ms != null ? { text: fmt(q.ms), sort: ProvenanceCore.formatUtc(q.ms).slice(0, 19), zone: '', kind: 'Tid', source: 'harkomst' } : null;
            pts.push({
                id: i + 1, name: q.kind === 'phone' ? 'Telefonen' : model.file.filename, path: q.kind === 'phone' ? 'routined' : model.file.filename,
                lat: q.lat, lon: q.lon, source: q.kind === 'phone' ? 'Telefonen (routined)' : q.kind === 'exif' ? 'Bilden enligt EXIF' : 'Bilden',
                taken: taken, until: null, visit: false, accuracy: q.accuracy && q.accuracy > 0 ? q.accuracy : null,
                type: q.kind === 'phone' ? (q.locType === 1 ? 'GNSS' : 'Wi-Fi') : 'Bild', device: '', software: '', mime: '',
                note: q.kind === 'phone' ? (q.distanceM != null ? ProvenanceCore.metres(q.distanceM) + ' från bilden' : '') : q.label,
                color: q.kind === 'phone' ? '#bf5af2' : '#ff3b30',
            });
        });
        return pts;
    }

    async function showMap(model, fmt) {
        var box = $('map-box');
        if (!model.positions.length) { box.classList.add('display-none'); return; }
        box.classList.remove('display-none');
        var mv = ensureMap();
        if (!mv) return;
        var pts = mapPoints(model, fmt);
        applyBubbles(mv, pts);
        mv.setPoints(pts, pts.length + (pts.length === 1 ? ' position' : ' positioner'));
        // Zoom upp till 18, så att nålar som ligger några meter isär inte slås ihop till en klunga.
        await withTimeout(mv.fitView({ maxZoom: 18 }), 15000);
    }

    // Kartbilden hämtas med en tidsgräns: utan kartfiler, eller när fönstret inte ritas, får
    // exporten gå vidare utan karta i stället för att vänta för evigt.
    function withTimeout(promise, ms) {
        return new Promise(function (resolve) {
            var done = false;
            var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, ms);
            promise.then(function (v) { if (!done) { done = true; clearTimeout(timer); resolve(v); } }, function () { if (!done) { done = true; clearTimeout(timer); resolve(null); } });
        });
    }

    async function mapImage() {
        if (!mapView || !state.model || !state.model.positions.length) return null;
        return withTimeout(mapView.toImage(), 10000);
    }

    function renderPositions(model, fmt) {
        if (!model.positions.length) { $('positions').innerHTML = ''; return; }
        $('positions').innerHTML = '<table><thead><tr><th>Tid (' + escapeHtml(state.meta.zoneLabel) + ')</th><th>Vad</th><th>Latitud</th><th>Longitud</th><th>Noggrannhet</th><th>Från bildens position</th><th>Källa</th></tr></thead><tbody>' +
            model.positions.map(function (q) {
                var src = q.source || {};
                return '<tr class="' + (q.kind === 'phone' ? '' : 'pos-file') + '"><td class="num">' + (q.ms != null ? escapeHtml(fmt(q.ms)) : '') + '</td><td>' + escapeHtml(q.label) + '</td>' +
                    '<td class="num">' + q.lat.toFixed(6) + '</td><td class="num">' + q.lon.toFixed(6) + '</td><td class="num">' + (q.accuracy ? Math.round(q.accuracy) + ' m' : '') + '</td>' +
                    '<td class="num">' + (q.distanceM != null ? escapeHtml(ProvenanceCore.metres(q.distanceM)) : '') + '</td><td class="path">' + escapeHtml([src.db, src.table, src.column].filter(Boolean).join(' → ')) + '</td></tr>';
            }).join('') + '</tbody></table>';
    }

    // ---------- Visning ----------

    function svgToPng(svgText, scale) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
            var img = new Image();
            img.onload = function () {
                var c = document.createElement('canvas');
                c.width = img.width * scale;
                c.height = img.height * scale;
                var ctx = c.getContext('2d');
                ctx.scale(scale, scale);
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                resolve(c.toDataURL('image/png'));
            };
            img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Tidslinjen kunde inte ritas som bild.')); };
            img.src = url;
        });
    }

    function badge(model, stateName) {
        return '<span class="badge ' + escapeHtml(stateName) + '">' + escapeHtml(model.stateLabel[stateName] || stateName) + '</span>';
    }

    async function render() {
        var m = state.model;
        var meta = state.meta;
        var fmt = meta.format;
        $('summary').innerHTML =
            (m.beta ? '<div class="type-line"><span class="badge beta">Beta</span> ' + escapeHtml(ProvenanceReport.BETA_NOTE) + '</div>' : '') +
            '<div class="type-line"><strong>Typ av fil:</strong> ' + escapeHtml(m.type.label) + (m.type.reasons.length ? ' (' + escapeHtml(m.type.reasons.join(', ')) + ')' : '') +
            (m.type.flags.length ? ' · ' + escapeHtml(m.type.flags.join(', ')) : '') + ' · ' + escapeHtml(meta.deviceLabel) + ' · T = ' + escapeHtml(fmt(m.file.createdMs || 0)) + ' (' + escapeHtml(meta.zoneLabel) + ')</div>' +
            '<div class="summary-text">' + escapeHtml(m.summary) + '</div>' +
            (m.warnings.length ? '<div class="warnings">' + m.warnings.map(escapeHtml).join('<br>') + '</div>' : '');
        $('factors').innerHTML = m.factors.map(function (f) {
            return '<div class="factor"><h3>' + badge(m, f.state) + escapeHtml(f.title) + '</h3><ul>' +
                f.items.map(function (i) { return '<li>' + escapeHtml(i.text) + '</li>'; }).join('') + '</ul><div class="plain">' + escapeHtml(f.plain) + '</div></div>';
        }).join('');

        var footer = 'Forensics Toolbox ' + state.toolVersion + ' · Härkomst · tidszon ' + meta.zoneLabel + ' · skapad ' + meta.createdText;
        state.pngs = [];
        var html = '';
        for (var i = 0; i < m.windows.length; i++) {
            var w = m.windows[i];
            var svg = ProvenanceTimeline.svg(m, { window: w, width: 1100, format: fmt, appName: function (id) { return appName(id) || id; }, title: 'Tidslinje ' + w.label + ' · ' + m.file.filename, footer: footer });
            var png = null;
            try { png = await svgToPng(svg, 2); } catch (e) { /* bilden saknas i exporten, SVG:n visas ändå */ }
            state.pngs.push(png);
            var n = m.narrative[i];
            html += '<div class="timeline"><h3><span>' + escapeHtml(w.label.charAt(0).toUpperCase() + w.label.slice(1)) + ' · ' + escapeHtml(fmt(w.startMs)) + ' till ' + escapeHtml(fmt(w.endMs).slice(11)) + '</span>' +
                '<button type="button" class="secondary save-png" data-i="' + i + '"' + (png ? '' : ' disabled') + '>Spara bild</button></h3>' +
                '<div class="timeline-svg">' + svg + '</div>' +
                '<div class="narrative"><table>' + n.lines.map(function (l) {
                    return '<tr><td class="time">' + escapeHtml(fmt(l.ms).slice(11)) + '</td><td>' + (l.bold ? '<strong>' + escapeHtml(l.text) + '</strong>' : escapeHtml(l.text)) + '</td></tr>';
                }).join('') + '</table>' + (n.lines.length ? '' : '<p class="muted">Inga registreringar i fönstret.</p>') +
                n.notes.map(function (t) { return '<p class="note">' + escapeHtml(t) + '</p>'; }).join('') + '</div></div>';
        }
        $('timelines').innerHTML = html;
        $('timelines').querySelectorAll('.save-png').forEach(function (b) {
            b.addEventListener('click', function () {
                var i = Number(b.getAttribute('data-i'));
                download(dataUrlToBlob(state.pngs[i]), 'harkomst-' + m.file.filename.replace(/\.[^.]+$/, '') + '-tidslinje' + (m.windows.length > 1 ? '-' + (i + 1) : '') + '.png');
            });
        });
        meta.timelinePngs = state.pngs;

        $('events').innerHTML = '<table><thead><tr><th>Tid (' + escapeHtml(meta.zoneLabel) + ')</th><th>UTC</th><th>Händelse</th><th>Till</th><th>Källa</th><th>Query</th></tr></thead><tbody>' +
            m.events.map(function (e) {
                var s = e.source || {};
                return '<tr><td>' + escapeHtml(fmt(e.ms)) + '</td><td>' + escapeHtml(ProvenanceCore.formatUtc(e.ms)) + '</td><td>' + escapeHtml(e.text) + '</td><td>' +
                    (e.endMs != null ? escapeHtml(fmt(e.endMs)) + (e.openEnded ? ' (pågår)' : '') : '') + '</td><td class="path">' + escapeHtml([s.db, s.table, s.stream, s.column].filter(Boolean).join(' → ')) + '</td><td>' + escapeHtml(s.queryId || '') + '</td></tr>';
            }).join('') + '</tbody></table>' + (m.outside ? '<p class="muted">' + m.outside + ' registreringar till finns utanför fönstren.</p>' : '');
        $('alternatives').innerHTML = '<table><thead><tr><th>Förklaring</th><th>Talar för</th><th>Talar emot</th></tr></thead><tbody>' +
            m.alternatives.map(function (a) {
                return '<tr><td>' + escapeHtml(a.label) + '</td><td>' + (a.for.length ? escapeHtml(a.for.join(' ')) : '<span class="muted">Inget i materialet.</span>') + '</td><td>' + (a.against.length ? escapeHtml(a.against.join(' ')) : '<span class="muted">Inget i materialet.</span>') + '</td></tr>';
            }).join('') + '</tbody></table>';
        $('sources').innerHTML = meta.sources.map(function (s) {
            return '<div class="source-block"><h4>' + escapeHtml(s.label) + '</h4><dl>' +
                '<dt>Sökväg</dt><dd>' + escapeHtml(s.path) + '</dd><dt>CRC32</dt><dd>' + escapeHtml(s.crc32) + (s.crcOk === false ? ' <span class="err">STÄMMER INTE</span>' : '') + '</dd><dt>SHA-256</dt><dd>' + escapeHtml(s.sha256) + '</dd>' +
                (s.walPath ? '<dt>-wal</dt><dd>' + escapeHtml(s.walPath) + '</dd><dt>-wal SHA-256</dt><dd>' + escapeHtml(s.walSha256) + '</dd>' : '') +
                '<dt>WAL</dt><dd>' + escapeHtml(s.walSummary) + '</dd>' + (s.warnings.length ? '<dt>Varning</dt><dd class="warn">' + escapeHtml(s.warnings.join(' ')) + '</dd>' : '') + '</dl></div>';
        }).join('') + (meta.fileEntry ? '<div class="source-block"><h4>Bildfilen</h4><dl><dt>Sökväg</dt><dd>' + escapeHtml(meta.fileEntry.path) + '</dd><dt>CRC32</dt><dd>' + escapeHtml(meta.fileEntry.crc32) + '</dd><dt>SHA-256</dt><dd>' + escapeHtml(meta.fileEntry.sha256) + '</dd></dl></div>' : '') +
            '<h4>SQL</h4>' + meta.queries.map(function (q) { return '<div><strong>' + escapeHtml(q.id) + '</strong> <span class="muted">' + escapeHtml(q.db) + '</span></div><pre class="sql">' + escapeHtml(q.sql) + '</pre>'; }).join('');
        renderPositions(m, fmt);
        renderCopies(m);
        $('result').classList.remove('display-none');
        $('result').scrollIntoView({ block: 'start', behavior: 'smooth' });
        await showMap(m, fmt);
    }

    // ---------- Exporter ----------

    function dataUrlToBlob(dataUrl) {
        var parts = dataUrl.split(',');
        var bin = atob(parts[1]);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: 'image/png' });
    }

    function download(blob, name) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
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

    function stamp() {
        var d = new Date();
        var p = function (n) { return String(n).padStart(2, '0'); };
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
    }

    async function exportHtml(kind) {
        state.meta.mapPng = await mapImage();
        return kind === 'protocol' ? ProvenanceReport.protocol(state.model, state.meta) : ProvenanceReport.explanation(state.model, state.meta);
    }

    async function copyExport(kind) {
        if (!state.model) return;
        var html = await exportHtml(kind);
        var ok = await copyHtml(html, ProvenanceReport.plainText(html));
        var withMap = state.meta.mapPng ? ' Tidslinjen och kartbilden följer med.' : (state.model.positions.length ? ' Kartbilden saknas: kartan har inga kartfiler.' : '');
        setStatus('export-status', ok ? (kind === 'protocol' ? 'Protokollet' : 'Förklaringen') + ' ligger på urklipp. Klistra in i Word med Ctrl+V.' + withMap : 'Kunde inte kopiera. Spara som HTML i stället.', ok ? '' : 'warn');
        if (ok) showToast('Kopierat för Word');
    }

    async function saveExport(kind) {
        if (!state.model) return;
        var html = ProvenanceReport.standalone((kind === 'protocol' ? 'Härkomst, protokoll: ' : 'Härkomst, förklaring: ') + state.model.file.filename, await exportHtml(kind));
        download(new Blob(['﻿' + html], { type: 'text/html;charset=utf-8' }), 'harkomst-' + state.model.file.filename.replace(/\.[^.]+$/, '') + '-' + (kind === 'protocol' ? 'protokoll' : 'forklaring') + '-' + stamp() + '.html');
    }

    // ---------- Start ----------

    async function init() {
        try {
            var cats = await Promise.all([
                loadLocalJson('../../queries/ios/photos-sqlite/catalog.json', 'PHOTOS_SQLITE_CATALOG'),
                loadLocalJson('../../queries/android/catalog.json', 'ANDROID_QUERIES_CATALOG'),
                loadLocalJson('../../queries/app-usage/catalog.json', 'APP_USAGE_CATALOG'),
                loadLocalJson('../../queries/ios/routined/catalog.json', 'ROUTINED_CATALOG'),
                loadLocalJson('../../queries/ios/snapchat/catalog.json', 'SNAPCHAT_CATALOG'),
            ]);
            state.sources = ProvenanceRoles.collect({ photos: cats[0], android: cats[1], appUsage: cats[2], routined: cats[3], snapchat: cats[4] });
            state.databases = ProvenanceRoles.databases(state.sources);
            state.targets = ExtractionCore.targets(state.databases);
        } catch (err) {
            $('load-error').textContent = 'Kunde inte ladda query-katalogerna';
            $('load-error').classList.remove('display-none');
            console.error(err);
        }
        try {
            var pkg = await loadLocalJson('../../package.json');
            state.toolVersion = pkg && pkg.version ? String(pkg.version).replace(/\.0$/, '') : '';
        } catch (e) { state.toolVersion = ''; }
        fillZoneSelect(null);
        var params = new URLSearchParams(location.search);
        if (params.get('file')) $('filename').value = params.get('file');
    }

    $('ex-pick').addEventListener('click', function () { $('ex-input').click(); });
    $('fill-sample').addEventListener('click', function () {
        fillSample('camera').catch(function (err) { setStatus('ex-status', escapeHtml(err && err.message ? err.message : String(err)), 'err'); });
    });
    $('fill-sample-snap').addEventListener('click', function () {
        fillSample('snapchat').catch(function (err) { setStatus('ex-status', escapeHtml(err && err.message ? err.message : String(err)), 'err'); });
    });
    $('ex-close').addEventListener('click', closeZip);
    $('ex-input').addEventListener('change', function () {
        var file = $('ex-input').files && $('ex-input').files[0];
        $('ex-input').value = '';
        if (!file) return;
        openZip(file).catch(function (err) {
            closeZip();
            setStatus('ex-status', escapeHtml(err && err.message ? err.message : String(err)), 'err');
        });
    });
    $('zone').addEventListener('change', function () { zoneTouched = true; });
    $('disk-pick').addEventListener('click', function () { $('disk-input').click(); });
    $('disk-input').addEventListener('change', function () {
        var file = $('disk-input').files && $('disk-input').files[0];
        $('disk-input').value = '';
        if (file) runDiskFile(file);
    });
    $('run').addEventListener('click', run);
    $('filename').addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    $('copy-protocol').addEventListener('click', function () { copyExport('protocol'); });
    $('copy-explanation').addEventListener('click', function () { copyExport('explanation'); });
    $('save-protocol').addEventListener('click', function () { saveExport('protocol'); });
    $('save-explanation').addEventListener('click', function () { saveExport('explanation'); });
    $('save-map').addEventListener('click', async function () {
        var png = await mapImage();
        if (!png) { setStatus('export-status', 'Ingen kartbild att spara. Kartan behöver kartfiler i mappen maps.', 'warn'); return; }
        download(dataUrlToBlob(png), 'harkomst-' + state.model.file.filename.replace(/\.[^.]+$/, '') + '-karta.png');
    });

    window.addEventListener('message', function (event) {
        if (event.source !== window.parent) return;
        var data = event.data;
        if (!data || (data.source !== 'forensics-toolbox' && data.source !== 'verktygslada')) return;
        if (data.type === 'provenance-file' && typeof data.file === 'string') $('filename').value = data.file;
    });

    init();
})();
