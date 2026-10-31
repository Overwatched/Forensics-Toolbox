// Härkomst: öppnar extraktionen med samma moduler som Queries, hämtar filens rad, kör
// rollqueryerna ur katalogerna mot databaserna (med -wal), läser EXIF ur bildfilen i zippen,
// och visar tidslinjen, faktorerna och förklaringen. Zippen läses bara via File.slice().
// Inget sparas på disk utom de exporter användaren själv laddar ner.
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var MAX_MEDIA = 200 * 1024 * 1024;
    var MAX_PREVIEW = 24 * 1024 * 1024;   // originalet visas direkt upp till så här stort, annars telefonens tumnagel
    var MAX_THUMB = 4 * 1024 * 1024;      // större "tumnaglar" läses inte
    var MAX_ROW_THUMB = 8 * 1024 * 1024;  // originalbilder som får bli tumnagel i vallistan
    var TIME_KEYS = ['created', 'added', 'modified'];

    var state = {
        sources: null, databases: null, targets: null, toolVersion: '',
        zip: null,           // { file, read, found, version, platform, zipLine, snapEntries }
        loaded: {},          // zip-postens namn -> laddad databas (bytes, stats, hashes, sqlDb …)
        exif: null,          // ExifTool-motorn
        model: null, meta: null, pngs: [],
        ownFor: null,        // filnamnet som undersökarens ruta och bockar gäller
        checked: {},         // faktor-id -> när undersökaren bockade i Kontrollerad (ms)
        preview: null,       // bilden i filkortet: { source, kind, note, url, mime, name, thumbName }
        showMedia: true,     // bilden visas i appen; av med knappen Dölj bilden
        includePicture: false, // bilden följer med i exporterna bara när rutan är ikryssad
        detail: 'focus',     // tidslinjen: 'focus' = det viktiga med text, resten blekt; 'all' = allt med text
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
            return { label: file.zoneName || offsetText(minutes), note: 'ur ' + (file.zoneSource || 'bildens ' + (file.zoneName ? 'ZTIMEZONENAME' : 'ZTIMEZONEOFFSET')), format: zoneFormatter(file.zoneName, minutes), offsetMinutes: minutes };
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
        // Innehållsförteckningen läses från disk en gång och hålls i minnet: varje sökning efter
        // databaser, filen, kopior och Snapchats poster går sedan mot minnet.
        var cache = await ZipRead.cacheDirectory(ZipRead.fileReader(file), file.size, null, function (done, total) {
            setStatus('ex-status', 'Läser zippens innehållsförteckning… ' + Math.round(100 * done / total) + ' %');
        });
        var read = cache.read;
        var opened = await ExtractionCore.open(read, file.size, state.targets, null);
        var keys = opened.found.map(function (f) { return f.key; });
        // Photos.sqlite betyder iOS. Annars Android så fort någon Android-källa finns (MediaStore,
        // Wellbeing eller Snapchats databaser under data/data), så att en fil kan bedömas även utan MediaStore.
        var isAndroidKey = function (k) { var src = sourceByKey(k); return !!(src && src.platform === 'Android'); };
        var platform = keys.indexOf('photos') >= 0 ? 'iOS' : keys.some(isAndroidKey) ? 'Android' : null;
        state.zip = {
            file: file, read: read, found: opened.found, version: opened.version, platform: platform, androidLogs: null, androidVersion: null,
            zipLine: 'Extraktion: ' + file.name + ' (' + file.size + ' byte, ändrad ' + new Date(file.lastModified).toISOString() + ')',
        };
        var logLine = '';
        if (platform === 'Android') {
            // Androids systemloggar (usagestats, appops) ur innehållsförteckningen, och Android-versionen ur usagestats/version.
            try {
                var logEntries = await ExtractionCore.find(read, file.size, ProvenanceAndroidLogs.keeper());
                var logs = ProvenanceAndroidLogs.sortEntries(logEntries);
                state.zip.androidLogs = logs;
                if (logs.version && logs.version.size < 4096) {
                    var vr = await ExtractionCore.readEntry(read, logs.version);
                    logs.versionInfo = ProvenanceAndroidLogs.usageVersion(vr.bytes);
                    if (logs.versionInfo.release) state.zip.androidVersion = logs.versionInfo.release;
                }
                logLine = ' · systemloggar: ' + logs.daily.length + (logs.daily.length === 1 ? ' dagsfil' : ' dagsfiler') + ' usagestats, ' + logs.discrete.length + ' appops-filer';
            } catch (e) { console.warn('Androids loggar kunde inte läsas', e); }
        }
        var text = opened.found.length + (opened.found.length === 1 ? ' databas' : ' databaser') + ' hittades på ' + opened.seconds.toFixed(1).replace('.', ',') + ' s. ' +
            file.name + ' · ' + ExtractionCore.sizeText(file.size) + (opened.version ? ' · iOS ' + opened.version : platform === 'Android' ? ' · Android' + (state.zip.androidVersion ? ' ' + state.zip.androidVersion : '') : '') +
            ' · innehållsförteckningen: ' + opened.scan.count.toLocaleString('sv-SE') + ' poster, ' + ExtractionCore.sizeText(cache.directorySize) + (cache.cached ? ', hålls i minnet' : ', läses från disk vid varje sökning') + logLine;
        if (!platform) text += ' Varken Photos.sqlite, MediaStore eller någon annan känd databas hittades, så ingen fil kan bedömas.';
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
        releasePreview();
        releaseHitUrls();
        if (mapView) mapView.setPoints([], '');
        $('ex-list').innerHTML = '';
        setStatus('ex-status', '');
        $('ex-close').classList.add('display-none');
        $('ex-pick').textContent = 'Öppna extraktion (zip)…';
        $('file-box').classList.add('display-none');
        $('result').classList.add('display-none');
        $('hits').classList.add('display-none');
        $('hits-entries').classList.add('display-none');
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
        // Sökvägen i zippen följer med, så att queryn kan öppnas och köras i Queries.
        var timeColumns = (timeKeys || []).map(function (k) { return ProvenanceRoles.fieldSpec(query, k); })
            .filter(function (t, i, a) { return t && a.findIndex(function (x) { return x && x.col === t.col; }) === i; });
        run.queries.push({ id: query.id, db: loaded.label, title: query.title, sql: sql, path: loaded.dbEntry.name, walPath: loaded.walEntry ? loaded.walEntry.name : null, timeColumns: timeColumns });
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
        setStatus('run-status', 'Räknar MD5 och SHA-256 på ' + escapeHtml(ExtractionCore.baseName(entry.name)) + '…');
        await tick();
        var sha = await ExtractionCore.sha256(r.bytes);
        return { bytes: r.bytes, crcOk: r.crcOk, sha256: sha, md5: md5Hex(r.bytes), line: r.line };
    }

    // MD5 ur Kontrollsumma-verktygets rena JS-implementation (WebCrypto saknar MD5).
    function md5Hex(bytes) {
        try { return window.ToolboxHashing ? window.ToolboxHashing.hashBytes(bytes, ['md5']).md5 : ''; } catch (e) { return ''; }
    }
    function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

    // ---------- Filkortet: bilden ----------

    function releasePreview() {
        if (state.preview && state.preview.url) URL.revokeObjectURL(state.preview.url);
        state.preview = null;
    }

    // Letar upp telefonens egen tumnagel (iOS: PhotoData/Thumbnails/V2/<mapp>/<fil>/5005.JPG), väljer vad
    // som ska visas och gör en blob-URL av bytena. Zippen läses bara. libraryRow är bibliotekets rad
    // (för tumnagelns sökväg) eller null för en fil utanför biblioteket.
    async function loadPreview(entry, bytes, libraryRow, platform, meta) {
        releasePreview();
        var z = state.zip;
        var thumb = null;
        var suffix = libraryRow ? ProvenanceMedia.thumbnailSuffix(platform, libraryRow) : null;
        if (suffix) {
            try {
                setStatus('run-status', 'Letar efter telefonens egen tumnagel…');
                var hits = await ExtractionCore.find(z.read, z.file.size, ProvenanceMedia.suffixKeeper([suffix]));
                var te = ProvenanceMedia.pickBySuffix(hits, suffix);
                if (te && te.size <= MAX_THUMB) {
                    var tr = await ExtractionCore.readEntry(z.read, te);
                    thumb = { path: te.name, size: te.size, crc32: ExtractionCore.hex(te.crc32), crcOk: tr.crcOk, mtime: ExtractionCore.entryTime(te), sha256: await ExtractionCore.sha256(tr.bytes), bytes: tr.bytes };
                }
            } catch (e) { /* ingen tumnagel: bilden visas på annat sätt eller inte alls */ }
        }
        var plan = ProvenanceMedia.previewPlan({ name: entry.name, size: entry.size, hasBytes: !!bytes, thumb: !!thumb, maxBytes: MAX_PREVIEW });
        var pv = { source: plan.source, kind: plan.kind, note: plan.note, url: null, mime: '', name: ExtractionCore.baseName(entry.name), thumbName: '' };
        if (plan.source === 'thumbnail') {
            pv.mime = 'image/jpeg';
            pv.url = URL.createObjectURL(new Blob([thumb.bytes], { type: pv.mime }));
            pv.thumbName = ExtractionCore.baseName(thumb.path);
        } else if (plan.source === 'original' || plan.source === 'video') {
            pv.mime = ProvenanceMedia.mimeOf(entry.name);
            pv.url = URL.createObjectURL(new Blob([bytes], { type: pv.mime }));
        }
        state.preview = pv;
        meta.thumbnail = thumb ? { path: thumb.path, size: thumb.size, crc32: thumb.crc32, crcOk: thumb.crcOk, mtime: thumb.mtime, sha256: thumb.sha256 } : null;
    }

    // Bilden förminskad till en JPEG-data-URL för exporterna (längsta sidan 480 px). Ritas från
    // blob-URL:en, så det fungerar även när bilden är dold i kortet. null om den inte går att rita.
    function previewDataUrl() {
        var pv = state.preview;
        if (!pv || !pv.url) return Promise.resolve(null);
        return new Promise(function (resolve) {
            var done = false;
            var finish = function (v) { if (!done) { done = true; resolve(v); } };
            setTimeout(function () { finish(null); }, 8000);
            var draw = function (el, w, h) {
                try {
                    if (!w || !h) return finish(null);
                    var scale = Math.min(1, 480 / Math.max(w, h));
                    var c = document.createElement('canvas');
                    c.width = Math.max(1, Math.round(w * scale));
                    c.height = Math.max(1, Math.round(h * scale));
                    c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
                    finish(c.toDataURL('image/jpeg', 0.85));
                } catch (e) { finish(null); }
            };
            if (pv.kind === 'video') {
                var v = document.createElement('video');
                v.muted = true;
                v.preload = 'auto';
                v.addEventListener('loadeddata', function () { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 10); } catch (e) { draw(v, v.videoWidth, v.videoHeight); } }, { once: true });
                v.addEventListener('seeked', function () { draw(v, v.videoWidth, v.videoHeight); }, { once: true });
                v.addEventListener('error', function () { finish(null); }, { once: true });
                v.src = pv.url;
            } else {
                var img = new Image();
                img.onload = function () { draw(img, img.naturalWidth, img.naturalHeight); };
                img.onerror = function () { finish(null); };
                img.src = pv.url;
            }
        });
    }

    // Kortet: bilden (eller varför den saknas), knappen Dölj/Visa, raderna med sökväg, storlek,
    // CRC32, MD5, SHA-256 och ett urval EXIF, och rutan för att ta med bilden i exporterna.
    var MONO_ROWS = { 'Sökväg i zippen': 1, CRC32: 1, MD5: 1, 'SHA-256': 1, 'Telefonens tumnagel': 1 };
    function renderFileCard() {
        var meta = state.meta, pv = state.preview;
        if (!meta) return;
        var rows = ProvenanceMedia.cardRows(meta.fileEntry, meta.exifRows, { sizeText: ExtractionCore.sizeText });
        if (meta.thumbnail) rows.push(['Telefonens tumnagel', meta.thumbnail.path + ' · ' + ExtractionCore.sizeText(meta.thumbnail.size) + ' · SHA-256 ' + meta.thumbnail.sha256]);
        var mediaHtml;
        if (pv && pv.url && state.showMedia) {
            mediaHtml = pv.kind === 'video'
                ? '<video id="preview-media" class="file-img" controls muted preload="metadata" src="' + pv.url + '"></video>'
                : '<img id="preview-media" class="file-img" alt="" src="' + pv.url + '">';
            mediaHtml += '<div class="file-caption">' + escapeHtml(pv.note) + (pv.thumbName ? ' (' + escapeHtml(pv.thumbName) + ' i zippen, egen hash nedan.)' : '') + '</div>';
        } else if (pv && pv.url) {
            mediaHtml = '<div class="file-placeholder">Bilden är dold.</div>';
        } else {
            var why = pv ? pv.note : meta.sampleNote ? 'Testdatan har ingen bildfil att visa.' : meta.fileMissingReason || 'Ingen bild.';
            mediaHtml = '<div class="file-placeholder">' + escapeHtml(why) + '</div>';
        }
        var canShow = !!(pv && pv.url);
        $('file-card').innerHTML = '<div class="file-card"><div class="file-media">' + mediaHtml +
            (canShow ? '<div class="button-row"><button type="button" class="secondary" id="toggle-media">' + (state.showMedia ? 'Dölj bilden' : 'Visa bilden') + '</button></div>' : '') + '</div>' +
            '<dl class="file-facts">' + rows.map(function (r) { return '<dt>' + escapeHtml(r[0]) + '</dt><dd' + (MONO_ROWS[r[0]] ? ' class="mono"' : '') + '>' + escapeHtml(r[1]) + '</dd>'; }).join('') +
            (meta.fileEntry ? '' : '<dt>Bildfilen</dt><dd>' + escapeHtml(meta.fileMissingReason || 'lästes inte ur zippen') + '</dd>') + '</dl></div>' +
            '<label class="chk-line"><input type="checkbox" id="include-picture"' + (state.includePicture ? ' checked' : '') + (canShow ? '' : ' disabled') + '> Ta med bilden i protokollet och förklaringen (förminskad). Sökväg, hashar och EXIF följer alltid med.</label>';
    }

    // Tumnaglar i vallistorna: blob-URL:er som släpps när listan byts.
    var hitUrls = [];
    var hitToken = 0;
    function releaseHitUrls() {
        hitUrls.forEach(function (u) { URL.revokeObjectURL(u); });
        hitUrls = [];
        hitToken++;
    }
    function thumbInto(tr, bytes, mime) {
        var url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        hitUrls.push(url);
        var img = document.createElement('img');
        img.className = 'row-thumb';
        img.alt = '';
        img.src = url;
        var cell = tr.querySelector('td.thumb-col');
        cell.innerHTML = '';
        cell.appendChild(img);
    }

    // ---------- Bedömningen ----------

    async function assess(fileRow, fileQuery, windowMs, run) {
        var z = state.zip;
        var platform = z.platform;
        // Android: kopplingen till Snapchats Memories görs först, så att tagningstiden, kameran,
        // positionen och tidszonen finns innan zonen och fönstren bestäms.
        if (platform === 'Android' && ProvenanceSnapchat.isSnapchatApp(fileRow.importer) && !fileRow.memory) {
            try { await linkSnapMemory(fileRow, run); } catch (e) { console.warn('Memories kunde inte läsas', e); }
            fillZoneSelect(fileRow);
        }
        var zone = zoneChoice(fileRow);
        var fmt = zone.format;
        var cams = cameraApps();
        var wins = ProvenanceCore.windows(fileRow, windowMs);
        var range = { startMs: Math.min.apply(null, wins.map(function (w) { return w.startMs; })), endMs: Math.max.apply(null, wins.map(function (w) { return w.endMs; })) };
        var input = {
            platform: platform, file: fileRow, appNames: appName, cameraApps: cams, windowMs: windowMs, format: fmt,
            fileSource: run.fileSource || { db: run.fileLabel, table: platform === 'Android' ? 'files' : fileQuery.sql.indexOf('ZGENERICASSET') >= 0 ? 'ZGENERICASSET' : 'ZASSET', column: fileQuery.fields.created.col || fileQuery.fields.created, queryId: fileQuery.id },
            appIntervals: [], screen: [], lock: [], locations: [], neighbours: [], coverage: {}, missingDbs: {}, warnings: [], copies: [], extraEvents: [], extraNotes: [],
            cameraUse: [], androidLog: null,
        };
        if (fileRow.createdFrom === 'date_added') input.fileSource = Object.assign({}, input.fileSource, { column: 'date_added (datetaken saknas)' });
        var meta = { sources: [], queries: run.queries, coverage: [], fileRows: [], exifRows: [], fileEntry: null, fileMissingReason: '', timelinePngs: [], copiesNote: '' };

        // Grannar ur samma databas som filen, eller ur bildbiblioteket när filen ligger utanför det.
        var fileRoles = run.fileRoles || {};
        var nbRoles = run.neighbourRoles || fileRoles;
        if (nbRoles.neighbours) {
            input.neighbours = androidCreatedFallback(runRole(run.neighbourDb || run.fileDb, nbRoles.neighbours, { window: range }, ['created', 'added'], run).rows);
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
            // usagestats (app, skärm, lås) och appops (kameran per app) ur zippens filer.
            try { await addAndroidLogs(input, meta, range, run); }
            catch (e) { input.warnings.push('Androids systemloggar kunde inte läsas: ' + e.message); console.warn(e); }
        }

        // Snapchats egna register (beta): cachade filer, meddelanden, konton, notiser och på Android
        // Memories och filhanterarens journal i fönstret.
        try { await addSnapchat(input, meta, range, run); }
        catch (e) { input.warnings.push('Snapchats register kunde inte läsas: ' + e.message); console.warn(e); }

        // Bildfilen: EXIF, CRC32, MD5, SHA-256, filsystemets tid och bilden till kortet.
        setStatus('run-status', 'Läser bildfilen ur zippen…');
        releasePreview();
        meta.thumbnail = null;
        input.exif = null;
        var fileSha = '';
        try {
            var media = run.mediaEntry ? { entry: run.mediaEntry, paired: null, reason: '' } : await findMedia(fileRow, platform);
            if (media.entry) {
                var read = await readMedia(media.entry);
                meta.fileEntry = { path: media.entry.name, size: media.entry.size, mtime: ExtractionCore.entryTime(media.entry), crc32: ExtractionCore.hex(media.entry.crc32), crcOk: read.crcOk, md5: read.md5 || '', sha256: read.sha256 || '' };
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
                try { await loadPreview(media.entry, read.bytes, run.mediaEntry ? null : fileRow, platform, meta); }
                catch (e) { state.preview = { source: 'none', kind: null, note: 'Bilden kunde inte visas: ' + e.message, url: null }; }
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

        if (!state.preview) state.preview = { source: 'none', kind: null, note: meta.fileMissingReason || 'Filen lästes inte ur zippen.', url: null };

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
        meta.deviceLabel = z.version ? 'iOS ' + z.version : z.androidVersion ? 'Android ' + z.androidVersion : platform;
        await finalize(input, meta, zone);
    }

    // ---------- Androids systemloggar: usagestats och appops ----------

    // Android: filer som en app sparar till galleriet har ofta ingen datetaken (Snapchat, bland
    // andra). Då är T date_added, när filen lades till i galleriet, och raden säger det.
    function androidCreatedFallback(rows) {
        if (!state.zip || state.zip.platform !== 'Android') return rows;
        (rows || []).forEach(function (r) { if (!r.createdMs && r.addedMs) { r.createdMs = r.addedMs; r.createdFrom = 'date_added'; } });
        return rows;
    }

    async function readLog(entry) {
        var r = await ExtractionCore.readEntry(state.zip.read, entry);
        r.sha256 = await ExtractionCore.sha256(r.bytes);
        return r;
    }

    // Protokollet får varje läst loggfil som en källa (sökväg, storlek, CRC32, SHA-256), eftersom
    // det inte finns någon databas att peka på.
    function logSource(meta, entry, label, read) {
        meta.sources.push({ label: label, path: entry.name, size: entry.size, mtime: ExtractionCore.entryTime(entry), crc32: ExtractionCore.hex(entry.crc32), crcOk: read.crcOk, sha256: read.sha256 || '',
            walPath: '', walCrc32: '', walSha256: '', walSummary: 'Binär fil, ingen WAL.', warnings: [] });
    }

    // usagestats (app i förgrunden, skärm, lås) och appops discrete (kameran per app) ur zippen.
    // usagestats ersätter Wellbeing när den finns: den har skärm och lås, Wellbeing bara apparna.
    // Bilagan får en pseudoquery per logg som säger vilka filer som lästes och hur.
    async function addAndroidLogs(input, meta, range, run) {
        var logs = state.zip.androidLogs;
        if (!logs) return;
        var L = ProvenanceAndroidLogs;
        var fmtU = ProvenanceCore.formatUtc;
        var dailies = L.pickDaily(logs.daily, range);
        var vi = logs.versionInfo || { version: null };
        if (logs.mappings && dailies.length && vi.version != null && vi.version !== 5 && vi.version !== 4) {
            input.warnings.push('usagestats har version ' + vi.version + ' (XML, Android 9 eller äldre), som inte läses. App, skärm och lås kommer då bara ur Wellbeing om den finns.');
        } else if ((logs.mappings || vi.version === 4) && dailies.length) {
            setStatus('run-status', 'Läser usagestats (app, skärm, lås)…');
            var map = null;
            if (logs.mappings) {
                var mapRead = await readLog(logs.mappings);
                logSource(meta, logs.mappings, 'usagestats mappings', mapRead);
                map = L.usageMappings(mapRead.bytes);
            }
            var decoded = [];
            var files = [];
            for (var i = 0; i < dailies.length; i++) {
                var dr = await readLog(dailies[i]);
                logSource(meta, dailies[i], 'usagestats daily/' + ExtractionCore.baseName(dailies[i].name), dr);
                decoded.push(L.usageDaily(dr.bytes, L.dailyBeginMs(dailies[i].name), map, vi.version || 5));
                files.push(dailies[i].name + ' (' + dailies[i].size + ' byte, CRC32 ' + ExtractionCore.hex(dailies[i].crc32) + ')');
            }
            var usSource = { db: 'usagestats', table: dailies.map(function (d) { return 'daily/' + ExtractionCore.baseName(d.name); }).join(', '), column: 'event_log: typ 1/2/23 (app), 15/16 (skärm), 17/18 (låsskärm)', queryId: 'usagestats-daily' };
            var lastEnd = Math.max.apply(null, decoded.map(function (d) { return d.endMs || 0; }));
            var iv = ProvenanceCore.intervalsFromEvents(L.usageToEvents(decoded), Math.max(lastEnd || 0, range.endMs), usSource);
            var stamp = function (list) { list.forEach(function (x) { x.stream = 'usagestats'; }); return list; };
            var hadWellbeing = input.appIntervals.length > 0;
            input.appIntervals = stamp(iv.apps);
            input.screen = stamp(iv.screen);
            input.lock = stamp(iv.lock);
            input.androidLog = 'usagestats';
            var cov = L.usageCoverage(decoded);
            input.coverage.usagestats = cov;
            meta.coverage.push(['usagestats (' + dailies.length + (dailies.length === 1 ? ' dagsfil' : ' dagsfiler') + ')', cov.firstMs ? fmtU(cov.firstMs) : '', cov.lastMs ? fmtU(cov.lastMs) : '', cov.rows]);
            if (lastEnd && range.endMs > lastEnd) input.warnings.push('usagestats dagsfil skrevs senast ' + fmtU(lastEnd) + '. Händelser efter det låg bara i telefonens minne när extraktionen gjordes och saknas.');
            if (hadWellbeing) input.warnings.push('Både usagestats och Wellbeing finns. App, skärm och lås kommer ur usagestats; Wellbeing-queryn står kvar i bilagan.');
            run.queries.push({ id: 'usagestats-daily', db: 'usagestats', title: 'Härkomst: usagestats (protobuf, ingen SQL)',
                sql: '-- Binära filer ur zippen, avkodade som ' + (vi.version === 4 ? 'IntervalStatsProto (version 4, strängpool i filen)' : 'IntervalStatsObfuscatedProto (version 5) med mappings') + ':\n-- ' + files.join('\n-- ') +
                    '\n-- Händelser av typ 1 ACTIVITY_RESUMED, 2 ACTIVITY_PAUSED, 23 ACTIVITY_STOPPED, 15 SCREEN_INTERACTIVE, 16 SCREEN_NON_INTERACTIVE, 17 KEYGUARD_SHOWN, 18 KEYGUARD_HIDDEN; tiderna är filens begynnelsetid plus time_ms.' +
                    '\n-- Kontroll på telefonen: adb shell dumpsys usagestats' });
        } else if (!logs.daily.length) {
            input.missingDbs.usagestats = true;
        }

        var discrete = L.pickDiscrete(logs.discrete, range);
        if (discrete.length) {
            setStatus('run-status', 'Läser appops (kameran per app)…');
            var rows = [];
            var dfiles = [];
            for (var j = 0; j < discrete.length; j++) {
                var e = discrete[j];
                if (e.size > 2 * 1024 * 1024) continue;
                var r = await readLog(e);
                var ops = L.discreteOps(r.bytes);
                rows = rows.concat(ops);
                dfiles.push(e);
                // Källa i protokollet för filerna med kamerarader nära fönstret; alla står i pseudoqueryn.
                if (ops.some(function (o) { return o.op === L.OP_CAMERA && o.ms >= range.startMs - 3600000 && o.ms <= range.endMs; })) logSource(meta, e, 'appops discrete/' + ExtractionCore.baseName(e.name), r);
            }
            if (dfiles.length) {
                var first = dfiles[0], last = dfiles[dfiles.length - 1];
                var apSource = { db: 'appops', table: 'discrete/' + ExtractionCore.baseName(first.name) + (dfiles.length > 1 ? ' … ' + ExtractionCore.baseName(last.name) + ' (' + dfiles.length + ' filer)' : ''), column: 'op 26 (CAMERA): nt (start), nd (längd ms) per paket', queryId: 'appops-discrete' };
                var allCam = L.opIntervals(rows, L.OP_CAMERA);
                allCam.filter(function (c) { return c.startMs <= range.endMs && (c.endMs == null ? c.startMs : c.endMs) >= range.startMs; })
                    .forEach(function (c) { input.cameraUse.push({ startMs: c.startMs, endMs: c.endMs, app: c.app, attribution: c.attribution, source: apSource }); });
                var ms = rows.map(function (x) { return x.ms; });
                input.coverage.appops = { firstMs: ms.length ? Math.min.apply(null, ms) : null, lastMs: ms.length ? Math.max.apply(null, ms) : null, rows: rows.length };
                meta.coverage.push(['appops discrete (' + dfiles.length + (dfiles.length === 1 ? ' fil' : ' filer') + ', kameran ' + allCam.length + ' gånger)', input.coverage.appops.firstMs ? fmtU(input.coverage.appops.firstMs) : '', input.coverage.appops.lastMs ? fmtU(input.coverage.appops.lastMs) : '', rows.length]);
                input.extraNotes.push('Telefonens logg över vilken app som använde kameran sparas i cirka sju dagar. Kameran igång betyder att kameravyn visades, inte att en bild togs.');
                run.queries.push({ id: 'appops-discrete', db: 'appops', title: 'Härkomst: appops discrete (binär XML, ingen SQL)',
                    sql: '-- ' + dfiles.length + ' filer ur zippen under appops/discrete/, skrivna ' + fmtU(L.discreteWrittenMs(first.name)) + ' till ' + fmtU(L.discreteWrittenMs(last.name)) + ', avkodade från Androids binära XML (ABX):\n-- ' +
                        dfiles.map(function (f) { return f.name + ' (' + f.size + ' byte, CRC32 ' + ExtractionCore.hex(f.crc32) + ')'; }).join('\n-- ') +
                        '\n-- <u ui><p pn><o op="26"><e nt nd/>: nt = start (ms), nd = längd (ms) på en egen rad med samma nt, ibland i en senare fil. Utan nd är slutet okänt.' +
                        '\n-- Kontroll på telefonen: adb shell abx2xml <fil> -' });
            }
        } else if (!logs.discrete.length) {
            input.missingDbs.appops = true;
        }
    }

    // ---------- Snapchat (beta) ----------

    // Samma rollnamn på båda plattformarna; Android har dessutom Memories och filhanterarens journal.
    var SNAP_KEYS_IOS = { cache: 'snapchat-cache', messages: 'snapchat-arroyo', friends: 'snapchat-friends', notifications: 'snapchat-notifications' };
    var SNAP_KEYS_ANDROID = { cache: 'snapchat-android-cache', messages: 'snapchat-android-arroyo', friends: 'snapchat-android-friends', notifications: 'snapchat-android-notifications', memories: 'snapchat-android-memories', journal: 'snapchat-android-journal' };
    function snapKeys() { return state.zip && state.zip.platform === 'Android' ? SNAP_KEYS_ANDROID : SNAP_KEYS_IOS; }

    function memoryRow(r) {
        return { id: r.id, mediaId: r.mediaId, mediaType: r.mediaType, createdMs: r.createdMs, capturedMs: r.capturedMs, zone: r.zone, width: r.width, height: r.height, duration: r.duration,
            front: r.front, hasLocation: r.hasLocation, latitude: r.latitude, longitude: r.longitude, overlay: r.overlay, userAgent: r.userAgent, externalId: r.externalId, _raw: r._raw };
    }

    // Android: den sparade snap i Snapchats Memories som hör till filen i galleriet (samma sort,
    // sparad inom några sekunder från date_added). Ger tagningstiden, kameran, positionen och tidszonen.
    async function linkSnapMemory(fileRow, run) {
        var keys = snapKeys();
        var hit = keys.memories ? hitFor(keys.memories) : null;
        if (!hit) return null;
        var src = sourceByKey(keys.memories);
        if (!src.roles.memories) return null;
        var anchor = fileRow.addedMs || fileRow.createdMs;
        if (!anchor) return null;
        var db = await loadDb(hit, src.title);
        var wide = { startMs: anchor - 10 * 60000, endMs: anchor + 10 * 60000 };
        var rows = runRole(db, src.roles.memories, { window: wide }, ['created', 'captured'], run).rows.map(memoryRow);
        run.snapMemories = rows;
        run.snapMemoryRange = wide;
        var video = /^video\//.test(String(fileRow.mime || '')) || /\.(mp4|mov|3gp|webm|mkv)$/i.test(String(fileRow.filename || ''));
        var link = ProvenanceSnapchat.linkMemory(rows, { addedMs: fileRow.addedMs, createdMs: fileRow.createdMs, video: video });
        if (!link) return null;
        var m = link.row;
        var located = Number(m.hasLocation) === 1 && m.latitude != null && m.longitude != null;
        fileRow.memory = {
            id: m.id, video: Number(m.mediaType) === 1, front: Number(m.front) === 1, capturedMs: m.capturedMs, createdMs: m.createdMs, deltaMs: link.deltaMs,
            latitude: located ? Number(m.latitude) : null, longitude: located ? Number(m.longitude) : null, zone: m.zone || null, width: m.width, height: m.height, duration: m.duration, userAgent: m.userAgent,
            source: { db: 'memories.db', table: 'memories_snap', column: 'snap_capture_time, create_time, front_facing, latitude, longitude', queryId: src.roles.memories.id },
        };
        fileRow.capturedMs = m.capturedMs || null;
        if (m.zone && !fileRow.zoneName) { fileRow.zoneName = m.zone; fileRow.zoneSource = 'Snapchats Memories (time_zone_id)'; }
        fileRow._raw = Object.assign({}, fileRow._raw, {
            'memories_snap._id': m.id, 'memories_snap.snap_capture_time': m._raw.snap_capture_time, 'memories_snap.create_time': m._raw.create_time,
            'memories_snap.front_facing': m._raw.front_facing, 'memories_snap.media_type': m._raw.media_type, 'memories_snap.time_zone_id': m._raw.time_zone_id,
            'memories_snap.latitude': m._raw.latitude, 'memories_snap.longitude': m._raw.longitude, 'memories_snap.snap_create_user_agent': m._raw.snap_create_user_agent,
        });
        return link;
    }

    // Sökvägen inuti Snapchats behållare (iOS) eller datamapp (Android), utan extraktionens prefix.
    function snapPath(name) { return String(name).replace(/^.*?(Documents|Library)\//, '$1/').replace(/^.*?com\.snapchat\.android\//, ''); }

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
        var keys = snapKeys();
        var cacheHit = hitFor(keys.cache);
        var msgHit = hitFor(keys.messages);
        if (!cacheHit && !msgHit && !(keys.memories && hitFor(keys.memories))) {
            if (input.file.snapchatCache) input.warnings.push('Filen ligger i Snapchats mapp, men cache_controller.db hittades inte i zippen.');
            return;
        }
        setStatus('run-status', 'Läser Snapchats register (beta)…');
        var entries = await snapEntries();
        var isVideoFile = /^video\//.test(String(input.file.mime || '')) || /\.(mp4|mov|3gp|webm|mkv)$/i.test(String(input.file.filename || ''));
        var ctx = { app: ProvenanceSnapchat.appId(state.zip.platform), accountId: ProvenanceSnapchat.accountId(entries.map(function (e) { return e.name; })), cacheRows: [], messages: [], friends: {}, notifications: [], memories: [], journal: [],
            file: input.file.snapchatCache ? null : { addedMs: input.file.addedMs, createdMs: input.file.createdMs, video: isVideoFile }, fileKey: null, sources: {}, centerMs: input.file.createdMs };
        var sc = input.file.snapchatCache || null;
        if (sc) ctx.fileKey = sc.key;

        if (cacheHit) {
            var cacheDb = await snapDb(keys.cache);
            var cacheSrc = sourceByKey(keys.cache);
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
            var msgDb = await snapDb(keys.messages);
            var msgSrc = sourceByKey(keys.messages);
            ctx.sources.messages = { db: 'arroyo.db', table: 'conversation_message', queryId: msgSrc.roles.messages.id };
            // Är meddelandena redan hämtade (chattmedia, brett fönster) används de i stället för en ny körning.
            var msgRows = run.snapMessages && run.snapMessageRange && run.snapMessageRange.startMs <= range.startMs && run.snapMessageRange.endMs >= range.endMs
                ? run.snapMessages : runRole(msgDb, msgSrc.roles.messages, { window: range }, ['created', 'read'], run).rows;
            ctx.messages = msgRows.map(function (r) {
                return { conversation: r.conversation, serverId: r.serverId == null ? null : Number(r.serverId), clientId: r.clientId, createdMs: r.createdMs, readMs: r.readMs, state: r.state, content: r.content,
                    senderId: r.senderId || null, createdOnDevice: r.createdOnDevice == null ? null : r.createdOnDevice, contentType: r.contentType == null ? null : r.contentType, remoteMediaCount: r.remoteMediaCount == null ? null : r.remoteMediaCount, isSaved: r.isSaved == null ? null : r.isSaved };
            });
            if (msgSrc.roles.coverage) {
                var mcov = runRole(msgDb, msgSrc.roles.coverage, {}, ['first', 'last'], run).rows[0];
                if (mcov) meta.coverage.push(['Snapchat arroyo (meddelanden kvar)', mcov.firstMs ? ProvenanceCore.formatUtc(mcov.firstMs) : '', mcov.lastMs ? ProvenanceCore.formatUtc(mcov.lastMs) : '', Number(mcov.rows)]);
            }
            input.warnings = input.warnings.concat(msgDb.warnings);
        }
        if (hitFor(keys.friends)) {
            var frDb = await snapDb(keys.friends);
            var frSrc = sourceByKey(keys.friends);
            runRole(frDb, frSrc.roles.friends, {}, [], run).rows.forEach(function (r) {
                var id = String(r.userId || '').replace(/-/g, '').toLowerCase();
                if (!id) return;
                // Android (main.db) har namnen i klartext; iOS (primary.docobjects) i en FlatBuffer.
                ctx.friends[id] = r.username != null || r.displayName != null ? { username: r.username || null, displayName: r.displayName || null } : ProvenanceSnapchat.friendNames(r.p);
            });
        }
        if (hitFor(keys.notifications)) {
            var nDb = await snapDb(keys.notifications);
            var nSrc = sourceByKey(keys.notifications);
            var android = state.zip.platform === 'Android';
            ctx.sources.notifications = { db: android ? 'client_notifications.db' : 'nse_db.sqlite', table: android ? 'Notifications' : 'ProcessedNotifications', queryId: nSrc.roles.notifications.id };
            ctx.notifications = runRole(nDb, nSrc.roles.notifications, { window: range }, ['time'], run).rows.map(function (r) { return { ms: r.timeMs, type: r.type, category: r.category == null ? null : r.category, id: r.id }; });
            input.warnings = input.warnings.concat(nDb.warnings);
        }
        if (keys.memories && hitFor(keys.memories)) {
            var memDb = await snapDb(keys.memories);
            var memSrc = sourceByKey(keys.memories);
            ctx.sources.memories = { db: 'memories.db', table: 'memories_snap', queryId: memSrc.roles.memories.id };
            ctx.memories = run.snapMemories && run.snapMemoryRange && run.snapMemoryRange.startMs <= range.startMs && run.snapMemoryRange.endMs >= range.endMs
                ? run.snapMemories : runRole(memDb, memSrc.roles.memories, { window: range }, ['created', 'captured'], run).rows.map(memoryRow);
            if (memSrc.roles.coverage) {
                var memCov = runRole(memDb, memSrc.roles.coverage, {}, ['first', 'last'], run).rows[0];
                if (memCov) meta.coverage.push(['Snapchat Memories (sparade snaps)', memCov.firstMs ? ProvenanceCore.formatUtc(memCov.firstMs) : '', memCov.lastMs ? ProvenanceCore.formatUtc(memCov.lastMs) : '', Number(memCov.rows)]);
            }
            input.warnings = input.warnings.concat(memDb.warnings);
        }
        if (keys.journal && hitFor(keys.journal)) {
            var jDb = await snapDb(keys.journal);
            var jSrc = sourceByKey(keys.journal);
            ctx.sources.journal = { db: 'journal.db', table: 'journal_entry + journal', queryId: jSrc.roles.journal.id };
            ctx.journal = runRole(jDb, jSrc.roles.journal, { window: range }, ['time', 'expires'], run).rows.map(function (r) { return { key: r.key, timeMs: r.timeMs, size: r.size, expiresMs: r.expiresMs, path: r.path }; });
            input.warnings = input.warnings.concat(jDb.warnings);
        }

        var out = ProvenanceSnapchat.build(ctx);
        input.extraEvents = out.events;
        input.extraNotes = (input.extraNotes || []).concat(out.notes);
        input.snapchatAccount = ctx.accountId;
        input.snapchatMemory = out.memory || null;
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
        var keys = snapKeys();
        Object.keys(keys).forEach(function (k) {
            var hit = hitFor(keys[k]);
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
            fileRow.snapchatCache = { key: cacheKey, path: snapPath(entry.name), size: entry.size, crc32: entry.crc32, context: null, label: null, known: false, external: null, own: null, who: null, recordingCopy: false };
            fileRow.importer = ProvenanceSnapchat.appId(z.platform);
            var cacheHit = hitFor(snapKeys().cache);
            if (cacheKey && cacheHit) {
                var cacheDb = await snapDb(snapKeys().cache);
                var cacheSrc = sourceByKey(snapKeys().cache);
                var rows = runRole(cacheDb, cacheSrc.roles['cache-key'], { cacheKey: cacheKey }, ['created', 'expires', 'deleted', 'lastRead'], runLog).rows;
                if (rows[0] && rows[0].createdMs) {
                    fileRow.createdMs = rows[0].createdMs;
                    fileRow._raw = Object.assign({ CACHE_KEY: cacheKey }, rows[0]._raw);
                    tSource = { db: 'cache_controller.db', table: 'CACHE_FILE_CLAIM', column: 'CREATION_TIMESTAMP_MILLIS', queryId: cacheSrc.roles['cache-key'].id };
                    // Chattmedia: meddelandet kan ha skickats långt före hämtningen. Det får ett eget fönster.
                    var ext = ProvenanceSnapchat.parseExternalKey(rows[0].external);
                    if ((ext.kind === 'message' || ext.kind === 'chat') && hitFor(snapKeys().messages)) {
                        var msgDb = await snapDb(snapKeys().messages);
                        var msgSrc = sourceByKey(snapKeys().messages);
                        var wide = { startMs: fileRow.createdMs - 30 * 86400000, endMs: fileRow.createdMs + 86400000 };
                        runLog.snapMessages = runRole(msgDb, msgSrc.roles.messages, { window: wide }, ['created', 'read'], runLog).rows;
                        runLog.snapMessageRange = wide;
                        // iOS: konversation och meddelandenummer står i nyckeln. Android: chattmediets id står i meddelandets protobuf.
                        var linked = ext.kind === 'message'
                            ? runLog.snapMessages.find(function (r) { return String(r.conversation).toLowerCase() === ext.conversationId && Number(r.serverId) === ext.serverMessageId; })
                            : ProvenanceSnapchat.messageForSnapId(runLog.snapMessages, ext.snapId);
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

    // Poster i zippen att välja bland, med tumnagel för bildfiler. opts: { target (behållarens id,
    // standard 'hits'), heading (rubrik i behållaren i stället för statusraden), centerMs (tidsökning) }.
    function renderEntryHits(hits, text, onPick, opts) {
        opts = opts || {};
        var place = placeOpts();
        var box = $(opts.target || 'hits');
        var timed = opts.centerMs != null;
        box.innerHTML = (opts.heading ? '<p class="hit-note">' + escapeHtml(opts.heading) + '</p>' : '') +
            '<table><thead><tr><th class="thumb-col">Bild</th><th>Sökväg i zippen</th><th>Plats</th><th>Storlek</th><th>Ändrad (enligt zippen)</th>' + (timed ? '<th>Från tidpunkten</th>' : '') + '<th>CRC32</th></tr></thead><tbody>' +
            hits.map(function (e, i) {
                var cls = ProvenanceCopies.classifyPath(e.name, place);
                return '<tr class="pick" data-i="' + i + '"><td class="thumb-col"><span class="row-thumb empty"></span></td><td class="path">' + escapeHtml(e.name) + '</td><td>' + escapeHtml(cls.label) + '</td><td>' + escapeHtml(ExtractionCore.sizeText(e.size)) + '</td><td>' + escapeHtml(ExtractionCore.entryTime(e)) + '</td>' +
                    (timed ? '<td>' + escapeHtml(e._ms != null ? ProvenanceMedia.deltaText(e._ms - opts.centerMs) + (e._assumed ? ' (zon okänd)' : '') : '') + '</td>' : '') + '<td class="path">' + escapeHtml(ExtractionCore.hex(e.crc32)) + '</td></tr>';
            }).join('') + '</tbody></table>';
        box.classList.remove('display-none');
        box.querySelectorAll('tr.pick').forEach(function (tr) {
            tr.addEventListener('click', function () { $('hits').classList.add('display-none'); $('hits-entries').classList.add('display-none'); onPick(hits[Number(tr.getAttribute('data-i'))]); });
        });
        if (!opts.heading) setStatus('run-status', escapeHtml(text));
        fillEntryThumbs(box, hits).catch(function () {});
    }

    // Tumnaglar för bildposter i en vallista: originalet läses ur zippen (små bilder, de första 30).
    async function fillEntryThumbs(box, hits) {
        if (!state.showMedia || !state.zip) return;
        var token = hitToken;
        var rows = box.querySelectorAll('tr.pick');
        for (var i = 0; i < hits.length && i < 30; i++) {
            var e = hits[i];
            if (ProvenanceMedia.kindOf(e.name) !== 'image' || e.size > MAX_ROW_THUMB) continue;
            try {
                var r = await ExtractionCore.readEntry(state.zip.read, e);
                if (token !== hitToken || !rows[i].isConnected) return;
                thumbInto(rows[i], r.bytes, ProvenanceMedia.mimeOf(e.name));
            } catch (err) { /* raden får ingen tumnagel */ }
        }
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
        var s = kind === 'snapchat' ? ProvenanceSample.snapchatScenario(deps) : kind === 'android' ? ProvenanceSample.androidScenario(deps) : ProvenanceSample.scenario(deps);
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
        if (s.kind === 'android') {
            // Android: MediaStore, Memories först (som i en riktig körning), loggarna som pseudoqueries, sedan Snapchats register.
            push('android-mediastore', 'file', 'external.db', { filename: s.file.filename });
            push('snapchat-android-memories', 'memories', 'memories.db', { window: { startMs: s.file.addedMs - 10 * 60000, endMs: s.file.addedMs + 10 * 60000 } });
            push('android-mediastore', 'neighbours', 'external.db', { window: range });
            queries.push({ id: 'usagestats-daily', db: 'usagestats', title: 'Härkomst: usagestats (protobuf, ingen SQL)', sql: '-- Testdata: dagsfilen data/system_ce/0/usagestats/daily/1717192800000 avkodad som IntervalStatsObfuscatedProto (version 5) med mappings.\n-- Händelser av typ 1 ACTIVITY_RESUMED, 2 ACTIVITY_PAUSED, 23 ACTIVITY_STOPPED, 15 SCREEN_INTERACTIVE, 16 SCREEN_NON_INTERACTIVE, 17 KEYGUARD_SHOWN, 18 KEYGUARD_HIDDEN.' });
            queries.push({ id: 'appops-discrete', db: 'appops', title: 'Härkomst: appops discrete (binär XML, ingen SQL)', sql: '-- Testdata: tre filer under data/system/appops/discrete/ avkodade från Androids binära XML (ABX); op 26 = kameran per paket, nt = start, nd = längd ms.' });
            push('snapchat-android-cache', 'cache-window', 'cache_controller.db', { window: range });
            push('snapchat-android-arroyo', 'messages', 'arroyo.db', { window: range });
            push('snapchat-android-friends', 'friends', 'main.db', {});
            push('snapchat-android-notifications', 'notifications', 'client_notifications.db', { window: range });
            push('snapchat-android-journal', 'journal', 'journal.db', { window: range });
        } else {
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
        }
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
            : s.kind === 'android'
                ? ' Filen är selfien ' + s.file.filename + ' som tas med Snapchats frontkamera 14:41:30 på en Android-telefon och sparas till galleriet. MediaStore saknar datetaken, så T är date_added; tagningstiden, kameran och positionen kommer ur Snapchats Memories, app, skärm och lås ur usagestats och kameran per app ur appops.'
                : ' Filen är IMG_4104.JPG vid Sergels torg, tagen mitt i en Snapchat-session.';
        setStatus('ex-status', escapeHtml(s.note + hint));
        $('file-box').classList.remove('display-none');
        $('filename').value = s.file.filename;
        setStatus('run-status', '');
        await finalize(input, meta, zone);
    }

    // ---------- Körningen ----------

    // opts.pk: raden som redan valts (ur tidsökningen), så att samma filnamn på flera rader inte frågar igen.
    async function run(opts) {
        var z = state.zip;
        if (!z || !z.platform) { setStatus('run-status', 'Öppna en extraktion först, eller fyll med testdata.', 'warn'); return; }
        var filename = $('filename').value.trim();
        if (!filename) { setStatus('run-status', 'Ange ett filnamn, eller sök på en tidpunkt.', 'warn'); return; }
        var pk = opts && opts.pk != null && typeof opts.pk !== 'object' ? String(opts.pk) : null;
        $('run').disabled = true;
        releaseHitUrls();
        $('hits').classList.add('display-none');
        $('hits-entries').classList.add('display-none');
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
            var hits = androidCreatedFallback(runRole(db, roles.file, { filename: filename }, TIME_KEYS, runLog).rows);
            // Exakt ZFILENAME först. En träff på ZORIGINALFILENAME är ofta en molnkopia med annat namn.
            hits.sort(function (a, b) { return (b.filename === filename) - (a.filename === filename) || (a.createdMs || 0) - (b.createdMs || 0); });
            if (pk != null && hits.some(function (h) { return String(h.pk) === pk; })) hits = hits.filter(function (h) { return String(h.pk) === pk; });
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

    // Rader i bildbiblioteket att välja bland: samma filnamn på flera rader, eller bilderna kring en
    // tidpunkt (opts.centerMs). Tumnagel, storlek och CRC32 fylls i efteråt ur zippen.
    function renderHits(hits, onPick, opts) {
        opts = opts || {};
        var fmt = ProvenanceCore.formatUtc;
        var timed = opts.centerMs != null;
        $('hits').innerHTML = '<table><thead><tr><th class="thumb-col">Bild</th><th>Filnamn</th><th>Mapp</th><th>Skapad (UTC)</th>' + (timed ? '<th>Från tidpunkten</th>' : '') + '<th>Tillagd (UTC)</th><th>Skaparapp</th><th>Storlek</th><th>CRC32</th></tr></thead><tbody>' +
            hits.map(function (h, i) {
                return '<tr class="pick" data-i="' + i + '"><td class="thumb-col"><span class="row-thumb empty"></span></td><td>' + escapeHtml(h.filename) + '</td><td>' + escapeHtml(h.directory || h.relativePath || '') + '</td><td>' +
                    (h.createdMs ? fmt(h.createdMs) : '') + '</td>' + (timed ? '<td>' + escapeHtml(h.deltaMs != null ? ProvenanceMedia.deltaText(h.deltaMs) : '') + '</td>' : '') + '<td>' + (h.addedMs ? fmt(h.addedMs) : '') + '</td><td>' +
                    escapeHtml(appName(h.importer) || h.importer || '') + '</td><td class="size"></td><td class="path crc"></td></tr>';
            }).join('') + '</tbody></table>';
        $('hits').classList.remove('display-none');
        $('hits').querySelectorAll('tr.pick').forEach(function (tr) {
            tr.addEventListener('click', function () { onPick(hits[Number(tr.getAttribute('data-i'))]); });
        });
        fillHitDetails(hits).catch(function () {});
    }

    // Storlek och CRC32 ur innehållsförteckningen och telefonens tumnagel (eller en liten originalbild)
    // för raderna i bildbibliotekets vallista. En sökning i förteckningen för alla rader.
    async function fillHitDetails(hits) {
        var z = state.zip;
        if (!z) return;
        var token = hitToken;
        var platform = z.platform;
        var wanted = hits.slice(0, 60).map(function (h) { return { media: mediaSuffix(h, platform), thumb: ProvenanceMedia.thumbnailSuffix(platform, h) }; });
        var suffixes = [];
        wanted.forEach(function (w) { if (w.media) suffixes.push(w.media); if (w.thumb) suffixes.push(w.thumb); });
        if (!suffixes.length) return;
        var entries = await ExtractionCore.find(z.read, z.file.size, ProvenanceMedia.suffixKeeper(suffixes));
        if (token !== hitToken) return;
        var rows = $('hits').querySelectorAll('tr.pick');
        for (var i = 0; i < wanted.length; i++) {
            var w = wanted[i], tr = rows[i];
            if (!tr || !tr.isConnected) continue;
            var me = w.media ? ProvenanceMedia.pickBySuffix(entries, w.media) : null;
            if (me) {
                tr.querySelector('td.size').textContent = ExtractionCore.sizeText(me.size);
                tr.querySelector('td.crc').textContent = ExtractionCore.hex(me.crc32);
            } else tr.querySelector('td.size').innerHTML = '<span class="muted">inte i zippen</span>';
            if (!state.showMedia) continue;
            var te = w.thumb ? ProvenanceMedia.pickBySuffix(entries, w.thumb) : null;
            var src = te && te.size <= MAX_THUMB ? te : me && ProvenanceMedia.kindOf(me.name) === 'image' && me.size <= MAX_ROW_THUMB ? me : null;
            if (!src) continue;
            try {
                var r = await ExtractionCore.readEntry(z.read, src);
                if (token !== hitToken || !tr.isConnected) return;
                thumbInto(tr, r.bytes, src === te ? 'image/jpeg' : ProvenanceMedia.mimeOf(src.name));
            } catch (err) { /* raden får ingen tumnagel */ }
        }
    }

    // ---------- Sök på tid ----------

    // Tidszonen som ett inskrivet klockslag tolkas i: valet i rutan, utan fil är det datorns zon eller UTC.
    function searchZone() {
        if ($('zone').value === 'utc') return { name: 'UTC', offsetMinutes: 0, label: 'UTC', format: zoneFormatter('UTC', 0) };
        var local = localZone();
        var off = -new Date().getTimezoneOffset();
        return { name: local || null, offsetMinutes: off, label: local || offsetText(off), format: zoneFormatter(local, off) };
    }

    // Datumet och klockslaget i fälten, tolkade. Klockslaget får vara tomt: då gäller hela dygnet.
    function whenParts() { return ProvenanceMedia.parseWhen($('when-date').value, $('when-time').value); }
    var WHEN_HELP = 'Skriv datumet som ÅÅÅÅ-MM-DD (till exempel 2026-10-31) och klockslaget, om det är känt, som TT:MM eller TT:MM:SS i 24-timmarsformat.';

    // Raden under fälten säger hur det inskrivna tolkas, innan man söker: hela dygnet eller tidpunkten med fönstret, i zonen.
    function updateWhenNote() {
        var note = $('when-note');
        var d = $('when-date').value.trim(), t = $('when-time').value.trim();
        if (!d && !t) { note.textContent = 'Klockslaget i 24-timmarsformat, sekunder valfria. Bara ett datum söker hela dygnet.'; note.classList.remove('warn'); return; }
        var parts = whenParts();
        if (!parts) { note.textContent = 'Går inte att tolka. Skriv ÅÅÅÅ-MM-DD och, om det är känt, TT:MM eller TT:MM:SS.'; note.classList.add('warn'); return; }
        var zone = searchZone();
        note.classList.remove('warn');
        note.textContent = parts.dateOnly
            ? 'Tolkas som hela dygnet ' + ProvenanceMedia.dateText(parts) + ' i ' + zone.label + '.'
            : 'Tolkas som ' + ProvenanceMedia.dateText(parts) + ' ' + ProvenanceMedia.timeText(parts) + ' i ' + zone.label + ', ±' + $('window').value + ' min.';
    }

    // Klistras "2026-10-31 14:30" in i datumfältet delas det upp på de två fälten.
    function pasteWhen(e) {
        var text = e.clipboardData ? e.clipboardData.getData('text') : '';
        var parts = ProvenanceMedia.parseLocal(text);
        if (!parts) return;
        e.preventDefault();
        $('when-date').value = ProvenanceMedia.dateText(parts);
        if (!parts.dateOnly) $('when-time').value = ProvenanceMedia.timeText(parts);
        updateWhenNote();
    }

    // Man vet när filen borde ha skapats men inte vad den heter: bilderna i biblioteket skapade i
    // fönstret kring tidpunkten listas närmast först, och under dem filer i zippen utanför biblioteket
    // (bild, video, Snapchats cache) med ändringstid i fönstret. Samma grannquery som tidslinjen använder.
    // Bara ett datum söker hela dygnet i zonen, i tidsordning, utan fönster.
    async function runTime() {
        var z = state.zip;
        if (!z || !z.platform) { setStatus('run-status', 'Öppna en extraktion först.', 'warn'); return; }
        var parts = whenParts();
        if (!parts) { setStatus('run-status', WHEN_HELP, 'warn'); return; }
        var zone = searchZone();
        var dayOnly = parts.dateOnly;
        var centerMs = dayOnly ? null : ProvenanceMedia.toUtcMs(parts, zone);
        var minutes = Number($('window').value);
        var range = dayOnly ? ProvenanceMedia.dayRange(parts, zone) : { startMs: centerMs - minutes * 60000, endMs: centerMs + minutes * 60000 };
        $('run').disabled = true;
        $('run-time').disabled = true;
        releaseHitUrls();
        $('hits').classList.add('display-none');
        $('hits-entries').classList.add('display-none');
        $('result').classList.add('display-none');
        try {
            var lib = libraryPick();
            var rows = [];
            if (lib && lib.roles.neighbours) {
                setStatus('run-status', 'Läser ' + escapeHtml(lib.src.title) + ' och -wal…');
                var db = await loadDb(lib.hit, lib.src.title);
                rows = androidCreatedFallback(runRole(db, lib.roles.neighbours, { window: range }, ['created', 'added'], { queries: [] }).rows);
            }
            rows = dayOnly
                ? rows.filter(function (r) { return r.createdMs != null; }).sort(function (a, b) { return a.createdMs - b.createdMs; })
                : ProvenanceMedia.nearestFirst(rows, centerMs, 'createdMs');
            setStatus('run-status', 'Söker filer i zippen med ändringstid i fönstret…');
            var entries = await ExtractionCore.find(z.read, z.file.size, ProvenanceMedia.mediaKeeper());
            // Zippar utan unixtid per post (bara DOS-tid, zon okänd) tolkas i sökningens zon och märks.
            var inWin = [];
            entries.forEach(function (e) {
                var t = ProvenanceMedia.entryMs(e, zone);
                if (t && t.ms >= range.startMs && t.ms <= range.endMs) inWin.push(Object.assign({}, e, { _ms: t.ms, _assumed: t.assumed }));
            });
            inWin.sort(dayOnly
                ? function (a, b) { return a._ms - b._ms; }
                : function (a, b) { return Math.abs(a._ms - centerMs) - Math.abs(b._ms - centerMs); });
            var assumed = inWin.some(function (e) { return e._assumed; });
            // "inom ±15 min från 2026-10-31 00:48:00 (Europe/Stockholm)" eller "under dygnet 2026-10-31 (Europe/Stockholm)".
            var span = dayOnly
                ? 'under dygnet ' + ProvenanceMedia.dateText(parts) + ' (' + zone.label + ')'
                : 'inom ±' + minutes + ' min från ' + zone.format(centerMs) + ' (' + zone.label + ')';
            var order = dayOnly ? 'i tidsordning' : 'närmast först';
            var cap = dayOnly ? ' (de 200 första visas)' : ' (de 200 närmaste visas)';
            var text = rows.length
                ? rows.length + (rows.length === 1 ? ' bild i bildbiblioteket skapad ' : ' bilder i bildbiblioteket skapade ') + span + ', ' + order + (rows.length > 200 ? cap : '') + '. Välj den som ska bedömas.'
                : (lib ? 'Ingen bild i bildbiblioteket skapad ' + span + '.' : 'Bildbibliotekets databas finns inte i zippen.');
            if (!inWin.length) text += ' Ingen fil utanför biblioteket har ändringstid ' + (dayOnly ? 'under dygnet' : 'i fönstret') + ' enligt zippen.';
            if (rows.length) renderHits(rows.slice(0, 200), pickLibraryRow, { centerMs: centerMs });
            if (inWin.length) {
                renderEntryHits(inWin.slice(0, 200), '', pickTimedEntry, {
                    target: 'hits-entries', centerMs: centerMs,
                    heading: inWin.length + (inWin.length === 1 ? ' fil' : ' filer') + ' utanför bildbiblioteket (bild, video eller Snapchats cache) har ändringstid ' + span + ' enligt zippen' + (inWin.length > 200 ? cap.replace(' (', ', ').replace(')', '') : '') + '.' +
                        (assumed ? ' Zippens ändringstider saknar tidszon och har tolkats i ' + zone.label + '.' : '') + ' Klicka på en rad för att bedöma den.',
                });
            }
            setStatus('run-status', escapeHtml(text), rows.length || inWin.length ? '' : 'warn');
        } catch (err) {
            console.error(err);
            setStatus('run-status', escapeHtml(err && err.message ? err.message : String(err)), 'err');
        } finally {
            $('run').disabled = false;
            $('run-time').disabled = false;
        }
    }
    function pickLibraryRow(row) {
        $('hits').classList.add('display-none');
        $('hits-entries').classList.add('display-none');
        $('filename').value = row.filename;
        run({ pk: row.pk });
    }
    function pickTimedEntry(e) {
        $('filename').value = ExtractionCore.baseName(e.name);
        assessEntry(e, Number($('window').value) * 60000).then(function () { setStatus('run-status', ''); })
            .catch(function (err) { setStatus('run-status', escapeHtml(err.message), 'err'); });
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
            if ((q.kind === 'exif' || q.kind === 'memory') && q.distanceM != null && q.distanceM <= 50) return;
            var taken = q.ms != null ? { text: fmt(q.ms), sort: ProvenanceCore.formatUtc(q.ms).slice(0, 19), zone: '', kind: 'Tid', source: 'harkomst' } : null;
            pts.push({
                id: i + 1, name: q.kind === 'phone' ? 'Telefonen' : model.file.filename, path: q.kind === 'phone' ? 'routined' : q.kind === 'memory' ? 'memories.db' : model.file.filename,
                lat: q.lat, lon: q.lon, source: q.kind === 'phone' ? 'Telefonen (routined)' : q.kind === 'exif' ? 'Bilden enligt EXIF' : q.kind === 'memory' ? 'Bilden enligt Snapchats Memories' : 'Bilden',
                taken: taken, until: null, visit: false, accuracy: q.accuracy && q.accuracy > 0 ? q.accuracy : null,
                type: q.kind === 'phone' ? (q.locType === 1 ? 'GNSS' : 'Wi-Fi') : 'Bild', device: '', software: '', mime: '',
                note: q.kind === 'phone' ? (q.distanceM != null ? ProvenanceCore.metres(q.distanceM) + ' från bilden' : '') : q.label,
                color: q.kind === 'phone' ? '#bf5af2' : q.kind === 'memory' ? '#c98500' : '#ff3b30',
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

    function updateCheckCount() {
        var m = state.model;
        if (!m) return;
        var n = m.factors.filter(function (f) { return state.checked[f.id]; }).length;
        $('check-count').textContent = n + ' av ' + m.factors.length + (m.factors.length === 1 ? ' faktor' : ' faktorer') + ' kontrollerade';
    }

    // ---------- Till Queries ----------

    // Queryn med det id:t som kördes mot en databas i zippen (inte testdata, inte loggfilerna utan SQL).
    function runnableQuery(id) {
        if (!id || !state.zip || !state.meta) return null;
        var list = (state.meta.queries || []).filter(function (q) { return q.id === id && q.path; });
        return list.length ? list[list.length - 1] : null;
    }

    // Källan som text (databas → tabell → kolumn), och som länk till Queries när queryn går att köra där.
    function sourceCell(src) {
        var text = ProvenanceReport.sourceText(src);
        var q = src && runnableQuery(src.queryId);
        if (!q) return escapeHtml(text);
        return '<button type="button" class="link-btn to-queries" data-q="' + escapeHtml(q.id) + '" title="Kör ' + escapeHtml(q.id) + ' i Queries mot ' + escapeHtml(q.db) + ' i zippen och visa raderna">' + escapeHtml(text) + '</button>';
    }

    function queryCell(id) {
        var q = runnableQuery(id);
        if (!q) return escapeHtml(id || '');
        return '<button type="button" class="link-btn to-queries" data-q="' + escapeHtml(q.id) + '" title="Kör queryn i Queries och visa raderna">' + escapeHtml(q.id) + ' ↗</button>';
    }

    function openInQueries(id) {
        var q = runnableQuery(id);
        if (!q) return;
        if (window.parent === window) {
            showToast('Öppna Härkomst i Forensics Toolbox för att köra queryn i Queries');
            return;
        }
        window.parent.postMessage({
            source: 'forensics-toolbox', type: 'open-query', file: state.zip.file, path: q.path, walPath: q.walPath,
            queryId: q.id, title: q.title, db: q.db, sql: q.sql, from: 'Härkomst · ' + state.model.file.filename, timeColumns: q.timeColumns || [],
        }, '*');
    }

    // ---------- Tabeller för Word ----------

    async function copyTable(html, what) {
        var ok = await copyHtml(html, ProvenanceReport.plainText(html));
        if (ok) showToast(what + ' kopierad för Word');
        else showToast('Kunde inte kopiera');
    }

    // Översikt, närbild och nyckelhändelser per fönster. Ritas om när undersökaren byter mellan
    // Det viktiga och Allt; exporterna får bilderna som de visas.
    async function renderTimelines() {
        var m = state.model;
        var meta = state.meta;
        var fmt = meta.format;
        var footer = 'Forensics Toolbox ' + state.toolVersion + ' · Härkomst · tidszon ' + meta.zoneLabel + ' · skapad ' + meta.createdText;
        var appLabel = function (id) { return appName(id) || id; };
        state.pngs = [];
        meta.timelinePngs = [];
        meta.closeupPngs = [];
        var html = '';
        for (var i = 0; i < m.windows.length; i++) {
            var w = m.windows[i];
            var c = w.closeup;
            var overview = ProvenanceTimeline.svg(m, { window: w, zoom: c, detail: state.detail, width: 1100, format: fmt, appName: appLabel, title: 'Tidslinje ' + w.label + ' · ' + m.file.filename, footer: footer });
            var closeup = ProvenanceTimeline.svg(m, { window: c, labels: true, detail: state.detail, width: 1100, format: fmt, appName: appLabel, title: 'Närbild ' + fmt(c.startMs).slice(11, 19) + ' till ' + fmt(c.endMs).slice(11, 19) + ' · ' + m.file.filename, footer: footer });
            var pngs = { overview: null, closeup: null };
            try { pngs.overview = await svgToPng(overview, 2); pngs.closeup = await svgToPng(closeup, 2); } catch (e) { /* bilden saknas i exporten, SVG:n visas ändå */ }
            state.pngs.push(pngs);
            meta.timelinePngs.push(pngs.overview);
            meta.closeupPngs.push(pngs.closeup);
            var n = m.narrative[i];
            var near = n.lines.filter(function (l) { return l.near; }).length;
            html += '<div class="timeline">' +
                '<h3><span>Översikt · ' + escapeHtml(w.label) + ' · ' + escapeHtml(fmt(w.startMs)) + ' till ' + escapeHtml(fmt(w.endMs).slice(11)) + '</span>' +
                '<button type="button" class="secondary save-png" data-i="' + i + '" data-kind="overview"' + (pngs.overview ? '' : ' disabled') + '>Spara bild</button></h3>' +
                '<div class="timeline-svg">' + overview + '</div>' +
                '<h3 class="closeup-head"><span>Närbild · ' + escapeHtml(fmt(c.startMs).slice(11)) + ' till ' + escapeHtml(fmt(c.endMs).slice(11)) +
                ' <span class="muted">(' + escapeHtml(ProvenanceCore.duration(c.endMs - c.centerMs)) + ' åt varje håll, den blå rutan i översikten)</span></span>' +
                '<span class="button-row"><span class="seg" role="group" aria-label="Text i tidslinjen" title="Det viktiga: text bara för den bedömda filen och läget vid T, resten blekt. Allt: text för varje händelse. Exporterna får det som visas.">' +
                '<button type="button" class="detail' + (state.detail === 'focus' ? ' on' : '') + '" data-detail="focus">Det viktiga</button>' +
                '<button type="button" class="detail' + (state.detail === 'all' ? ' on' : '') + '" data-detail="all">Allt</button></span>' +
                '<button type="button" class="secondary save-png" data-i="' + i + '" data-kind="closeup"' + (pngs.closeup ? '' : ' disabled') + '>Spara bild</button></span></h3>' +
                '<div class="timeline-svg">' + closeup + '</div>' +
                '<div class="narrative' + (near ? '' : ' all') + '" data-i="' + i + '">' +
                '<div class="narrative-head"><span><strong>Nyckelhändelser</strong> · ' + (near ? near + ' av ' + n.lines.length + ' rader ligger inom närbilden' : 'inga rader inom närbilden, alla ' + n.lines.length + ' visas') + '</span>' +
                '<span class="button-row">' + (near && near < n.lines.length ? '<button type="button" class="secondary show-all">Visa alla ' + n.lines.length + ' rader</button>' : '') +
                (n.lines.length ? '<button type="button" class="secondary copy-key" data-i="' + i + '" title="Tabellen med datum, klockslag, händelse och källa (databas → tabell → kolumn). Bara raderna som visas.">Kopiera tabellen för Word</button>' : '') + '</span></div>' +
                '<table>' + n.lines.map(function (l) {
                    return '<tr class="' + (l.near ? 'near' : 'far') + '"><td class="time">' + escapeHtml(fmt(l.ms).slice(11)) + '</td><td>' + (l.bold ? '<strong>' + escapeHtml(l.text) + '</strong>' : escapeHtml(l.text)) + '</td><td class="src">' + sourceCell(l.source) + '</td></tr>';
                }).join('') + '</table>' + (n.lines.length ? '' : '<p class="muted">Inga registreringar i fönstret.</p>') +
                n.notes.map(function (t) { return '<p class="note">' + escapeHtml(t) + '</p>'; }).join('') + '</div></div>';
        }
        $('timelines').innerHTML = html;
        $('timelines').querySelectorAll('.save-png').forEach(function (b) {
            b.addEventListener('click', function () {
                var i = Number(b.getAttribute('data-i'));
                var kind = b.getAttribute('data-kind');
                download(dataUrlToBlob(state.pngs[i][kind]), 'harkomst-' + m.file.filename.replace(/\.[^.]+$/, '') + (kind === 'closeup' ? '-narbild' : '-tidslinje') + (m.windows.length > 1 ? '-' + (i + 1) : '') + '.png');
            });
        });
        $('timelines').querySelectorAll('button.detail').forEach(function (b) {
            b.addEventListener('click', async function () {
                var want = b.getAttribute('data-detail');
                if (want === state.detail) return;
                state.detail = want;
                var y = window.scrollY;
                await renderTimelines();
                window.scrollTo(0, y);
            });
        });
        $('timelines').querySelectorAll('.show-all').forEach(function (b) {
            b.addEventListener('click', function () {
                var box = b.closest('.narrative');
                var all = box.classList.toggle('all');
                b.textContent = all ? 'Visa bara nyckelhändelserna' : 'Visa alla ' + box.querySelectorAll('tr').length + ' rader';
            });
        });

    }

    async function render() {
        var m = state.model;
        var meta = state.meta;
        var fmt = meta.format;
        if (state.ownFor !== m.file.filename) { $('own-assessment').value = ''; state.checked = {}; state.ownFor = m.file.filename; state.includePicture = false; }
        renderFileCard();
        $('summary').innerHTML =
            (m.beta ? '<div class="type-line"><span class="badge beta">Beta</span> ' + escapeHtml(ProvenanceReport.BETA_NOTE) + '</div>' : '') +
            '<div class="type-line"><strong>Typ av fil:</strong> ' + escapeHtml(m.type.label) + (m.type.reasons.length ? ' (' + escapeHtml(m.type.reasons.join(', ')) + ')' : '') +
            (m.type.flags.length ? ' · ' + escapeHtml(m.type.flags.join(', ')) : '') + ' · ' + escapeHtml(meta.deviceLabel) + ' · T = ' + escapeHtml(fmt(m.file.createdMs || 0)) + ' (' + escapeHtml(meta.zoneLabel) + ')</div>' +
            '<div class="summary-text"><span class="badge">Programmets sammanvägning</span>' + escapeHtml(m.summary) + '</div>' +
            (m.warnings.length ? '<div class="warnings">' + m.warnings.map(escapeHtml).join('<br>') + '</div>' : '');
        $('factors').innerHTML = m.factors.map(function (f) {
            var at = state.checked[f.id];
            return '<div class="factor' + (at ? ' checked' : '') + '" data-factor="' + escapeHtml(f.id) + '"><h3>' + badge(m, f.state) + escapeHtml(f.title) +
                '<label class="chk" title="Bocka i när du själv har kontrollerat faktorn mot källan och SQL:en. Följer med i protokollet med klockslag."><input type="checkbox" data-factor="' + escapeHtml(f.id) + '"' + (at ? ' checked' : '') + '>Kontrollerad</label></h3><ul>' +
                f.items.map(function (i) { return '<li>' + escapeHtml(i.text) + '</li>'; }).join('') + '</ul><div class="plain">' + escapeHtml(f.plain) + '</div></div>';
        }).join('');
        $('factors').querySelectorAll('input[data-factor]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var id = cb.getAttribute('data-factor');
                if (cb.checked) state.checked[id] = Date.now(); else delete state.checked[id];
                cb.closest('.factor').classList.toggle('checked', cb.checked);
                updateCheckCount();
            });
        });
        updateCheckCount();

        await renderTimelines();

        $('events').innerHTML = '<table><thead><tr><th>Tid (' + escapeHtml(meta.zoneLabel) + ')</th><th>UTC</th><th>Händelse</th><th>Till</th><th>Källa</th><th>Query</th></tr></thead><tbody>' +
            m.events.map(function (e) {
                var s = e.source || {};
                return '<tr><td>' + escapeHtml(fmt(e.ms)) + '</td><td>' + escapeHtml(ProvenanceCore.formatUtc(e.ms)) + '</td><td>' + escapeHtml(e.text) + '</td><td>' +
                    (e.endMs != null ? escapeHtml(fmt(e.endMs)) + (e.openEnded ? ' (pågår)' : '') : '') + '</td><td class="path">' + escapeHtml(ProvenanceReport.sourceText(s)) + '</td><td>' + queryCell(s.queryId) + '</td></tr>';
            }).join('') + '</tbody></table>' + (m.outside ? '<p class="muted">' + m.outside + ' registreringar till finns utanför fönstren.</p>' : '');
        $('events-note').textContent = state.zip
            ? 'Klicka på en query för att köra den i Queries mot samma zip och se raderna. Den öppnas i en egen flik.'
            : 'Testdata: queryerna går att läsa i protokollet men inte köra i Queries, eftersom ingen zip är öppen.';
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
            '<h4>SQL</h4>' + meta.queries.map(function (q) {
                return '<div class="sql-head"><span><strong>' + escapeHtml(q.id) + '</strong> <span class="muted">' + escapeHtml(q.db) + '</span></span>' +
                    (state.zip && q.path ? '<button type="button" class="secondary to-queries" data-q="' + escapeHtml(q.id) + '">Kör i Queries</button>' : '') + '</div><pre class="sql">' + escapeHtml(q.sql) + '</pre>';
            }).join('');
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
        state.meta.ownAssessment = $('own-assessment').value.trim();
        state.meta.checks = Object.assign({}, state.checked);
        state.meta.mapPng = await mapImage();
        // Bilden bara på begäran, förminskad. Sökväg, hashar och EXIF står alltid i protokollet.
        state.meta.previewPng = state.includePicture ? await previewDataUrl() : null;
        state.meta.previewNote = state.preview ? state.preview.note : '';
        return kind === 'protocol' ? ProvenanceReport.protocol(state.model, state.meta) : ProvenanceReport.explanation(state.model, state.meta);
    }

    async function copyExport(kind) {
        if (!state.model) return;
        var html = await exportHtml(kind);
        var ok = await copyHtml(html, ProvenanceReport.plainText(html));
        var withMap = state.meta.mapPng ? ' Tidslinjen och kartbilden följer med.' : (state.model.positions.length ? ' Kartbilden saknas: kartan har inga kartfiler.' : '');
        var withPic = state.includePicture ? (state.meta.previewPng ? ' Bilden följer med.' : ' Bilden kunde inte göras om till rapportbild och saknas.') : '';
        setStatus('export-status', ok ? (kind === 'protocol' ? 'Protokollet' : 'Förklaringen') + ' ligger på urklipp. Klistra in i Word med Ctrl+V.' + withMap + withPic : 'Kunde inte kopiera. Spara som HTML i stället.', ok ? '' : 'warn');
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
                loadLocalJson('../../queries/android/snapchat/catalog.json', 'SNAPCHAT_ANDROID_CATALOG'),
            ]);
            state.sources = ProvenanceRoles.collect({ photos: cats[0], android: cats[1], appUsage: cats[2], routined: cats[3], snapchat: cats[4], snapchatAndroid: cats[5] });
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
        $('role-note').innerHTML = '<strong>' + escapeHtml(ProvenanceReport.ROLE_NOTE.split('. ')[0]) + '.</strong> ' + escapeHtml(ProvenanceReport.ROLE_NOTE.split('. ').slice(1).join('. '));
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
    $('fill-sample-android').addEventListener('click', function () {
        fillSample('android').catch(function (err) { setStatus('ex-status', escapeHtml(err && err.message ? err.message : String(err)), 'err'); });
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
    $('run').addEventListener('click', function () { run(); });
    $('filename').addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    $('run-time').addEventListener('click', runTime);
    ['when-date', 'when-time'].forEach(function (id) {
        $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') runTime(); });
        $(id).addEventListener('input', updateWhenNote);
    });
    $('when-date').addEventListener('paste', pasteWhen);
    $('zone').addEventListener('change', updateWhenNote);
    $('window').addEventListener('change', updateWhenNote);
    $('file-card').addEventListener('click', function (e) {
        if (!e.target.closest('#toggle-media')) return;
        state.showMedia = !state.showMedia;
        renderFileCard();
    });
    $('file-card').addEventListener('change', function (e) { if (e.target.id === 'include-picture') state.includePicture = e.target.checked; });
    $('result').addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b || !state.model) return;
        if (b.classList.contains('to-queries')) { openInQueries(b.getAttribute('data-q')); return; }
        if (b.classList.contains('copy-key')) {
            var i = Number(b.getAttribute('data-i'));
            var all = b.closest('.narrative').classList.contains('all');
            copyTable(ProvenanceReport.keyEventsTable(state.model, state.meta, i, all), all ? 'Händelserna' : 'Nyckelhändelserna');
        }
    });
    $('copy-events').addEventListener('click', function () {
        if (state.model) copyTable(ProvenanceReport.eventsTable(state.model, state.meta), 'Händelserna med källa');
    });
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
