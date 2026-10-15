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

    // Första SELECT-listan på yttersta nivån. PRAGMA table_info ger fasta kolumner.
    function columns(sql) {
        var text = stripComments(sql).trim();
        if (/^PRAGMA\s+table_info/i.test(text)) return ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'];
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
        return splitTop(list).map(function (item) {
            var s = item.trim().replace(/;$/, '');
            var alias = /\bAS\s+["'`[]?([\w.]+)["'`\]]?\s*$/i.exec(s);
            if (alias) return alias[1];
            if (s === '*') return '*';
            var last = /([\w]+)["'`\]]?\s*$/.exec(s);
            return last ? last[1] : s;
        }).filter(Boolean);
    }

    var RULES = [
        [/^\*$/, function () { return '(alla kolumner)'; }],
        [/^(z?_?pk|_id|z_pk|cid|id)$/i, function (i) { return String(1201 + i); }],
        [/(date|time|zdate|creation|modif|start|end|last_?used|added|taken)/i, function (i) {
            var minutes = 10 + i * 7;
            return '2024-06-01 ' + String(14 + Math.floor(minutes / 60)).padStart(2, '0') + ':' +
                String(minutes % 60).padStart(2, '0') + ':12';
        }],
        [/(_data|path|directory|zdirectory)/i, function (i, ctx) {
            return '/storage/emulated/0/DCIM/Camera/' + ctx.file(i);
        }],
        [/(owner_package|package|bundle|creator|app)/i, function (i, ctx) { return ctx.pkg; }],
        [/(display_name|filename|zfilename|name|title)$/i, function (i, ctx) { return ctx.file(i); }],
        [/mime/i, function () { return 'image/jpeg'; }],
        [/media_type/i, function () { return '1'; }],
        [/(width)/i, function () { return '4032'; }],
        [/(height)/i, function () { return '3024'; }],
        [/(lat)/i, function () { return '59.3293'; }],
        [/(lon|lng)/i, function () { return '18.0686'; }],
        [/(bucket|album)/i, function () { return 'Camera'; }],
        [/(duration|seconds|count|size)/i, function (i) { return String(12 + i * 3); }],
        [/(type)$/i, function () { return 'TEXT'; }],
    ];

    function exampleRows(cols, opts) {
        opts = opts || {};
        var base = String(opts.filename || '').split(',')[0].trim();
        var ctx = {
            pkg: String(opts.packageName || opts.bundleId || '').split(',')[0].trim() || 'com.whatsapp',
            file: function (i) {
                if (base) return i === 0 ? base : base.replace(/(\.\w+)?$/, '_' + (i + 1) + '$1');
                return '202406' + String(1 + i).padStart(2, '0') + '_14' + String(10 + i) + '12.jpg';
            },
        };
        var count = opts.rows || 3;
        var rows = [];
        for (var i = 0; i < count; i++) {
            rows.push(cols.map(function (col) {
                for (var r = 0; r < RULES.length; r++) {
                    if (RULES[r][0].test(col)) return RULES[r][1](i, ctx);
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
