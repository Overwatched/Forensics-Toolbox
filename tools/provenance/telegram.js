// Telegram som källa i Härkomst: först iOS, och sist i filen Android med sin egen inledning.
// iOS är en betafunktion: tolkningarna är kontrollerade mot en labbtelefon
// (iOS 26.4.1, Telegram 13.1.2, 2026-11-03) och kan skilja sig mellan versioner, därför bär varje
// händelse databas, tabell, kolumn och query. Telegrams format avkodas i minnet av
// tools/db-queries/postbox.js. Filen kopplas till Telegram på tre sätt:
// - filen själv under postbox/media/: namnet är resursens id, och resursen hör till ett meddelande;
// - en bild ur bildbiblioteket: lagringsdatabasen har resursen ph-<bibliotekets id> för en chatt, med
//   den uppladdade bildens storlek, och meddelandet är det i samma chatt med en bild av samma storlek;
// - en bild som Telegram sparat i bildbiblioteket efter att den tagits med Telegrams kamera har bara
//   tiden gemensamt med meddelandet: det blir en möjlig koppling, inte en träff.
// Ingen DOM, ingen SQL. Testas i Node.
(function (root) {
    'use strict';

    var APP = 'ph.telegra.Telegraph';
    var MAX_EVENTS = 40;
    var NEARBY_MS = 60000;      // en sparad kamerabild och ett skickat meddelande inom så här lång tid (sett: 2, 6 och 9 s)
    // Namnen Telegrams kamera gav bilder och videor i labbet (ZORIGINALFILENAME och filen i tmp/).
    var CAMERA_NAME = /^cam(photo|video)_[0-9a-f]+\.[a-z0-9]+$/i;
    // Ett meddelande skickat, en bild skickad.
    var NEUTER = { meddelande: 1, samtal: 1, klistermärke: 1, ljud: 1, tjänstemeddelande: 1 };

    function isTelegramApp(id) { return id === APP; }
    function isCameraName(name) { return CAMERA_NAME.test(String(name || '')); }

    function kindOf(media) {
        var m = String(media || '');
        return /^bild/.test(m) ? 'bild' : m === 'video' ? 'video' : m || 'meddelande';
    }

    function chatName(r) { return r.chatName || (r.peerTgId ? 'Telegram-id ' + r.peerTgId : 'okänd chatt'); }
    function groupWord(r) { var t = Number(r.peerType); return t === 2 ? 'kanalen ' : t === 1 ? 'gruppen ' : ''; }

    // Motparten: chatten för ett skickat, avsändaren för ett mottaget (och gruppen eller kanalen).
    function counterpart(r) {
        var chat = chatName(r);
        var g = groupWord(r);
        if (Number(r.incoming) !== 1) return g + chat;
        var who = r.sender && r.sender !== 'den här telefonen' ? r.sender : chat;
        return g && who !== chat ? who + ' i ' + g + chat : who;
    }

    function key(r) { return r.peerId + '|' + (r.namespace != null ? r.namespace : 0) + '|' + (r.messageId != null ? r.messageId : r.id); }

    // Resursens id ur en sökväg direkt under postbox/media/, utan _partial.
    function resourceFromPath(path) {
        var m = /\/postbox\/media\/([^\/]+)$/.exec(String(path || ''));
        if (!m || /\.meta$/.test(m[1])) return null;
        return m[1].replace(/_partial$/, '');
    }

    // Meddelanden (peer|namnrymd|id) vars bild är en bild som valts ur bildbiblioteket: samma chatt och
    // samma storlek som en ph-resurs i lagringsdatabasen.
    function libraryMessages(ctx) {
        var out = {};
        (ctx.storage || []).forEach(function (s) {
            if (!s.libraryUuid || !s.peerId || !(Number(s.size) > 0)) return;
            (ctx.resources || []).forEach(function (r) {
                if (r.peerId === s.peerId && Number(r.size) === Number(s.size) && /^(bild|video)/.test(r.role)) out[key(r)] = s.libraryUuid;
            });
        });
        return out;
    }

    // Filen själv under postbox/media/: resursen i ett meddelande, eller lagringsdatabasens meddelande när
    // meddelandet inte finns kvar i t7.
    function match(ctx) {
        var rid = resourceFromPath(ctx.path);
        if (!rid) return [];
        var out = [];
        var seen = {};
        (ctx.resources || []).forEach(function (r) {
            if (r.resourceId !== rid || seen[key(r)]) return;
            seen[key(r)] = true;
            out.push({ row: r, by: ['path'] });
        });
        if (!out.length) {
            (ctx.storage || []).forEach(function (s) {
                if (s.resourceId !== rid || !s.messageId || seen[s.peerId + '|' + s.messageId]) return;
                seen[s.peerId + '|' + s.messageId] = true;
                out.push({ row: { peerId: s.peerId, peerType: s.peerType, peerTgId: s.peerTgId, namespace: s.messageNamespace, messageId: s.messageId, resourceId: rid, size: s.size, gone: true }, by: ['path', 'storage'] });
            });
        }
        return out;
    }

    // En bild ur bildbiblioteket (filens ZUUID) enligt lagringsdatabasen, med meddelandena i samma chatt
    // som har en bild av samma storlek.
    function picks(ctx) {
        var uuid = String(ctx.uuid || '').toUpperCase();
        if (!uuid) return [];
        var seen = {};
        return (ctx.storage || []).filter(function (s) {
            if (!s.libraryUuid || String(s.libraryUuid).toUpperCase() !== uuid || !s.peerId) return false;
            var k = s.peerId + '|' + s.resourceId;
            if (seen[k]) return false;
            seen[k] = true;
            return true;
        }).map(function (s) {
            var msgs = {};
            (ctx.resources || []).forEach(function (r) {
                if (r.peerId === s.peerId && Number(s.size) > 0 && Number(r.size) === Number(s.size) && /^(bild|video)/.test(r.role)) msgs[key(r)] = r;
            });
            return { storage: s, messages: Object.keys(msgs).map(function (k) { return msgs[k]; }).sort(function (a, b) { return a.timeMs - b.timeMs; }) };
        });
    }

    // En fil som Telegram sparat i bildbiblioteket: det första skickade meddelandet med en bild (eller
    // video, för en video) från filens skapandetid och en minut framåt, som inte är en bild ur
    // bildbiblioteket. Bara tiden binder ihop dem.
    function nearby(ctx, fromLibrary) {
        var T = ctx.createdMs;
        if (!ctx.savedByTelegram || T == null) return [];
        var want = ctx.video ? 'video' : 'bild';
        var byMsg = {};
        (ctx.resources || []).forEach(function (r) {
            var k = key(r);
            if (byMsg[k] || Number(r.incoming) === 1 || fromLibrary[k] || r.role === 'miniatyr') return;
            if (kindOf(r.media) !== want || r.timeMs == null || r.timeMs < T - 1000 || r.timeMs - T > NEARBY_MS) return;
            byMsg[k] = r;
        });
        return Object.keys(byMsg).map(function (k) { return byMsg[k]; }).sort(function (a, b) { return a.timeMs - b.timeMs; }).slice(0, 1);
    }

    // Telegrams kamera: originalnamnet i bildbiblioteket och, om den finns kvar, samma fil i tmp/.
    // ctx.camera: { name, path, same } från Härkomst, eller null.
    function camera(ctx) {
        if (!ctx.savedByTelegram || !isCameraName(ctx.originalFilename)) return null;
        var c = ctx.camera || {};
        return { name: ctx.originalFilename, video: /^camvideo_/i.test(ctx.originalFilename), path: c.path || null, same: c.same != null ? !!c.same : null };
    }

    // ctx: { path, uuid, createdMs, video, savedByTelegram, originalFilename, camera, resources, storage,
    //        storageRead, messages, sources: { main }, centerMs, keep(ms) }. Returnerar { events, notes, link }.
    function build(ctx) {
        var events = [];
        var notes = [];
        var srcMain = ctx.sources && ctx.sources.main || { db: 'db_sqlite', table: 'tg_message (ur t7)', queryId: 'role-messages' };
        var matches = match(ctx);
        var fromLibrary = libraryMessages(ctx);
        var pk = picks(ctx);
        var pickRows = [];
        pk.forEach(function (p) { if (p.messages.length === 1) pickRows.push(p.messages[0]); });
        // En bild som valts ur biblioteket och skickats kan också ha skickats direkt med kameran.
        var near = matches.length ? [] : nearby(ctx, fromLibrary);
        var fileMsgs = {};
        matches.forEach(function (x) { fileMsgs[key(x.row)] = true; });
        pickRows.forEach(function (r) { fileMsgs[key(r)] = true; });
        var nearMsgs = {};
        near.forEach(function (r) { nearMsgs[key(r)] = true; });

        (ctx.messages || []).forEach(function (m) {
            var ms = m.timeMs;
            if (ms == null) return;
            var k = key({ peerId: m.peerId, namespace: m.namespace, messageId: m.id });
            var own = Number(m.incoming) !== 1;
            var what = m.media === 'samtal' ? 'samtal' : m.media ? kindOf(m.media) : 'meddelande';
            var who = counterpart(m);
            var isFile = !!fileMsgs[k];
            var near1 = !!nearMsgs[k];
            var lib = !!fromLibrary[k];
            var once = Number(m.viewOnce) === 1;
            var text, plain = null;
            if (what === 'samtal') {
                text = 'Telegram: ' + (Number(m.callVideo) === 1 ? 'videosamtal' : 'samtal') + (own ? ' till ' : ' från ') + who + (m.callDuration ? ', ' + m.callDuration + ' s' : ', ingen längd registrerad') + ' (meddelande ' + m.id + ')';
            } else {
                var verb = NEUTER[what] ? (own ? 'skickat till ' : 'mottaget från ') : (own ? 'skickad till ' : 'mottagen från ');
                text = 'Telegram: ' + what + ' ' + verb + who + ' (meddelande ' + m.id + ')' + (lib ? ', vald ur bildbiblioteket' : '') + (once ? ', engångsvisning' : '');
                var noun = what === 'bild' ? 'En bild' : what === 'video' ? 'En video' : null;
                if (noun) plain = (own ? noun + ' skickas från den här telefonen i Telegram till ' + who : noun + ' tas emot i Telegram från ' + who) + (lib && own ? ' (vald ur bildbiblioteket)' : '') + (once ? ' för engångsvisning' : '');
            }
            if (isFile) {
                text = 'Den bedömda filen: ' + text;
                plain = (own ? 'Den bedömda filen skickas från den här telefonen i Telegram till ' + who : 'Den bedömda filen tas emot i Telegram från ' + who) + (once ? ' för engångsvisning' : '');
            } else if (near1) {
                text += '; skickad strax efter att den bedömda filen skapades';
            }
            events.push({ ms: ms, kind: 'tg-message', lane: 'telegram', app: APP, own: own, bold: isFile, isFile: isFile, near: near1, messageId: m.id,
                media: what === 'bild' || what === 'video' ? 1 : 0, mediaKind: what === 'bild' || what === 'video' ? what : null, fromLibrary: lib, viewOnce: once, call: what === 'samtal',
                active: own, activeText: own ? 'ett meddelande skickades' : null,
                text: text, plain: plain, source: Object.assign({}, srcMain, { column: 'timestamp (nyckelns tid)' }) });
        });

        if (typeof ctx.keep === 'function') events = events.filter(function (e) { return ctx.keep(e.ms); });
        events.sort(function (a, b) { return a.ms - b.ms; });
        if (events.length > MAX_EVENTS) {
            var center = ctx.centerMs != null ? ctx.centerMs : events[0].ms;
            var kept = events.filter(function (e) { return e.isFile || e.near; });
            events.filter(function (e) { return !e.isFile && !e.near; }).sort(function (a, b) { return Math.abs(a.ms - center) - Math.abs(b.ms - center); })
                .forEach(function (e) { if (kept.length < MAX_EVENTS) kept.push(e); });
            notes.push((events.length - kept.length) + ' Telegram-händelser till i fönstret visas inte.');
            events = kept.sort(function (a, b) { return a.ms - b.ms; });
        }

        var row = function (r, by) {
            return {
                messageId: r.messageId != null ? r.messageId : r.id, peerId: r.peerId, direction: Number(r.incoming) === 1 ? 'in' : 'out', who: counterpart(r), chat: chatName(r),
                kind: kindOf(r.media), size: r.size != null ? Number(r.size) : null, width: r.width, height: r.height, resourceId: r.resourceId || null, timeMs: r.timeMs != null ? r.timeMs : null,
                viewOnce: Number(r.viewOnce) === 1, gone: !!r.gone, by: by || [], path: r.resourceId ? 'postbox/media/' + r.resourceId : null,
            };
        };
        var mediaMessages = {};
        (ctx.resources || []).forEach(function (r) { mediaMessages[key(r)] = true; });
        var link = {
            matches: matches.map(function (x) { return row(x.row, x.by); }),
            picks: pk.map(function (p) {
                var s = p.storage;
                return { uuid: s.libraryUuid, resourceId: s.resourceId, size: Number(s.size) || null, peerId: s.peerId, chat: s.peerTgId ? 'Telegram-id ' + s.peerTgId : null,
                    messages: p.messages.map(function (r) { return row(r, ['library']); }) };
            }),
            nearby: near.map(function (r) { return Object.assign(row(r), { afterMs: r.timeMs - ctx.createdMs }); }),
            camera: camera(ctx),
            media: Object.keys(mediaMessages).length,
            storageRead: !!ctx.storageRead,
        };
        // Chatten för ett val ur bildbiblioteket heter som i meddelandet när ett meddelande hittades.
        link.picks.forEach(function (p) { if (p.messages.length) p.chat = p.messages[0].chat; });
        return { events: events, notes: notes, link: link };
    }

    // ---------- Android ----------
    // cache4.db, kontrollerad mot en labbtelefon (Android 16, Telegram med versionskod 73031, 2026-11-11) för en mottagen bild. Filen
    // låg under Android/data/org.telegram.messenger/files/Telegram/Telegram Images/ och hette -<id>_<nummer>.jpg:
    // id:t med omvänt tecken är bildens id i meddelandets blobb (åtta byte efter bildens konstruktor), och numret är
    // teckenkoden för en av bildens storlekar, vars antal byte i blobben var filens storlek. Filen står inte i
    // telefonens bildbibliotek. Skickade bilder, videor och filer är inte kontrollerade och kopplas inte.

    var APP_ANDROID = 'org.telegram.messenger';
    var TL_PHOTO = 0xfb197a65, TL_VECTOR = 0x1cb5c415;
    // Bildens storlekar: de tre första är sedda i labbet, de andra följer Telegrams schema.
    var TL_SIZE = 0x75c78e60, TL_SIZE_STRIPPED = 0xe0b0bc2e, TL_SIZE_PROGRESSIVE = 0xfa3efb95, TL_SIZE_EMPTY = 0x0e17e23c, TL_SIZE_CACHED = 0x021e1ad6, TL_SIZE_PATH = 0xd8214d41;
    // media_v4.type, med samma namn som i katalogens queryer.
    var MEDIA_ANDROID = { 0: 'bild eller video', 1: 'fil', 2: 'röst- eller videomeddelande', 4: 'musik', 5: 'gif' };
    var NEUTER_ANDROID = { meddelande: 1, 'röst- eller videomeddelande': 1, 'tjänstemeddelande': 1 };

    // Bildens id och storlekens bokstav ur namnet på en fil under Telegrams mapp. idHex är id:t som det står i
    // blobben: åtta byte med den lägsta först, som 16 hexadecimala tecken.
    function parseFileName(path) {
        var p = String(path || '');
        var at = p.indexOf('/' + APP_ANDROID + '/');
        if (at < 0 || typeof BigInt !== 'function') return null;
        var m = /^(-?\d{6,20})_(\d{2,3})\.(jpe?g|png|webp)$/i.exec(p.split('/').pop());
        if (!m) return null;
        var n = BigInt(m[1]);
        if (n > BigInt('9223372036854775807') || n < -BigInt('9223372036854775807')) return null;
        var hex = ('0000000000000000' + BigInt.asUintN(64, -n).toString(16).toUpperCase()).slice(-16);
        var le = '';
        for (var i = 14; i >= 0; i -= 2) le += hex.substr(i, 2);
        var code = Number(m[2]);
        return { idHex: le, sizeType: code >= 97 && code <= 122 ? String.fromCharCode(code) : null, path: p.slice(at + 1) };
    }

    // Läser byte ur en hexsträng: tal med den lägsta byten först och Telegrams strängar (längden i en byte, eller 254 och
    // längden i tre, utfyllt till fyra byte). Ett läsfel sätter failed och ger null.
    function tlReader(hex) {
        var len = Math.floor(hex.length / 2);
        var r = { pos: 0, failed: false };
        var b = function (at) { return parseInt(hex.substr(at * 2, 2), 16); };
        r.u32 = function () {
            if (r.failed || r.pos + 4 > len) { r.failed = true; return null; }
            var v = b(r.pos) + b(r.pos + 1) * 256 + b(r.pos + 2) * 65536 + b(r.pos + 3) * 16777216;
            r.pos += 4;
            return v;
        };
        r.skip = function (n) { if (r.failed || r.pos + n > len) r.failed = true; else r.pos += n; };
        r.bytes = function () {
            if (r.failed || r.pos + 1 > len) { r.failed = true; return null; }
            var n = b(r.pos), head = 1;
            if (n === 255) { r.failed = true; return null; }
            if (n === 254) {
                if (r.pos + 4 > len) { r.failed = true; return null; }
                n = b(r.pos + 1) + b(r.pos + 2) * 256 + b(r.pos + 3) * 65536;
                head = 4;
            }
            var start = r.pos + head;
            var end = r.pos + Math.ceil((head + n) / 4) * 4;
            if (end > len) { r.failed = true; return null; }
            r.pos = end;
            return { start: start, length: n };
        };
        r.str = function () {
            var x = r.bytes();
            if (!x) return null;
            var out = '';
            for (var i = 0; i < x.length; i++) out += String.fromCharCode(b(x.start + i));
            return out;
        };
        return r;
    }

    // En bild i ett meddelandes blobb. hex börjar vid bildens konstruktor. Returnerar { id (som idHex), sizes:
    // [{ type, w, h, size }], complete } eller null när det inte är en bild i den form som är kontrollerad.
    // För en bild i flera steg är storleken det sista stegets, alltså hela filens.
    function parsePhoto(hex) {
        var h = String(hex || '').toUpperCase();
        if (!/^[0-9A-F]*$/.test(h)) return null;
        var r = tlReader(h);
        if (r.u32() !== TL_PHOTO) return null;
        r.skip(4);
        var id = h.substr(r.pos * 2, 16);
        r.skip(16);
        r.bytes();
        r.skip(4);
        if (r.u32() !== TL_VECTOR) return null;
        var count = r.u32();
        if (r.failed || count > 64) return null;
        var sizes = [];
        for (var i = 0; i < count; i++) {
            var ctor = r.u32();
            var s = { type: null, w: null, h: null, size: null };
            if (ctor === TL_SIZE) { s.type = r.str(); s.w = r.u32(); s.h = r.u32(); s.size = r.u32(); }
            else if (ctor === TL_SIZE_PROGRESSIVE) {
                s.type = r.str(); s.w = r.u32(); s.h = r.u32();
                var steps = r.u32() === TL_VECTOR ? r.u32() : null;
                if (steps == null || steps > 64) r.failed = true;
                for (var j = 0; !r.failed && j < steps; j++) s.size = r.u32();
            } else if (ctor === TL_SIZE_CACHED) { s.type = r.str(); s.w = r.u32(); s.h = r.u32(); var body = r.bytes(); s.size = body ? body.length : null; }
            else if (ctor === TL_SIZE_STRIPPED || ctor === TL_SIZE_PATH) { s.type = r.str(); r.bytes(); }
            else if (ctor === TL_SIZE_EMPTY) s.type = r.str();
            else break;
            if (r.failed) break;
            sizes.push(s);
        }
        return { id: id, sizes: sizes, complete: sizes.length === count };
    }

    function groupWordAndroid(r) { var t = Number(r.peerType); return t === 2 ? 'gruppen eller kanalen ' : t === 1 ? 'gruppen ' : ''; }

    function counterpartAndroid(r) {
        var chat = r.chatName || 'okänd chatt';
        var g = groupWordAndroid(r);
        if (Number(r.out) === 1) return g + chat;
        var who = r.sender && r.sender !== 'den här telefonen' ? r.sender : chat;
        // Ett inlägg i en kanal har kanalen själv som avsändare.
        return g ? (who !== chat ? who + ' i ' : '') + g + chat : who;
    }

    // Meddelandena som bär filens bild. ctx.photo är raderna ur rollen photo: meddelanden vars blobb har id:t.
    // En rad räknas bara när id:t står på en jämn fyrbytesgräns direkt efter bildens konstruktor.
    function matchAndroid(ctx) {
        var name = ctx.name || parseFileName(ctx.path);
        var out = { matches: [], unread: 0 };
        if (!name) return out;
        (ctx.photo || []).forEach(function (r) {
            var photo = Number(r.idOffset) % 4 === 0 ? parsePhoto(r.photoHex) : null;
            if (!photo || photo.id !== name.idHex) { out.unread++; return; }
            var size = name.sizeType ? photo.sizes.filter(function (s) { return s.type === name.sizeType; })[0] || null : null;
            out.matches.push({ row: r, size: size, sizeOk: size && size.size != null && ctx.size != null ? Number(size.size) === Number(ctx.size) : null });
        });
        return out;
    }

    // ctx: { path, size (filens antal byte), photo (rollen photo), messages (rollen messages), sources: { main },
    //        centerMs, keep(ms) }. Returnerar { events, notes, link } som build, med link.android satt.
    function buildAndroid(ctx) {
        var events = [];
        var notes = [];
        var srcMain = ctx.sources && ctx.sources.main || { db: 'cache4.db', table: 'messages_v2', queryId: 'role-messages' };
        var name = parseFileName(ctx.path);
        var found = matchAndroid({ name: name, photo: ctx.photo, size: ctx.size });
        var fileMsgs = {};
        found.matches.forEach(function (x) { fileMsgs[x.row.peerId + '|' + x.row.id] = true; });

        (ctx.messages || []).forEach(function (m) {
            var ms = m.timeMs;
            if (ms == null) return;
            var own = Number(m.out) === 1;
            var isFile = !!fileMsgs[m.peerId + '|' + m.id];
            var what = isFile ? 'bild' : Number(m.service) === 1 ? 'tjänstemeddelande' : m.mediaType != null ? MEDIA_ANDROID[Number(m.mediaType)] || 'media' : 'meddelande';
            var who = counterpartAndroid(m);
            var verb = NEUTER_ANDROID[what] ? (own ? 'skickat till ' : 'mottaget från ') : (own ? 'skickad till ' : 'mottagen från ');
            var text = 'Telegram: ' + what + ' ' + verb + who + ' (meddelande ' + m.id + ')';
            var hasMedia = what !== 'meddelande' && what !== 'tjänstemeddelande';
            var plain = what === 'bild eller video' ? (own ? 'En bild eller video skickas från den här telefonen i Telegram till ' + who : 'En bild eller video tas emot i Telegram från ' + who) : null;
            if (isFile) { text = 'Den bedömda filen: ' + text; plain = own ? 'Den bedömda filen skickas från den här telefonen i Telegram till ' + who : 'Den bedömda filen tas emot i Telegram från ' + who; }
            events.push({ ms: ms, kind: 'tg-message', lane: 'telegram', app: APP_ANDROID, own: own, bold: isFile, isFile: isFile, near: false, messageId: m.id,
                media: hasMedia ? 1 : 0, mediaKind: hasMedia ? what : null, fromLibrary: false, viewOnce: false, call: false,
                active: own, activeText: own ? 'ett meddelande skickades' : null,
                text: text, plain: plain, source: Object.assign({}, srcMain, { column: 'date' }) });
        });

        if (typeof ctx.keep === 'function') events = events.filter(function (e) { return ctx.keep(e.ms); });
        events.sort(function (a, b) { return a.ms - b.ms; });
        if (events.length > MAX_EVENTS) {
            var center = ctx.centerMs != null ? ctx.centerMs : events[0].ms;
            var kept = events.filter(function (e) { return e.isFile; });
            events.filter(function (e) { return !e.isFile; }).sort(function (a, b) { return Math.abs(a.ms - center) - Math.abs(b.ms - center); })
                .forEach(function (e) { if (kept.length < MAX_EVENTS) kept.push(e); });
            notes.push((events.length - kept.length) + ' Telegram-händelser till i fönstret visas inte.');
            events = kept.sort(function (a, b) { return a.ms - b.ms; });
        }

        var link = {
            matches: found.matches.map(function (x) {
                var r = x.row;
                return {
                    messageId: r.id, peerId: r.peerId, direction: Number(r.out) === 1 ? 'out' : 'in', who: counterpartAndroid(r), chat: r.chatName || 'okänd chatt',
                    kind: 'bild', size: x.size ? x.size.size : null, width: x.size ? x.size.w : null, height: x.size ? x.size.h : null, resourceId: null, timeMs: r.timeMs != null ? r.timeMs : null,
                    viewOnce: false, gone: false, by: ['path'], path: name.path, sizeType: name.sizeType, sizeOk: x.sizeOk, fileSize: ctx.size != null ? Number(ctx.size) : null,
                };
            }),
            picks: [], nearby: [], camera: null, media: null, storageRead: false,
            android: true, idInName: !!name, unread: found.unread,
        };
        return { events: events, notes: notes, link: link };
    }

    var api = {
        APP: APP, isTelegramApp: isTelegramApp, isCameraName: isCameraName, kindOf: kindOf, counterpart: counterpart, resourceFromPath: resourceFromPath,
        match: match, picks: picks, nearby: nearby, libraryMessages: libraryMessages, build: build, NEARBY_MS: NEARBY_MS,
        APP_ANDROID: APP_ANDROID, parseFileName: parseFileName, parsePhoto: parsePhoto, counterpartAndroid: counterpartAndroid, matchAndroid: matchAndroid, buildAndroid: buildAndroid,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceTelegram = api;
})(typeof window !== 'undefined' ? window : this);
