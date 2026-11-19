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

    // Telefonens användare ur data/system/users/: userlist.xml (vilka som finns och nästa serienummer), <id>.xml (typ,
    // skapad, senast inloggad och framme) och Samsungs persona_cache.xml (anteckningar om borttagna användare). Filerna är
    // ABX (Android 12 och senare) eller text-XML. Undermapparna (0/ med inställningar och bakgrundsbilder) läses inte.
    function xmlElements(bytes) {
        var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        var out = [];
        if (b.length >= 4 && b[0] === 0x41 && b[1] === 0x42 && b[2] === 0x58 && b[3] === 0) {
            (function walk(el) { if (el.name !== '#doc') out.push({ name: el.name, attrs: el.attrs }); el.children.forEach(walk); })(androidLogs().abxParse(b));
            return out;
        }
        var text = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8').decode(b) : Buffer.from(b).toString('utf8');
        var ent = function (v) { return v.replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(Number(n)); }).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); };
        var tag = /<([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"]*")*)\s*\/?>/g, m;
        while ((m = tag.exec(text))) {
            var attrs = {}, a, at = /([\w.:-]+)\s*=\s*"([^"]*)"/g;
            while ((a = at.exec(m[2]))) attrs[a[1]] = ent(a[2]);
            out.push({ name: m[1], attrs: attrs });
        }
        return out;
    }
    var USER_TYPES = {
        'android.os.usertype.full.SYSTEM': 'telefonens ägare', 'android.os.usertype.full.SECONDARY': 'annan användare',
        'android.os.usertype.full.GUEST': 'gäst', 'android.os.usertype.profile.MANAGED': 'arbetsprofil',
        'android.os.usertype.profile.CLONE': 'klon av appar', 'android.os.usertype.profile.PRIVATE': 'privat utrymme',
    };
    // Samsung ger Secure Folder id 150 och Dual Messenger id 95 (inte kontrollerat i ett labb).
    function userKind(id, type) {
        var t = String(type || '');
        if (/securefolder|secure_folder/i.test(t) || (id >= 150 && id <= 160)) return 'Secure Folder (Samsung)';
        if (/dual/i.test(t) || id === 95) return 'Dual Messenger (Samsung)';
        if (id === 0) return 'telefonens ägare';
        return USER_TYPES[t] || (t ? t : 'okänd');
    }
    function msText(v) { var n = Number(v); return v != null && v !== '' && isFinite(n) && n > 0 ? utcText(n) : null; }
    function intOrNull(v) { var n = Number(v); return v != null && v !== '' && isFinite(n) ? n : null; }

    KINDS['android-users'] = {
        table: 'anvandare',
        own: true,
        columns: [
            ['rad', 'TEXT'], ['anvandar_id', 'INTEGER'], ['slag', 'TEXT'], ['typ', 'TEXT'], ['namn', 'TEXT'], ['skapad_utc', 'TEXT'], ['skapad_ms', 'INTEGER'],
            ['senast_inloggad_utc', 'TEXT'], ['senast_framme_utc', 'TEXT'], ['serienummer', 'INTEGER'], ['flaggor', 'INTEGER'], ['tid', 'TEXT'], ['text', 'TEXT'], ['fil', 'TEXT'],
        ],
        read: function (files) {
            var top = (files || []).filter(function (f) { return /\/users\/[^/]+$/.test(String(f.name).replace(/\\/g, '/')); });
            var byBase = {};
            top.forEach(function (f) { byBase[baseName(f.name)] = f; });
            var rows = [], ids = {}, listed = false, created = null;
            var list = byBase['userlist.xml'];
            if (list) {
                listed = true;
                xmlElements(list.bytes).forEach(function (el) {
                    if (el.name === 'users' && el.attrs.nextSerialNumber != null) {
                        var next = intOrNull(el.attrs.nextSerialNumber);
                        created = next != null ? Math.max(0, next - 10) : null;
                        rows.push(['nästa serienummer', null, null, null, null, null, null, null, null, next, null, null,
                            'nextSerialNumber ' + next + (created ? ': ' + created + ' användare har skapats sedan telefonen sattes upp (numren börjar på 10), också sådana som tagits bort.' : ': inga användare har skapats utöver telefonens ägare.'), 'userlist.xml']);
                    }
                    if (el.name === 'user' && el.attrs.id != null) ids[Number(el.attrs.id)] = true;
                });
            }
            Object.keys(byBase).filter(function (n) { return /^\d+\.xml$/.test(n); }).sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); }).forEach(function (n) {
                var u = xmlElements(byBase[n].bytes).filter(function (el) { return el.name === 'user'; })[0];
                if (!u) return;
                var id = intOrNull(u.attrs.id != null ? u.attrs.id : parseInt(n, 10));
                var note = listed && !ids[id] ? 'Står inte i userlist.xml.' : null;
                if (u.attrs.partial === true || u.attrs.partial === 'true') note = (note ? note + ' ' : '') + 'Halvt skapad (partial).';
                rows.push(['användare', id, userKind(id, u.attrs.type), u.attrs.type || null, u.attrs.name || null, msText(u.attrs.created), intOrNull(u.attrs.created) || null,
                    msText(u.attrs.lastLoggedIn), msText(u.attrs.lastEnteredForeground), intOrNull(u.attrs.serialNumber), intOrNull(u.attrs.flags), null, note, n]);
                delete ids[id];
            });
            // Användare i listan utan egen fil.
            Object.keys(ids).forEach(function (id) {
                rows.push(['användare', Number(id), userKind(Number(id), ''), null, null, null, null, null, null, null, null, null, 'Står i userlist.xml, men ' + id + '.xml saknas.', 'userlist.xml']);
            });
            var persona = byBase['persona_cache.xml'];
            if (persona) {
                xmlElements(persona.bytes).forEach(function (el) {
                    if (el.name !== 'cache') return;
                    Object.keys(el.attrs).filter(function (k) { return /REMOVED/i.test(k); }).forEach(function (k) {
                        var v = String(el.attrs[k]);
                        var lines = v.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l && !/^=+$/.test(l); });
                        var when = /^(\d{4})\.(\d\d)\.(\d\d)\.(\d\d)\.(\d\d)\.(\d\d)$/.exec(lines[0] || '');
                        var who = /user(?:Id|_id)?\s*[=: ]\s*(\d+)/i.exec(v);
                        rows.push(['borttagen enligt persona_cache', who ? Number(who[1]) : null, null, null, null, null, null, null, null, null, null,
                            when ? when[1] + '-' + when[2] + '-' + when[3] + ' ' + when[4] + ':' + when[5] + ':' + when[6] + ' (telefonens tid)' : null,
                            k + ': ' + lines.slice(when ? 1 : 0, when ? 2 : 1).join(' ') + (lines.length > 2 ? ' …' : ''), 'persona_cache.xml']);
                    });
                });
            }
            var users = rows.filter(function (r) { return r[0] === 'användare'; });
            var secure = users.some(function (r) { return /Secure Folder/.test(r[2]); });
            return { rows: rows, summary: plural(users.length, 'användare', 'användare') + (secure ? ', bland dem Secure Folder' : '') + (created ? ', ' + created + ' skapade enligt serienumret' : '') };
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
                line: Array.isArray(bytes) ? (name || 'Mappen') + ': ' + read.summary + ' lästes in i tabellen ' + k.table + ' i minnet' + (k.own ? '' : ', med samma tolkning som i Härkomst') + '. Filerna ändrades inte.'
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
