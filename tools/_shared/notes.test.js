'use strict';
// Anteckningar: påhittade NoteStore.sqlite (två iOS-varianter av kolumnerna) och sdoc.db i telefonernas form, med
// texten i Apples protobuf, en låst, en raderad, en checklista, en länk och en bilaga. Katalogens queryer körs mot
// tabellerna i minnet (attach) och mot sdoc.db, och Queries känner igen filerna (identify.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const Notes = require('./notes.js');

const ROOT = path.join(__dirname, '..', '..');
const catalog = require(path.join(ROOT, 'queries', 'notes', 'catalog.json'));
let SQLJS = null;
async function sqlJs() {
    if (SQLJS) return SQLJS;
    const dir = path.join(ROOT, 'tools', 'ios-keychain', 'vendor', 'sqljs');
    const ctx = {};
    new Function('window', fs.readFileSync(path.join(dir, 'sql-wasm-binary.js'), 'utf8'))(ctx);
    SQLJS = await require(path.join(dir, 'sql-wasm.js'))({ wasmBinary: ctx.SQL_WASM_BINARY });
    return SQLJS;
}

// ---------- Protobuf som Apple skriver den ----------
const varint = (n) => { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; out.push(b); } while (n); return Buffer.from(out); };
const num = (f, v) => Buffer.concat([varint(f * 8), varint(v)]);
const bytes = (f, b) => { b = Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8'); return Buffer.concat([varint(f * 8 + 2), varint(b.length), b]); };
// runs: [{ len, check: true/false, link, att: [id, uti] }]
function zdata(text, runs) {
    const runBufs = (runs || [{ len: text.length }]).map((r) => bytes(5, Buffer.concat([
        num(1, r.len),
        r.check !== undefined ? bytes(2, bytes(5, Buffer.concat([bytes(1, Buffer.alloc(16, 1)), num(2, r.check ? 1 : 0)]))) : Buffer.alloc(0),
        r.link ? bytes(9, r.link) : Buffer.alloc(0),
        r.att ? bytes(12, Buffer.concat([bytes(1, r.att[0]), bytes(2, r.att[1])])) : Buffer.alloc(0),
    ])));
    const note = Buffer.concat([bytes(2, text), ...runBufs]);
    return zlib.gzipSync(Buffer.concat([num(1, 0), bytes(2, Buffer.concat([num(1, 0), num(2, 0), bytes(3, note)]))]));
}

const COCOA = 978307200;
const T = Date.UTC(2026, 10, 19, 9, 0, 0);
const cocoa = (ms) => ms / 1000 - COCOA;

// NoteStore.sqlite med de kolumner som behövs. old: iOS-varianten med ZCREATIONDATE1 och ZACCOUNT3 i stället för
// ZCREATIONDATE3 och ZACCOUNT7.
function appleDb(SQL, old) {
    const db = new SQL.Database();
    const cols = ['Z_PK INTEGER PRIMARY KEY', 'Z_ENT INTEGER', 'ZTITLE1', 'ZTITLE2', 'ZSNIPPET', 'ZFOLDER', 'ZNOTEDATA', 'ZISPASSWORDPROTECTED', 'ZMARKEDFORDELETION', 'ZISPINNED', 'ZIDENTIFIER',
        'ZPASSWORDHINT', 'ZFOLDERTYPE', 'ZOWNER', 'ZPARENT', 'ZNAME', 'ZTYPEUTI', 'ZTITLE', 'ZMEDIA', 'ZFILENAME', 'ZNOTE',
        old ? 'ZCREATIONDATE1' : 'ZCREATIONDATE3', 'ZMODIFICATIONDATE1', old ? 'ZACCOUNT3' : 'ZACCOUNT7'];
    db.run('CREATE TABLE ZICCLOUDSYNCINGOBJECT (' + cols.join(', ') + ')');
    db.run('CREATE TABLE ZICNOTEDATA (Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, ZNOTE INTEGER, ZDATA BLOB)');
    db.run('CREATE TABLE Z_PRIMARYKEY (Z_ENT INTEGER, Z_NAME TEXT, Z_SUPER INTEGER, Z_MAX INTEGER)');
    [[5, 'ICAttachment'], [11, 'ICMedia'], [12, 'ICNote'], [14, 'ICAccount'], [15, 'ICFolder'], [19, 'ICNoteData']].forEach(([e, n]) => db.run('INSERT INTO Z_PRIMARYKEY VALUES (?, ?, 0, 0)', [e, n]));
    const created = old ? 'ZCREATIONDATE1' : 'ZCREATIONDATE3', account = old ? 'ZACCOUNT3' : 'ZACCOUNT7';
    const ins = (o) => { const k = Object.keys(o); db.run('INSERT INTO ZICCLOUDSYNCINGOBJECT (' + k.join(', ') + ') VALUES (' + k.map(() => '?').join(', ') + ')', k.map((x) => o[x])); };
    ins({ Z_PK: 3, Z_ENT: 14, ZNAME: 'iCloud' });
    ins({ Z_PK: 1, Z_ENT: 15, ZTITLE2: 'Recently Deleted', ZFOLDERTYPE: 1, ZOWNER: 3, ZIDENTIFIER: 'TrashFolder-CloudKit' });
    ins({ Z_PK: 2, Z_ENT: 15, ZTITLE2: 'Notes', ZFOLDERTYPE: 0, ZOWNER: 3, ZIDENTIFIER: 'DefaultFolder-CloudKit' });
    ins({ Z_PK: 4, Z_ENT: 15, ZTITLE2: 'Resor', ZFOLDERTYPE: 0, ZOWNER: 3 });
    ins({ Z_PK: 20, Z_ENT: 11, ZFILENAME: 'IMG_0042.jpeg' });
    ins({ Z_PK: 21, Z_ENT: 5, ZIDENTIFIER: 'ATT-1', ZTYPEUTI: 'public.jpeg', ZMEDIA: 20, ZNOTE: 10 });
    // 10: vanlig med checklista, länk och bilaga, fäst. 11: låst. 12: i Nyligen raderade. 13: markerad för radering, utan titel.
    const list = 'Packa\nPass\nLaddare\nSe https://example.org\n￼';
    ins({ Z_PK: 10, Z_ENT: 12, ZTITLE1: 'Packa', ZSNIPPET: 'Pass', ZFOLDER: 4, ZNOTEDATA: 100, ZISPINNED: 1, ZIDENTIFIER: 'N-10', [created]: cocoa(T), ZMODIFICATIONDATE1: cocoa(T + 3600000), [account]: 3 });
    ins({ Z_PK: 11, Z_ENT: 12, ZTITLE1: 'Hemligt', ZFOLDER: 2, ZNOTEDATA: 101, ZISPASSWORDPROTECTED: 1, ZPASSWORDHINT: 'hundens namn', [created]: cocoa(T + 60000), ZMODIFICATIONDATE1: cocoa(T + 120000) });
    ins({ Z_PK: 12, Z_ENT: 12, ZTITLE1: 'Raderad', ZFOLDER: 1, ZNOTEDATA: 102, [created]: cocoa(T - 86400000), ZMODIFICATIONDATE1: cocoa(T - 3600000) });
    ins({ Z_PK: 13, Z_ENT: 12, ZFOLDER: 2, ZNOTEDATA: 103, ZMARKEDFORDELETION: 1, [created]: cocoa(T - 172800000), ZMODIFICATIONDATE1: cocoa(T - 172800000) });
    db.run('INSERT INTO ZICNOTEDATA VALUES (100, 19, 10, ?)', [zdata(list, [
        { len: 6 }, { len: 5, check: true }, { len: 8, check: false }, { len: 4 }, { len: 19, link: 'https://example.org' }, { len: 2 }, { len: 1, att: ['ATT-1', 'public.jpeg'] }])]);
    db.run('INSERT INTO ZICNOTEDATA VALUES (101, 19, 11, ?)', [Buffer.from('krypterad, inte gzip')]);
    db.run('INSERT INTO ZICNOTEDATA VALUES (102, 19, 12, ?)', [zdata('Raderad\nDen här raderades.')]);
    db.run('INSERT INTO ZICNOTEDATA VALUES (103, 19, 13, ?)', [zdata('\nInköp: mjölk')]);
    return db;
}

test('Apples anteckningar: texten, checklistan, länken och bilagan avkodas, och låst, raderad och mappar känns igen i båda iOS-varianterna', async () => {
    const SQL = await sqlJs();
    for (const old of [false, true]) {
        const db = appleDb(SQL, old);
        try {
            assert.strictEqual(Notes.kindIn(db), 'apple');
            const r = Notes.read(db);
            assert.deepStrictEqual(r.errors, []);
            const by = Object.fromEntries(r.notes.map((n) => [n.id, n]));
            const a = by[10];
            assert.deepStrictEqual([a.title, a.folder, a.account, a.createdMs, a.modifiedMs, a.pinned, a.locked, a.deleted], ['Packa', 'Resor', 'iCloud', T, T + 3600000, true, false, false], 'old=' + old);
            assert.strictEqual(a.text, 'Packa\n☑ Pass\n☐ Laddare\nSe https://example.org\n￼');
            assert.deepStrictEqual([a.checklist, a.checked, a.links, a.attachments], [2, 1, ['https://example.org'], [{ id: 'ATT-1', uti: 'public.jpeg', name: 'IMG_0042.jpeg' }]]);
            assert.deepStrictEqual([by[11].locked, by[11].text, by[11].hint, by[11].title], [true, null, 'hundens namn', 'Hemligt']);
            assert.match(by[11].error, /^Låst/);
            assert.deepStrictEqual([by[12].deleted, by[12].deletedHow, by[12].folderKind], [true, 'i mappen Recently Deleted', 'Nyligen raderade']);
            assert.deepStrictEqual([by[13].deleted, by[13].title, by[13].titleFrom], [true, 'Inköp: mjölk', 'första raden']);
            assert.deepStrictEqual(r.folders.map((f) => [f.name, f.kind, f.count]), [['Recently Deleted', 'Nyligen raderade', 1], ['Notes', 'vanlig', 2], ['Resor', 'vanlig', 1]]);
        } finally { db.close(); }
    }
});

test('Queries: katalogens queryer för Apples anteckningar körs mot tabellerna i minnet', async () => {
    const SQL = await sqlJs();
    const db = appleDb(SQL, false);
    try {
        const done = Notes.attach(db, {});
        assert.match(done.line, /4 anteckningar, 1 låsta, 2 raderade i 3 mappar\.$/);
        const cat = catalog.databases.find((d) => d.id === 'apple-notes');
        const run = (id) => { const r = db.exec(cat.queries.find((q) => q.id === id).sql); return r.length ? r[0] : { columns: [], values: [] }; };
        assert.deepStrictEqual(run('notes-all').values.map((r) => r[0]), ['Packa', 'Hemligt', 'Raderad', 'Inköp: mjölk']);
        assert.deepStrictEqual(run('notes-deleted').values.map((r) => [r[0], r[2]]), [['Raderad', 'i mappen Recently Deleted'], ['Inköp: mjölk', 'markerad för radering (ZMARKEDFORDELETION)']]);
        assert.deepStrictEqual(run('notes-locked').values.map((r) => [r[0], r[5]]), [['Hemligt', 'hundens namn']]);
        assert.deepStrictEqual(run('notes-folders').values.map((r) => [r[0], r[3]]), [['Notes', 2], ['Recently Deleted', 1], ['Resor', 1]]);
        assert.deepStrictEqual(run('notes-extras').values.map((r) => [r[0], r[1], r[2], r[3], r[4]]), [['Packa', 2, 'https://example.org', 1, 'public.jpeg']]);
        assert.deepStrictEqual(run('notes-raw').values.map((r) => [r[0], r[3]]), [[100, 1], [101, 0], [102, 1], [103, 1]]);
    } finally { db.close(); }
});

function samsungDb(SQL) {
    const db = new SQL.Database();
    db.run("CREATE TABLE sdoc (_id INTEGER PRIMARY KEY, UUID TEXT, title TEXT NOT NULL DEFAULT '', content BLOB, createdAt INTEGER, lastModifiedAt INTEGER, isDeleted INTEGER DEFAULT 0, isLock INTEGER DEFAULT 0, isFavorite INTEGER DEFAULT 0, categoryUUID TEXT, recycle_bin_time_moved INTEGER DEFAULT 0, filePath TEXT, accountName TEXT DEFAULT '')");
    db.run('CREATE TABLE category_tree (UUID TEXT, parentUUID TEXT, isDeleted INTEGER, createdAt INTEGER, displayName TEXT)');
    db.run("INSERT INTO category_tree VALUES ('uncategorized:///', '', 0, 1, 'Uncategorized'), ('trash:///', '', 0, 1, 'Trash'), ('screenOffMemo:///', 'uncategorized:///', 0, 1, 'Screen off memo​')");
    const ins = (o) => { const k = Object.keys(o); db.run('INSERT INTO sdoc (' + k.join(', ') + ') VALUES (' + k.map(() => '?').join(', ') + ')', k.map((x) => o[x])); };
    ins({ _id: 1, UUID: 'S-1', content: Buffer.from('Inköpslista\nmjölk'), createdAt: T, lastModifiedAt: T + 1000, categoryUUID: 'uncategorized:///', filePath: '/data/user/0/x/SDocData/1.sdocx' });
    ins({ _id: 2, UUID: 'S-2', title: 'Kod', content: Buffer.from('1234'), createdAt: T, lastModifiedAt: T + 2000, categoryUUID: 'trash:///', recycle_bin_time_moved: T + 5000, filePath: '/f/2.sdocx' });
    ins({ _id: 3, UUID: 'S-3', title: 'Låst', content: Buffer.from('dold'), createdAt: T, lastModifiedAt: T + 3000, isLock: 1, isFavorite: 1, categoryUUID: 'screenOffMemo:///', filePath: '/f/3.sdocx' });
    return db;
}

test('Samsung Notes: texten, titeln ur första raden, papperskorgen, låst och mapparna, också i katalogens queryer', async () => {
    const SQL = await sqlJs();
    const db = samsungDb(SQL);
    try {
        assert.strictEqual(Notes.kindIn(db), 'samsung');
        const r = Notes.read(db);
        const by = Object.fromEntries(r.notes.map((n) => [n.id, n]));
        assert.deepStrictEqual([by[1].title, by[1].titleFrom, by[1].text, by[1].folder, by[1].createdMs], ['Inköpslista', 'första raden', 'Inköpslista\nmjölk', 'Uncategorized', T]);
        assert.deepStrictEqual([by[2].deleted, by[2].deletedMs, by[2].folderKind], [true, T + 5000, 'papperskorg']);
        assert.deepStrictEqual([by[3].locked, by[3].text, by[3].pinned, by[3].folder], [true, null, true, 'Screen off memo']);
        assert.strictEqual(Notes.attach(db, {}), null, 'Samsung Notes läses direkt i Queries');
        const cat = catalog.databases.find((d) => d.id === 'samsung-notes');
        const run = (id) => { const x = db.exec(cat.queries.find((q) => q.id === id).sql); return x.length ? x[0] : { values: [] }; };
        assert.deepStrictEqual(run('notes-all').values.map((v) => [v[0], v[1], v[2], v[5], v[6], v[9]]), [[3, 'Låst', 'Screen off memo', 1, 0, null], [2, 'Kod', 'Trash', 0, 1, '1234'], [1, 'Inköpslista\nmjölk', 'Uncategorized', 0, 0, 'Inköpslista\nmjölk']]);
        assert.deepStrictEqual(run('notes-deleted').values.map((v) => [v[0], v[7]]), [[2, new Date(T + 5000).toISOString().slice(0, 19).replace('T', ' ')]]);
        assert.deepStrictEqual(run('notes-locked').values.map((v) => v[0]), [3]);
        assert.deepStrictEqual(run('notes-folders').values.map((v) => [v[0], v[2]]), [['Screen off memo', 1], ['Trash', 1], ['Uncategorized', 1]]);
    } finally { db.close(); }
});

test('Queries känner igen NoteStore.sqlite och sdoc.db som anteckningar', async () => {
    const SQL = await sqlJs();
    global.window = global.window || {};
    const DbIdentify = require(path.join(ROOT, 'tools', 'db-queries', 'identify.js'));
    const dbs = catalog.databases.map((d) => ({ id: d.id, family: d.id, os: d.os, paths: d.paths, queries: d.queries.filter((q) => !q.hidden) }));
    const attach = (d) => Notes.attach(d);
    for (const [make, name, want] of [[appleDb, 'NoteStore.sqlite', 'apple-notes'], [samsungDb, 'sdoc.db', 'samsung-notes']]) {
        const db = make(SQL, false);
        const bytes = db.export();
        db.close();
        const ranked = DbIdentify.rank(SQL, bytes, dbs, { name, attach });
        assert.strictEqual(ranked[0].id, want, name);
        assert.ok(ranked[0].full, name + ': alla queryer passar');
    }
});

test('noteText: en trasig text ger ett fel', () => {
    assert.throws(() => Notes.noteText(Buffer.from('inte gzip')), /DEFLATE|protobuf|dokument/);
    assert.throws(() => Notes.noteText(zlib.gzipSync(Buffer.from([0x08, 0x01]))), /dokument/);
});
