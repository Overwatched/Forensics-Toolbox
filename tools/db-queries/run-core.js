// Delar av "Kör i appen" som inte behöver webbläsaren: CSV-export, positioner till kartan och
// tiderna i UTC. Testas i Node.
(function (root) {
    'use strict';

    // En cell som börjar med =, +, -, @, tabb eller vagnretur kan bli en formel när filen öppnas i Excel
    // eller LibreOffice, och texten i en chatt eller ett filnamn väljer någon annan. Den får en apostrof
    // först. Ett vanligt tal (-73.98, +46701234567, 1e-5) lämnas som det är.
    function formulaSafe(s) {
        return /^[=+\-@\t\r]/.test(s) && !/^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/.test(s) ? "'" + s : s;
    }

    function csvCell(v) {
        if (v === null || v === undefined) return '';
        if (v instanceof Uint8Array) v = '0x' + Array.prototype.map.call(v, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
        var s = formulaSafe(String(v));
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
    // Filnamnet och mappen i en rad om en bild (Photos.sqlite, MediaStore): punkten heter som filen, och
    // kartan kan visa filen som miniatyr om den finns i extraktionen.
    var FILE_NAME_COLUMN = /^(ZFILENAME|_display_name|filename|file_name|filnamn)$/i;
    var FILE_DIR_COLUMN = /^(ZDIRECTORY|relative_path|directory|mapp)$/i;
    var TYPE_COLUMN = /^(typ|type|kalla|källa|provider)$/i;
    // En tidskolumn som inte heter något med time: ZDATECREATED, date_added, datetaken.
    var DATE_COLUMN = /date/i;
    var NOT_DATE = /update|zone|offset/i;
    // Appen och enheten i en rad om en bild: Photos.sqlite och MediaStore.
    var APP_NAME_COLUMN = /^(ZIMPORTEDBYDISPLAYNAME|app|app_name|appnamn)$/i;
    var APP_ID_COLUMN = /^(ZIMPORTEDBYBUNDLEIDENTIFIER|owner_package_name|bundle_?id|package(_name)?)$/i;
    var MAKE_COLUMN = /^(ZCAMERAMAKE|make|tillverkare)$/i;
    var MODEL_COLUMN = /^(ZCAMERAMODEL|model|modell)$/i;

    // Kolumnerna som SQL:en räknar om till datorns lokala tid: datetime(…, 'localtime') AS namn.
    function localColumns(sql) {
        var out = [];
        var re = /'localtime'\s*\)\s*AS\s+["`\[]?([A-Za-z_][\w]*)/gi;
        var m;
        while ((m = re.exec(String(sql || '')))) out.push(m[1]);
        return out;
    }

    // Tillverkaren och modellen som en enhet. En modell som redan börjar med tillverkaren står ensam.
    function deviceText(make, model) {
        make = make == null ? '' : String(make).trim();
        model = model == null ? '' : String(model).trim();
        if (!model) return make;
        return make && model.toLowerCase().indexOf(make.toLowerCase()) !== 0 ? make + ' ' + model : model;
    }

    // Datorns zon för en tid "ÅÅÅÅ-MM-DD TT:MM:SS" i lokal tid, som +01:00.
    function localZone(sort) {
        var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(sort || '');
        if (!m) return '';
        var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
        var off = -d.getTimezoneOffset();
        var a = Math.abs(off);
        return (off < 0 ? '-' : '+') + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
    }

    function toPoints(columns, rows, opts) {
        opts = opts || {};
        var imp = opts.importer;
        var headers = columns.map(String);
        var col = imp.guessColumns(headers);
        if (col.lat < 0 || col.lon < 0) return { points: [], skipped: rows.length, columns: col };
        var zone = function (i) { return i >= 0 && /utc/i.test(headers[i]) ? 'UTC' : ''; };
        // Tiden ur den första kolumnen vars värden går att läsa som tid: den gissade först (UTC före lokal), sedan
        // kolumner med date i namnet. ZEXIFTIMESTAMPSTRING heter något med time men har kolon i datumet.
        var readable = function (i) {
            var seen = 0, ok = 0;
            for (var r = 0; r < rows.length && seen < 20; r++) {
                var v = rows[r][i];
                if (v === null || v === undefined || v === '') continue;
                seen++;
                if (imp.takenFrom(v, zone(i))) ok++;
            }
            return seen > 0 && ok * 2 >= seen;
        };
        var timeCandidates = [col.time].concat(headers.map(function (h, i) { return /utc/i.test(h) && DATE_COLUMN.test(h) && !NOT_DATE.test(h) ? i : -1; }))
            .concat(headers.map(function (h, i) { return DATE_COLUMN.test(h) && !NOT_DATE.test(h) ? i : -1; }))
            .concat(headers.map(function (h, i) { return /time/i.test(h) && !NOT_DATE.test(h) ? i : -1; }))
            .filter(function (i) { return i >= 0 && i !== col.end; });
        col.time = timeCandidates.filter(readable)[0];
        if (col.time === undefined) col.time = -1;
        var appCol = headers.findIndex(function (h) { return APP_NAME_COLUMN.test(h); });
        if (appCol < 0) appCol = headers.findIndex(function (h) { return APP_ID_COLUMN.test(h); });
        var makeCol = headers.findIndex(function (h) { return MAKE_COLUMN.test(h); });
        var modelCol = headers.findIndex(function (h) { return MODEL_COLUMN.test(h); });
        var typeCol = headers.findIndex(function (h) { return TYPE_COLUMN.test(h); });
        var addrCol = headers.findIndex(function (h) { return /^(z?address(_?title|_?string|_?line)?|adress|formatted_?address|plats(namn)?|place_?name)$/i.test(h); });
        var nameCol = headers.findIndex(function (h) { return FILE_NAME_COLUMN.test(h); });
        var dirCol = nameCol >= 0 ? headers.findIndex(function (h) { return FILE_DIR_COLUMN.test(h); }) : -1;
        // Tiden säger vilken kolumn den kom ur, eftersom en databas har flera.
        // En kolumn som SQL:en räknade om med datetime(…, 'localtime') står i datorns zon. opts.localZone(tid) ger
        // zonen för den tiden (+01:00), så att punkten får en verklig tidpunkt.
        var local = opts.localColumns || [];
        var timed = function (value, i) {
            var t = i >= 0 ? imp.takenFrom(value, zone(i)) : null;
            if (!t) return null;
            t.kind = 'Tid (' + headers[i] + ')';
            if (!t.zone && opts.localZone && local.indexOf(headers[i]) >= 0) {
                t.zone = opts.localZone(t.sort) || '';
                if (t.zone) { t.text = t.sort + ' ' + t.zone; t.kind = 'Tid (' + headers[i] + ', datorns zon)'; }
            }
            return t;
        };
        // Radens övriga kolumner står i punktens ruta på kartan.
        var shownOnMap = [col.lat, col.lon, col.time, col.end, col.accuracy, typeCol, nameCol, dirCol, addrCol];
        var points = [];
        var skipped = 0;
        rows.forEach(function (row, n) {
            var lat = Number(row[col.lat]);
            var lon = Number(row[col.lon]);
            if (row[col.lat] === null || row[col.lon] === null || !isFinite(lat) || !isFinite(lon)
                || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) { skipped++; return; }
            var until = col.end >= 0 ? timed(row[col.end], col.end) : null;
            var accuracy = col.accuracy >= 0 ? Number(row[col.accuracy]) : NaN;
            var kind = typeCol >= 0 && row[typeCol] != null ? String(row[typeCol]) : '';
            var file = nameCol >= 0 && row[nameCol] != null && row[nameCol] !== '' ? String(row[nameCol]) : '';
            var base = file.replace(/^.*\//, '');
            var dir = dirCol >= 0 && row[dirCol] != null ? String(row[dirCol]).replace(/\/+$/, '') : file.indexOf('/') >= 0 ? file.slice(0, file.lastIndexOf('/')) : '';
            points.push({
                id: points.length + 1,
                // Raden i resultatet, så att punkten går att hitta i Queries.
                row: n + 1,
                name: base || (until || col.end >= 0 ? 'Besök' : (kind || 'Rad')) + ' ' + (n + 1),
                path: base ? (dir ? dir + '/' : '') + base : '', lat: lat, lon: lon,
                source: opts.source || 'Queries',
                taken: col.time >= 0 ? timed(row[col.time], col.time) : null,
                until: until,
                visit: col.end >= 0,
                accuracy: isFinite(accuracy) && accuracy > 0 ? accuracy : null,
                type: kind, software: '', mime: '',
                device: deviceText(makeCol >= 0 ? row[makeCol] : null, modelCol >= 0 ? row[modelCol] : null),
                app: appCol >= 0 && row[appCol] != null ? String(row[appCol]) : '',
                address: addrCol >= 0 && row[addrCol] != null && String(row[addrCol]).trim() ? String(row[addrCol]).trim().slice(0, 200) : '',
                addressFrom: addrCol >= 0 ? 'kolumnen ' + headers[addrCol] : '',
                extra: headers.map(function (h, i) { return shownOnMap.indexOf(i) < 0 && row[i] !== null && row[i] !== '' ? [h, cellText(row[i]).slice(0, 200)] : null; }).filter(Boolean).slice(0, 12),
            });
        });
        return { points: points, skipped: skipped, columns: col };
    }

    // Råa tidsstämplar -> UTC, samma regler som Härkomst (roles.js toMs). epoch: cocoa, cocoaAuto, unix, unixMs, unixAuto.
    var COCOA_EPOCH = 978307200;
    function epochMs(value, epoch) {
        if (value === null || value === undefined || value === '') return null;
        var n = Number(value);
        if (!isFinite(n) || n === 0) return null;
        return Math.round(epoch === 'cocoa' ? (n + COCOA_EPOCH) * 1000
            : epoch === 'cocoaAuto' ? ((n > 100000000000 ? n / 1e9 : n) + COCOA_EPOCH) * 1000
            : epoch === 'unixMs' ? n
                : epoch === 'unixAuto' ? (n > 1000000000000 ? n : n * 1000)
                    : n * 1000);
    }

    function epochText(value, epoch) {
        var ms = epochMs(value, epoch);
        if (ms === null) return null;
        var d = new Date(ms);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace(/Z$/, ' UTC');
    }

    // Raderna som en händelse i Härkomst kommer ifrån: en tidskolumn har händelsens tid. Har flera rader
    // samma tid väljs de där värdena som händelsen bär (meddelandets id, appen) står i någon kolumn.
    // target: { ms: [tider], values: [värden] }. specs: [{ col, epoch }]. Ger radernas nummer, från 0.
    function findRows(columns, rows, specs, target) {
        if (!target || !target.ms || !target.ms.length || !specs || !specs.length) return [];
        var plan = specs.map(function (s) { return { i: columns.indexOf(s.col), epoch: s.epoch }; }).filter(function (p) { return p.i >= 0; });
        var wanted = {};
        target.ms.forEach(function (m) { wanted[m] = true; });
        var hits = [];
        rows.forEach(function (row, n) {
            if (plan.some(function (p) { var ms = epochMs(row[p.i], p.epoch); return ms !== null && wanted[ms]; })) hits.push(n);
        });
        var values = (target.values || []).filter(function (v) { return v !== null && v !== undefined && v !== ''; }).map(String);
        if (hits.length < 2 || !values.length) return hits;
        var narrow = hits.filter(function (n) {
            return values.every(function (v) { return rows[n].some(function (c) { return c !== null && c !== undefined && String(c) === v; }); });
        });
        return narrow.length ? narrow : hits;
    }

    // Tabellen i den första FROM som inte är en underfråga, t.ex. ZASSET: källan i kartans bubbla.
    function mainTable(sql) {
        var text = String(sql == null ? '' : sql).replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:[^']|'')*'/g, "''");
        var re = /\bfrom\s+("?)([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)\1/gi, m;
        while ((m = re.exec(text))) {
            var name = m[2];
            if (!/^(select|json_each|json_tree|pragma_\w+)$/i.test(name)) return name.replace(/^main\./i, '');
        }
        return '';
    }

    // Vilka rader som visas när bara max får plats: de första, eller en bit runt den första markerade raden.
    function rowWindow(total, hits, max) {
        if (total <= max || !hits || !hits.length || hits[0] < max) return { start: 0, end: Math.min(total, max) };
        var start = Math.max(0, Math.min(hits[0] - Math.floor(max / 2), total - max));
        return { start: start, end: start + max };
    }

    // True när SQL:en bara läser. Då kan den köras mot en databas som hålls öppen. Allt annat, också en
    // PRAGMA, får en egen kopia, så att den inte kan ändra något som nästa körning läser.
    function readsOnly(sql) {
        var text = String(sql == null ? '' : sql)
            .replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
        if (!/^\s*(select|with)\b/i.test(text)) return false;
        return !/\b(create|insert|update|delete|drop|alter|replace|pragma|attach|detach|vacuum|reindex|begin|commit|savepoint|release|rollback)\b/i.test(text);
    }

    // En kolumn "<namn> (UTC)" direkt efter varje tidskolumn som Härkomst räknade om. specs: [{ col, epoch }].
    // Råvärdet står kvar, så att den omräknade tiden alltid går att kontrollera.
    function withUtcColumns(columns, rows, specs) {
        if (!specs || !specs.length) return { columns: columns, rows: rows, added: 0 };
        var plan = [];
        var out = [];
        columns.forEach(function (c, i) {
            plan.push({ i: i });
            out.push(c);
            var spec = specs.find(function (s) { return s.col === c; });
            if (spec) { plan.push({ i: i, epoch: spec.epoch }); out.push(c + ' (UTC)'); }
        });
        if (out.length === columns.length) return { columns: columns, rows: rows, added: 0 };
        return {
            columns: out,
            rows: rows.map(function (r) { return plan.map(function (p) { return p.epoch ? epochText(r[p.i], p.epoch) : r[p.i]; }); }),
            added: out.length - columns.length,
        };
    }

    var api = {
        toCsv: toCsv, cellText: cellText, toPoints: toPoints, localColumns: localColumns, localZone: localZone, epochMs: epochMs, epochText: epochText, withUtcColumns: withUtcColumns,
        findRows: findRows, rowWindow: rowWindow, readsOnly: readsOnly, mainTable: mainTable,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.QueryRunCore = api;
})(typeof window !== 'undefined' ? window : this);
