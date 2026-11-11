// Chattar läser konversationer ur chattappars databaser med de dolda chattrollerna i query-katalogerna
// (chat-threads, chat-members, chat-messages, chat-attachments). Här görs raderna om till konversationer,
// meddelanden och bilagor, tiderna skrivs i vald zon och urvalet till en export väljs. Ingen SQL finns här.
// Testas i Node.
(function (root) {
    'use strict';

    var Roles = typeof module !== 'undefined' && module.exports ? require('../provenance/roles.js') : root.ProvenanceRoles;

    var ROLES = { threads: 'chat-threads', members: 'chat-members', messages: 'chat-messages', attachments: 'chat-attachments', names: 'chat-names' };
    var THREAD_KIND = { person: 'Enskild chatt', group: 'Grupp', status: 'Status', channel: 'Kanal', self: 'Till mig själv', other: 'Annan chatt' };
    var KIND_TEXT = {
        text: 'Text', image: 'Bild', video: 'Video', audio: 'Ljud', voice: 'Röstmeddelande', file: 'Fil', contact: 'Kontaktkort',
        location: 'Plats', sticker: 'Klistermärke', gif: 'GIF', call: 'Samtal', system: 'Systemmeddelande', deleted: 'Raderat', poll: 'Omröstning', other: 'Annat',
    };

    // Databaserna i katalogerna som har chattroller. catalogs: katalogobjekten (som WHATSAPP_IOS_CATALOG).
    function sources(catalogs) {
        var out = [];
        (catalogs || []).forEach(function (cat) {
            ((cat && cat.databases) || []).forEach(function (db) {
                var roles = {};
                Object.keys(ROLES).forEach(function (k) {
                    var q = (db.queries || []).find(function (x) { return x.hidden && x.role === ROLES[k]; });
                    if (q) roles[k] = q;
                });
                // En databas med bara chat-names ger namn åt chattarna i samma app (Snapchats kontodatabas).
                var namesOnly = !!roles.names && !roles.threads;
                if (!namesOnly && (!roles.threads || !roles.messages)) return;
                var m = /^(iOS|Android) — (.*)$/.exec(db.label || '');
                out.push({ namesOnly: namesOnly,
                    key: db.id, app: db.chatApp || (m ? m[2] : db.label), platform: m ? m[1] : '', title: m ? m[2] : db.label, label: db.label,
                    paths: db.paths || [], cipher: db.cipher || null, derive: db.derive || null, roles: roles,
                    catalogId: cat.id, paramLabels: cat.paramLabels || {},
                });
            });
        });
        return out;
    }

    // Databaserna i den form ExtractionCore.targets() vill ha.
    function databases(list) {
        return list.map(function (s) {
            return { id: s.key, family: s.key, familyTitle: s.title, label: s.title, paths: s.paths, ios: null, cipher: s.cipher, derive: s.derive };
        });
    }

    // ---------- Snapchat ----------

    // Fältet på vägen (fältnummer) i ett protobuf-meddelande, som bytes, eller null.
    function pbPath(bytes, path) {
        var b = bytes instanceof Uint8Array ? bytes : null;
        for (var depth = 0; b && depth < path.length; depth++) {
            var i = 0, found = null;
            while (i < b.length && !found) {
                var key = 0, shift = 0, c;
                do { c = b[i++]; key += (c & 0x7f) * Math.pow(2, shift); shift += 7; } while (c >= 0x80 && i < b.length);
                var field = Math.floor(key / 8), wire = key % 8;
                if (wire === 0) { do { c = b[i++]; } while (c >= 0x80 && i < b.length); }
                else if (wire === 1) i += 8;
                else if (wire === 5) i += 4;
                else if (wire === 2) {
                    var len = 0; shift = 0;
                    do { c = b[i++]; len += (c & 0x7f) * Math.pow(2, shift); shift += 7; } while (c >= 0x80 && i < b.length);
                    if (field === path[depth]) found = b.subarray(i, i + len);
                    i += len;
                } else return null;
            }
            b = found;
        }
        return b;
    }

    // Chattexten i Snapchats message_content: fältet 4.4.2.1 (kontrollerat mot labbtelefonerna på iOS och Android).
    function snapText(bytes) {
        var t = pbPath(bytes, [4, 4, 2, 1]);
        if (!t || !t.length) return '';
        try { return new TextDecoder('utf-8', { fatal: true }).decode(t); } catch (e) { return ''; }
    }

    // Id:n jämförs utan bindestreck och stora bokstäver, så att ett uuid i text och i hex blir samma.
    function idKey(v) { return String(v === null || v === undefined ? '' : v).toLowerCase().replace(/-/g, ''); }

    // Namnen ur en roll chat-names: { id: { name, username } }. decodeP: läser p när rollen har nameFrom.
    function names(src, result, decodeP) {
        var out = {};
        var q = src.roles.names;
        Roles.mapRows(q, result, []).forEach(function (r) {
            var n = { name: text(r.name), username: text(r.username) };
            if (q.nameFrom && decodeP && r.p !== undefined && r.p !== null) {
                var d = decodeP(r.p) || {};
                n.name = n.name || text(d.displayName);
                n.username = n.username || text(d.username);
            }
            if (!n.name && !n.username) return;
            out[idKey(r.id)] = n;
        });
        return out;
    }

    function nameText(n) { return n ? n.name ? n.name + (n.username ? ' (@' + n.username + ')' : '') : '@' + n.username : ''; }

    // Namnen läggs på deltagare, avsändare och konversationer som rollen säger ska få namn ur deltagarna.
    function applyNames(src, list, people, map) {
        if (!map || !Object.keys(map).length) return;
        Object.keys(people).forEach(function (k) {
            people[k].forEach(function (p) {
                var n = map[idKey(p.id)];
                if (n && (p.name === p.id || !p.name)) { p.name = nameText(n); p.named = true; }
            });
        });
        if (src.roles.threads.nameFromMembers) {
            list.forEach(function (t) {
                var who = (people[t.key] || []).map(function (p) { return p.name; });
                if (who.length) t.name = who.join(', ');
            });
        }
    }

    function num(v) { return v === null || v === undefined || v === '' ? null : Number(v); }
    function flag(v) { return v !== null && v !== undefined && v !== '' && Number(v) !== 0; }
    function text(v) { return v === null || v === undefined ? '' : String(v); }

    function threads(src, result) {
        return Roles.mapRows(src.roles.threads, result, ['first', 'last']).map(function (r) {
            var kind = THREAD_KIND[r.kind] ? r.kind : 'other';
            return {
                id: r.id, key: String(r.id), name: text(r.name) || '#' + r.id, kind: kind, kindText: THREAD_KIND[kind], address: text(r.address),
                messages: num(r.messages), firstMs: r.firstMs, lastMs: r.lastMs, archived: flag(r.archived), removed: flag(r.removed), raw: r._raw,
            };
        });
    }

    // Deltagarna per chatt: { chattens id: [{ id, name, address, admin, active }] }.
    function members(src, result) {
        var out = {};
        if (!src.roles.members) return out;
        Roles.mapRows(src.roles.members, result, []).forEach(function (r) {
            var k = String(r.threadId);
            (out[k] = out[k] || []).push({ id: text(r.id), name: text(r.name) || text(r.id), address: text(r.address), admin: flag(r.admin), active: r.active === null || r.active === undefined ? null : flag(r.active), isMe: flag(r.isMe), note: text(r.note) });
        });
        return out;
    }

    // Tiderna i rollen chat-messages, i katalogens ordning: { key, label, note, col, epoch }.
    function timeSpecs(src) {
        var q = src.roles.messages;
        return (q.times || []).map(function (t) {
            var spec = Roles.fieldSpec(q, t.key);
            return { key: t.key, label: t.label, note: t.note, col: spec ? spec.col : null, epoch: spec ? spec.epoch : null };
        });
    }

    function hexOfBase64(b64) {
        var s = String(b64 || '');
        if (!/^[A-Za-z0-9+/]{43}=$/.test(s)) return null;
        var bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
        var out = '';
        for (var i = 0; i < bin.length; i++) out += ('0' + bin.charCodeAt(i).toString(16)).slice(-2);
        return out;
    }

    function mediaKind(mime, kind, a) {
        var m = String(mime || '').toLowerCase();
        if (a.card || a.cardName) return 'contact';
        if (a.lat !== null && a.lat !== undefined && a.lon !== null && a.lon !== undefined) return 'location';
        if (/^image\//.test(m)) return kind === 'sticker' ? 'sticker' : 'image';
        if (/^video\//.test(m)) return 'video';
        if (/^audio\//.test(m)) return kind === 'voice' ? 'voice' : 'audio';
        if (m) return 'file';
        return ['image', 'video', 'audio', 'voice', 'sticker', 'gif'].indexOf(kind) >= 0 ? kind : 'file';
    }

    // Sökvägen till en bilaga i extraktionen: rollens fileRoot räknas från databasens mapp.
    function resolvePath(dbPath, fileRoot, rel) {
        if (!rel) return null;
        var parts = String(dbPath || '').split('/');
        parts.pop();
        String(fileRoot || '.').split('/').forEach(function (p) { if (p === '..') parts.pop(); });
        String(rel).replace(/^\.?\//, '').split('/').forEach(function (p) {
            if (p === '..') parts.pop();
            else if (p && p !== '.') parts.push(p);
        });
        return parts.join('/');
    }

    // Konversationen: meddelandena i ordning med tider, detaljer och bilagor. dbPath: databasens sökväg i extraktionen.
    // opts: { names } ur chat-names, när appen har en sådan databas. Raderna sparas inte en gång till som de
    // är: varje tid har sitt råa värde i times, och klockans ruta och exporten visar dem därifrån.
    function conversation(src, thread, msgResult, attResult, memberList, dbPath, opts) {
        var specs = timeSpecs(src);
        var q = src.roles.messages;
        var sortKey = q.sortTime || (specs[0] && specs[0].key);
        var rows = Roles.mapRows(q, msgResult, specs.map(function (t) { return t.key; }), { raw: false });
        var att = {};
        var attQ = src.roles.attachments;
        var shaHex = /^[0-9a-f]{64}$/i;
        if (attQ && attResult) {
            Roles.mapRows(attQ, attResult, ['uploaded'], { raw: false }).forEach(function (r) {
                var a = {
                    id: r.id, messageId: r.messageId, path: r.path ? String(r.path) : null, thumbPath: r.thumbPath ? String(r.thumbPath) : null,
                    mime: text(r.mime), size: num(r.size), duration: num(r.duration), name: text(r.name), title: text(r.title),
                    width: num(r.width), height: num(r.height), cardName: text(r.cardName), card: text(r.card),
                    lat: num(r.lat), lon: num(r.lon), uploadedMs: r.uploadedMs || null,
                    key: r.key ? String(r.key) : null, random: r.random ? String(r.random) : null,
                    sha256: r.sha256 && shaHex.test(String(r.sha256)) ? String(r.sha256).toLowerCase() : hexOfBase64(r.sha256b64),
                };
                a.entry = resolvePath(dbPath, attQ.fileRoot, a.path);
                a.thumbEntry = resolvePath(dbPath, attQ.fileRoot, a.thumbPath);
                (att[String(r.messageId)] = att[String(r.messageId)] || []).push(a);
            });
        }
        if (q.textFrom === 'snapchat') rows.forEach(function (r) { if (!r.text && r.content) r.text = snapText(r.content); });
        var nameMap = opts && opts.names;
        if (nameMap) rows.forEach(function (r) { if (!r.senderName && r.senderId) { var n = nameMap[idKey(r.senderId)]; if (n) r.senderName = nameText(n); } });
        var messages = rows.map(function (r, i) {
            var times = specs.map(function (t) { return { key: t.key, label: t.label, note: t.note, col: t.col, epoch: t.epoch, raw: r[t.key], ms: r[t.key + 'Ms'] }; });
            var sort = times.find(function (t) { return t.key === sortKey && t.ms !== null; }) || times.find(function (t) { return t.ms !== null; }) || null;
            var kind = KIND_TEXT[r.kind] ? r.kind : 'other';
            var list = att[String(r.id)] || [];
            list.forEach(function (a) { a.kind = mediaKind(a.mime, kind, a); });
            return {
                index: i, id: r.id, key: String(r.id), fromMe: flag(r.fromMe), senderId: text(r.senderId), senderName: text(r.senderName),
                text: text(r.text), kind: kind, kindLabel: text(r.kindLabel) || KIND_TEXT[kind], viewOnce: flag(r.viewOnce), deleted: flag(r.deleted) || kind === 'deleted',
                edited: text(r.edited), expiresIn: num(r.expiresIn), device: text(r.device), replyTo: r.replyTo === null || r.replyTo === undefined ? null : String(r.replyTo), replyText: text(r.replyText),
                sortMs: sort ? sort.ms : null, sortLabel: sort ? sort.label : '', times: times,
                details: (q.details || []).map(function (d) { return { label: d.label, value: r[d.key] }; }).filter(function (d) { return d.value !== null && d.value !== undefined && d.value !== ''; }),
                attachments: list,
            };
        });
        // Svaren pekar på ett annat meddelande i samma chatt; texten hämtas därifrån när rollen inte har den.
        var byKey = {};
        messages.forEach(function (m) { byKey[m.key] = m; });
        messages.forEach(function (m) {
            if (m.replyTo === null) return;
            var to = byKey[m.replyTo];
            m.reply = { found: !!to, text: m.replyText || (to ? to.text || to.kindLabel : ''), from: to ? (to.fromMe ? 'Den här telefonen' : to.senderName) : '' };
        });
        var people = memberList || [];
        // Utan apply: en chatt med hundratusentals meddelanden spränger annars anropsstacken.
        var firstMs = null, lastMs = null;
        messages.forEach(function (m) {
            if (m.sortMs === null) return;
            if (firstMs === null || m.sortMs < firstMs) firstMs = m.sortMs;
            if (lastMs === null || m.sortMs > lastMs) lastMs = m.sortMs;
        });
        return {
            source: src, thread: thread, members: people, messages: messages, timeSpecs: specs, sortKey: sortKey,
            firstMs: firstMs, lastMs: lastMs,
            group: thread.kind === 'group' || people.length > 1,
        };
    }

    // ---------- Tider ----------

    // zone: 'local' (datorns zon) eller ett zonnamn som 'UTC'.
    function zoneName(zone) {
        if (zone && zone !== 'local') return zone;
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'datorns zon'; } catch (e) { return 'datorns zon'; }
    }

    function formatter(zone) {
        var opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
        if (zone && zone !== 'local') opts.timeZone = zone;
        var f = new Intl.DateTimeFormat('en-GB', opts);
        return function (ms) {
            if (ms === null || ms === undefined || !isFinite(ms)) return '';
            var p = {};
            f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
            return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute + ':' + p.second;
        };
    }

    // Zonens förskjutning vid tiden ms, som "+01:00".
    function offsetText(zone, ms) {
        var f = formatter(zone);
        var local = f(ms), utc = formatter('UTC')(ms);
        if (!local || !utc) return '';
        var toMs = function (s) { return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16), +s.slice(17, 19)); };
        var min = Math.round((toMs(local) - toMs(utc)) / 60000);
        var sign = min < 0 ? '-' : '+';
        min = Math.abs(min);
        return sign + ('0' + Math.floor(min / 60)).slice(-2) + ':' + ('0' + (min % 60)).slice(-2);
    }

    // En tid som undersökaren skrev in ("2026-11-03 12:15" eller med sekunder) i zonen, som UTC-millisekunder.
    function parseLocal(textValue, zone) {
        var m = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*$/.exec(String(textValue || ''));
        if (!m) return null;
        var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
        // Förskjutningen vid den gissade tiden, och en gång till nära skiftena mellan sommar- och vintertid.
        var at = function (ms) { var o = offsetText(zone, ms); var s = o.charAt(0) === '-' ? -1 : 1; return s * (+o.slice(1, 3) * 60 + +o.slice(4, 6)) * 60000; };
        var ms = guess - at(guess);
        return guess - at(ms);
    }

    // ---------- Urval ----------

    // opts: { ids: [meddelandenas key] } eller { fromMs, toMs } (båda med). Utan något: alla.
    function pick(messages, opts) {
        opts = opts || {};
        if (opts.ids) {
            var wanted = {};
            opts.ids.forEach(function (k) { wanted[String(k)] = true; });
            return messages.filter(function (m) { return wanted[m.key]; });
        }
        if (opts.fromMs !== undefined || opts.toMs !== undefined) {
            var from = opts.fromMs === undefined || opts.fromMs === null ? -Infinity : opts.fromMs;
            var to = opts.toMs === undefined || opts.toMs === null ? Infinity : opts.toMs;
            return messages.filter(function (m) { return m.sortMs !== null && m.sortMs >= from && m.sortMs <= to; });
        }
        return messages.slice();
    }

    // ---------- Stora chattar ----------

    // Raderna ur en SELECT i sql.js, i omgångar: efter ungefär sliceMs millisekunder anropas onSlice(rader hittills).
    // Den får returnera ett löfte (en paus, så att sidan hinner rita) eller kasta (avbrutet). Ger samma form som
    // exec: { columns, values }. Bara den första satsen körs, så en chattroll är en enda SELECT.
    async function readRows(db, sql, opts) {
        opts = opts || {};
        var sliceMs = opts.sliceMs === undefined ? 40 : opts.sliceMs;
        var stmt = db.prepare(sql);
        try {
            var columns = stmt.getColumnNames();
            var values = [];
            var t = Date.now();
            while (stmt.step()) {
                values.push(stmt.get());
                if (opts.onSlice && (values.length & 127) === 0 && Date.now() - t >= sliceMs) {
                    await opts.onSlice(values.length);
                    t = Date.now();
                }
            }
            return { columns: columns, values: values };
        } finally {
            // Stängdes databasen under en paus är satsen redan släppt; då gör free ingenting.
            try { stmt.free(); } catch (e) { /* redan släppt */ }
        }
    }

    // Texten att söka i för varje meddelande, med små bokstäver: texten, bildtexten, filens namn och kontaktkortets namn.
    function searchIndex(messages) {
        return messages.map(function (m) {
            var parts = [m.text];
            m.attachments.forEach(function (a) { parts.push(a.title, a.name, a.cardName); });
            return parts.filter(Boolean).join('\n').toLowerCase();
        });
    }

    // Meddelandena (index) vars söktext innehåller q, i ordning.
    function findAll(index, q) {
        var needle = String(q || '').trim().toLowerCase();
        var out = [];
        if (!needle) return out;
        for (var i = 0; i < index.length; i++) if (index[i].indexOf(needle) >= 0) out.push(i);
        return out;
    }

    // Texten i bitar där träffarna för q är märkta: [{ text, hit }]. Ändrar små bokstäver längden på texten
    // (några få tecken gör det) märks ingenting, eftersom platserna då inte går att lita på.
    function marks(value, q) {
        var s = text(value), needle = String(q || '').trim().toLowerCase();
        var low = s.toLowerCase();
        if (!needle || low.length !== s.length) return [{ text: s, hit: false }];
        var out = [], at = 0, i;
        while ((i = low.indexOf(needle, at)) >= 0) {
            if (i > at) out.push({ text: s.slice(at, i), hit: false });
            out.push({ text: s.slice(i, i + needle.length), hit: true });
            at = i + needle.length;
        }
        if (at < s.length || !out.length) out.push({ text: s.slice(at), hit: false });
        return out;
    }

    // Meddelandet med den tidigaste tiden från ms och framåt (det första i ordningen vid lika tid), eller -1.
    // Ordningen i chatten litas inte på: ett meddelande utan sorteringstid kan ha fått en annan tid.
    function atOrAfter(messages, ms) {
        var best = -1;
        for (var i = 0; i < messages.length; i++) {
            var t = messages[i].sortMs;
            if (t === null || t < ms) continue;
            if (best < 0 || t < messages[best].sortMs) best = i;
        }
        return best;
    }

    // ---------- Listan med konversationer ----------

    // Slagen i listans ordning, med namnet på valet, och ordningarna att välja mellan.
    var THREAD_KINDS = { person: 'Enskilda', group: 'Grupper', status: 'Status', channel: 'Kanaler', self: 'Till mig själv', other: 'Andra' };
    var LIST_SORTS = [['recent', 'Senaste först'], ['messages', 'Flest meddelanden'], ['name', 'Namn A–Ö']];

    // Texten att jämföra: små bokstäver, utan osynliga riktningstecken, med vanliga streck och mellanrum. WhatsApp
    // skriver ett okänt nummer som namn med sådana tecken runt och hårda mellanrum i.
    function plain(v) {
        return text(v).toLowerCase().replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
    }

    // Ett id som appen har satt, och som ingen söker i med ett ord: ett UUID eller en lång rad hexsiffror.
    function opaque(s) {
        return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/.test(s) || /^[0-9a-f]{16,}$/.test(s);
    }

    // Telefonnumren i en text, som bara siffror: 5–15 siffror, skrivna med mellanrum, streck, parenteser eller punkter.
    function numbersIn(s) {
        var out = [];
        function keep(part) {
            var d = part.replace(/\D/g, '');
            if (d.length >= 5 && d.length <= 15) out.push(d);
        }
        (s.match(/\+?\d[\d\-()./ ]*\d/g) || []).forEach(function (run) {
            // Fler siffror än ett nummer har är flera nummer efter varandra, ett i varje ord.
            if (run.replace(/\D/g, '').length > 15) run.split(' ').forEach(keep);
            else keep(run);
        });
        return out;
    }

    function add(list, v) { if (v && list.indexOf(v) < 0) list.push(v); }

    // Lägger det som går att söka på i ett värde till e: texts (ett ord hittas var som helst i dem), nums
    // (telefonnummer som bara siffror) och ids (hela värdet, som hittas från sin början).
    // shown: värdet står i listan och söks som det står, vad det än är.
    function addValue(e, v, shown) {
        var s = plain(v);
        if (!s) return;
        // Ett JID med siffror före @: numret hos en användare (46701234567@s.whatsapp.net) och annars ett id (grupp,
        // lid). Det som står efter @ är detsamma i varje rad och ingenting att söka i.
        var jid = /^([\d.:\-]+)@([a-z\d.\-]+)$/.exec(s);
        if (jid || opaque(s)) {
            add(e.ids, s);
            if (jid && /^(s\.whatsapp\.net|c\.us)$/.test(jid[2])) numbersIn(jid[1]).forEach(function (d) { add(e.nums, d); });
            if (shown) add(e.texts, jid ? jid[1] : s);
            return;
        }
        numbersIn(s).forEach(function (d) { add(e.nums, d); });
        // Ett nummer är ingen text: två siffror finns mitt i vart tionde nummer.
        if (shown || /[^\d\s#+\-()./]/.test(s)) add(e.texts, s);
        else add(e.ids, s);
    }

    // Det som går att söka på i varje konversation: det egna (namnet, som står i listan, och adressen) och varje
    // deltagares namn och adress. Samma deltagare i flera konversationer delar på en post.
    function listIndex(list, people) {
        var known = Object.create(null);
        function person(p) {
            var key = JSON.stringify([p.name, p.address, p.id]);
            if (!known[key]) {
                var e = known[key] = { name: p.name, texts: [], nums: [], ids: [] };
                // Deltagarens id är i en del appar bara ett radnummer: det hittas som id, och söks inte i. En
                // deltagare utan namn heter som sitt id.
                if (plain(p.name) !== plain(p.id)) addValue(e, p.name, false);
                addValue(e, p.address, false);
                add(e.ids, plain(p.id));
            }
            return known[key];
        }
        return list.map(function (t) {
            var own = { texts: [], nums: [], ids: [] };
            addValue(own, t.name, true);
            addValue(own, t.address, false);
            return { own: own, who: ((people && people[t.key]) || []).map(person) };
        });
    }

    // Sökorden i en sökning: [{ text, digits, typed }]. Ord av siffror som står intill varandra är ett telefonnummer,
    // skrivet hur som helst: siffrorna jämförs utan mellanrum och streck, så att 070-123 45 67 hittar +46701234567,
    // och hela numret ska finnas på samma ställe. typed är siffrorna som de skrevs och digits desamma utan nollorna
    // först. Fler siffror än ett nummer har (15) är flera tal, som söks vart för sig.
    function searchTerms(query) {
        var out = [], run = [];
        function number(words) {
            var typed = words.join('').replace(/\D/g, '');
            out.push({ text: words.join(' '), digits: typed.replace(/^0+/, ''), typed: typed });
        }
        function flush() {
            if (!run.length) return;
            if (run.join('').replace(/\D/g, '').length > 15) run.forEach(function (w) { number([w]); });
            else number(run);
            run = [];
        }
        plain(query).split(' ').forEach(function (w) {
            if (!w) return;
            if (/^\+?[\d\-()./]*\d[\d\-()./]*$/.test(w)) { run.push(w); return; }
            flush();
            out.push({ text: w, digits: '', typed: '' });
        });
        flush();
        return out;
    }

    // Finns talet i numret? Fyra siffror eller fler hittas var som helst i det, färre bara i dess början (efter
    // landsnumret eller nollan): numret hittas medan det skrivs, utan att två siffror i ett gruppnamn träffar alla
    // nummer de står mitt i. Nollorna som skrevs först är riktnumrets nolla (070 är 4670) eller siffror mitt i numret.
    function inNumber(num, term) {
        var at = term.digits ? num.indexOf(term.digits) : -1;
        if (at >= 0 && (term.digits.length >= 4 || at <= 3)) return true;
        return term.typed.length >= 4 && term.typed !== term.digits && num.indexOf(term.typed) >= 0;
    }

    // Finns sökordet i det som går att söka på (ur addValue)? Ett ord finns var som helst i en text, ett tal i ett
    // telefonnummer hur numret än är skrivet. Ett id hittas från sin början, med minst åtta tecken: tre tecken ur ett
    // UUID finns i de flesta.
    function found(e, term) {
        var i;
        for (i = 0; i < e.texts.length; i++) if (e.texts[i].indexOf(term.text) >= 0) return true;
        if (term.typed) for (i = 0; i < e.nums.length; i++) if (inNumber(e.nums[i], term)) return true;
        if (term.text.length >= 8) for (i = 0; i < e.ids.length; i++) if (e.ids[i].lastIndexOf(term.text, 0) === 0) return true;
        return false;
    }

    // Träffar sökorden konversationen? Varje ord ska finnas i dess eget namn eller adress, eller hos en deltagare.
    // Ger null utan träff, annars namnen på deltagarna som stod för orden konversationen själv inte har.
    function listMatch(entry, terms) {
        var who = [];
        for (var i = 0; i < terms.length; i++) {
            if (found(entry.own, terms[i])) continue;
            var p = null;
            for (var k = 0; k < entry.who.length && !p; k++) if (found(entry.who[k], terms[i])) p = entry.who[k];
            if (!p) return null;
            if (who.indexOf(p.name) < 0) who.push(p.name);
        }
        return who;
    }

    var collator = typeof Intl !== 'undefined' && Intl.Collator ? new Intl.Collator('sv', { numeric: true, sensitivity: 'base' }) : null;
    function lastOf(t) { return t.lastMs === null || t.lastMs === undefined ? -Infinity : t.lastMs; }

    // Ordningen i listan. Lika värden, och två utan tid, står kvar i databasens ordning.
    function listSort(items, sort) {
        var order = sort === 'messages' ? function (a, b) { return (b.thread.messages || 0) - (a.thread.messages || 0); }
            : sort === 'name' ? function (a, b) { return collator ? collator.compare(a.thread.name, b.thread.name) : a.thread.name < b.thread.name ? -1 : a.thread.name > b.thread.name ? 1 : 0; }
            : function (a, b) { return lastOf(b.thread) - lastOf(a.thread); };
        return items.sort(function (a, b) { return order(a, b) || a.at - b.at; });
    }

    // Listan efter sökning, app, slag, tomma och ordning.
    // groups: databaserna i listans ordning, [{ app, threads, index }]. threads är null tills databasen är läst, och
    // index kommer ur listIndex. opts: { query, app, kind, hideEmpty, sort }.
    // Ger { groups: [{ visible, total, items: [{ thread, who, at }] }], apps: [{ app, count }],
    // kinds: [{ kind, text, count }], empty, total, shown, filtered }.
    // Talet vid en app eller ett slag räknar konversationerna som de andra valen lämnar kvar, alltså det valet skulle
    // visa. empty är de tomma konversationerna som Dölj tomma tar bort. En app utan läst databas har count null.
    function listView(groups, opts) {
        opts = opts || {};
        var terms = searchTerms(opts.query);
        var apps = [], appAt = {}, present = {}, counts = {}, empty = 0, total = 0, shown = 0;
        var out = (groups || []).map(function (g) {
            if (appAt[g.app] === undefined) { appAt[g.app] = apps.length; apps.push({ app: g.app, count: null }); }
            var app = apps[appAt[g.app]];
            var inApp = !opts.app || opts.app === g.app;
            if (!g.threads) return { visible: inApp, total: null, items: [] };
            if (app.count === null) app.count = 0;
            var items = [];
            g.threads.forEach(function (t, at) {
                total++;
                present[t.kind] = true;
                var who = listMatch(g.index[at], terms);
                if (!who) return;
                var isEmpty = t.messages === 0;
                var kept = !(opts.hideEmpty && isEmpty);
                var inKind = !opts.kind || opts.kind === t.kind;
                if (inKind && kept) app.count++;
                if (inApp && kept) counts[t.kind] = (counts[t.kind] || 0) + 1;
                if (inApp && inKind && isEmpty) empty++;
                if (inApp && inKind && kept) items.push({ thread: t, who: who, at: at });
            });
            shown += items.length;
            return { visible: inApp, total: g.threads.length, items: listSort(items, opts.sort) };
        });
        return {
            groups: out, apps: apps, empty: empty, total: total, shown: shown,
            kinds: Object.keys(THREAD_KINDS).filter(function (k) { return present[k]; }).map(function (k) { return { kind: k, text: THREAD_KINDS[k], count: counts[k] || 0 }; }),
            filtered: !!(terms.length || opts.app || opts.kind || opts.hideEmpty),
        };
    }

    // Avsändarens namn i texterna.
    function senderText(m) {
        if (m.fromMe) return 'Den här telefonen';
        return m.senderName || m.senderId || 'Okänd avsändare';
    }

    function sizeText(n) {
        if (n === null || n === undefined || !isFinite(n)) return '';
        var units = ['byte', 'kB', 'MB', 'GB'];
        var v = n, i = 0;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
        return (i ? v.toFixed(1).replace('.', ',') : String(v)) + ' ' + units[i];
    }

    function durationText(s) {
        if (s === null || s === undefined || !isFinite(s)) return '';
        s = Math.round(s);
        return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
    }

    var api = {
        ROLES: ROLES, THREAD_KIND: THREAD_KIND, KIND_TEXT: KIND_TEXT,
        sources: sources, databases: databases, threads: threads, members: members, conversation: conversation, timeSpecs: timeSpecs,
        names: names, applyNames: applyNames, snapText: snapText, pbPath: pbPath, idKey: idKey,
        resolvePath: resolvePath, hexOfBase64: hexOfBase64, mediaKind: mediaKind,
        zoneName: zoneName, formatter: formatter, offsetText: offsetText, parseLocal: parseLocal,
        pick: pick, senderText: senderText, sizeText: sizeText, durationText: durationText,
        readRows: readRows, searchIndex: searchIndex, findAll: findAll, marks: marks, atOrAfter: atOrAfter,
        THREAD_KINDS: THREAD_KINDS, LIST_SORTS: LIST_SORTS, listIndex: listIndex, searchTerms: searchTerms, listMatch: listMatch, listView: listView,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ChatCore = api;
})(typeof window !== 'undefined' ? window : this);
