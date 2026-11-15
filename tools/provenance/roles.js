// Härkomst hämtar sin SQL ur query-katalogerna via fältet role på dolda queries. Här
// samlas rollerna per databas och iOS-band, och platshållarna i SQL:en fylls i med tal och
// filnamn. Ingen egen SQL finns i verktyget. Testas i Node.
(function (root) {
    'use strict';

    var COCOA_EPOCH = 978307200;

    // Chattrollerna (chat-…) hör till Chattar och tas inte med här.
    function roleMap(list, meta) {
        var out = {};
        (list || []).forEach(function (q) {
            if (!q.hidden || !q.role || /^chat-/.test(q.role)) return;
            out[q.role] = Object.assign({}, meta || {}, q);
        });
        return out;
    }

    // catalogs: { photos, android, appUsage, routined, snapchat, snapchatAndroid, signalAndroid, signalIos, whatsappIos, telegramIos,
    // whatsappAndroid, telegramAndroid } som i Queries. Returnerar källorna i
    // den form ExtractionCore.targets() vill ha, med rollerna per källa (och per band för Photos).
    function collect(catalogs) {
        var photos = catalogs.photos || {};
        var appUsage = catalogs.appUsage || {};
        var routined = catalogs.routined || {};
        var android = catalogs.android || {};
        var sources = [];

        var hiddenQuestions = {};
        (photos.questions || []).forEach(function (q) { if (q.hidden) hiddenQuestions[q.id] = q; });
        var bands = (photos.bands || []).map(function (band) {
            var roles = {};
            (band.queries || []).forEach(function (q) {
                var question = hiddenQuestions[q.id];
                if (!question) return;
                roles[question.role] = Object.assign({}, question, q, { title: question.label });
            });
            return { id: 'photos-' + band.id, band: band.id, ios: band.ios, label: band.label, roles: roles };
        });
        sources.push({
            key: 'photos', platform: 'iOS', title: 'Photos.sqlite', paths: photos.paths || [], source: photos.source,
            bands: bands,
            databases: bands.map(function (b) {
                return { id: b.id, family: 'photos', familyTitle: 'Photos.sqlite', label: 'Photos.sqlite (' + b.label + ')', paths: photos.paths || [], ios: b.ios };
            }),
        });

        (appUsage.databases || []).forEach(function (db) {
            var roles = roleMap(db.queries);
            if (!Object.keys(roles).length) return;
            var isAndroid = /android|wellbeing/i.test(db.label);
            var label = db.label.replace(/^iOS — /, '').replace(/^Android — /, '');
            sources.push({
                key: db.id, platform: isAndroid ? 'Android' : 'iOS', title: label, paths: db.paths || [], source: db.source,
                roles: roles,
                databases: [{ id: db.id, family: db.id, familyTitle: label, label: label, paths: db.paths || [], ios: null }],
            });
        });

        (routined.databases || []).forEach(function (db) {
            var roles = roleMap(db.queries);
            if (!Object.keys(roles).length) return;
            var label = db.label.replace(/^iOS — /, '');
            sources.push({
                key: db.id, platform: 'iOS', title: label, paths: db.paths || [], source: db.source, roles: roles,
                databases: [{ id: db.id, family: db.id, familyTitle: label, label: label, paths: db.paths || [], ios: null }],
            });
        });

        // Snapchat (beta): på iOS fyra databaser som hittas på suffix i appens behållare, på Android
        // sex databaser under data/data/com.snapchat.android. Samma rollnamn på båda.
        [[catalogs.snapchat, 'iOS'], [catalogs.snapchatAndroid, 'Android']].forEach(function (pair) {
            ((pair[0] || {}).databases || []).forEach(function (db) {
                var roles = roleMap(db.queries);
                if (!Object.keys(roles).length) return;
                var label = db.label.replace(/^(iOS|Android) — /, '');
                sources.push({
                    key: db.id, platform: pair[1], title: label, paths: db.paths || [], source: db.source, roles: roles, beta: true,
                    databases: [{ id: db.id, family: db.id, familyTitle: label, label: label, paths: db.paths || [], ios: null }],
                });
            });
        });

        // Signal (beta): två databaser under data/data/org.thoughtcrime.securesms och signal.sqlite i
        // appgruppen på iOS, krypterade med SQLCipher. cipher följer med källan, så att Härkomst vet att
        // nyckeln behövs. WhatsApp (beta) på iOS är okrypterad. Telegram (beta) på iOS avkodas i minnet
        // (derive), och lagringsdatabasen är en egen källa. WhatsApp och Telegram (beta) på Android är okrypterade:
        // msgstore.db och wa.db under data/data/com.whatsapp, cache4.db under data/data/org.telegram.messenger.
        [[catalogs.signalAndroid, 'Android'], [catalogs.signalIos, 'iOS'], [catalogs.whatsappIos, 'iOS'], [catalogs.telegramIos, 'iOS'],
            [catalogs.whatsappAndroid, 'Android'], [catalogs.telegramAndroid, 'Android']].forEach(function (pair) {
            ((pair[0] || {}).databases || []).forEach(function (db) {
                var roles = roleMap(db.queries);
                if (!Object.keys(roles).length) return;
                var label = db.label.replace(/^(Android|iOS) — /, '');
                sources.push({
                    key: db.id, platform: pair[1], title: label, paths: db.paths || [], source: db.source, roles: roles, beta: true, cipher: db.cipher || null, derive: db.derive || null,
                    databases: [{ id: db.id, family: db.id, familyTitle: label, label: label, paths: db.paths || [], ios: null, cipher: db.cipher || null, derive: db.derive || null }],
                });
            });
        });

        (android.categories || []).forEach(function (cat) {
            var roles = roleMap(cat.queries);
            if (!Object.keys(roles).length) return;
            var key = 'android-' + cat.id;
            var label = cat.label + (cat.id === 'mediastore' ? ' (external.db)' : '');
            sources.push({
                key: key, platform: 'Android', title: label, paths: cat.paths || [], source: android.source, roles: roles,
                databases: [{ id: key, family: key, familyTitle: label, label: label, paths: cat.paths || [], ios: null }],
            });
        });

        return sources;
    }

    function databases(sources) {
        var out = [];
        sources.forEach(function (s) { out = out.concat(s.databases); });
        return out;
    }

    // Rollerna för en källa. För Photos väljs bandet efter iOS-versionen (eller databasens id).
    function rolesFor(source, pick) {
        if (!source.bands) return source.roles || {};
        var band = null;
        if (pick && pick.dbId) band = source.bands.find(function (b) { return b.id === pick.dbId; });
        if (!band && pick && pick.version) {
            var major = parseInt(pick.version, 10);
            band = source.bands.find(function (b) { return b.ios && major >= b.ios[0] && major <= b.ios[1]; });
        }
        if (!band) band = source.bands[source.bands.length - 1];
        return band.roles;
    }

    // Photos-bandet efter databasens egna tabeller och kolumner, när iOS-versionen saknas i zippen.
    // tables: tabellnamnen; columns: kolumnerna i ZADDITIONALASSETATTRIBUTES. null om inget passar.
    // Banden för iOS 15–16 och 17 och senare har samma rollqueryer.
    function photosBandFromSchema(tables, columns) {
        tables = tables || [];
        columns = columns || [];
        if (tables.indexOf('ZGENERICASSET') >= 0) return { id: 'photos-ios10-13', why: 'tabellen ZGENERICASSET finns (iOS 10–13)' };
        if (tables.indexOf('ZASSET') < 0) return null;
        if (columns.indexOf('ZIMPORTEDBYBUNDLEIDENTIFIER') >= 0) return { id: 'photos-ios17-plus', why: 'tabellen ZASSET med kolumnen ZIMPORTEDBYBUNDLEIDENTIFIER (iOS 15 och senare)' };
        return { id: 'photos-ios14', why: 'tabellen ZASSET utan kolumnen ZIMPORTEDBYBUNDLEIDENTIFIER (iOS 14)' };
    }

    function sqlString(v) { return String(v == null ? '' : v).replace(/'/g, "''"); }

    // Fyller i platshållarna. window: { startMs, endMs } i UTC-millisekunder. Tidsplatshållarna
    // blir tal i rätt epok. Textvärden citeras för SQL.
    function fill(sql, values) {
        values = values || {};
        var out = String(sql);
        var w = values.window;
        if (w) {
            var s = Math.floor(w.startMs / 1000);
            var e = Math.ceil(w.endMs / 1000);
            var pairs = {
                '{{cocoaStart}}': s - COCOA_EPOCH, '{{cocoaEnd}}': e - COCOA_EPOCH,
                '{{unixStart}}': s, '{{unixEnd}}': e,
                '{{unixMsStart}}': Math.floor(w.startMs), '{{unixMsEnd}}': Math.ceil(w.endMs),
            };
            Object.keys(pairs).forEach(function (token) { out = out.split(token).join(String(pairs[token])); });
        }
        Object.keys(values).forEach(function (name) {
            if (name === 'window') return;
            out = out.split('{{' + name + '}}').join(sqlString(values[name]));
        });
        var left = /\{\{(\w+)\}\}/.exec(out);
        if (left) throw new Error('Platshållaren ' + left[0] + ' fylldes inte i');
        return out;
    }

    // En fråga som katalogen märkt med splitByTime väljer raderna vars tid (fältet time, i millisekunder) ligger i
    // fönstret, gränserna medräknade, och ordnar dem efter tiden först och sedan entydigt. Svaret för ett fönster är
    // då svaren för fönstrets delar i följd, och en fråga över en stor logg kan köras i delar med paus emellan.
    function canSplit(query) {
        var t = query && query.splitByTime && query.epoch === 'unixMs' ? fieldSpec(query, 'time') : null;
        return !!t && t.epoch === 'unixMs';
    }

    // Säger frågeplanen (raderna ur EXPLAIN QUERY PLAN, texten sist i varje rad) att tiden slås upp i ett index,
    // utan att någon tabell läses rakt igenom? Annars skulle varje del läsa hela tabellen.
    function searchesByTime(query, planRows) {
        var col = fieldSpec(query, 'time').col;
        var texts = (planRows || []).map(function (r) { return String(r[r.length - 1]); });
        return texts.some(function (t) { return /^SEARCH /.test(t) && t.indexOf('(' + col + '>? AND ' + col + '<?)') >= 0; }) &&
            !texts.some(function (t) { return /^SCAN /.test(t); });
    }

    // Frågan som ger tiden hos den n:te raden efter en tid, i tidsordning, ur tabellen som frågeplanen säger att
    // tiden slås upp i (inParts, opts.edge). null när planen inte säger vilken tabell det är. plan(sql) säger om
    // en plan för den frågan går i indexet utan att sortera: annars läste varje gräns hela tabellen.
    function edgeQuery(query, planRows) {
        var col = fieldSpec(query, 'time').col;
        var table = null;
        (planRows || []).forEach(function (r) {
            var m = /^SEARCH (?:TABLE )?(\w+) USING (?:COVERING )?INDEX /.exec(String(r[r.length - 1]));
            if (m && String(r[r.length - 1]).indexOf('(' + col + '>? AND ' + col + '<?)') >= 0) table = m[1];
        });
        if (!table) return null;
        var sql = function (afterMs, n) {
            return 'SELECT "' + col + '" FROM "' + table + '" WHERE "' + col + '" > ' + Number(afterMs) + ' ORDER BY "' + col + '" LIMIT 1 OFFSET ' + Math.max(0, Math.floor(n) - 1);
        };
        return { table: table, sql: sql, inIndex: function (rows) {
            var texts = (rows || []).map(function (r) { return String(r[r.length - 1]); });
            return texts.length > 0 && texts.every(function (t) { return /^SEARCH /.test(t) && / INDEX /.test(t); });
        } };
    }

    // Kör en fråga som går att dela efter tid (canSplit) i delar och ger samma { columns, values } som hela frågan.
    // opts.exec(sql) kör en del och ger { columns, values } eller null när delen saknar rader. opts.span säger var
    // raderna ligger ({ firstMs, lastMs }): det styr bara delarnas bredd. Den första delen börjar där fönstret
    // börjar och den sista slutar där det slutar, så rader utanför span kommer också med. Delarna möts i en
    // gemensam gräns, och raderna i gränsen, som då kommer två gånger, tas bara med första gången. Bredden följer
    // hur lång tid en del tog (opts.aimMs per del): den växer försiktigt, eftersom raderna kan ligga tätt efter en
    // gles sträcka, och blir aldrig så smal att delarna blir fler än PARTS_MAX.
    // opts.between(andel) anropas mellan delarna och väntas in.
    // Raderna i en logg ligger tätt en stund och glest en annan, och en del som är lagom bred i en gles sträcka kan
    // ta många sekunder i en tät. Med opts.edge(efterMs, n), som ger tiden hos den n:te raden efter efterMs i
    // tidsordning (null när färre återstår), och antalet rader i opts.span.rows delas frågan därför efter antal rader
    // i stället: varje del är n rader lång, och n följer hur lång tid delen före tog. Var gränserna hamnar ändrar
    // inte svaret, bara hur länge en del tar. Ger edge inget som går att använda tas resten i en enda del.
    var PARTS_MAX = 20000;
    async function inParts(query, win, opts) {
        var col = fieldSpec(query, 'time').col;
        var start = Math.floor(win.startMs), end = Math.ceil(win.endMs);
        var lo = Math.max(start, Math.floor(opts.span.firstMs)), hi = Math.min(end, Math.ceil(opts.span.lastMs));
        var now = opts.now || Date.now;
        var aim = opts.aimMs || 100;
        var narrowest = Math.max(1, Math.ceil((hi - lo) / PARTS_MAX));
        var width = Math.max(narrowest, Math.round((hi - lo) / 200));
        var total = typeof opts.edge === 'function' && opts.span.rows > 0 ? Number(opts.span.rows) : 0;
        var fewest = Math.max(1, Math.ceil(total / PARTS_MAX));
        var count = Math.max(fewest, 500), asked = 0, after = start - 1;
        var out = { columns: [], values: [], parts: 0 };
        var from = start, next = lo, edge = null, at = -1;
        for (;;) {
            var last, to;
            if (total) {
                var nth = opts.edge(after, count);
                last = !(typeof nth === 'number' && nth > after && Math.ceil(nth) < end);
                to = last ? end : Math.ceil(nth);
                asked += count;
            } else {
                next += width;
                last = !(next < hi);
                to = last ? end : next;
            }
            var started = now();
            var res = opts.exec(fill(query.sql, { window: { startMs: from, endMs: to } }));
            var took = now() - started;
            out.parts++;
            if (res && res.values.length) {
                if (at < 0) {
                    out.columns = res.columns;
                    at = res.columns.indexOf(col);
                    if (at < 0) throw new Error('Frågan ' + query.id + ' ger inte kolumnen ' + col + ' och kan inte köras i delar');
                }
                var skip = 0;
                if (edge !== null) while (skip < res.values.length && res.values[skip][at] === edge) skip++;
                for (var i = skip; i < res.values.length; i++) out.values.push(res.values[i]);
            }
            if (last) return out;
            edge = from = after = to;
            var pace = Math.min(2, Math.max(0.125, aim / Math.max(took, 1)));
            width = Math.max(narrowest, Math.round(width * pace));
            count = Math.max(fewest, Math.round(count * pace));
            if (opts.between) await opts.between(total ? Math.min(asked / total, 1 - 1e-9) : (to - lo) / (hi - lo));
        }
    }

    // En fråga som katalogen märkt med indexByTime (svarets tidskolumner) väljer raderna där någon av de kolumnerna
    // ligger i fönstret, gränserna medräknade, och ordnar dem entydigt. Svaret över hela tiden kan då läggas en gång i
    // en egen tabell med index på tiderna, i en minnesdatabas bifogad under namnet INDEX_SCHEMA, och ett fönster slås
    // sedan upp där i stället för att källans tabell läses igenom för varje fil. Raderna ligger i tabellen i frågans
    // ordning, så uppslaget ordnar efter rowid och ger samma rader i samma ordning som frågan.
    // Ger { schema, table, build(fönster) -> satser, lookup(fönster) -> sats, drop }, eller null för en annan fråga.
    var INDEX_SCHEMA = 'ft_index';
    function timeIndex(query) {
        var cols = query && query.indexByTime;
        if (!Array.isArray(cols) || !cols.length || !cols.every(function (c) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(c); })) return null;
        // Fönstret är frågans enda platshållare, i en enda epok: samma platshållare fylls i uppslaget.
        var tokens = (String(query.sql).match(/\{\{\w+\}\}/g) || []).filter(function (t, i, a) { return a.indexOf(t) === i; }).sort().join();
        var unit = ['unixMs', 'unix', 'cocoa'].filter(function (u) { return tokens === '{{' + u + 'End}},{{' + u + 'Start}}'; })[0];
        if (!unit) return null;
        var table = 'q_' + String(query.id).replace(/\W/g, '_');
        var name = INDEX_SCHEMA + '."' + table + '"';
        var where = cols.map(function (c) { return '"' + c + '" BETWEEN {{' + unit + 'Start}} AND {{' + unit + 'End}}'; }).join(' OR ');
        return {
            schema: INDEX_SCHEMA, table: table, drop: 'DROP TABLE IF EXISTS ' + name,
            build: function (win) {
                return ['CREATE TABLE ' + name + ' AS ' + fill(query.sql, { window: win }).replace(/;\s*$/, '')]
                    .concat(cols.map(function (c, i) { return 'CREATE INDEX ' + INDEX_SCHEMA + '."' + table + '_' + (i + 1) + '" ON "' + table + '" ("' + c + '")'; }));
            },
            lookup: function (win) { return fill('SELECT * FROM ' + name + ' WHERE ' + where + ' ORDER BY rowid', { window: win }); },
        };
    }

    // Kolumn och epok för ett fält i fältkartan.
    function fieldSpec(query, key) {
        var spec = query.fields && query.fields[key];
        if (!spec) return null;
        if (typeof spec === 'string') return { col: spec, epoch: query.epoch };
        return { col: spec.col, epoch: spec.epoch || query.epoch };
    }

    // Gör om ett resultat från sql.js ({ columns, values }) till objekt med fältkartans namn.
    // Tidsfält (de som anges i timeKeys) blir UTC-millisekunder under samma namn med suffixet Ms.
    // Raden finns också som den är under _raw, utom med opts.raw === false (en stor chatt behöver den inte).
    function mapRows(query, result, timeKeys, opts) {
        if (!result || !result.columns) return [];
        var index = {};
        result.columns.forEach(function (c, i) { index[c] = i; });
        var keepRaw = !(opts && opts.raw === false);
        // Fälten slås upp en gång, inte för varje rad.
        var specs = Object.keys(query.fields || {}).map(function (key) {
            var spec = fieldSpec(query, key);
            return { key: key, at: index[spec.col], epoch: spec.epoch, time: !!(timeKeys && timeKeys.indexOf(key) >= 0) };
        });
        return result.values.map(function (row) {
            var o = {};
            if (keepRaw) {
                o._raw = {};
                result.columns.forEach(function (c, i) { o._raw[c] = row[i]; });
            }
            for (var k = 0; k < specs.length; k++) {
                var s = specs[k];
                var v = s.at === undefined ? null : row[s.at];
                o[s.key] = v;
                if (s.time) o[s.key + 'Ms'] = toMs(v, s.epoch);
            }
            return o;
        });
    }

    // Råvärde i databasen -> UTC-millisekunder. unixAuto: sekunder eller millisekunder efter storlek.
    function toMs(value, epoch) {
        if (value === null || value === undefined || value === '') return null;
        var n = Number(value);
        if (!isFinite(n) || n === 0) return null;
        if (epoch === 'cocoa') return Math.round((n + COCOA_EPOCH) * 1000);
        if (epoch === 'unixMs') return Math.round(n);
        if (epoch === 'unixAuto') return Math.round(n > 1000000000000 ? n : n * 1000);
        return Math.round(n * 1000);
    }

    var api = { collect: collect, databases: databases, rolesFor: rolesFor, photosBandFromSchema: photosBandFromSchema, fill: fill, canSplit: canSplit, edgeQuery: edgeQuery, searchesByTime: searchesByTime, inParts: inParts, timeIndex: timeIndex, fieldSpec: fieldSpec, mapRows: mapRows, toMs: toMs, COCOA_EPOCH: COCOA_EPOCH };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceRoles = api;
})(typeof window !== 'undefined' ? window : this);
