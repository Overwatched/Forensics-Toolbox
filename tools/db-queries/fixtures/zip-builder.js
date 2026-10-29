// Bygger zippar i tester: lagrade och deflate-poster, unixtid och Zip64. Används av
// zip.test.js och extraction-core.test.js. Ingår inte i bygget.

const zlib = require('node:zlib');
const zip = require('../zip');

// files: [{ name, data, deflate, mtime }]. zip64: alla storlekar och offset i Zip64-fält,
// och slutet med Zip64-post och locator, som de stora extraktionerna har.
function buildZip(files, opts) {
    opts = opts || {};
    const parts = [];
    const central = [];
    let offset = opts.lead ? opts.lead.length : 0;
    if (opts.lead) parts.push(opts.lead);
    for (const f of files) {
        const data = Buffer.from(f.data);
        const body = f.deflate ? zlib.deflateRawSync(data) : data;
        const name = Buffer.from(f.name, 'utf8');
        const crc = zip.crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(45, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(f.deflate ? 8 : 0, 8);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        // Ett extrafält i den lokala posten som inte finns i innehållsförteckningen: datan
        // måste räknas från den lokala postens längder.
        const localExtra = Buffer.from([0x99, 0x99, 4, 0, 1, 2, 3, 4]);
        local.writeUInt16LE(localExtra.length, 28);
        parts.push(local, name, localExtra, body);

        const extras = [];
        if (opts.zip64) {
            const z = Buffer.alloc(4 + 24);
            z.writeUInt16LE(0x0001, 0);
            z.writeUInt16LE(24, 2);
            z.writeBigUInt64LE(BigInt(data.length), 4);
            z.writeBigUInt64LE(BigInt(body.length), 12);
            z.writeBigUInt64LE(BigInt(offset), 20);
            extras.push(z);
        }
        if (f.mtime) {
            const ut = Buffer.alloc(9);
            ut.writeUInt16LE(0x5455, 0);
            ut.writeUInt16LE(5, 2);
            ut[4] = 1;
            ut.writeUInt32LE(f.mtime, 5);
            extras.push(ut);
        }
        const extra = Buffer.concat(extras);
        const c = Buffer.alloc(46);
        c.writeUInt32LE(0x02014b50, 0);
        c.writeUInt16LE(0x0800, 8);
        c.writeUInt16LE(f.deflate ? 8 : 0, 10);
        c.writeUInt16LE((13 << 11) | (25 << 5) | 18, 12);
        c.writeUInt16LE(((2024 - 1980) << 9) | (9 << 5) | 27, 14);
        c.writeUInt32LE(crc, 16);
        c.writeUInt32LE(opts.zip64 ? 0xffffffff : body.length, 20);
        c.writeUInt32LE(opts.zip64 ? 0xffffffff : data.length, 24);
        c.writeUInt16LE(name.length, 28);
        c.writeUInt16LE(extra.length, 30);
        c.writeUInt32LE(opts.zip64 ? 0xffffffff : offset, 42);
        central.push(c, name, extra);
        offset += local.length + name.length + localExtra.length + body.length;
    }
    const cd = Buffer.concat(central);
    const cdOffset = offset;
    parts.push(cd);
    if (opts.zip64) {
        const rec = Buffer.alloc(56);
        rec.writeUInt32LE(0x06064b50, 0);
        rec.writeBigUInt64LE(44n, 4);
        rec.writeBigUInt64LE(BigInt(files.length), 24);
        rec.writeBigUInt64LE(BigInt(files.length), 32);
        rec.writeBigUInt64LE(BigInt(cd.length), 40);
        rec.writeBigUInt64LE(BigInt(cdOffset), 48);
        const loc = Buffer.alloc(20);
        loc.writeUInt32LE(0x07064b50, 0);
        loc.writeBigUInt64LE(BigInt(cdOffset + cd.length), 8);
        loc.writeUInt32LE(1, 16);
        parts.push(rec, loc);
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(opts.zip64 ? 0xffff : files.length, 8);
    eocd.writeUInt16LE(opts.zip64 ? 0xffff : files.length, 10);
    eocd.writeUInt32LE(opts.zip64 ? 0xffffffff : cd.length, 12);
    eocd.writeUInt32LE(opts.zip64 ? 0xffffffff : cdOffset, 16);
    const comment = Buffer.from(opts.comment || '');
    eocd.writeUInt16LE(comment.length, 20);
    parts.push(eocd, comment);
    return Buffer.concat(parts);
}

// read(offset, length) över en Buffer, som File.slice() i appen.
function reader(buf) {
    return async (offset, length) => new Uint8Array(buf.buffer, buf.byteOffset + offset, Math.min(length, buf.length - offset));
}

module.exports = { buildZip, reader };
