// Filkortet i Härkomst: vad som kan visas av den bedömda filen och hur den känns igen.
// Rena hjälpfunktioner utan DOM: vilken sorts fil namnet är, var iOS har sin egen JPEG-tumnagel
// för en bild eller video (PhotoData/Thumbnails/V2/<ZDIRECTORY>/<ZFILENAME>/5005.JPG), vad som
// ska visas (originalet, systemets tumnagel, videon eller ingenting), raderna i kortet med
// hashar och ett urval EXIF-fält, tidsökningens tolkning av ett datum med eller utan klockslag i en tidszon och
// sortering av träffar efter avstånd från tidpunkten. Testas i Node.
(function (root) {
    'use strict';

    var IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp)$/i;        // avkodas av Chromium
    var HEIC_EXT = /\.(heic|heif|hif)$/i;                   // avkodas inte: tumnageln behövs
    var VIDEO_EXT = /\.(mp4|m4v|mov|3gp|webm)$/i;
    var THUMB_FILE = '5005.JPG';
    var MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp' };

    function baseName(name) { var s = String(name || ''); return s.slice(s.lastIndexOf('/') + 1); }
    function extOf(name) { var m = /\.([^./]+)$/.exec(baseName(name)); return m ? m[1].toLowerCase() : ''; }
    function mimeOf(name) { return MIME[extOf(name)] || 'application/octet-stream'; }

    // 'image' (visas direkt), 'heic' (behöver tumnagel), 'video', eller null för okänd typ.
    function kindOf(name) {
        var n = baseName(name);
        if (IMAGE_EXT.test(n)) return 'image';
        if (HEIC_EXT.test(n)) return 'heic';
        if (VIDEO_EXT.test(n)) return 'video';
        return null;
    }

    // Sökvägens slut för iOS egen tumnagel av en post i Photos.sqlite. Finns för bilder och
    // videor i DCIM och för iCloud-original i CPLAssets. null på Android och utan rad i biblioteket.
    function thumbnailSuffix(platform, file) {
        if (platform !== 'iOS' || !file || !file.directory || !file.filename) return null;
        return 'PhotoData/Thumbnails/V2/' + String(file.directory).replace(/^\/+|\/+$/g, '') + '/' + file.filename + '/' + THUMB_FILE;
    }

    // keep(namn) för en sökning i innehållsförteckningen: posterna vars namn slutar på någon av
    // sökvägarna, skiftlägesokänsligt.
    function suffixKeeper(suffixes) {
        var lower = (suffixes || []).filter(Boolean).map(function (s) { return String(s).toLowerCase(); });
        return function (name) {
            var n = String(name).toLowerCase();
            for (var i = 0; i < lower.length; i++) if (n.endsWith(lower[i]) && (n.length === lower[i].length || n.charAt(n.length - lower[i].length - 1) === '/')) return true;
            return false;
        };
    }

    // Posten som slutar på sökvägen, den kortaste om flera (t.ex. två filsystemavbilder i samma zip).
    function pickBySuffix(entries, suffix) {
        var s = String(suffix || '').toLowerCase();
        if (!s) return null;
        var hits = (entries || []).filter(function (e) { var n = e.name.toLowerCase(); return n.endsWith(s) && (n.length === s.length || n.charAt(n.length - s.length - 1) === '/'); });
        hits.sort(function (a, b) { return a.name.length - b.name.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
        return hits[0] || null;
    }

    // Vad som ska visas. opts: { name, size, hasBytes, thumb (finns tumnagel), maxBytes }.
    // Originalet för JPEG/PNG som lästs och inte är för stort, annars systemets tumnagel, annars
    // videon direkt för MP4, annars ingenting med skälet i klartext.
    function previewPlan(opts) {
        opts = opts || {};
        var kind = kindOf(opts.name);
        var small = opts.size != null && opts.maxBytes != null ? opts.size <= opts.maxBytes : true;
        if (kind === 'image' && opts.hasBytes && small) return { source: 'original', kind: 'image', note: 'Bilden i förminskad form.' };
        if (opts.thumb) return { source: 'thumbnail', kind: 'image', note: kind === 'video' ? 'Telefonens egen miniatyr av videon.' : 'Telefonens egen miniatyr av bilden.' };
        if (kind === 'video' && opts.hasBytes && small && /\.(mp4|m4v|webm)$/i.test(baseName(opts.name))) return { source: 'video', kind: 'video', note: 'En bildruta ur videon.' };
        if (kind === 'image' && opts.hasBytes) return { source: 'original', kind: 'image', note: 'Bilden i förminskad form.' };
        var why = kind === 'heic' ? 'HEIC-bilder kan inte visas utan telefonens egen tumnagel, och ingen hittades i zippen.'
            : kind === 'video' ? 'Videon kan inte visas här, och ingen tumnagel hittades i zippen.'
                : !opts.hasBytes ? 'Filen lästes inte ur zippen.'
                    : 'Filtypen kan inte visas.';
        return { source: 'none', kind: null, note: why };
    }

    // Ett urval EXIF-fält för kortet, ur protokollets taggrader [[tagg, värde]]. Hela listan finns i EXIF-visaren.
    var EXIF_PICKS = [
        ['Tagen (EXIF)', /:(DateTimeOriginal|CreationDate|CreateDate)$/],
        ['Tidszon (EXIF)', /:(OffsetTimeOriginal|OffsetTime)$/],
        ['Kamera', /:(Make)$/, /:(Model)$/],
        ['Objektiv', /:LensModel$/],
        ['Programvara', /:(Software|HostComputer)$/],
        ['Mått', /:ImageWidth$/, /:ImageHeight$/],
        ['Filtyp', /:(FileType|MIMEType)$/],
        ['Position (EXIF)', /:GPSLatitude$/, /:GPSLongitude$/],
        ['App (UserComment)', /:(UserComment|Description|Comment)$/],
    ];

    // Läsbara strängar (minst 8 tecken) i en protobuf, på alla nivåer. [] när bytena inte är protobuf.
    function protoStrings(b, depth) {
        var out = [];
        var i = 0;
        while (i < b.length) {
            var key = 0, mul = 1, c;
            do { c = b[i++]; key += (c & 0x7f) * mul; mul *= 128; } while ((c & 0x80) && i < b.length);
            var wire = key % 8;
            if (wire === 0) { do { c = b[i++]; } while ((c & 0x80) && i < b.length); }
            else if (wire === 1) i += 8;
            else if (wire === 5) i += 4;
            else if (wire === 2) {
                var n = 0; mul = 1;
                do { c = b[i++]; n += (c & 0x7f) * mul; mul *= 128; } while ((c & 0x80) && i < b.length);
                if (i + n > b.length) return out;
                var sub = b.slice(i, i + n);
                i += n;
                var text = String.fromCharCode.apply(null, sub);
                if (n >= 8 && /^[\x20-\x7e]+$/.test(text)) out.push(text);
                else if (n > 1 && depth < 4) out = out.concat(protoStrings(sub, depth + 1));
            } else return out;
        }
        return out;
    }

    // Snapchat på Android skriver sin user agent i EXIF UserComment (JPEG) och i description (MP4)
    // som base64 av en protobuf: "Snapchat/14.30.0.54 (AC2003; Android 13…) V/MUSHROOM". Här
    // plockas den läsbara strängen ut; andra kommentarer visas som de är. null = inget att visa.
    function decodeUserComment(value) {
        var v = String(value == null ? '' : value).trim();
        if (!v) return null;
        if (/^[A-Za-z0-9+/]{24,}={0,2}$/.test(v)) {
            try {
                var bin = typeof atob === 'function' ? atob(v) : null;
                if (bin) {
                    var bytes = []; for (var i = 0; i < bin.length; i++) bytes.push(bin.charCodeAt(i));
                    var found = protoStrings(bytes, 0);
                    found.sort(function (a, b) { return b.length - a.length; });
                    if (found.length) return found[0] + ' (base64 i taggen)';
                    var runs = bin.match(/[\x20-\x7e]{8,}/g) || [];
                    runs.sort(function (a, b) { return b.length - a.length; });
                    if (runs.length) return runs[0].trim() + ' (base64 i taggen)';
                }
            } catch (e) { /* inte base64: visas rått nedan */ }
        }
        if (/^[\x20-\x7e\u00a0-\uffff]{3,}$/.test(v) && !/^(binary data|\(Binary data)/i.test(v)) return v.length > 120 ? v.slice(0, 117) + '…' : v;
        return null;
    }

    function exifSummary(exifRows) {
        var rows = exifRows || [];
        var find = function (re) { var r = rows.find(function (x) { return re.test(x[0]); }); return r ? String(r[1]) : ''; };
        var out = [];
        EXIF_PICKS.forEach(function (p) {
            var vals = p.slice(1).map(find);
            if (!vals.some(Boolean)) return;
            var v = p[0] === 'Mått' ? vals.filter(Boolean).join(' × ') : p[0] === 'Position (EXIF)' ? vals.filter(Boolean).join(', ') : vals.filter(Boolean).join(' ');
            if (p[0] === 'App (UserComment)') { v = decodeUserComment(v); if (!v) return; }
            out.push([p[0], v]);
        });
        return out;
    }

    // Raderna i kortet. fileEntry: { path, size, mtime, crc32, crcOk, md5, sha256 }. opts.sizeText(byte) -> text.
    function cardRows(fileEntry, exifRows, opts) {
        opts = opts || {};
        if (!fileEntry) return [];
        var size = opts.sizeText ? opts.sizeText(fileEntry.size) + ' (' + fileEntry.size + ' byte)' : fileEntry.size + ' byte';
        var rows = [
            ['Filnamn', baseName(fileEntry.path)],
            ['Sökväg i zippen', fileEntry.path],
            ['Storlek', size],
            ['Ändrad enligt zippen', fileEntry.mtime || ''],
            ['CRC32', (fileEntry.crc32 || '') + (fileEntry.crcOk === false ? ' (stämmer inte med zippen)' : '')],
            ['MD5', fileEntry.md5 || 'inte beräknad'],
            ['SHA-256', fileEntry.sha256 || 'inte beräknad'],
        ];
        return rows.concat(exifSummary(exifRows));
    }

    // Ett inskrivet datum med eller utan klockslag, svensk skrivning: "2026-10-31", "2026-10-31 14:30",
    // "2026-10-31 14:30:15", också "14.30", "kl 14.30" och "2026-10-31T14:30" (som zippens DOS-tid och
    // webbläsarens datetime-fält skriver). -> { y, mo, d, h, mi, s, dateOnly }, annars null.
    // Amerikansk ordning (10/31/2026) och datum som inte finns (2026-02-30) avvisas.
    function parseLocal(value) {
        var m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:(?:T|\s+)(?:kl\.?\s*)?(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?\s*$/i.exec(String(value || ''));
        if (!m) return null;
        var p = { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: Number(m[4] || 0), mi: Number(m[5] || 0), s: Number(m[6] || 0), dateOnly: m[4] == null };
        if (p.mo < 1 || p.mo > 12 || p.d < 1 || p.d > 31 || p.h > 23 || p.mi > 59 || p.s > 59) return null;
        var check = new Date(Date.UTC(p.y, p.mo - 1, p.d));
        if (check.getUTCMonth() !== p.mo - 1 || check.getUTCDate() !== p.d) return null;
        return p;
    }

    // Två fält, datum och klockslag, där klockslaget får vara tomt (då gäller hela dygnet). Står
    // klockslaget i datumfältet, till exempel inklistrat, går det också.
    function parseWhen(dateValue, timeValue) {
        var d = String(dateValue || '').trim(), t = String(timeValue || '').trim();
        if (!d) return null;
        return parseLocal(t ? d + ' ' + t : d);
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    // "2026-10-31" och "14:30:15" ur de tolkade delarna, för fälten och texterna.
    function dateText(parts) { return parts.y + '-' + pad2(parts.mo) + '-' + pad2(parts.d); }
    function timeText(parts) { return pad2(parts.h) + ':' + pad2(parts.mi) + ':' + pad2(parts.s || 0); }

    // Hela dygnet för ett datum i en zon: { startMs, endMs } med dygnets sista millisekund, rätt
    // också de dygn som är 23 eller 25 timmar när sommartiden slår om.
    function dayRange(parts, zone) {
        if (!parts) return null;
        var next = new Date(Date.UTC(parts.y, parts.mo - 1, parts.d + 1));
        return {
            startMs: toUtcMs({ y: parts.y, mo: parts.mo, d: parts.d, h: 0, mi: 0, s: 0 }, zone),
            endMs: toUtcMs({ y: next.getUTCFullYear(), mo: next.getUTCMonth() + 1, d: next.getUTCDate(), h: 0, mi: 0, s: 0 }, zone) - 1,
        };
    }

    // Zonens förskjutning i minuter vid en UTC-tidpunkt, via Intl. null om zonen är okänd.
    function zoneOffsetAt(zoneName, utcMs) {
        try {
            var f = new Intl.DateTimeFormat('en-US', { timeZone: zoneName, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
            var parts = {};
            f.formatToParts(new Date(utcMs)).forEach(function (x) { parts[x.type] = x.value; });
            var asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
            return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
        } catch (e) { return null; }
    }

    // Klockslag i en zon -> UTC-millisekunder. zone: { name (IANA) | offsetMinutes }.
    function toUtcMs(parts, zone) {
        if (!parts) return null;
        var wall = Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s || 0);
        zone = zone || {};
        if (zone.name) {
            var off = zoneOffsetAt(zone.name, wall);
            if (off != null) {
                var ms = wall - off * 60000;
                var off2 = zoneOffsetAt(zone.name, ms);
                if (off2 != null && off2 !== off) ms = wall - off2 * 60000;
                return ms;
            }
        }
        return wall - (zone.offsetMinutes || 0) * 60000;
    }

    // Träffarna närmast tidpunkten först, med deltaMs (negativt = före).
    function nearestFirst(rows, centerMs, key) {
        key = key || 'createdMs';
        return (rows || []).filter(function (r) { return r[key] != null; }).map(function (r) {
            return Object.assign({}, r, { deltaMs: r[key] - centerMs });
        }).sort(function (a, b) { return Math.abs(a.deltaMs) - Math.abs(b.deltaMs) || a.deltaMs - b.deltaMs; });
    }

    // "2 min 5 s före" / "40 s efter" / "vid tidpunkten".
    function deltaText(deltaMs) {
        var s = Math.round(Math.abs(deltaMs) / 1000);
        if (s === 0) return 'vid tidpunkten';
        var t = s < 60 ? s + ' s' : s < 3600 ? Math.floor(s / 60) + ' min' + (s % 60 ? ' ' + (s % 60) + ' s' : '') : Math.floor(s / 3600) + ' tim' + (Math.floor((s % 3600) / 60) ? ' ' + Math.floor((s % 3600) / 60) + ' min' : '');
        return t + (deltaMs < 0 ? ' före' : ' efter');
    }

    // keep(namn) för bild- och videofiler i zippen utanför bildbiblioteket, plus Snapchats cachefiler
    // (som saknar ändelse). Används av tidsökningen; ändringstiden filtreras efteråt.
    var LIBRARY_PATH = /\/Media\/DCIM\/|\/Media\/PhotoData\//;
    function mediaKeeper() {
        return function (name) {
            if (name.charAt(name.length - 1) === '/') return false;
            if (LIBRARY_PATH.test(name)) return false;
            return !!kindOf(name) || /com\.snap\.file_manager_\d+_SCContent_|\/recorded_videos\//.test(name);
        };
    }

    // En posts ändringstid i UTC-ms: den utökade tidsstämpeln (unixtid) om den finns, annars
    // DOS-tiden tolkad i zonen, eftersom zippen inte säger vilken zon den är i. { ms, assumed } eller null.
    function entryMs(e, zone) {
        if (!e) return null;
        if (e.mtime) return { ms: e.mtime * 1000, assumed: false };
        var p = parseLocal(e.dosTime || '');
        if (!p) return null;
        return { ms: toUtcMs(p, zone), assumed: true };
    }

    // Byte -> data-URL, för bilden i exporterna. Fungerar i webbläsaren (btoa) och i Node.
    function dataUrl(bytes, mime) {
        var b64 = '';
        if (typeof btoa === 'function') {
            var chunk = 0x8000, s = '';
            for (var i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
            b64 = btoa(s);
        } else if (typeof Buffer !== 'undefined') b64 = Buffer.from(bytes).toString('base64');
        return 'data:' + (mime || 'application/octet-stream') + ';base64,' + b64;
    }

    var api = {
        decodeUserComment: decodeUserComment,
        kindOf: kindOf, mimeOf: mimeOf, baseName: baseName, thumbnailSuffix: thumbnailSuffix, suffixKeeper: suffixKeeper, pickBySuffix: pickBySuffix,
        previewPlan: previewPlan, exifSummary: exifSummary, cardRows: cardRows, parseLocal: parseLocal, parseWhen: parseWhen, dateText: dateText, timeText: timeText, dayRange: dayRange, zoneOffsetAt: zoneOffsetAt, toUtcMs: toUtcMs,
        nearestFirst: nearestFirst, deltaText: deltaText, mediaKeeper: mediaKeeper, entryMs: entryMs, dataUrl: dataUrl, THUMB_FILE: THUMB_FILE,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceMedia = api;
})(typeof window !== 'undefined' ? window : this);
