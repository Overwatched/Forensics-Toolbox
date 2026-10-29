// Härkomst hämtar sin SQL ur query-katalogerna via fältet role på dolda queries. Här
// samlas rollerna per databas och iOS-band, och platshållarna i SQL:en fylls i med tal och
// filnamn. Ingen egen SQL finns i verktyget. Testas i Node.
(function (root) {
    'use strict';

    var COCOA_EPOCH = 978307200;

    function roleMap(list, meta) {
        var out = {};
        (list || []).forEach(function (q) {
            if (!q.hidden || !q.role) return;
            out[q.role] = Object.assign({}, meta || {}, q);
        });
        return out;
    }

    // catalogs: { photos, android, appUsage, routined } som i Queries. Returnerar källorna i
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

    // Kolumn och epok för ett fält i fältkartan.
    function fieldSpec(query, key) {
        var spec = query.fields && query.fields[key];
        if (!spec) return null;
        if (typeof spec === 'string') return { col: spec, epoch: query.epoch };
        return { col: spec.col, epoch: spec.epoch || query.epoch };
    }

    // Gör om ett resultat från sql.js ({ columns, values }) till objekt med fältkartans namn.
    // Tidsfält (de som anges i timeKeys) blir UTC-millisekunder under samma namn med suffixet Ms.
    function mapRows(query, result, timeKeys) {
        if (!result || !result.columns) return [];
        var index = {};
        result.columns.forEach(function (c, i) { index[c] = i; });
        return result.values.map(function (row) {
            var o = { _raw: {} };
            result.columns.forEach(function (c, i) { o._raw[c] = row[i]; });
            Object.keys(query.fields || {}).forEach(function (key) {
                var spec = fieldSpec(query, key);
                var v = index[spec.col] === undefined ? null : row[index[spec.col]];
                o[key] = v;
                if (timeKeys && timeKeys.indexOf(key) >= 0) o[key + 'Ms'] = toMs(v, spec.epoch);
            });
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

    var api = { collect: collect, databases: databases, rolesFor: rolesFor, fill: fill, fieldSpec: fieldSpec, mapRows: mapRows, toMs: toMs, COCOA_EPOCH: COCOA_EPOCH };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceRoles = api;
})(typeof window !== 'undefined' ? window : this);
