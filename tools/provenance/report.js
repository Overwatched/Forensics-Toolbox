// Härkomsts två exporter, byggda ur samma modell: protokollet med alla källor, sökvägar,
// hashar och SQL, och förklaringen i vanlig svenska utan något av det. Båda är HTML med
// inline-stilar, så att Word gör tabeller och rubriker av dem vid inklistring. Testas i Node.
(function (root) {
    'use strict';

    var FONT = 'font-family: Arial, Helvetica, sans-serif;';
    var TD = 'border: 1px solid #999; padding: 3px 6px; vertical-align: top; font-size: 10pt;';
    var TH = TD + ' background: #e8e8e8; text-align: left; font-weight: bold;';
    var TABLE = 'border-collapse: collapse; margin: 6px 0 12px;';
    var STATE_COLOR = { support: '#1a7f37', contradiction: '#c62828', missing: '#8a6d00', info: '#444', na: '#777' };

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function h(level, text) { return '<h' + level + ' style="' + FONT + ' margin: 14px 0 6px;">' + esc(text) + '</h' + level + '>'; }
    function p(html) { return '<p style="' + FONT + ' font-size: 10.5pt; margin: 4px 0;">' + html + '</p>'; }

    function table(head, rows) {
        var out = '<table style="' + TABLE + '">';
        if (head) out += '<tr>' + head.map(function (c) { return '<th style="' + TH + '">' + esc(c) + '</th>'; }).join('') + '</tr>';
        rows.forEach(function (r) {
            out += '<tr>' + r.map(function (c) { return '<td style="' + TD + '">' + (c && c.html ? c.html : esc(c)) + '</td>'; }).join('') + '</tr>';
        });
        return out + '</table>';
    }

    function kv(rows) { return table(null, rows.map(function (r) { return [{ html: '<b>' + esc(r[0]) + '</b>' }, r[1]]; })); }

    function stateTag(model, state) {
        return '<span style="color: ' + (STATE_COLOR[state] || '#444') + '; font-weight: bold;">' + esc(model.stateLabel[state] || state) + '</span>';
    }

    function imageHtml(png, alt) {
        if (!png) return '';
        return '<p style="margin: 8px 0;"><img src="' + png + '" alt="' + esc(alt) + '" style="max-width: 100%; height: auto;"></p>';
    }

    function sourceText(src) {
        if (!src) return '';
        var parts = [src.db, src.table || src.stream, src.column].filter(Boolean);
        if (src.stream && src.table) parts = [src.db, src.table + ' ' + src.stream, src.column].filter(Boolean);
        return parts.join(' → ');
    }

    function eventValue(e) {
        if (e.kind === 'app') return e.app || '';
        if (e.kind === 'screen') return e.on ? 'tänd' : 'släckt';
        if (e.kind === 'lock') return e.locked ? 'låst' : 'olåst';
        if (e.kind === 'location') return e.lat.toFixed(5) + ', ' + e.lon.toFixed(5) + ' ±' + Math.round(e.accuracy) + ' m';
        return '';
    }

    // meta: { extraction: { name, size, lastModified }, deviceLabel, zoneLabel, zoneNote, toolVersion, createdText,
    //         format(ms), formatUtc(ms), fileRows: [[kolumn, värde]], exifRows: [[tagg, värde]], fileEntry: { path, size, mtime, crc32, sha256 } | null,
    //         sources: [{ label, path, size, mtime, crc32, sha256, walPath, walCrc32, walSha256, walSummary, warnings: [] }],
    //         queries: [{ id, db, title, sql }], coverage: [[ström, första, sista, rader]], timelinePngs: [dataUrl per fönster] }
    function protocol(model, meta) {
        var fmt = meta.format;
        var fmtUtc = meta.formatUtc;
        var out = '<div style="' + FONT + '">';
        out += h(1, 'Härkomst: ' + model.file.filename);
        out += kv([
            ['Extraktion', meta.extraction ? meta.extraction.name + ' (' + meta.extraction.size + ' byte, ändrad ' + meta.extraction.lastModified + ')' : 'filer valda för hand'],
            ['Enhet', meta.deviceLabel || model.platform],
            ['Tidszon i rapporten', meta.zoneLabel + (meta.zoneNote ? ' (' + meta.zoneNote + ')' : '')],
            ['Tidpunkt T (Skapad)', model.file.createdMs ? fmt(model.file.createdMs) + ' · ' + fmtUtc(model.file.createdMs) : 'saknas'],
            ['Fönster', model.windows.map(function (w) { return w.label + ': ' + fmt(w.startMs) + ' till ' + fmt(w.endMs); }).join('; ')],
            ['Program', 'Forensics Toolbox ' + (meta.toolVersion || '') + ', verktyget Härkomst'],
            ['Rapporten skapad', meta.createdText || ''],
        ]);
        if (meta.sampleNote) out += p('<b>' + esc(meta.sampleNote) + '</b>');
        if (model.warnings.length) out += p('<b>Varningar:</b> ' + model.warnings.map(esc).join(' '));

        out += h(2, '1. Filen');
        out += table(['Kolumn', 'Värde'], meta.fileRows || []);
        if (meta.fileEntry) {
            out += p('<b>Bildfilen i zippen:</b> ' + esc(meta.fileEntry.path) + ' (' + esc(meta.fileEntry.size) + ' byte, ändrad ' + esc(meta.fileEntry.mtime) +
                ', CRC32 ' + esc(meta.fileEntry.crc32) + (meta.fileEntry.crcOk === false ? ' STÄMMER INTE' : '') + (meta.fileEntry.sha256 ? ', SHA-256 ' + esc(meta.fileEntry.sha256) : '') + ')');
            if (meta.exifRows && meta.exifRows.length) out += table(['EXIF-tagg i filen', 'Värde'], meta.exifRows);
        } else if (meta.fileMissingReason) {
            out += p('<b>Bildfilen:</b> ' + esc(meta.fileMissingReason));
        }

        out += h(2, '2. Bedömning');
        out += p('<b>Typ av fil:</b> ' + esc(model.type.label) + (model.type.reasons.length ? ' (' + esc(model.type.reasons.join(', ')) + ')' : '') +
            (model.type.flags.length ? '. Flaggor: ' + esc(model.type.flags.join(', ')) : ''));
        out += p('<b>Sammanfattning:</b> ' + esc(model.summary));
        model.factors.forEach(function (f) {
            out += h(3, f.title + ': ' + model.stateLabel[f.state]);
            out += '<ul style="' + FONT + ' font-size: 10pt; margin: 2px 0 6px 18px;">' + f.items.map(function (i) {
                return '<li>' + stateTag(model, i.state) + ' ' + esc(i.text) + '</li>';
            }).join('') + '</ul>';
        });
        if (model.alternatives.length) {
            out += h(3, 'Alternativa förklaringar');
            out += table(['Förklaring', 'Talar för', 'Talar emot'], model.alternatives.map(function (a) {
                return [a.label, a.for.length ? a.for.join(' ') : 'Inget i materialet.', a.against.length ? a.against.join(' ') : 'Inget i materialet.'];
            }));
        }

        out += h(2, '3. Tidslinje');
        model.windows.forEach(function (w, i) {
            out += p('<b>' + esc(w.label.charAt(0).toUpperCase() + w.label.slice(1)) + '</b>');
            out += imageHtml(meta.timelinePngs && meta.timelinePngs[i], 'Tidslinje ' + w.label);
        });
        if (model.outside) out += p(esc(model.outside + ' registreringar till finns utanför fönstren och visas inte.'));

        out += h(2, '4. Händelser');
        out += table(['Tid (' + meta.zoneLabel + ')', 'UTC', 'Händelse', 'Värde', 'Till', 'Källa', 'Query'], model.events.map(function (e) {
            return [fmt(e.ms), fmtUtc(e.ms), e.text, eventValue(e), e.endMs != null ? fmt(e.endMs) + (e.openEnded ? ' (pågår)' : '') : '', sourceText(e.source), e.source && e.source.queryId || ''];
        }));

        out += h(2, '5. Källor');
        (meta.sources || []).forEach(function (s) {
            out += h(3, s.label);
            var rows = [['Sökväg i zippen', s.path], ['Storlek', s.size + ' byte'], ['Ändrad enligt zippen', s.mtime], ['CRC32', s.crc32 + (s.crcOk === false ? ' STÄMMER INTE' : '')], ['SHA-256', s.sha256]];
            if (s.walPath) rows.push(['-wal', s.walPath], ['-wal CRC32', s.walCrc32], ['-wal SHA-256', s.walSha256]);
            rows.push(['WAL', s.walSummary]);
            if (s.warnings && s.warnings.length) rows.push(['Varningar', s.warnings.join(' ')]);
            out += kv(rows);
        });
        if (meta.coverage && meta.coverage.length) {
            out += h(3, 'Strömmarnas täckning');
            out += table(['Ström', 'Första', 'Sista', 'Rader'], meta.coverage);
        }

        out += h(2, 'Bilaga: SQL');
        (meta.queries || []).forEach(function (q) {
            out += p('<b>' + esc(q.id) + '</b> (' + esc(q.db) + ') ' + esc(q.title || ''));
            out += '<pre style="font-family: Consolas, monospace; font-size: 9pt; white-space: pre-wrap; border: 1px solid #ccc; padding: 6px; margin: 4px 0 10px;">' + esc(q.sql) + '</pre>';
        });
        return out + '</div>';
    }

    function timeOnly(fmt, ms) { return fmt(ms).slice(11, 19); }

    // Förklaringen: inga hashar, sökvägar, kolumnnamn eller bundle-id.
    function explanation(model, meta) {
        var fmt = meta.format;
        var out = '<div style="' + FONT + '">';
        var name = model.file.filename;
        var noun = model.type.type === 'screenshot' ? 'skärmdumpen' : 'bilden';
        out += h(1, 'Vad telefonen registrerade kring ' + noun + ' ' + name);
        var minutes = model.windows.length ? Math.round((model.windows[0].endMs - model.windows[0].centerMs) / 60000) : 0;
        if (meta.sampleNote) out += p('<b>' + esc(meta.sampleNote) + '</b>');
        out += p(esc('Här är ' + noun + ' ' + name + ' på telefonen, och vad telefonen själv registrerade ' + minutes + ' minuter före och efter. Klockslagen är i ' + meta.zoneLabel + '.'));

        model.narrative.forEach(function (n, i) {
            if (model.narrative.length > 1) out += h(2, (i + 1) + '. ' + n.window.label.charAt(0).toUpperCase() + n.window.label.slice(1) + ', ' + fmt(n.window.centerMs).slice(0, 10));
            else out += h(2, fmt(n.window.centerMs).slice(0, 10));
            if (!n.lines.length) out += p('Inga registreringar i det här fönstret.');
            out += '<table style="' + TABLE + '">' + n.lines.map(function (l) {
                var text = esc(l.text);
                return '<tr><td style="' + TD + ' border: none; padding: 2px 10px 2px 0; white-space: nowrap;">' + timeOnly(fmt, l.ms) + '</td>' +
                    '<td style="' + TD + ' border: none; padding: 2px 0;">' + (l.bold ? '<b>' + text + '</b>' : text) + '</td></tr>';
            }).join('') + '</table>';
            n.notes.forEach(function (note) { out += p(esc(note)); });
            out += imageHtml(meta.timelinePngs && meta.timelinePngs[i], 'Tidslinje');
        });

        out += h(2, 'Vad det betyder');
        out += p(esc('Enligt telefonens egen bokföring är det här en ' + model.type.label.toLowerCase() + '.'));
        model.factors.forEach(function (f) { out += p('<b>' + esc(f.title) + '.</b> ' + esc(f.plain)); });
        out += p('<b>' + esc(model.summary) + '</b>');
        out += p(esc('Bedömningen säger vad som är förenligt med telefonens registreringar. Den säger inte vem som höll i telefonen.'));
        var walWarnings = (meta.sources || []).filter(function (s) { return s.warnings && s.warnings.some(function (w) { return /-wal/.test(w); }); });
        if (walWarnings.length) {
            out += p(esc('En del av telefonens registreringar lästes utan sin senaste loggfil, så den senaste tidens registreringar kan saknas.'));
        }
        if (meta.zoneNote) out += p(esc('Tidszonen är ' + meta.zoneNote + '.'));
        return out + '</div>';
    }

    // Ren text av samma innehåll, till urklippets text/plain.
    function plainText(html) {
        return String(html)
            .replace(/<\/(h[1-6]|p|tr|li|pre|div)>/gi, '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/t[dh]>/gi, '\t')
            .replace(/<img[^>]*>/gi, '[tidslinje]')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
            .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    // En fristående HTML-fil för arkivering.
    function standalone(title, bodyHtml) {
        return '<!DOCTYPE html>\n<html lang="sv"><head><meta charset="utf-8"><title>' + esc(title) + '</title></head>' +
            '<body style="max-width: 1000px; margin: 24px auto; padding: 0 16px; color: #1c1c1e; background: #fff;">' + bodyHtml + '</body></html>\n';
    }

    var api = { protocol: protocol, explanation: explanation, plainText: plainText, standalone: standalone, esc: esc };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceReport = api;
})(typeof window !== 'undefined' ? window : this);
