// Bygger en nyckelring med krypterade poster i samma form som en riktig: en XML-plist med keychainEntries, där
// metadata och värde är krypterade med AES-256-GCM och delarna ligger i NSKeyedArchiver-plistar. Innehållet är DER.
// Används av app-secrets.test.js, extraction-core.test.js och röktestet. Ingår inte i bygget. Alla nycklar är slumpade.

const crypto = require('node:crypto');

class Uid { constructor(value) { this.value = value; } }

function intBytes(n) {
    if (n < 256) return Buffer.from([0x10, n]);
    if (n < 65536) return Buffer.from([0x11, n >> 8, n & 255]);
    const b = Buffer.alloc(5);
    b[0] = 0x12;
    b.writeUInt32BE(n, 1);
    return b;
}

function head(kind, count) { return count < 15 ? Buffer.from([kind | count]) : Buffer.concat([Buffer.from([kind | 15]), intBytes(count)]); }

// En binär plist med dict, lista, text, data, heltal och Uid.
function bplist(root) {
    const parts = [];
    function add(v) {
        const at = parts.length;
        parts.push(null);
        if (v instanceof Uid) parts[at] = Buffer.from([0x80, v.value]);
        else if (Buffer.isBuffer(v) || v instanceof Uint8Array) parts[at] = Buffer.concat([head(0x40, v.length), Buffer.from(v)]);
        else if (typeof v === 'string') parts[at] = Buffer.concat([head(0x50, v.length), Buffer.from(v, 'ascii')]);
        else if (typeof v === 'number') parts[at] = intBytes(v);
        else if (Array.isArray(v)) { const refs = v.map(add); parts[at] = Buffer.concat([head(0xa0, v.length), Buffer.from(refs)]); }
        else {
            const keys = Object.keys(v);
            const keyRefs = keys.map(add);
            const valRefs = keys.map((k) => add(v[k]));
            parts[at] = Buffer.concat([head(0xd0, keys.length), Buffer.from(keyRefs), Buffer.from(valRefs)]);
        }
        return at;
    }
    add(root);
    let off = 8;
    const offsets = Buffer.alloc(parts.length * 2);
    parts.forEach((p, i) => { offsets.writeUInt16BE(off, i * 2); off += p.length; });
    const trailer = Buffer.alloc(32);
    trailer[6] = 2;
    trailer[7] = 1;
    trailer.writeBigUInt64BE(BigInt(parts.length), 8);
    trailer.writeBigUInt64BE(BigInt(off), 24);
    return Buffer.concat([Buffer.from('bplist00', 'ascii')].concat(parts, [offsets, trailer]));
}

// AES-256-GCM med ett IV på 32 byte, inpackat som _SFAuthenticatedCiphertext.
function seal(key, plain, tamperTag) {
    const iv = crypto.randomBytes(32);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([c.update(plain), c.final()]);
    const tag = c.getAuthTag();
    if (tamperTag) tag[0] ^= 1;
    return bplist({
        $version: 100000, $archiver: 'NSKeyedArchiver', $top: { root: new Uid(1) },
        $objects: ['$null', { $class: new Uid(5), SFInitializationVector: new Uid(2), SFCiphertext: new Uid(3), SFAuthenticationCode: new Uid(4) }, iv, data, tag,
            { $classname: '_SFAuthenticatedCiphertext', $classes: ['_SFAuthenticatedCiphertext', 'NSObject'] }],
    });
}

function derLen(n) { return n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]); }
function der(tag, body) { return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]); }

// Posten som DER, som irestore och Apple: SET av SEQUENCE { nyckel, värde }.
function record(fields) {
    return der(0x31, Buffer.concat(Object.keys(fields).map((k) => {
        const v = fields[k];
        const value = Buffer.isBuffer(v) ? der(0x04, v) : der(0x0c, Buffer.from(String(v), 'utf8'));
        return der(0x30, Buffer.concat([der(0x0c, Buffer.from(k, 'utf8')), value]));
    })));
}

function b64(b) { return Buffer.from(b).toString('base64'); }
function xmlText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function plistData(key, b) { return '<key>' + key + '</key><data>' + b64(b) + '</data>'; }

// items: [{ table, svce, acct, agrp, value, damage }]. damage: 'metadata' eller 'data' (fel kontrollsumma),
// 'tamper' eller 'tamper-meta' (TamperCheck stämmer inte i värdet eller i metadatan) eller 'classkey' (klassnyckeln saknas).
function encryptedKeychain(items) {
    const classKeys = { 7: crypto.randomBytes(32), 11: crypto.randomBytes(32) };
    const entries = items.map((it, i) => {
        const classIdx = it.damage === 'classkey' ? 99 : i % 2 ? 7 : 11;
        const check = crypto.randomUUID();
        const metaKey = crypto.randomBytes(32);
        const itemKey = crypto.randomBytes(32);
        const attrs = record({ svce: it.svce, acct: it.acct, agrp: it.agrp || '', pdmn: 'ck', TamperCheck: it.damage === 'tamper-meta' ? crypto.randomUUID() : check });
        const secret = record({ v_Data: Buffer.from(it.value), TamperCheck: it.damage === 'tamper' ? crypto.randomUUID() : check });
        return '<dict><key>classKeyIdx</key><integer>' + classIdx + '</integer><key>rowID</key><integer>' + (i + 1) + '</integer><key>table</key><string>' + xmlText(it.table || 'genp') + '</string><key>version</key><integer>8</integer>' +
            '<key>data</key><dict>' + plistData('ciphertext', seal(itemKey, secret, it.damage === 'data')) + '<key>tamperCheck</key><string>' + check + '</string>' + plistData('unwrappedKey', itemKey) + '</dict>' +
            '<key>metadata</key><dict>' + plistData('ciphertext', seal(metaKey, attrs, it.damage === 'metadata')) + '<key>tamperCheck</key><string>' + check + '</string>' + plistData('wrappedKey', seal(classKeys[classIdx === 99 ? 7 : classIdx], metaKey)) + '</dict></dict>';
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>classKeyIdxToUnwrappedMetadataClassKey</key><dict>' +
        Object.keys(classKeys).map((k) => plistData(k, classKeys[k])).join('') +
        '</dict><key>keychainEntries</key><array>' + entries.join('') + '</array></dict></plist>\n';
}

module.exports = { encryptedKeychain };
