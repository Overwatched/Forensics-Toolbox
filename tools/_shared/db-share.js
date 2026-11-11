// Inlästa databaser delas mellan verktygen, så att en databas läses ur extraktionen, kontrolleras, hashas och
// dekrypteras en gång och inte en gång per verktyg.
//
// Varje verktyg är en egen ram med eget minne, och ramarna når bara varandra genom huvudfönstret. Verktyget som
// läste databasen först har avbilden kvar (den som sql.js läser ur). När ett annat verktyg behöver samma databas
// frågar det huvudfönstret, som ber det första verktyget om en kopia: en kopiering i minnet i stället för läsning,
// CRC32, SHA-256 och dekryptering. Läser någon redan in databasen väntar frågaren på den i stället för att läsa
// samma fil samtidigt.
//
// Huvudfönstret (registry) håller bara reda på vem som har vad och skickar vidare. Inga byte stannar där.
// Verktygen (client) håller avbilden med en svag referens: den lever så länge databasen är öppen i verktyget, och
// hindrar inte att minnet lämnas tillbaka när den stängs. En avbild som inte längre är som när den lästes lämnas
// aldrig ut.
//
// Meddelandena, alla med source: 'forensics-toolbox':
//   verktyg → huvudfönster: db-want { id, key }, db-unwant { id }, db-have { key }, db-failed { key },
//                           db-gone { key } eller { all }, db-progress { key, stage, frac }, db-given { id, data }
//   huvudfönster → verktyg: db-wait { id, by, why: 'load' | 'copy' }, db-progress { id, by, stage, frac },
//                           db-result { id, data, by }, db-give { id, key }
// data är null eller { bytes: ArrayBuffer (överlåten), … uppgifterna från verktyget som läste }. db-result med
// null betyder: läs in den själv, och säg db-have eller db-failed efteråt. Testas i Node.
(function (root) {
    'use strict';

    var SOURCE = 'forensics-toolbox';
    // Så länge väntar ett verktyg på huvudfönstrets första svar, och huvudfönstret på en kopia, innan databasen
    // läses in som om ingen hade den. Väntan på ett verktyg som läser in har ingen gräns: den som läser säger
    // alltid till, också när det går fel eller avbilden inte går att dela.
    var ACK_MS = 10000;
    var GIVE_MS = 30000;
    // SQLites huvud. Filens ändringsräknare står där, så en avbild som något har skrivit i känns igen.
    var HEAD = 100;

    function later(fn, ms) {
        var t = setTimeout(fn, ms);
        return function () { clearTimeout(t); };
    }

    // Vilken avbild det gäller: filen, posterna i den och dekrypteringen. cipherTag är tom för en okrypterad
    // databas och annars profilen med ett fingeravtryck av nyckeln, aldrig nyckeln själv. Ett verktyg med en
    // annan nyckel, eller utan, får därför aldrig ett annat verktygs dekryptering.
    function keyOf(file, dbEntry, walEntry, cipherTag) {
        if (!file || !dbEntry) return '';
        var entry = function (e) { return e ? [e.name, e.localOffset, e.size, e.crc32].join(':') : ''; };
        return [file.name, file.size, file.lastModified, entry(dbEntry), entry(walEntry), cipherTag || ''].join('|');
    }

    // ---------- Huvudfönstret ----------

    // opts: { send(frame, payload, transfer), name(frame), later(fn, ms) -> avbryt }. frame är vad som helst som
    // send och name förstår; samma verktyg måste vara samma objekt varje gång.
    function registry(opts) {
        var wait = opts.later || later;
        var recs = new Map();       // key -> { holders: [frame], loader: frame | null, waiters: [{ frame, id }] }
        var gives = new Map();      // id -> { key, asker: { frame, id }, holder, cancel }
        var seq = 0;

        function rec(key) {
            if (!recs.has(key)) recs.set(key, { holders: [], loader: null, waiters: [] });
            return recs.get(key);
        }
        function tidy(key) {
            var r = recs.get(key);
            if (r && !r.holders.length && !r.loader && !r.waiters.length) recs.delete(key);
        }
        // false när meddelandet inte gick att skicka.
        function send(frame, type, fields, transfer) {
            var payload = { source: SOURCE, type: type };
            Object.keys(fields).forEach(function (k) { payload[k] = fields[k]; });
            try { opts.send(frame, payload, transfer); return true; }
            catch (err) { return false; }
        }

        // Frågaren får en kopia av den som har databasen, väntar på den som läser in den, eller läser själv.
        function serve(key, asker) {
            var r = rec(key);
            var holder = r.holders.filter(function (h) { return h !== asker.frame; })[0];
            if (holder) {
                var id = 'give-' + (++seq);
                var g = { key: key, asker: asker, holder: holder, cancel: null };
                g.cancel = wait(function () { given(holder, id, null); }, GIVE_MS);
                gives.set(id, g);
                send(asker.frame, 'db-wait', { id: asker.id, by: opts.name(holder), why: 'copy' });
                send(holder, 'db-give', { id: id, key: key });
            } else if (r.loader && r.loader !== asker.frame) {
                r.waiters.push(asker);
                send(asker.frame, 'db-wait', { id: asker.id, by: opts.name(r.loader), why: 'load' });
            } else {
                // Går svaret inte att skicka läser ingen in databasen, och ingen ska vänta på den.
                r.loader = send(asker.frame, 'db-result', { id: asker.id, data: null }) ? asker.frame : null;
                tidy(key);
            }
        }

        function serveWaiters(key) {
            var r = rec(key);
            var waiting = r.waiters;
            r.waiters = [];
            waiting.forEach(function (w) { serve(key, w); });
            tidy(key);
        }

        function given(frame, id, data) {
            var g = gives.get(id);
            if (!g || g.holder !== frame) return;
            gives.delete(id);
            g.cancel();
            if (data && data.bytes && send(g.asker.frame, 'db-result', { id: g.asker.id, data: data, by: opts.name(frame) }, [data.bytes])) return;
            // Verktyget har den inte längre, eller kopian gick inte att skicka: nästa som har den, annars läser
            // frågaren själv.
            var r = rec(g.key);
            r.holders = r.holders.filter(function (h) { return h !== frame; });
            serve(g.key, g.asker);
        }

        function handle(frame, d) {
            if (!frame || !d || typeof d.type !== 'string') return false;
            var key = typeof d.key === 'string' ? d.key : '';
            if (d.type === 'db-want' && key) {
                var r = rec(key);
                // Den som frågar har den inte, vad den än sa förut.
                r.holders = r.holders.filter(function (h) { return h !== frame; });
                serve(key, { frame: frame, id: d.id });
            } else if (d.type === 'db-unwant') {
                recs.forEach(function (r2, k) {
                    r2.waiters = r2.waiters.filter(function (w) { return !(w.frame === frame && w.id === d.id); });
                    tidy(k);
                });
                gives.forEach(function (g, id) {
                    if (g.asker.frame === frame && g.asker.id === d.id) { g.cancel(); gives.delete(id); }
                });
            } else if (d.type === 'db-have' && key) {
                var have = rec(key);
                if (have.holders.indexOf(frame) < 0) have.holders.push(frame);
                if (have.loader === frame) have.loader = null;
                serveWaiters(key);
            } else if (d.type === 'db-failed' && key) {
                var failed = recs.get(key);
                if (!failed || failed.loader !== frame) return true;
                failed.loader = null;
                // Den första som väntar läser nu själv, och de andra väntar på den.
                serveWaiters(key);
            } else if (d.type === 'db-gone') {
                recs.forEach(function (r3, k) {
                    if (!d.all && k !== key) return;
                    r3.holders = r3.holders.filter(function (h) { return h !== frame; });
                    tidy(k);
                });
            } else if (d.type === 'db-progress' && key) {
                var p = recs.get(key);
                if (!p || p.loader !== frame) return true;
                p.waiters.forEach(function (w) { send(w.frame, 'db-progress', { id: w.id, by: opts.name(frame), stage: d.stage, frac: d.frac }); });
            } else if (d.type === 'db-given') {
                given(frame, d.id, d.data || null);
            } else {
                return false;
            }
            return true;
        }

        // Verktygets ram har laddats, kanske om: det verktyget hade och höll på med finns inte längre. De som
        // väntade på det får en annan som har databasen, eller läser själva.
        function forget(frame) {
            gives.forEach(function (g, id) {
                if (g.holder === frame) given(frame, id, null);
                else if (g.asker.frame === frame) { g.cancel(); gives.delete(id); }
            });
            recs.forEach(function (r, key) {
                r.holders = r.holders.filter(function (h) { return h !== frame; });
                r.waiters = r.waiters.filter(function (w) { return w.frame !== frame; });
                if (r.loader === frame) { r.loader = null; serveWaiters(key); }
                else tidy(key);
            });
        }

        return {
            handle: handle,
            forget: forget,
            // Till testerna: vad som finns kvar.
            state: function () { return { keys: recs.size, gives: gives.size }; },
        };
    }

    // ---------- Verktygen ----------

    // port: { hub() -> finns huvudfönstret, post(payload, transfer), listen(fn(data)) }.
    // opts: { later, WeakRef } byts ut i testerna.
    function client(port, opts) {
        opts = opts || {};
        var wait = opts.later || later;
        var Weak = opts.WeakRef !== undefined ? opts.WeakRef : (typeof WeakRef !== 'undefined' ? WeakRef : null);
        var held = new Map();       // key -> { ref, head, facts }
        var asks = new Map();       // id -> { resolve, onWait, acked, cancel }
        var seq = 0;
        var mine = Math.random().toString(36).slice(2);

        function post(type, fields, transfer) {
            if (!port.hub()) return;
            var payload = { source: SOURCE, type: type };
            Object.keys(fields).forEach(function (k) { payload[k] = fields[k]; });
            port.post(payload, transfer);
        }

        function sameHead(bytes, head) {
            if (bytes.length < head.length) return false;
            for (var i = 0; i < head.length; i++) if (bytes[i] !== head[i]) return false;
            return true;
        }

        // En kopia av avbilden med uppgifterna om läsningen, eller null: databasen är stängd och minnet
        // lämnat tillbaka, något har skrivit i avbilden, eller minnet räcker inte till en kopia.
        function copyOf(key) {
            var h = held.get(key);
            if (!h) return null;
            var bytes = h.ref.deref();
            var data = null;
            try {
                if (bytes && bytes.length === h.length && sameHead(bytes, h.head)) {
                    data = { bytes: bytes.slice().buffer };
                    Object.keys(h.facts).forEach(function (k) { data[k] = h.facts[k]; });
                }
            } catch (err) { data = null; }
            if (!data) held.delete(key);
            return data;
        }

        function settle(id, value) {
            var a = asks.get(id);
            if (!a) return;
            asks.delete(id);
            a.cancel();
            a.resolve(value);
        }

        port.listen(function (d) {
            if (!d || typeof d.type !== 'string') return;
            if (d.type === 'db-give') {
                var data = copyOf(d.key);
                // Går uppgifterna inte att skicka ska frågaren ändå få ett svar, och läsa själv.
                try { post('db-given', { id: d.id, data: data }, data ? [data.bytes] : []); }
                catch (err) { held.delete(d.key); post('db-given', { id: d.id, data: null }, []); }
                return;
            }
            var a = asks.get(d.id);
            if (!a) return;
            if (d.type === 'db-wait' || d.type === 'db-progress') {
                a.acked = true;
                a.cancel();
                if (d.type === 'db-wait') a.why = d.why;
                if (a.onWait) a.onWait({ by: d.by, why: a.why, stage: d.type === 'db-progress' ? d.stage : null, frac: d.type === 'db-progress' ? d.frac : null });
            } else if (d.type === 'db-result') {
                if (!d.data || !d.data.bytes) { settle(d.id, null); return; }
                var got = {};
                Object.keys(d.data).forEach(function (k) { got[k] = d.data[k]; });
                got.bytes = new Uint8Array(d.data.bytes);
                // Vem som läste den ur extraktionen följer med, också när kopian har gått genom flera verktyg.
                got.readBy = d.data.readBy || d.by || '';
                settle(d.id, got);
            }
        });

        // Frågar efter databasen. Ger avbilden med uppgifterna, eller null: läs in den själv, och säg have()
        // eller failed() efteråt. onWait({ by, why, stage, frac }) medan ett annat verktyg läser in eller kopierar.
        function want(key, onWait) {
            if (!key || !port.hub() || !Weak) return Promise.resolve(null);
            return new Promise(function (resolve) {
                var id = mine + '-' + (++seq);
                var a = { resolve: resolve, onWait: onWait || null, acked: false, why: 'load', cancel: function () {} };
                asks.set(id, a);
                // Inget svar alls: det finns inget huvudfönster som förstår frågan. Ett svar kan stå i kö bakom
                // klockan när sidan har stått still, så det får en vända till på sig innan frågan ges upp.
                a.cancel = wait(function () {
                    a.cancel = wait(function () {
                        if (a.acked || !asks.has(id)) return;
                        post('db-unwant', { id: id });
                        settle(id, null);
                    }, 50);
                }, ACK_MS);
                post('db-want', { id: id, key: key });
            });
        }

        // Avbilden som verktyget nu har, och uppgifterna om läsningen som ska följa med en kopia. En avbild som
        // inte går att dela (en fil under 100 byte, som en tom databas) sägs som misslyckad: annars väntar nästa
        // verktyg för alltid på en läsning som redan är klar.
        function have(key, bytes, facts) {
            if (!key || !Weak) return;
            if (!bytes || bytes.length < HEAD) { failed(key); return; }
            held.set(key, { ref: new Weak(bytes), length: bytes.length, head: bytes.slice(0, HEAD), facts: facts || {} });
            post('db-have', { key: key });
        }

        function failed(key) { if (key) post('db-failed', { key: key }); }

        function gone(key) {
            if (key) { held.delete(key); post('db-gone', { key: key }); }
            else { held.clear(); post('db-gone', { all: true }); }
        }

        function progress(key, stage, frac) { if (key) post('db-progress', { key: key, stage: stage, frac: typeof frac === 'number' ? frac : null }); }

        return { want: want, have: have, failed: failed, gone: gone, progress: progress, holds: function (key) { return held.has(key); } };
    }

    // Verktygets väg till huvudfönstret. Huvudfönstret finns när det har hörts av: det skickar tema och extraktion
    // när ramen laddas. Fristående, eller i en annan sida än Forensics Toolbox, delas ingenting.
    function windowPort(win) {
        var host = win.parent;
        var seen = false;
        var handlers = [];
        if (host && host !== win && win.addEventListener) {
            win.addEventListener('message', function (event) {
                var d = event.data;
                if (event.source !== host || !d || d.source !== SOURCE) return;
                seen = true;
                if (typeof d.type === 'string' && d.type.indexOf('db-') === 0) handlers.forEach(function (fn) { fn(d); });
            });
        }
        return {
            hub: function () { return seen; },
            post: function (payload, transfer) { host.postMessage(payload, '*', transfer || []); },
            listen: function (fn) { handlers.push(fn); },
        };
    }

    var api = { SOURCE: SOURCE, ACK_MS: ACK_MS, GIVE_MS: GIVE_MS, keyOf: keyOf, registry: registry, createClient: client, windowPort: windowPort };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else {
        // Huvudfönstret använder registry; ett verktyg i en ram får sin client.
        api.client = root.parent && root.parent !== root ? client(windowPort(root)) : null;
        root.DbShare = api;
    }
})(typeof window !== 'undefined' ? window : this);
