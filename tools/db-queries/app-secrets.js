// Nycklar till appars krypterade databaser, som extraktionsverktyg sparar bredvid filerna.
// Signal på Android skyddar sin databasnyckel med telefonens Keystore, så den går inte att ta
// fram ur filerna. Verktyget låser upp den på telefonen och sparar resultatet, i någon av två former:
//   extra/Secrets/secrets.json i zippen, en post per app med
//     script_output [{ payload: { "sqlite db key": hex } }, { payload: { "signal attachment key": { modernKey, … } } }].
//   En egen nyckelfil med JSON-filen android_keystore,
//     { paket: [{ description, key_name, encrypted_data, decrypted_data }] }. Formatet för Signal
//     är inte kontrollerat (ingen sådan fil med Signal har setts), så tolkningen är försiktig.
// Signal på iOS lägger databasnyckeln i nyckelringen. Extraktionsverktyg sparar den på två sätt:
//   En plist bredvid zippen (…_keychain.plist), med posterna öppna i listorna genp, inet, keys och cert.
//   extra/KeychainDump/backup_keychain_v2.plist i zippen, med varje post krypterad (keychainEntries).
// Programmet letar själv (ExtractionCore.findKeys). Undersökaren kan också välja filen eller klistra in
// nyckeln. Ingen DOM. Testas i Node.
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

    // En nyckelfil under extra/ i zippen. Mappen ska ligga högst upp, eller i en enda mapp som zippen packat
    // allt i: längre ned och under filesystem1/ ligger telefonens egna filer, som inte ska tas för nycklar.
    function isExtraKeyPath(name) {
        if (isSecretsPath(name)) return true;
        var m = /^(?!filesystem\d*\/)(?:[^/]+\/)?extra\/(?:.+\/)?([^/]+)$/.exec(String(name || ''));
        return !!m && isKeyFileName(m[1]);
    }

    // Telefonens id i ett filnamn: det som står före första understrecket, när det ser ut som ett id
    // (minst 8 tecken, bokstäver, siffror och bindestreck, minst en siffra). null när namnet inte har något.
    function deviceIdOf(name) {
        var m = /^([0-9A-Za-z-]{8,})_/.exec(String(name || ''));
        return m && /\d/.test(m[1]) ? m[1].toLowerCase() : null;
    }

    // Vilka av filerna i zippens mapp som är dess nyckelfiler. Samma id i namnet avgör. Annars duger en enda
    // nyckelfil utan ett annat telefon-id. Flera, eller en annan telefons, väljs aldrig på chans: mappen kan
    // ha flera telefoners extraktioner. -> { use: [namn], other: [nyckelfiler som inte valdes] }.
    function besideKeyFiles(zipName, names) {
        var id = deviceIdOf(zipName);
        var keys = (names || []).filter(function (n) { return n !== zipName && isKeyFileName(n); });
        var same = id ? keys.filter(function (n) { return deviceIdOf(n) === id; }) : [];
        if (same.length) return { use: same, other: [] };
        var free = keys.filter(function (n) { return !id || !deviceIdOf(n); });
        return free.length === 1 ? { use: free, other: [] } : { use: [], other: keys };
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

    // Signals post i nyckelringen: svce GRDBKeyChainService, acct GRDBDatabaseCipherKeySpec, och värdet på
    // 48 byte (AES-nyckeln och saltet). Kontrollerat mot Signal på iOS 26.4.1 (labbtelefon, 2026-11-03).
    function isSignalItem(it) {
        return fieldText(it.svce) === 'GRDBKeyChainService' && fieldText(it.acct) === 'GRDBDatabaseCipherKeySpec';
    }

    function addSignalKey(out, value, group) {
        if (!(value instanceof Uint8Array) || value.length !== 48) return;
        var a = appEntry(out, SIGNAL_IOS);
        a.dbKey = toHex(value);
        a.notes.push('GRDBKeyChainService / GRDBDatabaseCipherKeySpec' + (group ? ' (' + fieldText(group) + ')' : ''));
    }

    // Nyckelringen från en iOS-extraktion: { genp: [...], inet: [...], keys: [...], cert: [...] }, en
    // post per objekt med agrp (åtkomstgrupp), svce (tjänst), acct (konto, ibland som data) och v_Data (värdet).
    function fromKeychainPlist(bytes, source, parseBinary) {
        var out = empty(source || 'nyckelringen');
        out.kind = 'keychain';
        var p;
        try { p = plistOf(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), parseBinary); } catch (e) { out.error = 'Nyckelringen gick inte att läsa som plist: ' + e.message + '.'; return out; }
        if (!p || typeof p !== 'object' || !Array.isArray(p.genp)) { out.error = 'Filen är en plist men ingen nyckelring (listan genp saknas).'; return out; }
        out.items = ['genp', 'inet', 'keys', 'cert'].reduce(function (n, k) { return n + (Array.isArray(p[k]) ? p[k].length : 0); }, 0);
        p.genp.forEach(function (it) {
            if (it && typeof it === 'object' && isSignalItem(it)) addSignalKey(out, it.v_Data, it.agrp);
        });
        return out;
    }

    // Innehållet ur en NSKeyedArchiver-plist med AES-GCM-delarna (_SFAuthenticatedCiphertext), dekrypterat och
    // kontrollerat. Stämmer inte kontrollsumman kastas ett fel.
    async function openSealed(keyBytes, sealed, parseBinary) {
        var a = plistOf(sealed, parseBinary);
        var o = a.$objects;
        var r = o[a.$top.root.value];
        var data = o[r.SFCiphertext.value], tag = o[r.SFAuthenticationCode.value];
        var joined = new Uint8Array(data.length + tag.length);
        joined.set(data);
        joined.set(tag, data.length);
        var key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
        return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: o[r.SFInitializationVector.value], tagLength: tag.length * 8 }, key, joined));
    }

    // Nyckelringen med krypterade poster (iOS keychain, version 8): { keychainEntries: [{ table, classKeyIdx,
    // metadata: { wrappedKey, ciphertext, tamperCheck }, data: { unwrappedKey, ciphertext, tamperCheck } }],
    // classKeyIdxToUnwrappedMetadataClassKey: { idx: nyckel } }. Extraktionsverktyget har låst upp klassnycklarna
    // och postens nyckel. Klassnyckeln öppnar postens metadatanyckel, som öppnar metadatan (DER: svce, acct, agrp),
    // och postens nyckel öppnar värdet (DER: v_Data). TamperCheck ska vara samma i posten som i det dekrypterade.
    // Bara värdet i Signals post dekrypteras. Kontrollerat mot två iOS-extraktioner utan Signal: alla 1 496
    // poster öppnas, och fälten heter som i plisten bredvid zippen.
    async function fromKeychainEntries(p, source, parseBinary) {
        var out = empty(source || 'nyckelringen');
        out.kind = 'keychain';
        out.items = p.keychainEntries.length;
        var kc = root.KC || (typeof globalThis !== 'undefined' ? globalThis.KC : null);
        var der = kc && kc.asn1;
        if (!der) { out.error = 'Nyckelringens poster är krypterade, och tolken för dem saknas (asn1.js).'; return out; }
        if (typeof crypto === 'undefined' || !crypto.subtle) { out.error = 'Nyckelringens poster är krypterade, och webbläsaren har inte det krypto som behövs (WebCrypto) här.'; return out; }
        var classKeys = p.classKeyIdxToUnwrappedMetadataClassKey || {};
        var tried = 0, failed = 0;
        for (var i = 0; i < p.keychainEntries.length; i++) {
            var e = p.keychainEntries[i];
            if (!e || e.table !== 'genp') continue;
            tried++;
            try {
                var itemKey = await openSealed(classKeys[String(e.classKeyIdx)], e.metadata.wrappedKey, parseBinary);
                var attrs = der.parseRecord(await openSealed(itemKey, e.metadata.ciphertext, parseBinary));
                if (attrs.TamperCheck !== e.metadata.tamperCheck) { failed++; continue; }
                if (!isSignalItem(attrs)) continue;
                var secret = der.parseRecord(await openSealed(e.data.unwrappedKey, e.data.ciphertext, parseBinary));
                if (secret.TamperCheck !== e.data.tamperCheck) { failed++; continue; }
                addSignalKey(out, secret.v_Data, attrs.agrp);
            } catch (err) { failed++; }
        }
        out.failed = failed;
        if (failed && !out.apps[SIGNAL_IOS]) out.error = failed + ' av ' + tried + ' poster i nyckelringen gick inte att dekryptera, så Signals nyckel kan finnas bland dem.';
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

    // Samma sak, och också nyckelringen med krypterade poster. Dekrypteringen är asynkron.
    async function readKeyBytes(bytes, name, parseBinary) {
        bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        var p = null;
        if (looksLikeKeychain(bytes)) {
            try { p = plistOf(bytes, parseBinary); } catch (e) { p = null; }
        }
        return p && Array.isArray(p.keychainEntries) ? fromKeychainEntries(p, name, parseBinary) : fromKeyFile(bytes, name, parseBinary);
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

    // Finns Signals databasnyckel, för Android eller iOS, i det som hittats?
    function hasSignalKey(found) {
        var has = function (app) { var k = signalKeys(found, app); return !!(k && k.dbKey); };
        return has(SIGNAL) || has(SIGNAL_IOS);
    }

    // Var nyckeln saknas, för felet när den inte hittas.
    function keyHint(profile) {
        return profile === 'signal-ios' ? 'nyckelringen (…_keychain.plist)' : 'nyckelfilen (…_android_keystore.zip eller secrets.json)';
    }

    // Vad undersökaren får veta när nyckeln inte hittades: var programmet letade och vad som återstår.
    // opts: { profile, word (zippen eller rapporten), search: { lookedBeside, other } ur ExtractionCore.findKeys }.
    function missingKeyText(opts) {
        var word = opts.word || 'zippen';
        var search = opts.search || {};
        var other = search.other || [];
        var inside = word === 'rapporten' ? 'i rapporten' : 'under extra/ i zippen';
        var looked = 'Ingen nyckel hittades ' + inside + (search.lookedBeside && !other.length ? ' eller bredvid den.' : '.');
        if (other.length) looked += ' Bredvid ' + word + ' ligger ' + other.join(', ') + ', men inget visar att de hör till den.';
        if (!search.lookedBeside) looked += ' En webbläsare får inte se mappen där ' + word + ' ligger.';
        return looked + ' Välj ' + keyHint(opts.profile) + ' med Nyckelfil…, eller klistra in nyckeln. Den sparas inte.';
    }

    var api = {
        SIGNAL: SIGNAL, SIGNAL_IOS: SIGNAL_IOS, isSecretsPath: isSecretsPath, isKeyFileName: isKeyFileName, isExtraKeyPath: isExtraKeyPath,
        besideKeyFiles: besideKeyFiles, deviceIdOf: deviceIdOf,
        fromSecretsFile: fromSecretsFile, fromKeystoreFile: fromKeystoreFile, fromKeychainPlist: fromKeychainPlist, fromKeyFile: fromKeyFile, readKeyBytes: readKeyBytes,
        parseXmlPlist: parseXmlPlist, parseManual: parseManual, signalKeys: signalKeys, keysForProfile: keysForProfile, hasSignalKey: hasSignalKey, keyHint: keyHint, missingKeyText: missingKeyText,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.AppSecrets = api;
})(typeof window !== 'undefined' ? window : this);
