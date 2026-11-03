// Nycklar till appars krypterade databaser, som extraktionsverktyg sparar bredvid filerna.
// Signal på Android skyddar sin databasnyckel med telefonens Keystore, så den går inte att ta
// fram ur filerna. Verktyget låser upp den på telefonen och sparar resultatet, i någon av två former:
//   extra/Secrets/secrets.json i zippen, en post per app med
//     script_output [{ payload: { "sqlite db key": hex } }, { payload: { "signal attachment key": { modernKey, … } } }].
//   En egen nyckelfil med JSON-filen android_keystore,
//     { paket: [{ description, key_name, encrypted_data, decrypted_data }] }. Formatet för Signal
//     är inte kontrollerat (ingen sådan fil med Signal har setts), så tolkningen är försiktig.
// Signal på iOS lägger databasnyckeln i nyckelringen. Extraktionsverktyget sparar nyckelringen som
// en plist bredvid zippen (…_keychain.plist), som undersökaren väljer tillsammans med zippen.
// Undersökaren kan också klistra in nyckeln. Ingen DOM. Testas i Node.
(function (root) {
    'use strict';

    var SIGNAL = 'org.thoughtcrime.securesms';
    var SIGNAL_IOS = 'org.whispersystems.signal';
    var SECRETS_RE = /(^|\/)extra\/Secrets\/secrets\.json$/;
    var HEX64 = /^[0-9a-f]{64}$/i;
    var HEX96 = /^[0-9a-f]{96}$/i;

    function isSecretsPath(name) { return SECRETS_RE.test(String(name || '')); }

    // Ett filnamn som ser ut som en nyckelfil: nyckelringen som plist, secrets.json eller android_keystore.
    function isKeyFileName(name) {
        var n = String(name || '').split('/').pop();
        return /keychain[^/]*\.plist$/i.test(n) || /^secrets\.json$/i.test(n) || /keystore/i.test(n);
    }

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

    function toHex(bytes) {
        var s = '';
        for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
        return s;
    }

    function base64Bytes(s) {
        s = String(s || '').replace(/\s+/g, '');
        if (typeof atob === 'function') {
            var bin = atob(s);
            var out = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            return out;
        }
        return Uint8Array.from(Buffer.from(s, 'base64'));
    }

    // ---------- Nyckelringen (plist) ----------

    function unescapeXml(s) {
        return s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-f]+|#\d+);/gi, function (m, e) {
            var l = e.toLowerCase();
            if (l === 'lt') return '<';
            if (l === 'gt') return '>';
            if (l === 'amp') return '&';
            if (l === 'quot') return '"';
            if (l === 'apos') return "'";
            return String.fromCodePoint(l.charAt(1) === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
        });
    }

    // En XML-plist till samma värden som den binära tolken ger: dict -> objekt, array -> lista,
    // data -> Uint8Array, integer och real -> tal, date -> text.
    function parseXmlPlist(text) {
        var re = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z]+)[^>]*?(\/?)>|([^<]+)/g;
        var toks = [];
        var m;
        while ((m = re.exec(text))) {
            if (m[2]) toks.push({ tag: m[2], close: !!m[1], empty: !!m[3] });
            else if (m[4] != null) toks.push({ text: m[4] });
        }
        var i = 0;
        function skip() { while (i < toks.length && toks[i].text != null && !/\S/.test(toks[i].text)) i++; }
        function textOf(tag) {
            var s = '';
            while (i < toks.length && !(toks[i].tag === tag && toks[i].close)) { if (toks[i].text != null) s += toks[i].text; i++; }
            if (i >= toks.length) throw new Error('<' + tag + '> slutar aldrig');
            i++;
            return unescapeXml(s);
        }
        function value() {
            skip();
            var t = toks[i++];
            if (!t || !t.tag || t.close) throw new Error('oväntat innehåll i plist');
            if (t.tag === 'plist') return value();
            if (t.empty) return t.tag === 'dict' ? {} : t.tag === 'array' ? [] : t.tag === 'true' ? true : t.tag === 'false' ? false : t.tag === 'data' ? new Uint8Array(0) : '';
            switch (t.tag) {
                case 'dict': {
                    var o = {};
                    for (;;) {
                        skip();
                        var n = toks[i];
                        if (!n) throw new Error('<dict> slutar aldrig');
                        if (n.tag === 'dict' && n.close) { i++; return o; }
                        if (n.tag !== 'key' || n.close) throw new Error('<dict> utan <key>');
                        i++;
                        var k = textOf('key');
                        o[k] = value();
                    }
                }
                case 'array': {
                    var a = [];
                    for (;;) {
                        skip();
                        if (!toks[i]) throw new Error('<array> slutar aldrig');
                        if (toks[i].tag === 'array' && toks[i].close) { i++; return a; }
                        a.push(value());
                    }
                }
                case 'string': return textOf('string');
                case 'data': return base64Bytes(textOf('data'));
                case 'integer': return Number(textOf('integer'));
                case 'real': return Number(textOf('real'));
                case 'date': return textOf('date');
                case 'true': textOf('true'); return true;
                case 'false': textOf('false'); return false;
                default: throw new Error('okänd tagg <' + t.tag + '> i plist');
            }
        }
        return value();
    }

    function isBinaryPlist(bytes) {
        return bytes && bytes.length >= 8 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]) === 'bplist';
    }

    function plistOf(bytes, parseBinary) {
        if (isBinaryPlist(bytes)) {
            var kc = root.KC || (typeof globalThis !== 'undefined' ? globalThis.KC : null);
            var parse = parseBinary || (kc && kc.bplist ? kc.bplist.parse : null);
            if (!parse) throw new Error('tolken för binära plistar saknas (bplist.js)');
            return parse(bytes);
        }
        return parseXmlPlist(text(bytes));
    }

    function fieldText(v) {
        if (v == null) return '';
        if (typeof v === 'string') return v;
        if (v instanceof Uint8Array) { try { return text(v); } catch (e) { return ''; } }
        return String(v);
    }

    // Nyckelringen från en iOS-extraktion: { genp: [...], inet: [...], keys: [...], cert: [...] }, en
    // post per objekt med agrp (åtkomstgrupp), svce (tjänst), acct (konto, ibland som data) och v_Data
    // (värdet). Signals databasnyckel: svce GRDBKeyChainService, acct GRDBDatabaseCipherKeySpec,
    // 48 byte (AES-nyckeln och saltet). Kontrollerat mot Signal på iOS 26.4.1 (labbtelefon, 2026-11-03).
    function fromKeychainPlist(bytes, source, parseBinary) {
        var out = empty(source || 'nyckelringen');
        out.kind = 'keychain';
        var p;
        try { p = plistOf(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), parseBinary); } catch (e) { out.error = 'Nyckelringen gick inte att läsa som plist: ' + e.message + '.'; return out; }
        if (!p || typeof p !== 'object' || !Array.isArray(p.genp)) { out.error = 'Filen är en plist men ingen nyckelring (listan genp saknas).'; return out; }
        out.items = ['genp', 'inet', 'keys', 'cert'].reduce(function (n, k) { return n + (Array.isArray(p[k]) ? p[k].length : 0); }, 0);
        p.genp.forEach(function (it) {
            if (!it || typeof it !== 'object') return;
            if (fieldText(it.svce) !== 'GRDBKeyChainService' || fieldText(it.acct) !== 'GRDBDatabaseCipherKeySpec') return;
            var v = it.v_Data;
            if (!(v instanceof Uint8Array) || v.length !== 48) return;
            var a = appEntry(out, SIGNAL_IOS);
            a.dbKey = toHex(v);
            a.notes.push('GRDBKeyChainService / GRDBDatabaseCipherKeySpec' + (it.agrp ? ' (' + fieldText(it.agrp) + ')' : ''));
        });
        return out;
    }

    function looksLikeKeychain(bytes) {
        if (isBinaryPlist(bytes)) return true;
        var head = text(bytes.subarray(0, Math.min(bytes.length, 4096)));
        return /<plist[\s>]/.test(head);
    }

    // En nyckelfil som undersökaren valt: nyckelringen (plist), secrets.json eller android_keystore.
    // Formatet avgörs av innehållet, inte namnet.
    function fromKeyFile(bytes, name, parseBinary) {
        bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        if (looksLikeKeychain(bytes)) return fromKeychainPlist(bytes, name, parseBinary);
        var obj;
        try { obj = JSON.parse(text(bytes)); } catch (e) { obj = undefined; }
        if (Array.isArray(obj)) return fromSecretsFile(obj, name);
        if (obj && typeof obj === 'object') return fromKeystoreFile(obj, name);
        var out = empty(name || 'nyckelfil');
        out.error = 'Filen är ingen nyckelfil som programmet känner igen (nyckelringen som plist, secrets.json eller android_keystore).';
        return out;
    }

    // Det undersökaren klistrar in: databasnyckeln som 64 hextecken (Android) eller 96 (iOS, nyckel
    // och salt, gärna som x'…'), bilagenyckeln som JSON ({"modernKey": …}) eller som base64, eller
    // hela secrets.json-posten.
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
            var p = part.replace(/^x'|'$/gi, '');
            if (HEX64.test(p) || HEX96.test(p)) out.dbKey = p.toLowerCase();
            else if (/^[A-Za-z0-9+/_-]{43}=?$/.test(p)) out.modernKey = p;
        });
        return out;
    }

    // Passar databasnyckeln appen? Android: 64 hextecken. iOS: 96 (nyckel och salt).
    function fits(app, key) { return app === SIGNAL_IOS ? HEX96.test(key) : HEX64.test(key); }

    // Signals nycklar ur det som hittats, i ordning: inklistrat, secrets.json, android_keystore,
    // nyckelringen. Varje nyckel tas för sig ur den första källan som har den, så att en inklistrad
    // bilagenyckel inte döljer databasnyckeln i nyckelfilen. app: SIGNAL (Android, standard) eller
    // SIGNAL_IOS. En inklistrad nyckel räknas bara om längden passar appen. source är databasnyckelns
    // källa (annars bilagenyckelns), modernSource bilagenyckelns.
    // Returnerar { dbKey, modernKey, source, modernSource } eller null.
    function signalKeys(found, app) {
        app = app || SIGNAL;
        var out = { dbKey: null, modernKey: null, source: null, modernSource: null };
        (found || []).forEach(function (f) {
            if (!f) return;
            var a = f.apps ? f.apps[app] : f;
            if (!a) return;
            var from = f.source || 'inklistrad';
            if (a.dbKey && !out.dbKey && fits(app, a.dbKey)) { out.dbKey = a.dbKey; out.source = from; }
            if (a.modernKey && !out.modernKey && app === SIGNAL) { out.modernKey = a.modernKey; out.modernSource = from; }
        });
        if (!out.dbKey && !out.modernKey) return null;
        if (!out.source) out.source = out.modernSource;
        return out;
    }

    // Nycklarna för en databas efter dess SQLCipher-profil i katalogen ('signal' eller 'signal-ios').
    function keysForProfile(found, profile) {
        return signalKeys(found, profile === 'signal-ios' ? SIGNAL_IOS : SIGNAL);
    }

    // Var nyckeln saknas, för felet när den inte hittas.
    function keyHint(profile) {
        return profile === 'signal-ios' ? 'nyckelringen (…_keychain.plist bredvid zippen)' : 'nyckelfilen (extra/Secrets/secrets.json)';
    }

    var api = {
        SIGNAL: SIGNAL, SIGNAL_IOS: SIGNAL_IOS, isSecretsPath: isSecretsPath, isKeyFileName: isKeyFileName,
        fromSecretsFile: fromSecretsFile, fromKeystoreFile: fromKeystoreFile, fromKeychainPlist: fromKeychainPlist, fromKeyFile: fromKeyFile,
        parseXmlPlist: parseXmlPlist, parseManual: parseManual, signalKeys: signalKeys, keysForProfile: keysForProfile, keyHint: keyHint,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.AppSecrets = api;
})(typeof window !== 'undefined' ? window : this);
