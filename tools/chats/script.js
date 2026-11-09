// Chattar: konversationerna i chattapparnas databaser som i appen. Extraktionen är samma som i Härkomst och Queries
// (raden högst upp). Databaserna hittas och läses som i Härkomst, och all SQL kommer ur katalogernas chattroller.
// Bilagorna läses ur extraktionen först när de syns. Inget skrivs till extraktionen.
// En stor chatt läses i omgångar med förlopp och kan avbrytas. Bubblorna ritas i block: bara meddelandena runt det
// som syns finns i sidan, och Sök, Gå till datum, Första och Senaste når resten.
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var inHub = window.parent !== window;
    var VERSION = new URLSearchParams(location.search).get('version') || '';
    var CATALOGS = [window.WHATSAPP_IOS_CATALOG, window.SIGNAL_IOS_CATALOG, window.SIGNAL_ANDROID_CATALOG, window.TELEGRAM_IOS_CATALOG, window.SNAPCHAT_CATALOG, window.SNAPCHAT_ANDROID_CATALOG].filter(Boolean);
    var SOURCES = ChatCore.sources(CATALOGS);
    var TARGETS = ExtractionCore.targets(ChatCore.databases(SOURCES));
    // En bilaga större än så läses först när undersökaren ber om det.
    var MAX_AUTO = 80 * 1024 * 1024;
    // Bilder större än så bäddas inte in i en export.
    var MAX_EMBED = 25 * 1024 * 1024;
    // Bubblorna ritas i block om så många meddelanden, och högst så många finns i sidan samtidigt.
    var BLOCK = 250;
    var MAX_DRAWN = 1500;
    // Så nära kanten (px) ritas nästa block.
    var EDGE = 1500;
    // Fler inlästa bilagor än så släpps när de inte längre finns i sidan, så att minnet inte växer med chatten.
    var MAX_URLS = 300;
    // Exporten varnar över så många meddelanden eller byte, och utskriften över så många sidor.
    var WARN_MESSAGES = 20000;
    var WARN_BYTES = 200 * 1024 * 1024;
    var WARN_PAGES = 300;

    var SQL = null;
    var state = {
        zip: null, dbs: [], keyFiles: [], current: null, zone: 'local', f: ChatCore.formatter('local'), picked: {}, selecting: false,
        urls: {}, entries: {}, checks: {}, attByPath: {}, names: {}, ready: Promise.resolve(), opened: Promise.resolve(),
        opening: null, job: null, exporting: null, view: null, find: null, observer: null,
    };

    function esc(s) { return ChatExport.esc(s); }
    function errText(err) { return err && err.message ? err.message : String(err); }
    function setStatus(id, html, kind) {
        var el = $(id);
        el.innerHTML = html ? (kind ? '<span class="' + kind + '">' + html + '</span>' : html) : '';
    }
    function toHub(msg) {
        if (!inHub) return;
        msg.source = 'forensics-toolbox';
        window.parent.postMessage(msg, '*');
    }
    function toast(text) {
        var t = $('toast');
        t.textContent = text;
        t.classList.add('show');
        clearTimeout(toast.timer);
        toast.timer = setTimeout(function () { t.classList.remove('show'); }, 3200);
    }
    function Z() { return state.zip && state.zip.report ? 'rapporten' : 'zippen'; }
    function fmt() { return state.f; }
    function baseName(name) { return String(name || '').slice(String(name || '').lastIndexOf('/') + 1); }
    // Tal med mellanrum mellan tusentalen, som 100 000.
    function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0'); }
    function many(n, one, more) { return num(n) + ' ' + (n === 1 ? one : more); }
    function secs(ms) { return (ms / 1000).toFixed(1).replace('.', ',') + ' s'; }
    // En paus, så att sidan hinner rita och svara på klick mellan omgångarna.
    function pause() { return new Promise(function (resolve) { setTimeout(resolve, 0); }); }
    function cancelError() { var e = new Error('Avbrutet.'); e.cancelled = true; return e; }

    if (!inHub) document.body.classList.add('standalone');
    $('c-apps').textContent = 'Appar med chattvy just nu: ' + SOURCES.map(function (s) { return s.app + ' (' + s.platform + ')'; }).join(', ') + '.';

    // ---------- Förloppet ----------

    // Ett arbete i steg, visat i el: stegen med det pågåendes förlopp, en stapel, tiden och Avbryt.
    // Rutan visas först efter en kort stund, så att det som går fort inte blinkar förbi.
    function Job(el, title, steps, cancellable) {
        var job = this;
        this.el = el;
        this.title = title;
        this.cancellable = cancellable;
        this.cancelled = false;
        this.shown = false;
        this.ended = false;
        this.t0 = Date.now();
        this.steps = steps.map(function (s) { return { text: s.text, weight: s.weight || 1, note: '', frac: null, state: 'wait', t0: 0, ms: 0 }; });
        el.job = this;
        this.timer = setTimeout(function () { job.show(); }, 250);
        this.clock = setInterval(function () { job.paint(); }, 250);
    }
    Job.prototype.check = function () { if (this.cancelled) throw cancelError(); };
    Job.prototype.cancel = function () { this.cancelled = true; this.paint(); };
    // Steg i pågår, med en anteckning och en andel (0–1) när den är känd. Stegen före är klara eller behövdes inte.
    Job.prototype.go = function (i, note, frac) {
        var now = Date.now();
        this.steps.forEach(function (s, k) {
            if (k >= i) return;
            if (s.state === 'active') { s.state = 'done'; s.ms = now - s.t0; }
            else if (s.state === 'wait') s.state = 'skip';
        });
        var s = this.steps[i];
        if (s.state !== 'active') { s.state = 'active'; s.t0 = now; }
        s.note = note || '';
        s.frac = frac === undefined || frac === null ? null : Math.max(0, Math.min(1, frac));
        this.paint();
    };
    Job.prototype.show = function () {
        if (this.el.job !== this || this.ended) return;
        this.shown = true;
        this.el.innerHTML = '<div class="c-job-box"><div class="c-job-title" role="status"></div><ol class="c-job-steps">' +
            this.steps.map(function () { return '<li><span class="c-job-mark" aria-hidden="true"></span><span class="c-job-text"></span><span class="c-job-note"></span></li>'; }).join('') +
            '</ol><div class="c-job-bar"><span></span></div><div class="c-job-foot"><span class="c-job-time"></span>' +
            (this.cancellable ? '<button type="button" class="c-btn" data-job-cancel>Avbryt</button>' : '') + '</div></div>';
        this.el.querySelector('.c-job-title').textContent = this.title;
        this.el.classList.remove('display-none');
        this.paint();
    };
    Job.prototype.paint = function () {
        if (!this.shown || this.el.job !== this) return;
        var total = 0, done = 0, items = this.el.querySelectorAll('.c-job-steps li');
        this.steps.forEach(function (s, k) {
            total += s.weight;
            if (s.state === 'done' || s.state === 'skip') done += s.weight;
            else if (s.state === 'active') done += s.weight * (s.frac || 0);
            var li = items[k];
            li.className = s.state;
            li.querySelector('.c-job-mark').textContent = s.state === 'done' ? '✓' : s.state === 'skip' ? '–' : '';
            li.querySelector('.c-job-text').textContent = s.text;
            li.querySelector('.c-job-note').textContent = s.state === 'done' ? [s.note, secs(s.ms)].filter(Boolean).join(' · ') : s.state === 'active' ? s.note : s.state === 'skip' ? 'behövs inte' : '';
        });
        this.el.querySelector('.c-job-bar span').style.width = Math.round(100 * done / total) + '%';
        this.el.querySelector('.c-job-time').textContent = (this.cancelled ? 'Avbryter… ' : '') + secs(Date.now() - this.t0);
        var b = this.el.querySelector('[data-job-cancel]');
        if (b) b.disabled = this.cancelled;
    };
    Job.prototype.finish = function () {
        this.ended = true;
        clearTimeout(this.timer);
        clearInterval(this.clock);
        if (this.el.job === this) {
            this.el.job = null;
            this.el.classList.add('display-none');
            this.el.innerHTML = '';
        }
    };

    document.addEventListener('click', function (e) {
        var b = e.target.closest('[data-job-cancel]');
        var box = b ? b.closest('.c-job') : null;
        if (box && box.job) box.job.cancel();
    });

    // Raden under extraktionen medan den öppnas: vad som läses, stapeln och tiden. Avbryt finns när databaserna läses.
    function progress(o, text, frac, stoppable) {
        if (state.opening !== o || o.done) return;
        var known = frac !== null && frac !== undefined;
        $('ex-progress').classList.remove('display-none');
        $('ex-progress').classList.toggle('unknown', !known);
        $('ex-progress-text').textContent = text;
        $('ex-progress-fill').style.width = known ? Math.round(100 * Math.max(0, Math.min(1, frac))) + '%' : '';
        var stop = $('ex-stop');
        stop.classList.toggle('display-none', !stoppable);
        stop.disabled = o.cancelled;
        stop.textContent = o.cancelled ? 'Stannar efter den här databasen…' : 'Avbryt';
    }

    $('ex-stop').addEventListener('click', function () {
        var o = state.opening;
        if (!o || o.done) return;
        o.cancelled = true;
        this.disabled = true;
        this.textContent = 'Stannar efter den här databasen…';
    });

    // ---------- Extraktionen ----------

    async function loadSql() {
        if (SQL) return SQL;
        if (window.toolboxWasmProblem()) throw new Error(window.toolboxWasmProblem());
        SQL = await initSqlJs({ wasmBinary: window.SQL_WASM_BINARY });
        return SQL;
    }

    function sameFile(a, b) { return !!a && !!b && a.name === b.name && a.size === b.size && a.lastModified === b.lastModified; }

    // Öppningar görs i tur och ordning, så att den sista gäller. En ny öppning ber den förra stanna efter databasen
    // den läser. state.opened blir klar när databaserna i den nya extraktionen är kända.
    function openZip(file) {
        if (state.opening && !state.opening.done) state.opening.cancelled = true;
        var opened;
        state.opened = new Promise(function (resolve) { opened = resolve; });
        var p = state.ready.then(function () { return openZipNow(file, opened); });
        state.ready = p.catch(function (err) { closeZip(); setStatus('ex-status', esc(errText(err)), 'err'); }).then(function () { opened(); });
        return p;
    }

    function closeZip() {
        if (state.job) state.job.cancel();
        state.dbs.forEach(function (d) { if (d.loaded && d.loaded.sqlDb) d.loaded.sqlDb.close(); });
        state.dbs = [];
        state.zip = null;
        closeThread();
        $('bar-zip').textContent = 'Ingen öppen';
        renderList();
    }

    async function openZipNow(file, opened) {
        closeZip();
        setStatus('ex-status', '');
        if (!file) { opened(); return; }
        var o = { file: file, t0: Date.now(), cancelled: false, done: false };
        state.opening = o;
        o.clock = setInterval(function () { if (state.opening === o && !o.done) $('ex-progress-time').textContent = secs(Date.now() - o.t0); }, 250);
        $('ex-progress-time').textContent = '';
        renderList();
        try {
            progress(o, 'Läser ' + file.name + '…', null);
            var source = await ExtractionCore.openSource(file, {
                onReport: function (done, total) { progress(o, 'Läser rapportens förteckning över filerna (report.xml)… ' + Math.round(100 * done / total) + ' %', done / total); },
                onTimes: function () { progress(o, 'Läser filernas tider (metadata.msgpack)…', null); },
            });
            var report = source.report;
            var cache = report ? null : await ZipRead.cacheDirectory(source.read, file.size, null, function (done, total) {
                progress(o, 'Läser zippens innehållsförteckning… ' + Math.round(100 * done / total) + ' %', done / total);
            });
            var read = report ? source.read : cache.read;
            progress(o, 'Letar efter chattapparnas databaser…', null);
            var found = await ExtractionCore.open(read, file.size, TARGETS, null);
            state.zip = {
                file: file, read: read, report: report, found: found.found, secrets: [], keySearch: null,
                line: (report ? 'Rapport (UFDR): ' : 'Extraktion: ') + file.name + ' (' + file.size + ' byte, ändrad ' + new Date(file.lastModified).toISOString() + ')',
            };
            $('bar-zip').textContent = file.name;
            if (found.found.some(function (f) { var s = sourceOf(f.key); return s && s.cipher; })) {
                progress(o, 'Letar efter nyckelfilen…', null);
                try {
                    state.zip.keySearch = await ExtractionCore.findKeys(read, file.size, { report: report, file: file });
                    state.zip.secrets = state.zip.keySearch.secrets;
                } catch (e) { console.warn('Nyckelfilen kunde inte läsas', e); }
            }
            var zip = state.zip;
            var all = found.found.map(function (hit) {
                return { hit: hit, src: sourceOf(hit.key), zip: zip, loaded: null, threads: [], members: {}, error: null, state: 'wait', note: '', loading: null };
            }).filter(function (d) { return d.src; });
            state.dbs = all.filter(function (d) { return !d.src.namesOnly; });
            state.names = {};
            // Listan visar databaserna direkt, och var och en fylls i när den är läst.
            renderList();
            opened();
            // Namnen först (Snapchats kontodatabas), så att de finns när konversationerna läses.
            var names = all.filter(function (d) { return d.src.namesOnly; });
            for (var n = 0; n < names.length; n++) {
                progress(o, 'Läser namnen i ' + names[n].src.app + ' (' + baseName(names[n].hit.db.name) + ')…', null);
                await loadNames(names[n]);
            }
            if (!state.dbs.length) {
                setStatus('ex-status', esc(file.name) + ': ingen databas för ' + esc(SOURCES.map(function (s) { return s.app; }).filter(function (a, i, l) { return l.indexOf(a) === i; }).join(', ')) + ' hittades i ' + Z() + '.');
                return;
            }
            for (var i = 0; i < state.dbs.length; i++) await loadInTurn(o, i);
        } finally {
            o.done = true;
            clearInterval(o.clock);
            if (state.opening === o) $('ex-progress').classList.add('display-none');
            renderList();
            summary();
        }
    }

    // Databas i av alla när extraktionen öppnas. En avbruten öppning lämnar resten olästa, med Läs in i listan.
    async function loadInTurn(o, i) {
        var d = state.dbs[i], total = state.dbs.length;
        if (d.state !== 'wait') { if (d.loading) await d.loading; return; }
        if (o.cancelled) { d.state = 'skipped'; renderList(); return; }
        var label = 'Databas ' + (i + 1) + ' av ' + total + ': ' + d.src.app + ' (' + baseName(d.hit.db.name) + ')';
        // Stapeln visar databaserna som är klara och dekrypteringen. Utan andel och med en enda databas glider den.
        var at = function (frac) { return frac === null || frac === undefined ? (total > 1 ? i / total : null) : (i + frac) / total; };
        progress(o, label, at(null), true);
        await loadThreads(d, function (note, frac) { progress(o, label + ' — ' + note, at(frac), true); });
        renderList();
    }

    // Raden överst när extraktionen är läst: konversationerna, databaserna som inte lästes in och felen.
    function summary() {
        if (!state.zip || !state.dbs.length || (state.opening && !state.opening.done)) return;
        var ok = state.dbs.filter(function (d) { return d.state === 'ready'; });
        var skipped = state.dbs.filter(function (d) { return d.state === 'skipped'; }).length;
        var count = ok.reduce(function (n, d) { return n + d.threads.length; }, 0);
        setStatus('ex-status', esc(state.zip.file.name) + ': ' + many(count, 'konversation', 'konversationer') + ' i ' + many(ok.length, 'databas', 'databaser') + '.' +
            (skipped ? ' ' + many(skipped, 'databas', 'databaser') + ' lästes inte in; välj Läs in i listan.' : '') +
            state.dbs.filter(function (d) { return d.error; }).map(function (d) { return ' <span class="warn">' + esc(d.src.app + ': ' + d.error) + '</span>'; }).join(''));
    }

    function sourceOf(key) { return SOURCES.find(function (s) { return s.key === key; }) || null; }

    // ---------- Nycklar (Signal) ----------

    function chosenKeys() {
        var open = state.zip ? state.zip.file : null;
        return state.keyFiles.filter(function (k) { return !k.forFile || !open || sameFile(k.forFile, open); });
    }

    function cipherFor(src) {
        if (!src.cipher) return null;
        var keys = AppSecrets.keysForProfile(chosenKeys().concat((state.zip && state.zip.secrets) || []), src.cipher);
        return { profile: src.cipher, passphrase: keys ? keys.dbKey : null, modernKey: keys ? keys.modernKey : null, source: keys ? keys.source : null };
    }

    async function useKeyFiles(files, forFile) {
        var parsed = [];
        for (var i = 0; i < files.length; i++) {
            var one;
            try { one = await ExtractionCore.readKeyFile(new Uint8Array(await files[i].arrayBuffer()), files[i].name); }
            catch (e) { one = { source: files[i].name, apps: {}, error: 'Filen kunde inte läsas: ' + e.message }; }
            one.forFile = forFile || null;
            parsed.push(one);
        }
        state.keyFiles = parsed;
        // Krypterade databaser som inte gick att öppna försöker igen med de nya nycklarna. De som väntar på sin
        // tur läses med dem ändå.
        var retry = state.dbs.filter(function (d) { return d.src.cipher && !d.loaded; });
        for (var j = 0; j < retry.length; j++) {
            if (retry[j].loading) await retry[j].loading;
            if (retry[j].state === 'error') await loadThreads(retry[j]);
        }
        if (retry.length) { renderList(); summary(); }
    }

    // ---------- Databaserna ----------

    // onNote(text, andel): vad som händer medan databasen läses, för listan och raden överst.
    async function loadDb(d, onNote) {
        if (d.loaded) return d.loaded;
        var note = onNote || function () {};
        await loadSql();
        var cipher = cipherFor(d.src);
        if (cipher && !cipher.passphrase) {
            throw new Error(AppSecrets.missingKeyText({ profile: cipher.profile, word: Z(), search: state.zip.keySearch }));
        }
        var label = d.src.app + ' (' + baseName(d.hit.db.name) + ')';
        note('läser filen' + (d.hit.db.size ? ' (' + ChatCore.sizeText(d.hit.db.size) + ')' : '') + '…', null);
        var loaded = await ExtractionCore.loadDatabase(state.zip.read, d.hit, [state.zip.line], cipher ? { cipher: cipher, onProgress: function (done, total) {
            note('dekrypterar… ' + Math.round(100 * done / total) + ' %', done / total);
        } } : undefined);
        loaded.keySource = cipher ? cipher.source : null;
        loaded.modernKey = cipher ? cipher.modernKey : null;
        try { loaded.sqlDb = new SQL.Database(ExtractionCore.noCopy(loaded.bytes)); }
        catch (err) { throw ZipRead.friendlyMemory(err, label, loaded.bytes.length); }
        loaded.bytes = null;
        // Extraktionen byttes medan filen lästes: databasen hör inte till någon längre.
        if (d.zip !== state.zip) { loaded.sqlDb.close(); throw cancelError(); }
        if (d.src.derive && window.TelegramPostbox) {
            note('avkodar Telegrams meddelanden…', null);
            await pause();
            try { loaded.derived = window.TelegramPostbox.attach(loaded.sqlDb); }
            catch (e) { loaded.warnings.push(label + ': Telegrams format kunde inte avkodas: ' + e.message); }
        }
        d.loaded = loaded;
        return loaded;
    }

    function friendlySql(err, q) {
        var msg = errText(err);
        if (/no such (column|table)/i.test(msg)) return new Error('Databasen saknar en tabell eller kolumn som ' + q.id + ' använder (' + msg + '). Den är troligen från en annan appversion än katalogen är skriven för.');
        return err;
    }

    // En roll med få rader (konversationerna, deltagarna, namnen), läst på en gång.
    function query(loaded, q, values) {
        var all;
        try { all = loaded.sqlDb.exec(Roles().fill(q.sql, values || {})); }
        catch (err) { throw friendlySql(err, q); }
        return all.length ? all[all.length - 1] : { columns: [], values: [] };
    }

    // En roll med många rader (meddelandena, bilagorna), läst i omgångar med en paus emellan. onCount(rader hittills).
    async function queryInSlices(loaded, q, values, job, onCount) {
        try {
            return await ChatCore.readRows(loaded.sqlDb, Roles().fill(q.sql, values || {}), {
                onSlice: async function (n) { onCount(n); await pause(); job.check(); },
            });
        } catch (err) { throw friendlySql(err, q); }
    }

    function Roles() { return window.ProvenanceRoles; }

    // Namnen ur en databas med chat-names, per app. En databas som inte går att läsa ger inga namn, och chattarna visar id:n.
    async function loadNames(d) {
        try {
            var loaded = await loadDb(d);
            var map = ChatCore.names(d.src, query(loaded, d.src.roles.names), window.ProvenanceSnapchat ? window.ProvenanceSnapchat.friendNames : null);
            state.names[d.src.app] = Object.assign(state.names[d.src.app] || {}, map);
            loaded.sqlDb.close();
        } catch (err) { console.warn('Namnen kunde inte läsas ur ' + d.hit.db.name, err); }
    }

    // Konversationerna i en databas. Listan visar databasens läge medan den läses. onNote som i loadDb.
    function loadThreads(d, onNote) {
        if (d.loading) return d.loading;
        d.state = 'busy';
        d.error = null;
        dbNote(d, 'Läser…');
        d.loading = (async function () {
            try {
                var loaded = await loadDb(d, function (note, frac) { dbNote(d, note.charAt(0).toUpperCase() + note.slice(1)); if (onNote) onNote(note, frac); });
                dbNote(d, 'Läser konversationerna…');
                if (onNote) onNote('läser konversationerna…', null);
                await pause();
                d.threads = ChatCore.threads(d.src, query(loaded, d.src.roles.threads));
                d.members = d.src.roles.members ? ChatCore.members(d.src, query(loaded, d.src.roles.members)) : {};
                ChatCore.applyNames(d.src, d.threads, d.members, state.names[d.src.app]);
                d.state = 'ready';
            } catch (err) {
                d.error = errText(err);
                d.state = 'error';
            } finally {
                d.loading = null;
            }
        })();
        return d.loading;
    }

    // ---------- Listan med konversationer ----------

    function dbStateHtml(d, di) {
        if (d.state === 'busy') return '<span class="c-spin" aria-hidden="true"></span>' + esc(d.note || 'Läser…');
        if (d.state === 'skipped') return 'Inte inläst. <button type="button" class="link-btn" data-load="' + di + '">Läs in</button>';
        return 'Väntar på sin tur…';
    }

    // Databasens rad i listan medan den läses.
    function dbNote(d, note) {
        d.note = note;
        var di = state.dbs.indexOf(d);
        var el = di >= 0 ? $('c-list').querySelector('[data-state-for="' + di + '"]') : null;
        if (el) el.innerHTML = dbStateHtml(d, di);
    }

    function renderList() {
        var q = $('c-search').value.trim().toLowerCase();
        var f = fmt();
        var html = state.dbs.map(function (d, di) {
            var head = '<div class="c-group">' + esc(d.src.app + (d.src.platform ? ' · ' + d.src.platform : '')) + '<small title="' + esc(d.hit.db.name) + '">' + esc(d.hit.db.name) + '</small></div>';
            if (d.error) return head + '<div class="c-list-empty warn">' + esc(d.error) + '</div>';
            if (d.state !== 'ready') return head + '<div class="c-list-empty c-db-state" data-state-for="' + di + '">' + dbStateHtml(d, di) + '</div>';
            var items = d.threads.filter(function (t) {
                return !q || (t.name + ' ' + t.address).toLowerCase().indexOf(q) >= 0;
            }).map(function (t) {
                var cur = state.current && state.current.db === d && state.current.thread.key === t.key;
                var sub = [t.messages !== null ? many(t.messages, 'meddelande', 'meddelanden') : '', t.lastMs ? 'senast ' + f(t.lastMs).slice(0, 10) : ''].filter(Boolean).join(' · ');
                return '<button type="button" class="c-item" data-db="' + di + '" data-thread="' + esc(t.key) + '"' + (cur ? ' aria-current="true"' : '') + ' title="' + esc(t.address || t.name) + '">' +
                    '<span class="c-item-name"><span>' + esc(t.name) + '</span><span class="c-kind">' + esc(t.kindText) + '</span></span>' +
                    '<span class="c-item-sub">' + esc(sub) + '</span></button>';
            }).join('');
            return head + (items || '<div class="c-list-empty">' + (q ? 'Ingen konversation matchar sökningen.' : 'Inga konversationer.') + '</div>');
        }).join('');
        var opening = state.opening && !state.opening.done;
        $('c-list').innerHTML = html || '<div class="c-list-empty">' + (state.zip ? (opening ? 'Letar efter chattdatabaser…' : 'Inga chattdatabaser i ' + Z() + '.') : opening ? 'Läser extraktionen…' : 'Ingen extraktion öppen.') + '</div>';
    }

    $('c-search').addEventListener('input', renderList);
    $('c-list').addEventListener('click', function (e) {
        var load = e.target.closest('[data-load]');
        if (load) {
            var skipped = state.dbs[Number(load.dataset.load)];
            if (skipped) loadThreads(skipped).then(function () { renderList(); summary(); });
            renderList();
            return;
        }
        var b = e.target.closest('.c-item');
        if (!b) return;
        var d = state.dbs[Number(b.dataset.db)];
        if (d) openThread(d, b.dataset.thread).catch(showError);
    });

    function showError(err) { setStatus('ex-status', esc(errText(err)), 'err'); }

    // ---------- En konversation ----------

    function closeThread() {
        // En export av konversationen som stängs avbryts, och rutan stängs.
        if (state.exporting) state.exporting.cancel();
        $('c-export').classList.add('display-none');
        Object.keys(state.urls).forEach(function (k) { URL.revokeObjectURL(state.urls[k]); });
        state.urls = {};
        state.entries = {};
        state.checks = {};
        state.attByPath = {};
        state.current = null;
        state.picked = {};
        state.view = null;
        state.find = null;
        if (state.observer) { state.observer.disconnect(); state.observer = null; }
        $('c-find').value = '';
        $('c-date').value = '';
        $('c-from').value = '';
        $('c-to').value = '';
        findCount();
        $('c-view').classList.add('display-none');
        $('c-empty').classList.remove('display-none');
        closePop();
    }

    // Läser konversationen i omgångar med förlopp och visar den först när allt är klart: ett avbrott lämnar det som
    // visades. focus: meddelandets key, som visas och blinkar.
    async function openThread(d, key, focus) {
        var thread = d.threads.find(function (t) { return t.key === String(key); });
        if (!thread) throw new Error('Konversationen ' + key + ' finns inte i ' + d.hit.db.name + '.');
        if (state.job) state.job.cancel();
        var job = new Job($('c-busy'), 'Öppnar ' + thread.name + ' · ' + d.src.app, [
            { text: 'Meddelandena', weight: 6 }, { text: 'Bilagorna', weight: 1 }, { text: 'Konversationen', weight: 2 },
            { text: 'Filerna i ' + Z(), weight: 1 }, { text: 'Bubblorna', weight: 1 },
        ], true);
        state.job = job;
        $('c-msgs').setAttribute('aria-busy', 'true');
        try {
            var loaded = await loadDb(d);
            var values = { threadId: thread.id };
            var expected = thread.messages;
            var counted = function (n) { return num(n) + (expected ? ' av ' + num(Math.max(expected, n)) : ' rader'); };
            job.go(0, expected ? counted(0) : '', expected ? 0 : null);
            var msgRes = await queryInSlices(loaded, d.src.roles.messages, values, job, function (n) { job.go(0, counted(n), expected ? n / Math.max(expected, n) : null); });
            job.go(0, many(msgRes.values.length, 'rad', 'rader'), 1);
            var attRes = null;
            if (d.src.roles.attachments) {
                job.go(1, '');
                attRes = await queryInSlices(loaded, d.src.roles.attachments, values, job, function (n) { job.go(1, many(n, 'rad', 'rader')); });
                job.go(1, many(attRes.values.length, 'rad', 'rader'), 1);
            }
            job.go(2, '');
            await pause();
            job.check();
            var model = ChatCore.conversation(d.src, thread, msgRes, attRes, d.members[thread.key] || [], d.hit.db.name, { names: state.names[d.src.app] });
            msgRes = attRes = null;
            job.go(2, many(model.messages.length, 'meddelande', 'meddelanden'), 1);
            var found = await findEntries(model, job);
            job.go(4, '');
            await pause();
            job.check();
            closeThread();
            var byKey = {};
            model.messages.forEach(function (m, i) { if (byKey[m.key] === undefined) byKey[m.key] = i; });
            state.current = { db: d, thread: thread, model: model, loaded: loaded, values: values, byKey: byKey, days: [], search: null };
            state.entries = found.entries;
            state.attByPath = found.byPath;
            $('c-empty').classList.add('display-none');
            $('c-view').classList.remove('display-none');
            renderHead();
            dateLimits();
            var at = focus === null || focus === undefined ? undefined : byKey[String(focus)];
            if (at !== undefined) showAt(at, 'center', true);
            else showAt(model.messages.length - 1, 'end');
            renderList();
        } catch (err) {
            if (err && err.cancelled) return;
            throw err;
        } finally {
            job.finish();
            if (state.job === job) { state.job = null; $('c-msgs').removeAttribute('aria-busy'); }
        }
    }

    // Bilagornas poster i extraktionen, efter sökvägen som rollen gav, och bilagan för varje sökväg.
    async function findEntries(model, job) {
        var wanted = {}, byPath = {}, entries = {}, count = 0;
        model.messages.forEach(function (m) {
            m.attachments.forEach(function (a) {
                [a.entry, a.thumbEntry].forEach(function (p) { if (p) { wanted[p] = true; wanted[p.replace(/^\/+/, '')] = true; count++; } });
                if (a.entry && !byPath[a.entry]) byPath[a.entry] = a;
            });
        });
        if (!count) return { entries: entries, byPath: byPath };
        job.go(3, many(count, 'sökväg', 'sökvägar'));
        var hits = await ExtractionCore.find(state.zip.read, state.zip.file.size, function (name) { return wanted[name] === true || wanted[name.replace(/^\/+/, '')] === true; },
            function (done, total) { job.go(3, many(count, 'sökväg', 'sökvägar'), done / total); });
        job.check();
        hits.forEach(function (e) { entries[e.name] = e; entries[e.name.replace(/^\/+/, '')] = e; });
        job.go(3, many(hits.length, 'fil hittad', 'filer hittade'), 1);
        return { entries: entries, byPath: byPath };
    }

    function entryOf(path) { return path ? state.entries[path] || state.entries[path.replace(/^\/+/, '')] || null : null; }

    function messageAt(key) {
        var i = state.current ? state.current.byKey[key] : undefined;
        return i === undefined ? null : state.current.model.messages[i];
    }

    function renderHead() {
        var c = state.current, m = c.model, t = c.thread, f = fmt();
        $('c-eyebrow').textContent = c.db.src.app + (c.db.src.platform ? ' · ' + c.db.src.platform : '') + ' · ' + baseName(c.db.hit.db.name);
        $('c-title').textContent = t.name;
        $('c-sub').textContent = [t.kindText, t.address && t.address !== t.name ? t.address : '', many(m.messages.length, 'meddelande', 'meddelanden'),
            m.firstMs !== null ? f(m.firstMs) + ' – ' + f(m.lastMs) : ''].filter(Boolean).join(' · ');
        $('c-msgs').dataset.app = c.db.src.app;
        var people = m.members;
        $('c-people-toggle').textContent = 'Deltagare (' + (people.length + 1) + ')';
        $('c-people').innerHTML = '<ul>' + people.map(function (p) {
            return '<li>' + esc(p.name) + (p.address && p.address !== p.name ? ' <span>' + esc(p.address) + '</span>' : '') + (p.admin ? ' <span>(administratör)</span>' : '') + (p.active === false ? ' <span>(har lämnat)</span>' : '') + (p.note ? ' <span>(' + esc(p.note) + ')</span>' : '') + '</li>';
        }).join('') + '<li>Den här telefonen <span>(extraktionens konto)</span></li></ul>' +
            (people.length ? '' : '<p class="muted">Databasen har inga fler deltagare för den här konversationen.</p>');
        var notes = [];
        if (!c.db.hit.wal) notes.push('Databasen har ingen -wal i ' + Z() + ', så de senaste ändringarna kan saknas.');
        (c.loaded.warnings || []).forEach(function (w) { notes.push(w); });
        var missing = 0;
        m.messages.forEach(function (msg) { msg.attachments.forEach(function (a) { if (a.entry && !entryOf(a.entry) && !(a.thumbEntry && entryOf(a.thumbEntry))) missing++; }); });
        if (missing) notes.push(many(missing, 'bilaga', 'bilagor') + ' finns i databasen men inte i ' + Z() + '.');
        $('c-note').classList.toggle('display-none', !notes.length);
        $('c-note').textContent = notes.join(' ');
        updateSelectBar();
    }

    $('c-people-toggle').addEventListener('click', function () {
        var open = $('c-people').classList.toggle('display-none') === false;
        this.setAttribute('aria-expanded', String(open));
    });

    var CLOCK = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.2V8l2.6 1.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

    // Texten med sökningens träffar märkta.
    function marked(value) {
        var q = state.find && state.find.q;
        if (!q) return esc(value);
        return ChatCore.marks(value, q).map(function (p) { return p.hit ? '<mark>' + esc(p.text) + '</mark>' : esc(p.text); }).join('');
    }

    // Märket under en bilaga: dekrypterad och om SHA-256 stämmer med databasen. Utan dekryptering och utan summa i
    // databasen finns inget att säga under filen; summan står i klockans ruta.
    function checkText(path) {
        var ch = state.checks[path];
        if (!ch || ch.ok === null && !ch.decrypted) return '';
        return (ch.decrypted ? 'Dekrypterad. ' : '') + (ch.ok === true ? 'SHA-256 stämmer med databasen.' : ch.ok === false ? 'SHA-256 stämmer inte med databasen.' : 'Databasen har ingen SHA-256 att jämföra med.');
    }

    function attachmentHtml(m, a, i) {
        var id = esc(m.key + ':' + i);
        var name = a.name || baseName(a.entry);
        if (a.kind === 'contact') {
            return '<div class="att att-file">Kontaktkort: <b>' + marked(a.cardName) + '</b>' + (a.card ? '<pre>' + esc(a.card) + '</pre>' : '') + '</div>';
        }
        if (a.kind === 'location') return '<div class="att att-file">Plats: ' + esc(a.lat) + ', ' + esc(a.lon) + '</div>';
        if (!a.entry) return '<div class="att att-missing">' + esc(ChatCore.KIND_TEXT[a.kind] || 'Fil') + (a.size ? ' (' + esc(ChatCore.sizeText(a.size)) + ')' : '') + ': databasen har ingen sökväg till filen.</div>';
        var e = entryOf(a.entry), shown = a.entry, smaller = false;
        // Appen kan spara flera storlekar. Saknas den största visas en mindre, märkt så.
        if (!e && a.thumbEntry && entryOf(a.thumbEntry)) { e = entryOf(a.thumbEntry); shown = a.thumbEntry; smaller = true; }
        if (!e) return '<div class="att att-missing" title="' + esc(a.entry) + '">' + esc(ChatCore.KIND_TEXT[a.kind] || 'Fil') + ' ' + esc(name) + ' finns inte i ' + Z() + '.</div>';
        var info = [name, a.mime, ChatCore.durationText(a.duration), ChatCore.sizeText(e.size)].filter(Boolean).join(' · ');
        var ch = state.checks[shown];
        var below = (a.title ? '<div class="att-cap">' + marked(a.title) + '</div>' : '') + (smaller ? '<div class="att-check">Bara en mindre version finns i ' + Z() + '.</div>' : '') +
            '<div class="att-check' + (ch && ch.ok === false ? ' bad' : '') + '" data-for="' + esc(shown) + '">' + esc(checkText(shown)) + '</div>';
        // En fil som redan är läst visas direkt när blocket ritas om.
        var src = state.urls[shown] ? ' src="' + esc(state.urls[shown]) + '"' : '';
        if (a.kind === 'image' || a.kind === 'sticker' || a.kind === 'gif' && /^image\//.test(a.mime)) {
            return '<div class="att"><button type="button" class="att-img" data-att="' + id + '" title="' + esc(info) + '"><img data-entry="' + esc(shown) + '" data-mime="' + esc(a.mime) + '"' + src + ' alt="' + esc(name) + '"></button>' + below + '</div>';
        }
        if (a.kind === 'video' || a.kind === 'gif') return '<div class="att"><video controls preload="metadata" data-entry="' + esc(shown) + '" data-mime="' + esc(a.mime) + '"' + src + ' title="' + esc(info) + '"></video>' + below + '</div>';
        if (a.kind === 'audio' || a.kind === 'voice') return '<div class="att"><audio controls preload="metadata" data-entry="' + esc(shown) + '" data-mime="' + esc(a.mime) + '"' + src + ' title="' + esc(info) + '"></audio>' + below + '</div>';
        return '<div class="att att-file">' + marked(info) + (a.sha256 ? '<small>SHA-256 ' + esc(a.sha256) + '</small>' : '') + ' <button type="button" class="link-btn" data-save="' + esc(shown) + '" data-name="' + esc(name) + '">Spara filen</button>' + below + '</div>';
    }

    function messageHtml(m, i) {
        var model = state.current.model, f = fmt();
        var sys = m.kind === 'system' || m.kind === 'call';
        var hit = state.find && state.find.hits.length && state.find.hits[state.find.pos] === i;
        var cls = 'm' + (sys ? ' sys' : m.fromMe ? ' me' : '') + (state.picked[m.key] ? ' picked' : '') + (hit ? ' hit' : '');
        var who = model.group && !m.fromMe && !sys ? '<div class="who">' + esc(ChatCore.senderText(m)) + '</div>' : '';
        var reply = m.reply ? '<div class="reply"><b>' + esc(m.reply.from || 'Svar') + '</b>' + esc(m.reply.text || (m.reply.found ? '' : 'Meddelandet finns inte i databasen')) + '</div>' : '';
        var atts = m.attachments.map(function (a, k) { return attachmentHtml(m, a, k); }).join('');
        var text = m.text ? '<div class="t">' + marked(m.text) + '</div>' : !m.attachments.length ? '<div class="t kind">' + esc(m.kindLabel) + '</div>' : '';
        var flags = [m.viewOnce ? 'engångsvisning' : '', m.deleted ? 'raderat' : '', m.edited, m.expiresIn ? 'försvinner ' + m.expiresIn + ' s' : '']
            .filter(Boolean).map(function (x) { return '<span class="flag">' + esc(x) + '</span>'; }).join('');
        var time = m.sortMs !== null ? f(m.sortMs).slice(11, 16) : '–';
        return '<div class="' + cls + '" data-i="' + i + '" data-key="' + esc(m.key) + '"><label class="m-check"><input type="checkbox" aria-label="Välj meddelandet"' + (state.picked[m.key] ? ' checked' : '') + '></label>' +
            '<div class="b">' + who + reply + atts + text +
            '<div class="foot">' + flags + '<time title="' + esc(m.sortLabel + ' ' + (m.sortMs !== null ? f(m.sortMs) : 'saknas')) + '">' + esc(time) + '</time>' +
            '<button type="button" class="clock" data-clock="' + esc(m.key) + '" aria-label="Tider och källa för meddelandet" title="' + esc('Tider och källa' + (m.device ? ' · ' + m.device : '')) + '">' + CLOCK + '</button></div></div></div>';
    }

    // ---------- Blocken i sidan ----------

    // Dagen för meddelande i i vald zon, sparad tills zonen byts.
    function dayOf(i) {
        var c = state.current;
        if (c.days[i] === undefined) {
            var ms = c.model.messages[i].sortMs;
            c.days[i] = ms !== null ? fmt()(ms).slice(0, 10) : 'Utan tid';
        }
        return c.days[i];
    }
    function newDay(i) { return i === 0 || dayOf(i) !== dayOf(i - 1); }
    // Datumet över ett meddelande. top: det första i sidan, som alltid får sitt datum även mitt på en dag.
    function sepHtml(i, top) { return '<div class="c-day' + (top ? ' c-day-top' : '') + '" data-i="' + i + '"><span>' + esc(dayOf(i)) + '</span></div>'; }

    // Meddelandena from–to (to ej med) som HTML. top: from är det första i sidan.
    function rangeHtml(from, to, top) {
        var out = [], list = state.current.model.messages;
        for (var i = from; i < to; i++) {
            if (newDay(i)) out.push(sepHtml(i, false));
            else if (i === from && top) out.push(sepHtml(i, true));
            out.push(messageHtml(list[i], i));
        }
        return out.join('');
    }

    function msgEl(i) { return $('c-msgs').querySelector('.m[data-i="' + i + '"]'); }

    // Sidan med meddelandena from–to.
    function draw(from, to) {
        var box = $('c-msgs'), n = state.current.model.messages.length;
        if (state.observer) state.observer.disconnect();
        state.view = { from: from, to: to };
        box.innerHTML = n ? rangeHtml(from, to, true) : '<p class="muted c-none">Konversationen har inga meddelanden.</p>';
        box.classList.toggle('selecting', state.selecting);
        watchMedia();
    }

    // Visar meddelande i med block runt sig. where: 'end' (sist i chatten), 'start' (överst, med datumet) eller
    // 'center'. flash: meddelandet blinkar.
    function showAt(i, where, flash) {
        var n = state.current.model.messages.length;
        if (!n) { draw(0, 0); return; }
        i = Math.max(0, Math.min(n - 1, i));
        var from = Math.max(0, i - BLOCK), to = Math.min(n, i + BLOCK + 1);
        if (from === 0) to = Math.min(n, Math.max(to, 2 * BLOCK));
        if (to === n) from = Math.max(0, Math.min(from, n - 2 * BLOCK));
        draw(from, to);
        var box = $('c-msgs'), el = msgEl(i);
        if (where === 'end') box.scrollTop = box.scrollHeight;
        // Datumen sitter fast överst när de rullas förbi och säger då inte var de står, så läget räknas från
        // meddelandet, med plats för datumet ovanför.
        else if (where === 'start') box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 44;
        else centerOn(el);
        if (flash) flashAt(i);
        requestAnimationFrame(fill);
    }

    function centerOn(el) {
        var box = $('c-msgs');
        box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - Math.max(0, (box.clientHeight - el.offsetHeight) / 2);
    }

    function flashAt(i) {
        var el = msgEl(i);
        if (!el) return;
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
    }

    // Det första meddelandet som syns och dess läge, så att sidan kan ritas om utan att hoppa.
    function anchor() {
        var box = $('c-msgs'), top = box.getBoundingClientRect().top;
        var list = box.querySelectorAll('.m');
        for (var k = 0; k < list.length; k++) {
            var r = list[k].getBoundingClientRect();
            if (r.bottom > top) return { i: Number(list[k].dataset.i), top: r.top - top };
        }
        return null;
    }

    // Ritar om det som finns i sidan (ny zon, sökning, urval) med samma meddelande på samma plats.
    function redraw() {
        if (!state.current || !state.view) return;
        var box = $('c-msgs'), a = anchor();
        draw(state.view.from, state.view.to);
        var el = a ? msgEl(a.i) : null;
        if (el) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - a.top;
    }

    // Nästa block ritas när kanten närmar sig, och block långt bort tas bort, så att sidan aldrig har fler än MAX_DRAWN.
    var filling = false;
    $('c-msgs').addEventListener('scroll', function () {
        if (filling || !state.view) return;
        filling = true;
        requestAnimationFrame(function () { filling = false; fill(); });
    }, { passive: true });

    function fill() {
        if (!state.current || !state.view) return;
        var box = $('c-msgs'), v = state.view, n = state.current.model.messages.length;
        if (box.scrollTop < EDGE && v.from > 0) prepend();
        else if (box.scrollHeight - box.scrollTop - box.clientHeight < EDGE && v.to < n) append();
    }

    // Webbläsaren håller själv det som syns på plats när något ändras ovanför (scroll anchoring), till exempel när
    // en bild laddas. Står läget inte där det ska efter ett nytt eller borttaget block ovanför, flyttas det här.
    function keepPlace(box, st, grown) {
        if (!grown) return;
        var want = st + grown;
        if (Math.abs(box.scrollTop - want) > 1) box.scrollTop = want;
    }

    function prepend() {
        var box = $('c-msgs'), v = state.view;
        var from = Math.max(0, v.from - BLOCK);
        var h = box.scrollHeight, st = box.scrollTop;
        // Det som var först i sidan har ett eget datum bara om dagen börjar där.
        var top = box.querySelector('.c-day-top');
        if (top) top.remove();
        box.insertAdjacentHTML('afterbegin', rangeHtml(from, v.from, true));
        v.from = from;
        keepPlace(box, st, box.scrollHeight - h);
        watchMedia();
        if (v.to - v.from > MAX_DRAWN) trimEnd();
    }

    function append() {
        var box = $('c-msgs'), v = state.view, n = state.current.model.messages.length;
        var to = Math.min(n, v.to + BLOCK);
        box.insertAdjacentHTML('beforeend', rangeHtml(v.to, to, false));
        v.to = to;
        watchMedia();
        if (v.to - v.from > MAX_DRAWN) trimStart();
    }

    function trimStart() {
        var box = $('c-msgs'), v = state.view;
        var cut = v.to - MAX_DRAWN;
        var h = box.scrollHeight, st = box.scrollTop;
        var el = box.firstElementChild;
        while (el && Number(el.dataset.i) < cut) { var next = el.nextElementSibling; unwatch(el); el.remove(); el = next; }
        if (!newDay(cut)) box.insertAdjacentHTML('afterbegin', sepHtml(cut, true));
        v.from = cut;
        keepPlace(box, st, box.scrollHeight - h);
        pruneUrls();
    }

    function trimEnd() {
        var box = $('c-msgs'), v = state.view;
        var cut = v.from + MAX_DRAWN;
        var el = box.lastElementChild;
        while (el && Number(el.dataset.i) >= cut) { var prev = el.previousElementSibling; unwatch(el); el.remove(); el = prev; }
        v.to = cut;
        pruneUrls();
    }

    function cssEscape(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'); }

    // ---------- Sök och gå till ----------

    function findCount() {
        var s = state.find;
        $('c-find-count').textContent = !s ? '' : s.hits.length ? num(s.pos + 1) + ' av ' + num(s.hits.length) : 'Inga träffar';
        $('c-find-prev').disabled = $('c-find-next').disabled = !s || s.hits.length < 1;
    }

    // Sökningen i hela konversationen, inte bara i sidan. Den första träffen är den första från det som syns.
    function runFind() {
        var c = state.current;
        if (!c) return;
        var q = $('c-find').value.trim();
        if (!q) { state.find = null; findCount(); redraw(); return; }
        if (!c.search) c.search = ChatCore.searchIndex(c.model.messages);
        var hits = ChatCore.findAll(c.search, q);
        var a = anchor(), from = a ? a.i : 0, pos = -1;
        for (var k = 0; k < hits.length; k++) if (hits[k] >= from) { pos = k; break; }
        if (pos < 0) pos = hits.length - 1;
        state.find = { q: q, hits: hits, pos: Math.max(0, pos) };
        findCount();
        if (hits.length) showAt(hits[state.find.pos], 'center', true);
        else redraw();
    }

    // Föregående (-1) eller nästa (1) träff, runt till början efter den sista.
    function stepHit(d) {
        var s = state.find;
        if (!s || !s.hits.length) return;
        s.pos = (s.pos + d + s.hits.length) % s.hits.length;
        findCount();
        var i = s.hits[s.pos], v = state.view;
        if (i >= v.from && i < v.to) {
            $('c-msgs').querySelectorAll('.m.hit').forEach(function (el) { el.classList.remove('hit'); });
            msgEl(i).classList.add('hit');
            centerOn(msgEl(i));
            flashAt(i);
        } else showAt(i, 'center', true);
    }

    var findTimer = null;
    $('c-find').addEventListener('input', function () { clearTimeout(findTimer); findTimer = setTimeout(runFind, 200); });
    $('c-find').addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        clearTimeout(findTimer);
        if (!state.find || state.find.q !== this.value.trim()) runFind();
        else stepHit(e.shiftKey ? -1 : 1);
    });
    $('c-find-prev').addEventListener('click', function () { stepHit(-1); });
    $('c-find-next').addEventListener('click', function () { stepHit(1); });

    // Datumväljaren går från konversationens första till sista dag i vald zon.
    function dateLimits() {
        var m = state.current.model, f = fmt(), d = $('c-date');
        d.min = m.firstMs !== null ? f(m.firstMs).slice(0, 10) : '';
        d.max = m.lastMs !== null ? f(m.lastMs).slice(0, 10) : '';
    }

    // Första meddelandet den dagen i vald zon, eller närmast efter.
    function goDate(value) {
        var c = state.current;
        if (!c || !value) return;
        var ms = ChatCore.parseLocal(value + ' 00:00', state.zone);
        if (ms === null) return;
        var i = ChatCore.atOrAfter(c.model.messages, ms);
        if (i < 0) {
            toast('Inga meddelanden från ' + value + ' och framåt. Det sista visas.');
            showAt(c.model.messages.length - 1, 'end');
            return;
        }
        if (dayOf(i) !== value) toast('Inga meddelanden ' + value + '. Närmast efter: ' + dayOf(i) + '.');
        showAt(i, 'start');
    }

    $('c-date').addEventListener('change', function () { goDate(this.value); });
    $('c-first').addEventListener('click', function () { if (state.current) showAt(0, 'start'); });
    $('c-last').addEventListener('click', function () { if (state.current) showAt(state.current.model.messages.length - 1, 'end'); });
    $('c-msgs').addEventListener('keydown', function (e) {
        if (!state.current || e.target !== this) return;
        if (e.key === 'Home') { e.preventDefault(); showAt(0, 'start'); }
        if (e.key === 'End') { e.preventDefault(); showAt(state.current.model.messages.length - 1, 'end'); }
    });

    // ---------- Bilagorna ----------

    function watchMedia() {
        var els = $('c-msgs').querySelectorAll('[data-entry]:not([data-seen])');
        els.forEach(function (el) { el.dataset.seen = '1'; });
        if (!('IntersectionObserver' in window)) { els.forEach(function (el) { loadMedia(el); }); return; }
        if (!state.observer) {
            state.observer = new IntersectionObserver(function (list) {
                list.forEach(function (it) { if (it.isIntersecting) { state.observer.unobserve(it.target); loadMedia(it.target); } });
            }, { root: $('c-msgs'), rootMargin: '400px 0px' });
        }
        els.forEach(function (el) { state.observer.observe(el); });
    }

    function unwatch(el) {
        if (!state.observer || !el.querySelectorAll) return;
        el.querySelectorAll('[data-entry]').forEach(function (x) { state.observer.unobserve(x); });
    }

    // Läsa filer släpps när många är inlästa och de inte längre finns i sidan eller förstoringen.
    function pruneUrls() {
        var keys = Object.keys(state.urls);
        if (keys.length <= MAX_URLS) return;
        var used = {};
        $('c-msgs').querySelectorAll('[data-entry]').forEach(function (el) { used[el.dataset.entry] = true; });
        var it = lightbox.list[lightbox.i];
        if (it && !$('c-lightbox').classList.contains('display-none')) used[it.path] = true;
        keys.forEach(function (k) { if (!used[k]) { URL.revokeObjectURL(state.urls[k]); delete state.urls[k]; } });
    }

    // Filen som appen ser den: läst ur extraktionen, dekrypterad när rollen säger det, och SHA-256 kontrollerad mot databasen.
    async function mediaBytes(path) {
        var e = entryOf(path);
        if (!e) throw new Error('Filen finns inte i ' + Z() + '.');
        var c = state.current, checks = state.checks;
        var r = await ExtractionCore.readEntry(state.zip.read, e);
        var a = state.attByPath[path] || {};
        var decrypt = c.db.src.roles.attachments ? c.db.src.roles.attachments.decrypt : null;
        var bytes = await ChatMedia.open(decrypt, r.bytes, a, { modernKey: c.loaded.modernKey });
        if (!checks[path]) {
            checks[path] = await ChatMedia.check(bytes, a);
            checks[path].decrypted = !!decrypt;
            if (state.current === c) markCheck(path);
        }
        return { bytes: bytes, attachment: a };
    }

    async function mediaUrl(path, mime) {
        if (state.urls[path]) return state.urls[path];
        var c = state.current;
        var got = await mediaBytes(path);
        if (state.current !== c) throw cancelError();
        if (!state.urls[path]) state.urls[path] = URL.createObjectURL(new Blob([got.bytes], { type: mime || got.attachment.mime || 'application/octet-stream' }));
        return state.urls[path];
    }

    function markCheck(path) {
        var ch = state.checks[path];
        if (!ch) return;
        $('c-msgs').querySelectorAll('.att-check[data-for="' + cssEscape(path) + '"]').forEach(function (el) {
            el.textContent = checkText(path);
            el.classList.toggle('bad', ch.ok === false);
        });
    }

    async function loadMedia(el, force) {
        var path = el.dataset.entry;
        var e = entryOf(path);
        if (!e) return;
        if (e.size > MAX_AUTO && !force) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'link-btn';
            b.textContent = 'Läs in ' + ChatCore.sizeText(e.size);
            b.addEventListener('click', function () { b.remove(); loadMedia(el, true); });
            el.parentNode.appendChild(b);
            return;
        }
        var cur = state.current;
        try {
            var url = await mediaUrl(path, el.dataset.mime);
            if (state.current !== cur) return;
            if (el.getAttribute('src') !== url) el.src = url;
        } catch (err) {
            if (err && err.cancelled) return;
            var note = document.createElement('div');
            note.className = 'att-missing';
            note.textContent = 'Filen kunde inte läsas: ' + errText(err);
            el.parentNode.appendChild(note);
        }
    }

    // Bilderna i konversationen i ordning, för bläddring i förstoringen.
    function images() {
        var out = [];
        state.current.model.messages.forEach(function (m) {
            m.attachments.forEach(function (a, i) {
                var p = entryOf(a.entry) ? a.entry : a.thumbEntry && entryOf(a.thumbEntry) ? a.thumbEntry : null;
                if ((a.kind === 'image' || a.kind === 'sticker') && p) out.push({ ref: m.key + ':' + i, m: m, a: a, path: p });
            });
        });
        return out;
    }

    var lightbox = { list: [], i: 0 };
    async function showImage(i) {
        var it = lightbox.list[i];
        if (!it) return;
        lightbox.i = i;
        $('c-lb-img').src = await mediaUrl(it.path, it.a.mime);
        $('c-lb-img').alt = it.a.name || baseName(it.a.entry);
        $('c-lb-cap').textContent = ChatCore.senderText(it.m) + ' · ' + (it.m.sortMs !== null ? fmt()(it.m.sortMs) : '') + ' · ' + it.path + (it.a.sha256 ? ' · SHA-256 ' + it.a.sha256 : '');
        $('c-lb-prev').disabled = i === 0;
        $('c-lb-next').disabled = i === lightbox.list.length - 1;
    }
    function openLightbox(ref) {
        lightbox.list = images();
        var i = lightbox.list.findIndex(function (x) { return x.ref === ref; });
        if (i < 0) return;
        $('c-lightbox').classList.remove('display-none');
        showImage(i).catch(showError);
        $('c-lb-close').focus();
    }
    function closeLightbox() { $('c-lightbox').classList.add('display-none'); $('c-lb-img').removeAttribute('src'); }
    $('c-lb-close').addEventListener('click', closeLightbox);
    $('c-lb-prev').addEventListener('click', function () { showImage(lightbox.i - 1).catch(showError); });
    $('c-lb-next').addEventListener('click', function () { showImage(lightbox.i + 1).catch(showError); });
    $('c-lightbox').addEventListener('click', function (e) { if (e.target === this) closeLightbox(); });

    // ---------- Tiderna för ett meddelande ----------

    function closePop() { $('c-pop').classList.add('display-none'); $('c-pop').innerHTML = ''; }

    function openPop(key, anchorEl) {
        var m = messageAt(key);
        if (!m) return;
        var f = fmt(), zone = ChatCore.zoneName(state.zone);
        var rows = m.times.map(function (t) {
            var when = t.ms !== null && t.ms !== undefined ? esc(f(t.ms)) + ' <small>' + esc(new Date(t.ms).toISOString()) + ' (UTC)</small>' : 'saknas';
            return '<tr><th>' + esc(t.label) + '</th><td>' + when + '<small>' + esc(t.note) + ' Rått värde: ' + esc(t.raw === null || t.raw === undefined ? 'NULL' : t.raw) + '.</small></td></tr>';
        });
        rows.push('<tr><th>Avsändare</th><td>' + esc(ChatCore.senderText(m)) + (m.senderId && m.senderId !== m.senderName ? '<small>' + esc(m.senderId) + '</small>' : '') + '</td></tr>');
        if (m.device) rows.push('<tr><th>Enhet</th><td>' + esc(m.device) + '</td></tr>');
        rows.push('<tr><th>Typ</th><td>' + esc(m.kindLabel) + '</td></tr>');
        m.details.forEach(function (d) { rows.push('<tr><th>' + esc(d.label) + '</th><td>' + esc(d.value) + '</td></tr>'); });
        m.attachments.forEach(function (a) {
            if (!a.entry && !a.sha256) return;
            var ch = a.entry ? state.checks[a.entry] : null;
            rows.push('<tr><th>Bilaga</th><td>' + esc(a.entry || '(ingen fil)') + (a.sha256 ? '<small>SHA-256 ' + esc(a.sha256) + ' (enligt databasen)</small>' : '') +
                (ch ? '<small>' + esc((ch.decrypted ? 'Dekrypterad. ' : '') + 'SHA-256 för innehållet: ' + ch.hash + (ch.ok === true ? ', stämmer.' : ch.ok === false ? ', stämmer inte.' : '.')) + '</small>' : '') + '</td></tr>');
        });
        var pop = $('c-pop');
        pop.innerHTML = '<h3>Meddelande ' + esc(m.id) + '</h3><p><small>Tiderna i ' + esc(zone) + (m.sortMs !== null ? ' (UTC' + esc(ChatCore.offsetText(state.zone, m.sortMs)) + ')' : '') + ' och i UTC.</small></p>' +
            '<table>' + rows.join('') + '</table>' +
            '<div class="c-pop-actions">' + (inHub ? '<button type="button" class="link-btn" data-pop="queries">Visa raden i Queries</button>' : '') +
            '<button type="button" class="link-btn" data-pop="close">Stäng</button></div>';
        pop.dataset.key = key;
        pop.classList.remove('display-none');
        var r = anchorEl.getBoundingClientRect();
        var w = pop.offsetWidth, h = pop.offsetHeight;
        pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
        pop.style.top = (r.top - h - 6 > 8 ? r.top - h - 6 : Math.min(window.innerHeight - h - 8, r.bottom + 6)) + 'px';
    }

    $('c-pop').addEventListener('click', function (e) {
        var b = e.target.closest('[data-pop]');
        if (!b) return;
        if (b.dataset.pop === 'queries') openInQueries(this.dataset.key);
        closePop();
    });

    // Raden i Queries: rollens SQL med chattens id ifyllt, och meddelandet markerat på sin tid och sitt id.
    function openInQueries(key) {
        var c = state.current;
        var m = messageAt(key);
        if (!m || !state.zip) return;
        var q = c.db.src.roles.messages;
        var sort = m.times.find(function (t) { return t.ms === m.sortMs; });
        toHub({
            type: 'open-query', file: state.zip.file, path: c.loaded.gz ? null : c.loaded.dbEntry.name, walPath: c.loaded.walEntry ? c.loaded.walEntry.name : null,
            queryId: q.id, title: q.title + ': ' + c.thread.name, db: c.db.src.label, sql: Roles().fill(q.sql, c.values), from: 'Chattar',
            timeColumns: sort ? [{ col: sort.col, epoch: sort.epoch }] : null,
            mark: { ms: m.sortMs !== null ? [m.sortMs] : [], values: [String(m.id)], text: 'Meddelande ' + m.id, time: m.sortMs !== null ? fmt()(m.sortMs) : '' },
        });
    }

    // ---------- Klick i konversationen ----------

    $('c-msgs').addEventListener('click', function (e) {
        var clock = e.target.closest('.clock');
        if (clock) { e.stopPropagation(); openPop(clock.dataset.clock, clock); return; }
        var save = e.target.closest('[data-save]');
        if (save) { saveFile(save.dataset.save, save.dataset.name).catch(showError); return; }
        var img = e.target.closest('.att-img');
        if (img && !state.selecting) { openLightbox(img.dataset.att); return; }
        if (state.selecting) {
            var m = e.target.closest('.m');
            if (!m || e.target.closest('video, audio')) return;
            // Ett klick på etiketten blir också ett klick på kryssrutan; det räknas där.
            if (e.target.closest('.m-check') && !e.target.matches('input')) return;
            togglePick(m.dataset.key, m);
            if (e.target.matches('input[type="checkbox"]')) return;
            e.preventDefault();
        }
    });

    async function saveFile(path, name) {
        var url = await mediaUrl(path, 'application/octet-stream');
        var a = document.createElement('a');
        a.href = url;
        a.download = name || baseName(path);
        a.click();
    }

    document.addEventListener('click', function (e) {
        if (!$('c-pop').classList.contains('display-none') && !e.target.closest('#c-pop') && !e.target.closest('.clock')) closePop();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            if (!$('c-lightbox').classList.contains('display-none')) closeLightbox();
            else if (!$('c-export').classList.contains('display-none')) closeExport();
            else closePop();
        }
        if (!$('c-lightbox').classList.contains('display-none')) {
            if (e.key === 'ArrowLeft' && lightbox.i > 0) showImage(lightbox.i - 1).catch(showError);
            if (e.key === 'ArrowRight' && lightbox.i < lightbox.list.length - 1) showImage(lightbox.i + 1).catch(showError);
        }
        // Cmd+F eller Ctrl+F söker i den öppna konversationen.
        if ((e.metaKey || e.ctrlKey) && !e.altKey && String(e.key).toLowerCase() === 'f' && state.current) {
            e.preventDefault();
            $('c-find').focus();
            $('c-find').select();
        }
    });

    // ---------- Urval ----------

    function togglePick(key, el) {
        if (state.picked[key]) delete state.picked[key];
        else state.picked[key] = true;
        el.classList.toggle('picked', !!state.picked[key]);
        var box = el.querySelector('input[type="checkbox"]');
        if (box) box.checked = !!state.picked[key];
        updateSelectBar();
    }

    function pickedKeys() {
        if (!state.current) return [];
        return state.current.model.messages.filter(function (m) { return state.picked[m.key]; }).map(function (m) { return m.key; });
    }

    function updateSelectBar() {
        var n = pickedKeys().length;
        $('c-select-count').textContent = many(n, 'valt meddelande', 'valda meddelanden');
        $('c-select-bar').classList.toggle('display-none', !state.selecting);
        $('c-select-toggle').setAttribute('aria-pressed', String(state.selecting));
    }

    $('c-select-toggle').addEventListener('click', function () {
        state.selecting = !state.selecting;
        $('c-msgs').classList.toggle('selecting', state.selecting);
        updateSelectBar();
    });
    $('c-select-all').addEventListener('click', function () {
        state.current.model.messages.forEach(function (m) { state.picked[m.key] = true; });
        redraw();
        updateSelectBar();
    });
    $('c-select-none').addEventListener('click', function () {
        state.picked = {};
        redraw();
        updateSelectBar();
    });

    // ---------- Tidszonen ----------

    (function zones() {
        var sel = $('c-zone');
        sel.innerHTML = '<option value="local">' + esc('Datorns zon (' + ChatCore.zoneName('local') + ')') + '</option><option value="UTC">UTC</option>';
        sel.addEventListener('change', function () {
            state.zone = sel.value;
            state.f = ChatCore.formatter(state.zone);
            if (state.current) {
                state.current.days = [];
                renderHead();
                dateLimits();
                redraw();
            }
            renderList();
        });
    })();

    // ---------- Export ----------

    // 'html' eller 'print' när varningen för ett stort urval är visad: nästa klick på samma knapp bygger ändå.
    var confirmed = null;

    function resetConfirm() {
        confirmed = null;
        $('c-export-html').textContent = 'Spara HTML';
        $('c-export-print').textContent = 'Skriv ut / PDF…';
    }

    function openExport() {
        var c = state.current;
        if (!c) return;
        var n = pickedKeys().length, f = fmt();
        $('c-scope-all').textContent = 'Hela konversationen (' + num(c.model.messages.length) + ')';
        $('c-scope-picked').textContent = 'Valda meddelanden (' + num(n) + ')';
        document.querySelector('input[name="c-scope"][value="picked"]').disabled = !n;
        document.querySelector('input[name="c-scope"][value="' + (n ? 'picked' : 'all') + '"]').checked = true;
        if (!$('c-from').value && c.model.firstMs !== null) $('c-from').value = f(c.model.firstMs);
        if (!$('c-to').value && c.model.lastMs !== null) $('c-to').value = f(c.model.lastMs);
        $('c-range-zone').textContent = 'i ' + ChatCore.zoneName(state.zone);
        resetConfirm();
        setStatus('c-export-status', '');
        estimateLine();
        $('c-export').classList.remove('display-none');
    }

    // Under en export avbryter Avbryt och Esc den, annars stängs rutan.
    function closeExport() {
        if (state.exporting) { state.exporting.cancel(); return; }
        $('c-export').classList.add('display-none');
    }

    var estimateTimer = null;
    function urvalChanged() {
        if (state.exporting) return;
        resetConfirm();
        setStatus('c-export-status', '');
        clearTimeout(estimateTimer);
        estimateTimer = setTimeout(estimateLine, 150);
    }

    $('c-export-open').addEventListener('click', openExport);
    $('c-export-cancel').addEventListener('click', closeExport);
    $('c-export-scope').addEventListener('change', urvalChanged);
    $('c-export-scope').addEventListener('input', urvalChanged);
    $('c-from').addEventListener('focus', function () { document.querySelector('input[name="c-scope"][value="range"]').checked = true; urvalChanged(); });
    $('c-to').addEventListener('focus', function () { document.querySelector('input[name="c-scope"][value="range"]').checked = true; urvalChanged(); });

    // Urvalet och texten om det, eller ett fel att visa.
    function selection() {
        var c = state.current, f = fmt();
        var scope = document.querySelector('input[name="c-scope"]:checked').value;
        if (scope === 'picked') {
            var keys = pickedKeys();
            return { list: ChatCore.pick(c.model.messages, { ids: keys }), text: many(keys.length, 'valt meddelande', 'valda meddelanden') };
        }
        if (scope === 'range') {
            var from = ChatCore.parseLocal($('c-from').value, state.zone), to = ChatCore.parseLocal($('c-to').value, state.zone);
            if (from === null || to === null) return { error: 'Skriv tiderna som ÅÅÅÅ-MM-DD TT:MM, med sekunder om du vill.' };
            if (to < from) return { error: 'Tiden Till är före Från.' };
            // En tid utan sekunder tar med hela minuten.
            if (!/:\d{2}:\d{2}\s*$/.test($('c-to').value)) to += 59999;
            else to += 999;
            return { list: ChatCore.pick(c.model.messages, { fromMs: from, toMs: to }), text: 'Tidsspann ' + f(from) + ' – ' + f(to) + ' (' + ChatCore.zoneName(state.zone) + ')' };
        }
        return { list: c.model.messages.slice(), text: 'Hela konversationen' };
    }

    // Bilderna i urvalet: filen i extraktionen (eller en mindre version) och storleken. count och bytes gäller
    // bilderna som bäddas in.
    function imagesOf(list) {
        var out = [], count = 0, bytes = 0;
        list.forEach(function (m) {
            m.attachments.forEach(function (a) {
                if (!((a.kind === 'image' || a.kind === 'sticker') && a.entry)) return;
                var p = entryOf(a.entry) ? a.entry : a.thumbEntry && entryOf(a.thumbEntry) ? a.thumbEntry : null;
                var size = p ? entryOf(p).size : 0;
                out.push({ a: a, path: p, size: size });
                if (p && size <= MAX_EMBED) { count++; bytes += size; }
            });
        });
        return { list: out, count: count, bytes: bytes };
    }

    // Raden om hur stor exporten blir, som följer urvalet.
    function estimateLine() {
        var el = $('c-export-estimate');
        if (!state.current) { el.textContent = ''; return; }
        var sel = selection();
        if (sel.error || !sel.list.length) { el.textContent = ''; return; }
        var imgs = imagesOf(sel.list), est = ChatExport.estimate(sel.list, imgs.count, imgs.bytes);
        el.textContent = 'Urvalet: ' + many(est.messages, 'meddelande', 'meddelanden') + (imgs.count ? ' och ' + many(imgs.count, 'bild', 'bilder') + ' (' + ChatCore.sizeText(imgs.bytes) + ')' : '') +
            '. Filen blir omkring ' + ChatCore.sizeText(est.bytes) + ', och en utskrift omkring ' + many(est.pages, 'sida', 'sidor') + '.';
    }

    function exportWarning(kind, est) {
        var what = many(est.messages, 'meddelande', 'meddelanden') + (est.images ? ' och ' + many(est.images, 'bild', 'bilder') : '');
        if (kind === 'print' && est.pages > WARN_PAGES) {
            return 'Urvalet har ' + what + ' och blir omkring ' + many(est.pages, 'sida', 'sidor') + ' utskrivet. Det tar lång tid och kan bli för stort för utskriftsdialogen. Välj gärna ett tidsspann eller några meddelanden, eller spara som HTML. Klicka Skriv ut ändå för att fortsätta.';
        }
        if (kind === 'html' && (est.messages > WARN_MESSAGES || est.bytes > WARN_BYTES)) {
            return 'Urvalet har ' + what + ', och filen blir omkring ' + ChatCore.sizeText(est.bytes) + '. Den tar en stund att bygga och kan bli tung att öppna. Välj gärna ett tidsspann eller några meddelanden. Klicka Spara ändå för att fortsätta.';
        }
        return '';
    }

    function blobToDataUrl(blob) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () { resolve(r.result); };
            r.onerror = function () { reject(r.error); };
            r.readAsDataURL(blob);
        });
    }

    function exportBusy(on) {
        $('c-export-html').disabled = on;
        $('c-export-print').disabled = on;
        $('c-export-scope').disabled = on;
    }

    // Exporten i delar med förlopp i rutan. kind: 'html' eller 'print'. Ger delarna, eller null när inget ska sparas.
    async function buildExport(kind) {
        var c = state.current;
        var sel = selection();
        if (sel.error) { setStatus('c-export-status', esc(sel.error), 'warn'); return null; }
        if (!sel.list.length) { setStatus('c-export-status', 'Inga meddelanden i urvalet.', 'warn'); return null; }
        var imgs = imagesOf(sel.list);
        var warn = exportWarning(kind, ChatExport.estimate(sel.list, imgs.count, imgs.bytes));
        if (warn && confirmed !== kind) {
            resetConfirm();
            confirmed = kind;
            $(kind === 'print' ? 'c-export-print' : 'c-export-html').textContent = kind === 'print' ? 'Skriv ut ändå' : 'Spara ändå';
            setStatus('c-export-status', esc(warn), 'warn');
            return null;
        }
        resetConfirm();
        setStatus('c-export-status', '');
        // Rutans egen Avbryt (och Esc) avbryter exporten.
        var job = new Job($('c-export-progress'), kind === 'print' ? 'Utskriften byggs' : 'HTML-filen byggs', [
            { text: 'Bilderna', weight: 3 }, { text: 'Meddelandena', weight: 2 }, { text: 'Spårbarheten', weight: 2 },
        ], false);
        state.exporting = job;
        exportBusy(true);
        try {
            var media = {}, list = imgs.list, n = list.length;
            for (var i = 0; i < n; i++) {
                var it = list[i];
                job.go(0, num(i + 1) + ' av ' + num(n), i / n);
                if (!it.path) { media[it.a.entry] = { missing: true }; continue; }
                if (it.size > MAX_EMBED) continue;
                var got = await mediaBytes(it.path);
                job.check();
                media[it.a.entry] = { dataUrl: await blobToDataUrl(new Blob([got.bytes], { type: it.a.mime || 'image/jpeg' })), smaller: it.path !== it.a.entry };
            }
            sel.list.forEach(function (m) { m.attachments.forEach(function (a) { if (a.entry && !entryOf(a.entry) && !media[a.entry]) media[a.entry] = { missing: true }; }); });
            return await ChatExport.parts({
                model: c.model, messages: sel.list, zone: state.zone, selection: sel.text, media: media,
                meta: { tool: 'Forensics Toolbox', version: VERSION, extraction: state.zip.line, dbPath: c.db.hit.db.name, dbLabel: c.db.src.label, keySource: c.loaded.keySource, exportedMs: Date.now() },
            }, async function (stage, done, total) {
                job.go(stage === 'trace' ? 2 : 1, num(done) + ' av ' + num(total), done / total);
                await pause();
                job.check();
            });
        } finally {
            job.finish();
            state.exporting = null;
            exportBusy(false);
        }
    }

    function exportFailed(err) {
        if (err && err.cancelled) { setStatus('c-export-status', 'Exporten avbröts.'); return; }
        setStatus('c-export-status', esc(errText(err)), 'err');
    }

    $('c-export-html').addEventListener('click', function () {
        buildExport('html').then(function (parts) {
            if (!parts) return;
            var a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob(parts, { type: 'text/html' }));
            a.download = ChatExport.fileName(state.current.model, 'html');
            a.click();
            // En stor fil tar en stund att skriva; adressen släpps först efter en minut.
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
            closeExport();
            toast('HTML-filen sparades: ' + a.download);
        }).catch(exportFailed);
    });

    // Utskriften går genom en dold ram med samma HTML. I utskriftsdialogen kan den sparas som PDF.
    $('c-export-print').addEventListener('click', function () {
        buildExport('print').then(function (parts) {
            if (!parts) return;
            var frame = $('c-print');
            frame.onload = function () {
                frame.onload = null;
                try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { showError(e); }
            };
            frame.srcdoc = parts.join('');
            closeExport();
        }).catch(exportFailed);
    });

    // ---------- Navet ----------

    var shared = { seq: 0, file: null };

    function followExtraction(msg) {
        if (!(msg.seq > shared.seq)) return;
        shared.seq = msg.seq;
        var cur = state.zip ? state.zip.file : null;
        if (msg.file ? sameFile(cur, msg.file) : !cur) return;
        openZip(msg.file || null);
    }

    // Från Queries: öppna chatten och visa meddelandet. path: databasens sökväg i extraktionen. Väntar bara på den
    // databasen, inte på resten av extraktionen.
    async function openChat(msg) {
        await state.opened;
        if (!state.zip) { setStatus('ex-status', 'Öppna extraktionen i raden högst upp, så visas chatten här.', 'warn'); return; }
        if (msg.zipName && msg.zipName !== state.zip.file.name) {
            setStatus('ex-status', esc('Raden kommer från ' + msg.zipName + ', men Chattar har ' + state.zip.file.name + ' öppen.'), 'warn');
            return;
        }
        var d = state.dbs.find(function (x) { return x.hit.db.name === msg.path; }) || state.dbs.find(function (x) { return x.src.key === msg.db; });
        if (!d) { setStatus('ex-status', esc('Databasen ' + (msg.path || msg.db) + ' finns inte bland chattdatabaserna i ' + Z() + '.'), 'warn'); return; }
        if (d.state !== 'ready' && d.state !== 'error') { await loadThreads(d); renderList(); }
        if (d.error) { setStatus('ex-status', esc(d.error), 'warn'); return; }
        await openThread(d, String(msg.thread), msg.message === null || msg.message === undefined ? null : String(msg.message));
    }

    window.addEventListener('message', function (event) {
        if (event.source !== window.parent || event.source === window) return;
        var data = event.data;
        if (!data || data.source !== 'forensics-toolbox') return;
        if (data.type === 'extraction') followExtraction(data);
        if (data.type === 'extraction-keys') useKeyFiles(Array.isArray(data.files) ? data.files : [], data.file || null).catch(showError);
        if (data.type === 'open-chat') openChat(data).catch(showError);
    });

    // Fristående: en egen knapp för extraktionen.
    $('open-pick').addEventListener('click', function () { $('open-input').click(); });
    $('open-input').addEventListener('change', function () {
        var picked = Array.from(this.files || []);
        this.value = '';
        var keys = picked.filter(function (f) { return /\.plist$|\.json$|keystore/i.test(f.name); });
        var zip = picked.find(function (f) { return keys.indexOf(f) < 0; });
        if (keys.length) useKeyFiles(keys, zip || null).catch(showError);
        if (zip) openZip(zip);
    });

    findCount();
    renderList();

    // För testerna och mätningarna.
    window.ChatsApp = {
        busy: function () { return !!state.job || !!state.exporting || !!(state.opening && !state.opening.done); },
        ready: function () { return state.ready; },
        state: function () { return state; },
        view: function () { return state.current && state.view ? { from: state.view.from, to: state.view.to, n: state.current.model.messages.length, drawn: $('c-msgs').querySelectorAll('.m').length } : null; },
    };
})();
