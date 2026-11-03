// WhatsApp som källa i Härkomst (iOS). Betafunktion: tolkningarna är kontrollerade mot en labbtelefon
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
    var TYPES = { 0: 'text', 1: 'bild', 2: 'video', 3: 'ljud', 4: 'kontaktkort', 5: 'plats', 8: 'dokument', 10: 'systemmeddelande' };
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
        var near = matches.length ? [] : nearby(ctx, media);
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
            var fromLibrary = !!(item && item.assetUuid);
            var verb = NEUTER[what] ? (own ? 'skickat till ' : 'mottaget från ') : (own ? 'skickad till ' : 'mottagen från ');
            var text = 'WhatsApp: ' + what + ' ' + verb + who + ' (meddelande ' + m.id + ')' + (fromLibrary ? ', vald ur bildbiblioteket' : '');
            var noun = hasFile ? (what === 'video' ? 'En video' : what === 'bild' ? 'En bild' : 'En fil') : null;
            var plain = noun ? (own ? noun + ' skickas från den här telefonen i WhatsApp till ' + who + (fromLibrary ? ' (vald ur bildbiblioteket)' : '') : noun + ' tas emot i WhatsApp från ' + who) : null;
            if (isFile) { text = 'Den bedömda filen: ' + text; plain = own ? 'Den bedömda filen skickas från den här telefonen i WhatsApp till ' + who : 'Den bedömda filen tas emot i WhatsApp från ' + who; }
            else if (near1) { text += '; skickad strax efter att den bedömda filen skapades'; }
            events.push({ ms: ms, kind: 'wa-message', lane: 'whatsapp', app: APP, own: own, bold: isFile, isFile: isFile, near: near1, messageId: m.id, media: hasFile ? 1 : 0, fromLibrary: fromLibrary,
                active: own, activeText: own ? 'ett meddelande skickades' : null,
                text: text, plain: plain, source: Object.assign({}, srcMain, { column: own ? 'ZSENTDATE' : 'ZMESSAGEDATE' }) });
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
                sentMs: m.sentMs, dateMs: m.dateMs, uploadMs: m.uploadMs,
            };
        };
        var link = {
            matches: matches.map(function (x) { return row(x.row, x.by); }),
            nearby: near.map(function (m) { return Object.assign(row(m), { afterMs: m.sentMs - ctx.createdMs }); }),
            media: media.filter(function (m) { return m.path || m.size > 0; }).length,
        };
        return { events: events, notes: notes, link: link };
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

    var api = {
        APP: APP, APP_BUSINESS: APP_BUSINESS, isWhatsAppApp: isWhatsAppApp, b64ToHex: b64ToHex, hexToB64: hexToB64, typeName: typeName, kindOf: kindOf,
        counterpart: counterpart, match: match, nearby: nearby, build: build, mediaText: mediaText, NEARBY_MS: NEARBY_MS,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceWhatsApp = api;
})(typeof window !== 'undefined' ? window : this);
