// Tolkar positioner från GPX, KML, GeoJSON, CSV, Google-tidslinje och inklistrad text.
// Ingen DOM och inget nätverk. Punkterna har samma form som MapCore.route väntar sig.
(function (root) {
    'use strict';

    function str(v) { return v === undefined || v === null ? '' : String(v).trim(); }

    function num(v) {
        var s = str(v).replace(/\s/g, '').replace(',', '.');
        if (!s || !/^[+\-]?\d+(\.\d+)?$/.test(s)) return null;
        var n = Number(s);
        return isFinite(n) ? n : null;
    }

    function valid(lat, lon) {
        return lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
    }

    function takenFrom(value) {
        if (value === undefined || value === null || value === '') return null;
        var raw = str(value);
        if (/^\d{10,13}$/.test(raw)) {
            var n = Number(raw);
            if (n < 1e11) n *= 1000;
            var d = new Date(n);
            if (isNaN(d.getTime())) return null;
            var sort = d.toISOString().slice(0, 19).replace('T', ' ');
            return { sort: sort, zone: 'UTC', text: sort + ' UTC', kind: 'Tid', source: 'import' };
        }
        var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+\-]\d{2}:?\d{2})?/.exec(raw);
        if (!m) return null;
        var zone = '';
        if (m[7] === 'Z') zone = 'UTC';
        else if (m[7]) zone = m[7].replace(/([+\-]\d{2})(\d{2})$/, '$1:$2').replace(/([+\-]\d{2})$/, '$1:00');
        var sort = m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + (m[6] || '00');
        return { sort: sort, zone: zone, text: sort + (zone ? ' ' + zone : ''), kind: 'Tid', source: 'import' };
    }

    function makePoint(part) {
        return {
            id: part.id, path: part.path || part.name || '', name: part.name || 'Punkt',
            lat: part.lat, lon: part.lon, source: part.source || 'import',
            taken: part.taken || null, device: part.device || '', software: '',
            type: part.type || '', mime: '', layer: part.layer || '', accuracy: part.accuracy || null,
        };
    }

    function parseXml(xml) {
        var s = String(xml).replace(/<\?xml[\s\S]*?\?>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
        var rootEl = { name: '#root', attrs: {}, children: [], text: '' };
        var stack = [rootEl];
        var re = /<([\/!]?)([\w:.-]+)([^>]*?)(\/?)>/g;
        var last = 0;
        var m;
        while ((m = re.exec(s))) {
            var parent = stack[stack.length - 1];
            parent.text += s.slice(last, m.index);
            last = re.lastIndex;
            if (m[1] === '!') continue;
            var name = m[2].split(':').pop();
            if (m[1] === '/') { if (stack.length > 1) stack.pop(); continue; }
            var attrs = {};
            m[3].replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g, function (_, k, v) { attrs[k.split(':').pop()] = v; });
            var el = { name: name, attrs: attrs, children: [], text: '' };
            parent.children.push(el);
            if (!m[4]) stack.push(el);
        }
        return rootEl;
    }

    function childText(el, name) {
        var c = el.children.filter(function (x) { return x.name === name; })[0];
        return c ? str(c.text) : '';
    }

    function walk(el, fn) {
        fn(el);
        el.children.forEach(function (c) { walk(c, fn); });
    }

    function collect(doc, names, read) {
        var points = [];
        var skipped = 0;
        var n = 0;
        walk(doc, function (el) {
            if (names.indexOf(el.name) < 0) return;
            var got = read(el);
            if (!got) { skipped++; return; }
            got.forEach(function (p) {
                if (!valid(p.lat, p.lon)) { skipped++; return; }
                n++;
                p.id = n;
                points.push(makePoint(p));
            });
        });
        return { points: points, skipped: skipped };
    }

    function parseGpx(xml) {
        return collect(parseXml(xml), ['trkpt', 'rtept', 'wpt'], function (el) {
            return [{
                lat: num(el.attrs.lat), lon: num(el.attrs.lon),
                name: childText(el, 'name') || el.name, taken: takenFrom(childText(el, 'time')),
                source: 'GPX',
            }];
        });
    }

    function coordPair(text) {
        var bits = str(text).split(',');
        var lon = num(bits[0]);
        var lat = num(bits[1]);
        return { lat: lat, lon: lon };
    }

    function parseKml(xml) {
        return collect(parseXml(xml), ['Placemark', 'Track'], function (el) {
            if (el.name === 'Track') {
                var times = el.children.filter(function (c) { return c.name === 'when'; }).map(function (c) { return str(c.text); });
                var coords = el.children.filter(function (c) { return c.name === 'coord'; });
                return coords.map(function (c, i) {
                    var bits = str(c.text).split(/\s+/);
                    return { lon: num(bits[0]), lat: num(bits[1]), taken: takenFrom(times[i]), name: 'Spår', source: 'KML' };
                });
            }
            var point = el.children.filter(function (c) { return c.name === 'Point'; })[0];
            var line = el.children.filter(function (c) { return c.name === 'LineString'; })[0];
            var name = childText(el, 'name') || 'Plats';
            var when = childText(el, 'when') || childText((el.children.filter(function (c) { return c.name === 'TimeStamp'; })[0] || { children: [] }), 'when');
            if (point) {
                var p = coordPair(childText(point, 'coordinates'));
                return [{ lat: p.lat, lon: p.lon, name: name, taken: takenFrom(when), source: 'KML' }];
            }
            if (line) {
                return str(childText(line, 'coordinates')).split(/\s+/).filter(Boolean).map(function (pair, i) {
                    var p = coordPair(pair);
                    return { lat: p.lat, lon: p.lon, name: name + ' ' + (i + 1), source: 'KML' };
                });
            }
            return null;
        });
    }

    function geoTime(props) {
        props = props || {};
        return takenFrom(props.time || props.timestamp || props.tid || props.date || props.datetime);
    }

    function parseGeoJson(obj) {
        var features = obj.type === 'Feature' ? [obj] : (obj.features || []);
        var points = [];
        var skipped = 0;
        features.forEach(function (f) {
            var g = f.geometry || {};
            var coords = [];
            if (g.type === 'Point') coords = [g.coordinates];
            else if (g.type === 'MultiPoint' || g.type === 'LineString') coords = g.coordinates || [];
            else { skipped++; return; }
            coords.forEach(function (c, i) {
                var lat = num(c[1]);
                var lon = num(c[0]);
                if (!valid(lat, lon)) { skipped++; return; }
                var props = f.properties || {};
                points.push(makePoint({
                    id: points.length + 1, lat: lat, lon: lon,
                    name: props.name || props.sokvag || (g.type === 'LineString' ? 'Linje' : 'Punkt'),
                    path: props.sokvag || '', taken: geoTime(props), device: props.enhet || '',
                    source: 'GeoJSON',
                }));
            });
        });
        return { points: points, skipped: skipped };
    }

    function latLngText(text) {
        var m = /(-?\d+(?:[.,]\d+)?)\D+(-?\d+(?:[.,]\d+)?)/.exec(str(text).replace('geo:', ''));
        if (!m) return null;
        return { lat: num(m[1]), lon: num(m[2]) };
    }

    function parseRecords(list) {
        var points = [];
        var skipped = 0;
        (list || []).forEach(function (r) {
            var lat = r.latitudeE7 !== undefined ? r.latitudeE7 / 1e7 : num(r.latitude);
            var lon = r.longitudeE7 !== undefined ? r.longitudeE7 / 1e7 : num(r.longitude);
            if (!valid(lat, lon)) { skipped++; return; }
            points.push(makePoint({
                id: points.length + 1, lat: lat, lon: lon, name: 'Google',
                taken: takenFrom(r.timestamp || r.timestampMs), source: 'Google', accuracy: r.accuracy,
            }));
        });
        return { points: points, skipped: skipped };
    }

    function parseSemantic(list) {
        var points = [];
        var skipped = 0;
        (list || []).forEach(function (seg) {
            var loc = seg.visit && seg.visit.topCandidate && seg.visit.topCandidate.placeLocation;
            var text = loc && (loc.latLng || loc.centerLatE7);
            var pair = loc && loc.latLng ? latLngText(loc.latLng) : null;
            var path = seg.timelinePath && seg.timelinePath.points || [];
            if (pair && valid(pair.lat, pair.lon)) {
                points.push(makePoint({
                    id: points.length + 1, lat: pair.lat, lon: pair.lon, name: 'Vistelse',
                    taken: takenFrom(seg.startTime), source: 'Google',
                }));
            } else if (!path.length) skipped++;
            path.forEach(function (p) {
                var got = latLngText(p.point || p.latLng || '');
                if (!got || !valid(got.lat, got.lon)) { skipped++; return; }
                points.push(makePoint({
                    id: points.length + 1, lat: got.lat, lon: got.lon, name: 'Förflyttning',
                    taken: takenFrom(p.time || seg.startTime), source: 'Google',
                }));
            });
        });
        return { points: points, skipped: skipped };
    }

    function parseJson(obj) {
        if (!obj || typeof obj !== 'object') return { points: [], skipped: 0, error: 'Ogiltig JSON' };
        if (obj.type === 'FeatureCollection' || obj.type === 'Feature') return parseGeoJson(obj);
        if (obj.locations || obj.records) return parseRecords(obj.locations || obj.records);
        if (obj.semanticSegments) return parseSemantic(obj.semanticSegments);
        if (Array.isArray(obj)) return parseRecords(obj);
        return { points: [], skipped: 0, error: 'Okänt JSON-format' };
    }

    function splitRows(text) {
        var lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(function (l) { return str(l); });
        if (!lines.length) return { delim: ',', rows: [] };
        var sample = lines[0];
        var delim = '\t';
        if ((sample.match(/\t/g) || []).length === 0) {
            var commas = (sample.match(/,/g) || []).length;
            var semis = (sample.match(/;/g) || []).length;
            delim = semis > commas ? ';' : ',';
        }
        return {
            delim: delim,
            rows: lines.map(function (l) { return l.split(delim).map(function (c) { return c.trim().replace(/^"|"$/g, ''); }); }),
        };
    }

    var COLUMN_NAMES = {
        lat: [/^lat/i, /bredd/i, /latitude/i],
        lon: [/^lon/i, /^lng/i, /langd/i, /längd/i, /longitude/i],
        time: [/time/i, /timestamp/i, /datetime/i, /^tid$/i, /^date$/i],
        name: [/^name$/i, /label/i, /^namn$/i],
        accuracy: [/accur/i, /noggrann/i],
    };

    function guessColumns(headers) {
        var out = {};
        Object.keys(COLUMN_NAMES).forEach(function (key) {
            out[key] = headers.findIndex(function (h) {
                return COLUMN_NAMES[key].some(function (re) { return re.test(h); });
            });
        });
        return out;
    }

    function parseCsv(text, columns) {
        var table = splitRows(text);
        if (!table.rows.length) return { points: [], skipped: 0 };
        var headers = table.rows[0];
        var guessed = columns || guessColumns(headers);
        var data = table.rows.slice(1);
        if (guessed.lat < 0 || guessed.lon < 0) {
            return { points: [], skipped: data.length, headers: headers, preview: data.slice(0, 5), columns: guessed };
        }
        var sampleLat = num(data[0] && data[0][guessed.lat]);
        var sampleLon = num(data[0] && data[0][guessed.lon]);
        var swapped = false;
        if (sampleLat !== null && Math.abs(sampleLat) > 90 && sampleLon !== null && Math.abs(sampleLon) <= 90) {
            var tmp = guessed.lat;
            guessed.lat = guessed.lon;
            guessed.lon = tmp;
            swapped = true;
        }
        var points = [];
        var skipped = 0;
        data.forEach(function (row) {
            var lat = num(row[guessed.lat]);
            var lon = num(row[guessed.lon]);
            if (!valid(lat, lon)) { skipped++; return; }
            points.push(makePoint({
                id: points.length + 1, lat: lat, lon: lon,
                name: guessed.name >= 0 ? row[guessed.name] || 'Punkt' : 'Punkt',
                taken: guessed.time >= 0 ? takenFrom(row[guessed.time]) : null,
                accuracy: guessed.accuracy >= 0 ? num(row[guessed.accuracy]) : null,
                source: 'CSV',
            }));
        });
        return { points: points, skipped: skipped, headers: headers, columns: guessed, swapped: swapped };
    }

    function parsePasted(text) {
        var points = [];
        var skipped = 0;
        String(text).split(/\r?\n/).forEach(function (line) {
            if (!str(line)) return;
            var m = /(-?\d+[.,]\d+)\s*[, ]\s*(-?\d+[.,]\d+)\s*(.*)$/.exec(line.trim());
            if (!m) { skipped++; return; }
            var lat = num(m[1]);
            var lon = num(m[2]);
            if (!valid(lat, lon)) { skipped++; return; }
            var rest = str(m[3]);
            points.push(makePoint({
                id: points.length + 1, lat: lat, lon: lon, name: rest || 'Punkt',
                taken: takenFrom(rest), source: 'inklistrad',
            }));
        });
        return { points: points, skipped: skipped };
    }

    function parse(text, name) {
        var body = String(text || '').replace(/^\uFEFF/, '');
        var lower = str(name).toLowerCase();
        if (/<gpx[\s>]/i.test(body) || /\.gpx$/.test(lower)) return parseGpx(body);
        if (/<kml[\s>]/i.test(body) || /\.kml$/.test(lower)) return parseKml(body);
        if (/\.geojson$|\.json$/.test(lower) || /^\s*[\[{]/.test(body)) {
            try { return parseJson(JSON.parse(body)); }
            catch (e) { if (/\.json$|\.geojson$/.test(lower)) return { points: [], skipped: 0, error: 'Ogiltig JSON' }; }
        }
        if (/\.csv$|\.tsv$/.test(lower) || /lat|bredd|longitude/i.test(body.split(/\r?\n/)[0] || '')) return parseCsv(body);
        return parsePasted(body);
    }

    var api = { parse: parse, parseCsv: parseCsv, takenFrom: takenFrom, guessColumns: guessColumns };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.MapImport = api;
})(typeof window !== 'undefined' ? window : this);
