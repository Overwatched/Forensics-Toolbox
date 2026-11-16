// Laborationens spår: stegen i loggen jämförda med det som står i telefonernas extraktioner.
// Ingen DOM och ingen läsning här. Underlaget per enhet kommer från lab-read.js (eller ett test) i den här formen:
//   messages: [{ key, app, base, fromMe, kind, deleted, codes: ['L03'], sortMs, times: [{ key, label, col, ms }] }]
//   threads:  [{ key, app, base, codes, firstMs }]              chattar vars namn innehåller en kod
//   media:    [{ key, base, name, kind: 'photo'|'video'|'screenshot', ms, col, qr: { code, t } | null, thumb }]
//   events:   [{ key, base, kind: 'lock'|'unlock'|'off'|'on', ms, col }]
//   locks:    [{ key, base, startMs, endMs, col }]              tider då enheten var låst
//   apps:     [{ key, base, app, startMs, endMs, col }]         appen (paketets eller buntens id) i förgrunden
// Varje sak kan också bära ref: det som behövs för att öppna källan (se trace-view.js). En bild eller händelse
// kan bära what (orden som står i tabellen i stället för sortens egna).
// Ordningen i sökningen: koden först (i meddelandets text, i gruppens namn eller i QR-koden i bilden), sedan
// tiden. Ett spår som bara hittas på tiden är aldrig säkert: det är troligt när det finns ett enda att välja
// på, och annars får användaren välja.
(function (root) {
    'use strict';
    var Lab = root.LabCore || require('./lab-core.js');

    // Märkena, bäst först: tecknet och ordet.
    var MARKS = {
        sure: { sign: '✔', word: 'säker', hint: 'Koden står i meddelandet, i gruppens namn eller i bilden.' },
        chosen: { sign: '✔', word: 'vald', hint: 'Du har valt spåret bland flera möjliga.' },
        likely: { sign: '≈', word: 'trolig', hint: 'Det enda spåret av rätt sort nära loggens tid. Koden finns inte i det.' },
        many: { sign: '?', word: 'flera möjliga', hint: 'Flera spår av rätt sort nära loggens tid. Det närmaste är föreslaget; välj det rätta.' },
        none: { sign: '–', word: 'inte hittad', hint: 'Inget spår av rätt sort nära loggens tid.' },
        off: { sign: '', word: 'söks inte', hint: 'Programmet letar inte efter den här sortens steg.' },
        wait: { sign: '', word: 'ingen extraktion', hint: 'Enhetens extraktion är inte vald.' },
    };
    var RANK = ['sure', 'chosen', 'likely', 'many', 'none', 'wait', 'off'];

    // Vad som söks för varje byggsten.
    var CODED = { text: 1, reply: 1, 'group-text': 1, 'group-reply': 1, document: 1, 'photo-app': 1, 'video-app': 1, 'photo-library': 1, 'text-delete': 1 };
    var BY_KIND = { voice: ['voice', 'audio'], call: ['call'], 'call-answer': ['call'] };
    // Sorten ett kodat steg har när koden inte står i det. "other" är det en app sparar utan att säga vad det är
    // (en snap i Snapchat).
    var UNCODED = { text: ['text'], reply: ['text'], 'group-text': ['text'], 'group-reply': ['text'], document: ['file', 'other'],
        'photo-app': ['image', 'other'], 'photo-library': ['image', 'other'], 'video-app': ['video', 'other'] };
    var MEDIA = { photo: 'photo', video: 'video', screenshot: 'screenshot' };
    var EVENT = { 'home-lock': 'lock', lock: 'lock', unlock: 'unlock', 'power-off': 'off', 'power-on': 'on' };
    // Steg som görs i en app utan att flödet säger vilken, och steg där appen inte står framme.
    var IMPLIED = { zone: 'Inställningar', 'zone-back': 'Inställningar' };
    var NO_APP = { install: 1, uninstall: 1 };
    var WHAT = { lock: 'låst', unlock: 'upplåst', off: 'avstängd', on: 'startad', photo: 'bilden tagen', video: 'videon inspelad', screenshot: 'skärmdumpen tagen' };

    // Tiderna i ett meddelande som säger när det kom fram, när det lästes och när det togs bort. Namnen är
    // katalogernas (queries/…/catalog.json, rollen chat-messages).
    var ARRIVED = ['arrived', 'received'], READ = ['read', 'opened', 'played'], REVOKED = ['revoked'];

    // Appens namn i flödet mot id:t i telefonens logg. En app som inte står här söks på namnet i id:t.
    var APP_IDS = {
        whatsapp: ['net.whatsapp.whatsapp', 'com.whatsapp'], signal: ['org.whispersystems.signal', 'org.thoughtcrime.securesms'],
        telegram: ['ph.telegra.telegraph', 'org.telegram.messenger'], snapchat: ['com.toyopagroup.picaboo', 'com.snapchat.android'],
        messenger: ['com.facebook.messenger', 'com.facebook.orca'], instagram: ['com.burbn.instagram', 'com.instagram.android'],
        kamera: ['com.apple.camera', 'com.sec.android.app.camera', 'com.android.camera', 'com.google.android.googlecamera'],
        bilder: ['com.apple.mobileslideshow', 'com.sec.android.gallery3d', 'com.google.android.apps.photos'],
        'inställningar': ['com.apple.preferences', 'com.android.settings'],
    };
    function appIs(id, name) {
        id = String(id || '').toLowerCase();
        name = String(name || '').trim().toLowerCase();
        if (!id || !name) return false;
        var known = APP_IDS[name];
        if (known) return known.some(function (k) { return id === k || id.indexOf(k + '.') === 0; });
        var word = name.replace(/[^a-z0-9]/g, '');
        return word.length >= 3 && id.replace(/[^a-z0-9]/g, '').indexOf(word) >= 0;
    }
    function sameApp(a, b) { return !b || String(a || '').trim().toLowerCase() === String(b).trim().toLowerCase(); }

    // Koderna i en text: bokstaven följd av stegets nummer, inte mitt i ett ord eller ett längre tal.
    function codesIn(text, prefix, width) {
        var out = [], m, re = new RegExp('(^|[^A-Za-zÅÄÖåäö0-9])(' + String(prefix).replace(/[^A-Za-zÅÄÖåäö]/g, '') + ')(\\d{' + (width || 2) + '})(?!\\d)', 'gi');
        while ((m = re.exec(String(text == null ? '' : text)))) {
            var code = m[2].toUpperCase() + m[3];
            if (out.indexOf(code) < 0) out.push(code);
            re.lastIndex = m.index + m[0].length - 1;
        }
        return out;
    }

    function median(list) {
        if (!list.length) return null;
        var s = list.slice().sort(function (a, b) { return a - b; }), mid = s.length >> 1;
        return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }

    // Telefonens klocka mot datorns, ur bilderna av rutan: QR-koden säger datorns sekund, och bildens tid är
    // telefonens. Bilden togs någon gång under sekunden, så varje bild är osäker en halv sekund åt vardera hållet.
    function clocks(evidence) {
        var out = {};
        Object.keys(evidence || {}).forEach(function (d) {
            var diffs = ((evidence[d] && evidence[d].media) || []).filter(function (m) { return m.qr && typeof m.ms === 'number'; }).map(function (m) { return m.ms - (m.qr.t + 500); });
            if (diffs.length) out[d] = { ms: Math.round(median(diffs)), n: diffs.length };
        });
        return out;
    }

    function timeOf(m, keys) {
        for (var i = 0; i < keys.length; i++) {
            var t = m.times.filter(function (x) { return x.key === keys[i] && typeof x.ms === 'number'; })[0];
            if (t) return t;
        }
        return null;
    }
    // Tiden som meddelandet står på i chatten.
    function sortTime(m) { return m.times.filter(function (x) { return x.ms === m.sortMs; })[0] || { key: '', label: '', col: '', ms: m.sortMs }; }

    // Stegen i loggen mot underlaget. evidence: { enhetens id: underlag }. opts: { before, after } i sekunder (hur
    // långt före och efter loggens tid ett spår utan kod söks) och chosen: { plats: spårets nyckel } för det
    // användaren har valt. Ger { rows, summary, clocks, delay, before, after, devices }.
    function match(flow, run, evidence, opts) {
        opts = opts || {};
        evidence = evidence || {};
        var before = (opts.before == null ? 180 : opts.before) * 1000, after = (opts.after == null ? 60 : opts.after) * 1000;
        var chosen = opts.chosen || {}, steps = Lab.view(flow), clock = clocks(evidence), used = {};
        var ids = flow.devices.map(function (d) { return d.id; });

        var rows = steps.map(function (s, n) {
            var e = run && run.entries[n];
            return {
                id: s.id, n: n, code: s.code, prev: n ? steps[n - 1].code : '', action: s.action, device: s.device, other: s.other, app: s.app || IMPLIED[s.action] || '', deviceName: s.deviceName, text: s.done,
                status: e ? e.status : '', logT: e && e.status === 'klar' ? e.t : null, off: e ? e.off : (run ? run.off : 0), approx: !!(e && e.approx), needs: [], traces: [],
            };
        });

        // Vad varje steg ska ha lämnat efter sig, per enhet. main: enheten som steget gjordes på.
        rows.forEach(function (r) {
            var own = r.device === '*' ? ids : [r.device];
            var others = r.other ? [r.other] : ids.filter(function (d) { return own.indexOf(d) < 0; });
            var need = function (list, role, more) { list.forEach(function (d) { r.needs.push(Object.assign({ device: d, role: role, slot: r.id + '|' + d + '|' + role, main: list === own }, more || {})); }); };
            r.own = own;
            r.chat = !!(CODED[r.action] || BY_KIND[r.action] || r.action === 'group' || r.action === 'read' || r.action === 'delete');
            if (CODED[r.action]) { need(own, 'sent'); need(others, 'received'); }
            else if (r.action === 'group') { need(own, 'thread'); need(others, 'thread'); }
            else if (r.action === 'read') { need(own, 'read'); need(others, 'read'); }
            else if (r.action === 'delete') { need(own, 'deleted', { fromMe: true }); need(others, 'deleted', { fromMe: false }); }
            else if (BY_KIND[r.action]) { need(own, 'kind', { fromMe: true }); need(others, 'kind', { fromMe: false }); }
            else if (MEDIA[r.action]) need(own, 'media');
            else if (EVENT[r.action]) need(own, 'event');
            else if (r.app && !NO_APP[r.action]) need(own, 'app');
        });

        var claim = function (d, item) { used[d + '|' + item.key] = true; };
        var free = function (d) { return function (item) { return !used[d + '|' + item.key]; }; };
        var timesOf = function (m) { return m.times.filter(function (x) { return typeof x.ms === 'number'; }); };
        var arrival = function (m) { return (!m.fromMe && timeOf(m, ARRIVED)) || sortTime(m); };
        var trace = function (need, item, ms, what, more) { return Object.assign({ device: need.device, slot: need.slot, main: need.main, what: what, ms: ms, item: item, col: item.col || '', key: item.key }, more || {}); };
        var msgTrace = function (need, m, t, what, more) { return trace(need, m, t.ms, what, Object.assign({ col: t.col, label: t.label, times: timesOf(m) }, more || {})); };
        var gone = function (need, m) {
            var t = timeOf(m, REVOKED) || arrival(m), when = t.key && REVOKED.indexOf(t.key) >= 0;
            // Utan en egen tid för raderingen visas raden som är raderad, med tiden då den skrevs eller kom.
            return msgTrace(need, m, t, when ? 'raderat' : 'raden är raderad; tiden är när den ' + (m.fromMe ? 'skrevs' : 'kom'), { shared: true, notWhen: !when });
        };

        // Första varvet: det som bär koden.
        rows.forEach(function (r) {
            r.needs.forEach(function (need) {
                var ev = evidence[need.device], hit = null;
                if (!ev) return;
                if (need.role === 'sent' || need.role === 'received') {
                    var list = ev.messages.filter(function (m) { return m.codes.indexOf(r.code) >= 0 && m.fromMe === (need.role === 'sent'); }).filter(free(need.device));
                    if (list.length) hit = msgTrace(need, list[0], arrival(list[0]), need.role === 'sent' ? 'skickat' : 'mottaget');
                    if (hit && list.length > 1) hit.more = list.length - 1;
                } else if (need.role === 'thread') {
                    var th = ev.threads.filter(function (t) { return t.codes.indexOf(r.code) >= 0 && typeof t.firstMs === 'number'; })[0];
                    if (th) hit = trace(need, th, th.firstMs, 'gruppens första rad');
                } else if (need.role === 'read') {
                    var msg = ev.messages.filter(function (m) { return m.codes.indexOf(r.prev) >= 0; })[0], t = msg && timeOf(msg, READ);
                    // Meddelandet hör också till steget som skickade det, så det tas inte i anspråk här.
                    if (t) hit = msgTrace(need, msg, t, 'läst', { shared: true, key: msg.key + '|' + t.key });
                } else if (need.role === 'deleted') {
                    var del = ev.messages.filter(function (m) { return m.deleted && m.codes.indexOf(r.prev) >= 0; })[0];
                    if (del) hit = gone(need, del);
                } else if (need.role === 'media') {
                    var pic = ev.media.filter(function (m) { return m.qr && m.qr.code === r.code; }).filter(free(need.device))[0];
                    if (pic) hit = trace(need, pic, pic.ms, pic.what || WHAT[pic.kind] || 'filen skapad', { thumb: pic.thumb, qr: pic.qr });
                }
                if (!hit) return;
                hit.mark = 'sure';
                r.traces.push(hit);
                need.done = true;
                if (!hit.shared) claim(need.device, hit.item);
            });
        });

        // Säkra spår per enhet i stegens ordning: ett spår utan kod väntas ligga mellan grannarnas.
        var anchors = {};
        var anchor = function (r, t) { if (!t.shared && !t.notWhen) (anchors[t.device] = anchors[t.device] || []).push({ n: r.n, ms: t.ms }); };
        rows.forEach(function (r) { r.traces.forEach(function (t) { anchor(r, t); }); });
        var bounds = function (d, n) {
            var lo = -Infinity, hi = Infinity;
            (anchors[d] || []).forEach(function (a) { if (a.n < n && a.ms > lo) lo = a.ms; if (a.n > n && a.ms < hi) hi = a.ms; });
            // Tider i hela sekunder får ligga en sekund fel.
            return { lo: lo - 1000, hi: hi + 1000 };
        };

        // Det som finns att välja på för ett steg på en enhet när koden inte finns: rätt sort, nära loggens tid.
        var candidates = function (r, need, ev, win) {
            var out = [];
            var inWin = function (ms) { return typeof ms === 'number' && ms >= win.from && ms <= win.to; };
            var over = function (x) { return x.startMs <= win.to && (x.endMs == null || x.endMs >= win.from); };
            var msgs = function (test) { return ev.messages.filter(free(need.device)).filter(test); };
            var side = function (m) { return m.fromMe ? 'skickat' : 'mottaget'; };
            var front = function (what) { ev.apps.filter(function (a) { return appIs(a.app, r.app) && over(a); }).forEach(function (a) { out.push(trace(need, a, a.startMs, what, { endMs: a.endMs, shared: true, span: true })); }); };
            if (need.role === 'sent' || need.role === 'received') {
                // Ett meddelande som raderades efteråt har inte texten kvar, och då inte heller koden.
                if (r.action === 'text-delete') msgs(function (m) { return m.deleted && m.fromMe === (need.role === 'sent') && sameApp(m.app, r.app) && inWin(arrival(m).ms); })
                    .forEach(function (m) { out.push(msgTrace(need, m, arrival(m), side(m) + ', texten finns inte kvar')); });
                // Ett meddelande av rätt sort utan någon kod i sig: en bild utan bildtext, eller en text där koden glömdes.
                else if (r.app) msgs(function (m) { return !m.codes.length && !m.deleted && UNCODED[r.action].indexOf(m.kind) >= 0 && m.fromMe === (need.role === 'sent') && sameApp(m.app, r.app) && inWin(arrival(m).ms); })
                    .forEach(function (m) { out.push(msgTrace(need, m, arrival(m), side(m) + ', utan kod i meddelandet')); });
            } else if (need.role === 'thread') {
                ev.threads.filter(free(need.device)).filter(function (t) { return !t.codes.length && sameApp(t.app, r.app) && inWin(t.firstMs); })
                    .forEach(function (t) { out.push(trace(need, t, t.firstMs, 'gruppens första rad, utan kod i namnet')); });
            } else if (need.role === 'deleted') {
                ev.messages.filter(function (m) { return m.deleted && m.fromMe === need.fromMe && sameApp(m.app, r.app); }).forEach(function (m) {
                    var g = gone(need, m);
                    if (g.notWhen ? g.ms >= win.from - before && g.ms <= win.to : inWin(g.ms)) out.push(g);
                });
            } else if (need.role === 'read') {
                var msg = ev.messages.filter(function (m) { return m.codes.indexOf(r.prev) >= 0; })[0], first = msg && sortTime(msg);
                // Ett mottaget meddelande utan uttalad lästid: en annan tid i det, efter att det kom. (I ett skickat
                // meddelande är de andra tiderna när det skickades och levererades.)
                if (msg && !msg.fromMe) timesOf(msg).forEach(function (t) {
                    if (t !== first && ARRIVED.indexOf(t.key) < 0 && inWin(t.ms) && t.ms >= msg.sortMs) out.push(msgTrace(need, msg, t, 'en senare tid i meddelandet' + (t.label ? ' (' + t.label + ')' : ''), { shared: true, key: msg.key + '|' + t.key }));
                });
                if (!out.length && need.main && r.app) front('appen framme');
            } else if (need.role === 'kind') {
                msgs(function (m) { return BY_KIND[r.action].indexOf(m.kind) >= 0 && (m.kind === 'call' || m.fromMe === need.fromMe) && sameApp(m.app, r.app) && inWin(arrival(m).ms); })
                    .forEach(function (m) { out.push(msgTrace(need, m, arrival(m), m.kind === 'call' ? 'samtal' : side(m))); });
            } else if (need.role === 'media') {
                ev.media.filter(free(need.device)).filter(function (m) { return m.kind === MEDIA[r.action] && inWin(m.ms); }).forEach(function (m) { out.push(trace(need, m, m.ms, m.what || WHAT[m.kind], { thumb: m.thumb })); });
            } else if (need.role === 'event') {
                // En rad som telefonen skriver först efteråt (late, se lab-read.js) får ligga ända fram till nästa steg på enheten.
                ev.events.filter(free(need.device)).filter(function (e) { return e.kind === EVENT[r.action] && (inWin(e.ms) || (e.late && e.ms > win.to && e.ms <= win.lateTo)); })
                    .forEach(function (e) { out.push(trace(need, e, e.ms, e.what || WHAT[e.kind], e.late ? { notWhen: true } : null)); });
                // Ingen låsning nära loggens tid: enheten kan ha varit låst hela tiden.
                if (!out.length && EVENT[r.action] === 'lock') ev.locks.filter(over).forEach(function (l) { out.push(trace(need, l, l.startMs, 'låst', { endMs: l.endMs, shared: true, span: true })); });
            } else if (need.role === 'app') {
                front('appen framme');
            }
            return out.sort(function (a, b) { return a.ms - b.ms; });
        };

        var seek = function (r, need) {
            var ev = evidence[need.device];
            if (need.done || !ev) return;
            var shift = clock[need.device] ? clock[need.device].ms : 0, near = r.logT + shift;
            var next = rows.filter(function (x) { return x.n > r.n && x.logT !== null && x.own.indexOf(need.device) >= 0; })[0];
            var cands = candidates(r, need, ev, { from: near - before, to: near + after, lateTo: (next ? next.logT + shift : near) + after });
            if (!cands.length) return;
            var b = bounds(need.device, r.n);
            var ordered = cands.filter(function (c) { return c.span || (c.ms >= b.lo && c.ms <= b.hi); });
            var pool = ordered.length ? ordered : cands;
            // Det som pågick när det trycktes är det enda rimliga bland tider med början och slut.
            var during = pool.filter(function (c) { return c.span && c.ms <= near + 1000 && (c.endMs == null || c.endMs >= near - 1000); });
            // Förslaget annars: det sista före trycket (man trycker när steget är gjort), och om inget finns det första efter.
            var pick = during.length === 1 ? during[0] : pool.filter(function (c) { return c.ms <= near + 1000; }).pop() || pool[0];
            var mine = cands.filter(function (c) { return c.key === chosen[need.slot]; })[0];
            var t = mine || pick;
            t.mark = mine ? 'chosen' : pool.length === 1 || during.length === 1 ? 'likely' : 'many';
            if (cands.length > 1) t.options = cands.map(function (c) { return { key: c.key, ms: c.ms, endMs: c.endMs, what: c.what, thumb: c.thumb }; });
            r.traces.push(t);
            need.done = true;
            if (!t.shared) claim(need.device, t.item);
            anchor(r, t);
        };

        // Andra varvet: det som bara går att hitta på tiden, i stegens ordning.
        rows.forEach(function (r) {
            if (r.logT === null) return;
            r.needs.forEach(function (need) { seek(r, need); });
            // Ett chattsteg utan spår på sin egen enhet, t.ex. i en app som programmet inte läser: när appen var framme.
            if (r.chat && r.app) r.own.forEach(function (d) {
                if (r.needs.some(function (n) { return n.device === d && n.done; })) return;
                var extra = { device: d, role: 'app', slot: r.id + '|' + d + '|app', main: true, instead: true };
                seek(r, extra);
                if (extra.done) r.needs.filter(function (n) { return n.device === d; }).forEach(function (n) { n.replaced = true; });
            });
            r.needs.forEach(function (need) {
                if (!need.done && !need.replaced && evidence[need.device]) r.traces.push({ device: need.device, slot: need.slot, main: need.main, what: '', ms: null, mark: 'none' });
            });
        });

        rows.forEach(function (r) {
            r.traces.forEach(function (t) { t.deviceName = Lab.deviceName(flow, t.device); t.source = t.item ? [t.item.base, t.col].filter(Boolean).join(' · ') : ''; });
            // Stegets egen enhet först, och där det bästa spåret först.
            r.traces.sort(function (a, b) { return (b.main ? 1 : 0) - (a.main ? 1 : 0) || RANK.indexOf(a.mark) - RANK.indexOf(b.mark) || (a.ms || 0) - (b.ms || 0); });
            var best = r.traces.filter(function (t) { return t.mark !== 'none'; }).sort(function (a, b) { return RANK.indexOf(a.mark) - RANK.indexOf(b.mark) || (b.main ? 1 : 0) - (a.main ? 1 : 0); })[0] || null;
            var read = r.needs.filter(function (n) { return evidence[n.device]; }).length;
            r.best = best;
            r.mark = r.status !== 'klar' || !r.needs.length ? 'off' : best ? best.mark : read ? 'none' : 'wait';
            // Hur långt efter telefonens tid det trycktes, med telefonens klocka omräknad till datorns när den är känd.
            r.pressedAfter = best && r.logT !== null && !best.span && !best.notWhen ? r.logT - (best.ms - (clock[best.device] ? clock[best.device].ms : 0)) : null;
        });

        var summary = {};
        RANK.forEach(function (k) { summary[k] = rows.filter(function (r) { return r.mark === k; }).length; });
        var delays = rows.filter(function (r) { return r.mark === 'sure' && r.pressedAfter !== null && r.best.main && !r.best.shared; }).map(function (r) { return r.pressedAfter; });
        return { rows: rows, summary: summary, clocks: clock, delay: delays.length ? { ms: median(delays), n: delays.length } : null, before: before / 1000, after: after / 1000,
            devices: flow.devices.map(function (d) { return { id: d.id, name: d.name, read: !!evidence[d.id] }; }) };
    }

    // ---------- Tabellen ----------

    function secondsText(ms) {
        var s = Math.round(Math.abs(ms) / 1000), text = s >= 60 ? Math.floor(s / 60) + ' min ' + (s % 60) + ' s' : s + ' s';
        return (ms < -499 ? '−' : '') + text;
    }
    function clockText(c) { return (c.ms >= 0 ? '+' : '−') + (Math.abs(c.ms) / 1000).toFixed(1).replace('.', ',') + ' s'; }
    function markText(k) { return (MARKS[k].sign ? MARKS[k].sign + ' ' : '') + MARKS[k].word; }
    function traceTime(t, off) {
        if (typeof t.ms !== 'number') return '';
        return Lab.timeText(t.ms, off) + (t.span ? '–' + (t.endMs ? Lab.timeText(t.endMs, off) : '') : '');
    }
    // En rad om ett spår, som den står i tabellen till Word: enheten, tiden och vad tiden är.
    function traceLine(t, off) {
        if (t.mark === 'none') return t.deviceName + ': inte hittad';
        return t.deviceName + ' ' + traceTime(t, off) + ' ' + t.what + (t.mark === 'sure' ? '' : ' (' + MARKS[t.mark].word + ')');
    }

    var HEAD = ['Kod', 'Åtgärd', 'Loggens tid', 'Telefonens tid', 'Källa'];
    function cells(r) {
        var shown = r.traces.filter(function (t) { return t.mark !== 'none' || t.main; });
        return [r.code, r.text, r.logT === null ? (r.status === 'hoppad' ? 'hoppad' : '') : Lab.timeText(r.logT, r.off),
            shown.length ? shown.map(function (t) { return traceLine(t, r.off); }).join('\n') : r.status === 'klar' ? MARKS[r.mark].word : '',
            shown.filter(function (t) { return t.source; }).map(function (t) { return t.deviceName + ': ' + t.source; }).join('\n')];
    }

    // Uppgifterna över tabellen. files: { enhetens id: filens namn och vad som lästes ur den }.
    function facts(flow, run, result, files, program) {
        var s = result.summary, parts = [];
        ['sure', 'chosen', 'likely', 'many', 'none', 'wait', 'off'].forEach(function (k) { if (s[k]) parts.push(s[k] + ' ' + MARKS[k].word); });
        var out = [['Laboration', flow.name], ['Datum', run.entries.length ? Lab.dateText(run.started, run.off) : '']];
        result.devices.forEach(function (d) { out.push(['Extraktion ' + d.name, (files && files[d.id]) || 'inte vald']); });
        out.push(['Steg', parts.join(', ')],
            ['Tider', 'Alla tider visas i loggens tidszon (UTC' + Lab.offsetText(run.off) + '). Loggens tid är när undersökaren tryckte att steget var gjort, på datorns klocka. Telefonens tid är den som står i extraktionen.'],
            ['Sökning', 'Ett spår utan kod söks från ' + secondsText(result.before * 1000) + ' före till ' + secondsText(result.after * 1000) + ' efter loggens tid.']);
        if (result.delay) out.push(['Tryck efter telefonens tid', 'Median ' + secondsText(result.delay.ms) + ' i ' + result.delay.n + (result.delay.n === 1 ? ' säkert steg.' : ' säkra steg.')]);
        var cl = result.devices.filter(function (d) { return result.clocks[d.id]; }).map(function (d) { var c = result.clocks[d.id]; return d.name + ' ' + clockText(c) + ' (' + c.n + (c.n === 1 ? ' bild' : ' bilder') + ' av rutan)'; });
        if (cl.length) out.push(['Telefonens klocka mot datorns', cl.join('; ') + '. Varje bild är osäker en halv sekund.']);
        if (program) out.push(['Program', program]);
        return out;
    }

    // Tabellen till Word: fem kolumner, med stilen i varje cell så att den följer med när den klistras in.
    function protocol(flow, run, result, files, program) {
        var FONT = 'font-family: Arial, Helvetica, sans-serif;';
        var TD = 'border: 1px solid #999; padding: 3px 6px; vertical-align: top; font-size: 10pt; ' + FONT;
        var TH = TD + ' background: #e8e8e8; text-align: left; font-weight: bold;';
        var TABLE = 'border-collapse: collapse; margin: 6px 0 12px;';
        var lines = function (c) { return String(c).split('\n').map(Lab.esc).join('<br>'); };
        var f = facts(flow, run, result, files, program);
        var html = '<h2 style="' + FONT + ' margin: 14px 0 6px;">Laborationens spår i enheterna: ' + Lab.esc(flow.name) + '</h2>';
        html += '<table style="' + TABLE + '">' + f.slice(1).map(function (x) { return '<tr><td style="' + TD + '"><b>' + Lab.esc(x[0]) + '</b></td><td style="' + TD + '">' + Lab.esc(x[1]) + '</td></tr>'; }).join('') + '</table>';
        html += '<table style="' + TABLE + '"><tr>' + HEAD.map(function (h) { return '<th style="' + TH + '">' + Lab.esc(h) + '</th>'; }).join('') + '</tr>';
        result.rows.forEach(function (r) {
            html += '<tr>' + cells(r).map(function (c, n) { return '<td style="' + TD + (n === 0 || n === 2 ? ' white-space: nowrap;' : '') + '">' + lines(c) + '</td>'; }).join('') + '</tr>';
        });
        html += '</table>';
        var oneLine = function (c) { return String(c).replace(/[\t\r\n]+/g, ' / '); };
        var text = f.map(function (x) { return x[0] + ': ' + x[1]; }).join('\n') + '\n\n' + HEAD.join('\t') + '\n' + result.rows.map(function (r) { return cells(r).map(oneLine).join('\t'); }).join('\n') + '\n';
        return { html: html, text: text };
    }

    function csvField(value) {
        var text = value == null ? '' : String(value);
        if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
        return /[";\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }

    // Allt som CSV: en rad per spår, med tiderna också i UTC.
    function toCsv(result) {
        var lines = ['Kod;Åtgärd;Loggens tid;Loggens tid UTC;Enhet;Telefonens tid;Telefonens tid UTC;Till;Vad;Märke;Tryckt efter (s);Källa'];
        result.rows.forEach(function (r) {
            var log = r.logT === null ? ['', ''] : [Lab.timeText(r.logT, r.off), new Date(r.logT).toISOString()];
            var list = r.traces.length ? r.traces : [null];
            list.forEach(function (t) {
                var has = t && typeof t.ms === 'number';
                lines.push([r.code, r.text, log[0], log[1], t ? t.deviceName : r.deviceName, has ? Lab.timeText(t.ms, r.off) : '', has ? new Date(t.ms).toISOString() : '',
                    has && t.endMs ? Lab.timeText(t.endMs, r.off) : '', t ? t.what : '', MARKS[t ? t.mark : r.mark].word,
                    has && r.logT !== null && !t.span && !t.notWhen ? ((r.logT - t.ms) / 1000).toFixed(1) : '', t ? t.source : ''].map(csvField).join(';'));
            });
        });
        return lines.join('\r\n') + '\r\n';
    }

    var api = { MARKS: MARKS, HEAD: HEAD, codesIn: codesIn, appIs: appIs, clocks: clocks, match: match, cells: cells, facts: facts, protocol: protocol, toCsv: toCsv,
        secondsText: secondsText, markText: markText, traceTime: traceTime, traceLine: traceLine };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LabTrace = api;
})(typeof window !== 'undefined' ? window : this);
