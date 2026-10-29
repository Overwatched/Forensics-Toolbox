// Snapchat (iOS) som källa i Härkomst. Betafunktion: tolkningarna är kontrollerade mot en
// extraktion (iOS 18.5, Snapchat 2025) och kan skilja sig mellan versioner, därför bär varje
// händelse databas, tabell, kolumn och query så att den går att kontrollera för hand.
// Här tolkas cacheregistrets nycklar och typkoder, protobufen i chattmeddelandena (avsändare,
// medienyckel), FlatBuffern i kontotabellen (användarnamn), och det hela blir händelser till
// tidslinjen. Ingen DOM, ingen SQL. Testas i Node.
(function (root) {
    'use strict';

    var PICABOO = 'com.toyopagroup.picaboo';
    var MAX_EVENTS = 40;

    // MEDIA_CONTEXT_TYPE i cache_controller.db. Bara koder med belägg får ett namn; övriga
    // visas som "typ N" och tas med i tidslinjen utan tolkning.
    var CONTEXT = {
        3: { label: 'chattmedia', plain: 'En bild eller video ur Snapchat-chatten läggs i appens cache', show: true },
        34: { label: 'inspelning med Snapchats kamera', plain: 'En video spelas in med Snapchats kamera', show: true },
        16: { label: 'story-video', plain: 'En story hämtas i Snapchat', show: true },
        24: { label: 'story, första bildruta', plain: null, show: false },
        7: { label: 'bild från Snapchats CDN', plain: null, show: false },
        13: { label: 'nedladdning från Snapchats CDN', plain: null, show: false },
        1: { label: 'lins', plain: null, show: false },
        12: { label: 'linspaket', plain: null, show: false },
        4: { label: 'Team Snapchat', plain: null, show: false },
        6: { label: 'Team Snapchat', plain: null, show: false },
        25: { label: 'resurs', plain: null, show: false },
    };

    function contextInfo(n) {
        var c = CONTEXT[Number(n)];
        // Okända typer visas inte i tidslinjen (de är ofta resurser vid appstart), men räknas i noten.
        return c ? Object.assign({ code: Number(n), known: true }, c) : { code: Number(n), known: false, label: 'typ ' + n + ' (okänd)', plain: null, show: false };
    }

    // EXTERNAL_KEY: vad cachefilen hör till.
    function parseExternalKey(ext) {
        var s = String(ext == null ? '' : ext);
        var m = /^(\d+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d+):(\d+):(\d+)$/i.exec(s);
        if (m) return { kind: 'message', conversationId: m[2].toLowerCase(), serverMessageId: Number(m[3]) };
        m = /^([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})~(\d+)$/i.exec(s);
        if (m) return { kind: 'recording', recordingId: m[1].toUpperCase() };
        m = /^([A-Za-z0-9._-]{3,})~([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})$/i.exec(s);
        if (m && !/^(firstframe|video|overlay)$/.test(m[1])) {
            // SNAPVIDEOFILTERSTATE-<mottagare> är en hjälppost för samma skickade snap, raderad inom någon sekund.
            var aux = /^snapvideofilterstate-(.+)$/i.exec(m[1]);
            if (aux) return { kind: 'sent', recipient: aux[1].toLowerCase(), mediaId: m[2].toUpperCase(), aux: 'filterstate' };
            return { kind: 'sent', recipient: m[1].toLowerCase(), mediaId: m[2].toUpperCase() };
        }
        m = /^(firstframe|video|overlay)~(.+)$/.exec(s);
        if (m) return { kind: 'story', part: m[1], storyKey: m[2] };
        if (/^https?:\/\//.test(s)) return { kind: 'url', url: s };
        if (/^lens\./.test(s)) return { kind: 'lens' };
        return { kind: 'other' };
    }

    // ---------- Protobuf, bara så mycket som behövs ----------

    function varint(b, i) {
        var value = 0, shift = 0, c;
        do {
            c = b[i++];
            value += (c & 0x7f) * Math.pow(2, shift);
            shift += 7;
        } while ((c & 0x80) && i < b.length && shift < 64);
        return { value: value, next: i };
    }

    // Fälten på en nivå: [{ field, wire, value | bytes }]. null när bytena inte är protobuf.
    function fields(b) {
        if (!b || !b.length) return [];
        var out = [];
        var i = 0;
        while (i < b.length) {
            var t = varint(b, i);
            i = t.next;
            var f = Math.floor(t.value / 8);
            var w = t.value % 8;
            if (f === 0) return null;
            if (w === 0) { var v = varint(b, i); i = v.next; out.push({ field: f, wire: 0, value: v.value }); }
            else if (w === 1) { if (i + 8 > b.length) return null; out.push({ field: f, wire: 1 }); i += 8; }
            else if (w === 5) { if (i + 4 > b.length) return null; out.push({ field: f, wire: 5 }); i += 4; }
            else if (w === 2) {
                var l = varint(b, i);
                i = l.next;
                if (i + l.value > b.length) return null;
                out.push({ field: f, wire: 2, bytes: b.subarray(i, i + l.value) });
                i += l.value;
            } else return null;
        }
        return out;
    }

    function toBytes(v) {
        if (!v) return null;
        if (v instanceof Uint8Array) return v;
        if (typeof v === 'string') { try { return new TextEncoder().encode(v); } catch (e) { return null; } }
        if (v.buffer) return new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength);
        return null;
    }

    function hex(b) { return Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }

    function uuidText(h) { return h.length === 32 ? h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20) : h; }

    function isPrintable(s) { return /^[\x20-\x7e -￿]+$/.test(s) && !/[�]/.test(s); }

    function decodeText(b) {
        try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return null; }
    }

    // Avsändarens id: fält 2 → fält 1, 16 byte. Samma plats som hex(substr(message_content, 7, 16))
    // i den synliga queryn när blobben börjar 08 xx 12 12 0A 10.
    function senderId(content) {
        var b = toBytes(content);
        var top = fields(b);
        if (!top) return null;
        var f2 = top.find(function (x) { return x.field === 2 && x.wire === 2; });
        if (!f2) return null;
        var inner = fields(f2.bytes);
        if (!inner) return null;
        var id = inner.find(function (x) { return x.field === 1 && x.wire === 2 && x.bytes.length === 16; });
        if (!id) return null;
        var h = hex(id.bytes);
        return /^0+$/.test(h) ? null : h;
    }

    // Finns ett par nyckel (32 byte) + IV (16 byte) någonstans i meddelandet, råa eller som base64?
    function hasMediaKey(content, depth) {
        depth = depth || 0;
        var list = fields(toBytes(content));
        if (!list || depth > 6) return false;
        var k = false, iv = false;
        list.forEach(function (x) {
            if (x.wire !== 2) return;
            var n = x.bytes.length;
            var s = n === 44 || n === 24 ? decodeText(x.bytes) : null;
            if (x.field === 1 && (n === 32 || (s && /^[A-Za-z0-9+/]{43}=$/.test(s)))) k = true;
            if (x.field === 2 && (n === 16 || (s && /^[A-Za-z0-9+/]{22}==$/.test(s)))) iv = true;
        });
        if (k && iv) return true;
        return list.some(function (x) { return x.wire === 2 && x.bytes.length > 2 && hasMediaKey(x.bytes, depth + 1); });
    }

    // Alla läsbara strängar i en protobuf, på alla nivåer.
    function strings(content, depth, out) {
        out = out || [];
        depth = depth || 0;
        var list = fields(toBytes(content));
        if (!list || depth > 6) return out;
        list.forEach(function (x) {
            if (x.wire !== 2 || x.bytes.length < 2) return;
            var s = decodeText(x.bytes);
            if (s && isPrintable(s) && s.length >= 2) { out.push(s); return; }
            strings(x.bytes, depth + 1, out);
        });
        return out;
    }

    // Strängar i en FlatBuffer: 32-bitars längd (little endian), bytena, och en avslutande nolla.
    // snapchatter.p i primary.docobjects är en FlatBuffer, inte protobuf.
    function flatStrings(content) {
        var b = toBytes(content);
        var out = [];
        if (!b) return out;
        for (var i = 0; i + 4 <= b.length; i += 4) {
            var n = b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
            if (n < 2 || n > 80 || i + 4 + n >= b.length || b[i + 4 + n] !== 0) continue;
            var s = decodeText(b.subarray(i + 4, i + 4 + n));
            if (s && isPrintable(s)) out.push(s);
        }
        return out;
    }

    // Användarnamn och visningsnamn ur snapchatter.p (FlatBuffer). Användarnamnet är det första som
    // ser ut som ett Snapchat-användarnamn, visningsnamnet det första med stor bokstav eller mellanslag.
    function friendNames(p) {
        var all = flatStrings(p);
        if (!all.length) all = strings(p);
        // Går kolumnen inte att läsa på något av sätten: läsbara strängar rakt ur bytena.
        if (!all.length) {
            var raw = toBytes(p);
            var text = raw ? decodeText(raw) || Array.prototype.map.call(raw, function (c) { return String.fromCharCode(c); }).join('') : '';
            all = (text.match(/[\x20-\x7e]{3,60}/g) || []).map(function (s) { return s.replace(/^[^A-Za-z0-9]+/, ''); }).filter(function (s) { return s.length >= 3; });
        }
        var username = all.find(function (s) { return /^[a-z0-9][a-z0-9._-]{2,}$/.test(s) && !/^[0-9a-f-]{32,36}$/.test(s); }) || null;
        var displayName = all.find(function (s) { return s !== username && /[A-ZÅÄÖ]|\s/.test(s) && !/^[0-9a-f-]{32,36}$/i.test(s) && s.length <= 60; }) || null;
        return { username: username, displayName: displayName, strings: all };
    }

    function messageInfo(content) {
        return { senderId: senderId(content), hasMediaKey: hasMediaKey(content) };
    }

    // Det egna kontots uuid står i mappnamnet file_manager_3_SCContent_<uuid>.
    function accountId(names) {
        for (var i = 0; i < (names || []).length; i++) {
            var m = /file_manager_\d+_SCContent_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(names[i]);
            if (m) return m[1].toLowerCase();
        }
        return null;
    }

    // Cachenyckeln ur en sökväg i Snapchats file_manager-mapp, annars null.
    function cacheKeyFromPath(name) {
        var m = /com\.snap\.file_manager_\d+_SCContent_[^/]*\/([0-9a-f]{32})(?:_[^/]*)?$/i.exec(String(name || ''));
        return m ? m[1].toLowerCase() : null;
    }

    function isRecordingPath(name) { return /\/recorded_videos\/recorded-[\d.]+\.mp4$/i.test(String(name || '')); }

    function whoText(id, ctx) {
        if (!id) return 'okänd avsändare';
        if (ctx.accountId && id === ctx.accountId.replace(/-/g, '')) return 'det egna kontot';
        var f = ctx.friends && ctx.friends[id];
        if (f && f.username) return '@' + f.username;
        return 'konto ' + uuidText(id).slice(0, 8) + '…';
    }

    function isOwn(id, ctx) { return !!(id && ctx.accountId && id === ctx.accountId.replace(/-/g, '')); }

    // ctx: { cacheRows, messages, friends: { idHex: { username, displayName } }, notifications,
    //        accountId, fileKey, sources: { cache, messages, notifications } }
    // Rader har tider som UTC-millisekunder (createdMs, readMs, lastReadMs, deletedMs, ms).
    // Returnerar { events, link, notes, hidden }.
    function build(ctx) {
        ctx = ctx || {};
        var events = [];
        var notes = [];
        var hidden = 0;
        var hiddenTypes = {};
        var srcCache = ctx.sources && ctx.sources.cache || { db: 'cache_controller.db', table: 'CACHE_FILE_CLAIM' };
        var srcMsg = ctx.sources && ctx.sources.messages || { db: 'arroyo.db', table: 'conversation_message' };
        var srcNotif = ctx.sources && ctx.sources.notifications || { db: 'nse_db.sqlite', table: 'ProcessedNotifications' };
        var fileKey = ctx.fileKey ? String(ctx.fileKey).toLowerCase() : null;
        var link = null;

        var byMessage = {};
        (ctx.messages || []).forEach(function (m) {
            if (m.conversation != null && m.serverId != null) byMessage[String(m.conversation).toLowerCase() + ':' + Number(m.serverId)] = m;
        });

        (ctx.cacheRows || []).forEach(function (r) {
            var info = contextInfo(r.context);
            var ext = parseExternalKey(r.external);
            var isFile = fileKey && String(r.key).toLowerCase() === fileKey;
            if (isFile) {
                link = { row: r, context: info, external: ext, message: ext.kind === 'message' ? byMessage[ext.conversationId + ':' + ext.serverMessageId] || null : null };
            }
            if (!info.show && !isFile) { hidden++; hiddenTypes[info.code] = (hiddenTypes[info.code] || 0) + 1; return; }
            if (r.createdMs == null) return;
            var what = 'Snapchat cachar media: typ ' + info.code + (info.known ? ' (' + info.label + ')' : '');
            if (ext.kind === 'message') what += ', konversation ' + ext.conversationId.slice(0, 8) + '…, meddelande ' + ext.serverMessageId;
            else if (ext.kind === 'recording') what += ', inspelning ' + ext.recordingId.slice(0, 8) + '…';
            else if (ext.kind === 'sent') what += ', skickad till @' + ext.recipient + (ext.aux ? ' (' + ext.aux + ')' : '');
            else if (ext.kind === 'story') what += ', ' + ext.part;
            var plain = ext.kind === 'sent' && info.code === 3 ? (ext.aux ? null : 'En snap eller bild skickas till @' + ext.recipient + ' från den här telefonen') : info.plain;
            // Tillfälliga poster utan extern nyckel (mellanlagring vid inspelning och hämtning) får ingen egen mening.
            if ((info.code === 34 && ext.kind !== 'recording') || (info.code === 3 && ext.kind === 'other')) plain = null;
            if (isFile) {
                what = 'Den bedömda filen: ' + what;
                plain = info.code === 34 ? 'Den bedömda videon spelas in med Snapchats kamera'
                    : ext.kind === 'sent' ? 'Den bedömda filen skickas till @' + ext.recipient + ' från den här telefonen'
                    : info.code === 3 ? 'Den bedömda filen läggs i Snapchat-chattens cache'
                        : 'Den bedömda filen läggs i Snapchats cache';
            }
            events.push({
                ms: r.createdMs, kind: 'snap-cache', lane: 'snapchat', bold: !!isFile, isFile: !!isFile, context: info.code, cacheKey: r.key, app: PICABOO, sent: ext.kind === 'sent' && !ext.aux,
                text: what + ', nyckel ' + String(r.key).slice(0, 12) + '…', plain: plain,
                source: Object.assign({}, srcCache, { column: 'CREATION_TIMESTAMP_MILLIS (MEDIA_CONTEXT_TYPE ' + info.code + ', EXTERNAL_KEY)' }),
            });
            if (r.deletedMs) {
                events.push({ ms: r.deletedMs, kind: 'snap-cache-deleted', lane: 'snapchat', context: info.code, cacheKey: r.key, app: PICABOO,
                    text: (isFile ? 'Den bedömda filen: ' : '') + 'raderad ur Snapchats cache, nyckel ' + String(r.key).slice(0, 12) + '…', plain: isFile ? 'Den bedömda filen tas bort ur Snapchats cache' : null,
                    source: Object.assign({}, srcCache, { column: 'DELETED_TIMESTAMP_MILLIS' }) });
            }
        });

        var sentAt = events.filter(function (e) { return e.kind === 'snap-cache' && e.sent; }).map(function (e) { return e.ms; });
        (ctx.messages || []).forEach(function (m) {
            var info = messageInfo(m.content);
            var own = isOwn(info.senderId, ctx);
            var who = whoText(info.senderId, ctx);
            var isFile = !!(link && link.message === m);
            var conv = String(m.conversation || '').slice(0, 8) + '…';
            var kindText = info.hasMediaKey ? 'snap eller bild' : 'meddelande';
            var text = 'Snapchat: ' + kindText + ' ' + m.serverId + ' i konversation ' + conv + ', avsändare ' + who + (own ? ' (den här telefonen)' : '');
            var plain = own
                ? (info.hasMediaKey ? 'En snap eller bild skickas från den här telefonen i Snapchat' : 'Ett meddelande skickas från den här telefonen i Snapchat')
                : (info.hasMediaKey ? 'En snap eller bild skickas till den här telefonen i Snapchat från ' + who : 'Ett meddelande skickas till den här telefonen i Snapchat från ' + who);
            if (isFile) { text = 'Den bedömda filen: ' + text; plain = own ? 'Den bedömda filen skickas från den här telefonen i Snapchat' : 'Den bedömda filen skickas till den här telefonen i Snapchat från ' + who; }
            // En skickad snap ger både en cacherad (med mottagaren) och ett meddelande inom några sekunder: en mening räcker.
            else if (own && m.createdMs != null && sentAt.some(function (t) { return Math.abs(t - m.createdMs) <= 5000; })) plain = null;
            var senderSource = Object.assign({}, srcMsg, { column: 'creation_timestamp; avsändare ur message_content (protobuf, fält 2 → 1)' });
            if (m.createdMs != null) events.push({ ms: m.createdMs, kind: 'snap-message', lane: 'snapchat', bold: isFile, isFile: isFile, own: own, senderId: info.senderId, hasMediaKey: info.hasMediaKey,
                conversation: m.conversation, serverId: m.serverId, app: PICABOO, text: text, plain: plain, source: senderSource });
            if (m.readMs != null) {
                events.push({ ms: m.readMs, kind: 'snap-read', lane: 'snapchat', isFile: isFile, own: own, conversation: m.conversation, serverId: m.serverId, app: PICABOO,
                    text: (isFile ? 'Den bedömda filen: ' : 'Snapchat: ') + kindText + ' ' + m.serverId + ' läst' + (own ? ' av mottagaren' : ' på den här telefonen'),
                    plain: own ? 'Mottagaren öppnar den' : 'Den öppnas på den här telefonen',
                    source: Object.assign({}, srcMsg, { column: 'read_timestamp' }) });
            }
        });

        (ctx.notifications || []).forEach(function (n) {
            if (n.ms == null) return;
            var t = String(n.type || '');
            events.push({ ms: n.ms, kind: 'snap-notification', lane: 'snapchat', app: PICABOO, notifType: t,
                text: 'Snapchat-notis: ' + t + ' (kategori ' + n.category + ')',
                plain: t === 'snap' ? 'Telefonen får en notis om en ny snap' : t === 'chat' ? 'Telefonen får en notis om ett nytt meddelande i Snapchat' : null,
                source: Object.assign({}, srcNotif, { column: 'timestamp, type' }) });
        });

        events.sort(function (a, b) { return a.ms - b.ms; });
        if (events.length > MAX_EVENTS) {
            // De närmast T behålls, plus allt som rör den bedömda filen.
            var center = ctx.centerMs != null ? ctx.centerMs : events[0].ms;
            var kept = events.filter(function (e) { return e.isFile; });
            events.filter(function (e) { return !e.isFile; }).sort(function (a, b) { return Math.abs(a.ms - center) - Math.abs(b.ms - center); })
                .forEach(function (e) { if (kept.length < MAX_EVENTS) kept.push(e); });
            notes.push((events.length - kept.length) + ' Snapchat-händelser till i fönstret visas inte.');
            events = kept.sort(function (a, b) { return a.ms - b.ms; });
        }
        if (hidden) notes.push(hidden + ' cacheposter för linser, resurser och andra typer (' + Object.keys(hiddenTypes).sort(function (a, b) { return a - b; }).join(', ') + ') i fönstret visas inte.');
        return { events: events, link: link, notes: notes, hidden: hidden };
    }

    var api = {
        PICABOO: PICABOO, CONTEXT: CONTEXT, contextInfo: contextInfo, parseExternalKey: parseExternalKey,
        fields: fields, senderId: senderId, hasMediaKey: hasMediaKey, strings: strings, flatStrings: flatStrings, friendNames: friendNames, messageInfo: messageInfo,
        accountId: accountId, cacheKeyFromPath: cacheKeyFromPath, isRecordingPath: isRecordingPath, uuidText: uuidText, hex: hex, build: build,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceSnapchat = api;
})(typeof window !== 'undefined' ? window : this);
