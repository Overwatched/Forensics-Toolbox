// Tidslinjen i Härkomst som SVG, utan bibliotek. Fem rader: Fil, Appar, Snapchat, Telefon (skärm
// och lås hopslagna till ett band) och Position. Ett lodrätt streck vid T. Översikten markerar
// närbildens ruta (opts.zoom), närbilden (opts.labels) skriver ut händelserna på bilden. Fasta
// ljusa färger så att bilden ser likadan ut i rapporten som på skärmen. Testas i Node.
(function (root) {
    'use strict';

    var LANES = [
        { id: 'file', label: 'Fil' },
        { id: 'app', label: 'Appar' },
        { id: 'snapchat', label: 'Snapchat' },
        { id: 'phone', label: 'Telefon' },
        { id: 'location', label: 'Position' },
    ];
    // Radfärgerna är kontrollerade mot varandra för färgblindhet och mot vit bakgrund.
    var COLORS = {
        bg: '#ffffff', text: '#1c1c1e', muted: '#6e6e73', grid: '#e5e5ea', lane: '#f7f7f9', t: '#d70015', zoom: '#007aff',
        app: '#2a78d6', camera: '#008300',
        on: '#9ec5f4', onLocked: '#d3e4f8', off: '#c7c7cc', offUnlocked: '#e5e5ea',
        file: '#1c1c1e', neighbour: '#a2a2a8', location: '#6250d6', exif: '#eb6834', snapchat: '#c98500',
    };
    var LEFT = 92;
    var RIGHT = 16;
    var TOP = 34;
    var LANE_H = 34;
    var LANE_H_LABELS = 48;
    var FOOTER = 54;
    var CHAR_W = 5.9;

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    function text(x, y, s, opts) {
        opts = opts || {};
        return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" font-family="Arial, Helvetica, sans-serif" font-size="' + (opts.size || 11) + '"' +
            ' fill="' + (opts.fill || COLORS.text) + '"' + (opts.anchor ? ' text-anchor="' + opts.anchor + '"' : '') + (opts.weight ? ' font-weight="' + opts.weight + '"' : '') + '>' + (opts.raw ? s : esc(s)) + '</text>';
    }

    // Avstånd mellan tidsmarkeringarna: 30 s, 1, 2, 5, 10, 15, 30 min eller timmar, så att det blir 4–8 stycken.
    function tickStep(spanMs) {
        var steps = [10000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000, 7200000, 21600000];
        for (var i = 0; i < steps.length; i++) if (spanMs / steps[i] <= 8) return steps[i];
        return steps[steps.length - 1];
    }

    // Skärm och lås blir ett band: vid varje brytpunkt i fönstret slås tillståndet ihop till
    // "tänd, olåst", "släckt, låst" osv. Saknas den ena strömmen står bara den andra.
    function phoneSegments(events, w) {
        var screen = events.filter(function (e) { return e.kind === 'screen' && e.endMs != null; });
        var lock = events.filter(function (e) { return e.kind === 'lock' && e.endMs != null; });
        if (!screen.length && !lock.length) return [];
        var cuts = [w.startMs, w.endMs];
        screen.concat(lock).forEach(function (e) { cuts.push(e.ms, e.endMs); });
        cuts = cuts.filter(function (t) { return t >= w.startMs && t <= w.endMs; }).sort(function (a, b) { return a - b; })
            .filter(function (t, i, a) { return i === 0 || t !== a[i - 1]; });
        var covers = function (e, t) { return e.ms <= t && t < e.endMs; };
        var out = [];
        for (var i = 0; i + 1 < cuts.length; i++) {
            var a = cuts[i], b = cuts[i + 1], mid = (a + b) / 2;
            var s = screen.find(function (e) { return covers(e, mid); });
            var l = lock.find(function (e) { return covers(e, mid); });
            if (!s && !l) continue;
            var on = s ? !!s.on : null;
            var locked = l ? !!l.locked : null;
            var label = [on == null ? null : on ? 'tänd' : 'släckt', locked == null ? null : locked ? 'låst' : 'olåst'].filter(Boolean).join(', ');
            var prev = out[out.length - 1];
            if (prev && prev.label === label && prev.endMs === a) { prev.endMs = b; continue; }
            out.push({ startMs: a, endMs: b, fromMs: Math.min(s ? s.ms : Infinity, l ? l.ms : Infinity), on: on, locked: locked, label: label });
        }
        return out;
    }

    function phoneColor(seg) {
        if (seg.on === true) return seg.locked === true ? COLORS.onLocked : COLORS.on;
        if (seg.on === false) return seg.locked === false ? COLORS.offUnlocked : COLORS.off;
        return seg.locked ? COLORS.off : COLORS.on;
    }

    // Kort text för en händelse i närbilden. null = ingen text, bara markören med sin tooltip.
    function shortLabel(e, model, appName) {
        var m;
        // En Snapchat-rad utan egen mening i förklaringen (t.ex. meddelandet som redan täcks av cacheraden) får ingen text.
        if (/^snap-/.test(e.kind) && !e.plain && !e.isFile) return null;
        switch (e.kind) {
            case 'file-created': return (model && model.file && model.file.filename ? model.file.filename + ' ' : '') + (model && model.type && model.type.type === 'snapchat' ? 'registreras' : 'skapas');
            case 'file-added': return 'Tillagd i biblioteket';
            case 'file-modified': return 'Ändrad';
            case 'exif': return 'EXIF i filen';
            case 'fs-mtime': return 'Ändringstid i zippen';
            case 'paired-video': return 'Live Photo-videon';
            case 'neighbour': m = /^Granne: (\S+)/.exec(e.text || ''); return m ? m[1] : 'Annan bild';
            case 'app': return appName ? appName(e.app) : e.app;
            case 'location':
                var q = model && model.positions ? model.positions.find(function (p) { return p.kind === 'phone' && p.ms === e.ms; }) : null;
                return 'Position' + (e.accuracy ? ' ±' + Math.round(e.accuracy) + ' m' : '') + (q && q.distanceM != null ? ' · ' + (q.distanceM < 1000 ? Math.round(q.distanceM) + ' m' : (q.distanceM / 1000).toFixed(1).replace('.', ',') + ' km') + ' från bilden' : '');
            case 'snap-message':
                if (e.isFile) return e.own ? 'Den bedömda filen skickas' : 'Den bedömda filen tas emot';
                m = /från (@\S+)$/.exec(e.plain || '');
                if (!e.own) return 'Snap' + (m ? ' från ' + m[1] : ' tas emot');
                m = /till (@\S+) från/.exec(e.plain || '');
                return 'Snap' + (m ? ' till ' + m[1] : ' skickas');
            case 'snap-read': return e.own ? 'Mottagaren öppnar den' : 'Öppnas på telefonen';
            case 'snap-notification': return e.notifType === 'snap' ? 'Notis: ny snap' : e.notifType === 'chat' ? 'Notis: nytt meddelande' : 'Notis från Snapchat';
            case 'snap-cache':
                if (e.isFile) return 'Den bedömda filen' + (e.context === 34 ? ' spelas in' : ' läggs i Snapchats cache');
                if (e.context === 34) return 'Video spelas in i Snapchat';
                if (e.sent) { m = /till (@\S+) från/.exec(e.plain || ''); return 'Snap' + (m ? ' till ' + m[1] : ' skickas'); }
                return e.plain ? 'Media ur Snapchat-chatten cachas' : null;
            case 'snap-cache-deleted': return e.isFile ? 'Den bedömda filen raderas ur cachen' : null;
            default: return null;
        }
    }

    function fmtTime(fmt, ms) { return fmt(ms).slice(11, 19); }

    // model: från ProvenanceCore.build. opts: { window, zoom, labels, width, format(ms) -> text, appName(id), title, footer }
    function svg(model, opts) {
        opts = opts || {};
        var w = opts.window || model.windows[0];
        var labels = !!opts.labels;
        var laneH = labels ? LANE_H_LABELS : LANE_H;
        var width = opts.width || 1000;
        var fmt = opts.format || function (ms) { return new Date(ms).toISOString().slice(0, 19).replace('T', ' '); };
        var appName = opts.appName || function (id) { return id; };
        var span = w.endMs - w.startMs;
        var plotW = width - LEFT - RIGHT;
        var plotRight = LEFT + plotW;
        var x = function (ms) { return LEFT + (ms - w.startMs) / span * plotW; };
        var clampX = function (ms) { return Math.max(LEFT, Math.min(plotRight, x(ms))); };
        var inWin = function (e) { return (e.ms <= w.endMs && (e.endMs != null ? e.endMs : e.ms) >= w.startMs); };
        var events = model.events.filter(inWin);
        var phone = phoneSegments(events, w);
        var laneOf = function (e) { return e.lane === 'camera' ? 'app' : e.lane; };
        var lanes = LANES.filter(function (l) {
            if (l.id === 'file' || l.id === 'app') return true;
            if (l.id === 'phone') return phone.length > 0;
            return events.some(function (e) { return laneOf(e) === l.id; });
        });
        var height = TOP + lanes.length * laneH + FOOTER;
        var out = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">';
        out += '<rect width="' + width + '" height="' + height + '" fill="' + COLORS.bg + '"/>';
        out += text(LEFT, 18, opts.title || ('Tidslinje ' + w.label), { size: 13, weight: 'bold' });

        // Raderna
        lanes.forEach(function (l, i) {
            var y = TOP + i * laneH;
            if (i % 2 === 0) out += '<rect x="' + LEFT + '" y="' + y + '" width="' + plotW + '" height="' + laneH + '" fill="' + COLORS.lane + '"/>';
            out += text(LEFT - 8, y + laneH / 2 + 4, l.label, { anchor: 'end', size: 11, fill: COLORS.muted });
        });
        var plotTop = TOP;
        var plotBottom = TOP + lanes.length * laneH;

        // Närbildens ruta i översikten
        if (opts.zoom && opts.zoom.endMs > w.startMs && opts.zoom.startMs < w.endMs) {
            var zx1 = clampX(opts.zoom.startMs), zx2 = clampX(opts.zoom.endMs);
            out += '<rect x="' + zx1.toFixed(1) + '" y="' + (plotTop - 4) + '" width="' + Math.max(2, zx2 - zx1).toFixed(1) + '" height="' + (plotBottom - plotTop + 8) + '" fill="' + COLORS.zoom + '" fill-opacity="0.10" stroke="' + COLORS.zoom + '" stroke-width="1"><title>Närbild ' + esc(fmtTime(fmt, opts.zoom.startMs) + ' till ' + fmtTime(fmt, opts.zoom.endMs)) + '</title></rect>';
        }

        // Tidsaxeln
        var step = tickStep(span);
        var first = Math.ceil(w.startMs / step) * step;
        for (var t = first; t <= w.endMs; t += step) {
            var tx = x(t);
            out += '<line x1="' + tx.toFixed(1) + '" y1="' + plotTop + '" x2="' + tx.toFixed(1) + '" y2="' + plotBottom + '" stroke="' + COLORS.grid + '" stroke-width="1"/>';
            out += text(tx, plotBottom + 14, step < 60000 ? fmtTime(fmt, t) : fmt(t).slice(11, 16), { anchor: 'middle', size: 10, fill: COLORS.muted });
        }
        out += '<line x1="' + LEFT + '" y1="' + plotBottom + '" x2="' + plotRight + '" y2="' + plotBottom + '" stroke="' + COLORS.muted + '" stroke-width="1"/>';

        // Textplacering i närbilden: två rader per spår, och en text får inte läggas ovanpå en
        // tidigare på samma rad. Texter som inte får plats till höger om markören skrivs till vänster.
        function placer() {
            var ends = [-Infinity, -Infinity];
            return function (leftPx, rightPx) {
                for (var r = 0; r < 2; r++) {
                    if (ends[r] <= leftPx) { ends[r] = rightPx; return r; }
                }
                return -1;
            };
        }
        function label(px, mid, place, parts, bold) {
            var s = parts.short + ' ' + parts.time;
            var wpx = s.length * CHAR_W;
            var flip = px + 10 + wpx > plotRight;
            var r = flip ? place(px - 10 - wpx, px + 6) : place(px + 6, px + 10 + wpx);
            if (r < 0) return '';
            var y = r === 0 ? mid - 5 : mid + 15;
            var raw = (bold ? '<tspan font-weight="bold">' : '<tspan>') + esc(parts.short) + '</tspan> <tspan fill="' + COLORS.muted + '">' + esc(parts.time) + '</tspan>';
            return text(flip ? px - 10 : px + 10, y, raw, { size: 10.5, raw: true, anchor: flip ? 'end' : null });
        }
        function marker(e, cx, mid) {
            var title = '<title>' + esc(e.text + ' ' + fmt(e.ms)) + '</title>';
            if (e.kind === 'location') return '<circle cx="' + cx.toFixed(1) + '" cy="' + mid + '" r="4" fill="' + COLORS.location + '" stroke="' + COLORS.bg + '" stroke-width="1.5">' + title + '</circle>';
            if (/^snap-/.test(e.kind)) {
                // Snapchat: triangel för meddelanden, cirkel för cacheposter, ring för läst, liten romb för notiser.
                var sr = e.isFile ? 7 : 4.5;
                var stroke = e.isFile ? ' stroke="' + COLORS.file + '" stroke-width="1.5"' : '';
                if (e.kind === 'snap-message') return '<polygon points="' + cx.toFixed(1) + ',' + (mid - sr - 1) + ' ' + (cx + sr + 1).toFixed(1) + ',' + (mid + sr) + ' ' + (cx - sr - 1).toFixed(1) + ',' + (mid + sr) + '" fill="' + COLORS.snapchat + '"' + stroke + '>' + title + '</polygon>';
                if (e.kind === 'snap-read') return '<circle cx="' + cx.toFixed(1) + '" cy="' + mid + '" r="' + sr + '" fill="' + COLORS.bg + '" stroke="' + COLORS.snapchat + '" stroke-width="2">' + title + '</circle>';
                if (e.kind === 'snap-notification') return '<polygon points="' + cx.toFixed(1) + ',' + (mid - 4) + ' ' + (cx + 4).toFixed(1) + ',' + mid + ' ' + cx.toFixed(1) + ',' + (mid + 4) + ' ' + (cx - 4).toFixed(1) + ',' + mid + '" fill="' + COLORS.snapchat + '" fill-opacity="0.6">' + title + '</polygon>';
                return '<circle cx="' + cx.toFixed(1) + '" cy="' + mid + '" r="' + sr + '" fill="' + COLORS.snapchat + '"' + stroke + '>' + title + '</circle>';
            }
            var color = e.neighbour ? COLORS.neighbour : e.kind === 'exif' || e.kind === 'fs-mtime' || e.kind === 'paired-video' ? COLORS.exif : COLORS.file;
            if (e.kind === 'file-created') return '<polygon points="' + cx.toFixed(1) + ',' + (mid - 8) + ' ' + (cx + 8).toFixed(1) + ',' + mid + ' ' + cx.toFixed(1) + ',' + (mid + 8) + ' ' + (cx - 8).toFixed(1) + ',' + mid + '" fill="' + color + '">' + title + '</polygon>';
            if (e.kind === 'file-added' || e.kind === 'file-modified') return '<rect x="' + (cx - 5).toFixed(1) + '" y="' + (mid - 5) + '" width="10" height="10" fill="none" stroke="' + color + '" stroke-width="2">' + title + '</rect>';
            return '<circle cx="' + cx.toFixed(1) + '" cy="' + mid + '" r="' + (e.neighbour ? 3 : 6) + '" fill="' + color + '">' + title + '</circle>';
        }

        // Händelserna per rad
        lanes.forEach(function (l, i) {
            var y = TOP + i * laneH;
            var mid = y + laneH / 2;
            var place = placer();
            if (l.id === 'phone') {
                phone.forEach(function (seg) {
                    var x1 = clampX(seg.startMs), x2 = clampX(seg.endMs);
                    var bw = Math.max(2, x2 - x1);
                    var s = seg.label + (labels && seg.fromMs < w.startMs ? ' sedan ' + fmtTime(fmt, seg.fromMs) : '');
                    out += '<rect x="' + x1.toFixed(1) + '" y="' + (mid - 9) + '" width="' + bw.toFixed(1) + '" height="18" rx="3" fill="' + phoneColor(seg) + '" stroke="' + COLORS.bg + '" stroke-width="1"><title>' +
                        esc(seg.label + ': ' + fmt(seg.startMs) + ' – ' + fmt(seg.endMs)) + '</title></rect>';
                    if (bw > s.length * CHAR_W + 8) out += text(x1 + 4, mid + 4, s, { size: 10, fill: COLORS.text });
                    else if (bw > seg.label.length * CHAR_W + 8) out += text(x1 + 4, mid + 4, seg.label, { size: 10, fill: COLORS.text });
                });
                return;
            }
            var laneEvents = events.filter(function (e) { return laneOf(e) === l.id && e.kind !== 'screen' && e.kind !== 'lock'; });
            // Intervall först, sedan deras texter, så att en tätt följande stapel inte täcker texten.
            var barLabels = '';
            laneEvents.filter(function (e) { return e.endMs != null; }).forEach(function (e) {
                var x1 = clampX(e.ms), x2 = clampX(e.endMs);
                var fill = e.lane === 'camera' ? COLORS.camera : COLORS.app;
                var bw = Math.max(2, x2 - x1);
                var name = appName(e.app) || e.app || '';
                out += '<rect x="' + x1.toFixed(1) + '" y="' + (mid - 9) + '" width="' + bw.toFixed(1) + '" height="18" rx="3" fill="' + fill + '" stroke="' + COLORS.bg + '" stroke-width="1"><title>' +
                    esc(e.text + ': ' + fmt(e.ms) + ' – ' + fmt(e.endMs)) + '</title></rect>';
                var long = name + ' ' + fmtTime(fmt, e.ms) + ' → ' + fmtTime(fmt, e.endMs);
                var s = labels && bw > long.length * CHAR_W + 8 ? long : bw > name.length * CHAR_W + 8 ? name : '';
                if (s) barLabels += '<clipPath id="b' + e.id + '"><rect x="' + x1.toFixed(1) + '" y="' + (mid - 9) + '" width="' + bw.toFixed(1) + '" height="18"/></clipPath><g clip-path="url(#b' + e.id + ')">' + text(x1 + 4, mid + 4, s, { size: 10, fill: '#ffffff' }) + '</g>';
            });
            out += barLabels;
            var points = laneEvents.filter(function (e) { return e.endMs == null; });
            if (l.id === 'file' && labels) {
                // Filens egna tidpunkter inom två sekunder blir en text: "IMG_0042.HEIC skapas · EXIF i filen 14:31:30".
                var groups = [];
                points.forEach(function (e) {
                    var g = !e.neighbour && groups.length && !groups[groups.length - 1].neighbour && Math.abs(groups[groups.length - 1].ms - e.ms) <= 2000 ? groups[groups.length - 1] : null;
                    if (g) g.items.push(e); else groups.push({ ms: e.ms, neighbour: !!e.neighbour, items: [e] });
                });
                groups.forEach(function (g) {
                    g.items.forEach(function (e) { out += marker(e, x(e.ms), mid); });
                    var shorts = g.items.map(function (e) { return shortLabel(e, model, appName); }).filter(Boolean);
                    if (shorts.length) out += label(x(g.ms), mid, place, { short: shorts.join(' · '), time: fmtTime(fmt, g.ms) }, g.items.some(function (e) { return e.kind === 'file-created'; }));
                });
            } else {
                points.forEach(function (e) {
                    var cx = x(e.ms);
                    out += marker(e, cx, mid);
                    if (labels) {
                        var s = shortLabel(e, model, appName);
                        if (s) out += label(cx, mid, place, { short: s, time: fmtTime(fmt, e.ms) }, !!e.isFile);
                    }
                });
            }
        });

        // T
        var tX = x(w.centerMs);
        out += '<line x1="' + tX.toFixed(1) + '" y1="' + (plotTop - 6) + '" x2="' + tX.toFixed(1) + '" y2="' + plotBottom + '" stroke="' + COLORS.t + '" stroke-width="1.5" stroke-dasharray="4 3"/>';
        out += text(tX + 4, plotTop - 2, 'T ' + fmtTime(fmt, w.centerMs), { size: 10, fill: COLORS.t, weight: 'bold' });

        // Förklaring och fot
        var ly = plotBottom + 32;
        var legend = [['◆', 'Skapad', COLORS.file], ['□', 'Tillagd/Ändrad', COLORS.file], ['●', 'EXIF/filsystem', COLORS.exif], ['•', 'Andra bilder', COLORS.neighbour], ['▬', 'App', COLORS.app], ['▬', 'Kamera', COLORS.camera]];
        if (phone.length) legend.push(['▬', 'Tänd', COLORS.on], ['▬', 'Släckt', COLORS.off]);
        if (events.some(function (e) { return e.lane === 'snapchat'; })) legend.push(['▲', 'Snapchat', COLORS.snapchat]);
        if (events.some(function (e) { return e.lane === 'location'; })) legend.push(['●', 'Position', COLORS.location]);
        if (opts.zoom) legend.push(['▭', 'Närbild', COLORS.zoom]);
        var lx = LEFT;
        legend.forEach(function (item) {
            out += text(lx, ly, item[0], { size: 11, fill: item[2] });
            out += text(lx + 14, ly, item[1], { size: 10, fill: COLORS.muted });
            lx += 14 + item[1].length * 6.2 + 16;
        });
        out += text(LEFT, ly + 16, opts.footer || '', { size: 9, fill: COLORS.muted });
        return out + '</svg>';
    }

    var api = { svg: svg, tickStep: tickStep, phoneSegments: phoneSegments, shortLabel: shortLabel, LANES: LANES, COLORS: COLORS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceTimeline = api;
})(typeof window !== 'undefined' ? window : this);
