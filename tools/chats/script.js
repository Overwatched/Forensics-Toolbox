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
    // Telefonen i sidopanelen öppnar samma sida med ?view=phone: bara telefonen, utan listan med konversationer.
    var PHONE_TOOL = new URLSearchParams(location.search).get('view') === 'phone';
    var CATALOGS = [window.WHATSAPP_IOS_CATALOG, window.WHATSAPP_ANDROID_CATALOG, window.SIGNAL_IOS_CATALOG, window.SIGNAL_ANDROID_CATALOG, window.TELEGRAM_IOS_CATALOG, window.TELEGRAM_ANDROID_CATALOG, window.SNAPCHAT_CATALOG, window.SNAPCHAT_ANDROID_CATALOG, window.COMMS_CATALOG].filter(Boolean);
    var SOURCES = ChatCore.sources(CATALOGS);
    // Samtalen och kontakterna (queries/comms): hittas med chattdatabaserna och läses före dem, så att kontakternas
    // namn finns när konversationerna läses.
    var COMM_SOURCES = window.Comms ? Comms.sources(window.COMMS_CATALOG) : [];
    // Webbhistoriken (queries/web): Safari, Chrome och Samsung Internet, läst efter samtalen.
    var WEB_SOURCES = window.Web ? Web.sources(window.WEB_CATALOG) : [];
    var TARGETS = ExtractionCore.targets(ChatCore.databases(SOURCES).concat(window.Comms ? Comms.databases(COMM_SOURCES) : []).concat(window.Web ? Web.databases(WEB_SOURCES) : []));
    // En bilaga större än så läses först när undersökaren ber om det.
    var MAX_AUTO = 80 * 1024 * 1024;
    // Bilder större än så bäddas inte in i en export.
    var MAX_EMBED = 25 * 1024 * 1024;
    // Bubblorna ritas i block om så många meddelanden, och högst så många finns i sidan samtidigt.
    var BLOCK = 250;
    var MAX_DRAWN = 1500;
    // Så nära kanten (px) ritas nästa block.
    var EDGE = 1500;
    // Listan ritar så många konversationer åt gången i varje databas; resten kommer när den rullas dit.
    var LIST_STEP = 200;
    // Raden när sökningen i listan inte träffar något. Ingen träff på ett nummer betyder inte att numret saknas i appen.
    var NO_MATCH = 'Ingen konversation matchar sökningen. Den letar i namn, nummer och deltagare, inte i meddelandenas text. Ett nummer hittas bara om databasen har det.';
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
        // Urvalet i listan: app och slag ('' är alla), ordningen och Dölj tomma. shown är listan som den visas.
        list: { app: '', kind: '', sort: 'recent', hideEmpty: false }, shown: null,
        // 'list' eller 'phone': bubblorna över hela bredden, eller i en ram med en telefons bredd.
        look: 'list',
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
        // De andra verktygen ska inte fråga här efter databaser som är stängda.
        if (window.DbShare && window.DbShare.client) window.DbShare.client.gone();
        closeThread();
        // Bildbiblioteket hör till extraktionen som stängs.
        // Bildbiblioteket, hemskärmen och inställningarna hör till extraktionen som stängs.
        if (state.device) {
            var P = state.device;
            if (P.gallery) { P.gallery.destroy(); P.gallery = null; }
            if (P.photos) Object.keys(P.photos.covers || {}).forEach(function (k) { if (P.photos.covers[k]) URL.revokeObjectURL(P.photos.covers[k]); });
            if (P.info) [P.info.wall || {}, P.info.icons || {}].forEach(function (m) { Object.keys(m).forEach(function (k) { if (m[k]) URL.revokeObjectURL(m[k]); }); });
            P.photos = null;
            P.info = null;
            P.page = 0;
            P.filter = 'all';
            if (PHONE_TOOL) openDevice('home');
        }
        $('bar-zip').textContent = 'Ingen öppen';
        // En annan extraktion har andra appar och namn, så sökningen och valet av app och slag börjar om.
        // Ordningen och Dölj tomma står kvar.
        state.list.app = '';
        state.list.kind = '';
        $('c-search').value = '';
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
            state.comms = { zip: zip, state: 'wait', hits: found.found.filter(function (h) { return commOf(h.key); }), contacts: null, calls: null, files: {}, errors: [] };
            state.web = { zip: zip, state: 'wait', hits: found.found.filter(function (h) { return webOf(h.key); }), browsers: [], errors: [] };
            var all = found.found.map(function (hit) {
                return { hit: hit, src: sourceOf(hit.key), zip: zip, loaded: null, threads: [], members: {}, index: null, error: null, state: 'wait', note: '', loading: null, collapsed: false, limit: LIST_STEP };
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
            if (state.comms.hits.length) {
                progress(o, 'Läser kontakterna och samtalen…', null);
                await loadComms(state.comms);
                if (deviceShown()) renderDevice();
            } else state.comms.state = 'none';
            if (state.web.hits.length) {
                progress(o, 'Läser webbhistoriken…', null);
                await loadWeb(state.web);
                if (deviceShown()) renderDevice();
            } else state.web.state = 'none';
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
    function commOf(key) { return COMM_SOURCES.find(function (s) { return s.key === key; }) || null; }
    function webOf(key) { return WEB_SOURCES.find(function (s) { return s.key === key; }) || null; }

    // Webbhistoriken: en post per webbläsare (Safari, Chrome, Samsung Internet, Edge …) med besöken, sökningarna,
    // nedladdningarna, flikarna och den rensade historiken. Användare 0 före andra användare; en fil per slag.
    async function loadWeb(w) {
        w.state = 'busy';
        var hits = w.hits.slice().sort(function (a, b) { return (/\/user(?:_de)?\/(?!0\/)\d+\//.test(a.db.name) ? 1 : 0) - (/\/user(?:_de)?\/(?!0\/)\d+\//.test(b.db.name) ? 1 : 0); });
        var parse = window.KC && KC.bplist ? KC.bplist.parse : null;
        for (var i = 0; i < hits.length; i++) {
            var h = hits[i], src = webOf(h.key), who = Web.browserOf(src, h.db.name);
            var b = w.browsers.filter(function (x) { return x.id === who.id; })[0];
            if (!b) { b = { id: who.id, name: who.name, platform: who.platform, files: {}, visits: null, searches: null, downloads: null, tabs: null, cleared: null }; w.browsers.push(b); }
            var kinds = Object.keys(src.roles).filter(function (k) { return !b.files[k]; });
            if (!kinds.length) continue;
            var d = { hit: h, src: { app: who.name, cipher: null, derive: null }, zip: w.zip, loaded: null };
            try {
                var loaded = await loadDb(d);
                try {
                    kinds.forEach(function (k) {
                        try {
                            b[k] = Web[k](src, query(loaded, src.roles[k]), parse);
                            b.files[k] = h.db.name;
                        } catch (err) { w.errors.push(who.name + ' (' + baseName(h.db.name) + '): ' + errText(err)); }
                    });
                } finally { loaded.sqlDb.close(); }
            } catch (err) {
                if (err && err.cancelled) throw err;
                w.errors.push(who.name + ' (' + baseName(h.db.name) + '): ' + errText(err));
            }
        }
        w.browsers = w.browsers.filter(function (b) { return Object.keys(b.files).length; });
        w.state = 'ready';
    }

    // Kontakterna och samtalen, med katalogens roller contacts, contact-points och calls. Den första databasen av
    // varje slag läses (användare 0 före andra användare).
    async function loadComms(c) {
        c.state = 'busy';
        var first = {};
        c.hits.slice().sort(function (a, b) { return (/\/user\/(?!0\/)\d+\//.test(a.db.name) ? 1 : 0) - (/\/user\/(?!0\/)\d+\//.test(b.db.name) ? 1 : 0); }).forEach(function (h) {
            var src = commOf(h.key);
            if (src && !first[src.kind]) first[src.kind] = { hit: h, src: src };
        });
        for (var kind of Object.keys(first)) {
            var x = first[kind], d = { hit: x.hit, src: { app: x.src.title, cipher: null, derive: null }, zip: c.zip, loaded: null };
            try {
                var loaded = await loadDb(d);
                try {
                    if (kind === 'contacts') c.contacts = Comms.contacts(x.src, query(loaded, x.src.roles.contacts), x.src.roles.points ? query(loaded, x.src.roles.points) : null);
                    else c.calls = Comms.calls(x.src, query(loaded, x.src.roles.calls));
                    c.files[kind] = x.hit.db.name;
                    c.platform = x.src.platform;
                } finally { loaded.sqlDb.close(); }
            } catch (err) {
                if (err && err.cancelled) throw err;
                c.errors.push(x.src.title + ': ' + errText(err));
            }
        }
        c.state = 'ready';
    }
    // Namnet i Kontakter för ett nummer eller en adress, eller ''.
    function contactName(v) {
        var c = state.comms && state.comms.zip === state.zip && state.comms.contacts ? Comms.lookup(state.comms.contacts.index, v) : null;
        return c ? c.name : '';
    }
    function contactOf(v) {
        return state.comms && state.comms.zip === state.zip && state.comms.contacts ? Comms.lookup(state.comms.contacts.index, v) : null;
    }

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
        var size = d.hit.db.size ? ' (' + ChatCore.sizeText(d.hit.db.size) + ')' : '';
        var loaded = await ExtractionCore.loadDatabase(d.zip.read, d.hit, [d.zip.line], {
            cipher: cipher,
            // Har ett annat verktyg redan läst databasen ur samma extraktion hämtas den därifrån, utan ny läsning
            // och dekryptering.
            share: { file: d.zip.file },
            onStage: function (stage, frac, by, inner) {
                note(stage === 'read' ? 'läser filen' + size + '…' : ExtractionCore.stageText(stage, frac, by, '', inner), typeof frac === 'number' ? frac : null);
            },
        });
        loaded.keySource = cipher ? cipher.source : null;
        loaded.modernKey = cipher ? cipher.modernKey : null;
        try { loaded.sqlDb = new SQL.Database(ExtractionCore.noCopy(loaded.bytes)); }
        catch (err) { throw ZipRead.friendlyMemory(err, label, loaded.bytes.length); }
        loaded.bytes = null;
        // Extraktionen byttes medan filen lästes: databasen hör inte till någon längre.
        if (d.zip !== state.zip) { loaded.sqlDb.close(); throw cancelError(); }
        if (d.src.derive && window.TelegramPostbox) {
            note('avkodar Telegrams meddelanden…', null);
            // Avkodningen går utan paus: raden ska hinna visas först.
            await ZipRead.painted();
            try { loaded.derived = window.TelegramPostbox.attach(loaded.sqlDb); }
            catch (e) { loaded.warnings.push(label + ': Telegrams format kunde inte avkodas: ' + e.message); }
        }
        // Bara läsning efter det: avbilden förblir som den lästes, också för verktygen som får en kopia av den.
        loaded.sqlDb.run('PRAGMA query_only = ON');
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
                // Frågan går utan paus och tar en stund i en stor databas: raden ska hinna visas först.
                await ZipRead.painted();
                d.threads = ChatCore.threads(d.src, query(loaded, d.src.roles.threads));
                d.members = d.src.roles.members ? ChatCore.members(d.src, query(loaded, d.src.roles.members)) : {};
                ChatCore.applyNames(d.src, d.threads, d.members, state.names[d.src.app]);
                ChatCore.applyContacts(d.threads, d.members, contactName);
                d.index = ChatCore.listIndex(d.threads, d.members);
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

    function chip(what, value, label, count, on) {
        return '<button type="button" class="c-chip" data-' + what + '="' + esc(value) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(label) +
            (count === null ? '' : ' <span>' + num(count) + '</span>') + '</button>';
    }

    // Skriver bara när något har ändrats, så att knappen som har fokus får stå kvar.
    function setHtml(id, html) {
        var el = $(id);
        if (el.shownHtml === html) return;
        el.shownHtml = html;
        el.innerHTML = html;
    }

    // Valen ovanför listan. Talet vid en app eller ett slag är så många konversationer valet skulle visa.
    function renderFilters(view) {
        var L = state.list;
        $('c-filters').classList.toggle('display-none', !view.total);
        setHtml('c-app-chips', view.apps.length > 1 ? view.apps.map(function (a) { return chip('app', a.app, a.app, a.count, L.app === a.app); }).join('') : '');
        setHtml('c-kind-chips', view.kinds.length > 1 ? view.kinds.map(function (k) { return chip('kind', k.kind, k.text, k.count, L.kind === k.kind); }).join('') : '');
        $('c-sort').value = L.sort;
        $('c-hide-empty').checked = L.hideEmpty;
        $('c-hide-empty-row').classList.toggle('display-none', !view.empty && !L.hideEmpty);
        $('c-hide-empty-text').textContent = 'Dölj tomma (' + num(view.empty) + ')';
        setHtml('c-count', view.filtered ? 'Visar ' + num(view.shown) + ' av ' + many(view.total, 'konversation', 'konversationer') + '. <button type="button" class="link-btn" id="c-reset">Visa alla</button>' : '');
    }

    function itemHtml(d, di, item, f) {
        var t = item.thread;
        var cur = state.current && state.current.db === d && state.current.thread.key === t.key;
        var sub = [t.messages !== null ? many(t.messages, 'meddelande', 'meddelanden') : '', t.lastMs ? 'senast ' + f(t.lastMs).slice(0, 10) : ''].filter(Boolean).join(' · ');
        return '<button type="button" class="c-item" data-db="' + di + '" data-thread="' + esc(t.key) + '"' + (cur ? ' aria-current="true"' : '') + ' title="' + esc(t.address || t.name) + '">' +
            '<span class="c-av p' + ChatCore.hueOf(t.key) + '" data-initial="' + esc(ChatCore.initialOf(t.name)) + '" aria-hidden="true"></span><span class="c-item-text">' +
            '<span class="c-item-name"><span>' + esc(t.name) + '</span><span class="c-kind">' + esc(t.kindText) + '</span></span>' +
            '<span class="c-item-sub">' + esc(sub) + '</span>' +
            // Sökningen träffade en deltagare och inte konversationens eget namn.
            (item.who.length ? '<span class="c-item-who">Deltagare: ' + esc(item.who.join(', ')) + '</span>' : '') + '</span></button>';
    }

    function moreHtml(di, left) {
        return left > 0 ? '<button type="button" class="c-more" data-more="' + di + '">Visa fler (' + num(left) + ' kvar)</button>' : '';
    }

    // En databas i listan: rubriken med antalet, och under den konversationerna om den är utfälld.
    function groupHtml(d, di, g, view, f) {
        // Urvalet lämnar ingenting kvar här: bara rubriken står kvar, så att det syns att databasen är med.
        var none = view.filtered && g.total !== null && !g.items.length;
        var count = d.error ? '<span class="warn">Fel</span>' : g.total === null ? '' : view.filtered ? num(g.items.length) + ' av ' + num(g.total) : num(g.total);
        var head = '<button type="button" class="c-group" data-group="' + di + '" aria-expanded="' + (d.collapsed ? 'false' : 'true') + '">' +
            '<span class="c-group-name">' + esc(d.src.app + (d.src.platform ? ' · ' + d.src.platform : '')) + '</span><span class="c-group-count">' + count + '</span>' +
            (none ? '' : '<small title="' + esc(d.hit.db.name) + '">' + esc(d.hit.db.name) + '</small>') + '</button>';
        var body = '';
        if (d.collapsed || none) body = '';
        else if (d.error) body = '<div class="c-list-empty warn">' + esc(d.error) + '</div>';
        else if (d.state !== 'ready') body = '<div class="c-list-empty c-db-state" data-state-for="' + di + '">' + dbStateHtml(d, di) + '</div>';
        else if (!g.total) body = '<div class="c-list-empty">Inga konversationer.</div>';
        else {
            // Konversationen som är öppen ritas alltid, också långt ned i en lång lista.
            var c = state.current;
            if (c && c.db === d) for (var i = d.limit; i < g.items.length; i++) if (g.items[i].thread.key === c.thread.key) { d.limit = i + 1; break; }
            g.drawn = Math.min(g.items.length, d.limit);
            body = g.items.slice(0, g.drawn).map(function (item) { return itemHtml(d, di, item, f); }).join('') + moreHtml(di, g.items.length - g.drawn);
        }
        return '<div class="c-db' + (none ? ' c-db-none' : '') + '">' + head + body + '</div>';
    }

    // Knappen i listan som har fokus, så att samma knapp får det igen när listan har ritats om.
    function focusedIn(list) {
        var a = document.activeElement;
        if (!a || !list.contains(a)) return null;
        if (a.classList.contains('c-item')) return ['item', a.dataset.db, a.dataset.thread];
        return a.dataset.group !== undefined ? ['group', a.dataset.group] : a.dataset.more !== undefined ? ['more', a.dataset.more] : null;
    }

    function itemEl(di, key) {
        var all = $('c-list').querySelectorAll('.c-item[data-db="' + di + '"]');
        for (var i = 0; i < all.length; i++) if (all[i].dataset.thread === key) return all[i];
        return null;
    }

    function renderList() {
        var L = state.list, list = $('c-list'), f = fmt();
        var view = ChatCore.listView(state.dbs.map(function (d) {
            return { app: d.src.app, threads: d.state === 'ready' ? d.threads : null, index: d.index };
        }), { query: $('c-search').value, app: L.app, kind: L.kind, hideEmpty: L.hideEmpty, sort: L.sort });
        state.shown = view;
        renderFilters(view);
        var had = focusedIn(list);
        var html = state.dbs.map(function (d, di) { return view.groups[di].visible ? groupHtml(d, di, view.groups[di], view, f) : ''; }).join('');
        var reading = state.dbs.some(function (d, di) { return view.groups[di].visible && d.state !== 'ready' && !d.error; });
        if (html && view.filtered && !view.shown && !reading) html += '<div class="c-list-empty">' + ($('c-search').value.trim() ? NO_MATCH : 'Ingen konversation i urvalet.') + '</div>';
        var opening = state.opening && !state.opening.done;
        list.innerHTML = html || '<div class="c-list-empty">' + (state.zip ? (opening ? 'Letar efter chattdatabaser…' : 'Inga chattdatabaser i ' + Z() + '.') : opening ? 'Läser extraktionen…' : 'Ingen extraktion öppen.') + '</div>';
        if (had) {
            var again = had[0] === 'item' ? itemEl(had[1], had[2]) : list.querySelector('[data-' + had[0] + '="' + had[1] + '"]');
            if (again) again.focus({ preventScroll: true });
        }
        watchMore();
        // Telefonen visar apparna och antalen när databaserna blir lästa.
        $('c-device-open').classList.toggle('display-none', !state.zip);
        if (state.device && deviceShown() && state.device.screen !== 'photos') {
            var top = $('c-device-body').scrollTop;
            renderDevice();
            $('c-device-body').scrollTop = top;
        }
    }

    // Resten av en lång lista ritas när raden Visa fler kommer nära det som syns.
    var moreObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) showMore(Number(e.target.dataset.more)); });
    }, { root: $('c-list'), rootMargin: '400px 0px' }) : null;

    function watchMore() {
        if (!moreObserver) return;
        moreObserver.disconnect();
        Array.prototype.forEach.call($('c-list').querySelectorAll('.c-more'), function (b) { moreObserver.observe(b); });
    }

    // Nästa omgång konversationer i en databas, lagd efter dem som redan är ritade.
    function showMore(di) {
        var d = state.dbs[di], g = state.shown ? state.shown.groups[di] : null;
        var more = $('c-list').querySelector('.c-more[data-more="' + di + '"]');
        if (!d || !g || !more || !(g.drawn < g.items.length)) return;
        var from = g.drawn, f = fmt();
        g.drawn = d.limit = Math.min(g.items.length, from + LIST_STEP);
        more.insertAdjacentHTML('beforebegin', g.items.slice(from, g.drawn).map(function (item) { return itemHtml(d, di, item, f); }).join(''));
        // Den som gick hit med tangenterna fortsätter på den första nya raden.
        var focused = document.activeElement === more;
        var first = focused ? itemEl(di, g.items[from].thread.key) : null;
        more.insertAdjacentHTML('afterend', moreHtml(di, g.items.length - g.drawn));
        more.remove();
        if (first) first.focus();
        watchMore();
    }

    // Ett nytt urval börjar överst, med den första omgången i varje databas.
    function listChanged() {
        state.dbs.forEach(function (d) { d.limit = LIST_STEP; });
        renderList();
        $('c-list').scrollTop = 0;
    }

    $('c-sort').innerHTML = ChatCore.LIST_SORTS.map(function (s) { return '<option value="' + s[0] + '">' + esc(s[1]) + '</option>'; }).join('');
    $('c-sort').addEventListener('change', function () { state.list.sort = this.value; listChanged(); });
    $('c-hide-empty').addEventListener('change', function () { state.list.hideEmpty = this.checked; listChanged(); });
    $('c-search').addEventListener('input', listChanged);
    $('c-filters').addEventListener('click', function (e) {
        var L = state.list, b = e.target.closest('.c-chip');
        if (b) {
            // Ett klick till på det valda tar bort valet.
            var what = b.dataset.app !== undefined ? 'app' : 'kind', value = b.dataset[what];
            L[what] = L[what] === value ? '' : value;
            listChanged();
            // Raden med valen ritades om: samma knapp ska ha fokus kvar.
            var again = Array.prototype.filter.call($('c-' + what + '-chips').children, function (x) { return x.dataset[what] === value; })[0];
            if (again) again.focus();
            return;
        }
        if (!e.target.closest('#c-reset')) return;
        L.app = '';
        L.kind = '';
        L.hideEmpty = false;
        $('c-search').value = '';
        listChanged();
        $('c-search').focus();
    });

    // Pil ned i sökrutan går till listan, och pilarna, Home och End går mellan raderna i den.
    $('c-search').addEventListener('keydown', function (e) {
        var first = e.key === 'ArrowDown' ? $('c-list').querySelector('button') : null;
        if (!first) return;
        e.preventDefault();
        first.focus();
    });
    $('c-list').addEventListener('keydown', function (e) {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(e.key) < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
        var all = Array.prototype.slice.call($('c-list').querySelectorAll('button'));
        var at = all.indexOf(document.activeElement);
        if (at < 0) return;
        e.preventDefault();
        var to = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : at + (e.key === 'ArrowDown' ? 1 : -1);
        if (to < 0) $('c-search').focus();
        else if (all[to]) all[to].focus();
    });

    $('c-list').addEventListener('click', function (e) {
        var load = e.target.closest('[data-load]');
        if (load) {
            var skipped = state.dbs[Number(load.dataset.load)];
            if (skipped) loadThreads(skipped).then(function () { renderList(); summary(); });
            renderList();
            return;
        }
        var more = e.target.closest('[data-more]');
        if (more) { showMore(Number(more.dataset.more)); return; }
        var group = e.target.closest('[data-group]');
        if (group) {
            var folded = state.dbs[Number(group.dataset.group)];
            if (folded) { folded.collapsed = !folded.collapsed; renderList(); }
            return;
        }
        var b = e.target.closest('.c-item');
        if (!b) return;
        var d = state.dbs[Number(b.dataset.db)];
        if (d) openThread(d, b.dataset.thread).catch(showError);
    });

    // Konversationen som är öppen visas i listan, om urvalet har den med: databasen fälls ut och raden rullas fram.
    function revealCurrent() {
        var c = state.current;
        if (!c) return;
        if (c.db.collapsed) { c.db.collapsed = false; renderList(); }
        var el = itemEl(state.dbs.indexOf(c.db), c.thread.key);
        if (el) el.scrollIntoView({ block: 'nearest' });
    }

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
        // Medan telefonen visas står den kvar i stället för startrutan.
        if (!state.device || !deviceShown()) $('c-empty').classList.toggle('display-none', PHONE_TOOL);
        closePop();
    }

    // Läser konversationen i omgångar med förlopp och visar den först när allt är klart: ett avbrott lämnar det som
    // visades. focus: meddelandets key, som visas och blinkar.
    async function openThread(d, key, focus) {
        var thread = d.threads.find(function (t) { return t.key === String(key); });
        if (!thread) throw new Error('Konversationen ' + key + ' finns inte i ' + d.hit.db.name + '.');
        // Öppnad från telefonen: chatten visas i telefonvyn, med knappen tillbaka. Från listan till vänster lämnas telefonen.
        var fromDevice = deviceShown();
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
            var model = ChatCore.conversation(d.src, thread, msgRes, attRes, d.members[thread.key] || [], d.hit.db.name, { names: state.names[d.src.app], nameOf: contactName });
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
            // Från telefonen öppnas chatten i telefonvyn, med knappen tillbaka till appens lista.
            state.device.on = fromDevice;
            if (fromDevice) { hideDevice(); setLook('phone'); }
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
        // Telefonvyns ram: samma uppgifter som i exporten.
        var ph = ChatExport.phone(m);
        $('c-phone').dataset.frame = ph.frame;
        $('c-phone-avatar').textContent = ph.initial;
        $('c-phone-name').textContent = ph.name;
        $('c-phone-sub').textContent = ph.sub;
        $('c-phone-foot').textContent = ph.label;
        $('c-phone-back-text').textContent = $('c-list-back-text').textContent = c.db.src.app;
        backButtons();
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
        // En HEIC som skickats som dokument avkodas och visas, men märkt som dokument och med filen kvar att spara.
        if (ChatCore.heicFile(a)) {
            return '<div class="att att-doc"><div class="att-doc-tag">Dokument: en HEIC-bild som skickades som fil</div>' +
                '<button type="button" class="att-img" data-att="' + id + '" title="' + esc(info) + '"><img data-entry="' + esc(shown) + '" data-mime="' + esc(a.mime) + '" data-doc="1"' + src + ' alt="' + esc(name) + '"></button>' +
                '<div class="att-doc-info">' + marked(info) + ' <button type="button" class="link-btn" data-save="' + esc(shown) + '" data-name="' + esc(name) + '">Spara filen</button></div>' + below + '</div>';
        }
        if (a.kind === 'image' || a.kind === 'sticker' || a.kind === 'gif' && /^image\//.test(a.mime)) {
            var doc = ChatCore.sentAsDocument(m, a);
            return '<div class="att' + (doc ? ' att-doc' : '') + '">' + (doc ? '<div class="att-doc-tag">Dokument: bilden skickades som fil</div>' : '') +
                '<button type="button" class="att-img" data-att="' + id + '" title="' + esc(info) + '"><img data-entry="' + esc(shown) + '" data-mime="' + esc(a.mime) + '"' + src + ' alt="' + esc(name) + '"></button>' + below + '</div>';
        }
        if (a.kind === 'video' || a.kind === 'gif') return '<div class="att"><video controls preload="metadata" data-entry="' + esc(shown) + '" data-mime="' + esc(a.mime) + '"' + src + ' title="' + esc(info) + '"></video>' + below + '</div>';
        if (a.kind === 'audio' || a.kind === 'voice') return '<div class="att"><audio controls preload="metadata" data-entry="' + esc(shown) + '" data-mime="' + esc(a.mime) + '"' + src + ' title="' + esc(info) + '"></audio>' + below + '</div>';
        return '<div class="att att-file">' + marked(info) + (a.sha256 ? '<small>SHA-256 ' + esc(a.sha256) + '</small>' : '') + ' <button type="button" class="link-btn" data-save="' + esc(shown) + '" data-name="' + esc(name) + '">Spara filen</button>' + below + '</div>';
    }

    function messageHtml(m, i) {
        var model = state.current.model, f = fmt();
        var sys = m.kind === 'system' || m.kind === 'call';
        var hit = state.find && state.find.hits.length && state.find.hits[state.find.pos] === i;
        // En följd från samma avsändare ritas ihop. Ett nytt datum bryter den.
        var list = model.messages, cont = !newDay(i) && ChatCore.sameRun(list[i - 1], m), more = i + 1 < list.length && !newDay(i + 1) && ChatCore.sameRun(m, list[i + 1]);
        var cls = 'm' + (sys ? ' sys' : m.fromMe ? ' me' : '') + (cont ? ' cont' : '') + (more ? ' more' : '') + (state.picked[m.key] ? ' picked' : '') + (hit ? ' hit' : '');
        var other = model.group && !m.fromMe && !sys, hue = ' p' + ChatCore.hueOf(ChatCore.senderKey(m));
        var who = other && !cont ? '<div class="who' + hue + '">' + esc(ChatCore.senderText(m)) + '</div>' : '';
        // Initialen står i data-initial och ritas av CSS, så att den inte blir en del av meddelandets text.
        var av = other ? '<span class="av' + hue + (more ? ' blank' : '') + '" data-initial="' + (more ? '' : esc(ChatCore.initialOf(ChatCore.senderText(m)))) + '" aria-hidden="true"></span>' : '';
        var reply = m.reply ? '<div class="reply"><b>' + esc(m.reply.from || 'Svar') + '</b>' + esc(m.reply.text || (m.reply.found ? '' : 'Meddelandet finns inte i databasen')) + '</div>' : '';
        var atts = m.attachments.map(function (a, k) { return attachmentHtml(m, a, k); }).join('');
        var text = m.text ? '<div class="t">' + marked(m.text) + '</div>' : !m.attachments.length ? '<div class="t kind">' + esc(m.kindLabel) + '</div>' : '';
        var flags = [m.viewOnce ? 'engångsvisning' : '', m.deleted ? 'raderat' : '', m.edited, m.expiresIn ? 'försvinner ' + m.expiresIn + ' s' : '']
            .filter(Boolean).map(function (x) { return '<span class="flag">' + esc(x) + '</span>'; }).join('');
        var time = m.sortMs !== null ? f(m.sortMs).slice(11, 16) : '–';
        return '<div class="' + cls + '" data-i="' + i + '" data-key="' + esc(m.key) + '"><label class="m-check"><input type="checkbox" aria-label="Välj meddelandet"' + (state.picked[m.key] ? ' checked' : '') + '></label>' +
            av + '<div class="b">' + who + reply + atts + text +
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
        requestAnimationFrame(updateLatest);
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

    // Det första meddelandet som syns och dess läge, så att sidan kan ritas om utan att hoppa. cut är hur stor del
    // av meddelandet som står ovanför kanten.
    function anchor() {
        var box = $('c-msgs'), top = box.getBoundingClientRect().top;
        var list = box.querySelectorAll('.m');
        for (var k = 0; k < list.length; k++) {
            var r = list[k].getBoundingClientRect();
            if (r.bottom > top) return { i: Number(list[k].dataset.i), top: r.top - top, cut: r.top < top ? (top - r.top) / r.height : 0 };
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

    // Listan eller telefonvyn. Bredden ändras och med den radbrytningarna, så läget hålls: stod chatten vid sitt
    // slut gör den det efteråt också, annars står det översta meddelandet kvar. Skär kanten meddelandet skärs det på
    // samma ställe i sin nya höjd: med samma avstånd som förut hamnade ett meddelande som blivit kortare helt
    // ovanför kanten.
    function setLook(look) {
        if (look === state.look) return;
        var box = $('c-msgs'), drawn = !!(state.current && state.view);
        var atEnd = drawn && state.view.to === state.current.model.messages.length && box.scrollHeight - box.scrollTop - box.clientHeight < 2;
        var a = drawn ? anchor() : null;
        closePop();
        state.look = look;
        $('c-stage').classList.toggle('phone', look === 'phone');
        $('c-look-list').setAttribute('aria-pressed', String(look === 'list'));
        $('c-look-phone').setAttribute('aria-pressed', String(look === 'phone'));
        backButtons();
        var el = a ? msgEl(a.i) : null;
        if (atEnd) box.scrollTop = box.scrollHeight;
        else if (el) {
            var r = el.getBoundingClientRect();
            box.scrollTop += r.top - box.getBoundingClientRect().top - (a.cut ? -a.cut * r.height : a.top);
        }
        fill();
    }
    // En chatt som öppnades från telefonen har knappen tillbaka till appen i båda vyerna: i telefonens ram, och i
    // listvyn i chattens huvud. Att byta vy lämnar inte telefonen.
    function backButtons() {
        var on = !!(state.device.on && state.current);
        $('c-phone-back').classList.toggle('display-none', !on);
        $('c-list-back').classList.toggle('display-none', !on || state.look !== 'list');
    }
    $('c-look-list').addEventListener('click', function () { setLook('list'); });
    $('c-look-phone').addEventListener('click', function () { setLook('phone'); });

    // Nästa block ritas när kanten närmar sig, och block långt bort tas bort, så att sidan aldrig har fler än MAX_DRAWN.
    var filling = false;
    $('c-msgs').addEventListener('scroll', function () {
        if (filling || !state.view) return;
        filling = true;
        requestAnimationFrame(function () { filling = false; fill(); });
    }, { passive: true });

    // Knappen till det senaste meddelandet syns när det inte står nära.
    function updateLatest() {
        var box = $('c-msgs'), v = state.view, n = state.current ? state.current.model.messages.length : 0;
        var far = !!v && n > 0 && (v.to < n || box.scrollHeight - box.scrollTop - box.clientHeight > 600);
        $('c-latest').classList.toggle('display-none', !far);
    }
    $('c-latest').addEventListener('click', function () {
        var n = state.current ? state.current.model.messages.length : 0;
        if (n) showAt(n - 1, 'end');
        $('c-msgs').focus();
    });

    function fill() {
        updateLatest();
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

    // heicOnly: filen är ett dokument som ska visas bara om innehållet är HEIC.
    async function mediaUrl(path, mime, heicOnly) {
        if (state.urls[path]) return state.urls[path];
        var c = state.current;
        var got = await mediaBytes(path);
        if (state.current !== c) throw cancelError();
        if (heicOnly && !(window.Heic && Heic.is(got.bytes))) throw Object.assign(new Error('Filen är inte en HEIC-bild.'), { notHeic: true });
        // HEIC ritas inte av webbläsaren: bilden avkodas (tools/_shared/heic.js) och visas som JPEG.
        var url = window.Heic && Heic.is(got.bytes) ? await Heic.url(got.bytes, { maxSide: 2048 }) : URL.createObjectURL(new Blob([got.bytes], { type: mime || got.attachment.mime || 'application/octet-stream' }));
        if (state.current !== c) { URL.revokeObjectURL(url); throw cancelError(); }
        if (state.urls[path]) URL.revokeObjectURL(url);
        else state.urls[path] = url;
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
            var url = await mediaUrl(path, el.dataset.mime, !!el.dataset.doc);
            if (state.current !== cur) return;
            if (el.getAttribute('src') !== url) el.src = url;
        } catch (err) {
            if (err && err.cancelled) return;
            if (err && err.notHeic) {
                var box = el.closest('.att-doc');
                el.closest('.att-img').remove();
                box.querySelector('.att-doc-tag').textContent = 'Dokument: filen heter som en HEIC-bild men är det inte.';
                return;
            }
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
                if ((a.kind === 'image' || a.kind === 'sticker' || ChatCore.heicFile(a)) && p) out.push({ ref: m.key + ':' + i, m: m, a: a, path: p, doc: ChatCore.heicFile(a) || ChatCore.sentAsDocument(m, a) });
            });
        });
        return out;
    }

    var lightbox = { list: [], i: 0 };
    async function showImage(i) {
        var it = lightbox.list[i];
        if (!it) return;
        lightbox.i = i;
        $('c-lb-img').src = await mediaUrl(it.path, it.a.mime, ChatCore.heicFile(it.a));
        $('c-lb-img').alt = it.a.name || baseName(it.a.entry);
        $('c-lb-cap').textContent = (it.doc ? 'Dokument (skickad som fil) · ' : '') + ChatCore.senderText(it.m) + ' · ' + (it.m.sortMs !== null ? fmt()(it.m.sortMs) : '') + ' · ' + it.path + (it.a.sha256 ? ' · SHA-256 ' + it.a.sha256 : '');
        $('c-lb-exif').classList.toggle('display-none', !inHub || !entryOf(it.path));
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
    $('c-lb-exif').addEventListener('click', function () {
        var it = lightbox.list[lightbox.i], e = it && entryOf(it.path);
        if (!e) return;
        mediaBytes(it.path).then(function (got) { return toExif(e, got.bytes, 'Chattar'); }).catch(showError);
        closeLightbox();
    });
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

    // En bild till EXIF: filen som den ligger i extraktionen (en krypterad bilaga dekrypterad), med
    // filsystemets tider ur zippen, som när Härkomst skickar den.
    async function toExif(entry, bytes, how) {
        var zt = ExtractionCore.entryTimes(entry), sources = {};
        ['modified', 'created', 'changed', 'third', 'accessed'].forEach(function (w) { sources[w] = zt.field || (w === 'modified' ? 'DOS-tid' : ''); });
        if (!bytes) bytes = (await ExtractionCore.readEntry(state.zip.read, entry)).bytes;
        var file = new File([bytes], baseName(entry.name), { lastModified: zt.modifiedMs || 0 });
        toHub({ type: 'file-for', to: 'exif', from: how, files: [{ file: file, path: state.zip.file.name + ' › ' + entry.name,
            times: { modified: zt.modified, created: zt.created, changed: zt.changed, third: zt.third, accessed: zt.accessed, field: zt.field, sources: sources } }] });
    }

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
        // Exporten föreslår utseendet som visas, och det går att välja ett annat.
        document.querySelector('input[name="c-look"][value="' + state.look + '"]').checked = true;
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
    $('c-export-look').addEventListener('change', urvalChanged);
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

    // Utseendet som är valt i exportrutan: 'list' eller 'phone'.
    function exportLook() { return document.querySelector('input[name="c-look"]:checked').value; }

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
        var imgs = imagesOf(sel.list), est = ChatExport.estimate(sel.list, imgs.count, imgs.bytes, exportLook());
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
        $('c-export-look').disabled = on;
    }

    // Exporten i delar med förlopp i rutan. kind: 'html' eller 'print'. Ger delarna, eller null när inget ska sparas.
    async function buildExport(kind) {
        var c = state.current;
        var sel = selection();
        if (sel.error) { setStatus('c-export-status', esc(sel.error), 'warn'); return null; }
        if (!sel.list.length) { setStatus('c-export-status', 'Inga meddelanden i urvalet.', 'warn'); return null; }
        var imgs = imagesOf(sel.list), look = exportLook();
        var warn = exportWarning(kind, ChatExport.estimate(sel.list, imgs.count, imgs.bytes, look));
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
                model: c.model, messages: sel.list, zone: state.zone, selection: sel.text, media: media, look: look,
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
        revealCurrent();
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


    // ---------- Telefonen ----------

    // Hemskärmen, apparna, bilderna och inställningarna, i telefonvyns ram. En chatt öppnas i telefonvyn med en knapp
    // tillbaka till appens lista. on: telefonen är vald; screen: 'home', 'app', 'photos', 'albums', 'settings' eller
    // 'setting'; app: appen i 'app'; page: sidan på hemskärmen; filter: urvalet i Bilder; section: delen i Inställningar.
    // photos: bildbiblioteket och info: hemskärmen och inställningarna, båda lästa första gången telefonen visas.
    state.device = { on: false, screen: 'home', app: '', page: 0, filter: 'all', section: '', photos: null, info: null, gallery: null, limit: LIST_STEP, note: null, noteFilter: 'all', call: null, callFilter: 'all', contact: null, web: '', webTab: 'visits', webItem: null };
    var GLYPH = {
        globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.6 5.2 3.6 8.5s-1 6.1-3.6 8.5c-2.6-2.4-3.6-5.2-3.6-8.5s1-6.1 3.6-8.5z"/>',
        chat: '<path d="M4 5h16v11H9l-5 4z"/>',
        shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/>',
        plane: '<path d="M3 11l18-7-6 17-3-7z"/>',
        ghost: '<path d="M6 20c1-1 2 0 3 0s2-1 3-1 2 1 3 1 2-1 3 0V10a6 6 0 0 0-12 0z"/>',
        photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/>',
        note: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
        phone: '<path d="M6.6 3.6l3 3.2-1.9 2.4a12.5 12.5 0 0 0 7.1 7.1l2.4-1.9 3.2 3-2.3 3C10.6 20.2 3.8 13.4 3.6 5.9z"/>',
        person: '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 20.2c1-4 4-5.6 7.2-5.6s6.2 1.6 7.2 5.6"/>',
        gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M5.5 18.5l2.1-2.1M16.4 7.6l2.1-2.1"/>',
    };
    // Ikonerna är verktygets egna: appens färg och en enkel symbol, inte appens logga. Andra appar får en färg ur
    // namnet och sin första bokstav.
    var APP_ICON = { WhatsApp: ['#1fa855', '#fff', 'chat'], Signal: ['#2257d6', '#fff', 'shield'], Telegram: ['#2a9fd8', '#fff', 'plane'], Snapchat: ['#f5d90a', '#16191c', 'ghost'], Bilder: ['#ffffff', '#d6336c', 'photo'], 'Inställningar': ['#8e8e93', '#fff', 'gear'], Anteckningar: ['#ffd52e', '#3d3100', 'note'], Meddelanden: ['#34c759', '#fff', 'chat'], Telefon: ['#34c759', '#fff', 'phone'], Kontakter: ['#9aa0a6', '#fff', 'person'], Safari: ['#1a8cff', '#fff', 'globe'], Webbläsare: ['#4285f4', '#fff', 'globe'] };
    var ICON_HUES = ['#5b6b8c', '#7a5c99', '#2f7f7a', '#9a5b3c', '#3d6fa8', '#8a4f6b', '#55803f', '#a0673a'];
    var MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
    var PHOTO_SOURCES = window.ProvenanceRoles.collect({ photos: window.PHOTOS_SQLITE_CATALOG || {}, android: window.ANDROID_QUERIES_CATALOG || {} })
        .filter(function (s) { return s.key === 'photos' || s.key === 'android-mediastore'; });
    var PHOTO_TARGETS = ExtractionCore.targets(window.ProvenanceRoles.databases(PHOTO_SOURCES));
    var APP_CATALOG = window.AppIds ? window.AppIds.APPS : [];

    function hueOf(s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return ICON_HUES[h % ICON_HUES.length]; }
    // role: Telefonens namn på appen (WhatsApp, Bilder, Inställningar) eller tomt; name: namnet under ikonen.
    function iconHtml(role, badge, name, url) {
        if (url) return '<span class="d-icon has-img" aria-hidden="true"><img src="' + esc(url) + '" alt="" draggable="false">' + (badge || '') + '</span>';
        var c = APP_ICON[role];
        if (!c) {
            var letter = String(name || role || '?').trim().charAt(0).toUpperCase() || '?';
            return '<span class="d-icon" style="background:' + hueOf(name || role) + ';color:#fff" aria-hidden="true"><b class="d-letter">' + esc(letter) + '</b>' + (badge || '') + '</span>';
        }
        return '<span class="d-icon" style="background:' + c[0] + ';color:' + c[1] + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">' + GLYPH[c[2]] + '</svg>' + (badge || '') + '</span>';
    }
    function badgeHtml(busy, error, n) {
        return busy ? '<span class="d-badge wait">…</span>' : error ? '<span class="d-badge">!</span>' : '<span class="d-badge">' + esc(num(n)) + '</span>';
    }
    function devicePlatform() {
        var ph = state.device.photos, info = state.device.info;
        return state.dbs.map(function (d) { return d.src.platform; }).concat(ph && ph.platform ? [ph.platform] : [], info && info.platform ? [info.platform] : [])[0] || '';
    }
    function deviceFrame() { var p = devicePlatform(); return p === 'iOS' ? 'ios' : p === 'Android' ? 'android' : 'plain'; }
    function monthOf(ms) {
        if (ms === null || ms === undefined) return 'Utan tid';
        var d = fmt()(ms);
        return MONTHS[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(0, 4);
    }
    function nameOfApp(id) { var info = state.device.info; return DeviceInfo.appName(id, info ? info.names : null, APP_CATALOG); }
    // Telefonens egen ikon för appen (Android), efter id eller efter Telefonens namn på appen. null när den saknas.
    function phoneIcon(id, role) {
        var icons = state.device.info && state.device.info.icons;
        if (!icons) return null;
        if (id && icons[id]) return icons[id];
        if (!role) return null;
        var k = Object.keys(icons).filter(function (x) { return DeviceInfo.roleOf(x) === role; })[0];
        return k ? icons[k] : null;
    }

    // ---------- Bildbiblioteket ----------

    // Photos.sqlite på iOS eller MediaStore på Android, med rollen gallery (alla bilder med favorit, dold, papperskorgen
    // och appen) och på iOS albums. Tumnaglarna och filerna i zippen slås upp efter mappen och namnet.
    function photosBand(sqlDb) {
        var r = sqlDb.exec("SELECT name FROM sqlite_master WHERE type = 'table'");
        var tables = r.length ? r[0].values.map(function (v) { return String(v[0]); }) : [];
        var info = tables.indexOf('ZADDITIONALASSETATTRIBUTES') >= 0 ? sqlDb.exec('PRAGMA table_info(ZADDITIONALASSETATTRIBUTES)') : [];
        var cols = info.length ? info[0].values.map(function (v) { return String(v[1]); }) : [];
        var b = Roles().photosBandFromSchema(tables, cols);
        return b ? b.id : null;
    }
    // Vilka album en bild hör till: kopplingstabellen heter Z_<n>ASSETS med kolumnerna Z_<n>ALBUMS och Z_<m>ASSETS,
    // och numren skiljer mellan iOS-versioner (iOS 17 har två). Alla sådana tabeller läses. { bildens Z_PK: [albumets Z_PK] }.
    function albumLinks(sqlDb) {
        var out = {}, tables = [];
        var r = sqlDb.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'Z_[0-9]*ASSETS'");
        (r.length ? r[0].values : []).forEach(function (v) {
            var t = String(v[0]), info = sqlDb.exec('PRAGMA table_info(' + t + ')');
            var cols = info.length ? info[0].values.map(function (c) { return String(c[1]); }) : [];
            var album = cols.filter(function (c) { return /^Z_\d+ALBUMS$/.test(c); })[0], asset = cols.filter(function (c) { return /^Z_\d+ASSETS$/.test(c); })[0];
            if (!album || !asset) return;
            tables.push(t);
            var rows = sqlDb.exec('SELECT ' + album + ', ' + asset + ' FROM ' + t);
            (rows.length ? rows[0].values : []).forEach(function (x) { (out[x[1]] = out[x[1]] || []).push(x[0]); });
        });
        return { links: out, tables: tables };
    }
    function loadPhotos() {
        var z = state.zip, P = state.device;
        if (!z) return Promise.resolve(null);
        if (P.photos && P.photos.zip === z) return P.photos.loading || Promise.resolve(P.photos);
        var ph = P.photos = { zip: z, state: 'busy', items: [], albums: [], thumbs: {}, files: {}, how: {}, covers: {}, note: '', loading: null };
        ph.loading = (async function () {
            try {
                var found = await ExtractionCore.open(z.read, z.file.size, PHOTO_TARGETS, null);
                var entries = await ExtractionCore.find(z.read, z.file.size, function (name) { return !!ChatPhone.entryKey(name); });
                entries.forEach(function (e) {
                    var k = ChatPhone.entryKey(e.name), into = k.kind === 'thumb' ? ph.thumbs : ph.files;
                    if (!into[k.key]) into[k.key] = e;
                });
                var hit = found.found[0];
                if (!hit) { ph.state = 'none'; return; }
                // Träffens nyckel är familjen (photos eller android-mediastore), med en databas per iOS-version i Photos.
                var src = PHOTO_SOURCES.filter(function (x) { return x.databases.some(function (d) { return (d.family || d.id) === hit.key; }); })[0];
                if (!src) throw new Error('Bildbiblioteket ' + hit.db.name + ' hör inte till någon känd källa.');
                var loaded = await loadDb({ hit: hit, src: { app: 'Bilder', platform: src.platform }, zip: z, loaded: null });
                var roles = src.bands ? Roles().rolesFor(src, { dbId: photosBand(loaded.sqlDb) }) : src.roles;
                var q = roles.gallery || roles.neighbours, rows;
                try {
                    rows = Roles().mapRows(q, query(loaded, q, { window: { startMs: Date.UTC(1970, 0, 2), endMs: Date.UTC(2200, 0, 1) } }), ['created', 'added'], { raw: false });
                } catch (err) {
                    // En äldre MediaStore utan is_favorite eller is_trashed: bilderna i tidsfönstret som förut.
                    if (!roles.gallery || !roles.neighbours) throw err;
                    ph.note = 'Frågan för galleriet gick inte att köra (' + errText(err) + '). Bilderna är lästa med Härkomsts fråga, utan favoriter och papperskorg.';
                    q = roles.neighbours;
                    rows = Roles().mapRows(q, query(loaded, q, { window: { startMs: Date.UTC(1970, 0, 2), endMs: Date.UTC(2200, 0, 1) } }), ['created', 'added'], { raw: false });
                }
                if (roles.albums) {
                    try {
                        var links = albumLinks(loaded.sqlDb);
                        var albumRows = Roles().mapRows(roles.albums, query(loaded, roles.albums, {}), ['created'], { raw: false });
                        rows.forEach(function (r) { r.albums = links.links[r.pk] || []; });
                        ph.albums = ChatPhone.albumList(albumRows, rows);
                        ph.albumTables = links.tables;
                    } catch (err) { ph.note = 'Albumen kunde inte läsas: ' + errText(err); }
                }
                loaded.sqlDb.close();
                if (z !== state.zip) return;
                ph.items = ChatPhone.photoItems(rows);
                ph.db = hit.db.name;
                ph.platform = src.platform;
                ph.query = q;
                ph.state = 'ready';
            } catch (err) {
                ph.state = 'error';
                ph.note = errText(err);
            } finally {
                ph.loading = null;
                if (state.device.photos === ph && deviceShown()) renderDevice();
            }
        })();
        return ph.loading;
    }

    // Bilden i en ruta: telefonens tumnagel, annars originalet förminskat. null när ingen bild går att visa här.
    async function photoUrl(it) {
        var ph = state.device.photos, z = ph.zip;
        var thumb = ph.thumbs[it.key];
        if (thumb) return URL.createObjectURL(new Blob([(await ExtractionCore.readEntry(z.read, thumb)).bytes], { type: 'image/jpeg' }));
        var f = ph.files[it.key];
        if (!f || f.size > MAX_AUTO) return null;
        // HEIC: filens egen förhandsbild (iPhone lägger en på 240 × 320 i filen), avkodad i en egen tråd.
        if (it.heif && window.Heic) {
            var heic = (await ExtractionCore.readEntry(z.read, f)).bytes;
            if (!Heic.is(heic)) return null;
            var r = await Heic.toJpeg(heic, { preview: true, maxSide: 320 });
            ph.how[it.key] = r.from === 'preview' ? 'Förhandsbilden i HEIC-filen' : 'Avkodad ur HEIC-filen';
            return URL.createObjectURL(r.blob);
        }
        if (!it.drawable) return null;
        return smallUrl((await ExtractionCore.readEntry(z.read, f)).bytes, 320);
    }
    // En Apple-textur (.atx, ASTC) som JPEG, högst side bildpunkter i bredd (tools/_shared/astc.js).
    async function atxUrl(bytes, side) {
        var t = Astc.decodeAtx(bytes);
        var c = document.createElement('canvas');
        c.width = t.width;
        c.height = t.height;
        c.getContext('2d').putImageData(new ImageData(t.rgba, t.width, t.height), 0, 0);
        var k = Math.min(1, side / t.width), out = c;
        if (k < 1) {
            out = document.createElement('canvas');
            out.width = Math.round(t.width * k);
            out.height = Math.round(t.height * k);
            out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
        }
        var blob = await new Promise(function (resolve) { out.toBlob(resolve, 'image/jpeg', 0.85); });
        if (!blob) throw new Error('bilden kunde inte sparas som JPEG');
        return URL.createObjectURL(blob);
    }
    // En bild förminskad till högst side bildpunkter i bredd, som JPEG.
    async function smallUrl(bytes, side) {
        var bmp = await createImageBitmap(new Blob([bytes]), { resizeWidth: side, resizeQuality: 'medium' });
        var c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close();
        var blob = await new Promise(function (resolve) { c.toBlob(resolve, 'image/jpeg', 0.82); });
        return blob ? URL.createObjectURL(blob) : null;
    }

    // ---------- Hemskärmen och inställningarna ----------

    // Filerna i DeviceInfo.FILES, lästa ur zippen en gång per extraktion. read: filerna som lästes (till Källor),
    // missing: de som inte finns. home: hemskärmen eller null; names: appens namn efter id; sections: inställningarna.
    function loadDeviceInfo() {
        var z = state.zip, P = state.device;
        if (!z) return Promise.resolve(null);
        if (P.info && P.info.zip === z) return P.info.loading || Promise.resolve(P.info);
        var info = P.info = { zip: z, state: 'busy', platform: '', home: null, homePath: '', names: {}, icons: {}, sections: [], wall: {}, read: [], missing: [], notes: [], notifications: null, notifNote: '', loading: null };
        info.loading = (async function () {
            try {
                await loadSql();
                var entries = await ExtractionCore.find(z.read, z.file.size, function (name) { return !!DeviceInfo.fileOf(name); });
                var got = DeviceInfo.pick(entries);
                var has = function (id) { return !!(got[id] && got[id].length); };
                info.platform = has('iconState') || has('systemVersion') ? 'iOS' : DeviceInfo.FILES.some(function (f) { return f.platform === 'Android' && has(f.id); }) ? 'Android' : '';
                var label = function (id) { return DeviceInfo.FILES.filter(function (f) { return f.id === id; })[0].label; };
                var bytesOf = async function (id, x) {
                    var r = await ExtractionCore.readEntry(z.read, x.entry);
                    info.read.push({ id: id, label: label(id), name: x.entry.name, size: x.entry.size, crcOk: r.crcOk });
                    return r.bytes;
                };
                var one = async function (id, as) {
                    if (!has(id)) { info.missing.push(label(id)); return null; }
                    try {
                        var b = await bytesOf(id, got[id][0]);
                        return as === 'plist' ? DeviceInfo.plist(b, KC.bplist.parse) : as === 'text' ? new TextDecoder('utf-8').decode(b) : b;
                    } catch (err) { info.notes.push(label(id) + ' kunde inte läsas: ' + errText(err)); return null; }
                };
                // En databas med sin -wal, som Chattar läser sina: rows(sqlDb) ger raderna.
                var dbRows = async function (x, id, rows) {
                    var loaded = await ExtractionCore.loadDatabase(z.read, { db: x.entry, wal: x.wal }, [z.line], { share: { file: z.file } });
                    var db = new SQL.Database(ExtractionCore.noCopy(loaded.bytes));
                    try { info.read.push({ id: id, label: label(id), name: x.entry.name, size: x.entry.size, crcOk: loaded.dbCrcOk, wal: !!x.wal }); return rows(db); }
                    finally { db.close(); }
                };
                var select = function (db, sql) {
                    var r = db.exec(sql)[0];
                    return r ? r.values.map(function (v) { var o = {}; r.columns.forEach(function (c, i) { o[c] = v[i]; }); return o; }) : [];
                };
                var tables = function (db) { var r = db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]; return r ? r.values.map(function (v) { return String(v[0]); }) : []; };
                var sections = [];
                if (info.platform === 'iOS') {
                    // Appens namn ur Info.plist i varje paket.
                    for (var a of got.appInfo || []) {
                        try { var n = DeviceInfo.infoName(DeviceInfo.plist((await ExtractionCore.readEntry(z.read, a.entry)).bytes, KC.bplist.parse)); if (n) info.names[n.id] = n.name; } catch (e) { /* ett trasigt paket får sitt id som namn */ }
                    }
                    if (got.appInfo && got.appInfo.length) info.read.push({ id: 'appInfo', label: 'Info.plist', name: 'Bundle/Application/<GUID>/<App>.app/Info.plist', size: null, count: got.appInfo.length });
                    var icon = await one('iconState', 'plist');
                    if (icon) info.home = DeviceInfo.iosHome(icon, nameOfApp);
                    sections.push(DeviceInfo.iosAbout(await one('systemVersion', 'plist'), await one('netPrefs', 'plist'), await one('commcenter', 'plist')));
                    var known = await one('knownNetworks', 'plist');
                    sections.push({ id: 'wifi', title: 'Wi-Fi', networks: known ? DeviceInfo.iosWifi(known) : null, source: 'com.apple.wifi.known-networks.plist' });
                    var acc = null;
                    if (has('accountsIos')) {
                        try {
                            acc = await dbRows(got.accountsIos[0], 'accountsIos', function (db) {
                                return select(db, 'SELECT a.ZUSERNAME AS user, t.ZACCOUNTTYPEDESCRIPTION AS kind, a.ZDATE AS date FROM ZACCOUNT a LEFT JOIN ZACCOUNTTYPE t ON t.Z_PK = a.ZACCOUNTTYPE ORDER BY a.ZDATE')
                                    .map(function (r) { return { user: r.user, kind: r.kind, ms: typeof r.date === 'number' ? Math.round((r.date + 978307200) * 1000) : null }; });
                            });
                        } catch (err) { info.notes.push('Accounts3.sqlite kunde inte läsas: ' + errText(err)); }
                    } else info.missing.push('Accounts3.sqlite');
                    sections.push({ id: 'accounts', title: 'Konton', accounts: acc ? DeviceInfo.accounts(acc) : null, source: 'Accounts3.sqlite · ZACCOUNT, ZACCOUNTTYPE' });
                    // Lägen: flygplansläge, Wi-Fi, Bluetooth, plats, utseende, språk, Fokus, säkerhetskopian med mera.
                    var json = async function (id) { var tx = await one(id, 'text'); try { return tx ? JSON.parse(tx) : null; } catch (err) { info.notes.push(label(id) + ' kunde inte tolkas: ' + errText(err)); return null; } };
                    var locs = [];
                    for (var lx of got.locationd || []) { try { var lp = DeviceInfo.plist(await bytesOf('locationd', lx), KC.bplist.parse); if (lp) locs.push(lp); } catch (e) { /* nästa fil */ } }
                    if (!has('locationd')) info.missing.push(label('locationd'));
                    sections.push(DeviceInfo.iosToggles({
                        radios: await one('radios', 'plist'), wifi: await one('wifiPrefs', 'plist'), bt: await one('btServer', 'plist'), locs: locs,
                        style: await one('uiStyle', 'plist'), global: await one('globalPrefs', 'plist'), datetime: await one('datetime', 'plist'), springboard: await one('springboard', 'plist'),
                        focus: await json('focusModes'), focusOn: has('focusOn') ? await json('focusOn') : null, backup: await one('backup', 'plist'), buddy: await one('buddy', 'plist'),
                    }));
                    // Bluetooth: parkopplade enheter (Bluetooth LE i en databas, klassiska i en plist).
                    var paired = null, classic = has('btDevices') ? await one('btDevices', 'plist') : null;
                    if (has('btPaired')) {
                        try { paired = await dbRows(got.btPaired[0], 'btPaired', function (db) { return tables(db).indexOf('PairedDevices') >= 0 ? select(db, 'SELECT * FROM PairedDevices') : []; }); }
                        catch (err) { info.notes.push(label('btPaired') + ' kunde inte läsas: ' + errText(err)); }
                    }
                    sections.push({ id: 'bluetooth', title: 'Bluetooth', bluetooth: paired || classic ? DeviceInfo.iosBluetooth(paired, classic) : null,
                        source: [paired ? 'com.apple.MobileBluetooth.ledevices.paired.db · PairedDevices' : '', classic ? 'com.apple.MobileBluetooth.devices.plist' : ''].filter(Boolean).join(' och ') || 'com.apple.MobileBluetooth.ledevices.paired.db',
                        foot: paired ? 'PairedDevices: Name, Address, LastConnectionTime, LastSeenTime (Unix-sekunder)' : 'en nyckel per adress: Name, LastSeenTime' });
                    // Bakgrunden: den valda postern i PosterBoard och dess bild av hemskärmen och låsskärmen (ASTC).
                    var wrowsI = [];
                    if (has('posterDb') && window.Astc) {
                        try {
                            var choice = await dbRows(got.posterDb[0], 'posterDb', function (db) {
                                var tb = tables(db);
                                if (tb.indexOf('poster') < 0 || tb.indexOf('posterRoleMembership') < 0) return null;
                                return DeviceInfo.posterChoice(select(db, 'SELECT * FROM poster'), select(db, 'SELECT * FROM posterRoleMembership'), tb.indexOf('posterAttributes') >= 0 ? select(db, 'SELECT * FROM posterAttributes') : []);
                            });
                            if (choice) {
                                var dbName = 'PBFPosterExtensionDataStoreSQLiteDatabase.sqlite3';
                                wrowsI.push(DeviceInfo.row('Vald bakgrund', choice.name || choice.provider, dbName + ' · posterAttributes/SELECTED, poster/providerId',
                                    choice.how === 'latest' ? 'Ingen poster är markerad som vald (SELECTED), så den som ändrades senast visas.' : ''));
                                wrowsI.push(DeviceInfo.row('Postern', choice.provider + ' · ' + choice.uuid, dbName + ' · poster'));
                                if (choice.count > 1) wrowsI.push(DeviceInfo.row('Sparade bakgrunder', many(choice.count, 'poster', 'posters') + ' för låsskärmen', dbName + ' · posterRoleMembership'));
                                var snaps = DeviceInfo.posterSnapshots((got.posterSnap || []).map(function (x) { return x.entry.name; }), choice.uuid);
                                for (var wk of ['home', 'lock']) {
                                    var wl = wk === 'home' ? 'Hemskärm' : 'Låsskärm', sn = snaps[wk];
                                    var sx = sn ? got.posterSnap.filter(function (x) { return x.entry.name === sn.name; })[0] : null;
                                    if (!sx) { wrowsI.push(DeviceInfo.row(wl, 'Ingen bild i ' + Z(), 'RuntimeSnapshot-' + wk + '.atx')); continue; }
                                    try {
                                        info.wall[wk] = await atxUrl(await bytesOf('posterSnap', sx), 720);
                                        wrowsI.push(DeviceInfo.row(wl, 'Telefonens bild av skärmen (Apple-textur, ASTC)', sx.entry.name));
                                    } catch (err) { wrowsI.push(DeviceInfo.row(wl, 'Kunde inte ritas: ' + errText(err), sx.entry.name)); }
                                }
                            }
                        } catch (err) { info.notes.push(label('posterDb') + ' kunde inte läsas: ' + errText(err)); }
                    }
                    // Före iOS 16: SpringBoards lilla JPEG-bild.
                    for (var ow of got.oldWall || []) {
                        var wk2 = /LockBackground/.test(ow.entry.name) ? 'lock' : 'home';
                        if (info.wall[wk2]) continue;
                        try { info.wall[wk2] = await smallUrl(await bytesOf('oldWall', ow), 720); wrowsI.push(DeviceInfo.row(wk2 === 'home' ? 'Hemskärm' : 'Låsskärm', 'Bild (JPEG)', ow.entry.name)); } catch (e) { /* nästa fil */ }
                    }
                    if (!wrowsI.length) { info.missing.push('PosterBoard'); wrowsI.push(DeviceInfo.row('Hemskärm och låsskärm', 'Inte läst', 'PosterBoard', 'Varken PosterBoards databas eller SpringBoards bild finns i ' + Z() + '.')); }
                    sections.push({ id: 'wallpaper', title: 'Bakgrund', rows: wrowsI, wall: info.wall });
                } else if (info.platform === 'Android') {
                    var abx = window.ProvenanceAndroidLogs.abxParse;
                    var settings = async function (id) { var b = await one(id, 'bytes'); try { return b ? DeviceInfo.settingsMap(b, abx) : {}; } catch (err) { info.notes.push(label(id) + ' kunde inte tolkas: ' + errText(err)); return {}; } };
                    var global = await settings('settingsGlobal'), secure = await settings('settingsSecure'), system = await settings('settingsSystem');
                    var props = [];
                    for (var bp of got.buildProp || []) { try { props.push(new TextDecoder('utf-8').decode(await bytesOf('buildProp', bp))); } catch (e) { /* nästa fil */ } }
                    if (!props.length) info.missing.push('build.prop');
                    // Hemskärmen: One UI först, annars den Launcher3-databas som ändrades senast och har favorites.
                    if (has('oneUi')) {
                        try {
                            info.home = await dbRows(got.oneUi[0], 'oneUi', function (db) { return DeviceInfo.oneUiHome(select(db, 'SELECT * FROM item'), select(db, 'SELECT * FROM item_group')); });
                            info.homePath = got.oneUi[0].entry.name;
                            Object.keys(info.home.names || {}).forEach(function (k) { if (!info.names[k]) info.names[k] = info.home.names[k]; });
                        } catch (err) { info.notes.push('OneUI.db kunde inte läsas: ' + errText(err)); }
                    }
                    if (!info.home && has('launcher3')) {
                        var list = got.launcher3.slice().sort(function (a, b) { return (b.entry.mtime || 0) - (a.entry.mtime || 0); });
                        for (var l of list) {
                            try {
                                // En launcher med ett annat schema (Huawei, äldre Samsung) sägs i Inställningar → Källor, med sina
                                // tabeller, så att den går att läsa i Queries.
                                var h = await dbRows(l, 'launcher3', function (db) {
                                    var t = tables(db);
                                    if (t.indexOf('favorites') < 0) { info.notes.push(baseName(l.entry.name) + ' (' + l.entry.name.split('/databases/')[0].split('/').pop() + ') har ingen tabell favorites, så hemskärmen kan inte läsas ur den. Tabellerna: ' + t.join(', ') + '.'); return null; }
                                    var rows = select(db, 'SELECT * FROM favorites');
                                    if (!rows.length) info.notes.push(baseName(l.entry.name) + ': tabellen favorites är tom.');
                                    return DeviceInfo.launcher3Home(rows, l.entry.name);
                                });
                                if (h && h.pages.length) { info.home = h; info.homePath = l.entry.name; break; }
                            } catch (err) { info.notes.push(baseName(l.entry.name) + ' kunde inte läsas: ' + errText(err)); }
                        }
                    }
                    if (info.home) DeviceInfo.homeAppIds(info.home).forEach(function (x) { if (x.name && x.name !== x.id && !info.names[x.id]) info.names[x.id] = x.name; });
                    // Ikonerna som telefonen ritar: launcherns ikoncache (app_icons.db i samma app som hemskärmen), och ikonen
                    // som launchern sparade på hemskärmens rad.
                    if (has('iconCache')) {
                        var dir = info.homePath ? info.homePath.slice(0, info.homePath.lastIndexOf('/')) : '';
                        var cacheX = got.iconCache.filter(function (x) { return dir && x.entry.name.slice(0, x.entry.name.lastIndexOf('/')) === dir; })[0] || got.iconCache[0];
                        try {
                            var cache = await dbRows(cacheX, 'iconCache', function (db) { return tables(db).indexOf('icons') >= 0 ? DeviceInfo.iconCache(select(db, 'SELECT * FROM icons')) : {}; });
                            Object.keys(cache).forEach(function (k) {
                                info.icons[k] = URL.createObjectURL(new Blob([cache[k].icon], { type: 'image/png' }));
                                if (cache[k].label && !info.names[k]) info.names[k] = cache[k].label;
                            });
                        } catch (err) { info.notes.push('app_icons.db kunde inte läsas: ' + errText(err)); }
                    }
                    if (info.home) {
                        var own = function (it) { if (it && it.kind === 'app' && it.icon && it.id && !info.icons[it.id]) info.icons[it.id] = URL.createObjectURL(new Blob([it.icon], { type: 'image/png' })); };
                        info.home.pages.forEach(function (pg) { pg.forEach(function (c) { own(c.item); if (c.item.kind === 'folder') c.item.items.forEach(own); }); });
                        info.home.dock.forEach(own);
                    }
                    sections.push(DeviceInfo.androidAbout(DeviceInfo.buildProps(props), global, secure));
                    sections.push(DeviceInfo.androidToggles(global, secure, system));
                    var wifiTexts = [];
                    for (var w of got.wifiStore || []) { try { wifiTexts.push(new TextDecoder('utf-8').decode(await bytesOf('wifiStore', w))); } catch (e) { /* nästa fil */ } }
                    if (!wifiTexts.length) info.missing.push('WifiConfigStore.xml');
                    sections.push({ id: 'wifi', title: 'Wi-Fi', networks: wifiTexts.length ? DeviceInfo.androidWifi(wifiTexts.filter(function (t) { return /^\s*</.test(t); })) : null, source: 'WifiConfigStore.xml', abx: wifiTexts.some(function (t) { return /^ABX/.test(t); }) });
                    var bt = await one('btConfig', 'text');
                    sections.push({ id: 'bluetooth', title: 'Bluetooth', bluetooth: bt ? DeviceInfo.androidBluetooth(bt) : null, source: 'bt_config.conf' });
                    var accA = null;
                    if (has('accountsAndroid')) {
                        try {
                            accA = await dbRows(got.accountsAndroid[0], 'accountsAndroid', function (db) {
                                return select(db, 'SELECT * FROM accounts').map(function (r) { var t = r.last_password_entry_time_millis_epoch; return { user: r.name, kind: r.type, ms: typeof t === 'number' && t > 0 ? t : null }; });
                            });
                        } catch (err) { info.notes.push('accounts_ce.db kunde inte läsas: ' + errText(err)); }
                    } else info.missing.push('accounts_ce.db');
                    sections.push({ id: 'accounts', title: 'Konton', accounts: accA ? DeviceInfo.accounts(accA) : null, source: 'accounts_ce.db · accounts' });
                    // Bakgrunden: en bildfil utan ändelse. Saknas den visar telefonen sin egen standardbild.
                    var wpInfo = {};
                    try { var wb = await one('wallpaperInfo', 'bytes'); if (wb) wpInfo = DeviceInfo.wallpaperInfo(wb, abx); } catch (err) { info.notes.push('wallpaper_info.xml kunde inte tolkas: ' + errText(err)); }
                    var wrows = [];
                    // Samsung sparar ingen fil wallpaper för standardbilden, men en miniatyr av bakgrunden (wallpaper_thumbs, en mapp
                    // med udda nummer är hemskärmen) och låsskärmens bild (wallpaper_lock_images).
                    var thumbs = (got.wallpaperThumb || []).slice().sort(function (a, b) { var n = function (x) { return Number((/wallpaper_thumbs\/(\d+)\//.exec(x.entry.name) || [])[1]) & 1 ? 0 : 1; }; return n(a) - n(b); });
                    for (var which of [['wallpaper', 'home', 'Hemskärm'], ['wallpaperLock', 'lock', 'Låsskärm']]) {
                        var x = (got[which[0]] || [])[0], xid = which[0], alt = '';
                        if (!x && which[1] === 'home' && thumbs.length) { x = thumbs[0]; xid = 'wallpaperThumb'; alt = 'Samsungs miniatyr av bakgrunden'; }
                        if (!x && which[1] === 'lock' && (got.wallpaperLockImg || []).length) { x = got.wallpaperLockImg[0]; xid = 'wallpaperLockImg'; alt = 'Samsungs bild för låsskärmen'; }
                        if (x) {
                            var wbytes = await bytesOf(xid, x), type = DeviceInfo.imageType(wbytes);
                            if (type && type !== 'image/heif') info.wall[which[1]] = await smallUrl(wbytes, 720).catch(function () { return null; });
                            wrows.push(DeviceInfo.row(which[2], type ? 'Bild (' + type.replace('image/', '').toUpperCase() + ', ' + ChatCore.sizeText(x.entry.size) + ')' : 'Filen är ingen bild som går att visa', x.entry.name, alt ? alt + '. Filen wallpaper finns inte, och telefonen visar då sin standardbild.' : ''));
                        } else if (which[1] === 'lock' && wpInfo.home && !wpInfo.lock) {
                            wrows.push(DeviceInfo.row(which[2], 'Samma som hemskärmen', 'wallpaper_info.xml', 'Filen har ingen egen låsskärm (kwp), och då visar Android hemskärmens bakgrund där också.'));
                        } else wrows.push(DeviceInfo.row(which[2], wpInfo[which[1]] ? 'Ingen egen bild i ' + Z() : 'Inte läst', label(which[0]), wpInfo[which[1]] ? 'Filen ' + label(which[0]) + ' finns inte. Telefonen visar då oftast sin standardbakgrund.' : ''));
                        if (wpInfo[which[1]]) wrows.push(DeviceInfo.row(which[2] + ', komponent', wpInfo[which[1]], 'wallpaper_info.xml · ' + (which[1] === 'home' ? 'wp' : 'kwp')));
                    }
                    sections.push({ id: 'wallpaper', title: 'Bakgrund', rows: wrows, wall: info.wall });
                }
                if (!info.home && !has('oneUi') && !has('launcher3')) info.missing.push(info.platform === 'iOS' ? 'IconState.plist' : info.platform === 'Android' ? 'OneUI.db eller launcher.db' : 'hemskärmens fil');
                // Notiserna till låsskärmen: Androids notishistorik, eller Biomes Notification.Usage på iOS.
                if (info.platform === 'Android') {
                    if (has('notifHistory')) {
                        var list = [];
                        for (var nh of got.notifHistory) {
                            try { DeviceInfo.notificationHistory(await bytesOf('notifHistory', nh)).forEach(function (n) { n.file = nh.entry.name; list.push(n); }); }
                            catch (err) { info.notes.push(baseName(nh.entry.name) + ' i notification_history kunde inte tolkas: ' + errText(err)); }
                        }
                        info.notifications = list;
                        info.notifNote = 'Ur Androids notishistorik (system_ce/0/notification_history/history/, ' + many(got.notifHistory.length, 'fil', 'filer') + '). Android sparar notiserna ungefär ett dygn, och bara när Notishistorik är påslagen.';
                    } else { info.missing.push('notification_history'); info.notifNote = 'Androids notishistorik finns inte i ' + Z() + '. Den sparas bara när Notishistorik är påslagen i telefonen.'; }
                } else if (info.platform === 'iOS') {
                    if (has('biomeNotif') && window.ProvenanceBiome) {
                        var rowsB = [];
                        for (var bf of got.biomeNotif) {
                            try { ProvenanceBiome.notificationUsage(await bytesOf('biomeNotif', bf)).rows.forEach(function (r) { r.file = bf.entry.name; rowsB.push(r); }); }
                            catch (err) { info.notes.push(baseName(bf.entry.name) + ' i Biome kunde inte tolkas: ' + errText(err)); }
                        }
                        var files = {};
                        rowsB.forEach(function (r) { files[r.id || r.eventId] = { file: r.file, offset: r.offset }; });
                        info.notifications = ProvenanceBiome.notifications(rowsB).map(function (n) {
                            var at = files[n.id] || {};
                            return { app: n.app, ms: n.ms, title: DeviceInfo.clean(n.title || ''), text: '', events: n.events, copies: n.copies || 1, id: n.id, file: at.file || '', offset: at.offset };
                        });
                        info.notifNote = 'Ur Biome (Notification.Usage/local): appen, titeln och tiden för varje notis. Texten sparas inte där. För Snapchat är titeln avsändarens namn.';
                    } else { info.missing.push('Biome Notification.Usage'); info.notifNote = 'Biomes Notification.Usage finns inte i ' + Z() + '.'; }
                }
                if (info.notifications) info.notifications.sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });
                // Anteckningarna: Apples Anteckningar eller Samsung Notes (Notes, tools/_shared/notes.js).
                var noteId = info.platform === 'iOS' ? 'appleNotes' : info.platform === 'Android' ? 'samsungNotes' : '';
                if (noteId && has(noteId) && window.Notes) {
                    try {
                        var memo = await dbRows(got[noteId][0], noteId, function (db) { return Notes.read(db); });
                        if (memo) { memo.file = got[noteId][0].entry.name; info.memos = memo; }
                    } catch (err) { info.notes.push(label(noteId) + ' kunde inte läsas: ' + errText(err)); }
                } else if (noteId) info.missing.push(label(noteId));
                info.sections = sections;
                info.state = z === state.zip ? 'ready' : 'gone';
            } catch (err) {
                info.state = 'error';
                info.notes.push(errText(err));
            } finally {
                info.loading = null;
                if (state.device.info === info && deviceShown()) renderDevice();
            }
        })();
        return info.loading;
    }

    function deviceShown() { return !$('c-device').classList.contains('display-none'); }
    function openDevice(screen, app, opts) {
        var P = state.device;
        screen = screen || 'home';
        if (P.screen !== screen || P.app !== (app || '')) P.limit = LIST_STEP;
        if (screen === 'app' && P.app !== (app || '')) P.appQuery = '';
        if (screen === 'home') { P.query = ''; P.setQuery = ''; }
        P.on = true;
        P.screen = screen;
        P.app = app || '';
        if (opts && opts.filter !== undefined) P.filter = opts.filter;
        if (opts && opts.section !== undefined) P.section = opts.section;
        if (P.gallery) { P.gallery.destroy(); P.gallery = null; }
        closeSheet();
        closePop();
        $('c-view').classList.add('display-none');
        $('c-empty').classList.add('display-none');
        $('c-device').classList.remove('display-none');
        $('c-device-open').setAttribute('aria-pressed', 'true');
        renderDevice();
        if (screen !== 'photos') $('c-device-body').scrollTop = 0;
    }
    function hideDevice() {
        if (state.device.gallery) { state.device.gallery.destroy(); state.device.gallery = null; }
        closeSheet();
        $('c-device').classList.add('display-none');
        $('c-device-open').setAttribute('aria-pressed', 'false');
    }

    // Vart knappen tillbaka går, och vad den heter.
    function backOf(P) {
        // Öppnat ur sökningen: tillbaka till träffarna. Ur kontrollcentret: tillbaka dit.
        if (P.fromSearch && /^(contact|note|webItem|setting|appInfo)$/.test(P.screen)) return { screen: 'search', text: 'Sök' };
        if (P.fromControl && P.screen === 'setting') return { screen: 'control', text: devicePlatform() === 'Android' ? 'Snabbinställningar' : 'Kontrollcenter' };
        if (P.screen === 'photos' && P.filter !== 'all') return { screen: 'albums', text: 'Album' };
        if (P.screen === 'setting') return { screen: 'settings', text: 'Inställningar' };
        if (P.screen === 'note') return { screen: 'notes', text: 'Anteckningar' };
        if (P.screen === 'memory') return { screen: 'memories', text: 'Memories', app: 'Snapchat' };
        if (P.screen === 'memories') return { screen: 'app', text: 'Snapchat', app: 'Snapchat' };
        if (P.screen === 'call') return { screen: 'calls', text: 'Samtal' };
        if (P.screen === 'webItem') { var wbB = webBrowser(P.web); return { screen: 'web', text: wbB ? wbB.name : 'Tillbaka' }; }
        if (P.screen === 'appInfo') return P.appInfoFrom === 'settings' ? { screen: 'settings', text: 'Inställningar' } : { screen: 'app', text: P.appInfo, app: P.appInfo };
        if (P.screen === 'contact') return { screen: P.contactFrom === 'call' ? 'call' : 'contacts', text: P.contactFrom === 'call' ? 'Samtalet' : 'Kontakter' };
        return { screen: 'home', text: 'Hem' };
    }

    function renderDevice() {
        var P = state.device, body = $('c-device-body');
        if (P.gallery && P.screen !== 'photos') { P.gallery.destroy(); P.gallery = null; }
        $('c-device-phone').dataset.frame = deviceFrame();
        var back = backOf(P);
        $('c-device-back').classList.toggle('display-none', P.screen === 'home');
        $('c-device-back-text').textContent = back.text;
        $('c-device-tabs').classList.toggle('display-none', !(P.screen === 'photos' && P.filter === 'all') && P.screen !== 'albums');
        $('c-device-tabs').querySelectorAll('[data-device-tab]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.deviceTab === (P.screen === 'albums' ? 'albums' : 'library'))); });
        if (!P.gallery) body.className = 'c-device-body ' + P.screen;
        // Bakgrunden hör till hemskärmen och låsskärmen, som sätter den själva.
        body.style.backgroundImage = '';
        if (!state.zip) {
            $('c-device-title').textContent = 'Ingen extraktion';
            $('c-device-sub').textContent = '';
            body.innerHTML = '<p class="d-empty">Öppna en extraktion i raden högst upp, så visas telefonen i den här.</p>';
            return;
        }
        if (P.screen === 'home') renderHome(body);
        else if (P.screen === 'app') renderAppList(body);
        else if (P.screen === 'albums') renderAlbums(body);
        else if (P.screen === 'settings') renderSettings(body);
        else if (P.screen === 'setting') renderSetting(body);
        else if (P.screen === 'lock') renderLock(body);
        else if (P.screen === 'notes') renderNotes(body);
        else if (P.screen === 'note') renderNote(body);
        else if (P.screen === 'calls') renderCalls(body);
        else if (P.screen === 'call') renderCall(body);
        else if (P.screen === 'contacts') renderContacts(body);
        else if (P.screen === 'contact') renderContact(body);
        else if (P.screen === 'web') renderWeb(body);
        else if (P.screen === 'webItem') renderWebItem(body);
        else if (P.screen === 'search') renderSearch(body);
        else if (P.screen === 'appInfo') renderAppInfo(body);
        else if (P.screen === 'control') renderControl(body);
        else if (P.screen === 'memories') renderMemories(body);
        else if (P.screen === 'memory') renderMemory(body);
        else renderPhotos(body);
    }

    // Ikonen för en app på hemskärmen. Apparna med data i Chattar, Bilder och Inställningar går att öppna; de andra
    // visar ett ark med vad som är känt om dem.
    function homeAppHtml(it, apps, ph, where) {
        var br = webBrowser(it.id);
        if (br) return webAppHtml(br, it.name || nameOfApp(it.id) || br.name, it.id);
        var role = DeviceInfo.roleOf(it.id), name = it.name || nameOfApp(it.id), badge = '', label = name;
        var chat = apps.filter(function (a) { return a.app === role; })[0];
        if (chat) { badge = badgeHtml(chat.busy, chat.error, chat.count); label += ', ' + (chat.busy ? 'läses' : many(chat.count, 'chatt', 'chattar')); }
        else if (role === 'Bilder' && ph && ph.state !== 'none') { badge = badgeHtml(ph.state === 'busy', ph.state === 'error', ph.items.length); label += ', ' + (ph.state === 'ready' ? many(ph.items.length, 'bild', 'bilder') : ph.state === 'busy' ? 'läses' : 'kunde inte läsas'); }
        var memos = role === 'Anteckningar' ? deviceMemos() : null;
        if (memos) { badge = badgeHtml(false, false, memos.notes.length); label += ', ' + many(memos.notes.length, 'anteckning', 'anteckningar'); }
        var cm = deviceComms(), calls = role === 'Telefon' && cm && cm.calls ? cm.calls : null, people = role === 'Kontakter' && cm && cm.contacts ? cm.contacts.list : null;
        if (calls) { badge = badgeHtml(false, false, calls.length); label += ', ' + many(calls.length, 'samtal', 'samtal'); }
        if (people) { badge = badgeHtml(false, false, people.length); label += ', ' + many(people.length, 'kontakt', 'kontakter'); }
        var data = chat ? ' data-device-app="' + esc(role) + '"' : role === 'Bilder' ? ' data-device-photos="1"' : role === 'Inställningar' ? ' data-device-settings="1"' : memos ? ' data-device-notes="1"' :
            calls ? ' data-device-calls="1"' : people ? ' data-device-contacts="1"' : ' data-home-app="' + esc(it.id) + '" data-where="' + esc(where) + '"';
        return '<button type="button" class="d-app' + (chat || role ? ' has-data' : '') + '"' + data + ' aria-label="' + esc(label) + '" title="' + esc(name + (it.id ? ' · ' + it.id : '')) + '">' +
            iconHtml(chat || role === 'Bilder' || role === 'Inställningar' || memos || calls || people ? role : '', badge, name, phoneIcon(it.id)) + '<span class="d-name">' + esc(name) + '</span></button>';
    }
    function cellHtml(c, apps, ph, where, key) {
        var style = 'grid-column:' + (c.x + 1) + ' / span ' + c.w + ';grid-row:' + (c.y + 1) + ' / span ' + c.h;
        var it = c.item;
        if (it.kind === 'widget') {
            var info = state.device.info, owner = DeviceInfo.widgetName(it, info ? info.names : null, APP_CATALOG);
            return '<div class="d-widget" style="' + style + '" title="' + esc((it.provider || it.app) + (it.count > 1 ? ' · ' + it.count + ' widgetar i en stapel' : '')) + '"><span class="d-widget-name">' + esc(owner || 'Widget') + '</span><span class="d-widget-kind">' + (it.count > 1 ? 'Widgetstapel (' + it.count + ')' : 'Widget') + '</span></div>';
        }
        if (it.kind === 'folder') {
            var mini = it.items.slice(0, 9).map(function (x) { var u = phoneIcon(x.id); return u ? '<i style="background:center / cover url(&quot;' + esc(u) + '&quot;)"></i>' : '<i style="background:' + (APP_ICON[DeviceInfo.roleOf(x.id)] || [hueOf(x.name || x.id)])[0] + '"></i>'; }).join('');
            return '<button type="button" class="d-app d-folder" style="' + style + '" data-folder="' + esc(key) + '" aria-label="' + esc('Mappen ' + it.name + ', ' + many(it.items.length, 'app', 'appar')) + '"><span class="d-icon d-folder-icon" aria-hidden="true">' + mini + '</span><span class="d-name">' + esc(it.name) + '</span></button>';
        }
        return '<div class="d-cell" style="' + style + '">' + homeAppHtml(it, apps, ph, where) + '</div>';
    }

    // Apparna med data som inte ligger på hemskärmen: { name, html }.
    function extraApps(apps, ph, info, home) {
        var onHome = {};
        if (home) DeviceInfo.homeAppIds(home).forEach(function (x) { var r = DeviceInfo.roleOf(x.id); if (r) onHome[r] = true; });
        var extra = [];
        apps.forEach(function (a) { if (!onHome[a.app]) extra.push({ kind: 'app', id: '', name: a.app, role: a.app }); });
        if (ph && ph.state !== 'none' && !onHome.Bilder) extra.push({ kind: 'app', id: '', name: 'Bilder', role: 'Bilder' });
        if (info && info.state === 'ready' && info.platform && !onHome['Inställningar']) extra.push({ kind: 'app', id: '', name: 'Inställningar', role: 'Inställningar' });
        if (deviceMemos() && !onHome.Anteckningar) extra.push({ kind: 'app', id: '', name: 'Anteckningar', role: 'Anteckningar' });
        var cmx = deviceComms();
        if (cmx && cmx.calls && !onHome.Telefon) extra.push({ kind: 'app', id: '', name: 'Telefon', role: 'Telefon' });
        if (cmx && cmx.contacts && !onHome.Kontakter) extra.push({ kind: 'app', id: '', name: 'Kontakter', role: 'Kontakter' });
        var homeIds = {};
        if (home) DeviceInfo.homeAppIds(home).forEach(function (x) { homeIds[x.id] = true; });
        var wb = deviceWeb();
        if (wb) wb.browsers.forEach(function (b) { if (!homeIds[b.id]) extra.push({ kind: 'web', id: b.id, name: b.name, role: '' }); });
        return extra.map(function (e) {
            return { name: e.name, html: extraHtml(e) };
        });
        function extraHtml(e) {
            if (e.kind === 'web') return webAppHtml(webBrowser(e.id), e.name, e.id);
            var chat = apps.filter(function (a) { return a.app === e.role; })[0];
            if (e.role === 'Bilder') return '<button type="button" class="d-app has-data" data-device-photos="1" aria-label="' + esc('Bilder, ' + (ph.state === 'ready' ? many(ph.items.length, 'bild', 'bilder') : ph.state === 'busy' ? 'läses' : 'kunde inte läsas')) + '">' +
                iconHtml('Bilder', badgeHtml(ph.state === 'busy', ph.state === 'error', ph.items.length), 'Bilder', phoneIcon('', 'Bilder')) + '<span class="d-name">Bilder</span></button>';
            if (e.role === 'Inställningar') return '<button type="button" class="d-app has-data" data-device-settings="1" aria-label="Inställningar">' + iconHtml('Inställningar', '', 'Inställningar', phoneIcon('', 'Inställningar')) + '<span class="d-name">Inställningar</span></button>';
            if (e.role === 'Telefon' || e.role === 'Kontakter') {
                var cn = e.role === 'Telefon' ? cmx.calls.length : cmx.contacts.list.length, cw = e.role === 'Telefon' ? many(cn, 'samtal', 'samtal') : many(cn, 'kontakt', 'kontakter');
                return '<button type="button" class="d-app has-data" ' + (e.role === 'Telefon' ? 'data-device-calls="1"' : 'data-device-contacts="1"') + ' aria-label="' + esc(e.role + ', ' + cw) + '">' + iconHtml(e.role, badgeHtml(false, false, cn), e.role, phoneIcon('', e.role)) + '<span class="d-name">' + esc(e.role) + '</span></button>';
            }
            if (e.role === 'Anteckningar') { var mm = deviceMemos(); return '<button type="button" class="d-app has-data" data-device-notes="1" aria-label="' + esc('Anteckningar, ' + many(mm.notes.length, 'anteckning', 'anteckningar')) + '">' + iconHtml('Anteckningar', badgeHtml(false, false, mm.notes.length), 'Anteckningar', phoneIcon('', 'Anteckningar')) + '<span class="d-name">Anteckningar</span></button>'; }
            return '<button type="button" class="d-app has-data" data-device-app="' + esc(e.role) + '" aria-label="' + esc(e.role + ', ' + (chat.busy ? 'läses' : many(chat.count, 'chatt', 'chattar'))) + '">' +
                iconHtml(e.role, badgeHtml(chat.busy, chat.error, chat.count), e.role, phoneIcon('', e.role)) + '<span class="d-name">' + esc(e.role) + '</span></button>';
        }
    }

    function renderHome(body) {
        var P = state.device, apps = ChatPhone.homeApps(state.dbs);
        if (!P.photos || P.photos.zip !== state.zip) loadPhotos();
        if (!P.info || P.info.zip !== state.zip) loadDeviceInfo();
        var ph = P.photos, info = P.info, home = info && info.state === 'ready' ? info.home : null;
        var about = info && info.sections ? info.sections.filter(function (s) { return s.id === 'about'; })[0] : null;
        var devName = about && about.rows.filter(function (r) { return r.label === 'Namn'; })[0];
        $('c-device-title').textContent = devName ? devName.value : state.zip.file.name.replace(/\.(zip|ufdr)$/i, '');
        // Apparna med data som inte ligger på hemskärmen (i applådan eller appbiblioteket) får en egen sida sist.
        var extraCells = extraApps(apps, ph, info, home).map(function (x) { return x.html; });
        var pages = home ? home.pages.slice() : [];
        var pageCount = pages.length + (extraCells.length ? 1 : 0);
        if (P.page >= pageCount) P.page = Math.max(0, pageCount - 1);
        var html = '', wall = info && info.wall && info.wall.home;
        if (P.page < pages.length) {
            var page = pages[P.page];
            html = '<div class="d-page" style="grid-template-columns:repeat(' + home.cols + ',1fr)">' + page.map(function (c, i) { return cellHtml(c, apps, ph, 'sida ' + (P.page + 1), 'p' + P.page + ':' + i); }).join('') + '</div>';
        } else if (extraCells.length) {
            html = (home ? '<p class="d-page-title">Med data, inte på hemskärmen</p>' : '') + '<div class="d-grid">' + extraCells.join('') + '</div>';
        } else {
            html = '<p class="d-empty">' + (info && info.state === 'busy' ? '<span class="c-spin" aria-hidden="true"></span> Läser hemskärmen…' : 'Extraktionen har ingen databas för chattapparna eller bildbiblioteket.') + '</p>';
        }
        var dots = pageCount > 1 ? '<div class="d-dots" role="group" aria-label="Sidor">' + (pageCount > 1 ? '<button type="button" class="d-nav" data-page-step="-1" aria-label="Föregående sida"' + (P.page ? '' : ' disabled') + '>‹</button>' : '') +
            Array.from({ length: pageCount }, function (_, i) { return '<button type="button" class="d-dot" data-page="' + i + '" aria-label="Sida ' + (i + 1) + (i === pages.length ? ', appar med data' : '') + '" aria-pressed="' + (i === P.page) + '"></button>'; }).join('') +
            '<button type="button" class="d-nav" data-page-step="1" aria-label="Nästa sida"' + (P.page < pageCount - 1 ? '' : ' disabled') + '>›</button></div>' : '';
        var dock = home && home.dock.length ? '<div class="d-dock" style="grid-template-columns:repeat(' + Math.max(4, home.dock.length) + ',1fr)">' + home.dock.map(function (it, i) {
            return it.kind === 'folder' ? cellHtml({ x: i, y: 0, w: 1, h: 1, item: it }, apps, ph, 'dockan', 'd:' + i) : '<div class="d-cell">' + homeAppHtml(it, apps, ph, 'dockan') + '</div>';
        }).join('') + '</div>' : '';
        var sources = home ? 'Hemskärmen ur ' + home.source + (home.computed ? ': ordningen är telefonens, platsen på sidan är uträknad' : ', med platserna som telefonen sparade dem') + '. ' : info && info.state === 'ready' ? 'Hemskärmens ordning finns inte i ' + Z() + ', så bara apparna med data visas. ' : '';
        $('c-device-sub').textContent = [devicePlatform(), home ? many(home.pages.length, 'sida', 'sidor') + ' · ' + home.source : many(extraCells.length, 'app med data', 'appar med data')].filter(Boolean).join(' · ');
        body.classList.toggle('has-wall', !!wall);
        body.style.backgroundImage = wall ? 'url("' + wall + '")' : '';
        var notifs = info && info.notifications;
        var pill = notifs ? '<button type="button" class="d-pill" data-device-lock="1" title="Låsskärmen med notiserna. Dra nedåt från överkanten, som i telefonen.">' + esc(many(notifs.length, 'notis', 'notiser')) + ' ›</button>' : '';
        var find = '<button type="button" class="d-search-pill" data-device-search="1" title="Sök bland apparna, kontakterna, konversationerna, anteckningarna, webben och inställningarna. Det räcker att börja skriva."><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15.5 15.5l5 5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>Sök</button>';
        body.innerHTML = '<div class="d-home">' + statusBarHtml() + pill + '<div class="d-screen">' + html + '</div>' + dots + find + dock + '</div>' +
            '<p class="d-note">' + esc(sources) + 'Siffran är antalet chattar eller bilder som lästes ur appens databas. Appar utan data i ' + esc(Z()) + ' går att trycka på men öppnas inte. ' + (info && Object.keys(info.icons || {}).length ? 'Ikonerna är telefonens egna ur launcherns app_icons.db, och verktygets där telefonen inte hade någon' : 'Ikonerna är verktygets egna') + (wall ? '; bakgrunden är telefonens egen bild' : '') + '.</p>';
        fitHome(body);
    }

    // Hemskärmen fyller telefonens skärm: sidan, prickarna och dockan syns utan att rulla. Ett större rutnät
    // (till exempel 5 × 6 på en stor Samsung) ritas mindre så att det får plats; noten står under.
    function fitHome(body) {
        var scr = body.querySelector('.d-home .d-screen');
        if (!scr) return;
        scr.style.fontSize = '';
        var h = scr.clientHeight, w = scr.clientWidth, nh = scr.scrollHeight, nw = scr.scrollWidth;
        if (!h || !w) return;
        var k = Math.min(1, h / nh, w / nw);
        if (k < 1) scr.style.fontSize = Math.max(0.6, Math.floor(k * 100) / 100) + 'em';
    }

    function appOf(name) { return ChatPhone.homeApps(state.dbs).filter(function (x) { return x.app === name; })[0] || null; }
    // En chattapps lista med sökfältet överst, som i appen: namnen och numren direkt, och meddelandenas text i appens alla
    // chattar med minst två tecken (fillAppList, searchMessages).
    function renderAppList(body) {
        var P = state.device, a = appOf(P.app);
        $('c-device-title').textContent = P.app;
        if (!a) { $('c-device-sub').textContent = ''; body.innerHTML = '<p class="d-empty">Appen finns inte i extraktionen.</p>'; return; }
        $('c-device-sub').textContent = many(ChatPhone.appThreads(state.dbs, a.dbs).length, 'chatt', 'chattar') + ' · ' + a.dbs.map(function (di) { return baseName(state.dbs[di].hit.db.name); }).join(', ');
        body.innerHTML = searchBar('d-app-q', 'Sök i ' + P.app, 'Namn, nummer och meddelandenas text i alla chattar i ' + P.app + '. Enter: första träffen.', P.appQuery) + '<div id="d-app-list"></div>';
        wireSearch($('d-app-q'), function (v) { P.appQuery = v; P.limit = LIST_STEP; fillAppList(); }, function () { openDevice('home'); });
        fillAppList();
    }
    function fillAppList() {
        var P = state.device, f = fmt(), a = appOf(P.app), box = $('d-app-list');
        if (!a || !box) return;
        var q = String(P.appQuery || '').trim(), list = ChatPhone.appThreads(state.dbs, a.dbs);
        if (q) {
            var view = ChatCore.listView(state.dbs.map(function (d) { return { app: d.src.app, threads: d.state === 'ready' ? d.threads : null, index: d.index }; }), { query: q });
            var keep = {};
            a.dbs.forEach(function (di) { view.groups[di].items.forEach(function (it) { keep[di + '|' + it.thread.key] = true; }); });
            list = list.filter(function (x) { return keep[x.db + '|' + x.thread.key]; });
        }
        var shown = list.slice(0, P.limit);
        var rows = shown.map(function (x) {
            var t = x.thread;
            var sub = [t.kindText, t.messages !== null ? many(t.messages, 'meddelande', 'meddelanden') : ''].filter(Boolean).join(' · ');
            return '<button type="button" class="d-row" data-db="' + x.db + '" data-thread="' + esc(t.key) + '" title="' + esc(t.address || t.name) + '">' +
                '<span class="c-av p' + ChatCore.hueOf(t.key) + '" data-initial="' + esc(ChatCore.initialOf(t.name)) + '" aria-hidden="true"></span><span class="d-row-text">' +
                '<span class="d-row-top"><b>' + (q ? hitMark(t.name, q) : esc(t.name)) + '</b><time>' + esc(t.lastMs ? f(t.lastMs).slice(0, 10) : '') + '</time></span><span class="d-row-sub">' + esc(sub) + '</span></span></button>';
        }).join('');
        var note = a.busy ? '<p class="d-empty">Databaserna läses fortfarande. Listan fylls på när de är klara.</p>' : !list.length && !q ? '<p class="d-empty">Databasen har inga konversationer.</p>' : '';
        var head = q && list.length ? '<p class="n-sec">Chattar · ' + num(list.length) + '</p>' : '';
        if (!q && APP_SETTING_APPS.indexOf(P.app) >= 0) {
            if (!P.apps || P.apps.zip !== state.zip) loadAppSettings();
            if (appSettingsOf(P.app)) head = '<button type="button" class="d-row d-applink" data-app-info="' + esc(P.app) + '"><span class="d-row-text"><span class="d-row-top"><b>Inställningar i ' + esc(P.app) + '</b><span class="d-chev" aria-hidden="true">›</span></span><span class="d-row-sub">Konto, sekretess, meddelanden, säkerhetskopiering och länkade enheter</span></span></button>';
        }
        // Snapchats Memories på iPhone: bilderna och videorna, dekrypterade ur cachen.
        if (!q && P.app === 'Snapchat' && window.Memories) {
            var MS = P.memories && P.memories.zip === state.zip ? P.memories : null;
            if (!MS) loadMemories();
            else if (MS.state === 'ready' && MS.list.length) {
                var mc = Memories.counts(MS.list);
                head += '<button type="button" class="d-row d-applink" data-device-memories="1"><span class="d-row-text"><span class="d-row-top"><b>Memories</b><span class="d-chev" aria-hidden="true">›</span></span><span class="d-row-sub">' + esc(many(mc.all, 'minne', 'minnen') + (mc.meo ? ', ' + num(mc.meo) + ' i My Eyes Only' : '') + (mc.located ? ', ' + num(mc.located) + ' med position' : '')) + '</span></span></button>';
            }
        }
        box.innerHTML = head + rows + (q && !list.length && q.length < 2 ? '<p class="d-empty">Ingen chatt heter så.</p>' : '') + note + (list.length > shown.length ? '<button type="button" class="c-btn d-more" data-device-more="1">Visa fler (' + num(list.length - shown.length) + ' kvar)</button>' : '') +
            (q.length >= 2 ? '<section id="d-msg-hits" class="d-msg-hits" aria-live="polite"></section>' : '');
        if (q.length >= 2) searchMessages(a, q);
        else msgSearch = null;
    }

    // ---------- Sök i telefonen ----------
    // Sökningen på hemskärmen (som Spotlight på iPhone och sökningen i Samsungs applåda): apparna, kontakterna,
    // konversationerna, anteckningarna, webbhistoriken och inställningarna. Och sökfälten i en chattapp och i Inställningar.

    function searchBar(id, placeholder, title, value) {
        return '<div class="d-searchbar"><span class="d-q-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5l5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></span>' +
            '<input type="search" id="' + id + '" class="d-q" placeholder="' + esc(placeholder) + '" aria-label="' + esc(placeholder) + '" title="' + esc(title) + '" spellcheck="false" autocomplete="off" value="' + esc(value || '') + '"></div>';
    }
    // Sökfältet: ändringen efter en kort paus, Escape tömmer fältet och går sedan tillbaka, Enter öppnar första träffen och
    // pil ned går till träffarna.
    var searchTimer = null;
    function wireSearch(input, changed, leave) {
        input.addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(function () { changed(input.value); }, 150); });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (input.value) { input.value = ''; changed(''); } else leave(); return; }
            var first = input.closest('.c-device-body').querySelector('.d-searchbar ~ * button:not(.d-more)');
            if (e.key === 'Enter' && first) { e.preventDefault(); clearTimeout(searchTimer); changed(input.value); first = input.closest('.c-device-body').querySelector('.d-searchbar ~ * button:not(.d-more)'); if (first) first.click(); }
            if (e.key === 'ArrowDown' && first) { e.preventDefault(); first.focus(); }
        });
        if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#c-device')) setTimeout(function () { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 0);
    }
    function hitMark(value, q) {
        return ChatCore.marks(value, q).map(function (p) { return p.hit ? '<mark>' + esc(p.text) + '</mark>' : esc(p.text); }).join('');
    }
    // Ett utdrag kring den första träffen.
    function snippet(value, q, width) {
        var s = String(value || '').replace(/\s+/g, ' ').trim(), i = s.toLowerCase().indexOf(String(q || '').trim().toLowerCase());
        width = width || 90;
        if (s.length <= width) return s;
        var from = i < 0 ? 0 : Math.max(0, i - Math.round(width / 3));
        return (from ? '…' : '') + s.slice(from, from + width) + (from + width < s.length ? '…' : '');
    }
    function hasText(value, q) { return String(value || '').toLowerCase().indexOf(q) >= 0; }

    // Meddelandenas text per konversation, läst en gång per databas och konversation.
    var quietJob = { check: function () {} };
    async function threadText(d, thread) {
        d.textIndex = d.textIndex || {};
        if (d.textIndex[thread.key]) return d.textIndex[thread.key];
        var loaded = await loadDb(d);
        var res = await queryInSlices(loaded, d.src.roles.messages, { threadId: thread.id }, quietJob, function () {});
        var model = ChatCore.conversation(d.src, thread, res, null, d.members[thread.key] || [], d.hit.db.name, { names: state.names[d.src.app], nameOf: contactName });
        var msgs = model.messages.map(function (m) { return { key: m.key, text: m.text, ms: m.sortMs, fromMe: m.fromMe, sender: m.fromMe ? 'Den här telefonen' : m.senderName || m.senderId || '' }; });
        return (d.textIndex[thread.key] = { messages: msgs, search: ChatCore.searchIndex(model.messages) });
    }
    // Meddelandena med q i en chattapps alla chattar, det senaste först. Listan fylls på medan chattarna läses.
    var msgSearch = null, MSG_HITS = 60;
    async function searchMessages(a, q) {
        var token = msgSearch = { q: q };
        var threads = ChatPhone.appThreads(state.dbs, a.dbs), hits = [], failed = 0, done = 0, f = fmt();
        var paint = function (finished) {
            var box = $('d-msg-hits');
            if (!box || token !== msgSearch) return;
            hits.sort(function (x, y) { return (y.m.ms || 0) - (x.m.ms || 0); });
            var rows = hits.slice(0, token.limit || MSG_HITS).map(function (h) {
                var t = h.thread;
                return '<button type="button" class="d-row m-hit" data-db="' + h.db + '" data-thread="' + esc(t.key) + '" data-msg="' + esc(h.m.key) + '"><span class="c-av p' + ChatCore.hueOf(t.key) + '" data-initial="' + esc(ChatCore.initialOf(t.name)) + '" aria-hidden="true"></span><span class="d-row-text">' +
                    '<span class="d-row-top"><b>' + esc(t.name) + '</b><time>' + esc(h.m.ms ? f(h.m.ms).slice(0, 16) : '') + '</time></span><span class="d-row-sub m-snip">' + (h.m.sender ? esc(h.m.sender) + ': ' : '') + hitMark(snippet(h.m.text, q), q) + '</span></span></button>';
            }).join('');
            var state2 = finished ? (hits.length ? '' : '<p class="d-empty">Ingen text i meddelandena innehåller ”' + esc(q) + '”.</p>') : '<p class="d-empty"><span class="c-spin" aria-hidden="true"></span> Söker i meddelandena… ' + num(done) + ' av ' + num(threads.length) + ' chattar</p>';
            box.innerHTML = '<p class="n-sec">Meddelanden' + (hits.length ? ' · ' + num(hits.length) : '') + '</p>' + rows + state2 +
                (hits.length > (token.limit || MSG_HITS) ? '<button type="button" class="c-btn d-more" data-msg-more="1">Visa fler (' + num(hits.length - (token.limit || MSG_HITS)) + ' kvar)</button>' : '') +
                (finished && failed ? '<p class="d-empty warn">' + many(failed, 'chatt', 'chattar') + ' kunde inte läsas.</p>' : '');
        };
        msgSearch.paint = paint;
        paint(false);
        for (var i = 0; i < threads.length; i++) {
            if (token !== msgSearch) return;
            var x = threads[i], d = state.dbs[x.db];
            try {
                var idx = await threadText(d, x.thread);
                ChatCore.findAll(idx.search, q).forEach(function (k) { hits.push({ db: x.db, thread: x.thread, m: idx.messages[k] }); });
            } catch (err) { failed++; }
            done++;
            if (done % 8 === 0) { paint(false); await pause(); }
        }
        token.done = true;
        paint(true);
    }

    // Alla appar i telefonen: hemskärmens (också i mappar) och de med data utanför den. { name, html }.
    function phoneApps() {
        var P = state.device, apps = ChatPhone.homeApps(state.dbs), ph = P.photos, info = P.info, home = info && info.state === 'ready' ? info.home : null;
        var out = [], seen = {};
        if (home) DeviceInfo.homeAppIds(home).forEach(function (x) {
            var name = x.name || nameOfApp(x.id) || x.id;
            if (seen[x.id]) return;
            seen[x.id] = true;
            out.push({ name: name, html: homeAppHtml({ kind: 'app', id: x.id, name: x.name }, apps, ph, x.where) });
        });
        return out.concat(extraApps(apps, ph, info, home));
    }
    // Inställningarnas rader med q i namnet, värdet eller källan: { section, title, label, value }.
    function settingHits(q) {
        var info = state.device.info, out = [];
        if (!info || info.state !== 'ready') return out;
        info.sections.forEach(function (s) {
            if (hasText(s.title, q)) out.push({ section: s.id, title: s.title, label: s.title, value: '' });
            (s.rows || []).forEach(function (r) { if (hasText(r.label, q) || hasText(r.value, q)) out.push({ section: s.id, title: s.title, label: r.label, value: r.value }); });
            (s.networks || []).forEach(function (n) { if (hasText(n.ssid, q)) out.push({ section: s.id, title: s.title, label: n.ssid, value: 'sparat nät' }); });
            ((s.bluetooth && s.bluetooth.devices) || []).forEach(function (d) { if (hasText(d.name, q) || hasText(d.address, q)) out.push({ section: s.id, title: s.title, label: d.name || d.address, value: d.address }); });
            (s.accounts || []).forEach(function (a) { if (hasText(a.user, q) || hasText(a.kinds.join(' '), q)) out.push({ section: s.id, title: s.title, label: a.user || 'Utan namn', value: a.kinds.join(', ') }); });
        });
        var A = state.device.apps;
        if (A && A.zip === state.zip && A.state === 'ready') A.list.forEach(function (x) {
            x.groups.forEach(function (g) { g.rows.forEach(function (r) { if (hasText(r.label, q) || hasText(r.value, q) || hasText(x.app, q) && hasText(g.title, q)) out.push({ app: x.app, title: x.app + ' · ' + g.title, label: r.label, value: r.value }); }); });
        });
        return out;
    }
    function settingHitHtml(h, q) {
        return '<button type="button" class="d-row" ' + (h.app ? 'data-app-info="' + esc(h.app) + '"' : 'data-section="' + esc(h.section) + '"') + '><span class="d-row-text"><span class="d-row-top"><b>' + hitMark(h.label, q) + '</b></span>' +
            '<span class="d-row-sub">' + esc(h.title) + (h.value ? ' · ' : '') + hitMark(h.value, q) + '</span></span></button>';
    }

    function renderSearch(body) {
        var P = state.device;
        $('c-device-title').textContent = 'Sök';
        $('c-device-sub').textContent = 'Apparna, kontakterna, konversationerna, anteckningarna, webben och inställningarna';
        body.innerHTML = searchBar('d-q', 'Sök', 'Apparna, kontakterna, konversationerna, anteckningarna, webbhistoriken och inställningarna. Enter: första träffen.', P.query) + '<div id="d-results" class="d-results"></div>';
        var input = $('d-q');
        if (!P.apps || P.apps.zip !== state.zip) loadAppSettings();
        wireSearch(input, function (v) { P.query = v; fillSearch(); }, function () { openDevice('home'); });
        setTimeout(function () { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 0);
        fillSearch();
    }
    function fillSearch() {
        var box = $('d-results'), P = state.device, f = fmt();
        if (!box) return;
        var raw = String(P.query || '').trim(), q = raw.toLowerCase();
        if (!q) { box.innerHTML = '<p class="d-empty">Skriv för att söka bland apparna, kontakterna, konversationerna, anteckningarna, webbhistoriken och inställningarna. På hemskärmen räcker det att börja skriva.</p>'; return; }
        var MAX = 6, out = [];
        var group = function (title, items) {
            if (!items.length) return;
            out.push('<section class="d-hits"><p class="n-sec">' + esc(title) + ' · ' + num(items.length) + '</p>' + items.slice(0, MAX).join('') + (items.length > MAX ? '<p class="d-hits-more">och ' + num(items.length - MAX) + ' till</p>' : '') + '</section>');
        };
        var appHits = phoneApps().filter(function (x) { return hasText(x.name, q); });
        if (appHits.length) out.push('<section class="d-hits"><p class="n-sec">Appar · ' + num(appHits.length) + '</p><div class="d-grid d-hit-apps">' + appHits.slice(0, 8).map(function (x) { return x.html; }).join('') + '</div></section>');
        var cm = deviceComms();
        if (cm && cm.contacts) group('Kontakter', cm.contacts.list.filter(function (k) {
            return hasText(k.name, q) || hasText(k.org, q) || k.phones.some(function (p) { return hasText(p.value, q) || (q.replace(/\D/g, '').length >= 3 && String(p.value).replace(/\D/g, '').indexOf(q.replace(/\D/g, '').replace(/^0+/, '')) >= 0); }) || k.emails.some(function (e) { return hasText(e.value, q); });
        }).map(function (k) {
            var sub = [k.phones[0] ? k.phones[0].value : k.emails[0] ? k.emails[0].value : '', k.org && k.org !== k.name ? k.org : ''].filter(Boolean).join(' · ');
            return '<button type="button" class="d-row k-row" data-contact-id="' + esc(k.id) + '"><span class="c-av p' + ChatCore.hueOf(k.id) + '" data-initial="' + esc(ChatCore.initialOf(k.name)) + '" aria-hidden="true"></span><span class="d-row-text"><span class="d-row-top"><b>' + hitMark(k.name, raw) + '</b></span><span class="d-row-sub">' + hitMark(sub, raw) + '</span></span></button>';
        }));
        var view = ChatCore.listView(state.dbs.map(function (d) { return { app: d.src.app, threads: d.state === 'ready' ? d.threads : null, index: d.index }; }), { query: raw });
        var conv = [];
        view.groups.forEach(function (g, di) {
            g.items.forEach(function (it) {
                var t = it.thread;
                conv.push({ ms: t.lastMs || 0, html: '<button type="button" class="d-row" data-db="' + di + '" data-thread="' + esc(t.key) + '"><span class="c-av p' + ChatCore.hueOf(t.key) + '" data-initial="' + esc(ChatCore.initialOf(t.name)) + '" aria-hidden="true"></span><span class="d-row-text"><span class="d-row-top"><b>' + hitMark(t.name, raw) + '</b><time>' + esc(t.lastMs ? f(t.lastMs).slice(0, 10) : '') + '</time></span><span class="d-row-sub">' + esc([state.dbs[di].src.app, t.kindText].filter(Boolean).join(' · ')) + '</span></span></button>' });
            });
        });
        group('Konversationer', conv.sort(function (x, y) { return y.ms - x.ms; }).map(function (x) { return x.html; }));
        var mm = deviceMemos();
        if (mm) group('Anteckningar', mm.notes.filter(function (n) { return !n.locked && (hasText(n.title, q) || hasText(n.text || n.snippet, q)); }).map(function (n) {
            return '<button type="button" class="d-row n-row" data-note-id="' + n.id + '"><span class="d-row-text"><span class="d-row-top"><b>' + hitMark(n.title || 'Ny anteckning', raw) + '</b><time>' + esc(n.modifiedMs ? f(n.modifiedMs).slice(0, 10) : '') + '</time></span><span class="d-row-sub">' + hitMark(snippet(n.text || n.snippet, raw, 70), raw) + '</span></span></button>';
        }));
        var wb = deviceWeb();
        if (wb) {
            var web = [];
            wb.browsers.forEach(function (b) {
                (b.visits ? webList(b, 'visits') : []).forEach(function (x, i) {
                    if (hasText(x.title, q) || hasText(x.url, q)) web.push({ ms: x.ms || 0, html: '<button type="button" class="d-row w-row" data-web-hit="' + esc(b.id) + '" data-web-index="' + i + '" title="' + esc(x.url || '') + '"><span class="d-row-text"><span class="d-row-top"><b>' + hitMark(x.title || x.host || x.url, raw) + '</b><time>' + esc(x.ms ? f(x.ms).slice(0, 10) : '') + '</time></span><span class="d-row-sub">' + esc(b.name) + ' · ' + hitMark(snippet(x.url, raw, 60), raw) + '</span></span></button>' });
                });
            });
            group('Webbhistorik', web.sort(function (x, y) { return y.ms - x.ms; }).map(function (x) { return x.html; }));
        }
        group('Inställningar', settingHits(q).map(function (h) { return settingHitHtml(h, raw); }));
        box.innerHTML = out.join('') || '<p class="d-empty">Inget hittades för ”' + esc(raw) + '”. Meddelandenas text söks inne i varje chattapp.</p>';
    }

    // ---------- Appinställningar ----------
    // Vad WhatsApp, Signal och Snapchat har sparat om kontot, sekretessen, meddelandena, säkerhetskopian och länkade
    // enheter (AppSettings, app-settings.js). En gång per extraktion; Signals filer med samma nyckel som chattarna.
    var APP_SETTING_APPS = ['WhatsApp', 'Signal', 'Snapchat'];
    function loadAppSettings() {
        var z = state.zip, P = state.device;
        if (!z || !window.AppSettings) return Promise.resolve(null);
        if (P.apps && P.apps.zip === z) return P.apps.loading || Promise.resolve(P.apps);
        var A = P.apps = { zip: z, state: 'busy', list: [], read: [], notes: [], loading: null };
        A.loading = (async function () {
            try {
                await loadSql();
                var got = AppSettings.pick(await ExtractionCore.find(z.read, z.file.size, function (name) { return !!AppSettings.fileOf(name); }));
                var label = function (id) { return AppSettings.FILES.filter(function (f) { return f.id === id; })[0].label; };
                var bytes = async function (id) {
                    if (!got[id]) return null;
                    var r = await ExtractionCore.readEntry(z.read, got[id].entry);
                    A.read.push({ label: label(id), name: got[id].entry.name, size: got[id].entry.size });
                    return r.bytes;
                };
                var prefs = async function (id) { try { return AppSettings.sharedPrefs(await bytes(id), window.ProvenanceAndroidLogs && ProvenanceAndroidLogs.abxParse); } catch (err) { A.notes.push(label(id) + ' kunde inte tolkas: ' + errText(err)); return {}; } };
                var plist = async function (id) { try { var b = await bytes(id); return b ? DeviceInfo.plist(b, KC.bplist.parse) : null; } catch (err) { A.notes.push(label(id) + ' kunde inte tolkas: ' + errText(err)); return null; } };
                var rowsOf = function (db, sql) { var r = db.exec(sql)[0]; return r ? r.values.map(function (v) { var o = {}; r.columns.forEach(function (c, i) { o[c] = v[i]; }); return o; }) : []; };
                var tablesOf = function (db) { var r = db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]; return r ? r.values.map(function (v) { return String(v[0]); }) : []; };
                var openDb = async function (id, cipher) {
                    var loaded = await ExtractionCore.loadDatabase(z.read, { db: got[id].entry, wal: got[id].wal }, [z.line], cipher ? { cipher: cipher } : {});
                    A.read.push({ label: label(id), name: got[id].entry.name, size: got[id].entry.size, wal: !!got[id].wal });
                    return new SQL.Database(ExtractionCore.noCopy(loaded.bytes));
                };
                // WhatsApp.
                if (got.waPrefs) A.list.push(AppSettings.whatsappAndroid(await prefs('waPrefs'), await prefs('waDisappearing'), await prefs('waBackup')));
                if (got.waIos) A.list.push(AppSettings.whatsappIos(await plist('waIos'), DeviceInfo.nsMs));
                // Signal: på Android signal-key-value.db med chattarnas nyckel, på iOS keyvalue och Device i signal.sqlite.
                var sig = state.dbs.filter(function (d) { return d.src.app === 'Signal'; });
                if (got.sigKv) {
                    var sa = sig.filter(function (d) { return d.src.platform === 'Android'; })[0], cipher = sa ? cipherFor(sa.src) : null;
                    if (!cipher || !cipher.passphrase) A.notes.push('Signals inställningar (signal-key-value.db) är krypterade, och nyckeln saknas. Välj nyckelfilen i Chattar, så läses de.');
                    else {
                        try {
                            var kvDb = await openDb('sigKv', cipher), kv = {};
                            try { rowsOf(kvDb, 'SELECT key AS key, value AS value FROM key_value').forEach(function (r) { kv[r.key] = r.value; }); } finally { kvDb.close(); }
                            A.list.push(AppSettings.signalAndroid(kv));
                        } catch (err) { A.notes.push('signal-key-value.db kunde inte läsas: ' + errText(err)); }
                    }
                }
                var si = sig.filter(function (d) { return d.src.platform === 'iOS' && d.state === 'ready'; })[0];
                if (si) {
                    try {
                        var loaded = await loadDb(si), sdb = loaded.sqlDb, t = tablesOf(sdb);
                        var kvRows = t.indexOf('keyvalue') >= 0 ? rowsOf(sdb, 'SELECT collection AS collection, key AS key, value AS value FROM keyvalue') : [];
                        var devs = t.indexOf('Device') >= 0 ? rowsOf(sdb, 'SELECT deviceId AS deviceId, createdAt AS createdAt, lastSeenAt AS lastSeenAt, name AS name FROM Device') : [];
                        A.list.push(AppSettings.signalIos(kvRows, devs, KC.bplist.parse));
                    } catch (err) { A.notes.push('Signals inställningar i signal.sqlite kunde inte läsas: ' + errText(err)); }
                }
                // Snapchat: Spara till (core.db på Android, primary.docobjects på iOS) och appens egna inställningar.
                if (got.snapCore || got.snapSession || got.snapMemories) {
                    var save = null;
                    if (got.snapCore) {
                        try {
                            var cdb = await openDb('snapCore');
                            try { var r24 = tablesOf(cdb).indexOf('SnapchatUserProperties') >= 0 ? rowsOf(cdb, 'SELECT textVal AS textVal, row_version AS row_version, last_updated_time AS last_updated_time FROM SnapchatUserProperties WHERE _id = 24')[0] : null; } finally { cdb.close(); }
                            if (r24) save = ProvenanceSnapchat.saveSetting({ value: r24.textVal, version: r24.row_version, updatedMs: r24.last_updated_time });
                        } catch (err) { A.notes.push('core.db kunde inte läsas: ' + errText(err)); }
                    }
                    var loc = null;
                    if (got.snapFeature) {
                        try {
                            var fdb = await openDb('snapFeature');
                            try { loc = tablesOf(fdb).indexOf('ShareLocationPreferences') >= 0 ? rowsOf(fdb, 'SELECT ghostModeEnabled AS ghostModeEnabled, ghostModeExpiration AS ghostModeExpiration, version AS version, audience AS audience, backgroundSharingEnabled AS backgroundSharingEnabled FROM ShareLocationPreferences ORDER BY _id DESC LIMIT 1')[0] || null : null; } finally { fdb.close(); }
                        } catch (err) { A.notes.push('Snapchats databas feature kunde inte läsas: ' + errText(err)); }
                    }
                    var meo = null;
                    if (got.snapMemories) {
                        try {
                            var mdb = await openDb('snapMemories');
                            try { meo = tablesOf(mdb).indexOf('memories_meo_confidential') >= 0 ? rowsOf(mdb, 'SELECT hashed_passcode AS hash, master_key IS NOT NULL AS masterKey FROM memories_meo_confidential WHERE hashed_passcode IS NOT NULL LIMIT 1')[0] || null : null; } finally { mdb.close(); }
                        } catch (err) { A.notes.push('Snapchats memories.db kunde inte läsas: ' + errText(err)); }
                    }
                    A.list.push(AppSettings.snapchat('Android', save, await prefs('snapSession'), null, null, loc, meo));
                }
                if (got.snapDoc || got.snapIos) {
                    var saveI = null;
                    if (got.snapDoc) {
                        try {
                            var ddb = await openDb('snapDoc');
                            try {
                                var ups = tablesOf(ddb).indexOf('userproperties') >= 0 ? rowsOf(ddb, 'SELECT p AS p FROM userproperties WHERE itemId = 24 ORDER BY writeStatus') : [];
                                for (var k = 0; k < ups.length && !saveI; k++) { var v = ProvenanceSnapchat.saveSettingFromFlat(ups[k].p); if (v) saveI = ProvenanceSnapchat.saveSetting({ value: v }); }
                            } finally { ddb.close(); }
                        } catch (err) { A.notes.push('primary.docobjects kunde inte läsas: ' + errText(err)); }
                    }
                    A.list.push(AppSettings.snapchat('iOS', saveI, null, await plist('snapIos'), DeviceInfo.nsMs));
                }
                A.list = A.list.filter(function (x) { return x.groups.length; });
                A.state = 'ready';
            } catch (err) {
                A.state = 'error';
                A.notes.push(errText(err));
            }
            A.loading = null;
            if (state.device.on && state.device.screen === 'search') fillSearch();
            else if (state.device.on && /^(appInfo|settings|app)$/.test(state.device.screen) && !(document.activeElement && /^d-(app|set)-q$/.test(document.activeElement.id))) renderDevice();
            return A;
        })();
        return A.loading;
    }
    function appSettingsOf(app) {
        var A = state.device.apps;
        return A && A.zip === state.zip && A.state === 'ready' ? A.list.filter(function (x) { return x.app === app; })[0] || null : null;
    }
    // Koden till My Eyes Only: prövad i den här vyn, per hash (state.device.meo[hash] = { state, code, tried, total }).
    function meoValue(r) {
        var m = (state.device.meo || {})[r.hash];
        if (!m) return { text: r.value, html: '<button type="button" class="c-btn d-meo-btn" data-meo-crack="' + esc(r.hash) + '">Pröva alla fyrsiffriga koder</button>' };
        if (m.state === 'busy') return { text: 'Prövar…', html: '<span class="c-spin" aria-hidden="true"></span> ' + esc(num(m.tried) + ' av ' + num(m.total)) };
        if (m.code !== null) return { text: m.code, html: '' };
        return { text: 'Inte en kod med fyra siffror', html: '' };
    }
    function appSettingRow(r, f) {
        if (r.action === 'meo') {
            var mv = meoValue(r);
            return '<div class="d-kv d-appset"><span class="d-kv-label">' + esc(r.label) + '</span><span class="d-kv-value">' + esc(mv.text) + '</span>' +
                (mv.html ? '<span class="d-meo">' + mv.html + '</span>' : '') +
                '<small class="d-kv-src">' + labMark(!!r.checked) + ' ' + esc(r.source) + '</small>' + (r.note ? '<small class="d-kv-note">' + esc(r.note) + '</small>' : '') + '</div>';
        }
        var value = r.ms ? (r.prefix || '') + f(r.ms) + (r.suffix || '') : r.value;
        var sw = r.on === undefined ? '' : '<span class="d-switch' + (r.on ? ' on' : '') + '" aria-hidden="true"><i></i></span>';
        var mark = labMark(!!r.checked);
        return '<div class="d-kv d-appset"><span class="d-kv-label">' + esc(r.label) + '</span><span class="d-kv-value">' + (sw ? sw + '<span class="d-switch-text">' + esc(value) + '</span>' : esc(value)) + '</span>' +
            '<small class="d-kv-src">' + mark + ' ' + esc(r.source) + '</small>' + (r.note ? '<small class="d-kv-note">' + esc(r.note) + '</small>' : '') + '</div>';
    }
    function renderAppInfo(body) {
        var P = state.device, f = fmt(), app = P.appInfo;
        if (!P.apps || P.apps.zip !== state.zip) loadAppSettings();
        $('c-device-title').textContent = app;
        var A = P.apps;
        if (!A || A.state === 'busy') { $('c-device-sub').textContent = 'Läser appens inställningar…'; body.innerHTML = '<p class="d-empty"><span class="c-spin" aria-hidden="true"></span> Läser appens inställningar…</p>'; return; }
        var s = appSettingsOf(app);
        $('c-device-sub').textContent = 'Inställningar i appen · tider i ' + ($('c-zone').selectedOptions[0] ? $('c-zone').selectedOptions[0].textContent : 'vald tidszon');
        if (!s) {
            body.innerHTML = '<p class="d-empty">' + esc(app) + ' har inga inställningar som verktyget läser i ' + esc(Z()) + '.</p>' + (A.notes.length ? '<p class="d-empty warn">' + esc(A.notes.join(' ')) + '</p>' : '');
            return;
        }
        var c = AppSettings.counts(s);
        var head = '<div class="d-apphead">' + iconHtml(app, '', app, null) + '<div><b>' + esc(app) + '</b><small>' + esc(s.platform) + ' · ' + many(c.rows, 'rad', 'rader') + ', ' + num(c.checked) + ' kontrollerade i labb</small></div></div>';
        var groups = s.groups.map(function (g) { return '<p class="n-sec">' + esc(g.title) + '</p><div class="d-kvs">' + g.rows.map(function (r) { return appSettingRow(r, f); }).join('') + '</div>'; }).join('');
        body.innerHTML = head + groups + (A.notes.length ? '<p class="d-empty warn">' + esc(A.notes.join(' ')) + '</p>' : '') +
            '<p class="d-note">Bara det som står i appens egna filer. ✓ Labb: kontrollerat i en labb. Ej verifierad: värdet står i filen, men vad det betyder är inte prövat ännu. Raderna kan ändras när labbarna gjorts.</p>';
    }

    // ---------- Snapchat Memories (iPhone) ----------
    // Snapsen ur scdb-27.sqlite3, nyckeln, positionen och platsnamnet ur gallery.encrypteddb (nyckelringen behövs) och
    // filerna i Snapchats cache, dekrypterade med snapens nyckel (Memories, memories.js). En gång per extraktion.
    function loadMemories() {
        var z = state.zip, P = state.device;
        if (!z || !window.Memories) return Promise.resolve(null);
        if (P.memories && P.memories.zip === z) return P.memories.loading || Promise.resolve(P.memories);
        var S = P.memories = { zip: z, state: 'busy', list: [], files: {}, urls: {}, notes: [], read: [], loading: null, paint: 0 };
        S.loading = (async function () {
            try {
                await loadSql();
                var got = Memories.pick(await ExtractionCore.find(z.read, z.file.size, function (name) { return !!Memories.which(name); }));
                if (!got.scdb) { S.state = 'none'; return S; }
                var open = async function (id, cipher) {
                    var loaded = await ExtractionCore.loadDatabase(z.read, { db: got[id].entry, wal: got[id].wal }, [z.line], cipher ? { cipher: cipher } : {});
                    S.read.push(got[id].entry.name);
                    return new SQL.Database(ExtractionCore.noCopy(loaded.bytes));
                };
                var rowsOf = function (db, sql) { var r = db.exec(sql)[0]; return r ? r.values.map(function (v) { var o = {}; r.columns.forEach(function (c, i) { o[c] = v[i]; }); return o; }) : []; };
                var snaps = [], keys = [], locs = [], claims = [];
                var d1 = await open('scdb');
                try { snaps = rowsOf(d1, Memories.SQL.snaps); } finally { d1.close(); }
                if (got.gallery) {
                    var cipher = cipherFor({ cipher: 'snapchat-gallery' });
                    if (!cipher || !cipher.passphrase) S.notes.push('gallery.encrypteddb är krypterad, och nyckeln saknas. Välj nyckelringen (…_keychain.plist) med extraktionen, så visas bilderna, positionerna och platserna.');
                    else {
                        try {
                            var d2 = await open('gallery', cipher);
                            try { keys = rowsOf(d2, Memories.SQL.keys); locs = rowsOf(d2, Memories.SQL.locations); } finally { d2.close(); }
                        } catch (err) { S.notes.push('gallery.encrypteddb kunde inte läsas: ' + errText(err)); }
                    }
                } else S.notes.push('gallery.encrypteddb finns inte i ' + Z() + ', så nycklarna och positionerna saknas.');
                if (got.cache) {
                    try { var d3 = await open('cache'); try { claims = rowsOf(d3, Memories.SQL.claims); } finally { d3.close(); } }
                    catch (err) { S.notes.push('cache_controller.db kunde inte läsas: ' + errText(err)); }
                }
                S.list = Memories.build(snaps, keys, locs, claims);
                var want = {};
                S.list.forEach(function (m) { if (m.media) want[m.media] = true; if (m.overlay) want[m.overlay] = true; });
                if (Object.keys(want).length) {
                    (await ExtractionCore.find(z.read, z.file.size, function (name) {
                        var n = '/' + String(name);
                        return Memories.FILE_MANAGER.test(n) && !!want[n.slice(n.lastIndexOf('/') + 1)];
                    })).forEach(function (e) { S.files[e.name.slice(e.name.lastIndexOf('/') + 1)] = e; });
                }
                S.state = 'ready';
            } catch (err) {
                S.state = 'error';
                S.notes.push('Memories kunde inte läsas: ' + errText(err));
            }
            S.loading = null;
            if (P.on && /^(app|memories|memory)$/.test(P.screen)) renderDevice();
            return S;
        })();
        return S.loading;
    }
    function memoryOf(id) { var S = state.device.memories; return S ? S.list.filter(function (m) { return m.id === id; })[0] || null : null; }
    async function memoryBytes(m, part) {
        var S = state.device.memories, e = m[part] ? S.files[m[part]] : null;
        if (!m[part] || !e) throw new Error('Filen finns inte i ' + Z() + '.');
        if (!m.key) throw new Error(m.keyLocked ? 'Nyckeln är krypterad (My Eyes Only).' : 'Nyckeln saknas.');
        return Memories.decrypt(crypto.subtle, (await ExtractionCore.readEntry(state.zip.read, e)).bytes, m.key, m.iv);
    }
    async function memoryUrl(m, part) {
        var S = state.device.memories, k = m.id + ':' + part;
        if (!S.urls[k]) {
            var bytes = await memoryBytes(m, part);
            S.urls[k] = { url: URL.createObjectURL(new Blob([bytes], { type: Memories.mime(bytes) || 'application/octet-stream' })), mime: Memories.mime(bytes) };
        }
        return S.urls[k];
    }
    function durText(s) { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
    function renderMemories(body) {
        var P = state.device, S = P.memories, f = fmt();
        $('c-device-title').textContent = 'Memories';
        if (!S || S.zip !== state.zip) { loadMemories(); S = P.memories; }
        if (!S || S.state === 'busy') { $('c-device-sub').textContent = 'Läser Memories…'; body.innerHTML = '<p class="d-empty"><span class="c-spin" aria-hidden="true"></span> Läser Memories och dekrypterar nycklarna…</p>'; return; }
        var c = Memories.counts(S.list);
        $('c-device-sub').textContent = 'Snapchat · ' + many(c.all, 'minne', 'minnen') + (c.meo ? ' · ' + num(c.meo) + ' i My Eyes Only' : '');
        var tiles = S.list.map(function (m) {
            var label = (m.kind === 'video' ? 'Video' : 'Bild') + (m.captureMs ? ', ' + f(m.captureMs) : '') + (m.meo ? ', My Eyes Only' : '');
            return '<button type="button" class="m-tile' + (m.meo ? ' meo' : '') + '" data-memory-id="' + esc(m.id) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
                '<span class="m-img" data-mem-thumb="' + esc(m.id) + '"></span>' +
                (m.kind === 'video' ? '<span class="m-badge">▶ ' + esc(durText(m.durationS)) + '</span>' : '') +
                (m.meo ? '<span class="m-lock">My Eyes Only</span>' : '') +
                '<span class="m-date">' + esc(m.captureMs ? f(m.captureMs).slice(0, 10) : '') + '</span></button>';
        }).join('');
        body.innerHTML = (c.located ? '<div class="m-head"><button type="button" class="c-btn" data-memories-map="1">Visa på kartan (' + num(c.located) + ')</button></div>' : '') +
            (S.list.length ? '<div class="m-grid">' + tiles + '</div>' : '<p class="d-empty">Inga Memories i scdb-27.sqlite3.</p>') +
            (S.notes.length ? '<p class="d-empty warn">' + esc(S.notes.join(' ')) + '</p>' : '') +
            '<p class="d-note">Ur scdb-27.sqlite3 (snapsen), gallery.encrypteddb (nyckeln, positionen och platsen; SQLCipher med nyckeln i nyckelringen) och Snapchats cache. Filerna dekrypteras med snapens nyckel (AES-256-CBC). My Eyes Only har nyckeln krypterad med koden.</p>';
        fillMemoryThumbs(body, S);
    }
    // Miniatyrerna en i taget, så länge rutnätet visas.
    function fillMemoryThumbs(body, S) {
        var seq = ++S.paint;
        (async function () {
            for (var i = 0; i < S.list.length; i++) {
                var m = S.list[i];
                if (S.paint !== seq || state.device.screen !== 'memories') return;
                var el = [].filter.call(body.querySelectorAll('[data-mem-thumb]'), function (x) { return x.dataset.memThumb === m.id; })[0];
                if (!el) continue;
                if (!m.key || !m.media) { el.classList.add(m.keyLocked ? 'locked' : 'none'); continue; }
                try {
                    var u = await memoryUrl(m, 'media');
                    if (/^video\//.test(u.mime)) el.innerHTML = '<video src="' + esc(u.url) + '#t=0.1" muted preload="metadata"></video>';
                    else el.style.backgroundImage = 'url("' + u.url + '")';
                } catch (err) { el.classList.add('none'); el.title = errText(err); }
            }
        })();
    }
    function renderMemory(body) {
        var P = state.device, S = P.memories, f = fmt(), m = memoryOf(P.memory);
        $('c-device-title').textContent = 'Memory';
        if (!m) { openDevice('memories', 'Snapchat'); return; }
        $('c-device-sub').textContent = (m.kind === 'video' ? 'Video' : 'Bild') + (m.captureMs ? ' · ' + f(m.captureMs) : '');
        var e = m.media ? S.files[m.media] : null;
        var rows = [
            m.captureMs ? kv('Tagen', f(m.captureMs), 'scdb-27.sqlite3 · ZGALLERYSNAP.ZCAPTURETIMEUTC') : '',
            m.savedMs ? kv('Sparad i Memories', f(m.savedMs), 'ZGALLERYSNAP.ZCREATETIMEUTC, ZGALLERYENTRY.ZDUPLICATETIMEUTC') : '',
            kv('Typ', m.kind + (m.w && m.h ? ', ' + m.w + ' × ' + m.h : '') + (m.durationS && m.kind === 'video' ? ', ' + durText(m.durationS) : '') + (m.front ? ', framkameran' : ''), 'ZMEDIAFORMAT, ZWIDTH, ZHEIGHT, ZDURATION, ZCAMERAFRONTFACING'),
            kv('My Eyes Only', m.meo ? 'Ja' : 'Nej', 'ZGALLERYENTRY.ZISPRIVATE'),
            m.lat !== null ? kv('Position', m.lat.toFixed(6) + ', ' + m.lon.toFixed(6) + (m.address ? ' · ' + m.address : ''), 'gallery.encrypteddb · snap_location_table, snap_address_title') : kv('Position', 'Ingen', 'gallery.encrypteddb · snap_location_table'),
            m.zone ? kv('Tidszon i snapen', m.zone, 'ZTIMEZONENAME') : '',
            m.copyOf ? kv('Kopia av', m.copyOf, 'ZDUPLICATEDFROMSNAPID') : '',
            kv('Snap-id', m.id, 'ZGALLERYSNAP.ZSNAPID'),
            kv('Filen', e ? e.name : m.media ? 'Finns inte i ' + Z() : 'Ingen i cachen', 'cache_controller.db · CACHE_FILE_CLAIM (EXTERNAL_KEY snap-media-<id>)'),
            kv('Nyckel', m.keyLocked ? 'Krypterad med koden till My Eyes Only' : m.key ? 'AES-256-CBC med snapens nyckel och iv' : 'Saknas', 'gallery.encrypteddb · snap_key_iv'),
        ].join('');
        var canImage = !!(m.key && e);
        body.innerHTML = '<div class="m-view" id="m-view">' + (canImage ? '<span class="c-spin" aria-hidden="true"></span>' : '<p class="d-empty">' + esc(m.keyLocked ? 'My Eyes Only: filen går inte att öppna utan koden.' : 'Filen finns inte i ' + Z() + '.') + '</p>') + '</div>' +
            (canImage ? '<div class="m-actions">' + (inHub ? '<button type="button" class="c-btn" data-memory-exif="' + esc(m.id) + '">Visa i EXIF</button>' : '') + '<button type="button" class="c-btn" data-memory-save="' + esc(m.id) + '">Spara filen</button></div>' : '') +
            '<div class="d-kvs">' + rows + '</div>';
        if (!canImage) return;
        Promise.all([memoryUrl(m, 'media'), m.overlay && S.files[m.overlay] ? memoryUrl(m, 'overlay').catch(function () { return null; }) : null]).then(function (r) {
            var view = $('m-view');
            if (!view || state.device.memory !== m.id) return;
            var media = /^video\//.test(r[0].mime) ? '<video src="' + esc(r[0].url) + '" controls playsinline></video>' : '<img src="' + esc(r[0].url) + '" alt="">';
            view.innerHTML = '<div class="m-stack">' + media + (r[1] ? '<img class="m-overlay" src="' + esc(r[1].url) + '" alt="" title="Text och ritning ovanpå snapen (snap-overlay)">' : '') + '</div>';
        }).catch(function (err) { var view = $('m-view'); if (view) view.innerHTML = '<p class="d-empty warn">' + esc(errText(err)) + '</p>'; });
    }
    async function memoryFile(m) {
        var bytes = await memoryBytes(m, 'media'), type = Memories.mime(bytes);
        var ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' }[type] || 'bin';
        return new File([bytes], 'snapchat-memory-' + m.id + '.' + ext, { type: type || 'application/octet-stream', lastModified: m.captureMs || 0 });
    }
    // Minnena med position till Positioner, med en liten bild för varje bild.
    async function memoriesToMap() {
        var S = state.device.memories;
        var list = S.list.filter(function (m) { return m.lat !== null; });
        toast('Minnena skickas till Positioner…');
        var points = [];
        for (var i = 0; i < list.length; i++) {
            var m = list[i], file = null;
            if (m.kind === 'bild' && m.key && m.media && S.files[m.media]) {
                try {
                    var bytes = await memoryBytes(m, 'media');
                    var bmp = await createImageBitmap(new Blob([bytes]));
                    var k = Math.min(1, 360 / Math.max(bmp.width, bmp.height));
                    var cv = document.createElement('canvas');
                    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
                    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
                    var blob = await new Promise(function (res) { cv.toBlob(res, 'image/jpeg', 0.85); });
                    if (blob) file = new File([blob], m.id + '.jpg', { type: 'image/jpeg' });
                } catch (err) { file = null; }
            }
            var t = m.captureMs ? new Date(m.captureMs).toISOString().slice(0, 19).replace('T', ' ') : '';
            points.push({
                id: points.length + 1, name: 'Memory ' + (t ? t.slice(0, 16) : m.id.slice(0, 8)), path: 'Snapchat Memories/' + m.id, lat: m.lat, lon: m.lon,
                source: 'gallery.encrypteddb', taken: t ? { sort: t, zone: 'UTC', text: t + ' UTC', kind: 'Tagen (ZCAPTURETIMEUTC)', source: 'import' } : null,
                type: m.meo ? 'My Eyes Only' : m.kind, device: '', app: 'Snapchat', software: '', mime: '', file: file,
                extra: [m.address ? ['Plats', m.address] : null, ['Snap-id', m.id]].filter(Boolean),
            });
        }
        toHub({ type: 'positions', layerKey: 'snapchat-memories', layerName: 'Snapchat Memories', points: points, noun: ['minne', 'minnen'] });
    }

    // ---------- Kontrollcenter ----------
    // Rullgardinen överst, som i telefonen: lägena ur Inställningar → Lägen som rutor, på eller av. En ruta öppnar raden
    // med fil och fält. Nås med statusraden överst på hemskärmen och låsskärmen, eller med ett drag nedåt från överkanten.
    var TILES = [
        { key: 'plane', labels: ['Flygplansläge'], name: 'Flygplansläge', glyph: '<path d="M10.5 3.5c.8-.8 2.2-.8 3 0l.2 5.3 6.8 4v2l-6.8-2-.2 4.4 2.2 1.8v1.5l-3.7-1-3.7 1V19l2.2-1.8-.2-4.4-6.8 2v-2l6.8-4z"/>' },
        { key: 'wifi', labels: ['Wi-Fi'], name: 'Wi-Fi', glyph: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.3a9.5 9.5 0 0 1 13 0M8.6 15.5a5 5 0 0 1 6.8 0"/><circle cx="12" cy="18.6" r="1.2"/>' },
        { key: 'bt', labels: ['Bluetooth'], name: 'Bluetooth', glyph: '<path d="M7 7.5l10 9-5 4.5V3l5 4.5-10 9"/>' },
        { key: 'cell', labels: ['Mobildata'], name: 'Mobildata', glyph: '<path d="M5 19v-3M9.5 19v-6M14 19v-9M18.5 19V6"/>' },
        { key: 'loc', labels: ['Platstjänster', 'Plats'], name: 'Plats', glyph: '<path d="M20 4L4 11l7 2 2 7z"/>' },
        { key: 'focus', labels: ['Fokus på', 'Stör ej'], name: 'Fokus', glyph: '<path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.6 7 7 0 0 1-5-13.6z"/>' },
        { key: 'dark', labels: ['Utseende', 'Mörkt läge'], name: 'Mörkt läge', glyph: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>' },
        { key: 'battery', labels: ['Batteriprocent'], name: 'Batteriprocent', glyph: '<rect x="3" y="7.5" width="16" height="9" rx="2"/><path d="M21 10.5v3"/>' },
    ];
    // Rutorna med läget ur raderna: on true/false, eller null när filen inte säger det.
    function controlTiles() {
        var info = state.device.info, sec = info && info.state === 'ready' ? info.sections.filter(function (s) { return s.id === 'toggles'; })[0] : null, rows = sec ? sec.rows : [];
        return TILES.map(function (t) {
            var r = rows.filter(function (x) { return t.labels.indexOf(x.label) >= 0; })[0];
            var v = r ? String(r.value) : '', on = !r ? null : /^På|^Mörkt/.test(v) ? true : /^Av|^Ljust|^Inget$/.test(v) ? false : null;
            if (r && t.key === 'focus' && on === null) on = v !== '' && v !== 'Inget' && v !== '0';
            return { key: t.key, name: t.name, glyph: t.glyph, on: on, row: r || null };
        });
    }
    function statusBarHtml() {
        var tiles = controlTiles().filter(function (t) { return t.row && (t.on || t.key === 'wifi' || t.key === 'bt'); });
        if (!tiles.length) return '';
        return '<button type="button" class="d-statusbar" data-device-control="1" title="Kontrollcenter: telefonens lägen. Dra också nedåt från överkanten.">' +
            tiles.map(function (t) { return '<svg class="' + (t.on ? 'on' : 'off') + '" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-label="' + esc(t.name + (t.on ? ' på' : ' av')) + '">' + t.glyph + '</svg>'; }).join('') + '</button>';
    }
    function renderControl(body) {
        var P = state.device, info = P.info, android = devicePlatform() === 'Android';
        $('c-device-title').textContent = android ? 'Snabbinställningar' : 'Kontrollcenter';
        $('c-device-sub').textContent = 'Telefonens sparade lägen när extraktionen gjordes';
        if (!info || info.state !== 'ready') { body.innerHTML = '<p class="d-empty"><span class="c-spin" aria-hidden="true"></span> Läser telefonens filer…</p>'; return; }
        var wall = info.wall && (info.wall.lock || info.wall.home);
        body.classList.toggle('has-wall', !!wall);
        body.style.backgroundImage = wall ? 'url("' + wall + '")' : '';
        var tiles = controlTiles().filter(function (t) { return t.row; });
        if (android) tiles.forEach(function (t) { if (t.key === 'focus') t.name = 'Stör ej'; });
        var html = tiles.map(function (t) {
            var state2 = t.on === true ? 'på' : t.on === false ? 'av' : 'okänt';
            return '<button type="button" class="d-tile' + (t.on ? ' on' : t.on === false ? ' off' : '') + '" data-section="toggles" title="' + esc((t.row.checked === true ? '✓ Labb · ' : t.row.checked === false ? 'Ej verifierad · ' : '') + t.row.source + (t.row.note ? ' · ' + t.row.note : '')) + '" aria-label="' + esc(t.name + ', ' + state2 + ', ' + t.row.value) + '">' +
                '<span class="d-tile-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + t.glyph + '</svg></span>' +
                '<span class="d-tile-text"><b>' + esc(t.name) + '</b><small>' + esc(t.row.value) + '</small></span></button>';
        }).join('');
        var notifs = info.notifications;
        body.innerHTML = '<div class="d-control">' + (html ? '<div class="d-tiles">' + html + '</div>' : '<p class="d-empty">Telefonens lägen finns inte i ' + esc(Z()) + '.</p>') +
            (notifs ? '<button type="button" class="d-pill" data-device-lock="1">' + esc(many(notifs.length, 'notis', 'notiser')) + ' ›</button>' : '') +
            '<button type="button" class="d-pill" data-section="toggles">Alla lägen i Inställningar ›</button></div>';
    }

    function photosWaiting(body, ph) {
        $('c-device-sub').textContent = ph.state === 'busy' ? 'Läser bildbiblioteket…' : '';
        body.innerHTML = ph.state === 'busy' ? '<p class="d-empty"><span class="c-spin" aria-hidden="true"></span> Läser bildbiblioteket…</p>' :
            ph.state === 'none' ? '<p class="d-empty">Extraktionen har inget bildbibliotek (Photos.sqlite eller MediaStore).</p>' : '<p class="d-empty warn">Bildbiblioteket kunde inte läsas: ' + esc(ph.note) + '</p>';
    }

    function renderPhotos(body) {
        var P = state.device;
        body.style.backgroundImage = '';
        if (!P.photos || P.photos.zip !== state.zip) loadPhotos();
        var ph = P.photos;
        var group = ChatPhone.filterById(ph.items, ph.albums, P.filter, nameOfApp);
        $('c-device-title').textContent = P.filter === 'all' ? 'Bilder' : group ? group.title : 'Bilder';
        if (ph.state !== 'ready') { photosWaiting(body, ph); return; }
        var items = P.filter === 'all' ? ph.items : ChatPhone.filterItems(ph.items, P.filter);
        var thumbs = items.filter(function (it) { return ph.thumbs[it.key]; }).length;
        $('c-device-sub').textContent = many(items.length, 'bild', 'bilder') + ' · ' + baseName(ph.db) + (thumbs ? ' · ' + num(thumbs) + ' med telefonens tumnagel' : '');
        if (!items.length) { body.innerHTML = '<p class="d-empty">' + (P.filter === 'all' ? 'Bildbiblioteket har inga bilder.' : 'Inga bilder i urvalet.') + '</p>'; return; }
        if (P.gallery) return;
        P.gallery = new ChatPhone.Gallery({ box: body, items: items, url: photoUrl, open: openPhoto, monthOf: monthOf, cols: 4 });
    }

    // Album och urval, som i telefonens Bilder: egna album, mediatyper, appen som sparade bilden och det dolda och
    // raderade. Omslaget är den senaste bilden i urvalet.
    function renderAlbums(body) {
        var P = state.device;
        body.style.backgroundImage = '';
        if (!P.photos || P.photos.zip !== state.zip) loadPhotos();
        var ph = P.photos;
        $('c-device-title').textContent = 'Album';
        if (ph.state !== 'ready') { photosWaiting(body, ph); return; }
        var groups = ChatPhone.galleryGroups(ph.items, ph.albums, nameOfApp, ph.platform);
        $('c-device-sub').textContent = many(groups.reduce(function (n, g) { return n + g.list.length; }, 0), 'urval', 'urval') + ' · ' + baseName(ph.db);
        var covers = [];
        body.innerHTML = groups.map(function (g) {
            return '<h3 class="d-group">' + esc(g.title) + '</h3><div class="d-albums">' + g.list.map(function (a) {
                if (a.cover !== null) covers.push(a.cover);
                return '<button type="button" class="d-album' + (a.warn ? ' warn' : '') + '" data-filter="' + esc(a.id) + '" aria-label="' + esc(a.title + ', ' + many(a.count, 'bild', 'bilder')) + '" title="' + esc(a.note || a.title) + '">' +
                    '<span class="d-cover"' + (a.cover !== null ? ' data-cover="' + a.cover + '"' : '') + ' aria-hidden="true"></span><span class="d-album-name">' + esc(a.title) + '</span><span class="d-album-count">' + esc(num(a.count)) + '</span></button>';
            }).join('') + '</div>';
        }).join('') + '<p class="d-note">' + esc(ph.platform === 'iOS' ? 'Albumen ur ZGENERICALBUM med bilderna ur ' + ((ph.albumTables || []).join(' och ') || 'kopplingstabellen') + '; mediatyperna ur ZKIND och ZKINDSUBTYPE, favorit, dold och papperskorgen ur ZFAVORITE, ZHIDDEN och ZTRASHEDSTATE, appen ur ZIMPORTEDBYBUNDLEIDENTIFIER.' :
            'Albumen är mapparna (bucket_display_name), appen är owner_package_name, favorit och papperskorgen is_favorite och is_trashed i MediaStore.') + (ph.note ? ' ' + esc(ph.note) : '') + '</p>';
        // Omslagen läses efter varandra, med telefonens tumnagel när den finns.
        var mine = ph;
        (async function () {
            for (var i of covers) {
                if (state.device.photos !== mine || state.device.screen !== 'albums') return;
                var it = ph.items[i];
                var url = ph.covers[it.key];
                if (url === undefined) { try { url = await photoUrl(it); } catch (e) { url = null; } ph.covers[it.key] = url; }
                if (url) body.querySelectorAll('[data-cover="' + i + '"]').forEach(function (el) { el.style.backgroundImage = 'url("' + url + '")'; el.classList.add('has'); });
            }
        })();
    }

    // Inställningar: en lista som i telefonen, och en del i taget.
    function settingCount(s) {
        if (s.networks) return s.networks.length;
        if (s.accounts) return s.accounts.length;
        if (s.bluetooth) return s.bluetooth.devices.length;
        return null;
    }
    function renderSettings(body) {
        var P = state.device;
        body.style.backgroundImage = '';
        if (!P.info || P.info.zip !== state.zip) loadDeviceInfo();
        var info = P.info;
        $('c-device-title').textContent = 'Inställningar';
        if (info.state === 'busy') { $('c-device-sub').textContent = 'Läser inställningarna…'; body.innerHTML = '<p class="d-empty"><span class="c-spin" aria-hidden="true"></span> Läser inställningarna…</p>'; return; }
        $('c-device-sub').textContent = many(info.read.length, 'fil', 'filer') + ' lästa ur ' + Z();
        body.innerHTML = searchBar('d-set-q', 'Sök i inställningarna', 'Raderna i alla delar: namnet, värdet, nät, enheter och konton.', P.setQuery) + '<div id="d-set-list"></div>';
        wireSearch($('d-set-q'), function (v) { P.setQuery = v; fillSettings(); }, function () { openDevice('home'); });
        fillSettings();
    }
    function fillSettings() {
        var P = state.device, info = P.info, box = $('d-set-list');
        if (!box || !info) return;
        var q = String(P.setQuery || '').trim();
        if (q) {
            var hits = settingHits(q.toLowerCase());
            box.innerHTML = hits.length ? hits.map(function (h) { return settingHitHtml(h, q); }).join('') : '<p class="d-empty">Ingen inställning innehåller ”' + esc(q) + '”.</p>';
            return;
        }
        var rows = info.sections.map(function (s) {
            var n = settingCount(s), empty = !(s.rows && s.rows.length) && n === null;
            return '<button type="button" class="d-set" data-section="' + esc(s.id) + '"><span class="d-set-name">' + esc(s.title) + '</span><span class="d-set-val">' + esc(empty ? 'Inte läst' : n !== null ? num(n) : '') + '</span><span class="d-chev" aria-hidden="true">›</span></button>';
        });
        if (!P.apps || P.apps.zip !== state.zip) loadAppSettings();
        if (P.apps && P.apps.state === 'ready' && P.apps.list.length) {
            rows.push('<p class="n-sec d-set-head">Appar</p>');
            P.apps.list.forEach(function (x) { var c = AppSettings.counts(x); rows.push('<button type="button" class="d-set" data-app-info="' + esc(x.app) + '"><span class="d-set-name">' + esc(x.app) + '</span><span class="d-set-val">' + esc(num(c.rows)) + '</span><span class="d-chev" aria-hidden="true">›</span></button>'); });
        }
        rows.push('<button type="button" class="d-set" data-section="sources"><span class="d-set-name">Källor</span><span class="d-set-val">' + esc(num(info.read.length)) + '</span><span class="d-chev" aria-hidden="true">›</span></button>');
        box.innerHTML = '<div class="d-sets">' + rows.join('') + '</div>' + (info.notes.length ? '<p class="d-empty warn">' + esc(info.notes.join(' ')) + '</p>' : '') +
            '<p class="d-note">Bara det som står i telefonens egna filer. Varje rad säger vilken fil och vilket fält den kommer ur.</p>';
    }
    // checked: true = kontrollerat i labb, false = ej verifierat, utelämnat = ingen märkning.
    function kv(label, value, source, note, checked) {
        return '<div class="d-kv"><span class="d-kv-label">' + esc(label) + '</span><span class="d-kv-value">' + esc(value) + '</span>' + (source || checked !== undefined ? '<small class="d-kv-src">' + labMark(checked) + esc(source || '') + '</small>' : '') + (note ? '<small class="d-kv-note">' + esc(note) + '</small>' : '') + '</div>';
    }
    function labMark(checked) {
        return checked === true ? '<span class="d-check" title="Kontrollerad i en labb: inställningen ändrades eller händelsen gjordes vid en loggad tid och syntes i filen.">✓ Labb</span> ' :
            checked === false ? '<span class="d-unverified" title="Värdet står i filen, men vad det betyder är inte prövat i en labb ännu.">Ej verifierad</span> ' : '';
    }
    function renderSetting(body) {
        var P = state.device, info = P.info, f = fmt();
        body.style.backgroundImage = '';
        if (!info || info.state !== 'ready') { openDevice('settings'); return; }
        var s = info.sections.filter(function (x) { return x.id === P.section; })[0];
        var t = function (ms) { return ms ? f(ms) : ''; };
        var html = '';
        if (P.section === 'sources') {
            $('c-device-title').textContent = 'Källor';
            // Filernas namn är långa: namnet står på en egen rad och storleken under det.
            html = info.read.map(function (r) { return kv(r.label, r.count ? many(r.count, 'fil', 'filer') : ChatCore.sizeText(r.size) + (r.wal ? ' med -wal' : '') + (r.crcOk === false ? ' · CRC32 stämmer inte' : ''), r.name).replace('class="d-kv"', 'class="d-kv d-kv-stack"'); }).join('') +
                (info.missing.length ? kv('Finns inte i ' + Z(), info.missing.join(', ')) : '');
        } else if (!s) { openDevice('settings'); return; }
        else {
            $('c-device-title').textContent = s.title;
            if (s.rows) html = s.rows.map(function (r) { return kv(r.label, r.ms ? t(r.ms) + (r.suffix || '') : r.value, r.source, r.note, r.checked); }).join('');
            if (s.wall && (s.wall.home || s.wall.lock)) html = '<div class="d-walls">' + ['home', 'lock'].filter(function (k) { return s.wall[k]; }).map(function (k) { return '<figure><img src="' + esc(s.wall[k]) + '" alt=""><figcaption>' + (k === 'home' ? 'Hemskärm' : 'Låsskärm') + '</figcaption></figure>'; }).join('') + '</div>' + html;
            if (s.networks !== undefined) {
                html = s.networks === null ? kv('Wi-Fi', 'Inte läst', s.source + (s.abx ? ' (binär XML, som verktyget inte läser för Wi-Fi)' : ' finns inte i ' + Z())) : !s.networks.length ? kv('Wi-Fi', 'Inga sparade nät', s.source) :
                    s.networks.map(function (n) {
                        var bits = [n.security, n.addedMs ? 'tillagt ' + t(n.addedMs) : '', n.lastMs ? 'senast ' + t(n.lastMs) : '', n.reason ? 'genom ' + n.reason + (n.bundle ? ' (' + n.bundle + ')' : '') : '',
                            n.hasKey ? 'lösenordet är sparat (visas inte)' : '', n.recent ? 'senast anslutet' : '', n.connected === false ? 'aldrig anslutet' : ''].filter(Boolean);
                        return kv(n.ssid, '', bits.join(' · '));
                    }).join('') + '<small class="d-kv-src d-kv-foot">' + esc(s.source + (devicePlatform() === 'iOS' ? ' · AddedAt, LastAssociatedAt, JoinedByUserAt, JoinedBySystemAt' : ' · SSID, ConfigKey, HasEverConnected')) + '</small>';
            }
            if (s.accounts !== undefined) {
                html = s.accounts === null ? kv('Konton', 'Inte läst', s.source.split(' · ')[0] + ' finns inte i ' + Z()) : !s.accounts.length ? kv('Konton', 'Inga konton', s.source) :
                    s.accounts.map(function (a) { return kv(a.user || 'Utan namn', '', [a.kinds.join(', '), a.firstMs ? 'först ' + t(a.firstMs) : ''].filter(Boolean).join(' · ')); }).join('') + '<small class="d-kv-src d-kv-foot">' + esc(s.source) + '</small>';
            }
            if (s.bluetooth !== undefined) {
                var b = s.bluetooth;
                html = b === null ? kv('Bluetooth', 'Inte läst', s.source + ' finns inte i ' + Z()) : (b.adapter ? kv('Telefonens namn', b.adapter.name, s.source + ' · Adapter/Name') + kv('Adress', b.adapter.address, s.source + ' · Adapter/Address') : '') +
                    (b.devices.length ? b.devices.map(function (d) { return kv(d.name || d.address, '', [d.address, d.type, d.paired ? 'parkopplad' : 'inte parkopplad', d.ms ? 'senast ' + t(d.ms) : ''].filter(Boolean).join(' · ')); }).join('') : kv('Enheter', 'Inga sparade enheter', s.source)) +
                    '<small class="d-kv-src d-kv-foot">' + esc(s.source + ' · ' + (s.foot || 'en del per adress: Name, DevType, LinkKey, Timestamp')) + '</small>';
            }
            if (!html) html = '<p class="d-empty">Inget lästes för ' + esc(s.title.toLowerCase()) + '.</p>';
        }
        $('c-device-sub').textContent = 'Tider i ' + ($('c-zone').selectedOptions[0] ? $('c-zone').selectedOptions[0].textContent : 'vald tidszon');
        body.innerHTML = '<div class="d-kvs">' + html + '</div>';
    }

    // ---------- Anteckningar ----------
    // Apples Anteckningar eller Samsung Notes, lästa med telefonens övriga filer (loadDeviceInfo, Notes.read).

    function deviceMemos() {
        var info = state.device.info;
        return info && info.zip === state.zip && info.state === 'ready' && info.memos ? info.memos : null;
    }
    var NOTE_FILTERS = [['all', 'Alla'], ['locked', 'Låsta'], ['deleted', 'Raderade']];
    function noteBadges(n) {
        return (n.pinned ? '<span class="n-badge">Fäst</span>' : '') + (n.locked ? '<span class="n-badge lock">Låst</span>' : '') + (n.deleted ? '<span class="n-badge del">Raderad</span>' : '');
    }
    function renderNotes(body) {
        var P = state.device, f = fmt(), m = deviceMemos();
        body.style.backgroundImage = '';
        $('c-device-title').textContent = 'Anteckningar';
        if (!m) {
            var busy = P.info && P.info.state === 'busy';
            $('c-device-sub').textContent = '';
            body.innerHTML = '<p class="d-empty">' + (busy ? '<span class="c-spin" aria-hidden="true"></span> Läser anteckningarna…' : 'Extraktionen har ingen anteckningsdatabas (NoteStore.sqlite eller Samsung Notes).') + '</p>';
            return;
        }
        var counts = { all: m.notes.length, locked: m.notes.filter(function (n) { return n.locked; }).length, deleted: m.notes.filter(function (n) { return n.deleted; }).length };
        var keep = function (n) { return P.noteFilter === 'locked' ? n.locked : P.noteFilter === 'deleted' ? n.deleted : true; };
        $('c-device-sub').textContent = (m.app !== 'Anteckningar' ? m.app + ' · ' : '') + many(m.notes.length, 'anteckning', 'anteckningar') + ' · ' + baseName(m.file);
        var chips = '<div class="n-chips" role="group" aria-label="Urval">' + NOTE_FILTERS.map(function (x) {
            return '<button type="button" class="n-chip" data-note-filter="' + x[0] + '" aria-pressed="' + (P.noteFilter === x[0]) + '">' + esc(x[1]) + ' <span>' + num(counts[x[0]]) + '</span></button>';
        }).join('') + '</div>';
        // En rubrik per mapp, som i appen: de raderade sist. Fästa först i mappen, sedan den senast ändrade.
        var groups = {}, order = [];
        m.notes.filter(keep).forEach(function (n) {
            var k = (n.deleted && !n.folder ? 'Raderade' : n.folder || 'Utan mapp') + (n.account ? ' · ' + n.account : '');
            if (!groups[k]) { groups[k] = { title: k, trash: n.deleted && (/raderade|papperskorg|trash|deleted/i.test(n.folderKind + ' ' + n.folder) || !n.folder), list: [] }; order.push(k); }
            groups[k].list.push(n);
        });
        order.sort(function (a, b) { return (groups[a].trash - groups[b].trash) || a.localeCompare(b, 'sv'); });
        var shown = 0, html = order.map(function (k) {
            var g = groups[k];
            g.list.sort(function (a, b) { return (b.pinned - a.pinned) || ((b.modifiedMs || 0) - (a.modifiedMs || 0)); });
            var rows = g.list.filter(function () { return shown++ < P.limit; }).map(function (n) {
                var first = n.locked ? 'Låst anteckning' + (n.hint ? ' · tips: ' + n.hint : '') : n.error ? n.error : String(n.text || n.snippet || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean).filter(function (l) { return l !== n.title; })[0] || 'Ingen mer text';
                return '<button type="button" class="d-row n-row" data-note-id="' + n.id + '" title="' + esc(n.source) + '"><span class="d-row-text">' +
                    '<span class="d-row-top"><b>' + esc(n.title || 'Ny anteckning') + '</b><time>' + esc(n.modifiedMs ? f(n.modifiedMs).slice(0, 10) : '') + '</time></span>' +
                    '<span class="d-row-sub">' + noteBadges(n) + esc(first) + '</span></span></button>';
            }).join('');
            return rows ? '<p class="n-sec">' + esc(g.title) + ' <span>' + num(g.list.length) + '</span></p>' + rows : '';
        }).join('');
        var total = order.reduce(function (s, k) { return s + groups[k].list.length; }, 0);
        body.innerHTML = chips + (html || '<p class="d-empty">Inga anteckningar i urvalet.</p>') +
            (total > P.limit ? '<button type="button" class="c-btn d-more" data-device-more="1">Visa fler (' + num(total - P.limit) + ' kvar)</button>' : '') +
            (m.errors.length ? '<p class="d-empty warn">' + esc(m.errors.slice(0, 3).join(' ')) + '</p>' : '') +
            '<p class="d-note">Ur ' + esc(m.file) + '. Raderade anteckningar ligger kvar i appen i 30 dagar. En låst antecknings text är krypterad; titeln och tiderna syns.</p>';
    }
    function renderNote(body) {
        var P = state.device, f = fmt(), m = deviceMemos();
        body.style.backgroundImage = '';
        var n = m && m.notes.filter(function (x) { return x.id === P.note; })[0];
        if (!n) { openDevice('notes'); return; }
        var t = function (ms) { return ms ? f(ms) : ''; };
        $('c-device-title').textContent = n.title || 'Anteckning';
        $('c-device-sub').textContent = [n.folder, n.modifiedMs ? 'ändrad ' + t(n.modifiedMs) : ''].filter(Boolean).join(' · ');
        var text = n.text != null ? '<div class="n-text">' + esc(n.text.replace(/￼/g, '[bilaga]')) + '</div>' : '<p class="d-empty warn">' + esc(n.error || 'Texten finns inte.') + '</p>';
        var att = n.attachments.length ? kv('Bilagor', n.attachments.map(function (a) { return (a.name || 'namnlös') + (a.uti ? ' (' + a.uti + ')' : ''); }).join(', '), 'Filerna ligger under anteckningskontots Media/ och FallbackImages/ i appgruppen.') : '';
        var meta = [
            kv('Skapad', t(n.createdMs), n.app === 'Anteckningar' ? 'ZCREATIONDATE3 (äldre iOS ZCREATIONDATE1)' : 'sdoc · createdAt'),
            kv('Ändrad', t(n.modifiedMs), n.app === 'Anteckningar' ? 'ZMODIFICATIONDATE1' : 'sdoc · lastModifiedAt'),
            kv('Mapp', n.folder + (n.folderKind && n.folderKind !== 'vanlig' ? ' (' + n.folderKind + ')' : '') + (n.account ? ' · ' + n.account : '')),
            n.locked ? kv('Låst', 'Ja' + (n.hint ? ', tipset: ' + n.hint : ''), n.app === 'Anteckningar' ? 'ZISPASSWORDPROTECTED, ZPASSWORDHINT' : 'sdoc · isLock') : '',
            n.deleted ? kv('Raderad', n.deletedHow + (n.deletedMs ? ', ' + t(n.deletedMs) : ''), n.app === 'Anteckningar' ? 'ZFOLDERTYPE 1 eller ZMARKEDFORDELETION' : 'sdoc · categoryUUID, recycle_bin_time_moved, isDeleted') : '',
            n.pinned ? kv(n.app === 'Anteckningar' ? 'Fäst' : 'Favorit', 'Ja') : '',
            n.checklist ? kv('Checklista', n.checked + ' av ' + n.checklist + ' avbockade') : '',
            n.links.length ? kv('Länkar', n.links.join(' ')) : '',
            att,
            kv('Titeln', n.titleFrom === 'första raden' ? 'Första raden i texten (anteckningen har ingen egen titel)' : 'Egen titel', n.titleFrom === 'första raden' ? '' : n.app === 'Anteckningar' ? 'ZTITLE1' : 'sdoc · title'),
            kv('Källa', n.source, m.file),
            n.uuid ? kv('Identifierare', n.uuid) : '',
        ].join('');
        body.innerHTML = '<div class="n-head">' + noteBadges(n) + '</div>' + text + '<div class="d-kvs">' + meta + '</div>';
    }

    // ---------- Webbhistorik (queries/web, Web) ----------

    function deviceWeb() {
        var w = state.web;
        return w && w.zip === state.zip && w.state === 'ready' && w.browsers.length ? w : null;
    }
    function webBrowser(id) {
        var w = deviceWeb();
        return w && id ? w.browsers.filter(function (b) { return b.id === id; })[0] || null : null;
    }
    // Ikonen för en webbläsare med data: telefonens egen ikon, annars en jordglob. Siffran är antalet besök.
    function webAppHtml(b, name, id) {
        var n = b.visits ? b.visits.length : b.tabs ? b.tabs.length : 0, what = b.visits ? many(n, 'besök', 'besök') : many(n, 'flik', 'flikar');
        var url = phoneIcon(id || b.id);
        return '<button type="button" class="d-app has-data" data-device-web="' + esc(b.id) + '" aria-label="' + esc(name + ', ' + what) + '" title="' + esc(name + ' · ' + b.id) + '">' +
            iconHtml(name === 'Safari' ? 'Safari' : 'Webbläsare', badgeHtml(false, false, n), name, url) + '<span class="d-name">' + esc(name) + '</span></button>';
    }
    var WEB_TABS = [['visits', 'Historik'], ['searches', 'Sökningar'], ['downloads', 'Nedladdningar'], ['tabs', 'Flikar'], ['cleared', 'Rensat']];
    function webTabsOf(b) { return WEB_TABS.filter(function (t) { return b[t[0]] && (b[t[0]].length || t[0] === 'visits'); }); }
    function webList(b, tab) { return b[tab] || []; }
    function renderWeb(body) {
        var P = state.device, f = fmt(), b = webBrowser(P.web);
        body.style.backgroundImage = '';
        if (!b) { openDevice('home'); return; }
        var tabs = webTabsOf(b);
        if (!tabs.some(function (t) { return t[0] === P.webTab; })) P.webTab = tabs.length ? tabs[0][0] : 'visits';
        var all = webList(b, P.webTab), shown = all.slice(0, P.limit);
        $('c-device-title').textContent = b.name;
        $('c-device-sub').textContent = (b.visits ? many(b.visits.length, 'besök', 'besök') + ' · ' : '') + baseName(b.files[P.webTab] || b.files.visits || '');
        var chips = '<div class="n-chips" role="group" aria-label="Urval">' + tabs.map(function (t) {
            return '<button type="button" class="n-chip" data-web-tab="' + t[0] + '" aria-pressed="' + (P.webTab === t[0]) + '">' + esc(t[1]) + ' <span>' + num(b[t[0]].length) + '</span></button>';
        }).join('') + '</div>';
        var day = null;
        var rows = shown.map(function (x) {
            var i = all.indexOf(x), d = x.ms ? f(x.ms).slice(0, 10) : 'Utan tid', head = '', top, sub, cls = '';
            if (P.webTab !== 'tabs' && d !== day) { day = d; head = '<p class="n-sec">' + esc(d) + '</p>'; }
            if (P.webTab === 'visits') {
                top = x.title || x.host || x.url;
                sub = [x.host, x.transition || (x.loaded === 0 ? 'laddades inte' : ''), x.origin === 'synced' ? 'synkad' : ''].filter(Boolean).join(' · ');
                if (x.origin === 'synced') cls = ' w-synced';
            } else if (P.webTab === 'searches') {
                top = x.term; sub = [x.engine, x.host].filter(Boolean).join(' · ');
            } else if (P.webTab === 'downloads') {
                top = x.name; sub = [x.host, x.state, Web.sizeText(x.size)].filter(Boolean).join(' · ');
            } else if (P.webTab === 'tabs') {
                if (x.group !== day) { day = x.group; head = '<p class="n-sec">' + esc(x.group) + '</p>'; }
                top = x.title || x.host || x.url; sub = [x.host, x.closedMs ? 'stängd' : ''].filter(Boolean).join(' · ');
            } else {
                top = x.url ? x.host || x.url : 'Allt i spannet'; sub = (x.startMs ? f(x.startMs).slice(0, 16) : '') + ' – ' + (x.endMs ? f(x.endMs).slice(0, 16) : '');
            }
            var time = P.webTab === 'tabs' ? (x.ms ? f(x.ms).slice(0, 16) : '') : x.ms ? f(x.ms).slice(11, 16) : '';
            return head + '<button type="button" class="d-row w-row' + cls + '" data-web-id="' + i + '" title="' + esc(x.url || '') + '"><span class="d-row-text">' +
                '<span class="d-row-top"><b>' + esc(top) + '</b><time>' + esc(time) + '</time></span><span class="d-row-sub">' + esc(sub) + '</span></span></button>';
        }).join('');
        var notes = {
            visits: 'Tiderna i vald zon. ' + (b.platform === 'iOS' ? 'Ett besök synkat från en annan enhet (iCloud) märks. Raderade besök finns inte kvar; rensad historik lämnar spår under Rensat.' : 'Övergången säger hur besöket kom till: länk, skriven adress, sökning, omladdning. Ett besök synkat från en annan enhet märks.'),
            searches: b.platform === 'iOS' ? 'Söktermerna läses ur adresserna (Google, Bing, DuckDuckGo, Ecosia, Brave, Startpage, Yahoo). Tiden är besöket.' : 'Söktermerna som skrevs i adressfältet, med tiden för det senaste besöket på sökadressen.',
            downloads: 'Nedladdningarna med adressen, sidan de kom från och var filen sparades. Filen kan finnas kvar i zippen under sin sökväg.',
            tabs: 'Flikarna när extraktionen gjordes, också de privata. Tiden är flikens senaste besök (LastVisitTime).',
            cleared: 'Spåren efter rensad historik: tidsspannet som rensades, eller adressen när en enda sida togs bort.',
        };
        body.innerHTML = chips + (rows || '<p class="d-empty">Inget i ' + esc((WEB_TABS.filter(function (t) { return t[0] === P.webTab; })[0] || ['', 'urvalet'])[1].toLowerCase()) + '.</p>') +
            (all.length > shown.length ? '<button type="button" class="c-btn d-more" data-device-more="1">Visa fler (' + num(all.length - shown.length) + ' kvar)</button>' : '') +
            '<p class="d-note">Ur ' + esc(b.files[P.webTab] || '') + '. ' + esc(notes[P.webTab] || '') + '</p>' +
            (state.web.errors.length ? '<p class="d-empty warn">' + esc(state.web.errors.join(' ')) + '</p>' : '');
    }
    function renderWebItem(body) {
        var P = state.device, f = fmt(), b = webBrowser(P.web);
        body.style.backgroundImage = '';
        var x = b ? webList(b, P.webTab)[P.webItem] : null;
        if (!x) { openDevice('web'); return; }
        var ios = b.platform === 'iOS', t = function (ms) { return ms ? f(ms) : ''; }, rows = [];
        if (P.webTab === 'visits') {
            $('c-device-title').textContent = x.title || x.host || 'Besök';
            rows = [
                kv('Tid', t(x.ms), ios ? 'history_visits.visit_time (Cocoa-sekunder: ' + x.raw + ')' : 'visits.visit_time (mikrosekunder sedan 1601)'),
                kv('Adress', x.url, ios ? 'history_items.url' : 'urls.url'),
                x.title ? kv('Titel', x.title, ios ? 'history_visits.title' : 'urls.title') : '',
                x.originText ? kv('Ursprung', x.originText, ios ? 'history_visits.origin' : 'visits.originator_cache_guid') : '',
                x.transition ? kv('Övergång', x.transition + (x.qualifiers ? ' (' + x.qualifiers + ')' : ''), 'visits.transition') : '',
                x.durationS ? kv('Tid på sidan', Comms.durationText(x.durationS) + ' (' + x.durationS + ' s)', 'visits.visit_duration') : '',
                x.from ? kv('Från sidan', x.from, 'visits.from_visit') : '',
                x.redirectFrom ? kv('Omdirigerad från', x.redirectFrom, 'history_visits.redirect_source') : '',
                ios && x.loaded !== null ? kv('Laddades', x.loaded ? 'Ja' : 'Nej', 'history_visits.load_successful') : '',
                x.form ? kv('Formulär', 'Ja, inte en vanlig hämtning (POST)', 'history_visits.http_non_get') : '',
                x.app ? kv('App', nameOfApp(x.app) + ' (' + x.app + ')', 'visits.app_id') : '',
                x.count !== null ? kv('Besök på adressen', String(x.count) + (x.typed ? ', ' + x.typed + ' skrivna' : ''), ios ? 'history_items.visit_count' : 'urls.visit_count, typed_count') : '',
                kv('Källa', (ios ? 'history_visits rad ' : 'visits rad ') + x.id, b.files.visits),
            ];
        } else if (P.webTab === 'searches') {
            $('c-device-title').textContent = x.term;
            rows = [kv('Sökterm', x.term, ios ? 'ur adressen (q= eller p=)' : 'keyword_search_terms.term'), kv('Tid', t(x.ms), ios ? 'history_visits.visit_time' : 'urls.last_visit_time (senaste besöket)'),
                x.engine ? kv('Sökmotor', x.engine) : '', kv('Adress', x.url), kv('Källa', (ios ? 'history_visits rad ' : 'urls rad ') + x.id, b.files.searches)];
        } else if (P.webTab === 'downloads') {
            $('c-device-title').textContent = x.name;
            rows = [kv('Fil', x.path, 'downloads.target_path', x.mediaStore ? 'En post i MediaStore (_id ' + x.mediaStore + '), som säger var filen ligger.' : ''), x.current && x.current !== x.path ? kv('Sparad som', x.current, 'downloads.current_path') : '',
                kv('Började', t(x.ms), 'downloads.start_time'), x.endMs ? kv('Klar', t(x.endMs), 'downloads.end_time') : '', kv('Läge', x.state + (x.opened ? ', öppnad' : ''), 'downloads.state, opened'),
                x.size !== null ? kv('Storlek', Web.sizeText(x.size) + ' (' + num(x.size) + ' byte)' + (x.received !== null && x.received !== x.size ? ', ' + num(x.received) + ' mottagna' : ''), 'downloads.total_bytes, received_bytes') : '',
                x.mime ? kv('Typ', x.mime, 'downloads.mime_type') : '', kv('Adress', x.url, 'downloads_url_chains (sista)'),
                x.chain && x.chain !== x.url ? kv('Omdirigeringar', x.chain, 'downloads_url_chains') : '', x.referrer ? kv('Hänvisning', x.referrer, 'downloads.referrer') : '',
                x.tab ? kv('Fliken', x.tab, 'downloads.tab_url') : '', x.tabReferrer ? kv('Flikens hänvisning', x.tabReferrer, 'downloads.tab_referrer_url') : '',
                x.lastAccessMs ? kv('Senast öppnad', t(x.lastAccessMs), 'downloads.last_access_time') : '', kv('Källa', 'downloads rad ' + x.id, b.files.downloads)];
        } else if (P.webTab === 'tabs') {
            $('c-device-title').textContent = x.title || x.host || 'Flik';
            rows = [kv('Adress', x.url, 'bookmarks.url'), x.title ? kv('Titel', x.title, 'bookmarks.title') : '', kv('Grupp', x.group + (x.private ? ' (privat surfning)' : ''), 'bookmarks.parent, windows'),
                kv('Senaste besöket', x.ms ? t(x.ms) : 'Saknas', 'local_attributes · LastVisitTime'), x.closedMs ? kv('Stängd', t(x.closedMs), 'bookmarks.date_closed') : '',
                kv('Källa', 'bookmarks rad ' + x.id, b.files.tabs)];
        } else {
            $('c-device-title').textContent = 'Rensad historik';
            rows = [kv('Från', t(x.startMs), 'history_tombstones.start_time'), kv('Till', t(x.endMs), 'history_tombstones.end_time'), kv('Adress', x.url || 'Alla adresser i spannet', 'history_tombstones.url'),
                kv('Källa', 'history_tombstones rad ' + x.id, b.files.cleared)];
        }
        $('c-device-sub').textContent = b.name + (x.ms ? ' · ' + f(x.ms) : '');
        body.innerHTML = '<div class="d-kvs">' + rows.join('') + '</div>';
    }

    // ---------- Samtal och kontakter (queries/comms, Comms) ----------

    function deviceComms() {
        var c = state.comms;
        return c && c.zip === state.zip && c.state === 'ready' ? c : null;
    }
    function commsWaiting(body, what) {
        var c = state.comms, busy = c && c.zip === state.zip && (c.state === 'busy' || c.state === 'wait');
        $('c-device-sub').textContent = '';
        body.innerHTML = '<p class="d-empty">' + (busy ? '<span class="c-spin" aria-hidden="true"></span> Läser ' + what + '…' : 'Extraktionen har ingen databas med ' + what + (what === 'samtalen' ? ' (CallHistory.storedata eller calllog.db).' : ' (AddressBook.sqlitedb eller contacts2.db).')) + '</p>' +
            (c && c.errors.length ? '<p class="d-empty warn">' + esc(c.errors.join(' ')) + '</p>' : '');
    }
    // Namnet att visa för ett samtal: kontakten i telefonen, annars namnet i loggen, annars numret.
    function callWho(x) {
        var k = contactOf(x.number);
        return k ? k.name : x.name || (x.hidden ? x.hidden.charAt(0).toUpperCase() + x.hidden.slice(1) : '') || x.number || 'Okänt nummer';
    }
    var PHONE_APPS = /^(com\.apple\.Telephony|com\.android\.phone|com\.android\.server\.telecom|com\.samsung\.android\.incallui|com\.google\.android\.dialer)$/;
    function callApp(x) {
        if (!x.app || PHONE_APPS.test(x.app)) return x.type === 'FaceTime video' || x.type === 'FaceTime ljud' ? x.type : '';
        if (x.app === 'com.apple.FaceTime') return x.type || 'FaceTime';
        return nameOfApp(x.app);
    }
    var CALL_FILTERS = [['all', 'Alla'], ['missed', 'Missade'], ['apps', 'I appar']];
    function callKeep(x, flt) {
        return flt === 'missed' ? /^(missed|rejected|blocked)$/.test(x.direction) : flt === 'apps' ? !!callApp(x) && !/^FaceTime/.test(callApp(x)) : true;
    }
    var CALL_ARROW = { in: '↙', out: '↗', missed: '↙', rejected: '↙', blocked: '⊘', voicemail: '↙', elsewhere: '↙', other: '·' };
    function renderCalls(body) {
        var P = state.device, f = fmt(), c = deviceComms();
        body.style.backgroundImage = '';
        $('c-device-title').textContent = 'Samtal';
        if (!c || !c.calls) return commsWaiting(body, 'samtalen');
        var all = c.calls, list = all.filter(function (x) { return callKeep(x, P.callFilter); }), shown = list.slice(0, P.limit);
        $('c-device-sub').textContent = many(all.length, 'samtal', 'samtal') + ' · ' + baseName(c.files.calls);
        var chips = '<div class="n-chips" role="group" aria-label="Urval">' + CALL_FILTERS.map(function (x) {
            return '<button type="button" class="n-chip" data-call-filter="' + x[0] + '" aria-pressed="' + (P.callFilter === x[0]) + '">' + esc(x[1]) + ' <span>' + num(all.filter(function (y) { return callKeep(y, x[0]); }).length) + '</span></button>';
        }).join('') + '</div>';
        var day = null;
        var rows = shown.map(function (x) {
            var i = all.indexOf(x), who = callWho(x), app = callApp(x), d = x.ms ? f(x.ms).slice(0, 10) : 'Utan tid', head = '';
            if (d !== day) { day = d; head = '<p class="n-sec">' + esc(d) + '</p>'; }
            var sub = [CALL_ARROW[x.direction] + ' ' + x.dirText, app, x.duration ? Comms.durationText(x.duration) : ''].filter(Boolean).join(' · ');
            return head + '<button type="button" class="d-row k-row' + (/^(missed|rejected|blocked)$/.test(x.direction) ? ' missed' : '') + '" data-call-id="' + i + '" title="' + esc(x.number) + '">' +
                '<span class="c-av p' + ChatCore.hueOf(who) + '" data-initial="' + esc(ChatCore.initialOf(who)) + '" aria-hidden="true"></span><span class="d-row-text">' +
                '<span class="d-row-top"><b>' + esc(who) + '</b><time>' + esc(x.ms ? f(x.ms).slice(11, 16) : '') + '</time></span><span class="d-row-sub">' + esc(sub) + '</span></span></button>';
        }).join('');
        body.innerHTML = chips + (rows || '<p class="d-empty">Inga samtal i urvalet.</p>') +
            (list.length > shown.length ? '<button type="button" class="c-btn d-more" data-device-more="1">Visa fler (' + num(list.length - shown.length) + ' kvar)</button>' : '') +
            '<p class="d-note">Ur ' + esc(c.files.calls) + '. Tiderna är när samtalet började, i vald zon. Namnet är kontaktens i telefonen när numret finns i Kontakter, annars det som loggen sparade. Ett raderat samtal finns inte kvar i loggen.</p>';
    }
    // Chattar och meddelanden med en motpart: trådar vars nummer eller deltagare har samma nummer.
    function chatsWith(values) {
        var keys = {};
        values.forEach(function (v) { var k = Comms.phoneKey(v); if (k) keys[k] = true; });
        var out = [];
        if (!Object.keys(keys).length) return out;
        state.dbs.forEach(function (d, di) {
            (d.threads || []).forEach(function (t) {
                var hit = keys[Comms.phoneKey(t.address)] || (d.members[t.key] || []).some(function (p) { return keys[Comms.phoneKey(p.address)] || keys[Comms.phoneKey(p.id)]; });
                if (hit) out.push({ db: di, thread: t, app: d.src.app });
            });
        });
        return out;
    }
    function threadRows(list) {
        var f = fmt();
        return list.slice(0, 20).map(function (x) {
            var t = x.thread;
            return '<button type="button" class="d-row" data-db="' + x.db + '" data-thread="' + esc(t.key) + '"><span class="c-av p' + ChatCore.hueOf(t.key) + '" data-initial="' + esc(ChatCore.initialOf(t.name)) + '" aria-hidden="true"></span><span class="d-row-text">' +
                '<span class="d-row-top"><b>' + esc(t.name) + '</b><time>' + esc(t.lastMs ? f(t.lastMs).slice(0, 10) : '') + '</time></span><span class="d-row-sub">' + esc(x.app + (t.messages !== null ? ' · ' + many(t.messages, 'meddelande', 'meddelanden') : '')) + '</span></span></button>';
        }).join('');
    }
    function renderCall(body) {
        var P = state.device, f = fmt(), c = deviceComms();
        body.style.backgroundImage = '';
        var x = c && c.calls ? c.calls[P.call] : null;
        if (!x) { openDevice('calls'); return; }
        var ios = c.platform === 'iOS', k = contactOf(x.number), app = callApp(x);
        $('c-device-title').textContent = callWho(x);
        $('c-device-sub').textContent = x.dirText + (x.ms ? ' · ' + f(x.ms) : '');
        var meta = [
            kv('Riktning', x.dirText, ios ? 'ZORIGINATED, ZANSWERED' : 'calls.type (' + x.typeRaw + ')'),
            kv('Började', x.ms ? f(x.ms) : 'Tiden saknas', ios ? 'ZDATE (Cocoa-sekunder: ' + x.raw + ')' : 'calls.date (millisekunder: ' + x.raw + ')'),
            kv('Längd', x.duration !== null ? Comms.durationText(x.duration) + ' (' + Math.round(x.duration) + ' s)' : '', ios ? 'ZDURATION' : 'calls.duration'),
            kv(app && !/^FaceTime/.test(app) ? 'Motpart i appen' : 'Nummer', x.number || x.hidden || 'Saknas', ios ? 'ZADDRESS' : 'calls.number', app && !/^FaceTime/.test(app) && !Comms.phoneKey(x.number) ? 'Appens id för motparten, inte ett telefonnummer.' : ''),
            x.name ? kv('Namn i loggen', x.name, ios ? 'ZNAME' : 'calls.name', ios && app ? 'Namnet som appen gav samtalet.' : 'Kontaktens namn när samtalet loggades.') : '',
            k ? kv('Kontakt i telefonen', k.name, baseName(c.files.contacts || ''), 'Matchad på numrets sista nio siffror.') : '',
            kv('Slag', [x.type, app].filter(Boolean).filter(function (v, i, l) { return l.indexOf(v) === i; }).join(' · ') || 'Telefon', ios ? 'ZCALLTYPE, ZSERVICE_PROVIDER' : 'calls.features, subscription_component_name'),
            x.app ? kv('App-id', x.app) : '',
            x.others.length ? kv('Fler deltagare', x.others.join(', '), ios ? 'ZHANDLE via Z_2REMOTEPARTICIPANTHANDLES' : '') : '',
            x.country || x.place ? kv('Land och plats', [x.country, x.place].filter(Boolean).join(' · '), ios ? 'ZISO_COUNTRY_CODE, ZLOCATION' : 'countryiso, geocoded_location') : '',
            x.account ? kv('Telefonens konto', x.account, 'phone_account_address') : '',
            x.read !== null ? kv('Läst', x.read ? 'Ja' : 'Nej', ios ? 'ZREAD' : 'is_read') : '',
            x.cause !== null && ios ? kv('Orsak till slut', String(x.cause), 'ZDISCONNECTED_CAUSE', 'Värdenas betydelse är inte kontrollerad.') : '',
            x.uid ? kv('Identifierare', x.uid, 'ZUNIQUE_ID') : '',
            kv('Källa', (ios ? 'ZCALLRECORD rad ' : 'calls rad ') + x.id, c.files.calls),
        ].join('');
        var chats = chatsWith([x.number].concat(x.others));
        body.innerHTML = (k ? '<button type="button" class="c-btn k-open" data-contact-id="' + esc(k.id) + '">Visa kontakten</button>' : '') + '<div class="d-kvs">' + meta + '</div>' +
            (chats.length ? '<p class="n-sec">Chattar med numret</p>' + threadRows(chats) : '');
    }
    function contactBadges(k) {
        return (k.starred ? '<span class="n-badge">Favorit</span>' : '') + (k.deleted ? '<span class="n-badge del">Raderad</span>' : '');
    }
    function renderContacts(body) {
        var P = state.device, c = deviceComms();
        body.style.backgroundImage = '';
        $('c-device-title').textContent = 'Kontakter';
        if (!c || !c.contacts) return commsWaiting(body, 'kontakterna');
        var list = c.contacts.list, shown = list.slice(0, P.limit), letter = null;
        $('c-device-sub').textContent = many(list.length, 'kontakt', 'kontakter') + ' · ' + baseName(c.files.contacts);
        var rows = shown.map(function (k) {
            var l = (k.sortName.charAt(0) || '#').toLocaleUpperCase('sv'), head = '';
            if (!/\p{L}/u.test(l)) l = '#';
            if (l !== letter) { letter = l; head = '<p class="n-sec">' + esc(l) + '</p>'; }
            var sub = [k.phones[0] ? k.phones[0].value : k.emails[0] ? k.emails[0].value : '', k.org && k.org !== k.name ? k.org : ''].filter(Boolean).join(' · ');
            return head + '<button type="button" class="d-row k-row" data-contact-id="' + esc(k.id) + '"><span class="c-av p' + ChatCore.hueOf(k.id) + '" data-initial="' + esc(ChatCore.initialOf(k.name)) + '" aria-hidden="true"></span><span class="d-row-text">' +
                '<span class="d-row-top"><b>' + esc(k.name) + '</b></span><span class="d-row-sub">' + contactBadges(k) + esc(sub) + '</span></span></button>';
        }).join('');
        body.innerHTML = (rows || '<p class="d-empty">Inga kontakter.</p>') +
            (list.length > shown.length ? '<button type="button" class="c-btn d-more" data-device-more="1">Visa fler (' + num(list.length - shown.length) + ' kvar)</button>' : '') +
            '<p class="d-note">Ur ' + esc(c.files.contacts) + '. Queries visar också ändrade och raderade kontakter.</p>';
    }
    function renderContact(body) {
        var P = state.device, f = fmt(), c = deviceComms();
        body.style.backgroundImage = '';
        var k = c && c.contacts ? c.contacts.list.filter(function (x) { return x.id === P.contact; })[0] : null;
        if (!k) { openDevice('contacts'); return; }
        var ios = c.platform === 'iOS';
        $('c-device-title').textContent = k.name;
        $('c-device-sub').textContent = [k.org !== k.name ? k.org : '', k.account].filter(Boolean).join(' · ');
        var points = function (list, word) { return list.map(function (p) { return kv(p.label || word, p.value, p.account && !ios ? 'Konto: ' + p.account : ''); }).join(''); };
        var meta = [
            points(k.phones, 'Telefon'), points(k.emails, 'E-post'),
            k.org ? kv('Företag', k.org + (k.title ? ', ' + k.title : '')) : '',
            k.nick ? kv('Smeknamn', k.nick) : '',
            k.birthday ? kv('Födelsedag', k.birthday) : '',
            k.note ? kv('Anteckning', k.note) : '',
            k.account ? kv('Konto', k.account, ios ? 'ABStore' : 'accounts.account_type') : '',
            k.createdMs ? kv('Skapad', f(k.createdMs), 'ABPerson.CreationDate') : '',
            k.modifiedMs ? kv('Ändrad', f(k.modifiedMs), 'ABPerson.ModificationDate') : '',
            k.contacted ? kv('Kontaktad', many(k.contacted, 'gång', 'gånger') + (k.lastContactedMs ? ', senast ' + f(k.lastContactedMs) : ''), 'raw_contacts.times_contacted, last_time_contacted') : '',
            k.deleted ? kv('Raderad', 'Markerad som raderad men inte synkad', 'raw_contacts.deleted') : '',
            kv('Källa', (ios ? 'ABPerson rad ' : 'contact_id ') + k.id, c.files.contacts),
        ].join('');
        var nums = k.phones.concat(k.emails).map(function (p) { return Comms.phoneKey(p.value); }).filter(Boolean);
        var calls = (c.calls || []).filter(function (x) { return nums.indexOf(Comms.phoneKey(x.number)) >= 0; });
        var chats = chatsWith(k.phones.concat(k.emails).map(function (p) { return p.value; }));
        body.innerHTML = '<div class="n-head">' + contactBadges(k) + '</div><div class="d-kvs">' + meta + '</div>' +
            (calls.length ? '<p class="n-sec">Samtal (' + num(calls.length) + ')</p>' + calls.slice(0, 10).map(function (x) {
                var app = callApp(x);
                return '<button type="button" class="d-row k-row' + (/^(missed|rejected|blocked)$/.test(x.direction) ? ' missed' : '') + '" data-call-id="' + c.calls.indexOf(x) + '"><span class="d-row-text"><span class="d-row-top"><b>' + esc(CALL_ARROW[x.direction] + ' ' + x.dirText) + '</b><time>' + esc(x.ms ? f(x.ms).slice(0, 16) : '') + '</time></span><span class="d-row-sub">' + esc([app, x.duration ? Comms.durationText(x.duration) : ''].filter(Boolean).join(' · ')) + '</span></span></button>';
            }).join('') : '') +
            (chats.length ? '<p class="n-sec">Chattar</p>' + threadRows(chats) : '');
    }

    // Låsskärmen: notiserna, den senaste först, med en rubrik per dag och telefonens bakgrund för låsskärmen bakom.
    function renderLock(body) {
        var P = state.device, info = P.info, f = fmt();
        $('c-device-title').textContent = 'Låsskärm';
        if (!info || info.state !== 'ready') { body.innerHTML = '<p class="d-empty"><span class="c-spin" aria-hidden="true"></span> Läser telefonens filer…</p>'; return; }
        var list = info.notifications || [], shown = list.slice(0, P.limit), day = null;
        var wall = info.wall && (info.wall.lock || info.wall.home);
        body.classList.toggle('has-wall', !!wall);
        body.style.backgroundImage = wall ? 'url("' + wall + '")' : '';
        $('c-device-sub').textContent = many(list.length, 'notis', 'notiser') + (list.length ? ' · ' + f(list[list.length - 1].ms).slice(0, 10) + ' – ' + f(list[0].ms).slice(0, 10) : '');
        var html = shown.map(function (n, i) {
            var d = n.ms ? f(n.ms).slice(0, 10) : 'Utan tid', head = '';
            if (d !== day) { day = d; head = '<h3 class="d-day">' + esc(d) + '</h3>'; }
            var name = nameOfApp(n.app);
            return head + '<button type="button" class="d-notif" data-notif="' + i + '">' + iconHtml(DeviceInfo.roleOf(n.app), '', name, phoneIcon(n.app)) +
                '<span class="d-notif-text"><span class="d-notif-top"><b>' + esc(name) + '</b><time>' + esc(n.ms ? f(n.ms).slice(11, 16) : '') + '</time></span>' +
                (n.title ? '<span class="d-notif-title">' + esc(n.title) + '</span>' : '') + (n.text ? '<span class="d-notif-body">' + esc(n.text) + '</span>' : '') + '</span></button>';
        }).join('');
        body.innerHTML = '<div class="d-lock">' + statusBarHtml() + (html || '<p class="d-empty">Inga notiser.</p>') + (list.length > shown.length ? '<button type="button" class="c-btn d-more" data-device-more="1">Visa fler (' + num(list.length - shown.length) + ' kvar)</button>' : '') + '</div>' +
            '<p class="d-note">' + esc(info.notifNote) + ' Tiderna i vald zon.</p>';
    }
    function openNotification(i) {
        var info = state.device.info, n = info && info.notifications ? info.notifications[i] : null, f = fmt();
        if (!n) return;
        var android = devicePlatform() === 'Android';
        var rows = [['App', esc(nameOfApp(n.app)) + ' <small>(' + esc(n.app) + ')</small>'], ['Tid', n.ms ? esc(f(n.ms)) + ' <small>(' + (android ? 'posted_time_ms' : 'Biome, fält 2') + ')</small>' : 'Saknas']];
        if (n.title) rows.push(['Titel', esc(n.title)]);
        if (n.text) rows.push(['Text', esc(n.text)]);
        if (n.channel) rows.push(['Kanal', esc(n.channel) + (n.channelId ? ' <small>(' + esc(n.channelId) + ')</small>' : '')]);
        if (n.conversation) rows.push(['Konversation', esc(n.conversation)]);
        if (n.events) rows.push(['Händelser', esc(n.events.map(function (e) { return f(e.ms).slice(11, 19) + ' typ ' + e.type; }).join(', ')) + ' <small>(vad typerna betyder är inte kontrollerat, utom 17 när notisen kom)</small>']);
        if (n.copies > 1) rows.push(['Kopior', esc(String(n.copies)) + ' poster med samma app, tid och titel']);
        if (n.key) rows.push(['Nyckel', esc(n.key)]);
        rows.push(['Källa', esc(n.file || '') + (n.offset !== undefined && n.offset !== null ? ' <small>(byte ' + esc(String(n.offset)) + ')</small>' : '')]);
        showSheet(esc(n.title || nameOfApp(n.app)), '<table>' + rows.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</table>', '', '');
    }

    // Uppgifterna om en bild, i ett ark i telefonen.
    function openPhoto(it) {
        var ph = state.device.photos, f = fmt(), q = ph.query;
        var thumb = ph.thumbs[it.key], file = ph.files[it.key];
        var col = it.timeField ? Roles().fieldSpec(q, it.timeField).col : '';
        var url = state.device.gallery ? state.device.gallery.urls.map.get(it.key) : null;
        var rows = [
            [it.timeField === 'added' ? 'Tillagd' : 'Skapad', it.ms !== null ? esc(f(it.ms)) + ' <small>(' + esc(col) + ')</small>' : 'Tiden saknas i databasen.'],
            ['I ' + esc(Z()), file ? esc(file.name) + ' <small>(' + esc(ChatCore.sizeText(file.size)) + ')</small>' : 'Filen finns inte i ' + esc(Z()) + '.'],
            ['I galleriet', thumb ? 'Telefonens tumnagel (5005.JPG)' : url ? ph.how[it.key] || 'Förminskad ur originalet' : it.drawable || it.heif ? 'Ingen bild' : 'Formatet kan inte visas här'],
        ];
        var marks = [it.favorite ? 'Favorit' : '', it.hidden ? 'Dold' : '', it.screenshot ? 'Skärmdump' : '', it.recording ? 'Skärminspelning' : ''].filter(Boolean);
        if (marks.length) rows.push(['Märkt', esc(marks.join(', '))]);
        if (it.trashed) rows.push(['Papperskorgen', 'Ja, bilden ligger i Nyligen raderade.']);
        if (it.albums && it.albums.length) {
            var names = it.albums.map(function (pk) { var a = ph.albums.filter(function (x) { return x.pk === pk; })[0]; return a ? a.title : null; }).filter(Boolean);
            if (names.length) rows.push(['Album', esc(names.join(', '))]);
        }
        if (it.folder && ph.platform === 'Android') rows.push(['Mapp', esc(it.folder)]);
        if (it.importer) rows.push(['App enligt databasen', esc(nameOfApp(it.importer)) + ' <small>(' + esc(it.importer) + ', ' + esc(Roles().fieldSpec(q, 'importer').col) + ')</small>']);
        var table = /\bFROM\s+(\w+)/i.exec(q.sql || '');
        rows.push(['Källa', esc(baseName(ph.db)) + (table ? ' · ' + esc(table[1]) : '')]);
        showSheet(esc(it.name), (url ? '<img src="' + esc(url) + '" alt="">' : '') + '<table>' + rows.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</table>',
            inHub ? (file ? '<button type="button" class="c-btn" data-sheet-exif="' + esc(it.key) + '">Visa i EXIF</button>' : '') +
                '<button type="button" class="c-btn c-primary" data-sheet-assess="1">Bedöm i Härkomst</button>' : '', it.name);
    }
    // Ett ark i telefonen: rubriken (HTML), innehållet och knapparna före Stäng.
    function showSheet(titleHtml, inner, actions, name) {
        var sheet = $('c-device-sheet');
        sheet.innerHTML = '<div class="c-sheet-box"><span class="c-sheet-grip" aria-hidden="true"></span><h2 id="c-sheet-title">' + titleHtml + '</h2>' + inner +
            '<div class="c-sheet-actions">' + (actions || '') + '<button type="button" class="c-btn" data-sheet-close="1">Stäng</button></div></div>';
        sheet.dataset.name = name || '';
        sheet.classList.remove('display-none');
        sheet.querySelector('[data-sheet-close]').focus();
    }
    function closeSheet() {
        var sheet = $('c-device-sheet');
        if (sheet.classList.contains('display-none')) return;
        sheet.classList.add('display-none');
        sheet.innerHTML = '';
    }
    // En mapp på hemskärmen, i ett ark.
    function openFolder(key) {
        var home = state.device.info && state.device.info.home;
        if (!home) return;
        var m = /^(p(\d+)|d):(\d+)$/.exec(key);
        if (!m) return;
        var it = m[1] === 'd' ? home.dock[Number(m[3])] : (home.pages[Number(m[2])][Number(m[3])] || {}).item;
        if (!it || it.kind !== 'folder') return;
        var apps = ChatPhone.homeApps(state.dbs), ph = state.device.photos;
        showSheet(esc(it.name), '<div class="d-grid d-folder-grid">' + it.items.map(function (x) { return homeAppHtml(x, apps, ph, (m[1] === 'd' ? 'dockan' : 'sida ' + (Number(m[2]) + 1)) + ', mappen ' + it.name); }).join('') + '</div>' +
            '<p class="d-note">' + esc('Mappen ur ' + home.source + '.') + '</p>', '', '');
    }
    // En app utan data i Telefonen: vad som är känt om den.
    function openAppSheet(id, where) {
        var info = state.device.info, home = info && info.home;
        var name = nameOfApp(id), fromInfo = info && info.names[id];
        var rows = [['Id', esc(id)], ['Plats', esc(where || '')], ['Namnet', fromInfo ? (devicePlatform() === 'iOS' ? 'Appens Info.plist' : 'Titeln i ' + esc(home ? home.source : 'launcherns databas')) : 'Verktygets lista över appar, eller id:t']];
        showSheet(esc(name), '<table>' + rows.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</table><p class="d-note">Appen ligger på hemskärmen. Telefonen läser inte dess data, så den öppnas inte här. App-ID och Queries kan visa mer om den.</p>', '', '');
    }

    $('c-device-open').addEventListener('click', function () { openDevice('home'); });
    $('c-device-back').addEventListener('click', function () { var b = backOf(state.device); openDevice(b.screen, b.app || (b.screen === 'app' ? state.device.app : ''), b.screen === 'albums' ? { filter: 'all' } : null); });
    $('c-phone-back').addEventListener('click', function () { if (state.current) openDevice('app', state.current.db.src.app); });
    $('c-list-back').addEventListener('click', function () { if (state.current) openDevice('app', state.current.db.src.app); });
    $('c-device-tabs').addEventListener('click', function (e) {
        var b = e.target.closest('[data-device-tab]');
        if (b) openDevice(b.dataset.deviceTab === 'albums' ? 'albums' : 'photos', '', { filter: 'all' });
    });
    // Alla koder med fyra siffror mot hashen för My Eyes Only, i flera trådar. Förloppet står på raden.
    function crackMeo(hash) {
        var P = state.device, M = P.meo || (P.meo = {});
        if (M[hash] && M[hash].state === 'busy') return;
        var codes = Bcrypt.fourDigits();
        var m = M[hash] = { state: 'busy', code: null, tried: 0, total: codes.length };
        var paint = function () { if (P.on && P.screen === 'appInfo') renderDevice(); };
        var last = 0;
        paint();
        Bcrypt.crack(hash, codes, { onProgress: function (n) { m.tried = n; if (Date.now() - last > 250) { last = Date.now(); paint(); } } })
            .then(function (code) { m.state = 'done'; m.code = code; paint(); })
            .catch(function (err) { m.state = 'done'; m.code = null; P.apps && P.apps.notes.push('Koden kunde inte prövas: ' + errText(err)); paint(); });
    }

    function onDeviceClick(e) {
        var b = e.target.closest('button');
        if (!b || b.classList.contains('g-tile')) return;
        // Det som öppnas ur sökningen går tillbaka dit.
        state.device.fromSearch = state.device.screen === 'search';
        state.device.fromControl = state.device.screen === 'control';
        if (b.dataset.meoCrack) { crackMeo(b.dataset.meoCrack); return; }
        if (b.dataset.deviceMemories) return openDevice('memories', 'Snapchat');
        if (b.dataset.memoryId) { state.device.memory = b.dataset.memoryId; return openDevice('memory', 'Snapchat'); }
        if (b.dataset.memoriesMap) { memoriesToMap().catch(showError); return; }
        if (b.dataset.memoryExif) {
            var mx = memoryOf(b.dataset.memoryExif);
            if (mx) memoryFile(mx).then(function (file) { toHub({ type: 'file-for', to: 'exif', from: 'Snapchat Memories', files: [{ file: file, path: state.zip.file.name + ' › ' + (state.device.memories.files[mx.media] || {}).name + ' (dekrypterad)' }] }); }).catch(showError);
            return;
        }
        if (b.dataset.memorySave) {
            var ms = memoryOf(b.dataset.memorySave);
            if (ms) memoryFile(ms).then(function (file) { var a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000); }).catch(showError);
            return;
        }
        if (b.dataset.deviceSearch) return openDevice('search');
        if (b.dataset.deviceControl) return openDevice('control');
        if (b.dataset.appInfo) { state.device.appInfo = b.dataset.appInfo; state.device.appInfoFrom = state.device.screen === 'settings' ? 'settings' : state.device.screen === 'search' ? 'search' : 'app'; return openDevice('appInfo', state.device.screen === 'app' ? state.device.app : ''); }
        if (b.dataset.msgMore && msgSearch) { msgSearch.limit = (msgSearch.limit || MSG_HITS) + MSG_HITS; msgSearch.paint(!!msgSearch.done); return; }
        if (b.dataset.msg !== undefined) {
            // En träff i meddelandena: chatten öppnas vid meddelandet, och samma ord står i sökfältet i chatten.
            var dm = state.dbs[Number(b.dataset.db)], words = String(state.device.appQuery || '').trim();
            if (dm) openThread(dm, b.dataset.thread, b.dataset.msg).then(function () { if (words && state.current) { $('c-find').value = words; runFind(); } }).catch(showError);
            return;
        }
        if (b.dataset.webHit !== undefined) { state.device.web = b.dataset.webHit; state.device.webTab = 'visits'; state.device.webItem = Number(b.dataset.webIndex); return openDevice('webItem'); }
        if (b.dataset.deviceApp) return openDevice('app', b.dataset.deviceApp);
        if (b.dataset.devicePhotos) return openDevice('photos', '', { filter: 'all' });
        if (b.dataset.deviceSettings) return openDevice('settings');
        if (b.dataset.deviceLock) return openDevice('lock');
        if (b.dataset.deviceNotes) return openDevice('notes');
        if (b.dataset.deviceCalls) return openDevice('calls');
        if (b.dataset.deviceContacts) return openDevice('contacts');
        if (b.dataset.deviceWeb) { if (state.device.web !== b.dataset.deviceWeb) state.device.webTab = ''; state.device.web = b.dataset.deviceWeb; return openDevice('web'); }
        if (b.dataset.webTab) { state.device.webTab = b.dataset.webTab; state.device.limit = LIST_STEP; renderDevice(); $('c-device-body').scrollTop = 0; return; }
        if (b.dataset.webId !== undefined) { state.device.webItem = Number(b.dataset.webId); return openDevice('webItem'); }
        if (b.dataset.callFilter) { state.device.callFilter = b.dataset.callFilter; state.device.limit = LIST_STEP; return renderDevice(); }
        if (b.dataset.callId !== undefined) { state.device.call = Number(b.dataset.callId); return openDevice('call'); }
        if (b.dataset.contactId !== undefined) { state.device.contact = b.dataset.contactId; state.device.contactFrom = state.device.screen === 'call' ? 'call' : 'contacts'; return openDevice('contact'); }
        if (b.dataset.noteFilter) { state.device.noteFilter = b.dataset.noteFilter; state.device.limit = LIST_STEP; return renderDevice(); }
        if (b.dataset.noteId !== undefined) { state.device.note = Number(b.dataset.noteId); return openDevice('note'); }
        if (b.dataset.notif !== undefined) return openNotification(Number(b.dataset.notif));
        if (b.dataset.homeApp !== undefined) return openAppSheet(b.dataset.homeApp, b.dataset.where);
        if (b.dataset.folder) return openFolder(b.dataset.folder);
        if (b.dataset.page !== undefined) { state.device.page = Number(b.dataset.page); return renderDevice(); }
        if (b.dataset.pageStep) { state.device.page = Math.max(0, state.device.page + Number(b.dataset.pageStep)); return renderDevice(); }
        if (b.dataset.filter) return openDevice('photos', '', { filter: b.dataset.filter });
        if (b.dataset.section) return openDevice('setting', '', { section: b.dataset.section });
        if (b.dataset.deviceMore) { state.device.limit += LIST_STEP; var box = $('c-device-body'), top = box.scrollTop; renderDevice(); box.scrollTop = top; return; }
        if (b.classList.contains('d-row')) {
            var d = state.dbs[Number(b.dataset.db)];
            if (d) openThread(d, b.dataset.thread).catch(showError);
        }
    }
    $('c-device-body').addEventListener('click', onDeviceClick);

    // Dra med musen som med ett finger: i sidled byter hemskärmen sida, på de andra skärmarna går ett drag åt höger
    // tillbaka, och i höjdled rullar listan eller galleriet. Ett drag är inget klick. Fingrar och pennor har webbläsarens
    // egen rullning, så bara musen hanteras här.
    var drag = null, SWIPE = 60;
    var deviceBody = $('c-device-body');
    if (window.ResizeObserver) new ResizeObserver(function () { if (state.device.on && state.device.screen === 'home') fitHome(deviceBody); }).observe(deviceBody);
    deviceBody.addEventListener('pointerdown', function (e) {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, top: deviceBody.scrollTop, axis: '', moved: false };
    });
    deviceBody.addEventListener('pointermove', function (e) {
        if (!drag || e.pointerId !== drag.id) return;
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.axis) {
            if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
            drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            drag.moved = true;
            try { deviceBody.setPointerCapture(e.pointerId); } catch (err) { /* en påhittad pekare i testerna */ }
            deviceBody.classList.add('dragging');
        }
        if (drag.axis === 'y') deviceBody.scrollTop = drag.top - dy;
        else {
            var screen = deviceBody.querySelector('.d-screen');
            if (state.device.screen === 'home' && screen) screen.style.transform = 'translateX(' + dx + 'px)';
        }
    });
    function endDrag(e) {
        if (!drag || e.pointerId !== drag.id) return;
        var d = drag, dx = e.clientX - d.x;
        drag = null;
        deviceBody.classList.remove('dragging');
        if (!d.moved) return;
        // Klicket som följer på ett drag släpps inte igenom.
        deviceBody.dataset.dragged = '1';
        setTimeout(function () { delete deviceBody.dataset.dragged; }, 0);
        // Ett drag nedåt från hemskärmens överkant visar notiserna, som i telefonen.
        // Från högra halvan (iPhone), eller överallt på Android, visas kontrollcentret med lägena.
        if (d.axis === 'y' && state.device.screen === 'home' && d.top === 0 && e.clientY - d.y > 90) {
            var rect = deviceBody.getBoundingClientRect(), right = d.x > rect.left + rect.width / 2;
            var hasNotifs = state.device.info && state.device.info.notifications;
            if (devicePlatform() === 'Android' || right || !hasNotifs) { if (controlTiles().some(function (t) { return t.row; })) openDevice('control'); else if (hasNotifs) openDevice('lock'); }
            else openDevice('lock');
            return;
        }
        if (d.axis !== 'x') return;
        var P = state.device, screen = deviceBody.querySelector('.d-screen');
        if (P.screen === 'home') {
            var pages = deviceBody.querySelectorAll('.d-dot').length;
            var next = Math.abs(dx) < SWIPE ? P.page : Math.min(Math.max(pages - 1, 0), Math.max(0, P.page + (dx < 0 ? 1 : -1)));
            if (next === P.page) { if (screen) { screen.classList.add('d-snap'); screen.style.transform = ''; } return; }
            P.page = next;
            renderDevice();
            var fresh = deviceBody.querySelector('.d-screen');
            if (fresh) fresh.classList.add(dx < 0 ? 'd-from-right' : 'd-from-left');
        } else if (dx > SWIPE * 1.5 && P.screen !== 'home') $('c-device-back').click();
    }
    deviceBody.addEventListener('pointerup', endDrag);
    deviceBody.addEventListener('pointercancel', endDrag);
    deviceBody.addEventListener('click', function (e) { if (deviceBody.dataset.dragged) { e.stopPropagation(); e.preventDefault(); } }, true);
    $('c-device-sheet').addEventListener('click', function (e) {
        if (e.target === this || e.target.closest('[data-sheet-close]')) return closeSheet();
        var ex = e.target.closest('[data-sheet-exif]');
        if (ex) {
            var f = state.device.photos && state.device.photos.files[ex.dataset.sheetExif];
            if (f) toExif(f, null, 'Telefonen').catch(showError);
            closeSheet();
            return;
        }
        if (e.target.closest('[data-sheet-assess]')) {
            toHub({ type: 'names-for', to: 'provenance', names: [this.dataset.name], zipName: state.zip ? state.zip.file.name : '' });
            closeSheet();
            return;
        }
        // En app i en mapp: arket stängs och appen öppnas.
        var b = e.target.closest('button.d-app');
        if (b) { closeSheet(); onDeviceClick({ target: b }); }
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !$('c-device-sheet').classList.contains('display-none')) { e.preventDefault(); closeSheet(); return; }
        // Escape går tillbaka ett steg i telefonen, som knappen (i ett sökfält tömmer den först fältet).
        if (e.key === 'Escape' && deviceShown() && state.device.screen !== 'home' && !/^(INPUT|SELECT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '')) {
            e.preventDefault();
            $('c-device-back').click();
            return;
        }
        // Att skriva på hemskärmen öppnar sökningen, som att dra nedåt på en iPhone.
        if (deviceShown() && state.device.screen === 'home' && e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey &&
            !/^(INPUT|SELECT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '') && $('c-device-sheet').classList.contains('display-none')) {
            e.preventDefault();
            state.device.query = e.key;
            openDevice('search');
            return;
        }
        // Pilarna bläddrar mellan hemskärmens sidor.
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && deviceShown() && state.device.screen === 'home' && !/^(INPUT|SELECT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '')) {
            var step = e.key === 'ArrowLeft' ? -1 : 1;
            var dots = $('c-device-body').querySelectorAll('.d-dot').length;
            if (!dots) return;
            var next = Math.min(dots - 1, Math.max(0, state.device.page + step));
            if (next !== state.device.page) { e.preventDefault(); state.device.page = next; renderDevice(); }
        }
    });
    // Telefonens bredd ändras med fönstret: galleriet räknar om sina rader.
    window.addEventListener('resize', function () { if (state.device.gallery) state.device.gallery.paint(true); });

    // Telefonen som eget verktyg (?view=phone): bara telefonen, utan Chattars lista.
    if (PHONE_TOOL) {
        document.body.classList.add('phone-tool');
        openDevice('home');
    }

    findCount();
    renderList();

    // För testerna och mätningarna.
    window.ChatsApp = {
        busy: function () { return !!state.job || !!state.exporting || !!(state.opening && !state.opening.done); },
        ready: function () { return state.ready; },
        state: function () { return state; },
        list: function () { return state.shown; },
        look: function () { return state.look; },
        view: function () { return state.current && state.view ? { from: state.view.from, to: state.view.to, n: state.current.model.messages.length, drawn: $('c-msgs').querySelectorAll('.m').length } : null; },
        device: function () {
            var P = state.device, ph = P.photos, g = P.gallery;
            return { on: P.on, shown: deviceShown(), screen: P.screen, app: P.app, info: P.info ? { state: P.info.state, notes: P.info.memos ? P.info.memos.notes.length : null } : null,
                web: state.web ? { state: state.web.state, errors: state.web.errors, browsers: state.web.browsers.map(function (b) { return { id: b.id, name: b.name, visits: b.visits ? b.visits.length : null, searches: b.searches ? b.searches.length : null, downloads: b.downloads ? b.downloads.length : null, tabs: b.tabs ? b.tabs.length : null, cleared: b.cleared ? b.cleared.length : null }; }) } : null,
                comms: state.comms ? { state: state.comms.state, calls: state.comms.calls ? state.comms.calls.length : null, contacts: state.comms.contacts ? state.comms.contacts.list.length : null, errors: state.comms.errors } : null, photos: ph ? { state: ph.state, items: ph.items.length, thumbs: Object.keys(ph.thumbs).length, files: Object.keys(ph.files).length, note: ph.note } : null,
                gallery: g ? { tiles: $('c-device-body').querySelectorAll('.g-tile').length, shown: $('c-device-body').querySelectorAll('.g-tile.has').length, loads: g.stats.loads, failed: g.stats.failed, urls: g.urls.map.size } : null };
        },
    };
})();
