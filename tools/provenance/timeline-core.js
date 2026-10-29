// Kärnan i Härkomst: gör om rollqueryernas rader till en händelselista i UTC, avgör vilken
// sorts fil det är, bedömer de tre faktorerna (skapandetid, app igång, kamera igång) som
// stöd, motsägelse eller saknas, och skriver förklaringens meningar. Ingen DOM, ingen SQL.
// Bedömningen är hypotesstöd: "förenligt med", aldrig en slutsats. Testas i Node.
(function (root) {
    'use strict';

    var MINUTE = 60000;
    var TOLERANCE_MS = 5000;        // ett intervall "täcker" T med den här marginalen
    var SAME_TIME_MS = 60000;       // Skapad och Tillagd räknas som samtidiga inom en minut
    var LATE_MS = 3600000;          // Tillagd mer än en timme efter Skapad: kom till telefonen senare
    var MERGE_GAP_MS = 2000;        // täta händelser från samma app slås ihop i förklaringen

    var IOS_CAMERA = 'com.apple.camera';
    var IOS_SPRINGBOARD = 'com.apple.springboard';

    var STATE_LABEL = { support: 'Stöd', contradiction: 'Motsägelse', missing: 'Saknas', info: 'Upplysning', na: 'Inte tillämplig' };

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    // Fast förskjutning i minuter. Räcker inom ett fönster på några timmar; UI:t kan skicka
    // en egen formatterare med riktig zon.
    function formatWithOffset(ms, offsetMinutes) {
        var d = new Date(ms + (offsetMinutes || 0) * MINUTE);
        return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' +
            pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
    }

    function formatUtc(ms) { return formatWithOffset(ms, 0) + ' UTC'; }

    function duration(ms) {
        var s = Math.round(Math.abs(ms) / 1000);
        if (s < 60) return s + ' s';
        if (s < 3600) return Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
        if (s < 86400) return Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' min';
        return Math.floor(s / 86400) + ' dygn ' + Math.floor((s % 86400) / 3600) + ' h';
    }

    function lower(s) { return String(s == null ? '' : s).toLowerCase(); }

    // Intervallet kan vara en rad ({ startMs, endMs }) eller en händelse ({ ms, endMs }).
    function covers(iv, ms, tol) {
        tol = tol == null ? TOLERANCE_MS : tol;
        var start = iv.startMs != null ? iv.startMs : iv.ms;
        return start != null && iv.endMs != null && start - tol <= ms && iv.endMs + tol >= ms;
    }

    function isCameraApp(app, cameraApps) {
        if (!app) return false;
        if (app === IOS_CAMERA) return true;
        return (cameraApps || []).indexOf(app) >= 0;
    }

    // Appnamn i klartext via App-ID-katalogen, annars id:t.
    function appName(id, names) {
        if (!id) return 'okänd app';
        var n = names ? names(id) : null;
        return n || id;
    }

    // ---------- Typ av fil ----------

    // file: raden ur Photos.sqlite eller MediaStore med fältkartans namn.
    function classify(file, platform, opts) {
        opts = opts || {};
        var reasons = [];
        var flags = [];
        var type = 'unknown';
        var importer = file.importer || '';
        var importedBy = file.importedBy == null ? null : Number(file.importedBy);
        var rel = lower(file.relativePath);
        var name = lower(file.filename);
        if (platform === 'Android') {
            if (rel.indexOf('dcim/camera') === 0 || isCameraApp(importer, opts.cameraApps)) {
                type = 'camera';
                reasons.push(rel.indexOf('dcim/camera') === 0 ? 'relative_path börjar med DCIM/Camera' : 'owner_package_name är en kameraapp (' + importer + ')');
            } else if (rel.indexOf('screenshots') >= 0 || name.indexOf('screenshot') === 0) {
                type = 'screenshot';
                reasons.push(rel.indexOf('screenshots') >= 0 ? 'relative_path innehåller Screenshots' : 'filnamnet börjar med Screenshot');
            } else if (importer) {
                type = 'saved';
                reasons.push('owner_package_name är ' + importer);
            }
        } else {
            if (importedBy === 1 || importedBy === 2 || importer === IOS_CAMERA) {
                type = 'camera';
                reasons.push(importedBy === 1 || importedBy === 2 ? 'ZIMPORTEDBY ' + importedBy + ' (' + (importedBy === 1 ? 'bakre' : 'främre') + ' kameran enligt iLEAPP)' : 'skaparappen är com.apple.camera');
            } else if (importedBy === 8 || importer === IOS_SPRINGBOARD || Number(file.kindSubtype) === 10) {
                type = 'screenshot';
                if (importedBy === 8) reasons.push('ZIMPORTEDBY 8');
                if (importer === IOS_SPRINGBOARD) reasons.push('skaparappen är com.apple.springboard');
                if (Number(file.kindSubtype) === 10) reasons.push('ZKINDSUBTYPE 10');
            } else if (importedBy === 3 || importedBy === 6 || importedBy === 9 || importer) {
                type = 'saved';
                if (importedBy != null) reasons.push('ZIMPORTEDBY ' + importedBy);
                if (importer) reasons.push('skaparappen är ' + importer);
            }
        }
        // ZMODIFICATIONDATE ändras av mycket annat än redigering (favorit, album, synk), så bara
        // en redigeringsapp räknas som tecken på redigering. Ändrad-tiden visas ändå i tidslinjen.
        if (file.editor) flags.push('edited');
        if (file.addedMs && file.createdMs && file.addedMs - file.createdMs > LATE_MS) flags.push('received-later');
        if (Number(file.trashed) === 1) flags.push('trashed');
        if (Number(file.hidden) === 1) flags.push('hidden');
        var labels = { camera: 'Kamerabild', screenshot: 'Skärmdump', saved: 'Sparad ur en app', unknown: 'Okänd typ' };
        return { type: type, label: labels[type], reasons: reasons, flags: flags, importer: importer, importedBy: importedBy };
    }

    // ---------- Fönster ----------

    function windows(file, windowMs) {
        windowMs = windowMs || 15 * MINUTE;
        var out = [];
        if (file.createdMs) out.push({ id: 'created', label: 'när filen skapades', centerMs: file.createdMs, startMs: file.createdMs - windowMs, endMs: file.createdMs + windowMs });
        if (file.addedMs && (!file.createdMs || file.addedMs - file.createdMs > windowMs)) {
            out.push({ id: 'added', label: 'när filen kom till telefonen', centerMs: file.addedMs, startMs: file.addedMs - windowMs, endMs: file.addedMs + windowMs });
        }
        return out;
    }

    function unionRange(wins) {
        var s = Infinity, e = -Infinity;
        wins.forEach(function (w) { s = Math.min(s, w.startMs); e = Math.max(e, w.endMs); });
        return { startMs: s, endMs: e };
    }

    // ---------- Android: händelser -> intervall ----------

    // Wellbeing/UsageEvents: 1 RESUMED, 2 PAUSED, 23 STOPPED, 15/16 skärm, 17/18 låsskärm.
    // events: [{ ms, type, app }]. Returnerar { apps, screen, lock } i samma form som iOS-raderna.
    function intervalsFromEvents(events, rangeEndMs, source) {
        var open = {};
        var apps = [];
        var screen = [];
        var lock = [];
        var screenOn = null;
        var lockState = null;
        var sorted = events.slice().sort(function (a, b) { return a.ms - b.ms; });
        sorted.forEach(function (e) {
            var t = Number(e.type);
            if (t === 1) {
                if (open[e.app] == null) open[e.app] = e.ms;
            } else if (t === 2 || t === 23) {
                if (open[e.app] != null) {
                    apps.push({ startMs: open[e.app], endMs: e.ms, app: e.app, stream: 'wellbeing', source: source });
                    delete open[e.app];
                }
            } else if (t === 15 || t === 16) {
                if (screenOn) { screenOn.endMs = e.ms; screen.push(screenOn); screenOn = null; }
                screenOn = { startMs: e.ms, endMs: null, on: t === 15, stream: 'wellbeing', source: source };
            } else if (t === 17 || t === 18) {
                if (lockState) { lockState.endMs = e.ms; lock.push(lockState); lockState = null; }
                lockState = { startMs: e.ms, endMs: null, locked: t === 17, stream: 'wellbeing', source: source };
            }
        });
        Object.keys(open).forEach(function (app) { apps.push({ startMs: open[app], endMs: rangeEndMs, app: app, stream: 'wellbeing', source: source, openEnded: true }); });
        if (screenOn) { screenOn.endMs = rangeEndMs; screenOn.openEnded = true; screen.push(screenOn); }
        if (lockState) { lockState.endMs = rangeEndMs; lockState.openEnded = true; lock.push(lockState); }
        apps.sort(function (a, b) { return a.startMs - b.startMs; });
        return { apps: apps, screen: screen, lock: lock };
    }

    // Täta intervall från samma app slås ihop, så att förklaringen inte fylls av brus.
    function mergeIntervals(list, gapMs) {
        gapMs = gapMs == null ? MERGE_GAP_MS : gapMs;
        var out = [];
        list.slice().sort(function (a, b) { return a.startMs - b.startMs; }).forEach(function (iv) {
            var last = out[out.length - 1];
            if (last && last.app === iv.app && last.stream === iv.stream && iv.startMs - last.endMs <= gapMs) {
                last.endMs = Math.max(last.endMs, iv.endMs);
                last.merged = (last.merged || 1) + 1;
            } else {
                out.push(Object.assign({}, iv));
            }
        });
        return out;
    }

    // ---------- Händelselistan ----------

    function inRange(ms, range) { return ms != null && ms >= range.startMs && ms <= range.endMs; }

    function fileVerb(type, platform) {
        if (type === 'camera') return 'tas med kameran';
        if (type === 'screenshot') return 'tas';
        if (type === 'saved') return 'sparas';
        return 'skapas';
    }

    function fileNoun(type) { return type === 'screenshot' ? 'Skärmdumpen' : 'Bilden'; }

    function buildEvents(input, type, wins) {
        var file = input.file;
        var names = input.appNames;
        var range = unionRange(wins);
        var events = [];
        var outside = 0;
        var fileSrc = input.fileSource || {};

        function add(e) {
            if (e.ms == null) return;
            if (!inRange(e.ms, range) && !(e.endMs != null && e.endMs >= range.startMs && e.ms <= range.endMs)) { outside++; return; }
            events.push(e);
        }

        var noun = fileNoun(type.type);
        var created = { ms: file.createdMs, kind: 'file-created', lane: 'file', bold: true,
            text: 'Skapad (' + (input.platform === 'Android' ? 'datetaken' : 'ZDATECREATED') + ')',
            plain: noun + ' ' + file.filename + ' ' + fileVerb(type.type, input.platform) +
                (type.type === 'saved' && type.importer ? ' av ' + appName(type.importer, names) : ''),
            source: fileSrc };
        add(created);
        if (file.addedMs && Math.abs(file.addedMs - (file.createdMs || 0)) > TOLERANCE_MS) {
            add({ ms: file.addedMs, kind: 'file-added', lane: 'file', text: 'Tillagd i biblioteket (' + (input.platform === 'Android' ? 'date_added' : 'ZADDEDDATE') + ')',
                plain: noun + ' läggs till i ' + (input.platform === 'Android' ? 'galleriet' : 'Bilder'), source: fileSrc });
        }
        if (file.modifiedMs && Math.abs(file.modifiedMs - (file.createdMs || 0)) > TOLERANCE_MS && Math.abs(file.modifiedMs - (file.addedMs || 0)) > TOLERANCE_MS) {
            add({ ms: file.modifiedMs, kind: 'file-modified', lane: 'file', text: 'Ändrad (' + (input.platform === 'Android' ? 'date_modified' : 'ZMODIFICATIONDATE') + ')',
                plain: noun + ' ändras' + (file.editor ? ' av ' + appName(file.editor, names) : ''), source: fileSrc });
        }
        if (input.exif && input.exif.takenMs) {
            add({ ms: input.exif.takenMs, kind: 'exif', lane: 'file', text: 'EXIF i filen: ' + (input.exif.sourceTag || 'DateTimeOriginal') + ' ' + input.exif.takenText,
                plain: null, source: input.exif.source || { db: 'bildfilen', table: 'EXIF' } });
        }
        if (input.fileEntry && input.fileEntry.mtimeMs) {
            add({ ms: input.fileEntry.mtimeMs, kind: 'fs-mtime', lane: 'file', text: 'Filsystemets ändringstid enligt zippen', plain: null,
                source: { db: 'zippen', table: input.fileEntry.name, column: 'ändringstid' } });
        }
        if (input.pairedVideo && input.pairedVideo.takenMs) {
            add({ ms: input.pairedVideo.takenMs, kind: 'paired-video', lane: 'file', text: 'Live Photo-videon ' + input.pairedVideo.name + ' (QuickTime CreateDate, UTC)',
                plain: null, source: input.pairedVideo.source || { db: 'bildfilen', table: 'QuickTime' } });
        }

        (input.neighbours || []).forEach(function (n) {
            if (file.pk != null && n.pk === file.pk) return;
            if (n.filename === file.filename) return;
            var nType = classify(n, input.platform, input);
            add({ ms: n.createdMs, kind: 'neighbour', lane: 'file', text: 'Granne: ' + n.filename + (n.importer ? ' (' + n.importer + ')' : ''),
                plain: fileNoun(nType.type) + ' ' + n.filename + ' ' + fileVerb(nType.type, input.platform), neighbour: true, app: n.importer, source: input.neighbourSource || fileSrc });
        });

        var appIvs = mergeIntervals(input.appIntervals || []);
        appIvs.forEach(function (iv) {
            var name = appName(iv.app, names);
            var lane = isCameraApp(iv.app, input.cameraApps) ? 'camera' : 'app';
            add({ ms: iv.startMs, endMs: iv.endMs, kind: 'app', lane: lane, app: iv.app, stream: iv.stream, openEnded: iv.openEnded,
                text: name + ' igång (' + iv.stream + ')', plain: name + ' öppnas', plainEnd: name + ' lämnas', source: iv.source });
        });
        (input.screen || []).forEach(function (iv) {
            add({ ms: iv.startMs, endMs: iv.endMs, kind: 'screen', lane: 'screen', on: !!iv.on, stream: iv.stream, openEnded: iv.openEnded,
                text: iv.on ? 'Skärmen tänd' : 'Skärmen släckt', plain: iv.on ? 'Skärmen tänds' : 'Skärmen släcks', plainEnd: iv.on ? 'Skärmen släcks' : null, source: iv.source });
        });
        (input.lock || []).forEach(function (iv) {
            add({ ms: iv.startMs, endMs: iv.endMs, kind: 'lock', lane: 'lock', locked: !!iv.locked, stream: iv.stream, openEnded: iv.openEnded,
                text: iv.locked ? 'Telefonen låst' : 'Telefonen olåst', plain: iv.locked ? 'Telefonen låses' : 'Telefonen låses upp',
                plainEnd: iv.locked ? 'Telefonen låses upp' : 'Telefonen låses', source: iv.source });
        });
        (input.locations || []).forEach(function (p) {
            add({ ms: p.ms, kind: 'location', lane: 'location', lat: p.lat, lon: p.lon, accuracy: p.accuracy, locType: p.type,
                text: 'Position ' + p.lat.toFixed(5) + ', ' + p.lon.toFixed(5) + ' (±' + Math.round(p.accuracy) + ' m, ' + (p.type === 1 ? 'GNSS' : p.type === 4 ? 'Wi-Fi' : 'typ ' + p.type) + ')',
                plain: null, source: p.source || input.locationSource });
        });

        events.sort(function (a, b) { return a.ms - b.ms || (a.endMs || a.ms) - (b.endMs || b.ms); });
        events.forEach(function (e, i) { e.id = i + 1; });
        return { events: events, outside: outside };
    }

    // ---------- Bedömning ----------

    function coverageReason(key, coverage, missingDbs, ms, dbLabel) {
        if (missingDbs && missingDbs[key]) return dbLabel + ' finns inte i extraktionen.';
        var c = coverage && coverage[key];
        if (c && c.rows === 0) return dbLabel + ' har inga rader i strömmen.';
        if (c && c.firstMs != null && c.lastMs != null && (ms < c.firstMs || ms > c.lastMs)) {
            return 'Tidpunkten ligger utanför ' + dbLabel + ':s täckning (' + formatUtc(c.firstMs) + ' till ' + formatUtc(c.lastMs) + ').';
        }
        return 'Inga registreringar i tidsfönstret.';
    }

    function factorTime(input, type) {
        var file = input.file;
        var items = [];
        var state = 'missing';
        if (!file.createdMs) {
            return { id: 'time', title: 'Skapandetid', state: 'missing', items: ['Skapandetiden saknas i databasen.'],
                plain: 'Det går inte att se när filen skapades.' };
        }
        if (file.addedMs) {
            var diff = file.addedMs - file.createdMs;
            if (Math.abs(diff) <= SAME_TIME_MS) items.push({ state: 'support', text: 'Tillagd i biblioteket ' + duration(diff) + ' efter Skapad. Filen hamnade i biblioteket direkt när den skapades.' });
            else if (diff > LATE_MS) items.push({ state: 'contradiction', text: 'Tillagd i biblioteket ' + duration(diff) + ' efter Skapad. Filen kom till biblioteket långt efter att den skapades, vilket är vanligt för mottagna eller synkade bilder.' });
            else items.push({ state: 'info', text: 'Tillagd i biblioteket ' + duration(diff) + ' efter Skapad.' });
        } else {
            items.push({ state: 'info', text: 'Tiden då filen lades till i biblioteket saknas.' });
        }
        if (input.exif && input.exif.takenMs) {
            var ediff = input.exif.takenMs - file.createdMs;
            if (Math.abs(ediff) <= SAME_TIME_MS) items.push({ state: 'support', text: 'EXIF-tiden i själva filen (' + input.exif.takenText + ') stämmer med Skapad' + (Math.abs(ediff) > 1000 ? ' inom ' + duration(ediff) : '') + '.' });
            else items.push({ state: 'contradiction', text: 'EXIF-tiden i själva filen (' + input.exif.takenText + ') skiljer sig ' + duration(ediff) + ' från Skapad.' });
        } else if (input.exif && input.exif.read) {
            items.push({ state: 'info', text: 'Filen har ingen EXIF-tid' + (type.type === 'screenshot' ? ', vilket är normalt för en skärmdump' : '') + '.' });
        } else {
            items.push({ state: 'info', text: 'Själva filen lästes inte' + (input.fileMissingReason ? ': ' + input.fileMissingReason : '') + '.' });
        }
        if (input.exif && (input.exif.make || input.exif.model) && (file.cameraMake || file.cameraModel)) {
            var fileDev = lower((input.exif.make || '') + ' ' + (input.exif.model || '')).replace(/\s+/g, ' ').trim();
            var dbDev = lower((file.cameraMake || '') + ' ' + (file.cameraModel || '')).replace(/\s+/g, ' ').trim();
            if (fileDev === dbDev || fileDev.indexOf(dbDev) >= 0 || dbDev.indexOf(fileDev) >= 0) items.push({ state: 'support', text: 'Make/Model i filen (' + (input.exif.make || '') + ' ' + (input.exif.model || '') + ') stämmer med databasen.' });
            else items.push({ state: 'contradiction', text: 'Make/Model i filen (' + (input.exif.make || '') + ' ' + (input.exif.model || '') + ') skiljer sig från databasen (' + (file.cameraMake || '') + ' ' + (file.cameraModel || '') + ').' });
        }
        if (input.fileEntry && input.fileEntry.mtimeMs) {
            var fdiff = input.fileEntry.mtimeMs - file.createdMs;
            items.push({ state: Math.abs(fdiff) <= SAME_TIME_MS ? 'support' : 'info', text: 'Filsystemets ändringstid enligt zippen ligger ' + duration(fdiff) + (fdiff < 0 ? ' före' : ' efter') + ' Skapad.' });
        }
        if (items.some(function (i) { return i.state === 'contradiction'; })) state = 'contradiction';
        else if (items.some(function (i) { return i.state === 'support'; })) state = 'support';
        else state = 'info';
        var plain;
        if (state === 'support') plain = 'Tiderna hänger ihop: filen skapades och hamnade i biblioteket vid samma tid' + (input.exif && input.exif.takenMs ? ', och tiden inuti filen säger detsamma' : '') + '.';
        else if (state === 'contradiction') plain = 'Tiderna hänger inte ihop. ' + items.filter(function (i) { return i.state === 'contradiction'; }).map(function (i) { return i.text; }).join(' ');
        else plain = 'Tiderna går inte att kontrollera mot varandra.';
        return { id: 'time', title: 'Skapandetid', state: state, items: items, plain: plain };
    }

    // ---------- Positioner ----------

    function validCoord(lat, lon) {
        lat = Number(lat); lon = Number(lon);
        // Photos.sqlite skriver -180 när positionen saknas.
        return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) && lat !== -180;
    }

    function distanceM(a, b) {
        var R = 6371000;
        var p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
        var dp = (b.lat - a.lat) * Math.PI / 180, dl = (b.lon - a.lon) * Math.PI / 180;
        var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return 2 * R * Math.asin(Math.sqrt(h));
    }

    function metres(m) { return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km'; }

    // Alla positioner som hör till bedömningen: bildens egen enligt databasen, bildens enligt
    // EXIF i filen, och telefonens enligt routined. Avståndet räknas från bildens position.
    function positions(input) {
        var file = input.file;
        var out = [];
        var filePos = null;
        if (validCoord(file.latitude, file.longitude)) {
            filePos = { lat: Number(file.latitude), lon: Number(file.longitude) };
            out.push({ kind: 'file', ms: file.createdMs, lat: filePos.lat, lon: filePos.lon, accuracy: null, label: 'Bilden enligt databasen',
                source: input.fileSource ? Object.assign({}, input.fileSource, { column: input.platform === 'Android' ? 'latitude, longitude' : 'ZLATITUDE, ZLONGITUDE' }) : null });
        }
        var ex = input.exif && input.exif.position;
        if (ex && validCoord(ex.lat, ex.lon)) {
            var exPos = { lat: Number(ex.lat), lon: Number(ex.lon) };
            if (!filePos) filePos = exPos;
            out.push({ kind: 'exif', ms: file.createdMs, lat: exPos.lat, lon: exPos.lon, accuracy: ex.accuracy || null, label: 'Bilden enligt EXIF i filen',
                source: { db: 'bildfilen', table: file.filename, column: ex.source || 'GPS' } });
        }
        (input.locations || []).forEach(function (l) {
            out.push({ kind: 'phone', ms: l.ms, lat: l.lat, lon: l.lon, accuracy: l.accuracy, locType: l.type,
                label: 'Telefonen (' + (l.type === 1 ? 'GNSS' : l.type === 4 ? 'Wi-Fi' : 'typ ' + l.type) + ')', source: l.source || input.locationSource || null });
        });
        out.forEach(function (p) {
            p.distanceM = filePos && p.kind === 'phone' ? distanceM(filePos, p) : (p.kind === 'exif' && out[0].kind === 'file' ? distanceM(out[0], p) : null);
            p.offsetMs = file.createdMs != null && p.ms != null ? p.ms - file.createdMs : null;
        });
        return { list: out, filePos: filePos };
    }

    function factorPosition(input, pos) {
        var file = input.file;
        var phone = pos.list.filter(function (p) { return p.kind === 'phone'; });
        var items = [];
        var near = null;
        phone.forEach(function (p) { if (near === null || Math.abs(p.offsetMs) < Math.abs(near.offsetMs)) near = p; });
        if (!pos.filePos) {
            if (!phone.length) {
                return { id: 'position', title: 'Position', state: 'missing', items: [{ state: 'missing', text: 'Filen har ingen position, och telefonen har inga registrerade positioner i fönstret' + (input.missingDbs && input.missingDbs.routined ? ' (routined Cache.sqlite finns inte i extraktionen)' : '') + '.' }],
                    plain: 'Det finns ingen positionsuppgift, varken i bilden eller från telefonen.' };
            }
            return { id: 'position', title: 'Position', state: 'info', items: [{ state: 'info', text: 'Filen har ingen position. Telefonen registrerade ' + phone.length + (phone.length === 1 ? ' position' : ' positioner') + ' i fönstret, närmast ' + metres(0) .replace('0 m', '') + duration(near.offsetMs) + (near.offsetMs < 0 ? ' före' : ' efter') + ' bilden.' }],
                plain: 'Bilden saknar positionsuppgift. Telefonen registrerade var den var ' + duration(near.offsetMs) + (near.offsetMs < 0 ? ' före' : ' efter') + ' att bilden togs.' };
        }
        var exifRow = pos.list.filter(function (p) { return p.kind === 'exif' && p.distanceM != null; })[0];
        if (exifRow) items.push({ state: exifRow.distanceM <= 50 ? 'support' : 'contradiction', text: 'Positionen i EXIF i filen ligger ' + metres(exifRow.distanceM) + ' från positionen i databasen.' });
        if (!phone.length) {
            items.push({ state: 'missing', text: 'Telefonen har inga registrerade positioner i fönstret' + (input.missingDbs && input.missingDbs.routined ? ': routined Cache.sqlite finns inte i extraktionen' : '') + '.' });
            return { id: 'position', title: 'Position', state: 'missing', items: items, plain: 'Bilden har en position, men det finns ingen registrering av var telefonen var vid den tiden.' };
        }
        var tol = Math.max(100, 2 * (Number(near.accuracy) || 0));
        var when = duration(near.offsetMs) + (near.offsetMs < 0 ? ' före' : ' efter');
        var state;
        if (near.distanceM <= tol) { state = 'support'; items.push({ state: 'support', text: 'Telefonen var ' + metres(near.distanceM) + ' från bildens position ' + when + ' bilden (noggrannhet ' + Math.round(near.accuracy) + ' m).' }); }
        else if (near.distanceM > 1000) { state = 'contradiction'; items.push({ state: 'contradiction', text: 'Telefonen var ' + metres(near.distanceM) + ' från bildens position ' + when + ' bilden.' }); }
        else { state = 'info'; items.push({ state: 'info', text: 'Telefonen var ' + metres(near.distanceM) + ' från bildens position ' + when + ' bilden. Avståndet kan bero på GPS-fel.' }); }
        var within = phone.filter(function (p) { return p.distanceM <= Math.max(100, 2 * (Number(p.accuracy) || 0)); }).length;
        if (phone.length > 1) items.push({ state: 'info', text: within + ' av ' + phone.length + ' registrerade positioner i fönstret ligger inom noggrannheten från bildens position.' });
        var plain = state === 'support' ? 'Telefonen var på samma plats som bilden togs, ' + when + '.'
            : state === 'contradiction' ? 'Telefonen var ' + metres(near.distanceM) + ' från platsen där bilden ska ha tagits, ' + when + '. Det stämmer inte med att den här telefonen tog bilden där.'
                : 'Telefonen var ' + metres(near.distanceM) + ' från bildens position, ' + when + '. Så stora avstånd kan bero på GPS-fel.';
        return { id: 'position', title: 'Position', state: state, items: items, plain: plain };
    }

    function appsAt(events, ms, lane) {
        return events.filter(function (e) { return e.kind === 'app' && (!lane || e.lane === lane) && covers(e, ms); });
    }

    function factorApp(input, type, events) {
        var file = input.file;
        var T = file.createdMs;
        var names = input.appNames;
        var kcLabel = input.platform === 'Android' ? 'Wellbeing' : 'knowledgeC';
        var streamKey = input.platform === 'Android' ? 'wellbeing' : '/app/usage';
        var running = appsAt(events, T);
        var runningNames = running.map(function (e) { return appName(e.app, names); });
        var expected = type.type === 'camera' ? null : type.importer;
        var title = type.type === 'screenshot' ? 'App på skärmen' : 'App igång';
        var anyInWindow = events.some(function (e) { return e.kind === 'app'; });
        var items = [];
        var state;
        var plain;
        if (!running.length) {
            state = 'missing';
            var reason = anyInWindow ? 'Ingen app är registrerad som igång vid tidpunkten, men det finns registreringar i fönstret.' : coverageReason(streamKey, input.coverage, input.missingDbs, T, kcLabel);
            items.push({ state: 'missing', text: reason });
            plain = 'Det finns ingen registrering av vilken app som var öppen vid den här tiden. Det betyder inte att ingen app var öppen.';
        } else if (type.type === 'screenshot') {
            state = 'info';
            items.push({ state: 'info', text: 'På skärmen vid tidpunkten: ' + runningNames.join(', ') + ' (' + running[0].stream + ').' });
            plain = 'När skärmdumpen togs var ' + runningNames.join(' och ') + ' öppen på skärmen.';
        } else if (type.type === 'camera') {
            var cam = running.filter(function (e) { return isCameraApp(e.app, input.cameraApps); });
            if (cam.length) { state = 'support'; items.push({ state: 'support', text: 'Kameran var igång vid tidpunkten (' + cam[0].stream + ').' }); }
            else { state = 'contradiction'; items.push({ state: 'contradiction', text: 'Vid tidpunkten var ' + runningNames.join(', ') + ' igång, inte kameran.' }); }
            var others = running.filter(function (e) { return !isCameraApp(e.app, input.cameraApps); });
            if (cam.length && others.length) items.push({ state: 'info', text: 'Samtidigt registrerades ' + others.map(function (e) { return appName(e.app, names); }).join(', ') + '.' });
            plain = state === 'support' ? 'Kameran var igång när bilden togs.' : 'Vid den här tiden var ' + runningNames.join(' och ') + ' igång, men inte kameran.';
        } else {
            var match = expected ? running.filter(function (e) { return e.app === expected; }) : [];
            if (match.length) { state = 'support'; items.push({ state: 'support', text: appName(expected, names) + ', som skapade filen, var igång vid tidpunkten (' + match[0].stream + ').' }); }
            else if (expected) { state = 'contradiction'; items.push({ state: 'contradiction', text: 'Vid tidpunkten var ' + runningNames.join(', ') + ' igång, inte ' + appName(expected, names) + ' som skapade filen.' }); }
            else { state = 'info'; items.push({ state: 'info', text: 'Igång vid tidpunkten: ' + runningNames.join(', ') + '.' }); }
            plain = state === 'support' ? appName(expected, names) + ' var igång när bilden sparades.'
                : state === 'contradiction' ? 'Vid den här tiden var ' + runningNames.join(' och ') + ' igång, inte ' + appName(expected, names) + '.'
                    : 'Vid den här tiden var ' + runningNames.join(' och ') + ' igång.';
        }
        return { id: 'app', title: title, state: state, items: items, plain: plain, running: running.map(function (e) { return e.app; }) };
    }

    function factorCamera(input, type, events, appFactor) {
        var T = input.file.createdMs;
        var names = input.appNames;
        if (type.type === 'screenshot') {
            return { id: 'camera', title: 'Kamera igång', state: 'na', items: [{ state: 'na', text: 'En skärmdump tas utan kameran.' }], plain: 'Kameran behövs inte för en skärmdump, så den frågan ställs inte.' };
        }
        if (type.type === 'saved' && type.importer && !isCameraApp(type.importer, input.cameraApps)) {
            // En tredjepartsapp med egen kamera ger inga rader för systemkameran.
            var f = Object.assign({}, appFactor, { id: 'camera', title: 'Skaparappen igång' });
            f.items = f.items.concat([{ state: 'info', text: 'Filen skapades av ' + appName(type.importer, names) + '. En sådan app använder kameran i sin egen process, så systemkameran syns inte i loggen. Därför bedöms om skaparappen var igång.' }]);
            return f;
        }
        var cam = appsAt(events, T, 'camera');
        var anyCamInWindow = events.some(function (e) { return e.kind === 'app' && e.lane === 'camera'; });
        var running = appsAt(events, T);
        var kcLabel = input.platform === 'Android' ? 'Wellbeing' : 'knowledgeC';
        var streamKey = input.platform === 'Android' ? 'wellbeing' : '/app/usage';
        if (cam.length) {
            return { id: 'camera', title: 'Kamera igång', state: 'support', items: [{ state: 'support', text: appName(cam[0].app, names) + ' var igång ' + formatUtc(cam[0].ms) + ' till ' + formatUtc(cam[0].endMs) + ' (' + cam[0].stream + ').' }],
                plain: 'Kameran var igång när bilden togs.' };
        }
        if (running.length) {
            return { id: 'camera', title: 'Kamera igång', state: 'contradiction', items: [{ state: 'contradiction', text: 'Kameran är inte registrerad vid tidpunkten. Igång var ' + running.map(function (e) { return appName(e.app, names); }).join(', ') + '.' }],
                plain: 'Kameran är inte registrerad som igång vid den här tiden. ' + running.map(function (e) { return appName(e.app, names); }).join(' och ') + ' var igång.' };
        }
        var reason = anyCamInWindow ? 'Kameran var igång i fönstret, men inte vid själva tidpunkten.' : coverageReason(streamKey, input.coverage, input.missingDbs, T, kcLabel);
        return { id: 'camera', title: 'Kamera igång', state: 'missing', items: [{ state: 'missing', text: reason }],
            plain: 'Det finns ingen registrering av om kameran var igång vid den här tiden. Det betyder inte att den inte var det.' };
    }

    function factorScreen(input, events) {
        var T = input.file.createdMs;
        var on = events.filter(function (e) { return e.kind === 'screen' && covers(e, T); });
        if (!on.length) {
            var any = events.some(function (e) { return e.kind === 'screen'; });
            var reason = any ? 'Ingen registrering av skärmen vid själva tidpunkten.' : coverageReason(input.platform === 'Android' ? 'wellbeing' : '/display/isBacklit', input.coverage, input.missingDbs, T, input.platform === 'Android' ? 'Wellbeing' : 'knowledgeC');
            return { id: 'screen', title: 'Skärm', state: 'missing', items: [{ state: 'missing', text: reason }], plain: 'Det finns ingen registrering av om skärmen var tänd.' };
        }
        var lit = on.some(function (e) { return e.on; });
        var lock = events.filter(function (e) { return e.kind === 'lock' && covers(e, T); });
        var items = [{ state: lit ? 'support' : 'contradiction', text: lit ? 'Skärmen var tänd vid tidpunkten (' + on[0].stream + ').' : 'Skärmen var släckt vid tidpunkten (' + on[0].stream + ').' }];
        if (lock.length) items.push({ state: 'info', text: 'Telefonen var ' + (lock[0].locked ? 'låst' : 'olåst') + ' vid tidpunkten. Kameran går att starta från låsskärmen, så det avgör inget.' });
        return { id: 'screen', title: 'Skärm', state: lit ? 'support' : 'contradiction', items: items,
            plain: lit ? 'Skärmen var tänd.' : 'Skärmen var släckt vid den här tiden, vilket inte stämmer med att någon använde telefonen då.' };
    }

    function alternatives(input, type, factors) {
        var file = input.file;
        var names = input.appNames;
        var out = [];
        var lateDiff = file.addedMs && file.createdMs ? file.addedMs - file.createdMs : null;
        var app = factors.find(function (f) { return f.id === 'app'; });
        var cam = factors.find(function (f) { return f.id === 'camera'; });

        function alt(id, label, fors, againsts) {
            out.push({ id: id, label: label, for: fors.filter(Boolean), against: againsts.filter(Boolean) });
        }
        var posF = factors.find(function (f) { return f.id === 'position'; });
        alt('received', 'Mottagen från någon annan (chatt, AirDrop, nedladdning)',
            [lateDiff != null && lateDiff > LATE_MS ? 'Filen lades till i biblioteket ' + duration(lateDiff) + ' efter att den skapades.' : null,
                type.type === 'saved' ? 'Skaparappen är ' + appName(type.importer, names) + '.' : null,
                posF && posF.state === 'contradiction' ? posF.items.filter(function (i) { return i.state === 'contradiction'; }).map(function (i) { return i.text; }).join(' ') : null],
            [type.type === 'camera' ? 'Databasen anger kameran som källa (' + type.reasons.join(', ') + ').' : null,
                lateDiff != null && Math.abs(lateDiff) <= SAME_TIME_MS ? 'Filen hamnade i biblioteket direkt när den skapades.' : null,
                cam && cam.state === 'support' ? 'Kameran var igång vid tidpunkten.' : null,
                posF && posF.state === 'support' ? 'Telefonen var på bildens position vid tidpunkten.' : null]);
        alt('synced', 'Synkad från en annan enhet eller molnet',
            [lateDiff != null && lateDiff > LATE_MS && type.type !== 'saved' ? 'Filen lades till i biblioteket långt efter att den skapades.' : null,
                file.cloudLocalState != null && Number(file.cloudLocalState) !== 0 ? 'ZCLOUDLOCALSTATE är ' + file.cloudLocalState + '.' : null],
            [cam && cam.state === 'support' ? 'Kameran var igång på den här telefonen vid tidpunkten.' : null,
                input.exif && input.exif.model && file.cameraModel && lower(input.exif.model) === lower(file.cameraModel) ? null : null,
                lateDiff != null && Math.abs(lateDiff) <= SAME_TIME_MS ? 'Filen hamnade i biblioteket direkt när den skapades.' : null]);
        alt('screenshot', 'Skärmdump',
            [type.type === 'screenshot' ? type.reasons.join(', ') + '.' : null],
            [type.type !== 'screenshot' && type.reasons.length ? type.reasons.join(', ') + '.' : null]);
        alt('saved', 'Sparad eller skapad av en annan app än kameran',
            [type.type === 'saved' ? 'Skaparappen är ' + appName(type.importer, names) + '.' : null,
                app && app.state === 'contradiction' ? app.items[0].text : null],
            [type.type === 'camera' ? 'Databasen anger kameran som källa.' : null,
                cam && cam.state === 'support' ? 'Kameran var igång vid tidpunkten.' : null]);
        alt('edited', 'Redigerad kopia',
            [file.editor ? 'Redigeringsappen är ' + appName(file.editor, names) + '.' : null],
            [!file.editor ? 'Ingen redigeringsapp är registrerad för filen.' : null]);
        return out;
    }

    // ---------- Förklaringen ----------

    function narrative(events, wins, opts) {
        opts = opts || {};
        var lines = [];
        var range = unionRange(wins);
        var seen = {};
        function push(ms, text, bold) {
            if (ms == null || text == null) return;
            if (!inRange(ms, range)) return;
            var key = Math.round(ms / 1000) + '|' + text;
            if (seen[key]) return;
            seen[key] = true;
            lines.push({ ms: ms, text: text, bold: !!bold });
        }
        var neighbours = [];
        var locations = [];
        events.forEach(function (e) {
            if (e.neighbour) { neighbours.push(e); return; }
            if (e.kind === 'location') { locations.push(e); return; }
            if (e.plain) push(e.ms, e.plain, e.bold);
            if (e.plainEnd && e.endMs != null && !e.openEnded) push(e.endMs, e.plainEnd, false);
        });
        lines.sort(function (a, b) { return a.ms - b.ms; });
        var notes = [];
        if (neighbours.length) {
            var T = opts.centerMs;
            var within = T != null ? Math.max.apply(null, neighbours.map(function (n) { return Math.abs(n.ms - T); })) : null;
            var span = within == null ? '' : within <= MINUTE ? ' inom en minut' : ' inom ' + Math.ceil(within / MINUTE) + ' minuter';
            notes.push(neighbours.length + (neighbours.length === 1 ? ' bild till skapades' : ' bilder till skapades') + span + (T != null ? ' från bilden' : '') + '.');
        }
        if (locations.length) {
            var first = locations[0].ms, last = locations[locations.length - 1].ms;
            notes.push('Telefonen registrerade ' + locations.length + (locations.length === 1 ? ' position' : ' positioner') + (locations.length > 1 ? ' mellan ' + (opts.format || formatUtc)(first) + ' och ' + (opts.format || formatUtc)(last) : ' ' + (opts.format || formatUtc)(first)) + '.');
        }
        return { lines: lines, notes: notes };
    }

    // ---------- Allt ihop ----------

    function build(input) {
        var file = input.file;
        var type = classify(file, input.platform, input);
        var wins = windows(file, input.windowMs);
        var built = buildEvents(input, type, wins);
        var events = built.events;
        var factors = [];
        var warnings = (input.warnings || []).slice();
        var pos = positions(input);
        if (file.createdMs) {
            var fTime = factorTime(input, type);
            var fApp = factorApp(input, type, events);
            var fCam = factorCamera(input, type, events, fApp);
            var fScreen = factorScreen(input, events);
            var fPos = factorPosition(input, pos);
            factors = [fTime, fApp, fCam, fScreen, fPos];
        } else {
            factors = [factorTime(input, type)];
            warnings.push('Skapandetiden saknas, så app, kamera och skärm kan inte bedömas.');
        }
        var alts = file.createdMs ? alternatives(input, type, factors) : [];
        var perWindow = wins.map(function (w) {
            var n = narrative(events.filter(function (e) { return inRange(e.ms, w) || (e.endMs != null && e.endMs >= w.startMs && e.ms <= w.endMs); }), [w], { centerMs: w.centerMs, format: input.format });
            return { window: w, lines: n.lines, notes: n.notes };
        });
        var summary = summaryText(type, factors, input.appNames);
        return {
            platform: input.platform, file: file, type: type, windows: wins, events: events, outside: built.outside,
            factors: factors, alternatives: alts, narrative: perWindow, warnings: warnings, summary: summary,
            positions: pos.list, filePosition: pos.filePos,
            stateLabel: STATE_LABEL,
        };
    }

    // En mening som sammanfattar, alltid "förenligt"/"inte förenligt"/"går inte att bedöma".
    function summaryText(type, factors, names) {
        var core = factors.filter(function (f) { return f.id !== 'screen' && f.state !== 'na' && f.state !== 'info'; });
        var hyp = type.type === 'screenshot' ? 'att skärmdumpen togs på den här telefonen'
            : type.type === 'saved' ? 'att filen sparades på den här telefonen av ' + (type.importer ? appName(type.importer, names) : 'appen')
                : 'att bilden togs med den här telefonens kamera';
        if (core.some(function (f) { return f.state === 'contradiction'; })) return 'Materialet är inte förenligt med ' + hyp + ' utan vidare: minst en faktor motsäger det.';
        var support = core.filter(function (f) { return f.state === 'support'; }).length;
        var missing = core.filter(function (f) { return f.state === 'missing'; }).length;
        if (support && !missing) return 'Materialet är förenligt med ' + hyp + '. Alla kontrollerade faktorer ger stöd.';
        if (support) return 'Materialet är förenligt med ' + hyp + ', men ' + missing + (missing === 1 ? ' faktor' : ' faktorer') + ' går inte att bedöma för att registreringar saknas.';
        return 'Det går inte att bedöma ' + hyp + ' utifrån det här materialet: registreringar saknas.';
    }

    var api = {
        classify: classify, windows: windows, intervalsFromEvents: intervalsFromEvents, mergeIntervals: mergeIntervals,
        buildEvents: buildEvents, narrative: narrative, build: build, summaryText: summaryText,
        formatWithOffset: formatWithOffset, formatUtc: formatUtc, duration: duration, appName: appName, isCameraApp: isCameraApp, covers: covers,
        positions: positions, distanceM: distanceM, metres: metres, validCoord: validCoord,
        STATE_LABEL: STATE_LABEL, TOLERANCE_MS: TOLERANCE_MS, SAME_TIME_MS: SAME_TIME_MS, LATE_MS: LATE_MS,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceCore = api;
})(typeof window !== 'undefined' ? window : this);
