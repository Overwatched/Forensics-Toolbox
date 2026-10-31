// Androids egna systemloggar som källor i Härkomst: app i förgrunden, skärm och lås ur
// usagestats (protobuf), och kameran ur appops-mappen discrete (Androids binära XML, ABX).
// Båda är filer i extraktionen, inte SQLite, så de läses här byte för byte. Formaten är
// kontrollerade mot en labbtelefon (Android 13): ABX-avkodningen ger samma XML som telefonens
// eget abx2xml, och usagestats-händelserna är desamma som i `dumpsys usagestats`. Ingen DOM,
// ingen SQL. Testas i Node.
(function (root) {
    'use strict';

    // ---------- Protobuf, bara så mycket som behövs ----------

    function varint(b, i) {
        var value = 0, mul = 1, c;
        do {
            c = b[i++];
            value += (c & 0x7f) * mul;
            mul *= 128;
        } while ((c & 0x80) && i < b.length);
        return { value: value, next: i };
    }

    // Går igenom fälten på en nivå och anropar handlers[fält](värde | bytes).
    function message(b, handlers) {
        var i = 0;
        while (i < b.length) {
            var t = varint(b, i);
            i = t.next;
            var f = Math.floor(t.value / 8);
            var w = t.value % 8;
            var h = handlers[f];
            if (w === 0) { var v = varint(b, i); i = v.next; if (h) h(v.value); }
            else if (w === 1) { i += 8; }
            else if (w === 5) { i += 4; }
            else if (w === 2) {
                var l = varint(b, i);
                i = l.next;
                if (i + l.value > b.length) throw new Error('protobuf: fältet går utanför filen');
                if (h) h(b.subarray(i, i + l.value));
                i += l.value;
            } else throw new Error('protobuf: okänd wire type ' + w);
        }
    }

    function toBytes(v) {
        if (!v) return new Uint8Array(0);
        if (v instanceof Uint8Array) return v;
        if (v.buffer) return new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength);
        return new Uint8Array(v);
    }

    var decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
    function text(b) {
        if (decoder) return decoder.decode(b);
        var s = '';
        for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
        return s;
    }

    // ---------- ABX: Androids binära XML ----------

    // Token: låg nibble = typ (0 START_DOCUMENT, 1 END_DOCUMENT, 2 START_TAG, 3 END_TAG,
    // 4 TEXT, 5 CDSECT, 7 IGNORABLE_WHITESPACE, 9 COMMENT, 15 ATTRIBUTE), hög nibble = datatyp
    // (1 null, 2 sträng, 3 internerad sträng, 4 hex, 5 base64, 6 int, 7 int hex, 8 long,
    // 9 long hex, 10 float, 11 double, 12 true, 13 false). Internerade strängar: u16-index,
    // 0xFFFF = ny sträng (u16 längd + bytes) som läggs till tabellen.
    function abxParse(bytes) {
        var b = toBytes(bytes);
        if (b.length < 4 || b[0] !== 0x41 || b[1] !== 0x42 || b[2] !== 0x58 || b[3] !== 0) throw new Error('inte ABX (magic "ABX\\0" saknas)');
        var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        var interned = [];
        var p = 4;
        function utf() { var n = dv.getUint16(p); p += 2; var s = text(b.subarray(p, p + n)); p += n; return s; }
        function intern() { var i = dv.getUint16(p); p += 2; if (i === 0xffff) { var s = utf(); interned.push(s); return s; } return interned[i]; }
        function bytesOf() { var n = dv.getUint16(p); p += 2; var s = b.subarray(p, p + n); p += n; return s; }
        function hexOf(s) { var out = ''; for (var i = 0; i < s.length; i++) out += (s[i] < 16 ? '0' : '') + s[i].toString(16); return out; }
        function value(dt) {
            switch (dt) {
                case 1: return null;
                case 2: return utf();
                case 3: return intern();
                case 4: return hexOf(bytesOf());
                case 5: { var raw = bytesOf(); var bin = ''; for (var i = 0; i < raw.length; i++) bin += String.fromCharCode(raw[i]); return typeof btoa === 'function' ? btoa(bin) : hexOf(raw); }
                case 6: case 7: { var v = dv.getInt32(p); p += 4; return v; }
                case 8: case 9: { var big = dv.getBigInt64(p); p += 8; return Number(big); }
                case 10: { var f = dv.getFloat32(p); p += 4; return f; }
                case 11: { var d = dv.getFloat64(p); p += 8; return d; }
                case 12: return true;
                case 13: return false;
                default: throw new Error('ABX: okänd datatyp ' + dt + ' vid byte ' + p);
            }
        }
        var doc = { name: '#doc', attrs: {}, children: [] };
        var stack = [doc];
        while (p < b.length) {
            var token = b[p++];
            var type = token & 0x0f;
            var dt = token >> 4;
            if (type === 0) continue;
            if (type === 1) break;
            if (type === 2) { var el = { name: intern(), attrs: {}, children: [] }; stack[stack.length - 1].children.push(el); stack.push(el); continue; }
            if (type === 3) { intern(); if (stack.length > 1) stack.pop(); continue; }
            if (type === 15) { var name = intern(); stack[stack.length - 1].attrs[name] = value(dt); continue; }
            if (type === 4 || type === 5 || type === 7 || type === 9) { value(dt); continue; }
            throw new Error('ABX: okänd token ' + token + ' vid byte ' + (p - 1));
        }
        return doc;
    }

    function escXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

    // Samma utskrift som telefonens abx2xml, för kontroll.
    function abxToXml(el, indent) {
        indent = indent || '';
        if (el.name === '#doc') return el.children.map(function (c) { return abxToXml(c, indent); }).join('');
        var attrs = Object.keys(el.attrs).map(function (k) { return ' ' + k + '="' + escXml(el.attrs[k]) + '"'; }).join('');
        if (!el.children.length) return indent + '<' + el.name + attrs + ' />\n';
        return indent + '<' + el.name + attrs + '>\n' + el.children.map(function (c) { return abxToXml(c, indent + '  '); }).join('') + indent + '</' + el.name + '>\n';
    }

    // ---------- appops discrete: kamera, mikrofon, position per app ----------

    // AppOpsManager-koder med belägg i labbtelefonen. Övriga visas som "op N".
    var OPS = { 0: 'grov position', 1: 'position', 26: 'kamera', 27: 'mikrofon', 51: 'tangentbord/IME', 108: 'position i bakgrunden', 111: 'systemuppgift' };
    var OP_CAMERA = 26;
    var OP_MICROPHONE = 27;
    var OP_FINE_LOCATION = 1;

    var DISCRETE_RE = /(^|\/)appops\/discrete\/(\d+)tl$/;
    var USAGE_VERSION_RE = /(^|\/)usagestats\/(?:\d+\/)?version$/;
    var USAGE_MAPPINGS_RE = /(^|\/)usagestats\/(?:\d+\/)?mappings$/;
    var USAGE_DAILY_RE = /(^|\/)usagestats\/(?:\d+\/)?daily\/(\d+)$/;

    function isDiscretePath(name) { return DISCRETE_RE.test(String(name || '')); }
    // Filen skrivs när registret töms; namnet är skrivtiden i ms. Allt i filen hände före den.
    function discreteWrittenMs(name) { var m = DISCRETE_RE.exec(String(name || '')); return m ? Number(m[2]) : null; }

    // <h><u ui><p pn><o op><a at?><e nt nd? us f/>… -> rader. nd är längden i ms och står på en
    // egen rad med samma nt när operationen avslutats, ibland i en senare fil.
    function discreteOps(bytes) {
        var doc = abxParse(bytes);
        var rows = [];
        function walk(el, ctx) {
            var next = ctx;
            if (el.name === 'u') next = Object.assign({}, ctx, { uid: el.attrs.ui });
            else if (el.name === 'p') next = Object.assign({}, ctx, { pkg: el.attrs.pn });
            else if (el.name === 'o') next = Object.assign({}, ctx, { op: Number(el.attrs.op) });
            else if (el.name === 'a') next = Object.assign({}, ctx, { attribution: el.attrs.at == null ? null : String(el.attrs.at) });
            else if (el.name === 'e') {
                var nt = el.attrs.nt == null ? null : Number(el.attrs.nt);
                var nd = el.attrs.nd == null ? null : Number(el.attrs.nd);
                if (nt != null && isFinite(nt)) {
                    rows.push({ uid: ctx.uid == null ? null : Number(ctx.uid), pkg: ctx.pkg || null, op: ctx.op == null ? null : ctx.op, attribution: ctx.attribution || null,
                        ms: nt, durationMs: nd != null && isFinite(nd) && nd >= 0 ? nd : null, uidState: el.attrs.us == null ? null : Number(el.attrs.us), flags: el.attrs.f == null ? null : Number(el.attrs.f) });
                }
                return;
            }
            el.children.forEach(function (c) { walk(c, next); });
        }
        walk(doc, {});
        return rows;
    }

    // Raderna för en operation hopslagna till intervall per app: startraden (utan nd) och
    // slutraden (med nd) har samma nt. Utan slutrad är intervallet öppet (pågick när filen skrevs,
    // eller slutet ligger i en fil som inte finns med). rows kan komma från många filer.
    function opIntervals(rows, opCode) {
        var byKey = {};
        var order = [];
        (rows || []).forEach(function (r) {
            if (opCode != null && Number(r.op) !== Number(opCode)) return;
            var key = (r.pkg || '') + '|' + r.op + '|' + r.ms;
            if (!byKey[key]) { byKey[key] = { startMs: r.ms, endMs: null, durationMs: null, app: r.pkg, op: Number(r.op), opName: OPS[Number(r.op)] || ('op ' + r.op), uid: r.uid, attribution: r.attribution, open: true }; order.push(key); }
            var iv = byKey[key];
            if (r.durationMs != null && (iv.durationMs == null || r.durationMs > iv.durationMs)) { iv.durationMs = r.durationMs; iv.endMs = r.ms + r.durationMs; iv.open = false; }
            if (r.attribution && !iv.attribution) iv.attribution = r.attribution;
        });
        return order.map(function (k) { return byKey[k]; }).sort(function (a, b) { return a.startMs - b.startMs || String(a.app).localeCompare(String(b.app)); });
    }

    // Vilka discrete-filer som kan innehålla händelser i fönstret: de som skrevs efter fönstrets
    // start (innehållet är äldre än skrivtiden). Slutraden för en operation kan ligga i en senare
    // fil, så alla senare filer tas med upp till taket.
    function pickDiscrete(entries, range, max) {
        max = max || 600;
        return (entries || []).filter(function (e) { var ms = discreteWrittenMs(e.name); return ms != null && ms >= range.startMs; })
            .sort(function (a, b) { return discreteWrittenMs(a.name) - discreteWrittenMs(b.name); }).slice(0, max);
    }

    // ---------- usagestats: app i förgrunden, skärm, lås ----------

    var USAGE_TYPES = {
        1: 'ACTIVITY_RESUMED', 2: 'ACTIVITY_PAUSED', 3: 'END_OF_DAY', 4: 'CONTINUE_PREVIOUS_DAY', 5: 'CONFIGURATION_CHANGE', 6: 'SYSTEM_INTERACTION', 7: 'USER_INTERACTION',
        8: 'SHORTCUT_INVOCATION', 9: 'CHOOSER_ACTION', 10: 'NOTIFICATION_SEEN', 11: 'STANDBY_BUCKET_CHANGED', 12: 'NOTIFICATION_INTERRUPTION', 13: 'SLICE_PINNED_PRIV', 14: 'SLICE_PINNED',
        15: 'SCREEN_INTERACTIVE', 16: 'SCREEN_NON_INTERACTIVE', 17: 'KEYGUARD_SHOWN', 18: 'KEYGUARD_HIDDEN', 19: 'FOREGROUND_SERVICE_START', 20: 'FOREGROUND_SERVICE_STOP',
        21: 'CONTINUING_FOREGROUND_SERVICE', 22: 'ROLLOVER_FOREGROUND_SERVICE', 23: 'ACTIVITY_STOPPED', 24: 'ACTIVITY_DESTROYED', 25: 'FLUSH_TO_DISK', 26: 'DEVICE_SHUTDOWN',
        27: 'DEVICE_STARTUP', 28: 'USER_UNLOCKED', 29: 'USER_STOPPED', 30: 'LOCUS_ID_SET', 31: 'APP_COMPONENT_USED',
    };
    // De händelser Härkomst använder: samma koder som Wellbeing-rollen (1 RESUMED, 2 PAUSED,
    // 23 STOPPED, 15/16 skärm, 17/18 låsskärm).
    var USAGE_WANTED = { 1: 1, 2: 1, 23: 1, 15: 1, 16: 1, 17: 1, 18: 1 };

    function isUsageVersionPath(name) { return USAGE_VERSION_RE.test(String(name || '')); }
    function isUsageMappingsPath(name) { return USAGE_MAPPINGS_RE.test(String(name || '')); }
    function isUsageDailyPath(name) { return USAGE_DAILY_RE.test(String(name || '')); }
    function dailyBeginMs(name) { var m = USAGE_DAILY_RE.exec(String(name || '')); return m ? Number(m[2]) : null; }

    // Filen version: första raden är databasversionen (3 = XML, 4 = protobuf, 5 = protobuf med
    // mappings), andra raden "release;codename;build" (Build.VERSION), t.ex. "13;REL;f8fb74d040".
    function usageVersion(bytes) {
        var lines = text(toBytes(bytes)).split(/\r?\n/);
        var version = parseInt(lines[0], 10);
        var parts = (lines[1] || '').split(';');
        return { version: isFinite(version) ? version : null, release: parts[0] || null, codename: parts[1] || null, build: parts[2] || null, text: lines.slice(0, 2).join(' / ') };
    }

    // mappings (version 5): fält 2 upprepat { 1 token, 2 strängar… }. token -> [paketnamn, klass…].
    // Klasstoken t i en händelse är strängar[t − 1]; paketnamnet är strängar[0].
    function usageMappings(bytes) {
        var map = {};
        message(toBytes(bytes), { 2: function (m) {
            var token = null, strings = [];
            message(m, { 1: function (v) { token = v; }, 2: function (s) { strings.push(text(s)); } });
            if (token != null) map[token] = strings;
        } });
        return map;
    }

    // En dagsfil: version 5 (IntervalStatsObfuscatedProto) med tokens som slås upp i mappings,
    // eller version 4 (IntervalStatsProto) med sin egen strängpool. Tiderna i filen är relativa
    // filens begynnelsetid (filnamnet). Returnerar { beginMs, endMs, events }.
    function usageDaily(bytes, beginMs, map, version) {
        var b = toBytes(bytes);
        var out = { beginMs: beginMs, endMs: null, events: [], version: version || 5 };
        var pool = null;
        if (Number(version) === 4) {
            pool = [];
            message(b, { 2: function (sp) { message(sp, { 2: function (s) { pool.push(text(s)); } }); } });
        }
        var str = function (pkgTok, tok) {
            if (pool) return tok ? pool[tok - 1] || null : null;
            var l = map && map[pkgTok];
            if (!l) return null;
            return tok ? l[tok - 1] || null : l[0] || null;
        };
        message(b, {
            1: function (v) { out.endMs = beginMs + v; },
            22: function (m) {
                var e = {};
                if (pool) {
                    message(m, { 1: function (v) { e.pkgTok = v; }, 2: function (v) { e.clsTok = v; }, 3: function (v) { e.rel = v; }, 4: function (v) { e.flags = v; }, 5: function (v) { e.type = v; }, 11: function (v) { e.bucket = v; }, 13: function (v) { e.instance = v; }, 14: function (v) { e.rootPkgTok = v; } });
                    e.pkg = str(null, e.pkgTok); e.cls = e.clsTok ? str(null, e.clsTok) : null; e.rootPkg = e.rootPkgTok ? str(null, e.rootPkgTok) : null;
                } else {
                    message(m, { 1: function (v) { e.pkgTok = v; }, 2: function (v) { e.clsTok = v; }, 3: function (v) { e.rel = v; }, 4: function (v) { e.flags = v; }, 5: function (v) { e.type = v; }, 8: function (v) { e.bucket = v; }, 10: function (v) { e.instance = v; }, 11: function (v) { e.rootPkgTok = v; } });
                    e.pkg = str(e.pkgTok, 0); e.cls = e.clsTok ? str(e.pkgTok, e.clsTok) : null; e.rootPkg = e.rootPkgTok ? str(e.rootPkgTok, 0) : null;
                }
                e.ms = beginMs + (e.rel || 0);
                e.typeName = USAGE_TYPES[e.type] || ('typ ' + e.type);
                out.events.push(e);
            },
        });
        out.events.sort(function (a, b) { return a.ms - b.ms; });
        return out;
    }

    // Dagsfilerna som kan täcka fönstret: begynnelsetiden före fönstrets slut, och nästa fils
    // begynnelsetid (eller två dygn) efter fönstrets start. Dagsfilen skrivs när loggen töms, så
    // de sista minuterna före extraktionen kan saknas; det syns på endMs.
    function pickDaily(entries, range) {
        var list = (entries || []).filter(function (e) { return dailyBeginMs(e.name) != null; })
            .sort(function (a, b) { return dailyBeginMs(a.name) - dailyBeginMs(b.name); });
        return list.filter(function (e, i) {
            var begin = dailyBeginMs(e.name);
            var next = i + 1 < list.length ? dailyBeginMs(list[i + 1].name) : begin + 2 * 86400000;
            return begin <= range.endMs && next >= range.startMs;
        });
    }

    // Händelserna i Wellbeing-rollens form ({ ms, type, app }) för intervallbygget.
    function usageToEvents(dailies) {
        var out = [];
        (dailies || []).forEach(function (d) {
            d.events.forEach(function (e) {
                if (!USAGE_WANTED[e.type]) return;
                out.push({ ms: e.ms, type: e.type, app: e.pkg || (e.type >= 15 && e.type <= 18 ? 'android' : null), cls: e.cls || null, instance: e.instance || null });
            });
        });
        out.sort(function (a, b) { return a.ms - b.ms; });
        return out;
    }

    // Täckning: första och sista händelse och antal i de avkodade dagsfilerna.
    function usageCoverage(dailies) {
        var first = null, last = null, rows = 0;
        (dailies || []).forEach(function (d) {
            d.events.forEach(function (e) {
                rows++;
                if (first == null || e.ms < first) first = e.ms;
                if (last == null || e.ms > last) last = e.ms;
            });
        });
        return { firstMs: first, lastMs: last, rows: rows };
    }

    // keep(namn) till genomgången av innehållsförteckningen: bara loggfilerna.
    function keeper() {
        return function (name) {
            if (name.charAt(name.length - 1) === '/') return false;
            return DISCRETE_RE.test(name) || USAGE_DAILY_RE.test(name) || USAGE_MAPPINGS_RE.test(name) || USAGE_VERSION_RE.test(name);
        };
    }

    // Posterna sorterade per sort: { version, mappings, daily: [], discrete: [] }. Finns flera
    // användare (usagestats/10/…) tas den första användaren (lägst nummer) som har mappings.
    function sortEntries(entries) {
        var out = { version: null, mappings: null, daily: [], discrete: [] };
        var byUser = {};
        (entries || []).forEach(function (e) {
            if (isDiscretePath(e.name)) { out.discrete.push(e); return; }
            // Användaren står före (system_ce/<n>/usagestats) eller efter (usagestats/<n>/) mappen.
            var m = /(^|\/)(?:system_ce\/(\d+)\/)?usagestats\/(?:(\d+)\/)?/.exec(e.name);
            if (!m) return;
            var user = m[2] != null ? m[2] : m[3] != null ? m[3] : '0';
            if (!byUser[user]) byUser[user] = { version: null, mappings: null, daily: [] };
            if (isUsageVersionPath(e.name)) byUser[user].version = e;
            else if (isUsageMappingsPath(e.name)) byUser[user].mappings = e;
            else if (isUsageDailyPath(e.name)) byUser[user].daily.push(e);
        });
        var users = Object.keys(byUser).sort(function (a, b) { return Number(a) - Number(b); });
        var pick = users.find(function (u) { return byUser[u].daily.length; });
        if (pick) { out.version = byUser[pick].version; out.mappings = byUser[pick].mappings; out.daily = byUser[pick].daily; out.user = Number(pick); }
        return out;
    }

    var api = {
        abxParse: abxParse, abxToXml: abxToXml,
        OPS: OPS, OP_CAMERA: OP_CAMERA, OP_MICROPHONE: OP_MICROPHONE, OP_FINE_LOCATION: OP_FINE_LOCATION,
        isDiscretePath: isDiscretePath, discreteWrittenMs: discreteWrittenMs, discreteOps: discreteOps, opIntervals: opIntervals, pickDiscrete: pickDiscrete,
        USAGE_TYPES: USAGE_TYPES, isUsageVersionPath: isUsageVersionPath, isUsageMappingsPath: isUsageMappingsPath, isUsageDailyPath: isUsageDailyPath, dailyBeginMs: dailyBeginMs,
        usageVersion: usageVersion, usageMappings: usageMappings, usageDaily: usageDaily, pickDaily: pickDaily, usageToEvents: usageToEvents, usageCoverage: usageCoverage,
        keeper: keeper, sortEntries: sortEntries, message: message, varint: varint,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceAndroidLogs = api;
})(typeof window !== 'undefined' ? window : this);
