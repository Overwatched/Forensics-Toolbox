// Tolkning av ExifTool-utdata (-json -a -G1 -s) till sammanfattning, flaggor och export.
// Inga DOM-anrop här, så modulen kan testas i Node.
(function (root) {
    'use strict';

    // ExifTool körs mot en kopia i minnet. Sökväg, åtkomsttid, inode-tid och rättigheter
    // kommer därför från minnesfilsystemet och säger inget om originalfilen.
    var DROP = {
        'SourceFile': true,
        'ExifTool:ExifToolVersion': true,
        'System:FileName': true,
        'System:Directory': true,
        'System:FileModifyDate': true,
        'System:FileAccessDate': true,
        'System:FileInodeChangeDate': true,
        'System:FilePermissions': true,
    };

    var TIME_SOURCES = [
        ['Composite:SubSecDateTimeOriginal', 'Tagen'],
        ['ExifIFD:DateTimeOriginal', 'Tagen'],
        ['Keys:CreationDate', 'Skapad'],
        ['XMP-photoshop:DateCreated', 'Skapad'],
        ['XMP-exif:DateTimeOriginal', 'Tagen'],
        ['Composite:SubSecCreateDate', 'Digitaliserad'],
        ['ExifIFD:CreateDate', 'Digitaliserad'],
        ['QuickTime:CreateDate', 'Skapad', 'UTC'],
        ['Keys:CreationTime', 'Skapad'],
        ['XMP-xmp:CreateDate', 'Skapad'],
        ['PNG:CreationTime', 'Skapad'],
        ['PDF:CreateDate', 'Skapad'],
        ['Office:Created', 'Skapad'],
        ['RIFF:DateTimeOriginal', 'Tagen'],
        ['IFD0:ModifyDate', 'Ändrad'],
    ];

    var MAKE_KEYS = ['IFD0:Make', 'Keys:Make', 'UserData:Make', 'XMP-tiff:Make', 'QuickTime:Make'];
    var MODEL_KEYS = ['IFD0:Model', 'Keys:Model', 'UserData:Model', 'XMP-tiff:Model', 'QuickTime:Model'];
    var SOFTWARE_KEYS = [
        'IFD0:Software', 'Keys:Software', 'XMP-xmp:CreatorTool', 'PNG:Software', 'UserData:Software',
        'UserData:SoftwareVersion', 'UserData:Encoder', 'ItemList:Encoder', 'RIFF:Software',
        'PDF:Producer', 'PDF:Creator', 'Office:Application',
    ];

    var EDITORS = /photoshop|lightroom|gimp|snapseed|picsart|vsco|facetune|canva|pixelmator|affinity|paint\.net|meitu|capcut|inshot|luminar|darktable|acdsee|photoscape|photoroom|remini|faceapp|lensa|polarr|afterlight|youcam|airbrush/i;
    var SCREENSHOT_NAME = /screenshot|skärmavbild|skärmbild|bildschirmfoto|capture d.écran|captura de pantalla/i;
    var CAMERA_IMAGE = /^image\/(jpeg|heic|heif|tiff|x-[a-z]+-raw|x-adobe-dng)/i;

    // Filnamn som appar sätter när de sparar eller exporterar. App-id:t pekar på
    // posten i App-ID-katalogen (tools/app-ids/catalog.js).
    var FILENAME_PATTERNS = [
        { re: /^(IMG|VID|AUD|PTT|STK|DOC)-\d{8}-WA\d{4}/i, app: 'whatsapp' },
        { re: /^WhatsApp (Image|Video|Audio) \d{4}-\d{2}-\d{2}/i, app: 'whatsapp' },
        { re: /^received_\d{9,}/i, app: 'messenger' },
        { re: /^FB_IMG_\d{10,}/i, app: 'facebook' },
        { re: /^Snapchat-\d{6,}/i, app: 'snapchat' },
        { re: /^signal-\d{4}-\d{2}-\d{2}-\d{6}/i, app: 'signal' },
        { re: /^photo_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/i, app: 'telegram' },
        { re: /^PXL_\d{8}_\d{6,}/i, app: 'pixel-camera' },
        { re: /^InShot_\d{8}_\d{6}/i, app: 'inshot' },
        { re: /^lv_0_\d{14}/i, app: 'capcut' },
        { re: /^\d{8}_\d{6}(\(\d+\))?\.(jpe?g|mp4|heic)$/i, app: 'samsung-camera' },
    ];

    var ZIP_CONTAINERS = /^(docx|docm|dotx|xlsx|xlsm|pptx|pptm|odt|ods|odp|odg|epub|apk|aab|jar|ipa|xpi|kmz|pages|numbers|key|vsdx|3mf|cbz)$/i;
    var EXT_SAME = [['jpg', 'jpeg', 'jpe', 'jfif'], ['tif', 'tiff'], ['heic', 'heif', 'hif'], ['mov', 'qt'], ['mp4', 'm4v'], ['htm', 'html'], ['mpg', 'mpeg'], ['aif', 'aiff']];

    function str(value) {
        if (value === null || value === undefined) return '';
        if (Array.isArray(value)) return value.map(str).join(', ');
        return String(value);
    }

    function isZeroDate(value) {
        return /^0000[:\-]00[:\-]00/.test(value);
    }

    function first(tags, keys) {
        for (var i = 0; i < keys.length; i++) {
            var v = str(tags[keys[i]]).trim();
            if (v && !isZeroDate(v)) return { key: keys[i], value: v };
        }
        return null;
    }

    function extOf(name) {
        var m = /\.([^./\\]+)$/.exec(name || '');
        return m ? m[1].toLowerCase() : '';
    }

    function sameExt(a, b) {
        if (a === b) return true;
        for (var i = 0; i < EXT_SAME.length; i++) {
            if (EXT_SAME[i].indexOf(a) >= 0 && EXT_SAME[i].indexOf(b) >= 0) return true;
        }
        return false;
    }

    function extensionMismatch(name, typeExt) {
        var ext = extOf(name);
        var actual = String(typeExt || '').toLowerCase();
        if (!ext || !actual || actual === 'txt') return false;
        if (actual === 'zip' && ZIP_CONTAINERS.test(ext)) return false;
        return !sameExt(ext, actual);
    }

    // "2024:06:01 14:34:56.123+02:00" -> { text: "2024-06-01 14:34:56.123 +02:00", sort: "2024-06-01 14:34:56.123" }
    function formatDate(raw, zoneHint) {
        var m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?\s*(Z|[+\-]\d{2}:?\d{2})?/.exec(raw || '');
        if (!m) return { text: raw || '', sort: raw || '', zone: '' };
        var base = m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + (m[6] || '00') + (m[7] || '');
        var zone = m[8] ? (m[8] === 'Z' ? 'UTC' : m[8]) : (zoneHint || '');
        return { text: zone ? base + ' ' + zone : base, sort: base, zone: zone };
    }

    function takenTime(tags) {
        for (var i = 0; i < TIME_SOURCES.length; i++) {
            var src = TIME_SOURCES[i];
            var hit = first(tags, [src[0]]);
            if (!hit) continue;
            var zoneHint = src[2] || '';
            if (src[0] === 'ExifIFD:DateTimeOriginal') zoneHint = str(tags['ExifIFD:OffsetTimeOriginal']);
            if (src[0] === 'ExifIFD:CreateDate') zoneHint = str(tags['ExifIFD:OffsetTimeDigitized']);
            var d = formatDate(hit.value, zoneHint);
            return { text: d.text, sort: d.sort, zone: d.zone, kind: src[1], source: src[0] };
        }
        return null;
    }

    // "59 deg 19' 45.48\" N" eller "59.3293" -> 59.3293
    function parseCoord(value) {
        var s = str(value).trim();
        if (!s) return null;
        var num = /^[+\-]?\d+(\.\d+)?$/.exec(s);
        if (num) return Number(s);
        var m = /^([\d.]+)\s*deg\s*(?:([\d.]+)'\s*)?(?:([\d.]+)"\s*)?([NSEW])?$/i.exec(s);
        if (!m) return null;
        var v = Number(m[1]) + Number(m[2] || 0) / 60 + Number(m[3] || 0) / 3600;
        if (m[4] && /[SW]/i.test(m[4])) v = -v;
        return v;
    }

    function position(tags) {
        var lat = parseCoord(tags['Composite:GPSLatitude']);
        var lon = parseCoord(tags['Composite:GPSLongitude']);
        var source = 'Composite:GPSPosition';
        if (lat === null || lon === null) {
            var pair = first(tags, ['Keys:GPSCoordinates', 'UserData:GPSCoordinates', 'XMP-exif:GPSPosition']);
            if (pair) {
                var parts = pair.value.split(',');
                lat = parseCoord(parts[0]);
                lon = parseCoord(parts[1]);
                source = pair.key;
            }
        }
        if (lat === null || lon === null || isNaN(lat) || isNaN(lon)) return null;
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
        return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, zero: lat === 0 && lon === 0, source: source };
    }

    function device(tags) {
        var make = first(tags, MAKE_KEYS);
        var model = first(tags, MODEL_KEYS);
        if (!make && !model) return null;
        var text;
        if (make && model && model.value.toLowerCase().indexOf(make.value.toLowerCase()) === 0) text = model.value;
        else text = [make && make.value, model && model.value].filter(Boolean).join(' ');
        return { text: text, source: [make && make.key, model && model.key].filter(Boolean).join(', ') };
    }

    function hasGroup(tags, prefixes) {
        return Object.keys(tags).some(function (k) {
            return prefixes.some(function (p) { return k.indexOf(p) === 0; });
        });
    }

    function filenameApps(name) {
        var base = String(name || '').split(/[\\/]/).pop();
        var out = [];
        FILENAME_PATTERNS.forEach(function (p) {
            if (p.re.test(base) && out.indexOf(p.app) < 0) out.push(p.app);
        });
        return out;
    }

    function editSigns(tags, software) {
        var reasons = [];
        var tools = SOFTWARE_KEYS.concat(['XMP-xmpMM:HistorySoftwareAgent']).map(function (k) { return str(tags[k]); });
        var editor = tools.filter(function (v) { return EDITORS.test(v); })[0];
        if (editor) reasons.push('Redigeringsprogram: ' + editor);
        if (tags['XMP-xmpMM:HistoryAction'] || tags['XMP-xmpMM:HistoryWhen']) reasons.push('XMP-historik finns');
        var taken = first(tags, ['ExifIFD:DateTimeOriginal']);
        var modified = first(tags, ['IFD0:ModifyDate']);
        if (taken && modified) {
            var a = formatDate(taken.value).sort;
            var b = formatDate(modified.value).sort;
            if (b > a && Date.parse(b.replace(' ', 'T')) - Date.parse(a.replace(' ', 'T')) > 60000) {
                reasons.push('IFD0:ModifyDate är senare än DateTimeOriginal');
            }
        }
        if (software && /^adobe|gimp|paint/i.test(software.value) && !editor) reasons.push('Programvara: ' + software.value);
        return reasons;
    }

    function summarize(tags, name) {
        tags = tags || {};
        var type = str(tags['File:FileType']);
        var typeExt = str(tags['File:FileTypeExtension']);
        var mime = str(tags['File:MIMEType']);
        var software = first(tags, SOFTWARE_KEYS);
        var flags = [];

        var mismatch = extensionMismatch(name, typeExt);
        if (mismatch) {
            flags.push({ id: 'ext', label: 'Fel filändelse', reason: 'Innehållet är ' + (type || typeExt) + ' men filen heter .' + extOf(name) });
        }

        var pos = position(tags);
        if (pos) flags.push({ id: 'gps', label: pos.zero ? 'Position 0,0' : 'Position', reason: pos.lat + ', ' + pos.lon + ' (' + pos.source + ')' });

        if (CAMERA_IMAGE.test(mime) && !hasGroup(tags, ['IFD0:', 'ExifIFD:', 'XMP-', 'Apple:', 'GPS:'])) {
            flags.push({ id: 'stripped', label: 'Ingen kamerametadata', reason: 'Bilden saknar EXIF och XMP. Vanligt efter att en app skickat eller sparat om bilden.' });
        }

        var comment = str(tags['ExifIFD:UserComment']) + ' ' + str(tags['XMP-exif:UserComment']);
        if (/screenshot/i.test(comment) || SCREENSHOT_NAME.test(name || '')) {
            flags.push({ id: 'screenshot', label: 'Skärmdump', reason: /screenshot/i.test(comment) ? 'UserComment: Screenshot' : 'Filnamnet' });
        }

        var edits = editSigns(tags, software);
        if (edits.length) flags.push({ id: 'edited', label: 'Tecken på redigering', reason: edits.join('. ') });

        var apps = filenameApps(name);
        if (apps.length) flags.push({ id: 'app', label: 'App i filnamn', reason: 'Filnamnet följer mönstret för ' + apps.join(', '), apps: apps });

        var office = hasGroup(tags, ['Office:']);
        var warning = str(tags['ExifTool:Warning']);
        if (office && /Archive::Zip/.test(warning)) warning = '';
        var problem = str(tags['ExifTool:Error']) || warning;
        if (problem) flags.push({ id: 'warning', label: tags['ExifTool:Error'] ? 'Fel' : 'Varning', reason: problem });

        if (office && typeExt === 'zip') type = extOf(name).toUpperCase() || type;

        return {
            type: type || (tags['ExifTool:Error'] ? 'Okänd' : ''),
            typeExt: typeExt,
            mime: mime,
            mismatch: mismatch,
            taken: takenTime(tags),
            device: device(tags),
            software: software ? { text: software.value, source: software.key } : null,
            position: pos,
            flags: flags,
            apps: apps,
        };
    }

    function cleanTags(tags) {
        var out = {};
        Object.keys(tags || {}).forEach(function (k) {
            if (!DROP[k]) out[k] = tags[k];
        });
        return out;
    }

    function groupTags(tags) {
        var groups = {};
        var order = [];
        Object.keys(tags).forEach(function (key) {
            var i = key.indexOf(':');
            var group = i > 0 ? key.slice(0, i) : 'Övrigt';
            var tag = i > 0 ? key.slice(i + 1) : key;
            if (!groups[group]) {
                groups[group] = [];
                order.push(group);
            }
            groups[group].push({ tag: tag, key: key, value: str(tags[key]) });
        });
        return order.map(function (g) { return { group: g, entries: groups[g] }; });
    }

    // --- Office / OpenDocument -------------------------------------------------------
    // ExifTool i WebAssembly saknar Archive::Zip och läser därför inte docProps. De få
    // XML-filerna med dokumentets egenskaper läses här direkt ur ZIP-filen.

    var OFFICE_FILES = ['docProps/core.xml', 'docProps/app.xml', 'meta.xml'];
    var OFFICE_FIELDS = [
        ['docProps/core.xml', 'title', 'Title'],
        ['docProps/core.xml', 'subject', 'Subject'],
        ['docProps/core.xml', 'creator', 'Creator'],
        ['docProps/core.xml', 'lastModifiedBy', 'LastModifiedBy'],
        ['docProps/core.xml', 'created', 'Created'],
        ['docProps/core.xml', 'modified', 'Modified'],
        ['docProps/core.xml', 'lastPrinted', 'LastPrinted'],
        ['docProps/core.xml', 'revision', 'Revision'],
        ['docProps/core.xml', 'keywords', 'Keywords'],
        ['docProps/core.xml', 'description', 'Description'],
        ['docProps/app.xml', 'Application', 'Application'],
        ['docProps/app.xml', 'AppVersion', 'AppVersion'],
        ['docProps/app.xml', 'Company', 'Company'],
        ['docProps/app.xml', 'Manager', 'Manager'],
        ['docProps/app.xml', 'Template', 'Template'],
        ['docProps/app.xml', 'TotalTime', 'TotalEditTimeMinutes'],
        ['docProps/app.xml', 'Pages', 'Pages'],
        ['meta.xml', 'title', 'Title'],
        ['meta.xml', 'initial-creator', 'Creator'],
        ['meta.xml', 'creator', 'LastModifiedBy'],
        ['meta.xml', 'creation-date', 'Created'],
        ['meta.xml', 'date', 'Modified'],
        ['meta.xml', 'print-date', 'LastPrinted'],
        ['meta.xml', 'generator', 'Application'],
        ['meta.xml', 'editing-cycles', 'Revision'],
        ['meta.xml', 'editing-duration', 'TotalEditTime'],
    ];

    function decodeXml(s) {
        return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
            .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
            .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
            .replace(/&amp;/g, '&');
    }

    function xmlValue(xml, local) {
        var re = new RegExp('<(?:[\\w.-]+:)?' + local + '(?:\\s[^>]*)?>([^<]*)</(?:[\\w.-]+:)?' + local + '>');
        var m = re.exec(xml);
        return m ? decodeXml(m[1]).trim() : '';
    }

    function officeTags(files) {
        var out = {};
        OFFICE_FIELDS.forEach(function (f) {
            var xml = files[f[0]];
            if (!xml) return;
            var v = xmlValue(xml, f[1]);
            if (v && !out['Office:' + f[2]]) out['Office:' + f[2]] = v;
        });
        return out;
    }

    function u16(b, o) { return b[o] | (b[o + 1] << 8); }
    function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

    // Läser utvalda filer ur en ZIP. readRange(start, end) -> Promise<Uint8Array>,
    // inflateRaw(bytes) -> Promise<Uint8Array>. Läser bara katalogen och de filer som efterfrågas.
    function readZipEntries(size, readRange, inflateRaw, wanted) {
        var tailStart = Math.max(0, size - 65558);
        return readRange(tailStart, size).then(function (tail) {
            var eocd = -1;
            for (var i = tail.length - 22; i >= 0; i--) {
                if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
            }
            if (eocd < 0) return {};
            var count = u16(tail, eocd + 10);
            var cdSize = u32(tail, eocd + 12);
            var cdOffset = u32(tail, eocd + 16);
            if (cdOffset + cdSize > size) return {};
            return readRange(cdOffset, cdOffset + cdSize).then(function (cd) {
                var entries = [];
                var p = 0;
                var decoder = new TextDecoder();
                for (var n = 0; n < count && p + 46 <= cd.length; n++) {
                    if (u32(cd, p) !== 0x02014b50) break;
                    var method = u16(cd, p + 10);
                    var compSize = u32(cd, p + 20);
                    var nameLen = u16(cd, p + 28);
                    var extraLen = u16(cd, p + 30);
                    var commentLen = u16(cd, p + 32);
                    var local = u32(cd, p + 42);
                    var entryName = decoder.decode(cd.subarray(p + 46, p + 46 + nameLen));
                    if (wanted.indexOf(entryName) >= 0 && compSize < 4 * 1024 * 1024) {
                        entries.push({ name: entryName, method: method, compSize: compSize, local: local });
                    }
                    p += 46 + nameLen + extraLen + commentLen;
                }
                var out = {};
                return entries.reduce(function (chain, e) {
                    return chain.then(function () {
                        return readRange(e.local, e.local + 30).then(function (h) {
                            if (u32(h, 0) !== 0x04034b50) return null;
                            var start = e.local + 30 + u16(h, 26) + u16(h, 28);
                            return readRange(start, start + e.compSize);
                        }).then(function (data) {
                            if (!data) return null;
                            if (e.method === 0) return data;
                            if (e.method === 8) return inflateRaw(data);
                            return null;
                        }).then(function (bytes) {
                            if (bytes) out[e.name] = decoder.decode(bytes);
                        });
                    });
                }, Promise.resolve()).then(function () { return out; });
            });
        });
    }

    // Tidsfilter från <input type="datetime-local"> ("2024-06-01T14:30"). Jämför tiden som
    // den står i filen, utan omräkning mellan zoner, precis som den visas i tabellen.
    function inTimeRange(taken, from, to) {
        if (!from && !to) return true;
        var key = taken && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(taken.sort || '') ? taken.sort.slice(0, 19) : '';
        if (!key) return false;
        function bound(v, end) {
            var s = v.replace('T', ' ');
            return s.length === 16 ? s + (end ? ':59' : ':00') : s.slice(0, 19);
        }
        if (from && key < bound(from, false)) return false;
        if (to && key > bound(to, true)) return false;
        return true;
    }

    // --- Export --------------------------------------------------------------------

    function csvCell(value) {
        var s = str(value);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    var CSV_HEADER = ['sokvag', 'storlek_byte', 'filens_andringstid', 'filtyp', 'mime', 'fel_filandelse', 'tid', 'tid_typ',
        'tid_kalla', 'enhet', 'programvara', 'latitud', 'longitud', 'flaggor', 'varning'];

    function toCsv(rows) {
        var lines = [CSV_HEADER.join(',')];
        rows.forEach(function (r) {
            var s = r.summary || {};
            var warn = (s.flags || []).filter(function (f) { return f.id === 'warning'; })[0];
            lines.push([
                r.path,
                r.size,
                r.modified,
                s.type,
                s.mime,
                s.mismatch ? 'ja' : '',
                s.taken ? s.taken.text : '',
                s.taken ? s.taken.kind : '',
                s.taken ? s.taken.source : '',
                s.device ? s.device.text : '',
                s.software ? s.software.text : '',
                s.position ? s.position.lat : '',
                s.position ? s.position.lon : '',
                (s.flags || []).filter(function (f) { return f.id !== 'warning'; }).map(function (f) { return f.label; }).join('; '),
                r.error || (warn ? warn.reason : ''),
            ].map(csvCell).join(','));
        });
        return lines.join('\r\n') + '\r\n';
    }

    var api = {
        summarize: summarize,
        cleanTags: cleanTags,
        groupTags: groupTags,
        parseCoord: parseCoord,
        formatDate: formatDate,
        inTimeRange: inTimeRange,
        extensionMismatch: extensionMismatch,
        filenameApps: filenameApps,
        officeTags: officeTags,
        readZipEntries: readZipEntries,
        OFFICE_FILES: OFFICE_FILES,
        toCsv: toCsv,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ExifCore = api;
})(typeof window !== 'undefined' ? window : this);
