// Kartlogik utan DOM: vilka filer som har position, rutt i tidsordning och export till
// KML och GeoJSON. Testas i Node.
(function (root) {
    'use strict';

    function str(v) { return v === undefined || v === null ? '' : String(v); }

    // Filer med position. 0,0 är nästan alltid en tom GPS-tagg och ritas inte.
    function points(rows) {
        var out = [];
        rows.forEach(function (r) {
            var s = r.summary;
            if (!s || !s.position || s.position.zero) return;
            out.push({
                id: r.id,
                path: r.path,
                name: r.name,
                lat: s.position.lat,
                lon: s.position.lon,
                accuracy: s.position.accuracy || null,
                source: s.position.source,
                taken: s.taken || null,
                device: s.device ? s.device.text : '',
                app: s.appHit ? s.appHit.name : '',
                software: s.software ? s.software.text : '',
                type: s.type || '',
                mime: s.mime || '',
            });
        });
        return out;
    }

    function zoneMinutes(zone) {
        if (zone === 'UTC') return 0;
        var m = /^([+\-])(\d{2}):?(\d{2})$/.exec(zone || '');
        if (!m) return null;
        return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
    }

    // "2024-06-01 14:34:56.5" i angiven zon -> millisekunder UTC. null om tiden inte går att läsa.
    function instant(sort, zone) {
        var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d+)?/.exec(sort || '');
        if (!m) return null;
        var ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]),
            m[7] ? Math.round(Number(m[7]) * 1000) : 0);
        var off = zoneMinutes(zone);
        return ms - (off || 0) * 60000;
    }

    // Rutt i tidsordning. Tider med tidszon jämförs som verklig tidpunkt, så att en
    // QuickTime-tid i UTC hamnar rätt mot en bild i lokal tid. Tider utan zon tolkas i
    // den zon som är vanligast bland filerna, och räknas i assumed.
    function route(list) {
        var counts = {};
        list.forEach(function (p) {
            if (p.taken && p.taken.zone && zoneMinutes(p.taken.zone) !== null) counts[p.taken.zone] = (counts[p.taken.zone] || 0) + 1;
        });
        var assumedZone = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); })[0] || '';
        var assumed = 0;
        var untimed = 0;
        var timed = [];
        list.forEach(function (p) {
            var t = p.taken;
            var zone = t && t.zone && zoneMinutes(t.zone) !== null ? t.zone : '';
            var at = t ? instant(t.sort, zone || assumedZone) : null;
            if (at === null) { untimed++; return; }
            if (!zone) assumed++;
            timed.push({ point: p, at: at, assumed: !zone });
        });
        timed.sort(function (a, b) { return a.at - b.at || a.point.path.localeCompare(b.point.path); });
        var result = {
            steps: timed.map(function (t, i) { return { point: t.point, at: t.at, assumed: t.assumed, index: i + 1 }; }),
            assumedZone: assumedZone,
            assumed: assumed,
            untimed: untimed,
        };
        return enrich(result);
    }

    function haversine(a, b) {
        var R = 6371000;
        var p1 = a.lat * Math.PI / 180;
        var p2 = b.lat * Math.PI / 180;
        var dp = (b.lat - a.lat) * Math.PI / 180;
        var dl = (b.lon - a.lon) * Math.PI / 180;
        var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    function formatDistance(meters) {
        if (meters < 1000) return Math.round(meters) + ' m';
        return (meters / 1000).toFixed(1).replace('.', ',') + ' km';
    }

    // Ring runt en punkt, i meter. EXIF utan noggrannhet ritas inte.
    function circlePolygon(lon, lat, meters, steps) {
        steps = steps || 64;
        var coords = [];
        var latRad = lat * Math.PI / 180;
        var i;
        for (i = 0; i <= steps; i++) {
            var bearing = (i / steps) * 2 * Math.PI;
            var dx = meters * Math.sin(bearing);
            var dy = meters * Math.cos(bearing);
            var dLat = (dy / 6371000) * (180 / Math.PI);
            var dLon = (dx / (6371000 * Math.cos(latRad))) * (180 / Math.PI);
            coords.push([lon + dLon, lat + dLat]);
        }
        return coords;
    }

    function formatDuration(seconds) {
        seconds = Math.max(0, Math.round(seconds));
        var m = Math.floor(seconds / 60);
        var h = Math.floor(m / 60);
        m %= 60;
        if (h && m) return h + ' h ' + m + ' min';
        if (h) return h + ' h';
        if (m) return m + ' min';
        return seconds + ' s';
    }

    // Steg under 200 m räknas inte som orimliga: GPS kan hoppa så mycket.
    function enrich(r) {
        var maxKmh = 250;
        var minJump = 200;
        var gapMs = 3 * 3600000;
        var total = 0;
        var implausible = 0;
        r.steps.forEach(function (s, i) {
            if (!i) { s.fromPrev = null; s.trip = 1; return; }
            var prev = r.steps[i - 1];
            var meters = haversine(prev.point, s.point);
            var seconds = (s.at - prev.at) / 1000;
            var kmh = seconds > 0 ? (meters / 1000) / (seconds / 3600) : (meters > 0 ? Infinity : 0);
            var bad = meters >= minJump && kmh > maxKmh;
            if (bad) implausible++;
            s.fromPrev = { meters: meters, seconds: seconds, kmh: kmh, implausible: bad };
            if (s.at - prev.at <= gapMs) total += meters;
        });
        var trips = [];
        var cur = null;
        r.steps.forEach(function (s, i) {
            var gap = i > 0 && s.at - r.steps[i - 1].at > gapMs;
            if (!cur || gap) {
                cur = { index: trips.length + 1, steps: [], meters: 0, from: s.at, to: s.at };
                trips.push(cur);
            }
            s.trip = cur.index;
            cur.steps.push(s);
            cur.to = s.at;
            if (s.fromPrev && !gap) cur.meters += s.fromPrev.meters;
        });
        r.trips = trips;
        r.totalMeters = total;
        r.implausible = implausible;
        r.stays = staysOf(r.steps);
        return r;
    }

    function staysOf(steps) {
        var stays = [];
        var i = 0;
        while (i < steps.length) {
            var j = i + 1;
            while (j < steps.length && haversine(steps[i].point, steps[j].point) <= 100) j++;
            if (j - i >= 2 && steps[j - 1].at - steps[i].at >= 5 * 60000) {
                stays.push({
                    from: steps[i].at, to: steps[j - 1].at, count: j - i,
                    lat: steps[i].point.lat, lon: steps[i].point.lon,
                    names: steps.slice(i, j).map(function (s) { return s.point.name; }),
                });
                i = j;
            } else i++;
        }
        return stays;
    }

    // En heldragen linje per färg. Ett uppehåll får inte klippa linjen: då försvinner
    // sträckan över vattnet och samma enhet ser ut som flera rutter.
    function routeLines(r, color) {
        var steps = (r && r.steps) || [];
        var lines = [];
        var bad = [];
        if (steps.length < 2) return { lines: lines, bad: bad };
        function tripOf(step) {
            var found = null;
            (r.trips || []).forEach(function (t) { if (t.index === step.trip) found = t; });
            return found;
        }
        function colorOf(step) {
            var trip = tripOf(step);
            return (trip && trip.color) || color;
        }
        var run = [steps[0]];
        var runColor = colorOf(steps[0]);
        function flush() {
            if (run.length > 1) {
                lines.push({ color: runColor, coordinates: run.map(function (s) { return [s.point.lon, s.point.lat]; }) });
                for (var i = 1; i < run.length; i++) {
                    if (run[i].fromPrev && run[i].fromPrev.implausible) {
                        bad.push([[run[i - 1].point.lon, run[i - 1].point.lat], [run[i].point.lon, run[i].point.lat]]);
                    }
                }
            }
            run = [];
        }
        for (var i = 1; i < steps.length; i++) {
            var next = colorOf(steps[i]);
            if (next !== runColor) { flush(); run = [steps[i]]; runColor = next; }
            else run.push(steps[i]);
        }
        flush();
        return { lines: lines, bad: bad };
    }

    function routesBy(list, field) {
        var groups = {};
        var order = [];
        list.forEach(function (p) {
            var key = str(p[field]).trim() || 'Okänd';
            if (!groups[key]) { groups[key] = []; order.push(key); }
            groups[key].push(p);
        });
        return order.map(function (name) { return { name: name, route: route(groups[name]) }; });
    }

    // Närmaste punkt före och efter t, och en rak uppskattning mellan dem.
    function positionAt(r, t) {
        var steps = r.steps;
        if (!steps.length) return null;
        if (t <= steps[0].at) return { at: t, before: steps[0], after: null, interpolated: false, lat: steps[0].point.lat, lon: steps[0].point.lon };
        var last = steps[steps.length - 1];
        if (t >= last.at) return { at: t, before: last, after: null, interpolated: false, lat: last.point.lat, lon: last.point.lon };
        for (var i = 1; i < steps.length; i++) {
            if (steps[i].at < t) continue;
            var a = steps[i - 1];
            var b = steps[i];
            var f = (t - a.at) / (b.at - a.at);
            return {
                at: t, before: a, after: b, interpolated: true,
                lat: a.point.lat + (b.point.lat - a.point.lat) * f,
                lon: a.point.lon + (b.point.lon - a.point.lon) * f,
            };
        }
        return null;
    }

    function simplify(coords, tolerance) {
        if (coords.length <= 2) return coords;
        function dmax(start, end) {
            var ax = coords[start][0], ay = coords[start][1], bx = coords[end][0], by = coords[end][1];
            var best = 0;
            var idx = start;
            for (var i = start + 1; i < end; i++) {
                var dx = bx - ax, dy = by - ay;
                var len = Math.sqrt(dx * dx + dy * dy) || 1;
                var dist = Math.abs(dy * coords[i][0] - dx * coords[i][1] + bx * ay - by * ax) / len;
                if (dist > best) { best = dist; idx = i; }
            }
            return { dist: best, idx: idx };
        }
        var keep = {};
        keep[0] = true;
        keep[coords.length - 1] = true;
        var stack = [[0, coords.length - 1]];
        while (stack.length) {
            var span = stack.pop();
            var hit = dmax(span[0], span[1]);
            if (hit.dist > tolerance) {
                keep[hit.idx] = true;
                stack.push([span[0], hit.idx], [hit.idx, span[1]]);
            }
        }
        return coords.filter(function (_, i) { return keep[i]; });
    }

    function isoTime(taken) {
        if (!taken || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(taken.sort || '')) return '';
        var base = taken.sort.replace(' ', 'T');
        if (taken.zone === 'UTC') return base + 'Z';
        var m = /^([+\-]\d{2}):?(\d{2})$/.exec(taken.zone || '');
        return m ? base + m[1] + ':' + m[2] : base;
    }

    function xml(s) {
        return str(s).replace(/[<>&"']/g, function (c) {
            return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c];
        }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    }

    function describe(p) {
        return [
            p.path,
            p.taken ? (p.taken.kind + ': ' + p.taken.text + ' (' + p.taken.source + ')') : 'Ingen tid i filen',
            p.device ? 'Enhet: ' + p.device : '',
            p.software ? 'Programvara: ' + p.software : '',
            'Position: ' + p.lat + ', ' + p.lon + ' (' + p.source + ')',
        ].filter(Boolean).join('\n');
    }

    function fields(p, step) {
        return {
            sokvag: p.path,
            tid: p.taken ? p.taken.text : '',
            tid_typ: p.taken ? p.taken.kind : '',
            tid_kalla: p.taken ? p.taken.source : '',
            tidszon_antagen: step && step.assumed ? 'ja' : '',
            ordning: step ? String(step.index) : '',
            enhet: p.device,
            programvara: p.software,
            filtyp: p.type,
            position_kalla: p.source,
        };
    }

    function stepMap(r) {
        var byId = {};
        r.steps.forEach(function (s) { byId[s.point.id] = s; });
        return byId;
    }

    function toKml(list, meta) {
        meta = meta || {};
        var r = route(list);
        var steps = stepMap(r);
        var out = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<kml xmlns="http://www.opengis.net/kml/2.2">',
            '<Document>',
            '<name>' + xml(meta.title || 'EXIF-visare') + '</name>',
            '<description>' + xml(meta.description || '') + '</description>',
            '<Style id="fil"><IconStyle><scale>0.8</scale></IconStyle></Style>',
            '<Style id="rutt"><LineStyle><color>ffd47a2b</color><width>3</width></LineStyle></Style>',
            '<Folder><name>Filer (' + list.length + ')</name>',
        ];
        list.forEach(function (p) {
            var when = isoTime(p.taken);
            var data = fields(p, steps[p.id]);
            out.push('<Placemark><name>' + xml(p.name) + '</name><styleUrl>#fil</styleUrl>'
                + (when ? '<TimeStamp><when>' + xml(when) + '</when></TimeStamp>' : '')
                + '<description>' + xml(describe(p)) + '</description><ExtendedData>'
                + Object.keys(data).map(function (k) {
                    return '<Data name="' + k + '"><value>' + xml(data[k]) + '</value></Data>';
                }).join('')
                + '</ExtendedData><Point><coordinates>' + p.lon + ',' + p.lat + '</coordinates></Point></Placemark>');
        });
        out.push('</Folder>');
        var trips = r.trips && r.trips.length ? r.trips : [];
        var lines = trips.filter(function (t) { return t.steps.length > 1; });
        if (lines.length) {
            out.push('<Folder><name>Rutt i tidsordning (' + r.steps.length + ' punkter)</name>');
            lines.forEach(function (trip) {
                var begin = isoTime(trip.steps[0].point.taken);
                var end = isoTime(trip.steps[trip.steps.length - 1].point.taken);
                out.push('<Placemark><name>Tur ' + trip.index + '</name><styleUrl>#rutt</styleUrl>'
                    + '<description>' + xml(routeNote(r) + ' ' + routeSummary(r)) + '</description>'
                    + (begin && end ? '<TimeSpan><begin>' + xml(begin) + '</begin><end>' + xml(end) + '</end></TimeSpan>' : '')
                    + '<LineString><tessellate>1</tessellate><coordinates>'
                    + trip.steps.map(function (s) { return s.point.lon + ',' + s.point.lat; }).join(' ')
                    + '</coordinates></LineString></Placemark>');
            });
            out.push('</Folder>');
        }
        out.push('</Document>', '</kml>');
        return out.join('\n') + '\n';
    }

    function routeNote(r) {
        var parts = ['Ordnad efter tidpunkt.'];
        if (r.assumed) {
            parts.push(r.assumedZone
                ? r.assumed + ' filer saknar tidszon och tolkas som ' + r.assumedZone + ', den vanligaste bland filerna.'
                : 'Ingen fil har tidszon. Tiderna jämförs som de står i filerna.');
        }
        if (r.untimed) parts.push(r.untimed + ' filer saknar tid och ingår inte i rutten.');
        return parts.join(' ');
    }

    function routeSummary(r) {
        var parts = [];
        if (r.steps.length > 1) {
            var span = (r.steps[r.steps.length - 1].at - r.steps[0].at) / 1000;
            parts.push('Rutt: ' + r.steps.length + ' punkter, ' + formatDistance(r.totalMeters) + ', ' + formatDuration(span) + '.');
        }
        if (r.trips && r.trips.length > 1) parts.push(r.trips.length + ' turer, åtskilda av uppehåll över 3 timmar.');
        if (r.implausible) parts.push(r.implausible + ' förflyttningar är orimligt snabba — kontrollera tid eller position.');
        if (r.stays && r.stays.length) parts.push(r.stays.length + (r.stays.length === 1 ? ' vistelse.' : ' vistelser.'));
        return parts.join(' ');
    }

    function legText(leg) {
        if (!leg) return '';
        var text = 'Från föregående: ' + formatDistance(leg.meters) + ' på ' + formatDuration(leg.seconds);
        if (leg.seconds > 0 && isFinite(leg.kmh)) text += ' (' + leg.kmh.toFixed(1).replace('.', ',') + ' km/h)';
        if (leg.implausible) text += '. Orimligt snabb förflyttning';
        return text;
    }

    function toGeoJson(list, meta) {
        var r = route(list);
        var steps = stepMap(r);
        var features = list.map(function (p) {
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
                properties: fields(p, steps[p.id]),
            };
        });
        if (r.steps.length > 1) {
            features.push({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: r.steps.map(function (s) { return [s.point.lon, s.point.lat]; }) },
                properties: { typ: 'rutt', punkter: r.steps.length, beskrivning: routeNote(r) },
            });
        }
        var fc = { type: 'FeatureCollection', features: features };
        if (meta) fc.metadata = meta;
        return JSON.stringify(fc, null, 2) + '\n';
    }

    function toGpx(list, meta) {
        meta = meta || {};
        var r = route(list);
        var out = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<gpx version="1.1" creator="Forensics Toolbox" xmlns="http://www.topografix.com/GPX/1/1">',
            '<metadata><name>' + xml(meta.title || 'Positioner') + '</name></metadata>',
            '<trk><name>Rutt</name>',
        ];
        (r.trips.length ? r.trips : [{ steps: r.steps }]).forEach(function (trip) {
            if (trip.steps.length < 2) return;
            out.push('<trkseg>');
            trip.steps.forEach(function (s) {
                var when = isoTime(s.point.taken);
                out.push('<trkpt lat="' + s.point.lat + '" lon="' + s.point.lon + '"><name>' + xml(s.point.name) + '</name>'
                    + (when ? '<time>' + xml(when) + '</time>' : '') + '</trkpt>');
            });
            out.push('</trkseg>');
        });
        out.push('</trk>', '</gpx>');
        return out.join('\n') + '\n';
    }

    // Bubblans rader. Miniatyren ligger först som standard, eftersom den alltid har gjort det.
    var BUBBLE_FIELDS = [
        { key: 'thumb', label: 'Miniatyr' },
        { key: 'time', label: 'Tid' },
        { key: 'name', label: 'Filnamn' },
        { key: 'device', label: 'Enhet' },
        { key: 'app', label: 'App' },
        { key: 'pos', label: 'Longitud/latitud' },
        { key: 'accuracy', label: 'Noggrannhet' },
        { key: 'note', label: 'Händelse' },
    ];

    function fieldLabel(key) {
        var f = BUBBLE_FIELDS.filter(function (x) { return x.key === key; })[0];
        return f ? f.label : '';
    }

    function fieldValue(p, key, note) {
        if (key === 'time') return p.taken ? p.taken.text : '';
        if (key === 'name') return str(p.name);
        if (key === 'device') return str(p.device);
        if (key === 'app') return str(p.app);
        if (key === 'pos') return p.lon.toFixed(5) + ', ' + p.lat.toFixed(5);
        if (key === 'accuracy') return p.accuracy > 0 ? Math.round(p.accuracy) + ' m' : '';
        if (key === 'note') return str(note);
        return '';
    }

    // Panelens kryssrutor ({ time: true, titles: false, … }) som bubbelinställning.
    function defaultBubble(flags) {
        flags = flags || {};
        return {
            titles: !!flags.titles,
            items: BUBBLE_FIELDS.map(function (f) { return { key: f.key, on: !!flags[f.key], label: '' }; }),
        };
    }

    // Bubblans innehåll i vald ordning: { thumb: true } eller { text, heading }.
    // En egen titel visas alltid. En egen rad med bara titel blir en rubrik.
    function bubbleParts(p, cfg, note) {
        var out = [];
        (cfg.items || []).forEach(function (item) {
            if (!item.on) return;
            if (item.key === 'thumb') { out.push({ thumb: true }); return; }
            var label = str(item.label).trim();
            if (item.key === 'custom') {
                var text = str(item.value).trim();
                if (!label && !text) return;
                out.push(text ? { text: label ? label + ': ' + text : text } : { text: label, heading: true });
                return;
            }
            var value = fieldValue(p, item.key, note);
            if (!value) return;
            if (label) out.push({ text: label + ': ' + value });
            else out.push({ text: cfg.titles ? fieldLabel(item.key) + ': ' + value : value });
        });
        return out;
    }

    // Källan en punkt kom från: lagret i Positioner, annars översta mappen i sökvägen.
    function sourceOf(p) {
        if (p.layer) return str(p.layer);
        var path = str(p.path);
        var cut = path.indexOf('/');
        return cut > 0 ? path.slice(0, cut) : '';
    }

    // Ett fast nummer per punkt i tidsordning, så att kartan och listan går att para ihop och
    // så att "punkt 7" betyder samma sak även när punkter tas ur rutten. Utan tid kommer sist.
    function numberPoints(list, steps) {
        var numbers = {};
        var inRoute = {};
        var n = 0;
        (steps || []).forEach(function (s) { inRoute[s.point.id] = true; });
        list.map(function (p, i) { return { p: p, i: i, t: p.taken && p.taken.sort ? p.taken.sort : '' }; })
            .sort(function (a, b) {
                if (a.t !== b.t) {
                    if (!a.t) return 1;
                    if (!b.t) return -1;
                    return a.t < b.t ? -1 : 1;
                }
                return a.i - b.i;
            })
            .forEach(function (x) { if (!numbers[x.p.id]) numbers[x.p.id] = ++n; });
        return { numbers: numbers, inRoute: inRoute };
    }

    var api = {
        numberPoints: numberPoints,
        BUBBLE_FIELDS: BUBBLE_FIELDS,
        defaultBubble: defaultBubble,
        bubbleParts: bubbleParts,
        sourceOf: sourceOf,
        points: points,
        route: route,
        routesBy: routesBy,
        routeLines: routeLines,
        routeNote: routeNote,
        routeSummary: routeSummary,
        legText: legText,
        positionAt: positionAt,
        haversine: haversine,
        circlePolygon: circlePolygon,
        simplify: simplify,
        formatDistance: formatDistance,
        formatDuration: formatDuration,
        instant: instant,
        isoTime: isoTime,
        toKml: toKml,
        toGeoJson: toGeoJson,
        toGpx: toGpx,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.MapCore = api;
})(typeof window !== 'undefined' ? window : this);
