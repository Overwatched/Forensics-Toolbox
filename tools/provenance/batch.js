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

    // ---------- Listor från disk ----------

    var LIST_FILE = /\.(txt|csv|tsv|lst|list|md5|sha1|sha256|md5sum|sha1sum|sha256sum|hash|hashes)$/i;
    // Format som kan se ut som en lista för den som valde dem, men inte går att läsa här.
    var OFFICE_FILE = /\.(xlsx|xlsm|xls|ods|numbers|docx|doc|odt|pdf)$/i;
    var BSD_LINE = /^(?:MD5|SHA-?1|SHA-?256)\s*\(.*\)\s*=\s*([0-9a-fA-F]{32}|[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/i;
    var HEAD_HASH = /^(md5(\s*sum)?|sha-?1|sha-?256|hash(\s*value)?|hashv[aä]rde|hashsumma|checksum)$/i;
    var HEAD_NAME = /^(file\s*name|filename|filnamn|name|namn|zfilename|_?display_name|file|fil|path|full\s*path|s[oö]kv[aä]g)$/i;

    function isListFile(name) { return LIST_FILE.test(String(name)); }
    function isOfficeFile(name) { return OFFICE_FILE.test(String(name)); }

    // Text har inga nollbytes, utom UTF-16, som känns igen på sin BOM.
    function looksLikeText(bytes) {
        if (bytes.length > 1 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) return true;
        for (var i = 0; i < Math.min(bytes.length, 65536); i++) if (bytes[i] === 0) return false;
        return true;
    }

    // UTF-8 eller UTF-16 med BOM, annars UTF-8, annars Windows-1252 (en CSV-fil ur Excel med å, ä och ö).
    function decodeList(bytes) {
        if (bytes.length > 1 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
        if (bytes.length > 1 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
        try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
    }

    // Avgränsaren i en tabell: den vanligaste av tabb, semikolon och komma på första raden.
    function delimiterOf(line) {
        var best = '';
        var most = 0;
        ['\t', ';', ','].forEach(function (d) {
            var n = line.split(d).length - 1;
            if (n > most) { most = n; best = d; }
        });
        return best;
    }

    // En rad i en tabell, med citattecken runt celler som innehåller avgränsaren.
    function splitRow(line, delim) {
        if (!delim) return [line];
        var cells = [];
        var cur = '';
        var quoted = false;
        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (ch === '"') {
                if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
                else quoted = !quoted;
            } else if (ch === delim && !quoted) { cells.push(cur); cur = ''; }
            else cur += ch;
        }
        cells.push(cur);
        return cells;
    }

    function isHash(x) { return HASH.test(x); }
    function isFileName(x) { return EXT.test(x); }

    // Filerna på en rad utan rubrik. Summan går före namnet: "IMG_0001.HEIC;d41d8…" är samma fil. En rad med
    // bara namn eller bara summor är flera filer. Annars står filnamnet först ("IMG_0001.HEIC,12345,2024-06-01"),
    // eller så är hela raden ett namn ("Bild, kopia.jpg").
    function fromRow(line) {
        var bsd = BSD_LINE.exec(line);
        if (bsd) return [bsd[1]];
        var whole = clean(line);
        if (isHash(whole)) return [whole];
        var sum = HASH_LINE.exec(line);
        if (sum) return [sum[1]];
        var cells = splitRow(line, delimiterOf(line)).map(clean).filter(Boolean);
        if (cells.length < 2) return whole ? [baseName(whole)] : [];
        var hashes = cells.filter(isHash);
        if (hashes.length === cells.length) return cells;
        if (hashes.length) return [hashes[0]];
        if (cells.every(isFileName)) return cells.map(baseName);
        return [baseName(isFileName(cells[0]) ? cells[0] : whole)];
    }

    // En textfil med filnamn eller hashsummor: en per rad, en rad ur md5sum eller shasum, eller en tabell. Har
    // tabellen en rubrikrad används kolumnen med summan, annars den med filnamnet. Rader med # är kommentarer
    // (en CSV-fil ur Queries börjar med sådana). Returnerar { names, hashes, files, skipped, column }.
    function parseList(text) {
        var rows = String(text == null ? '' : text).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
            .map(function (l) { return l.trim(); })
            .filter(function (l) { return l && !/^(#|%%%%|\/\/)/.test(l); });
        var out = [];
        var seen = {};
        var skipped = 0;
        var add = function (name) {
            if (name && !seen[name]) { seen[name] = true; out.push(name); }
        };
        var column = '';
        var delim = rows.length ? delimiterOf(rows[0]) : '';
        var head = rows.length ? splitRow(rows[0], delim).map(clean) : [];
        var hashAt = head.findIndex(function (c) { return HEAD_HASH.test(c); });
        var nameAt = head.findIndex(function (c) { return HEAD_NAME.test(c); });
        if (hashAt >= 0 || nameAt >= 0) {
            column = head[hashAt >= 0 ? hashAt : nameAt];
            rows.slice(1).forEach(function (line) {
                var cells = splitRow(line, delim).map(clean);
                var value = hashAt >= 0 && isHash(cells[hashAt] || '') ? cells[hashAt] : nameAt >= 0 ? baseName(cells[nameAt] || '') : '';
                if (value) add(value);
                else skipped++;
            });
        } else {
            // En rubrik med okända namn: första raden har inget filnamn eller summa, men det har andra raden.
            var named = function (line) { return splitRow(line, delimiterOf(line)).map(clean).some(function (c) { return isHash(c) || isFileName(c); }); };
            var first = delim && rows.length > 1 && !named(rows[0]) && named(rows[1]) ? 1 : 0;
            rows.slice(first).forEach(function (line) { fromRow(line).forEach(add); });
        }
        var hashes = out.filter(isHash).length;
        return { names: out, hashes: hashes, files: out.length - hashes, skipped: skipped, column: column };
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

    // ---------- Lägen, märken och urval i listan ----------

    // Radens läge i ord, som det står i listan och i urvalet ovanför den.
    var STATUS_WORD = { done: 'Med underlag', ambiguous: 'Flera träffar', missing: 'Finns inte', error: 'Kunde inte bedömas', stopped: 'Avbruten', waiting: 'Väntar' };

    // En faktors läge som tecken. Tecknet står ihop med ordet, så att läget går att läsa utan färgen.
    var STATE_SIGN = { support: '✓', contradiction: '✕', missing: '?', info: 'i', na: '–' };
    // Vad varje läge betyder, till förklaringen ovanför listan. Samma ord som i protokollet för en fil.
    var STATE_MEANING = [
        ['support', 'stämmer med det typen säger om hur filen kom till'],
        ['contradiction', 'stämmer inte utan vidare, och behöver förklaras'],
        ['missing', 'registreringar saknas, så faktorn säger inget åt något håll'],
        ['info', 'väger inte åt något håll'],
        ['na', 'frågan gäller inte den här typen av fil'],
    ];

    // Grupperna i urvalet, i den ordning de står. 'contradiction' är filer med underlag där minst en faktor inte är förenlig.
    var GROUPS = [
        ['', 'Alla'], ['done', STATUS_WORD.done], ['contradiction', 'Något inte förenligt'], ['ambiguous', STATUS_WORD.ambiguous],
        ['missing', STATUS_WORD.missing], ['error', STATUS_WORD.error], ['stopped', 'Avbrutna'],
    ];

    function inGroup(row, group) {
        if (!group) return true;
        if (group !== 'contradiction') return row.status === group;
        var f = row.status === 'done' && row.summary ? row.summary.factors : {};
        return Object.keys(f).some(function (id) { return f[id].state === 'contradiction'; });
    }

    // Hur många rader varje grupp har: { '': 70, done: 68, contradiction: 2, … }.
    function groupCounts(rows) {
        var out = {};
        GROUPS.forEach(function (g) { out[g[0]] = (rows || []).filter(function (r) { return inGroup(r, g[0]); }).length; });
        return out;
    }

    // Texten som sökningen i listan går mot: namnet, det som söktes, sökvägen, mappen, typen, T, radens läge och
    // programmets sammanvägning, där appen som sparade filen står.
    function rowText(row) {
        var s = row.summary || {};
        var it = row.item || {};
        return [row.name, it.hash, it.path, s.filename, s.path, s.place, s.typeLabel, s.tText, s.summary, row.note, row.status === 'done' ? '' : STATUS_WORD[row.status]]
            .filter(Boolean).join('\n').toLowerCase();
    }

    // filter: { text, group }. Varje ord i texten ska finnas någonstans på raden, och raden ska höra till gruppen.
    function matches(row, filter) {
        filter = filter || {};
        if (!inGroup(row, filter.group || '')) return false;
        var words = String(filter.text || '').toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) return true;
        var hay = rowText(row);
        return words.every(function (w) { return hay.indexOf(w) >= 0; });
    }

    // Texten vid stapeln medan listan körs: hur många som är klara, och ungefär hur lång tid som är kvar räknat
    // på filerna hittills. Tiden står först efter tre filer och två sekunder, när det finns något att räkna på.
    function progressText(done, total, elapsedMs) {
        var text = done + ' av ' + total + ' klara';
        if (done < 3 || done >= total || !(elapsedMs >= 2000)) return text;
        var left = elapsedMs / done * (total - done) / 1000;
        if (left < 8) return text + ' · några sekunder kvar';
        return text + ' · ungefär ' + (left < 90 ? Math.round(left / 5) * 5 + ' s' : Math.round(left / 60) + ' min') + ' kvar';
    }

    // En rad med flera träffar som en rad per träff. choices: det som skiljer träffarna åt ({ pk } för en rad i
    // bildbiblioteket, { path } för en post i zippen). Varje ny post är den gamla med valet och träffens nummer.
    function hitItems(item, choices) {
        return (choices || []).map(function (c, n) {
            var out = {};
            Object.keys(item || {}).forEach(function (k) { out[k] = item[k]; });
            Object.keys(c).forEach(function (k) { out[k] = c[k]; });
            out.hit = { n: n + 1, of: choices.length };
            return out;
        });
    }

    var api = {
        FACTOR_COLUMNS: FACTOR_COLUMNS, parseNames: parseNames, isListFile: isListFile, isOfficeFile: isOfficeFile, looksLikeText: looksLikeText, decodeList: decodeList, parseList: parseList,
        summarize: summarize, examinerState: examinerState, examinerText: examinerText, counts: counts,
        STATUS_WORD: STATUS_WORD, STATE_SIGN: STATE_SIGN, STATE_MEANING: STATE_MEANING, GROUPS: GROUPS, inGroup: inGroup, groupCounts: groupCounts,
        rowText: rowText, matches: matches, progressText: progressText, hitItems: hitItems,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceBatch = api;
})(typeof window !== 'undefined' ? window : this);
