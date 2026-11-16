// Laborationens underlag ur en extraktion: det som lab-trace.js jämför loggens steg med. Extraktionen läses
// bara, ingenting skrivs och allt hålls i minnet. Databaserna hittas och läses som i Chattar och Härkomst
// (katalogernas roller), och stängs när de är lästa.
//   chattar:   meddelandena i de chattar som har meddelanden från laborationens dygn. Texten sparas inte, bara
//              koderna som står i den, tiderna och vad som behövs för att öppna raden i Queries.
//   bilder:    bildbibliotekets filer som är tagna eller tillagda under laborationen, med QR-koden i bilden när
//              den går att läsa och en liten bild att välja efter.
//   händelser: lås, upplåsning, av och på, och vilken app som var framme (knowledgeC på iOS, usagestats på Android).
// De delar som inte behöver någon fil (messagesOf, mediaOf, locksOf, appsOf, usageOf) testas i Node.
(function (root) {
    'use strict';

    // Globala i webbläsaren. I Node skickas de in med use().
    var deps = {};
    function dep(name) {
        if (deps[name]) return deps[name];
        if (typeof root[name] !== 'undefined') return root[name];
        throw new Error(name + ' saknas');
    }
    function has(name) { return !!deps[name] || typeof root[name] !== 'undefined'; }
    var node = typeof module !== 'undefined' && module.exports;
    var Lab = node ? require('./lab-core.js') : root.LabCore;
    var Trace = node ? require('./lab-trace.js') : root.LabTrace;

    var DAY = 86400000;

    // Tiden laborationen pågick enligt loggen, med ett dygn åt vardera hållet: telefonens klocka kan gå fel, och
    // loggen kan ha startats efter de första stegen.
    function period(run) {
        var ts = [run.started].concat(run.entries.map(function (e) { return e.t; })).filter(function (t) { return typeof t === 'number'; });
        return { startMs: Math.min.apply(null, ts) - DAY, endMs: Math.max.apply(null, ts) + DAY };
    }
    function within(ms, p) { return typeof ms === 'number' && ms >= p.startMs && ms <= p.endMs; }

    // ---------- Chattar ----------

    // Meddelandets sort för sökningen: samtal och röstmeddelanden söks på sorten, och ett röstmeddelande kan stå
    // som en ljudbilaga.
    function kindOf(m) {
        if (m.kind === 'call' || m.kind === 'voice' || m.kind === 'audio') return m.kind;
        var a = (m.attachments || []).filter(function (x) { return x.kind === 'voice' || x.kind === 'audio'; })[0];
        return a ? a.kind : m.kind;
    }

    // En konversation ur ChatCore.conversation som underlag. o: { prefix, width, period }. ref: det som öppnar
    // chattens rader i Queries. Koden söks i texten, i bildtexten och i filens namn.
    function messagesOf(src, conv, base, o, ref) {
        var out = [];
        conv.messages.forEach(function (m) {
            var texts = [m.text].concat((m.attachments || []).map(function (a) { return [a.title, a.name].filter(Boolean).join('\n'); }));
            var codes = Trace.codesIn(texts.filter(Boolean).join('\n'), o.prefix, o.width);
            var times = m.times.filter(function (t) { return typeof t.ms === 'number'; });
            if (!codes.length && !times.some(function (t) { return within(t.ms, o.period); })) return;
            out.push({
                key: src.key + '|' + conv.thread.key + '|' + m.key, app: src.app, base: base, fromMe: !!m.fromMe, kind: kindOf(m), deleted: !!m.deleted, codes: codes, sortMs: m.sortMs,
                times: times.map(function (t) { return { key: t.key, label: t.label, col: t.col || '', ms: t.ms }; }), ref: ref ? { query: ref, id: m.id } : null,
            });
        });
        return out;
    }

    // ---------- Bildbiblioteket ----------

    var VIDEO = /\.(mov|mp4|m4v|3gp|mkv|webm|avi)$/i;
    // Format som programmets webbläsare kan visa. Annat (HEIC) läses ur telefonens egen JPEG-kopia när den finns.
    var SHOWN = /\.(jpe?g|png|webp|gif|bmp)$/i;

    // Raderna ur rollen neighbours (ProvenanceRoles.mapRows med created och added) som underlag: filerna som
    // skapades eller lades till under laborationen. cols: kolumnernas namn för created och added.
    function mediaOf(rows, platform, base, o, cols) {
        var out = [];
        (rows || []).forEach(function (r) {
            var name = String(r.filename || ''), dir = String(platform === 'iOS' ? r.directory || '' : r.relativePath || '').replace(/^\/+|\/+$/g, '');
            if (!name) return;
            var made = within(r.createdMs, o.period), added = within(r.addedMs, o.period);
            if (!made && !added) return;
            var shot = platform === 'iOS'
                ? Number(r.kindSubtype) === 10 || (r.kindSubtype === undefined && /\.png$/i.test(name))
                : /screenshot|skärm/i.test(dir + '/' + name);
            var item = {
                key: 'media|' + r.pk, base: base, name: name, path: (dir ? dir + '/' : '') + name, kind: VIDEO.test(name) ? 'video' : shot ? 'screenshot' : 'photo',
                ms: made ? r.createdMs : r.addedMs, col: (made ? cols.created : cols.added) || '', qr: null, thumb: '',
            };
            // Bildens egen tid ligger utanför laborationen (t.ex. ändrad i Bilder efteråt): tiden den lades till gäller.
            if (!made) item.what = 'filen tillagd i biblioteket';
            out.push(item);
        });
        return out.sort(function (a, b) { return a.ms - b.ms; });
    }

    // ---------- Lås och appar ----------

    // iOS: raderna ur /device/isLocked (start, slut, 1 = låst). Varje rad är en tid i ett läge, så dess början och
    // slut är ett byte av läge. Samma byte står i två rader (den enas slut är den andras början) och tas en gång.
    function locksOf(rows, base) {
        var events = [], locks = [], seen = {};
        var add = function (kind, ms, col) {
            if (typeof ms !== 'number') return;
            var k = kind + '|' + Math.round(ms / 1000);
            if (seen[k]) return;
            seen[k] = true;
            events.push({ key: k, base: base, kind: kind, ms: ms, col: col });
        };
        (rows || []).forEach(function (r) {
            var locked = Number(r.value) === 1;
            if (typeof r.startMs !== 'number') return;
            if (locked) locks.push({ key: 'locked|' + r.startMs, base: base, startMs: r.startMs, endMs: typeof r.endMs === 'number' ? r.endMs : null, col: '/device/isLocked' });
            add(locked ? 'lock' : 'unlock', r.startMs, '/device/isLocked · ZSTARTDATE');
            add(locked ? 'unlock' : 'lock', r.endMs, '/device/isLocked · ZENDDATE');
        });
        events.sort(function (a, b) { return a.ms - b.ms; });
        return { events: events, locks: locks };
    }

    // iOS: raderna ur /app/usage (start, slut, buntens id).
    function appsOf(rows, base, col) {
        return (rows || []).filter(function (r) { return typeof r.startMs === 'number' && r.value; }).map(function (r) {
            return { key: 'app|' + r.startMs + '|' + r.value, base: base, app: String(r.value), startMs: r.startMs, endMs: typeof r.endMs === 'number' ? r.endMs : null, col: col };
        });
    }

    // Android: usagestats. decoded: dagsfilerna ur ProvenanceAndroidLogs.usageDaily. iv: intervallen ur
    // ProvenanceCore.intervalsFromEvents (apparna slås ihop när samma app kommer tillbaka inom två sekunder, som
    // i Härkomst: ett byte av skärm i appen är inte ett nytt besök).
    var SAME_MS = 5000;
    var USAGE = { 17: ['lock', 'KEYGUARD_SHOWN'], 18: ['unlock', 'KEYGUARD_HIDDEN'], 26: ['off', 'DEVICE_SHUTDOWN'], 27: ['on', 'DEVICE_STARTUP'], 28: ['unlock', 'USER_UNLOCKED'] };
    function usageOf(decoded, iv, o) {
        var base = 'usagestats', events = [];
        (decoded || []).forEach(function (d) {
            d.events.forEach(function (e) {
                var u = USAGE[e.type];
                if (u && within(e.ms, o.period)) events.push({ key: u[1] + '|' + e.ms, base: base, kind: u[0], ms: e.ms, col: 'händelse ' + e.type + ' (' + u[1] + ')', type: e.type });
            });
        });
        events.sort(function (a, b) { return a.ms - b.ms; });
        // Efter en start låses telefonen upp två gånger i loggen, USER_UNLOCKED och strax efter KEYGUARD_HIDDEN:
        // det är samma upplåsning, och den första tiden gäller.
        // En avstängning eller start kan också stå på två rader efter varandra.
        events = events.filter(function (e, i) {
            if (e.type === 18) return !events.some(function (x) { return x.type === 28 && Math.abs(x.ms - e.ms) <= SAME_MS; });
            return !((e.type === 26 || e.type === 27) && events.some(function (x, j) { return j < i && x.type === e.type && e.ms - x.ms <= SAME_MS; }));
        });
        // usagestats ligger i den del av telefonen som öppnas först när den låses upp, så raden om starten skrivs vid
        // första upplåsningen och inte när telefonen slogs på (på labbtelefonen 72 ms efter USER_UNLOCKED).
        events.forEach(function (e) { if (e.type === 27) { e.late = true; e.what = 'startad; raden skrivs vid första upplåsningen efter starten'; } });
        var span = function (x, key) { return { key: key + '|' + x.startMs + (x.app ? '|' + x.app : ''), base: base, startMs: x.startMs, endMs: x.openEnded ? null : x.endMs }; };
        var over = function (x) { return x.startMs <= o.period.endMs && (x.endMs == null || x.endMs >= o.period.startMs); };
        return {
            events: events,
            locks: (iv.lock || []).filter(function (x) { return x.locked && over(x); }).map(function (x) { return Object.assign(span(x, 'locked'), { col: 'händelse 17–18 (låsskärmen)' }); }),
            apps: (iv.apps || []).filter(over).map(function (x) { return Object.assign(span(x, 'app'), { app: x.app, col: 'händelse 1, 2 och 23 (appen framme)' }); }),
        };
    }

    // ---------- Bilden: QR-koden och den lilla bilden ----------

    // I programmets webbläsare. Bilden avkodas, QR-koden söks först i en förminskad bild (går fort och räcker
    // oftast) och sedan i hela, och en liten bild sparas att välja efter. Ger { text, thumb } eller null.
    var QUICK_SIDE = 1600, THUMB_SIDE = 160;
    async function browserPicture(bytes) {
        if (typeof root.createImageBitmap !== 'function' || typeof document === 'undefined') return null;
        var bmp;
        try { bmp = await root.createImageBitmap(new Blob([bytes])); } catch (e) { return null; }
        var draw = function (side) {
            var k = Math.min(1, side / Math.max(bmp.width, bmp.height));
            var c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(bmp.width * k));
            c.height = Math.max(1, Math.round(bmp.height * k));
            c.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0, c.width, c.height);
            return c;
        };
        var scan = function (c) {
            if (typeof root.jsQR !== 'function') return null;
            var d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
            var hit = root.jsQR(d.data, c.width, c.height, { inversionAttempts: 'dontInvert' });
            return hit && hit.data ? hit.data : null;
        };
        try {
            var text = scan(draw(QUICK_SIDE));
            if (!text && Math.max(bmp.width, bmp.height) > QUICK_SIDE) text = scan(draw(Infinity));
            return { text: text, thumb: draw(THUMB_SIDE).toDataURL('image/jpeg', 0.7) };
        } finally {
            if (bmp.close) bmp.close();
        }
    }

    // Filerna till bibliotekets rader i extraktionen: bilden själv och, på iOS, telefonens JPEG-kopia av den
    // (PhotoData/Thumbnails/V2/<mapp>/<fil>/5005.JPG), som finns för HEIC och video.
    async function pictures(media, platform, read, size, o, stage) {
        if (!media.length) return { tried: 0, coded: 0 };
        var Core = dep('ExtractionCore'), byPath = {}, byBase = {};
        media.forEach(function (m) {
            var p = m.path.toLowerCase();
            byPath[p] = m;
            byBase[p.slice(p.lastIndexOf('/') + 1)] = true;
        });
        // Sökvägen i extraktionen slutar med bibliotekets sökväg: den längsta svansen som stämmer.
        var pathsEnding = function (l) {
            for (var at = l.indexOf('/'); at >= 0; at = l.indexOf('/', at + 1)) if (byPath[l.slice(at + 1)]) return byPath[l.slice(at + 1)];
            return byPath[l] || null;
        };
        var own = new Map(), copy = new Map();
        var entries = await Core.find(read, size, function (name) {
            var l = name.toLowerCase();
            if (l.charAt(l.length - 1) === '/') return false;
            if (platform === 'iOS' && l.slice(-9) === '/5005.jpg' && l.indexOf('/thumbnails/v2/') >= 0) return byBase[l.slice(l.lastIndexOf('/', l.length - 10) + 1, -9)] === true;
            return byBase[l.slice(l.lastIndexOf('/') + 1)] === true;
        });
        entries.forEach(function (e) {
            var l = e.name.toLowerCase(), isCopy = platform === 'iOS' && l.slice(-9) === '/5005.jpg' && l.indexOf('/thumbnails/v2/') >= 0;
            var m = pathsEnding(isCopy ? l.slice(0, -9) : l);
            if (!m) return;
            var into = isCopy ? copy : own;
            if (!into.has(m)) into.set(m, e);
        });
        var look = o.picture || browserPicture, tried = 0, coded = 0;
        for (var i = 0; i < media.length; i++) {
            var m = media[i], entry = (m.kind !== 'video' && SHOWN.test(m.name) && own.get(m)) || copy.get(m) || null;
            if (own.get(m)) m.entry = own.get(m).name;
            if (!entry) continue;
            stage('Läser bild ' + (i + 1) + ' av ' + media.length + ' och söker QR-koden…', (i + 1) / media.length);
            var got = null;
            try { got = await look((await Core.readEntry(read, entry)).bytes, entry.name); } catch (e) { got = null; }
            if (!got) continue;
            tried++;
            m.thumb = got.thumb || '';
            m.qr = got.text ? Lab.readShot(got.text) : null;
            if (m.qr) coded++;
        }
        return { tried: tried, coded: coded };
    }

    // ---------- Läsningen ----------

    function chatCatalogs() {
        return ['WHATSAPP_IOS_CATALOG', 'WHATSAPP_ANDROID_CATALOG', 'SIGNAL_IOS_CATALOG', 'SIGNAL_ANDROID_CATALOG', 'TELEGRAM_IOS_CATALOG', 'TELEGRAM_ANDROID_CATALOG', 'SNAPCHAT_CATALOG', 'SNAPCHAT_ANDROID_CATALOG']
            .map(function (n) { return root[n]; }).filter(Boolean);
    }

    function count(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
    function errText(err) { return err && err.message ? err.message : String(err); }
    function pause() { return new Promise(function (resolve) { setTimeout(resolve, 0); }); }

    // Läser en enhets extraktion. file: filen (File). o: { prefix, width, period, onStage(text, andel), SQL,
    // catalogs: { chats: [], photos, appUsage, android }, picture(bytes, namn) }.
    // Ger { evidence, platform, line, read: [vad som lästes], missing: [vad som inte lästes och varför] }.
    async function read(file, o) {
        var Core = dep('ExtractionCore'), Zip = dep('ZipRead'), Chat = dep('ChatCore'), Roles = dep('ProvenanceRoles');
        var stage = o.onStage || function () {};
        var cats = o.catalogs || { chats: chatCatalogs(), photos: root.PHOTOS_SQLITE_CATALOG, appUsage: root.APP_USAGE_CATALOG, android: root.ANDROID_QUERIES_CATALOG };
        var ev = { messages: [], threads: [], media: [], events: [], locks: [], apps: [] };
        var out = { evidence: ev, platform: null, line: '', read: [], missing: [] };
        var fill = Roles.fill;

        stage('Öppnar extraktionen…');
        var source = await Core.openSource(file, { onReport: function (done, total) { stage('Läser rapporten…', total ? done / total : null); } });
        var report = source.report;
        var rd = report ? source.read : (await Zip.cacheDirectory(source.read, file.size, null, function (done, total) { stage('Läser innehållsförteckningen…', total ? done / total : null); })).read;
        out.line = (report ? 'Rapport (UFDR): ' : 'Extraktion: ') + file.name + ' (' + file.size + ' byte' + (file.lastModified ? ', ändrad ' + new Date(file.lastModified).toISOString() : '') + ')';

        var chats = Chat.sources(cats.chats || []).filter(function (s) { return !s.namesOnly; });
        var system = Roles.collect({ photos: cats.photos, appUsage: cats.appUsage, android: cats.android }).filter(function (s) { return s.key === 'photos' || s.key === 'knowledgec' || s.key === 'android-mediastore'; });
        var targets = Core.targets(Chat.databases(chats).concat(Roles.databases(system)));
        stage('Söker databaserna…');
        var opened = await Core.open(rd, file.size, targets, function (done, total) { stage('Söker databaserna…', total ? done / total : null); });
        var hitFor = function (key) { return opened.found.filter(function (f) { return f.key === key; }).sort(function (a, b) { return (b.primary ? 1 : 0) - (a.primary ? 1 : 0); })[0] || null; };
        var chatHits = chats.filter(function (s) { return hitFor(s.key); });
        out.platform = hitFor('photos') || hitFor('knowledgec') ? 'iOS' : hitFor('android-mediastore') || chatHits.some(function (s) { return s.platform === 'Android'; }) ? 'Android'
            : chatHits.some(function (s) { return s.platform === 'iOS'; }) ? 'iOS' : null;

        var SQL = o.SQL;
        async function loadDb(hit, label, cipher) {
            var opts = { cipher: cipher || null, onStage: function (s, frac, by, inner) { stage(label + ': ' + Core.stageText(s, frac, by, '', inner), typeof frac === 'number' ? frac : null); } };
            if (has('DbShare')) opts.share = { file: file };
            var loaded = await Core.loadDatabase(rd, hit, [out.line], opts), db;
            stage(label + ': öppnar databasen…');
            await Zip.painted();
            try { db = new SQL.Database(Core.noCopy(loaded.bytes)); } catch (err) { throw Zip.friendlyMemory(err, label, loaded.bytes.length); }
            loaded.bytes = null;
            return { db: db, path: loaded.gz ? null : loaded.dbEntry.name, walPath: loaded.walEntry ? loaded.walEntry.name : null, base: Core.baseName(hit.db.name) };
        }
        var query = function (L, q, values) {
            var res = L.db.exec(fill(q.sql, values || {}));
            return res.length ? res[res.length - 1] : { columns: [], values: [] };
        };
        // Det som öppnar källan i Queries: samma query med samma värden.
        // keys: fälten med tider, så att Queries kan märka ut raden på tiden.
        var refOf = function (L, q, values, label, keys) {
            var cols = (keys || []).map(function (k) { return Roles.fieldSpec(q, k); }).filter(Boolean);
            return { path: L.path, walPath: L.walPath, queryId: q.id, title: q.title, db: label, sql: fill(q.sql, values || {}), timeColumns: cols.length ? cols : null };
        };

        // ----- Chattarna -----
        var secrets = [], keySearch = null;
        if (chatHits.some(function (s) { return s.cipher; })) {
            stage('Söker nycklar till krypterade databaser…');
            try { keySearch = await Core.findKeys(rd, file.size, { report: report, file: file, beside: o.beside }); secrets = keySearch.secrets; } catch (e) { keySearch = null; }
        }
        for (var c = 0; c < chatHits.length; c++) {
            var src = chatHits[c], hit = hitFor(src.key), name = src.title, L = null;
            try {
                var cipher = null;
                if (src.cipher) {
                    var keys = dep('AppSecrets').keysForProfile(secrets, src.cipher);
                    if (!keys || !keys.dbKey) { out.missing.push(name + ' (krypterad, och nyckeln hittades inte i eller bredvid extraktionen)'); continue; }
                    cipher = { profile: src.cipher, passphrase: keys.dbKey, modernKey: keys.modernKey, source: keys.source };
                }
                L = await loadDb(hit, name, cipher);
                if (src.derive && has('TelegramPostbox')) dep('TelegramPostbox').attach(L.db);
                L.db.run('PRAGMA query_only = ON');
                var threads = Chat.threads(src, query(L, src.roles.threads));
                // Bara chattar som har meddelanden från laborationens dygn kan bära stegens spår. En chatt utan
                // tider läses också, liksom en vars namn har en kod.
                var named = function (t) { return Trace.codesIn(t.name, o.prefix, o.width); };
                var wanted = threads.filter(function (t) {
                    return named(t).length || t.firstMs == null || t.lastMs == null || (t.firstMs <= o.period.endMs && t.lastMs >= o.period.startMs);
                });
                var members = src.roles.members ? Chat.members(src, query(L, src.roles.members)) : {};
                var kept = 0;
                for (var t = 0; t < wanted.length; t++) {
                    var thread = wanted[t], values = { threadId: thread.id };
                    stage(name + ': läser chatt ' + (t + 1) + ' av ' + wanted.length + '…', (t + 1) / wanted.length);
                    var sql = fill(src.roles.messages.sql, values);
                    var msgRes = await Chat.readRows(L.db, sql, { onSlice: pause });
                    var attRes = src.roles.attachments ? query(L, src.roles.attachments, values) : null;
                    var conv = Chat.conversation(src, thread, msgRes, attRes, members[thread.key] || [], hit.db.name, {});
                    var sortSpec = conv.timeSpecs.filter(function (x) { return x.key === conv.sortKey; })[0];
                    var ref = refOf(L, src.roles.messages, values, src.label);
                    // Alla meddelandets tider: spåret kan vara tiden då det lästes, inte den som chatten är ordnad på.
                    var timeCols = conv.timeSpecs.filter(function (x) { return x.col; }).map(function (x) { return { col: x.col, epoch: x.epoch }; });
                    ref.timeColumns = timeCols.length ? timeCols : null;
                    var list = messagesOf(src, conv, L.base, o, ref);
                    kept += list.length;
                    Array.prototype.push.apply(ev.messages, list);
                    var codes = named(thread), first = conv.firstMs == null ? thread.firstMs : conv.firstMs;
                    // En grupp som börjar under laborationen tas med också utan kod i namnet.
                    if (codes.length || (thread.kind === 'group' && first >= o.period.startMs && first <= o.period.endMs)) {
                        ev.threads.push({ key: src.key + '|' + thread.key, app: src.app, base: L.base, codes: codes, firstMs: first, col: sortSpec ? sortSpec.col || '' : '', ref: { query: ref, id: null } });
                    }
                    if ((t & 7) === 7) await pause();
                }
                out.read.push(name + ' (' + count(wanted.length, 'chatt', 'chattar') + ' av ' + threads.length + ', ' + count(kept, 'meddelande', 'meddelanden') + ')');
            } catch (err) {
                out.missing.push(name + ' (' + errText(err) + ')');
            } finally {
                if (L) try { L.db.close(); } catch (e) { /* redan stängd */ }
            }
        }

        // ----- Bildbiblioteket -----
        var libKey = out.platform === 'iOS' ? 'photos' : 'android-mediastore', libHit = hitFor(libKey), libSrc = system.filter(function (s) { return s.key === libKey; })[0];
        if (libHit && libSrc) {
            var P = null;
            try {
                P = await loadDb(libHit, libSrc.title);
                P.db.run('PRAGMA query_only = ON');
                var roles;
                if (libSrc.bands) {
                    var pick = Core.dbForVersion(targets.filter(function (x) { return x.key === libKey; })[0], opened.version);
                    roles = Roles.rolesFor(libSrc, { dbId: pick.db.id, version: opened.version });
                    if (pick.guessed) {
                        var tb = P.db.exec("SELECT name FROM sqlite_master WHERE type = 'table'"), cl = P.db.exec('PRAGMA table_info(ZADDITIONALASSETATTRIBUTES)');
                        var band = Roles.photosBandFromSchema(tb.length ? tb[0].values.map(function (r) { return r[0]; }) : [], cl.length ? cl[0].values.map(function (r) { return r[1]; }) : []);
                        if (band) roles = Roles.rolesFor(libSrc, { dbId: band.id });
                    }
                } else roles = Roles.rolesFor(libSrc, {});
                var nq = roles.neighbours;
                stage(libSrc.title + ': läser filerna…');
                await Zip.painted();
                // Hela biblioteket frågas och urvalet görs här: en bild vars tid har ändrats efteråt ligger utanför
                // laborationen på sin egen tid men inte på tiden den lades till.
                var all = { window: { startMs: 0, endMs: 4102444800000 } };
                var rows = Roles.mapRows(nq, query(P, nq, all), ['created', 'added'], { raw: false });
                var spec = function (k) { var s = Roles.fieldSpec(nq, k); return s ? s.col : ''; };
                ev.media = mediaOf(rows, out.platform, P.base, o, { created: spec('created'), added: spec('added') });
                ev.media.forEach(function (m) {
                    m.ref = { query: refOf(P, nq, { window: { startMs: m.ms - 60000, endMs: m.ms + 60000 } }, libSrc.title, ['created', 'added']), id: m.name };
                    // Frågan söker på bildens egen tid. Ligger den utanför laborationen går raden inte att visa så.
                    if (m.what) m.ref = null;
                });
                var pics = await pictures(ev.media, out.platform, rd, file.size, o, stage);
                out.read.push('bildbiblioteket (' + count(ev.media.length, 'fil', 'filer') + ' från laborationen' + (pics.coded ? ', QR-koden läst i ' + pics.coded : '') + ')');
            } catch (err) {
                out.missing.push('bildbiblioteket (' + errText(err) + ')');
            } finally {
                if (P) try { P.db.close(); } catch (e) { /* redan stängd */ }
            }
        } else if (out.platform) out.missing.push('bildbiblioteket (databasen finns inte i extraktionen)');

        // ----- Lås och appar -----
        if (out.platform === 'iOS') {
            var kHit = hitFor('knowledgec'), kSrc = system.filter(function (s) { return s.key === 'knowledgec'; })[0], K = null;
            if (kHit && kSrc) {
                try {
                    K = await loadDb(kHit, kSrc.title);
                    K.db.run('PRAGMA query_only = ON');
                    var win = { window: o.period }, lockQ = kSrc.roles.lock, appQ = kSrc.roles['app-usage'];
                    stage(kSrc.title + ': läser lås och appar…');
                    await Zip.painted();
                    var lk = locksOf(Roles.mapRows(lockQ, query(K, lockQ, win), ['start', 'end'], { raw: false }), K.base);
                    var near = function (x) { return { window: { startMs: (x.startMs == null ? x.ms : x.startMs) - 60000, endMs: (x.endMs == null ? (x.startMs == null ? x.ms : x.startMs) : x.endMs) + 60000 } }; };
                    lk.events.forEach(function (x) { x.ref = { query: refOf(K, lockQ, near(x), kSrc.title, ['start', 'end']), id: null }; });
                    lk.locks.forEach(function (x) { x.ref = { query: refOf(K, lockQ, near(x), kSrc.title, ['start', 'end']), id: null }; });
                    ev.events = lk.events;
                    ev.locks = lk.locks;
                    ev.apps = appsOf(Roles.mapRows(appQ, query(K, appQ, win), ['start', 'end'], { raw: false }), K.base, '/app/usage');
                    ev.apps.forEach(function (x) { x.ref = { query: refOf(K, appQ, near(x), kSrc.title, ['start', 'end']), id: x.app }; });
                    out.read.push(kSrc.title + ' (lås och app framme; av och på söks inte på iOS)');
                } catch (err) {
                    out.missing.push(kSrc.title + ' (' + errText(err) + ')');
                } finally {
                    if (K) try { K.db.close(); } catch (e) { /* redan stängd */ }
                }
            } else out.missing.push('knowledgeC.db (finns inte i extraktionen, så lås och app framme saknas)');
        } else if (out.platform === 'Android' && has('ProvenanceAndroidLogs') && has('ProvenanceCore')) {
            var A = dep('ProvenanceAndroidLogs');
            try {
                stage('Söker usagestats…');
                var logs = A.sortEntries(await Core.find(rd, file.size, A.keeper()));
                var vi = { version: null };
                if (logs.version && logs.version.size < 4096) vi = A.usageVersion((await Core.readEntry(rd, logs.version)).bytes);
                var dailies = A.pickDaily(logs.daily, o.period);
                var canDecode = vi.version === 4 || (!!logs.mappings && (vi.version == null || vi.version === 5));
                if (!dailies.length) out.missing.push('usagestats (inga dagsfiler från laborationen, så lås, av, på och app framme saknas)');
                else if (!canDecode) out.missing.push('usagestats (version ' + (vi.version == null ? 'okänd' : vi.version) + ' går inte att avkoda)');
                else {
                    var map = logs.mappings ? A.usageMappings((await Core.readEntry(rd, logs.mappings)).bytes) : null, decoded = [];
                    for (var d = 0; d < dailies.length; d++) {
                        stage('usagestats: läser dagsfil ' + (d + 1) + ' av ' + dailies.length + '…', (d + 1) / dailies.length);
                        decoded.push(A.usageDaily((await Core.readEntry(rd, dailies[d])).bytes, A.dailyBeginMs(dailies[d].name), map, vi.version || 5));
                        await pause();
                    }
                    var lastEnd = Math.max.apply(null, decoded.map(function (x) { return x.endMs || 0; }));
                    var PC = dep('ProvenanceCore'), iv = PC.intervalsFromEvents(A.usageToEvents(decoded), lastEnd || o.period.endMs, null);
                    iv.apps = PC.mergeIntervals(iv.apps);
                    var us = usageOf(decoded, iv, o);
                    ev.events = us.events;
                    ev.locks = us.locks;
                    ev.apps = us.apps;
                    out.read.push('usagestats (' + count(dailies.length, 'dagsfil', 'dagsfiler') + ': lås, av, på och app framme)');
                }
            } catch (err) {
                out.missing.push('usagestats (' + errText(err) + ')');
            }
        }
        if (!out.platform) out.missing.push('ingen av databaserna som programmet känner till finns i filen');
        stage('');
        return out;
    }

    var api = {
        use: function (d) { Object.keys(d || {}).forEach(function (k) { deps[k] = d[k]; }); },
        period: period, messagesOf: messagesOf, mediaOf: mediaOf, locksOf: locksOf, appsOf: appsOf, usageOf: usageOf, read: read,
    };
    if (node) module.exports = api;
    else root.LabRead = api;
})(typeof window !== 'undefined' ? window : this);
