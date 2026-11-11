// Delad läsning av en extraktion (zip eller UFDR): hitta katalogernas databaser, läsa iOS-versionen,
// läsa ut databas och -wal till minnet med CRC-kontroll och lägga på WAL-ramarna. Används
// av Queries (extraction.js) och Härkomst. Filen nås bara via read(offset, length), som i
// appen är File.slice(). Inget skrivs någonsin. Testas i Node.
(function (root) {
    'use strict';

    // ZipRead, ZipLocate, UfdrRead, FsTimes, SqliteWal, AppSecrets och DbShare är globala i webbläsaren. I Node skickas de in med use().
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

    // Raden om en post: var den kom ifrån, och om CRC32 stämde mot zippen när den lästes. I en rapport står
    // telefonens sökväg först och rapportens egen post efter.
    function entryLine(entry, crcOk) {
        var where = entry.report ? (entry.report.member ? 'posten ' + entry.report.member + ', ' : 'tom fil utan post i rapporten, ') : '';
        var line = 'Ur ' + sourceWord(entry) + ': ' + entry.name + ' (' + where + entry.size + ' byte, ändrad ' + entryTime(entry) +
            ', CRC32 ' + hex(entry.crc32) + (crcOk ? ' stämmer' : ' STÄMMER INTE') + ')';
        if (!crcOk) line += '. Varning: innehållet skiljer sig från det ' + sourceWord(entry) + ' anger.';
        return line;
    }

    // Läser ut en post och beskriver var den kom ifrån, med CRC32 kontrollerad mot zippen.
    async function readEntry(read, entry) {
        var out = await dep('ZipRead').extract(read, entry);
        return { bytes: out.bytes, crcOk: out.crcOk, line: entryLine(entry, out.crcOk) };
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
    // lead: rader som ska stå först, t.ex. vilken zip det gäller. entry, lead och zipRead följer med, så att
    // databasen och dess -wal kan läsas med loadDatabase.
    function zipSource(read, entry, lead) {
        return {
            name: baseName(entry.name),
            path: entry.name,
            size: entry.size,
            // Samma post i samma zip, så att Queries inte läser om en databas som redan är inläst.
            key: (lead || []).join('|') + '|' + entry.localOffset + '|' + entry.name,
            entry: entry,
            lead: lead || [],
            zipRead: read,
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

    // En nyckelfil, efter innehållet. Är den en zip (…_android_keystore.zip) packas den upp i minnet och nyckelfilen i
    // den tolkas. Hur nyckeln känns igen står i AppSecrets.
    async function readKeyFile(bytes, name) {
        var Secrets = dep('AppSecrets');
        bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4)) return Secrets.readKeyBytes(bytes, name);
        var read = async function (offset, length) { return bytes.subarray(offset, offset + length); };
        var inside = await find(read, bytes.length, Secrets.isKeyFileName);
        if (!inside.length) return { source: name, apps: {}, error: 'Zippen innehåller ingen nyckelfil.' };
        return Secrets.readKeyBytes((await readEntry(read, inside[0])).bytes, name);
    }

    // Nyckelfiler bredvid en vald fil. Extraktionskoden når aldrig huvudprocessen, så frågan går till huvudfönstret,
    // som svarar med filerna i skrivbordsappen och null i en webbläsare. Utan huvudfönster, eller utan svar, null.
    var HUB_WAIT_MS = 30000;
    function besideFromHub(file) {
        var host = root.parent;
        if (!file || !host || host === root || !root.addEventListener) return null;
        return function () {
            return new Promise(function (resolve) {
                var id = 'keys-' + Date.now() + '-' + Math.random();
                var timer = setTimeout(function () { done(null); }, HUB_WAIT_MS);
                function done(found) {
                    clearTimeout(timer);
                    root.removeEventListener('message', onReply);
                    resolve(found);
                }
                function onReply(event) {
                    var d = event.data;
                    if (event.source === host && d && d.source === 'forensics-toolbox' && d.type === 'keys-beside-result' && d.id === id) done(d.found || null);
                }
                root.addEventListener('message', onReply);
                host.postMessage({ source: 'forensics-toolbox', type: 'keys-beside', id: id, file: file }, '*');
            });
        };
    }

    // En nyckelring är några MB. Större än så är inte en nyckelfil, oavsett vad den heter, och den läses inte in.
    var MAX_KEY_FILE = 64 * 1024 * 1024;

    // Nycklarna som hör till extraktionen, utan att undersökaren gör något: nyckelfiler under extra/ i zippen,
    // nyckelfilerna i en rapport och, när inget av det hade Signals nyckel, nyckelfiler bredvid zippen. En fil som
    // inte går att läsa stoppar inte de andra, och felet följer med. opts: { report, file, beside } (beside byts ut i testerna).
    // -> { secrets, lookedBeside, other }. other: nyckelfiler bredvid zippen som inte kan knytas till den.
    async function findKeys(read, size, opts) {
        opts = opts || {};
        var Secrets = dep('AppSecrets');
        var out = { secrets: [], lookedBeside: false, other: [] };
        async function add(load, source) {
            try { out.secrets.push(await readKeyFile(await load(), source)); }
            catch (err) { out.secrets.push({ source: source, apps: {}, error: 'Filen kunde inte läsas: ' + (err && err.message ? err.message : err) }); }
        }
        function ofEntry(entry) { return function () { return readEntry(read, entry).then(function (r) { return r.bytes; }); }; }
        var inside = await find(read, size, Secrets.isExtraKeyPath);
        for (var i = 0; i < inside.length; i++) {
            if (inside[i].size > MAX_KEY_FILE) out.secrets.push({ source: inside[i].name + ' i zippen', apps: {}, error: 'Filen är för stor för att vara en nyckelfil (' + sizeText(inside[i].size) + ').' });
            else await add(ofEntry(inside[i]), inside[i].name + ' i zippen');
        }
        var kept = opts.report ? opts.report.keychains : [];
        for (var k = 0; k < kept.length; k++) await add(ofEntry(kept[k]), baseName(kept[k].name) + ' i rapporten');
        var beside = opts.beside || besideFromHub(opts.file);
        if (!beside || Secrets.hasSignalKey(out.secrets)) return out;
        var near = null;
        try { near = await beside(); } catch (err) { console.warn('Mappen bredvid extraktionen kunde inte läsas', err); }
        if (!near) return out;
        out.lookedBeside = true;
        out.other = near.other || [];
        var word = opts.report ? 'rapporten' : 'zippen';
        var files = near.files || [];
        for (var f = 0; f < files.length; f++) await add((function (b) { return function () { return b; }; })(files[f].bytes), files[f].name + ' bredvid ' + word);
        return out;
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
    // ett fel med code 'ENCRYPTED'.
    // opts.share: { file } låter verktygen dela på läsningen (se sharedCore). file är extraktionens fil.
    // opts.onStage(skede, andel, verktyg, dess skede): vad som händer, se stageText.
    // opts.onProgress(sidor, alla) under dekrypteringen.
    // Returnerar { bytes, stats, hashes: { db, wal }, lines, warnings, dbEntry, walEntry, crcOk, dbCrcOk, walCrcOk,
    // sharedBy, sharedLine, cipherLine }.
    async function loadDatabase(read, hit, lead, opts) {
        opts = opts || {};
        try { return describe(await sharedCore(read, hit, opts), hit, lead, opts); }
        catch (err) { throw dep('ZipRead').friendlyMemory(err, baseName(hit.db.name), hit.db.size); }
    }

    // Själva läsningen: databasen och -wal ur extraktionen, CRC32, SHA-256, dekrypteringen och WAL-ramarna.
    // Ger avbilden och det som räknades, utan texter. Texterna skrivs av verktyget som visar dem (describe),
    // så en avbild som delas mellan verktygen har samma uppgifter hos alla.
    // -> { bytes, stats, hashes: { db, wal }, dbCrcOk, walCrcOk (null utan -wal), encrypted, readAt, readBy }
    async function readCore(read, hit, opts) {
        var stage = opts.onStage || function () {};
        stage('read', null);
        var dbRead = await dep('ZipRead').extract(read, hit.db);
        var walRead = hit.wal ? await dep('ZipRead').extract(read, hit.wal) : null;
        stage('hash', null);
        var hashes = { db: await sha256(dbRead.bytes), wal: walRead ? await sha256(walRead.bytes) : '' };
        var walBytes = walRead ? walRead.bytes : new Uint8Array(0);
        // En SQLCipher-fil med okrypterat huvud (Signal på iOS) börjar som SQLite; SqlCipher känner igen den.
        var sc = deps.SqlCipher || root.SqlCipher;
        var encrypted = dbRead.bytes.length >= 16 && (sc ? sc.isEncrypted(dbRead.bytes, opts.cipher && opts.cipher.profile) : !isPlainSqlite(dbRead.bytes));
        var merged;
        if (encrypted && opts.cipher && opts.cipher.passphrase) {
            stage('decrypt', 0);
            merged = await dep('SqlCipher').openAsync(dbRead.bytes, walBytes, opts.cipher.passphrase, opts.cipher.profile, dep('SqliteWal'), {
                onProgress: function (done, total, how) {
                    if (opts.onProgress) opts.onProgress(done, total, how);
                    stage(how && how.slow ? 'decrypt-slow' : 'decrypt', total ? done / total : null);
                },
            });
        } else if (encrypted && opts.cipher) {
            var err = new Error(baseName(hit.db.name) + ' är krypterad (SQLCipher), och ingen nyckel hittades: extraktionen saknar ' + (opts.cipher.hint || 'nyckelfilen') + '. Klistra in nyckeln för att läsa databasen.');
            err.code = 'ENCRYPTED';
            throw err;
        } else {
            if (walRead && walRead.bytes.length) stage('wal', null);
            merged = dep('SqliteWal').apply(dbRead.bytes, walBytes, { owned: true });
        }
        return {
            bytes: merged.bytes, stats: merged.stats, hashes: hashes, dbCrcOk: dbRead.crcOk, walCrcOk: walRead ? walRead.crcOk : null,
            encrypted: encrypted, readAt: Date.now(), readBy: '',
        };
    }

    // Vilken dekryptering en delad avbild gäller: profilen och en SHA-256 över nyckeln, aldrig nyckeln själv.
    // Tom för en databas som läses utan nyckel. null när summan inte går att räkna: då delas databasen inte.
    async function cipherTag(cipher) {
        if (!cipher || !cipher.passphrase) return '';
        var profile = String(cipher.profile || '');
        var sum = typeof TextEncoder === 'undefined' ? '' : await sha256(new TextEncoder().encode(profile + '\u0000' + String(cipher.passphrase)));
        return sum ? profile + ':' + sum : null;
    }

    // Uppgifterna om läsningen som följer med en avbild till nästa verktyg.
    function factsOf(core) {
        return { stats: core.stats, hashes: core.hashes, dbCrcOk: core.dbCrcOk, walCrcOk: core.walCrcOk, encrypted: core.encrypted, readAt: core.readAt, readBy: core.readBy || '' };
    }

    // En avbild från ett annat verktyg används bara om den är läsbar som den är här: en okrypterad
    // SQLite-fil med uppgifterna om läsningen. Annars läser verktyget databasen själv.
    function usable(got, opts) {
        if (!got.bytes || got.bytes.length < 100 || !got.stats || !got.hashes || typeof got.dbCrcOk !== 'boolean') return false;
        var sc = deps.SqlCipher || root.SqlCipher;
        return isPlainSqlite(got.bytes) && !(sc && sc.isEncrypted(got.bytes, opts.cipher && opts.cipher.profile));
    }

    // Läsningen genom delningen mellan verktygen (tools/_shared/db-share.js). Har ett annat verktyg redan läst
    // samma databas ur samma fil, med samma nyckel, kommer en kopia av dess avbild därifrån: ingen ny läsning,
    // kontroll eller dekryptering. Läser ett annat verktyg just nu in den, väntar det här på det i stället för
    // att läsa samma fil samtidigt. Utan huvudfönster, och för ett verktyg som öppnats för sig, är det readCore.
    async function sharedCore(read, hit, opts) {
        var Share = deps.DbShare || root.DbShare;
        // opts.share.client byts ut i testerna, där flera verktyg delar på en process.
        var client = opts.share && opts.share.file && Share ? opts.share.client || Share.client : null;
        var tag = client ? await cipherTag(opts.cipher) : null;
        var key = tag === null ? '' : Share.keyOf(opts.share.file, hit.db, hit.wal, tag);
        if (!key) return readCore(read, hit, opts);
        var stage = opts.onStage || function () {};
        var got = await client.want(key, function (w) { stage(w.why === 'copy' ? 'copy' : 'wait', w.frac, w.by, w.stage); });
        if (got && usable(got, opts)) {
            client.have(key, got.bytes, factsOf(got));
            return got;
        }
        var core;
        // De som väntar på den här läsningen får veta var den är, när skedet eller procenten har ändrats: en
        // stor databas dekrypteras i över tusen omgångar, och ett meddelande för var och en säger inget nytt.
        var told = '';
        function tell(name, frac) {
            var now = name + (typeof frac === 'number' ? ' ' + Math.round(100 * frac) : '');
            if (now !== told) { told = now; client.progress(key, name, frac); }
            stage(name, frac);
        }
        try {
            core = await readCore(read, hit, Object.assign({}, opts, { onStage: tell }));
        } catch (err) {
            client.failed(key);
            throw err;
        }
        // En databas som lästes utan nyckel och ändå är krypterad är ingenting att dela.
        if (core.encrypted && !core.stats.cipher) client.failed(key);
        else client.have(key, core.bytes, factsOf(core));
        return core;
    }

    // Vad som händer medan en databas läses, som text. label är vad verktyget kallar databasen; utan den
    // blir det en kort text med liten bokstav, för en rad som redan säger vilken databas det gäller.
    // by och inner: verktyget som läser in databasen åt det här, och skedet det är i.
    function stageText(stage, frac, by, label, inner) {
        var pct = typeof frac === 'number' ? ' ' + Math.round(100 * frac) + ' %' : '';
        var of = label ? ' ' + label : '';
        var text;
        if (stage === 'wait') {
            var doing = inner && inner !== 'wait' && inner !== 'copy' ? stageText(inner, frac) : '';
            text = 'väntar på ' + (label || 'databasen') + ', som ' + by + ' redan läser in' + (doing ? ' (' + doing + ')' : '…');
        } else if (stage === 'copy') text = 'hämtar ' + (label || 'databasen') + ' från ' + by + ', som redan har läst den…';
        else if (stage === 'hash') text = 'räknar SHA-256' + (label ? ' för ' + label : '') + '…';
        else if (stage === 'decrypt') text = 'dekrypterar' + of + '…' + pct;
        else if (stage === 'decrypt-slow') text = 'dekrypterar' + of + ' utan webbläsarens inbyggda kryptering, så det går långsammare…' + pct;
        else if (stage === 'wal') text = 'lägger på -wal' + (label ? ' för ' + label : '') + '…';
        else text = 'läser' + (of || ' filen') + '…';
        return label ? text.charAt(0).toUpperCase() + text.slice(1) : text;
    }

    function utcText(ms) { return new Date(ms).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'; }

    // Det verktyget visar om en läsning: raderna till protokollet och varningarna. core kan komma från ett annat
    // verktygs läsning; posterna, raderna före och nyckelns källa är verktygets egna.
    function describe(core, hit, lead, opts) {
        var dbName = baseName(hit.db.name);
        var walName = hit.wal ? baseName(hit.wal.name) : '';
        var warnings = [];
        // En -wal som inte går att lägga på (trasigt huvud, fel sidstorlek) hoppar SQLite över. Här
        // läses databasen likadant utan den, och varningen säger det.
        if (hit.wal && core.stats.error) warnings.push(walName + ' lades inte på: ' + core.stats.error + '. ' + dbName + ' lästes utan -wal, som SQLite gör med en sådan fil. Poster som bara finns i -wal saknas.');
        if (!hit.wal) warnings.push(dbName + ' lästes utan -wal: ' + (hit.db.report ? 'rapporten har ingen, men den kan ha funnits på telefonen.' : 'extraktionen har ingen.') + ' Poster som bara fanns i -wal kan saknas.');
        if (hit.journal && hit.journal.size) warnings.push(dbName + ' har en -journal: databasen kan vara mitt i en transaktion.');
        if (!core.dbCrcOk) warnings.push('CRC32 för ' + dbName + ' stämmer inte med ' + sourceWord(hit.db) + '.');
        if (hit.wal && !core.walCrcOk) warnings.push('CRC32 för ' + walName + ' stämmer inte med ' + sourceWord(hit.wal) + '.');
        if (reportHashOk(hit.db, core.hashes.db) === false) warnings.push('SHA-256 för ' + dbName + ' stämmer inte med report.xml.');
        if (hit.wal && reportHashOk(hit.wal, core.hashes.wal) === false) warnings.push('SHA-256 för ' + walName + ' stämmer inte med report.xml.');
        var lines = (lead || []).concat([entryLine(hit.db, core.dbCrcOk)]).concat(hit.wal ? [entryLine(hit.wal, core.walCrcOk)] : []);
        if (core.hashes.db) lines.push('SHA-256 ' + dbName + ': ' + core.hashes.db);
        if (core.hashes.wal) lines.push('SHA-256 ' + walName + ': ' + core.hashes.wal);
        var cipherLine = '';
        if (core.stats.cipher) {
            cipherLine = dep('SqlCipher').summary(core.stats, opts.cipher && opts.cipher.source);
            lines.push(cipherLine);
            var bad = core.stats.cipher.badHmac + core.stats.cipher.walBadHmac;
            if (bad) warnings.push(dbName + ': kontrollsumman (HMAC) stämde inte för ' + bad + ' sidor efter dekrypteringen. De sidorna kan vara skadade.');
        }
        // Läst av ett annat verktyg: det ska synas i protokollet, med när kontrollerna gjordes.
        var sharedLine = '';
        if (core.readBy) {
            sharedLine = 'Läst ur ' + sourceWord(hit.db) + ' av ' + core.readBy + ' ' + utcText(core.readAt) + '. Verktygen delar på läsningen: här används en kopia av avbilden i minnet, och CRC32' +
                (core.hashes.db ? (core.stats.cipher ? ', SHA-256 och dekrypteringen' : ' och SHA-256') : (core.stats.cipher ? ' och dekrypteringen' : '')) + ' ovan är från den läsningen.';
            lines.push(sharedLine);
        }
        return {
            bytes: core.bytes, stats: core.stats, hashes: core.hashes, lines: lines, warnings: warnings,
            dbEntry: hit.db, walEntry: hit.wal || null, crcOk: core.dbCrcOk && (!hit.wal || !!core.walCrcOk),
            dbCrcOk: core.dbCrcOk, walCrcOk: core.walCrcOk,
            sharedBy: core.readBy || '', sharedLine: sharedLine, cipherLine: cipherLine,
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
        targets: targets, dbForVersion: dbForVersion, open: open, openSource: openSource, find: find, findKeys: findKeys, readKeyFile: readKeyFile, sourceWord: sourceWord, reportHashOk: reportHashOk,
        readEntry: readEntry, entryLine: entryLine, zipSource: zipSource, loadDatabase: loadDatabase, stageText: stageText, walSummary: walSummary, entryTimes: entryTimes,
        sha256: sha256, noCopy: noCopy, entryTime: entryTime, hex: hex, sizeText: sizeText, baseName: baseName,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ExtractionCore = api;
})(typeof window !== 'undefined' ? window : this);
