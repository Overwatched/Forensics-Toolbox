// Kartvyn i EXIF-visaren. MapLibre och kartresurserna laddas först när kartan öppnas.
//
// Offline (standard): kartfilerna i appens maps/-mapp via ftmaps://, eller .pmtiles-filer
// som användaren väljer (HTML-versionen). Typsnitt och ikoner är inbäddade, så inget
// hämtas utanför datorn.
// Online (bara efter godkännande, gäller tills verktyget laddas om): OpenFreeMap. Tjänsten
// ser vilka kartrutor som hämtas, inte filerna eller deras metadata.
(function (root) {
    'use strict';

    var VENDOR_CSS = 'vendor/maps/maplibre-gl.css';
    var VENDOR_JS = ['vendor/maps/maplibre.js', 'vendor/maps/map-assets.js'];
    var MAP_DATA = 'ftmaps://data/';
    var ONLINE = {
        name: 'OpenFreeMap',
        host: 'tiles.openfreemap.org',
        styles: { light: 'https://tiles.openfreemap.org/styles/liberty', dark: 'https://tiles.openfreemap.org/styles/dark' },
    };
    var OFFLINE_ATTRIBUTION = '© OpenStreetMap-bidragsgivare · Protomaps';
    var FONT = ['Noto Sans Regular'];
    var THUMB_MIME = /^image\/(jpeg|png|gif|webp|bmp|avif)$/;
    var COLORS = { image: '#0a84ff', video: '#bf5af2', other: '#8e8e93' };

    var vendorPromise = null;
    var protocolsReady = false;
    var archives = [];
    var manifest = null;

    function $(id) { return document.getElementById(id); }

    function make(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function theme() {
        return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('Kunde inte ladda ' + src)); };
            document.head.append(s);
        });
    }

    function loadVendor() {
        if (vendorPromise) return vendorPromise;
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = VENDOR_CSS;
        document.head.append(link);
        vendorPromise = VENDOR_JS.reduce(function (p, src) {
            return p.then(function () { return loadScript(src); });
        }, Promise.resolve());
        return vendorPromise;
    }

    function base64Buffer(b64) {
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
    }

    function setupProtocols() {
        if (protocolsReady) return;
        protocolsReady = true;
        var ml = root.maplibregl;
        var assets = root.MAP_ASSETS;
        ml.setWorkerUrl(URL.createObjectURL(new Blob([root.MAPLIBRE_WORKER_SOURCE], { type: 'text/javascript' })));
        ml.addProtocol('ftlocal', function (params) {
            var path = params.url.replace(/^ftlocal:\/\//, '');
            var m = /^glyphs\/(.+)\/(\d+-\d+)\.pbf$/.exec(path);
            if (m) {
                var font = assets.glyphs[decodeURIComponent(m[1]).split(',')[0]];
                var range = font && font[m[2]];
                return Promise.resolve({ data: range ? base64Buffer(range) : new ArrayBuffer(0) });
            }
            m = /^sprites\/([\w@]+)\.(json|png)$/.exec(path);
            var sprite = m && assets.sprites[m[1]];
            if (sprite) return Promise.resolve({ data: m[2] === 'json' ? sprite.json : base64Buffer(sprite.png) });
            return Promise.reject(new Error('Okänd kartresurs: ' + path));
        });
        ml.addProtocol('ftpm', function (params, abort) {
            var m = /^ftpm:\/\/(\d+)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
            var archive = m && archives[Number(m[1])];
            if (!archive) return Promise.reject(new Error('Okänd kartfil'));
            return archive.pm.getZxy(Number(m[2]), Number(m[3]), Number(m[4]), abort.signal).then(function (r) {
                return { data: r ? r.data : new ArrayBuffer(0) };
            });
        });
    }

    function addArchive(source, label) {
        var pm = new root.pmtiles.PMTiles(source);
        return pm.getHeader().then(function (header) {
            return { pm: pm, header: header, label: label };
        });
    }

    function sortArchives(list) {
        return list.sort(function (a, b) { return a.header.minZoom - b.header.minZoom; });
    }

    // Kartfilerna som följer med skrivbordsappen.
    function openBundled() {
        return fetch(MAP_DATA + 'kartdata.json').then(function (res) {
            if (!res.ok) throw new Error('Ingen kartdata');
            return res.json();
        }).then(function (json) {
            manifest = json;
            return Promise.all(Object.keys(json.files).map(function (name) {
                return addArchive(new root.pmtiles.FetchSource(MAP_DATA + name), json.files[name].label);
            }));
        }).then(function (list) {
            archives = sortArchives(list);
        });
    }

    function openFiles(files) {
        return Promise.all(Array.prototype.map.call(files, function (f) {
            return addArchive(new root.pmtiles.FileSource(f), f.name.replace(/\.pmtiles$/i, ''));
        })).then(function (list) {
            manifest = null;
            archives = sortArchives(list);
        });
    }

    // Lägsta zoomnivån först. Filer med högre min-zoom (Sverige) ritas ovanpå och täcker
    // den grövre kartan där de har data; utanför syns översikten.
    function offlineStyle() {
        var base = root.MAP_ASSETS.layers[theme()];
        var sources = {};
        var layers = [];
        archives.forEach(function (a, i) {
            var h = a.header;
            var src = 'pm' + i;
            sources[src] = {
                type: 'vector',
                tiles: ['ftpm://' + i + '/{z}/{x}/{y}'],
                minzoom: h.minZoom,
                maxzoom: h.maxZoom,
                bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat],
                attribution: OFFLINE_ATTRIBUTION,
            };
            base.forEach(function (layer) {
                if (layer.type === 'background') {
                    if (i === 0) layers.push(layer);
                    return;
                }
                var copy = Object.assign({}, layer, { id: src + '-' + layer.id, source: src });
                if (i > 0) copy.minzoom = Math.max(layer.minzoom || 0, h.minZoom);
                layers.push(copy);
            });
        });
        return {
            version: 8,
            glyphs: 'ftlocal://glyphs/{fontstack}/{range}.pbf',
            sprite: 'ftlocal://sprites/' + theme(),
            sources: sources,
            layers: layers,
        };
    }

    function arrowImage() {
        var size = 24;
        var canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(6, 5);
        ctx.lineTo(19, 12);
        ctx.lineTo(6, 19);
        ctx.lineTo(9, 12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        return ctx.getImageData(0, 0, size, size);
    }

    function kind(mime) {
        if (/^image\//.test(mime)) return 'image';
        if (/^video\//.test(mime)) return 'video';
        return 'other';
    }

    function create(opts) {
        var el = {
            wrap: $('map-view'),
            map: $('map'),
            status: $('map-status'),
            route: $('route-toggle'),
            online: $('online-toggle'),
            fit: $('map-fit'),
            routeNote: $('route-note'),
            note: $('map-note'),
            fallback: $('map-fallback'),
            pick: $('map-pick'),
            input: $('map-input'),
            consent: $('online-consent'),
            consentOk: $('online-ok'),
            consentCancel: $('online-cancel'),
        };
        var map = null;
        var ready = null;
        var online = false;
        var points = [];
        var routeInfo = null;
        var byId = {};
        var popup = null;
        var thumbUrl = null;
        var fittedOnce = false;
        var styleError = '';

        function setStatus(text, state) {
            el.status.textContent = text;
            el.status.className = 'map-status' + (state ? ' ' + state : '');
        }

        function offlineLabel() {
            var parts = archives.map(function (a) {
                return a.label + ' (zoom ' + a.header.minZoom + '–' + a.header.maxZoom + ')';
            });
            return 'Offline · ' + parts.join(', ') + (manifest && manifest.date ? ' · kartdata ' + manifest.date : '');
        }

        function updateStatus() {
            if (online) setStatus('Online · ' + ONLINE.name + ' hämtar kartrutor för området som visas. Inga filer skickas.', 'online');
            else if (archives.length) setStatus(offlineLabel(), 'offline');
            else setStatus('Ingen offlinekarta. Välj kartfiler eller slå på onlinekartan.', 'missing');
            el.fallback.classList.toggle('display-none', online || archives.length > 0);
        }

        function geojson() {
            var steps = {};
            if (routeInfo) routeInfo.steps.forEach(function (s) { steps[s.point.id] = s.index; });
            return {
                type: 'FeatureCollection',
                features: points.map(function (p) {
                    return {
                        type: 'Feature',
                        id: p.id,
                        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
                        properties: { id: p.id, kind: kind(p.mime), step: steps[p.id] || 0 },
                    };
                }),
            };
        }

        function routeGeojson() {
            var coords = el.route.checked && routeInfo ? routeInfo.steps.map(function (s) { return [s.point.lon, s.point.lat]; }) : [];
            return {
                type: 'FeatureCollection',
                features: coords.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }] : [],
            };
        }

        function addDataLayers() {
            if (!map.hasImage('route-arrow')) map.addImage('route-arrow', arrowImage(), { pixelRatio: 2 });
            map.addSource('route', { type: 'geojson', data: routeGeojson() });
            map.addSource('files', {
                type: 'geojson', data: geojson(), cluster: true, clusterRadius: 42, clusterMaxZoom: 16,
            });
            map.addLayer({
                id: 'route-line', type: 'line', source: 'route',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': '#ff9f0a', 'line-width': 3, 'line-opacity': 0.9 },
            });
            map.addLayer({
                id: 'route-arrows', type: 'symbol', source: 'route',
                layout: {
                    'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': 'route-arrow',
                    'icon-allow-overlap': true, 'icon-ignore-placement': true,
                },
            });
            map.addLayer({
                id: 'clusters', type: 'circle', source: 'files', filter: ['has', 'point_count'],
                paint: {
                    'circle-color': '#0a84ff',
                    'circle-opacity': 0.88,
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 2,
                    'circle-radius': ['step', ['get', 'point_count'], 15, 10, 19, 50, 24, 200, 30],
                },
            });
            map.addLayer({
                id: 'cluster-count', type: 'symbol', source: 'files', filter: ['has', 'point_count'],
                layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': FONT, 'text-size': 12, 'text-allow-overlap': true },
                paint: { 'text-color': '#ffffff' },
            });
            map.addLayer({
                id: 'points', type: 'circle', source: 'files', filter: ['!', ['has', 'point_count']],
                paint: {
                    'circle-color': ['match', ['get', 'kind'], 'image', COLORS.image, 'video', COLORS.video, COLORS.other],
                    'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 10, 7],
                    'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#ff9f0a', '#ffffff'],
                    'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 2],
                },
            });
            map.addLayer({
                id: 'point-step', type: 'symbol', source: 'files',
                filter: ['all', ['!', ['has', 'point_count']], ['>', ['get', 'step'], 0]],
                layout: {
                    'text-field': ['to-string', ['get', 'step']], 'text-font': FONT, 'text-size': 11,
                    'text-offset': [0, -1.5], 'text-allow-overlap': true, visibility: el.route.checked ? 'visible' : 'none',
                },
                paint: { 'text-color': '#ff9f0a', 'text-halo-color': '#000000', 'text-halo-width': 1.2 },
            });
        }

        function refreshData() {
            if (!map || !map.getSource('files')) return;
            map.getSource('files').setData(geojson());
            map.getSource('route').setData(routeGeojson());
            if (map.getLayer('point-step')) map.setLayoutProperty('point-step', 'visibility', el.route.checked ? 'visible' : 'none');
        }

        function currentStyle() {
            if (online) return ONLINE.styles[theme()];
            if (archives.length) return offlineStyle();
            return { version: 8, glyphs: 'ftlocal://glyphs/{fontstack}/{range}.pbf', sources: {}, layers: [] };
        }

        function applyStyle() {
            styleError = '';
            var style = currentStyle();
            map.setStyle(style, { diff: false });
            map.once('style.load', function () {
                addDataLayers();
                if (selectedId !== null) map.setFeatureState({ source: 'files', id: selectedId }, { selected: true });
            });
            updateStatus();
        }

        var selectedId = null;

        function select(id) {
            if (selectedId !== null && map.getSource('files')) map.setFeatureState({ source: 'files', id: selectedId }, { selected: false });
            selectedId = id;
            if (id !== null && map.getSource('files')) map.setFeatureState({ source: 'files', id: id }, { selected: true });
        }

        function closePopup() {
            if (popup) popup.remove();
        }

        function popupContent(p) {
            var box = make('div', 'map-popup');
            var file = THUMB_MIME.test(p.mime) && opts.getFile ? opts.getFile(p.id) : null;
            if (file) {
                thumbUrl = URL.createObjectURL(file);
                var img = make('img', 'map-thumb');
                img.alt = '';
                img.src = thumbUrl;
                img.onerror = function () { img.remove(); };
                box.append(img);
            }
            box.append(make('div', 'map-popup-name', p.name));
            var dir = p.path.slice(0, Math.max(0, p.path.length - p.name.length)).replace(/\/$/, '');
            if (dir) box.append(make('div', 'map-popup-dir', dir));
            var dl = make('dl');
            function row(label, value) {
                if (!value) return;
                dl.append(make('dt', '', label));
                dl.append(make('dd', '', value));
            }
            row(p.taken ? p.taken.kind : 'Tid', p.taken ? p.taken.text : 'Ingen tid i filen');
            row('Enhet', p.device);
            row('Position', p.lat + ', ' + p.lon);
            var step = routeInfo && routeInfo.steps.filter(function (s) { return s.point.id === p.id; })[0];
            if (step) row('Rutt', 'Punkt ' + step.index + ' av ' + routeInfo.steps.length + (step.assumed ? ' (tidszon antagen)' : ''));
            box.append(dl);
            var actions = make('div', 'map-popup-actions');
            var more = make('button', 'link-btn', 'Visa metadata');
            more.type = 'button';
            more.addEventListener('click', function () { opts.onSelect(p.id); });
            var copy = make('button', 'link-btn', 'Kopiera koordinater');
            copy.type = 'button';
            copy.addEventListener('click', function () { opts.copy(p.lat + ', ' + p.lon); });
            actions.append(more, copy);
            box.append(actions);
            return box;
        }

        function showPopup(lngLat, content, id) {
            var url = thumbUrl;
            thumbUrl = null;
            popup = new root.maplibregl.Popup({ maxWidth: '300px', offset: 12, focusAfterOpen: false })
                .setLngLat(lngLat).setDOMContent(content).addTo(map);
            popup.on('close', function () {
                if (url) URL.revokeObjectURL(url);
                if (id !== undefined) select(null);
                popup = null;
            });
        }

        function openPoint(p) {
            closePopup();
            showPopup([p.lon, p.lat], popupContent(p), p.id);
            select(p.id);
        }

        function clusterList(leaves, lngLat) {
            var seen = {};
            var items = leaves.map(function (f) { return byId[f.properties.id]; }).filter(function (p) {
                if (!p || seen[p.id]) return false;
                seen[p.id] = true;
                return true;
            }).sort(function (a, b) {
                var ta = a.taken ? a.taken.sort : '~';
                var tb = b.taken ? b.taken.sort : '~';
                return ta < tb ? -1 : ta > tb ? 1 : a.path.localeCompare(b.path);
            });
            if (!items.length) return;
            var same = items.every(function (p) { return p.lat === items[0].lat && p.lon === items[0].lon; });
            var box = make('div', 'map-popup');
            box.append(make('div', 'map-popup-name', items.length + (same ? ' filer på samma plats' : ' filer')));
            var list = make('div', 'map-popup-list');
            items.forEach(function (p) {
                var b = make('button', 'map-popup-item');
                b.type = 'button';
                b.append(make('span', '', p.name));
                b.append(make('span', 'muted', p.taken ? p.taken.text : ''));
                b.addEventListener('click', function () { openPoint(p); });
                list.append(b);
            });
            box.append(list);
            closePopup();
            showPopup(lngLat, box);
        }

        function bindEvents() {
            map.on('click', 'clusters', function (e) {
                var f = e.features[0];
                var src = map.getSource('files');
                var id = f.properties.cluster_id;
                Promise.all([src.getClusterExpansionZoom(id), src.getClusterLeaves(id, 500, 0)]).then(function (r) {
                    var leaves = r[1];
                    var first = leaves[0].geometry.coordinates;
                    // Filer med exakt samma position delas aldrig upp, hur långt man än zoomar.
                    var same = leaves.every(function (l) {
                        return l.geometry.coordinates[0] === first[0] && l.geometry.coordinates[1] === first[1];
                    });
                    if (same || r[0] > 17) clusterList(leaves, f.geometry.coordinates);
                    else map.easeTo({ center: f.geometry.coordinates, zoom: r[0] + 0.3 });
                });
            });
            map.on('click', 'points', function (e) {
                var ids = {};
                e.features.forEach(function (f) { ids[f.properties.id] = true; });
                if (Object.keys(ids).length > 1) {
                    clusterList(e.features, e.features[0].geometry.coordinates);
                    return;
                }
                var p = byId[e.features[0].properties.id];
                if (p) openPoint(p);
            });
            ['clusters', 'points'].forEach(function (layer) {
                map.on('mouseenter', layer, function () { map.getCanvas().style.cursor = 'pointer'; });
                map.on('mouseleave', layer, function () { map.getCanvas().style.cursor = ''; });
            });
            map.on('styleimagemissing', function (e) {
                if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
            });
            map.on('error', function (e) {
                var msg = e && e.error && e.error.message;
                if (online && msg && !styleError) {
                    styleError = msg;
                    setStatus('Onlinekartan kunde inte hämtas (' + msg + '). Kontrollera nätverket eller slå av onlinekartan.', 'missing');
                }
            });
            map.getContainer().addEventListener('click', function (e) {
                var a = e.target.closest && e.target.closest('.maplibregl-ctrl-attrib a');
                if (!a) return;
                e.preventDefault();
                opts.openExternal(a.href, a.textContent);
            });
        }

        function fit() {
            if (!map || !points.length) return;
            if (points.length === 1) {
                map.jumpTo({ center: [points[0].lon, points[0].lat], zoom: 15 });
                return;
            }
            var b = new root.maplibregl.LngLatBounds();
            points.forEach(function (p) { b.extend([p.lon, p.lat]); });
            map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 0 });
        }

        function start() {
            if (ready) return ready;
            setStatus('Laddar kartan…');
            ready = loadVendor().then(function () {
                setupProtocols();
                return openBundled().catch(function () { archives = []; });
            }).then(function () {
                map = new root.maplibregl.Map({
                    container: el.map,
                    style: currentStyle(),
                    center: [15, 62],
                    zoom: 4,
                    maxZoom: 19,
                    attributionControl: false,
                    localIdeographFontFamily: 'sans-serif',
                });
                map.addControl(new root.maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
                map.addControl(new root.maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
                map.addControl(new root.maplibregl.AttributionControl({ compact: true }), 'bottom-right');
                map.once('style.load', addDataLayers);
                bindEvents();
                updateStatus();
                new MutationObserver(function () { if (map) applyStyle(); })
                    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
                return new Promise(function (resolve) { map.once('load', resolve); });
            }).catch(function (err) {
                setStatus('Kartan kunde inte starta: ' + (err && err.message ? err.message : err), 'missing');
                throw err;
            });
            return ready;
        }

        function setPoints(list, info, notes) {
            points = list;
            routeInfo = info;
            byId = {};
            list.forEach(function (p) { byId[p.id] = p; });
            el.routeNote.textContent = el.route.checked && info && info.steps.length > 1 ? root.MapCore.routeNote(info) : '';
            el.note.textContent = notes || '';
            if (popup && selectedId !== null && !byId[selectedId]) closePopup();
            refreshData();
        }

        el.route.addEventListener('change', function () {
            el.routeNote.textContent = el.route.checked && routeInfo && routeInfo.steps.length > 1 ? root.MapCore.routeNote(routeInfo) : '';
            refreshData();
        });
        el.fit.addEventListener('click', fit);
        el.online.addEventListener('change', function () {
            if (!el.online.checked) {
                online = false;
                if (map) applyStyle();
                return;
            }
            el.online.checked = false;
            el.consent.classList.remove('display-none');
        });
        el.consentOk.addEventListener('click', function () {
            el.consent.classList.add('display-none');
            online = true;
            el.online.checked = true;
            if (map) applyStyle();
        });
        el.consentCancel.addEventListener('click', function () { el.consent.classList.add('display-none'); });
        el.pick.addEventListener('click', function () { el.input.click(); });
        el.input.addEventListener('change', function () {
            var files = el.input.files;
            if (!files || !files.length) return;
            start().then(function () { return openFiles(files); }).then(function () {
                el.input.value = '';
                if (!online) applyStyle();
                updateStatus();
            }).catch(function (err) {
                setStatus('Kartfilerna kunde inte läsas: ' + (err && err.message ? err.message : err), 'missing');
            });
        });

        return {
            show: function () {
                return start().then(function () {
                    map.resize();
                    if (!fittedOnce && points.length) { fittedOnce = true; fit(); }
                });
            },
            setPoints: setPoints,
            focus: function (id) {
                return start().then(function () {
                    var p = byId[id];
                    if (!p) return;
                    map.resize();
                    fittedOnce = true;
                    // Punkten under mitten, så att popupen får plats ovanför.
                    map.jumpTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 16), offset: [0, 120] });
                    openPoint(p);
                });
            },
            onlineHost: ONLINE.host,
        };
    }

    root.ExifMap = { create: create };
})(window);
