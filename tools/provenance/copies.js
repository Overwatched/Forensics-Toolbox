// "Var finns filen?" i Härkomst: alla poster i zippen med samma storlek och CRC32 som filen,
// och vad platsen betyder (bildbiblioteket, Snapchats cache, SMS-bilaga, bildväljaren …).
// Storlek och CRC32 står i zippens innehållsförteckning, så inget behöver läsas för att hitta
// kandidaterna; SHA-256 bekräftar dem sedan. Ingen DOM. Testas i Node.
(function (root) {
    'use strict';

    var GUID = '([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})';

    // Ordningen spelar roll: det första mönstret som passar gäller.
    var AREAS = [
        [/com\.snap\.file_manager_\d+_SCContent/i, 'Snapchat, cache (file_manager)', 'i Snapchats cache', 'snapchat'],
        [/\/recorded_videos\//i, 'Snapchat, inspelade videor (recorded_videos)', 'bland Snapchats inspelade videor', 'snapchat'],
        [/\/Media\/DCIM\//, 'Bildbiblioteket (DCIM)', 'i bildbiblioteket', 'library'],
        [/\/PhotoData\/CPLAssets\//, 'Bildbiblioteket, iCloud-original (CPLAssets)', 'i bildbiblioteket', 'library'],
        [/\/PhotoData\/(Thumbnails|Caches|Metadata|Mutations)\//, 'Bildbiblioteket, tumnagel eller cache', 'som en kopia i bildbiblioteket', 'library'],
        [/\/Media\/PhotoData\//, 'Bildbiblioteket (PhotoData)', 'i bildbiblioteket', 'library'],
        [/\/Library\/SMS\/Attachments\//, 'iMessage/SMS-bilaga', 'som bilaga i Meddelanden', 'messages'],
        [/File Provider Storage\/photospicker\//, 'Bildväljaren (kopia som en app fick välja ur biblioteket)', 'som en kopia en app fick ur bildbiblioteket', 'picker'],
        [/\/Media\/Downloads\//, 'Hämtade filer', 'bland hämtade filer', 'downloads'],
        [new RegExp('/Containers/Shared/AppGroup/' + GUID + '/'), 'Appgrupp $1', 'i en apps delade lagring', 'appgroup'],
        [new RegExp('/Containers/Data/PluginKitPlugin/' + GUID + '/'), 'Apptillägg $1', 'i ett apptilläggs lagring', 'plugin'],
        [new RegExp('/Containers/Data/Application/' + GUID + '/'), 'Appbehållare $1', 'i en apps egen lagring', 'app'],
        [/\/DCIM\/Camera\//, 'Kameran (DCIM/Camera)', 'i kamerans mapp', 'library'],
        [/\/Pictures\/Screenshots\//, 'Skärmdumpar (Pictures/Screenshots)', 'bland skärmdumparna', 'library'],
        [/\/Pictures\/Snapchat\//, 'Snapchat, sparade snaps (Pictures/Snapchat)', 'bland Snapchats sparade bilder', 'snapchat'],
        [/\/Download\//, 'Hämtade filer (Download)', 'bland hämtade filer', 'downloads'],
        [/\/Android\/(?:data|media)\/([\w.]+)\//, 'Appens lagring: $1', 'i en apps egen lagring', 'app'],
        [/(?:^|\/)data\/(?:data|user(?:_de)?\/\d+)\/([\w.]+)\//, 'Appens data: $1', 'i en apps egen lagring', 'app'],
        [/\/tmp\//, 'Tillfällig fil (tmp)', 'som en tillfällig fil', 'tmp'],
    ];

    // { label, plain, area }. label får GUID eller paketnamn ur sökvägen.
    // opts.snapchatContainers: GUID:er (appbehållare och appgrupp) som hör till Snapchat enligt
    // var dess databaser hittades, så att t.ex. Library/Caches i Snapchats behållare märks som Snapchat.
    function classifyPath(name, opts) {
        var n = String(name || '');
        var out = { label: 'Annan plats', plain: 'på en annan plats i telefonen', area: 'other' };
        var guid = null;
        for (var i = 0; i < AREAS.length; i++) {
            var m = AREAS[i][0].exec(n);
            if (m) { out = { label: AREAS[i][1].replace('$1', m[1] || ''), plain: AREAS[i][2], area: AREAS[i][3] }; guid = m[1] || null; break; }
        }
        var containers = (opts && opts.snapchatContainers || []).map(function (g) { return String(g).toUpperCase(); });
        var inSnapContainer = guid && containers.indexOf(String(guid).toUpperCase()) >= 0;
        // En appbehållare eller appdata som hör till Snapchat märks som Snapchat.
        if (out.area !== 'snapchat' && (inSnapContainer || /picaboo|snapchat/i.test(n))) {
            out = { label: 'Snapchat, ' + out.label.charAt(0).toLowerCase() + out.label.slice(1), plain: 'i Snapchat', area: 'snapchat' };
        }
        return out;
    }

    function baseName(n) { return String(n).slice(String(n).lastIndexOf('/') + 1); }

    // keep-funktion till ZipRead.scan: sparar poster med samma storlek och CRC32, och poster
    // vars filnamn är ett av de sökta (skiftlägesokänsligt). Zip64-poster (0xFFFFFFFF) tas inte.
    function keeper(size, crc32, names) {
        var wanted = {};
        (names || []).forEach(function (x) { wanted[String(x).toLowerCase()] = true; });
        var any = Object.keys(wanted).length > 0;
        return function (name, entrySize, entryCrc) {
            if (name.charAt(name.length - 1) === '/') return false;
            if (size != null && entrySize === size && entryCrc === crc32) return true;
            return any && wanted[baseName(name).toLowerCase()] === true;
        };
    }

    // Poster med samma storlek och CRC32 som filen, utom filen själv. Sorterade: bildbiblioteket
    // först, sedan efter sökvägens längd.
    function findCopies(entries, file, opts) {
        var out = (entries || []).filter(function (e) {
            return e.size === file.size && e.crc32 === file.crc32 && e.name !== file.name && e.name.charAt(e.name.length - 1) !== '/';
        });
        var rank = { library: 0, snapchat: 1, messages: 2, picker: 3, downloads: 4, app: 5, appgroup: 6, plugin: 7, tmp: 8, other: 9 };
        out.sort(function (a, b) {
            var ra = rank[classifyPath(a.name, opts).area], rb = rank[classifyPath(b.name, opts).area];
            return ra - rb || a.name.length - b.name.length;
        });
        return out;
    }

    // Poster vars filnamn är det sökta, skiftlägesokänsligt. Kortast sökväg först.
    function byName(entries, filename) {
        var want = String(filename || '').toLowerCase();
        if (!want) return [];
        return (entries || []).filter(function (e) { return baseName(e.name).toLowerCase() === want && e.name.charAt(e.name.length - 1) !== '/'; })
            .sort(function (a, b) { return a.name.length - b.name.length; });
    }

    // En mening för förklaringen: var filen finns utöver den bedömda platsen.
    function plainSentence(copies) {
        if (!copies || !copies.length) return '';
        var seen = {};
        var places = [];
        copies.forEach(function (c) {
            var p = c.plain || classifyPath(c.name).plain;
            if (!seen[p]) { seen[p] = true; places.push(p); }
        });
        var list = places.length === 1 ? places[0] : places.slice(0, -1).join(', ') + ' och ' + places[places.length - 1];
        return 'Exakt samma fil finns också ' + list + '.';
    }

    var api = { classifyPath: classifyPath, keeper: keeper, findCopies: findCopies, byName: byName, plainSentence: plainSentence, baseName: baseName, AREAS: AREAS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceCopies = api;
})(typeof window !== 'undefined' ? window : this);
