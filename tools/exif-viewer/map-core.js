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
                source: s.position.source,
                taken: s.taken || null,
                device: s.device ? s.device.text : '',
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
        return {
            steps: timed.map(function (t, i) { return { point: t.point, at: t.at, assumed: t.assumed, index: i + 1 }; }),
            assumedZone: assumedZone,
            assumed: assumed,
            untimed: untimed,
        };
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
        if (r.steps.length > 1) {
            out.push('<Folder><name>Rutt i tidsordning (' + r.steps.length + ' punkter)</name><Placemark><name>Rutt</name>'
                + '<styleUrl>#rutt</styleUrl><description>' + xml(routeNote(r)) + '</description>'
                + '<LineString><tessellate>1</tessellate><coordinates>'
                + r.steps.map(function (s) { return s.point.lon + ',' + s.point.lat; }).join(' ')
                + '</coordinates></LineString></Placemark></Folder>');
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

    var api = {
        points: points,
        route: route,
        routeNote: routeNote,
        instant: instant,
        isoTime: isoTime,
        toKml: toKml,
        toGeoJson: toGeoJson,
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.MapCore = api;
})(typeof window !== 'undefined' ? window : this);
