// Delad läsning av en extraktion (zip): hitta katalogernas databaser, läsa iOS-versionen,
// läsa ut databas och -wal till minnet med CRC-kontroll och lägga på WAL-ramarna. Används
// av Queries (extraction.js) och Härkomst. Zippen nås bara via read(offset, length), som i
// appen är File.slice(). Inget skrivs någonsin. Testas i Node.
(function (root) {
    'use strict';

    // ZipRead, ZipLocate och SqliteWal är globala i webbläsaren. I Node skickas de in med use().
    var deps = {};
    function dep(name) {
        if (deps[name]) return deps[name];
        if (typeof root[name] !== 'undefined') return root[name];
        throw new Error(name + ' saknas');
    }

    function sizeText(n) {
        if (n >= 1073741824) return (n / 1073741824).toFixed(1).replace('.', ',') + ' GB';
        if (n >= 1048576) return (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
        if (n >= 1024) return Math.round(n / 1024) + ' kB';
        return n + ' byte';
    }

    // Unixtid ur zippen är UTC. Saknas den finns bara DOS-tid, som är lokal tid utan zon.
    function entryTime(e) {
        if (e.mtime) return new Date(e.mtime * 1000).toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
        return e.dosTime ? e.dosTime + ' (zon okänd)' : '';
    }

    function hex(n) { return ('0000000' + n.toString(16)).slice(-8); }

    function baseName(name) { return name.slice(name.lastIndexOf('/') + 1); }

    // Katalogens databaser grupperade per familj. Photos har en databas per iOS-version och
    // samma sökvägar för alla. databases: [{ id, family, familyTitle, label, paths, ios }]
    function targets(databases) {
        var out = [];
        var byKey = {};
        databases.forEach(function (d) {
            if (!d.paths || !d.paths.length) return;
            var key = d.family || d.id;
            if (!byKey[key]) {
                byKey[key] = { key: key, paths: d.paths, dbs: [], title: d.familyTitle || d.label };
                out.push(byKey[key]);
            }
            byKey[key].dbs.push(d);
        });
        return out;
    }

    // Rätt databas i familjen för iOS-versionen. Finns ingen som passar tas den sista, och
    // guessed säger att användaren bör kontrollera versionen.
    function dbForVersion(target, version) {
        if (target.dbs.length === 1) return { db: target.dbs[0], guessed: false };
        var major = version ? parseInt(version, 10) : NaN;
        var hit = target.dbs.find(function (d) { return d.ios && major >= d.ios[0] && major <= d.ios[1]; });
        return hit ? { db: hit, guessed: false } : { db: target.dbs[target.dbs.length - 1], guessed: true };
    }

    // Läser ut en post och beskriver var den kom ifrån, med CRC32 kontrollerad mot zippen.
    async function readEntry(read, entry) {
        var out = await dep('ZipRead').extract(read, entry);
        var line = 'Ur zippen: ' + entry.name + ' (' + entry.size + ' byte, ändrad ' + entryTime(entry) +
            ', CRC32 ' + hex(entry.crc32) + (out.crcOk ? ' stämmer' : ' STÄMMER INTE') + ')';
        if (!out.crcOk) line += '. Varning: innehållet skiljer sig från det zippen anger.';
        return { bytes: out.bytes, crcOk: out.crcOk, line: line };
    }

    // En källa i samma form som "Kör i appen" i Queries använder: { name, read() -> { bytes, lines } }.
    // lead: rader som ska stå först, t.ex. vilken zip det gäller.
    function zipSource(read, entry, lead) {
        return {
            name: baseName(entry.name),
            read: async function () {
                var r = await readEntry(read, entry);
                return { bytes: r.bytes, lines: (lead || []).concat([r.line]) };
            },
        };
    }

    // Går igenom innehållsförteckningen, hittar databaserna och läser iOS-versionen.
    // Returnerar { scan, found, version, systemVersion, seconds }.
    async function open(read, size, targetList, onProgress) {
        var ZipRead = dep('ZipRead');
        var ZipLocate = dep('ZipLocate');
        var started = Date.now();
        var scan = await ZipRead.scan(read, size, ZipLocate.keeper(targetList), onProgress);
        var loc = ZipLocate.locate(scan.entries, targetList);
        var version = null;
        if (loc.systemVersion) {
            try { version = ZipLocate.iosVersion((await ZipRead.extract(read, loc.systemVersion)).bytes); }
            catch (err) { version = null; }
        }
        return { scan: scan, found: loc.found, version: version, systemVersion: loc.systemVersion, seconds: (Date.now() - started) / 1000 };
    }

    // En ny genomgång av innehållsförteckningen efter andra poster, t.ex. bildfilen under DCIM.
    // keep(namn) avgör vilka som sparas.
    async function find(read, size, keep, onProgress) {
        var scan = await dep('ZipRead').scan(read, size, keep, onProgress);
        return scan.entries;
    }

    async function sha256(bytes) {
        var c = root.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
        if (!c || !c.subtle) return '';
        var digest = await c.subtle.digest('SHA-256', bytes);
        return Array.prototype.map.call(new Uint8Array(digest), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    }

    // Läser databasen och dess -wal ur zippen, kontrollerar CRC32, räknar SHA-256 på båda och
    // lägger WAL-ramarna på en kopia i minnet. hit är en träff från locate(): { db, wal, journal }.
    // Returnerar { bytes, stats, hashes: { db, wal }, lines, warnings, dbEntry, walEntry }.
    async function loadDatabase(read, hit, lead) {
        var dbRead = await readEntry(read, hit.db);
        var walRead = hit.wal ? await readEntry(read, hit.wal) : null;
        var hashes = { db: await sha256(dbRead.bytes), wal: walRead ? await sha256(walRead.bytes) : '' };
        var merged = dep('SqliteWal').apply(dbRead.bytes, walRead ? walRead.bytes : new Uint8Array(0));
        if (walRead && merged.stats.error) throw new Error(baseName(hit.wal.name) + ': ' + merged.stats.error);
        var warnings = [];
        if (!walRead) warnings.push(baseName(hit.db.name) + ' lästes utan -wal: extraktionen har ingen. Poster som bara fanns i -wal kan saknas.');
        if (hit.journal && hit.journal.size) warnings.push(baseName(hit.db.name) + ' har en -journal: databasen kan vara mitt i en transaktion.');
        if (!dbRead.crcOk) warnings.push('CRC32 för ' + baseName(hit.db.name) + ' stämmer inte med zippen.');
        if (walRead && !walRead.crcOk) warnings.push('CRC32 för ' + baseName(hit.wal.name) + ' stämmer inte med zippen.');
        var lines = (lead || []).concat([dbRead.line]).concat(walRead ? [walRead.line] : []);
        if (hashes.db) lines.push('SHA-256 ' + baseName(hit.db.name) + ': ' + hashes.db);
        if (hashes.wal) lines.push('SHA-256 ' + baseName(hit.wal.name) + ': ' + hashes.wal);
        return {
            bytes: merged.bytes, stats: merged.stats, hashes: hashes, lines: lines, warnings: warnings,
            dbEntry: hit.db, walEntry: hit.wal || null, crcOk: dbRead.crcOk && (!walRead || walRead.crcOk),
        };
    }

    // Samma text som Queries visar om WAL-ramarna.
    function walSummary(loaded) {
        if (!loaded.walEntry) return 'Utan -wal.';
        var s = loaded.stats;
        var text = '-wal: ' + s.appliedFrames + ' av ' + s.walFrames + ' ramar lades på (' + s.commits + ' commit, ' + s.pages + ' sidor).';
        if (s.uncommittedFrames) text += ' ' + s.uncommittedFrames + ' ramar hörde till en transaktion som aldrig blev klar och lades inte på.';
        if (s.oldFrames) text += ' ' + s.oldFrames + ' ramar är kvar från en äldre omgång av -wal och lades inte på.';
        if (s.brokenFrames) text += ' ' + s.brokenFrames + ' ramar från och med en trasig ram lades inte på.';
        return text;
    }

    var api = {
        use: function (d) { Object.keys(d).forEach(function (k) { deps[k] = d[k]; }); },
        targets: targets, dbForVersion: dbForVersion, open: open, find: find,
        readEntry: readEntry, zipSource: zipSource, loadDatabase: loadDatabase, walSummary: walSummary,
        sha256: sha256, entryTime: entryTime, hex: hex, sizeText: sizeText, baseName: baseName,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ExtractionCore = api;
})(typeof window !== 'undefined' ? window : this);
