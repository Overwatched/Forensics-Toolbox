// Delar av "Kör i appen" som inte behöver webbläsaren: para ihop databas och -wal,
// CSV-export och positioner till kartan. Testas i Node.
(function (root) {
    'use strict';

    // Databasen är filen som inte slutar på -wal, -shm eller -journal. -wal ska höra till
    // samma databas, annars varnar vi.
    function pairFiles(names) {
        var db = null;
        var wal = null;
        var other = [];
        names.forEach(function (name, i) {
            if (/-wal$/i.test(name)) { if (wal === null) wal = i; else other.push(i); }
            else if (/-(shm|journal)$/i.test(name)) other.push(i);
            else if (db === null) db = i;
            else other.push(i);
        });
        var mismatch = db !== null && wal !== null && names[wal].replace(/-wal$/i, '') !== names[db];
        return { db: db, wal: wal, other: other, mismatch: mismatch };
    }

    function csvCell(v) {
        if (v === null || v === undefined) return '';
        if (v instanceof Uint8Array) v = '0x' + Array.prototype.map.call(v, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
        var s = String(v);
        return /[",;\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    function toCsv(columns, rows) {
        return [columns].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
    }

    function cellText(v) {
        if (v === null || v === undefined) return 'NULL';
        if (v instanceof Uint8Array) return '(blob, ' + v.length + ' byte)';
        return String(v);
    }

    // Kolumnerna gissas på samma sätt som CSV-importen i Positioner, så att resultatet
    // hamnar likadant på kartan som en exporterad CSV.
    function toPoints(columns, rows, opts) {
        opts = opts || {};
        var imp = opts.importer;
        var headers = columns.map(String);
        var col = imp.guessColumns(headers);
        if (col.lat < 0 || col.lon < 0) return { points: [], skipped: rows.length, columns: col };
        var zone = function (i) { return i >= 0 && /utc/i.test(headers[i]) ? 'UTC' : ''; };
        var typeCol = headers.findIndex(function (h) { return /^(typ|type)$/i.test(h); });
        var points = [];
        var skipped = 0;
        rows.forEach(function (row, n) {
            var lat = Number(row[col.lat]);
            var lon = Number(row[col.lon]);
            if (row[col.lat] === null || row[col.lon] === null || !isFinite(lat) || !isFinite(lon)
                || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) { skipped++; return; }
            var until = col.end >= 0 ? imp.takenFrom(row[col.end], zone(col.end)) : null;
            var accuracy = col.accuracy >= 0 ? Number(row[col.accuracy]) : NaN;
            var kind = typeCol >= 0 && row[typeCol] != null ? String(row[typeCol]) : '';
            points.push({
                id: points.length + 1,
                name: (until || col.end >= 0 ? 'Besök' : (kind || opts.title || 'Position')) + ' ' + (n + 1),
                path: '', lat: lat, lon: lon,
                source: opts.source || 'Queries',
                taken: col.time >= 0 ? imp.takenFrom(row[col.time], zone(col.time)) : null,
                until: until,
                visit: col.end >= 0,
                accuracy: isFinite(accuracy) && accuracy > 0 ? accuracy : null,
                type: kind, device: '', software: '', mime: '',
            });
        });
        return { points: points, skipped: skipped, columns: col };
    }

    var api = { pairFiles: pairFiles, toCsv: toCsv, cellText: cellText, toPoints: toPoints };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.QueryRunCore = api;
})(typeof window !== 'undefined' ? window : this);
