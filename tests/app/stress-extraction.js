'use strict';
// En stor påhittad iPhone-extraktion för att mäta Chattar och galleriet: bildbiblioteket med telefonens egna
// tumnaglar (PhotoData/Thumbnails/V2/…/5005.JPG, 20–70 KB som i riktiga zippar), några original utan tumnagel,
// och WhatsApp med många chattar och en mycket lång. Namn, nummer och texter är påhittade. Ingår inte i
// provkörningen; körs för hand:
//
//   node tests/app/stress-extraction.js <mapp> [--photos 20000] [--messages 50000] [--originals 300]
//
// Zippen skrivs post för post till disk (lagrade poster, Zip64 när den behövs), så att den inte behöver rymmas i
// minnet. Bilderna ritas med ImageMagick (magick) i ett hundratal varianter som återanvänds.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCHEMAS = require(path.join(ROOT, 'tools', 'db-queries', 'fixtures', 'chat-schemas.json'));
const { loadSql } = require('./fixtures');

const COCOA = 978307200;
const T_END = Date.UTC(2026, 10, 12, 12, 0, 0) / 1000;
const M = 'private/var/mobile/';
const GROUP_WA = 'AppGroup/66666666-7777-4888-9999-AAAAAAAAAAAA/';

function args() {
    const a = process.argv.slice(2), o = { dir: a[0], photos: 20000, messages: 50000, originals: 300 };
    for (let i = 1; i < a.length; i += 2) o[a[i].replace(/^--/, '')] = Number(a[i + 1]);
    if (!o.dir) throw new Error('Ange mappen: node tests/app/stress-extraction.js <mapp>');
    return o;
}

// ---------- Zippen, post för post ----------

function zipWriter(file) {
    const fd = fs.openSync(file, 'w');
    const central = [];
    let at = 0;
    const write = (b) => { fs.writeSync(fd, b); at += b.length; };
    const dos = (() => { const d = new Date(T_END * 1000); return { time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5), date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate() }; })();
    return {
        add(name, data) {
            const n = Buffer.from(name, 'utf8'), crc = zlib.crc32(data) >>> 0, offset = at, big = offset >= 0xffffffff;
            const local = Buffer.alloc(30);
            local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
            local.writeUInt16LE(dos.time, 10); local.writeUInt16LE(dos.date, 12); local.writeUInt32LE(crc, 14);
            local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
            write(local); write(n); write(data);
            central.push({ n, crc, size: data.length, offset, big });
        },
        close() {
            const start = at;
            for (const e of central) {
                const extra = e.big ? Buffer.alloc(12) : Buffer.alloc(0);
                if (e.big) { extra.writeUInt16LE(1, 0); extra.writeUInt16LE(8, 2); extra.writeBigUInt64LE(BigInt(e.offset), 4); }
                const h = Buffer.alloc(46);
                h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(0x031e, 4); h.writeUInt16LE(45, 6); h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(0, 10);
                h.writeUInt16LE(dos.time, 12); h.writeUInt16LE(dos.date, 14); h.writeUInt32LE(e.crc, 16); h.writeUInt32LE(e.size, 20); h.writeUInt32LE(e.size, 24);
                h.writeUInt16LE(e.n.length, 28); h.writeUInt16LE(extra.length, 30); h.writeUInt32LE(0o100644 * 65536, 38);
                h.writeUInt32LE(e.big ? 0xffffffff : e.offset, 42);
                write(h); write(e.n); write(extra);
            }
            const size = at - start, zip64 = start >= 0xffffffff || central.length > 0xffff;
            if (zip64) {
                const z = Buffer.alloc(56), zAt = at;
                z.writeUInt32LE(0x06064b50, 0); z.writeBigUInt64LE(44n, 4); z.writeUInt16LE(45, 12); z.writeUInt16LE(45, 14);
                z.writeBigUInt64LE(BigInt(central.length), 24); z.writeBigUInt64LE(BigInt(central.length), 32); z.writeBigUInt64LE(BigInt(size), 40); z.writeBigUInt64LE(BigInt(start), 48);
                write(z);
                const l = Buffer.alloc(20);
                l.writeUInt32LE(0x07064b50, 0); l.writeBigUInt64LE(BigInt(zAt), 8); l.writeUInt32LE(1, 16);
                write(l);
            }
            const e = Buffer.alloc(22);
            e.writeUInt32LE(0x06054b50, 0);
            e.writeUInt16LE(Math.min(central.length, 0xffff), 8); e.writeUInt16LE(Math.min(central.length, 0xffff), 10);
            e.writeUInt32LE(Math.min(size, 0xffffffff), 12); e.writeUInt32LE(zip64 ? 0xffffffff : start, 16);
            write(e);
            fs.closeSync(fd);
            return { entries: central.length, bytes: at };
        },
    };
}

