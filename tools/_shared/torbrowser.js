// Tor Browser och andra Gecko-webbläsare på Android: filerna utanför databaserna som säger när appen användes.
// tor/state (Tors egen text: LastWritten, TorVersion, TotalBuildTimes), cached-microdesc-consensus (valid-after),
// shared_prefs/fenix_preferences.xml (senaste surfaktivitet, användningstid, antal starter, privat läge), profilens
// times.json (när profilen skapades) och flikbilderna i no_backup/mozac_browser_thumbnails. Ingen SQL här; historiken
// och bokmärkena läses med katalogen Webbhistorik (familjen android-gecko). Används av Telefonen; testas i Node.
// Kontrollerat mot Tor Browser 16.0.2 på en labbtelefon (Android 13, 2026-11-21).
(function (root) {
    'use strict';

    var NAMES = {
        'org.torproject.torbrowser': 'Tor Browser', 'org.torproject.torbrowser_alpha': 'Tor Browser Alpha',
        'org.mozilla.firefox': 'Firefox', 'org.mozilla.firefox_beta': 'Firefox Beta', 'org.mozilla.fenix': 'Firefox Nightly', 'org.mozilla.focus': 'Firefox Focus',
    };
    function isGecko(pkg) { return !!NAMES[pkg] || /^org\.(torproject|mozilla)\./.test(String(pkg || '')); }
    function isTor(pkg) { return /^org\.torproject\./.test(String(pkg || '')); }

    // Filerna i appens mapp som läses: { kind, pkg } eller null. Sökvägen kan börja var som helst (zippens prefix).
    var FILES = [
        ['state', /\/files\/tor\/state$/],
        ['consensus', /\/files\/tor\/cached-microdesc-consensus$/],
        ['prefs', /\/shared_prefs\/fenix_preferences\.xml$/],
        ['times', /\/files\/mozilla\/[^\/]+\/times\.json$/],
        ['thumb', /\/no_backup\/mozac_browser_thumbnails\/(?:private_)?thumbnails\/[^\/]+\.0$/],
    ];
    function fileOf(path) {
        var s = '/' + String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
        var m = /\/data\/(?:data|user\/\d+)\/([^\/]+)\//.exec(s);
        if (!m || !isGecko(m[1])) return null;
        for (var i = 0; i < FILES.length; i++) {
            if (FILES[i][1].test(s)) return { kind: FILES[i][0], pkg: m[1], private: FILES[i][0] === 'thumb' ? /\/private_thumbnails\//.test(s) : undefined };
        }
        return null;
    }

    // "2026-11-21 13:05:32" i UTC (Tor skriver tiderna så) -> ms.
    function utcMs(text) {
        var m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)$/.exec(String(text || '').trim());
        return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
    }

    // tor/state: { lastWrittenMs, version, builds, guards, dormant }. Vakternas sampled_on och confirmed_on slumpas bakåt
    // av Tor och säger inte när Tor användes; de räknas bara.
    function torState(text) {
        var out = { lastWrittenMs: null, version: '', builds: null, guards: 0, dormant: null };
        String(text || '').split(/\r?\n/).forEach(function (line) {
            var m = /^(\S+)\s+(.*)$/.exec(line.trim());
            if (!m || m[1].charAt(0) === '#') return;
            if (m[1] === 'LastWritten') out.lastWrittenMs = utcMs(m[2]);
            else if (m[1] === 'TorVersion') out.version = m[2].replace(/^Tor\s+/, '').replace(/\s*\(.*\)$/, '');
            else if (m[1] === 'TotalBuildTimes') out.builds = Number(m[2]);
            else if (m[1] === 'Guard') out.guards++;
            else if (m[1] === 'Dormant') out.dormant = m[2] === '1';
        });
        return out;
    }

    // valid-after i konsensusfilen (de första raderna): ms eller null.
    function consensusValidAfter(text) {
        var m = /^valid-after\s+(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\s*$/m.exec(String(text || '').slice(0, 4096));
        return m ? utcMs(m[1]) : null;
    }

    // shared_prefs i Androids XML-form: { namn: värde } med long och int som tal och boolean som true/false.
    function sharedPrefs(xml) {
        var out = {}, re = /<(boolean|int|long|float|string)\s+name="([^"]*)"(?:\s+value="([^"]*)")?\s*(?:\/>|>([\s\S]*?)<\/\1>)/g, m;
        var unescape = function (s) { return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); };
        while ((m = re.exec(String(xml || '')))) {
            var v = m[3] !== undefined ? m[3] : m[4] || '';
            out[unescape(m[2])] = m[1] === 'boolean' ? v === 'true' : m[1] === 'string' ? unescape(v) : Number(v);
        }
        return out;
    }

    // fenix_preferences.xml: det som säger hur appen användes.
    function fenixPrefs(xml) {
        var p = sharedPrefs(xml), ms = function (k) { var v = p[k]; return typeof v === 'number' && v > 0 ? v : null; };
        var n = function (k) { return typeof p[k] === 'number' ? p[k] : null; };
        return {
            lastBrowseMs: ms('pref_key_last_browse_activity_time'), lastHomeMs: ms('pref_key_last_home_activity_time'),
            usageS: n('pref_key_growth_usage_time') !== null ? Math.round(n('pref_key_growth_usage_time') / 1000) : null,
            launches: n('pref_key_app_launch_count'), opened: n('pref_key_times_app_opened'), coldStarts: n('pref_key_app_cold_start_count'),
            privateMode: typeof p.pref_key_last_known_mode_private === 'boolean' ? p.pref_key_last_known_mode_private : null,
            version: typeof p.pref_key_extensions_version === 'string' ? p.pref_key_extensions_version.split('-')[0] : '',
        };
    }

    // times.json i profilen: { createdMs, firstUseMs }.
    function profileTimes(text) {
        try {
            var j = JSON.parse(String(text || ''));
            return { createdMs: typeof j.created === 'number' ? j.created : null, firstUseMs: typeof j.firstUse === 'number' ? j.firstUse : null };
        } catch (e) { return { createdMs: null, firstUseMs: null }; }
    }

    var api = { NAMES: NAMES, isGecko: isGecko, isTor: isTor, fileOf: fileOf, torState: torState, consensusValidAfter: consensusValidAfter, sharedPrefs: sharedPrefs, fenixPrefs: fenixPrefs, profileTimes: profileTimes, utcMs: utcMs };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.TorBrowser = api;
})(typeof window !== 'undefined' ? window : this);
