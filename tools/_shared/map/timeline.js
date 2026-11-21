// Tidslinjen under kartan: ett band per källa, med bilder och positioner som streck, samtal och meddelanden som romber
// och vistelser som staplar. Långa uppehåll trycks ihop (ett brott med uppehållets längd), så att en enstaka gammal bild
// inte gör resten till ett streck. Ett klick öppnar punkten, ett drag markerar allt i spannet, och markören följer
// uppspelningen. Skalan (scale) testas i Node.
//
//   MapTimeline.scale(tider, bredd)   → { x(ms), ms(x), segments, breaks }
//   MapTimeline.create(behållare, { onPick(ref), onBrush(frånMs, tillMs) }) → { draw(lanes, markörMs), destroy() }
//   lanes: [{ name, color, items: [{ ms, until, kind: 'point' | 'event' | 'stay', color, title, ref }] }]
(function (root) {
    'use strict';

    var BREAK = 26;

    // Tiderna delas där uppehållet är längre än max(2 h, 1/40 av hela spannet). Varje del får bredd efter sin längd
    // (minst en liten del av helheten), och uppehållen en fast bredd.
    function scale(times, width) {
        var t = (times || []).filter(function (v) { return typeof v === 'number' && isFinite(v); }).sort(function (a, b) { return a - b; });
        if (!t.length) return null;
        var span = t[t.length - 1] - t[0];
        var gap = Math.max(2 * 3600000, span / 40);
        var parts = [{ from: t[0], to: t[0] }];
        for (var i = 1; i < t.length; i++) {
            var cur = parts[parts.length - 1];
            if (t[i] - cur.to > gap) parts.push({ from: t[i], to: t[i] });
            else cur.to = t[i];
        }
        // En del utan längd (en enda tid) får en minut åt vardera hållet, så att den syns och går att peka på.
        parts.forEach(function (p) { if (p.to - p.from < 120000) { var mid = (p.from + p.to) / 2; p.from = mid - 60000; p.to = mid + 60000; } });
        var total = parts.reduce(function (n, p) { return n + (p.to - p.from); }, 0);
        var free = Math.max(40, width - BREAK * (parts.length - 1));
        var weights = parts.map(function (p) { return Math.max(p.to - p.from, total * 0.06); });
        var wsum = weights.reduce(function (n, w) { return n + w; }, 0);
        var x = 0;
        var segments = parts.map(function (p, k) {
            var w = free * weights[k] / wsum;
            var seg = { from: p.from, to: p.to, x0: x, x1: x + w };
            x += w + BREAK;
            return seg;
        });
        var breaks = segments.slice(1).map(function (s, k) { return { x: s.x0 - BREAK / 2, gapMs: s.from - segments[k].to }; });
        function toX(ms) {
            if (ms <= segments[0].from) return segments[0].x0;
            for (var k = 0; k < segments.length; k++) {
                var s = segments[k];
                if (ms <= s.to) return ms < s.from ? s.x0 - BREAK / 2 : s.x0 + (s.x1 - s.x0) * (ms - s.from) / (s.to - s.from);
            }
            return segments[segments.length - 1].x1;
        }
        function toMs(px) {
            if (px <= segments[0].x0) return segments[0].from;
            for (var k = 0; k < segments.length; k++) {
                var s = segments[k];
                if (px <= s.x1) return px < s.x0 ? s.from : s.from + (s.to - s.from) * (px - s.x0) / (s.x1 - s.x0);
            }
            return segments[segments.length - 1].to;
        }
        return { x: toX, ms: toMs, segments: segments, breaks: breaks };
    }

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function clock(ms) { var d = new Date(ms); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
    function day(ms) { return new Date(ms).toISOString().slice(0, 10); }
    function gapText(ms) {
        var h = ms / 3600000;
        return h < 48 ? Math.round(h) + ' h' : Math.round(h / 24) + ' d';
    }

    function create(host, opts) {
        opts = opts || {};
        var LABEL = 118, LANE = 22, AXIS = 22;
        var canvas = document.createElement('canvas');
        canvas.className = 'map-timeline-canvas';
        var tip = document.createElement('div');
        tip.className = 'map-timeline-tip';
        tip.hidden = true;
        host.append(canvas, tip);
        var state = { lanes: [], cursor: null, sc: null, hits: [], brush: null };

        function colors() {
            var css = getComputedStyle(host);
            var v = function (n, d) { return (css.getPropertyValue(n) || '').trim() || d; };
            return { text: v('--text', '#e8e8ed'), muted: v('--text-muted', '#98989f'), border: v('--border', '#3a3a40'), accent: v('--accent', '#0a84ff'), band: v('--surface-hover', '#323238') };
        }

        // focus: { from, to } som markeras som ett fält (fönstret runt en tid), eller null.
        function draw(lanes, cursor, focus) {
            if (lanes !== undefined) state.lanes = lanes || [];
            if (cursor !== undefined) state.cursor = cursor;
            if (focus !== undefined) state.focus = focus || null;
            var w = host.clientWidth, dpr = window.devicePixelRatio || 1;
            var h = AXIS + Math.max(1, state.lanes.length) * LANE + 4;
            canvas.style.height = h + 'px';
            canvas.width = Math.max(1, Math.round(w * dpr));
            canvas.height = Math.round(h * dpr);
            var ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);
            var c = colors();
            var times = [];
            state.lanes.forEach(function (l) { l.items.forEach(function (it) { times.push(it.ms); if (it.until) times.push(it.until); }); });
            if (state.focus && times.length) times.push(state.focus.from, state.focus.to);
            var plotW = Math.max(60, w - LABEL - 12);
            var sc = state.sc = scale(times, plotW);
            state.hits = [];
            ctx.font = '11px -apple-system, "Segoe UI", sans-serif';
            ctx.textBaseline = 'middle';
            if (!sc) { ctx.fillStyle = c.muted; ctx.fillText('Inga punkter med tid.', 8, h / 2); return; }
            var X = function (ms) { return LABEL + sc.x(ms); };
            // Banden och namnen.
            state.lanes.forEach(function (l, i) {
                var y = AXIS + i * LANE;
                if (i % 2 === 0) { ctx.fillStyle = c.band; ctx.globalAlpha = 0.35; ctx.fillRect(0, y, w, LANE); ctx.globalAlpha = 1; }
                ctx.fillStyle = l.color || c.text;
                ctx.fillRect(6, y + LANE / 2 - 4, 8, 8);
                ctx.fillStyle = c.text;
                var name = l.name || '';
                while (name.length > 3 && ctx.measureText(name).width > LABEL - 24) name = name.slice(0, -2);
                ctx.fillText(name === (l.name || '') ? name : name + '…', 18, y + LANE / 2);
            });
            // Axeln: början och slutet på varje del, och datumet när det byts.
            ctx.fillStyle = c.muted;
            // En etikett ritas bara där den får plats efter den förra, så att de inte krockar.
            var lastDay = '', freeX = 0;
            var label = function (text, x, right) {
                var tw = ctx.measureText(text).width, x0 = right ? x - tw : x;
                if (x0 < freeX) return false;
                ctx.fillText(text, x0, AXIS / 2);
                freeX = x0 + tw + 8;
                return true;
            };
            sc.segments.forEach(function (s) {
                var d = day(s.from);
                if (label((d !== lastDay ? d + ' ' : '') + clock(s.from), LABEL + s.x0)) lastDay = d;
                if (s.x1 - s.x0 > 90) label(clock(s.to), LABEL + s.x1, true);
            });
            var freeGap = 0;
            sc.breaks.forEach(function (b) {
                ctx.strokeStyle = c.border;
                ctx.setLineDash([3, 3]);
                ctx.beginPath(); ctx.moveTo(LABEL + b.x, AXIS - 2); ctx.lineTo(LABEL + b.x, h); ctx.stroke();
                ctx.setLineDash([]);
                var g = gapText(b.gapMs), gw = ctx.measureText(g).width, gx = LABEL + b.x - gw / 2;
                if (gx < freeGap) return;
                ctx.fillStyle = c.muted;
                ctx.fillText(g, gx, h - 7);
                freeGap = gx + gw + 6;
            });
            if (state.focus) {
                var f0 = X(Math.max(state.focus.from, sc.segments[0].from)), f1 = X(Math.min(state.focus.to, sc.segments[sc.segments.length - 1].to));
                if (f1 > f0) {
                    ctx.fillStyle = c.accent; ctx.globalAlpha = 0.1;
                    ctx.fillRect(f0, AXIS, f1 - f0, h - AXIS);
                    ctx.globalAlpha = 0.6; ctx.strokeStyle = c.accent;
                    ctx.strokeRect(f0 + 0.5, AXIS + 0.5, f1 - f0 - 1, h - AXIS - 1);
                    ctx.globalAlpha = 1;
                }
            }
            // Punkterna.
            state.lanes.forEach(function (l, i) {
                var y = AXIS + i * LANE, mid = y + LANE / 2;
                l.items.forEach(function (it) {
                    var x = X(it.ms);
                    ctx.fillStyle = it.color || l.color || c.accent;
                    if (it.kind === 'stay' && it.until) {
                        var x2 = Math.max(x + 3, X(it.until));
                        ctx.globalAlpha = 0.55;
                        ctx.fillRect(x, mid - 5, x2 - x, 10);
                        ctx.globalAlpha = 1;
                        state.hits.push({ x0: x, x1: x2, y0: y, y1: y + LANE, it: it });
                    } else if (it.kind === 'event') {
                        ctx.beginPath(); ctx.moveTo(x, mid - 6); ctx.lineTo(x + 5, mid); ctx.lineTo(x, mid + 6); ctx.lineTo(x - 5, mid); ctx.closePath(); ctx.fill();
                        state.hits.push({ x0: x - 5, x1: x + 5, y0: y, y1: y + LANE, it: it });
                    } else {
                        ctx.fillRect(x - 1, mid - 7, 2, 14);
                        state.hits.push({ x0: x - 3, x1: x + 3, y0: y, y1: y + LANE, it: it });
                    }
                });
            });
            if (state.cursor != null) {
                var cx = X(state.cursor);
                ctx.strokeStyle = c.accent; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(cx, AXIS - 4); ctx.lineTo(cx, h); ctx.stroke();
                ctx.lineWidth = 1;
            }
            if (state.brush) {
                ctx.fillStyle = c.accent; ctx.globalAlpha = 0.18;
                var a = Math.min(state.brush.a, state.brush.b), bb = Math.max(state.brush.a, state.brush.b);
                ctx.fillRect(a, AXIS, bb - a, h - AXIS);
                ctx.globalAlpha = 1;
            }
        }

        function at(e) {
            var r = canvas.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        }
        function hitAt(p) {
            var best = null, dist = Infinity;
            state.hits.forEach(function (h) {
                if (p.y < h.y0 || p.y > h.y1) return;
                var d = p.x < h.x0 ? h.x0 - p.x : p.x > h.x1 ? p.x - h.x1 : 0;
                if (d < dist && d <= 4) { dist = d; best = h.it; }
            });
            return best;
        }
        var down = null;
        canvas.addEventListener('pointerdown', function (e) {
            if (e.button !== 0) return;
            down = at(e);
            canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener('pointermove', function (e) {
            var p = at(e);
            if (down && Math.abs(p.x - down.x) > 4 && down.x > LABEL) {
                state.brush = { a: Math.max(LABEL, down.x), b: Math.max(LABEL, p.x) };
                tip.hidden = true;
                draw();
                return;
            }
            var it = hitAt(p);
            tip.hidden = !it;
            if (it) {
                tip.textContent = it.title || '';
                tip.style.left = Math.min(Math.max(0, p.x + 10), host.clientWidth - 220) + 'px';
                tip.style.top = Math.max(0, p.y - 34) + 'px';
            }
            canvas.style.cursor = it ? 'pointer' : p.x > LABEL ? 'crosshair' : '';
        });
        canvas.addEventListener('pointerleave', function () { tip.hidden = true; });
        canvas.addEventListener('pointerup', function (e) {
            var p = at(e);
            if (state.brush && state.sc) {
                var a = Math.min(state.brush.a, state.brush.b) - LABEL, b = Math.max(state.brush.a, state.brush.b) - LABEL;
                state.brush = null;
                draw();
                if (opts.onBrush) opts.onBrush(state.sc.ms(a), state.sc.ms(b));
            } else {
                var it = hitAt(p);
                if (it && opts.onPick) opts.onPick(it.ref);
            }
            down = null;
        });

        return { draw: draw, destroy: function () { canvas.remove(); tip.remove(); } };
    }

    var api = { scale: scale, create: create };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.MapTimeline = api;
})(typeof window !== 'undefined' ? window : this);
