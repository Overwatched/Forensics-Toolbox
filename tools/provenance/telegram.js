// Telegram som källa i Härkomst (iOS). Betafunktion: tolkningarna är kontrollerade mot en labbtelefon
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
        var near = matches.length || pickRows.length ? [] : nearby(ctx, fromLibrary);
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

    var api = {
        APP: APP, isTelegramApp: isTelegramApp, isCameraName: isCameraName, kindOf: kindOf, counterpart: counterpart, resourceFromPath: resourceFromPath,
        match: match, picks: picks, nearby: nearby, libraryMessages: libraryMessages, build: build, NEARBY_MS: NEARBY_MS,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceTelegram = api;
})(typeof window !== 'undefined' ? window : this);
