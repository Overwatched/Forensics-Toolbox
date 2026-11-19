// Anteckningar: Apples Anteckningar (NoteStore.sqlite) och Samsung Notes (sdoc.db), läst ur en öppen sql.js-databas.
// Texten i NoteStore.sqlite är gzip-packad protobuf (ZICNOTEDATA.ZDATA) och avkodas här; i sdoc.db står den som
// UTF-8. Kolumnernas namn i NoteStore.sqlite skiftar mellan iOS-versionerna (ZCREATIONDATE1/3, ZACCOUNT2–8), så de
// väljs efter schemat. Används av Telefonen (appen Anteckningar) och av Queries, där Apples anteckningar läggs i
// tabellerna anteckning och anteckningsmapp i minnet (attach). Testas i Node (notes.test.js).
//
//   Notes.kindIn(db)        'apple', 'samsung' eller null
//   Notes.read(db)          { kind, app, notes: [...], folders: [...], errors: [...] }
//   Notes.noteText(bytes)   ZDATA → { text, attachments, links, checklist }
//   Notes.attach(db, cache) tabellerna i minnet, för Queries
(function (root) {
    'use strict';

    var COCOA = 978307200;
    var ATTACHMENT = '￼';

    function inflate() {
        if (root.Inflate) return root.Inflate;
        if (typeof require === 'function') return require('./inflate.js');
        throw new Error('Inflate saknas');
    }

    function utf8(b) {
        if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(b);
        return Buffer.from(b).toString('utf8');
    }

    // ---------- Protobuf ----------

    // Fälten i ett meddelande: [{ f, w, v }], v är ett tal (varint) eller byte (längdprefix).
    function fields(b) {
        var p = 0, out = [];
        function varint() {
            var r = 0, s = 0, x;
            do {
                if (p >= b.length) throw new Error('protobuf: datan tar slut');
                x = b[p++];
                r += (x & 127) * Math.pow(2, s);
                s += 7;
            } while (x & 128);
            return r;
        }
        while (p < b.length) {
            var key = varint(), f = Math.floor(key / 8), w = key & 7, v;
            if (w === 0) v = varint();
            else if (w === 2) { var n = varint(); if (p + n > b.length) throw new Error('protobuf: fältet är längre än datan'); v = b.subarray(p, p + n); p += n; }
            else if (w === 5) { v = null; p += 4; }
            else if (w === 1) { v = null; p += 8; }
            else throw new Error('protobuf: okänd typ ' + w);
            out.push({ f: f, w: w, v: v });
        }
        return out;
    }
    function one(list, f) { for (var i = 0; i < list.length; i++) if (list[i].f === f) return list[i].v; return null; }
    function all(list, f) { return list.filter(function (x) { return x.f === f; }).map(function (x) { return x.v; }); }

    // ZDATA: gzip med NoteStoreProto (2 Document → 3 Note → 2 texten, 5 formateringen i körningar). En körning har
    // 1 längden (UTF-16-tecken), 2 styckeformat (5 checklista: 2 klar), 9 länk och 12 bilaga (1 id, 2 typ).
    function noteText(bytes) {
        var raw = inflate().gunzip(bytes);
        var doc = one(fields(raw), 2);
        if (!doc) throw new Error('anteckningen har inget dokument');
        var note = one(fields(doc), 3);
        if (!note) throw new Error('anteckningen har ingen text');
        var nf = fields(note);
        var tb = one(nf, 2);
        var text = tb ? utf8(tb) : '';
        var attachments = [], links = [], checks = [];
        var pos = 0;
        all(nf, 5).forEach(function (run) {
            var rf = fields(run);
            var len = one(rf, 1) || 0;
            var style = one(rf, 2);
            if (style) {
                var cl = one(fields(style), 5);
                if (cl) checks.push({ at: pos, done: one(fields(cl), 2) === 1 });
            }
            var link = one(rf, 9);
            if (link) { var u = utf8(link); if (links.indexOf(u) < 0) links.push(u); }
            var att = one(rf, 12);
            if (att) {
                var af = fields(att);
                attachments.push({ id: one(af, 1) ? utf8(one(af, 1)) : '', uti: one(af, 2) ? utf8(one(af, 2)) : '', at: pos });
            }
            pos += len;
        });
        // Checklistans rader får ☐ eller ☑ först, som i appen.
        var lines = text.split('\n'), starts = [], s = 0;
        lines.forEach(function (l) { starts.push(s); s += l.length + 1; });
        var mark = {};
        checks.forEach(function (c) {
            var i = 0;
            while (i + 1 < starts.length && starts[i + 1] <= c.at) i++;
            mark[i] = c.done ? '☑ ' : '☐ ';
        });
        var shown = lines.map(function (l, i) { return (mark[i] || '') + l; }).join('\n');
        return { text: shown, plain: text, attachments: attachments, links: links, checklist: Object.keys(mark).length, checked: Object.keys(mark).filter(function (k) { return mark[k] === '☑ '; }).length };
    }

    // ---------- Databasen ----------

    function tables(db) {
        var r = db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0];
        return r ? r.values.map(function (v) { return String(v[0]); }) : [];
    }
    function columns(db, table) {
        var r = db.exec('PRAGMA table_info("' + table + '")')[0];
        var out = {};
        (r ? r.values : []).forEach(function (v) { out[String(v[1])] = true; });
        return out;
    }
    function select(db, sql, params) {
        var st = db.prepare(sql), out = [];
        try {
            if (params) st.bind(params);
            while (st.step()) out.push(st.getAsObject());
        } finally { st.free(); }
        return out;
    }
    function kindIn(db) {
        var t;
        try { t = tables(db); } catch (e) { return null; }
        if (t.indexOf('ZICCLOUDSYNCINGOBJECT') >= 0 && t.indexOf('ZICNOTEDATA') >= 0) return 'apple';
        if (t.indexOf('sdoc') >= 0 && t.indexOf('category_tree') >= 0) return 'samsung';
        return null;
    }
    function cocoaMs(v) { return typeof v === 'number' && isFinite(v) && v !== 0 ? Math.round((v + COCOA) * 1000) : null; }
    function msOrNull(v) { return typeof v === 'number' && isFinite(v) && v > 0 ? v : null; }
    function firstLine(t) { var l = String(t || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean)[0] || ''; return l.length > 80 ? l.slice(0, 80) + '…' : l; }

    var FOLDER_KIND = { 0: 'vanlig', 1: 'Nyligen raderade', 3: 'smart mapp' };

    function readApple(db) {
        var C = columns(db, 'ZICCLOUDSYNCINGOBJECT');
        var col = function (names) { for (var i = 0; i < names.length; i++) if (C[names[i]]) return names[i]; return null; };
        var as = function (names, alias) { var c = col(names); return (c || 'NULL') + ' AS ' + alias; };
        var ents = {};
        select(db, 'SELECT Z_ENT, Z_NAME FROM Z_PRIMARYKEY').forEach(function (r) { ents[r.Z_NAME] = r.Z_ENT; });
        if (ents.ICNote == null) throw new Error('NoteStore.sqlite har ingen ICNote i Z_PRIMARYKEY');
        var accounts = {};
        if (ents.ICAccount != null) select(db, 'SELECT Z_PK, ' + as(['ZNAME'], 'name') + ' FROM ZICCLOUDSYNCINGOBJECT WHERE Z_ENT = ?', [ents.ICAccount]).forEach(function (r) { accounts[r.Z_PK] = r.name || ''; });
        var folders = {}, folderList = [];
        if (ents.ICFolder != null) {
            select(db, 'SELECT Z_PK, ' + as(['ZTITLE2', 'ZTITLE'], 'title') + ', ' + as(['ZFOLDERTYPE'], 'type') + ', ' + as(['ZOWNER'], 'owner') + ', ' + as(['ZPARENT'], 'parent') + ', ' +
                as(['ZIDENTIFIER'], 'uuid') + ', ' + as(['ZMARKEDFORDELETION'], 'gone') + ' FROM ZICCLOUDSYNCINGOBJECT WHERE Z_ENT = ? ORDER BY Z_PK', [ents.ICFolder]).forEach(function (r) {
                var f = { id: r.Z_PK, name: r.title || (r.type === 1 ? 'Nyligen raderade' : 'Mapp ' + r.Z_PK), kind: FOLDER_KIND[r.type] || (r.type == null ? 'vanlig' : 'typ ' + r.type),
                    trash: r.type === 1, account: accounts[r.owner] || '', parent: r.parent, uuid: r.uuid || '', deleted: r.gone === 1, count: 0 };
                folders[r.Z_PK] = f;
                folderList.push(f);
            });
        }
        // Bilagornas namn och typ: ICAttachment med id, och ICMedia med filnamnet.
        var media = {}, attach = {};
        if (ents.ICMedia != null && C.ZFILENAME) select(db, 'SELECT Z_PK, ZFILENAME FROM ZICCLOUDSYNCINGOBJECT WHERE Z_ENT = ?', [ents.ICMedia]).forEach(function (r) { media[r.Z_PK] = r.ZFILENAME; });
        if (ents.ICAttachment != null) {
            select(db, 'SELECT Z_PK, ' + as(['ZIDENTIFIER'], 'uuid') + ', ' + as(['ZTYPEUTI'], 'uti') + ', ' + as(['ZTITLE'], 'title') + ', ' + as(['ZMEDIA'], 'media') + ' FROM ZICCLOUDSYNCINGOBJECT WHERE Z_ENT = ?', [ents.ICAttachment])
                .forEach(function (r) { if (r.uuid) attach[r.uuid] = { uti: r.uti || '', name: r.title || media[r.media] || '' }; });
        }
        var data = {};
        select(db, 'SELECT Z_PK, ZDATA FROM ZICNOTEDATA').forEach(function (r) { data[r.Z_PK] = r.ZDATA; });
        var accountCols = ['ZACCOUNT2', 'ZACCOUNT3', 'ZACCOUNT4', 'ZACCOUNT5', 'ZACCOUNT6', 'ZACCOUNT7', 'ZACCOUNT8'].filter(function (c) { return C[c]; });
        var sql = 'SELECT Z_PK, ' + as(['ZTITLE1', 'ZTITLE'], 'title') + ', ' + as(['ZSNIPPET'], 'snippet') + ', ' + as(['ZFOLDER'], 'folder') + ', ' + as(['ZNOTEDATA'], 'data') + ', ' +
            as(['ZISPASSWORDPROTECTED'], 'locked') + ', ' + as(['ZMARKEDFORDELETION'], 'gone') + ', ' + as(['ZISPINNED'], 'pinned') + ', ' + as(['ZIDENTIFIER'], 'uuid') + ', ' +
            as(['ZPASSWORDHINT'], 'hint') + ', ' + as(['ZCREATIONDATE3', 'ZCREATIONDATE1', 'ZCREATIONDATE'], 'created') + ', ' + as(['ZMODIFICATIONDATE1', 'ZMODIFICATIONDATE'], 'modified') +
            (accountCols.length ? ', ' + accountCols.join(', ') : '') + ' FROM ZICCLOUDSYNCINGOBJECT WHERE Z_ENT = ? ORDER BY Z_PK';
        var errors = [];
        var notes = select(db, sql, [ents.ICNote]).map(function (r) {
            var f = folders[r.folder] || null;
            var acc = f && f.account ? f.account : '';
            if (!acc) accountCols.some(function (c) { if (r[c] != null && accounts[r[c]] != null) { acc = accounts[r[c]]; return true; } return false; });
            var n = {
                app: 'Anteckningar', id: r.Z_PK, uuid: r.uuid || '', title: r.title || '', titleFrom: 'ZTITLE1', folder: f ? f.name : '', folderKind: f ? f.kind : '', account: acc,
                createdMs: cocoaMs(r.created), modifiedMs: cocoaMs(r.modified), deletedMs: null, locked: r.locked === 1, deleted: !!(f && f.trash) || r.gone === 1,
                deletedHow: r.gone === 1 ? 'markerad för radering (ZMARKEDFORDELETION)' : f && f.trash ? 'i mappen ' + f.name : '', pinned: r.pinned === 1,
                text: null, snippet: r.snippet || '', attachments: [], links: [], checklist: 0, checked: 0, hint: r.hint || '',
                source: 'ZICCLOUDSYNCINGOBJECT rad ' + r.Z_PK + (r.data != null ? ', ZICNOTEDATA rad ' + r.data : ''), error: '',
            };
            if (f) f.count++;
            var bytes = r.data != null ? data[r.data] : null;
            if (n.locked) n.error = 'Låst: texten är krypterad med anteckningens lösenord.';
            else if (!bytes || !bytes.length) n.error = 'Texten finns inte i databasen (ZICNOTEDATA saknas).';
            else {
                try {
                    var t = noteText(bytes);
                    n.text = t.text; n.links = t.links; n.checklist = t.checklist; n.checked = t.checked;
                    n.attachments = t.attachments.map(function (a) { var x = attach[a.id] || {}; return { id: a.id, uti: a.uti || x.uti || '', name: x.name || '' }; });
                } catch (err) { n.error = 'Texten kunde inte avkodas: ' + (err && err.message ? err.message : err); errors.push('Anteckning ' + r.Z_PK + ': ' + n.error); }
            }
            if (!n.title) { n.title = firstLine(n.text || n.snippet); n.titleFrom = 'första raden'; }
            return n;
        });
        return { kind: 'apple', app: 'Anteckningar', notes: notes, folders: folderList, errors: errors };
    }

    function readSamsung(db) {
        var C = columns(db, 'sdoc');
        var has = function (c) { return !!C[c]; };
        var cats = {};
        select(db, 'SELECT UUID, displayName, ' + (columns(db, 'category_tree').isDeleted ? 'isDeleted' : '0') + ' AS gone FROM category_tree').forEach(function (r) {
            cats[r.UUID] = { id: r.UUID, name: String(r.displayName || '').replace(/​/g, ''), kind: /^trash:/.test(r.UUID) ? 'papperskorg' : 'vanlig', trash: /^trash:/.test(r.UUID), account: '', deleted: r.gone === 1, count: 0 };
        });
        var c = function (name, fallback) { return has(name) ? name : (fallback || 'NULL'); };
        var rows = select(db, 'SELECT _id, ' + c('UUID') + ' AS uuid, ' + c('title', "''") + ' AS title, CAST(' + c('content', "''") + ' AS TEXT) AS text, ' + c('createdAt') + ' AS created, ' +
            c('lastModifiedAt') + ' AS modified, ' + c('isDeleted', '0') + ' AS gone, ' + c('isLock', '0') + ' AS locked, ' + c('isFavorite', '0') + ' AS fav, ' + c('categoryUUID') + ' AS cat, ' +
            c('recycle_bin_time_moved', '0') + ' AS binMs, ' + c('filePath') + ' AS file, ' + c('accountName') + ' AS account FROM sdoc ORDER BY _id');
        var notes = rows.map(function (r) {
            var f = cats[r.cat] || null;
            if (f) f.count++;
            var trash = !!(f && f.trash) || msOrNull(r.binMs) !== null;
            var n = {
                app: 'Samsung Notes', id: r._id, uuid: r.uuid || '', title: r.title || '', titleFrom: 'title', folder: f ? f.name : '', folderKind: f ? f.kind : '', account: r.account || '',
                createdMs: msOrNull(r.created), modifiedMs: msOrNull(r.modified), deletedMs: msOrNull(r.binMs), locked: r.locked === 1, deleted: trash || r.gone === 1,
                deletedHow: r.gone === 1 ? 'raderad (isDeleted)' : trash ? 'i papperskorgen' : '', pinned: r.fav === 1,
                text: r.locked === 1 ? null : (r.text || ''), snippet: '', attachments: [], links: [], checklist: 0, checked: 0, hint: '',
                source: 'sdoc rad ' + r._id + (r.file ? ', ' + r.file : ''), error: r.locked === 1 ? 'Låst: Samsung Notes visar inte texten utan lösenordet. Hela anteckningen ligger i filen ' + (r.file || '.sdocx') + '.' : '',
            };
            if (!n.title) { n.title = firstLine(r.text); n.titleFrom = 'första raden'; }
            return n;
        });
        return { kind: 'samsung', app: 'Samsung Notes', notes: notes, folders: Object.keys(cats).map(function (k) { return cats[k]; }), errors: [] };
    }

    function read(db) {
        var kind = kindIn(db);
        if (kind === 'apple') return readApple(db);
        if (kind === 'samsung') return readSamsung(db);
        return null;
    }

    // ---------- Queries: tabellerna i minnet ----------

    function utcText(ms) { return ms == null ? null : new Date(ms).toISOString().slice(0, 19).replace('T', ' '); }
    var NOTE_COLUMNS = ['app', 'id', 'titel', 'titel_ur', 'mapp', 'mappens_slag', 'konto', 'skapad_utc', 'andrad_utc', 'skapad_ms', 'andrad_ms', 'last', 'raderad', 'hur_raderad', 'fast',
        'tecken', 'bilagor', 'bilagetyper', 'lankar', 'checklista', 'losenordstips', 'text', 'utdrag', 'identifierare', 'kalla', 'fel'];
    var FOLDER_COLUMNS = ['id', 'namn', 'slag', 'konto', 'anteckningar', 'raderad', 'identifierare'];
    var INTEGER = { id: 1, skapad_ms: 1, andrad_ms: 1, last: 1, raderad: 1, fast: 1, tecken: 1, bilagor: 1, checklista: 1, anteckningar: 1 };

    function noteRow(n) {
        return [n.app, n.id, n.title, n.titleFrom, n.folder, n.folderKind, n.account, utcText(n.createdMs), utcText(n.modifiedMs), n.createdMs, n.modifiedMs, n.locked ? 1 : 0, n.deleted ? 1 : 0,
            n.deletedHow || null, n.pinned ? 1 : 0, n.text == null ? null : n.text.length, n.attachments.length, n.attachments.map(function (a) { return a.uti || 'okänd'; }).join(', ') || null,
            n.links.join(' ') || null, n.checklist, n.hint || null, n.text, n.snippet || null, n.uuid || null, n.source, n.error || null];
    }

    function create(db, name, cols, rows) {
        db.run('DROP TABLE IF EXISTS temp.' + name);
        db.run('CREATE TEMP TABLE ' + name + ' (' + cols.map(function (c) { return c + (INTEGER[c] ? ' INTEGER' : ' TEXT'); }).join(', ') + ')');
        var st = db.prepare('INSERT INTO temp.' + name + ' VALUES (' + cols.map(function () { return '?'; }).join(', ') + ')');
        try { rows.forEach(function (r) { st.run(r); }); } finally { st.free(); }
    }

    // Apples anteckningar som tabeller i minnet. Samsung Notes läses i Queries direkt ur sdoc.db, där texten står som
    // text. cache: ett objekt där raderna sparas, så att en ny kopia av samma databas inte avkodas igen.
    function attach(db, cache) {
        if (kindIn(db) !== 'apple') return null;
        var data = cache && cache.notes;
        if (!data) { data = readApple(db); if (cache) cache.notes = data; }
        db.run('BEGIN');
        try {
            create(db, 'anteckning', NOTE_COLUMNS, data.notes.map(noteRow));
            create(db, 'anteckningsmapp', FOLDER_COLUMNS, data.folders.map(function (f) { return [f.id, f.name, f.kind, f.account, f.count, f.deleted ? 1 : 0, f.uuid || null]; }));
            db.run('COMMIT');
        } catch (e) {
            try { db.run('ROLLBACK'); } catch (e2) { /* redan avbruten */ }
            throw e;
        }
        var locked = data.notes.filter(function (n) { return n.locked; }).length, deleted = data.notes.filter(function (n) { return n.deleted; }).length;
        return {
            kind: 'apple-notes', tables: ['anteckning', 'anteckningsmapp'], errors: data.errors.length,
            line: 'Anteckningarna avkodades i minnet (gzip och protobuf i ZICNOTEDATA.ZDATA) till tabellerna anteckning och anteckningsmapp: ' + data.notes.length + ' anteckningar' +
                (locked ? ', ' + locked + ' låsta' : '') + (deleted ? ', ' + deleted + ' raderade' : '') + ' i ' + data.folders.length + ' mappar.' +
                (data.errors.length ? ' ' + data.errors.length + ' gick inte att avkoda: ' + data.errors.slice(0, 3).join('; ') : ''),
        };
    }

    var api = { kindIn: kindIn, read: read, readApple: readApple, readSamsung: readSamsung, noteText: noteText, attach: attach, fields: fields, NOTE_COLUMNS: NOTE_COLUMNS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Notes = api;
})(typeof window !== 'undefined' ? window : this);
