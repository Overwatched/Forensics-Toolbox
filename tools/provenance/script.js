// Härkomst: öppnar extraktionen med samma moduler som Queries, hämtar filens rad, kör
// rollqueryerna ur katalogerna mot databaserna (med -wal), läser EXIF ur bildfilen i zippen,
// och visar tidslinjen, faktorerna och förklaringen. Zippen läses bara via File.slice().
// Inget sparas på disk utom de exporter användaren själv laddar ner.
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    // Inne i Forensics Toolbox öppnas extraktionen i raden högst upp, och vissa knappar finns bara där.
    if (window.parent !== window) document.body.classList.add('in-hub');
    var MAX_MEDIA = 200 * 1024 * 1024;
    var MAX_HANDOVER = 1024 * 1024 * 1024;   // högst så mycket läses ur zippen åt EXIF & karta på en gång
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
        ownFor: null,        // filen (zip + rad eller sökväg) som undersökarens ruta och bockar gäller
        checked: {},         // faktor-id -> när undersökaren bockade i Kontrollerad (ms)
        examiner: {},        // filens nyckel (assessmentKey) -> { text, checked, includePicture, filename }, bara i minnet
        batch: null,         // listan med flera filer: { rows, stop, window, zone, running, open }
        preview: null,       // bilden i filkortet: { source, kind, note, url, mime, name, thumbName }
        showMedia: true,     // bilden visas i appen; av med knappen Dölj bilden
        includePicture: false, // bilden följer med i exporterna bara när rutan är ikryssad
        detail: 'focus',     // tidslinjen: 'focus' = det viktiga med text, resten blekt; 'all' = allt med text
        mapSummary: false,   // kartan, tabellen och exporterna: telefonens positioner sammanfattade i vistelser
        hashStop: false,     // Avbryt under en sökning på hashsumma
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

    // Lägesraden under en bedömning. I en lista står filens nummer och namn först.
    function progress(html) {
        var b = state.batch;
        var prefix = b && b.running && b.prefix ? b.prefix : '';
        setStatus('run-status', prefix && html ? prefix + ' · ' + html : prefix || html);
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

    // forList: listan med flera filer, där Bildens zon betyder varje bilds egen zon.
    function fillZoneSelect(file, forList) {
        var sel = $('zone');
        var opts = [];
        if (forList) opts.push({ value: 'file', label: 'Varje bilds egen zon, där den finns' });
        else if (file && (file.zoneName || file.zoneOffset != null)) {
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
            // Förskjutningen vid tagningen (ZTIMEZONEOFFSET) är exakt; finns bara zonnamnet räknas förskjutningen per tidpunkt.
            return { label: file.zoneName || offsetText(minutes), note: 'ur ' + (file.zoneSource || 'bildens ' + (file.zoneName ? 'ZTIMEZONENAME' : 'ZTIMEZONEOFFSET')), format: zoneFormatter(file.zoneName, minutes), offsetMinutes: minutes, name: file.zoneOffset != null ? null : file.zoneName };
        }
        if (v === 'utc') return { label: 'UTC', note: '', format: zoneFormatter('UTC', 0), offsetMinutes: 0, name: 'UTC' };
        var local = localZone();
        return { label: local || offsetText(-new Date().getTimezoneOffset()), note: 'datorns tidszon, antagen', format: zoneFormatter(local, -new Date().getTimezoneOffset()), offsetMinutes: -new Date().getTimezoneOffset(), name: local || null };
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

    // Filer och filnamn från andra verktyg väntar på att en pågående öppning blir klar.
    var zipReady = Promise.resolve();
    function openZip(file, opts) {
        var p = openZipNow(file, opts);
        zipReady = p.catch(function () {});
        return p;
    }

    // opts.from: verktyget där zippen öppnades, när Härkomst följer extraktionen dit.
    async function openZipNow(file, opts) {
        opts = opts || {};
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
            containerApps: {}, containerMeta: null,
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
        if (opts.from) text = 'Samma extraktion som i ' + opts.from + '. ' + text;
        setStatus('ex-status', escapeHtml(text));
        renderFound();
        $('ex-close').classList.remove('display-none');
        $('ex-pick').textContent = 'Öppna en annan zip…';
        $('file-box').classList.toggle('display-none', !platform);
        fillZoneSelect(null);
        if (platform) $('filename').focus();
        toHub({ type: 'extraction-info', file: file, info: { device: opened.version ? 'iOS ' + opened.version : state.zip.androidVersion ? 'Android ' + state.zip.androidVersion : platform || '' } });
    }

    function closeZip() {
        saveExaminer();
        if (state.zip) toHub({ type: 'current-file', name: null });
        Object.keys(state.loaded).forEach(function (k) { if (state.loaded[k].sqlDb) state.loaded[k].sqlDb.close(); });
        state.loaded = {};
        state.zip = null;
        state.model = null;
        clearBatch();
        hideFollowOffer();
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

    // ---------- Extraktionen i hela programmet ----------

    // Huvudfönstret minns zippen som senast öppnades eller stängdes i något verktyg, med ett
    // löpnummer, och skickar läget när Härkomst visas. Härkomst följer en ändring den inte redan
    // sett. Visas en bedömning eller en lista byts den inte bort: då erbjuds bytet på en rad.
    var shared = { seq: 0, pending: null };

    function sameZipFile(a, b) { return !!a && !!b && a.name === b.name && a.size === b.size && a.lastModified === b.lastModified; }

    function toHub(msg) {
        if (window.parent === window) return;
        window.parent.postMessage(Object.assign({ source: 'forensics-toolbox' }, msg), '*');
    }

    // Undersökaren öppnade eller stängde en zip här: huvudfönstret och de andra verktygen får veta det.
    function announceExtraction() {
        if (window.parent === window) return;
        window.parent.postMessage({ source: 'forensics-toolbox', type: 'extraction-changed', file: state.zip ? state.zip.file : null }, '*');
    }

    function showingWork() {
        return (!!state.model && !$('result').classList.contains('display-none')) || !!(state.batch && state.batch.rows.length);
    }

    function hideFollowOffer() {
        $('ex-follow').classList.add('display-none');
        $('ex-follow').innerHTML = '';
    }

    function offerFollow(msg) {
        var cur = state.zip ? state.zip.file.name : null;
        var where = msg.from ? ' i ' + msg.from : '';
        var text = msg.file
            ? msg.file.name + ' öppnades' + where + '. Härkomst visar fortfarande ' + (cur ? cur : 'det du arbetar med') + ', så att det som visas inte försvinner.'
            : 'Extraktionen stängdes' + where + '. Härkomst har kvar ' + cur + ', så att det som visas inte försvinner.';
        $('ex-follow').innerHTML = '<span>' + escapeHtml(text) + '</span> <button type="button" class="secondary" id="ex-follow-btn">' +
            escapeHtml(msg.file ? (cur ? 'Byt till ' + msg.file.name : 'Öppna ' + msg.file.name) : 'Stäng den här också') + '</button>';
        $('ex-follow').classList.remove('display-none');
        $('ex-follow-btn').addEventListener('click', function () {
            if (isBusy()) return;
            hideFollowOffer();
            if (msg.file) openZip(msg.file, { from: msg.from }).then(announceExtraction, zipFailed);
            else { closeZip(); announceExtraction(); }
        });
    }

    function followExtraction(msg) {
        if (!(msg.seq > shared.seq)) return;
        if (isBusy()) { shared.pending = msg; return; }
        shared.seq = msg.seq;
        hideFollowOffer();
        var cur = state.zip ? state.zip.file : null;
        if (msg.file ? sameZipFile(cur, msg.file) : !cur) return;
        if (showingWork() && !msg.force) { offerFollow(msg); return; }
        if (msg.file) openZip(msg.file, { from: msg.from }).catch(zipFailed);
        else closeZip();
    }

    // ---------- Mellan verktygen ----------

    // Filen som visas, till raden högst upp: namn, sökväg och plats. Testdata och filer som inte
    // lästes ur zippen har ingen fil att visa någon annanstans.
    function announceFile() {
        var m = state.model, meta = state.meta;
        if (!state.zip || !m || !meta || !meta.mediaEntry) { toHub({ type: 'current-file', name: null }); return; }
        toHub({ type: 'current-file', name: m.file.filename, path: meta.mediaEntry.name, place: ProvenanceCopies.classifyPath(meta.mediaEntry.name, placeOpts()).label });
    }

    // Poster ur zippen som filer åt EXIF & karta: varje fil högst MAX_MEDIA och sammanlagt högst
    // MAX_HANDOVER. Sökvägen säger vilken zip och vilken post filen kommer från.
    async function entriesAsFiles(entries) {
        var z = state.zip;
        var out = [], total = 0, skipped = 0;
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (e.size > MAX_MEDIA || total + e.size > MAX_HANDOVER) { skipped++; continue; }
            if (entries.length > 1) progress('Läser ' + (i + 1) + ' av ' + entries.length + ' ur zippen…');
            var r = await ExtractionCore.readEntry(z.read, e);
            total += e.size;
            var t = ProvenanceMedia.entryMs(e, searchZone());
            var zt = ExtractionCore.entryTimes(e);
            out.push({ file: new File([r.bytes], ExtractionCore.baseName(e.name), t && t.ms ? { lastModified: t.ms } : {}), path: z.file.name + ' › ' + e.name,
                times: { modified: zt.modified, created: zt.created, accessed: zt.accessed, field: zt.field } });
        }
        return { files: out, skipped: skipped };
    }

    // Huvudfönstret ber om filen som visas, för att visa den i EXIF & karta.
    async function handOver(to) {
        var meta = state.meta;
        if (to !== 'exif' || !state.zip || !meta || !meta.mediaEntry) return;
        var got = await entriesAsFiles([meta.mediaEntry]);
        if (!got.files.length) { showToast('Filen är för stor för att visas i EXIF & karta'); return; }
        toHub({ type: 'file-for', to: 'exif', files: got.files });
    }

    // Listan i EXIF & karta: filerna som lästes ur zippen, med alla taggar och positionerna på kartan.
    async function batchToExif() {
        var b = state.batch, z = state.zip;
        if (!b || !z || isBusy()) return;
        var wanted = {};
        b.rows.forEach(function (r) { if (r.status === 'done' && r.summary && r.summary.path) wanted[r.summary.path] = true; });
        if (!Object.keys(wanted).length) { setStatus('run-status', 'Ingen fil i listan lästes ur zippen.', 'warn'); return; }
        busy(true);
        try {
            var entries = await ExtractionCore.find(z.read, z.file.size, function (name) { return wanted[name] === true; });
            var got = await entriesAsFiles(entries);
            setStatus('run-status', got.files.length + (got.files.length === 1 ? ' fil skickades' : ' filer skickades') + ' till EXIF & karta.' + (got.skipped ? ' ' + got.skipped + ' var för stora och hoppades över.' : ''));
            if (got.files.length) toHub({ type: 'file-for', to: 'exif', files: got.files });
        } finally { busy(false); }
    }

    // Filer från EXIF & karta: samma innehåll letas upp i extraktionen, som med Välj filer från disk.
    function receiveFiles(list) {
        zipReady.then(function () {
            var files = (list || []).map(function (f) { return f && f.file; }).filter(Boolean);
            if (!files.length) return;
            if (!state.zip || !state.zip.platform) { setStatus('ex-status', 'Öppna en extraktion i raden högst upp, så letar Härkomst upp filen i den.', 'warn'); return; }
            if (isBusy()) { setStatus('run-status', 'Vänta tills bedömningen är klar och försök igen.', 'warn'); return; }
            if (files.length === 1) runDiskFile(files[0]);
            else runBatch(files.map(function (f) { return { kind: 'disk', file: f }; }), 'disk').catch(batchFailed);
        });
    }

    // Filnamn ur ett resultat i Queries. Kommer de från en annan zip än den som är öppen här körs de inte.
    function receiveNames(names, zipName) {
        zipReady.then(function () {
            if (!state.zip || !state.zip.platform) { setStatus('ex-status', 'Öppna en extraktion i raden högst upp, så bedöms filerna i den.', 'warn'); return; }
            if (isBusy()) { setStatus('run-status', 'Vänta tills bedömningen är klar och försök igen.', 'warn'); return; }
            $('filename').value = names.join('\n');
            fitNameBox();
            if (zipName && zipName !== state.zip.file.name) {
                setStatus('run-status', escapeHtml('Filnamnen kommer från en query mot ' + zipName + ', men Härkomst har ' + state.zip.file.name + ' öppen. Byt extraktion i raden högst upp, eller tryck Bedöm härkomst för att leta efter namnen här.'), 'warn');
                return;
            }
            run();
        });
    }

    function zipFailed(err) {
        closeZip();
        setStatus('ex-status', escapeHtml(err && err.message ? err.message : String(err)), 'err');
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
        var all;
        try { all = loaded.sqlDb.exec(sql); } catch (err) { throw schemaError(err, loaded, query); }
        var res = all.length ? all[all.length - 1] : { columns: [], values: [] };
        // Sökvägen i zippen följer med, så att queryn kan öppnas och köras i Queries.
        var timeColumns = (timeKeys || []).map(function (k) { return ProvenanceRoles.fieldSpec(query, k); })
            .filter(function (t, i, a) { return t && a.findIndex(function (x) { return x && x.col === t.col; }) === i; });
        run.queries.push({ id: query.id, db: loaded.label, title: query.title, sql: sql, path: loaded.dbEntry.name, walPath: loaded.walEntry ? loaded.walEntry.name : null, timeColumns: timeColumns });
        return { rows: ProvenanceRoles.mapRows(query, res, timeKeys), result: res, sql: sql };
    }

    // En rollquery som saknar en tabell eller kolumn i databasen är nästan alltid skriven för en
    // annan system- eller appversion än telefonens. Felet säger det i klartext.
    function schemaError(err, loaded, query) {
        var msg = err && err.message ? err.message : String(err);
        if (!/no such (column|table)/i.test(msg)) return err;
        var hint = /external\.db$/.test(loaded.dbEntry.name) ? ' Härkomsts MediaStore-queryer är skrivna för Android 11 och senare (kolumnerna relative_path, owner_package_name, is_pending och is_trashed).'
            : /Photos\.sqlite$/.test(loaded.dbEntry.name) ? ' Photos-queryerna väljs efter iOS-versionen; kontrollera versionen, och se tabellerna med schema-probe i Queries.'
                : ' Databasens tabeller ändras mellan system- och appversioner.';
        return new Error(loaded.label + ' saknar en tabell eller kolumn som queryn ' + query.id + ' använder (' + msg + '). Databasen är troligen från en annan version än queryn är skriven för.' + hint);
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

    // EXIF-tiden i filen -> UTC-millisekunder. Utan zon i taggen antas rapportens zon, med
    // förskjutningen vid just den tidpunkten (sommartid).
    function exifTakenMs(taken, zone) {
        return ProvenanceMedia.exifTakenMs(taken, { name: zone.name, offsetMinutes: zone.offsetMinutes });
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
        progress('Räknar MD5 och SHA-256 på ' + escapeHtml(ExtractionCore.baseName(entry.name)) + '…');
        await tick();
        var sha = await ExtractionCore.sha256(r.bytes);
        return { bytes: r.bytes, crcOk: r.crcOk, sha256: sha, md5: md5Hex(r.bytes), line: r.line };
    }

    // MD5 ur Kontrollsumma-verktygets rena JS-implementation (WebCrypto saknar MD5).
    function md5Hex(bytes) {
        try { return window.ToolboxHashing ? window.ToolboxHashing.hashBytes(bytes, ['md5']).md5 : ''; } catch (e) { return ''; }
    }
    function sha1Hex(bytes) {
        try { return window.ToolboxHashing ? window.ToolboxHashing.hashBytes(bytes, ['sha1']).sha1 : ''; } catch (e) { return ''; }
    }
    function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

    // Medan en bedömning pågår går det inte att byta eller stänga zippen, fylla med testdata eller
    // starta en ny körning: annars kunde svar ur två extraktioner hamna i samma protokoll.
    var BUSY_IDS = ['run', 'run-time', 'ex-pick', 'ex-close', 'disk-pick', 'fill-sample', 'fill-sample-snap', 'fill-sample-android',
        'batch-copy', 'batch-save', 'batch-exif', 'batch-back', 'batch-prev', 'batch-next'];
    var busyCount = 0;
    var redoPending = false;
    function busy(on) {
        busyCount = Math.max(0, busyCount + (on ? 1 : -1));
        BUSY_IDS.forEach(function (id) { if ($(id)) $(id).disabled = busyCount > 0; });
        // Byttes tidszonen eller fönstret under körningen görs bedömningen om när den är klar, och
        // en extraktion som öppnades i ett annat verktyg under tiden följs (eller erbjuds) då.
        if (!busyCount && redoPending) { redoPending = false; setTimeout(redoShown, 0); }
        if (!busyCount && shared.pending) { var next = shared.pending; shared.pending = null; setTimeout(function () { followExtraction(next); }, 0); }
        // Föregående och Nästa i listan är spärrade i början och slutet av listan, inte bara under körningen.
        if (!busyCount && state.batch && state.batch.open >= 0) showBatchNav();
    }
    function isBusy() { return busyCount > 0; }
    // Kör fn som en bedömning: knapparna är spärrade tills den är klar, och fel visas på statusraden.
    function guarded(fn) {
        busy(true);
        return Promise.resolve().then(fn).catch(function (err) {
            console.error(err);
            setStatus('run-status', escapeHtml(err && err.message ? err.message : String(err)), 'err');
        }).then(function () { busy(false); });
    }

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
                progress('Letar efter telefonens egen tumnagel…');
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
    var MONO_ROWS = { 'Sökväg i zippen': 1, CRC32: 1, MD5: 1, 'SHA-1': 1, 'SHA-256': 1, 'Telefonens tumnagel': 1, 'Sökt på MD5': 1, 'Sökt på SHA-1': 1, 'Sökt på SHA-256': 1 };
    function renderFileCard() {
        var meta = state.meta, pv = state.preview;
        if (!meta) return;
        var rows = ProvenanceMedia.cardRows(meta.fileEntry, meta.exifRows, { sizeText: ExtractionCore.sizeText });
        if (meta.thumbnail) rows.push(['Telefonens tumnagel', meta.thumbnail.path + ' · ' + ExtractionCore.sizeText(meta.thumbnail.size) + ' · SHA-256 ' + meta.thumbnail.sha256]);
        var fb = meta.foundBy;
        if (fb) rows.unshift(['Sökt på ' + fb.label, fb.value + (fb.same === true ? ' (samma som filens)' : fb.same === false ? ' (SKILJER SIG från filens ' + fb.own + ')' : ' (filens summa kunde inte kontrolleras)')]);
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
            if (!run.quiet) fillZoneSelect(fileRow);
        }
        var zone = zoneChoice(fileRow);
        var fmt = zone.format;
        var cams = cameraApps();
        var wins = ProvenanceCore.windows(fileRow, windowMs);
        // Utan tidpunkt finns inga fönster, och inga registreringar läses kring filen.
        var range = wins.length ? { startMs: Math.min.apply(null, wins.map(function (w) { return w.startMs; })), endMs: Math.max.apply(null, wins.map(function (w) { return w.endMs; })) } : null;
        var input = {
            platform: platform, file: fileRow, appNames: appName, cameraApps: cams, windowMs: windowMs, format: fmt,
            fileSource: run.fileSource || { db: run.fileLabel, table: platform === 'Android' ? 'files' : fileQuery.sql.indexOf('ZGENERICASSET') >= 0 ? 'ZGENERICASSET' : 'ZASSET', column: ProvenanceRoles.fieldSpec(fileQuery, 'created').col, queryId: fileQuery.id },
            appIntervals: [], screen: [], lock: [], locations: [], neighbours: [], coverage: {}, missingDbs: {}, warnings: [], copies: [], extraEvents: [], extraNotes: [],
            cameraUse: [], androidLog: null,
        };
        if (fileRow.createdFrom === 'date_added') input.fileSource = Object.assign({}, input.fileSource, { column: 'date_added (datetaken saknas)' });
        if (run.bandNote) input.warnings.push(run.bandNote);
        if (run.timeNote) input.warnings.push(run.timeNote);
        var meta = { sources: [], queries: run.queries, coverage: [], fileRows: [], exifRows: [], fileEntry: null, fileMissingReason: '', timelinePngs: [], copiesNote: '' };

        // Grannar ur samma databas som filen, eller ur bildbiblioteket när filen ligger utanför det.
        var fileRoles = run.fileRoles || {};
        var nbRoles = run.neighbourRoles || fileRoles;
        // Queryerna läser spannet från det första fönstrets början till det sista fönstrets slut, utan
        // gräns på antalet rader. Grannarna och positionerna mellan fönstren sorteras bort, så att en bild
        // som skapades långt innan den kom till telefonen inte får med allt däremellan.
        if (nbRoles.neighbours && range) {
            input.neighbours = androidCreatedFallback(runRole(run.neighbourDb || run.fileDb, nbRoles.neighbours, { window: range }, ['created', 'added'], run).rows)
                .filter(function (r) { return ProvenanceCore.inWindows(r.createdMs, wins); });
            input.neighbourSource = run.neighbourSource || { db: run.fileLabel, table: input.fileSource.table, column: ProvenanceRoles.fieldSpec(nbRoles.neighbours, 'created').col, queryId: nbRoles.neighbours.id };
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
        if (!range) {
            input.warnings.push('Filen har ingen tidpunkt i databasen, så inga registreringar kring den kunde läsas.');
        } else if (platform === 'iOS') {
            var kc = hitFor('knowledgec');
            // En databas som inte går att läsa (annat schema, trasig fil) stoppar inte bedömningen:
            // faktorerna säger att den inte kunde läsas, och felet står bland varningarna.
            if (kc) try {
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
            } catch (e) {
                input.warnings.push('knowledgeC.db kunde inte läsas: ' + e.message);
                input.missingDbs['/app/usage'] = 'unread';
                input.missingDbs['/display/isBacklit'] = 'unread';
            } else {
                input.missingDbs['/app/usage'] = true;
                input.missingDbs['/display/isBacklit'] = true;
            }
            var rt = hitFor('routined-cache');
            if (rt) try {
                var rtSrc = sourceByKey('routined-cache');
                var rtDb = await loadDb(rt, rtSrc.title);
                if (rtSrc.roles.location) {
                    input.locationSource = { db: 'Cache.sqlite', table: 'ZRTCLLOCATIONMO', column: 'ZTIMESTAMP, ZLATITUDE, ZLONGITUDE', queryId: rtSrc.roles.location.id };
                    runRole(rtDb, rtSrc.roles.location, { window: range }, ['time'], run).rows.forEach(function (r) {
                        if (r.timeMs == null || !ProvenanceCore.inWindows(r.timeMs, wins)) return;
                        input.locations.push({ ms: r.timeMs, lat: Number(r.latitude), lon: Number(r.longitude), accuracy: Number(r.accuracy), type: Number(r.type) });
                    });
                }
                input.warnings = input.warnings.concat(rtDb.warnings);
            } catch (e) {
                input.warnings.push('routined Cache.sqlite kunde inte läsas: ' + e.message);
                input.missingDbs.routined = 'unread';
            } else {
                input.missingDbs.routined = true;
            }
        } else {
            input.missingDbs.routined = true;
            var wb = hitFor('wellbeing');
            if (wb) try {
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
            } catch (e) {
                input.warnings.push('Wellbeing (app_usage) kunde inte läsas: ' + e.message);
                input.missingDbs.wellbeing = 'unread';
            } else {
                input.missingDbs.wellbeing = true;
            }
            // usagestats (app, skärm, lås) och appops (kameran per app) ur zippens filer.
            try { await addAndroidLogs(input, meta, range, run); }
            catch (e) { input.warnings.push('Androids systemloggar kunde inte läsas: ' + e.message); console.warn(e); }
        }

        // Snapchats egna register (beta): cachade filer, meddelanden, konton, notiser och på Android
        // Memories och filhanterarens journal i fönstret.
        if (range) {
            try { await addSnapchat(input, meta, range, run); }
            catch (e) { input.warnings.push('Snapchats register kunde inte läsas: ' + e.message); console.warn(e); }
        }

        // Bildfilen: EXIF, CRC32, MD5, SHA-256, filsystemets tid och bilden till kortet.
        progress('Läser bildfilen ur zippen…');
        if (!run.quiet) releasePreview();
        meta.thumbnail = null;
        input.exif = null;
        var fileSha = '';
        try {
            var media = run.mediaEntry ? { entry: run.mediaEntry, paired: null, reason: '' } : await findMedia(fileRow, platform);
            if (media.entry) {
                var read = await readMedia(media.entry);
                // Tiderna efter läsningen: den lokala posten kan ha fler tider än innehållsförteckningen.
                var times = ExtractionCore.entryTimes(media.entry);
                meta.fileEntry = { path: media.entry.name, size: media.entry.size, mtime: times.modified, created: times.created, accessed: times.accessed, timeField: times.field, crc32: ExtractionCore.hex(media.entry.crc32), crcOk: read.crcOk, md5: read.md5 || '', sha256: read.sha256 || '' };
                meta.mediaEntry = media.entry;
                input.fileEntry = { name: media.entry.name, size: media.entry.size, mtimeMs: times.modifiedMs, createdMs: times.createdMs, timeField: times.field };
                fileSha = read.sha256 || '';
                if (read.bytes) {
                    progress('Läser EXIF ur bildfilen…');
                    var tags = await readTags(read.bytes, fileRow.filename);
                    var sum = ExifCore.summarize(tags, fileRow.filename);
                    var taken = exifTakenMs(sum.taken, zone);
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
                if (!run.quiet) {
                    try { await loadPreview(media.entry, read.bytes, run.mediaEntry ? null : fileRow, platform, meta); }
                    catch (e) { state.preview = { source: 'none', kind: null, note: 'Bilden kunde inte visas: ' + e.message, url: null }; }
                }
                if (media.paired && media.paired.size <= MAX_MEDIA) {
                    try {
                        var pr = await ExtractionCore.readEntry(state.zip.read, media.paired);
                        var ptags = await readTags(pr.bytes, media.paired.name.slice(media.paired.name.lastIndexOf('/') + 1));
                        var psum = ExifCore.summarize(ptags, media.paired.name);
                        var pt = exifTakenMs(psum.taken, zone);
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

        if (!run.quiet && !state.preview) state.preview = { source: 'none', kind: null, note: meta.fileMissingReason || 'Filen lästes inte ur zippen.', url: null };

        // Hittad på en hashsumma: summan står i filkortet och protokollet, jämförd med filens egen. En fil
        // över 200 MB läses inte här, men sökningen räknade summan på samma post.
        if (run.foundBy) {
            var fb = run.foundBy;
            var fe = meta.fileEntry;
            var own = '';
            if (fe && fb.algo === 'md5') own = fe.md5;
            else if (fe && fb.algo === 'sha256') own = fe.sha256;
            else if (fe && fb.algo === 'sha1' && read && read.bytes) own = fe.sha1 = sha1Hex(read.bytes);
            if (!own && fe && meta.mediaEntry && z.hashCache) {
                own = z.hashCache[fb.algo][ProvenanceHashSearch.keyOf(meta.mediaEntry)] || '';
                if (own && fb.algo === 'sha1') fe.sha1 = own;
            }
            meta.foundBy = { algo: fb.algo, label: ProvenanceHashSearch.label(fb.algo), value: fb.value, own: own || '', same: own ? own === fb.value : null };
        }

        // Var finns filen? Alla poster med samma storlek och CRC32, bekräftade med SHA-256.
        if (meta.fileEntry) {
            try {
                progress('Letar efter kopior av filen i zippen…');
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
        return finalize(input, meta, zone, run.quiet);
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
        // Version 4 har strängarna i dagsfilen, version 5 i mappings. Version 3 och äldre är XML.
        var canDecode = vi.version === 4 || (!!logs.mappings && (vi.version == null || vi.version === 5));
        if (dailies.length && !canDecode) {
            input.warnings.push('usagestats finns men läses inte: ' + (vi.version != null && vi.version < 4
                ? 'version ' + vi.version + ' är XML (Android 9 eller äldre).'
                : 'version ' + (vi.version == null ? 'okänd' : vi.version) + (logs.mappings ? '' : ' utan mappings-filen') + ', som Härkomst inte kan avkoda.') +
                ' App, skärm och lås kommer då bara ur Wellbeing om den finns.');
        } else if (dailies.length) {
            progress('Läser usagestats (app, skärm, lås)…');
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
            progress('Läser appops (kameran per app)…');
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
        progress('Läser Snapchats register (beta)…');
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
    // Saknas iOS-versionen i zippen väljs Photos-queryerna efter databasens egna tabeller och
    // kolumner, och protokollet får en varning (bandNote) om hur de valdes.
    async function libraryPick() {
        var z = state.zip;
        var key = z.platform === 'iOS' ? 'photos' : 'android-mediastore';
        var hit = z.found.find(function (f) { return f.key === key && f.primary; }) || hitFor(key);
        var src = sourceByKey(key);
        if (!hit || !src) return null;
        var dbPick = ExtractionCore.dbForVersion(state.targets.find(function (t) { return t.key === key; }), z.version);
        var roles = ProvenanceRoles.rolesFor(src, { dbId: dbPick.db.id, version: z.version });
        var guessed = !!(dbPick.guessed && src.bands);
        var bandNote = '';
        if (guessed) {
            var band = null;
            try {
                var schema = photosSchema(await loadDb(hit, src.title));
                band = ProvenanceRoles.photosBandFromSchema(schema.tables, schema.columns);
            } catch (e) { band = null; }
            if (band) roles = ProvenanceRoles.rolesFor(src, { dbId: band.id });
            bandNote = 'iOS-versionen hittades inte i zippen (SystemVersion.plist saknas eller går inte att läsa). ' + (band
                ? 'Photos-queryerna valdes efter databasen: ' + band.why + '.'
                : 'Photos-queryerna för ' + src.bands[src.bands.length - 1].label + ' används. Kontrollera versionen.');
        }
        var table = z.platform === 'Android' ? 'files' : roles.file && roles.file.sql.indexOf('ZGENERICASSET') >= 0 ? 'ZGENERICASSET' : 'ZASSET';
        return { key: key, hit: hit, src: src, roles: roles, table: table, guessed: guessed, bandNote: bandNote };
    }

    // Tabellerna och kolumnerna i ZADDITIONALASSETATTRIBUTES, för valet av Photos-band.
    function photosSchema(loaded) {
        var t = loaded.sqlDb.exec("SELECT name FROM sqlite_master WHERE type = 'table'");
        var c = loaded.sqlDb.exec('PRAGMA table_info(ZADDITIONALASSETATTRIBUTES)');
        return { tables: t.length ? t[0].values.map(function (r) { return r[0]; }) : [], columns: c.length ? c[0].values.map(function (r) { return r[1]; }) : [] };
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
        return { snapchatContainers: guids, containerApps: state.zip ? state.zip.containerApps : {}, appName: appName };
    }

    // GUID:t i en appbehållare på iOS säger inte vilken app det är. Behållarens egen
    // .com.apple.mobile_container_manager.metadata.plist har appens id (MCMMetadataIdentifier).
    // Förteckningen över dem tas fram en gång per zip, och en plist läses först när en fil i den
    // behållaren ska visas. Okända behållare står kvar med sitt GUID.
    var CONTAINER_META = '/.com.apple.mobile_container_manager.metadata.plist';
    var CONTAINER_GUID = /\/Containers\/(?:Data\/Application|Shared\/AppGroup|Data\/PluginKitPlugin)\/([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\//;

    async function knownContainers(paths) {
        var z = state.zip;
        if (!z || z.platform !== 'iOS' || !window.KC || !window.KC.bplist) return;
        var want = [];
        (paths || []).forEach(function (p) {
            var m = CONTAINER_GUID.exec(p || '');
            var g = m ? m[1].toUpperCase() : null;
            if (g && !(g in z.containerApps) && want.indexOf(g) < 0) want.push(g);
        });
        if (!want.length) return;
        if (!z.containerMeta) {
            z.containerMeta = {};
            var metas = await ExtractionCore.find(z.read, z.file.size, function (name) { return name.slice(-CONTAINER_META.length) === CONTAINER_META; });
            metas.forEach(function (e) { var m = CONTAINER_GUID.exec(e.name); if (m) z.containerMeta[m[1].toUpperCase()] = e; });
        }
        for (var i = 0; i < want.length; i++) {
            var g = want[i];
            z.containerApps[g] = null;
            var e = z.containerMeta[g];
            if (!e || e.size > 65536) continue;
            try {
                var plist = window.KC.bplist.parse((await ExtractionCore.readEntry(z.read, e)).bytes);
                var id = plist && plist.MCMMetadataIdentifier;
                if (typeof id !== 'string' || !id) continue;
                var name = appName(id) || appName(id.replace(/^group\./, ''));
                z.containerApps[g] = name ? name + ' (' + id + ')' : id;
            } catch (err) { /* behållaren står kvar med sitt GUID */ }
        }
    }

    // ---------- Var finns filen? ----------

    // Alla poster med samma storlek och CRC32 som filen (ur innehållsförteckningen), de första tio
    // bekräftade med SHA-256. Returnerar raderna som modellen och protokollet använder.
    async function findCopies(file, fileSha) {
        var z = state.zip;
        var entries = await ExtractionCore.find(z.read, z.file.size, ProvenanceCopies.keeper(file.size, file.crc32, []));
        var list = ProvenanceCopies.findCopies(entries, file, placeOpts());
        await knownContainers(list.slice(0, 100).map(function (e) { return e.name; }));
        var opts = placeOpts();
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            var cls = ProvenanceCopies.classifyPath(e.name, opts);
            var shaOk = null;
            if (i < 10 && fileSha && e.size <= MAX_MEDIA) {
                try { shaOk = (await ExtractionCore.sha256((await ExtractionCore.readEntry(z.read, e)).bytes)) === fileSha; } catch (err) { shaOk = null; }
            }
            out.push({ name: e.name, size: e.size, crc32: ExtractionCore.hex(e.crc32), mtime: ExtractionCore.entryTime(e), mtimeMs: e.mtime ? e.mtime * 1000 : null, created: ExtractionCore.entryTimes(e).created, area: cls.area, label: cls.label, plain: cls.plain, shaOk: shaOk, entry: e });
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
        var created = list.some(function (c) { return c.created; });
        $('copies').innerHTML = '<table><thead><tr><th>Sökväg i zippen</th><th>Plats</th><th>Storlek</th><th>Ändrad (enligt zippen)</th>' + (created ? '<th>Skapad (enligt zippen)</th>' : '') + '<th>CRC32</th><th>SHA-256</th></tr></thead><tbody>' +
            list.map(function (c) {
                return '<tr><td class="path">' + escapeHtml(c.name) + '</td><td>' + escapeHtml(c.label) + '</td><td>' + escapeHtml(ExtractionCore.sizeText(c.size)) + '</td><td>' + escapeHtml(c.mtime) + '</td>' + (created ? '<td>' + escapeHtml(c.created || '') + '</td>' : '') + '<td class="path">' + escapeHtml(c.crc32) + '</td>' +
                    '<td>' + (c.shaOk === true ? '<span class="ok">samma som filen</span>' : c.shaOk === false ? '<span class="err">skiljer sig</span>' : '<span class="muted">inte kontrollerad</span>') + '</td></tr>';
            }).join('') + '</tbody></table>';
    }

    // ---------- Fil utanför bildbiblioteket ----------

    function dirName(name) { return name.slice(0, name.lastIndexOf('/')); }

    // Bedömer en post i zippen som inte har någon rad i Photos: i första hand en fil i Snapchats
    // cache, vars tidpunkt kommer ur cache_controller. Annars används EXIF-tiden eller zippens ändringstid.
    // priorQueries: queries som redan körts (sökningen i bildbiblioteket utan träff), så att de står i protokollet.
    // opts.quiet: en fil i listan. Inget ritas, och { model, meta } eller { missing } returneras.
    // opts.foundBy: { algo, value } när filen hittades på en hashsumma.
    async function assessEntry(entry, windowMs, priorQueries, opts) {
        var quiet = !!(opts && opts.quiet);
        var foundBy = opts && opts.foundBy || null;
        if (!quiet) state.redo = function () { return assessEntry(entry, Number($('window').value) * 60000, priorQueries, { foundBy: foundBy }).then(function () { setStatus('run-status', ''); }); };
        var z = state.zip;
        var runLog = { queries: (priorQueries || []).slice(), fileDb: null, fileLabel: '', fileRoles: null, mediaEntry: entry, quiet: quiet, foundBy: foundBy };
        var name = ExtractionCore.baseName(entry.name);
        var cacheKey = ProvenanceSnapchat.cacheKeyFromPath(entry.name);
        var fileRow = { filename: name, directory: dirName(entry.name), createdMs: null, addedMs: null, modifiedMs: null, importer: null, _raw: {}, zoneName: null, zoneOffset: null };
        await knownContainers([entry.name]);
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
                    var taken = exifTakenMs(sum.taken, zone0);
                    if (taken.ms) { fileRow.createdMs = taken.ms; tSource = { db: 'bildfilen', table: name, column: sum.taken.source }; }
                } catch (e) { /* ingen EXIF */ }
            }
            // Zippens ändringstid: Unix-tid när den finns, annars DOS-tid utan zon, tolkad som i sökningen på tid.
            var em = fileRow.createdMs ? null : ProvenanceMedia.entryMs(entry, zone0);
            if (em && em.ms) {
                fileRow.createdMs = em.ms;
                tSource = { db: 'zippen', table: entry.name, column: em.assumed ? 'ändringstid (DOS-tid utan zon)' : 'ändringstid' };
                if (em.assumed) runLog.timeNote = 'Filen har ingen registerrad och ingen tid i EXIF, så T är zippens ändringstid. Zippen anger den utan tidszon (DOS-tid), och den har tolkats i ' + zone0.label + '.';
            }
        }
        if (!fileRow.createdMs) {
            var none = 'Filen har varken registerrad, EXIF-tid eller ändringstid, så ingen tidslinje kan byggas.';
            if (quiet) return { missing: none };
            setStatus('run-status', none, 'warn');
            return null;
        }
        fileRow._raw = Object.assign({ 'Sökväg i zippen': entry.name, Plats: cls.label }, fileRow._raw);
        runLog.fileSource = tSource;
        runLog.fileLabel = tSource.db;
        // Bilderna i biblioteket runt tidpunkten visas även för en fil utanför biblioteket.
        var lib = await libraryPick();
        if (lib && lib.bandNote) runLog.bandNote = lib.bandNote;
        if (lib && lib.roles.neighbours) {
            runLog.neighbourDb = await loadDb(lib.hit, lib.src.title);
            runLog.neighbourRoles = { neighbours: lib.roles.neighbours };
            runLog.neighbourSource = { db: lib.src.title, table: lib.table, column: ProvenanceRoles.fieldSpec(lib.roles.neighbours, 'created').col, queryId: lib.roles.neighbours.id };
        }
        if (!quiet) fillZoneSelect(fileRow);
        progress('Hämtar registreringar…');
        return assess(fileRow, null, windowMs, runLog);
    }

    // Filnamnet finns inte i biblioteket: sök hela zippen på namnet.
    async function runOutsideLibrary(filename, windowMs, priorQueries) {
        var z = state.zip;
        setStatus('run-status', 'Ingen rad i bildbiblioteket. Söker filnamnet i hela zippen…');
        var entries = await ExtractionCore.find(z.read, z.file.size, ProvenanceCopies.keeper(null, null, [filename]));
        var hits = ProvenanceCopies.byName(entries, filename);
        if (!hits.length) { setStatus('run-status', 'Ingen rad med filnamnet ' + escapeHtml(filename) + ' i bildbiblioteket, och ingen fil med det namnet i zippen. Namnet måste vara exakt, med ändelse.', 'warn'); return; }
        if (hits.length === 1) { await assessEntry(hits[0], windowMs, priorQueries); return; }
        await knownContainers(hits.map(function (e) { return e.name; }));
        renderEntryHits(hits, 'Filnamnet finns på ' + hits.length + ' ställen i zippen, men inte i bildbiblioteket. Välj vilken post som ska bedömas.', function (e) { guarded(function () { return assessEntry(e, Number($('window').value) * 60000, priorQueries).then(function () { setStatus('run-status', ''); }); }); });
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
            tr.addEventListener('click', function () {
                if (isBusy()) return;
                $('hits').classList.add('display-none'); $('hits-entries').classList.add('display-none'); onPick(hits[Number(tr.getAttribute('data-i'))]);
            });
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
        clearBatch();
        if (file.size > MAX_MEDIA) { setStatus('run-status', 'Filen är ' + ExtractionCore.sizeText(file.size) + ', över gränsen på 200 MB.', 'warn'); return; }
        busy(true);
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
            await knownContainers(hits.map(function (e) { return e.name; }));
            renderEntryHits(hits, head + 'Samma innehåll finns på ' + hits.length + ' ställen i zippen. Välj vilken post som ska bedömas.', function (e) { guarded(function () { return pick(e); }); });
        } catch (err) {
            console.error(err);
            setStatus('run-status', escapeHtml(err && err.message ? err.message : String(err)), 'err');
        } finally {
            busy(false);
        }
    }

    // ---------- Sök på hashsumma ----------

    // Raderna i biblioteket vars fil ligger på sökvägen. Hittas ingen behålls alla.
    function rowsForPath(rows, path) {
        var lower = String(path).toLowerCase();
        var platform = state.zip ? state.zip.platform : null;
        var same = rows.filter(function (r) { var s = mediaSuffix(r, platform); return !!s && lower.endsWith(s.toLowerCase()); });
        return same.length ? same : rows;
    }

    function num(n) { return Number(n).toLocaleString('sv-SE'); }
    function secondsText(ms) {
        var s = Math.round(ms / 1000);
        return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
    }

    // Läser zippens filer och räknar summorna, med förlopp och Avbryt. Summor som redan räknats
    // (ett tidigare sök i samma zip) läses inte om.
    async function searchHashes(hashes, entries) {
        var z = state.zip;
        if (!z.hashCache) z.hashCache = ProvenanceHashSearch.emptyCache();
        var labels = [];
        hashes.forEach(function (h) { var l = ProvenanceHashSearch.label(ProvenanceHashSearch.algoOf(h)); if (labels.indexOf(l) < 0) labels.push(l); });
        var what = hashes.length === 1 ? labels[0] + ':n' : hashes.length + ' summorna (' + labels.join(', ') + ')';
        var stopBtn = $('batch-stop');
        state.hashStop = false;
        stopBtn.textContent = 'Avbryt sökningen';
        stopBtn.title = 'Sökningen stannar efter filen som läses nu';
        stopBtn.disabled = false;
        stopBtn.classList.remove('display-none');
        var t0 = performance.now();
        var shown = 0;
        setStatus('run-status', escapeHtml('Söker ' + what + ' i zippen…'));
        try {
            var res = await ProvenanceHashSearch.search(entries, hashes, z.hashCache, {
                stream: function (e, onChunk) { return ZipRead.stream(z.read, e, onChunk); },
                hasher: function (algo) { return ToolboxHashing.createHasher(algo); },
                shouldStop: function () { return state.hashStop || state.zip !== z; },
                tick: tick,
                onProgress: function (p) {
                    var now = performance.now();
                    if (now - shown < 250) return;
                    shown = now;
                    setStatus('run-status', escapeHtml('Söker ' + what + ' i zippen. ' + p.tierText.charAt(0).toUpperCase() + p.tierText.slice(1) + ': ' + num(p.tierDone) + ' av ' + num(p.tierTotal) +
                        ' (' + ExtractionCore.sizeText(p.tierBytes) + ' av ' + ExtractionCore.sizeText(p.tierBytesTotal) + '). Hela zippen: ' + ExtractionCore.sizeText(p.doneBytes) + ' av ' +
                        ExtractionCore.sizeText(p.totalBytes) + ', ' + secondsText(now - t0) + '.'));
                },
            });
            res.ms = performance.now() - t0;
            res.what = what;
            return res;
        } finally {
            stopBtn.classList.add('display-none');
            stopBtn.textContent = 'Avbryt listan';
            stopBtn.title = 'Filen som bedöms nu blir klar, sedan stannar listan';
        }
    }

    // En summa i listan: var den finns, eller varför den inte hittades.
    function hashItem(text, res) {
        var hex = String(text).trim().toLowerCase();
        var algo = ProvenanceHashSearch.algoOf(hex);
        var item = { kind: 'hash', hash: hex, algo: algo, foundBy: { algo: algo, value: hex } };
        var hits = res && res.found[hex] || [];
        if (hits.length) item.entries = hits;
        else item.missing = ProvenanceHashSearch.missingText(algo, res, ExtractionCore.sizeText);
        return item;
    }

    function foundText(res) {
        return res.what.charAt(0).toUpperCase() + res.what.slice(1) + (res.missing.length ? '' : ' hittades') + ' efter ' + num(res.read) + (res.read === 1 ? ' läst fil' : ' lästa filer') +
            ' (' + ExtractionCore.sizeText(res.bytes) + ') på ' + secondsText(res.ms) + '.';
    }

    // Rutan har hashsummor. En summa som också är ett filnamn i zippen (Snapchats cachefiler heter 32
    // hexadecimala tecken, som en MD5) är ett filnamn. Resten söks på innehållet, i en enda läsning av
    // zippen för alla summor. En ensam summa bedöms direkt; flera namn och summor blir en lista.
    async function runWithHashes(names) {
        var z = state.zip;
        clearBatch();
        releaseHitUrls();
        $('hits').classList.add('display-none');
        $('hits-entries').classList.add('display-none');
        $('result').classList.add('display-none');
        var hashes = [];
        var res = null;
        busy(true);
        try {
            setStatus('run-status', 'Läser zippens innehållsförteckning…');
            var entries = await ExtractionCore.find(z.read, z.file.size, function (name) { return name.charAt(name.length - 1) !== '/'; });
            var hexNames = {};
            entries.forEach(function (e) { var b = ExtractionCore.baseName(e.name).toLowerCase(); if (ProvenanceHashSearch.algoOf(b)) hexNames[b] = true; });
            hashes = names.filter(function (n) { return ProvenanceHashSearch.algoOf(n) && !hexNames[n.toLowerCase()]; });
            if (hashes.length) res = await searchHashes(hashes, entries);
        } catch (err) {
            batchFailed(err);
            return;
        } finally {
            busy(false);
        }
        if (res && res.stopped) {
            var got = hashes.length - res.missing.length;
            setStatus('run-status', escapeHtml('Sökningen avbröts efter ' + num(res.done) + ' av ' + num(res.total) + ' filer. ' + (hashes.length > 1 ? got + ' av ' + hashes.length + ' summor hittades innan dess. ' : '') +
                'Sök igen, så går filerna som redan lästs fort.'), 'warn');
            return;
        }
        if (names.length > 1) {
            await runBatch(names.map(function (n) { return hashes.indexOf(n) < 0 ? { kind: 'name', name: n } : hashItem(n, res); }), 'names');
            return;
        }
        if (!hashes.length) { await run({ filename: names[0] }); return; }
        var item = hashItem(names[0], res);
        if (item.missing) { setStatus('run-status', escapeHtml(item.missing + ' Det tog ' + secondsText(res.ms) + '.'), 'warn'); return; }
        var head = ProvenanceHashSearch.label(item.algo) + ' ' + item.hash + ' ';
        if (item.entries.length === 1) {
            await guarded(function () { return assessFound(item.entries[0], item.foundBy, foundText(res)); });
            return;
        }
        await knownContainers(item.entries.map(function (e) { return e.name; }));
        renderEntryHits(item.entries, head + 'finns på ' + item.entries.length + ' ställen i zippen. ' + foundText(res) + ' Välj vilken post som ska bedömas.', function (e) {
            guarded(function () { return assessFound(e, item.foundBy, foundText(res)); });
        });
    }

    // En post som hittats på sin summa. En bild i bildbiblioteket (DCIM) bedöms via biblioteket, som
    // när filen väljs från disk, och annars som en post i zippen.
    async function assessFound(e, foundBy, note) {
        var cls = ProvenanceCopies.classifyPath(e.name, placeOpts());
        if (cls.area === 'library' && /\/DCIM\//.test(e.name)) await run({ filename: ExtractionCore.baseName(e.name), path: e.name, entry: e, foundBy: foundBy });
        else await assessEntry(e, Number($('window').value) * 60000, [], { foundBy: foundBy });
        if (!$('result').classList.contains('display-none')) setStatus('run-status', escapeHtml(note || ''));
    }

    // Det sista steget, gemensamt för en riktig extraktion och testdatat: modellen byggs,
    // protokollets huvud fylls i och allt ritas.
    // quiet: en fil i listan. Modellen och metan returneras utan att något ritas.
    async function finalize(input, meta, zone, quiet) {
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
        if (quiet) return { model: model, meta: meta };
        state.model = model;
        state.meta = meta;
        await render();
        noteBatchDetail(model, meta);
        announceFile();
        return { model: model, meta: meta };
    }

    // Testdata: samma påhittade promenad i Stockholm som i EXIF & karta, utan extraktion. Två
    // scenarier: kamerabilden IMG_4104.JPG i biblioteket, och (kind 'snapchat') videon som spelas in
    // med Snapchats kamera strax efter och bara finns i Snapchats cache. Rollqueryernas SQL i
    // protokollet är den riktiga ur katalogerna, ifylld för fönstret, i samma ordning som en körning.
    async function fillSample(kind) {
        closeZip();
        state.redo = function () { return fillSample(kind); };
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
    // opts: { pk, filename }. Utan filename läses fältet: ett namn bedöms här, flera blir en lista.
    async function run(opts) {
        var z = state.zip;
        if (!z || !z.platform) { setStatus('run-status', 'Öppna en extraktion först, eller fyll med testdata.', 'warn'); return; }
        var fromList = !!(opts && opts.filename);
        var names = fromList ? [opts.filename] : ProvenanceBatch.parseNames($('filename').value);
        if (!names.length) { setStatus('run-status', 'Ange ett filnamn eller en hashsumma, eller sök på en tidpunkt.', 'warn'); return; }
        if (!fromList && names.some(function (n) { return ProvenanceHashSearch.algoOf(n); })) { await runWithHashes(names); return; }
        if (names.length > 1) { await runBatch(names.map(function (n) { return { kind: 'name', name: n }; }), 'names'); return; }
        var filename = names[0];
        var pk = opts && opts.pk != null && typeof opts.pk !== 'object' ? String(opts.pk) : null;
        // Hittad på en hashsumma: summan följer med till protokollet, och sökvägen väljer raden när
        // flera rader i biblioteket har samma filnamn.
        var foundBy = opts && opts.foundBy || null;
        var foundPath = opts && opts.path || null;
        // En ny sökning här avslutar listan; en fil som öppnas ur listan gör det inte.
        if (!fromList) clearBatch();
        busy(true);
        releaseHitUrls();
        $('hits').classList.add('display-none');
        $('hits-entries').classList.add('display-none');
        $('result').classList.add('display-none');
        try {
            var runLog = { queries: [], foundBy: foundBy };
            var windowMs = Number($('window').value) * 60000;
            var lib = await libraryPick();
            if (!lib && opts && opts.entry) { await assessEntry(opts.entry, windowMs, [], { foundBy: foundBy }); return; }
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
            if (lib.bandNote) runLog.bandNote = lib.bandNote;
            var hits = androidCreatedFallback(runRole(db, roles.file, { filename: filename }, TIME_KEYS, runLog).rows);
            // Exakt ZFILENAME först. En träff på ZORIGINALFILENAME är ofta en molnkopia med annat namn.
            hits.sort(function (a, b) { return (b.filename === filename) - (a.filename === filename) || (a.createdMs || 0) - (b.createdMs || 0); });
            if (pk != null && hits.some(function (h) { return String(h.pk) === pk; })) hits = hits.filter(function (h) { return String(h.pk) === pk; });
            if (foundPath && hits.length > 1) hits = rowsForPath(hits, foundPath);
            if (!hits.length && opts && opts.entry) { await assessEntry(opts.entry, windowMs, runLog.queries, { foundBy: foundBy }); return; }
            if (!hits.length) {
                await runOutsideLibrary(filename, windowMs, runLog.queries);
                return;
            }
            if (hits.length === 1) {
                var only = hits[0];
                state.redo = function () { return run({ pk: only.pk, filename: filename, foundBy: foundBy, path: foundPath }); };
                fillZoneSelect(only);
                progress('Hämtar registreringar…');
                await assess(only, roles.file, windowMs, runLog);
                setStatus('run-status', '');
                return;
            }
            fillZoneSelect(hits[0]);
            renderHits(hits, function (row) {
                $('hits').classList.add('display-none');
                // Samma rad igen (tidszon eller fönster ändrat) görs om via run, som hämtar raden på nytt.
                state.redo = function () { return run({ pk: row.pk, filename: filename, foundBy: foundBy }); };
                guarded(function () {
                    progress('Hämtar registreringar…');
                    var log = { queries: runLog.queries.slice(), fileDb: db, fileLabel: src.title, fileRoles: roles, bandNote: runLog.bandNote, foundBy: foundBy };
                    return assess(row, roles.file, Number($('window').value) * 60000, log).then(function () { setStatus('run-status', ''); });
                });
            });
            setStatus('run-status', hits.length + ' rader har det filnamnet. Välj vilken som ska bedömas.');
        } catch (err) {
            console.error(err);
            setStatus('run-status', escapeHtml(err && err.message ? err.message : String(err)), 'err');
        } finally {
            busy(false);
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
            tr.addEventListener('click', function () { if (!isBusy()) onPick(hits[Number(tr.getAttribute('data-i'))]); });
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

    // ---------- Flera filer: listan ----------

    function batchFailed(err) {
        console.error(err);
        setStatus('run-status', escapeHtml(err && err.message ? err.message : String(err)), 'err');
    }

    // Filnamnsrutan växer med antalet rader, upp till åtta.
    function fitNameBox() {
        var el = $('filename');
        el.rows = Math.min(8, Math.max(1, el.value.split('\n').length));
    }

    // Varje fil i listan bedöms med samma kod som en ensam fil, men utan filkort, tidslinjer och
    // karta. Zippens förteckning och databaserna är redan inlästa, så varje fil kostar bara det som
    // gäller den. Ett klick på en rad gör om bedömningen för den filen och visar den vanliga vyn.
    // Poster: { kind: 'name', name } | { kind: 'row', row } (bildbiblioteket) | { kind: 'entry', entry }
    // | { kind: 'disk', file } | { kind: 'hash', hash, algo, foundBy, entries eller missing }.
    // pk eller path läggs till när undersökaren valt bland flera träffar.

    function batchItemName(it) {
        if (it.kind === 'name') return it.name;
        if (it.kind === 'hash') return it.hash;
        if (it.kind === 'disk') return it.file.name;
        if (it.kind === 'row') return it.row.filename;
        return ExtractionCore.baseName(it.entry.name);
    }

    function clearBatch() {
        var b = state.batch;
        if (b) {
            b.stop = true;
            b.urls.forEach(function (u) { URL.revokeObjectURL(u); });
        }
        state.batch = null;
        $('batch-box').classList.add('display-none');
        $('batch-list').innerHTML = '';
        $('batch-nav').classList.add('display-none');
    }

    function windowText(v) { return Number(v) >= 1440 ? '±' + Math.round(Number(v) / 60) + ' timmar' : '±' + v + ' min'; }

    function zoneText(v) {
        if (v === 'utc') return 'UTC';
        if (v === 'file') return 'varje bilds egen zon, annars datorns';
        return localZone() || offsetText(-new Date().getTimezoneOffset());
    }

    // items: posterna ovan. origin: 'names', 'disk' eller 'time', till raden under listan.
    async function runBatch(items, origin) {
        var z = state.zip;
        if (!z || !z.platform) { setStatus('run-status', 'Öppna en extraktion först.', 'warn'); return; }
        clearBatch();
        releaseHitUrls();
        $('hits').classList.add('display-none');
        $('hits-entries').classList.add('display-none');
        $('result').classList.add('display-none');
        fillZoneSelect(null, true);
        var b = state.batch = {
            rows: items.map(function (it) { return { item: it, name: batchItemName(it), status: 'waiting', note: '', summary: null, key: null, target: null, thumbUrl: null }; }),
            stop: false, running: true, prefix: '', current: -1, open: -1, origin: origin || '', urls: [],
            window: $('window').value, zone: $('zone').value,
        };
        busy(true);
        $('batch-stop').disabled = false;
        $('batch-stop').classList.remove('display-none');
        $('batch-box').classList.remove('display-none');
        renderBatch();
        var t0 = performance.now();
        var done = 0;
        try {
            for (var i = 0; i < b.rows.length && !b.stop; i++) {
                b.current = i;
                b.prefix = 'Bedömer ' + (i + 1) + ' av ' + b.rows.length + ': ' + escapeHtml(b.rows[i].name);
                progress('');
                renderBatch();
                await batchOne(b.rows[i], b);
                done++;
            }
        } finally {
            b.running = false;
            b.current = -1;
            $('batch-stop').classList.add('display-none');
            busy(false);
        }
        if (state.batch !== b) return;
        b.rows.forEach(function (r) { if (r.status === 'waiting') { r.status = 'stopped'; r.note = 'Avbruten innan filen bedömdes.'; } });
        renderBatch();
        var secs = (performance.now() - t0) / 1000;
        var c = ProvenanceBatch.counts(b.rows);
        var text = (b.stop ? 'Avbruten efter ' + done + ' av ' + b.rows.length + ' filer' : b.rows.length + ' filer genomgångna') +
            ' på ' + secs.toFixed(1).replace('.', ',') + ' s' + (done ? ' (' + (secs / done).toFixed(1).replace('.', ',') + ' s per fil)' : '') + '. ' +
            c.done + ' bedömda' + (c.missing ? ', ' + c.missing + ' finns inte' : '') + (c.ambiguous ? ', ' + c.ambiguous + ' med flera träffar' : '') + (c.error ? ', ' + c.error + ' kunde inte bedömas' : '') +
            '. Klicka på en rad för att se underlaget och skriva din egen bedömning.';
        setStatus('run-status', escapeHtml(text));
        fillBatchThumbs(b).catch(function () {});
    }

    async function batchOne(row, b) {
        var windowMs = Number(b.window) * 60000;
        try {
            var target = await resolveItem(row.item);
            row.target = target;
            if (target.missing) { row.status = 'missing'; row.note = target.missing; return; }
            if (target.ambiguous) { row.status = 'ambiguous'; row.note = target.ambiguous; return; }
            var foundBy = row.item.foundBy || null;
            var out = target.kind === 'row'
                ? await assess(target.row, target.query, windowMs, Object.assign({}, target.runLog, { queries: target.runLog.queries.slice(), quiet: true, foundBy: foundBy }))
                : await assessEntry(target.entry, windowMs, target.priorQueries, { quiet: true, foundBy: foundBy });
            if (!out || out.missing) { row.status = 'error'; row.note = out && out.missing ? out.missing : 'Filen kunde inte bedömas.'; return; }
            setRowSummary(row, out.model, out.meta);
            row.status = 'done';
        } catch (err) {
            console.warn(err);
            row.status = 'error';
            row.note = err && err.message ? err.message : String(err);
        }
    }

    function setRowSummary(row, model, meta) {
        row.key = assessmentKey(model.file);
        var path = meta.fileEntry ? meta.fileEntry.path : row.target && row.target.entry ? row.target.entry.name : '';
        var place = path ? ProvenanceCopies.classifyPath(path, placeOpts()).label : '';
        row.summary = ProvenanceBatch.summarize(model, meta, { format: meta.format, zoneLabel: meta.zoneLabel, place: place, key: row.key });
    }

    // Vad en rad ska bedöma: en rad i bildbiblioteket, en post i zippen, eller varför inget.
    async function resolveItem(it) {
        if (it.path) {
            var z = state.zip;
            var exact = (await ExtractionCore.find(z.read, z.file.size, ProvenanceCopies.keeper(null, null, [ExtractionCore.baseName(it.path)])))
                .filter(function (e) { return e.name === it.path; });
            return exact.length ? { kind: 'entry', entry: exact[0], priorQueries: [] } : { missing: 'Posten ' + it.path + ' finns inte längre i zippen.' };
        }
        if (it.kind === 'name') return resolveName(it.name, it.pk);
        if (it.kind === 'row') return resolveName(it.row.filename, it.pk != null ? it.pk : it.row.pk);
        if (it.kind === 'entry') return { kind: 'entry', entry: it.entry, priorQueries: [] };
        if (it.kind === 'hash') return resolveFound(it, it.missing ? null : it.entries, ProvenanceHashSearch.label(it.algo) + ':n finns');
        return resolveDisk(it);
    }

    // Som run(): exakt ett filnamn i bildbiblioteket, annars samma namn någon annanstans i zippen.
    // path: filens sökväg i zippen, när den är känd (hittad på innehållet), väljer bland flera rader.
    async function resolveName(name, pk, path) {
        var z = state.zip;
        var prior = [];
        var lib = await libraryPick();
        if (lib) {
            var db = await loadDb(lib.hit, lib.src.title);
            var runLog = { queries: [], fileDb: db, fileLabel: lib.src.title, fileRoles: lib.roles, bandNote: lib.bandNote || '' };
            var hits = androidCreatedFallback(runRole(db, lib.roles.file, { filename: name }, TIME_KEYS, runLog).rows);
            if (pk != null && hits.some(function (h) { return String(h.pk) === String(pk); })) hits = hits.filter(function (h) { return String(h.pk) === String(pk); });
            if (path && hits.length > 1) hits = rowsForPath(hits, path);
            if (hits.length === 1) return { kind: 'row', row: hits[0], query: lib.roles.file, runLog: runLog };
            if (hits.length > 1) return { ambiguous: hits.length + ' rader i ' + lib.src.title + ' har det namnet. Öppna raden och välj.' };
            prior = runLog.queries;
        }
        var found = ProvenanceCopies.byName(await ExtractionCore.find(z.read, z.file.size, ProvenanceCopies.keeper(null, null, [name])), name);
        if (!found.length) return { missing: lib ? 'Finns varken i bildbiblioteket eller någon annanstans i zippen. Namnet måste vara exakt, med ändelse.' : 'Finns inte i zippen.' };
        if (found.length > 1) return { ambiguous: 'Namnet finns på ' + found.length + ' ställen i zippen. Öppna raden och välj.' };
        return { kind: 'entry', entry: found[0], priorQueries: prior };
    }

    // En fil från disk: samma innehåll (storlek och CRC32) i zippen. Finns det på flera ställen
    // och ett av dem är bildbiblioteket bedöms den, som när man väljer den i listan för en ensam fil.
    async function resolveDisk(it) {
        var z = state.zip;
        var file = it.file;
        if (file.size > MAX_MEDIA) return { missing: 'Filen är ' + ExtractionCore.sizeText(file.size) + ', över gränsen på 200 MB.' };
        progress('Räknar CRC32…');
        var crc = ZipRead.crc32(new Uint8Array(await file.arrayBuffer()));
        var hits = ProvenanceCopies.findCopies(await ExtractionCore.find(z.read, z.file.size, ProvenanceCopies.keeper(file.size, crc, [])), { name: '', size: file.size, crc32: crc }, placeOpts());
        if (!hits.length) return { missing: 'Ingen post i zippen har samma storlek och CRC32, så filen finns inte byte för byte i extraktionen.' };
        return resolveFound(it, hits, 'Samma innehåll finns');
    }

    // Poster med samma innehåll (från disk eller en hashsumma). Finns det på flera ställen och ett av
    // dem är bildbiblioteket bedöms den, som när man väljer den i listan för en ensam fil.
    async function resolveFound(it, hits, what) {
        if (!hits) return { missing: it.missing };
        var opts = placeOpts();
        var lib = hits.filter(function (e) { var c = ProvenanceCopies.classifyPath(e.name, opts); return c.area === 'library' && /\/DCIM\//.test(e.name); });
        var pick = hits.length === 1 ? hits[0] : lib.length === 1 ? lib[0] : null;
        if (!pick) return { ambiguous: what + ' på ' + hits.length + ' ställen i zippen. Öppna raden och välj.', entries: hits };
        if (ProvenanceCopies.classifyPath(pick.name, opts).area === 'library' && /\/DCIM\//.test(pick.name)) {
            var t = await resolveName(ExtractionCore.baseName(pick.name), it.pk, pick.name);
            if (!t.missing) return t;
        }
        return { kind: 'entry', entry: pick, priorQueries: [] };
    }

    // Vad som söktes, när det inte är filnamnet: summan, eller filens namn på disk.
    function rowAlias(row) {
        if (row.item.kind === 'hash') return ProvenanceHashSearch.label(row.item.algo) + ' ' + row.item.hash;
        return row.summary && row.name !== row.summary.filename ? 'på disk: ' + row.name : '';
    }

    function batchRowHtml(row, i, b) {
        var cols = ProvenanceBatch.FACTOR_COLUMNS;
        var s = row.summary;
        var openable = !b.running && (row.status === 'done' || row.status === 'ambiguous');
        var thumb = row.thumbUrl ? '<img class="row-thumb" alt="" src="' + row.thumbUrl + '">' : '<span class="row-thumb empty"></span>';
        var cls = 'batch-row' + (openable ? ' pick' : '') + (b.current === i ? ' current' : '') + (b.open === i ? ' opened' : '');
        if (row.status !== 'done' || !s) {
            var what = row.status === 'waiting' ? (b.current === i ? 'Bedöms…' : 'Väntar') : row.status === 'ambiguous' ? 'Flera träffar' : row.status === 'missing' ? 'Finns inte' : row.status === 'stopped' ? 'Avbruten' : 'Kunde inte bedömas';
            return '<tr class="' + cls + '" data-i="' + i + '"><td class="thumb-col">' + thumb + '</td><td><strong>' + escapeHtml(row.item.kind === 'hash' ? rowAlias(row) : row.name) + '</strong></td><td></td>' +
                '<td class="' + (row.status === 'waiting' ? 'muted' : 'warn') + '">' + escapeHtml(what) + '</td><td colspan="' + (cols.length + 1) + '" class="muted">' + escapeHtml(row.note) + '</td></tr>';
        }
        var cells = cols.map(function (c) {
            var f = s.factors[c[0]];
            if (!f) return '<td class="f-col"></td>';
            return '<td class="f-col"><span class="dot ' + escapeHtml(f.state) + '" title="' + escapeHtml(f.title + ': ' + (f.verdict || ProvenanceCore.STATE_LABEL[f.state] || f.state)) + '"></span></td>';
        }).join('');
        var ex = ProvenanceBatch.examinerState(state.examiner[row.key], s.factorIds);
        var exText = ProvenanceBatch.examinerText(state.examiner[row.key], s.factorIds);
        return '<tr class="' + cls + '" data-i="' + i + '" title="' + escapeHtml(s.summary) + '"><td class="thumb-col">' + thumb + '</td>' +
            '<td><strong>' + escapeHtml(s.filename) + '</strong>' + (rowAlias(row) ? ' <span class="muted">(' + escapeHtml(rowAlias(row)) + ')</span>' : '') +
            '<div class="sub">' + escapeHtml(s.place || s.fileNote) + '</div></td>' +
            '<td>' + escapeHtml(s.tText) + '<div class="sub">' + escapeHtml(s.zoneLabel) + '</div></td>' +
            '<td>' + escapeHtml(s.typeLabel) + (s.beta ? ' <span class="badge beta">Beta</span>' : '') + (s.warnings ? '<div class="sub warn">' + s.warnings + (s.warnings === 1 ? ' varning' : ' varningar') + '</div>' : '') + '</td>' +
            cells + '<td class="' + (ex.written ? 'ok' : 'muted') + '">' + escapeHtml(exText) + '</td></tr>';
    }

    function renderBatch() {
        var b = state.batch;
        if (!b) return;
        var cols = ProvenanceBatch.FACTOR_COLUMNS;
        $('batch-list').innerHTML = '<table class="batch-table"><thead><tr><th class="thumb-col">Bild</th><th>Fil</th><th>T</th><th>Typ</th>' +
            cols.map(function (c) { return '<th class="f-col" title="' + escapeHtml(c[2]) + '">' + escapeHtml(c[1]) + '</th>'; }).join('') +
            '<th>Undersökaren</th></tr></thead><tbody>' + b.rows.map(function (r, i) { return batchRowHtml(r, i, b); }).join('') + '</tbody></table>';
        var c = ProvenanceBatch.counts(b.rows);
        var assessed = b.rows.filter(function (r) { return r.key && ProvenanceBatch.examinerState(state.examiner[r.key], r.summary ? r.summary.factorIds : []).written; }).length;
        $('batch-note').textContent = b.rows.length + ' filer, fönster ' + windowText(b.window) + ', tidszon: ' + zoneText(b.zone) + '. ' +
            (b.running ? '' : c.done + ' har underlag, ' + assessed + ' har din egen bedömning. ') +
            'Prickarna är faktorernas läge: grön förenligt, röd inte förenligt, gul saknas, grå inte tillämplig eller upplysning. ' +
            'Klicka på en rad för hela underlaget, tidslinjen och exporterna för den filen.';
    }

    // Tumnaglar: telefonens egen för bildbibliotekets rader, annars originalet om det är en liten bild.
    async function fillBatchThumbs(b) {
        var z = state.zip;
        if (!z || !state.showMedia) return;
        var platform = z.platform;
        var want = [];
        var suffixes = [];
        b.rows.slice(0, 200).forEach(function (r) {
            var t = r.target;
            if (r.status !== 'done' || !t) return;
            if (t.kind === 'row') {
                var w = { row: r, media: mediaSuffix(t.row, platform), thumb: ProvenanceMedia.thumbnailSuffix(platform, t.row) };
                if (w.media) suffixes.push(w.media);
                if (w.thumb) suffixes.push(w.thumb);
                want.push(w);
            } else if (t.entry) want.push({ row: r, entry: t.entry });
        });
        var entries = suffixes.length ? await ExtractionCore.find(z.read, z.file.size, ProvenanceMedia.suffixKeeper(suffixes)) : [];
        for (var i = 0; i < want.length; i++) {
            if (state.batch !== b) return;
            var w2 = want[i];
            var src = null;
            var mime = '';
            if (w2.entry) {
                if (ProvenanceMedia.kindOf(w2.entry.name) === 'image' && w2.entry.size <= MAX_ROW_THUMB) { src = w2.entry; mime = ProvenanceMedia.mimeOf(w2.entry.name); }
            } else {
                var te = w2.thumb ? ProvenanceMedia.pickBySuffix(entries, w2.thumb) : null;
                var me = w2.media ? ProvenanceMedia.pickBySuffix(entries, w2.media) : null;
                if (te && te.size <= MAX_THUMB) { src = te; mime = 'image/jpeg'; }
                else if (me && ProvenanceMedia.kindOf(me.name) === 'image' && me.size <= MAX_ROW_THUMB) { src = me; mime = ProvenanceMedia.mimeOf(me.name); }
            }
            if (!src) continue;
            try {
                var r = await ExtractionCore.readEntry(z.read, src);
                if (state.batch !== b) return;
                var url = URL.createObjectURL(new Blob([r.bytes], { type: mime }));
                b.urls.push(url);
                w2.row.thumbUrl = url;
                var img = $('batch-list').querySelector('tr[data-i="' + b.rows.indexOf(w2.row) + '"] td.thumb-col');
                if (img) img.innerHTML = '<img class="row-thumb" alt="" src="' + url + '">';
            } catch (err) { /* raden får ingen tumnagel */ }
        }
    }

    // Ett klick på en rad: samma bedömning som för en ensam fil, med listans fönster och zon.
    function openBatchRow(i) {
        var b = state.batch;
        if (!b || b.running || isBusy() || !b.rows[i]) return;
        var row = b.rows[i];
        if (row.status !== 'done' && row.status !== 'ambiguous') return;
        saveExaminer();
        b.open = i;
        $('window').value = b.window;
        $('zone').value = b.zone;
        $('batch-box').classList.add('display-none');
        $('result').classList.add('display-none');
        showBatchNav();
        var windowMs = Number(b.window) * 60000;
        guarded(async function () {
            var chosen = row.item.pk != null || !!row.item.path;
            var foundBy = row.item.foundBy || null;
            // Flera träffar och inget val ännu: samma lista att välja ur som för en ensam fil.
            if (row.status === 'ambiguous' && !chosen) {
                var t0 = row.target || {};
                if (t0.entries) {
                    var what = row.item.kind === 'hash' ? rowAlias(row) : 'Samma innehåll som ' + row.name;
                    renderEntryHits(t0.entries, what + ' finns på ' + t0.entries.length + ' ställen i zippen. Välj vilken post som ska bedömas.', function (e) {
                        guarded(function () { return assessEntry(e, Number($('window').value) * 60000, [], { foundBy: foundBy }).then(function () { setStatus('run-status', ''); }); });
                    });
                } else await run({ filename: row.name });
                return;
            }
            var t = row.target && row.target.kind ? row.target : (row.target = await resolveItem(row.item));
            if (t.kind === 'row') await run({ filename: t.row.filename, pk: t.row.pk, foundBy: foundBy });
            else if (t.kind === 'entry') await assessEntry(t.entry, windowMs, t.priorQueries, { foundBy: foundBy });
            else { setStatus('run-status', escapeHtml(t.missing || t.ambiguous || 'Filen kunde inte öppnas.'), 'warn'); return; }
            setStatus('run-status', '');
        });
    }

    // Efter en bedömning som öppnats ur listan: valet bland flera träffar sparas på raden, så att
    // det gäller när listan görs om, och raden får underlaget för den valda filen.
    function noteBatchDetail(model, meta) {
        var b = state.batch;
        if (!b || b.open < 0 || b.running) return;
        var row = b.rows[b.open];
        if (!row) return;
        if (row.status === 'ambiguous') {
            if (model.file.pk != null) row.item.pk = model.file.pk;
            else if (meta.fileEntry) row.item.path = meta.fileEntry.path;
            row.target = null;
            setRowSummary(row, model, meta);
            row.status = 'done';
        }
        showBatchNav();
    }

    function showBatchNav() {
        var b = state.batch;
        if (!b || b.open < 0) { $('batch-nav').classList.add('display-none'); return; }
        $('batch-pos').textContent = 'Fil ' + (b.open + 1) + ' av ' + b.rows.length + ' i listan: ' + b.rows[b.open].name;
        $('batch-prev').disabled = nextOpenable(b, b.open, -1) < 0;
        $('batch-next').disabled = nextOpenable(b, b.open, 1) < 0;
        $('batch-nav').classList.remove('display-none');
    }

    function nextOpenable(b, from, step) {
        for (var i = from + step; i >= 0 && i < b.rows.length; i += step) {
            if (b.rows[i].status === 'done' || b.rows[i].status === 'ambiguous') return i;
        }
        return -1;
    }

    // Tillbaka till listan med listans fönster och zon. Undersökarens kolumn visar det som skrivits.
    function backToList() {
        var b = state.batch;
        if (!b || isBusy()) return;
        saveExaminer();
        var was = b.open;
        b.open = -1;
        $('result').classList.add('display-none');
        $('batch-nav').classList.add('display-none');
        $('hits').classList.add('display-none');
        $('hits-entries').classList.add('display-none');
        setStatus('run-status', '');
        fillZoneSelect(null, true);
        $('zone').value = b.zone;
        $('window').value = b.window;
        renderBatch();
        $('batch-box').classList.remove('display-none');
        var tr = $('batch-list').querySelector('tr[data-i="' + was + '"]');
        if (tr) tr.scrollIntoView({ block: 'center' });
    }

    async function exportBatch(save) {
        var b = state.batch;
        if (!b) return;
        saveExaminer();
        var z = state.zip;
        var rows = b.rows.map(function (r) { return { name: r.name, searched: r.item.kind === 'hash' ? rowAlias(r) : '', status: r.status, note: r.note, summary: r.summary, examiner: r.key ? state.examiner[r.key] || null : null }; });
        var html = ProvenanceReport.batchTable(rows, {
            extraction: z ? { name: z.file.name } : null,
            deviceLabel: z ? (z.version ? 'iOS ' + z.version : z.androidVersion ? 'Android ' + z.androidVersion : z.platform) : '',
            windowText: windowText(b.window), zoneText: zoneText(b.zone),
            createdText: new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC', toolVersion: state.toolVersion,
            stateLabel: ProvenanceCore.STATE_LABEL,
        });
        if (save) {
            download(new Blob(['﻿' + ProvenanceReport.standalone('Härkomst, ' + b.rows.length + ' filer', html)], { type: 'text/html;charset=utf-8' }), 'harkomst-lista-' + stamp() + '.html');
            return;
        }
        await copyTable(html, 'Listan');
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
        clearBatch();
        state.timeItems = null;
        busy(true);
        releaseHitUrls();
        $('hits').classList.add('display-none');
        $('hits-entries').classList.add('display-none');
        $('result').classList.add('display-none');
        try {
            var lib = await libraryPick();
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
            await knownContainers(inWin.slice(0, 200).map(function (e) { return e.name; }));
            if (inWin.length) {
                renderEntryHits(inWin.slice(0, 200), '', pickTimedEntry, {
                    target: 'hits-entries', centerMs: centerMs,
                    heading: inWin.length + (inWin.length === 1 ? ' fil' : ' filer') + ' utanför bildbiblioteket (bild, video eller Snapchats cache) har ändringstid ' + span + ' enligt zippen' + (inWin.length > 200 ? cap.replace(' (', ', ').replace(')', '') : '') + '.' +
                        (assumed ? ' Zippens ändringstider saknar tidszon och har tolkats i ' + zone.label + '.' : '') + ' Klicka på en rad för att bedöma den.',
                });
            }
            // Alla filerna i listorna kan bedömas på en gång, som en lista med flera filer.
            state.timeItems = rows.slice(0, 200).map(function (r) { return { kind: 'row', row: r }; })
                .concat(inWin.slice(0, 200).map(function (e) { return { kind: 'entry', entry: e }; }));
            var all = state.timeItems.length > 1 ? ' <button type="button" class="secondary" id="batch-time">Bedöm alla ' + state.timeItems.length + ' i en lista</button>' : '';
            setStatus('run-status', escapeHtml(text) + all, rows.length || inWin.length ? '' : 'warn');
        } catch (err) {
            console.error(err);
            setStatus('run-status', escapeHtml(err && err.message ? err.message : String(err)), 'err');
        } finally {
            busy(false);
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
        guarded(function () { return assessEntry(e, Number($('window').value) * 60000).then(function () { setStatus('run-status', ''); }); });
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

    // Telefonens positioner som kartan, tabellen och exporterna visar dem: alla, eller sammanfattade
    // med MapCore.summarizeTrack. Sammanfattningen görs per fönster, så att en vistelse aldrig går
    // över tiden mellan två fönster. Positionerna närmast före och efter T visas alltid, eftersom
    // positionsfaktorn bygger på dem. rows: bildens egna positioner först, sedan telefonens i tidsordning.
    function positionView(model) {
        var phone = model.positions.filter(function (q) { return q.kind === 'phone'; });
        var view = { summary: !!state.mapSummary && phone.length > 0, total: phone.length, rows: [], stays: 0, shown: phone.length };
        if (!view.summary) {
            view.rows = model.positions.map(function (q) { return { kind: 'point', q: q }; });
            return view;
        }
        var before = null, after = null;
        phone.forEach(function (q) {
            if (q.offsetMs == null) return;
            if (q.offsetMs <= 0 && (!before || q.offsetMs > before.offsetMs)) before = q;
            if (q.offsetMs > 0 && (!after || q.offsetMs < after.offsetMs)) after = q;
        });
        var wins = model.windows || [];
        var groups = wins.map(function () { return []; });
        var loose = [];
        phone.forEach(function (q) {
            for (var i = 0; i < wins.length; i++) if (q.ms >= wins[i].startMs && q.ms <= wins[i].endMs) { groups[i].push(q); return; }
            loose.push(q);
        });
        var items = [];
        groups.forEach(function (g) {
            MapCore.summarizeTrack(g.map(function (q) { return { at: q.ms, lat: q.lat, lon: q.lon, keep: q === before || q === after, q: q }; })).forEach(function (it) {
                if (it.kind !== 'stay') { items.push({ kind: 'point', q: it.item.q, keep: !!it.keep }); return; }
                items.push({
                    kind: 'stay', from: it.from, to: it.to, count: it.count, lat: it.lat, lon: it.lon, radius: it.radius,
                    members: it.members.map(function (m) { return m.q; }), source: it.members[0].q.source,
                    distanceM: model.filePosition ? ProvenanceCore.distanceM(model.filePosition, it) : null,
                });
            });
        });
        loose.forEach(function (q) { items.push({ kind: 'point', q: q }); });
        var at = function (r) { return r.kind === 'stay' ? r.from : r.q.ms; };
        items.sort(function (a, b) { return at(a) - at(b); });
        view.stays = items.filter(function (r) { return r.kind === 'stay'; }).length;
        view.shown = items.length;
        view.rows = model.positions.filter(function (q) { return q.kind !== 'phone'; }).map(function (q) { return { kind: 'point', q: q }; }).concat(items);
        return view;
    }

    function positionNote(view) {
        if (!view.total) return '';
        if (!view.summary) return view.total > 30 ? view.total + ' positioner från telefonen. Sammanfatta positionerna ritar en ring per vistelse i stället för en nål per position.' : '';
        var single = view.shown - view.stays;
        return view.total + ' positioner från telefonen visas som ' + view.stays + (view.stays === 1 ? ' vistelse' : ' vistelser') + ' och ' + single + (single === 1 ? ' enskild position' : ' enskilda positioner') +
            '. En vistelse säger var telefonen var vid de registrerade tiderna, inte var den var mellan dem.';
    }

    // "2026-03-02 08:02:11–09:45:00", med datum två gånger när vistelsen går över midnatt.
    function spanText(fmt, from, to) {
        var a = fmt(from), b = fmt(to);
        return a.slice(0, 10) === b.slice(0, 10) ? a + '–' + b.slice(11) : a + ' – ' + b;
    }

    // Nålar med noggrannhetsring för alla punkter. Bildens nål och vistelserna får en bubbla.
    function applyBubbles(mv, pts) {
        var standard = MapCore.defaultBubble({});
        standard.pin = true;
        standard.ring = true;
        standard.leader = false;
        var perPoint = {};
        pts.forEach(function (p) {
            if (p.source === 'Telefonen (routined)' && !p.stay) return;
            var cfg = p.stay ? MapCore.defaultBubble({ note: true }) : MapCore.defaultBubble({ note: true, time: true });
            cfg.pin = true;
            cfg.leader = true;
            cfg.ring = true;
            perPoint[p.id] = cfg;
        });
        mv.setBubbles(standard, perPoint, {});
    }

    function mapTime(ms, fmt) { return ms != null ? { text: fmt(ms), sort: ProvenanceCore.formatUtc(ms).slice(0, 19), zone: '', kind: 'Tid', source: 'harkomst' } : null; }

    // Punkterna i samma form som Positioner använder: bilden som röd nål med sin egen källa,
    // telefonens positioner som egen källa med noggrannhetsring, en vistelse som en ring med
    // ankomst och avfärd.
    function mapPoints(model, fmt, view) {
        var pts = [];
        view.rows.forEach(function (r, i) {
            if (r.kind === 'stay') {
                pts.push({
                    id: i + 1, name: 'Vistelse', path: 'routined', lat: r.lat, lon: r.lon, source: 'Telefonen (routined)',
                    taken: mapTime(r.from, fmt), until: mapTime(r.to, fmt), visit: true, stay: true, accuracy: Math.max(5, Math.round(r.radius)),
                    type: 'Vistelse', device: '', software: '', mime: '',
                    note: fmt(r.from).slice(11, 16) + '–' + fmt(r.to).slice(11, 16) + ', ' + r.count + ' positioner',
                    color: '#bf5af2',
                });
                return;
            }
            var q = r.q;
            // EXIF-positionen ritas bara när den skiljer sig från databasens, annars ligger två nålar på varandra.
            if ((q.kind === 'exif' || q.kind === 'memory') && q.distanceM != null && q.distanceM <= 50) return;
            pts.push({
                id: i + 1, name: q.kind === 'phone' ? 'Telefonen' : model.file.filename, path: q.kind === 'phone' ? 'routined' : q.kind === 'memory' ? 'memories.db' : model.file.filename,
                lat: q.lat, lon: q.lon, source: q.kind === 'phone' ? 'Telefonen (routined)' : q.kind === 'exif' ? 'Bilden enligt EXIF' : q.kind === 'memory' ? 'Bilden enligt Snapchats Memories' : 'Bilden',
                taken: mapTime(q.ms, fmt), until: null, visit: false, accuracy: q.accuracy && q.accuracy > 0 ? q.accuracy : null,
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
        var view = positionView(model);
        $('map-summary').checked = !!state.mapSummary;
        $('map-summary').disabled = !view.total;
        $('map-note').textContent = positionNote(view);
        var mv = ensureMap();
        if (!mv) return;
        var pts = mapPoints(model, fmt, view);
        // Sammanfattat är urvalet redan gjort: varje vistelse och position ritas för sig, utan klungor.
        mv.setClustering(!view.summary);
        applyBubbles(mv, pts);
        mv.setPoints(pts, view.summary ? view.total + ' positioner som ' + pts.length + ' markeringar' : pts.length + (pts.length === 1 ? ' position' : ' positioner'));
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
        var path = function (src) { src = src || {}; return [src.db, src.table, src.column].filter(Boolean).join(' → '); };
        $('positions').innerHTML = '<table><thead><tr><th>Tid (' + escapeHtml(state.meta.zoneLabel) + ')</th><th>Vad</th><th>Latitud</th><th>Longitud</th><th>Noggrannhet</th><th>Från bildens position</th><th>Källa</th></tr></thead><tbody>' +
            positionView(model).rows.map(function (r) {
                if (r.kind === 'stay') {
                    return '<tr class="pos-stay"><td class="num">' + escapeHtml(spanText(fmt, r.from, r.to)) + '</td><td>' + escapeHtml('Vistelse: ' + r.count + ' positioner i följd inom 100 m') + '</td>' +
                        '<td class="num">' + r.lat.toFixed(6) + '</td><td class="num">' + r.lon.toFixed(6) + '</td><td class="num">' + escapeHtml('radie ' + Math.round(r.radius) + ' m') + '</td>' +
                        '<td class="num">' + (r.distanceM != null ? escapeHtml(ProvenanceCore.metres(r.distanceM)) : '') + '</td><td class="path">' + escapeHtml(path(r.source)) + '</td></tr>';
                }
                var q = r.q;
                return '<tr class="' + (q.kind === 'phone' ? (r.keep ? 'pos-keep' : '') : 'pos-file') + '"><td class="num">' + (q.ms != null ? escapeHtml(fmt(q.ms)) : '') + '</td><td>' + escapeHtml(q.label + (r.keep ? ', närmast T' : '')) + '</td>' +
                    '<td class="num">' + q.lat.toFixed(6) + '</td><td class="num">' + q.lon.toFixed(6) + '</td><td class="num">' + (q.accuracy ? Math.round(q.accuracy) + ' m' : '') + '</td>' +
                    '<td class="num">' + (q.distanceM != null ? escapeHtml(ProvenanceCore.metres(q.distanceM)) : '') + '</td><td class="path">' + escapeHtml(path(q.source)) + '</td></tr>';
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

    // Undersökarens ruta och bockar hör till en fil i en extraktion. Samma filnamn i en annan zip,
    // på en annan rad eller på en annan plats i zippen börjar med en tom ruta; samma fil igen
    // (till exempel med en annan tidszon eller ett annat fönster) behåller det som skrivits.
    function assessmentKey(file) {
        var z = state.zip;
        var zip = z ? [z.file.name, z.file.size, z.file.lastModified].join('|') : 'testdata';
        var where = file.pk != null ? 'rad ' + file.pk : (file.directory || file.relativePath || '') + '/' + file.filename;
        return zip + '|' + where;
    }

    // Sparar rutan och bockarna för filen som visas. Texterna finns bara i minnet, men kvar även om
    // zippen stängs och öppnas igen, eftersom nyckeln innehåller zippen.
    function saveExaminer() {
        if (!state.ownFor) return;
        var text = $('own-assessment').value;
        var checked = Object.assign({}, state.checked);
        if (!text.trim() && !Object.keys(checked).length && !state.includePicture) { delete state.examiner[state.ownFor]; return; }
        state.examiner[state.ownFor] = { text: text, checked: checked, includePicture: state.includePicture, filename: state.ownName || '' };
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
        // Undersökarens ruta och bockar hör till filen och finns kvar när filen visas igen.
        var own = assessmentKey(m.file);
        if (state.ownFor !== own) {
            saveExaminer();
            var saved = state.examiner[own] || {};
            $('own-assessment').value = saved.text || '';
            state.checked = Object.assign({}, saved.checked || {});
            state.includePicture = !!saved.includePicture;
            state.ownFor = own;
            state.ownName = m.file.filename;
        }
        renderFileCard();
        $('summary').innerHTML =
            (m.beta ? '<div class="type-line"><span class="badge beta">Beta</span> ' + escapeHtml(ProvenanceReport.BETA_NOTE) + '</div>' : '') +
            '<div class="type-line"><strong>Typ av fil:</strong> ' + escapeHtml(m.type.label) + (m.type.reasons.length ? ' (' + escapeHtml(m.type.reasons.join(', ')) + ')' : '') +
            (m.type.flags.length ? ' · ' + escapeHtml(m.type.flags.join(', ')) : '') + ' · ' + escapeHtml(meta.deviceLabel) + ' · T = ' + escapeHtml(fmt(m.file.createdMs || 0)) + ' (' + escapeHtml(meta.zoneLabel) + ')</div>' +
            '<div class="summary-text"><span class="badge">Programmets sammanvägning</span>' + escapeHtml(m.summary) + '</div>' +
            (m.warnings.length ? '<div class="warnings">' + m.warnings.map(escapeHtml).join('<br>') + '</div>' : '');
        // Faktorns fråga, svaret i faktorns egna ord (färgen är läget) och vad svaret betyder för hypotesen.
        $('factors').innerHTML = m.factors.map(function (f) {
            var at = state.checked[f.id];
            var label = m.stateLabel[f.state] || f.state;
            return '<div class="factor' + (at ? ' checked' : '') + '" data-factor="' + escapeHtml(f.id) + '"><h3>' + escapeHtml(f.title) +
                '<span class="badge ' + escapeHtml(f.state) + '" title="' + escapeHtml(label) + '">' + escapeHtml(f.verdict || label) + '</span>' +
                '<label class="chk" title="Bocka i när du själv har kontrollerat faktorn mot källan och SQL:en. Följer med i protokollet med klockslag."><input type="checkbox" data-factor="' + escapeHtml(f.id) + '"' + (at ? ' checked' : '') + '>Kontrollerad</label></h3>' +
                (f.question ? '<p class="question">' + escapeHtml(f.question) + '</p>' : '') +
                (f.meaning ? '<p class="meaning ' + escapeHtml(f.state) + '">' + escapeHtml(f.meaning) + '</p>' : '') +
                '<ul>' + f.items.map(function (i) { return '<li>' + escapeHtml(i.text) + '</li>'; }).join('') + '</ul><div class="plain">' + escapeHtml(f.plain) + '</div></div>';
        }).join('');
        $('factors').querySelectorAll('input[data-factor]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var id = cb.getAttribute('data-factor');
                if (cb.checked) state.checked[id] = Date.now(); else delete state.checked[id];
                cb.closest('.factor').classList.toggle('checked', cb.checked);
                updateCheckCount();
                saveExaminer();
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
        if (!state.keepScroll) $('result').scrollIntoView({ block: 'start', behavior: 'smooth' });
        // Kartan kan ta en stund (eller ge upp efter 15 s utan kartfiler). Resultatet är redan klart.
        if (/Letar efter kopior|Läser bildfilen|Hämtar registreringar/.test($('run-status').textContent)) setStatus('run-status', '');
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
        state.meta.positionView = positionView(state.model);
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

    // Tidszonen och fönstret gäller hela bedömningen. Byts de medan ett resultat visas görs samma
    // bedömning om, så att tidslinjen, tabellerna och exporterna inte står kvar med de gamla.
    function redoShown() {
        if (isBusy()) { redoPending = true; return; }
        var b = state.batch;
        if (b && b.open < 0 && !$('batch-box').classList.contains('display-none')) {
            // Listan: samma filer med det nya fönstret eller den nya zonen. Valen bland flera träffar följer med.
            runBatch(b.rows.map(function (r) { return r.item; }), b.origin).catch(batchFailed);
            return;
        }
        if (!state.model || !state.redo || $('result').classList.contains('display-none')) return;
        var y = window.scrollY;
        state.keepScroll = true;
        guarded(state.redo).then(function () { state.keepScroll = false; window.scrollTo(0, y); });
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
    $('ex-close').addEventListener('click', function () { closeZip(); announceExtraction(); });
    $('ex-input').addEventListener('change', function () {
        var file = $('ex-input').files && $('ex-input').files[0];
        $('ex-input').value = '';
        if (!file) return;
        openZip(file).then(announceExtraction, zipFailed);
    });
    $('zone').addEventListener('change', function () { zoneTouched = true; });
    $('disk-pick').addEventListener('click', function () { $('disk-input').click(); });
    $('disk-input').addEventListener('change', function () {
        var files = Array.prototype.slice.call($('disk-input').files || []);
        $('disk-input').value = '';
        if (files.length === 1) runDiskFile(files[0]);
        else if (files.length > 1) runBatch(files.map(function (f) { return { kind: 'disk', file: f }; }), 'disk').catch(batchFailed);
    });
    $('run').addEventListener('click', function () { run(); });
    // Enter bedömer, Skift+Enter ger en ny rad för nästa filnamn. Rutan växer med raderna.
    $('filename').addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.shiftKey) return;
        e.preventDefault();
        if (!isBusy()) run();
    });
    $('filename').addEventListener('input', fitNameBox);

    // Listan med flera filer.
    $('batch-stop').addEventListener('click', function () {
        state.hashStop = true;
        if (state.batch) state.batch.stop = true;
        $('batch-stop').disabled = true;
    });
    $('batch-list').addEventListener('click', function (e) {
        var tr = e.target.closest('tr.pick');
        if (tr) openBatchRow(Number(tr.getAttribute('data-i')));
    });
    $('batch-back').addEventListener('click', backToList);
    $('batch-prev').addEventListener('click', function () { var b = state.batch; var i = b ? nextOpenable(b, b.open, -1) : -1; if (i >= 0) openBatchRow(i); });
    $('batch-next').addEventListener('click', function () { var b = state.batch; var i = b ? nextOpenable(b, b.open, 1) : -1; if (i >= 0) openBatchRow(i); });
    $('batch-copy').addEventListener('click', function () { exportBatch(false); });
    $('batch-exif').addEventListener('click', function () { batchToExif().catch(batchFailed); });
    $('batch-save').addEventListener('click', function () { exportBatch(true); });
    $('run-status').addEventListener('click', function (e) {
        if (e.target.id === 'batch-time' && state.timeItems && !isBusy()) runBatch(state.timeItems, 'time').catch(batchFailed);
    });
    $('run-time').addEventListener('click', runTime);
    ['when-date', 'when-time'].forEach(function (id) {
        $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter' && !isBusy()) runTime(); });
        $(id).addEventListener('input', updateWhenNote);
    });
    $('when-date').addEventListener('paste', pasteWhen);
    $('zone').addEventListener('change', updateWhenNote);
    $('window').addEventListener('change', updateWhenNote);
    $('zone').addEventListener('change', redoShown);
    $('window').addEventListener('change', redoShown);
    $('file-card').addEventListener('click', function (e) {
        if (!e.target.closest('#toggle-media')) return;
        state.showMedia = !state.showMedia;
        renderFileCard();
    });
    $('file-card').addEventListener('change', function (e) { if (e.target.id === 'include-picture') { state.includePicture = e.target.checked; saveExaminer(); } });
    $('own-assessment').addEventListener('input', saveExaminer);
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
    // Sammanfatta positionerna: bara kartan och tabellen ritas om, bedömningen är densamma.
    $('map-summary').addEventListener('change', function () {
        state.mapSummary = $('map-summary').checked;
        if (!state.model || !state.meta) return;
        renderPositions(state.model, state.meta.format);
        showMap(state.model, state.meta.format).catch(function (err) { console.warn(err); });
    });
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
        if (data.type === 'extraction') followExtraction({ file: data.file || null, seq: Number(data.seq) || 0, from: data.from || '', force: !!data.force });
        if (data.type === 'deliver-file') handOver(data.to).catch(function (err) { console.warn(err); });
        if (data.type === 'provenance-files') receiveFiles(data.files);
        if (data.type === 'provenance-names' && Array.isArray(data.names)) receiveNames(data.names.map(String), data.zipName || '');
    });

    init();
})();
