// Delad läsning av en extraktion (zip eller UFDR): hitta katalogernas databaser, läsa iOS-versionen,
// läsa ut databas och -wal till minnet med CRC-kontroll och lägga på WAL-ramarna. Används
// av Queries (extraction.js) och Härkomst. Filen nås bara via read(offset, length), som i
// appen är File.slice(). Inget skrivs någonsin. Testas i Node.
(function (root) {
    'use strict';

    // ZipRead, ZipLocate, UfdrRead, FsTimes och SqliteWal är globala i webbläsaren. I Node skickas de in med use().
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

    // Zippens tider för en post (som text och i ms), och fältet de kommer ur. created är filens
    // skapandetid: NTFS-fältets, eller den fjärde i UT-fältet. changed är ctime, den tredje av fyra
    // UT-tider. third är den tredje av tre UT-tider: skapandetid enligt Info-ZIP:s beskrivning, men
    // ctime hos andra verktyg, och vilket det är syns inte i zippen. Därför är den ingen skapandetid.
    function entryTimes(e) {
        var utc = function (s) { return s ? new Date(s * 1000).toISOString().slice(0, 19).replace('T', ' ') + ' UTC' : ''; };
        return {
            modified: entryTime(e), created: utc(e.crtime), changed: utc(e.ctime), third: utc(e.utThird), accessed: utc(e.atime),
            modifiedMs: e.mtime ? Math.round(e.mtime * 1000) : null, createdMs: e.crtime ? Math.round(e.crtime * 1000) : null, changedMs: e.ctime ? Math.round(e.ctime * 1000) : null,
            thirdMs: e.utThird ? e.utThird * 1000 : null, accessedMs: e.atime ? Math.round(e.atime * 1000) : null,
            field: e.timeField === 'NTFS' ? 'NTFS-fältet' : e.timeField === 'UT' ? 'UT-fältet' : e.timeField === 'report.xml' || e.timeField === 'metadata.msgpack' ? e.timeField : '',
        };
    }

    function hex(n) { return ('0000000' + n.toString(16)).slice(-8); }

    // En vanlig SQLite-fil börjar med "SQLite format 3" och en nolla. En SQLCipher-fil börjar med saltet.
    function isPlainSqlite(bytes) {
        var head = 'SQLite format 3\u0000';
        for (var i = 0; i < 16; i++) if (bytes[i] !== head.charCodeAt(i)) return false;
        return true;
    }

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

    // Vad källan heter i texterna. En rapport är också en zip, men det undersökaren valde är en rapport.
    function sourceWord(entry) { return entry && entry.report ? 'rapporten' : 'zippen'; }

    // Läser ut en post och beskriver var den kom ifrån, med CRC32 kontrollerad mot zippen. I en rapport står
    // telefonens sökväg först och rapportens egen post efter.
    async function readEntry(read, entry) {
        var out = await dep('ZipRead').extract(read, entry);
        var where = entry.report ? (entry.report.member ? 'posten ' + entry.report.member + ', ' : 'tom fil utan post i rapporten, ') : '';
        var line = 'Ur ' + sourceWord(entry) + ': ' + entry.name + ' (' + where + entry.size + ' byte, ändrad ' + entryTime(entry) +
            ', CRC32 ' + hex(entry.crc32) + (out.crcOk ? ' stämmer' : ' STÄMMER INTE') + ')';
        if (!out.crcOk) line += '. Varning: innehållet skiljer sig från det ' + sourceWord(entry) + ' anger.';
        return { bytes: out.bytes, crcOk: out.crcOk, line: line };
    }

    // Filens SHA-256 mot den report.xml anger. true, false, eller null när det inte går att jämföra.
    function reportHashOk(entry, sha) {
        var want = entry && entry.report && entry.report.sha256;
        return want && sha ? want.toLowerCase() === sha : null;
    }

    // Extraktionen som en fil: { read, report, fsTimes, timesError }. report är rapportens uppgifter för en UFDR,
    // och read känner då redan till filerna på telefonen. fsTimes: { count } när zippens filer har sina tider i en
    // egen fil. timesError: den gick inte att läsa, så tiderna i zippen säger inget säkert.
    // opts.onReport(lästa byte, alla) medan report.xml läses, opts.onTimes() när tiderna ska läsas.
    async function openSource(file, opts) {
        opts = opts || {};
        var read = dep('ZipRead').fileReader(file);
        var Ufdr = deps.UfdrRead || root.UfdrRead;
        if (Ufdr && await Ufdr.detect(read, file.size, file.name)) {
            var opened = await Ufdr.open(read, file.size, { onProgress: opts.onReport });
            return { read: opened.read, report: opened.report, fsTimes: null, timesError: '' };
        }
        var Times = deps.FsTimes || root.FsTimes;
        var out = { read: read, report: null, fsTimes: null, timesError: '' };
        if (Times) {
            try {
                var times = await Times.load(read, file.size, { onStart: opts.onTimes });
                if (times) { read.fsTimes = times; out.fsTimes = { count: times.count }; }
            } catch (err) {
                out.timesError = err && err.message ? err.message : String(err);
            }
        }
        return out;
    }

    // En källa i samma form som "Kör i appen" i Queries använder: { name, size, key, read() -> { bytes, lines } }.
    // lead: rader som ska stå först, t.ex. vilken zip det gäller.
    function zipSource(read, entry, lead) {
        return {
            name: baseName(entry.name),
            size: entry.size,
            // Samma post i samma zip, så att Queries inte läser om en databas som redan är inläst.
            key: (lead || []).join('|') + '|' + entry.localOffset + '|' + entry.name,
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

    // crypto.subtle nekar mer än 2 GB. Större filer räknas i JavaScript, bit för bit, utan att sidan
    // står still. opts.subtleMax kan bytas ut i testerna.
    var SUBTLE_MAX = 2000000000;
    var HASH_PIECE = 64 * 1024 * 1024;
    async function sha256(bytes, opts) {
        var c = root.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
        if (!c || !c.subtle) return '';
        if (bytes.length > (opts && opts.subtleMax || SUBTLE_MAX)) {
            var hasher = dep('ToolboxHashing').createHasher('sha256');
            for (var at = 0; at < bytes.length; at += HASH_PIECE) {
                hasher.update(bytes.subarray(at, at + HASH_PIECE));
                await dep('ZipRead').pause();
            }
            return hasher.digestHex();
        }
        var digest = await c.subtle.digest('SHA-256', bytes);
        return Array.prototype.map.call(new Uint8Array(digest), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    }

    // Lämnar arrayen till sql.js utan kopia: sql.js tar in filen med slice() och läser den med
    // subarray(). Arrayen tillhör databasen efteråt, och den som lämnat den ska inte använda den mer.
    function noCopy(bytes) {
        return {
            length: bytes.length,
            subarray: function (from, to) { return bytes.subarray(from, to); },
            slice: function () { return bytes; },
        };
    }

    // Läser databasen och dess -wal ur zippen, kontrollerar CRC32, räknar SHA-256 på båda och
    // lägger WAL-ramarna på en kopia i minnet. hit är en träff från locate(): { db, wal, journal }.
    // opts.cipher: { profile, passphrase, source } för en SQLCipher-krypterad databas (Signal):
    // sidorna och WAL-ramarna dekrypteras då i minnet. Är databasen krypterad utan nyckel kastas
    // ett fel med code 'ENCRYPTED'. opts.onProgress(sidor, alla) under dekrypteringen.
    // Returnerar { bytes, stats, hashes: { db, wal }, lines, warnings, dbEntry, walEntry }.
    async function loadDatabase(read, hit, lead, opts) {
        try { return await readDatabase(read, hit, lead, opts || {}); }
        catch (err) { throw dep('ZipRead').friendlyMemory(err, baseName(hit.db.name), hit.db.size); }
    }

    async function readDatabase(read, hit, lead, opts) {
        var dbRead = await readEntry(read, hit.db);
        var walRead = hit.wal ? await readEntry(read, hit.wal) : null;
        var hashes = { db: await sha256(dbRead.bytes), wal: walRead ? await sha256(walRead.bytes) : '' };
        var walBytes = walRead ? walRead.bytes : new Uint8Array(0);
        // En SQLCipher-fil med okrypterat huvud (Signal på iOS) börjar som SQLite; SqlCipher känner igen den.
        var sc = deps.SqlCipher || root.SqlCipher;
        var encrypted = dbRead.bytes.length >= 16 && (sc ? sc.isEncrypted(dbRead.bytes, opts.cipher && opts.cipher.profile) : !isPlainSqlite(dbRead.bytes));
        var merged;
        if (encrypted && opts.cipher && opts.cipher.passphrase) {
            merged = await dep('SqlCipher').openAsync(dbRead.bytes, walBytes, opts.cipher.passphrase, opts.cipher.profile, dep('SqliteWal'), { onProgress: opts.onProgress });
        } else if (encrypted && opts.cipher) {
            var err = new Error(baseName(hit.db.name) + ' är krypterad (SQLCipher), och ingen nyckel hittades: extraktionen saknar ' + (opts.cipher.hint || 'nyckelfilen') + '. Klistra in nyckeln för att läsa databasen.');
            err.code = 'ENCRYPTED';
            throw err;
        } else {
            merged = dep('SqliteWal').apply(dbRead.bytes, walBytes, { owned: true });
        }
        var warnings = [];
        // En -wal som inte går att lägga på (trasigt huvud, fel sidstorlek) hoppar SQLite över. Här
        // läses databasen likadant utan den, och varningen säger det.
        if (walRead && merged.stats.error) warnings.push(baseName(hit.wal.name) + ' lades inte på: ' + merged.stats.error + '. ' + baseName(hit.db.name) + ' lästes utan -wal, som SQLite gör med en sådan fil. Poster som bara finns i -wal saknas.');
        if (!walRead) warnings.push(baseName(hit.db.name) + ' lästes utan -wal: ' + (hit.db.report ? 'rapporten har ingen, men den kan ha funnits på telefonen.' : 'extraktionen har ingen.') + ' Poster som bara fanns i -wal kan saknas.');
        if (hit.journal && hit.journal.size) warnings.push(baseName(hit.db.name) + ' har en -journal: databasen kan vara mitt i en transaktion.');
        if (!dbRead.crcOk) warnings.push('CRC32 för ' + baseName(hit.db.name) + ' stämmer inte med ' + sourceWord(hit.db) + '.');
        if (walRead && !walRead.crcOk) warnings.push('CRC32 för ' + baseName(hit.wal.name) + ' stämmer inte med ' + sourceWord(hit.wal) + '.');
        if (reportHashOk(hit.db, hashes.db) === false) warnings.push('SHA-256 för ' + baseName(hit.db.name) + ' stämmer inte med report.xml.');
        if (walRead && reportHashOk(hit.wal, hashes.wal) === false) warnings.push('SHA-256 för ' + baseName(hit.wal.name) + ' stämmer inte med report.xml.');
        var lines = (lead || []).concat([dbRead.line]).concat(walRead ? [walRead.line] : []);
        if (hashes.db) lines.push('SHA-256 ' + baseName(hit.db.name) + ': ' + hashes.db);
        if (hashes.wal) lines.push('SHA-256 ' + baseName(hit.wal.name) + ': ' + hashes.wal);
        if (merged.stats.cipher) {
            lines.push(dep('SqlCipher').summary(merged.stats, opts.cipher.source));
            var bad = merged.stats.cipher.badHmac + merged.stats.cipher.walBadHmac;
            if (bad) warnings.push(baseName(hit.db.name) + ': kontrollsumman (HMAC) stämde inte för ' + bad + ' sidor efter dekrypteringen. De sidorna kan vara skadade.');
        }
        return {
            bytes: merged.bytes, stats: merged.stats, hashes: hashes, lines: lines, warnings: warnings,
            dbEntry: hit.db, walEntry: hit.wal || null, crcOk: dbRead.crcOk && (!walRead || walRead.crcOk),
        };
    }

    // Samma text som Queries visar om WAL-ramarna.
    function walSummary(loaded) {
        if (!loaded.walEntry) return 'Utan -wal.';
        var s = loaded.stats;
        if (s.error) return '-wal lades inte på: ' + s.error + '. Databasen lästes utan den, som SQLite gör.';
        if (s.empty) return '-wal är tom (0 byte), så det fanns inga ramar att lägga på.';
        var text = '-wal: ' + s.appliedFrames + ' av ' + s.walFrames + ' ramar lades på (' + s.commits + ' commit, ' + s.pages + ' sidor).';
        if (s.uncommittedFrames) text += ' ' + s.uncommittedFrames + ' ramar hörde till en transaktion som aldrig blev klar och lades inte på.';
        if (s.oldFrames) text += ' ' + s.oldFrames + ' ramar är kvar från en äldre omgång av -wal och lades inte på.';
        if (s.brokenFrames) text += ' ' + s.brokenFrames + ' ramar från och med en trasig ram lades inte på.';
        return text;
    }

    var api = {
        use: function (d) { Object.keys(d).forEach(function (k) { deps[k] = d[k]; }); },
        targets: targets, dbForVersion: dbForVersion, open: open, openSource: openSource, find: find, sourceWord: sourceWord, reportHashOk: reportHashOk,
        readEntry: readEntry, zipSource: zipSource, loadDatabase: loadDatabase, walSummary: walSummary, entryTimes: entryTimes,
        sha256: sha256, noCopy: noCopy, entryTime: entryTime, hex: hex, sizeText: sizeText, baseName: baseName,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ExtractionCore = api;
})(typeof window !== 'undefined' ? window : this);
