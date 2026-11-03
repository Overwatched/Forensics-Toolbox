// Kodar Telegrams format (Postbox) för testerna: objekt, meddelanden (t7), kontakter (t2) och
// lagringsdatabasens poster (t15, t16), i samma form som postbox.js läser och som labbtelefonen har.
// Bara för tester, och bara påhittade data.
'use strict';

const crypto = require('node:crypto');
const PB = require('../postbox.js');

const utf8 = (s) => Buffer.from(String(s), 'utf8');
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const f64 = (n) => { const b = Buffer.alloc(8); b.writeDoubleLE(n); return b; };
const u8 = (n) => Buffer.from([n]);

// Värden med sin typ: V.i32(5), V.str('x'), V.obj('Klass', { fält }), V.objs([{ cls, f }]) …
const V = {
    i32: (v) => ({ type: 0, v }),
    i64: (v) => ({ type: 1, v }),
    bool: (v) => ({ type: 2, v }),
    f64: (v) => ({ type: 3, v }),
    str: (v) => ({ type: 4, v }),
    obj: (cls, f) => ({ type: 5, cls, f }),
    i32s: (list) => ({ type: 6, list }),
    objs: (list) => ({ type: 8, list }),
    bytes: (v) => ({ type: 10, v }),
    nil: () => ({ type: 11 }),
};

function object(cls, f) {
    const body = fields(f);
    return Buffer.concat([u32(PB.classHash(cls)), i32(body.length), body]);
}

function value(x) {
    switch (x.type) {
        case 0: return i32(x.v);
        case 1: return i64(x.v);
        case 2: return u8(x.v ? 1 : 0);
        case 3: return f64(x.v);
        case 4: { const b = utf8(x.v); return Buffer.concat([i32(b.length), b]); }
        case 5: return object(x.cls, x.f);
        case 6: return Buffer.concat([i32(x.list.length)].concat(x.list.map(i32)));
        case 8: return Buffer.concat([i32(x.list.length)].concat(x.list.map((o) => object(o.cls, o.f))));
        case 10: return Buffer.concat([i32(x.v.length), Buffer.from(x.v)]);
        case 11: return Buffer.alloc(0);
    }
    throw new Error('okänd typ ' + x.type);
}

function fields(f) {
    return Buffer.concat(Object.keys(f).map((k) => Buffer.concat([u8(utf8(k).length), utf8(k), u8(f[k].type), value(f[k])])));
}

// Ett rotobjekt, som attribut, media och kontakter lagras.
function root(cls, f) { return fields({ _: V.obj(cls, f) }); }

// Peer-id som Telegram packar det: typen i bit 32–34, id:t i resten.
function peer(type, id) {
    const n = BigInt(id);
    return ((n >> 32n) << 35n) | (BigInt(type) << 32n) | (n & 0xffffffffn);
}

function mediaId(ns, id) { return Buffer.concat([i32(ns), i64(id)]); }

// En bild med en resurs per storlek: sizes [{ s: 'y', w, h, size }].
function image(o) {
    return root('TelegramMediaImage', {
        i: V.bytes(mediaId(0, o.photoId)),
        r: V.objs(o.sizes.map((z) => ({ cls: 'TelegramMediaImageRepresentation', f: {
            dx: V.i32(z.w), dy: V.i32(z.h),
            r: V.obj('CloudPhotoSizeMediaResource', { d: V.i32(o.dc || 4), i: V.i64(o.photoId), h: V.i64(7), s: V.str(z.s), n64: V.i64(z.size), fr: V.bytes([3, 0, 0, 0]) }),
            ps: V.i32s([]), th: V.i32(0), hv: V.bool(false), ip: V.bool(false),
        } }))),
        vr: V.objs([]), em: V.nil(), prf: V.nil(), fl: V.i32(0), vid: V.nil(),
    });
}

// En video som fil: TelegramMediaFile med videons attribut och filnamnet.
function video(o) {
    return root('TelegramMediaFile', {
        i: V.bytes(mediaId(5, o.fileId)), prf: V.nil(),
        r: V.obj('CloudDocumentMediaResource', { d: V.i32(o.dc || 4), f: V.i64(o.fileId), a: V.i64(9), n64: V.i64(o.size), fr: V.bytes([3, 0, 0, 0]), fn: V.str(o.name || 'video.mp4') }),
        pr: V.objs([{ cls: 'TelegramMediaImageRepresentation', f: { dx: V.i32(90), dy: V.i32(160), r: V.obj('CloudDocumentSizeMediaResource', { d: V.i32(o.dc || 4), i: V.i64(o.fileId), h: V.i64(9), s: V.str('m'), fr: V.bytes([3, 0, 0, 0]) }), ps: V.i32s([]), th: V.i32(0), hv: V.bool(false), ip: V.bool(false) } }]),
        vr: V.objs([]), cv: V.nil(), mt: V.str(o.mime || 'video/mp4'), s64: V.i64(o.size),
        at: V.objs([
            { cls: 'TelegramMediaFileAttribute', f: { t: V.i32(4), dur: V.f64(o.dur || 2.5), w: V.i32(o.w), h: V.i32(o.h), f: V.i32(2), prs: V.nil(), ct: V.nil(), vc: V.str('h264') } },
            { cls: 'TelegramMediaFileAttribute', f: { t: V.i32(0), fn: V.str(o.name || 'video.mp4') } },
        ]),
        arep: V.objs([]),
    });
}

function call(o) {
    return root('TelegramMediaAction', { _rawValue: V.i32(14), i: V.i64(o.id || 1), dr: o.discard == null ? V.nil() : V.i32(o.discard), d: o.duration == null ? V.nil() : V.i32(o.duration), vc: V.i32(o.video ? 1 : 0) });
}

