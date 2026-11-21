// Webbläsaren som källa till en fil i Härkomst: nedladdningen i Chrome eller Samsung Internet som filen är (MediaStores
// post, samma sökväg, eller samma namn nära i tid), och besöken strax före. Rena funktioner; Härkomst läser rollerna
// web-downloads och web-visits ur katalogen Webbhistorik (queries/web). Testas i Node (web-origin.test.js).
(function (root) {
    'use strict';

    // En sökväg i telefonens delade lagring, utan början: /storage/emulated/0/Download/a.jpg, /sdcard/Download/a.jpg och
    // data/media/0/Download/a.jpg blir download/a.jpg.
    function tail(p) {
        var s = String(p || '').replace(/\\/g, '/');
        var m = /(?:\/storage\/emulated\/\d+|\/storage\/self\/primary|\/sdcard|(?:^|\/)data\/media\/\d+|\/mnt\/user\/\d+\/emulated\/\d+)\/(.*)$/.exec(s);
        return (m ? m[1] : s.replace(/^\/+/, '')).toLowerCase();
    }
    // MediaStores post i en adress som content://media/external/downloads/24. Alla MediaStores samlingar är vyer av
    // tabellen files, så numret är filens _id.
    function storeId(p) {
        var m = /^content:\/\/media\/external(?:_primary)?\/(?:downloads|file|images\/media|video\/media)\/(\d+)$/i.exec(String(p || ''));
        return m ? Number(m[1]) : null;
    }
    function fileName(p) {
        var s = String(p || '').replace(/[?#].*$/, '').replace(/\/+$/, '');
        try { return decodeURIComponent(s.slice(s.lastIndexOf('/') + 1)); } catch (e) { return s.slice(s.lastIndexOf('/') + 1); }
    }

    var NAME_TIME_MS = 10 * 60000;
    var RANK = { mediastore: 0, path: 1, 'name-time': 2 };

    // Nedladdningen som filen är. file: { pk, path, filename, addedMs }. downloads: rollens rader (path, current, url,
    // endMs, startMs). Ger { d, how } eller null; how: mediastore, path eller name-time.
    function matchDownload(file, downloads) {
        var best = null;
        (downloads || []).forEach(function (d) {
            var paths = [d.path, d.current].filter(Boolean), how = null;
            if (file.pk != null && paths.some(function (p) { var id = storeId(p); return id !== null && id === Number(file.pk); })) how = 'mediastore';
            else if (file.path && paths.some(function (p) { return storeId(p) === null && tail(p) === tail(file.path); })) how = 'path';
            else if (file.filename && file.addedMs != null) {
                var names = paths.filter(function (p) { return storeId(p) === null; }).map(fileName).concat([fileName(d.url)]);
                var at = d.endMs || d.startMs;
                if (names.indexOf(file.filename) >= 0 && at && Math.abs(at - file.addedMs) <= NAME_TIME_MS) how = 'name-time';
            }
            if (how && (!best || RANK[how] < RANK[best.how])) best = { d: d, how: how };
        });
        return best;
    }

    // Besöken strax före ms (och upp till fem sekunder efter): det senaste först, högst max.
    function visitsBefore(visits, ms, spanMs, max) {
        if (ms == null) return [];
        return (visits || []).filter(function (v) { return v.timeMs != null && v.timeMs <= ms + 5000 && v.timeMs >= ms - spanMs; })
            .sort(function (a, b) { return b.timeMs - a.timeMs; }).slice(0, max || 5);
    }

    // Appar på iPhone som sparar en bild ur webben i bildbiblioteket (ZIMPORTEDBYBUNDLEIDENTIFIER).
    var IOS_BROWSERS = { 'com.apple.mobilesafari': 'Safari', 'com.google.chrome.ios': 'Chrome' };

    // Gecko-webbläsarna på Android (Tor Browser, Firefox): de sparar ingen lista över nedladdningar i en databas som
    // Chrome; MediaStores owner_package_name säger att appen laddade ner filen.
    function isGeckoPackage(pkg) { return /^org\.(torproject|mozilla)\./.test(String(pkg || '')); }
    function isTorPackage(pkg) { return /^org\.torproject\./.test(String(pkg || '')); }
    // Ligger filen i Download (relative_path Download/ eller sökvägen)?
    function inDownloads(p) { return /(^|\/)download\//i.test(String(p || '').replace(/\\/g, '/')); }

    var api = { tail: tail, storeId: storeId, fileName: fileName, matchDownload: matchDownload, visitsBefore: visitsBefore, IOS_BROWSERS: IOS_BROWSERS, NAME_TIME_MS: NAME_TIME_MS,
        isGeckoPackage: isGeckoPackage, isTorPackage: isTorPackage, inDownloads: inDownloads };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceWeb = api;
})(typeof window !== 'undefined' ? window : this);
