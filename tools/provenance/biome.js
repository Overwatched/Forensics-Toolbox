// Biome på iOS: strömmarna App.InFocus (appen i förgrunden) och Notification.Usage (notiser) ur
// Library/Biome/streams/restricted/<ström>/local/. Filerna är SEGB: version 1 (iOS 15–16 och ibland 18) har
// postens längd i ett huvud före varje post, version 2 (iOS 17 och senare) har en lista med postens slut, läge
// och tid baklänges i slutet av filen. Varje post är protobuf. Fälten är kontrollerade mot två telefoner
// (iOS 18.7 med version 1 och iOS 26.4 med version 2). Bara local/ läses: remote/<enhet>/ är andra enheter på
// samma konto, och tombstone/ säger bara vilka poster som rensats. Testas i Node.
(function (root) {
    'use strict';

    var MAC_EPOCH_MS = 978307200000;
    var STATE = { 1: 'skriven', 3: 'raderad', 4: 'okänd' };

    function toBytes(v) {
        if (v instanceof Uint8Array) return v;
        if (v instanceof ArrayBuffer) return new Uint8Array(v);
        if (v && v.buffer instanceof ArrayBuffer) return new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength);
        return new Uint8Array(v || []);
    }

    function macMs(sec) { return sec == null || !isFinite(sec) ? null : Math.round(sec * 1000 + MAC_EPOCH_MS); }

    // CRC32 (samma som zlib): version 2 har summan för varje post, version 1 också.
    var CRC_TABLE = null;
    function crc32(b) {
        if (!CRC_TABLE) {
            CRC_TABLE = new Uint32Array(256);
            for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
        }
        var crc = 0xffffffff;
        for (var i = 0; i < b.length; i++) crc = CRC_TABLE[(crc ^ b[i]) & 0xff] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    }

    function isSegb2(b) { return b.length >= 32 && b[0] === 0x53 && b[1] === 0x45 && b[2] === 0x47 && b[3] === 0x42; }
    function isSegb1(b) { return b.length >= 56 && b[52] === 0x53 && b[53] === 0x45 && b[54] === 0x47 && b[55] === 0x42; }
    function isSegb(bytes) { var b = toBytes(bytes); return isSegb2(b) || isSegb1(b); }

    // { version, createdMs, records: [{ index, state, stateText, ms, crcOk, offset, data }] }. Raderade poster är
    // nollade i filen och står med utan data.
    function segb(bytes) {
        var b = toBytes(bytes);
        var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        var records = [];
        if (isSegb2(b)) {
            var count = dv.getInt32(4, true);
            var created = dv.getFloat64(8, true);
            var prev = 0;
            for (var k = 0; k < count; k++) {
                var at = b.length - 16 * (k + 1);
                if (at < 32) break;
                var end = dv.getInt32(at, true), state = dv.getInt32(at + 4, true), t = dv.getFloat64(at + 8, true);
                var start = 32 + prev;
                if (end < prev || 32 + end > at) break;
                var rec = { index: k, state: state, stateText: STATE[state] || 'läge ' + state, ms: macMs(t), offset: start, crcOk: null, data: null };
                if (state === 1 && 32 + end - start > 8) {
                    rec.data = b.subarray(start + 8, 32 + end);
                    rec.crcOk = crc32(rec.data) === dv.getUint32(start, true);
                }
                records.push(rec);
                prev = (end + 3) & ~3;
            }
            return { version: 2, createdMs: macMs(created), records: records };
        }
        if (isSegb1(b)) {
            var dataEnd = Math.min(dv.getInt32(0, true), b.length);
            var i = 56, n = 0;
            while (i + 32 <= dataEnd) {
                var len = dv.getInt32(i, true);
                if (len <= 0 || i + 32 + len > b.length) break;
                var st = dv.getInt32(i + 4, true);
                var r = { index: n++, state: st, stateText: STATE[st] || 'läge ' + st, ms: macMs(dv.getFloat64(i + 8, true)), offset: i, crcOk: null, data: null };
                if (st === 1) {
                    r.data = b.subarray(i + 32, i + 32 + len);
                    r.crcOk = crc32(r.data) === dv.getUint32(i + 24, true);
                }
                records.push(r);
                i = (i + 32 + len + 7) & ~7;
            }
            return { version: 1, createdMs: macMs(dv.getFloat64(8, true)), records: records };
        }
        throw new Error('Filen är inte SEGB');
    }

    // ---------- protobuf: fältnummer -> första värdet (varint som tal, fixed64 som double, text) ----------

    function varint(b, i) {
        var v = 0, mul = 1, c;
        do {
            if (i >= b.length) throw new Error('slut på data');
            c = b[i++];
            v += (c & 0x7f) * mul;
            mul *= 128;
        } while (c & 0x80);
        return [v, i];
    }

    var utf8 = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
    function text(b) { return utf8 ? utf8.decode(b) : Buffer.from(b).toString('utf8'); }

    function fields(b) {
        var out = {};
        var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        var i = 0;
        while (i < b.length) {
            var kv = varint(b, i); i = kv[1];
            var f = Math.floor(kv[0] / 8), w = kv[0] % 8, v;
            if (w === 0) { kv = varint(b, i); v = kv[0]; i = kv[1]; }
            else if (w === 1) { if (i + 8 > b.length) throw new Error('slut på data'); v = dv.getFloat64(i, true); i += 8; }
            else if (w === 5) { if (i + 4 > b.length) throw new Error('slut på data'); v = dv.getFloat32(i, true); i += 4; }
            else if (w === 2) { kv = varint(b, i); i = kv[1]; if (i + kv[0] > b.length) throw new Error('slut på data'); v = text(b.subarray(i, i + kv[0])); i += kv[0]; }
            else throw new Error('okänd trådtyp ' + w);
            if (!(f in out)) out[f] = v;
        }
        return out;
    }

    function decodeAll(bytes, map) {
        var s = segb(bytes);
        var rows = [];
        var bad = 0;
        s.records.forEach(function (r) {
            if (!r.data) return;
            var f;
            try { f = fields(r.data); } catch (e) { bad++; return; }
            var row = map(f, r);
            if (row) { row.recordMs = r.ms; row.offset = r.offset; row.crcOk = r.crcOk; rows.push(row); }
        });
        var deleted = s.records.filter(function (r) { return r.state === 3; }).length;
        return { version: s.version, createdMs: s.createdMs, rows: rows, records: s.records.length, deleted: deleted, bad: bad };
    }

    // App.InFocus: 3 = 1 när appen kommer i förgrunden, 0 när den lämnar den; 4 = tiden; 6 = appens id;
    // 1 = skälet (SpringBoards transitionReason); 2 = sorten (1 app, 3 kontrollcenter och liknande); 10 = versionen.
    function appInFocus(bytes) {
        return decodeAll(bytes, function (f, r) {
            if (typeof f[6] !== 'string' || f[3] == null) return null;
            return { ms: macMs(typeof f[4] === 'number' ? f[4] : null) || r.ms, starting: Number(f[3]) === 1, app: f[6], reason: typeof f[1] === 'string' ? f[1] : null,
                kind: f[2] != null ? Number(f[2]) : null, version: typeof f[10] === 'string' ? f[10] : null };
        });
    }

    // Notification.Usage: en post per händelse kring en notis. 2 = notisens egen tid (samma för alla händelser
    // kring notisen), 3 = händelsens typ, 4 = appens id, 5 = notisens id, 1 = händelsens id, 8 = titeln (för
    // Snapchat avsändarens namn), 12 = tråden. Postens tid är händelsens tid. Typ 17 kommer inom någon
    // sekund efter notisens tid; vad de andra typerna betyder är inte kontrollerat.
    function notificationUsage(bytes) {
        return decodeAll(bytes, function (f, r) {
            if (typeof f[4] !== 'string') return null;
            return { ms: r.ms, notifiedMs: macMs(typeof f[2] === 'number' ? f[2] : null), type: f[3] != null ? Number(f[3]) : null, app: f[4],
                id: typeof f[5] === 'string' ? f[5] : null, eventId: typeof f[1] === 'string' ? f[1] : null,
                title: typeof f[8] === 'string' ? f[8] : null, thread: typeof f[12] === 'string' ? f[12] : null };
        });
    }

    // En notis per id, med notisens tid och händelsetyperna i ordning. Utan id blir varje händelse en egen notis.
    function notifications(rows) {
        var byId = {};
        var out = [];
        (rows || []).forEach(function (r) {
            var key = r.id || r.eventId || (r.app + '|' + r.ms);
            var n = byId[key];
            if (!n) {
                n = byId[key] = { ms: r.notifiedMs != null ? r.notifiedMs : r.ms, app: r.app, title: r.title, id: r.id, firstEventMs: r.ms, events: [] };
                out.push(n);
            }
            if (r.ms < n.firstEventMs) n.firstEventMs = r.ms;
            n.events.push({ ms: r.ms, type: r.type });
        });
        out.forEach(function (n) { n.events.sort(function (a, b) { return a.ms - b.ms; }); });
        // Samma app, tid och titel under två id är samma notis (iOS lägger ibland in den två gånger).
        var seen = {};
        return out.sort(function (a, b) { return a.ms - b.ms; }).filter(function (n) {
            var k = n.app + '|' + n.ms + '|' + (n.title || '');
            if (seen[k]) { seen[k].copies = (seen[k].copies || 1) + 1; return false; }
            seen[k] = n;
            return true;
        });
    }

    // Händelserna i Wellbeing-rollens form ({ ms, type 1/2, app }) för intervallbygget.
    function focusToEvents(rows) {
        return (rows || []).filter(function (r) { return r.ms != null; })
            .map(function (r) { return { ms: r.ms, type: r.starting ? 1 : 2, app: r.app }; })
            .sort(function (a, b) { return a.ms - b.ms; });
    }

    // ---------- filerna i zippen ----------

    var STREAMS = ['App.InFocus', 'Notification.Usage'];
    var PATH_RE = /(^|\/)Biome\/streams\/(restricted|public)\/([^/]+)\/local\/(\d+)$/;

    // { stream, startMs } för en fil i en ström som läses, annars null. Filens namn är när den skapades, i
    // mikrosekunder sedan 2001. Det säger inte vilka tider posterna har: en fil kan få nya poster långt senare,
    // när de gamla har rensats, så alla filer i strömmen läses.
    function streamOf(name) {
        var m = PATH_RE.exec(String(name || ''));
        if (!m || STREAMS.indexOf(m[3]) < 0) return null;
        return { stream: m[3], startMs: Math.round(Number(m[4]) / 1000 + MAC_EPOCH_MS) };
    }

    function keeper() {
        return function (name) { return !!streamOf(name); };
    }

    // { 'App.InFocus': [poster], 'Notification.Usage': [poster] }, i tidsordning.
    function sortEntries(entries) {
        var out = {};
        STREAMS.forEach(function (s) { out[s] = []; });
        (entries || []).forEach(function (e) { var s = streamOf(e.name); if (s) out[s.stream].push(e); });
        STREAMS.forEach(function (s) { out[s].sort(function (a, b) { return streamOf(a.name).startMs - streamOf(b.name).startMs; }); });
        return out;
    }

    var api = {
        MAC_EPOCH_MS: MAC_EPOCH_MS, STREAMS: STREAMS, isSegb: isSegb, segb: segb, fields: fields, crc32: crc32,
        appInFocus: appInFocus, notificationUsage: notificationUsage, notifications: notifications, focusToEvents: focusToEvents,
        streamOf: streamOf, keeper: keeper, sortEntries: sortEntries,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceBiome = api;
})(typeof window !== 'undefined' ? window : this);
