// Hittar katalogernas databaser bland namnen i en zip. Sökvägen jämförs bakifrån, eftersom
// verktygen lägger olika prefix framför (filesystem1/, /, inget). -wal, -shm och -journal
// kopplas till sin databas. Testas i Node.
(function (root) {
    'use strict';

    var COMPANION = /-(wal|shm|journal)$/;
    var SYSTEM_VERSION = 'System/Library/CoreServices/SystemVersion.plist';

    // Android: /data/user/0/<paket> är samma som /data/data/<paket>. Andra användare (10, 11 …)
    // behålls som egna träffar med användarnumret.
    function normalize(name) {
        var n = String(name).replace(/\\/g, '/').replace(/^\/+/, '');
        var user = null;
        var m = /(^|\/)data\/user(?:_de)?\/(\d+)\//.exec(n);
        if (m) {
            user = Number(m[2]);
            n = n.slice(0, m.index) + m[1] + 'data/data/' + n.slice(m.index + m[0].length);
        } else if (/(^|\/)data\/data\//.test(n)) {
            user = 0;
        }
        return { path: n, user: user };
    }

    function baseName(p) { return p.slice(p.lastIndexOf('/') + 1); }

    // targets: [{ key, paths: [...] }]. Snabbt filter till ZipRead.scan: bara namn vars filnamn
    // kan vara en databas, en -wal/-shm/-journal eller SystemVersion.plist sparas.
    function keeper(targets) {
        var names = {};
        targets.forEach(function (t) { t.paths.forEach(function (p) { names[baseName(p)] = true; }); });
        names[baseName(SYSTEM_VERSION)] = true;
        return function (name) {
            if (name.charAt(name.length - 1) === '/') return false;
            return names[baseName(name).replace(COMPANION, '')] === true;
        };
    }

    function suffixMatch(path, wanted) {
        if (path === wanted) return '';
        if (path.length > wanted.length && path.slice(-wanted.length - 1) === '/' + wanted) {
            return path.slice(0, path.length - wanted.length);
        }
        return null;
    }

    // Returnerar { found: [...], iosVersion }. Varje träff:
    // { key, path (katalogens sökväg), primary (första sökvägen i katalogen), user,
    //   db, wal, shm, journal (zip-poster eller null) }
    function locate(entries, targets) {
        var byName = {};
        entries.forEach(function (e) { byName[e.name] = e; });
        var found = [];
        var prefixes = {};
        entries.forEach(function (e) {
            if (COMPANION.test(e.name) || e.name.charAt(e.name.length - 1) === '/') return;
            var norm = normalize(e.name);
            targets.forEach(function (t) {
                t.paths.forEach(function (p, i) {
                    var prefix = suffixMatch(norm.path, p);
                    if (prefix === null) return;
                    prefixes[prefix] = (prefixes[prefix] || 0) + 1;
                    found.push({
                        key: t.key, path: p, primary: i === 0, user: norm.user,
                        db: e,
                        wal: byName[e.name + '-wal'] || null,
                        shm: byName[e.name + '-shm'] || null,
                        journal: byName[e.name + '-journal'] || null,
                    });
                });
            });
        });
        found.sort(function (a, b) {
            return targets.findIndex(function (t) { return t.key === a.key; }) - targets.findIndex(function (t) { return t.key === b.key; })
                || (b.primary - a.primary) || ((a.user || 0) - (b.user || 0)) || (a.db.name < b.db.name ? -1 : 1);
        });
        return { found: found, systemVersion: systemVersionEntry(entries, prefixes) };
    }

    // Det finns kopior av SystemVersion.plist i programuppdateringar och tillgångar. Den rätta
    // ligger under samma prefix som databaserna, annars den med kortast sökväg.
    function systemVersionEntry(entries, prefixes) {
        var hits = entries.filter(function (e) {
            return suffixMatch(normalize(e.name).path, SYSTEM_VERSION) !== null;
        });
        var best = null;
        hits.forEach(function (e) {
            var prefix = suffixMatch(normalize(e.name).path, SYSTEM_VERSION);
            var score = (prefixes[prefix] ? 0 : 1e6) + e.name.length;
            if (!best || score < best.score) best = { entry: e, score: score };
        });
        return best ? best.entry : null;
    }

    // Läser ProductVersion ur en XML-plist. Binära plistar ger null.
    function iosVersion(bytes) {
        var text = new TextDecoder('utf-8').decode(bytes);
        var m = /<key>ProductVersion<\/key>\s*<string>([\d.]+)<\/string>/.exec(text);
        return m ? m[1] : null;
    }

    var api = { normalize: normalize, keeper: keeper, locate: locate, iosVersion: iosVersion, SYSTEM_VERSION: SYSTEM_VERSION };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ZipLocate = api;
})(typeof window !== 'undefined' ? window : this);
