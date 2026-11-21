(function () {
    'use strict';

    var COLORS = ['#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff375f', '#ffd60a'];
    var layers = [];
    var nextId = 1;
    var pendingCsv = null;
    var clickAt = null;
    var mapView = null;

    function $(id) { return document.getElementById(id); }
    function make(tag, className, text) {
        var n = document.createElement(tag);
        if (className) n.className = className;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    // Texten står i sidopanelen och, så att den syns, också som en ruta på kartan. kind: 'busy', 'ok' eller 'error'.
    function setStatus(text, kind) {
        $('status').textContent = text || '';
        if (mapView && text) mapView.notify(text, kind || 'ok');
    }

    function timeBound(date, time, end) {
        var d = (date || '').trim();
        var t = (time || '').trim();
        if (!d && !t) return '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
        var clockMatch = /^(\d{2}:\d{2})(?::\d{2})?$/.exec(t);
        t = clockMatch ? clockMatch[1] : '';
        var clock = t ? t + (end ? ':59' : ':00') : (end ? '23:59:59' : '00:00:00');
        return d + ' ' + clock;
    }

    function inRange(p) {
        var from = timeBound($('time-from-date').value, $('time-from-time').value, false);
        var to = timeBound($('time-to-date').value, $('time-to-time').value, true);
        if (!from && !to) return true;
        if (!p.taken) return false;
        var wall = p.taken.sort.slice(0, 19);
        if (from && wall < from) return false;
        if (to && wall > to) return false;
        return true;
    }

    // Täta positioner glesas ut: en per källa och tidsintervall (den med bäst noggrannhet). En fil (en bild) och en
    // punkt utan tid visas alltid. thinMinutes 0 = alla.
    var thinMinutes = 0;
    var thinned = { shown: 0, total: 0 };
    // En fil (en bild) och en händelse (samtal, meddelande) visas alltid för sig: de glesas inte ut och blir inga vistelser.
    function isFilePoint(p) { return p.exifId != null || !!p.path || !!p.file; }
    function pointMs(p) { return p.taken && p.taken.sort ? MapCore.instant(p.taken.sort, p.taken.zone || '') : null; }
    function thin(list) {
        thinned = { shown: list.length, total: list.length };
        if (!thinMinutes) return list;
        var size = thinMinutes * 60000, best = {}, out = [];
        list.forEach(function (p, i) {
            var ms = isFilePoint(p) || p.stay ? null : pointMs(p);
            if (ms === null) { out.push({ p: p, i: i }); return; }
            var key = p.layerId + ':' + Math.floor(ms / size);
            var have = best[key];
            var acc = function (q) { return q.accuracy > 0 ? q.accuracy : Infinity; };
            if (!have) { best[key] = { p: p, i: i }; out.push(best[key]); }
            else if (acc(p) < acc(have.p)) { have.p = p; }
        });
        var kept = out.sort(function (a, b) { return a.i - b.i; }).map(function (x) { return x.p; });
        thinned = { shown: kept.length, total: list.length };
        return kept;
    }

    // Vistelser: positioner i följd inom 100 m under minst 5 minuter blir en ring (MapCore.summarizeTrack, samma gräns
    // som Härkomst), med ankomst, avfärd och varaktighet. Förflyttningarna emellan står kvar som punkter. En fil (en
    // bild), ett besök och en punkt utan tid visas alltid. viewMode 'all' visar alla punkter.
    var viewMode = 'all';
    var stayIds = {};
    var nextStayId = 1000000000;
    function durationText(ms) {
        var m = Math.round(ms / 60000);
        return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
    }
    function stayPoint(x) {
        var first = x.members[0].p, last = x.members[x.members.length - 1].p;
        var key = first.layerId + ':' + x.from;
        var id = stayIds[key] || (stayIds[key] = nextStayId++);
        var dur = durationText(x.to - x.from);
        // Raderna i databasen som vistelsen är gjord av: den SQL som flest av positionerna kom ur.
        var bySql = {}, origin = null;
        x.members.forEach(function (m) {
            var o = m.p.origin;
            if (!o || !o.sql) return;
            var g = bySql[o.sql] || (bySql[o.sql] = Object.assign({}, o, { rows: [] }));
            (o.rows || []).forEach(function (r) { if (g.rows.indexOf(r) < 0) g.rows.push(r); });
            if (!origin || g.rows.length > origin.rows.length) origin = g;
        });
        var dbCol = (first.extra || []).filter(function (e) { return e[0] === 'Databas'; })[0];
        return {
            id: id, stay: true, visit: true, name: 'Vistelse ' + dur, path: '', lat: x.lat, lon: x.lon,
            taken: first.taken, until: last.taken, accuracy: Math.max(25, Math.round(x.radius)), count: x.count, origin: origin,
            layer: first.layer, layerId: first.layerId, color: first.color, type: 'Vistelse', device: first.device || '', source: first.source,
            stayLabel: dur, extra: [['Område', 'inom ' + Math.max(1, Math.round(x.radius)) + ' m från mitten'], dbCol || null, origin && origin.title ? ['Urval', origin.title] : null].filter(Boolean),
        };
    }
    function staysOf(list) {
        if (viewMode !== 'stays') return list;
        var byLayer = {}, out = [];
        list.forEach(function (p) {
            var ms = isFilePoint(p) || p.visit ? null : pointMs(p);
            if (ms === null) { out.push(p); return; }
            (byLayer[p.layerId] = byLayer[p.layerId] || []).push({ at: ms, lat: p.lat, lon: p.lon, p: p });
        });
        Object.keys(byLayer).forEach(function (id) {
            MapCore.summarizeTrack(byLayer[id], { stepM: 0, stepMs: 0 }).forEach(function (x) {
                if (x.kind === 'stay') out.push(stayPoint(x));
                else if (!x.inStay) out.push(x.item.p);
            });
        });
        return out;
    }

    function visiblePoints() {
        var out = [];
        layers.forEach(function (layer) {
            if (!layer.visible) return;
            layer.points.forEach(function (p) { if (inRange(p)) out.push(p); });
        });
        return thin(staysOf(out));
    }

    function currentRoute(points) {
        var grouped = {};
        var order = [];
        points.forEach(function (p) {
            if (!grouped[p.layerId]) { grouped[p.layerId] = []; order.push(p.layerId); }
            grouped[p.layerId].push(p);
        });
        var trips = [];
        var steps = [];
        var total = 0;
        var bad = 0;
        var assumed = 0;
        var untimed = 0;
        order.forEach(function (id) {
            var layer = layers.filter(function (l) { return l.id === id; })[0];
            if (!layer || !layer.route) return;
            var r = MapCore.route(grouped[id]);
            assumed += r.assumed;
            untimed += r.untimed;
            bad += r.implausible;
            r.trips.forEach(function (trip) {
                if (trip.steps.length < 2) return;
                trip.color = layer.color;
                trip.index = trips.length + 1;
                trip.steps.forEach(function (s) { s.trip = trip.index; steps.push(s); });
                trips.push(trip);
                total += trip.meters;
            });
        });
        return { steps: steps, trips: trips, assumed: assumed, untimed: untimed, assumedZone: '', totalMeters: total, implausible: bad, stays: [] };
    }

    function refresh() {
        renderLayers();
        redraw();
    }

    function redraw() {
        var points = visiblePoints();
        var shownLayers = layers.filter(function (l) { return l.visible; }).length;
        var note = points.length + (points.length === 1 ? ' punkt' : ' punkter') + ' i ' + shownLayers + (shownLayers === 1 ? ' källa.' : ' källor.') +
            (thinned.shown < thinned.total ? ' ' + (thinned.total - thinned.shown) + ' täta positioner dolda (en per ' + thinMinutes + ' min).' : '') +
            (viewMode === 'stays' ? (function (n) { return ' ' + n + (n === 1 ? ' vistelse.' : ' vistelser.'); })(points.filter(function (p) { return p.stay; }).length) : '');
        if (mapView) mapView.setPoints(points, note);
        fillRouteSpan();
    }

    var routeDefaults = { from: '', to: '' };

    function fillRouteSpan() {
        var span = mapView && mapView.numberSpan ? mapView.numberSpan() : null;
        var next = span ? { from: String(span.first), to: String(span.last) } : { from: '', to: '' };
        ['from', 'to'].forEach(function (key) {
            var el = $(key === 'from' ? 'route-from' : 'route-to');
            if (document.activeElement === el) return;
            if (!el.value || el.value === routeDefaults[key]) el.value = next[key];
        });
        routeDefaults = next;
    }

    var colorTimer = null;

    function setColor(layer, color) {
        layer.color = color;
        layer.points.forEach(function (p) { p.color = color; });
        clearTimeout(colorTimer);
        colorTimer = setTimeout(redraw, 80);
    }

    function renderLayers() {
        var list = $('layer-list');
        list.textContent = '';
        layers.forEach(function (layer) {
            var row = make('div', 'layer');
            // Listan ritas inte om här, då skulle färgväljaren stängas mitt i valet.
            var swatch = make('input', 'swatch');
            swatch.type = 'color';
            swatch.value = layer.color;
            swatch.title = 'Byt färg på ' + layer.name;
            swatch.addEventListener('input', function () { setColor(layer, swatch.value); });
            var name = make('span', '', layer.name + ' (' + layer.points.length + ')');
            var eye = make('button', '', layer.visible ? 'Dölj' : 'Visa');
            eye.type = 'button';
            eye.addEventListener('click', function () { layer.visible = !layer.visible; refresh(); });
            var route = make('button', '', layer.route ? 'Rutt på' : 'Rutt av');
            route.type = 'button';
            route.addEventListener('click', function () { layer.route = !layer.route; refresh(); });
            var bubbles = make('button', '', 'Anpassa');
            bubbles.type = 'button';
            bubbles.title = 'Anpassa bubblorna för ' + layer.name;
            bubbles.addEventListener('click', function () {
                var ids = visiblePoints().filter(function (p) { return p.layerId === layer.id; }).map(function (p) { return p.id; });
                if (!ids.length) { setStatus('Inga punkter från ' + layer.name + ' visas just nu.'); return; }
                adaptPoints(ids, layer.name);
            });
            // Var var telefonen när bilderna i källan togs: positionerna runt varje bilds tid, ur extraktionen.
            var marks = phoneMarks(layer);
            var phone = null;
            if (marks.length) {
                phone = make('button', '', 'Telefonen…');
                phone.type = 'button';
                phone.title = 'Var var telefonen när bilderna togs? Telefonens positioner runt varje bilds tid, ur extraktionen som är öppen.';
                phone.addEventListener('click', function () { row.classList.toggle('show-phone'); });
            }
            var del = make('button', 'quiet', '×');
            del.type = 'button';
            del.title = 'Ta bort källa';
            del.addEventListener('click', function () { layers = layers.filter(function (l) { return l !== layer; }); refresh(); });
            var actions = make('div', 'layer-actions');
            actions.append(eye, route, bubbles);
            if (phone) actions.append(phone);
            actions.append(del);
            row.append(swatch, name, actions);
            if (phone) {
                var ask = make('div', 'layer-phone');
                ask.append(make('span', '', marks.length + (marks.length === 1 ? ' bild med tid' : ' bilder med tid') + ', ±'));
                var span = make('select');
                span.setAttribute('aria-label', 'Minuter före och efter');
                [5, 15, 60].forEach(function (m) { var o = make('option', '', m + ' min'); o.value = String(m); span.append(o); });
                span.value = '15';
                var go = make('button', 'secondary-btn', 'Hämta positionerna');
                go.type = 'button';
                go.addEventListener('click', function () {
                    var minutes = Number(span.value);
                    setStatus('Letar efter telefonens positioner ±' + minutes + ' min kring ' + marks.length + (marks.length === 1 ? ' bild' : ' bilder') + ' i ' + layer.name + '…', 'busy');
                    window.parent.postMessage({ source: 'forensics-toolbox', type: 'phone-positions', atMs: marks[0].atMs, minutes: minutes, marks: marks, label: layer.name, key: 'layer' + layer.id }, '*');
                    row.classList.remove('show-phone');
                });
                ask.append(span, go);
                row.append(ask);
            }
            list.append(row);
        });
    }

    // ---------- Samtal och meddelanden i tidslinjen ----------
    // Queries läser samtalen och meddelandena i tidsspannet för punkterna som visas. De har ingen egen position och ritas
    // inte på kartan: de står i kartans tidslinje och i listan under den, med positionen närmast i tid som en länk.
    var EVENT_GAP = 30 * 60000;
    function realMs(p) {
        return p.taken && MapCore.zoneMinutes(p.taken.zone) !== null ? MapCore.instant(p.taken.sort, p.taken.zone) : null;
    }
    function eventRefs() {
        var out = [];
        layers.forEach(function (l) {
            if (!l.visible) return;
            l.points.forEach(function (p) { var ms = realMs(p); if (ms !== null) out.push({ ms: ms, p: p }); });
        });
        return out.sort(function (a, b) { return a.ms - b.ms; });
    }
    function placeEvents(events) {
        var dirWord = { ut: 'utgående', in: 'inkommande', missat: 'missat' };
        var list = events.map(function (e) {
            var who = e.who ? (e.dir === 'ut' ? ' till ' : ' från ') + e.who : '';
            return {
                key: [e.kind, e.ms, e.app, e.who, e.dir].join('|'), kind: e.kind, ms: e.ms, app: e.app || '', dir: e.dir || '', dirText: dirWord[e.dir] || e.dir || '',
                duration: e.duration || 0, source: e.source || '', origin: e.origin || null,
                name: e.kind === 'call' ? (e.dir === 'missat' ? 'Missat samtal' : 'Samtal') + who : 'Meddelande' + who,
            };
        });
        var total = ensureMap().addEvents(list);
        ensureMap().showEvents(true);
        return { placed: list.length, total: total };
    }
    $('events-add').addEventListener('click', function () {
        var refs = eventRefs();
        if (!refs.length) { setStatus('Lägg först till positioner eller bilder med tid och zon. Händelserna läses för tiderna de täcker.', 'error'); return; }
        // Ett fönster runt varje position, ihopslaget där fönstren går omlott: bara tiderna där det finns en position att
        // lägga händelsen vid läses.
        var wins = [];
        refs.forEach(function (r) {
            var last = wins[wins.length - 1];
            if (last && r.ms - EVENT_GAP <= last.endMs) last.endMs = Math.max(last.endMs, r.ms + EVENT_GAP);
            else wins.push({ startMs: r.ms - EVENT_GAP, endMs: r.ms + EVENT_GAP });
        });
        var total = wins.reduce(function (n, w) { return n + w.endMs - w.startMs; }, 0);
        if (total > 62 * 86400000) { setStatus('Positionerna täcker mer än två månader. Välj ett kortare tidsspann längst ner.', 'error'); return; }
        setStatus('Läser samtal och meddelanden kring ' + refs.length + (refs.length === 1 ? ' position' : ' positioner') + ' (' + wins.length + (wins.length === 1 ? ' tidsfönster' : ' tidsfönster') + ')…', 'busy');
        window.parent.postMessage({ source: 'forensics-toolbox', type: 'phone-events', fromMs: wins[0].startMs, toMs: wins[wins.length - 1].endMs, windows: wins }, '*');
    });

    // Bilderna i en källa med en verklig tidpunkt (tid med zon): { atMs, title }.
    function phoneMarks(layer) {
        var out = [];
        layer.points.forEach(function (p) {
            if (!isFilePoint(p) || !p.taken || MapCore.zoneMinutes(p.taken.zone) === null) return;
            var ms = MapCore.instant(p.taken.sort, p.taken.zone);
            if (ms !== null) out.push({ atMs: ms, title: p.name });
        });
        return out;
    }

    function paint(layer, points) {
        points.forEach(function (p) {
            p.color = layer.color;
            p.layer = layer.name;
            p.layerId = layer.id;
            // Varje fil numrerar sina punkter från 1. Kartan behöver id som är unika
            // över alla källor, annars döljs och tas fel punkter bort.
            p.id = nextId++;
        });
        return points;
    }

    function addLayer(name, points) {
        var layer = { id: nextId++, name: name, color: COLORS[layers.length % COLORS.length], visible: true, route: true, points: [] };
        paint(layer, points);
        layer.points = points;
        layers.push(layer);
        return layer;
    }

    function addChunked(name, points) {
        var layer = addLayer(name, []);
        var i = 0;
        function step() {
            var slice = points.slice(i, i + 2000);
            paint(layer, slice);
            layer.points = layer.points.concat(slice);
            i += slice.length;
            setStatus(layer.name + ': ' + i + ' av ' + points.length);
            if (i < points.length) setTimeout(step, 0);
            else { setStatus(points.length + ' punkter från ' + name + '.'); refresh(); }
        }
        if (points.length > 2000) step();
        else { layer.points = paint(layer, points); setStatus(points.length + ' punkter från ' + name + '.'); refresh(); }
    }

    function takeResult(name, result) {
        if (result.error) { setStatus(result.error); return; }
        if (result.headers && result.columns && (result.columns.lat < 0 || result.columns.lon < 0)) {
            pendingCsv = { name: name, text: result.text };
            showColumns(result);
            return;
        }
        var extra = result.skipped ? ' ' + result.skipped + ' rader saknade giltig position.' : '';
        if (result.swapped) extra += ' Latitud och longitud såg ombytta ut och byttes.';
        addChunked(name, result.points);
        if (extra) setStatus($('status').textContent + extra);
    }

    function showColumns(result) {
        var box = $('columns');
        box.classList.remove('display-none');
        box.textContent = '';
        box.append(make('span', '', 'Välj kolumner för ' + pendingCsv.name));
        ['lat', 'lon', 'time', 'name'].forEach(function (key) {
            var sel = make('select');
            sel.dataset.col = key;
            var blank = make('option', '', key);
            blank.value = '';
            sel.append(blank);
            result.headers.forEach(function (h, i) {
                var o = make('option', '', h || ('Kolumn ' + (i + 1)));
                o.value = String(i);
                sel.append(o);
            });
            box.append(sel);
        });
        var go = make('button', 'primary-btn', 'Importera');
        go.type = 'button';
        go.addEventListener('click', function () {
            var columns = { lat: -1, lon: -1, time: -1, name: -1, accuracy: -1 };
            box.querySelectorAll('select').forEach(function (sel) {
                columns[sel.dataset.col] = sel.value === '' ? -1 : Number(sel.value);
            });
            var parsed = MapImport.parseCsv(pendingCsv.text, columns);
            box.classList.add('display-none');
            takeResult(pendingCsv.name, parsed);
        });
        box.append(go);
    }

    var VIEW_KIND = 'positioner-vy';
    var THUMB_EDGE = 480;
    var THUMB_MAX = 500;

    function asView(text) {
        if (!/^\s*\{/.test(text) || text.indexOf(VIEW_KIND) < 0) return null;
        try {
            var data = JSON.parse(text);
            return data && data.kind === VIEW_KIND && Array.isArray(data.layers) ? data : null;
        } catch (err) {
            return null;
        }
    }

    function thumbnail(file) {
        if (!file || !/^image\//.test(file.type) || typeof createImageBitmap !== 'function') return Promise.resolve(null);
        return createImageBitmap(file).then(function (bitmap) {
            var scale = Math.min(1, THUMB_EDGE / Math.max(bitmap.width, bitmap.height));
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            if (bitmap.close) bitmap.close();
            return canvas.toDataURL('image/jpeg', 0.8);
        }).catch(function () { return null; });
    }

    function dataUrlFile(url, name) {
        var m = /^data:(image\/[a-z+.-]+);base64,(.*)$/i.exec(url || '');
        if (!m) return null;
        var bin = atob(m[2]);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new File([bytes], name || 'miniatyr.jpg', { type: m[1] });
    }

    function pointData(p) {
        var out = {};
        Object.keys(p).forEach(function (key) { if (key !== 'file') out[key] = p[key]; });
        return out;
    }

    function saveView() {
        if (!layers.length) { setStatus('Inget att spara.'); return; }
        var withFile = [];
        layers.forEach(function (layer) {
            layer.points.forEach(function (p) { if (p.file && withFile.length < THUMB_MAX) withFile.push(p); });
        });
        setStatus(withFile.length ? 'Sparar vyn och ' + withFile.length + ' miniatyrer…' : 'Sparar vyn…');
        var thumbs = {};
        var chain = Promise.resolve();
        withFile.forEach(function (p) {
            chain = chain.then(function () {
                return thumbnail(p.file).then(function (url) { if (url) thumbs[p.id] = url; });
            });
        });
        chain.then(function () {
            var data = {
                app: 'Forensics Toolbox',
                kind: VIEW_KIND,
                version: 1,
                saved: new Date().toISOString(),
                time: {
                    fromDate: $('time-from-date').value, fromTime: $('time-from-time').value,
                    toDate: $('time-to-date').value, toTime: $('time-to-time').value,
                },
                layers: layers.map(function (layer) {
                    return {
                        id: layer.id, name: layer.name, color: layer.color, visible: layer.visible, route: layer.route,
                        key: layer.key || '',
                        points: layer.points.map(pointData),
                    };
                }),
                thumbs: thumbs,
                thin: thinMinutes,
                viewMode: viewMode,
                routes: namedRoutes,
                map: mapView ? mapView.getState() : null,
            };
            var stamp = data.saved.slice(0, 16).replace('T', '-').replace(':', '');
            download(JSON.stringify(data), 'application/json', 'positioner-vy-' + stamp + '.json');
            setStatus('Vyn sparades. Öppna filen med Öppna vy… för att fortsätta senare.');
        });
    }

    function openView(data, filename) {
        if (layers.length && !window.confirm('Ersätta källorna som visas nu med vyn ' + filename + '?')) return;
        var thumbs = data.thumbs || {};
        var maxId = 0;
        var count = 0;
        layers = data.layers.map(function (saved, i) {
            var layer = {
                id: Number(saved.id) || i + 1,
                key: typeof saved.key === 'string' ? saved.key : '',
                name: String(saved.name || 'Källa ' + (i + 1)),
                color: /^#[0-9a-f]{6}$/i.test(saved.color) ? saved.color : COLORS[i % COLORS.length],
                visible: saved.visible !== false,
                route: saved.route !== false,
                points: [],
            };
            maxId = Math.max(maxId, layer.id);
            layer.points = (saved.points || []).filter(function (p) {
                return p && isFinite(p.lat) && isFinite(p.lon);
            }).map(function (p) {
                p.color = layer.color;
                p.layer = layer.name;
                p.layerId = layer.id;
                if (thumbs[p.id]) p.file = dataUrlFile(thumbs[p.id], p.name);
                maxId = Math.max(maxId, Number(p.id) || 0);
                return p;
            });
            count += layer.points.length;
            return layer;
        });
        nextId = maxId + 1;
        var time = data.time || {};
        $('time-from-date').value = time.fromDate || '';
        $('time-from-time').value = time.fromTime || '';
        $('time-to-date').value = time.toDate || '';
        $('time-to-time').value = time.toTime || '';
        ensureMap().setTimeSpan(timeSpanText());
        thinMinutes = [0, 1, 5, 10, 30, 60].indexOf(Number(data.thin)) >= 0 ? Number(data.thin) : 0;
        if ($('thin')) $('thin').value = String(thinMinutes);
        viewMode = data.viewMode === 'stays' ? 'stays' : 'all';
        if ($('view-mode')) $('view-mode').value = viewMode;
        loadRoutes(data);
        refresh();
        ensureMap().setState(data.map);
        ensureMap().setNamedRoutes(namedRoutes);
        setStatus('Vyn ' + filename + ' öppnades: ' + count + ' punkter i ' + layers.length + ' källor.');
    }

    function readFile(file) {
        return file.text().then(function (text) {
            var view = asView(text);
            if (view) { openView(view, file.name); return; }
            var result = MapImport.parse(text, file.name);
            result.text = text;
            var skipped = result.skipped || 0;
            takeResult(file.name, result);
            if (skipped && !result.headers) setStatus($('status').textContent);
        });
    }

    function findPoint(id) {
        var found = null;
        layers.forEach(function (layer) {
            layer.points.forEach(function (p) { if (p.id === id) found = p; });
        });
        return found;
    }

    function adaptPoints(ids, title) {
        var map = ensureMap();
        map.mark(ids);
        map.editBubbles(ids, title);
    }

    function ensureMap() {
        if (mapView) return mapView;
        mapView = ToolboxMap.create({
            host: $('map-host'),
            routeOn: true,
            route: currentRoute,
            getFile: function (id) {
                var found = findPoint(id);
                return found && found.file ? found.file : null;
            },
            onSelect: function (id) {
                var found = findPoint(id);
                if (!found || found.exifId == null) return false;
                window.parent.postMessage({ source: 'forensics-toolbox', type: 'show-exif', exifId: found.exifId }, '*');
                return true;
            },
            onRemove: function (id) {
                layers.forEach(function (layer) {
                    layer.points = layer.points.filter(function (p) { return p.id !== id; });
                });
                layers = layers.filter(function (layer) { return layer.points.length; });
                refresh();
            },
            // Var var telefonen: Queries letar upp positionerna runt tiden i extraktionen och skickar dem som en källa.
            phoneAround: function (p, atMs, minutes) {
                setStatus('Letar efter telefonens positioner ±' + minutes + ' min kring ' + (p.taken ? p.taken.text : '') + '…', 'busy');
                window.parent.postMessage({ source: 'forensics-toolbox', type: 'phone-positions', atMs: atMs, minutes: minutes, title: p.name }, '*');
            },
            // Allt runt tiden: telefonens positioner först, sedan samtalen och meddelandena (i tidslinjen, de har ingen plats).
            aroundTime: function (p, atMs, minutes) {
                around = { atMs: atMs, minutes: minutes, step: 'positions' };
                setStatus('Läser positioner, samtal och meddelanden ±' + minutes + ' min kring ' + (p.taken ? p.taken.text : '') + '…', 'busy');
                window.parent.postMessage({ source: 'forensics-toolbox', type: 'phone-positions', atMs: atMs, minutes: minutes, title: p.name, key: 'around' + atMs }, '*');
            },
            // Källan: databasen i Queries med samma SQL och raden markerad.
            openSource: function (p) {
                if (!p.origin) return;
                window.parent.postMessage({ source: 'forensics-toolbox', type: 'open-source', origin: p.origin, text: p.name, time: p.taken ? p.taken.text : '' }, '*');
            },
            onContext: function (pos) {
                clickAt = pos;
                $('manual').classList.remove('display-none');
                $('manual-where').textContent = pos.lat.toFixed(5) + ', ' + pos.lon.toFixed(5);
            },
        });
        // Tidsspannet står i kartans rad längst ner, och de namngivna rutterna under Rutt.
        mapView.addToMenu('time', $('time-block'));
        var viewBox = make('div', 'side-block');
        viewBox.append(make('h2', '', 'Visa positionerna'));
        var viewSel = make('select');
        viewSel.id = 'view-mode';
        viewSel.setAttribute('aria-label', 'Visa positionerna');
        [['all', 'Alla punkter'], ['stays', 'Vistelser och förflyttningar']].forEach(function (o) {
            var opt = make('option', '', o[1]);
            opt.value = o[0];
            viewSel.append(opt);
        });
        viewSel.value = viewMode;
        var stayBubbles = make('button', 'secondary-btn display-none', 'Ankomst, avfärd och tid i bubblor');
        stayBubbles.type = 'button';
        stayBubbles.title = 'En bubbla per vistelse med ankomst, avfärd, varaktighet, antal positioner och källa. Anpassa bubblan ändrar den.';
        stayBubbles.addEventListener('click', function () {
            var cfgs = {};
            visiblePoints().filter(function (p) { return p.stay; }).forEach(function (p) {
                var cfg = MapCore.defaultBubble({ arrival: true, departure: true, duration: true, count: true, source: true });
                cfg.titles = true;
                cfg.leader = true;
                cfgs[p.id] = cfg;
            });
            if (!Object.keys(cfgs).length) { setStatus('Inga vistelser visas.', 'error'); return; }
            ensureMap().setBubbles(null, cfgs);
        });
        var setView = function (mode) {
            viewMode = mode === 'stays' ? 'stays' : 'all';
            viewSel.value = viewMode;
            stayBubbles.classList.toggle('display-none', viewMode !== 'stays');
            mapView.setActive('view', viewMode === 'stays' ? { text: 'Vistelser', pop: 'points', title: 'Täta positioner visas som vistelser. × visar alla punkter.', clear: function () { setView('all'); } } : null);
            redraw();
        };
        viewSel.addEventListener('change', function () { setView(viewSel.value); });
        viewBox.append(viewSel, make('p', 'zone-note', 'En vistelse: positioner inom 100 m under minst 5 minuter, som en ring med ankomst, avfärd och tid. Bilder och punkter utan tid visas alltid.'), stayBubbles);
        mapView.addToMenu('points', viewBox);
        var thinBox = make('div', 'side-block');
        thinBox.append(make('h2', '', 'Täta positioner'));
        var thinSel = make('select');
        thinSel.id = 'thin';
        thinSel.setAttribute('aria-label', 'Glesa ut täta positioner');
        [[0, 'Visa alla'], [1, 'En per minut'], [5, 'En per 5 min'], [10, 'En per 10 min'], [30, 'En per 30 min'], [60, 'En per timme']].forEach(function (o) {
            var opt = make('option', '', o[1]);
            opt.value = String(o[0]);
            thinSel.append(opt);
        });
        thinSel.value = String(thinMinutes);
        var setThin = function (m) {
            thinMinutes = Number(m) || 0;
            thinSel.value = String(thinMinutes);
            mapView.setActive('thin', thinMinutes ? { text: thinMinutes === 60 ? 'En per timme' : 'En per ' + thinMinutes + ' min', pop: 'points', title: 'Täta positioner glesas ut. × visar alla.', clear: function () { setThin(0); } } : null);
            redraw();
        };
        thinSel.addEventListener('change', function () { setThin(thinSel.value); });
        thinBox.append(thinSel, make('p', 'zone-note', 'En position per källa och intervall, den med bäst noggrannhet. Bilder och punkter utan tid visas alltid.'));
        mapView.addToMenu('points', thinBox);
        mapView.addToMenu('route', $('routes-block'));
        return mapView;
    }

    function timeSpanText() {
        var a = [$('time-from-date').value.trim(), $('time-from-time').value.trim()].filter(Boolean).join(' ');
        var b = [$('time-to-date').value.trim(), $('time-to-time').value.trim()].filter(Boolean).join(' ');
        return a || b ? (a || '…') + ' – ' + (b || '…') : '';
    }

    $('pick').addEventListener('click', function () { $('file').click(); });
    $('fill-sample').addEventListener('click', function () {
        if (layers.some(function (l) { return l.sample; })) {
            setStatus('Exemplet är redan inlagt.');
            return;
        }
        var scenario = SampleData.positionScenario();
        scenario.layers.forEach(function (spec) {
            var layer = addLayer(spec.name, spec.points);
            layer.sample = true;
            layer.color = spec.color;
            layer.points.forEach(function (p) { p.color = spec.color; });
        });
        refresh();
        var numbering = MapCore.numberPoints(visiblePoints(), []).numbers;
        var byName = {};
        layers.forEach(function (layer) {
            layer.points.forEach(function (p) { byName[p.name] = p; });
        });
        namedRoutes = [];
        scenario.routes.forEach(function (route) {
            var nums = route.files.map(function (name) {
                return byName[name] ? numbering[byName[name].id] : 0;
            }).filter(Boolean);
            if (nums.length < 2) return;
            var from = Math.min.apply(null, nums);
            var to = Math.max.apply(null, nums);
            if (to - from + 1 !== nums.length) return;
            namedRoutes.push({ name: route.name, from: from, to: to, visible: true });
        });
        $('route-error').textContent = '';
        renderRouteList();
        var bubbles = {};
        var shifts = {};
        scenario.bubbles.forEach(function (item) {
            var point = byName[item.file];
            if (!point) return;
            var cfg = MapCore.defaultBubble({ time: true, note: !!point.note });
            cfg.leader = true;
            cfg.ring = !!item.ring;
            bubbles[point.id] = cfg;
            if (item.shift) shifts[point.id] = item.shift;
        });
        ensureMap().setNamedRoutes(namedRoutes);
        ensureMap().setBubbles(null, bubbles, shifts);
        ensureMap().fitView();
        setStatus(scenario.summary);
    });
    $('file').addEventListener('change', function () {
        var files = Array.prototype.slice.call($('file').files || []);
        $('file').value = '';
        var chain = Promise.resolve();
        files.forEach(function (file) { chain = chain.then(function () { return readFile(file); }); });
    });
    $('view-save').addEventListener('click', saveView);
    $('view-open').addEventListener('click', function () { $('view-file').click(); });
    $('view-file').addEventListener('change', function () {
        var file = $('view-file').files && $('view-file').files[0];
        $('view-file').value = '';
        if (!file) return;
        file.text().then(function (text) {
            var view = asView(text);
            if (view) openView(view, file.name);
            else setStatus(file.name + ' är ingen sparad vy från Positioner.');
        });
    });
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
        e.preventDefault();
        Array.prototype.forEach.call(e.dataTransfer.files || [], readFile);
    });
    $('paste-add').addEventListener('click', function () {
        var text = $('paste').value;
        if (!text.trim()) return;
        takeResult('Inklistrad', MapImport.parse(text, 'klistra.txt'));
        $('paste').value = '';
    });
    ['time-from-date', 'time-from-time', 'time-to-date', 'time-to-time'].forEach(function (id) {
        var changed = function () { refresh(); if (mapView) mapView.setTimeSpan(timeSpanText()); };
        $(id).addEventListener('input', changed);
        $(id).addEventListener('change', changed);
    });

    $('manual-add').addEventListener('click', function () {
        if (!clickAt) return;
        var name = $('manual-name').value.trim() || 'Manuell punkt';
        var date = $('manual-date').value.trim();
        var clock = $('manual-time').value.trim();
        var time = date && clock ? date + ' ' + clock + ':00' : (date ? date + ' 00:00:00' : '');
        var layer = layers.filter(function (l) { return l.name === 'Manuella'; })[0] || addLayer('Manuella', []);
        var point = {
            id: nextId++, name: name, path: name, lat: clickAt.lat, lon: clickAt.lon, source: 'manuell',
            taken: time ? MapImport.takenFrom(time.replace('T', ' ') + ':00') : null,
            layer: 'Manuella', layerId: layer.id, color: layer.color,
        };
        layer.points.push(point);
        $('manual-name').value = '';
        refresh();
    });

    function download(text, type, filename) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: type }));
        a.download = filename;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }

    document.querySelector('.exports').addEventListener('click', function (e) {
        var button = e.target.closest('button');
        var kind = button && button.dataset.export;
        if (!kind) return;
        var points = visiblePoints();
        if (!points.length) { setStatus('Inget att exportera.'); return; }
        if (kind === 'kml') download(MapCore.toKml(points, { title: 'Positioner' }), 'application/vnd.google-earth.kml+xml', 'positioner.kml');
        if (kind === 'gpx') download(MapCore.toGpx(points, { title: 'Positioner' }), 'application/gpx+xml', 'positioner.gpx');
        if (kind === 'geojson') download(MapCore.toGeoJson(points, { tool: 'Positioner' }), 'application/geo+json', 'positioner.geojson');
        if (kind === 'csv') {
            var lines = ['namn,lat,lon,tid,kalla'];
            points.forEach(function (p) {
                // En cell som börjar med =, +, -, @, tabb eller vagnretur får en apostrof först, så att Excel
                // inte tolkar den som en formel. Ett vanligt tal (en negativ longitud) lämnas som det är.
                lines.push([p.name, p.lat, p.lon, p.taken ? p.taken.text : '', p.layer || ''].map(function (v) {
                    var s = String(v);
                    if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/.test(s)) s = "'" + s;
                    return '"' + s.replace(/"/g, '""') + '"';
                }).join(','));
            });
            download(lines.join('\n') + '\n', 'text/csv', 'positioner.csv');
        }
    });

    function placeOnLayer(layer, src, kept) {
        var p = Object.assign({}, src);
        p.color = layer.color;
        p.layer = layer.name;
        p.layerId = layer.id;
        if (p.exifId != null && Object.prototype.hasOwnProperty.call(kept, p.exifId)) {
            p.id = kept[p.exifId];
            delete kept[p.exifId];
        } else {
            p.id = nextId++;
        }
        if (p.id >= nextId) nextId = p.id + 1;
        return p;
    }

    // Samma nyckel uppdaterar källan i stället för att lägga till en kopia. Bildernas id
    // behålls, så att ruttval och bubblor ligger kvar när filtren i EXIF ändras.
    function receivePositions(data) {
        if (data.update === 'files') { receiveFiles(data); return; }
        if (!data.layerKey) { addChunked('EXIF', data.points); return; }
        var name = String(data.layerName || 'EXIF-bilder');
        var layer = layers.filter(function (l) { return l.key === data.layerKey; })[0];
        var created = !layer;
        if (!layer) {
            layer = {
                id: nextId++, key: data.layerKey, name: name,
                color: COLORS[layers.length % COLORS.length], visible: true, route: true, points: [],
            };
            if (layer.id >= nextId) nextId = layer.id + 1;
            layers.push(layer);
        }
        layer.name = name;
        if (created && data.route === false) layer.route = false;
        if (created && /^#[0-9a-f]{6}$/i.test(data.color || '')) layer.color = data.color;
        var kept = {};
        layer.points.forEach(function (p) { if (p.exifId != null) kept[p.exifId] = p.id; });
        layer.points = data.points.map(function (src) { return placeOnLayer(layer, src, kept); });
        if (pendingFiles[data.layerKey]) { receiveFiles({ layerKey: data.layerKey, files: pendingFiles[data.layerKey] }, true); delete pendingFiles[data.layerKey]; }
        refresh();
        var n = layer.points.length;
        var noun = Array.isArray(data.noun) && data.noun.length === 2 ? data.noun : ['bild', 'bilder'];
        var word = n === 1 ? noun[0] : noun[1];
        setStatus(created
            ? n + ' ' + word + ' lades till som källan ' + name + '.'
            : 'Källan ' + name + ' uppdaterades: ' + n + ' ' + word + '.');
        if (data.focusExifId != null) {
            var hit = layer.points.filter(function (p) { return p.exifId === data.focusExifId; })[0];
            if (hit) ensureMap().focus(hit.id);
        }
    }

    // Miniatyrerna som görs efter att punkterna skickats: från EXIF per bild (exifId), från Queries per rad
    // (fileKey). Kommer de före punkterna sparas de tills källan finns.
    var pendingFiles = {};
    function receiveFiles(data, quiet) {
        var layer = layers.filter(function (l) { return l.key === data.layerKey; })[0];
        var files = data.files || {};
        if (!layer) { pendingFiles[data.layerKey] = Object.assign(pendingFiles[data.layerKey] || {}, files); return; }
        var changed = false;
        layer.points.forEach(function (p) {
            var key = p.fileKey != null ? p.fileKey : p.exifId;
            var f = key != null ? files[key] : null;
            if (f && f !== p.file) { p.file = f; changed = true; }
        });
        if (changed && !quiet) redraw();
    }

    var namedRoutes = [];
    var routeTimer = null;

    function pointNumber(id) {
        var raw = $(id).value.trim();
        var n = Number(raw);
        return /^\d+$/.test(raw) && n >= 1 ? n : 0;
    }

    function syncRoutes() {
        renderRouteList();
        if (mapView) mapView.setNamedRoutes(namedRoutes);
    }

    function loadRoutes(data) {
        var list = Array.isArray(data.routes) ? data.routes : [];
        if (!list.length && data.routeText) {
            var parsed = MapCore.parseRouteText(data.routeText);
            if (parsed && !parsed.error) list = parsed.routes;
        }
        namedRoutes = list.filter(function (r) { return r && r.from >= 1 && r.to >= 1; }).map(function (r) {
            var from = Number(r.from);
            var to = Number(r.to);
            if (from > to) { var swap = from; from = to; to = swap; }
            return { name: String(r.name || 'Rutt'), from: from, to: to, visible: r.visible !== false };
        });
        $('route-error').textContent = '';
        renderRouteList();
    }

    function renderRouteList() {
        var list = $('route-list');
        list.textContent = '';
        namedRoutes.forEach(function (route, i) {
            var row = make('div', 'route-row');
            var swatch = make('span', 'route-swatch');
            swatch.style.background = MapCore.ROUTE_COLORS[i % MapCore.ROUTE_COLORS.length];
            var name = make('input', 'route-name');
            name.type = 'text';
            name.value = route.name;
            name.setAttribute('aria-label', 'Namn på rutten');
            name.addEventListener('input', function () {
                route.name = name.value.trim() || ('Rutt ' + (i + 1));
                clearTimeout(routeTimer);
                routeTimer = setTimeout(function () { if (mapView) mapView.setNamedRoutes(namedRoutes); }, 200);
            });
            name.addEventListener('blur', function () {
                if (!name.value.trim()) {
                    route.name = 'Rutt ' + (i + 1);
                    name.value = route.name;
                }
                if (mapView) mapView.setNamedRoutes(namedRoutes);
            });
            if (route.visible === false) row.classList.add('is-hidden');
            var range = make('span', 'range', route.from === route.to ? String(route.from) : route.from + '–' + route.to);
            var bubbles = make('button', '', 'Anpassa');
            bubbles.type = 'button';
            bubbles.title = 'Anpassa bubblorna för ' + route.name;
            bubbles.addEventListener('click', function () {
                var ids = ensureMap().idsInRange(route.from, route.to);
                if (!ids.length) { setStatus('Inga punkter i ' + route.name + '.'); return; }
                adaptPoints(ids, route.name);
            });
            var hide = make('button', '', route.visible === false ? 'Visa' : 'Dölj');
            hide.type = 'button';
            hide.title = route.visible === false ? 'Visa rutten igen' : 'Dölj den här rutten';
            hide.addEventListener('click', function () {
                route.visible = route.visible === false;
                syncRoutes();
            });
            var del = make('button', 'quiet', '×');
            del.type = 'button';
            del.title = 'Ta bort ' + route.name;
            del.addEventListener('click', function () {
                namedRoutes.splice(i, 1);
                $('route-error').textContent = '';
                syncRoutes();
            });
            var actions = make('div', 'route-actions');
            actions.append(bubbles, hide, del);
            row.append(swatch, name, range, actions);
            list.append(row);
        });
    }

    function addRoute() {
        var a = pointNumber('route-from');
        var b = pointNumber('route-to');
        if (!a && !b) {
            $('route-error').textContent = 'Fyll i första och sista punkten.';
            return;
        }
        if (!a) a = b;
        if (!b) b = a;
        if (a > b) { var swap = a; a = b; b = swap; }
        var clash = namedRoutes.filter(function (r) { return !(b < r.from || a > r.to); })[0];
        if (clash) {
            $('route-error').textContent = 'De punkterna ingår redan i ' + clash.name + '.';
            return;
        }
        namedRoutes.push({ name: 'Rutt ' + (namedRoutes.length + 1), from: a, to: b, visible: true });
        $('route-from').value = routeDefaults.from;
        $('route-to').value = routeDefaults.to;
        $('route-error').textContent = '';
        syncRoutes();
        var field = document.querySelectorAll('.route-name');
        var last = field[field.length - 1];
        if (last) { last.focus(); last.select(); }
    }

    $('route-add').addEventListener('click', addRoute);
    ['route-from', 'route-to'].forEach(function (id) {
        $(id).addEventListener('keydown', function (e) {
            if (e.key === 'Enter') addRoute();
        });
    });

    // Allt runt tiden pågår: { atMs, minutes, step }.
    var around = null;
    function aroundDone(text, ok) {
        var a = around;
        around = null;
        ensureMap().focusTime(a.atMs - a.minutes * 60000, a.atMs + a.minutes * 60000, true);
        setStatus(text, ok ? 'ok' : 'error');
    }
    window.addEventListener('message', function (e) {
        var data = e.data;
        if (data && data.source === 'forensics-toolbox' && data.type === 'phone-positions-done') {
            if (around && around.step === 'positions') {
                around.step = 'events';
                around.posText = data.text || '';
                var w = { startMs: around.atMs - Math.max(around.minutes, 30) * 60000, endMs: around.atMs + Math.max(around.minutes, 30) * 60000 };
                window.parent.postMessage({ source: 'forensics-toolbox', type: 'phone-events', fromMs: w.startMs, toMs: w.endMs, windows: [w] }, '*');
                return;
            }
            setStatus(data.text || '', data.ok ? 'ok' : 'error');
            return;
        }
        if (data && data.source === 'forensics-toolbox' && data.type === 'phone-events-done' && around && around.step === 'events') {
            if (data.ok && Array.isArray(data.events) && data.events.length) placeEvents(data.events);
            aroundDone(around.posText + ' ' + (data.text || '') + (data.ok && data.events && data.events.length ? ' De står i tidslinjen, inte på kartan.' : ''), data.ok);
            return;
        }
        if (data && data.source === 'forensics-toolbox' && data.type === 'phone-events-done') {
            var r = data.ok && Array.isArray(data.events) && data.events.length ? placeEvents(data.events) : null;
            setStatus((data.text || '') + (r ? ' De står i tidslinjen under kartan, inte på kartan: de har ingen egen position.' : ''), data.ok ? 'ok' : 'error');
            return;
        }
        if (!data || data.source !== 'forensics-toolbox' || data.type !== 'positions' || !Array.isArray(data.points)) return;
        receivePositions(data);
    });

    // Positioner följer inte extraktionen: källorna står kvar när den byts eller stängs (toolkit.js).
    if (window.toolboxHolds) window.toolboxHolds(function () {
        var n = layers.reduce(function (sum, l) { return sum + l.points.length; }, 0);
        return { items: layers.length ? [n + (n === 1 ? ' punkt' : ' punkter') + ' i ' + layers.length + (layers.length === 1 ? ' källa' : ' källor')] : [] };
    });

    // För provkörningen (tests/app): punkterna med vilken fil som kan visas som miniatyr, också utan WebGL.
    window.PositionsApp = {
        events: function () { return ensureMap().events(); },
        shown: function () { return ensureMap().drawnCount(); },
        times: function () { return ensureMap().times(); },
        range: function (from, to) { ensureMap().focusTime(from, to, false); },
        points: function () { return visiblePoints().map(function (p) { return { id: p.id, exifId: p.exifId, name: p.name, file: p.file ? p.file.type || '' : '', device: p.device || '', time: p.taken ? p.taken.text : '', type: p.type || '' }; }); },
        open: function (id) { return ensureMap().focus(id); },
    };

    ensureMap().show();
})();
