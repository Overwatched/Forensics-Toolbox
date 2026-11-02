// Flera filer i Härkomst: namnen som klistras in, en rad per fil i listan och undersökarens läge
// per fil. Varje fil bedöms med samma kod som en ensam fil; här finns bara det som gäller listan.
// Ingen DOM. Testas i Node.
(function (root) {
    'use strict';

    // Kolumnerna i listan: faktorns id, kolumnens rubrik och faktorns vanliga namn.
    var FACTOR_COLUMNS = [
        ['time', 'Skapad', 'Skapandetid'],
        ['app', 'App', 'App igång'],
        ['camera', 'Kamera', 'Kamera igång'],
        ['screen', 'Skärm', 'Skärmen'],
        ['position', 'Position', 'Position'],
    ];

    var EXT = /\.[A-Za-z0-9]{1,5}$/;
    // MD5, SHA-1 eller SHA-256.
    var HASH = /^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
    // En rad ur md5sum, sha256sum och liknande: summan, mellanslag, filnamnet.
    var HASH_LINE = /^([0-9a-fA-F]{32}|[0-9a-fA-F]{40}|[0-9a-fA-F]{64})\s+\*?\S/;

    function clean(x) { return String(x).trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim(); }

    function baseName(s) {
        var t = String(s);
        return t.slice(Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\')) + 1);
    }

    // Ett eller flera filnamn eller hashsummor: ett per rad (eller med tabb eller semikolon emellan),
    // eller med komma emellan. Komma delar bara när varje del ser ut som ett filnamn med ändelse eller
    // en summa, så att "Bild, kopia.jpg" står kvar. Summor med mellanslag emellan delas också, och en
    // rad ur md5sum (summan och filnamnet) blir summan. En hel sökväg blir filnamnet. Dubbletter tas
    // bort, ordningen behålls.
    function parseNames(text) {
        var out = [];
        var seen = {};
        String(text == null ? '' : text).split(/\r?\n|\t|;/).forEach(function (piece) {
            var words = piece.trim().split(/[\s,]+/).filter(Boolean);
            var line = HASH_LINE.exec(piece.trim());
            var parts;
            if (words.length > 1 && words.every(function (w) { return HASH.test(clean(w)); })) parts = words;
            else if (line) parts = [line[1]];
            else {
                parts = piece.split(',');
                if (parts.length > 1 && !parts.every(function (x) { var c = clean(x); return EXT.test(c) || HASH.test(c); })) parts = [piece];
            }
            parts.forEach(function (x) {
                var name = baseName(clean(x));
                if (!name || seen[name]) return;
                seen[name] = true;
                out.push(name);
            });
        });
        return out;
    }

    // En rad i listan ur en bedömning: det som behövs för att gå igenom filerna och för Word.
    // opts: { format (ms -> text i radens zon), zoneLabel, place, key }
    function summarize(model, meta, opts) {
        opts = opts || {};
        var file = model.file || {};
        var fe = meta && meta.fileEntry;
        var factors = {};
        (model.factors || []).forEach(function (f) { factors[f.id] = { state: f.state, title: f.title, verdict: f.verdict || '' }; });
        return {
            key: opts.key || '',
            filename: file.filename || '',
            path: fe ? fe.path : '',
            fileNote: fe ? '' : (meta && meta.fileMissingReason) || '',
            md5: fe ? fe.md5 || '' : '',
            sha256: fe ? fe.sha256 || '' : '',
            createdMs: file.createdMs || null,
            tText: file.createdMs && opts.format ? opts.format(file.createdMs) : '',
            zoneLabel: opts.zoneLabel || '',
            type: model.type ? model.type.type : 'unknown',
            typeLabel: model.type ? model.type.label : '',
            place: opts.place || '',
            factors: factors,
            factorIds: (model.factors || []).map(function (f) { return f.id; }),
            summary: model.summary || '',
            warnings: (model.warnings || []).length,
            beta: !!model.beta,
        };
    }

    // Undersökarens läge för en fil: om rutan är ifylld och hur många faktorer som är bockade.
    // saved: { text, checked } ur Härkomsts minne, eller inget.
    function examinerState(saved, factorIds) {
        var text = saved && saved.text ? String(saved.text).trim() : '';
        var checked = saved && saved.checked ? saved.checked : {};
        var ids = factorIds || [];
        var n = ids.filter(function (id) { return checked[id]; }).length;
        return { written: !!text, text: text, checked: n, total: ids.length };
    }

    // "Bedömd, 3 av 5 kontrollerade", "2 av 5 kontrollerade, ingen text" eller "Inte bedömd".
    function examinerText(saved, factorIds) {
        var s = examinerState(saved, factorIds);
        if (!s.written && !s.checked) return 'Inte bedömd';
        var count = s.checked + ' av ' + s.total + ' kontrollerade';
        if (!s.written) return count + ', ingen text';
        return 'Bedömd' + (s.checked ? ', ' + count : '');
    }

    // Raderna i listan räknade per läge, till raden under listan.
    function counts(rows) {
        var out = { done: 0, missing: 0, ambiguous: 0, error: 0, stopped: 0, waiting: 0 };
        (rows || []).forEach(function (r) { if (out[r.status] != null) out[r.status]++; });
        return out;
    }

    var api = { FACTOR_COLUMNS: FACTOR_COLUMNS, parseNames: parseNames, summarize: summarize, examinerState: examinerState, examinerText: examinerText, counts: counts };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceBatch = api;
})(typeof window !== 'undefined' ? window : this);
