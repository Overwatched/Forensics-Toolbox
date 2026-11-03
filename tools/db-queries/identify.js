// Vad användaren pekade på med knappen högst upp: en extraktion (zip), en SQLite-databas eller
// dess -wal, och vilken av katalogens databaser en SQLite-fil är. Katalogens queries provas mot
// filens schema med prepare(), som bara kompilerar frågan utan att köra den: en databas passar när
// alla dess queries går att förbereda. Queries som går att förbereda mot en tom databas
// (schemafrågor som "Tabeller i databasen") säger inget om filen och räknas inte. Testas i Node.
(function (root) {
    'use strict';

    var SQLITE = 'SQLite format 3\u0000';

    // Ser byten från 100 ut som huvudet för ett b-träd (typ, första fria block, cellernas början,
    // fragmenterade byte)? En krypterad sida klarar det nästan aldrig.
    function btreeHead(b) {
        if ([2, 5, 10, 13].indexOf(b[100]) < 0) return false;
        var size = ((b[16] << 8) | b[17]) === 1 ? 65536 : (b[16] << 8) | b[17];
        var usable = size - b[20];
        var free = (b[101] << 8) | b[102], content = ((b[105] << 8) | b[106]) || 65536;
        return (free === 0 || (free > 100 && free < usable)) && content <= usable && b[107] <= 60;
    }

    // Filens första byte (minst 16, helst 108) och namn: 'zip', 'wal', 'companion' (-shm, -journal),
    // 'sqlite' eller 'other' (en krypterad databas, eller något helt annat). En tom -wal känns igen på
    // namnet. En SQLCipher-fil med okrypterat huvud (Signal på iOS) börjar som SQLite, men har reserv
    // för IV och HMAC i byte 20 och en krypterad sida efter huvudet: den räknas som krypterad.
    function kindOf(head, name) {
        var b = head || [];
        var n = String(name || '');
        if (b[0] === 0x50 && b[1] === 0x4b && ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6) || (b[2] === 7 && b[3] === 8))) return 'zip';
        if (/-wal$/i.test(n) || (b[0] === 0x37 && b[1] === 0x7f && b[2] === 0x06 && (b[3] === 0x82 || b[3] === 0x83))) return 'wal';
        if (/-(shm|journal)$/i.test(n)) return 'companion';
        var plain = b.length >= 16;
        for (var i = 0; plain && i < 16; i++) if (b[i] !== SQLITE.charCodeAt(i)) plain = false;
        if (plain && b.length >= 108 && b[20] >= 32 && !btreeHead(b)) return 'other';
        if (plain) return 'sqlite';
        return /\.zip$/i.test(n) ? 'zip' : 'other';
    }

    // Filerna som valdes på en gång: [{ name, kind }] med kind från kindOf(). Ger index för zippar,
    // databaser, -wal och -journal (-shm behövs inte), och mismatch när -wal inte heter som databasen.
    function sortPicked(items) {
        var out = { zips: [], dbs: [], wal: null, journal: null, mismatch: false };
        items.forEach(function (it, i) {
            if (it.kind === 'zip') out.zips.push(i);
            else if (it.kind === 'wal') { if (out.wal === null) out.wal = i; }
            else if (it.kind === 'companion') { if (/-journal$/i.test(it.name)) out.journal = i; }
            else out.dbs.push(i);
        });
        out.mismatch = out.dbs.length === 1 && out.wal !== null && items[out.wal].name.replace(/-wal$/i, '') !== items[out.dbs[0]].name;
        return out;
    }

    // {{namn}} blir 0, som går att förbereda både i en sträng och som ett värde.
    function neutral(sql) {
        return String(sql || '').replace(/\{\{\w+\}\}/g, '0');
    }

    // Tom text när frågan går att förbereda, annars felet. sql.js kastar ibland en sträng.
    function prepareError(db, sql) {
        try {
            db.prepare(sql).free();
            return '';
        } catch (e) {
            return String(e && e.message ? e.message : e) || 'fel';
        }
    }

    // De queries per databas som säger något om schemat. En query som bara är kommentarer
    // ("Nothing to prepare") eller går att förbereda mot en tom databas räknas inte.
    var cache = null;
    function checks(SQL, databases) {
        if (cache && cache.databases === databases) return cache.map;
        var empty = new SQL.Database();
        var map = {};
        try {
            databases.forEach(function (d) {
                map[d.id] = (d.queries || []).map(function (q) { return neutral(q.sql); }).filter(function (sql) {
                    var err = prepareError(empty, sql);
                    return !!err && !/Nothing to prepare/i.test(err);
                });
            });
        } finally {
            empty.close();
        }
        cache = { databases: databases, map: map };
        return map;
    }

    function baseName(p) {
        var s = String(p || '');
        return s.slice(s.lastIndexOf('/') + 1).toLowerCase();
    }

    // Katalogens databaser vars sökväg slutar på filens namn (external.db, Photos.sqlite, signal.db).
    function byName(name, databases) {
        var n = baseName(name);
        if (!n) return [];
        return databases.filter(function (d) {
            return (d.paths || []).some(function (p) { return baseName(p) === n; });
        });
    }

    // Alla kolumnnamn i filens tabeller, med små bokstäver. En tabell som inte går att läsa hoppas över.
    function columnNames(db) {
        var words = {};
        var tables = db.exec("SELECT name FROM sqlite_master WHERE type = 'table'");
        (tables.length ? tables[0].values : []).forEach(function (row) {
            var cols;
            try { cols = db.exec('PRAGMA table_info("' + String(row[0]).replace(/"/g, '""') + '")'); } catch (e) { return; }
            (cols.length ? cols[0].values : []).forEach(function (c) { words[String(c[1]).toLowerCase()] = true; });
        });
        return words;
    }

    // Hur många av filens kolumner databasens queries nämner, utan kommentarer och strängar. Snapchats
    // arroyo.db på Android har fler kolumner än på iOS, och iOS-queries går därför också att förbereda
    // mot den: Android-queries nämner fler av dem.
    function specificity(list, words) {
        var seen = {};
        list.forEach(function (sql) {
            var code = sql.replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, ' ');
            (code.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).forEach(function (w) {
                w = w.toLowerCase();
                if (words[w]) seen[w] = true;
            });
        });
        return Object.keys(seen).length;
    }

    // Katalogens databaser mot en SQLite-fil (bytes med -wal pålagd): hur många av databasens
    // queries som går att förbereda. Bara databaser där minst en går, bäst först: alla queries
    // passar, den som redan är vald (opts.prefer), filens namn, extraktionens operativsystem
    // (opts.os), störst andel, flest queries, flest av filens kolumner. Inom en familj vinner den
    // senaste (Photos.sqlite för den nyaste iOS-versionen), annars katalogens ordning.
    function rank(SQL, bytes, databases, opts) {
        opts = opts || {};
        var map = checks(SQL, databases);
        var named = byName(opts.name, databases).map(function (d) { return d.id; });
        var db = new SQL.Database(bytes);
        var out = [];
        try {
            var words = null;
            databases.forEach(function (d, i) {
                var list = map[d.id] || [];
                if (!list.length) return;
                var ok = list.filter(function (sql) { return !prepareError(db, sql); }).length;
                if (!ok) return;
                words = words || columnNames(db);
                out.push({
                    id: d.id, family: d.family || d.id, os: d.os || '', ok: ok, total: list.length, full: ok === list.length,
                    named: named.indexOf(d.id) >= 0, columns: specificity(list, words), order: i,
                });
            });
        } finally {
            db.close();
        }
        out.sort(function (a, b) {
            return (b.full - a.full) || ((b.id === opts.prefer) - (a.id === opts.prefer)) || (b.named - a.named)
                || (opts.os ? (b.os === opts.os) - (a.os === opts.os) : 0)
                || (b.ok / b.total - a.ok / a.total) || (b.ok - a.ok) || (b.columns - a.columns)
                || (a.family === b.family ? b.order - a.order : a.order - b.order);
        });
        return out;
    }

    // Slutsatsen ur rank(): { best, families, partial, ok, total, order, ranked }, eller null när ingen
    // query passar. order är databasernas id, bäst först.
    // Filen gäller varje familj där alla queries passar, eller minst hälften: MediaStore och kamerans
    // filer ligger i samma external.db, och en äldre external.db saknar vyer som någon query använder.
    // partial säger att inte alla queries i den bästa databasen passar.
    function conclude(ranked) {
        if (!ranked || !ranked.length) return null;
        var families = [];
        ranked.forEach(function (r, i) {
            if ((i === 0 || r.full || r.ok / r.total >= 0.5) && families.indexOf(r.family) < 0) families.push(r.family);
        });
        return {
            best: ranked[0].id, families: families, partial: !ranked[0].full, ok: ranked[0].ok, total: ranked[0].total,
            order: ranked.map(function (r) { return r.id; }), ranked: ranked,
        };
    }

    // När schemat inte säger något känns filen igen på namnet. En krypterad fil (SQLCipher) har inget
    // schema att läsa utan nyckeln (opts.encrypted: bara krypterade databaser), och en databas vars
    // tabeller bara finns i -wal har inga utan sin -wal. opts.prefer och opts.os som i rank().
    function fromName(name, databases, opts) {
        opts = opts || {};
        var hits = byName(name, databases).filter(function (d) { return !opts.encrypted || !!d.cipher; });
        if (!hits.length) return null;
        var best = hits.find(function (d) { return d.id === opts.prefer; })
            || (opts.os && hits.find(function (d) { return d.os === opts.os; })) || hits[0];
        var families = [];
        hits.forEach(function (d) {
            var f = d.family || d.id;
            if (families.indexOf(f) < 0) families.push(f);
        });
        var order = [best.id].concat(hits.filter(function (d) { return d !== best; }).map(function (d) { return d.id; }));
        return { best: best.id, families: families, partial: false, ok: 0, total: 0, byName: true, order: order, ranked: [] };
    }

    var api = {
        kindOf: kindOf, sortPicked: sortPicked, neutral: neutral, checks: checks, byName: byName, rank: rank, conclude: conclude,
        fromName: fromName,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.DbIdentify = api;
})(typeof window !== 'undefined' ? window : this);
