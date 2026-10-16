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
        if (!/^\d{2}:\d{2}$/.test(t)) t = '';
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
                        points: layer.points.map(pointData),
                    };
                }),
                thumbs: thumbs,
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
        refresh();
        ensureMap().setState(data.map);
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

    function ensureMap() {
        if (mapView) return mapView;
        mapView = ToolboxMap.create({
            host: $('map-host'),
            routeOn: true,
            route: currentRoute,
            getFile: function (id) {
                var found = null;
                layers.forEach(function (layer) {
                    layer.points.forEach(function (p) { if (p.id === id) found = p; });
                });
                return found && found.file ? found.file : null;
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
        if (layers.some(function (l) { return l.name === 'Testdata · Stockholm'; })) {
            setStatus('Testdata finns redan.');
            return;
        }
        addChunked('Testdata · Stockholm', SampleData.positionPoints());
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

    window.addEventListener('message', function (e) {
        var data = e.data;
        if (!data || data.source !== 'forensics-toolbox' || data.type !== 'positions' || !Array.isArray(data.points)) return;
        addChunked('EXIF & karta', data.points);
    });

    ensureMap().show();
})();
