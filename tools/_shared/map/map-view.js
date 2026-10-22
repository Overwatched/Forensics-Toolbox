// Gemensam kartvy. MapLibre och kartresurserna laddas först när kartan öppnas.
//
// Offline (standard): kartfilerna i appens maps/-mapp via ftmaps://, eller .pmtiles-filer
// som användaren väljer (HTML-versionen). Typsnitt och ikoner är inbäddade, så inget
// hämtas utanför datorn.
// Online (bara efter godkännande, gäller tills verktyget laddas om): OpenFreeMap. Tjänsten
// ser vilka kartrutor som hämtas, inte filerna eller deras metadata.
(function (root) {
    'use strict';

    // Sökvägar relativt den här filen, så att både EXIF-verktyget och Positioner kan använda den.
    var SCRIPT_BASE = document.currentScript ? new URL('./', document.currentScript.src) : null;
    function vendorUrl(rel) { return SCRIPT_BASE ? new URL(rel, SCRIPT_BASE).href : rel; }
    var VENDOR_CSS = vendorUrl('vendor/maps/maplibre-gl.css');
    var VENDOR_JS = [vendorUrl('vendor/maps/maplibre.js'), vendorUrl('vendor/maps/map-assets.js')];
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
        // Under file:// är varje adress en egen origin. En sida i tools/ får inte
        // hämta eller skjuta in skript från en annan mapp. Statiska script-taggar
        // i HTML-filen har redan laddat biblioteket när det behövs.
        if (root.maplibregl && root.MAP_ASSETS) {
            vendorPromise = Promise.resolve();
            return vendorPromise;
        }
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

    // MapLibre startar workern som modul (type:module) och lindar koden i
    // `import "…"`. Under file:// blir det antingen "cross-origin redirects"
    // eller "Cannot use import statement outside a module". Källkoden är ett
    // vanligt skript, så varje sådan worker byts mot den, utan type:module.
    function useClassicBlobWorkers() {
        if (root.__ftClassicWorker) return root.__ftClassicWorker;
        var NativeWorker = root.Worker;
        var sourceUrl = URL.createObjectURL(new Blob(
            [root.MAPLIBRE_WORKER_SOURCE],
            { type: 'text/javascript' }
        ));
        function ClassicBlobWorker(url, opts) {
            if (opts && opts.type === 'module') return new NativeWorker(sourceUrl);
            return new NativeWorker(url, opts);
        }
        ClassicBlobWorker.prototype = NativeWorker.prototype;
        root.Worker = ClassicBlobWorker;
        root.__ftClassicWorker = sourceUrl;
        return sourceUrl;
    }

    function setupProtocols() {
        if (protocolsReady) return;
        protocolsReady = true;
        var ml = root.maplibregl;
        var assets = root.MAP_ASSETS;
        ml.setWorkerUrl(useClassicBlobWorkers());
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

    // Bildrutor är oftast 256 eller 512 pixlar, och headern säger inte vilket. En ruta
    // nära mitten avkodas för att ta reda på det.
    function rasterTileSize(pm, h) {
        var z = Math.max(h.minZoom, Math.min(h.maxZoom, h.centerZoom || h.minZoom));
        var n = Math.pow(2, z);
        var lat = Math.max(-85, Math.min(85, h.centerLat)) * Math.PI / 180;
        var x = Math.min(n - 1, Math.max(0, Math.floor((h.centerLon + 180) / 360 * n)));
        var y = Math.min(n - 1, Math.max(0, Math.floor((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * n)));
        return pm.getZxy(z, x, y).then(function (r) {
            if (!r || !root.createImageBitmap) return 256;
            return root.createImageBitmap(new Blob([r.data])).then(function (bmp) {
                var size = bmp.width;
                if (bmp.close) bmp.close();
                return size === 512 ? 512 : 256;
            });
        }).catch(function () { return 256; });
    }

    function addArchive(source, label) {
        var pm = new root.pmtiles.PMTiles(source);
        return pm.getHeader().then(function (header) {
            var archive = {
                pm: pm, header: header, label: label, kind: root.MapCore.archiveKind(header.tileType),
                minZoom: header.minZoom, maxZoom: header.maxZoom,
                bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
            };
            if (archive.kind !== 'raster') return archive;
            return Promise.all([
                rasterTileSize(pm, header),
                pm.getMetadata().catch(function () { return null; }),
            ]).then(function (r) {
                archive.tileSize = r[0];
                var meta = r[1] || {};
                archive.attribution = meta.attribution ? String(meta.attribution).replace(/<[^>]*>/g, '') : label;
                return archive;
            });
        });
    }

    function sortArchives(list) {
        return list.sort(function (a, b) { return a.header.minZoom - b.header.minZoom; });
    }

    function baseName(name) { return name.replace(/\.pmtiles$/i, ''); }

    var PAGE_MAPS = '';
    try { PAGE_MAPS = new URL('../../maps/', document.baseURI).href; } catch (e) { PAGE_MAPS = ''; }

    function openFromUrl(base) {
        return fetch(base + 'kartdata.json').then(function (res) {
            if (!res.ok) throw new Error('Ingen kartdata');
            return res.json();
        }).then(function (json) {
            manifest = json;
            // Egna kartfiler i samma mapp, till exempel flygfoton. Bara skrivbordsappen kan lista mappen.
            var extra = base === MAP_DATA
                ? fetch('ftmaps://list/').then(function (res) { return res.ok ? res.json() : []; }).catch(function () { return []; })
                : Promise.resolve([]);
            return extra.then(function (names) {
                var all = Object.keys(json.files).map(function (name) { return { name: name, label: json.files[name].label }; });
                names.forEach(function (name) {
                    if (!json.files[name]) all.push({ name: name, label: baseName(name) });
                });
                return Promise.all(all.map(function (f) {
                    return addArchive(new root.pmtiles.FetchSource(base + f.name), f.label).catch(function () { return null; });
                }));
            });
        }).then(function (list) {
            list = list.filter(Boolean);
            if (!list.length) throw new Error('Inga läsbara kartfiler');
            archives = sortArchives(list);
        });
    }

    function mapDb() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open('ft-maps', 1);
            req.onupgradeneeded = function () { req.result.createObjectStore('dir'); };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function loadDirHandle() {
        return mapDb().then(function (db) {
            return new Promise(function (resolve) {
                var req = db.transaction('dir').objectStore('dir').get('maps');
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { resolve(null); };
            });
        }).catch(function () { return null; });
    }

    function saveDirHandle(handle) {
        return mapDb().then(function (db) {
            return new Promise(function (resolve) {
                var req = db.transaction('dir', 'readwrite').objectStore('dir').put(handle, 'maps');
                req.onsuccess = function () { resolve(); };
                req.onerror = function () { resolve(); };
            });
        }).catch(function () {});
    }

    function listPmtiles(folder) {
        var files = [];
        var iter = folder.values();
        function step() {
            return iter.next().then(function (item) {
                if (item.done) return files;
                var entry = item.value;
                if (entry.kind === 'file' && /\.pmtiles$/i.test(entry.name)) {
                    return entry.getFile().then(function (file) {
                        files.push(file);
                        return step();
                    });
                }
                return step();
            });
        }
        return step();
    }

    // kartdata.json namnger filerna. Saknas den, som när world.pmtiles och
    // sweden.pmtiles laddats ner var för sig, duger .pmtiles-filerna i mappen.
    function readMapFolder(folder) {
        return folder.getFileHandle('kartdata.json').then(function (handle) {
            return handle.getFile().then(function (file) { return file.text(); }).then(function (text) {
                var json = JSON.parse(text);
                return Promise.all(Object.keys(json.files).map(function (name) {
                    return folder.getFileHandle(name).then(function (fileHandle) {
                        return fileHandle.getFile();
                    }, function () {
                        throw new Error('saknar ' + name);
                    });
                })).then(function (files) {
                    // Egna .pmtiles-filer i mappen, till exempel flygfoton, kommer också med.
                    return listPmtiles(folder).then(function (all) {
                        all.forEach(function (f) { if (!json.files[f.name]) files.push(f); });
                        return { json: json, files: files };
                    });
                });
            });
        }, function () {
            return listPmtiles(folder).then(function (files) {
                if (!files.length) throw new Error('mappen saknar kartdata.json och .pmtiles-filer');
                return { json: null, files: files };
            });
        });
    }

    function filesInDir(dir) {
        return dir.getFileHandle('kartdata.json').then(function () {
            return readMapFolder(dir);
        }, function () {
            return dir.getDirectoryHandle('maps').then(function (folder) {
                return readMapFolder(folder);
            }, function () {
                return readMapFolder(dir);
            });
        });
    }

    // Skrivbordsappen via ftmaps://. HTML-mappen öppnad som file:// får inte
    // hämta ../../maps — Chromium behandlar varje filadress som en egen origin.
    // Då läses kartfilerna ur den mapp användaren valt, via File.slice.
    function openBundled() {
        // ftmaps:// och file:// går inte att hämta med fetch i en webbläsare.
        // Chromium loggar då "scheme doesn't support CORS" och, för file://,
        // "unique security origins". Bara skrivbordsappen har ftmaps://.
        var step = root.forensicsDesktop
            ? openFromUrl(MAP_DATA)
            : Promise.reject(new Error('ingen skrivbordskarta'));
        return step.catch(function () {
            if (location.protocol === 'file:' || !PAGE_MAPS) throw new Error('ingen sökväg');
            return openFromUrl(PAGE_MAPS);
        }).catch(function () {
            return loadDirHandle().then(function (handle) {
                if (!handle || !handle.queryPermission) throw new Error('ingen mapp');
                return handle.queryPermission({ mode: 'read' }).then(function (state) {
                    if (state !== 'granted') throw new Error('behörighet');
                    return filesInDir(handle);
                });
            }).then(function (got) {
                manifest = got.json;
                return openFiles(got.files).then(function () { manifest = got.json; });
            });
        });
    }

    function readFiles(files) {
        return Promise.all(Array.prototype.map.call(files, function (f) {
            return addArchive(new root.pmtiles.FileSource(f), baseName(f.name));
        }));
    }

    function openFiles(files) {
        return readFiles(files).then(function (list) {
            manifest = null;
            archives = sortArchives(list);
        });
    }

    // Lägger till filer utöver de som redan är öppna. En fil med samma namn ersätter den gamla.
    function addFiles(files) {
        return readFiles(files).then(function (list) {
            var names = list.map(function (a) { return a.label; });
            archives = sortArchives(archives.filter(function (a) { return names.indexOf(a.label) < 0; }).concat(list));
            return list;
        });
    }

    function offlineStyle(mode) {
        return root.MapCore.basemapStyle({
            archives: archives,
            layers: root.MAP_ASSETS.layers[theme()],
            mode: mode,
            glyphs: 'ftlocal://glyphs/{fontstack}/{range}.pbf',
            sprite: 'ftlocal://sprites/' + theme(),
            attribution: OFFLINE_ATTRIBUTION,
            tileUrl: function (i) { return 'ftpm://' + i + '/{z}/{x}/{y}'; },
        });
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

    // Nålen är inte redo att visas. Koden finns kvar, men varken kryssrutan eller nålarna syns.
    var PIN_ENABLED = false;

    // Huvudet rymmer fyra siffror med luft, och fem om texten blir lite mindre. pixelRatio 2.
    var PIN_PIXEL_RATIO = 2;
    var PIN_W = 164;
    var PIN_H = 168;
    var PIN_CX = 74;
    var PIN_CY = 70;
    var PIN_R = 54;
    var PIN_TIP = 152;
    var PIN_HEAD_CSS = (PIN_H - PIN_CY) / PIN_PIXEL_RATIO;
    var PIN_TOP_CSS = (PIN_H - (PIN_CY - PIN_R)) / PIN_PIXEL_RATIO;

    // Avståndsfält så att MapLibre kan färga nålen med källans färg. Spetsen sitter i nederkanten.
    function pinImage() {
        var w = PIN_W;
        var h = PIN_H;
        function inside(x, y) {
            var dx = x - PIN_CX;
            var dy = y - PIN_CY;
            if (dx * dx + dy * dy <= PIN_R * PIN_R) return true;
            if (y < PIN_CY || y > PIN_TIP) return false;
            var half = PIN_R * (1 - (y - PIN_CY) / (PIN_TIP - PIN_CY));
            return Math.abs(x - PIN_CX) <= half;
        }
        var data = new Uint8Array(w * h * 4);
        var range = 8;
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var on = inside(x + 0.5, y + 0.5);
                var min = range;
                for (var oy = -range; oy <= range; oy++) {
                    for (var ox = -range; ox <= range; ox++) {
                        var nx = x + ox;
                        var ny = y + oy;
                        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                        if (inside(nx + 0.5, ny + 0.5) !== on) {
                            var d = Math.sqrt(ox * ox + oy * oy);
                            if (d < min) min = d;
                        }
                    }
                }
                // MapLibre ritar konturen där alpha är 192. Högre värde är inuti formen.
                var alpha = Math.max(0, Math.min(255, Math.round(192 + (on ? min : -min) * 16)));
                var i = (y * w + x) * 4;
                data[i] = data[i + 1] = data[i + 2] = 255;
                data[i + 3] = alpha;
            }
        }
        return { width: w, height: h, data: data };
    }

    function kind(mime) {
        if (/^image\//.test(mime)) return 'image';
        if (/^video\//.test(mime)) return 'video';
        return 'other';
    }

    function labeledToggle(text) {
        var label = make('label', 'toggle');
        var input = make('input');
        input.type = 'checkbox';
        label.append(input, make('span', '', text));
        return { label: label, input: input };
    }

    // Panelen byggs här så att varje verktyg bara behöver en tom behållare.
    function buildShell(host, opts) {
        host.classList.add('map-wrap');
        host.textContent = '';
        var mapEl = make('div', 'map');
        var status = make('p', 'map-status');
        var hide = make('button', 'map-hide', 'Dölj');
        hide.type = 'button';
        hide.title = 'Dölj menyn, till exempel inför en bild';
        var show = make('button', 'map-show secondary-btn display-none', 'Meny');
        show.type = 'button';
        var head = make('div', 'map-head');
        head.append(status, hide);
        var route = labeledToggle('Rutt i tidsordning');
        if (opts.routeOn) route.input.checked = true;
        var perDevice = labeledToggle('Per enhet');
        var online = labeledToggle('Onlinekarta');
        var fit = make('button', 'link-btn', 'Visa alla');
        fit.type = 'button';
        var listBtn = make('button', 'map-list-btn', 'Lista');
        listBtn.type = 'button';
        listBtn.title = 'Visa alla punkter i en lista';
        var numbersRow = make('label', 'map-field');
        numbersRow.append(make('span', '', 'Nummer på'));
        var numbers = make('select');
        [['all', 'Alla punkter'], ['route', 'Bara rutten'], ['none', 'Inga']].forEach(function (o) {
            var opt = make('option', '', o[1]);
            opt.value = o[0];
            numbers.append(opt);
        });
        numbersRow.append(numbers);
        var measureBtn = make('button', 'link-btn', 'Mät');
        measureBtn.type = 'button';
        var saveBtn = make('button', 'link-btn', 'Spara bild');
        saveBtn.type = 'button';
        var routeSection = make('div', 'map-section');
        routeSection.append(make('h3', '', 'Rutt'));
        var routeStack = make('div', 'map-stack');
        routeStack.append(route.label, perDevice.label, numbersRow);
        var routeActions = make('div', 'map-row');
        routeActions.append(fit, measureBtn, saveBtn);
        routeSection.append(routeStack, routeActions);
        var measureNote = make('p', 'map-note');
        routeSection.append(measureNote);
        var bubbles = make('div', 'map-section map-bubbles');
        bubbles.append(make('h3', '', 'Bubblor'));
        bubbles.append(make('p', 'map-note', 'Standard gäller punkter utan egen inställning. Markera punkter med skift+klick, eller i listan, och tryck Anpassa.'));
        var bubbleStandard = make('button', 'secondary-btn', 'Anpassa standard…');
        bubbleStandard.type = 'button';
        var bubbleSmaller = make('button', 'link-btn', 'Mindre');
        var bubbleLarger = make('button', 'link-btn', 'Större');
        bubbleSmaller.type = 'button';
        bubbleLarger.type = 'button';
        bubbleSmaller.title = 'Mindre text i bubblorna';
        bubbleLarger.title = 'Större text i bubblorna';
        var bubbleSize = make('div', 'map-row');
        bubbleSize.append(bubbleSmaller, bubbleLarger);
        var bubbleCustom = make('p', 'map-note');
        var bubbleReset = make('button', 'link-btn display-none', 'Återställ alla bubblor');
        bubbleReset.type = 'button';
        bubbleReset.title = 'Ta bort egna inställningar så att alla följer standarden';
        bubbles.append(bubbleStandard, bubbleSize, bubbleCustom, bubbleReset);
        var routeNote = make('p', 'map-note');
        var note = make('p', 'map-note');
        var fallback = make('div', 'map-fallback display-none');
        fallback.append(make('p', '', 'Offlinekartan ligger i mappen maps bredvid Toolbox.html. Välj den mappen. Ingen server behövs.'));
        var pickDir = make('button', 'secondary-btn', 'Välj mappen maps…');
        pickDir.type = 'button';
        var pick = make('button', 'secondary-btn', 'Välj kartfiler…');
        pick.type = 'button';
        var dirInput = make('input');
        dirInput.type = 'file';
        dirInput.multiple = true;
        dirInput.setAttribute('webkitdirectory', '');
        dirInput.setAttribute('directory', '');
        dirInput.hidden = true;
        var input = make('input');
        input.type = 'file';
        input.multiple = true;
        input.hidden = true;
        fallback.append(pickDir, pick, dirInput, input);
        var steps = make('div', 'map-steps');
        var timeBar = make('div', 'map-time display-none');
        var timeInput = make('input');
        timeInput.type = 'range';
        timeInput.min = '0';
        timeInput.max = '0';
        timeInput.value = '0';
        var play = make('button', 'link-btn', 'Spela');
        play.type = 'button';
        var timeLabel = make('span', 'map-time-label', '');
        var speed = make('select', 'map-time-speed');
        speed.title = 'Uppspelningens hastighet';
        speed.setAttribute('aria-label', 'Hastighet');
        [['auto', 'Hela på 10 s'], ['60', '1 min/s'], ['600', '10 min/s'], ['3600', '1 h/s']].forEach(function (o) {
            var opt = make('option', '', o[1]);
            opt.value = o[0];
            speed.append(opt);
        });
        timeBar.append(play, speed, timeInput, timeLabel);
        var baseSection = make('div', 'map-section');
        baseSection.append(make('h3', '', 'Bakgrund'));
        var basemapRow = make('div', 'map-segment');
        basemapRow.setAttribute('role', 'radiogroup');
        basemapRow.setAttribute('aria-label', 'Bakgrund');
        var basemapButtons = {};
        root.MapCore.BASEMAPS.forEach(function (b) {
            var btn = make('button', 'map-segment-btn', b.label);
            btn.type = 'button';
            btn.dataset.mode = b.key;
            btn.setAttribute('role', 'radio');
            basemapRow.append(btn);
            basemapButtons[b.key] = btn;
        });
        var basemapNote = make('p', 'map-note');
        var addImagery = make('button', 'link-btn', 'Lägg till bildkarta…');
        addImagery.type = 'button';
        addImagery.title = 'Flygfoton eller satellitbilder i PMTiles-format. Läses lokalt, inget skickas.';
        var imageryInput = make('input');
        imageryInput.type = 'file';
        imageryInput.accept = '.pmtiles';
        imageryInput.multiple = true;
        imageryInput.hidden = true;
        var imageryRow = make('div', 'map-row');
        imageryRow.append(addImagery, imageryInput);
        baseSection.append(basemapRow, basemapNote, imageryRow, online.label);
        var panel = make('div', 'map-panel');
        panel.append(head, baseSection, routeSection, bubbles, routeNote, note, fallback);
        hide.addEventListener('click', function () {
            panel.classList.add('display-none');
            show.classList.remove('display-none');
        });
        show.addEventListener('click', function () {
            panel.classList.remove('display-none');
            show.classList.add('display-none');
        });
        var list = make('aside', 'map-list display-none');
        list.setAttribute('aria-label', 'Positioner');

        var consent = make('div', 'consent display-none');
        consent.setAttribute('role', 'dialog');
        consent.append(make('h3', '', 'Slå på onlinekarta?'));
        consent.append(make('p', '', 'Kartrutor hämtas från OpenFreeMap (tiles.openfreemap.org). Tjänsten ser din IP-adress och vilka kartrutor som visas, alltså ungefär vilket område du tittar på.'));
        consent.append(make('p', '', 'Inga filer, bilder eller metadata skickas. Punkterna ritas lokalt.'));
        consent.append(make('p', 'muted', 'Gäller tills verktyget laddas om.'));
        var actions = make('div', 'consent-actions');
        var consentCancel = make('button', 'secondary-btn', 'Avbryt');
        var consentOk = make('button', 'primary-btn', 'Slå på');
        consentCancel.type = 'button';
        consentOk.type = 'button';
        actions.append(consentCancel, consentOk);
        consent.append(actions);
        var editor = make('div', 'map-editor display-none');
        editor.setAttribute('role', 'dialog');
        var pickBar = make('div', 'map-pickbar display-none');
        pickBar.setAttribute('role', 'toolbar');
        pickBar.setAttribute('aria-label', 'Markerade punkter');
        host.append(mapEl, list, panel, show, timeBar, consent, editor, pickBar);
        return {
            editor: editor, pickBar: pickBar, bubbleCustom: bubbleCustom, bubbleReset: bubbleReset,
            wrap: host, map: mapEl, status: status, route: route.input, perDevice: perDevice.input,
            online: online.input, fit: fit, measureBtn: measureBtn, saveBtn: saveBtn, measureNote: measureNote,
            listBtn: listBtn, list: list, numbers: numbers,
            bubbleStandard: bubbleStandard,
            bubbleSmaller: bubbleSmaller, bubbleLarger: bubbleLarger,
            routeNote: routeNote, note: note, steps: steps, timeBar: timeBar, timeInput: timeInput, play: play, timeLabel: timeLabel, speed: speed,
            fallback: fallback, pickDir: pickDir, pick: pick, dirInput: dirInput, input: input,
            consent: consent, consentOk: consentOk, consentCancel: consentCancel,
            basemapButtons: basemapButtons, basemapNote: basemapNote, addImagery: addImagery, imageryInput: imageryInput,
        };
    }

    function create(opts) {
        if (!opts || !opts.host) throw new Error('Kartan behöver en behållare');
        var el = buildShell(opts.host, opts);
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
        var basemap = 'map';

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
            else setStatus('Ingen offlinekarta. Välj mappen maps, eller slå på onlinekartan.', 'missing');
            el.fallback.classList.toggle('display-none', online || archives.length > 0);
            updateBasemap();
        }

        function updateBasemap() {
            var modes = root.MapCore.basemapModes(archives);
            var active = modes.indexOf(basemap) >= 0 ? basemap : 'map';
            Object.keys(el.basemapButtons).forEach(function (key) {
                var btn = el.basemapButtons[key];
                var on = key === active;
                btn.disabled = modes.indexOf(key) < 0;
                btn.classList.toggle('active', on);
                btn.setAttribute('aria-checked', on ? 'true' : 'false');
                btn.title = btn.disabled ? 'Kräver en bildkarta (flygfoton eller satellitbilder)' : '';
            });
            var images = archives.filter(function (a) { return a.kind === 'raster'; });
            el.basemapNote.textContent = images.length
                ? 'Bilder: ' + images.map(function (a) {
                    return a.label + ' (zoom ' + a.minZoom + '–' + a.maxZoom + ')';
                }).join(', ') + '. Utanför bilderna syns kartan.'
                : 'Satellit kräver en bildkarta i PMTiles-format, till exempel flygfoton. Lägg filen i mappen maps eller välj den här.';
        }

        var notes = {};
        var hidden = {};
        var excluded = {};
        var bubbleCfg = {};
        var picked = {};

        function drawnPoints() {
            return points.filter(function (p) { return !hidden[p.id]; });
        }

        function routePoints() {
            return drawnPoints().filter(function (p) { return !excluded[p.id]; });
        }

        // Verktyget kan dela upp rutten själv (Positioner gör det per källa).
        var numberById = {};
        var inRouteById = {};
        var customRoutes = null;
        var namedRoutes = [];
        var appliedRanges = null;

        function useNamedRoutes(list) {
            namedRoutes = (list || []).filter(function (r) {
                return r && r.name && r.from >= 1 && r.to >= r.from;
            }).map(function (r) {
                return { name: String(r.name), from: Number(r.from), to: Number(r.to), visible: r.visible !== false };
            });
            var shown = namedRoutes.filter(function (r) { return r.visible !== false; });
            appliedRanges = namedRoutes.length
                ? shown.map(function (r) { return [r.from, r.to]; })
                : null;
        }

        function computeRoute() {
            var numbering = root.MapCore.numberPoints(points, []);
            numberById = numbering.numbers;
            inRouteById = {};
            if (el.route.checked && appliedRanges) {
                var visibleRoutes = namedRoutes.filter(function (r) { return r.visible !== false; });
                var groups = root.MapCore.pointsInRanges(routePoints(), function (p) { return numberById[p.id]; }, appliedRanges);
                groups.forEach(function (group) {
                    group.forEach(function (p) { inRouteById[p.id] = true; });
                });
                customRoutes = groups.map(function (group, i) {
                    var route = root.MapCore.route(group);
                    route.colorIndex = namedRoutes.indexOf(visibleRoutes[i]);
                    return route;
                });
                var steps = [];
                customRoutes.forEach(function (r) { r.steps.forEach(function (s) { steps.push(s); }); });
                routeInfo = {
                    steps: steps, trips: [], totalMeters: 0, implausible: 0,
                    assumed: 0, untimed: 0, assumedZone: '', stays: [],
                };
                customRoutes.forEach(function (r) {
                    routeInfo.totalMeters += r.totalMeters || 0;
                    routeInfo.implausible += r.implausible || 0;
                    routeInfo.assumed += r.assumed || 0;
                    routeInfo.untimed += r.untimed || 0;
                });
            } else {
                customRoutes = null;
                routeInfo = (opts.route || root.MapCore.route)(routePoints());
                if (el.route.checked) routeInfo.steps.forEach(function (s) { inRouteById[s.point.id] = true; });
            }
        }

        function badgeShown(p) {
            var mode = el.numbers.value;
            if (mode === 'none') return false;
            if (mode === 'route') return !!inRouteById[p.id];
            return !!numberById[p.id];
        }

        function badgeFilter() {
            var f = ['all', ['!', ['has', 'point_count']], ['>', ['get', 'step'], 0], ['!=', ['get', 'pin'], 1]];
            if (el.numbers.value === 'route') f.push(['==', ['get', 'inroute'], 1]);
            return f;
        }

        function pinBadgeFilter() {
            var f = ['all', ['!', ['has', 'point_count']], ['>', ['get', 'step'], 0], ['==', ['get', 'pin'], 1]];
            if (el.numbers.value === 'route') f.push(['==', ['get', 'inroute'], 1]);
            return f;
        }

        function badgeVisibility() {
            return el.numbers.value === 'none' ? 'none' : 'visible';
        }

        function freshStandard() {
            var cfg = root.MapCore.defaultBubble({});
            cfg.leader = false;
            cfg.ring = false;
            return cfg;
        }

        var standardCfg = freshStandard();

        function bubbleOf(p) {
            var custom = bubbleCfg[p.id];
            if (!custom) {
                if (PIN_ENABLED || !standardCfg.pin) return standardCfg;
                var plain = cloneBubble(standardCfg);
                plain.pin = false;
                return plain;
            }
            var cfg = cloneBubble(custom);
            if (!Object.prototype.hasOwnProperty.call(custom, 'leader')) cfg.leader = !!standardCfg.leader;
            if (!Object.prototype.hasOwnProperty.call(custom, 'ring')) cfg.ring = !!standardCfg.ring;
            if (!Object.prototype.hasOwnProperty.call(custom, 'pin')) cfg.pin = !!standardCfg.pin;
            if (!PIN_ENABLED && cfg.pin) {
                cfg = cloneBubble(cfg);
                cfg.pin = false;
            }
            return cfg;
        }

        function bubbleContent(p) {
            var parts = root.MapCore.bubbleParts(p, bubbleOf(p), notes[p.id] || p.note || '');
            var wantsThumb = parts.some(function (x) { return x.thumb; });
            var file = wantsThumb && opts.getFile && THUMB_MIME.test(p.mime || '') ? opts.getFile(p.id) : null;
            return parts.filter(function (x) { return !x.thumb || file; }).map(function (x) {
                return x.thumb ? { thumb: file } : x;
            });
        }

        function geojson() {
            return {
                type: 'FeatureCollection',
                features: drawnPoints().map(function (p) {
                    return {
                        type: 'Feature',
                        id: p.id,
                        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
                        properties: {
                            id: p.id, kind: kind(p.mime), step: numberById[p.id] || 0,
                            inroute: inRouteById[p.id] ? 1 : 0, color: p.color || '',
                            pin: bubbleOf(p).pin ? 1 : 0,
                        },
                    };
                }),
            };
        }

        var TRIP_COLORS = root.MapCore.ROUTE_COLORS;

        function shownRoutes() {
            if (!el.route.checked) return [];
            if (customRoutes) return customRoutes.filter(function (r) { return r.steps.length > 1; });
            if (el.perDevice.checked && root.MapCore.routesBy) {
                return root.MapCore.routesBy(routePoints(), 'device')
                    .map(function (g) { return g.route; });
            }
            return routeInfo ? [routeInfo] : [];
        }

        // Tidsreglaget: null betyder hela rutten. Annars ritas rutten fram till den tiden.
        var timeCursor = null;

        function routeGeojson() {
            var features = [];
            shownRoutes().forEach(function (r, group) {
                var colorAt = r.colorIndex != null ? r.colorIndex : group;
                if (timeCursor !== null && root.MapCore.routeUntil) r = root.MapCore.routeUntil(r, timeCursor);
                var drawn = root.MapCore.routeLines(r, TRIP_COLORS[colorAt % TRIP_COLORS.length]);
                drawn.lines.forEach(function (line) {
                    var coords = line.coordinates;
                    if (coords.length > 5000 && root.MapCore.simplify) coords = root.MapCore.simplify(coords, 0.0002);
                    features.push({
                        type: 'Feature',
                        geometry: { type: 'LineString', coordinates: coords },
                        properties: { color: line.color, implausible: 0 },
                    });
                });
                drawn.bad.forEach(function (coords) {
                    features.push({
                        type: 'Feature',
                        geometry: { type: 'LineString', coordinates: coords },
                        properties: { color: '#ff453a', implausible: 1 },
                    });
                });
            });
            return { type: 'FeatureCollection', features: features };
        }

        function accuracyGeojson() {
            var features = [];
            if (root.MapCore.circlePolygon) {
                drawnPoints().forEach(function (p) {
                    if (!bubbleOf(p).ring || !(p.accuracy > 0)) return;
                    features.push({
                        type: 'Feature',
                        geometry: { type: 'Polygon', coordinates: [root.MapCore.circlePolygon(p.lon, p.lat, p.accuracy)] },
                        properties: {},
                    });
                });
            }
            return { type: 'FeatureCollection', features: features };
        }

        var measureClicks = [];
        var measuring = false;

        function addMeasure(lngLat, event) {
            if (event && event.originalEvent) event.originalEvent._ftMeasured = true;
            if (measureClicks.length >= 2) measureClicks = [];
            measureClicks.push(lngLat);
            refreshMeasure();
        }

        function measureGeojson() {
            var features = measureClicks.map(function (c) {
                return { type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: {} };
            });
            if (measureClicks.length >= 2) {
                features.push({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: measureClicks.slice(0, 2).map(function (c) { return [c.lng, c.lat]; }) },
                    properties: {},
                });
            }
            return { type: 'FeatureCollection', features: features };
        }

        function refreshMeasure() {
            if (map && map.getSource('measure')) map.getSource('measure').setData(measureGeojson());
            if (measureClicks.length < 2) {
                el.measureNote.textContent = measureClicks.length === 1
                    ? 'Klicka en punkt till.'
                    : (measuring ? 'Klicka startpunkt.' : '');
                return;
            }
            var a = measureClicks[0];
            var b = measureClicks[1];
            el.measureNote.textContent = root.MapCore.formatDistance(root.MapCore.haversine(
                { lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng }));
        }

        function addDataLayers() {
            if (!map.hasImage('route-arrow')) map.addImage('route-arrow', arrowImage(), { pixelRatio: 2 });
            if (map.hasImage('ft-pin')) map.removeImage('ft-pin');
            map.addImage('ft-pin', pinImage(), { sdf: true, pixelRatio: PIN_PIXEL_RATIO });
            map.addSource('route', { type: 'geojson', data: routeGeojson() });
            map.addSource('accuracy', { type: 'geojson', data: accuracyGeojson() });
            map.addSource('measure', { type: 'geojson', data: measureGeojson() });
            map.addSource('files', {
                type: 'geojson', data: geojson(), cluster: true, clusterRadius: 42, clusterMaxZoom: 16,
            });
            map.addLayer({
                id: 'accuracy-fill', type: 'fill', source: 'accuracy',
                paint: { 'fill-color': '#0a84ff', 'fill-opacity': 0.15 },
            });
            map.addLayer({
                id: 'accuracy-line', type: 'line', source: 'accuracy',
                paint: { 'line-color': '#0a84ff', 'line-width': 1.5, 'line-opacity': 0.85 },
            });
            map.addLayer({
                id: 'measure-line', type: 'line', source: 'measure',
                filter: ['==', ['geometry-type'], 'LineString'],
                layout: { 'line-cap': 'round' },
                paint: { 'line-color': '#1c1c1e', 'line-width': 2, 'line-dasharray': [1.5, 1.5] },
            });
            map.addLayer({
                id: 'measure-points', type: 'circle', source: 'measure',
                filter: ['==', ['geometry-type'], 'Point'],
                paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': '#1c1c1e', 'circle-stroke-width': 2 },
            });
            map.addLayer({
                id: 'route-line', type: 'line', source: 'route',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.9 },
                filter: ['==', ['get', 'implausible'], 0],
            });
            map.addLayer({
                id: 'route-bad', type: 'line', source: 'route',
                filter: ['==', ['get', 'implausible'], 1],
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': '#ff453a', 'line-width': 3, 'line-dasharray': [2, 2] },
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
                layout: {
                    'text-field': ['concat', ['get', 'point_count_abbreviated'], ' st'],
                    'text-font': FONT, 'text-size': 12, 'text-allow-overlap': true,
                },
                paint: { 'text-color': '#ffffff' },
            });
            function marked() {
                return ['any',
                    ['boolean', ['feature-state', 'selected'], false],
                    ['boolean', ['feature-state', 'picked'], false]];
            }
            function pointColor() {
                return ['case', ['!=', ['get', 'color'], ''], ['get', 'color'],
                    ['match', ['get', 'kind'], 'image', COLORS.image, 'video', COLORS.video, COLORS.other]];
            }
            map.addLayer({
                id: 'points', type: 'circle', source: 'files',
                filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'pin'], 1]],
                paint: {
                    'circle-color': pointColor(),
                    'circle-radius': ['case', marked(), 10, 7],
                    'circle-stroke-color': ['case', marked(), '#ff9f0a', '#ffffff'],
                    'circle-stroke-width': ['case', marked(), 3, 2],
                },
            });
            map.addLayer({
                id: 'pins', type: 'symbol', source: 'files',
                filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'pin'], 1]],
                layout: {
                    'icon-image': 'ft-pin', 'icon-anchor': 'bottom', 'icon-allow-overlap': true,
                    'icon-ignore-placement': true, 'icon-size': 1,
                },
                paint: {
                    'icon-color': pointColor(),
                    'icon-halo-color': '#ff9f0a',
                    'icon-halo-width': ['case', marked(), 2, 0],
                },
            });
            // Mörk bricka för punkter i rutten, ljus för övriga.
            var routed = ['==', ['get', 'inroute'], 1];
            map.addLayer({
                id: 'point-badge', type: 'circle', source: 'files',
                filter: badgeFilter(),
                layout: { visibility: badgeVisibility() },
                paint: {
                    'circle-radius': 13,
                    'circle-color': ['case', routed, '#1c1c1e', '#ffffff'],
                    'circle-stroke-color': ['case', routed, '#ffffff', ['case', ['!=', ['get', 'color'], ''], ['get', 'color'], '#1c1c1e']],
                    'circle-stroke-width': ['case', routed, 2, 2.5],
                },
            });
            map.addLayer({
                id: 'point-step', type: 'symbol', source: 'files',
                filter: badgeFilter(),
                layout: {
                    'text-field': ['to-string', ['get', 'step']], 'text-font': FONT, 'text-size': 13,
                    'text-allow-overlap': true, visibility: badgeVisibility(),
                },
                paint: {
                    'text-color': ['case', routed, '#ffffff', '#1c1c1e'],
                    'text-halo-color': ['case', routed, '#1c1c1e', '#ffffff'],
                    'text-halo-width': 1.2,
                },
            });
            map.addSource('time-marker', { type: 'geojson', data: timeMarkerGeojson() });
            map.addLayer({
                id: 'pin-step', type: 'symbol', source: 'files',
                filter: pinBadgeFilter(),
                layout: {
                    'text-field': ['to-string', ['get', 'step']], 'text-font': FONT,
                    'text-size': ['case',
                        ['>=', ['length', ['to-string', ['get', 'step']]], 5], 10,
                        ['>=', ['length', ['to-string', ['get', 'step']]], 4], 13,
                        15],
                    'text-offset': ['case',
                        ['>=', ['length', ['to-string', ['get', 'step']]], 5], ['literal', [0, -PIN_HEAD_CSS / 10]],
                        ['>=', ['length', ['to-string', ['get', 'step']]], 4], ['literal', [0, -PIN_HEAD_CSS / 13]],
                        ['literal', [0, -PIN_HEAD_CSS / 15]]],
                    'text-allow-overlap': true, visibility: badgeVisibility(),
                },
                paint: {
                    'text-color': '#ffffff',
                    'text-halo-color': '#1c1c1e',
                    'text-halo-width': 1.2,
                },
            });
            // Positionen vid tid T, en per rutt. Egen källa, så att den aldrig klustras med punkterna.
            map.addLayer({
                id: 'time-marker', type: 'circle', source: 'time-marker',
                paint: {
                    'circle-radius': 9,
                    'circle-color': ['get', 'color'],
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 3,
                    'circle-opacity': ['case', ['==', ['get', 'interpolated'], 1], 0.55, 1],
                },
            });
        }

        var bubbleMarkers = [];
        var bubbleOffset = {};
        var bubbleScale = 1;
        var leaderSvg = null;

        function svgEl(name) {
            return document.createElementNS('http://www.w3.org/2000/svg', name);
        }

        function edgeToward(box, px, py) {
            var cx = (box.left + box.right) / 2;
            var cy = (box.top + box.bottom) / 2;
            var dx = px - cx;
            var dy = py - cy;
            if (!dx && !dy) return { x: cx, y: box.bottom };
            var scale = Math.min((box.right - box.left) / 2 / Math.abs(dx), (box.bottom - box.top) / 2 / Math.abs(dy));
            return { x: cx + dx * scale, y: cy + dy * scale };
        }

        // Punktens radie i pixlar, med vit kant. Med rutt är det den mörka sifferbrickan.
        function pointRadius(p) {
            if (bubbleOf(p).pin) return PIN_HEAD_CSS;
            if (badgeShown(p)) return 15;
            return p.id === selectedId ? 13 : 9;
        }

        function pointColor(p) {
            return p.color || COLORS[kind(p.mime)] || COLORS.other;
        }

        // Linjen börjar en bit utanför punkten, så att siffran syns, och slutar vid bubblans kant.
        // Den är neutral så att den inte förväxlas med rutten, som har källans färg.
        function leaderSegment(item, origin) {
            var pt = map.project([item.point.lon, item.point.lat]);
            var rect = item.card.getBoundingClientRect();
            var end = edgeToward({
                left: rect.left - origin.left, top: rect.top - origin.top,
                right: rect.right - origin.left, bottom: rect.bottom - origin.top,
            }, pt.x, pt.y);
            var dx = end.x - pt.x;
            var dy = end.y - pt.y;
            var len = Math.sqrt(dx * dx + dy * dy);
            var gap = pointRadius(item.point) + 3;
            if (len < gap + 8) return null;
            return {
                x1: pt.x + dx / len * gap, y1: pt.y + dy / len * gap, x2: end.x, y2: end.y,
                color: pointColor(item.point),
            };
        }

        function updateLeaders() {
            if (!leaderSvg || !map) return;
            while (leaderSvg.firstChild) leaderSvg.removeChild(leaderSvg.firstChild);
            var container = map.getContainer();
            var width = container.clientWidth;
            var height = container.clientHeight;
            leaderSvg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
            leaderSvg.setAttribute('width', String(width));
            leaderSvg.setAttribute('height', String(height));
            var mapRect = container.getBoundingClientRect();
            bubbleMarkers.forEach(function (item) {
                if (!bubbleOf(item.point).leader) return;
                var seg = leaderSegment(item, mapRect);
                if (!seg) return;
                [['#ffffff', 4.5, 0.95], ['#1c1c1e', 1.6, 1]].forEach(function (s) {
                    var line = svgEl('line');
                    line.setAttribute('x1', seg.x1);
                    line.setAttribute('y1', seg.y1);
                    line.setAttribute('x2', seg.x2);
                    line.setAttribute('y2', seg.y2);
                    line.setAttribute('stroke', s[0]);
                    line.setAttribute('stroke-width', String(s[1]));
                    line.setAttribute('stroke-opacity', String(s[2]));
                    line.setAttribute('stroke-linecap', 'round');
                    leaderSvg.appendChild(line);
                });
                var dot = svgEl('circle');
                dot.setAttribute('cx', seg.x2);
                dot.setAttribute('cy', seg.y2);
                dot.setAttribute('r', '3');
                dot.setAttribute('fill', seg.color);
                dot.setAttribute('stroke', '#ffffff');
                dot.setAttribute('stroke-width', '1.5');
                leaderSvg.appendChild(dot);
            });
        }

        var bubbleUrls = [];
        var bubbleLimited = false;
        var BUBBLE_CAP = 200;

        function bubbleCandidates() {
            var list = [];
            points.forEach(function (p) {
                if (hidden[p.id]) return;
                if (bubbleContent(p).length) list.push(p);
            });
            return list;
        }

        // Få punkter ritas alla. Blir det fler ritas bara de som syns, så att kartan
        // inte skapar ett kort per punkt.
        function bubblesToDraw() {
            var list = bubbleCandidates();
            if (list.length <= BUBBLE_CAP || !map) return list;
            var box = map.getContainer().getBoundingClientRect();
            var margin = 80;
            var inside = [];
            list.forEach(function (p) {
                var pt = map.project([p.lon, p.lat]);
                if (pt.x >= -margin && pt.y >= -margin && pt.x <= box.width + margin && pt.y <= box.height + margin) inside.push(p);
            });
            if (inside.length <= BUBBLE_CAP) return inside;
            var cx = box.width / 2;
            var cy = box.height / 2;
            inside.sort(function (a, b) {
                var pa = map.project([a.lon, a.lat]);
                var pb = map.project([b.lon, b.lat]);
                var da = (pa.x - cx) * (pa.x - cx) + (pa.y - cy) * (pa.y - cy);
                var db = (pb.x - cx) * (pb.x - cx) + (pb.y - cy) * (pb.y - cy);
                return da - db;
            });
            return inside.slice(0, BUBBLE_CAP);
        }

        function syncBubbles() {
            bubbleUrls.forEach(function (url) { URL.revokeObjectURL(url); });
            bubbleUrls = [];
            bubbleMarkers.forEach(function (item) { item.marker.remove(); });
            bubbleMarkers = [];
            if (!map) return;
            var wanted = bubbleCandidates();
            var draw = bubblesToDraw();
            bubbleLimited = draw.length < wanted.length;
            var drawIds = {};
            draw.forEach(function (p) { drawIds[p.id] = true; });
            points.forEach(function (p) {
                if (!drawIds[p.id]) return;
                var parts = bubbleContent(p);
                if (!parts.length) return;
                var off = bubbleOffset[p.id] || { x: 0, y: -12 };
                var anchor = make('div', 'ft-bubble-anchor');
                var card = make('div', 'ft-bubble' + (bubbleCfg[p.id] ? ' is-custom' : ''));
                parts.forEach(function (part) {
                    if (part.thumb) {
                        var img = make('img', 'ft-bubble-thumb');
                        var url = URL.createObjectURL(part.thumb);
                        bubbleUrls.push(url);
                        img.src = url;
                        img.alt = '';
                        card.append(img);
                        return;
                    }
                    card.append(make('div', 'ft-bubble-line' + (part.heading ? ' ft-bubble-heading' : ''), part.text));
                });
                card.style.fontSize = Math.round(13 * bubbleScale) + 'px';
                card.style.transform = 'translate(' + off.x + 'px, ' + off.y + 'px)';
                card.title = 'Dra för att flytta bubblan. Dubbelklicka för att anpassa den.';
                anchor.append(card);
                card.addEventListener('click', function (e) { e.stopPropagation(); });
                card.addEventListener('dblclick', function (e) {
                    e.stopPropagation();
                    e.preventDefault();
                    picked = {};
                    picked[p.id] = true;
                    applyPick(listOpen);
                    openEditor([p.id]);
                });
                card.addEventListener('pointerdown', function (e) {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    map.dragPan.disable();
                    var startX = e.clientX;
                    var startY = e.clientY;
                    var origin = { x: off.x, y: off.y };
                    function move(ev) {
                        off = { x: origin.x + ev.clientX - startX, y: origin.y + ev.clientY - startY };
                        bubbleOffset[p.id] = off;
                        card.style.transform = 'translate(' + off.x + 'px, ' + off.y + 'px)';
                        updateLeaders();
                    }
                    function up() {
                        map.dragPan.enable();
                        window.removeEventListener('pointermove', move);
                        window.removeEventListener('pointerup', up);
                    }
                    window.addEventListener('pointermove', move);
                    window.addEventListener('pointerup', up);
                });
                var lift = bubbleOf(p).pin ? -Math.round(PIN_TOP_CSS + 8) : -10;
                var marker = new root.maplibregl.Marker({ element: anchor, anchor: 'bottom', offset: [0, lift] })
                    .setLngLat([p.lon, p.lat]).addTo(map);
                bubbleMarkers.push({ marker: marker, card: card, point: p });
            });
            requestAnimationFrame(updateLeaders);
            updateBubbleNote();
        }

        function refreshData() {
            if (!map || !map.getSource('files')) return;
            map.getSource('files').setData(geojson());
            map.getSource('route').setData(routeGeojson());
            if (map.getSource('time-marker')) map.getSource('time-marker').setData(timeMarkerGeojson());
            ['point-badge', 'point-step'].forEach(function (id) {
                if (!map.getLayer(id)) return;
                map.setFilter(id, badgeFilter());
                map.setLayoutProperty(id, 'visibility', badgeVisibility());
            });
            if (map.getLayer('pin-step')) {
                map.setFilter('pin-step', pinBadgeFilter());
                map.setLayoutProperty('pin-step', 'visibility', badgeVisibility());
            }
            paintStates();
            if (map.getSource('accuracy')) map.getSource('accuracy').setData(accuracyGeojson());
            refreshMeasure();
            syncBubbles();
        }

        function currentStyle() {
            if (online) return ONLINE.styles[theme()];
            if (archives.length) return offlineStyle(basemap);
            return { version: 8, glyphs: 'ftlocal://glyphs/{fontstack}/{range}.pbf', sources: {}, layers: [] };
        }

        // Onlinekartan har ingen satellit. Lokala bildkartor läggs under namnen i onlinestilen,
        // och i läget Satellit döljs namnen. Bilderna hämtas aldrig från nätet.
        function addOnlineImagery() {
            if (basemap === 'map') return;
            var firstLabel = null;
            map.getStyle().layers.forEach(function (layer) {
                if (layer.type !== 'symbol') return;
                if (!firstLabel) firstLabel = layer.id;
                if (basemap === 'satellite') map.setLayoutProperty(layer.id, 'visibility', 'none');
            });
            archives.forEach(function (a, i) {
                if (a.kind !== 'raster') return;
                map.addSource('ftimg' + i, {
                    type: 'raster', tiles: ['ftpm://' + i + '/{z}/{x}/{y}'], tileSize: a.tileSize || 256,
                    minzoom: a.minZoom, maxzoom: a.maxZoom, bounds: a.bounds, attribution: a.attribution,
                });
                map.addLayer({ id: 'ftimg' + i, type: 'raster', source: 'ftimg' + i }, firstLabel || undefined);
            });
        }

        function applyStyle() {
            styleError = '';
            var style = currentStyle();
            map.setStyle(style, { diff: false });
            map.once('style.load', function () {
                if (online) addOnlineImagery();
                addDataLayers();
                paintStates();
            });
            updateStatus();
        }

        function setBasemap(mode) {
            if (root.MapCore.basemapModes(archives).indexOf(mode) < 0) mode = 'map';
            if (mode === basemap) return;
            basemap = mode;
            if (map) applyStyle();
            else updateBasemap();
        }

        var selectedId = null;

        function paintStates() {
            if (!map || !map.getSource('files')) return;
            points.forEach(function (p) {
                map.setFeatureState({ source: 'files', id: p.id }, {
                    picked: !!picked[p.id],
                    selected: p.id === selectedId,
                });
            });
        }

        function select(id) {
            selectedId = id;
            paintStates();
            updateLeaders();
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
            if (p.accuracy > 0) row('Horisontell noggrannhet', Math.round(p.accuracy) + ' m');
            row('Händelse', notes[p.id] || p.note);
            var stepAt = inRouteById[p.id] ? routeInfo.steps.map(function (s) { return s.point.id; }).indexOf(p.id) : -1;
            var step = stepAt >= 0 ? routeInfo.steps[stepAt] : null;
            if (numberById[p.id]) {
                row('Nummer', numberById[p.id] + (el.route.checked && !step ? ' (inte med i rutten)' : ''));
            }
            if (step) {
                var routeText = 'Steg ' + (stepAt + 1) + ' av ' + routeInfo.steps.length + (step.assumed ? ' (tidszon antagen)' : '');
                if (step.trip && routeInfo.trips && routeInfo.trips.length > 1) routeText += ' · tur ' + step.trip;
                row('Rutt', routeText);
                if (step.fromPrev && root.MapCore.legText) row('Steg', root.MapCore.legText(step.fromPrev));
            }
            box.append(dl);
            var actions = make('div', 'map-popup-actions');
            var more = make('button', 'link-btn', p.detail || 'Visa metadata');
            more.type = 'button';
            more.addEventListener('click', function () {
                if (opts.onSelect && opts.onSelect(p.id)) return;
                openList(p.id);
            });
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
            if (editing) closeEditor(false);
            picked = {};
            picked[p.id] = true;
            listAnchor = p.id;
            closePopup();
            showPopup([p.lon, p.lat], popupContent(p), p.id);
            select(p.id);
            updatePickBar();
            if (listOpen) renderList();
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
            if (!leaderSvg) {
                leaderSvg = svgEl('svg');
                leaderSvg.setAttribute('class', 'ft-leaders');
                // Direkt efter kartans canvas, före markörerna som MapLibre lägger i samma
                // behållare. Då hamnar linjerna under bubblorna och miniatyrerna.
                var canvas = map.getCanvas();
                canvas.parentNode.insertBefore(leaderSvg, canvas.nextSibling);
                map.on('move', updateLeaders);
                map.on('resize', updateLeaders);
                map.on('moveend', function () {
                    if (bubbleCandidates().length > BUBBLE_CAP) syncBubbles();
                    if (listInView && listOpen) renderList();
                });
            }
            map.on('contextmenu', function (e) {
                e.preventDefault();
                if (opts.onContext) opts.onContext({ lat: e.lngLat.lat, lon: e.lngLat.lng });
            });
            map.on('click', 'clusters', function (e) {
                if (e.originalEvent) e.originalEvent._ftPick = true;
                if (measuring) { addMeasure(e.lngLat, e); return; }
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
            function onPointClick(e) {
                if (e.originalEvent) {
                    e.originalEvent._ftPick = true;
                    if (e.originalEvent._ftPickHandled) return;
                    e.originalEvent._ftPickHandled = true;
                }
                if (measuring) { addMeasure(e.lngLat, e); return; }
                var ids = {};
                e.features.forEach(function (f) {
                    if (f.properties && f.properties.id != null) ids[f.properties.id] = true;
                });
                var idList = Object.keys(ids);
                if (idList.length > 1) {
                    clusterList(e.features, e.features[0].geometry.coordinates);
                    return;
                }
                var p = byId[idList[0]];
                if (!p) return;
                if (e.originalEvent && e.originalEvent.shiftKey) {
                    if (picked[p.id]) delete picked[p.id];
                    else picked[p.id] = true;
                    listAnchor = p.id;
                    closePopup();
                    applyPick(true);
                    return;
                }
                openPoint(p);
            }
            ['points', 'pins', 'point-badge', 'point-step', 'pin-step'].forEach(function (layer) {
                map.on('click', layer, onPointClick);
            });
            ['clusters', 'points', 'pins', 'point-badge', 'pin-step'].forEach(function (layer) {
                map.on('mouseenter', layer, function () { map.getCanvas().style.cursor = 'pointer'; });
                map.on('mouseleave', layer, function () { map.getCanvas().style.cursor = ''; });
            });
            map.on('styleimagemissing', function (e) {
                if (map.hasImage(e.id)) return;
                if (e.id === 'ft-pin') map.addImage('ft-pin', pinImage(), { sdf: true, pixelRatio: PIN_PIXEL_RATIO });
                else if (e.id === 'route-arrow') map.addImage('route-arrow', arrowImage(), { pixelRatio: 2 });
                else map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
            });
            map.on('click', function (e) {
                if (e.originalEvent && e.originalEvent._ftPick) return;
                if (measuring) {
                    if (!(e.originalEvent && e.originalEvent._ftMeasured)) addMeasure(e.lngLat, e);
                    return;
                }
                if (e.originalEvent && e.originalEvent.shiftKey) return;
                if (!pickedIds().length) return;
                picked = {};
                listAnchor = null;
                closePopup();
                applyPick(true);
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
                    preserveDrawingBuffer: true,
                    localIdeographFontFamily: 'sans-serif',
                });
                map.addControl(new root.maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
                map.addControl({
                    onAdd: function () {
                        var box = make('div', 'maplibregl-ctrl maplibregl-ctrl-group map-list-ctrl');
                        box.append(el.listBtn);
                        return box;
                    },
                    onRemove: function () { if (el.listBtn.parentNode) el.listBtn.parentNode.remove(); },
                }, 'top-right');
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

        function updateRouteNote() {
            var parts = [];
            if (el.route.checked && namedRoutes.length) {
                parts.push(namedRoutes.map(function (r) {
                    return r.visible === false ? r.name + ' (dold)' : r.name;
                }).join(', ') + '. Punkter utanför ritas utan linje.');
            } else if (el.route.checked && routeInfo && routeInfo.steps.length > 1) {
                parts.push(root.MapCore.routeNote(routeInfo));
            }
            if (el.route.checked && routeInfo && routeInfo.steps.length > 1 && root.MapCore.routeSummary && !namedRoutes.length) {
                parts.push(root.MapCore.routeSummary(routeInfo));
            }
            var out = drawnPoints().filter(function (p) { return excluded[p.id]; }).length;
            if (el.route.checked && out) parts.push(out + (out === 1 ? ' punkt är' : ' punkter är') + ' inte med i rutten.');
            el.routeNote.textContent = parts.filter(Boolean).join(' ');
        }

        function updateBubbleNote() {
            var n = Object.keys(bubbleCfg).filter(function (id) { return byId[id]; }).length;
            var parts = [];
            if (n) parts.push(n + (n === 1 ? ' punkt har egen inställning.' : ' punkter har egen inställning.'));
            if (bubbleLimited) parts.push('Bubblor visas för punkterna i bild. Zooma in om du vill se fler.');
            el.bubbleCustom.textContent = parts.join(' ');
            el.bubbleReset.classList.toggle('display-none', !n);
        }

        function routeChanged() {
            computeRoute();
            updateRouteNote();
            renderList();
            updatePickBar();
            setupTime();
            refreshData();
        }

        function setInRoute(ids, on) {
            ids.forEach(function (id) {
                if (on) delete excluded[id];
                else excluded[id] = true;
            });
            routeChanged();
        }

        function setHidden(ids, on) {
            ids.forEach(function (id) {
                if (on) hidden[id] = true;
                else delete hidden[id];
            });
            routeChanged();
        }

        function setPoints(list, noteText) {
            points = list;
            byId = {};
            list.forEach(function (p) { byId[p.id] = p; });
            Object.keys(picked).forEach(function (id) { if (!byId[id]) delete picked[id]; });
            computeRoute();
            updateRouteNote();
            updateBubbleNote();
            renderList();
            updatePickBar();
            setupTime();
            el.note.textContent = noteText || '';
            if (popup && selectedId !== null && !byId[selectedId]) closePopup();
            refreshData();
        }

        // Redigeringen visas direkt på kartan. Avbryt lägger tillbaka det som gällde innan.
        var editing = null;
        var editTimer = null;

        function cloneBubble(cfg) {
            cfg = cfg || {};
            return {
                titles: !!cfg.titles,
                leader: !!cfg.leader,
                ring: !!cfg.ring,
                pin: !!cfg.pin,
                items: (cfg.items || []).map(function (i) { return Object.assign({}, i); }),
            };
        }

        function fieldLabel(key) {
            var f = root.MapCore.BUBBLE_FIELDS.filter(function (x) { return x.key === key; })[0];
            return f ? f.label : '';
        }

        function openStandard() {
            if (editing) closeEditor(false);
            closePopup();
            editing = { standard: true, before: cloneBubble(standardCfg), cfg: cloneBubble(standardCfg) };
            renderEditor();
            el.editor.classList.remove('display-none');
        }

        function openEditor(ids, title) {
            ids = (ids || []).filter(function (id) { return byId[id]; });
            if (!ids.length) return;
            if (editing) closeEditor(false);
            closePopup();
            var before = {};
            var notesBefore = {};
            ids.forEach(function (id) {
                before[id] = bubbleCfg[id] || null;
                notesBefore[id] = notes[id] || (byId[id] && byId[id].note) || '';
            });
            editing = { ids: ids, title: title || '', before: before, notesBefore: notesBefore, cfg: cloneBubble(bubbleOf(byId[ids[0]])) };
            renderEditor();
            el.editor.classList.remove('display-none');
        }

        function applyEditing() {
            if (editing.standard) standardCfg = cloneBubble(editing.cfg);
            else editing.ids.forEach(function (id) { bubbleCfg[id] = cloneBubble(editing.cfg); });
            clearTimeout(editTimer);
            editTimer = setTimeout(refreshData, 120);
        }

        function closeEditor(restore) {
            if (!editing) return;
            if (restore) {
                if (editing.standard) standardCfg = editing.before;
                else Object.keys(editing.before).forEach(function (id) {
                    if (editing.before[id]) bubbleCfg[id] = editing.before[id];
                    else delete bubbleCfg[id];
                });
                if (editing.notesBefore) {
                    Object.keys(editing.notesBefore).forEach(function (id) {
                        var value = editing.notesBefore[id];
                        if (value) {
                            notes[id] = value;
                            if (byId[id]) byId[id].note = value;
                        } else {
                            delete notes[id];
                            if (byId[id]) byId[id].note = '';
                        }
                    });
                }
            }
            editing = null;
            clearTimeout(editTimer);
            el.editor.classList.add('display-none');
            el.editor.textContent = '';
            refreshData();
        }

        function smallButton(text, title, onClick) {
            var b = make('button', 'map-editor-btn', text);
            b.type = 'button';
            if (title) { b.title = title; b.setAttribute('aria-label', title); }
            b.addEventListener('click', onClick);
            return b;
        }

        function renderEditor() {
            var box = el.editor;
            var items = editing.cfg.items;
            box.textContent = '';
            var many = !editing.standard && editing.ids.length > 1;
            var heading = editing.standard ? 'Standard för bubblor'
                : (editing.title || (many ? editing.ids.length + ' bubblor' : (byId[editing.ids[0]].name || 'Bubblan')));
            box.append(make('h3', '', heading));
            box.append(make('p', 'map-note', editing.standard
                ? 'Gäller alla punkter som inte har en egen inställning.'
                : (many
                    ? 'Gäller de markerade punkterna och ersätter deras tidigare inställning.'
                    : 'Gäller den här punkten och ersätter standarden.') +
                    ' Bocka för det som ska visas, ändra ordning och skriv en egen titel om du vill.'));
            box.append(make('h4', '', 'På kartan'));
            var leader = labeledToggle('Linje till punkten');
            leader.input.checked = !!editing.cfg.leader;
            leader.input.addEventListener('change', function () { editing.cfg.leader = leader.input.checked; applyEditing(); });
            var ring = labeledToggle('Horisontell noggrannhet');
            ring.label.title = 'Ring runt punkten som visar osäkerheten i meter';
            ring.input.checked = !!editing.cfg.ring;
            ring.input.addEventListener('change', function () { editing.cfg.ring = ring.input.checked; applyEditing(); });
            box.append(leader.label, ring.label);
            if (PIN_ENABLED) {
                var pinToggle = labeledToggle('Nål istället för punkt');
                pinToggle.label.title = 'Visar en kartnål i stället för den runda punkten';
                pinToggle.input.checked = !!editing.cfg.pin;
                pinToggle.input.addEventListener('change', function () { editing.cfg.pin = pinToggle.input.checked; applyEditing(); });
                box.append(pinToggle.label);
            }
            box.append(make('h4', '', 'I bubblan'));
            if (editing.standard) {
                box.append(make('p', 'map-note', 'Händelsetexten skrivs när du anpassar en punkt, en källa eller en rutt. Här väljer du bara om den ska synas.'));
            }
            if (!editing.standard) {
                var eventLabel = make('label', 'map-event');
                eventLabel.append(make('span', '', 'Händelse'));
                var event = make('input');
                event.type = 'text';
                event.placeholder = many ? 'Samma text för alla markerade' : 'Vad hände här';
                var eventValues = editing.ids.map(function (id) { return notes[id] || (byId[id] && byId[id].note) || ''; });
                if (!many || eventValues.every(function (v) { return v === eventValues[0]; })) event.value = eventValues[0] || '';
                event.addEventListener('input', function () {
                    if (many && !event.value) return;
                    editing.ids.forEach(function (id) {
                        if (event.value) notes[id] = event.value;
                        else delete notes[id];
                        if (byId[id]) byId[id].note = event.value;
                    });
                    if (event.value) {
                        editing.cfg.items.forEach(function (item) { if (item.key === 'note') item.on = true; });
                        var noteBox = box.querySelector('.map-editor-row[data-key="note"] input[type="checkbox"]');
                        if (noteBox) noteBox.checked = true;
                    }
                    applyEditing();
                });
                eventLabel.append(event);
                if (many && !eventValues.every(function (v) { return v === eventValues[0]; })) {
                    eventLabel.append(make('span', 'map-event-hint', 'Lämna tomt om varje punkt ska behålla sin händelse.'));
                }
                box.append(eventLabel);
            }
            var titles = labeledToggle('Titlar framför värdena (Tid:, Filnamn: …)');
            titles.input.checked = editing.cfg.titles;
            titles.input.addEventListener('change', function () { editing.cfg.titles = titles.input.checked; applyEditing(); });
            box.append(titles.label);
            var listEl = make('div', 'map-editor-items');
            items.forEach(function (item, i) {
                var rowEl = make('div', 'map-editor-row');
                rowEl.dataset.key = item.key;
                var on = make('input');
                on.type = 'checkbox';
                on.checked = item.on;
                on.title = 'Visa i bubblan';
                on.addEventListener('change', function () { item.on = on.checked; applyEditing(); });
                rowEl.append(on);
                if (item.key === 'thumb') {
                    rowEl.append(make('span', 'map-editor-fixed', 'Miniatyr'));
                } else if (item.key === 'note') {
                    rowEl.append(make('span', 'map-editor-fixed', 'Visa händelsen'));
                } else {
                    var label = make('input');
                    label.type = 'text';
                    label.value = item.label || '';
                    label.placeholder = item.key === 'custom' ? 'Egen titel' : fieldLabel(item.key);
                    label.title = item.key === 'custom' ? 'Titel' : 'Egen titel för ' + fieldLabel(item.key) + '. Tomt = standard.';
                    label.addEventListener('input', function () { item.label = label.value; applyEditing(); });
                    rowEl.append(label);
                }
                if (item.key === 'custom') {
                    var value = make('input');
                    value.type = 'text';
                    value.value = item.value || '';
                    value.placeholder = 'Text (valfri)';
                    value.addEventListener('input', function () { item.value = value.value; applyEditing(); });
                    rowEl.append(value);
                    rowEl.classList.add('is-custom');
                }
                var moves = make('div', 'map-editor-moves');
                var up = smallButton('↑', 'Flytta upp', function () {
                    items.splice(i - 1, 0, items.splice(i, 1)[0]);
                    applyEditing();
                    renderEditor();
                });
                up.disabled = i === 0;
                var down = smallButton('↓', 'Flytta ned', function () {
                    items.splice(i + 1, 0, items.splice(i, 1)[0]);
                    applyEditing();
                    renderEditor();
                });
                down.disabled = i === items.length - 1;
                moves.append(up, down);
                if (item.key === 'custom') {
                    moves.append(smallButton('×', 'Ta bort raden', function () {
                        items.splice(i, 1);
                        applyEditing();
                        renderEditor();
                    }));
                }
                rowEl.append(moves);
                listEl.append(rowEl);
            });
            box.append(listEl);
            var add = make('button', 'link-btn', '+ Egen rad');
            add.type = 'button';
            add.addEventListener('click', function () {
                items.unshift({ key: 'custom', on: true, label: '', value: '' });
                applyEditing();
                renderEditor();
                var first = box.querySelector('.map-editor-row.is-custom input[type="text"]');
                if (first) first.focus();
            });
            box.append(add);
            var actions = make('div', 'consent-actions');
            var reset = null;
            if (!editing.standard) {
                reset = make('button', 'secondary-btn', 'Följ standarden');
                reset.type = 'button';
                reset.title = 'Ta bort den egna inställningen så att punkterna följer standarden';
                reset.addEventListener('click', function () {
                    editing.ids.forEach(function (id) { delete bubbleCfg[id]; });
                    editing.before = {};
                    closeEditor(false);
                });
            }
            var cancel = make('button', 'secondary-btn', 'Avbryt');
            cancel.type = 'button';
            cancel.addEventListener('click', function () { closeEditor(true); });
            var done = make('button', 'primary-btn', 'Klar');
            done.type = 'button';
            done.addEventListener('click', function () { closeEditor(false); });
            if (reset) actions.append(reset);
            actions.append(cancel, done);
            box.append(actions);
        }

        el.editor.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeEditor(true);
        });
        el.bubbleReset.addEventListener('click', function () {
            bubbleCfg = {};
            refreshData();
        });
        el.bubbleStandard.addEventListener('click', openStandard);

        var listOpen = false;

        function orderedPoints() {
            return points.map(function (p) { return { point: p, index: numberById[p.id] || 0 }; })
                .sort(function (a, b) { return (a.index || Infinity) - (b.index || Infinity); });
        }

        function pickedIds() {
            return points.filter(function (p) { return picked[p.id]; }).map(function (p) { return p.id; });
        }

        // Sökrutan byggs en gång, så att den behåller fokus när listan ritas om.
        var listQuery = '';
        var listInView = false;
        var listAnchor = null;

        function selectListRange(ids, targetId) {
            var end = -1;
            var start = -1;
            for (var i = 0; i < ids.length; i++) {
                if (ids[i] === targetId) end = i;
                if (listAnchor != null && ids[i] === listAnchor) start = i;
            }
            if (end < 0) return;
            if (start < 0) start = end;
            var lo = Math.min(start, end);
            var hi = Math.max(start, end);
            picked = {};
            for (var j = lo; j <= hi; j++) picked[ids[j]] = true;
            if (start === end) listAnchor = targetId;
            applyPick(true);
        }

        function pointInView(p) {
            if (hidden[p.id]) return false;
            if (!map || !isFinite(p.lon) || !isFinite(p.lat)) return false;
            try { return map.getBounds().contains([p.lon, p.lat]); }
            catch (e) { return false; }
        }
        var listCount = make('span', 'map-list-count');
        var listSearch = make('input', 'map-list-search');
        listSearch.type = 'search';
        listSearch.placeholder = 'Sök namn, tid, enhet, händelse…';
        listSearch.setAttribute('aria-label', 'Sök i listan');
        listSearch.addEventListener('input', function () {
            listQuery = listSearch.value;
            renderList();
        });
        listSearch.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape' || !listSearch.value) return;
            e.stopPropagation();
            listSearch.value = listQuery = '';
            renderList();
        });

        function listMatches(p) {
            if (listInView && !pointInView(p)) return false;
            var terms = listQuery.toLowerCase().split(/\s+/).filter(Boolean);
            if (!terms.length) return true;
            var text = [p.name, p.path, p.taken && p.taken.text, p.device, p.app, root.MapCore.sourceOf(p), notes[p.id] || p.note]
                .filter(Boolean).join(' ').toLowerCase();
            return terms.every(function (t) { return text.indexOf(t) >= 0; });
        }

        function listTools(sources) {
            var tools = make('div', 'map-list-tools');
            var inView = make('button', 'link-btn' + (listInView ? ' is-on' : ''), 'I kartan');
            inView.type = 'button';
            inView.title = 'Visa bara positioner som syns i kartan just nu. Numren ändras inte.';
            inView.setAttribute('aria-pressed', listInView ? 'true' : 'false');
            inView.addEventListener('click', function () {
                listInView = !listInView;
                renderList();
            });
            tools.append(inView);
            var markLabel = make('span', 'muted', 'Markera');
            markLabel.title = 'Skift+klick i listan markerar raderna emellan';
            tools.append(markLabel);
            var all = make('button', 'link-btn', 'Alla');
            all.type = 'button';
            all.title = 'Markera alla som syns i listan';
            all.addEventListener('click', function () {
                points.forEach(function (p) { if (listMatches(p)) picked[p.id] = true; });
                applyPick(true);
            });
            var none = make('button', 'link-btn', 'Inga');
            none.type = 'button';
            none.title = 'Avmarkera alla';
            none.addEventListener('click', function () { picked = {}; listAnchor = null; applyPick(true); });
            tools.append(all, none);
            if (sources.length > 1) {
                var bySource = make('select');
                bySource.title = 'Markera alla punkter från en källa';
                var blank = make('option', '', 'Källa…');
                blank.value = '';
                bySource.append(blank);
                sources.forEach(function (s) {
                    var o = make('option', '', s);
                    o.value = s;
                    bySource.append(o);
                });
                bySource.addEventListener('change', function () {
                    var want = bySource.value;
                    if (!want) return;
                    picked = {};
                    points.forEach(function (p) { if (root.MapCore.sourceOf(p) === want) picked[p.id] = true; });
                    applyPick(true);
                });
                tools.append(bySource);
            }
            return tools;
        }

        function updatePickBar() {
            var ids = pickedIds();
            var bar = el.pickBar;
            bar.textContent = '';
            if (!ids.length) {
                bar.classList.add('display-none');
                return;
            }
            bar.classList.remove('display-none');
            bar.append(make('strong', '', ids.length === 1 ? '1 markerad' : ids.length + ' markerade'));
            function action(text, fn) {
                var b = make('button', 'link-btn', text);
                b.type = 'button';
                b.addEventListener('click', function (e) {
                    e.stopPropagation();
                    fn();
                });
                bar.append(b);
            }
            var allIn = ids.every(function (id) { return !excluded[id]; });
            var allHidden = ids.every(function (id) { return hidden[id]; });
            action('Anpassa', function () { openEditor(ids); });
            action(allIn ? 'Ur rutten' : 'Med i rutten', function () { setInRoute(ids, !allIn); });
            action(allHidden ? 'Visa' : 'Dölj', function () { setHidden(ids, !allHidden); });
            action('Ta bort', function () {
                closePopup();
                ids.forEach(function (id) {
                    delete picked[id];
                    delete hidden[id];
                    if (opts.onRemove) opts.onRemove(id);
                });
            });
            action('Avmarkera', function () { picked = {}; listAnchor = null; applyPick(true); });
            bar.append(make('span', 'map-pick-hint', 'Skift+klick i listan markerar ett intervall'));
        }

        function applyPick(redraw) {
            if (editing) closeEditor(false);
            if (!pickedIds().length) listAnchor = null;
            paintStates();
            updatePickBar();
            if (redraw && listOpen) renderList();
        }

        function markPoints(ids) {
            if (editing) closeEditor(false);
            picked = {};
            (ids || []).forEach(function (id) { if (byId[id]) picked[id] = true; });
            closePopup();
            setList(true);
            applyPick(true);
        }

        function renderList(ensureId) {
            var active = el.list.querySelector('.map-list-row.active');
            var activeId = active ? active.dataset.id : '';
            var scroll = el.list.scrollTop;
            var searching = document.activeElement === listSearch;
            var caret = listSearch.selectionStart;
            el.list.textContent = '';
            var head = make('div', 'map-list-head');
            var top = make('div', 'map-list-title');
            var title = make('div', 'map-list-heading');
            title.append(make('strong', '', 'Positioner'), listCount);
            var close = make('button', 'link-btn', 'Stäng');
            close.type = 'button';
            close.addEventListener('click', function () { setList(false); });
            top.append(title, close);
            head.append(top);
            el.list.append(head);
            var rows = orderedPoints();
            if (!rows.length) {
                el.list.append(make('p', 'map-note', 'Inga positioner att visa.'));
                return;
            }
            head.append(listSearch);
            if (searching) {
                listSearch.focus();
                listSearch.setSelectionRange(caret, caret);
            }
            var sources = [];
            points.forEach(function (p) {
                var s = root.MapCore.sourceOf(p);
                if (s && sources.indexOf(s) < 0) sources.push(s);
            });
            head.append(listTools(sources));
            head.append(make('p', 'map-note map-list-hint', 'Skift+klick markerar alla rader emellan. Anpassa finns i listen längst ned.'));
            var matched = rows.filter(function (row) { return listMatches(row.point); });
            var LIST_CAP = 300;
            var pin = ensureId != null ? String(ensureId) : activeId;
            var shown = matched.slice(0, LIST_CAP);
            if (pin) {
                var pinned = matched.filter(function (row) { return String(row.point.id) === pin; })[0];
                if (pinned && shown.indexOf(pinned) < 0) shown.unshift(pinned);
            }
            if (listQuery.trim() || listInView) listCount.textContent = matched.length + ' av ' + rows.length;
            else if (matched.length > LIST_CAP) listCount.textContent = 'Visar ' + LIST_CAP + ' av ' + matched.length;
            else listCount.textContent = '';
            shown.forEach(function (row) {
                var p = row.point;
                var item = make('div', 'map-list-row' + (String(p.id) === activeId ? ' active' : '') +
                    (hidden[p.id] ? ' is-hidden' : '') + (picked[p.id] ? ' is-picked' : ''));
                item.dataset.id = String(p.id);
                var pick = make('input', 'map-list-pick');
                pick.type = 'checkbox';
                pick.checked = !!picked[p.id];
                pick.title = 'Markera. Skift+klick tar med raderna emellan.';
                pick.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (!e.shiftKey) return;
                    e.preventDefault();
                    selectListRange(shown.map(function (r) { return r.point.id; }), p.id);
                });
                pick.addEventListener('change', function () {
                    if (pick.checked) picked[p.id] = true;
                    else delete picked[p.id];
                    listAnchor = p.id;
                    applyPick(true);
                });
                var num = make('b', 'map-list-num' + (el.route.checked && !inRouteById[p.id] ? ' is-off-route' : ''),
                    row.index ? String(row.index) : '–');
                if (num.classList.contains('is-off-route')) num.title = 'Inte med i rutten';
                item.append(pick, num);
                var body = make('div', 'map-list-body');
                body.append(make('div', 'map-list-name', p.name || 'Punkt'));
                var source = sources.length > 1 ? root.MapCore.sourceOf(p) : '';
                var meta = [p.taken ? p.taken.text : 'Ingen tid', p.device, p.app, source !== p.device ? source : '']
                    .filter(Boolean).join(' · ');
                if (meta) body.append(make('div', 'map-list-meta', meta));
                var noteText = notes[p.id] || p.note || '';
                if (noteText) body.append(make('div', 'map-list-note', noteText));
                var buttons = make('div', 'map-list-actions');
                var more = make('button', 'link-btn', p.detail || 'Visa metadata');
                more.type = 'button';
                more.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (opts.onSelect && opts.onSelect(p.id)) return;
                    openList(p.id);
                });
                var hideRow = make('button', 'link-btn', hidden[p.id] ? 'Visa på kartan' : 'Dölj');
                hideRow.type = 'button';
                hideRow.addEventListener('click', function (e) {
                    e.stopPropagation();
                    setHidden([p.id], !hidden[p.id]);
                });
                var remove = make('button', 'link-btn', 'Ta bort');
                remove.type = 'button';
                remove.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (opts.onRemove) opts.onRemove(p.id);
                });
                buttons.append(more, hideRow, remove);
                body.append(buttons);
                item.append(body);
                item.addEventListener('click', function (e) {
                    if (e.shiftKey) {
                        selectListRange(shown.map(function (r) { return r.point.id; }), p.id);
                        return;
                    }
                    listAnchor = p.id;
                    openPoint(p);
                });
                el.list.append(item);
            });
            el.list.append(make('p', 'map-note map-list-nohit' + (matched.length ? ' display-none' : ''), 'Inga träffar.'));
            if (matched.length > shown.length) {
                el.list.append(make('p', 'map-note map-list-more', 'Sök för att se de övriga punkterna.'));
            }
            el.list.scrollTop = scroll;
        }

        function setList(open) {
            listOpen = open;
            el.list.classList.toggle('display-none', !open);
            el.wrap.classList.toggle('map-with-list', open);
            el.listBtn.classList.toggle('active', open);
            el.listBtn.title = open ? 'Stäng listan' : 'Visa alla punkter i en lista';
            if (map) map.resize();
        }

        function openList(id) {
            setList(true);
            renderList(id);
            if (id === undefined || id === null) return;
            var row = el.list.querySelector('[data-id="' + String(id) + '"]');
            if (!row) return;
            el.list.querySelectorAll('.map-list-row.active').forEach(function (n) { n.classList.remove('active'); });
            row.classList.add('active');
            row.scrollIntoView({ block: 'nearest' });
        }

        var playTimer = null;

        function stopPlay() {
            if (playTimer) clearInterval(playTimer);
            playTimer = null;
            el.play.textContent = 'Spela';
        }

        function setupTime() {
            stopPlay();
            timeCursor = null;
            var split = appliedRanges && customRoutes.filter(function (r) { return r.steps.length > 1; }).length > 1;
            var on = el.route.checked && routeInfo && routeInfo.steps.length > 1 && !split;
            el.timeBar.classList.toggle('display-none', !on);
            if (!on) return;
            el.timeInput.min = String(routeInfo.steps[0].at);
            el.timeInput.max = String(routeInfo.steps[routeInfo.steps.length - 1].at);
            el.timeInput.value = el.timeInput.max;
            el.timeLabel.textContent = 'Dra för att se rutten fram till en tidpunkt';
        }

        // En position per rutt som visas (per enhet blir det en per enhet).
        function timePositions() {
            if (timeCursor === null || !root.MapCore.positionAt) return [];
            var out = [];
            shownRoutes().forEach(function (r, group) {
                var pos = root.MapCore.positionAt(r, timeCursor);
                if (!pos) return;
                var colorAt = r.colorIndex != null ? r.colorIndex : group;
                pos.color = TRIP_COLORS[colorAt % TRIP_COLORS.length];
                out.push(pos);
            });
            return out;
        }

        function timeMarkerGeojson() {
            return {
                type: 'FeatureCollection',
                features: timePositions().map(function (pos) {
                    return {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] },
                        properties: { color: pos.color, interpolated: pos.interpolated ? 1 : 0 },
                    };
                }),
            };
        }

        // Tiden visas i zonen för punkten före T, så att den går att jämföra med källan.
        function zoneAt(pos) {
            var step = pos.before;
            if (step && !step.assumed && step.point.taken && step.point.taken.zone) return { zone: step.point.taken.zone, assumed: false };
            return { zone: routeInfo.assumedZone || 'UTC', assumed: !!routeInfo.assumedZone };
        }

        function showTime(t) {
            timeCursor = t;
            var list = timePositions();
            if (list.length) {
                var pos = list[0];
                var z = zoneAt(pos);
                var label = root.MapCore.formatInstant(t, z.zone) + (z.assumed ? ' (antagen zon)' : '');
                if (list.length > 1) label += ' · ' + list.length + ' rutter';
                else if (pos.interpolated) label += ' · uppskattad mellan två punkter, inte uppmätt';
                else if (pos.before) label += ' · ' + (pos.before.point.name || 'punkt ' + (numberById[pos.before.point.id] || ''));
                el.timeLabel.textContent = label;
                el.timeLabel.title = label;
            }
            if (!map || !map.getSource('route')) return;
            map.getSource('route').setData(routeGeojson());
            map.getSource('time-marker').setData(timeMarkerGeojson());
        }

        function playStep() {
            var start = Number(el.timeInput.min);
            var end = Number(el.timeInput.max);
            var tick = 100;
            var rate = el.speed.value === 'auto' ? (end - start) / (10000 / tick) : Number(el.speed.value) * tick;
            var t = Math.min(end, Number(el.timeInput.value) + Math.max(1, rate));
            el.timeInput.value = String(t);
            showTime(t);
            if (t >= end) stopPlay();
        }

        el.route.addEventListener('change', routeChanged);
        el.numbers.addEventListener('change', refreshData);
        el.listBtn.addEventListener('click', function () { setList(!listOpen); if (listOpen) renderList(); });
        el.bubbleSmaller.addEventListener('click', function () {
            bubbleScale = Math.max(0.75, Math.round(bubbleScale * 0.85 * 100) / 100);
            syncBubbles();
        });
        el.bubbleLarger.addEventListener('click', function () {
            bubbleScale = Math.min(2, Math.round(bubbleScale * 1.18 * 100) / 100);
            syncBubbles();
        });
        el.perDevice.addEventListener('change', refreshData);
        el.timeInput.addEventListener('input', function () { showTime(Number(el.timeInput.value)); });
        el.play.addEventListener('click', function () {
            if (playTimer) { stopPlay(); return; }
            // Står reglaget i slutet börjar uppspelningen om från början.
            if (timeCursor === null || Number(el.timeInput.value) >= Number(el.timeInput.max)) {
                el.timeInput.value = el.timeInput.min;
                showTime(Number(el.timeInput.min));
            }
            el.play.textContent = 'Paus';
            playTimer = setInterval(playStep, 100);
        });
        // Bilden ska gå att lägga i en rapport: källa (krävs av licensen), skala, norr och
        // när den skapades.
        var REPORT_FOOTER = 46;

        function pad(n) { return (n < 10 ? '0' : '') + n; }

        function stamp(d) {
            return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        }

        function zoneText(d) {
            var off = -d.getTimezoneOffset();
            var sign = off < 0 ? '-' : '+';
            off = Math.abs(off);
            return sign + pad(Math.floor(off / 60)) + ':' + pad(off % 60);
        }

        function attributionText() {
            var node = map.getContainer().querySelector('.maplibregl-ctrl-attrib-inner');
            var text = node ? node.textContent.replace(/\s+/g, ' ').trim() : '';
            return text || (online ? ONLINE.name : OFFLINE_ATTRIBUTION);
        }

        function drawNorth(ctx, cx, cy, scale) {
            var r = 18 * scale;
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.92)';
            ctx.fill();
            ctx.lineWidth = scale;
            ctx.strokeStyle = '#1c1c1e';
            ctx.stroke();
            ctx.translate(cx, cy);
            ctx.rotate(-map.getBearing() * Math.PI / 180);
            ctx.beginPath();
            ctx.moveTo(0, -12 * scale);
            ctx.lineTo(6 * scale, 6 * scale);
            ctx.lineTo(0, 2 * scale);
            ctx.lineTo(-6 * scale, 6 * scale);
            ctx.closePath();
            ctx.fillStyle = '#1c1c1e';
            ctx.fill();
            ctx.font = '700 ' + Math.round(9 * scale) + 'px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText('N', 0, 15.5 * scale);
            ctx.restore();
        }

        function drawFooter(ctx, top, width, scale, now) {
            var h = REPORT_FOOTER * scale;
            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, top, width, h);
            ctx.fillStyle = '#1c1c1e';
            ctx.fillRect(0, top, width, scale);
            var pad8 = 10 * scale;
            // Skalstocken mäts mitt i kartan. Med lutning stämmer den bara ungefär.
            var center = map.getCenter();
            var metersPerPx = 40075016.686 * Math.cos(center.lat * Math.PI / 180) / (512 * Math.pow(2, map.getZoom()));
            var nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
            var meters = nice[0];
            nice.forEach(function (m) { if (m / metersPerPx <= 120) meters = m; });
            var barW = meters / metersPerPx * scale;
            var y = top + 17 * scale;
            ctx.strokeStyle = '#1c1c1e';
            ctx.lineWidth = 2 * scale;
            ctx.beginPath();
            ctx.moveTo(pad8, y - 5 * scale);
            ctx.lineTo(pad8, y);
            ctx.lineTo(pad8 + barW, y);
            ctx.lineTo(pad8 + barW, y - 5 * scale);
            ctx.stroke();
            ctx.textBaseline = 'alphabetic';
            ctx.font = '600 ' + Math.round(11 * scale) + 'px sans-serif';
            ctx.fillText(root.MapCore.formatDistance(meters), pad8, top + 33 * scale);
            var left = pad8 + Math.max(barW, 60 * scale) + 16 * scale;
            ctx.font = '600 ' + Math.round(11 * scale) + 'px sans-serif';
            var view = 'Skapad ' + stamp(now) + ' (' + zoneText(now) + ') · Mitt ' +
                center.lat.toFixed(5) + ', ' + center.lng.toFixed(5) + ' · zoom ' + map.getZoom().toFixed(1) +
                (map.getPitch() > 1 ? ' · lutad vy, skalan ungefärlig' : '');
            ctx.fillText(view, left, top + 18 * scale, width - left - pad8);
            ctx.font = Math.round(10 * scale) + 'px sans-serif';
            ctx.fillStyle = '#48484a';
            ctx.fillText('Kartdata: ' + attributionText(), left, top + 34 * scale, width - left - pad8);
            ctx.restore();
        }

        function saveMapImage() {
            if (!map) return;
            map.triggerRepaint();
            requestAnimationFrame(function () {
                var glCanvas = map.getCanvas();
                var box = map.getContainer().getBoundingClientRect();
                var scale = glCanvas.width / box.width;
                var out = document.createElement('canvas');
                out.width = glCanvas.width;
                out.height = glCanvas.height + Math.round(REPORT_FOOTER * scale);
                var ctx = out.getContext('2d');
                ctx.drawImage(glCanvas, 0, 0);
                ctx.lineCap = 'round';
                bubbleMarkers.forEach(function (item) {
                    if (!bubbleOf(item.point).leader) return;
                    var seg = leaderSegment(item, box);
                        if (!seg) return;
                        [['rgba(255,255,255,0.95)', 4.5], ['#1c1c1e', 1.6]].forEach(function (s) {
                            ctx.beginPath();
                            ctx.moveTo(seg.x1 * scale, seg.y1 * scale);
                            ctx.lineTo(seg.x2 * scale, seg.y2 * scale);
                            ctx.strokeStyle = s[0];
                            ctx.lineWidth = s[1] * scale;
                            ctx.stroke();
                        });
                        ctx.beginPath();
                        ctx.arc(seg.x2 * scale, seg.y2 * scale, 3 * scale, 0, Math.PI * 2);
                        ctx.fillStyle = seg.color;
                        ctx.fill();
                        ctx.lineWidth = 1.5 * scale;
                        ctx.strokeStyle = '#ffffff';
                        ctx.stroke();
                });
                bubbleMarkers.forEach(function (item) {
                    var rect = item.card.getBoundingClientRect();
                    var x = (rect.left - box.left) * scale;
                    var y = (rect.top - box.top) * scale;
                    var w = rect.width * scale;
                    var h = rect.height * scale;
                    ctx.beginPath();
                    ctx.roundRect(x, y, w, h, 8 * scale);
                    ctx.fillStyle = '#ffffff';
                    ctx.fill();
                    ctx.lineWidth = scale;
                    ctx.strokeStyle = '#1c1c1e';
                    ctx.stroke();
                    ctx.fillStyle = '#1c1c1e';
                    ctx.textBaseline = 'top';
                    var fontPx = Math.round(13 * bubbleScale * scale);
                    var lineH = Math.round(13 * bubbleScale * 1.35 * scale);
                    // Raderna ritas där de ligger i bubblan, i samma ordning som på skärmen.
                    Array.prototype.forEach.call(item.card.children, function (child) {
                        var r = child.getBoundingClientRect();
                        var cx = (r.left - box.left) * scale;
                        var cy = (r.top - box.top) * scale;
                        if (child.tagName === 'IMG') {
                            if (child.complete && child.naturalWidth) ctx.drawImage(child, cx, cy, r.width * scale, r.height * scale);
                            return;
                        }
                        ctx.font = (child.classList.contains('ft-bubble-heading') ? '800 ' : '600 ') + fontPx + 'px sans-serif';
                        var maxW = r.width * scale + 1;
                        var line = '';
                        var row = 0;
                        child.textContent.split(/\s+/).forEach(function (word) {
                            var next = line ? line + ' ' + word : word;
                            if (line && ctx.measureText(next).width > maxW) {
                                ctx.fillText(line, cx, cy + row * lineH);
                                row++;
                                line = word;
                            } else line = next;
                        });
                        if (line) ctx.fillText(line, cx, cy + row * lineH);
                    });
                });
                var now = new Date();
                drawNorth(ctx, glCanvas.width - 34 * scale, 34 * scale, scale);
                drawFooter(ctx, glCanvas.height, out.width, scale, now);
                var a = document.createElement('a');
                a.download = 'karta-' + stamp(now).replace(/[-:]/g, '').replace(' ', '-') + '.png';
                a.href = out.toDataURL('image/png');
                a.click();
            });
        }

        el.fit.addEventListener('click', fit);
        el.measureBtn.addEventListener('click', function () {
            measuring = !measuring;
            el.measureBtn.classList.toggle('active', measuring);
            measureClicks = [];
            el.measureNote.textContent = measuring ? 'Klicka startpunkt.' : '';
            refreshMeasure();
            if (map) map.getCanvas().style.cursor = measuring ? 'crosshair' : '';
        });
        el.saveBtn.addEventListener('click', saveMapImage);
        Object.keys(el.basemapButtons).forEach(function (key) {
            el.basemapButtons[key].addEventListener('click', function () { setBasemap(key); });
        });
        el.addImagery.addEventListener('click', function () { el.imageryInput.click(); });
        el.imageryInput.addEventListener('change', function () {
            var files = Array.prototype.filter.call(el.imageryInput.files || [], function (f) { return /\.pmtiles$/i.test(f.name); });
            el.imageryInput.value = '';
            if (!files.length) return;
            start().then(function () { return addFiles(files); }).then(function (added) {
                var images = added.filter(function (a) { return a.kind === 'raster'; });
                // En ny bildkarta visas direkt som hybrid, annars händer inget synligt.
                if (images.length && basemap === 'map') basemap = 'hybrid';
                applyStyle();
                if (!images.length) setStatus('Filen innehåller en vektorkarta, inte bilder. Den används som karta.', 'offline');
            }).catch(function (err) {
                setStatus('Bildkartan kunde inte läsas: ' + (err && err.message ? err.message : err), 'missing');
            });
        });
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
        function useChosenFiles(files) {
            var tiles = Array.prototype.filter.call(files || [], function (file) {
                return /\.pmtiles$/i.test(file.name);
            });
            if (!tiles.length) {
                setStatus('Mappen behöver innehålla world.pmtiles och sweden.pmtiles.', 'missing');
                return;
            }
            start().then(function () { return openFiles(tiles); }).then(function () {
                if (!online) applyStyle();
                updateStatus();
            }).catch(function (err) {
                setStatus('Kartfilerna kunde inte läsas: ' + (err && err.message ? err.message : err), 'missing');
            });
        }
        el.pickDir.addEventListener('click', function () {
            // Alltid en mappdialog, i samma klick. En filväljare som reserv
            // gjorde att Windows bara lät användaren markera en fil.
            el.dirInput.click();
        });
        el.pick.addEventListener('click', function () { el.input.click(); });
        el.dirInput.addEventListener('change', function () {
            var snapshot = Array.prototype.slice.call(el.dirInput.files || []);
            el.dirInput.value = '';
            useChosenFiles(snapshot);
        });
        el.input.addEventListener('change', function () {
            var snapshot = Array.prototype.slice.call(el.input.files || []);
            el.input.value = '';
            useChosenFiles(snapshot);
        });

        var TOGGLES = ['route', 'perDevice'];

        function standardFromLegacy(toggles) {
            toggles = toggles || {};
            var cfg = root.MapCore.defaultBubble({
                thumb: toggles.bubbleThumb, time: toggles.bubbleTime, name: toggles.bubbleName,
                device: toggles.bubbleDevice, app: toggles.bubbleApp, pos: toggles.bubblePos,
                accuracy: toggles.bubbleAccuracy, note: toggles.bubbleNote, titles: toggles.bubbleTitles,
            });
            cfg.leader = !!toggles.bubbleLeaders;
            cfg.ring = !!toggles.accuracy;
            return cfg;
        }

        // Onlinekartan sparas inte: den kräver ett nytt samtycke varje gång.
        function getState() {
            var toggles = {};
            TOGGLES.forEach(function (key) { toggles[key] = el[key].checked; });
            return {
                view: map ? {
                    center: map.getCenter().toArray(), zoom: map.getZoom(),
                    bearing: map.getBearing(), pitch: map.getPitch(),
                } : null,
                toggles: toggles,
                numbers: el.numbers.value,
                basemap: basemap,
                routes: namedRoutes,
                bubbleScale: bubbleScale,
                bubbleOffset: bubbleOffset,
                bubbleStandard: cloneBubble(standardCfg),
                bubbleCfg: bubbleCfg,
                excluded: excluded,
                hidden: hidden,
                notes: notes,
                listOpen: listOpen,
                listInView: listInView,
            };
        }

        function setState(state) {
            state = state || {};
            var toggles = state.toggles || {};
            TOGGLES.forEach(function (key) {
                if (typeof toggles[key] === 'boolean') el[key].checked = toggles[key];
            });
            if (['all', 'route', 'none'].indexOf(state.numbers) >= 0) el.numbers.value = state.numbers;
            if (Array.isArray(state.routes)) useNamedRoutes(state.routes);
            // Valet sparas även om bildkartan inte är öppnad än. Stilen faller då tillbaka till kartan.
            var keys = root.MapCore.BASEMAPS.map(function (b) { return b.key; });
            if (keys.indexOf(state.basemap) >= 0 && state.basemap !== basemap) {
                basemap = state.basemap;
                if (map) applyStyle();
                else updateBasemap();
            }
            var obj = function (v) { return v && typeof v === 'object' ? Object.assign({}, v) : {}; };
            bubbleScale = Math.min(2, Math.max(0.75, Number(state.bubbleScale) || 1));
            bubbleOffset = obj(state.bubbleOffset);
            standardCfg = state.bubbleStandard && state.bubbleStandard.items
                ? cloneBubble(state.bubbleStandard) : standardFromLegacy(toggles);
            bubbleCfg = obj(state.bubbleCfg);
            excluded = obj(state.excluded);
            hidden = obj(state.hidden);
            notes = obj(state.notes);
            picked = {};
            listInView = !!state.listInView;
            closeEditor(false);
            closePopup();
            updateBubbleNote();
            setList(!!state.listOpen);
            routeChanged();
            var view = state.view;
            if (!view || !Array.isArray(view.center)) return Promise.resolve();
            fittedOnce = true;
            return start().then(function () {
                map.resize();
                map.jumpTo({ center: view.center, zoom: view.zoom, bearing: view.bearing || 0, pitch: view.pitch || 0 });
            });
        }

        return {
            getState: getState,
            setState: setState,
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
            resize: function () { if (map) map.resize(); },
            setNamedRoutes: function (list) {
                useNamedRoutes(list);
                routeChanged();
            },
            idsInRange: function (from, to) {
                return points.filter(function (p) {
                    var n = numberById[p.id];
                    return n >= from && n <= to;
                }).map(function (p) { return p.id; });
            },
            editBubbles: function (ids, title) { openEditor(ids, title); },
            mark: function (ids) { markPoints(ids); },
            setBubbles: function (standard, perPoint, offsets) {
                if (standard) standardCfg = cloneBubble(standard);
                Object.keys(perPoint || {}).forEach(function (id) {
                    bubbleCfg[id] = cloneBubble(perPoint[id]);
                });
                Object.keys(offsets || {}).forEach(function (id) { bubbleOffset[id] = offsets[id]; });
                if (map && map.getSource('files')) refreshData();
                else updateBubbleNote();
            },
            fitView: function () {
                return start().then(function () {
                    map.resize();
                    fittedOnce = true;
                    fit();
                    syncBubbles();
                });
            },
            numberSpan: function () {
                var min = 0;
                var max = 0;
                points.forEach(function (p) {
                    var n = numberById[p.id];
                    if (!n) return;
                    if (!min || n < min) min = n;
                    if (n > max) max = n;
                });
                return min ? { first: min, last: max } : null;
            },
            openList: openList,
            onlineHost: ONLINE.host,
        };
    }

    root.ToolboxMap = { create: create };
    root.ExifMap = root.ToolboxMap;
})(window);
