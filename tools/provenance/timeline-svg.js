// Tidslinjen i Härkomst som SVG, utan bibliotek. En rad per källa, ett lodrätt streck vid T,
// och fasta ljusa färger så att bilden ser likadan ut i rapporten som på skärmen. Testas i Node.
(function (root) {
    'use strict';

    var LANES = [
        { id: 'file', label: 'Fil' },
        { id: 'app', label: 'App igång' },
        { id: 'camera', label: 'Kamera' },
        { id: 'screen', label: 'Skärm' },
        { id: 'lock', label: 'Lås' },
        { id: 'location', label: 'Position' },
    ];
    var COLORS = {
        bg: '#ffffff', text: '#1c1c1e', muted: '#6e6e73', grid: '#e5e5ea', lane: '#f7f7f9', t: '#ff3b30',
        app: '#0a84ff', camera: '#30d158', screenOn: '#ffd60a', screenOff: '#8e8e93', locked: '#8e8e93', unlocked: '#64d2ff',
        file: '#1c1c1e', neighbour: '#a2a2a8', location: '#bf5af2', exif: '#ff9f0a',
    };
    var LEFT = 92;
    var RIGHT = 16;
    var TOP = 34;
    var LANE_H = 34;
    var FOOTER = 54;

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    function text(x, y, s, opts) {
        opts = opts || {};
        return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" font-family="Arial, Helvetica, sans-serif" font-size="' + (opts.size || 11) + '"' +
            ' fill="' + (opts.fill || COLORS.text) + '"' + (opts.anchor ? ' text-anchor="' + opts.anchor + '"' : '') + (opts.weight ? ' font-weight="' + opts.weight + '"' : '') + '>' + esc(s) + '</text>';
    }

    // Avstånd mellan tidsmarkeringarna: 1, 2, 5, 10, 15, 30 min eller 1 h, så att det blir 4–8 stycken.
    function tickStep(spanMs) {
        var steps = [30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000, 7200000, 21600000];
        for (var i = 0; i < steps.length; i++) if (spanMs / steps[i] <= 8) return steps[i];
        return steps[steps.length - 1];
    }

    // model: från ProvenanceCore.build. opts: { window, width, format(ms) -> text, title, footer }
    function svg(model, opts) {
        opts = opts || {};
        var w = opts.window || model.windows[0];
        var width = opts.width || 1000;
        var fmt = opts.format || function (ms) { return new Date(ms).toISOString().slice(11, 19); };
        var span = w.endMs - w.startMs;
        var plotW = width - LEFT - RIGHT;
        var x = function (ms) { return LEFT + (ms - w.startMs) / span * plotW; };
        var clampX = function (ms) { return Math.max(LEFT, Math.min(LEFT + plotW, x(ms))); };
        var inWin = function (e) { return (e.ms <= w.endMs && (e.endMs != null ? e.endMs : e.ms) >= w.startMs); };
        var events = model.events.filter(inWin);
        var lanes = LANES.filter(function (l) {
            if (l.id === 'file' || l.id === 'app' || l.id === 'camera' || l.id === 'screen') return true;
            return events.some(function (e) { return e.lane === l.id; });
        });
        var height = TOP + lanes.length * LANE_H + FOOTER;
        var out = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">';
        out += '<rect width="' + width + '" height="' + height + '" fill="' + COLORS.bg + '"/>';
        out += text(LEFT, 18, opts.title || ('Tidslinje ' + w.label), { size: 13, weight: 'bold' });

        // Raderna
        lanes.forEach(function (l, i) {
            var y = TOP + i * LANE_H;
            if (i % 2 === 0) out += '<rect x="' + LEFT + '" y="' + y + '" width="' + plotW + '" height="' + LANE_H + '" fill="' + COLORS.lane + '"/>';
            out += text(LEFT - 8, y + LANE_H / 2 + 4, l.label, { anchor: 'end', size: 11, fill: COLORS.muted });
        });
        var plotTop = TOP;
        var plotBottom = TOP + lanes.length * LANE_H;

        // Tidsaxeln
        var step = tickStep(span);
        var first = Math.ceil(w.startMs / step) * step;
        for (var t = first; t <= w.endMs; t += step) {
            var tx = x(t);
            out += '<line x1="' + tx.toFixed(1) + '" y1="' + plotTop + '" x2="' + tx.toFixed(1) + '" y2="' + plotBottom + '" stroke="' + COLORS.grid + '" stroke-width="1"/>';
            out += text(tx, plotBottom + 14, fmt(t).slice(11, 16), { anchor: 'middle', size: 10, fill: COLORS.muted });
        }
        out += '<line x1="' + LEFT + '" y1="' + plotBottom + '" x2="' + (LEFT + plotW) + '" y2="' + plotBottom + '" stroke="' + COLORS.muted + '" stroke-width="1"/>';

        // Händelserna per rad
        lanes.forEach(function (l, i) {
            var y = TOP + i * LANE_H;
            var mid = y + LANE_H / 2;
            events.filter(function (e) { return e.lane === l.id; }).forEach(function (e) {
                if (e.endMs != null) {
                    var x1 = clampX(e.ms), x2 = clampX(e.endMs);
                    var fill = e.kind === 'app' ? (l.id === 'camera' ? COLORS.camera : COLORS.app)
                        : e.kind === 'screen' ? (e.on ? COLORS.screenOn : COLORS.screenOff)
                            : e.kind === 'lock' ? (e.locked ? COLORS.locked : COLORS.unlocked) : COLORS.app;
                    var bw = Math.max(2, x2 - x1);
                    out += '<rect x="' + x1.toFixed(1) + '" y="' + (mid - 9) + '" width="' + bw.toFixed(1) + '" height="18" rx="3" fill="' + fill + '" fill-opacity="0.85"><title>' +
                        esc(e.text + ': ' + fmt(e.ms) + ' – ' + fmt(e.endMs)) + '</title></rect>';
                    var label = e.kind === 'app' ? (opts.appName ? opts.appName(e.app) : e.app) : e.kind === 'screen' ? (e.on ? 'tänd' : 'släckt') : (e.locked ? 'låst' : 'olåst');
                    if (bw > 36) out += '<clipPath id="c' + e.id + '"><rect x="' + x1.toFixed(1) + '" y="' + (mid - 9) + '" width="' + bw.toFixed(1) + '" height="18"/></clipPath>' +
                        '<g clip-path="url(#c' + e.id + ')">' + text(x1 + 4, mid + 4, label, { size: 10, fill: e.kind === 'screen' && e.on ? COLORS.text : '#ffffff' }) + '</g>';
                } else if (e.kind === 'location') {
                    out += '<circle cx="' + x(e.ms).toFixed(1) + '" cy="' + mid + '" r="3.5" fill="' + COLORS.location + '"><title>' + esc(e.text + ' ' + fmt(e.ms)) + '</title></circle>';
                } else {
                    var cx = x(e.ms);
                    var color = e.neighbour ? COLORS.neighbour : e.kind === 'exif' || e.kind === 'fs-mtime' || e.kind === 'paired-video' ? COLORS.exif : COLORS.file;
                    var r = e.neighbour ? 3 : 6;
                    if (e.kind === 'file-created') {
                        out += '<polygon points="' + (cx).toFixed(1) + ',' + (mid - 8) + ' ' + (cx + 8).toFixed(1) + ',' + mid + ' ' + (cx).toFixed(1) + ',' + (mid + 8) + ' ' + (cx - 8).toFixed(1) + ',' + mid + '" fill="' + color + '"><title>' + esc(e.text + ' ' + fmt(e.ms)) + '</title></polygon>';
                    } else if (e.kind === 'file-added' || e.kind === 'file-modified') {
                        out += '<rect x="' + (cx - 5).toFixed(1) + '" y="' + (mid - 5) + '" width="10" height="10" fill="none" stroke="' + color + '" stroke-width="2"><title>' + esc(e.text + ' ' + fmt(e.ms)) + '</title></rect>';
                    } else {
                        out += '<circle cx="' + cx.toFixed(1) + '" cy="' + mid + '" r="' + r + '" fill="' + color + '"><title>' + esc(e.text + ' ' + fmt(e.ms)) + '</title></circle>';
                    }
                }
            });
        });

        // T
        var tX = x(w.centerMs);
        out += '<line x1="' + tX.toFixed(1) + '" y1="' + (plotTop - 6) + '" x2="' + tX.toFixed(1) + '" y2="' + plotBottom + '" stroke="' + COLORS.t + '" stroke-width="1.5" stroke-dasharray="4 3"/>';
        out += text(tX + 4, plotTop - 8 + 6, 'T ' + fmt(w.centerMs).slice(11, 19), { size: 10, fill: COLORS.t, weight: 'bold' });

        // Förklaring och fot
        var ly = plotBottom + 32;
        var legend = [['◆', 'Skapad', COLORS.file], ['□', 'Tillagd/Ändrad', COLORS.file], ['●', 'EXIF/filsystem', COLORS.exif], ['•', 'Andra bilder', COLORS.neighbour], ['▬', 'App', COLORS.app], ['▬', 'Kamera', COLORS.camera], ['▬', 'Skärm tänd', COLORS.screenOn]];
        var lx = LEFT;
        legend.forEach(function (item) {
            out += text(lx, ly, item[0], { size: 11, fill: item[2] });
            out += text(lx + 14, ly, item[1], { size: 10, fill: COLORS.muted });
            lx += 14 + item[1].length * 6.2 + 16;
        });
        out += text(LEFT, ly + 16, opts.footer || '', { size: 9, fill: COLORS.muted });
        return out + '</svg>';
    }

    var api = { svg: svg, tickStep: tickStep, LANES: LANES, COLORS: COLORS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceTimeline = api;
})(typeof window !== 'undefined' ? window : this);
