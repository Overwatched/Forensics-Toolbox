// Tidslinjen i Härkomst som SVG, utan bibliotek. En rad per jämförelse: Fil, App, Kamera, Skärm,
// Lås, Position och Snapchat (de rader som har något att visa). Ett band i radens färg betyder
// "på" (kameran igång, skärmen tänd, telefonen olåst), ett grått band "av", ingenting = ingen
// registrering. T är en kolumn genom alla rader med en prick där den korsar ett band, och till
// höger står kolumnen "Vid T" som säger läget per rad i klartext, med faktorns ord (Stöd,
// Motsägelse, Saknas, Upplysning) som på faktorkorten. Översikten markerar närbildens ruta
// (opts.zoom), närbilden (opts.labels) skriver ut händelserna på bilden. Fasta ljusa färger så
// att bilden ser likadan ut i rapporten som på skärmen. Testas i Node.
(function (root) {
    'use strict';

    // Radfärgerna är kontrollerade mot varandra för färgblindhet och mot vit bakgrund.
    var COLORS = {
        bg: '#ffffff', text: '#1c1c1e', muted: '#6e6e73', grid: '#e5e5ea', lane: '#f7f7f9', t: '#d70015', zoom: '#007aff',
        file: '#1c1c1e', neighbour: '#a2a2a8', exif: '#eb6834',
        phone: '#1f6fd0', camera: '#008300', snapchat: '#c98500', location: '#6250d6', other: '#8e8e93',
        off: '#e5e5ea', offStroke: '#c7c7cc',
        status: { support: '#248a3d', contradiction: '#d70015', missing: '#c77700', info: '#007aff', na: '#8e8e93' },
    };
    var STATE_LABEL = { support: 'Stöd', contradiction: 'Motsägelse', missing: 'Saknas', info: 'Upplysning', na: 'Inte tillämplig' };
    var ROWS = [
        { id: 'file', label: 'Fil', factor: 'time' },
        { id: 'app', label: 'App', factor: 'app' },
        { id: 'camera', label: 'Kamera', factor: 'camera' },
        { id: 'screen', label: 'Skärm', factor: 'screen' },
        { id: 'lock', label: 'Lås', factor: null },
        { id: 'location', label: 'Position', factor: 'position' },
        { id: 'snapchat', label: 'Snapchat', factor: null },
    ];
    var LEFT = 96, RIGHT = 14, GAP = 16, COL = 300, PILL_W = 104, TOP = 44, FOOTER = 56, CHAR_W = 5.9;
    var ROW_H = 36, ROW_H_LABELS = 50;
    var MAX_LANES = 5, LANE_H = 13, DODGE_MAX = 40, LEGEND_H = 16, FADE = 0.3;
    var SNAP_APPS = { 'com.toyopagroup.picaboo': 1, 'com.snapchat.android': 1 };

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function text(x, y, s, o) {
        o = o || {};
        return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" font-family="Arial, Helvetica, sans-serif" font-size="' + (o.size || 11) + '" fill="' + (o.fill || COLORS.text) + '"' +
            (o.anchor ? ' text-anchor="' + o.anchor + '"' : '') + (o.weight ? ' font-weight="' + o.weight + '"' : '') + '>' + (o.raw ? s : esc(s)) + '</text>';
    }
    function fmtTime(fmt, ms) { return fmt(ms).slice(11, 19); }

    // "24 s", "3 min 5 s", "1 tim 12 min".
    function dur(ms) {
        var s = Math.round(Math.abs(ms) / 1000);
        if (s < 60) return s + ' s';
        var m = Math.floor(s / 60); s = s % 60;
        if (m < 60) return m + ' min' + (s ? ' ' + s + ' s' : '');
        var h = Math.floor(m / 60); m = m % 60;
        return h + ' tim' + (m ? ' ' + m + ' min' : '');
    }
    function metres(m) { return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km'; }

    // Avstånd mellan tidsmarkeringarna: 10 s, 30 s, 1, 2, 5, 10, 15, 30 min eller timmar, så att det blir 4–8 stycken.
    function tickStep(spanMs) {
        var steps = [10000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000, 7200000, 21600000];
        for (var i = 0; i < steps.length; i++) if (spanMs / steps[i] <= 8) return steps[i];
        return steps[steps.length - 1];
    }
    function cut(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

    function isSnapApp(app) { return !!SNAP_APPS[app]; }
    function appColor(e) { return e.lane === 'camera' ? COLORS.camera : isSnapApp(e.app) ? COLORS.snapchat : COLORS.other; }
    function covers(e, t) { return e.ms <= t && t < (e.endMs != null ? e.endMs : e.ms + 1); }
    function overlaps(e, w) { return e.ms <= w.endMs && (e.endMs != null ? e.endMs : e.ms) >= w.startMs; }
    function nearest(list, T) { return list.reduce(function (a, p) { return !a || Math.abs(p.ms - T) < Math.abs(a.ms - T) ? p : a; }, null); }
    // Snapchats egen kamera vid T: inspelningsposten (iOS, typ 34) eller tagningen i Memories (Android).
    function isRecording(e, T) { return ((e.kind === 'snap-cache' && e.context === 34) || (e.kind === 'snap-memory' && e.captured)) && Math.abs(e.ms - T) <= 2000; }
    // Appen i förgrunden: kameraanvändning ur appops (cameraOp) hör till kameraraden, inte appraden.
    function foreground(e) { return e.kind === 'app' && !e.cameraOp; }

    // Vilka rader finns: alltid Fil och App, sedan en rad per faktor som finns, Lås om låsdata finns,
    // Snapchat om det finns Snapchat-händelser. Varje rad bär sin faktor (eller null).
    function rowsFor(model) {
        var f = {};
        (model.factors || []).forEach(function (x) { f[x.id] = x; });
        var ev = model.events || [];
        return ROWS.filter(function (r) {
            if (r.id === 'file' || r.id === 'app') return true;
            if (r.id === 'camera') return !!f.camera;
            if (r.id === 'screen') return !!f.screen || ev.some(function (e) { return e.kind === 'screen'; });
            if (r.id === 'lock') return ev.some(function (e) { return e.kind === 'lock'; });
            if (r.id === 'location') return !!f.position;
            if (r.id === 'snapchat') return ev.some(function (e) { return /^snap-/.test(e.kind); });
            return false;
        }).map(function (r) { return { id: r.id, label: r.label, factor: r.factor ? f[r.factor] || null : null }; });
    }

    // Kort text för en Snapchat-händelse i närbilden. null = bara markören med sin tooltip. Meddelanden
    // och notiser får alltid en text, så att ingen markör i Snapchat-raden står utan förklaring.
    function snapLabel(e) {
        var m;
        if (!e.plain && !e.isFile && !(e.kind === 'snap-cache' && e.context === 34) && e.kind !== 'snap-message' && e.kind !== 'snap-notification') return null;
        switch (e.kind) {
            case 'snap-message':
                if (e.isFile) return e.own ? 'Den bedömda filen skickas' : 'Den bedömda filen tas emot';
                m = /från (@\S+)$/.exec(e.plain || '');
                if (!e.own) return 'Snap' + (m ? ' från ' + m[1] : ' tas emot');
                m = /till (@\S+) från/.exec(e.plain || '');
                return 'Snap' + (m ? ' till ' + m[1] : ' skickas');
            case 'snap-read': return e.own ? 'Mottagaren öppnar den' : 'Öppnas på telefonen';
            case 'snap-notification': return e.notifType === 'snap' ? 'Notis: ny snap' : e.notifType === 'chat' ? 'Notis: nytt meddelande' : 'Notis från Snapchat';
            case 'snap-cache':
                if (e.isFile) return 'Den bedömda filen' + (e.context === 34 ? ' spelas in' : ' läggs i cachen');
                if (e.context === 34) return 'Video spelas in';
                if (e.sent) { m = /till (@\S+) från/.exec(e.plain || ''); return 'Snap' + (m ? ' till ' + m[1] : ' skickas'); }
                return e.plain ? 'Media ur chatten cachas' : null;
            case 'snap-cache-deleted': return e.isFile ? 'Den bedömda filen raderas ur cachen' : null;
            case 'snap-memory':
                if (e.captured) return e.isFile ? 'Den bedömda ' + (e.video ? 'videon' : 'bilden') + ' tas (Memories)' : (e.video ? 'Video spelas in' : 'Bild tas') + ' (Memories)';
                return e.isFile ? 'Sparas i Memories' : null;
            case 'snap-journal': return e.folder === 'posted_story_snap' ? 'Story-snap lagras' : null;
        }
        return null;
    }
    // Kort text för filens egna tidpunkter och grannbilderna.
    function fileLabel(e, model) {
        var m;
        switch (e.kind) {
            case 'file-created': return (model.file && model.file.filename ? cut(model.file.filename, 22) + ' ' : '') + (model.type && model.type.type === 'snapchat' ? 'registreras' : 'skapas');
            case 'file-added': return 'Tillagd i biblioteket';
            case 'file-modified': return 'Ändrad';
            case 'exif': return 'EXIF i filen';
            case 'fs-mtime': return 'Ändringstid i zippen';
            case 'paired-video': return 'Live Photo-videon';
            case 'file-captured': return 'Tagen (Memories)';
            case 'neighbour': m = /^Granne: (\S+)/.exec(e.text || ''); return m ? m[1] : 'Annan bild';
        }
        return null;
    }

    // Snapchat-händelsen som kolumnen Vid T beskriver: den närmaste som säger något om en snap.
    function snapAtT(ev, T) {
        var cands = ev.filter(function (e) { return (/^snap-(message|cache|read)$/.test(e.kind) && (e.isFile || e.own || e.sent || e.context === 34 || e.kind === 'snap-message')) || (e.kind === 'snap-memory' && (e.isFile || e.captured)); });
        return cands.length ? nearest(cands, T) : null;
    }

    // Det viktiga för bedömningen: filens egna tidpunkter, allt som Snapchat knyter till den bedömda
    // filen, inspelningen vid T, den närmaste positionen och Snapchat-händelsen i kolumnen Vid T.
    // Resten (grannbilder, andra snappar och inspelningar) är sammanhang: blek markör utan text.
    function focusSet(model, T, positions) {
        var ev = model.events;
        var keep = new Set();
        ev.forEach(function (e) {
            if (e.isFile) keep.add(e);
            else if (e.lane === 'file' && !e.neighbour) keep.add(e);
            else if (isRecording(e, T)) keep.add(e);
        });
        var snap = snapAtT(ev, T);
        if (snap) keep.add(snap);
        var near = nearest((positions || []).filter(function (p) { return p.kind === 'phone'; }), T);
        if (near) ev.forEach(function (e) { if (e.kind === 'location' && e.ms === near.ms) keep.add(e); });
        return keep;
    }

    // Läget vid T per rad: faktorns tillstånd (pillen) och två korta rader text.
    // ctx: { model, T, fmt, appName, positions }
    function stateAt(row, ctx) {
        var T = ctx.T, ev = ctx.model.events, fmt = ctx.fmt, model = ctx.model;
        var st = row.factor ? row.factor.state : null;
        var running = ev.filter(function (e) { return foreground(e) && covers(e, T); });
        var camOps = ev.filter(function (e) { return e.kind === 'app' && e.lane === 'camera' && covers(e, T); });
        var names = running.map(function (e) { return ctx.appName(e.app); }).filter(function (n, i, a) { return a.indexOf(n) === i; });
        var since = function (e) { return 'sedan ' + fmtTime(fmt, e.ms) + ' (' + dur(T - e.ms) + ')'; };
        var when = function (ms) { return dur(ms - T) + (ms < T ? ' före T' : ' efter T'); };
        switch (row.id) {
            case 'file': {
                var created = ev.find(function (e) { return e.kind === 'file-created'; });
                var parts = [];
                var ex = ev.find(function (e) { return e.kind === 'exif'; });
                var fsm = ev.find(function (e) { return e.kind === 'fs-mtime'; });
                var added = ev.find(function (e) { return e.kind === 'file-added'; });
                var cap = ev.find(function (e) { return e.kind === 'file-captured'; });
                if (cap) parts.push('tagen ' + dur(cap.ms - T) + (cap.ms < T ? ' före (Memories)' : ' efter (Memories)'));
                if (ex) parts.push(Math.abs(ex.ms - T) <= 2000 ? 'EXIF stämmer' : 'EXIF ' + dur(ex.ms - T) + (ex.ms < T ? ' före' : ' efter'));
                else parts.push('ingen EXIF-tid');
                if (added) parts.push(Math.abs(added.ms - T) <= 2000 ? 'tillagd direkt' : 'tillagd ' + dur(added.ms - T) + ' efter');
                if (fsm) parts.push(Math.abs(fsm.ms - T) <= 2000 ? 'filsystemet stämmer' : 'filsystemet ' + dur(fsm.ms - T) + (fsm.ms < T ? ' före' : ' efter'));
                var verb = model.type && model.type.type === 'snapchat' ? 'Registrerad' : 'Skapad';
                return { state: st, l1: verb + (created && created.source && created.source.db ? ' · ' + created.source.db : ''), l2: parts.join(' · ') };
            }
            case 'app':
                if (!running.length) return { state: st, l1: 'ingen app registrerad', l2: '' };
                return { state: st, l1: names.join(', ') + ' i förgrunden', l2: since(running[0]) };
            case 'camera': {
                var cam = camOps[0];
                if (cam) return { state: st, l1: cam.cameraOp ? 'används av ' + ctx.appName(cam.app) : 'igång', l2: since(cam) + ', ' + dur(cam.endMs - T) + ' till' };
                var rec = ev.find(function (e) { return isRecording(e, T); });
                if (rec) return { state: st, l1: 'Snapchats kamera', l2: rec.kind === 'snap-memory' ? 'tagning registrerad i Memories vid T' : 'inspelning registrerad vid T' };
                var capAt = ev.find(function (e) { return e.kind === 'file-captured'; });
                var camAtCap = capAt ? ev.find(function (e) { return e.kind === 'app' && e.lane === 'camera' && e.ms - 5000 <= capAt.ms && capAt.ms <= e.endMs + 5000; }) : null;
                if (camAtCap) return { state: st, l1: 'igång när bilden togs', l2: fmtTime(fmt, camAtCap.ms) + ' → ' + fmtTime(fmt, camAtCap.endMs) + ', ' + dur(T - capAt.ms) + ' före T' };
                if (st === 'na') return { state: st, l1: 'behövs inte', l2: 'för den här filtypen' };
                if (running.length) return { state: st, l1: 'inte igång', l2: names.join(', ') + ' i förgrunden' };
                return { state: st, l1: 'ingen registrering', l2: '' };
            }
            case 'screen': {
                var s = ev.find(function (e) { return e.kind === 'screen' && covers(e, T); });
                if (!s) return { state: st, l1: 'ingen registrering', l2: '' };
                return { state: st, l1: s.on ? 'tänd' : 'släckt', l2: since(s) };
            }
            case 'lock': {
                var l = ev.find(function (e) { return e.kind === 'lock' && covers(e, T); });
                if (!l) return { state: null, l1: 'ingen registrering', l2: '' };
                return { state: null, l1: l.locked ? 'låst' : 'olåst', l2: since(l) };
            }
            case 'location': {
                var ps = (ctx.positions || []).filter(function (p) { return p.kind === 'phone'; });
                var mem = (ctx.positions || []).find(function (p) { return p.kind === 'memory'; });
                if (!ps.length && mem) return { state: st, l1: 'bildens position ur Memories', l2: mem.lat.toFixed(5) + ', ' + mem.lon.toFixed(5) + ' · ingen telefonposition' };
                if (!ps.length) return { state: st, l1: 'ingen position i fönstret', l2: '' };
                var near = nearest(ps, T);
                var acc = near.accuracy ? ' · ±' + Math.round(near.accuracy) + ' m' : '';
                if (near.distanceM == null) return { state: st, l1: 'bilden saknar position', l2: 'närmaste ' + when(near.ms) + acc };
                return { state: st, l1: metres(near.distanceM) + ' från bilden', l2: when(near.ms) + acc };
            }
            case 'snapchat': {
                var n = snapAtT(ev, T);
                if (!n) return { state: null, l1: '–', l2: '' };
                return { state: null, l1: snapLabel(n) || 'Snapchat-händelse', l2: Math.abs(n.ms - T) <= 1000 ? 'vid T' : when(n.ms) };
            }
        }
        return { state: st, l1: '', l2: '' };
    }

    // Pricken i T-kolumnen per rad: fylld i radens färg = på, vit med grå kant = av, null = ingen registrering.
    function tMarker(row, ctx) {
        var T = ctx.T, ev = ctx.model.events;
        var running = ev.filter(function (e) { return foreground(e) && covers(e, T); });
        var off = { fill: COLORS.bg, stroke: COLORS.other };
        if (row.id === 'app') return running.length ? { fill: appColor(running[0]) } : null;
        if (row.id === 'camera') {
            if (ev.some(function (e) { return e.kind === 'app' && e.lane === 'camera' && covers(e, T); })) return { fill: COLORS.camera };
            if (ev.some(function (e) { return isRecording(e, T); })) return { fill: COLORS.camera };
            return running.length ? off : null;
        }
        if (row.id === 'screen') { var s = ev.find(function (e) { return e.kind === 'screen' && covers(e, T); }); return s ? (s.on ? { fill: COLORS.phone } : off) : null; }
        if (row.id === 'lock') { var l = ev.find(function (e) { return e.kind === 'lock' && covers(e, T); }); return l ? (!l.locked ? { fill: COLORS.phone } : off) : null; }
        return null;
    }

    // Markörerna: romb för skapad, fyrkant för tillagd/ändrad, cirkel för EXIF och filsystem, liten
    // prick för grannbilder; Snapchat: triangel för meddelanden, cirkel för cacheposter, ring för
    // läst, liten romb för notiser; violett cirkel för position (större för den närmaste).
    function snapRadius(e) { return e.kind === 'snap-notification' ? 4 : e.isFile ? 7 : 4.5; }
    function marker(e, cx, mid, fmt) {
        var title = '<title>' + esc(e.text + ' ' + fmt(e.ms)) + '</title>';
        if (e.kind === 'location') return '<circle cx="' + cx.toFixed(1) + '" cy="' + mid + '" r="' + (e.near ? 6 : 4) + '" fill="' + COLORS.location + '" stroke="' + COLORS.bg + '" stroke-width="1.5">' + title + '</circle>';
        if (/^snap-/.test(e.kind)) {
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

    // Ritar raderna för ett fönster från cfg.y0. cfg: { y0, rowH, labels, plotW, zoom, column, prefix }
    // I närbilden växer en rad på höjden när texterna behöver fler spår, så att ingen text faller bort.
    function block(ctx, w, rows, cfg) {
        var fmt = ctx.fmt, appName = ctx.appName, model = ctx.model, T = w.centerMs;
        var y0 = cfg.y0, rowH = cfg.rowH, labels = !!cfg.labels, plotW = cfg.plotW;
        var plotRight = LEFT + plotW;
        var span = w.endMs - w.startMs;
        var x = function (ms) { return LEFT + (ms - w.startMs) / span * plotW; };
        var cx = function (ms) { return Math.max(LEFT, Math.min(plotRight, x(ms))); };
        var events = model.events.filter(function (e) { return overlaps(e, w); });
        var barH = 18;
        var pre = cfg.prefix || '';
        var tX = x(T);
        // focus: bara det viktiga får text, sammanhanget ritas blekt. null = allt med full styrka.
        var focus = cfg.focus ? focusSet(model, T, ctx.positions) : null;
        var important = function (e) { return !focus || focus.has(e); };
        var faded = function (svg, e) { return important(e) ? svg : '<g opacity="' + FADE + '">' + svg + '</g>'; };

        // Textplacering i närbilden: spår per rad, och en text får inte läggas ovanpå en tidigare
        // på samma spår. Texter som inte får plats till höger om markören skrivs till vänster.
        // Spår 0 ligger i höjd med markören (i kamerans rad ovanför bandet), resten under.
        function placer() {
            var ends = [];
            var place = function (l, r) {
                for (var k = 0; k < MAX_LANES; k++) {
                    if (ends[k] == null || ends[k] <= l) { ends[k] = r; return k; }
                }
                return -1;
            };
            place.lanes = function () { return ends.length; };
            return place;
        }
        function laneY(k, mid, overBand) {
            if (overBand) return k === 0 ? mid - 13 : mid + 22 + LANE_H * (k - 1);
            return k === 0 ? mid - 5 : mid + 15 + LANE_H * (k - 1);
        }
        function band(x1, x2, mid, fill, title, stroke) {
            var bw = Math.max(2, x2 - x1);
            return '<rect x="' + x1.toFixed(1) + '" y="' + (mid - barH / 2) + '" width="' + bw.toFixed(1) + '" height="' + barH + '" rx="3" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="1"' : ' stroke="' + COLORS.bg + '" stroke-width="1"') + '><title>' + esc(title) + '</title></rect>';
        }
        // Text i ett band: den längsta varianten som får plats, och helst så att den inte går under T-pricken.
        var uid = 0;
        function bandText(x1, x2, mid, cands, fill) {
            var bw = x2 - x1;
            cands = [].concat(cands).filter(Boolean);
            var pick = null;
            for (var k = 0; k < cands.length && !pick; k++) {
                var wpx = cands[k].length * CHAR_W;
                if (bw < wpx + 8) continue;
                var crosses = x1 < tX && tX < x2 && x1 + 4 + wpx > tX - 9;
                if (!crosses) pick = { s: cands[k], x: x1 + 4 };
                else if (tX + 10 + wpx <= x2 - 4) pick = { s: cands[k], x: tX + 10 };
            }
            // Får ingen variant plats utan att gå under T-pricken skrivs ingen text: bandet och kolumnen Vid T säger läget.
            if (!pick) return '';
            var id = pre + 'c' + (++uid);
            return '<clipPath id="' + id + '"><rect x="' + x1.toFixed(1) + '" y="' + (mid - barH / 2) + '" width="' + bw.toFixed(1) + '" height="' + barH + '"/></clipPath><g clip-path="url(#' + id + ')">' + text(pick.x, mid + 4, pick.s, { size: 10, fill: fill }) + '</g>';
        }
        var sinceText = function (e, word) { return labels ? (e.ms < w.startMs ? word + ' sedan ' + fmtTime(fmt, e.ms) : word + ' ' + fmtTime(fmt, e.ms) + (e.endMs < w.endMs ? ' → ' + fmtTime(fmt, e.endMs) : '')) : word; };

        // En rad med radens mitt i mid. Ger { svg, lanes }.
        function renderRow(r, mid) {
            var place = placer();
            var overBand = r.id === 'camera';
            var said = [];
            var out = '', texts = '';
            function label(px, short, time, bold) {
                // Samma text inom tio sekunder (en skickad snap i både cachen och meddelandena) skrivs en gång.
                // "Snap till @x" ur cachen och "Snap skickas" ur meddelandena är samma snap.
                var topic = /^Snap (till |skickas)/.test(short) ? 'sent' : short;
                if (said.some(function (s) { return s.topic === topic && Math.abs(s.px - px) <= 10000 * plotW / span; })) return '';
                var s = time ? short + ' ' + time : short, wpx = s.length * CHAR_W;
                var flip = px + 10 + wpx > plotRight;
                var k = flip ? place(px - 10 - wpx, px + 6) : place(px + 6, px + 10 + wpx);
                if (k < 0) return '';
                said.push({ topic: topic, px: px });
                var raw = (bold ? '<tspan font-weight="bold">' : '<tspan>') + esc(short) + '</tspan>' + (time ? ' <tspan fill="' + COLORS.muted + '">' + esc(time) + '</tspan>' : '');
                return text(flip ? px - 10 : px + 10, laneY(k, mid, overBand), raw, { size: 10.5, raw: true, anchor: flip ? 'end' : null });
            }
            if (r.id === 'app') {
                events.filter(foreground).forEach(function (e) {
                    var x1 = cx(e.ms), x2 = cx(e.endMs), name = appName(e.app) || e.app || '';
                    var fill = appColor(e);
                    out += band(x1, x2, mid, fill, name + ' ' + fmt(e.ms) + ' – ' + fmt(e.endMs));
                    var long = name + ' ' + fmtTime(fmt, e.ms) + ' → ' + fmtTime(fmt, e.endMs);
                    texts += bandText(x1, x2, mid, labels ? [long, name] : [name], fill === COLORS.snapchat ? COLORS.text : '#ffffff');
                });
            } else if (r.id === 'camera') {
                // Grått där en annan app var i förgrunden, grönt där kameran var igång, prick för Snapchats inspelning.
                events.filter(function (e) { return e.kind === 'app' && e.lane !== 'camera'; }).forEach(function (e) {
                    out += band(cx(e.ms), cx(e.endMs), mid, COLORS.off, 'Inte kameran: ' + (appName(e.app) || e.app) + ' ' + fmt(e.ms) + ' – ' + fmt(e.endMs), COLORS.offStroke);
                });
                events.filter(function (e) { return e.kind === 'app' && e.lane === 'camera'; }).forEach(function (e) {
                    var x1 = cx(e.ms), x2 = cx(e.endMs);
                    var word = e.cameraOp ? 'används' : 'igång';
                    out += band(x1, x2, mid, COLORS.camera, (appName(e.app) || e.app) + (e.cameraOp ? ' använder kameran ' : ' igång ') + fmt(e.ms) + ' – ' + fmt(e.endMs));
                    texts += bandText(x1, x2, mid, [e.cameraOp ? (appName(e.app) || e.app) + ' ' + fmtTime(fmt, e.ms) + ' → ' + fmtTime(fmt, e.endMs) : sinceText(e, word), word], '#ffffff');
                });
                // Snapchats egen kamera: inspelningsposten (iOS) eller tagningen i Memories (Android).
                events.filter(function (e) { return (e.kind === 'snap-cache' && e.context === 34) || (e.kind === 'snap-memory' && e.captured); }).forEach(function (e) {
                    var px = x(e.ms);
                    out += faded('<circle cx="' + px.toFixed(1) + '" cy="' + mid + '" r="' + (e.isFile ? 7 : 5) + '" fill="' + COLORS.camera + '"' + (e.isFile ? ' stroke="' + COLORS.file + '" stroke-width="1.5"' : '') + '><title>' + esc(e.text + ' ' + fmt(e.ms)) + '</title></circle>', e);
                    var what = e.kind === 'snap-memory' ? (e.isFile ? 'Den bedömda ' + (e.video ? 'videon' : 'bilden') + ' tas med Snapchats kamera' : (e.video ? 'Video spelas in' : 'Bild tas') + ' med Snapchats kamera')
                        : (e.isFile ? 'Den bedömda filen spelas in med Snapchats kamera' : 'Inspelning med Snapchats kamera');
                    // I det viktiga står meningen i Snapchat-raden; här räcker vilken kamera.
                    if (labels && important(e)) texts += focus ? label(px, 'Snapchats kamera', fmtTime(fmt, e.ms), false) : label(px, what, fmtTime(fmt, e.ms), !!e.isFile);
                });
            } else if (r.id === 'screen' || r.id === 'lock') {
                events.filter(function (e) { return e.kind === r.id && e.endMs != null; }).forEach(function (e) {
                    var on = r.id === 'screen' ? !!e.on : !e.locked;
                    var word = r.id === 'screen' ? (on ? 'tänd' : 'släckt') : (on ? 'olåst' : 'låst');
                    var x1 = cx(e.ms), x2 = cx(e.endMs);
                    out += band(x1, x2, mid, on ? COLORS.phone : COLORS.off, word + ' ' + fmt(e.ms) + ' – ' + fmt(e.endMs), on ? null : COLORS.offStroke);
                    texts += bandText(x1, x2, mid, [sinceText(e, word), word], on ? '#ffffff' : COLORS.text);
                });
            } else if (r.id === 'location') {
                var ps = ctx.positions.filter(function (p) { return p.kind === 'phone'; });
                var near = nearest(ps, T);
                events.filter(function (e) { return e.kind === 'location'; }).forEach(function (e) {
                    var p = ps.find(function (q) { return q.ms === e.ms; });
                    var isNear = !!near && e.ms === near.ms;
                    out += faded(marker(Object.assign({}, e, { near: isNear }), x(e.ms), mid, fmt), e);
                    if (labels && important(e)) {
                        var s = 'Position' + (e.accuracy ? ' ±' + Math.round(e.accuracy) + ' m' : '') + (p && p.distanceM != null ? ' · ' + metres(p.distanceM) + ' från bilden' : '');
                        texts += label(x(e.ms), s, fmtTime(fmt, e.ms), isNear);
                    }
                });
            } else if (r.id === 'snapchat') {
                // Markörer som skulle hamna på varandra läggs bredvid varandra i tidsordning: den första
                // står på sin tid, de följande högst DODGE_MAX px till höger. Klockslagen står i texten.
                var prev = null;
                events.filter(function (e) { return /^snap-/.test(e.kind); }).sort(function (a, b) { return a.ms - b.ms; }).forEach(function (e) {
                    var r0 = snapRadius(e), px = x(e.ms);
                    if (prev && px < prev.px + prev.r + r0 + 2 && prev.px + prev.r + r0 + 2 - px <= DODGE_MAX) px = prev.px + prev.r + r0 + 2;
                    prev = { px: px, r: r0 };
                    out += faded(marker(e, px, mid, fmt), e);
                    if (labels && important(e)) { var s = snapLabel(e); if (s) texts += label(px, s, fmtTime(fmt, e.ms), !!e.isFile); }
                });
            } else if (r.id === 'file') {
                // Filens egna tidpunkter inom två sekunder blir en grupp: skapad-raden i fetstil, resten på en andra rad.
                var pts = events.filter(function (e) { return e.lane === 'file'; });
                var groups = [];
                pts.forEach(function (e) {
                    var g = !e.neighbour && groups.length && !groups[groups.length - 1].neighbour && Math.abs(groups[groups.length - 1].ms - e.ms) <= 2000 ? groups[groups.length - 1] : null;
                    if (g) g.items.push(e); else groups.push({ ms: e.ms, neighbour: !!e.neighbour, items: [e] });
                });
                groups.forEach(function (g) {
                    g.items.forEach(function (e) { out += faded(marker(e, x(e.ms), mid, fmt), e); });
                    if (labels && g.items.some(important)) {
                        var main = g.items.find(function (e) { return e.kind === 'file-created'; });
                        var rest = g.items.filter(function (e) { return e !== main; }).map(function (e) { return fileLabel(e, model); }).filter(Boolean);
                        if (main) {
                            texts += label(x(g.ms), fileLabel(main, model), fmtTime(fmt, g.ms), true);
                            if (rest.length) texts += label(x(g.ms), rest.join(' · '), '', false);
                        } else if (rest.length) texts += label(x(g.ms), rest.join(' · '), fmtTime(fmt, g.ms), false);
                    }
                });
            }
            return { svg: out + texts, lanes: place.lanes(), overBand: overBand };
        }

        // Först räknas spåren per rad (radens höjd), sedan ritas raderna på sina platser.
        var layout = [];
        var yy = y0;
        rows.forEach(function (r) {
            var h = rowH;
            if (labels) {
                var dry = renderRow(r, rowH / 2);
                if (dry.lanes) h = Math.max(rowH, Math.ceil(rowH / 2 + laneY(dry.lanes - 1, 0, dry.overBand) + 7));
            }
            layout.push({ y: yy, h: h, mid: yy + rowH / 2 });
            yy += h;
        });
        var plotBottom = yy;
        var out = '';

        // Bakgrund och radetiketter
        rows.forEach(function (r, i) {
            var L = layout[i];
            if (i % 2 === 0) out += '<rect x="' + LEFT + '" y="' + L.y + '" width="' + plotW + '" height="' + L.h + '" fill="' + COLORS.lane + '"/>';
            out += text(LEFT - 10, L.mid + 4, r.label, { anchor: 'end', size: 11.5, weight: 'bold' });
        });
        // Närbildens ruta i översikten
        if (cfg.zoom && cfg.zoom.endMs > w.startMs && cfg.zoom.startMs < w.endMs) {
            var zx1 = cx(cfg.zoom.startMs), zx2 = cx(cfg.zoom.endMs);
            out += '<rect x="' + zx1.toFixed(1) + '" y="' + (y0 - 4) + '" width="' + Math.max(2, zx2 - zx1).toFixed(1) + '" height="' + (plotBottom - y0 + 8) + '" fill="' + COLORS.zoom + '" fill-opacity="0.10" stroke="' + COLORS.zoom + '" stroke-width="1"><title>Närbild ' + esc(fmtTime(fmt, cfg.zoom.startMs) + ' till ' + fmtTime(fmt, cfg.zoom.endMs)) + '</title></rect>';
        }
        // Tidsaxeln
        var step = tickStep(span);
        for (var t = Math.ceil(w.startMs / step) * step; t <= w.endMs; t += step) {
            var tx = x(t);
            out += '<line x1="' + tx.toFixed(1) + '" y1="' + y0 + '" x2="' + tx.toFixed(1) + '" y2="' + plotBottom + '" stroke="' + COLORS.grid + '" stroke-width="1"/>';
            out += text(tx, plotBottom + 14, step < 60000 ? fmtTime(fmt, t) : fmt(t).slice(11, 16), { anchor: 'middle', size: 10, fill: COLORS.muted });
        }
        out += '<line x1="' + LEFT + '" y1="' + plotBottom + '" x2="' + plotRight + '" y2="' + plotBottom + '" stroke="' + COLORS.muted + '" stroke-width="1"/>';
        // T-kolumnen bakom allt
        out += '<rect x="' + (tX - 5).toFixed(1) + '" y="' + (y0 - 4) + '" width="10" height="' + (plotBottom - y0 + 4) + '" fill="' + COLORS.t + '" fill-opacity="0.09"/>';

        uid = 0;
        rows.forEach(function (r, i) { out += renderRow(r, layout[i].mid).svg; });

        // T: streck, etikett och en prick per rad som har ett band under T
        out += '<line x1="' + tX.toFixed(1) + '" y1="' + (y0 - 6) + '" x2="' + tX.toFixed(1) + '" y2="' + plotBottom + '" stroke="' + COLORS.t + '" stroke-width="1.5" stroke-dasharray="4 3"/>';
        out += text(tX + 4, y0 - 8, 'T ' + fmtTime(fmt, T), { size: 10.5, fill: COLORS.t, weight: 'bold' });
        rows.forEach(function (r, i) {
            var m = tMarker(r, ctx);
            if (!m) return;
            out += '<circle cx="' + tX.toFixed(1) + '" cy="' + layout[i].mid + '" r="5.5" fill="' + m.fill + '" stroke="' + (m.stroke || COLORS.bg) + '" stroke-width="2"/>';
        });

        // Kolumnen "Vid T": pill med faktorns ord, sedan två rader text.
        if (cfg.column) {
            var x0 = plotRight + GAP;
            out += text(x0, y0 - 8, 'Vid T · ' + fmtTime(fmt, T), { size: 11, weight: 'bold' });
            rows.forEach(function (r, i) {
                var L = layout[i], mid = L.mid;
                if (i % 2 === 0) out += '<rect x="' + (x0 - 6) + '" y="' + L.y + '" width="' + (COL + 6) + '" height="' + L.h + '" fill="' + COLORS.lane + '"/>';
                var s = stateAt(r, ctx);
                if (s.state) {
                    var lab = STATE_LABEL[s.state] || s.state, pw = lab.length * 6.3 + 14;
                    out += '<rect x="' + x0 + '" y="' + (mid - 9) + '" width="' + pw.toFixed(1) + '" height="18" rx="9" fill="' + (COLORS.status[s.state] || COLORS.other) + '"/>';
                    out += text(x0 + pw / 2, mid + 3.5, lab, { size: 10, fill: '#ffffff', weight: 'bold', anchor: 'middle' });
                }
                var tx0 = x0 + PILL_W;
                if (s.l2) {
                    out += text(tx0, mid - 2, cut(s.l1, 33), { size: 11, weight: 'bold' });
                    out += text(tx0, mid + 11, cut(s.l2, 38), { size: 10, fill: COLORS.muted });
                } else out += text(tx0, mid + 4, cut(s.l1, 33), { size: 11, weight: 'bold' });
            });
        }
        return { svg: out, bottom: plotBottom };
    }

    // Teckenförklaringen: bara det som finns i bilden, radbruten så att den ryms i bredden.
    function legendItems(rows, events, hasZoom) {
        var ids = rows.map(function (r) { return r.id; });
        var has = function (f) { return events.some(f); };
        var kind = function (k) { return function (e) { return e.kind === k; }; };
        var items = [];
        if (has(kind('file-created'))) items.push(['◆', 'Skapad', COLORS.file]);
        if (has(function (e) { return e.kind === 'file-added' || e.kind === 'file-modified'; })) items.push(['□', 'Tillagd/Ändrad', COLORS.file]);
        if (has(function (e) { return e.kind === 'exif' || e.kind === 'fs-mtime' || e.kind === 'paired-video'; })) items.push(['●', 'EXIF/filsystem', COLORS.exif]);
        if (has(function (e) { return e.neighbour; })) items.push(['•', 'Andra bilder', COLORS.neighbour]);
        items.push(['▬', 'Kamera', COLORS.camera]);
        if (ids.indexOf('snapchat') >= 0) items.push(['▬', 'Snapchat', COLORS.snapchat]);
        items.push(['▬', 'Annan app', COLORS.other]);
        if (ids.indexOf('screen') >= 0 || ids.indexOf('lock') >= 0) items.push(['▬', 'Tänd / olåst', COLORS.phone], ['▬', 'Släckt / låst / inte kameran', COLORS.offStroke]);
        if (has(function (e) { return (e.kind === 'snap-cache' && e.context === 34) || (e.kind === 'snap-memory' && e.captured); })) items.push(['●', 'Snapchats kamera', COLORS.camera]);
        if (ids.indexOf('location') >= 0) items.push(['●', 'Position', COLORS.location]);
        if (ids.indexOf('snapchat') >= 0) {
            if (has(kind('snap-message'))) items.push(['▲', 'Snap/meddelande', COLORS.snapchat]);
            if (has(kind('snap-read'))) items.push(['○', 'Öppnad', COLORS.snapchat]);
            var regs = [];
            if (has(function (e) { return /^snap-cache/.test(e.kind); })) regs.push('cache');
            if (has(kind('snap-memory'))) regs.push('Memories');
            if (has(kind('snap-journal'))) regs.push('filhanterare');
            if (regs.length) items.push(['●', 'Snapchats register (' + regs.join(', ') + ')', COLORS.snapchat]);
            if (has(kind('snap-notification'))) items.push(['◆', 'Notis', COLORS.snapchat]);
            if (has(function (e) { return /^snap-/.test(e.kind) && e.isFile; })) items.push(['◉', 'Svart kant: den bedömda filen', COLORS.file]);
        }
        if (hasZoom) items.push(['▭', 'Närbild', COLORS.zoom]);
        items.push(['┆', 'T', COLORS.t]);
        return items;
    }

    function legend(items, y, maxX) {
        var out = '', lx = LEFT, lines = 1;
        items.forEach(function (it) {
            var wpx = 14 + it[1].length * 5.6 + 16;
            if (lx > LEFT && lx + wpx - 16 > maxX) { lx = LEFT; y += LEGEND_H; lines++; }
            out += text(lx, y, it[0], { size: 11, fill: it[2] });
            out += text(lx + 14, y, it[1], { size: 10, fill: COLORS.muted });
            lx += wpx;
        });
        return { svg: out, lines: lines };
    }

    // model: från ProvenanceCore.build. opts: { window, zoom, labels, detail ('focus' = standard, 'all'), column, width, format(ms) -> text, appName(id), title, footer, positions, prefix }
    function svg(model, opts) {
        opts = opts || {};
        var w = opts.window || model.windows[0];
        var width = opts.width || 1100;
        var column = opts.column !== false;
        var ctx = {
            model: model, T: w.centerMs,
            fmt: opts.format || function (ms) { return new Date(ms).toISOString().slice(0, 19).replace('T', ' '); },
            appName: opts.appName || function (id) { return id; },
            positions: opts.positions || (Array.isArray(model.positions) ? model.positions : []),
        };
        var rows = rowsFor(model);
        var plotW = width - LEFT - RIGHT - (column ? GAP + COL : 0);
        var rowH = opts.labels ? ROW_H_LABELS : ROW_H;
        var focus = opts.detail !== 'all';
        var b = block(ctx, w, rows, { y0: TOP, rowH: rowH, labels: opts.labels, focus: focus, plotW: plotW, zoom: opts.zoom, column: column, prefix: opts.prefix || (opts.labels ? 'n' : 'o') });
        var inWindow = model.events.filter(function (e) { return overlaps(e, w); });
        var items = legendItems(rows, inWindow, !!opts.zoom);
        if (focus) {
            var keep = focusSet(model, ctx.T, ctx.positions);
            var hidden = inWindow.filter(function (e) { return !keep.has(e) && (e.lane === 'file' || e.kind === 'location' || /^snap-/.test(e.kind)); }).length;
            if (hidden) items.splice(items.length - 1, 0, ['○', 'Blek: annan händelse i fönstret (' + hidden + '), står i tabellen', COLORS.muted]);
        }
        var lg = legend(items, b.bottom + 32, width - RIGHT);
        var extra = (lg.lines - 1) * LEGEND_H;
        var height = b.bottom + FOOTER + extra;
        var out = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' +
            '<rect width="' + width + '" height="' + height + '" fill="' + COLORS.bg + '"/>';
        out += text(LEFT, 18, opts.title || ('Tidslinje ' + w.label), { size: 13, weight: 'bold' });
        out += b.svg;
        out += lg.svg;
        out += text(LEFT, b.bottom + 48 + extra, opts.footer || '', { size: 9, fill: COLORS.muted });
        return out + '</svg>';
    }

    var api = { svg: svg, rowsFor: rowsFor, stateAt: stateAt, tMarker: tMarker, snapLabel: snapLabel, fileLabel: fileLabel, legendItems: legendItems, focusSet: focusSet, tickStep: tickStep, dur: dur, ROWS: ROWS, COLORS: COLORS, STATE_LABEL: STATE_LABEL };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceTimeline = api;
})(typeof window !== 'undefined' ? window : this);
