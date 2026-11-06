// Samsungs egna loggar som källor i Härkomst: SSRM-loggen (com.sec.android.sdhms/ssrm_heating_N.log) och
// batterihistoriken (/data/log/batterystats/newbatterystatsYYMMDDHHMMSS). Båda är textfiler med lokal tid utan zon,
// och båda ger app i förgrunden, skärm och kamera långt bakåt i tiden, där usagestats och appops inte längre räcker.
// Formaten är kontrollerade mot en Samsung-telefon (SM-A336B, en rapport): SSRM-raderna mot rapportverktygets egna
// tolkningar, och batterihistorikens tider mot SSRM och usagestats. Ingen DOM, ingen SQL. Testas i Node.
(function (root) {
    'use strict';

    var SSRM_RE = /(^|\/)com\.sec\.android\.sdhms\/ssrm_heating_(\d+)\.log$/;
    var BATTERY_RE = /(^|\/)batterystats\/newbatterystats(\d{12})$/;
    var MINUTE = 60000;
    var DAY = 86400000;
    var SILENCE_MS = 3600000;       // SSRM skriver flera gånger i timmen när telefonen är igång; ett längre uppehåll är ett hål i loggen
    var CLOCK_LIMIT_MS = 5000;      // samma marginal som faktorerna: en större flytt av klockan gör raden osäker
    var FAR_ZONE_MS = 14 * DAY;     // så långt från en känd tidszon räknas zonen som känd
    var LARGE_STEP_MS = 3600000;    // telefonen vaknar oftare än så: ett större steg framåt i klockan är inget uppehåll i raderna
    var RAW_MAX = 220;
    var MERGE_GAP_MS = 2000;        // samma marginal som Härkomsts övriga hopslagning av täta händelser
    var RTC_NEAR_MS = MINUTE;       // [RTC] skrivs någon sekund efter en start

    function isSsrmPath(name) { return SSRM_RE.test(String(name || '')); }
    function isBatteryPath(name) { return BATTERY_RE.test(String(name || '')); }
    function keeper() {
        return function (name) { return SSRM_RE.test(name) || BATTERY_RE.test(name); };
    }

    function baseName(name) { return String(name).slice(String(name).lastIndexOf('/') + 1); }

    // Filnamnets tid är lokal: newbatterystats260317080553 skrevs 2026-03-17 08:05:53 i telefonens zon.
    function batteryNameMs(name) {
        var m = BATTERY_RE.exec(String(name || ''));
        if (!m) return null;
        var s = m[2];
        return Date.UTC(2000 + Number(s.slice(0, 2)), Number(s.slice(2, 4)) - 1, Number(s.slice(4, 6)), Number(s.slice(6, 8)), Number(s.slice(8, 10)), Number(s.slice(10, 12)));
    }

    // Samma fil kan stå under både data/data och data/user/0. En gång per filnamn räcker.
    function sortEntries(entries) {
        var seen = {};
        var once = function (e) { var b = baseName(e.name); if (seen[b]) return false; seen[b] = true; return true; };
        var ssrm = (entries || []).filter(function (e) { return isSsrmPath(e.name); }).filter(once);
        var battery = (entries || []).filter(function (e) { return isBatteryPath(e.name); }).filter(once)
            .sort(function (a, b) { return batteryNameMs(a.name) - batteryNameMs(b.name); });
        return { ssrm: ssrm, battery: battery };
    }

    // En egen kopia av ett namn: en delsträng håller annars hela filens text kvar i minnet så länge raden sparas.
    function own(text) { return text.split('').join(''); }

    function cutRaw(line) {
        var s = String(line).replace(/\s+/g, ' ').trim();
        return s.length > RAW_MAX ? s.slice(0, RAW_MAX - 1) + '…' : s;
    }

    // ---------- SSRM ----------

    var SSRM_LINE = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) \[([A-Z]+)\] ?(.*)$/;
    var LAST_BOOT = /ABOVE LOGS ARE FROM LAST BOOTING/;
    var RTC_RE = /(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) (\d{9,11})\s*$/;

    // Filerna skrivs i tur och ordning och börjar om från 0, så skrivordningen är filernas första tid.
    function ssrmRows(files) {
        var lists = [];
        (files || []).forEach(function (f) {
            var rows = [];
            String(f.text).split(/\r?\n/).forEach(function (line, i) {
                var m = SSRM_LINE.exec(line);
                if (m) rows.push({ localMs: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), tag: m[7], rest: m[8], file: f.name, line: i + 1, raw: line });
                else if (LAST_BOOT.test(line)) rows.push({ boundary: true });
            });
            var first = rows.find(function (r) { return !r.boundary; });
            if (first) lists.push({ first: first.localMs, rows: rows });
        });
        lists.sort(function (a, b) { return a.first - b.first; });
        return lists.reduce(function (all, l) { return all.concat(l.rows); }, []);
    }

    function rowRef(r) { return { file: r.file, line: r.line, raw: cutRaw(r.raw) }; }

    // [RTC]-raden har både lokal tid och unixtid. Zonen är skillnaden, avrundad till en kvart: raden skrivs över en sekundgräns.
    function rtcOffset(r) {
        var m = RTC_RE.exec(r.rest);
        if (!m) return null;
        var minutes = Math.round((r.localMs - Number(m[7]) * 1000) / (15 * MINUTE)) * 15;
        return Math.abs(minutes) <= 14 * 60 ? { localMs: r.localMs, offsetMinutes: minutes } : null;
    }

    // App, skärm och kamera som intervall i lokal tid. Appen slutar när skärmen släcks, som i usagestats. Ett hål i
    // loggen, en omstart eller filernas slut avslutar allt som pågår: efter det finns inga registreringar, inte samma läge.
    function parseSsrm(files) {
        var rows = ssrmRows(files);
        var out = { apps: [], screen: [], camera: [], offsets: [], spans: [], rows: 0 };
        var app = null;
        var screen = null;
        var cams = {};
        var last = null;
        var span = null;
        function close(iv, list, r, openEnded) {
            iv.endLocal = r.localMs;
            iv.to = rowRef(r);
            if (openEnded) iv.openEnded = true;
            if (iv.endLocal >= iv.startLocal) list.push(iv);
        }
        function closeAll(r, openEnded) {
            if (app) { close(app, out.apps, r, openEnded); app = null; }
            if (screen) { close(screen, out.screen, r, openEnded); screen = null; }
            // Kameran utan slutrad: slutet är okänt, inte tiden för sista raden.
            Object.keys(cams).forEach(function (c) { out.camera.push(cams[c]); });
            cams = {};
        }
        rows.forEach(function (r) {
            if (r.boundary) {
                if (last) closeAll(last, true);
                span = null;
                return;
            }
            out.rows++;
            var ver = r.tag === 'VER' ? /\b(START|SHUTDOWN)\s*$/.exec(r.rest) : null;
            if (last && (Math.abs(r.localMs - last.localMs) > SILENCE_MS || (ver && ver[1] === 'START'))) {
                closeAll(last, true);
                span = null;
            }
            if (!span) { span = { startLocal: r.localMs, endLocal: r.localMs }; out.spans.push(span); }
            if (r.localMs > span.endLocal) span.endLocal = r.localMs;
            if (r.tag === 'RTC') {
                var off = rtcOffset(r);
                if (off) {
                    out.offsets.push(off);
                    // Raderna från starten till den första [RTC] har samma zon som den, inte zonen före starten. Skärmen tänds på
                    // de raderna, och med en zonändring medan telefonen var låst blev hela skärmraden annars osäker (labbet, 28 dagar).
                    if (r.localMs > span.startLocal && r.localMs - span.startLocal <= RTC_NEAR_MS) out.offsets.push({ localMs: span.startLocal, offsetMinutes: off.offsetMinutes });
                }
            } else if (r.tag === 'PKG') {
                if (app) close(app, out.apps, r);
                var pkg = own(r.rest.trim());
                app = pkg && !(screen && !screen.on) ? { startLocal: r.localMs, app: pkg, from: rowRef(r) } : null;
            } else if (ver && ver[1] === 'SHUTDOWN') {
                closeAll(r, false);
                span = null;
            } else if (r.tag === 'SET') {
                var lcd = /\[LCD\] (ON|OFF)\b/.exec(r.rest);
                if (lcd) {
                    var on = lcd[1] === 'ON';
                    if (screen && screen.on === on) { last = r; return; }
                    if (screen) close(screen, out.screen, r);
                    screen = { startLocal: r.localMs, on: on, from: rowRef(r) };
                    if (!on && app) { close(app, out.apps, r); app = null; }
                }
                var cam = /camera running :: (true|false)\s+client : (\S+)/.exec(r.rest);
                if (cam) {
                    var client = own(cam[2]);
                    if (cam[1] === 'true') {
                        if (!cams[client]) cams[client] = { startLocal: r.localMs, endLocal: null, app: client, from: rowRef(r) };
                    } else if (cams[client]) {
                        cams[client].endLocal = r.localMs;
                        cams[client].to = rowRef(r);
                        out.camera.push(cams[client]);
                        delete cams[client];
                    }
                }
            }
            last = r;
        });
        if (last) closeAll(last, true);
        out.offsets.sort(function (a, b) { return a.localMs - b.localMs; });
        out.firstLocal = out.spans.length ? out.spans[0].startLocal : null;
        out.lastLocal = out.spans.length ? out.spans[out.spans.length - 1].endLocal : null;
        return out;
    }

    // Zonen vid en lokal tid ur en tabell av kända zoner: { offsetMinutes, unsureMs }, eller null utan någon känd zon.
    // Säger raderna före och efter olika har zonen bytts däremellan, och då vet man inte vilken sida tiden hör till.
    function zoneAt(offsets, localMs) {
        var list = offsets || [];
        var lo = 0, hi = list.length;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (list[mid].localMs <= localMs) lo = mid + 1; else hi = mid; }
        var before = lo > 0 ? list[lo - 1] : null;
        var after = lo < list.length ? list[lo] : null;
        if (!before && !after) return null;
        if (before && before.localMs === localMs) return { offsetMinutes: before.offsetMinutes, unsureMs: 0 };
        if (before && after && before.offsetMinutes !== after.offsetMinutes) {
            var near = localMs - before.localMs <= after.localMs - localMs ? before : after;
            return { offsetMinutes: near.offsetMinutes, unsureMs: Math.abs(before.offsetMinutes - after.offsetMinutes) * MINUTE };
        }
        var one = before || after;
        return { offsetMinutes: one.offsetMinutes, unsureMs: Math.abs(localMs - one.localMs) > FAR_ZONE_MS && !(before && after) ? 60 * MINUTE : 0 };
    }

    // ---------- Batterihistoriken ----------

    var BATTERY_REL = /^\s*(?:\+(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?(?:(\d+)ms)?|0)\s+\(\d+\)\s*(.*)$/;
    var BATTERY_DATE = /^\s*(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d{3}) (.*)$/;
    var ANCHOR_RE = /^(RESET:)?TIME: (\d{4})-(\d\d)-(\d\d)-(\d\d)-(\d\d)-(\d\d)(?:-(\d{3}))?/;

    // Uid står på två sätt i filen: 10330 och u0a330.
    function uidNumber(text) {
        var m = /^u(\d+)a(\d+)$/.exec(text);
        return m ? Number(m[1]) * 100000 + 10000 + Number(m[2]) : Number(text);
    }

    // Raderna skrivs ut med en av två former. Äldre filer har tiden sedan historikens början (+1h37m42s570ms),
    // nyare har datum utan år (05-22 12:24:57.537). I båda räknas tiden fram från senaste ankaret (TIME: med full tid),
    // så en rad är aldrig säkrare än ankaret före den. Allt som läses är app, skärm, kamera, ankare och omstarter.
    // Kameran: nyare rader säger vem som använder den (+camera +state=10330:"camera"), och raderna +top vilket paket
    // uid:n är. Utan den uppgiften är appen den som låg i förgrunden, och det kan vara en annan: i labbet startade Snapchat
    // kameran medan frågan om behörighet låg överst.
    function parseBattery(text, name) {
        var str = String(text);
        var out = { name: name, format: null, rows: 0, firstLocal: null, lastLocal: null, apps: [], screen: [], camera: [], segments: [] };
        var anchor = null;
        var prevRow = null;     // förra radens utskrivna tid
        var restarted = false;
        var seg = null;
        var waitFollow = null;  // ankaret vars nästa rad säger om steget framåt var ett uppehåll eller en sen skrivning
        var scr = { on: null, since: null };
        var curTop = null;
        var names = Object.create(null);
        var uids = Object.create(null);
        var openApp = null;
        var cam = null;
        function ref(line, raw) { return { file: name, line: line, raw: cutRaw(raw), seg: out.segments.length - 1 }; }
        // Tillståndsraden efter RESET:TIME: skriver läget som +screen eller -screen. Det ger ett intervall utan längd, och det säger inget.
        function pushInterval(list, iv, end, openEnded) {
            iv.endLocal = end.localMs;
            iv.to = end.ref;
            if (openEnded) iv.openEnded = true;
            if (iv.endLocal > iv.startLocal || (list === out.camera && iv.endLocal === iv.startLocal)) list.push(iv);
        }
        function closeApp(end, openEnded) { if (openApp) { pushInterval(out.apps, openApp, end, openEnded); openApp = null; } }
        function endScreen(end, openEnded) {
            if (scr.on !== null && scr.since) pushInterval(out.screen, { startLocal: scr.since.localMs, on: scr.on, from: scr.since.ref }, end, openEnded);
        }
        function closeAll(end, openEnded) {
            closeApp(end, openEnded);
            endScreen(end, openEnded);
            if (cam) { pushInterval(out.camera, cam, end, true); cam = null; }
        }
        var pos = 0, lineNo = 0, n = str.length;
        var last = null;
        while (pos < n) {
            var nl = str.indexOf('\n', pos);
            if (nl < 0) nl = n;
            var line = str.slice(pos, nl);
            pos = nl + 1;
            lineNo++;
            if (line.charCodeAt(0) === 80 && line.indexOf('Per process state') === 0) break;
            var d = BATTERY_DATE.exec(line);
            var rel = d ? null : BATTERY_REL.exec(line);
            if (!d && !rel) continue;
            var rest = d ? d[7] : rel[6];
            var relMs = rel ? Number(rel[1] || 0) * DAY + Number(rel[2] || 0) * 3600000 + Number(rel[3] || 0) * MINUTE + Number(rel[4] || 0) * 1000 + Number(rel[5] || 0) : null;
            if (!out.format) out.format = d ? 'date' : 'offset';
            var rowLocal = null;
            if (d) {
                var refMs = anchor ? anchor.localMs : batteryNameMs(name) || 0;
                var y = new Date(refMs).getUTCFullYear();
                rowLocal = Date.UTC(y, +d[1] - 1, +d[2], +d[3], +d[4], +d[5], +d[6]);
                // Datum utan år: raden ligger nära ankaret, också över ett årsskifte.
                if (rowLocal - refMs > 182 * DAY) rowLocal = Date.UTC(y - 1, +d[1] - 1, +d[2], +d[3], +d[4], +d[5], +d[6]);
                else if (refMs - rowLocal > 182 * DAY) rowLocal = Date.UTC(y + 1, +d[1] - 1, +d[2], +d[3], +d[4], +d[5], +d[6]);
            } else if (anchor) {
                rowLocal = anchor.localMs + (relMs - anchor.relMs);
            }
            var a = ANCHOR_RE.exec(rest);
            if (a) {
                var at = Date.UTC(+a[2], +a[3] - 1, +a[4], +a[5], +a[6], +a[7], +(a[8] || 0));
                // Steget: hur mycket ankaret skiljer sig från tiden raderna före det räknades fram till. I den äldre formen är
                // det exakt. I den nyare är bara förra radens tid känd, så ett steg framåt kan också vara ett uppehåll i raderna.
                var step = null;
                if (!restarted) {
                    if (d && prevRow != null) step = at - prevRow;
                    else if (!d && anchor) step = at - rowLocal;
                }
                if (seg) seg.endStep = step;
                seg = { startLocal: at, endLocal: at, startStep: step, endStep: null, follow: null, line: lineNo, raw: cutRaw(line) };
                out.segments.push(seg);
                waitFollow = seg;
                anchor = { localMs: at, relMs: relMs };
                prevRow = at;
                restarted = false;
                if (scr.on === null && !scr.since) scr.since = { localMs: at, ref: ref(lineNo, line) };
                last = { localMs: at, ref: ref(lineNo, line) };
                continue;
            }
            if (rowLocal == null) continue;
            out.rows++;
            if (rest.indexOf('START') === 0 || rest.indexOf('SHUTDOWN') === 0) {
                var down = rest.indexOf('SHUTDOWN') === 0;
                if (last) closeAll(down ? { localMs: rowLocal, ref: ref(lineNo, line) } : last, !down);
                scr = { on: null, since: null };
                curTop = null;
                restarted = true;
                last = null;
                continue;
            }
            if (waitFollow) {
                waitFollow.follow = /(^| )\+running( |$)/.test(rest) ? 'wake' : /(^| )-running( |$)/.test(rest) ? 'late' : 'other';
                waitFollow = null;
            }
            prevRow = rowLocal;
            if (seg && rowLocal > seg.endLocal) seg.endLocal = rowLocal;
            var here = { localMs: rowLocal, ref: ref(lineNo, line) };
            last = here;
            if (rest.indexOf('screen') < 0 && rest.indexOf('camera') < 0 && rest.indexOf('top=') < 0) continue;
            var flags = rest.replace(/"[^"]*"/g, '""');
            var sc = /(?:^| )([+-])screen(?= |$)/.exec(flags);
            if (sc) {
                var on = sc[1] === '+';
                if (scr.on === null) {
                    // Första övergången efter en omstart eller filens början säger vad skärmen var fram till dess.
                    if (scr.since) pushInterval(out.screen, { startLocal: scr.since.localMs, on: !on, from: scr.since.ref }, here);
                    if (on) openApp = null;
                    scr = { on: on, since: here };
                } else if (scr.on !== on) {
                    endScreen(here);
                    scr = { on: on, since: here };
                }
                if (!on) closeApp(here);
            }
            var topRe = /(?:^| )([+-]?)top=([^:\s]+):"([^"]*)"/g;
            var t;
            while ((t = topRe.exec(rest))) {
                var topName = names[t[3]] || (names[t[3]] = own(t[3]));
                var topUid = uidNumber(t[2]);
                // Uid 1000 delas av flera systemappar. Då säger uid:n inte vilken.
                uids[topUid] = uids[topUid] === undefined || uids[topUid] === topName ? topName : null;
                if (t[1] === '-') {
                    if (openApp && openApp.app === topName) closeApp(here);
                    if (curTop === topName) curTop = null;
                } else {
                    curTop = topName;
                    if (openApp && openApp.app !== curTop) closeApp(here);
                    if (!openApp && scr.on !== false) openApp = { startLocal: rowLocal, app: curTop, from: here.ref };
                }
            }
            var ca = /(?:^| )([+-])camera(?= |$)/.exec(flags);
            if (ca) {
                var st = /(?:^| )[+-]state=([^:\s]+):"camera"/.exec(rest);
                var camUid = st ? uidNumber(st[1]) : null;
                if (ca[1] === '+') {
                    if (!cam) cam = { startLocal: rowLocal, app: curTop, uid: camUid, from: here.ref };
                } else if (cam) { pushInterval(out.camera, cam, here); cam = null; }
                // Kameran var på redan när avsnittet började: en ny fil börjar mitt i en användning.
                else if (seg) pushInterval(out.camera, { startLocal: seg.startLocal, app: curTop, uid: camUid, from: { file: name, line: seg.line, raw: seg.raw, seg: out.segments.length - 1 } }, here);
            }
        }
        if (last) closeAll(last, true);
        // Paketet kan stå senare i filen än kameraraden. Hittas det inte är appen okänd: den i förgrunden är inte säkert samma.
        out.camera.forEach(function (c) {
            if (c.uid == null) return;
            c.app = uids[c.uid] || null;
            c.byUid = !!c.app;
        });
        out.segments.forEach(function (s) { s.clockMs = segmentClock(s, out.format === 'offset'); });
        [out.apps, out.screen, out.camera].forEach(function (list) {
            list.forEach(function (iv) { iv.clockMs = intervalClock(out.segments, iv); });
        });
        // Täckningen räknas på avsnitt med en klocka att lita på: en telefon utan nät kan ha stått på 2021 ett tag.
        var good = out.segments.filter(function (s) { return s.clockMs <= LARGE_STEP_MS; });
        out.firstLocal = good.length ? Math.min.apply(null, good.map(function (s) { return s.startLocal; })) : null;
        out.lastLocal = good.length ? Math.max.apply(null, good.map(function (s) { return s.endLocal; })) : null;
        return out;
    }

    // Hur mycket klockan kan ligga fel i ett avsnitt mellan två ankare. Tiden räknas fram från ankaret, och ankarets tid
    // kan vara tagen för sent: en rad som skrevs när telefonen vaknade får tiden då, inte tiden då det hände. Då ligger
    // raderna efter ankaret för sent ända tills ett senare ankare stegar tillbaka (labbet: +163 s, sedan −162 s).
    // - Ett steg bakåt vid avsnittets slut är säkert: raderna före det låg så mycket fel.
    // - Ett steg framåt vid avsnittets början räknas, utom när raden efter ankaret är +running: då vaknade telefonen just
    //   då, och steget är ett uppehåll i raderna, inget fel i klockan (i labbet högst 10 s). Andra rader kan vara båda
    //   delarna, och det går inte att skilja dem åt i den nyare formen, så de räknas (i labbet upp till 30 min).
    // - Ett steg framåt på mer än en timme är ingen sömn utan att klockan ställdes: raderna före är fel, raderna efter rätt.
    // - I den äldre formen är steget exakt, så det räknas åt båda håll.
    function segmentClock(s, exact) {
        var harmless = s.follow === 'wake' || (s.startStep > LARGE_STEP_MS && s.follow !== 'late');
        var start = s.startStep != null && s.startStep > 0 && (exact || !harmless) ? s.startStep : 0;
        var end = s.endStep != null && (s.endStep < 0 || exact || s.endStep > LARGE_STEP_MS) ? Math.abs(s.endStep) : 0;
        return Math.max(start, end);
    }

    function intervalClock(segments, iv) {
        var a = iv.from && iv.from.seg != null ? iv.from.seg : 0;
        var b = iv.to && iv.to.seg != null ? iv.to.seg : a;
        var max = 0;
        for (var i = Math.max(0, a); i <= b && i < segments.length; i++) if (segments[i].clockMs > max) max = segments[i].clockMs;
        return max;
    }

    // Filen skrivs när historiken nollställs, så den täcker tiden från förra filens namn till sitt eget. Tiderna är lokala
    // och fönstren i UTC, därför ett dygns marginal. Ett fönster per tidpunkt: mellan två tidpunkter som ligger långt isär läses inget.
    function pickBattery(entries, windows) {
        var list = entries || [];
        return list.filter(function (e, i) {
            var end = batteryNameMs(e.name);
            var start = i ? batteryNameMs(list[i - 1].name) : -Infinity;
            return (windows || []).some(function (w) { return end >= w.startMs - DAY && start <= w.endMs + DAY; });
        });
    }

    // Zonen när filen skrevs: filnamnets lokala tid mot filens ändringstid i UTC. Stämmer de inte på en kvart när
    // (till exempel en kopia med en senare tid) säger det inget om zonen.
    function fileOffset(entry) {
        var local = batteryNameMs(entry.name);
        if (local == null || !entry.mtimeMs) return null;
        var diff = local - entry.mtimeMs;
        var quarters = Math.round(diff / (15 * MINUTE));
        if (Math.abs(diff - quarters * 15 * MINUTE) > 2 * MINUTE || Math.abs(quarters) > 56) return null;
        return quarters * 15;
    }

    // Zonen per fil. Raderna skrivs ut med zonen när filen skrevs, inte zonen då det hände, så SSRM:s tabell gäller bara
    // en fil utan ändringstid. Har zonen bytts sedan förra filen spänner filen över bytet (sommartid eller en resa), och
    // då går det inte att säga vilken sida en rad hör till. entries är sorterade och har mtimeMs.
    function batteryZones(entries, ssrmOffsets) {
        var out = {};
        var prev = null;
        (entries || []).forEach(function (e, i) {
            var own = fileOffset(e);
            var nameMs = batteryNameMs(e.name);
            var viaSsrm = own == null ? zoneAt(ssrmOffsets, nameMs) : null;
            var offset = own != null ? own : viaSsrm ? viaSsrm.offsetMinutes : null;
            var unsure = viaSsrm ? viaSsrm.unsureMs : 0;
            if (prev != null && offset != null && prev !== offset) unsure = Math.max(unsure, Math.abs(prev - offset) * MINUTE);
            out[baseName(e.name)] = { offsetMinutes: offset, unsureMs: unsure, oldest: i === 0, nameMs: nameMs };
            if (offset != null) prev = offset;
        });
        return out;
    }

    // Den äldsta filen har ingen fil före sig att jämföra zonen med, så rader långt före filens namn är osäkra.
    function batteryZoneAt(z, localMs) {
        if (!z || z.offsetMinutes == null) return null;
        var unsure = z.unsureMs;
        if (z.oldest && z.nameMs - localMs > FAR_ZONE_MS) unsure = Math.max(unsure, 60 * MINUTE);
        return { offsetMinutes: z.offsetMinutes, unsureMs: unsure };
    }

    function spansUtc(spans, offsets) {
        return (spans || []).map(function (s) {
            var a = zoneAt(offsets, s.startLocal), b = zoneAt(offsets, s.endLocal);
            return a && b ? { startMs: s.startLocal - a.offsetMinutes * MINUTE, endMs: s.endLocal - b.offsetMinutes * MINUTE } : null;
        }).filter(Boolean);
    }

    function inSpan(spans, startMs, endMs) {
        return spans.some(function (s) { return s.startMs <= startMs && endMs <= s.endMs; });
    }

    // Källan i Härkomsts form: filen, raderna och själva råraderna.
    function sourceOf(db, queryId, iv) {
        var a = iv.from, b = iv.to;
        var where = a.file + ' rad ' + a.line;
        if (b && (b.file !== a.file || b.line !== a.line)) where += b.file === a.file ? '–' + b.line : ', ' + b.file + ' rad ' + b.line;
        return { db: db, table: where, column: a.raw + (b && b.line !== a.line ? ' … ' + b.raw : ''), queryId: queryId };
    }

    // Tätt följande rader med samma värde slås ihop med första och sista råraden, så att källan täcker hela intervallet.
    // Appar byter ofta aktivitet: -top och +top med samma paket inom en bråkdel av en sekund. En ny fil börjar också
    // mitt i en app, en tänd skärm eller en kameraanvändning.
    function mergeRows(list, what) {
        var out = [];
        var same = what === 'screen' ? function (a, b) { return a.on === b.on; } : function (a, b) { return a.app === b.app; };
        list.slice().sort(function (a, b) { return a.startMs - b.startMs; }).forEach(function (iv) {
            var last = out[out.length - 1];
            if (last && same(last, iv) && iv.startMs - last.endMs <= MERGE_GAP_MS) {
                if (iv.endMs >= last.endMs) { last.endMs = iv.endMs; last.to = iv.to; last.openEnded = iv.openEnded; }
                last.clockMs = Math.max(last.clockMs || 0, iv.clockMs || 0);
                last.zoneMs = Math.max(last.zoneMs, iv.zoneMs);
            } else {
                out.push(Object.assign({}, iv));
            }
        });
        return out;
    }

    // Raderna i fönstret i UTC och i samma form som Härkomsts övriga källor.
    // - Samma tid ur flera loggar ger inte fler rader: för app och skärm gäller den starkaste källan som täcker tiden, först
    //   telefonens egen logg (primary: usagestats eller Wellbeing), sedan SSRM, sist batterihistoriken. Kameran har ingen
    //   sådan ordning: där är flera oberoende källor just det undersökaren vill se.
    // - En rad vars tid är osäker hamnar i unsure och räknas inte i bedömningen.
    // opts: { windows: [{ startMs, endMs }], ssrm, battery: [parsed], zones, primary: [{ startMs, endMs }] }
    function collect(opts) {
        var out = { apps: [], screen: [], camera: [], unsure: [], usedSsrm: {}, usedBattery: {}, ssrmRows: [], batteryRows: [], noZone: 0 };
        var offsets = opts.ssrm ? opts.ssrm.offsets : [];
        var primary = opts.primary || [];
        var ssrmSpans = opts.ssrm ? spansUtc(opts.ssrm.spans, offsets) : [];
        function inRange(startMs, endMs) { return opts.windows.some(function (w) { return startMs <= w.endMs && (endMs != null ? endMs : startMs) >= w.startMs; }); }
        function take(what, iv, stream, startMs, endMs, zoneMs) {
            var clockMs = iv.clockMs || 0;
            var row = { startMs: startMs, endMs: endMs, stream: stream, openEnded: !!iv.openEnded };
            if (what === 'app' || what === 'camera') row.app = iv.app || null;
            if (what === 'camera' && iv.byUid) row.byUid = true;
            if (what === 'screen') row.on = iv.on;
            row.source = stream === 'SSRM' ? sourceOf('SSRM', 'ssrm-heating', iv) : sourceOf('batterihistoriken', 'batterystats-history', iv);
            if (zoneMs > 0 || clockMs > CLOCK_LIMIT_MS) {
                row.what = what;
                row.clockMs = clockMs;
                row.zoneMs = zoneMs;
                out.unsure.push(row);
            } else if (what === 'app') out.apps.push(row);
            else if (what === 'screen') out.screen.push(row);
            else out.camera.push(row);
            var used = stream === 'SSRM' ? out.usedSsrm : out.usedBattery;
            [iv.from, iv.to].forEach(function (r) {
                if (!r) return;
                used[r.file] = true;
                (stream === 'SSRM' ? out.ssrmRows : out.batteryRows).push({ file: r.file, line: r.line, raw: r.raw, seg: r.seg, startMs: startMs });
            });
        }
        if (opts.ssrm) {
            [['app', opts.ssrm.apps], ['screen', opts.ssrm.screen], ['camera', opts.ssrm.camera]].forEach(function (pair) {
                pair[1].forEach(function (iv) {
                    var a = zoneAt(offsets, iv.startLocal);
                    if (!a) { out.noZone++; return; }
                    var b = iv.endLocal != null ? zoneAt(offsets, iv.endLocal) : a;
                    var startMs = iv.startLocal - a.offsetMinutes * MINUTE;
                    var endMs = iv.endLocal != null ? iv.endLocal - b.offsetMinutes * MINUTE : null;
                    if (!inRange(startMs, endMs)) return;
                    if (pair[0] !== 'camera' && inSpan(primary, startMs, endMs != null ? endMs : startMs)) return;
                    take(pair[0], iv, 'SSRM', startMs, endMs, Math.max(a.unsureMs, b.unsureMs));
                });
            });
        }
        var parts = { app: [], screen: [], camera: [] };
        (opts.battery || []).forEach(function (p) {
            var z = (opts.zones || {})[baseName(p.name)];
            [['app', p.apps], ['screen', p.screen], ['camera', p.camera]].forEach(function (pair) {
                pair[1].forEach(function (iv) {
                    var a = batteryZoneAt(z, iv.startLocal);
                    if (!a) { out.noZone++; return; }
                    var b = batteryZoneAt(z, iv.endLocal);
                    parts[pair[0]].push(Object.assign({}, iv, { startMs: iv.startLocal - a.offsetMinutes * MINUTE, endMs: iv.endLocal - b.offsetMinutes * MINUTE, zoneMs: Math.max(a.unsureMs, b.unsureMs) }));
                });
            });
        });
        Object.keys(parts).forEach(function (what) {
            mergeRows(parts[what], what).forEach(function (iv) {
                if (!inRange(iv.startMs, iv.endMs)) return;
                if (what !== 'camera' && (inSpan(primary, iv.startMs, iv.endMs) || inSpan(ssrmSpans, iv.startMs, iv.endMs))) return;
                take(what, iv, 'batterihistoriken', iv.startMs, iv.endMs, iv.zoneMs);
            });
        });
        return out;
    }

    // Täckningen i UTC, och hålen i den: tiden mellan två delar av SSRM-loggen (telefonen var avstängd, eller inte upplåst
    // efter en omstart: loggen ligger i appens krypterade lagring).
    function ssrmCoverage(parsed) {
        var list = spansUtc(parsed.spans, parsed.offsets);
        var gaps = [];
        list.forEach(function (s, i) { if (i && s.startMs > list[i - 1].endMs) gaps.push({ startMs: list[i - 1].endMs, endMs: s.startMs }); });
        return { firstMs: list.length ? list[0].startMs : null, lastMs: list.length ? list[list.length - 1].endMs : null, rows: parsed.rows, gaps: gaps };
    }

    // Batterihistorikens täckning: från den äldsta filens första rad till den nyaste filens namn. Filen ska täcka tiden från
    // förra filens namn, men historiken har ett tak och de äldsta raderna kan vara borta. Då är tiden däremellan ett hål.
    // parsed: { filnamn: tolkad fil } för de filer som är lästa; bara deras hål är kända.
    function batteryCoverage(entries, zones, parsed) {
        var list = entries || [];
        var utc = function (e, localMs) { var z = zones[baseName(e.name)]; return z && z.offsetMinutes != null ? localMs - z.offsetMinutes * MINUTE : null; };
        var gaps = [];
        list.forEach(function (e, i) {
            var p = parsed[baseName(e.name)];
            if (!i || !p || p.firstLocal == null) return;
            var from = utc(list[i - 1], batteryNameMs(list[i - 1].name));
            var to = utc(e, p.firstLocal);
            if (from != null && to != null && to - from > MINUTE) gaps.push({ startMs: from, endMs: to });
        });
        var first = list.length ? parsed[baseName(list[0].name)] : null;
        return {
            firstMs: first && first.firstLocal != null ? utc(list[0], first.firstLocal) : null,
            lastMs: list.length ? utc(list[list.length - 1], batteryNameMs(list[list.length - 1].name)) : null,
            gaps: gaps,
        };
    }

    var api = {
        isSsrmPath: isSsrmPath, isBatteryPath: isBatteryPath, keeper: keeper, sortEntries: sortEntries, batteryNameMs: batteryNameMs,
        parseSsrm: parseSsrm, parseBattery: parseBattery, zoneAt: zoneAt, pickBattery: pickBattery, fileOffset: fileOffset, batteryZones: batteryZones, batteryZoneAt: batteryZoneAt,
        collect: collect, ssrmCoverage: ssrmCoverage, batteryCoverage: batteryCoverage, baseName: baseName, CLOCK_LIMIT_MS: CLOCK_LIMIT_MS, SSRM: 'SSRM', BATTERY: 'batterihistoriken',
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceSamsungLogs = api;
})(typeof window !== 'undefined' ? window : this);
