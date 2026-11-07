// Textfiler som tabeller i Queries. Filen tolkas på samma sätt som i Härkomst, och raderna läggs i en SQLite-databas i
// minnet som queryerna körs mot. Filen i extraktionen läses bara. Katalogens databas säger vilken tolkning med convert.
// Testas i Node.
(function (root) {
    'use strict';

    function samsungLogs() {
        if (root.ProvenanceSamsungLogs) return root.ProvenanceSamsungLogs;
        if (typeof require === 'function') return require('../provenance/samsung-logs.js');
        throw new Error('Tolkningen av Samsungs loggar saknas');
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

    function known(kind) { return Object.prototype.hasOwnProperty.call(KINDS, kind); }

    // bytes -> en SQLite-databas med tabellen, som bytes. { bytes, table, rows, line }. SQL: sql.js.
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
                line: (name || 'Filen') + ' är text: ' + read.summary + ' lästes in i tabellen ' + k.table + ' i minnet, med samma tolkning som i Härkomst. Filen ändrades inte.',
            };
        } finally {
            db.close();
        }
    }

    var api = { toSqlite: toSqlite, known: known };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.QueryTextLogs = api;
})(typeof window !== 'undefined' ? window : this);
