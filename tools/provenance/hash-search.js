// Sök på hashsumma i Härkomst: vilka inmatningar som är hashsummor, i vilken ordning zippens filer
// läses, och själva sökningen. Zippens innehållsförteckning har bara CRC32, så varje fil måste läsas
// och hashas. Bilder och videor läses först, sedan filer utan ändelse (många appars cache) och sist
// resten. Sökningen stannar när alla summor är hittade; hittas en summa inte har alla filer lästs.
// Summor som redan räknats sparas per zip, så att nästa sökning inte läser om samma filer.
// Ingen DOM. Testas i Node.
(function (root) {
    'use strict';

    var ALGO_BY_LENGTH = { 32: 'md5', 40: 'sha1', 64: 'sha256' };
    var LABEL = { md5: 'MD5', sha1: 'SHA-1', sha256: 'SHA-256' };
    var MEDIA = /\.(jpe?g|heic|heif|png|gif|webp|bmp|tiff?|dng|avif|mp4|mov|m4v|3gp|avi|mkv|webm)$/i;
    var TIER_TEXT = ['bild- och videofilerna', 'filerna utan ändelse', 'övriga filer'];

    // 'md5', 'sha1', 'sha256' eller null. Bara hexadecimala tecken, rätt längd.
    function algoOf(text) {
        var t = String(text == null ? '' : text).trim();
        return /^[0-9a-f]+$/i.test(t) ? ALGO_BY_LENGTH[t.length] || null : null;
    }

    function label(algo) { return LABEL[algo] || String(algo || '').toUpperCase(); }

    function baseName(n) { return String(n).slice(String(n).lastIndexOf('/') + 1); }

    function tierOf(name) {
        var b = baseName(name);
        return MEDIA.test(b) ? 0 : b.indexOf('.') < 0 ? 1 : 2;
    }

    // Filerna i läsordning, i tre grupper. Inom en grupp i zippens ordning, så att läsningen går framåt i filen.
    function plan(entries) {
        var tiers = [[], [], []];
        (entries || []).forEach(function (e) {
            if (e.name.charAt(e.name.length - 1) === '/') return;
            tiers[tierOf(e.name)].push(e);
        });
        tiers.forEach(function (t) { t.sort(function (a, b) { return a.localOffset - b.localOffset; }); });
        return tiers.map(function (list, i) {
            return { tier: i, text: TIER_TEXT[i], entries: list, bytes: list.reduce(function (s, e) { return s + e.size; }, 0) };
        });
    }

    function keyOf(e) { return e.localOffset + ':' + e.name; }

    function emptyCache() { return { md5: {}, sha1: {}, sha256: {} }; }

    // entries: zippens poster. wanted: hashsummor (versaler går bra). cache: emptyCache(), sparas per zip.
    // deps: { stream(entry, onChunk) -> Promise, hasher(algo) -> { update(bytes), digestHex() },
    //         shouldStop() -> bool, onProgress({ done, total, doneBytes, bytes (lästa nu), totalBytes, tier, tierText, tierDone, tierTotal, tierBytes, tierBytesTotal }),
    //         tick() -> Promise (låter sidan rita) }
    // Returnerar { found: { summa: [poster] }, missing: [summor], read, bytes, total, totalBytes, skipped: [{ entry, reason }],
    //              stopped (undersökaren avbröt), complete (alla filer genomgångna) }.
    // Kopiorna: när en summa hittats kontrolleras alla poster med samma storlek och CRC32, så att listan
    // över var innehållet finns blir hel även om sökningen stannade vid den första träffen.
    async function search(entries, wanted, cache, deps) {
        var want = {};
        var algos = {};
        (wanted || []).forEach(function (h) {
            var a = algoOf(h);
            if (!a) return;
            want[String(h).trim().toLowerCase()] = a;
            algos[a] = true;
        });
        var algoList = Object.keys(algos);
        var left = Object.keys(want).length;
        var found = {};
        var tiers = plan(entries);
        var total = 0, totalBytes = 0;
        tiers.forEach(function (t) { total += t.entries.length; totalBytes += t.bytes; });
        var done = 0, doneBytes = 0, bytes = 0, readCount = 0;
        var skipped = [];
        var stopped = false;
        var tick = deps.tick || function () { return Promise.resolve(); };

        function note(e, hex) {
            if (!want[hex]) return;
            if (!found[hex]) { found[hex] = []; left--; }
            if (found[hex].indexOf(e) < 0) found[hex].push(e);
        }

        // Räknar de summor posten saknar i cachen. false om posten inte gick att läsa.
        async function hashEntry(e, list) {
            var key = keyOf(e);
            var need = list.filter(function (a) { return cache[a][key] === undefined; });
            if (!need.length) return true;
            var hs = need.map(function (a) { return { a: a, h: deps.hasher(a) }; });
            try {
                await deps.stream(e, function (chunk) { hs.forEach(function (x) { x.h.update(chunk); }); });
            } catch (err) {
                skipped.push({ entry: e, reason: err && err.message ? err.message : String(err) });
                return false;
            }
            hs.forEach(function (x) { cache[x.a][key] = x.h.digestHex(); });
            readCount++;
            bytes += e.size;
            return true;
        }

        outer:
        for (var t = 0; t < tiers.length; t++) {
            var list = tiers[t].entries;
            var tierDone = 0, tierBytes = 0;
            for (var i = 0; i < list.length; i++) {
                if (left === 0) break outer;
                if (deps.shouldStop && deps.shouldStop()) { stopped = true; break outer; }
                var e = list[i];
                var fresh = algoList.some(function (a) { return cache[a][keyOf(e)] === undefined; });
                if (await hashEntry(e, algoList)) algoList.forEach(function (a) { note(e, cache[a][keyOf(e)]); });
                done++;
                doneBytes += e.size;
                tierDone++;
                tierBytes += e.size;
                if (deps.onProgress) deps.onProgress({ done: done, total: total, doneBytes: doneBytes, bytes: bytes, totalBytes: totalBytes, tier: t, tierText: tiers[t].text, tierDone: tierDone, tierTotal: list.length, tierBytes: tierBytes, tierBytesTotal: tiers[t].bytes });
                // Ur cachen går det fort: sidan får rita då och då ändå.
                if (!fresh && done % 2000 === 0) await tick();
            }
        }
        var complete = !stopped && done === total;

        // Kopiorna av det som hittats: samma storlek och CRC32, bekräftade med samma summa.
        var hexes = Object.keys(found);
        for (var k = 0; k < hexes.length; k++) {
            var hex = hexes[k];
            var algo = want[hex];
            var firstHit = found[hex][0];
            var twins = [];
            tiers.forEach(function (tt) { tt.entries.forEach(function (x) { if (x.size === firstHit.size && x.crc32 === firstHit.crc32 && found[hex].indexOf(x) < 0) twins.push(x); }); });
            for (var j = 0; j < twins.length; j++) {
                if (await hashEntry(twins[j], [algo]) && cache[algo][keyOf(twins[j])] === hex) found[hex].push(twins[j]);
            }
            found[hex].sort(function (a, b) { return a.localOffset - b.localOffset; });
        }
        return {
            found: found,
            missing: Object.keys(want).filter(function (h) { return !found[h]; }),
            read: readCount, bytes: bytes, total: total, totalBytes: totalBytes, done: done,
            skipped: skipped, stopped: stopped, complete: complete,
        };
    }

    // Varför en summa inte hittades, i klartext. res: svaret från search(). sizeText(byte) -> text.
    function missingText(algo, res, sizeText) {
        var what = label(algo);
        if (res.stopped) return 'Sökningen avbröts efter ' + res.done.toLocaleString('sv-SE') + ' av ' + res.total.toLocaleString('sv-SE') + ' filer, innan ' + what + ':n hittades.';
        var text = 'Ingen fil i zippen har den ' + what + ':n. Alla ' + res.total.toLocaleString('sv-SE') + ' filerna (' + sizeText(res.totalBytes) + ') är genomsökta';
        if (res.skipped.length) text += ', utom ' + res.skipped.length + (res.skipped.length === 1 ? ' fil som inte gick att läsa' : ' filer som inte gick att läsa') + ' (' + res.skipped.slice(0, 3).map(function (s) { return baseName(s.entry.name); }).join(', ') + (res.skipped.length > 3 ? ' …' : '') + ')';
        return text + '.';
    }

    var api = { algoOf: algoOf, label: label, tierOf: tierOf, plan: plan, keyOf: keyOf, emptyCache: emptyCache, search: search, missingText: missingText, TIER_TEXT: TIER_TEXT };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceHashSearch = api;
})(typeof window !== 'undefined' ? window : this);
