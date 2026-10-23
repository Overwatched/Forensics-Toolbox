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

    function setStatus(text) { $('status').textContent = text || ''; }

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

    function visiblePoints() {
        var out = [];
        layers.forEach(function (layer) {
            if (!layer.visible) return;
            layer.points.forEach(function (p) { if (inRange(p)) out.push(p); });
        });
        return out;
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
        var note = points.length + ' punkter i ' + layers.filter(function (l) { return l.visible; }).length + ' källor.';
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
            var del = make('button', 'quiet', '×');
            del.type = 'button';
            del.title = 'Ta bort källa';
            del.addEventListener('click', function () { layers = layers.filter(function (l) { return l !== layer; }); refresh(); });
            var actions = make('div', 'layer-actions');
            actions.append(eye, route, bubbles, del);
            row.append(swatch, name, actions);
            list.append(row);
        });
    }

    function paint(layer, points) {
        points.forEach(function (p) {
            p.color = layer.color;
            p.layer = layer.name;
            p.layerId = layer.id;
            if (!p.device) p.device = layer.name;
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
            onContext: function (pos) {
                clickAt = pos;
                $('manual').classList.remove('display-none');
                $('manual-where').textContent = pos.lat.toFixed(5) + ', ' + pos.lon.toFixed(5);
            },
        });
        return mapView;
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
        $(id).addEventListener('input', refresh);
        $(id).addEventListener('change', refresh);
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
            device: 'Manuella', layer: 'Manuella', layerId: layer.id, color: layer.color,
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
                lines.push([p.name, p.lat, p.lon, p.taken ? p.taken.text : '', p.layer || ''].map(function (v) {
                    return '"' + String(v).replace(/"/g, '""') + '"';
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
        if (!p.device) p.device = layer.name;
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
        if (!data.layerKey) { addChunked('EXIF & karta', data.points); return; }
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
        var kept = {};
        layer.points.forEach(function (p) { if (p.exifId != null) kept[p.exifId] = p.id; });
        layer.points = data.points.map(function (src) { return placeOnLayer(layer, src, kept); });
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

    window.addEventListener('message', function (e) {
        var data = e.data;
        if (!data || data.source !== 'forensics-toolbox' || data.type !== 'positions' || !Array.isArray(data.points)) return;
        receivePositions(data);
    });

    ensureMap().show();
})();