// ---------- Bilderna ----------

// Ett hundratal tumnaglar (384 × 512, brus och ett nummer, så att storleken blir som i en riktig zipp) och ett
// tjugotal original på 2016 × 1512.
function pictures(tmp, thumbs, originals) {
    const out = { thumbs: [], originals: [] };
    for (let i = 0; i < thumbs; i++) {
        const f = path.join(tmp, 't' + i + '.jpg');
        execFileSync('magick', ['-size', '384x512', 'plasma:hsl(' + (i * 37 % 360) + ',70%,55%)-hsl(' + (i * 71 % 360) + ',60%,35%)', '-gravity', 'center', '-pointsize', '64', '-fill', 'white',
            '-annotate', '0', String(i + 1), '-quality', '84', f]);
        out.thumbs.push(fs.readFileSync(f));
    }
    for (let i = 0; i < originals; i++) {
        const f = path.join(tmp, 'o' + i + '.jpg');
        execFileSync('magick', ['-size', '2016x1512', 'plasma:hsl(' + (i * 53 % 360) + ',70%,55%)-black', '-quality', '86', f]);
        out.originals.push(fs.readFileSync(f));
    }
    return out;
}

// ---------- Databaserna ----------

const ins = (db) => {
    const cache = {};
    return (t, row) => {
        const keys = Object.keys(row), k = t + keys.join();
        if (!cache[k]) cache[k] = db.prepare('INSERT INTO ' + t + ' (' + keys.join(', ') + ') VALUES (' + keys.map(() => '?').join(', ') + ')');
        cache[k].run(Object.values(row));
    };
};

// Bildbiblioteket: en bild var tionde minut bakåt från T_END. Var tjugonde är en skärmdump, var femtionde kom från
// WhatsApp, och originalen utan tumnagel ligger sist.
function photosDb(SQL, o) {
    const db = new SQL.Database();
    db.run('CREATE TABLE ZASSET (Z_PK INTEGER PRIMARY KEY, ZDIRECTORY TEXT, ZFILENAME TEXT, ZDATECREATED REAL, ZADDEDDATE REAL, ZKIND INTEGER, ZKINDSUBTYPE INTEGER, ZTRASHEDSTATE INTEGER, ZADDITIONALATTRIBUTES INTEGER, ZUUID TEXT)');
    db.run('CREATE TABLE ZADDITIONALASSETATTRIBUTES (Z_PK INTEGER PRIMARY KEY, ZASSET INTEGER, ZIMPORTEDBY INTEGER, ZCREATORBUNDLEID TEXT, ZORIGINALFILENAME TEXT)');
    const put = ins(db), list = [];
    db.run('BEGIN');
    const total = o.photos + o.originals;
    for (let i = 0; i < total; i++) {
        const dir = 'DCIM/' + (100 + Math.floor(i / 1000)) + 'APPLE', name = 'IMG_' + String((i % 9999) + 1).padStart(4, '0') + (i % 20 === 0 ? '.PNG' : '.JPG');
        const t = T_END - (total - i) * 600, wa = i % 50 === 0;
        put('ZASSET', { Z_PK: i + 1, ZDIRECTORY: dir, ZFILENAME: name, ZDATECREATED: t - COCOA, ZADDEDDATE: t + 2 - COCOA, ZKIND: 0, ZKINDSUBTYPE: i % 20 === 0 ? 10 : 0, ZTRASHEDSTATE: 0, ZADDITIONALATTRIBUTES: i + 1, ZUUID: 'U' + i });
        put('ZADDITIONALASSETATTRIBUTES', { Z_PK: i + 1, ZASSET: i + 1, ZIMPORTEDBY: wa ? 3 : 1, ZCREATORBUNDLEID: wa ? 'net.whatsapp.WhatsApp' : 'com.apple.camera', ZORIGINALFILENAME: name });
        list.push({ dir, name, thumb: i < o.photos });
    }
    db.run('COMMIT');
    const bytes = Buffer.from(db.export());
    db.close();
    return { bytes, list };
}

