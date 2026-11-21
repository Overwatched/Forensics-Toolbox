// Webbhistorik ur katalogen Webbhistorik (queries/web): rollerna web-visits, web-searches, web-downloads, web-tabs,
// web-cleared och web-bookmarks. Här görs rollernas rader om till besök, sökningar, nedladdningar och flikar, och en databas kopplas
// till sin webbläsare. Ingen SQL finns här. Används av Telefonen; testas i Node (web.test.js).
(function (root) {
    'use strict';

    var Roles = typeof module !== 'undefined' && module.exports ? require('../provenance/roles.js') : root.ProvenanceRoles;
    var ROLES = { visits: 'web-visits', searches: 'web-searches', downloads: 'web-downloads', tabs: 'web-tabs', cleared: 'web-cleared', bookmarks: 'web-bookmarks' };
    var KINDS = Object.keys(ROLES);

    // Databaserna i katalogen med någon roll: { key, platform, app, title, label, paths, roles }.
    function sources(catalog) {
        var out = [];
        ((catalog && catalog.databases) || []).forEach(function (db) {
            var roles = {};
            KINDS.forEach(function (k) {
                var q = (db.queries || []).filter(function (x) { return x.hidden && x.role === ROLES[k]; })[0];
                if (q) roles[k] = q;
            });
            if (!Object.keys(roles).length) return;
            var m = /^(iOS|Android) — (.*)$/.exec(db.label || '');
            out.push({ key: db.id, platform: db.os || (m ? m[1] : ''), app: db.app || '', title: m ? m[2] : db.label, label: db.label, paths: db.paths || [], roles: roles });
        });
        return out;
    }
    // I den form ExtractionCore.targets() vill ha.
    function databases(list) {
        return list.map(function (s) { return { id: s.key, family: s.key, familyTitle: s.title, label: s.title, paths: s.paths, ios: null, cipher: null, derive: null }; });
    }

    // Webbläsaren en databas hör till: paketet i sökvägen på Android, Safari och Chrome på iPhone.
    var ANDROID_NAMES = {
        'com.android.chrome': 'Chrome', 'com.chrome.beta': 'Chrome Beta', 'com.chrome.dev': 'Chrome Dev', 'com.chrome.canary': 'Chrome Canary',
        'com.sec.android.app.sbrowser': 'Samsung Internet', 'com.sec.android.app.sbrowser.beta': 'Samsung Internet Beta',
        'com.microsoft.emmx': 'Edge', 'com.brave.browser': 'Brave', 'com.opera.browser': 'Opera', 'com.vivaldi.browser': 'Vivaldi', 'com.kiwibrowser.browser': 'Kiwi',
        'org.torproject.torbrowser': 'Tor Browser', 'org.torproject.torbrowser_alpha': 'Tor Browser Alpha', 'org.mozilla.firefox': 'Firefox', 'org.mozilla.firefox_beta': 'Firefox Beta',
        'org.mozilla.fenix': 'Firefox Nightly', 'org.mozilla.focus': 'Firefox Focus',
    };
    var IOS_IDS = { Safari: 'com.apple.mobilesafari', Chrome: 'com.google.chrome.ios' };
    function browserOf(src, path) {
        var m = /(?:^|\/)data\/(?:data|user\/\d+|user_de\/\d+)\/([^\/]+)\//.exec(String(path || ''));
        if (m) return { id: m[1], name: ANDROID_NAMES[m[1]] || (src.app + ' (' + m[1] + ')'), platform: 'Android' };
        return { id: IOS_IDS[src.app] || src.key, name: src.app || src.title, platform: src.platform || 'iOS' };
    }

    function text(v) { return v === null || v === undefined ? '' : String(v); }
    function num(v) { var n = Number(v); return v === null || v === undefined || v === '' || !isFinite(n) ? null : n; }

    // Värddatorn i en adress, utan www.
    function host(url) {
        var m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@\/?#]*@)?([^\/?#:]+)/i.exec(text(url));
        return m ? m[1].replace(/^www\./i, '').toLowerCase() : '';
    }
    // Filnamnet i en sökväg eller adress.
    function fileName(p) {
        var s = text(p).replace(/[?#].*$/, '');
        return s.slice(s.replace(/\/+$/, '').lastIndexOf('/') + 1).replace(/\/+$/, '');
    }

    var ORIGIN = { local: 'Den här enheten', synced: 'Annan enhet (synkad)' };

    // Besöken, det senaste först: { id, ms, url, host, title, origin, originText, loaded, redirectFrom, count, transition, … }.
    function visits(src, result) {
        return Roles.mapRows(src.roles.visits, result, ['time']).map(function (r) {
            var origin = text(r.origin);
            return {
                id: text(r.id), ms: r.timeMs || null, raw: r.time, url: text(r.url), host: host(r.url), title: text(r.title).trim(),
                origin: origin, originText: ORIGIN[origin] || (origin ? 'origin ' + origin : ''), loaded: num(r.loaded), redirectFrom: text(r.redirectFrom), count: num(r.count),
                form: num(r.form) === 1, transition: text(r.transition), qualifiers: text(r.qualifiers), durationS: num(r.durationS), from: text(r.from), app: text(r.app), typed: num(r.typed),
            };
        }).sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });
    }

    // Procentkodningen i en sökterm (SQL:en avkodar bara de vanligaste tecknen).
    function decodeTerm(s) {
        s = text(s);
        try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch (e) { return s; }
    }
    function searches(src, result) {
        return Roles.mapRows(src.roles.searches, result, ['time']).map(function (r) {
            return { id: text(r.id), ms: r.timeMs || null, raw: r.time, term: decodeTerm(r.term).trim(), engine: text(r.engine), url: text(r.url), host: host(r.url) };
        }).filter(function (x) { return x.term; }).sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });
    }

    function downloads(src, result) {
        return Roles.mapRows(src.roles.downloads, result, ['start', 'end', 'lastAccess']).map(function (r) {
            var path = text(r.path) || text(r.current), store = /^content:\/\//i.test(path);
            return {
                id: text(r.id), ms: r.startMs || null, raw: r.start, endMs: r.endMs || null, path: path, current: text(r.current),
                // På Android står ofta MediaStores adress (content://media/external/downloads/24) i stället för en sökväg.
                name: (store ? fileName(r.url) : fileName(path)) || fileName(r.url) || 'Utan namn', mediaStore: store ? (/\/(\d+)$/.exec(path) || [])[1] || '' : '',
                mime: text(r.mime), size: num(r.size), received: num(r.received), state: text(r.state), opened: num(r.opened) === 1, url: text(r.url), host: host(r.url), chain: text(r.chain),
                referrer: text(r.referrer), site: text(r.site), tab: text(r.tab), tabReferrer: text(r.tabReferrer), lastAccessMs: r.lastAccessMs || null,
            };
        }).sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });
    }

    // Flikarna. parsePlist(bytes) läser local_attributes (en binär plist); LastVisitTime är flikens senaste besök.
    function tabs(src, result, parsePlist) {
        return Roles.mapRows(src.roles.tabs, result, ['closed']).map(function (r) {
            var last = null, attrs = r.attrs;
            if (attrs && parsePlist) {
                try {
                    var d = parsePlist(attrs instanceof Uint8Array ? attrs : new Uint8Array(attrs));
                    var v = d && d.LastVisitTime;
                    if (v && typeof v.__nsdate === 'number') last = Math.round((v.__nsdate + Roles.COCOA_EPOCH) * 1000);
                } catch (e) { /* en trasig plist ger ingen tid */ }
            }
            return {
                id: text(r.id), title: text(r.title).trim(), url: text(r.url), host: host(r.url), group: text(r.group), private: num(r.private) === 1,
                closedMs: r.closedMs || null, order: num(r.order), ms: last,
            };
        }).sort(function (a, b) { return (a.private ? 1 : 0) - (b.private ? 1 : 0) || (b.ms || 0) - (a.ms || 0); });
    }

    function cleared(src, result) {
        return Roles.mapRows(src.roles.cleared, result, ['start', 'end']).map(function (r) {
            return { id: text(r.id), ms: r.startMs || null, startMs: r.startMs || null, endMs: r.endMs || null, url: text(r.url), host: host(r.url) };
        }).sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });
    }

    // Bokmärkena, det senaste först: { id, ms (tillagt), modifiedMs, url, host, title, folder }.
    function bookmarks(src, result) {
        return Roles.mapRows(src.roles.bookmarks, result, ['added', 'modified']).map(function (r) {
            return { id: text(r.id), ms: r.addedMs || null, raw: r.added, modifiedMs: r.modifiedMs || null, url: text(r.url), host: host(r.url), title: text(r.title).trim(), folder: text(r.folder) };
        }).sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });
    }

    // Nedladdningarna i MediaStore som en app gjort (rollen store-downloads i katalogen för Android), i samma form som
    // downloads ovan. För webbläsare utan egen lista (Tor Browser sparar ingen, och ingen adress). rows: rollens rader
    // (mapRows med added och modified), pkg: appens paket.
    function storeDownloads(rows, pkg) {
        return (rows || []).filter(function (r) { return text(r.owner) === pkg; }).map(function (r) {
            return {
                id: text(r.pk), ms: r.addedMs || null, raw: r.added, endMs: null, path: text(r.path), current: '', name: text(r.filename) || fileName(r.path) || 'Utan namn',
                mediaStore: text(r.pk), mime: text(r.mime), size: num(r.size), received: null, state: 'klar', opened: false, url: text(r.url), host: host(r.url), chain: '',
                referrer: text(r.referrer), site: '', tab: '', tabReferrer: '', lastAccessMs: null, fromStore: true, relativePath: text(r.relativePath), modifiedMs: r.modifiedMs || null,
            };
        }).sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });
    }

    // 1,2 MB.
    function sizeText(n) {
        if (n === null || n === undefined || !isFinite(n) || n < 0) return '';
        if (n < 1024) return n + ' byte';
        var u = ['kB', 'MB', 'GB'], v = n / 1024, i = 0;
        while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
        return (v < 10 ? v.toFixed(1) : Math.round(v)).toString().replace('.', ',') + ' ' + u[i];
    }

    var api = { sources: sources, databases: databases, browserOf: browserOf, host: host, fileName: fileName, visits: visits, searches: searches, downloads: downloads, tabs: tabs, cleared: cleared, bookmarks: bookmarks, storeDownloads: storeDownloads,
        decodeTerm: decodeTerm, sizeText: sizeText, KINDS: KINDS, ORIGIN: ORIGIN };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Web = api;
})(typeof window !== 'undefined' ? window : this);
