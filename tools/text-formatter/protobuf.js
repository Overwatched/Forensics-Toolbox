(function (root) {
    'use strict';

    var MAX_BYTES = 5 * 1024 * 1024;
    var MAX_DEPTH = 8;
    var MAX_FIELD = 536870911;

    function readVarint(bytes, pos) {
        var value = 0n;
        var shift = 0n;
        while (pos < bytes.length) {
            var b = bytes[pos++];
            value |= BigInt(b & 0x7f) << shift;
            if ((b & 0x80) === 0) return { value: value, pos: pos };
            shift += 7n;
            if (shift > 70n) throw new Error('Ogiltig varint');
        }
        throw new Error('Ofullständig varint');
    }

    function jsonInt(value) {
        if (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= 0n) return Number(value);
        return value.toString();
    }

    function hexBytes(bytes) {
        var out = '';
        for (var i = 0; i < bytes.length; i++) {
            if (i) out += ' ';
            out += bytes[i].toString(16).padStart(2, '0');
        }
        return out;
    }

    function decodeUtf8(bytes) {
        try {
            var text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            if (text.length === 0) return { ok: true, text: '' };
            var printable = 0;
            for (var i = 0; i < text.length; i++) {
                var c = text.charCodeAt(i);
                if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)) printable++;
            }
            if (printable / text.length < 0.85) return { ok: false };
            return { ok: true, text: text };
        } catch (e) {
            return { ok: false };
        }
    }

    function readExact(bytes, pos, size) {
        if (pos + size > bytes.length) throw new Error('Ofullständigt fält');
        return { slice: bytes.subarray(pos, pos + size), pos: pos + size };
    }

    function float32(bytes) {
        return new DataView(bytes.buffer, bytes.byteOffset, 4).getFloat32(0, true);
    }

    function float64(bytes) {
        return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
    }

    function uint32(bytes) {
        return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
    }

    function uint64(bytes) {
        return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true);
    }

    function packedVarints(bytes) {
        var pos = 0;
        var values = [];
        try {
            while (pos < bytes.length) {
                var v = readVarint(bytes, pos);
                values.push(jsonInt(v.value));
                pos = v.pos;
            }
            return pos === bytes.length && values.length > 1 ? values : null;
        } catch (e) {
            return null;
        }
    }

    function decodeMessage(bytes, start, end, depth) {
        if (depth > MAX_DEPTH) throw new Error('För djupt nästlat meddelande');
        var pos = start;
        var fields = [];
        while (pos < end) {
            var tag = readVarint(bytes, pos);
            pos = tag.pos;
            var field = Number(tag.value >> 3n);
            var wire = Number(tag.value & 7n);
            if (field < 1 || field > MAX_FIELD) throw new Error('Ogiltigt fältnummer ' + field);
            var item = { field: field, wire: wire };
            if (wire === 0) {
                var vr = readVarint(bytes, pos);
                pos = vr.pos;
                item.kind = 'varint';
                item.value = jsonInt(vr.value);
            } else if (wire === 1) {
                var f64 = readExact(bytes, pos, 8);
                pos = f64.pos;
                item.kind = 'fixed64';
                item.hex = hexBytes(f64.slice);
                item.value = jsonInt(uint64(f64.slice));
                item.float = float64(f64.slice);
            } else if (wire === 5) {
                var f32 = readExact(bytes, pos, 4);
                pos = f32.pos;
                item.kind = 'fixed32';
                item.hex = hexBytes(f32.slice);
                item.value = uint32(f32.slice);
                item.float = float32(f32.slice);
            } else if (wire === 2) {
                var lr = readVarint(bytes, pos);
                pos = lr.pos;
                var payload = readExact(bytes, pos, Number(lr.value));
                pos = payload.pos;
                var inner = payload.slice;
                var asText = decodeUtf8(inner);
                var asMsg = null;
                if (inner.length > 0 && depth < MAX_DEPTH) {
                    try {
                        asMsg = decodeMessage(inner, 0, inner.length, depth + 1);
                    } catch (e) {
                        asMsg = null;
                    }
                }
                if (asMsg && asMsg.fields.length && (!asText.ok || inner.length >= 2 && asMsg.score >= 2)) {
                    item.kind = 'message';
                    item.fields = asMsg.fields;
                } else if (asText.ok) {
                    item.kind = 'string';
                    item.value = asText.text;
                } else {
                    var packed = packedVarints(inner);
                    if (packed) {
                        item.kind = 'packed';
                        item.value = packed;
                    } else {
                        item.kind = 'bytes';
                        item.len = inner.length;
                        item.hex = hexBytes(inner);
                    }
                }
            } else if (wire === 3 || wire === 4) {
                throw new Error('Grupp-wire (3/4) stöds inte');
            } else {
                throw new Error('Okänd wire-typ ' + wire);
            }
            fields.push(item);
        }
        if (pos !== end) throw new Error('Ofullständigt meddelande');
        return { fields: fields, score: fields.length };
    }

    function tryLengthPrefix(bytes) {
        if (bytes.length < 2) return null;
        try {
            var vr = readVarint(bytes, 0);
            var remaining = bytes.length - vr.pos;
            if (vr.value === BigInt(remaining) && remaining > 0) {
                return decodeMessage(bytes, vr.pos, bytes.length, 0);
            }
        } catch (e) { /* prova LE-längd */ }
        if (bytes.length >= 5) {
            var len = uint32(bytes.subarray(0, 4));
            if (len === bytes.length - 4 && len > 0) {
                try {
                    return decodeMessage(bytes, 4, bytes.length, 0);
                } catch (e) {
                    return null;
                }
            }
        }
        return null;
    }

    function fieldsToJson(fields) {
        var obj = {};
        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            var key = String(f.field);
            var value;
            if (f.kind === 'message') value = fieldsToJson(f.fields);
            else if (f.kind === 'bytes') value = { _bytes: f.hex.replace(/ /g, ''), _len: f.len };
            else if (f.kind === 'fixed32' || f.kind === 'fixed64') value = { _fixed: f.kind, value: f.value, hex: f.hex, float: f.float };
            else value = f.value;
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                if (!Array.isArray(obj[key])) obj[key] = [obj[key]];
                obj[key].push(value);
            } else {
                obj[key] = value;
            }
        }
        return obj;
    }

    function fieldsToText(fields, indent) {
        indent = indent || '';
        var lines = [];
        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            var head = indent + '#' + f.field + ' ' + f.kind;
            if (f.kind === 'message') {
                lines.push(head);
                lines.push(fieldsToText(f.fields, indent + '  '));
            } else if (f.kind === 'string') {
                lines.push(head + ' = ' + JSON.stringify(f.value));
            } else if (f.kind === 'bytes') {
                var preview = f.hex.length > 96 ? f.hex.slice(0, 96) + ' …' : f.hex;
                lines.push(head + ' (' + f.len + ' B) = ' + preview);
            } else if (f.kind === 'packed') {
                lines.push(head + ' = ' + f.value.join(', '));
            } else if (f.kind === 'fixed32' || f.kind === 'fixed64') {
                lines.push(head + ' = ' + f.value + '  hex ' + f.hex);
            } else {
                lines.push(head + ' = ' + f.value);
            }
        }
        return lines.join('\n');
    }

    function decodeBytes(bytes) {
        if (!bytes || !bytes.length) throw new Error('Tom indata');
        if (bytes.length > MAX_BYTES) throw new Error('För stor blob (max 5 MiB)');
        var decoded;
        var prefix = false;
        try {
            decoded = decodeMessage(bytes, 0, bytes.length, 0);
        } catch (e) {
            decoded = tryLengthPrefix(bytes);
            prefix = !!decoded;
            if (!decoded) throw e;
        }
        if (!decoded.fields.length) throw new Error('Inga protobuf-fält');
        return {
            fields: decoded.fields,
            json: fieldsToJson(decoded.fields),
            text: fieldsToText(decoded.fields, ''),
            lengthPrefixed: prefix,
            bytes: bytes.length,
        };
    }

    function hexToBytes(hex) {
        var out = new Uint8Array(hex.length / 2);
        for (var i = 0; i < out.length; i++) {
            out[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return out;
    }

    function extractHex(text) {
        var t = String(text || '').trim();
        if (!t) return null;
        var sqlite = t.match(/^X'([0-9a-fA-F]+)'$/i);
        if (sqlite) return sqlite[1].toLowerCase();
        var compact = t.replace(/\s+/g, '');
        if (/^(?:\\x[0-9a-fA-F]{2})+$/i.test(compact)) {
            return compact.replace(/\\x/gi, '').toLowerCase();
        }
        var stripped = compact.replace(/^0x/i, '').replace(/[:,_-]/g, '');
        if (stripped.length >= 2 && stripped.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(stripped)) {
            return stripped.toLowerCase();
        }
        return null;
    }

    function tryBase64(text) {
        var t = String(text || '').trim().replace(/\s+/g, '');
        if (t.length < 4 || t.length % 4 === 1) return null;
        if (!/^[A-Za-z0-9+/_-]+=*$/.test(t)) return null;
        try {
            var bin = atob(t.replace(/-/g, '+').replace(/_/g, '/'));
            var out = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            return out;
        } catch (e) {
            return null;
        }
    }

    function latin1Bytes(text) {
        var out = new Uint8Array(text.length);
        for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
        return out;
    }

    function scoreDecode(result) {
        return result && result.fields ? result.fields.length : 0;
    }

    function parseInputText(text) {
        var attempts = [];
        var hex = extractHex(text);
        if (hex) attempts.push({ kind: 'hex', bytes: hexToBytes(hex) });
        var b64 = tryBase64(text);
        if (b64) attempts.push({ kind: 'base64', bytes: b64 });
        attempts.push({ kind: 'raw', bytes: latin1Bytes(String(text)) });

        var best = null;
        var lastError = null;
        for (var i = 0; i < attempts.length; i++) {
            try {
                var decoded = decodeBytes(attempts[i].bytes);
                decoded.inputKind = attempts[i].kind;
                if (!best || scoreDecode(decoded) > scoreDecode(best)) best = decoded;
            } catch (e) {
                lastError = e;
            }
        }
        if (best) return best;
        throw lastError || new Error('Kunde inte tolka indata som protobuf');
    }

    var api = {
        decodeBytes: decodeBytes,
        parseInputText: parseInputText,
        extractHex: extractHex,
        hexBytes: hexBytes,
    };

    root.ProtobufViewer = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
