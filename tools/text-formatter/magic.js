(function (root) {
    'use strict';

    var FORMATS = [
        { id: 'json', label: 'JSON' },
        { id: 'protobuf', label: 'Protobuf' },
        { id: 'base64', label: 'Base64' },
        { id: 'hex', label: 'Hex' },
        { id: 'url', label: 'URL-kodad' },
        { id: 'jwt', label: 'JWT' },
        { id: 'xml', label: 'XML' },
        { id: 'plist', label: 'Plist' },
        { id: 'gzip', label: 'gzip/zlib' },
        { id: 'time', label: 'Unix-tid' },
    ];

    var SAMPLES = [
        {
            id: 'json',
            label: 'JSON',
            input: '{"user":"anna","id":12}',
            note: 'Rå JSON → pretty-print',
        },
        {
            id: 'protobuf',
            label: 'Protobuf (hex)',
            input: '08 96 01',
            note: 'SQLite-blob som hex. Fält #1 = 150',
        },
        {
            id: 'sqlite',
            label: 'Protobuf (SQLite X\'…\')',
            input: "X'120774657374696e67'",
            note: "X-hex från DB Browser. Fält #2 = \"testing\"",
        },
        {
            id: 'base64',
            label: 'Base64 → JSON',
            input: 'eyJvayI6dHJ1ZX0=',
            note: 'Base64-lager runt JSON',
        },
        {
            id: 'jwt',
            label: 'JWT',
            input: 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjMiLCJuYW1lIjoiS2ltIiwiaWF0IjoxNzE0NTIxNjAwfQ.',
            note: 'Header + payload avkodas, signaturen rörs inte',
        },
        {
            id: 'url',
            label: 'URL-kodad',
            input: 'namn%3DKalle%20Svensson%26stad%3DG%C3%B6teborg',
            note: 'Percent-encoding från query/cookie',
        },
        {
            id: 'xml',
            label: 'XML',
            input: '<note><to>Kim</to><msg>hej</msg></note>',
            note: 'XML pretty-print',
        },
        {
            id: 'plist',
            label: 'Plist (XML)',
            input: '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Name</key><string>Kim</string><key>Enabled</key><true/></dict></plist>',
            note: 'XML-plist → JSON. Binär bplist00 går också',
        },
        {
            id: 'hex',
            label: 'Hex-sträng',
            input: '48 65 6a 20 4b 69 6d',
            note: 'Hex → UTF-8-text "Hej Kim"',
        },
        {
            id: 'gzip',
            label: 'gzip → JSON',
            input: '1f8b0800000000000003ab56aaca2c50b22a292a4dad0500037ca5190c000000',
            note: 'gzip-blob som hex, inuti JSON',
        },
        {
            id: 'time',
            label: 'Unix-tid',
            input: '1714521600',
            note: '10 siffror → UTC-tid. Full matris finns i Time Converter',
        },
    ];

    SAMPLES.unshift({
        id: 'all',
        label: 'Alla format',
        input: SAMPLES.filter(function (s) { return s.id !== 'sqlite'; })
            .map(function (s) { return s.input; })
            .join('\n\n'),
        note: 'Ett stycke per format, tom rad emellan',
    });

    function latin1Bytes(text) {
        var out = new Uint8Array(text.length);
        for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
        return out;
    }

    function bytesToUtf8(bytes) {
        try {
            var text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            var ok = 0;
            for (var i = 0; i < text.length; i++) {
                var c = text.charCodeAt(i);
                if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)) ok++;
            }
            if (text.length && ok / text.length < 0.85) return null;
            return text;
        } catch (e) {
            return null;
        }
    }

    function looksLikeJson(text) {
        var t = String(text || '').trim();
        if (!t) return null;
        var first = t[0];
        if (first !== '{' && first !== '[') return null;
        try {
            return JSON.parse(t);
        } catch (e) {
            return null;
        }
    }

    function prettyJson(value) {
        return JSON.stringify(value, null, 2);
    }

    function b64urlJson(part) {
        var pad = part + '==='.slice((part.length + 3) % 4);
        var bin = atob(pad.replace(/-/g, '+').replace(/_/g, '/'));
        return JSON.parse(bin);
    }

    function prettyXml(xml) {
        var t = String(xml).trim().replace(/>\s+</g, '><');
        var out = '';
        var indent = 0;
        t.replace(/<\/?[^>]+>|[^<]+/g, function (token) {
            if (token.charAt(0) === '<') {
                if (token.charAt(1) === '/') indent = Math.max(0, indent - 1);
                out += (out ? '\n' : '') + '  '.repeat(indent) + token;
                if (!/^<\//.test(token) && !/\/>$/.test(token) && !/^<\?/.test(token) && !/^<!/.test(token)) indent++;
            } else if (token.trim()) {
                out += token;
            }
            return token;
        });
        return out;
    }

    function unixLabel(seconds) {
        var d = new Date(seconds * 1000);
        if (isNaN(d.getTime())) return null;
        var utc = d.toISOString().replace('.000Z', ' UTC').replace('T', ' ');
        return utc;
    }

    function hit(id, score, why, text, extra) {
        extra = extra || {};
        var meta = FORMATS.find(function (f) { return f.id === id; });
        return {
            id: id,
            title: meta ? meta.label : id,
            score: score,
            confidence: score >= 85 ? 'hög' : score >= 70 ? 'trolig' : 'möjlig',
            why: why,
            text: text,
            open: extra.open || null,
        };
    }

    function detectJson(text) {
        var value = looksLikeJson(text);
        if (!value) return null;
        return hit('json', 92, 'Giltig JSON.', prettyJson(value), { open: 'json' });
    }

    function detectJwt(text) {
        var t = String(text || '').trim();
        var parts = t.split('.');
        if (parts.length !== 3) return null;
        if (!/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
        try {
            var header = b64urlJson(parts[0]);
            var payload = b64urlJson(parts[1]);
            var body = prettyJson({ header: header, payload: payload, signature: parts[2] ? '(finns, avkodas inte)' : '(tom)' });
            return hit('jwt', 96, 'Tre Base64url-delar. Header och payload är JSON.', body);
        } catch (e) {
            return null;
        }
    }

    function detectXml(text) {
        var t = String(text || '').trim();
        if (t.charAt(0) !== '<' || t.indexOf('>') === -1) return null;
        if (/^<!DOCTYPE html/i.test(t) || /^<html/i.test(t)) return null;
        if (/<plist\b/i.test(t)) return null;
        var pretty = prettyXml(t);
        return hit('xml', 78, 'XML-struktur.', pretty);
    }

    function looksLikeBplistBytes(bytes) {
        return bytes && bytes.length >= 8 &&
            bytes[0] === 0x62 && bytes[1] === 0x70 && bytes[2] === 0x6c &&
            bytes[3] === 0x69 && bytes[4] === 0x73 && bytes[5] === 0x74;
    }

    function detectPlist(text) {
        var parse = root.parsePlist;
        if (typeof parse !== 'function') return null;
        var t = String(text || '').trim();
        var xmlPlist = /<plist\b/i.test(t);
        var asciiBin = t.slice(0, 6) === 'bplist';
        var bytes = null;
        if (!xmlPlist && !asciiBin) {
            var pb = root.ProtobufViewer;
            if (pb && typeof pb.extractHex === 'function') {
                var hex = pb.extractHex(t);
                if (hex && hex.length >= 16) {
                    bytes = new Uint8Array(hex.length / 2);
                    for (var i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
                    if (!looksLikeBplistBytes(bytes)) bytes = null;
                }
            }
        }
        if (!xmlPlist && !asciiBin && !bytes) return null;
        try {
            var value = bytes ? parse(bytes) : parse(t);
            var keyed = root.isKeyedArchiver && root.isKeyedArchiver(value)
                ? ' NSKeyedArchiver — titta i $objects.'
                : '';
            var why = (asciiBin || bytes)
                ? 'Binär bplist00 → JSON.' + keyed
                : 'XML-plist → JSON.' + keyed;
            return hit('plist', 91, why, prettyJson(value), { open: 'plist' });
        } catch (e) {
            return null;
        }
    }

    function detectUrl(text) {
        var t = String(text || '').trim();
        if (!/%[0-9A-Fa-f]{2}/.test(t)) return null;
        try {
            var decoded = decodeURIComponent(t.replace(/\+/g, '%20'));
            if (decoded === t) return null;
            return hit('url', 82, 'Percent-encoding.', decoded);
        } catch (e) {
            return null;
        }
    }

    function detectTime(text) {
        var t = String(text || '').trim();
        if (!/^\d{10,16}$/.test(t)) return null;
        var n = Number(t);
        var seconds;
        var unit;
        if (t.length === 10 && n >= 1e9 && n < 2.2e9) { seconds = n; unit = 's'; }
        else if (t.length === 13 && n >= 1e12) { seconds = n / 1000; unit = 'ms'; }
        else if (t.length === 16) { seconds = n / 1e6; unit = 'µs'; }
        else return null;
        var utc = unixLabel(seconds);
        if (!utc) return null;
        return hit('time', 74, 'Heltal som unix-' + unit + '. Full matris i Time Converter.', utc + '\nunix ' + unit + ' = ' + t);
    }

    function detectBase64(text) {
        var t = String(text || '').trim().replace(/\s+/g, '');
        if (t.indexOf('.') !== -1) return null;
        if (/^\d+$/.test(t)) return null;
        var pb = root.ProtobufViewer;
        var decoded = null;
        if (t.length < 8 || t.length % 4 === 1) return null;
        if (!/^[A-Za-z0-9+/_-]+=*$/.test(t)) return null;
        try {
            var bin = atob(t.replace(/-/g, '+').replace(/_/g, '/'));
            decoded = latin1Bytes(bin);
        } catch (e) {
            return null;
        }
        if (!decoded || decoded.length < 3) return null;
        var utf = bytesToUtf8(decoded);
        var innerJson = utf && looksLikeJson(utf);
        var body = innerJson ? prettyJson(innerJson) : (utf || (pb ? pb.hexBytes(decoded) : ''));
        var why = innerJson ? 'Base64, innehållet är JSON.' : utf ? 'Base64 → UTF-8.' : 'Base64 → bytes.';
        return hit('base64', innerJson ? 88 : utf ? 72 : 58, why, body, { open: innerJson ? 'json' : null });
    }

    function detectHex(text) {
        var pb = root.ProtobufViewer;
        if (!pb || typeof pb.extractHex !== 'function') return null;
        var hex = pb.extractHex(text);
        if (!hex || hex.length < 4) return null;
        if (/^\d+$/.test(String(text).trim())) return null;
        var compact = String(text).replace(/\s+/g, '');
        if (compact.length > 4 && !/^[0-9a-fA-FxX\\' :,._-]+$/.test(compact) && !/^X'/i.test(String(text).trim())) {
            return null;
        }
        var bytes = [];
        for (var i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
        var arr = new Uint8Array(bytes);
        var utf = bytesToUtf8(arr);
        var innerJson = utf && looksLikeJson(utf);
        var body = innerJson ? prettyJson(innerJson) : (utf || pb.hexBytes(arr));
        var why = innerJson ? 'Hex, innehållet är JSON.' : utf ? 'Hex → UTF-8.' : 'Hex-bytes.';
        return hit('hex', innerJson ? 86 : utf ? 70 : 56, why, body, { open: innerJson ? 'json' : null });
    }

    function detectProtobuf(text) {
        var pb = root.ProtobufViewer;
        if (!pb) return null;
        try {
            var result = pb.parseInputText(text);
            if (!result || !result.fields || !result.fields.length) return null;
            var score = Math.min(90, 55 + result.fields.length * 8);
            return hit('protobuf', score, 'Protobuf wire-format (' + result.inputKind + ', ' + result.bytes + ' B).', result.text + '\n\n' + prettyJson(result.json), { open: 'protobuf' });
        } catch (e) {
            return null;
        }
    }

    function candidateBytes(text) {
        var list = [];
        var pb = root.ProtobufViewer;
        if (pb && pb.extractHex) {
            var hex = pb.extractHex(text);
            if (hex) {
                var bytes = new Uint8Array(hex.length / 2);
                for (var i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
                list.push(bytes);
            }
        }
        try {
            var t = String(text || '').trim().replace(/\s+/g, '');
            if (t.length >= 8 && /^[A-Za-z0-9+/_-]+=*$/.test(t)) {
                var bin = atob(t.replace(/-/g, '+').replace(/_/g, '/'));
                list.push(latin1Bytes(bin));
            }
        } catch (e) { /* ignore */ }
        list.push(latin1Bytes(String(text)));
        return list;
    }

    function inflate(bytes, format) {
        if (typeof DecompressionStream === 'function') {
            return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)))
                .arrayBuffer()
                .then(function (buf) { return new Uint8Array(buf); });
        }
        var zlib = require('zlib');
        var buf = Buffer.from(bytes);
        if (format === 'gzip') return Promise.resolve(new Uint8Array(zlib.gunzipSync(buf)));
        return Promise.resolve(new Uint8Array(zlib.inflateSync(buf)));
    }

    function detectGzip(text) {
        var cands = candidateBytes(text);
        var chain = Promise.resolve(null);
        cands.forEach(function (bytes) {
            chain = chain.then(function (found) {
                if (found) return found;
                if (!bytes || bytes.length < 4) return null;
                var isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
                var isZlib = bytes[0] === 0x78 && (bytes[1] === 0x01 || bytes[1] === 0x9c || bytes[1] === 0xda);
                if (!isGzip && !isZlib) return null;
                return inflate(bytes, isGzip ? 'gzip' : 'deflate').then(function (out) {
                    var utf = bytesToUtf8(out);
                    var innerJson = utf && looksLikeJson(utf);
                    var body = innerJson ? prettyJson(innerJson) : (utf || (root.ProtobufViewer ? root.ProtobufViewer.hexBytes(out) : ''));
                    var why = (isGzip ? 'gzip' : 'zlib') + (innerJson ? ', innehållet är JSON.' : utf ? ' → UTF-8.' : ' → bytes.');
                    return hit('gzip', innerJson ? 90 : 80, why, body, { open: innerJson ? 'json' : null });
                }).catch(function () { return null; });
            });
        });
        return chain;
    }

    function enabledSet(ids) {
        if (ids == null) {
            var all = {};
            FORMATS.forEach(function (f) { all[f.id] = true; });
            return all;
        }
        var set = {};
        ids.forEach(function (id) { set[id] = true; });
        return set;
    }

    function splitChunks(text) {
        var raw = String(text || '').replace(/^\uFEFF/, '');
        if (!raw.trim()) return [];
        var blank = raw.split(/\n[ \t]*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        if (blank.length > 1) return blank;
        var trimmed = raw.trim();
        var first = trimmed.charAt(0);
        if (first === '{' || first === '[' || first === '<' || trimmed.slice(0, 6) === 'bplist') {
            return [trimmed];
        }
        var lines = trimmed.split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        return lines.length > 1 ? lines : [trimmed];
    }

    function runMagicOne(text, ids) {
        var enabled = enabledSet(ids);
        var forced = ids && ids.length && ids.length < FORMATS.length;
        var tasks = [];

        function maybe(id, fn) {
            if (!enabled[id]) return;
            tasks.push(Promise.resolve().then(function () { return fn(text); }).catch(function () { return null; }));
        }

        maybe('json', detectJson);
        maybe('jwt', detectJwt);
        maybe('plist', detectPlist);
        maybe('xml', detectXml);
        maybe('url', detectUrl);
        maybe('time', detectTime);
        maybe('base64', detectBase64);
        maybe('hex', detectHex);
        maybe('protobuf', detectProtobuf);
        maybe('gzip', detectGzip);

        return Promise.all(tasks).then(function (rows) {
            var hits = rows.filter(Boolean);
            hits.sort(function (a, b) { return b.score - a.score; });
            if (!forced) hits = hits.filter(function (h) { return h.score >= 55; });
            var seen = {};
            hits = hits.filter(function (h) {
                if (seen[h.id]) return false;
                seen[h.id] = true;
                return true;
            });
            return hits;
        });
    }

    function runMagic(text, ids) {
        var chunks = splitChunks(text);
        if (!chunks.length) return Promise.resolve([]);
        if (chunks.length === 1) return runMagicOne(chunks[0], ids);

        var chain = Promise.resolve([]);
        chunks.forEach(function (chunk, i) {
            chain = chain.then(function (all) {
                return runMagicOne(chunk, ids).then(function (hits) {
                    hits.forEach(function (h) {
                        h.chunk = i + 1;
                        h.why = 'Stycke ' + (i + 1) + ': ' + h.why;
                    });
                    return all.concat(hits);
                });
            });
        });
        return chain;
    }

    var api = {
        FORMATS: FORMATS,
        SAMPLES: SAMPLES,
        splitChunks: splitChunks,
        runMagic: runMagic,
        detectJson: detectJson,
        detectJwt: detectJwt,
        detectXml: detectXml,
        detectPlist: detectPlist,
        detectUrl: detectUrl,
        detectTime: detectTime,
        detectBase64: detectBase64,
        detectHex: detectHex,
        detectProtobuf: detectProtobuf,
    };

    root.TextMagic = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
