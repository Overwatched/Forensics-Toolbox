/**
 * Parse XML plist or binary bplist00 to a JS value.
 * Offline, no dependencies.
 */
(function (root) {
    const MAGIC = [0x62, 0x70, 0x6c, 0x69, 0x73, 0x74]; // bplist

    function decodeUtf16Be(bytes) {
        const units = [];
        for (let i = 0; i < bytes.length; i += 2) {
            units.push((bytes[i] << 8) | bytes[i + 1]);
        }
        return String.fromCharCode.apply(null, units);
    }

    function readUInt(view, offset, size) {
        if (size === 1) return view.getUint8(offset);
        if (size === 2) return view.getUint16(offset);
        if (size === 4) return view.getUint32(offset);
        if (size === 8) {
            const hi = view.getUint32(offset);
            const lo = view.getUint32(offset + 4);
            return hi * 0x100000000 + lo;
        }
        throw new Error('Ogiltig heltalsstorlek i bplist: ' + size);
    }

    function parseBplist(buffer) {
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        if (bytes.length < 40) throw new Error('För kort för bplist');
        for (let i = 0; i < 6; i++) {
            if (bytes[i] !== MAGIC[i]) throw new Error('Inte bplist00');
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const trailer = bytes.length - 32;
        const offsetSize = view.getUint8(trailer + 6);
        const refSize = view.getUint8(trailer + 7);
        const numObjects = readUInt(view, trailer + 8, 8);
        const topObject = readUInt(view, trailer + 16, 8);
        const tableOffset = readUInt(view, trailer + 24, 8);

        function objectOffset(index) {
            return readUInt(view, tableOffset + index * offsetSize, offsetSize);
        }

        const cache = new Array(numObjects);

        function parseObject(index) {
            if (cache[index] !== undefined) return cache[index];
            const off = objectOffset(index);
            const marker = view.getUint8(off);
            const type = marker >> 4;
            let extra = marker & 0x0f;
            let pos = off + 1;

            function readLength() {
                if (extra !== 0x0f) return extra;
                const m = view.getUint8(pos);
                pos += 1;
                const size = 1 << (m & 0x0f);
                const len = readUInt(view, pos, size);
                pos += size;
                return len;
            }

            let value;
            if (type === 0x0) {
                if (extra === 0x00) value = null;
                else if (extra === 0x08) value = false;
                else if (extra === 0x09) value = true;
                else if (extra === 0x0f) value = null;
                else value = null;
            } else if (type === 0x1) {
                const size = 1 << extra;
                if (size <= 4) {
                    value = readUInt(view, pos, size);
                } else {
                    const hi = view.getUint32(pos);
                    const lo = view.getUint32(pos + 4);
                    value = hi * 0x100000000 + lo;
                }
            } else if (type === 0x2) {
                const size = 1 << extra;
                if (size === 4) value = view.getFloat32(pos);
                else if (size === 8) value = view.getFloat64(pos);
                else throw new Error('Okänd real-storlek');
            } else if (type === 0x3) {
                const abs = view.getFloat64(pos);
                value = new Date((abs + 978307200) * 1000).toISOString();
            } else if (type === 0x4) {
                const len = readLength();
                const slice = bytes.slice(pos, pos + len);
                let hex = '';
                for (let i = 0; i < slice.length; i++) {
                    hex += slice[i].toString(16).padStart(2, '0');
                }
                value = { _plistDataHex: hex };
            } else if (type === 0x5) {
                const len = readLength();
                const slice = bytes.slice(pos, pos + len);
                let s = '';
                for (let i = 0; i < slice.length; i++) s += String.fromCharCode(slice[i]);
                value = s;
            } else if (type === 0x6) {
                const len = readLength();
                value = decodeUtf16Be(bytes.slice(pos, pos + len * 2));
            } else if (type === 0x8) {
                const size = extra + 1;
                value = { _plistUid: readUInt(view, pos, size) };
            } else if (type === 0xa || type === 0xc) {
                const len = readLength();
                const arr = [];
                cache[index] = arr;
                for (let i = 0; i < len; i++) {
                    const ref = readUInt(view, pos + i * refSize, refSize);
                    arr.push(parseObject(ref));
                }
                return arr;
            } else if (type === 0xd) {
                const len = readLength();
                const obj = {};
                cache[index] = obj;
                for (let i = 0; i < len; i++) {
                    const keyRef = readUInt(view, pos + i * refSize, refSize);
                    const valRef = readUInt(view, pos + (len + i) * refSize, refSize);
                    obj[String(parseObject(keyRef))] = parseObject(valRef);
                }
                return obj;
            } else {
                throw new Error('Okänd bplist-typ 0x' + type.toString(16));
            }

            cache[index] = value;
            return value;
        }

        return parseObject(topObject);
    }

    function xmlText(el) {
        return (el.textContent || '').trim();
    }

    function parseXmlNode(node) {
        if (!node || node.nodeType !== 1) return null;
        const tag = node.tagName;
        if (tag === 'true') return true;
        if (tag === 'false') return false;
        if (tag === 'integer') return parseInt(xmlText(node), 10);
        if (tag === 'real') return parseFloat(xmlText(node));
        if (tag === 'string') return xmlText(node);
        if (tag === 'date') return xmlText(node);
        if (tag === 'data') return { _plistDataBase64: xmlText(node).replace(/\s+/g, '') };
        if (tag === 'array') {
            const out = [];
            for (let i = 0; i < node.children.length; i++) {
                out.push(parseXmlNode(node.children[i]));
            }
            return out;
        }
        if (tag === 'dict') {
            const out = {};
            const kids = node.children;
            for (let i = 0; i < kids.length; i += 2) {
                const keyEl = kids[i];
                const valEl = kids[i + 1];
                if (!keyEl || keyEl.tagName !== 'key' || !valEl) continue;
                out[xmlText(keyEl)] = parseXmlNode(valEl);
            }
            return out;
        }
        return null;
    }

    function parseXmlPlist(text) {
        const trimmed = String(text || '').replace(/^\uFEFF/, '').trim();
        const doc = new DOMParser().parseFromString(trimmed, 'application/xml');
        if (doc.querySelector('parsererror')) {
            throw new Error('Ogiltig XML-plist');
        }
        const plist = doc.querySelector('plist');
        const root = plist ? plist.children[0] : doc.documentElement;
        if (!root) throw new Error('Tom plist');
        return parseXmlNode(root);
    }

    function looksLikeBplist(bytes) {
        if (bytes.length < 8) return false;
        for (let i = 0; i < 6; i++) {
            if (bytes[i] !== MAGIC[i]) return false;
        }
        return true;
    }

    function parsePlist(input) {
        if (typeof input === 'string') {
            const trimmed = input.replace(/^\uFEFF/, '').trim();
            if (!trimmed) throw new Error('Tom plist');
            if (trimmed.charCodeAt(0) === 0x62 && trimmed.slice(0, 6) === 'bplist') {
                return parseBplist(new TextEncoder().encode(trimmed).buffer);
            }
            return parseXmlPlist(trimmed);
        }
        const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
        if (looksLikeBplist(bytes)) return parseBplist(bytes);
        const text = (typeof TextDecoder !== 'undefined')
            ? new TextDecoder('utf-8').decode(bytes)
            : Buffer.from(bytes).toString('utf8');
        return parseXmlPlist(text);
    }

    function isKeyedArchiver(value) {
        return value && typeof value === 'object' && !Array.isArray(value) &&
            (value.$archiver === 'NSKeyedArchiver' || Array.isArray(value.$objects));
    }

    root.parsePlist = parsePlist;
    root.parsePlistXml = parseXmlPlist;
    root.parsePlistBinary = parseBplist;
    root.isKeyedArchiver = isKeyedArchiver;
})(typeof window !== 'undefined' ? window : globalThis);