// WhatsApp: 199 chattar med lika många meddelanden och en lång med resten, och två grupper med fem deltagare.
function whatsappDb(SQL, o) {
    const db = new SQL.Database();
    Object.values(SCHEMAS['whatsapp-ios']).forEach((sql) => db.run(sql));
    const put = ins(db), chats = 200, long = Math.floor(o.messages * 0.4), each = Math.floor((o.messages - long) / (chats - 1));
    const words = 'hej då kanske imorgon middag klockan sju tåget är sent jag ringer sen okej bra tack ses vi där bilen jobbet'.split(' ');
    db.run('BEGIN');
    let pk = 1;
    for (let c = 1; c <= chats; c++) {
        const group = c === 2 || c === 3, n = c === 1 ? long : each, jid = group ? '1203630' + c + '@g.us' : '4670' + String(1000000 + c) + '@s.whatsapp.net';
        put('ZWACHATSESSION', { Z_PK: c, ZSESSIONTYPE: group ? 1 : 0, ZCONTACTJID: jid, ZPARTNERNAME: c === 1 ? 'Den långa chatten' : group ? 'Gruppen ' + c : 'Kontakt ' + c, ZLASTMESSAGEDATE: T_END - c * 60 - COCOA });
        if (group) for (let g = 0; g < 5; g++) put('ZWAGROUPMEMBER', { Z_PK: c * 10 + g, ZCHATSESSION: c, ZMEMBERJID: '4671' + (1000000 + g) + '@s.whatsapp.net', ZCONTACTNAME: 'Medlem ' + (g + 1), ZISADMIN: g === 0 ? 1 : 0, ZISACTIVE: 1 });
        for (let i = 0; i < n; i++) {
            const me = (i * 7 + c) % 3 === 0, t = T_END - c * 60 - (n - i) * 97 - COCOA;
            const text = Array.from({ length: 3 + ((i * 7) % 24) }, (_, k) => words[(i + k * 3 + c) % words.length]).join(' ');
            put('ZWAMESSAGE', { Z_PK: pk++, ZCHATSESSION: c, ZISFROMME: me ? 1 : 0, ZMESSAGETYPE: 0, ZTEXT: text, ZMESSAGEDATE: t, ZSENTDATE: t,
                ZFROMJID: me ? null : group ? '4671' + (1000000 + (i % 5)) + '@s.whatsapp.net' : jid, ZMESSAGESTATUS: 6 });
        }
    }
    db.run('COMMIT');
    const bytes = Buffer.from(db.export());
    db.close();
    return { bytes, chats, long, each };
}

async function main() {
    const o = args();
    fs.mkdirSync(o.dir, { recursive: true });
    const started = Date.now(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-stress-bilder-'));
    try {
        const pics = pictures(tmp, 120, 20);
        const SQL = await loadSql();
        const photos = photosDb(SQL, o), wa = whatsappDb(SQL, o);
        const file = path.join(o.dir, 'Stor-iPhone.zip'), z = zipWriter(file);
        z.add(M + 'Media/PhotoData/Photos.sqlite', photos.bytes);
        z.add(M + 'Containers/Shared/' + GROUP_WA + 'ChatStorage.sqlite', wa.bytes);
        z.add(M + 'Containers/Shared/' + GROUP_WA + 'ChatStorage.sqlite-wal', Buffer.alloc(0));
        let thumbBytes = 0;
        photos.list.forEach((p, i) => {
            if (p.thumb) {
                const b = pics.thumbs[i % pics.thumbs.length];
                thumbBytes += b.length;
                z.add(M + 'Media/PhotoData/Thumbnails/V2/' + p.dir + '/' + p.name + '/5005.JPG', b);
            } else z.add(M + 'Media/' + p.dir + '/' + p.name, pics.originals[i % pics.originals.length]);
        });
        const done = z.close();
        const summary = { file, entries: done.entries, bytes: done.bytes, photos: o.photos, originals: o.originals, thumbAverage: Math.round(thumbBytes / o.photos),
            messages: o.messages, chats: wa.chats, longChat: wa.long, perChat: wa.each, seconds: Math.round((Date.now() - started) / 1000) };
        fs.writeFileSync(path.join(o.dir, 'Stor-iPhone.json'), JSON.stringify(summary, null, 2));
        console.log(JSON.stringify(summary));
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { zipWriter };
