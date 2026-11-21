// Webbläsarnas cache på telefonen: sidor och filer som de låg sparade när extraktionen gjordes.
// WebKit (Safari och andra appar på iOS): Library/Caches/WebKit/NetworkCache/Version N/Records/<partition>/Resource/<hash>,
// en post per adress med nyckel, tid, svarets rubriker och innehållet (i posten, eller i Blobs/<SHA-1 av innehållet>).
// Chromium (Chrome och Samsung Internet på Android): cache/Cache/Cache_Data/<hash>_0, "simple cache" med nyckeln
// (adressen), innehållet och svarets rubriker. Chromium sparar innehållet som det kom, så en sida kan vara gzip- eller
// brotli-packad. Kontrollerat mot labbtelefonerna 2026-11-11 (iPhone, Safari; Samsung A33, Chrome). Testas i Node.
(function (root) {
    'use strict';

    var WEBKIT_RECORD = /\/NetworkCache\/Version \d+\/Records\/[^/]+\/(Resource|SubResources)\/[0-9A-F]{40}$/i;
    var WEBKIT_BLOB = /\/NetworkCache\/Version \d+\/Blobs\/([0-9A-F]{40})$/i;
    var CHROMIUM_ENTRY = /\/Cache_Data\/[0-9a-f]{16}_0$/i;
    // Appen som cachen hör till: behållaren på iOS (läses i dess metadata-plist), paketet på Android.
    var IOS_CONTAINER = /\/Containers\/Data\/Application\/([0-9A-F-]{36})\//i;
    var ANDROID_PACKAGE = /\/data\/(?:data|user\/\d+)\/([^/]+)\//;

    function kindOf(name) {
        var n = String(name);
        if (WEBKIT_RECORD.test(n)) return 'webkit';
        if (WEBKIT_BLOB.test(n)) return 'webkit-blob';
        if (CHROMIUM_ENTRY.test(n) && /\/data\/(?:data|user\/\d+)\//.test(n)) return 'chromium';
        return '';
    }
    // Appen för en fil i cachen: { platform, container } eller { platform, id }.
    function ownerOf(name) {
        var m = IOS_CONTAINER.exec(name);
        if (m) return { platform: 'iOS', container: m[1].toUpperCase() };
        m = ANDROID_PACKAGE.exec(name);
        return m ? { platform: 'Android', id: m[1] } : null;
    }

    function latin1(bytes, a, b) {
        var s = '';
        for (var i = a; i < b; i++) s += String.fromCharCode(bytes[i]);
        return s;
    }
    function hex(bytes, a, n) {
        var s = '';
        for (var i = 0; i < n; i++) s += (bytes[a + i] < 16 ? '0' : '') + bytes[a + i].toString(16);
        return s.toUpperCase();
    }
    function view(bytes) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }

    // ---------- WebKit ----------

    // WTF::Persistence: en sträng är längden (uint32, 0xFFFFFFFF = ingen), en byte för 8-bitarstext och tecknen.
    function readString(bytes, dv, at) {
        if (at + 4 > bytes.length) throw new Error('posten tar slut');
        var len = dv.getUint32(at, true);
        if (len === 0xffffffff) return { value: null, next: at + 4 };
        var is8 = bytes[at + 4] === 1, start = at + 5, end = start + (is8 ? len : len * 2);
        if (end > bytes.length) throw new Error('en sträng går utanför posten');
        var value = '';
        if (is8) value = latin1(bytes, start, end);
        else for (var i = start; i < end; i += 2) value += String.fromCharCode(dv.getUint16(i, true));
        return { value: value, next: end };
    }

    // Strängarna i svarets rubriker, i ordning (adressen, typen, HTTP-versionen och rubrikerna parvis).
    function strings(bytes, dv, a, b) {
        var out = [];
        for (var i = a; i + 5 <= b;) {
            var len = dv.getUint32(i, true), flag = bytes[i + 4];
            if (len > 0 && len < 16384 && (flag === 1) && i + 5 + len <= b) {
                var ok = true;
                for (var k = i + 5; k < i + 5 + len && ok; k++) if (bytes[k] < 9 || (bytes[k] > 13 && bytes[k] < 32)) ok = false;
                if (ok) { out.push(latin1(bytes, i + 5, i + 5 + len)); i += 5 + len; continue; }
            }
            i++;
        }
        return out;
    }

    // En post i WebKits NetworkCache: { url, partition, type, ms (då posten sparades), mime, status, headers, bodySize,
    // inline, bodyHash (SHA-1, namnet på filen i Blobs), body (innehållet när det ligger i posten) }.
    function parseWebKit(bytes) {
        var dv = view(bytes), at = 0;
        var version = dv.getUint32(0, true);
        if (version < 10 || version > 40) throw new Error('okänd version ' + version);
        at = 4;
        var partition = readString(bytes, dv, at); at = partition.next;
        var type = readString(bytes, dv, at); at = type.next;
        var ident = readString(bytes, dv, at); at = ident.next;
        var range = readString(bytes, dv, at); at = range.next;
        at += 40; // nyckelns och partitionens SHA-1
        var seconds = dv.getFloat64(at, true); at += 8;
        at += 20; // rubrikernas SHA-1
        var headerSize = Number(dv.getBigUint64 ? dv.getBigUint64(at, true) : dv.getUint32(at, true)); at += 8;
        var bodyHash = hex(bytes, at, 20); at += 20;
        var bodySize = Number(dv.getBigUint64 ? dv.getBigUint64(at, true) : dv.getUint32(at, true)); at += 8;
        var inline = bytes[at] === 1;
        var headEnd = bytes.length - (inline ? bodySize : 0), headStart = headEnd - headerSize;
        if (headStart < at || headerSize > bytes.length) throw new Error('rubrikerna ligger utanför posten');
        var list = strings(bytes, dv, headStart, headEnd);
        var http = list.findIndex(function (s) { return /^HTTP\/\d/.test(s); });
        var headers = {};
        if (http >= 0) for (var i = http + 1; i + 1 < list.length; i += 2) headers[list[i].toLowerCase()] = list[i + 1];
        var mime = list.slice(0, http >= 0 ? http : list.length).filter(function (s) { return /^[a-z]+\/[\w.+-]+$/i.test(s); })[0] || (headers['content-type'] || '').split(';')[0].trim();
        return {
            engine: 'webkit', version: version, partition: partition.value || '', type: type.value || '', url: ident.value || '', range: range.value,
            ms: isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null, mime: String(mime || '').toLowerCase(), status: http >= 0 ? list[http] : '',
            headers: headers, bodySize: bodySize, inline: inline, bodyHash: bodyHash, body: inline ? bytes.subarray(headEnd, bytes.length) : null,
        };
    }

    // ---------- Chromium ----------

    var SIMPLE_MAGIC = [0x30, 0x5c, 0x72, 0xa7, 0x1b, 0x6d, 0xfb, 0xfc];
    var EOF_MAGIC = [0xd8, 0x41, 0x0d, 0x97, 0x45, 0x6f, 0xfa, 0xf4];
    function magicAt(bytes, at, m) {
        if (at < 0 || at + 8 > bytes.length) return false;
        for (var i = 0; i < 8; i++) if (bytes[at + i] !== m[i]) return false;
        return true;
    }
    var WIN_EPOCH_US = 11644473600000000;
    // Chromium-tid: mikrosekunder sedan 1601.
    function chromeMs(dv, at) {
        if (at + 8 > dv.byteLength) return null;
        var us = Number(dv.getBigInt64 ? dv.getBigInt64(at, true) : 0);
        var ms = Math.round((us - WIN_EPOCH_US) / 1000);
        return ms > Date.UTC(2000, 0, 1) && ms < Date.UTC(2100, 0, 1) ? ms : null;
    }

    // En fil <hash>_0 i Chromiums cache: { url, ms (svaret kom), requestMs, status, headers, mime, encoding, body }.
    function parseChromium(bytes) {
        if (!magicAt(bytes, 0, SIMPLE_MAGIC)) throw new Error('inte Chromiums cache');
        var dv = view(bytes);
        // Huvudet: magin, versionen, nyckelns längd och hash och fyra byte utfyllnad; nyckeln börjar på 24.
        var keyLen = dv.getUint32(12, true), keyEnd = 24 + keyLen;
        if (keyEnd > bytes.length) throw new Error('nyckeln går utanför filen');
        var key = latin1(bytes, 24, keyEnd);
        // Nyckeln är "1/0/_dk_<plats> <ram> <adress>" i nyare versioner, annars bara adressen.
        var url = key.split(' ').pop().replace(/^\d+\/\d+\/(_dk_)?/, '');
        var eof0 = bytes.length - 24;
        if (!magicAt(bytes, eof0, EOF_MAGIC)) throw new Error('slutet saknas');
        var flags0 = dv.getUint32(eof0 + 8, true), size0 = dv.getUint32(eof0 + 16, true);
        var s0end = eof0 - ((flags0 & 2) ? 32 : 0), s0start = s0end - size0;
        var eof1 = s0start - 24;
        // Ström 1 (innehållet) går från nyckeln till sitt slut; storleken står bara i slutet för ström 0.
        var body = magicAt(bytes, eof1, EOF_MAGIC) && eof1 >= keyEnd ? bytes.subarray(keyEnd, eof1) : null;
        // Ström 0: HttpResponseInfo som en Pickle: storleken, flaggor, när frågan skickades och när svaret kom, och
        // rubrikerna som text med noll mellan raderna.
        var info = s0start >= 0 ? bytes.subarray(s0start, s0end) : new Uint8Array(0), idv = view(info);
        // Tiderna står först, efter ett eller två heltal beroende på version: de två första rimliga int64 på 4-bytesgräns.
        var times = [];
        for (var t = 4; t + 8 <= Math.min(info.length, 48) && times.length < 2; t += 4) {
            var v = chromeMs(idv, t);
            if (v !== null) { times.push(v); t += 4; }
        }
        var requestMs = times[0] || null, ms = times[1] || times[0] || null;
        var raw = '', start = -1;
        for (var i = 0; i + 5 < info.length; i++) if (info[i] === 0x48 && info[i + 1] === 0x54 && info[i + 2] === 0x54 && info[i + 3] === 0x50 && info[i + 4] === 0x2f) { start = i; break; }
        if (start >= 0) {
            var end = start;
            while (end + 1 < info.length && !(info[end] === 0 && info[end + 1] === 0)) end++;
            raw = latin1(info, start, end);
        }
        var lines = raw.split('\0').filter(Boolean), headers = {};
        lines.slice(1).forEach(function (l) { var c = l.indexOf(':'); if (c > 0) headers[l.slice(0, c).trim().toLowerCase()] = l.slice(c + 1).trim(); });
        return {
            engine: 'chromium', url: url, key: key, ms: ms, requestMs: requestMs, status: lines[0] || '', headers: headers,
            mime: String((headers['content-type'] || '').split(';')[0].trim()).toLowerCase(), encoding: String(headers['content-encoding'] || '').toLowerCase(),
            bodySize: body ? body.length : 0, inline: true, body: body,
        };
    }

    // ---------- Sidan ----------

    function charsetOf(headers, bytes) {
        var m = /charset=["']?([\w-]+)/i.exec(headers['content-type'] || '');
        if (m) return m[1];
        var head = latin1(bytes, 0, Math.min(bytes.length, 2048));
        m = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
        return m ? m[1] : 'utf-8';
    }
    function decodeText(bytes, headers) {
        var cs = charsetOf(headers || {}, bytes);
        try { return new TextDecoder(cs).decode(bytes); } catch (e) { return new TextDecoder('utf-8').decode(bytes); }
    }
    function isHtml(r) { return /^(text\/html|application\/xhtml\+xml)$/.test(r.mime) && !r.range; }

    // Adressen utan #, för att para ihop en sida med filerna den använder.
    function bare(url) { return String(url || '').replace(/#.*$/, ''); }
    function resolve(href, base) {
        try { return new URL(href, base).href; } catch (e) { return ''; }
    }

    // Sidan att visa i en ram utan skript och utan nätverk: skript, ramar, omdirigeringar och formulär tas bort, länkarna
    // går inte att följa (adressen står i title), och bilder och stilmallar som finns i cachen läggs in i sidan.
    // files(url) → { dataUrl } eller { text } för en fil i cachen, annars null. doc: ett dokument ur DOMParser.
    var CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; media-src data:";
    function safePage(doc, pageUrl, files) {
        var used = { images: 0, styles: 0, missing: 0 };
        ['script', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'portal', 'template'].forEach(function (t) {
            Array.prototype.slice.call(doc.getElementsByTagName(t)).forEach(function (n) { n.remove(); });
        });
        Array.prototype.slice.call(doc.querySelectorAll('meta[http-equiv]')).forEach(function (n) { n.remove(); });
        Array.prototype.slice.call(doc.querySelectorAll('link')).forEach(function (n) {
            var rel = String(n.getAttribute('rel') || '').toLowerCase();
            var href = resolve(n.getAttribute('href') || '', pageUrl);
            var hit = /stylesheet/.test(rel) && href ? files(href) : null;
            if (hit && hit.text != null) {
                var st = doc.createElement('style');
                st.textContent = hit.text;
                st.setAttribute('data-from', href);
                n.replaceWith(st);
                used.styles++;
            } else n.remove();
        });
        Array.prototype.slice.call(doc.querySelectorAll('*')).forEach(function (el) {
            Array.prototype.slice.call(el.attributes).forEach(function (a) {
                var name = a.name.toLowerCase();
                if (/^on/.test(name) || name === 'formaction' || name === 'ping' || name === 'srcdoc') el.removeAttribute(a.name);
                else if ((name === 'href' || name === 'xlink:href' || name === 'action') && el.tagName.toLowerCase() !== 'link') {
                    var to = resolve(a.value, pageUrl);
                    el.removeAttribute(a.name);
                    if (to && !el.title) el.title = to;
                }
            });
            var tag = el.tagName.toLowerCase();
            if (tag === 'img' || tag === 'input' || tag === 'source' || tag === 'video' || tag === 'audio' || tag === 'track' || tag === 'image') {
                var src = el.getAttribute('src') || el.getAttribute('data-src') || '';
                el.removeAttribute('srcset');
                el.removeAttribute('data-srcset');
                if (tag === 'video' || tag === 'audio') el.removeAttribute('poster');
                if (!src) return;
                var url = resolve(src, pageUrl), hit2 = url ? files(url) : null;
                if (hit2 && hit2.dataUrl) { el.setAttribute('src', hit2.dataUrl); used.images++; }
                else { el.removeAttribute('src'); if (tag === 'img') { el.setAttribute('data-missing', url); used.missing++; } }
            }
        });
        var head = doc.head || doc.documentElement;
        var meta = doc.createElement('meta');
        meta.setAttribute('http-equiv', 'Content-Security-Policy');
        meta.setAttribute('content', CSP);
        head.insertBefore(meta, head.firstChild);
        var style = doc.createElement('style');
        style.textContent = 'img[data-missing]{outline:1px dashed #999;min-width:24px;min-height:24px}';
        head.append(style);
        return { html: '<!doctype html>' + doc.documentElement.outerHTML, used: used };
    }

    function sizeText(n) {
        if (n == null) return '';
        if (n < 1024) return n + ' byte';
        if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0).replace('.', ',') + ' kB';
        return (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
    }

    var api = {
        kindOf: kindOf, ownerOf: ownerOf, parseWebKit: parseWebKit, parseChromium: parseChromium, decodeText: decodeText, isHtml: isHtml,
        bare: bare, resolve: resolve, safePage: safePage, sizeText: sizeText, CSP: CSP, WEBKIT_BLOB: WEBKIT_BLOB,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.WebCache = api;
})(typeof window !== 'undefined' ? window : this);
