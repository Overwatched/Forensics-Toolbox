// PowerLog som källa i Härkomst (iOS): skärmen, låset, appen på skärmen och kameran per app ur
// CurrentPowerlog.PLSQL. Rollqueryerna ger övergångar med rättad tid: PowerLogs tid plus
// tidsförskjutningen som gällde då (PLStorageOperator_EventForward_TimeOffset, kolumnen system). Här blir
// övergångarna intervall. Ett läge gäller till nästa övergång, men inte över ett glapp i PowerLogs tätaste
// tabeller (pl-gaps, över två timmar): då var telefonen avstängd eller PowerLog skrev inte, och läget är
// okänt till nästa övergång. Kontrollerat mot en labbtelefon (iOS 26.4.1, 2026-11-03): appen på skärmen
// och kameran stämmer med knowledgeC på ungefär en sekund. Ingen DOM, ingen SQL. Testas i Node.
(function (root) {
    'use strict';

    var MERGE_MS = 2000;   // kamerasessioner för samma app med högst så här långt emellan blir en
    var HOME = { 'com.apple.springboard.home-screen': 1, 'com.apple.springboard.app-switcher': 1, 'com.apple.springboard': 1 };
    var LOCK_SCREEN = 'com.apple.lock-screen';

    function sortByMs(list) { return list.slice().sort(function (a, b) { return a.ms - b.ms; }); }

    // Det första glappet som börjar i [fromMs, toMs).
    function firstGap(gaps, fromMs, toMs) {
        for (var i = 0; i < gaps.length; i++) {
            var g = gaps[i];
            if (g.startMs >= fromMs && g.startMs < toMs) return g;
        }
        return null;
    }

    // Övergångar till intervall. rows: [{ ms, value }]. value null betyder att inget läge gäller (till
    // exempel hemskärmen för appen på skärmen). endMs: täckningens slut, där det sista läget slutar.
    function intervals(rows, gaps, endMs) {
        var out = [];
        var cur = null;
        var close = function (ms) {
            if (cur && cur.value != null) out.push({ startMs: cur.startMs, endMs: Math.max(ms, cur.startMs), value: cur.value });
            cur = null;
        };
        sortByMs(rows).forEach(function (r) {
            if (r.ms == null) return;
            if (cur) {
                var g = firstGap(gaps, cur.startMs, r.ms);
                if (g) close(g.startMs);
            }
            if (cur && cur.value === r.value) return;
            close(r.ms);
            cur = { startMs: r.ms, value: r.value === undefined ? null : r.value };
        });
        if (cur) {
            var last = firstGap(gaps, cur.startMs, Infinity);
            close(last ? last.startMs : endMs != null ? endMs : cur.startMs);
        }
        return out;
    }

    // Skärmen ur PLDisplayAgent_EventPoint_Display (Block Backlight, Active 1 tänd, 0 släckt).
    function screen(rows, gaps, endMs) {
        return intervals(rows.map(function (r) { return { ms: r.timeMs, value: Number(r.active) === 1 }; }), gaps, endMs)
            .map(function (iv) { return { startMs: iv.startMs, endMs: iv.endMs, on: iv.value }; });
    }

    // Låset ur PLSpringBoardAgent_EventForward_SBLock (Locked 1 låst, 0 olåst).
    function lock(rows, gaps, endMs) {
        return intervals(rows.map(function (r) { return { ms: r.timeMs, value: Number(r.locked) === 1 }; }), gaps, endMs)
            .map(function (iv) { return { startMs: iv.startMs, endMs: iv.endMs, locked: iv.value }; });
    }

    // Appen på skärmen ur PLScreenStateAgent_EventForward_ScreenState: en rad med AppRole 1 byter app.
    // Hemskärmen och appväxlaren är ingen app. Låsskärmen och en släckt skärm (screenOff: tider ur
    // skärmens övergångar) avslutar appen. Andra roller (Face ID, kontrollcenter) ligger ovanpå appen.
    function apps(rows, gaps, endMs, screenOff) {
        var list = [];
        rows.forEach(function (r) {
            var b = r.bundle || '';
            if (Number(r.role) === 1) list.push({ ms: r.timeMs, value: HOME[b] || !b ? null : b });
            else if (b === LOCK_SCREEN) list.push({ ms: r.timeMs, value: null });
        });
        (screenOff || []).forEach(function (ms) { list.push({ ms: ms, value: null }); });
        return intervals(list, gaps, endMs).map(function (iv) { return { startMs: iv.startMs, endMs: iv.endMs, app: iv.value }; });
    }

    // Kamerasessioner per app ur PLCameraAgent_EventForward_Camera: en rad med State 1 och BundleId
    // startar en kamera (en rad per kamera, CameraType), en rad med State 0 stänger samma kamera. En app
    // som har flera kameror igång samtidigt, eller öppnar kameran igen inom två sekunder, får en session.
    // Utan stängningsrad slutar sessionen vid nästa glapp, annars är slutet okänt.
    function camera(rows, gaps) {
        var open = {};
        var out = [];
        sortByMs(rows.map(function (r) { return { ms: r.timeMs, app: r.app, type: String(r.type), state: Number(r.state) }; })).forEach(function (r) {
            if (r.ms == null) return;
            if (r.state === 1 && r.app) {
                if (!open[r.type]) open[r.type] = { app: r.app, startMs: r.ms };
            } else if (r.state === 0 && open[r.type]) {
                out.push({ app: open[r.type].app, startMs: open[r.type].startMs, endMs: r.ms });
                delete open[r.type];
            }
        });
        Object.keys(open).forEach(function (t) {
            var g = firstGap(gaps, open[t].startMs, Infinity);
            out.push({ app: open[t].app, startMs: open[t].startMs, endMs: g ? g.startMs : null });
        });
        out.sort(function (a, b) { return a.startMs - b.startMs; });
        var merged = [];
        out.forEach(function (s) {
            var last = merged.filter(function (m) { return m.app === s.app; }).pop();
            if (last && (last.endMs == null || s.startMs - last.endMs <= MERGE_MS)) {
                if (last.endMs != null && (s.endMs == null || s.endMs > last.endMs)) last.endMs = s.endMs;
                last.sessions++;
            } else {
                merged.push({ app: s.app, startMs: s.startMs, endMs: s.endMs, sessions: 1 });
            }
        });
        return merged;
    }

    // Allt på en gång. ctx: { backlight, lock, screenState, camera (rader med timeMs), gaps
    // ([{ startMs, endMs }]), coverage ({ lastMs }) }.
    function build(ctx) {
        var gaps = (ctx.gaps || []).filter(function (g) { return g.startMs != null; }).sort(function (a, b) { return a.startMs - b.startMs; });
        var endMs = ctx.coverage && ctx.coverage.lastMs != null ? ctx.coverage.lastMs : null;
        var scr = screen(ctx.backlight || [], gaps, endMs);
        var off = scr.filter(function (iv) { return !iv.on; }).map(function (iv) { return iv.startMs; });
        return {
            screen: scr,
            lock: lock(ctx.lock || [], gaps, endMs),
            apps: apps(ctx.screenState || [], gaps, endMs, off),
            camera: camera(ctx.camera || [], gaps),
        };
    }

    var api = { intervals: intervals, screen: screen, lock: lock, apps: apps, camera: camera, build: build, LOCK_SCREEN: LOCK_SCREEN };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenancePowerLog = api;
})(typeof window !== 'undefined' ? window : this);
