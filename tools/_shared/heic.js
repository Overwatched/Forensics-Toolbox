// HEIC och HEIF i verktygen. Chromium ritar inte formatet, så bilden avkodas med libheif (vendor/libheif,
// LGPL-3.0) i en egen tråd och lämnas tillbaka som en JPEG. Avkodaren laddas först när en HEIC ska visas, och
// bara det som visas avkodas: anroparen frågar efter en bild när den ska ritas.
//
//   Heic.is(bytes)                 filen är HEIC/HEIF, efter innehållet (ftyp), inte ändelsen
//   Heic.isName(name)              ändelsen .heic, .heif eller .hif
//   Heic.toJpeg(bytes, opts)       → Promise<{ blob, w, h, width, height, from }>
//                                  opts.preview: filens egen förhandsbild om den finns (snabb, för listor)
//                                  opts.maxSide: förminska till högst så många bildpunkter på längsta sidan
//   Heic.url(bytes, opts)          → Promise<objekt-URL till JPEG:en>
//
// Två trådar: en för förhandsbilder och små bilder, en för hela bilder, så att en stor bild som avkodas inte
// håller kvar en lista. Testas i Node (heic.test.js) utan sida och worker.
(function (root) {
    'use strict';

    // ftyp-lådans märken. mif1/msf1 är också AVIF, som Chromium ritar själv: med avif och utan HEVC-märke är det inte HEIC.
    var HEVC = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'];
    var HEIF = HEVC.concat(['mif1', 'msf1', 'mif2']);
    var AV1 = ['avif', 'avis'];

    function brands(bytes) {
        var b = bytes && (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
        if (!b || b.length < 16) return null;
        var fc = function (i) { return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]); };
        if (fc(4) !== 'ftyp') return null;
        var size = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0, end = Math.min(size, b.length), out = [fc(8)];
        for (var i = 16; i + 4 <= end; i += 4) out.push(fc(i));
        return out;
    }
    function is(bytes) {
        var list = brands(bytes);
        if (!list) return false;
        var has = function (set) { return list.some(function (x) { return set.indexOf(x) >= 0; }); };
        if (has(AV1) && !has(HEVC)) return false;
        return has(HEIF);
    }
    function isName(name) { return /\.(heic|heif|hif)$/i.test(String(name || '')); }

    // ---------- Trådarna ----------

    var base = (function () {
        var s = root.document && root.document.currentScript && root.document.currentScript.src;
        return s ? s.slice(0, s.lastIndexOf('/') + 1) : '';
    })();
    var source = null;
    function loadSource() {
        if (root.LIBHEIF_WORKER_SOURCE) return Promise.resolve();
        if (!source) {
            source = new Promise(function (resolve, reject) {
                var s = root.document.createElement('script');
                s.src = base + 'vendor/libheif/libheif-worker.js';
                s.onload = function () { root.LIBHEIF_WORKER_SOURCE ? resolve() : reject(new Error('Avkodaren för HEIC saknas.')); };
                s.onerror = function () { source = null; reject(new Error('Avkodaren för HEIC kunde inte laddas (vendor/libheif).')); };
                root.document.head.appendChild(s);
            });
        }
        return source;
    }

    var lanes = {};
    function lane(name) {
        if (lanes[name]) return lanes[name];
        var L = lanes[name] = { jobs: {}, seq: 0, worker: null };
        L.ready = loadSource().then(function () {
            var url = URL.createObjectURL(new Blob([root.LIBHEIF_WORKER_SOURCE], { type: 'text/javascript' }));
            var w = new Worker(url);
            L.worker = w;
            w.onmessage = function (e) {
                var d = e.data || {};
                if (d.ready) { URL.revokeObjectURL(url); return; }
                var job = L.jobs[d.id];
                if (!job) return;
                delete L.jobs[d.id];
                if (d.ok) job.resolve(d);
                else job.reject(new Error(d.error || 'HEIC-filen kunde inte avkodas.'));
            };
            // Kraschar tråden (för lite minne för en stor bild) får alla som väntar ett fel, och nästa bild startar en ny.
            w.onerror = function (e) {
                e.preventDefault();
                Object.keys(L.jobs).forEach(function (id) { L.jobs[id].reject(new Error('Avkodaren för HEIC stannade: ' + (e.message || 'okänt fel') + '.')); });
                L.jobs = {};
                w.terminate();
                delete lanes[name];
            };
        });
        L.ready.catch(function () { delete lanes[name]; });
        return L;
    }

    function toJpeg(bytes, opts) {
        opts = opts || {};
        var small = opts.preview || (opts.maxSide && opts.maxSide <= 640);
        var L = lane(small ? 'small' : 'big');
        return L.ready.then(function () {
            return new Promise(function (resolve, reject) {
                var id = ++L.seq;
                L.jobs[id] = { resolve: resolve, reject: reject };
                // Bytena kopieras till tråden: den som frågar har kvar sina (de är ofta zippens cache).
                L.worker.postMessage({ id: id, bytes: bytes, preview: !!opts.preview, maxSide: opts.maxSide || 0 });
            });
        });
    }
    function url(bytes, opts) {
        return toJpeg(bytes, opts).then(function (r) { return URL.createObjectURL(r.blob); });
    }

    var api = { is: is, isName: isName, brands: brands, toJpeg: toJpeg, url: url };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Heic = api;
})(typeof window !== 'undefined' ? window : this);
