// Signal som källa i Härkomst. Betafunktion: tolkningarna är kontrollerade mot en Android-
// labbtelefon (Android 13, Signal 8.33) och en verklig extraktion (Signal 8.10), och kan
// skilja sig mellan versioner, därför bär varje händelse databas, tabell, kolumn och query.
// Signals databaser är krypterade (SQLCipher) och dekrypteras i minnet innan rollqueryerna körs.
// Här tolkas bilagornas SHA-256 (originalet före Signals omkodning och den lagrade filen),
// meddelandenas riktning och tider och raderna i Signals logg, och det hela blir händelser till
// tidslinjen och kopplingen mellan den bedömda filen och Signal. Ingen DOM, ingen SQL. Testas i Node.
(function (root) {
    'use strict';

    var APP = 'org.thoughtcrime.securesms';
    var MAX_EVENTS = 40;
    var SAVE_LINK_MS = 10000;   // en sparad bilaga hör till en fil i galleriet som lades till inom så här lång tid (sett: under en sekund)
    var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

    function isSignalApp(id) { return id === APP; }

    // SHA-256 i base64 (som i databasen) till hex.
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

    // message.type & 31: 20 mottaget, 21–26 utgående (23 skickat), 27 utkast.
    function direction(type) {
        var b = Number(type) & 31;
        return b === 20 ? 'in' : b >= 21 && b <= 26 ? 'out' : b === 27 ? 'draft' : null;
    }

    function kindOf(contentType) {
        var c = String(contentType || '');
        return /^image\//.test(c) ? 'bild' : /^video\//.test(c) ? 'video' : /^audio\//.test(c) ? 'ljudfil' : 'fil';
    }

    function recipientName(ctx, id) {
        var r = (ctx.recipients || {})[String(id)];
        if (!r) return id != null ? 'mottagare ' + id : 'okänd';
        return r.groupTitle || r.name || 'mottagare ' + id;
    }

    // Konversationens namn: gruppens titel, annars personen.
    function threadName(ctx, row) {
        var r = (ctx.recipients || {})[String(row.threadRecipient)];
        if (r && r.groupTitle) return { name: r.groupTitle, group: true };
        return { name: recipientName(ctx, row.threadRecipient), group: false };
    }

    // Motparten i ett meddelande: mottagaren för ett skickat, avsändaren för ett mottaget.
    function counterpart(ctx, row) {
        var dir = direction(row.type);
        var conv = threadName(ctx, row);
        if (dir === 'out') return conv.group ? 'gruppen ' + conv.name : recipientName(ctx, row.toId != null ? row.toId : row.threadRecipient);
        return recipientName(ctx, row.fromId) + (conv.group ? ' i gruppen ' + conv.name : '');
    }

    // Filnamnet när Signal sparar en bilaga till galleriet: signal-ÅÅÅÅ-MM-DD-TT-MM-SS-mmm.ext
    // (Signal 8, sett) eller signal-ÅÅÅÅ-MM-DD-TTMMSS.ext (äldre versioner). Tiden är
    // meddelandets date_sent i telefonens zon, alltså avsändarens klocka för ett mottaget.
    function savedNameTime(filename) {
        var n = String(filename || '');
        var m = /^signal-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{3})\.[A-Za-z0-9]+$/.exec(n);
        if (m) return { text: m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6] + '.' + m[7], ms: true };
        m = /^signal-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.[A-Za-z0-9]+$/.exec(n);
        if (m) return { text: m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6], ms: false };
        return null;
    }

    // Bilagor vars original eller lagrade fil har filens SHA-256.
    function match(sha256Hex, attachments) {
        var want = String(sha256Hex || '').toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(want)) return [];
        var out = [];
        (attachments || []).forEach(function (a) {
            var s = b64ToHex(a.hashStart), e = b64ToHex(a.hashEnd);
            var onStart = s === want, onEnd = e === want;
            if (!onStart && !onEnd) return;
            out.push({ row: a, on: onStart && onEnd ? 'both' : onStart ? 'start' : 'end', transformed: !!(s && e && s !== e) });
        });
        return out;
    }

    // ---------- Signals logg ----------

    // content:// i "Inserting attachment …": var bilagan kom ifrån.
    function uriInfo(uri) {
        var u = String(uri || '');
        var m = /^content:\/\/media\/external\/(images|video|audio|file)\/media\/(\d+)/.exec(u);
        if (m) return { source: 'gallery', mediaId: Number(m[2]), mime: m[1] === 'images' ? 'image' : m[1] === 'video' ? 'video' : m[1] };
        m = /^content:\/\/com\.android\.providers\.media\.documents\/document\/(image|video|audio|document)%3A(\d+)/.exec(u);
        if (m) return { source: 'documents', mediaId: Number(m[2]), mime: m[1] };
        m = /^content:\/\/org\.thoughtcrime\.securesms\.blob\/blob\/([\w-]+)\/([^/]+)\/([^/]+)\/(\d+)\//.exec(u);
        if (m) return { source: 'capture', store: m[1], mime: decodeURIComponent(m[2]), size: Number(m[4]) };
        m = /^content:\/\/org\.thoughtcrime\.securesms\/part\/(\d+)/.exec(u);
        if (m) return { source: 'attachment', partId: Number(m[1]) };
        return { source: 'other', uri: u };
    }

    // Raden utan Signals huvud ("[8.33.2] [tråd] 2026-11-02 18:47:59.420 GMT+01:00 D ").
    function lineText(body) {
        var s = String(body || '');
        var m = /^\[[^\]]*\]\s*\[[^\]]*\]\s*\S+\s+\S+\s+GMT\S*\s+\w\s+/.exec(s);
        return m ? s.slice(m[0].length) : s;
    }

    // Loggraderna (created_at, body) till händelser. Kopplar ihop "Inserting attachment <uri>"
    // med "Inserted attachment at AttachmentId::N" och märker en förhandsuppladdning som togs
    // bort igen (t.ex. när bilden redigerades och en ny version lades in).
    function parseLog(rows) {
        var out = [];
        var lastPick = null;
        var byAttachment = {};
        (rows || []).forEach(function (r) {
            var ms = Number(r.timeMs != null ? r.timeMs : r.time);
            var t = lineText(r.body);
            var m;
            if (/BaseActivity: \[MediaSendV3Activity\] onCreate\(\)/.test(t)) out.push({ ms: ms, kind: 'open' });
            else if (/BaseActivity: \[MediaViewerActivity\] onCreate\(\)/.test(t)) out.push({ ms: ms, kind: 'viewer' });
            else if (/CameraScreenViewModel: \[Event\] SwitchCamera/.test(t)) out.push({ ms: ms, kind: 'switch-camera' });
            else if (/CameraScreenViewModel: Video recording started/.test(t)) out.push({ ms: ms, kind: 'video-start' });
            else if ((m = /CameraScreenViewModel: Video recording succeeded\. bytes: (\d+)/.exec(t))) out.push({ ms: ms, kind: 'video', bytes: Number(m[1]) });
            else if ((m = /AttachmentTable: Inserting attachment (content:\/\/\S+) for pre-upload/.exec(t)) || (m = /\[insertAttachmentWithData\] Inserting attachment for messageId (?:-?\d+)\. \(MessageId: -?\d+, (content:\/\/[^)\s]+)\)/.exec(t))) {
                // Samma uri står på två rader i följd; bara den första blir en händelse.
                if (lastPick && lastPick.uri === m[1] && ms - lastPick.ms < 2000) return;
                lastPick = Object.assign({ ms: ms, kind: 'pick', uri: m[1], attachmentId: null, discarded: false }, uriInfo(m[1]));
                out.push(lastPick);
            } else if ((m = /Inserted attachment at AttachmentId::(\d+)/.exec(t))) {
                if (lastPick && lastPick.attachmentId == null && ms - lastPick.ms < 5000) { lastPick.attachmentId = Number(m[1]); byAttachment[m[1]] = lastPick; }
            } else if ((m = /\[deleteAttachment\] attachmentId: AttachmentId::(\d+)/.exec(t))) {
                if (byAttachment[m[1]]) byAttachment[m[1]].discarded = true;
                out.push({ ms: ms, kind: 'discard', attachmentId: Number(m[1]) });
            } else if ((m = /IndividualSendJobV2: \[(\d+)\]\[(\d+)\] Sent message\./.exec(t))) out.push({ ms: ms, kind: 'sent', sentMs: Number(m[1]), messageId: Number(m[2]), group: false });
            else if ((m = /PushGroupSendJob: .*\[(\d+)\] Sending message: (\d+)/.exec(t))) out.push({ ms: ms, kind: 'sent', sentMs: Number(m[1]), messageId: Number(m[2]), group: true });
            else if ((m = /AttachmentDownloadJob: onAdded\(\) messageId: (\d+)\s+attachmentId: AttachmentId::(\d+)/.exec(t))) out.push({ ms: ms, kind: 'download', messageId: Number(m[1]), attachmentId: Number(m[2]) });
            else if ((m = /AttachmentSaver: Saving (\d+) attachments? to device storage/.exec(t))) out.push({ ms: ms, kind: 'save', count: Number(m[1]) });
            else if ((m = /SaveAttachmentUtil: Save attachments completed \((\d+) of (\d+) saved successfully\)/.exec(t))) out.push({ ms: ms, kind: 'saved', saved: Number(m[1]), of: Number(m[2]) });
            else if ((m = /\[deleteAttachmentsForMessage\] mmsId: (\d+)/.exec(t))) out.push({ ms: ms, kind: 'delete', messageId: Number(m[1]), forAll: false });
            else if (/RemoteDeleteSendJob\] onSubmit\(\)/.test(t)) out.push({ ms: ms, kind: 'remote-delete' });
            else if ((m = /matches the DATA_HASH_START of AttachmentId::(\d+)/.exec(t))) out.push({ ms: ms, kind: 'reuse', templateId: Number(m[1]) });
            else if (/MultiselectForwardActiv: State change: SendPending/.test(t)) out.push({ ms: ms, kind: 'forward' });
        });
        // "Radera för alla": bilagorna tas bort och RemoteDeleteSendJob skickas inom en sekund.
        out.forEach(function (e, i) {
            if (e.kind !== 'delete') return;
            e.forAll = out.some(function (x) { return x.kind === 'remote-delete' && Math.abs(x.ms - e.ms) <= 1500; });
        });
        // En bild från Signals kamera som lades in, togs bort och ersattes av en ny blob inom samma
        // session är en redigering: den nya bilagan är den redigerade versionen.
        out.forEach(function (e, i) {
            if (e.kind !== 'pick' || e.source !== 'capture' || e.discarded) return;
            var before = out.slice(0, i).reverse().find(function (x) { return x.kind === 'pick' && e.ms - x.ms < 120000; });
            if (before && before.discarded && before.source === 'capture') { e.edited = true; e.original = before; before.replacedByEdit = true; }
        });
        return out.filter(function (e) { return e.kind !== 'remote-delete'; });
    }

    // ---------- Kopplingen och händelserna ----------

    // ctx: { sha256, mediaId, fileName, fileAddedMs, savedBySignal, attachments, messages, recipients,
    //        log, sources: { main, log }, centerMs, wall(ms) -> 'ÅÅÅÅ-MM-DD TT:MM:SS.mmm' i vald zon }
    // Returnerar { events, notes, link }.
    function build(ctx) {
        var events = [];
        var notes = [];
        var srcMain = ctx.sources && ctx.sources.main || { db: 'signal.db', table: 'message', queryId: 'role-messages' };
        var srcAtt = Object.assign({}, srcMain, { table: 'attachment + message', queryId: ctx.sources && ctx.sources.attachmentsQueryId || 'role-attachments' });
        var srcLog = ctx.sources && ctx.sources.log || { db: 'signal-logs.db', table: 'log', queryId: 'role-log' };
        var wall = ctx.wall || function (ms) { return new Date(ms).toISOString().replace('T', ' ').replace('Z', ''); };
        var attachments = ctx.attachments || [];
        var byMessage = {};
        attachments.forEach(function (a) { (byMessage[a.messageId] = byMessage[a.messageId] || []).push(a); });

        var matches = match(ctx.sha256, attachments);
        var matchedMessages = {};
        matches.forEach(function (x) { matchedMessages[x.row.messageId] = true; });
        var log = parseLog(ctx.log);
        var picks = ctx.mediaId != null ? log.filter(function (e) { return e.kind === 'pick' && e.mediaId === Number(ctx.mediaId); }) : [];
        var sentByMessage = {};
        log.forEach(function (e) { if (e.kind === 'sent') sentByMessage[e.messageId] = e; });
        var attById = {};
        attachments.forEach(function (a) { attById[a.id] = a; });
        // Valet i galleriet leder till en bilaga, och bilagan till ett meddelande (eller inte, om det raderats).
        picks.forEach(function (p) {
            var a = p.attachmentId != null ? attById[p.attachmentId] : null;
            p.messageId = a ? a.messageId : null;
            if (p.messageId != null) matchedMessages[p.messageId] = true;
            if (p.messageId == null && p.attachmentId != null) {
                // Utan bilaga kvar: meddelandet som skickades närmast efter valet (inom två minuter), ur loggen.
                var sent = log.find(function (e) { return e.kind === 'sent' && e.ms >= p.ms && e.ms - p.ms <= 120000 && !log.some(function (x) { return x.kind === 'pick' && x !== p && x.ms > p.ms && x.ms < e.ms; }); });
                if (sent) p.sentLater = sent;
                var del = sent ? log.find(function (e) { return e.kind === 'delete' && e.messageId === sent.messageId; }) : null;
                if (del) p.deletedLater = del;
                if (sent) matchedMessages[sent.messageId] = true;
            }
        });
        // "Save attachments completed" är när filen fanns i galleriet; "Saving …" används om den saknas.
        var saveEvents = log.filter(function (e) { return e.kind === 'saved'; });
        if (!saveEvents.length) saveEvents = log.filter(function (e) { return e.kind === 'save'; });
        var savedHere = ctx.savedBySignal && ctx.fileAddedMs != null ? saveEvents.find(function (e) { return Math.abs(e.ms - ctx.fileAddedMs) <= SAVE_LINK_MS; }) : null;

        // Filnamnet för en sparad bilaga bär meddelandets date_sent.
        var nameTime = savedNameTime(ctx.fileName);
        var nameMatch = null;
        if (nameTime) {
            matches.concat(attachments.map(function (a) { return { row: a }; })).some(function (x) {
                var a = x.row;
                if (a.sentMs == null) return false;
                var w = wall(a.sentMs);
                var hit = nameTime.ms ? w.slice(0, 23) === nameTime.text : w.slice(0, 19) === nameTime.text;
                if (hit) nameMatch = { attachment: a, text: nameTime.text };
                return hit;
            });
        }

        // Meddelandena i fönstret.
        (ctx.messages || []).forEach(function (m) {
            var dir = direction(m.type);
            if (!dir || dir === 'draft') return;
            var own = dir === 'out';
            var who = counterpart(ctx, m);
            var atts = byMessage[m.id] || [];
            var n = Number(m.attachments != null ? m.attachments : atts.length);
            var kinds = atts.map(function (a) { return kindOf(a.contentType); });
            var what = n ? (n === 1 ? (kinds[0] || 'bilaga') : n + ' bilagor') : 'meddelande';
            // Böjningen: ett meddelande skickat, en bild skickad, två bilagor skickade.
            var verb = !n ? (own ? 'skickat till ' : 'mottaget från ') : n === 1 ? (own ? 'skickad till ' : 'mottagen från ') : (own ? 'skickade till ' : 'mottagna från ');
            var isFile = !!matchedMessages[m.id];
            var deleted = m.deletedBy != null && m.deletedBy !== '';
            var viewOnce = Number(m.viewOnce) === 1;
            var ms = own ? m.sentMs : (m.receivedMs != null ? m.receivedMs : m.sentMs);
            if (ms == null) return;
            var text = 'Signal: ' + what + ' ' + verb + who + ' (meddelande ' + m.id + ')' +
                (viewOnce ? ', engångsvisning' : '') + (deleted ? ', raderat för alla senare' : '') +
                (!own && m.sentMs != null ? '; avsändarens klocka ' + wall(m.sentMs) + (m.serverMs > 0 ? ', servern ' + wall(m.serverMs) : '') : '');
            var noun = n === 1 ? 'En ' + what : n ? what.charAt(0).toUpperCase() + what.slice(1) : 'Ett meddelande';
            var plain = n ? (own ? noun + ' skickas från den här telefonen i Signal till ' + who : noun + ' tas emot i Signal från ' + who) + (viewOnce ? ' för engångsvisning' : '') : null;
            if (deleted) plain = (own ? 'Ett meddelande skickas från den här telefonen i Signal till ' + who : 'Ett meddelande tas emot i Signal från ' + who) + ' (det raderades senare för alla)';
            if (isFile) { text = 'Den bedömda filen: ' + text; plain = (own ? 'Den bedömda filen skickas från den här telefonen i Signal till ' + who : 'Den bedömda filen tas emot i Signal från ' + who) + (deleted ? ' (meddelandet raderades senare för alla)' : ''); }
            events.push({ ms: ms, kind: 'sig-message', lane: 'signal', app: APP, own: own, bold: isFile, isFile: isFile, messageId: m.id, attachments: n, viewOnce: Number(m.viewOnce) === 1, deleted: deleted,
                active: own, activeText: own ? 'ett meddelande skickades' : null,
                text: text, plain: plain, source: Object.assign({}, srcMain, { column: own ? 'date_sent' : 'date_received (date_sent, date_server)' }) });
        });

        // Loggen i fönstret.
        var known = {};
        (ctx.messages || []).forEach(function (m) { known[m.id] = true; });
        log.forEach(function (e) {
            var src = Object.assign({}, srcLog, { column: 'created_at, body' });
            var base = { ms: e.ms, lane: 'signal', app: APP, source: src, logKind: e.kind };
            switch (e.kind) {
                case 'open':
                    events.push(Object.assign(base, { kind: 'sig-log', active: true, activeText: 'kameran och medievalet öppnades', text: 'Signals logg: kameran och medievalet öppnas (MediaSendV3Activity)', plain: null }));
                    break;
                case 'video':
                    var start = log.filter(function (x) { return x.kind === 'video-start' && x.ms <= e.ms && e.ms - x.ms < 600000; }).pop();
                    events.push(Object.assign(base, { kind: 'sig-capture', video: true, startMs: start ? start.ms : null, active: true, activeText: 'en video spelades in med Signals kamera',
                        text: 'Signals logg: video inspelad med Signals kamera' + (start ? ' (' + ((e.ms - start.ms) / 1000).toFixed(1).replace('.', ',') + ' s)' : '') + ', ' + e.bytes + ' byte',
                        plain: 'En video spelas in med Signals kamera' }));
                    break;
                case 'pick':
                    var isFile = picks.indexOf(e) >= 0;
                    var att = e.attachmentId != null ? ' som bilaga ' + e.attachmentId : '';
                    var text, plain;
                    if (e.source === 'gallery' || e.source === 'documents') {
                        text = 'Signals logg: ' + (e.source === 'gallery' ? 'en fil väljs ur galleriet' : 'en fil väljs med filväljaren') + ' (MediaStore-id ' + e.mediaId + ')' + att + (e.discarded ? ', togs bort igen' : '');
                        plain = e.discarded ? null : isFile ? 'Den bedömda filen väljs i Signal' : 'En fil i galleriet väljs i Signal';
                    } else if (e.source === 'capture') {
                        var vid = /^video/.test(e.mime);
                        text = 'Signals logg: ' + (e.edited ? 'den redigerade ' + (vid ? 'videon' : 'bilden') : (vid ? 'en video' : 'en bild') + ' från Signals kamera') + ' läggs in' + att + ' (' + e.size + ' byte)' + (e.discarded ? ', togs bort igen' : '');
                        plain = e.discarded ? (e.replacedByEdit && !vid ? 'En bild tas med Signals kamera' : null) : e.edited ? 'Bilden redigeras i Signal innan den skickas' : vid ? null : 'En bild tas med Signals kamera';
                    } else if (e.source === 'attachment') {
                        text = 'Signals logg: en befintlig bilaga skickas vidare' + att;
                        plain = null;
                    } else {
                        text = 'Signals logg: en bilaga läggs in' + att + ' (' + e.uri + ')';
                        plain = null;
                    }
                    events.push(Object.assign(base, { kind: 'sig-pick', isFile: isFile, bold: isFile, pickSource: e.source, mediaId: e.mediaId != null ? e.mediaId : null, attachmentId: e.attachmentId, text: text, plain: plain,
                        active: true, activeText: e.source === 'capture' ? 'en bild från Signals kamera lades till' : 'en fil valdes i Signal' }));
                    break;
                case 'sent':
                    if (known[e.messageId]) {
                        events.push(Object.assign(base, { kind: 'sig-log', text: 'Signals logg: meddelande ' + e.messageId + ' skickat' + (e.group ? ' till en grupp' : ''), plain: null }));
                    } else {
                        events.push(Object.assign(base, { kind: 'sig-log', text: 'Signals logg: meddelande ' + e.messageId + ' skickat (finns inte i databasens fönster' + (log.some(function (x) { return x.kind === 'delete' && x.messageId === e.messageId; }) ? ', raderat senare' : '') + ')',
                            plain: 'Ett meddelande skickas i Signal' }));
                    }
                    break;
                case 'saved':
                    events.push(Object.assign(base, { kind: 'sig-saved', isFile: !!savedHere, bold: !!savedHere, active: true, activeText: 'en bilaga sparades till galleriet',
                        text: 'Signals logg: ' + e.saved + ' av ' + e.of + ' bilagor sparade till galleriet (SaveAttachmentUtil)',
                        plain: savedHere ? 'Den bedömda filen sparas ur Signal till galleriet' : 'En bilaga sparas ur Signal till galleriet' }));
                    break;
                case 'delete':
                    events.push(Object.assign(base, { kind: 'sig-deleted', messageId: e.messageId, forAll: e.forAll, active: true, activeText: 'ett meddelande raderades',
                        text: 'Signals logg: meddelande ' + e.messageId + ' raderas' + (e.forAll ? ' för alla (RemoteDeleteSendJob)' : '') + ', bilagorna tas bort',
                        plain: e.forAll ? 'Ett meddelande raderas för alla i Signal' : 'Ett meddelande raderas i Signal' }));
                    break;
                case 'forward':
                    events.push(Object.assign(base, { kind: 'sig-log', active: true, activeText: 'en bilaga vidarebefordrades', text: 'Signals logg: vidarebefordran skickas (MultiselectForward)', plain: 'En bilaga vidarebefordras i Signal' }));
                    break;
                case 'download':
                    events.push(Object.assign(base, { kind: 'sig-log', text: 'Signals logg: bilaga ' + e.attachmentId + ' till meddelande ' + e.messageId + ' hämtas', plain: null }));
                    break;
                case 'viewer':
                    events.push(Object.assign(base, { kind: 'sig-log', active: true, activeText: 'en bild visades i Signal', text: 'Signals logg: en bild eller video visas i Signal (MediaViewerActivity)', plain: null }));
                    break;
            }
        });

        // Bara händelserna i bedömningens fönster (ctx.keep), om det anges.
        if (typeof ctx.keep === 'function') events = events.filter(function (e) { return ctx.keep(e.ms); });
        events.sort(function (a, b) { return a.ms - b.ms; });
        if (events.length > MAX_EVENTS) {
            var center = ctx.centerMs != null ? ctx.centerMs : events[0].ms;
            var kept = events.filter(function (e) { return e.isFile; });
            events.filter(function (e) { return !e.isFile; }).sort(function (a, b) { return Math.abs(a.ms - center) - Math.abs(b.ms - center); })
                .forEach(function (e) { if (kept.length < MAX_EVENTS) kept.push(e); });
            notes.push((events.length - kept.length) + ' Signal-händelser till i fönstret visas inte.');
            events = kept.sort(function (a, b) { return a.ms - b.ms; });
        }

        var link = {
            matches: matches.map(function (x) {
                var a = x.row;
                var dir = direction(a.type);
                return {
                    attachmentId: a.id, messageId: a.messageId, on: x.on, transformed: x.transformed, direction: dir,
                    who: a.type != null ? counterpart(ctx, a) : null, conversation: a.threadRecipient != null ? threadName(ctx, a).name : null,
                    contentType: a.contentType, size: a.size, width: a.width, height: a.height, fileName: a.fileName || null, dataFile: a.dataFile ? String(a.dataFile).split('/').pop() : null,
                    sentMs: a.sentMs, receivedMs: a.receivedMs, serverMs: a.serverMs, uploadMs: a.uploadMs, viewOnce: Number(a.viewOnce) === 1, deleted: a.deletedBy != null && a.deletedBy !== '',
                };
            }),
            picks: picks.map(function (p) {
                return { ms: p.ms, source: p.source, attachmentId: p.attachmentId, messageId: p.messageId, discarded: p.discarded,
                    sentLater: p.sentLater ? { ms: p.sentLater.ms, messageId: p.sentLater.messageId } : null, deletedLater: p.deletedLater ? { ms: p.deletedLater.ms, forAll: p.deletedLater.forAll } : null };
            }),
            saved: savedHere ? { ms: savedHere.ms } : null,
            nameTime: nameTime ? nameTime.text : null,
            nameMatch: nameMatch ? { attachmentId: nameMatch.attachment.id, messageId: nameMatch.attachment.messageId } : null,
            attachments: attachments.length,
            logRows: (ctx.log || []).length,
        };
        return { events: events, notes: notes, link: link };
    }

    // ---------- Hashsökningen ----------

    // Bilagor med en viss summa. SHA-256 jämförs direkt med databasens summor (original och lagrad);
    // MD5 och SHA-1 kräver att bilagan dekrypteras: deps.plain(bilaga) -> Promise<Uint8Array|null>,
    // deps.hasher(algo) -> { update, digestHex }, deps.algoOf(summa), deps.onProgress(klara, alla).
    // Returnerar { found: { summa: [{ attachment, on }] }, decrypted, unreadable, needed }.
    async function findByHash(hashes, attachments, deps) {
        var found = {};
        var want = {};
        (hashes || []).forEach(function (h) { var x = String(h).trim().toLowerCase(); want[x] = deps.algoOf(x); });
        var slow = Object.keys(want).filter(function (h) { return want[h] !== 'sha256'; });
        (attachments || []).forEach(function (a) {
            var s = b64ToHex(a.hashStart), e = b64ToHex(a.hashEnd);
            Object.keys(want).forEach(function (h) {
                if (want[h] !== 'sha256' || (h !== s && h !== e)) return;
                (found[h] = found[h] || []).push({ attachment: a, on: h === s && h === e ? 'both' : h === s ? 'start' : 'end' });
            });
        });
        var out = { found: found, decrypted: 0, unreadable: 0, needed: slow.length > 0 };
        if (!slow.length) return out;
        var algos = slow.map(function (h) { return want[h]; }).filter(function (a, i, arr) { return arr.indexOf(a) === i; });
        var list = (attachments || []).filter(function (a) { return a.dataFile; });
        for (var i = 0; i < list.length; i++) {
            var a = list[i];
            var bytes = await deps.plain(a);
            if (deps.onProgress) deps.onProgress(i + 1, list.length);
            if (!bytes) { out.unreadable++; continue; }
            out.decrypted++;
            algos.forEach(function (algo) {
                var hasher = deps.hasher(algo);
                hasher.update(bytes);
                var hex = hasher.digestHex();
                if (want[hex] === algo) (found[hex] = found[hex] || []).push({ attachment: a, on: 'end' });
            });
        }
        return out;
    }

    // En mening om en bilaga som hittats på sin summa.
    function attachmentText(hit, ctx) {
        var a = hit.attachment;
        var wall = ctx.wall || function (ms) { return new Date(ms).toISOString(); };
        var dir = direction(a.type);
        var original = hit.on === 'start';
        var what = (original ? 'originalet till bilaga ' : 'bilaga ') + a.id + ' (' + (a.contentType || 'okänd typ') + (a.width ? ', ' + a.width + '×' + a.height : '') + (a.size != null ? ', ' + a.size + ' byte' : '') + ')';
        var msg = a.messageId != null ? ' i meddelande ' + a.messageId : '';
        var when = dir === 'in' ? ', mottagen från ' + counterpart(ctx, a) + ' ' + wall(a.receivedMs) + (a.sentMs ? ' (avsändarens klocka ' + wall(a.sentMs) + ')' : '')
            : dir === 'out' ? ', skickad till ' + counterpart(ctx, a) + ' ' + wall(a.sentMs) : '';
        var file = a.dataFile ? ' Bilagan ligger krypterad i app_parts/' + String(a.dataFile).split('/').pop() + '.' : ' Bilagan finns inte på telefonen (inte hämtad).';
        return what + msg + when + (original ? ', före Signals omkodning. Originalet finns inte bland Signals filer, bara den omkodade versionen.' : '.' + file);
    }

    var api = {
        findByHash: findByHash, attachmentText: attachmentText,
        APP: APP, isSignalApp: isSignalApp, b64ToHex: b64ToHex, direction: direction, kindOf: kindOf, savedNameTime: savedNameTime,
        match: match, uriInfo: uriInfo, lineText: lineText, parseLog: parseLog, build: build, counterpart: counterpart,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceSignal = api;
})(typeof window !== 'undefined' ? window : this);
