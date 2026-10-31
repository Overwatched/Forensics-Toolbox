// Förhandsvisning av vad en query returnerar: kolumnerna läses ur SQL:en och
// exempelvärdena väljs efter kolumnnamnet. Ingen databas läses. Testas i Node.
(function (root) {
    'use strict';

    function stripComments(sql) {
        return String(sql || '').replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    }

    function splitTop(text) {
        var parts = [];
        var depth = 0;
        var quote = '';
        var cur = '';
        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            if (quote) {
                cur += ch;
                if (ch === quote) quote = '';
                continue;
            }
            if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
            if (ch === '(') depth++;
            if (ch === ')') depth--;
            if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
            cur += ch;
        }
        if (cur.trim()) parts.push(cur);
        return parts;
    }

    var PRAGMA_COLUMNS = ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'];

    // Första SELECT-listan på yttersta nivån, som uttryck.
    function selectItems(text) {
        var m = /\bSELECT\s+(?:DISTINCT\s+)?/i.exec(text);
        if (!m) return [];
        var rest = text.slice(m.index + m[0].length);
        var depth = 0;
        var end = -1;
        var re = /\(|\)|\bFROM\b/gi;
        var t;
        while ((t = re.exec(rest))) {
            if (t[0] === '(') depth++;
            else if (t[0] === ')') depth--;
            else if (depth === 0) { end = t.index; break; }
        }
        var list = end < 0 ? rest : rest.slice(0, end);
        return splitTop(list).map(function (item) { return item.trim().replace(/;$/, ''); }).filter(Boolean);
    }

    function itemName(s) {
        var alias = /\bAS\s+["'`[]?([\w.]+)["'`\]]?\s*$/i.exec(s);
        if (alias) return alias[1];
        if (s === '*') return '*';
        var last = /([\w]+)["'`\]]?\s*$/.exec(s);
        return last ? last[1] : s;
    }

    function columns(sql) {
        var text = stripComments(sql).trim();
        if (/^PRAGMA\s+table_info/i.test(text)) return PRAGMA_COLUMNS.slice();
        return selectItems(text).map(itemName).filter(Boolean);
    }

    // Första strängen efter THEN i ett CASE-uttryck, t.ex. 'Skärmdump'.
    function caseLiterals(sql) {
        var text = stripComments(sql).trim();
        var out = {};
        selectItems(text).forEach(function (s) {
            var m = /\bCASE\b[\s\S]*?\bTHEN\s+'((?:[^']|'')*)'/i.exec(s);
            if (m) out[itemName(s)] = m[1].replace(/''/g, "'");
        });
        return out;
    }

    function pick(list) {
        return function (i) { return list[i % list.length]; };
    }

    // Sluttiden ligger lika långt efter starttiden som duration-regeln säger (12 + 3i s).
    function clock(i, end) {
        var minutes = 10 + i * 7;
        var seconds = 12 + (end ? 12 + i * 3 : 0);
        minutes += Math.floor(seconds / 60);
        return String(14 + Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0') + ':' +
            String(seconds % 60).padStart(2, '0');
    }

    var RULES = [
        [/^\*$/, function () { return '(alla kolumner)'; }],
        [/^(notnull|pk)$/i, function () { return '0'; }],
        [/^dflt_value$/i, function () { return 'NULL'; }],
        [/^cid$/i, function (i) { return String(i); }],
        [/^(z?_?pk|_id|id)$/i, function (i) { return String(1201 + i); }],
        // Snapchat (cache_controller.db, arroyo.db, primary.docobjects, nse_db.sqlite)
        [/cache_key/i, function (i) { return ['7d1f3a9c2b4e5f60718293a4b5c6d7e8', '0a1b2c3d4e5f60718293a4b5c6d7e8f9', 'c6d7e8f90a1b2c3d4e5f60718293a4b5'][i % 3]; }],
        [/media_context_type/i, function (i) { return ['3', '34', '16'][i % 3]; }],
        [/external_key/i, function (i) { return '1:2b7e1d0c-3f4a-4b5c-9d6e-7f8a9b0c1d2e:' + (4 + i) + ':0:0'; }],
        [/(conversation_?id)/i, function () { return '2b7e1d0c-3f4a-4b5c-9d6e-7f8a9b0c1d2e'; }],
        [/(server_message_id|client_message_id|message_?id)/i, function (i) { return String(4 + i); }],
        [/message_state_type/i, function () { return 'COMMITTED'; }],
        [/(avsandare|sender)/i, function () { return '9e6f7a8b1c2d4e3f8a9b0c1d2e3f4a5b'; }],
        // Snapchat på Android (arroyo.db, main.db, client_notifications.db, memories.db, journal.db)
        [/^(content_type|created_on_device|is_saved|front_facing|has_location|has_overlay_image)$/i, function (i) { return String(i % 2); }],
        [/remote_media_count/i, function () { return '1'; }],
        [/^username$/i, pick(['anna.svensson', 'erik.lind', 'sara.nilsson'])],
        [/displayname$/i, pick(['Anna Svensson', 'Erik Lind', 'Sara Nilsson'])],
        [/json/i, function () { return '{"arroyo_convo_id":"2b7e1d0c-3f4a-4b5c-9d6e-7f8a9b0c1d2e","arroyo_message_id":"4"}'; }],
        [/time_zone/i, function () { return 'Europe/Stockholm'; }],
        [/user_agent/i, function () { return 'Snapchat/14.30.0.54 (AC2003; Android 13#f8fb74d040#33; gzip) V/MUSHROOM'; }],
        [/^(external_id|media_id)$/i, function (i) { return '4669844f-2375-6c4f-5de8-1489444859' + (10 + i); }],
        [/^key$/i, pick(['67F4A4FC9E7EA492DEFC059260D154E6.media', 'C025B6FFB844EF85C721AA05B78DA32D.posted_story_snap', '7CF641F2121BC4035AC4E5296671CE44.overlay'])],
        [/^mapp$/i, pick(['memories_media', 'posted_story_snap', 'memories_overlay'])],
        [/^user_?id$/i, function () { return '9e6f7a8b-1c2d-4e3f-8a9b-0c1d2e3f4a5b'; }],
        [/notification_?id/i, function () { return '4d28a744-acc5-4607-a3c1-dbdde70795d3'; }],
        [/^category$/i, function () { return '1'; }],
        [/_hex$/i, function () { return '0a0b…'; }],
        [/(innehall|storlek|_bytes)/i, function (i) { return String(21293 + i * 1000); }],
        [/timezonename/i, function () { return 'Europe/Stockholm'; }],
        [/timezoneoffset/i, function () { return '7200'; }],
        [/exiftimestampstring/i, function (i) { return '2024:06:01 ' + clock(i); }],
        [/(enddate|^end_?time$|^avfard_|^exit_)/i, function (i) { return '2024-06-01 ' + clock(i, true); }],
        [/(accuracy|noggrannhet|osakerhet|uncertainty)/i, function (i) { return String(5 + (i % 4) * 3); }],
        [/(confidence|konfidens|placetype|usertype|referenceframe|^zsource$|^ztype$)/i, function () { return '1'; }],
        [/mapitemidentifier/i, function (i) { return String(4800123456789 + i); }],
        [/(date|time|creation|modif|start|end|last_?used|added|taken|tillagd|^tid_|^ankomst_|^upptackt_|_utc$|_lokal$)/i, function (i) {
            return '2024-06-01 ' + clock(i);
        }],
        [/relative_path/i, function () { return 'DCIM/Camera/'; }],
        [/directory/i, function (i, ctx) { return ctx.ios ? 'DCIM/100APPLE' : '/storage/emulated/0/DCIM/Camera'; }],
        [/(_data|path)/i, function (i, ctx) { return '/storage/emulated/0/DCIM/Camera/' + ctx.file(i); }],
        [/(importedbydisplayname|editorlocalizedname)/i, function () { return 'WhatsApp'; }],
        [/(owner_package|package|bundle|creator|valuestring|app)/i, function (i, ctx) { return ctx.pkg; }],
        [/^(zfullname|zdisplayname)$/i, pick(['Anna Svensson', 'Erik Lind', 'Sara Nilsson'])],
        [/^ztitle$/i, pick(['Semester 2024', 'WhatsApp', 'Skärmdumpar'])],
        [/streamname/i, pick(['/app/usage', '/app/inFocus', '/display/isBacklit', '/device/isLocked'])],
        [/^tabell$/i, function (i, ctx) { return ctx.schema === 'columns' ? 'ZASSET' : pick(['Z_33ASSETS', 'Z_34ASSETS'])(i); }],
        [/^kolumner$/i, function () { return 'Z_33ALBUMS, Z_3ASSETS, Z_FOK_3ASSETS'; }],
        [/^name$/i, function (i, ctx) {
            if (ctx.schema === 'tables') return pick(ctx.ios ? ['ZASSET', 'ZADDITIONALASSETATTRIBUTES', 'ZGENERICALBUM'] : ['files', 'thumbnails', 'log'])(i);
            if (ctx.schema === 'columns') return pick(ctx.ios ? ['Z_PK', 'ZFILENAME', 'ZDATECREATED'] : ['_id', '_data', 'mime_type'])(i);
            return ctx.file(i);
        }],
        [/bucket_display_name/i, function () { return 'Camera'; }],
        [/volume_name/i, function () { return 'external_primary'; }],
        [/(display_name|filename|title)$/i, function (i, ctx) { return ctx.file(i); }],
        [/cameramake/i, function () { return 'Apple'; }],
        [/cameramodel/i, function () { return 'iPhone 15 Pro'; }],
        [/lensmodel/i, function () { return 'iPhone 15 Pro back camera 6.86mm f/1.78'; }],
        [/uniformtypeidentifier/i, function () { return 'public.heic'; }],
        [/adjustmentformatidentifier/i, function () { return 'com.apple.photo'; }],
        [/(guid|syndicationidentifier)/i, function (i) { return '8F3C2A1E-4B7D-4C9A-9E21-0D5F6A7B8C' + String(10 + i); }],
        [/^zidentifier$/i, function (i) { return '+4670123456' + (i % 10); }],
        [/mime/i, function (i, ctx) { return ctx.ios ? 'image/heic' : 'image/jpeg'; }],
        [/media_type/i, function () { return '1'; }],
        [/(width)/i, function () { return '4032'; }],
        [/(height)/i, function () { return '3024'; }],
        [/(lat)/i, function () { return '59.3293'; }],
        [/(lon|lng)/i, function () { return '18.0686'; }],
        [/(bucket|album)/i, function () { return 'Camera'; }],
        [/(duration|seconds|count|size|antal|minuter|datapunkter|^n$)/i, function (i) { return String(12 + i * 3); }],
        [/valueinteger/i, function (i) { return i % 2 ? '0' : '1'; }],
        [/cloudlocalstate/i, function () { return '1'; }],
        [/savedassettype/i, function () { return '3'; }],
        [/(hidden|favorite|trashedstate|manual|isresponse|direction|syndicationstate|kindsubtype|^zkind$)/i, function () { return '0'; }],
        [/^type$/i, function (i, ctx) {
            if (ctx.schema === 'tables') return 'table';
            if (ctx.schema === 'columns') return pick(['INTEGER', 'TEXT', 'TIMESTAMP'])(i);
            return '1';
        }],
    ];

    function exampleRows(cols, opts) {
        opts = opts || {};
        var ios = /ios/i.test(opts.platform || '');
        var sql = String(opts.sql || '');
        var base = String(opts.filename || '').split(',')[0].trim();
        var literals = sql ? caseLiterals(sql) : {};
        var ctx = {
            ios: ios,
            schema: /^\s*PRAGMA\s+table_info|pragma_table_info/i.test(stripComments(sql)) ? 'columns'
                : /\bsqlite_master\b/i.test(sql) ? 'tables' : '',
            pkg: String(opts.packageName || opts.bundleId || '').split(',')[0].trim() || (ios ? 'net.whatsapp.WhatsApp' : 'com.whatsapp'),
            file: function (i) {
                if (base) return i === 0 ? base : base.replace(/(\.\w+)?$/, '_' + (i + 1) + '$1');
                if (ios) return 'IMG_' + (4101 + i) + '.HEIC';
                return '202406' + String(1 + i).padStart(2, '0') + '_14' + String(10 + i) + '12.jpg';
            },
        };
        var count = opts.rows || 3;
        var rows = [];
        for (var i = 0; i < count; i++) {
            rows.push(cols.map(function (col) {
                if (Object.prototype.hasOwnProperty.call(literals, col)) return literals[col];
                var name = col.replace(/^(ext|cloud)_/i, '');
                for (var r = 0; r < RULES.length; r++) {
                    if (RULES[r][0].test(name)) return RULES[r][1](i, ctx);
                }
                return '…';
            }));
        }
        return rows;
    }

    var api = { columns: columns, exampleRows: exampleRows };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.QueryPreview = api;
})(typeof window !== 'undefined' ? window : this);