const viewOnce = () => root('AutoclearTimeoutMessageAttribute', { t: V.i32(0x7fffffff), c: V.nil() });
const consumed = (c) => root('ConsumableContentMessageAttribute', { c: V.i32(c ? 1 : 0) });
const entities = () => root('TextEntitiesMessageAttribute', { entities: V.objs([]) });
const user = (o) => root('TelegramUser', Object.assign({ i: V.i64(peer(0, o.id)), ah: V.i64(1) },
    o.fn ? { fn: V.str(o.fn) } : {}, o.ln ? { ln: V.str(o.ln) } : {}, o.un ? { un: V.str(o.un) } : {}, o.p ? { p: V.str(o.p) } : {}, { ph: V.objs([]), fl: V.i32(0) }));
const channel = (o) => root('TelegramChannel', { i: V.i64(peer(2, o.id)), ah: V.i64(1), t: V.str(o.title), un: V.str(o.un || ''), ph: V.objs([]), fl: V.i32(0) });

// t7: nyckeln (peer, namnrymd, tid, id i big endian) och värdet.
function messageKey(m) {
    const b = Buffer.alloc(20);
    b.writeBigInt64BE(BigInt(m.peer), 0);
    b.writeInt32BE(m.namespace || 0, 8);
    b.writeInt32BE(m.timestamp, 12);
    b.writeInt32BE(m.id, 16);
    return b;
}

// m: { incoming, author, text, attributes: [rot], media: [rot], tags, forward: { author, date, source } }
function messageValue(m) {
    const parts = [u8(0), u32(m.id), u32(1)];
    parts.push(u8(m.globalTags != null ? 2 : 0));
    if (m.globalTags != null) parts.push(u32(m.globalTags));
    parts.push(u32((m.incoming ? 4 : 0) | 64), u32(m.tags || 0));
    if (m.forward) {
        parts.push(u8(1 | (m.forward.source ? 2 : 0)), i64(m.forward.author), i32(m.forward.date));
        if (m.forward.source) parts.push(i64(m.forward.source));
    } else {
        parts.push(u8(0));
    }
    parts.push(u8(m.author != null ? 1 : 0));
    if (m.author != null) parts.push(i64(m.author));
    const text = utf8(m.text || '');
    parts.push(i32(text.length), text);
    const list = (arr) => Buffer.concat([i32(arr.length)].concat(arr.map((x) => Buffer.concat([i32(x.length), x]))));
    parts.push(list(m.attributes || []), list(m.media || []), i32(0), i32(0));
    return Buffer.concat(parts);
}

// Schemat som i labbtelefonens db_sqlite, med de tabeller avkodningen läser.
function postboxDb(SQL, o) {
    const db = new SQL.Database();
    db.run('CREATE TABLE __meta_fulltext_tables (name INTEGER)');
    db.run('CREATE TABLE t0 (key INTEGER PRIMARY KEY, value BLOB)');
    db.run('CREATE TABLE t2 (key INTEGER PRIMARY KEY, value BLOB)');
    db.run('CREATE TABLE t6 (key BLOB PRIMARY KEY, value BLOB)');
    db.run('CREATE TABLE t7 (key BLOB PRIMARY KEY, value BLOB)');
    db.run('CREATE TABLE t15 (key INTEGER PRIMARY KEY, value BLOB)');
    db.run('CREATE TABLE t16 (key BLOB PRIMARY KEY, value BLOB) WITHOUT ROWID');
    (o.peers || []).forEach((p) => db.run('INSERT INTO t2 VALUES (CAST(? AS INTEGER), ?)', [String(p.peer), new Uint8Array(p.value)]));
    (o.messages || []).forEach((m) => db.run('INSERT INTO t7 VALUES (?, ?)', [new Uint8Array(messageKey(m)), new Uint8Array(m.value || messageValue(m))]));
    const bytes = db.export();
    db.close();
    return bytes;
}

// Lagringsdatabasen: entries [{ id, contentType, size, refs: [{ peer, namespace, messageId }] }].
// En post utan refs får en rad i t16 utan chatt, som klistermärkena i labbet.
function storageDb(SQL, o) {
    const db = new SQL.Database();
    db.run('CREATE TABLE __meta_fulltext_tables (name INTEGER)');
    ['t15', 't16', 't17', 't19', 't20', 't21'].forEach((t) => db.run('CREATE TABLE ' + t + ' (key BLOB PRIMARY KEY, value BLOB) WITHOUT ROWID'));
    (o.entries || []).forEach((e) => {
        const hash = crypto.createHash('md5').update(e.id).digest();
        const id = utf8(e.id);
        const len = Buffer.alloc(2); len.writeUInt16LE(id.length);
        db.run('INSERT INTO t15 VALUES (?, ?)', [new Uint8Array(hash), new Uint8Array(Buffer.concat([u8(0), len, id, u8(e.contentType || 0), i64(e.size || 0)]))]);
        const refs = e.refs && e.refs.length ? e.refs : [null];
        refs.forEach((r) => {
            const k = Buffer.alloc(29);
            hash.copy(k, 0);
            if (r) { k.writeBigInt64BE(BigInt(r.peer), 16); k[24] = r.namespace || 0; k.writeInt32BE(r.messageId || 0, 25); }
            db.run('INSERT INTO t16 VALUES (?, NULL)', [new Uint8Array(k)]);
        });
    });
    db.run("INSERT INTO t21 VALUES (X'0000', CAST('{\"version\":2}' AS BLOB))");
    const bytes = db.export();
    db.close();
    return bytes;
}

module.exports = { V, root, object, peer, image, video, call, viewOnce, consumed, entities, user, channel, messageKey, messageValue, postboxDb, storageDb };
