// WhatsApp som källa i Härkomst: först iOS, och sist i filen Android med sin egen inledning.
// iOS är en betafunktion: tolkningarna är kontrollerade mot en labbtelefon
// (iOS 26.4.1, 2026-11-03) och kan skilja sig mellan versioner, därför bär varje händelse databas,
// tabell, kolumn och query. ChatStorage.sqlite är inte krypterad. Filen kopplas till WhatsApp på tre
// sätt som binder: samma SHA-256 som en mediefil (ZVCARDNAME, base64), samma post i bildbiblioteket
// (bibliotekets id i ZMETADATA när filen valdes därifrån) eller filen själv under Message/. En bild som
// WhatsApp sparat i bildbiblioteket efter att den tagits med WhatsApps kamera har bara tiden gemensamt
// med meddelandet: det blir en möjlig koppling, inte en träff. Ingen DOM, ingen SQL. Testas i Node.
(function (root) {
    'use strict';

    var APP = 'net.whatsapp.WhatsApp';
    var APP_BUSINESS = 'net.whatsapp.WhatsAppSMB';
    var MAX_EVENTS = 40;
    var NEARBY_MS = 60000;      // en sparad kamerabild och ett skickat meddelande inom så här lång tid (sett: 2 och 7 s)
    var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    // ZMESSAGETYPE: bara de typer som syns i labbet får ett namn (3, 5 och 8 är vanliga tolkningar).
    var TYPES = { 0: 'text', 1: 'bild', 2: 'video', 3: 'ljud', 4: 'kontaktkort', 5: 'plats', 8: 'dokument', 10: 'systemmeddelande', 38: 'bild', 39: 'video' };
    // Engångsvisning: 38 är kontrollerad (bild, labbsessionen 2026-11-03), 39 (video) är en vanlig tolkning.
    function isViewOnce(t) { return Number(t) === 38 || Number(t) === 39; }
    // Ett meddelande skickat, en bild skickad.
    var NEUTER = { meddelande: 1, kontaktkort: 1, dokument: 1, ljud: 1, systemmeddelande: 1 };

    function isWhatsAppApp(id) { return id === APP || id === APP_BUSINESS; }

    function b64ToHex(b64) {
        var s = String(b64 == null ? '' : b64).replace(/[\s=]+/g, '');
        if (!s) return null;
        var bits = 0, value = 0, out = '';
        for (var i = 0; i < s.length; i++) {
            var v = B64.indexOf(s.charAt(i));
            if (v < 0) return null;
            value = (value << 6) | v;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                var b = (value >> bits) & 255;
                out += (b < 16 ? '0' : '') + b.toString(16);
            }
        }
        return out;
    }

    function hexToB64(hex) {
        var h = String(hex || '').toLowerCase();
        if (!/^[0-9a-f]*$/.test(h) || h.length % 2) return null;
        var out = '';
        for (var i = 0; i < h.length; i += 6) {
            var chunk = h.slice(i, i + 6);
            var n = parseInt(chunk + '000000'.slice(chunk.length), 16);
            var chars = chunk.length / 2 + 1;
            for (var j = 0; j < 4; j++) out += j < chars ? B64.charAt((n >> (18 - 6 * j)) & 63) : '=';
        }
        return out;
    }

    function typeName(t) { var n = TYPES[Number(t)]; return n || 'typ ' + t; }

    function kindOf(row) {
        var mime = String(row.mime || '');
        if (/^image\//.test(mime)) return 'bild';
        if (/^video\//.test(mime)) return 'video';
        if (/^audio\//.test(mime)) return 'ljudfil';
        var t = TYPES[Number(row.type)];
        return t === 'bild' || t === 'video' ? t : 'fil';
    }

    function chatName(row) {
        return row.chatName || (row.chatId != null ? 'chatt ' + row.chatId : 'okänd chatt');
    }

    // Motparten: chatten för ett skickat, avsändaren för ett mottaget (och gruppen om det är en grupp).
    function counterpart(row) {
        var chat = chatName(row);
        var group = Number(row.sessionType) === 1;
        if (Number(row.fromMe) === 1) return group ? 'gruppen ' + chat : chat;
        var who = row.sender && row.sender !== 'den här telefonen' ? row.sender : chat;
        return group && who !== chat ? who + ' i gruppen ' + chat : who;
    }

    // Mediefiler som hör till filen. ctx: { sha256 (hex), uuid (Photos ZUUID), path (sökvägen i zippen) }.
    function match(ctx, media) {
        var sha = String(ctx.sha256 || '').toLowerCase();
        var uuid = String(ctx.uuid || '').toUpperCase();
        var path = String(ctx.path || '');
        var out = [];
        (media || []).forEach(function (m) {
            var by = [];
            if (/^[0-9a-f]{64}$/.test(sha) && m.sha256 && b64ToHex(m.sha256) === sha) by.push('sha256');
            if (uuid && m.assetUuid && String(m.assetUuid).toUpperCase() === uuid) by.push('asset');
            if (path && m.path && path.slice(-(m.path.length + 9)) === '/Message/' + m.path) by.push('path');
            if (by.length) out.push({ row: m, by: by });
        });
        return out;
    }

    // En bild som WhatsApp sparat i bildbiblioteket, tagen med WhatsApps kamera: det första skickade
    // meddelandet med en bild eller video från filens skapandetid och en minut framåt, som inte valts
    // ur bildbiblioteket. Bara tiden binder ihop dem.
    function nearby(ctx, media) {
        var T = ctx.createdMs;
        if (!ctx.savedByWhatsApp || T == null) return [];
        return (media || []).filter(function (m) {
            var k = kindOf(m);
            return Number(m.fromMe) === 1 && !m.assetUuid && (k === 'bild' || k === 'video') && m.sentMs != null && m.sentMs >= T - 1000 && m.sentMs - T <= NEARBY_MS;
        }).sort(function (a, b) { return a.sentMs - b.sentMs; }).slice(0, 1);
    }

    // ctx: { sha256, uuid, path, createdMs, savedByWhatsApp, media, messages, sources: { main }, centerMs,
    //        keep(ms), wall(ms) }. Returnerar { events, notes, link }.
    function build(ctx) {
        var events = [];
        var notes = [];
        var srcMain = ctx.sources && ctx.sources.main || { db: 'ChatStorage.sqlite', table: 'ZWAMESSAGE', queryId: 'role-messages' };
        var media = ctx.media || [];
        var byMessage = {};
        media.forEach(function (m) { byMessage[m.messageId] = m; });
        var matches = match(ctx, media);
        // En bild som valts ur biblioteket och skickats kan också ha skickats direkt med kameran.
        var onlyPicks = matches.every(function (x) { return Number(x.row.fromMe) === 1 && x.by.length === 1 && x.by[0] === 'asset'; });
        var near = onlyPicks ? nearby(ctx, media) : [];
        var fileMessages = {};
        matches.forEach(function (x) { fileMessages[x.row.messageId] = true; });
        var nearMessages = {};
        near.forEach(function (m) { nearMessages[m.messageId] = true; });

        (ctx.messages || []).forEach(function (m) {
            var type = Number(m.type);
            if (type === 10) return;
            var own = Number(m.fromMe) === 1;
            var ms = own && m.sentMs != null ? m.sentMs : m.dateMs;
            if (ms == null) return;
            var item = m.mediaId != null ? byMessage[m.id] || null : null;
            var hasFile = !!(item && (item.path || item.size > 0));
            var what = hasFile ? kindOf(item) : typeName(type) === 'text' ? 'meddelande' : typeName(type);
            var who = counterpart(m);
            var isFile = !!fileMessages[m.id];
            var near1 = !!nearMessages[m.id];
            // Bibliotekets id i ett mottaget meddelande betyder att bilden sparades dit, inte att den valdes därifrån.
            var fromLibrary = !!(own && item && item.assetUuid);
            var savedThere = !!(!own && item && item.assetUuid);
            var once = isViewOnce(type);
            var verb = NEUTER[what] ? (own ? 'skickat till ' : 'mottaget från ') : (own ? 'skickad till ' : 'mottagen från ');
            var text = 'WhatsApp: ' + what + ' ' + verb + who + ' (meddelande ' + m.id + ')' + (fromLibrary ? ', vald ur bildbiblioteket' : '') + (savedThere ? ', sparad i bildbiblioteket' : '') + (once ? ', engångsvisning' : '');
            var noun = hasFile ? (what === 'video' ? 'En video' : what === 'bild' ? 'En bild' : 'En fil') : null;
            var plain = noun ? (own ? noun + ' skickas från den här telefonen i WhatsApp till ' + who + (fromLibrary ? ' (vald ur bildbiblioteket)' : '') : noun + ' tas emot i WhatsApp från ' + who) + (once ? ' för engångsvisning' : '') : null;
            if (isFile) { text = 'Den bedömda filen: ' + text; plain = own ? 'Den bedömda filen skickas från den här telefonen i WhatsApp till ' + who : 'Den bedömda filen tas emot i WhatsApp från ' + who; }
            else if (near1) { text += '; skickad strax efter att den bedömda filen skapades'; }
            events.push({ ms: ms, kind: 'wa-message', lane: 'whatsapp', app: APP, own: own, bold: isFile, isFile: isFile, near: near1, messageId: m.id, media: hasFile ? 1 : 0, mediaKind: hasFile ? what : null, fromLibrary: fromLibrary, viewOnce: once,
                active: own, activeText: own ? 'ett meddelande skickades' : null,
                text: text, plain: plain, source: Object.assign({}, srcMain, { column: own ? 'ZSENTDATE' : 'ZMESSAGEDATE' }) });
        });

        // Meddelanden som tillägget tog emot i bakgrunden men som inte finns i databasen.
        var known = {};
        (ctx.stanzaIds || []).forEach(function (id) { known[String(id)] = true; });
        var pending = (ctx.extensionLog || []).filter(function (r) { return !known[r.stanzaId]; });
        pending.forEach(function (r) {
            events.push({ ms: r.ms, kind: 'wa-pending', lane: 'whatsapp', app: APP, own: false, bold: false, isFile: false, near: false, messageId: r.stanzaId, media: r.kind === 'media' ? 1 : 0, active: false,
                text: 'WhatsApp: ' + (r.kind === 'media' ? 'meddelande med media' : 'meddelande') + ' mottaget i bakgrunden (id ' + r.stanzaId + '), finns inte i ChatStorage.sqlite',
                plain: (r.kind === 'media' ? 'Ett meddelande med media' : 'Ett meddelande') + ' tas emot i WhatsApp i bakgrunden. Det finns inte i databasen',
                source: { db: r.file || 'ServiceExtension-loggen', table: 'xmpp//< recv <', column: 'id' } });
        });

        if (typeof ctx.keep === 'function') events = events.filter(function (e) { return ctx.keep(e.ms); });
        events.sort(function (a, b) { return a.ms - b.ms; });
        if (events.length > MAX_EVENTS) {
            var center = ctx.centerMs != null ? ctx.centerMs : events[0].ms;
            var kept = events.filter(function (e) { return e.isFile || e.near; });
            events.filter(function (e) { return !e.isFile && !e.near; }).sort(function (a, b) { return Math.abs(a.ms - center) - Math.abs(b.ms - center); })
                .forEach(function (e) { if (kept.length < MAX_EVENTS) kept.push(e); });
            notes.push((events.length - kept.length) + ' WhatsApp-händelser till i fönstret visas inte.');
            events = kept.sort(function (a, b) { return a.ms - b.ms; });
        }

        var row = function (m, by) {
            return {
                mediaId: m.id, messageId: m.messageId, by: by || [], direction: Number(m.fromMe) === 1 ? 'out' : 'in', who: counterpart(m), chat: chatName(m),
                kind: kindOf(m), mime: m.mime || null, size: m.size, path: m.path ? 'Message/' + m.path : null, assetUuid: m.assetUuid || null,
                sentMs: m.sentMs, dateMs: m.dateMs, uploadMs: m.uploadMs, viewOnce: isViewOnce(m.type),
            };
        };
        var link = {
            matches: matches.map(function (x) { return row(x.row, x.by); }),
            nearby: near.map(function (m) { return Object.assign(row(m), { afterMs: m.sentMs - ctx.createdMs }); }),
            media: media.filter(function (m) { return m.path || m.size > 0; }).length,
            pending: pending.length,
        };
        return { events: events, notes: notes, link: link };
    }

    // Tilläggets logg (Logs/ServiceExtension_*/whatsapp-….log): meddelanden som togs emot medan appen var
    // stängd eller telefonen låst. De köas och skrivs till ChatStorage.sqlite först när appen öppnas
    // (labbet: en bild med låst telefon 2026-11-04). Raderna har klockslag utan datum, i telefonens zon:
    // zonen räknas ut ur filens ändringstid (zippen) och loggens sista klockslag.
    // opts: { name (filnamnet, med ÅÅÅÅ-MM-DD-TT-MM-SS), mtimeMs }. Returnerar [{ ms, kind, stanzaId, file }].
    function parseExtensionLog(text, opts) {
        var name = /whatsapp-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/.exec(opts.name || '');
        if (!name) return [];
        var day = Date.UTC(Number(name[1]), Number(name[2]) - 1, Number(name[3]));
        var startOfDay = Number(name[4]) * 3600000 + Number(name[5]) * 60000 + Number(name[6]) * 1000;
        var lines = String(text || '').split(/\r?\n/);
        var rows = [];
        var last = null;
        var seen = {};
        lines.forEach(function (l) {
            var t = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) /.exec(l);
            if (!t) return;
            var ofDay = Number(t[1]) * 3600000 + Number(t[2]) * 60000 + Number(t[3]) * 1000 + Number(t[4]);
            // En logg som går över midnatt börjar om på klockslagen.
            var local = day + ofDay + (ofDay < startOfDay - 60000 ? 86400000 : 0);
            last = local;
            var m = /xmpp\/\/< recv < \[(media|msg|message|text)\/ id=([0-9A-Za-z]+)/.exec(l);
            if (m && !seen[m[2]]) {
                seen[m[2]] = true;
                rows.push({ local: local, kind: m[1] === 'media' ? 'media' : 'text', stanzaId: m[2] });
            }
        });
        if (!rows.length || last == null || opts.mtimeMs == null) return [];
        var offset = Math.round((last - opts.mtimeMs) / 900000) * 900000;
        return rows.map(function (r) { return { ms: r.local - offset, kind: r.kind, stanzaId: r.stanzaId, file: String(opts.name).split('/').pop() }; });
    }

    // En mening om en mediefil som hittats på sin summa (hashsökningen).
    function mediaText(m, wall) {
        wall = wall || function (ms) { return new Date(ms).toISOString(); };
        var own = Number(m.fromMe) === 1;
        var when = own ? (m.sentMs != null ? m.sentMs : m.dateMs) : m.dateMs;
        return 'WhatsApp-' + kindOf(m) + ' (' + (m.mime || 'okänd typ') + (m.size != null ? ', ' + m.size + ' byte' : '') + ') i meddelande ' + m.messageId + ', ' +
            (own ? 'skickad till ' : 'mottagen från ') + counterpart(m) + (when != null ? ' ' + wall(when) : '') + '.' +
            (m.path ? ' Filen ligger under Message/' + m.path + '.' : ' Filen finns inte på telefonen.');
    }

    // ---------- Android ----------
    // msgstore.db, kontrollerad mot en labbtelefon (Android 16, WhatsApp 2.26.43, 2026-11-11). Filen kopplas till
    // WhatsApp på tre sätt som binder: samma SHA-256 som mediefilen (message_media.file_hash, base64), samma SHA-256
    // som originalet till en bild som togs i appen och skickades omkodad (original_file_hash), eller filen själv
    // under WhatsApp/Media/ (file_path). WhatsApps mediefiler står också i telefonens bildbibliotek (MediaStore).

    var APP_ANDROID = 'com.whatsapp';
    // message_type med samma namn som i katalogens queryer: 0, 1, 2, 3, 7, 9 och 15 är sedda i labbet, resten är vanliga tolkningar.
    var TYPES_ANDROID = { 0: 'meddelande', 1: 'bild', 2: 'ljudfil', 3: 'video', 4: 'kontaktkort', 5: 'plats', 7: 'systemmeddelande', 9: 'dokument', 10: 'missat samtal',
        13: 'gif', 14: 'kontaktkort', 15: 'meddelande', 16: 'plats i realtid', 20: 'klistermärke', 42: 'bild', 43: 'video' };
    var MEDIA_TYPES_ANDROID = { 1: 1, 2: 1, 3: 1, 9: 1, 13: 1, 20: 1, 42: 1, 43: 1 };
    var NEUTER_ANDROID = { meddelande: 1, kontaktkort: 1, dokument: 1, 'röstmeddelande': 1, 'klistermärke': 1, systemmeddelande: 1 };

    function isViewOnceAndroid(t) { return Number(t) === 42 || Number(t) === 43; }

    function kindOfAndroid(row) {
        var mime = String(row.mime || '');
        var t = Number(row.type);
        if (Number(row.voice) === 1) return 'röstmeddelande';
        if (/^image\//.test(mime)) return t === 20 ? 'klistermärke' : 'bild';
        if (/^video\//.test(mime)) return t === 13 ? 'gif' : 'video';
        if (/^audio\//.test(mime)) return 'ljudfil';
        var n = TYPES_ANDROID[t];
        return n && MEDIA_TYPES_ANDROID[t] ? n : 'fil';
    }

    function nameAndroid(jid, names) { return jid && names && names[jid] ? names[jid] : jid; }

    // Gruppens namn står i msgstore.db. En enskild chatt heter som kontakten i wa.db, annars som sitt JID.
    function chatNameAndroid(row, names) {
        return row.chatSubject || nameAndroid(row.chatJid, names) || (row.chatId != null ? 'chatt ' + row.chatId : 'okänd chatt');
    }

    function counterpartAndroid(row, names) {
        var chat = chatNameAndroid(row, names);
        var group = Number(row.group) === 1;
        if (Number(row.fromMe) === 1) return group ? 'gruppen ' + chat : chat;
        var who = row.sender && row.sender !== 'den här telefonen' ? nameAndroid(row.sender, names) : chat;
        return group && who !== chat ? who + ' i gruppen ' + chat : who;
    }

    // Tiden på den här telefonen: när ett skickat meddelande skrevs, när ett mottaget kom in.
    function whenAndroid(m) { return Number(m.fromMe) !== 1 && m.receivedMs != null ? m.receivedMs : m.dateMs; }

    function verbAndroid(what, own, asDocument) {
        var n = NEUTER_ANDROID[what] || /^meddelande/.test(what);
        return (own ? (n ? 'skickat' : 'skickad') : (n ? 'mottaget' : 'mottagen')) + (asDocument ? ' som dokument' : '') + (own ? ' till ' : ' från ');
    }

    // Mediefiler som hör till filen. ctx: { sha256 (hex), path (sökvägen i zippen) }.
    function matchAndroid(ctx, media) {
        var sha = String(ctx.sha256 || '').toLowerCase();
        var okSha = /^[0-9a-f]{64}$/.test(sha);
        var path = String(ctx.path || '');
        var out = [];
        (media || []).forEach(function (m) {
            var by = [];
            if (okSha && m.sha256 && b64ToHex(m.sha256) === sha) by.push('sha256');
            if (okSha && m.original && b64ToHex(m.original) === sha) by.push('original');
            if (path && m.path && /^Media\//.test(m.path) && path.slice(-(m.path.length + 10)) === '/WhatsApp/' + m.path) by.push('path');
            if (by.length) out.push({ row: m, by: by });
        });
        return out;
    }

    // ctx: { sha256, path, media, messages, names ({ jid: namn } ur wa.db), sources: { main }, centerMs, keep(ms) }.
    // Returnerar { events, notes, link } som build, med link.android satt.
    function buildAndroid(ctx) {
        var events = [];
        var notes = [];
        var names = ctx.names || {};
        var srcMain = ctx.sources && ctx.sources.main || { db: 'msgstore.db', table: 'message', queryId: 'role-messages' };
        var media = ctx.media || [];
        var byMessage = {};
        media.forEach(function (m) { byMessage[m.messageId] = m; });
        var matches = matchAndroid(ctx, media);
        var fileMessages = {};
        matches.forEach(function (x) { fileMessages[x.row.messageId] = x.by; });

        (ctx.messages || []).forEach(function (m) {
            var type = Number(m.type);
            if (type === 7) return;
            var own = Number(m.fromMe) === 1;
            var ms = whenAndroid(m);
            if (ms == null) return;
            var item = m.mediaId != null ? byMessage[m.id] || null : null;
            var hasFile = !!(item && MEDIA_TYPES_ANDROID[type] && (item.path || item.size > 0 || item.sha256));
            var what = hasFile ? kindOfAndroid(item) : TYPES_ANDROID[type] || 'meddelande av typ ' + type;
            var asDocument = hasFile && type === 9 && what !== 'dokument' && what !== 'fil';
            var who = counterpartAndroid(m, names);
            var by = fileMessages[m.id] || null;
            var isFile = !!by;
            // Summan är originalets: det som skickades är en kopia gjord av den bedömda filen.
            var original = isFile && by.length === 1 && by[0] === 'original';
            var once = isViewOnceAndroid(type);
            var notFetched = hasFile && !item.path && Number(item.transferred) === 0;
            var text = 'WhatsApp: ' + what + ' ' + (type === 10 ? (own ? 'till ' : 'från ') : verbAndroid(what, own, asDocument)) + who + ' (meddelande ' + m.id + ')' +
                (type === 15 ? ', raderat för alla' : '') + (once ? ', engångsvisning' : '') + (notFetched ? ', inte hämtad till telefonen' : '');
            var noun = hasFile ? (what === 'video' ? 'En video' : what === 'bild' ? 'En bild' : what === 'röstmeddelande' ? 'Ett röstmeddelande' : 'En fil') : null;
            var plain = noun ? (own ? noun + ' skickas från den här telefonen i WhatsApp till ' + who : noun + ' tas emot i WhatsApp från ' + who) + (once ? ' för engångsvisning' : '') : null;
            if (original) { text += '; den bedömda filen är originalet till den'; plain = 'En kopia av den bedömda filen skickas från den här telefonen i WhatsApp till ' + who; }
            else if (isFile) { text = 'Den bedömda filen: ' + text; plain = own ? 'Den bedömda filen skickas från den här telefonen i WhatsApp till ' + who : 'Den bedömda filen tas emot i WhatsApp från ' + who; }
            events.push({ ms: ms, kind: 'wa-message', lane: 'whatsapp', app: APP_ANDROID, own: own, bold: isFile, isFile: isFile, near: false, messageId: m.id, media: hasFile ? 1 : 0, mediaKind: hasFile ? what : null, fromLibrary: false, viewOnce: once,
                active: own, activeText: own ? 'ett meddelande skickades' : null,
                text: text, plain: plain, source: Object.assign({}, srcMain, { column: !own && m.receivedMs != null ? 'received_timestamp' : 'timestamp' }) });
        });

        if (typeof ctx.keep === 'function') events = events.filter(function (e) { return ctx.keep(e.ms); });
        events.sort(function (a, b) { return a.ms - b.ms; });
        if (events.length > MAX_EVENTS) {
            var center = ctx.centerMs != null ? ctx.centerMs : events[0].ms;
            var kept = events.filter(function (e) { return e.isFile; });
            events.filter(function (e) { return !e.isFile; }).sort(function (a, b) { return Math.abs(a.ms - center) - Math.abs(b.ms - center); })
                .forEach(function (e) { if (kept.length < MAX_EVENTS) kept.push(e); });
            notes.push((events.length - kept.length) + ' WhatsApp-händelser till i fönstret visas inte.');
            events = kept.sort(function (a, b) { return a.ms - b.ms; });
        }

        var link = {
            matches: matches.map(function (x) {
                var m = x.row;
                var own = Number(m.fromMe) === 1;
                return {
                    mediaId: m.messageId, messageId: m.messageId, by: x.by, direction: own ? 'out' : 'in', who: counterpartAndroid(m, names), chat: chatNameAndroid(m, names),
                    kind: kindOfAndroid(m), document: Number(m.type) === 9, mime: m.mime || null, size: m.size != null ? Number(m.size) : null, path: m.path ? 'WhatsApp/' + m.path : null, assetUuid: null,
                    sentMs: own ? m.dateMs : null, dateMs: whenAndroid(m), writtenMs: m.dateMs, uploadMs: null, viewOnce: isViewOnceAndroid(m.type), fetched: !!m.path || Number(m.transferred) !== 0,
                };
            }),
            nearby: [],
            media: media.filter(function (m) { return m.path || m.size > 0; }).length,
            pending: 0,
            android: true,
            shaKnown: /^[0-9a-f]{64}$/i.test(String(ctx.sha256 || '')),
        };
        return { events: events, notes: notes, link: link };
    }

    // En mening om en mediefil som hittats på sin summa (hashsökningen). by: 'sha256' eller 'original'.
    function mediaTextAndroid(m, wall, by, names) {
        wall = wall || function (ms) { return new Date(ms).toISOString(); };
        var own = Number(m.fromMe) === 1;
        var what = kindOfAndroid(m);
        var when = whenAndroid(m);
        return 'WhatsApp-' + what + ' (' + (m.mime || 'okänd typ') + (m.size != null ? ', ' + m.size + ' byte' : '') + ') i meddelande ' + m.messageId + ', ' +
            verbAndroid(what, own, false) + counterpartAndroid(m, names) + (when != null ? ' ' + wall(when) : '') + '.' +
            (by === 'original' ? ' Summan är originalets (original_file_hash): det som skickades är en kopia gjord av filen.' : '') +
            (m.path ? ' ' + (by === 'original' ? 'Kopian' : 'Filen') + ' ligger under WhatsApp/' + m.path + '.' : ' Filen hämtades aldrig till telefonen.');
    }

    var api = {
        APP: APP, APP_BUSINESS: APP_BUSINESS, isWhatsAppApp: isWhatsAppApp, b64ToHex: b64ToHex, hexToB64: hexToB64, typeName: typeName, kindOf: kindOf,
        counterpart: counterpart, match: match, nearby: nearby, build: build, mediaText: mediaText, parseExtensionLog: parseExtensionLog, isViewOnce: isViewOnce, NEARBY_MS: NEARBY_MS,
        APP_ANDROID: APP_ANDROID, kindOfAndroid: kindOfAndroid, counterpartAndroid: counterpartAndroid, matchAndroid: matchAndroid, buildAndroid: buildAndroid, mediaTextAndroid: mediaTextAndroid,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceWhatsApp = api;
})(typeof window !== 'undefined' ? window : this);
