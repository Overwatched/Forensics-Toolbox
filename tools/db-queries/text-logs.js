// Loggfiler som inte är SQL som tabeller i Queries: Samsungs eRR.p (en textfil), usagestats på Android och Biome på
// iOS (en mapp med binära filer). Filerna tolkas på samma sätt som i Härkomst, och raderna läggs i en SQLite-databas i
// minnet som queryerna körs mot. Filerna i extraktionen läses bara. Katalogens databas säger vilken tolkning med convert,
// och folder: true att källan är en mapp; då får read() en lista { name, bytes } i stället för en fil. Testas i Node.
(function (root) {
    'use strict';

    function samsungLogs() {
        if (root.ProvenanceSamsungLogs) return root.ProvenanceSamsungLogs;
        if (typeof require === 'function') return require('../provenance/samsung-logs.js');
        throw new Error('Tolkningen av Samsungs loggar saknas');
    }

    function androidLogs() {
        if (root.ProvenanceAndroidLogs) return root.ProvenanceAndroidLogs;
        if (typeof require === 'function') return require('../provenance/android-logs.js');
        throw new Error('Tolkningen av Androids loggar saknas');
    }

    function biome() {
        if (root.ProvenanceBiome) return root.ProvenanceBiome;
        if (typeof require === 'function') return require('../provenance/biome.js');
        throw new Error('Tolkningen av Biome saknas');
    }

    function baseName(p) { return String(p).slice(String(p).lastIndexOf('/') + 1); }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    // Filerna i en Biome-ström: bara filerna direkt i local/ (tombstone/ säger bara vad som rensats).
    function biomeRows(files, decode, toRow) {
        var B = biome();
        var rows = [], read = 0, deleted = 0, versions = {};
        (files || []).forEach(function (f) {
            if (/\/tombstone\//.test(f.name) || !B.isSegb(f.bytes)) return;
            var d = decode(f.bytes);
            read++; deleted += d.deleted; versions[d.version] = true;
            d.rows.forEach(function (r) { rows.push(toRow(baseName(f.name), r)); });
        });
        return { rows: rows, summary: plural(read, 'fil', 'filer') + ' (SEGB version ' + Object.keys(versions).join(' och ') + '), ' + plural(rows.length, 'post', 'poster') + ', ' + deleted + ' rensade' };
    }

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function utcText(ms) { return new Date(ms).toISOString().slice(0, 19).replace('T', ' '); }
    function zoneText(minutes) {
        var abs = Math.abs(minutes);
        return (minutes < 0 ? '-' : '+') + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
    }
    function localText(r) { return utcText(r.localMs) + zoneText(r.offsetMinutes).replace(':', ''); }

    var KINDS = {
        // eRR.p: en rad per start, omstart och nedstängning.
        'err-p': {
            table: 'err',
            columns: [
                ['rad', 'INTEGER'], ['tid', 'TEXT'], ['unix_ms', 'INTEGER'], ['utc', 'TEXT'], ['zon', 'TEXT'], ['vad', 'TEXT'], ['kod', 'TEXT'],
                ['orsak', 'TEXT'], ['orsak_i_ord', 'TEXT'], ['krasch', 'INTEGER'], ['fel_klocka', 'INTEGER'], ['text', 'TEXT'],
            ],
            read: function (bytes, name) {
                var S = samsungLogs();
                var parsed = S.parseErr(bytes, name || 'eRR.p');
                var rows = parsed.rows.map(function (r) {
                    return [r.line, localText(r), r.ms, utcText(r.ms), zoneText(r.offsetMinutes), r.what || '', r.code || '', r.reason || null,
                        r.reason ? S.ERR_REASONS[r.reason] || null : null, r.crash ? 1 : 0, r.clockLost ? 1 : 0, r.raw];
                });
                var text = rows.length + (rows.length === 1 ? ' rad' : ' rader') + (parsed.clockLost ? ', ' + parsed.clockLost + ' med fel klocka' : '') +
                    (parsed.headerRows != null && parsed.headerRows !== rows.length ? '. Filens huvud säger ' + parsed.headerRows + ' rader' : '');
                return { rows: rows, summary: text };
            },
        },
    };

    // usagestats: dagsfilerna under daily/ med mappings (version 5) eller strängpoolen i filen (version 4).
    KINDS.usagestats = {
        table: 'handelser',
        columns: [
            ['fil', 'TEXT'], ['tid_utc', 'TEXT'], ['unix_ms', 'INTEGER'], ['typ', 'INTEGER'], ['typnamn', 'TEXT'], ['paket', 'TEXT'], ['klass', 'TEXT'],
            ['kanal', 'TEXT'], ['instans', 'INTEGER'],
        ],
        read: function (files) {
            var L = androidLogs();
            var byName = {};
            (files || []).forEach(function (f) { byName[f.name] = f; });
            var find = function (re) { return (files || []).filter(function (f) { return re.test(f.name); })[0] || null; };
            var vf = find(/\/usagestats\/(?:\d+\/)?version$/);
            var mf = find(/\/usagestats\/(?:\d+\/)?mappings$/);
            var vi = vf ? L.usageVersion(vf.bytes) : { version: null };
            var daily = (files || []).filter(function (f) { return L.isUsageDailyPath(f.name); });
            if (vi.version != null && vi.version < 4) throw new Error('usagestats version ' + vi.version + ' är XML (Android 9 eller äldre) och läses inte här.');
            if (vi.version !== 4 && !mf) throw new Error('usagestats saknar filen mappings, som behövs för att läsa dagsfilerna.');
            var map = mf ? L.usageMappings(mf.bytes) : null;
            var rows = [];
            daily.forEach(function (f) {
                var d = L.usageDaily(f.bytes, L.dailyBeginMs(f.name), map, vi.version || 5);
                d.events.forEach(function (e) {
                    rows.push(['daily/' + baseName(f.name), utcText(e.ms), e.ms, e.type, e.typeName, e.pkg || null, e.cls || null, e.channel || null, e.instance || null]);
                });
            });
            rows.sort(function (a, b) { return a[2] - b[2]; });
            return { rows: rows, summary: plural(daily.length, 'dagsfil', 'dagsfiler') + ' (version ' + (vi.version == null ? 'okänd' : vi.version) + (vi.release ? ', Android ' + vi.release : '') + '), ' + plural(rows.length, 'händelse', 'händelser') };
        },
    };

    // Biome Notification.Usage: en rad per händelse kring en notis.
    KINDS['biome-notification-usage'] = {
        table: 'notishandelser',
        columns: [
            ['fil', 'TEXT'], ['position', 'INTEGER'], ['tid_utc', 'TEXT'], ['unix_ms', 'INTEGER'], ['notis_tid_utc', 'TEXT'], ['notis_unix_ms', 'INTEGER'],
            ['typ', 'INTEGER'], ['app', 'TEXT'], ['titel', 'TEXT'], ['notis_id', 'TEXT'], ['handelse_id', 'TEXT'], ['trad', 'TEXT'], ['summa_ok', 'INTEGER'],
        ],
        read: function (files) {
            return biomeRows(files, biome().notificationUsage, function (file, r) {
                return [file, r.offset, r.ms != null ? utcText(r.ms) : null, r.ms, r.notifiedMs != null ? utcText(r.notifiedMs) : null, r.notifiedMs, r.type, r.app, r.title, r.id, r.eventId, r.thread, r.crcOk ? 1 : 0];
            });
        },
    };

    // Biome App.InFocus: en rad när en app kommer i förgrunden och en när den lämnar den.
    KINDS['biome-app-infocus'] = {
        table: 'forgrund',
        columns: [
            ['fil', 'TEXT'], ['position', 'INTEGER'], ['tid_utc', 'TEXT'], ['unix_ms', 'INTEGER'], ['in_i_forgrunden', 'INTEGER'], ['app', 'TEXT'], ['skal', 'TEXT'],
            ['sort', 'INTEGER'], ['version', 'TEXT'], ['summa_ok', 'INTEGER'],
        ],
        read: function (files) {
            return biomeRows(files, biome().appInFocus, function (file, r) {
                return [file, r.offset, r.ms != null ? utcText(r.ms) : null, r.ms, r.starting ? 1 : 0, r.app, r.reason, r.kind, r.version, r.crcOk ? 1 : 0];
            });
        },
    };

    function known(kind) { return Object.prototype.hasOwnProperty.call(KINDS, kind); }

    // bytes (eller [{ name, bytes }] för en mapp) -> en SQLite-databas med tabellen, som bytes. { bytes, table, rows, line }. SQL: sql.js.
    function toSqlite(SQL, kind, bytes, name) {
        if (!known(kind)) throw new Error('Okänd textfil: ' + kind);
        var k = KINDS[kind];
        var read = k.read(bytes, name);
        var db = new SQL.Database();
        try {
            db.run('CREATE TABLE ' + k.table + ' (' + k.columns.map(function (c) { return c[0] + ' ' + c[1]; }).join(', ') + ')');
            var stmt = db.prepare('INSERT INTO ' + k.table + ' VALUES (' + k.columns.map(function () { return '?'; }).join(', ') + ')');
            try { read.rows.forEach(function (r) { stmt.run(r); }); } finally { stmt.free(); }
            return {
                bytes: db.export(), table: k.table, rows: read.rows.length,
                line: Array.isArray(bytes) ? (name || 'Mappen') + ': ' + read.summary + ' lästes in i tabellen ' + k.table + ' i minnet, med samma tolkning som i Härkomst. Filerna ändrades inte.'
                    : (name || 'Filen') + ' är text: ' + read.summary + ' lästes in i tabellen ' + k.table + ' i minnet, med samma tolkning som i Härkomst. Filen ändrades inte.',
            };
        } finally {
            db.close();
        }
    }

    var api = { toSqlite: toSqlite, known: known };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.QueryTextLogs = api;
})(typeof window !== 'undefined' ? window : this);
