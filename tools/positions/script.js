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

    function inRange(p) {
        var from = $('time-from').value;
        var to = $('time-to').value;
        if (!from && !to) return true;
        if (!p.taken) return false;
        var wall = p.taken.sort.slice(0, 19);
        if (from && wall < from.replace('T', ' ')) return false;
        if (to && wall > to.replace('T', ' ') + ':59') return false;
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
        var points = visiblePoints();
        var note = points.length + ' punkter i ' + layers.filter(function (l) { return l.visible; }).length + ' källor.';
        if (mapView) mapView.setPoints(points, currentRoute(points), note);
    }

    function renderLayers() {
        var list = $('layer-list');
        list.textContent = '';
        layers.forEach(function (layer) {
            var row = make('div', 'layer');
            var swatch = make('span', 'swatch');
            swatch.style.background = layer.color;
            var name = make('span', '', layer.name + ' (' + layer.points.length + ')');
            var eye = make('button', '', layer.visible ? 'Dölj' : 'Visa');
            eye.type = 'button';
            eye.addEventListener('click', function () { layer.visible = !layer.visible; refresh(); });
            var route = make('button', '', layer.route ? 'Rutt på' : 'Rutt av');
            route.type = 'button';
            route.addEventListener('click', function () { layer.route = !layer.route; refresh(); });
            var del = make('button', '', '×');
            del.type = 'button';
            del.title = 'Ta bort källa';
            del.addEventListener('click', function () { layers = layers.filter(function (l) { return l !== layer; }); refresh(); });
            row.append(swatch, name, eye, route, del);
            list.append(row);
        });
    }

    function paint(layer, points) {
        points.forEach(function (p) {
            p.color = layer.color;
            p.layer = layer.name;
            p.layerId = layer.id;
            p.device = layer.name;
            if (!p.id) p.id = nextId++;
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

    function readFile(file) {
        return file.text().then(function (text) {
            var result = MapImport.parse(text, file.name);
            result.text = text;
            var skipped = result.skipped || 0;
            takeResult(file.name, result);
            if (skipped && !result.headers) setStatus($('status').textContent);
        });
    }

    function ensureMap() {
        if (mapView) return mapView;
        mapView = ToolboxMap.create({
            host: $('map-host'),
            routeOn: true,
            onContext: function (pos) {
                clickAt = pos;
                $('manual').classList.remove('display-none');
                $('manual-where').textContent = pos.lat.toFixed(5) + ', ' + pos.lon.toFixed(5);
            },
        });
        return mapView;
    }

    $('pick').addEventListener('click', function () { $('file').click(); });
    $('file').addEventListener('change', function () {
        var files = Array.prototype.slice.call($('file').files || []);
        $('file').value = '';
        var chain = Promise.resolve();
        files.forEach(function (file) { chain = chain.then(function () { return readFile(file); }); });
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
    ['time-from', 'time-to'].forEach(function (id) { $(id).addEventListener('change', refresh); });

    $('manual-add').addEventListener('click', function () {
        if (!clickAt) return;
        var name = $('manual-name').value.trim() || 'Manuell punkt';
        var time = $('manual-time').value;
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
        var kind = e.target.dataset && e.target.dataset.export;
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

    window.addEventListener('message', function (e) {
        var data = e.data;
        if (!data || data.source !== 'forensics-toolbox' || data.type !== 'positions' || !Array.isArray(data.points)) return;
        addChunked('EXIF & karta', data.points);
    });

    ensureMap().show();
})();
