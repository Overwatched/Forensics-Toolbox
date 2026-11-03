// Appversionen för apparna som Härkomst läser (Snapchat, Signal), till protokollet. Databasernas
// tabeller ändras mellan versioner, så protokollet säger vilken version uppgifterna kommer från
// och var versionen står:
//   iOS: appens Info.plist i paketet (Bundle/Application/<GUID>/<App>.app), alltså den version som
//        var installerad när extraktionen gjordes.
//   Android: data/system/packages.xml (versionskod, installerad och uppdaterad), Snapchats Memories
//        (snap_create_user_agent: versionen när snappen togs) och Signals logg (versionen på raden
//        närmast T).
// Ingen DOM, ingen zip. Testas i Node.
(function (root) {
    'use strict';

    // Info.plist som bplist (via parseBinary) eller XML. Returnerar { bundleId, version, build } eller null.
    function fromInfoPlist(bytes, parseBinary) {
        if (!bytes || bytes.length < 8) return null;
        var head = String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, 0, 8));
        var obj = null;
        if (head === 'bplist00') {
            if (!parseBinary) return null;
            try { obj = parseBinary(bytes); } catch (e) { return null; }
        } else {
            var text = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8').decode(bytes) : Buffer.from(bytes).toString('utf8');
            obj = {};
            ['CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion'].forEach(function (k) {
                var m = new RegExp('<key>' + k + '</key>\\s*<string>([^<]*)</string>').exec(text);
                if (m) obj[k] = m[1].trim();
            });
        }
        if (!obj || typeof obj !== 'object') return null;
        var version = typeof obj.CFBundleShortVersionString === 'string' ? obj.CFBundleShortVersionString : null;
        var build = typeof obj.CFBundleVersion === 'string' ? obj.CFBundleVersion : null;
        if (!version && !build) return null;
        return { bundleId: typeof obj.CFBundleIdentifier === 'string' ? obj.CFBundleIdentifier : null, version: version, build: build };
    }

    // Tiderna i packages.xml är millisekunder, i text som hex och i ABX som tal.
    function msOf(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'number') return v > 0 ? v : null;
        var n = parseInt(String(v), 16);
        return n > 0 ? n : null;
    }

    // version = versionskoden, ut = senast uppdaterad, it = installerad (bara äldre Android; senare
    // står den per användare i package-restrictions.xml), ft = tidsstämpeln för appens paketfil.
    function pkgInfo(attrs) {
        var code = attrs.version != null && attrs.version !== '' ? Number(attrs.version) : null;
        return { versionCode: code != null && isFinite(code) ? code : null, fileMs: msOf(attrs.ft), installMs: msOf(attrs.it), updateMs: msOf(attrs.ut) };
    }

    // packages.xml (ABX från Android 12 via abxParse, annars text): { versionCode, fileMs,
    // installMs, updateMs } för paketet, eller null. Kontrollerat mot en verklig extraktion (Android, ABX).
    function fromPackagesXml(bytes, pkg, abxParse) {
        if (!bytes || bytes.length < 4) return null;
        if (bytes[0] === 0x41 && bytes[1] === 0x42 && bytes[2] === 0x58 && bytes[3] === 0) {
            if (!abxParse) return null;
            var doc;
            try { doc = abxParse(bytes); } catch (e) { return null; }
            var found = null;
            (function walk(el) {
                if (found || !el) return;
                if (el.name === 'package' && el.attrs && el.attrs.name === pkg) { found = el; return; }
                (el.children || []).forEach(walk);
            })(doc);
            return found ? pkgInfo(found.attrs) : null;
        }
        var text = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8').decode(bytes) : Buffer.from(bytes).toString('utf8');
        var re = /<package\s([^>]*)>/g;
        var m;
        while ((m = re.exec(text))) {
            var attrs = {};
            m[1].replace(/([\w:.-]+)="([^"]*)"/g, function (all, k, v) { attrs[k] = v; return all; });
            if (attrs.name === pkg) return pkgInfo(attrs);
        }
        return null;
    }

    // "Snapchat/14.30.0.54 (AC2003; Android 13#…)" -> "14.30.0.54".
    function fromUserAgent(ua) {
        var m = /Snapchat\/(\d+(?:\.\d+)+)/.exec(String(ua || ''));
        return m ? m[1] : null;
    }

    // Signals loggrader börjar med versionen: "[8.33.2] [tråd] 2026-11-02 …". Versionen på raden
    // närmast T. rows: [{ timeMs, body }]. Returnerar { version, ms } eller null.
    function fromSignalLog(rows, T) {
        var best = null;
        (rows || []).forEach(function (r) {
            var m = /^\[(\d+(?:\.\d+)+)\]/.exec(String(r.body || ''));
            var ms = Number(r.timeMs != null ? r.timeMs : r.time);
            if (!m || !isFinite(ms)) return;
            if (!best || (T != null && Math.abs(ms - T) < Math.abs(best.ms - T))) best = { version: m[1], ms: ms };
        });
        return best;
    }

    // En mening per app till protokollet. list: [{ app, version, build, versionCode, source, note }].
    function text(list) {
        return (list || []).map(function (v) {
            var what = v.version ? v.version + (v.build && v.build !== v.version ? ' (build ' + v.build + ')' : '') : v.versionCode != null ? 'versionskod ' + v.versionCode : 'okänd version';
            if (v.version && v.versionCode != null) what += ', versionskod ' + v.versionCode;
            return v.app + ' ' + what + ' (' + v.source + (v.note ? '; ' + v.note : '') + ')';
        }).join('. ') + ((list || []).length ? '.' : '');
    }

    var api = { fromInfoPlist: fromInfoPlist, fromPackagesXml: fromPackagesXml, fromUserAgent: fromUserAgent, fromSignalLog: fromSignalLog, text: text };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceAppVersions = api;
})(typeof window !== 'undefined' ? window : this);
