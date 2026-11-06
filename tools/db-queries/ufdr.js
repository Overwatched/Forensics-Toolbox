// Läser en UFDR, rapporten som Cellebrite Physical Analyzer skriver. En UFDR är en zip: filerna ligger
// under files/ med rapportens egna namn (files/Image/IMG_0033.HEIC), och report.xml säger vilken fil på
// telefonen varje namn är, med telefonens sökväg, tider och hashsummor. Här blir det en
// innehållsförteckning i minnet i samma form som en zips, med telefonens sökvägar som namn, så att
// Queries och Härkomst läser rapporten som vilken extraktion som helst. Filerna läses ur rapporten med
// ZipRead, och inget skrivs. report.xml kan vara över 1 GB och läses därför i bitar, som byte.
//
// Vad rapporterna visar, jämfört fil för fil med extraktionen de kom från (docs/DEVELOPMENT.md):
// - Innehållet är samma byte. En fil med samma innehåll på flera ställen ligger en gång och listas under
//   RelatedNodes med egna sökvägar och tider.
// - Tom fil: raden pekar på en post som inte finns, och summorna är N/A.
// - ModifyTime är filens ändringstid, AccessTime dess åtkomsttid och CreationTime dess skapandetid. ChangeTime är
//   filens ctime: den finns när zippen rapporten kom ur har den (metadata.msgpack), annars är den tom. En fil utan
//   tider får ModifyTime 1980-01-01 (zippens nolla) och inga andra tider.
// - Rader utan fil på telefonen: filer som Physical Analyzer utvunnit ur andra filer (embedded="true"
//   eller med en fil i sökvägen, som .../signal.sqlite/signal.sqlite.decrypted) och nyckelfilerna.
// - Rapporten är ett urval. Vad som saknas står ingenstans.
// Testas i Node.
(function (root) {
    'use strict';

    // ZipRead är global i webbläsaren. I Node skickas den in med use().
    var deps = {};
    function dep(name) {
        if (deps[name]) return deps[name];
        if (typeof root[name] !== 'undefined') return root[name];
        throw new Error(name + ' saknas');
    }

    var REPORT_NAME = 'report.xml';
    var FIELD_ID = 0x5546;   // zip.js känner igen fältet, bara i en förteckning som byggts här
    var SIG_CENTRAL = 0x02014b50;
    var CHUNK = 16 * 1024 * 1024;
    // Filens tid när Physical Analyzer inte har någon: zippens nolla, 1980-01-01 00:00:00.
    var NO_TIME_MS = 315532800000;
    // ctime står, om den finns, i avsnittet som annars hoppas över. Namnet står först i taggen.
    var CHANGE_ITEM = '<item name="CoreFileSystemFileSystemNodeChangeTime"';
    // Nyckelfilerna. Ur en zip med nyckelringen bredvid har den fs="Keychain". Ur en zip med extra/ flyttar rapporten
    // filerna högst upp, utanför telefonens filsystem: extra/KeychainDump/backup_keychain_v2.plist blir
    // /backup_keychain_v2.plist och extra/Secrets/secrets.json blir /Secrets/secrets.json.
    var KEY_ROW = /^\/(?:[^/]*keychain[^/]*\.plist|Secrets\/secrets\.json)$/i;
    var TOOL_ROW = /^\/Secrets\//;
    var FILE_ITEMS = { 'Local Path': 'local', SHA256: 'sha256', MD5: 'md5', Tags: 'tags', MediaOrigin: 'origin', MediaOriginReasoning: 'originReason', ServiceIdentifier: 'service', AdjustedTimestamp: 'adjustedTime', AdjustedLocation: 'adjustedLocation' };

    var utf8 = new TextDecoder('utf-8');
    var encoder = new TextEncoder();
    var DONE = { done: true };

    function isAt(b, at, word) {
        for (var i = 0; i < word.length; i++) if (b[at + i] !== word.charCodeAt(i)) return false;
        return true;
    }

    // Slutet på taggen som börjar vid at: >, men inte inne i ett attributvärde. -1 om den inte är slut i bufferten.
    function tagEnd(b, at) {
        var quoted = false;
        for (var i = at, n = b.length; i < n; i++) {
            var c = b[i];
            if (c === 34) quoted = !quoted;
            else if (c === 62 && !quoted) return i;
        }
        return -1;
    }

    function cdataEnd(b, from) {
        var n = b.length;
        for (var i = b.indexOf(93, from); i >= 0 && i + 2 < n; i = b.indexOf(93, i + 1)) {
            if (b[i + 1] === 93 && b[i + 2] === 62) return i;
        }
        return -1;
    }

    var ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
    function unescape(s) {
        if (s.indexOf('&') < 0) return s;
        return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, function (all, e) {
            if (e.charAt(0) !== '#') return ENTITIES[e];
            var code = e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
        });
    }

    function attr(tag, name) {
        var at = tag.indexOf(' ' + name + '="');
        if (at < 0) return null;
        var start = at + name.length + 3;
        var end = tag.indexOf('"', start);
        return end < 0 ? null : unescape(tag.slice(start, end));
    }

    // En tid räknas bara med zon i texten. Annars går den inte att placera.
    function timeMs(text) {
        var s = String(text || '').trim();
        if (!/(?:Z|[+-]\d\d:\d\d)$/.test(s)) return null;
        var ms = Date.parse(s);
        return isNaN(ms) ? null : ms;
    }

    // Avsnittet MetaData skriver tiden med zonen i parentes: 2026-04-05 04:54:46(UTC+2). Samma tid som i
    // accessInfo på alla 842 969 värden i en riktig rapport.
    function metaTimeMs(text) {
        var m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(?:\.(\d+))?\(UTC(?:([+-])(\d{1,2})(?::(\d\d))?)?\)$/.exec(String(text || '').trim());
        if (!m) return null;
        var off = (Number(m[9] || 0) * 60 + Number(m[10] || 0)) * (m[8] === '-' ? -1 : 1);
        return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? Math.round(Number('0.' + m[7]) * 1000) : 0) - off * 60000;
    }

    // Ett elements värde, där taggen slutar vid ie: { value, next }, eller null om det inte är slut i bufferten.
    function elementValue(b, ie) {
        var vs = ie + 1;
        if (b.length - vs < 9) return null;
        if (isAt(b, vs, '<![CDATA[')) {
            var ve = cdataEnd(b, vs + 9);
            return ve < 0 ? null : { value: utf8.decode(b.subarray(vs + 9, ve)), next: ve + 3 };
        }
        var pe = b.indexOf(60, vs);
        return pe < 0 ? null : { value: unescape(utf8.decode(b.subarray(vs, pe))), next: pe };
    }

    // Går igenom report.xml i bitar, som byte: en tagg i taget, och bara det som behövs avkodas. Metadata
    // utom avsnittet File hoppas över: det är större delen av filen. push(bytes) med nästa bit, och
    // bitarna kan delas var som helst, och svaret är true när filerna är slut. on.header(text) får allt före
    // <taggedFiles>, och on.file(rad) varje fil, också de under RelatedNodes.
    function createScanner(on) {
        var head = [];
        var inFiles = false;
        var skipping = false;
        var carry = null;
        var stack = [];
        var section = '';

        function finish() {
            var r = stack.pop();
            if (r) on.file(r);
        }

        function concat(a, b) {
            var out = new Uint8Array(a.length + b.length);
            out.set(a);
            out.set(b, a.length);
            return out;
        }

        // Rubriken: allt fram till <taggedFiles>, som aldrig är stort.
        function findStart(b) {
            for (var at = b.indexOf(60); at >= 0; at = b.indexOf(60, at + 1)) {
                if (at + 13 > b.length) return { partial: at };
                if (isAt(b, at, '<taggedFiles')) return { at: at };
            }
            return null;
        }

        function push(chunk) {
            var b = carry ? concat(carry, chunk) : chunk;
            carry = null;
            var at = 0;
            if (!inFiles) {
                var found = findStart(b);
                if (!found || found.partial !== undefined) {
                    var cut = found ? found.partial : b.length;
                    head.push(b.slice(0, cut));
                    if (cut < b.length) carry = b.slice(cut);
                    return;
                }
                head.push(b.slice(0, found.at));
                var whole = new Uint8Array(head.reduce(function (s, x) { return s + x.length; }, 0));
                head.reduce(function (s, x) { whole.set(x, s); return s + x.length; }, 0);
                on.header(utf8.decode(whole));
                head = [];
                inFiles = true;
                at = found.at + 13;
            }
            var n = b.length;
            for (;;) {
                var lt = b.indexOf(60, at);
                if (lt < 0) return;
                if (n - lt < CHANGE_ITEM.length) { carry = b.slice(lt); return; }
                var c = b[lt + 1];
                // CDATA, var det än står.
                if (c === 33) {
                    var ce = cdataEnd(b, lt + 9);
                    if (ce < 0) { carry = b.slice(lt); return; }
                    at = ce + 3;
                    continue;
                }
                if (skipping) {
                    if (c === 47 && isAt(b, lt, '</metadata>')) { skipping = false; section = ''; at = lt + 11; }
                    else if (c === 105 && isAt(b, lt, CHANGE_ITEM)) {
                        var ge = tagEnd(b, lt + 1);
                        if (ge < 0) { carry = b.slice(lt); return; }
                        if (b[ge - 1] === 47) { at = ge + 1; continue; }
                        var gv = elementValue(b, ge);
                        if (!gv) { carry = b.slice(lt); return; }
                        var r1 = stack[stack.length - 1];
                        if (r1 && r1.x === null) r1.x = metaTimeMs(gv.value);
                        at = gv.next;
                    } else at = lt + 1;
                    continue;
                }
                if (c === 47) {
                    if (isAt(b, lt, '</file>')) { finish(); at = lt + 7; continue; }
                    if (isAt(b, lt, '</metadata>')) { section = ''; at = lt + 11; continue; }
                    if (isAt(b, lt, '</taggedFiles>')) throw DONE;
                    at = lt + 1;
                    continue;
                }
                if (isAt(b, lt, '<file ')) {
                    var fe = tagEnd(b, lt + 1);
                    if (fe < 0) { carry = b.slice(lt); return; }
                    var ft = utf8.decode(b.subarray(lt, fe));
                    stack.push({
                        path: attr(ft, 'path') || '', name: attr(ft, 'name') || '', size: Number(attr(ft, 'size')) || 0, fs: attr(ft, 'fs') || '', deleted: attr(ft, 'deleted') || '',
                        embedded: attr(ft, 'embedded') === 'true', related: /^true$/i.test(attr(ft, 'isrelated') || ''),
                        m: null, a: null, c: null, d: null, x: null, local: null, sha256: '', md5: '', tags: '', origin: '', originReason: '', service: '', adjustedTime: '', adjustedLocation: '',
                    });
                    if (b[fe - 1] === 47) finish();
                    at = fe + 1;
                    continue;
                }
                if (isAt(b, lt, '<timestamp ')) {
                    var te = tagEnd(b, lt + 1);
                    if (te < 0) { carry = b.slice(lt); return; }
                    if (b[te - 1] === 47) { at = te + 1; continue; }
                    var tv = b.indexOf(60, te + 1);
                    if (tv < 0) { carry = b.slice(lt); return; }
                    var r0 = stack[stack.length - 1];
                    if (r0) {
                        var tn = attr(utf8.decode(b.subarray(lt, te)), 'name');
                        var key = tn === 'ModifyTime' ? 'm' : tn === 'AccessTime' ? 'a' : tn === 'CreationTime' ? 'c' : tn === 'DeletedTime' ? 'd' : tn === 'ChangeTime' ? 'x' : '';
                        if (key) r0[key] = timeMs(utf8.decode(b.subarray(te + 1, tv)));
                    }
                    at = tv;
                    continue;
                }
                if (isAt(b, lt, '<metadata ')) {
                    var me = tagEnd(b, lt + 1);
                    if (me < 0) { carry = b.slice(lt); return; }
                    if (b[me - 1] !== 47) {
                        section = attr(utf8.decode(b.subarray(lt, me)), 'section') || '';
                        if (section !== 'File') skipping = true;
                    }
                    at = me + 1;
                    continue;
                }
                if (section === 'File' && isAt(b, lt, '<item ')) {
                    var ie = tagEnd(b, lt + 1);
                    if (ie < 0) { carry = b.slice(lt); return; }
                    var field = b[ie - 1] === 47 ? '' : FILE_ITEMS[attr(utf8.decode(b.subarray(lt, ie)), 'name')];
                    if (!field) { at = ie + 1; continue; }
                    var iv = elementValue(b, ie);
                    if (!iv) { carry = b.slice(lt); return; }
                    var top = stack[stack.length - 1];
                    if (top) top[field] = iv.value;
                    at = iv.next;
                    continue;
                }
                at = lt + 1;
            }
        }

        return {
            push: function (chunk) {
                try { push(chunk); return false; }
                catch (err) { if (err === DONE) return true; throw err; }
            },
            started: function () { return inFiles; },
        };
    }

    // Rapportens uppgifter om sig själv, ur början av report.xml.
    function parseHeader(text) {
        var info = { project: {}, extraction: {}, items: {}, images: [] };
        var open = function (tag) { var m = new RegExp('<' + tag + '\\s[^>]*>').exec(text); return m ? m[0] : ''; };
        var project = open('project');
        ['id', 'name', 'reportVersion', 'extractionType', 'NodeCount', 'ModelCount', 'containsGarbage'].forEach(function (k) { info.project[k] = attr(project, k); });
        var ex = open('extractionInfo');
        ['name', 'type', 'deviceName', 'fullName', 'IsPartialData', 'IsStoppedByUser', 'IsTriageExtraction', 'IsSelectiveExtraction'].forEach(function (k) { info.extraction[k] = attr(ex, k); });
        var item = /<item\s[^>]*?name="([^"]*)"[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/item>/g;
        for (var m = item.exec(text); m; m = item.exec(text)) info.items[unescape(m[1])] = m[2] !== undefined ? m[2] : unescape(m[3] || '');
        var img = /<image\s[^>]*>/g;
        for (var g = img.exec(text); g; g = img.exec(text)) info.images.push({ key: attr(g[0], 'key'), path: attr(g[0], 'path'), size: Number(attr(g[0], 'size')) || 0, verify: attr(g[0], 'verify') });
        return info;
    }

    // Rader som inte är filer på telefonen: nyckelfilerna, det extraktionsverktyget lagt till och det som utvunnits
    // ur andra filer. En fil kan inte ligga i en fil, så en fil i sökvägen räcker som bevis.
    function classify(rows) {
        var paths = new Set();
        rows.forEach(function (r) { paths.add(r.path); });
        rows.forEach(function (r) {
            if (r.fs === 'Keychain' || KEY_ROW.test(r.path)) { r.kind = 'keychain'; return; }
            if (r.embedded || TOOL_ROW.test(r.path)) { r.kind = 'derived'; return; }
            for (var at = r.path.lastIndexOf('/'); at > 0; at = r.path.lastIndexOf('/', at - 1)) {
                if (paths.has(r.path.slice(0, at))) { r.kind = 'derived'; return; }
            }
            r.kind = 'file';
        });
    }

    // Vad posten behöver utöver zippens fält. Tomma värden utelämnas: det blir hundratusentals rader.
    function reportFields(r, member) {
        var f = { member: member ? member.name : '' };
        if (!member) f.noData = true;
        // Ingen av de andra tiderna: 1980-01-01 är ingen tid utan Physical Analyzers ersättning för en som saknas.
        var noTime = r.m === NO_TIME_MS && r.c === null && r.a === null;
        if (r.m !== null && !noTime) f.m = r.m;
        if (r.a !== null) f.a = r.a;
        if (r.c !== null) f.c = r.c;
        if (r.x !== null && r.x !== undefined) f.x = r.x;
        if (r.d !== null) f.deletedMs = r.d;
        if (r.deleted && r.deleted !== 'Intact') f.deleted = r.deleted;
        ['sha256', 'md5', 'tags', 'origin', 'originReason', 'service', 'adjustedTime', 'adjustedLocation'].forEach(function (k) { if (r[k] && r[k] !== 'N/A') f[k] = r[k]; });
        return f;
    }

    function putU16(b, at, v) { b[at] = v & 255; b[at + 1] = (v >>> 8) & 255; }
    function putU32(b, at, v) { b[at] = v & 255; b[at + 1] = (v >>> 8) & 255; b[at + 2] = (v >>> 16) & 255; b[at + 3] = (v >>> 24) & 255; }
    function putU64(b, at, v) { putU32(b, at, v % 0x100000000); putU32(b, at + 4, Math.floor(v / 0x100000000)); }

    // Innehållsförteckningen: en post per fil på telefonen, i samma form som en zips. Zip64-fält bara där
    // talen kräver det. Platsen är rapportens egen post, så läsningen och CRC32-kontrollen går som vanligt.
    function buildDirectory(rows) {
        var parts = rows.map(function (r) {
            var name = encoder.encode(r.path);
            var json = encoder.encode(JSON.stringify(reportFields(r, r.member)));
            var e = r.member || { method: 0, flags: 0, crc32: 0, compSize: 0, size: r.size, localOffset: 0 };
            var wide = (e.size >= 0xffffffff ? 8 : 0) + (e.compSize >= 0xffffffff ? 8 : 0) + (e.localOffset >= 0xffffffff ? 8 : 0);
            return { name: name, json: json, e: e, wide: wide, length: 46 + name.length + (wide ? 4 + wide : 0) + 4 + json.length };
        });
        var bytes = new Uint8Array(parts.reduce(function (s, p) { return s + p.length; }, 0));
        var at = 0;
        parts.forEach(function (p) {
            var e = p.e;
            putU32(bytes, at, SIG_CENTRAL);
            putU16(bytes, at + 4, 45);
            putU16(bytes, at + 6, 45);
            putU16(bytes, at + 8, (e.flags & 1) | 0x0800);
            putU16(bytes, at + 10, e.method);
            putU32(bytes, at + 16, e.crc32);
            putU32(bytes, at + 20, Math.min(e.compSize, 0xffffffff));
            putU32(bytes, at + 24, Math.min(e.size, 0xffffffff));
            putU16(bytes, at + 28, p.name.length);
            putU16(bytes, at + 30, (p.wide ? 4 + p.wide : 0) + 4 + p.json.length);
            putU32(bytes, at + 42, Math.min(e.localOffset, 0xffffffff));
            bytes.set(p.name, at + 46);
            var q = at + 46 + p.name.length;
            if (p.wide) {
                putU16(bytes, q, 1);
                putU16(bytes, q + 2, p.wide);
                q += 4;
                [e.size, e.compSize, e.localOffset].forEach(function (v) { if (v >= 0xffffffff) { putU64(bytes, q, v); q += 8; } });
            }
            putU16(bytes, q, FIELD_ID);
            putU16(bytes, q + 2, p.json.length);
            bytes.set(p.json, q + 4);
            at += p.length;
        });
        return bytes;
    }

    // En rad som inte hör till förteckningen, som nyckelringen, i samma form som en post ur den.
    function entryOf(r) {
        var e = r.member;
        var f = reportFields(r, e);
        return {
            name: r.path, flags: e.flags, method: e.method, dosTime: '', crc32: e.crc32, compSize: e.compSize, size: e.size, localOffset: e.localOffset,
            mtime: f.m ? f.m / 1000 : null, atime: f.a ? f.a / 1000 : null, crtime: f.c ? f.c / 1000 : null, ctime: f.x ? f.x / 1000 : null, utThird: null, timeField: 'report.xml', report: f,
        };
    }

    function isZipHead(b) { return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7); }

    // En rapport känns igen på namnet, eller på att den första posten är en rapports och report.xml finns.
    async function detect(read, size, name) {
        var named = /\.ufdr$/i.test(String(name || ''));
        var head = await read(0, Math.min(size, 512));
        if (!isZipHead(head)) {
            if (named) throw lockedError(name);
            return false;
        }
        if (named) return true;
        var len = head[26] | (head[27] << 8);
        var first = utf8.decode(head.subarray(30, 30 + len));
        if (!/^(files\/|DbData\/|report\.xml$|settings\.json$)/.test(first)) return false;
        var scan = await dep('ZipRead').scan(read, size, function (n) { return n === REPORT_NAME; });
        return scan.entries.length > 0;
    }

    function lockedError(name) {
        var err = new Error(name + ' går inte att läsa som zip. Rapporten är troligen skyddad med lösenord, eller trasig. Skapa den utan skydd och öppna den igen.');
        err.code = 'UFDR_LOCKED';
        return err;
    }

    // Läser rapporten en gång. Returnerar { bytes, count, info }. onProgress(lästa byte, alla).
    async function index(read, size, opts) {
        opts = opts || {};
        var ZipRead = dep('ZipRead');
        var started = Date.now();
        var cache = await ZipRead.cacheDirectory(read, size, null, null);
        var scan = await ZipRead.scan(cache.read, size, function () { return true; });
        var members = new Map();
        scan.entries.forEach(function (e) { members.set(e.name, e); });
        var reportEntry = members.get(REPORT_NAME);
        if (!reportEntry) throw new Error('Rapporten har ingen report.xml, och det är den som säger vilka filer den innehåller.');

        var header = null;
        var rows = [];
        var scanner = createScanner({
            header: function (text) { header = parseHeader(text); },
            file: function (r) { rows.push(r); },
        });
        var done = 0;
        try {
            await ZipRead.stream(read, reportEntry, function (chunk) {
                done += chunk.length;
                if (scanner.push(chunk)) throw DONE;
                if (opts.onProgress) opts.onProgress(done, reportEntry.size);
            }, { chunk: opts.chunk || CHUNK });
        } catch (err) {
            if (err !== DONE) throw err;
        }
        if (!header) throw new Error('report.xml i rapporten har inget avsnitt med filer (taggedFiles).');
        if (opts.onProgress) opts.onProgress(reportEntry.size, reportEntry.size);

        classify(rows);
        var counts = { rows: rows.length, files: 0, related: 0, derived: 0, empty: 0, unresolved: 0, sizeDiffers: 0, ctimes: 0 };
        var tags = {};
        var files = [];
        var keychains = [];
        rows.forEach(function (r) {
            var local = r.local ? r.local.replace(/\\/g, '/') : '';
            r.member = local ? members.get(local) || null : null;
            if (r.member && r.member.size !== r.size) counts.sizeDiffers++;
            if (r.kind === 'keychain') { if (r.member) keychains.push(entryOf(r)); return; }
            if (r.kind === 'derived') { counts.derived++; return; }
            if (!r.member) { if (r.size) counts.unresolved++; else counts.empty++; }
            if (r.related) counts.related++;
            if (r.x !== null) counts.ctimes++;
            if (r.tags) tags[r.tags] = (tags[r.tags] || 0) + 1;
            files.push(r);
        });
        counts.files = files.length;
        var bytes = buildDirectory(files);
        var ex = header.extraction;
        var yes = function (v) { return /^true$/i.test(v || ''); };
        return {
            bytes: bytes, count: files.length,
            info: {
                reportVersion: header.project.reportVersion || '', paVersion: header.items.UFED_PA_Version || '', extractionType: header.project.extractionType || '',
                device: ex.fullName || ex.deviceName || '', selectedDevice: header.items.DeviceInfoSelectedDeviceName || '', createdText: header.items.DeviceInfoCreationTime || '',
                zone: header.items['Time zone settings (ID)'] || '', sources: header.images, nodeCount: Number(header.project.NodeCount) || 0, modelCount: Number(header.project.ModelCount) || 0,
                partial: { partialData: yes(ex.IsPartialData), stoppedByUser: yes(ex.IsStoppedByUser), triage: yes(ex.IsTriageExtraction), selective: yes(ex.IsSelectiveExtraction) },
                counts: counts, tags: tags, keychains: keychains, reportSize: reportEntry.size, seconds: (Date.now() - started) / 1000,
            },
        };
    }

    // Read-funktionen som ZipRead.scan känner igen som en färdig innehållsförteckning.
    function readerFor(read, built) {
        var wrapped = function (offset, length) { return read(offset, length); };
        wrapped.directory = { bytes: built.bytes, size: built.bytes.length, entries: built.count, zip64: true, names: null, places: null, built: true };
        return wrapped;
    }

    // Rapporten som källa: { read, report }. opts.built: en förteckning som redan lästs (samma rapport i ett annat verktyg).
    async function open(read, size, opts) {
        opts = opts || {};
        var built = opts.built || await index(read, size, opts);
        return { read: readerFor(read, built), report: built.info, built: built };
    }

    // Summorna i report.xml, in i Härkomsts cache för sökning på hashsumma. Annars skulle varje fil läsas.
    // Filen som hittas läses och hashas ändå när den bedöms. SHA-1 finns inte i rapporten och räknas som förut.
    function fillHashCache(entries, cache, keyOf) {
        (entries || []).forEach(function (e) {
            if (!e.report) return;
            var key = keyOf(e);
            if (e.report.md5) cache.md5[key] = e.report.md5.toLowerCase();
            if (e.report.sha256) cache.sha256[key] = e.report.sha256.toLowerCase();
        });
    }

    function count(n) { return Number(n).toLocaleString('sv-SE'); }

    // Rapporten i klartext, till statusraden och protokollet.
    function summaryText(report) {
        var c = report.counts;
        var parts = ['Rapport i UFDR-format' + (report.paVersion ? ', rapportverktygets version ' + report.paVersion : '') + (report.createdText ? ', skapad ' + report.createdText : '') + '.'];
        // Rapportens egen benämning, utan verktygets namn: det ska inte stå i programmets texter. Benämningen kan vara
        // allmän (Google Android Generic), så modellen står efter, när det är en modell och inte en intern kod.
        var vendor = /cellebrite|physical analyzer|\bufed\b/i;
        var model = /\d/.test(report.selectedDevice || '') && !vendor.test(report.selectedDevice) ? ' (' + report.selectedDevice + ')' : '';
        if (report.device && !vendor.test(report.device)) parts.push('Extraktion: ' + report.device + model + '.');
        // Nyckelfilerna kan komma ur samma zip som filerna, och då är det en och samma källfil.
        var sources = report.sources.map(function (s) { return s.path + (s.verify ? ' (' + s.verify + ')' : ''); }).filter(function (s, i, all) { return all.indexOf(s) === i; });
        if (sources.length) parts.push('Källfiler enligt rapporten: ' + sources.join(', ') + '.');
        parts.push(count(c.files) + ' filer från telefonen' + (c.related ? ', varav ' + count(c.related) + ' med samma innehåll som en annan fil' : '') + '.');
        return parts.join(' ');
    }

    // Vad en rapport inte kan säga, och varför frånvaro inte är ett svar.
    function limitText(report) {
        var c = report.counts;
        var parts = ['En rapport innehåller bara det som valdes när den skapades, och vad som saknas står ingenstans: att en fil inte finns i rapporten säger inte att den saknades på telefonen.'];
        if (!report.tags.Uncategorized) parts.push('Filer utan kategori (Uncategorized) ingår inte i den här rapporten.');
        if (!c.ctimes) parts.push('Tiden då filens metadata ändrades (ctime) finns inte i den här rapporten.');
        if (c.derived) parts.push(count(c.derived) + ' filer som rapportverktyget utvunnit ur andra filer, till exempel ur arkiv och databaser, är inga filer på telefonen och visas inte.');
        var p = report.partial;
        if (p.partialData) parts.push('Rapporten märker extraktionen som ofullständig (IsPartialData).');
        if (p.stoppedByUser) parts.push('Rapporten märker extraktionen som avbruten av användaren (IsStoppedByUser).');
        if (p.triage) parts.push('Rapporten märker extraktionen som en triage (IsTriageExtraction).');
        if (p.selective) parts.push('Rapporten märker extraktionen som selektiv (IsSelectiveExtraction).');
        if (c.unresolved) parts.push(count(c.unresolved) + ' filer står i report.xml men finns inte i rapporten.');
        if (report.nodeCount && report.nodeCount !== c.rows) parts.push('report.xml säger ' + count(report.nodeCount) + ' filer, men ' + count(c.rows) + ' lästes.');
        return parts.join(' ');
    }

    var api = {
        use: function (d) { Object.keys(d).forEach(function (k) { deps[k] = d[k]; }); },
        detect: detect, index: index, open: open, createScanner: createScanner, parseHeader: parseHeader, metaTimeMs: metaTimeMs, _buildDirectory: buildDirectory, fillHashCache: fillHashCache, summaryText: summaryText, limitText: limitText, timeMs: timeMs,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.UfdrRead = api;
})(typeof window !== 'undefined' ? window : this);
