// Nycklar till appars krypterade databaser, som extraktionsverktyg sparar bredvid filerna.
// Signal på Android skyddar sin databasnyckel med telefonens Keystore, så den går inte att ta
// fram ur filerna. Verktyget låser upp den på telefonen och sparar resultatet, i någon av två former:
//   extra/Secrets/secrets.json i zippen, en post per app med
//     script_output [{ payload: { "sqlite db key": hex } }, { payload: { "signal attachment key": { modernKey, … } } }].
//   En egen nyckelfil med JSON-filen android_keystore,
//     { paket: [{ description, key_name, encrypted_data, decrypted_data }] }. Formatet för Signal
//     är inte kontrollerat (ingen sådan fil med Signal har setts), så tolkningen är försiktig.
// Undersökaren kan också klistra in nyckeln. Ingen DOM. Testas i Node.
(function (root) {
    'use strict';

    var SIGNAL = 'org.thoughtcrime.securesms';
    var SECRETS_RE = /(^|\/)extra\/Secrets\/secrets\.json$/;
    var HEX64 = /^[0-9a-f]{64}$/i;

    function isSecretsPath(name) { return SECRETS_RE.test(String(name || '')); }

    function text(bytes) {
        if (typeof bytes === 'string') return bytes;
        if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
        return Buffer.from(bytes).toString('utf8');
    }

    // JSON som text, bytes eller redan tolkat.
    function parse(input) {
        if (input && typeof input === 'object' && typeof input.length !== 'number') return input;
        if (Array.isArray(input)) return input;
        return JSON.parse(text(input));
    }

    function empty(source) { return { source: source, apps: {} }; }

    function appEntry(out, app) {
        if (!out.apps[app]) out.apps[app] = { dbKey: null, modernKey: null, notes: [] };
        return out.apps[app];
    }

    // Bilagenyckeln kan stå som objekt eller som JSON-text: { classicCipherKey, classicMacKey, modernKey }.
    function modernKeyOf(v) {
        if (!v) return null;
        if (typeof v === 'string') {
            try { v = JSON.parse(v); } catch (e) { return null; }
        }
        return v && typeof v.modernKey === 'string' && v.modernKey ? v.modernKey : null;
    }

    // extra/Secrets/secrets.json.
    function fromSecretsFile(bytes, source) {
        var out = empty(source || 'extra/Secrets/secrets.json');
        var list;
        try { list = parse(bytes); } catch (e) { out.error = 'secrets.json gick inte att läsa som JSON.'; return out; }
        if (!Array.isArray(list)) { out.error = 'secrets.json har inte det väntade formatet (en lista).'; return out; }
        list.forEach(function (item) {
            if (!item || !item.app) return;
            var outputs = Array.isArray(item.script_output) ? item.script_output : [];
            outputs.forEach(function (o) {
                var p = o && o.payload;
                if (!p || typeof p !== 'object') return;
                Object.keys(p).forEach(function (k) {
                    var v = p[k];
                    if (/sqlite db key/i.test(k) && typeof v === 'string' && HEX64.test(v.trim())) appEntry(out, item.app).dbKey = v.trim().toLowerCase();
                    else if (/attachment key/i.test(k)) { var mk = modernKeyOf(v); if (mk) appEntry(out, item.app).modernKey = mk; }
                });
            });
            if (out.apps[item.app] && item.script_title) out.apps[item.app].notes.push(item.script_title);
        });
        return out;
    }

    // android_keystore ur en egen nyckelfil. Bara poster som entydigt är
    // en databasnyckel (32 byte) eller en bilagenyckel (JSON med modernKey) används.
    function fromKeystoreFile(bytes, source) {
        var out = empty(source || 'android_keystore');
        var obj;
        try { obj = parse(bytes); } catch (e) { out.error = 'android_keystore gick inte att läsa som JSON.'; return out; }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { out.error = 'android_keystore har inte det väntade formatet.'; return out; }
        Object.keys(obj).forEach(function (app) {
            (Array.isArray(obj[app]) ? obj[app] : []).forEach(function (e) {
                if (!e || typeof e.decrypted_data !== 'string') return;
                var d = e.decrypted_data.trim();
                var label = String(e.description || '') + ' ' + String(e.key_name || '');
                if (HEX64.test(d) && (/database/i.test(label) || app === SIGNAL)) appEntry(out, app).dbKey = d.toLowerCase();
                var mk = modernKeyOf(d) || (/^[0-9a-f]+$/i.test(d) && d.length % 2 === 0 ? modernKeyOf(hexText(d)) : null);
                if (mk) appEntry(out, app).modernKey = mk;
            });
        });
        return out;
    }

    function hexText(hex) {
        var s = '';
        for (var i = 0; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
    }

    // Det undersökaren klistrar in: databasnyckeln som 64 hextecken, bilagenyckeln som JSON
    // ({"modernKey": …}) eller som base64, eller hela secrets.json-posten.
    function parseManual(input) {
        var s = String(input == null ? '' : input).trim();
        var out = { dbKey: null, modernKey: null };
        if (!s) return out;
        if (/^[\[{]/.test(s)) {
            try {
                var j = JSON.parse(s);
                var c = fromSecretsFile(Array.isArray(j) ? j : [{ app: SIGNAL, script_output: [{ payload: j }] }], 'inklistrad');
                var a = c.apps[SIGNAL] || Object.keys(c.apps).map(function (k) { return c.apps[k]; })[0];
                if (a) { out.dbKey = a.dbKey; out.modernKey = a.modernKey; }
                if (!out.modernKey) out.modernKey = modernKeyOf(j);
                return out;
            } catch (e) { return out; }
        }
        s.split(/[\s,;]+/).forEach(function (part) {
            var p = part.replace(/^x'|'$/g, '');
            if (HEX64.test(p)) out.dbKey = p.toLowerCase();
            else if (/^[A-Za-z0-9+/_-]{43}=?$/.test(p)) out.modernKey = p;
        });
        return out;
    }

    // Signals nycklar ur det som hittats, i ordning: inklistrat, secrets.json, android_keystore.
    // Returnerar { dbKey, modernKey, source } eller null.
    function signalKeys(found) {
        for (var i = 0; i < (found || []).length; i++) {
            var f = found[i];
            if (!f) continue;
            var a = f.apps ? f.apps[SIGNAL] : f;
            if (a && (a.dbKey || a.modernKey)) return { dbKey: a.dbKey || null, modernKey: a.modernKey || null, source: f.source || 'inklistrad' };
        }
        return null;
    }

    var api = { SIGNAL: SIGNAL, isSecretsPath: isSecretsPath, fromSecretsFile: fromSecretsFile, fromKeystoreFile: fromKeystoreFile, parseManual: parseManual, signalKeys: signalKeys };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.AppSecrets = api;
})(typeof window !== 'undefined' ? window : this);
