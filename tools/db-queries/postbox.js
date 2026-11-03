// Telegrams databaser på iOS (Postbox). Tabellerna t0, t1, … har nyckel och värde som blobbar i
// Telegrams eget format, så SQL kan inte läsa meddelandena direkt. Här avkodas meddelandena (t7) och
// kontakterna och chattarna (t2) i postbox/db/db_sqlite, och resurserna i lagringsdatabasen
// postbox/media/storage/db/db_sqlite (t15 och t16), till tillfälliga tabeller (tg_…) i databasen i
// minnet. Queries och Härkomst läser dem sedan med vanlig SQL. Filen ändras inte, och tabellerna
// finns inte i den. Formatet är kontrollerat mot en labbtelefon (iOS 26.4.1, Telegram 13.1.2,
// 2026-11-03). En post som inte går att avkoda tas med med nyckelns uppgifter och felet.
// Ingen DOM. Testas i Node.
(function (root) {
    'use strict';

    // Varje objekt bär sin klass som MurmurHash3 (x86, 32 bitar) av klassnamnet med det här fröet.
    var SEED = 0xf7ca7fd2;
    var CLASS_NAMES = [
        'TelegramMediaImage', 'TelegramMediaFile', 'TelegramMediaAction', 'TelegramMediaImageRepresentation', 'TelegramMediaImageReference',
        'TelegramMediaFileAttribute', 'TelegramMediaWebpage', 'TelegramMediaMap', 'TelegramMediaContact', 'TelegramMediaPoll', 'TelegramMediaDice',
        'TelegramMediaStory', 'TelegramMediaExpiredContent', 'TelegramMediaUnsupported', 'TelegramMediaGame', 'TelegramMediaInvoice',
        'CloudPhotoSizeMediaResource', 'CloudDocumentMediaResource', 'CloudDocumentSizeMediaResource', 'LocalFileMediaResource',
        'LocalFileReferenceMediaResource', 'PhotoLibraryMediaResource',
        'TextEntitiesMessageAttribute', 'OutgoingMessageInfoAttribute', 'AutoclearTimeoutMessageAttribute', 'AutoremoveTimeoutMessageAttribute',
        'ConsumableContentMessageAttribute', 'ReplyMessageAttribute', 'EditedMessageAttribute', 'ForwardOptionsMessageAttribute',
        'TelegramUser', 'TelegramChannel', 'TelegramGroup', 'TelegramSecretChat',
    ];
    var VIEW_ONCE = 0x7fffffff;          // AutoclearTimeoutMessageAttribute.t för en bild eller video som visas en gång
    var INCOMING = 4;                    // MessageFlags: mottaget
    var PHONE_CALL = 14;                 // TelegramMediaAction._rawValue för ett samtal (fälten i, dr, d, vc)
    var PEER_TYPES = { 0: 'användare', 1: 'grupp', 2: 'kanal', 3: 'hemlig chatt' };
    var MEDIA_KINDS = { TelegramMediaWebpage: 'webbsida', TelegramMediaMap: 'plats', TelegramMediaContact: 'kontakt', TelegramMediaPoll: 'omröstning', TelegramMediaDice: 'tärning', TelegramMediaStory: 'story' };

    function murmur3(bytes, seed) {
        var h = seed | 0, n = bytes.length, i = 0, k;
        var c1 = 0xcc9e2d51, c2 = 0x1b873593;
        for (; i + 4 <= n; i += 4) {
            k = bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);
            k = Math.imul(k, c1); k = (k << 15) | (k >>> 17); k = Math.imul(k, c2);
            h ^= k; h = (h << 13) | (h >>> 19); h = (Math.imul(h, 5) + 0xe6546b64) | 0;
        }
        k = 0;
        var r = n & 3;
        if (r === 3) k ^= bytes[i + 2] << 16;
        if (r >= 2) k ^= bytes[i + 1] << 8;
        if (r >= 1) { k ^= bytes[i]; k = Math.imul(k, c1); k = (k << 15) | (k >>> 17); k = Math.imul(k, c2); h ^= k; }
        h ^= n; h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
        return h >>> 0;
    }

    function ascii(s) { var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
    function classHash(name) { return murmur3(ascii(name), SEED); }

    var classes = null;
    function className(hash) {
        if (!classes) { classes = {}; CLASS_NAMES.forEach(function (n) { classes[classHash(n)] = n; }); }
        return classes[hash] || '#' + ('0000000' + hash.toString(16)).slice(-8);
    }

    var decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
    function utf8(b) {
        if (decoder) return decoder.decode(b);
        var s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
        try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
    }

    function Reader(bytes) {
        this.b = bytes; this.o = 0;
        this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    Reader.prototype.need = function (n) { if (n < 0 || this.o + n > this.b.length) throw new Error('posten tar slut vid byte ' + this.o + ' av ' + this.b.length); };
    Reader.prototype.left = function () { return this.b.length - this.o; };
    Reader.prototype.u8 = function () { this.need(1); return this.b[this.o++]; };
    Reader.prototype.i32 = function () { this.need(4); var x = this.v.getInt32(this.o, true); this.o += 4; return x; };
    Reader.prototype.u32 = function () { this.need(4); var x = this.v.getUint32(this.o, true); this.o += 4; return x; };
    Reader.prototype.i64 = function () { this.need(8); var x = this.v.getBigInt64(this.o, true); this.o += 8; return x; };
    Reader.prototype.f64 = function () { this.need(8); var x = this.v.getFloat64(this.o, true); this.o += 8; return x; };
    Reader.prototype.bytes = function (n) { this.need(n); var x = this.b.subarray(this.o, this.o + n); this.o += n; return x; };
    Reader.prototype.text = function (n) { return utf8(this.bytes(n)); };

    function list(r, item) {
        var n = r.i32();
        if (n < 0 || n > r.left()) throw new Error('orimligt antal (' + n + ') vid byte ' + r.o);
        var out = [];
        for (var i = 0; i < n; i++) out.push(item());
        return out;
    }

    // Ett objekt: fält efter fält med [nyckelns längd (1 byte)][nyckel][typ (1 byte)][värde]. Heltal
    // är little endian; 64-bitarstal blir BigInt. Klassen står i fältet '@'.
    function fields(bytes, depth) {
        if (depth > 32) throw new Error('för djupt nästlade objekt');
        var r = new Reader(bytes), out = {};
        while (r.left() > 0) {
            var key = r.text(r.u8());
            out[key] = value(r, r.u8(), depth);
        }
        return out;
    }
    function object(r, depth) {
        var hash = r.u32();
        var o = fields(r.bytes(r.i32()), depth + 1);
        o['@'] = className(hash);
        return o;
    }
    function value(r, type, depth) {
        switch (type) {
            case 0: return r.i32();
            case 1: return r.i64();
            case 2: return r.u8() !== 0;
            case 3: return r.f64();
            case 4: return r.text(r.i32());
            case 5: return object(r, depth);
            case 6: return list(r, function () { return r.i32(); });
            case 7: return list(r, function () { return r.i64(); });
            case 8: return list(r, function () { return object(r, depth); });
            case 9: return list(r, function () { return { key: object(r, depth), value: object(r, depth) }; });
            case 10: return r.bytes(r.i32());
            case 11: return null;
            case 12: return list(r, function () { return r.text(r.i32()); });
            case 13: return list(r, function () { return r.bytes(r.i32()); });
        }
        throw new Error('okänd värdetyp ' + type + ' vid byte ' + (r.o - 1));
    }

    // Ett rotobjekt (attribut, media, kontakt) ligger i fältet "_".
    function decodeRoot(bytes) {
        var f = fields(bytes, 0);
        if (!f._ || typeof f._ !== 'object') throw new Error('objektet saknar rotfältet');
        return f._;
    }

    var B32 = BigInt(32), B35 = BigInt(35), LOW = BigInt(0xffffffff), SEVEN = BigInt(7);
    // Peer-id: typen (0 användare, 1 grupp, 2 kanal, 3 hemlig chatt) i bit 32–34, Telegrams id i resten.
    function peerParts(n) {
        var u = BigInt.asUintN(64, BigInt(n));
        return { type: Number((u >> B32) & SEVEN), id: (((u >> B35) << B32) | (u & LOW)).toString() };
    }

    // t7: nyckeln är peer (8), namnrymd (4), tid i unixsekunder (4) och id (4), big endian.
    function decodeKey(key) {
        if (!key || key.length !== 20) throw new Error('nyckeln är inte 20 byte');
        var v = new DataView(key.buffer, key.byteOffset, key.byteLength);
        return { peer: v.getBigInt64(0, false), namespace: v.getInt32(8, false), timestamp: v.getInt32(12, false), id: v.getInt32(16, false) };
    }

    // t7: värdet. Ordningen är Telegrams (MessageHistoryTable): typ, stabilt id och version, dataflaggor
    // med valfria fält, flaggor, taggar, vidarebefordran, avsändare, text, attribut, inbäddad media och
    // id för media i t6.
    function decodeMessage(value) {
        var r = new Reader(value);
        var m = {};
        var type = r.u8();
        if (type !== 0) throw new Error('posten är av typ ' + type + ', inte ett meddelande');
        m.stableId = r.u32();
        m.stableVersion = r.u32();
        var df = r.u8();
        if (df & ~63) throw new Error('okända dataflaggor ' + df);
        if (df & 1) m.globallyUniqueId = r.i64();
        if (df & 2) m.globalTags = r.u32();
        if (df & 4) m.groupingKey = r.i64();
        if (df & 8) m.groupInfo = r.u32();
        if (df & 16) m.localTags = r.u32();
        if (df & 32) m.threadId = r.i64();
        m.flags = r.u32();
        m.tags = r.u32();
        var ff = r.u8();
        if (ff) {
            m.forward = { author: r.i64(), date: r.i32() };
            if (ff & 2) m.forward.source = r.i64();
            if (ff & 4) m.forward.sourceMessage = { peer: r.i64(), namespace: r.i32(), id: r.i32() };
            if (ff & 8) m.forward.signature = r.text(r.i32());
            if (ff & 16) m.forward.psaType = r.text(r.i32());
            if (ff & 32) m.forward.flags = r.i32();
        }
        if (r.u8() === 1) m.author = r.i64();
        m.text = r.text(r.i32());
        m.attributes = list(r, function () { return decodeRoot(r.bytes(r.i32())); });
        m.media = list(r, function () { return decodeRoot(r.bytes(r.i32())); });
        m.referencedMedia = list(r, function () { return { namespace: r.i32(), id: r.i64() }; });
        // Efter media-id följer ett antal (0 i labbet) för fält som inte avkodas här.
        m.tail = r.left();
        m.tailCount = m.tail >= 4 ? r.i32() : null;
        return m;
    }

    function str(v) { return v === undefined || v === null ? null : typeof v === 'bigint' ? v.toString() : v; }
    function num(v) { return v === undefined || v === null ? null : typeof v === 'bigint' ? Number(v) : v; }

    // Resursens id, som Telegram namnger filen under postbox/media/ och raden i lagringsdatabasen med.
    function resourceId(res) {
        if (!res) return null;
        switch (res['@']) {
            case 'CloudPhotoSizeMediaResource': return 'telegram-cloud-photo-size-' + res.d + '-' + str(res.i) + '-' + res.s;
            case 'CloudDocumentMediaResource': return 'telegram-cloud-document-' + res.d + '-' + str(res.f);
            case 'CloudDocumentSizeMediaResource': return 'telegram-cloud-document-size-' + res.d + '-' + str(res.i) + '-' + res.s;
            case 'LocalFileMediaResource': return 'telegram-local-file-' + str(res.f);
        }
        return null;
    }
    function resourceSize(res) { return res ? num(res.n64 !== undefined ? res.n64 : res.n) : null; }

    // Det viktigaste ur meddelandets media: slag, MIME, storlek, mått, längd, filnamn, samtal och resurserna.
    function mediaSummary(media) {
        var out = { classes: [], kind: null, mime: null, size: null, width: null, height: null, duration: null, fileName: null, action: null, call: null, resources: [] };
        var addRep = function (rep, role) {
            var id = resourceId(rep.r);
            if (id) out.resources.push({ id: id, size: resourceSize(rep.r), width: num(rep.dx), height: num(rep.dy), role: role });
        };
        (media || []).forEach(function (m) {
            var c = m['@'];
            out.classes.push(c);
            if (out.kind) return;
            if (c === 'TelegramMediaImage') {
                var reps = m.r || [];
                reps.forEach(function (rep) { addRep(rep, 'bild'); });
                var big = reps.reduce(function (a, b) { return !a || num(b.dx) * num(b.dy) > num(a.dx) * num(a.dy) ? b : a; }, null);
                out.kind = 'bild';
                if (big) { out.width = num(big.dx); out.height = num(big.dy); out.size = resourceSize(big.r); }
            } else if (c === 'TelegramMediaFile') {
                var attrs = m.at || [];
                var by = function (t) { return attrs.find(function (a) { return a.t === t; }) || null; };
                var video = by(4), audio = by(5), name = by(0), img = by(2);
                out.mime = m.mt || null;
                out.size = num(m.s64 !== undefined ? m.s64 : m.s !== undefined ? m.s : resourceSize(m.r));
                out.fileName = name && name.fn ? name.fn : m.r && m.r.fn ? m.r.fn : null;
                if (video) { out.width = num(video.w); out.height = num(video.h); out.duration = num(video.dur); }
                else if (img) { out.width = num(img.w); out.height = num(img.h); }
                if (audio && out.duration == null) out.duration = num(audio.dur);
                out.kind = by(1) ? 'klistermärke' : video ? 'video' : audio ? 'ljud' : /^image\//.test(out.mime || '') ? 'bild (fil)' : /^video\//.test(out.mime || '') ? 'video' : 'fil';
                var main = resourceId(m.r);
                if (main) out.resources.push({ id: main, size: out.size, width: out.width, height: out.height, role: out.kind });
                (m.pr || []).forEach(function (rep) { addRep(rep, 'miniatyr'); });
            } else if (c === 'TelegramMediaAction') {
                out.action = num(m._rawValue);
                if (out.action === PHONE_CALL) {
                    out.kind = 'samtal';
                    out.call = { id: str(m.i), discard: num(m.dr), duration: num(m.d), video: m.vc ? 1 : 0 };
                } else {
                    out.kind = 'tjänstemeddelande';
                }
            } else {
                out.kind = MEDIA_KINDS[c] || c;
            }
        });
        return out;
    }

    function attribute(attrs, name) { return (attrs || []).find(function (a) { return a['@'] === name; }) || null; }

    var MESSAGE_COLUMNS = ['peer_id', 'peer_type', 'peer_tg_id', 'namespace', 'id', 'timestamp', 'incoming', 'flags', 'tags', 'global_tags',
        'author_id', 'author_tg_id', 'forward_author_id', 'forward_date', 'text', 'media', 'media_classes', 'media_mime', 'media_size', 'media_width', 'media_height',
        'media_duration', 'media_file_name', 'view_once', 'autoclear_timeout', 'consumed', 'action', 'call_duration', 'call_video', 'call_discard',
        'grouping_key', 'thread_id', 'media_ref', 'decode_error'];
    var RESOURCE_COLUMNS = ['peer_id', 'namespace', 'message_id', 'resource_id', 'role', 'size', 'width', 'height'];
    var PEER_COLUMNS = ['peer_id', 'peer_type', 'peer_tg_id', 'kind', 'name', 'first_name', 'last_name', 'username', 'phone', 'title', 'class', 'decode_error'];
    var STORAGE_COLUMNS = ['resource_id', 'content_type', 'size', 'peer_id', 'peer_type', 'peer_tg_id', 'message_namespace', 'message_id', 'library_uuid', 'decode_error'];

    // En rad i tg_message (och raderna i tg_resource) för en post i t7.
    function messageRows(key, value) {
        var k = decodeKey(key);
        var p = peerParts(k.peer);
        var row = { peer_id: k.peer.toString(), peer_type: p.type, peer_tg_id: p.id, namespace: k.namespace, id: k.id, timestamp: k.timestamp };
        var resources = [];
        try {
            var m = decodeMessage(value);
            var media = mediaSummary(m.media);
            var clear = attribute(m.attributes, 'AutoclearTimeoutMessageAttribute') || attribute(m.attributes, 'AutoremoveTimeoutMessageAttribute');
            var consumed = attribute(m.attributes, 'ConsumableContentMessageAttribute');
            Object.assign(row, {
                incoming: m.flags & INCOMING ? 1 : 0, flags: m.flags, tags: m.tags, global_tags: m.globalTags != null ? m.globalTags : null,
                author_id: str(m.author), author_tg_id: m.author != null ? peerParts(m.author).id : null, forward_author_id: m.forward ? str(m.forward.author) : null, forward_date: m.forward ? m.forward.date : null,
                text: m.text, media: media.kind, media_classes: media.classes.join(', ') || null, media_mime: media.mime, media_size: media.size,
                media_width: media.width, media_height: media.height, media_duration: media.duration, media_file_name: media.fileName,
                view_once: clear && num(clear.t) === VIEW_ONCE ? 1 : 0, autoclear_timeout: clear ? num(clear.t) : null, consumed: consumed ? (consumed.c ? 1 : 0) : null,
                action: media.action, call_duration: media.call ? media.call.duration : null, call_video: media.call ? media.call.video : null, call_discard: media.call ? media.call.discard : null,
                grouping_key: str(m.groupingKey), thread_id: str(m.threadId),
                media_ref: m.referencedMedia.length ? m.referencedMedia.map(function (x) { return x.namespace + ':' + x.id; }).join(', ') : null,
                decode_error: m.tailCount ? 'okända fält efter media-id (' + m.tail + ' byte)' : null,
            });
            resources = media.resources.map(function (r) {
                return { peer_id: row.peer_id, namespace: row.namespace, message_id: row.id, resource_id: r.id, role: r.role, size: r.size, width: r.width, height: r.height };
            });
        } catch (e) {
            row.decode_error = e.message;
        }
        return { message: row, resources: resources };
    }

    // En rad i tg_peer för en post i t2. Nyckeln läses som text, så att 64-bitarstalet blir exakt.
    function peerRow(keyText, value) {
        var p = peerParts(BigInt(keyText));
        var row = { peer_id: String(keyText), peer_type: p.type, peer_tg_id: p.id, kind: PEER_TYPES[p.type] || 'typ ' + p.type };
        try {
            var o = decodeRoot(value);
            var name = [o.fn, o.ln].filter(Boolean).join(' ');
            Object.assign(row, { name: name || o.t || o.un || null, first_name: o.fn || null, last_name: o.ln || null, username: o.un || null, phone: o.p || null, title: o.t || null, class: o['@'] });
        } catch (e) {
            row.decode_error = e.message;
        }
        return row;
    }

    // Lagringsdatabasen: t15 har resursens id per hash (16 byte), t16 vilken peer och vilket meddelande
    // resursen hör till (hash, peer 8, namnrymd 1, meddelande 4, big endian). Meddelande 0 betyder att det
    // inte var känt när resursen registrerades, till exempel medan en bild ur bildbiblioteket laddades upp.
    function storageInfo(value) {
        var r = new Reader(value);
        var version = r.u8();
        if (version !== 0) throw new Error('okänd version ' + version + ' i t15');
        var n = r.v.getUint16(r.o, true); r.o += 2;
        var id = r.text(n);
        var contentType = r.left() >= 1 ? r.u8() : null;
        var size = r.left() >= 8 ? num(r.i64()) : null;
        return { id: id, contentType: contentType, size: size };
    }
    function hexOf(b) { var s = ''; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; }
    function libraryUuid(id) {
        var m = /^ph-([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})_/.exec(id || '');
        return m ? m[1].toUpperCase() : null;
    }
    function storageRows(t15, t16) {
        var info = {};
        var used = {};
        t15.forEach(function (row) {
            var h = hexOf(row[0]);
            try { info[h] = storageInfo(row[1]); } catch (e) { info[h] = { error: e.message }; }
        });
        var out = [];
        var push = function (h, ref) {
            var i = info[h] || { error: 'hashen saknas i t15' };
            out.push({
                resource_id: i.id || null, content_type: i.contentType != null ? i.contentType : null, size: i.size != null ? i.size : null,
                peer_id: ref ? ref.peer : null, peer_type: ref ? ref.type : null, peer_tg_id: ref ? ref.tgId : null,
                message_namespace: ref ? ref.namespace : null, message_id: ref ? ref.id : null, library_uuid: libraryUuid(i.id), decode_error: i.error || null,
            });
        };
        t16.forEach(function (row) {
            var k = row[0];
            var h = hexOf(k.subarray(0, 16));
            used[h] = true;
            var ref = null;
            if (k.length >= 29) {
                var v = new DataView(k.buffer, k.byteOffset, k.byteLength);
                var peer = v.getBigInt64(16, false);
                if (peer !== BigInt(0)) {
                    var p = peerParts(peer);
                    var mid = v.getInt32(25, false);
                    ref = { peer: peer.toString(), type: p.type, tgId: p.id, namespace: k[24], id: mid || null };
                }
            }
            push(h, ref);
        });
        Object.keys(info).forEach(function (h) { if (!used[h]) push(h, null); });
        return out;
    }

    // ---------- Tabellerna i minnet ----------

    function tableNames(db) {
        var res = db.exec("SELECT name FROM sqlite_master WHERE type = 'table'");
        var names = {};
        (res.length ? res[0].values : []).forEach(function (r) { names[r[0]] = true; });
        return names;
    }

    // postbox: meddelandedatabasen (t7 och t2). storage: lagringsdatabasen (t15, t16 och t17, utan t7).
    // Båda har Postbox-tabellen __meta_fulltext_tables. Kontodatabasen (accounts-metadata) har bara t2 och t3.
    function kindOf(names) {
        if (!names.__meta_fulltext_tables) return null;
        if (names.t7 && names.t2) return 'postbox';
        if (names.t15 && names.t16 && names.t17 && !names.t7) return 'storage';
        return null;
    }

    function rowsOf(db, sql) {
        var res = db.exec(sql);
        return res.length ? res[0].values : [];
    }

    function readPostbox(db) {
        var messages = [], resources = [], peers = [];
        rowsOf(db, 'SELECT key, value FROM t7').forEach(function (r) {
            if (!(r[0] instanceof Uint8Array)) return;
            var out;
            try { out = messageRows(r[0], r[1] instanceof Uint8Array ? r[1] : new Uint8Array(0)); }
            catch (e) { out = { message: { decode_error: 'nyckeln: ' + e.message }, resources: [] }; }
            messages.push(out.message);
            resources = resources.concat(out.resources);
        });
        rowsOf(db, 'SELECT CAST(key AS TEXT), value FROM t2').forEach(function (r) {
            try { peers.push(peerRow(r[0], r[1] instanceof Uint8Array ? r[1] : new Uint8Array(0))); }
            catch (e) { peers.push({ peer_id: String(r[0]), decode_error: e.message }); }
        });
        return { kind: 'postbox', tables: { tg_message: { columns: MESSAGE_COLUMNS, rows: messages }, tg_resource: { columns: RESOURCE_COLUMNS, rows: resources }, tg_peer: { columns: PEER_COLUMNS, rows: peers } } };
    }

    function readStorage(db) {
        var t15 = rowsOf(db, 'SELECT key, value FROM t15').filter(function (r) { return r[0] instanceof Uint8Array && r[1] instanceof Uint8Array; });
        var t16 = rowsOf(db, 'SELECT key FROM t16').filter(function (r) { return r[0] instanceof Uint8Array && r[0].length >= 16; });
        return { kind: 'storage', tables: { tg_storage: { columns: STORAGE_COLUMNS, rows: storageRows(t15, t16) } } };
    }

    var INTEGER_COLUMNS = { peer_type: 1, namespace: 1, id: 1, timestamp: 1, incoming: 1, flags: 1, tags: 1, global_tags: 1, forward_date: 1, media_size: 1, media_width: 1,
        media_height: 1, view_once: 1, autoclear_timeout: 1, consumed: 1, action: 1, call_duration: 1, call_video: 1, call_discard: 1, message_id: 1, size: 1, width: 1,
        height: 1, content_type: 1, message_namespace: 1 };
    function create(db, data) {
        Object.keys(data.tables).forEach(function (name) {
            var t = data.tables[name];
            db.run('DROP TABLE IF EXISTS temp.' + name);
            db.run('CREATE TEMP TABLE ' + name + ' (' + t.columns.map(function (c) { return c + (INTEGER_COLUMNS[c] ? ' INTEGER' : c === 'media_duration' ? ' REAL' : ' TEXT'); }).join(', ') + ')');
            var st = db.prepare('INSERT INTO temp.' + name + ' VALUES (' + t.columns.map(function () { return '?'; }).join(', ') + ')');
            try {
                t.rows.forEach(function (row) { st.run(t.columns.map(function (c) { var v = row[c]; return v === undefined ? null : typeof v === 'bigint' ? v.toString() : v; })); });
            } finally {
                st.free();
            }
        });
    }

    function errorsIn(data) {
        var all = [];
        Object.keys(data.tables).forEach(function (name) {
            data.tables[name].rows.forEach(function (r) { if (r.decode_error) all.push(r.decode_error); });
        });
        return all;
    }

    // Raden till spårbarheten och protokollet.
    function summary(data) {
        var t = data.tables;
        var errors = errorsIn(data);
        var line = data.kind === 'postbox'
            ? 'Telegrams format avkodat i minnet: tg_message (' + t.tg_message.rows.length + ' meddelanden ur t7), tg_resource (' + t.tg_resource.rows.length + ' resurser i meddelandena) och tg_peer (' + t.tg_peer.rows.length + ' kontakter och chattar ur t2). Tabellerna finns inte i filen.'
            : 'Telegrams lagringsdatabas avkodad i minnet: tg_storage (' + t.tg_storage.rows.length + ' rader ur t15 och t16). Tabellen finns inte i filen.';
        if (errors.length) line += ' ' + errors.length + (errors.length === 1 ? ' post' : ' poster') + ' kunde inte avkodas helt (första felet: ' + errors[0] + '); de står med i tabellen med felet i decode_error.';
        return { line: line, errors: errors.length };
    }

    // Lägger Telegrams tabeller i en sql.js-databas när den är en av Telegrams. cache: ett objekt där de
    // avkodade raderna sparas, så att en ny kopia av samma databas inte avkodas igen. Returnerar
    // { kind, tables, line, errors } eller null.
    function attach(db, cache) {
        var kind;
        try { kind = kindOf(tableNames(db)); } catch (e) { return null; }
        if (!kind) return null;
        var data = cache && cache[kind];
        if (!data) {
            data = kind === 'postbox' ? readPostbox(db) : readStorage(db);
            if (cache) cache[kind] = data;
        }
        create(db, data);
        var s = summary(data);
        return { kind: kind, tables: Object.keys(data.tables), line: s.line, errors: s.errors };
    }

    var api = {
        attach: attach, kindOf: kindOf, decodeKey: decodeKey, decodeMessage: decodeMessage, decodeRoot: decodeRoot, messageRows: messageRows,
        peerRow: peerRow, storageRows: storageRows, peerParts: peerParts, resourceId: resourceId, mediaSummary: mediaSummary, libraryUuid: libraryUuid,
        murmur3: murmur3, classHash: classHash, className: className, SEED: SEED, VIEW_ONCE: VIEW_ONCE, CLASS_NAMES: CLASS_NAMES,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.TelegramPostbox = api;
})(typeof window !== 'undefined' ? window : this);
