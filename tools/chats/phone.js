// Telefonen i Chattar: hemskärmen med apparna som har data i extraktionen, appens lista med chattar och galleriet
// med bilderna ur bildbiblioteket (Photos.sqlite på iOS, MediaStore på Android). Det som går att pröva utan sida
// (apparna, bildernas nycklar i zippen, galleriets rader och cachen för bilderna) testas i Node; Gallery ritar.
(function (root) {
    'use strict';

    var node = typeof module !== 'undefined' && module.exports;

    // ---------- Hemskärmen ----------

    // Apparna med en databas i extraktionen, i den ordning databaserna hittades. count: konversationerna i de
    // databaser som är lästa; busy: någon läses fortfarande; error: alla gick fel.
    function homeApps(dbs) {
        var out = [], by = {};
        dbs.forEach(function (d, di) {
            var app = d.src.app, a = by[app];
            if (!a) { a = by[app] = { app: app, count: 0, dbs: [], busy: false, ready: 0, errors: 0 }; out.push(a); }
            a.dbs.push(di);
            if (d.state === 'ready') { a.ready++; a.count += d.threads.length; }
            else if (d.state === 'error') a.errors++;
            else if (d.state === 'busy' || d.state === 'wait') a.busy = true;
        });
        out.forEach(function (a) { a.error = !a.ready && a.errors === a.dbs.length; });
        return out;
    }

    // Konversationerna i appens lästa databaser, den senaste först. Utan tid sist.
    function appThreads(dbs, indices) {
        var out = [];
        indices.forEach(function (di) {
            var d = dbs[di];
            if (d.state === 'ready') d.threads.forEach(function (t) { out.push({ db: di, thread: t }); });
        });
        var last = function (x) { return x.thread.lastMs === null || x.thread.lastMs === undefined ? -Infinity : x.thread.lastMs; };
        return out.sort(function (a, b) { return last(b) - last(a); });
    }

    // ---------- Bilderna ----------

    var MEDIA = /\.(jpe?g|png|gif|webp|bmp|heic|heif|dng|tiff?|mov|mp4|m4v|3gp|mkv|webm)$/i;
    var VIDEO = /\.(mov|mp4|m4v|3gp|mkv|webm)$/i;
    // Format som sidan kan rita. HEIC, DNG och TIFF kan den inte; där behövs telefonens tumnagel.
    var DRAWABLE = /\.(jpe?g|png|gif|webp|bmp)$/i;
    // HEIC och HEIF ritas med avkodaren i tools/_shared/heic.js.
    var HEIF = /\.(heic|heif|hif)$/i;

    // Vad en post i zippen är för galleriet. iOS: telefonens tumnagel PhotoData/Thumbnails/V2/<mapp>/<fil>/5005.JPG,
    // och originalet under Media/<mapp>/<fil>. Android: filen under DCIM/ eller Pictures/ i lagringen. key är
    // mappen och filen med små bokstäver, som i bildbibliotekets rad.
    function entryKey(name) {
        var n = '/' + String(name).replace(/\\/g, '/').replace(/^\/+/, ''), m;
        if ((m = /\/PhotoData\/Thumbnails\/V2\/(.+)\/5005\.jpg$/i.exec(n))) return { kind: 'thumb', key: m[1].toLowerCase() };
        if (/\/PhotoData\/(Thumbnails|Caches|Metadata|Mutations)\//i.test(n) || !MEDIA.test(n)) return null;
        if ((m = /\/Media\/((?:DCIM|PhotoData\/CPLAssets)\/.+)$/i.exec(n))) return { kind: 'file', key: m[1].toLowerCase() };
        if ((m = /\/((?:DCIM|Pictures)\/.+)$/i.exec(n))) return { kind: 'file', key: m[1].toLowerCase() };
        return null;
    }

    // Raderna ur bildbibliotekets roll (neighbours, med fälten mappade) som bilder i galleriet, den senaste först.
    // iOS har mappen och filen (directory, filename), Android den relativa sökvägen (relativePath).
    function photoItems(rows) {
        var out = rows.map(function (r, i) {
            var dir = r.directory !== undefined && r.directory !== null ? String(r.directory).replace(/\/+$/, '') + '/' : String(r.relativePath || '');
            var name = String(r.filename || '');
            var ms = typeof r.createdMs === 'number' && isFinite(r.createdMs) ? r.createdMs : typeof r.addedMs === 'number' && isFinite(r.addedMs) ? r.addedMs : null;
            return {
                i: i, key: (dir + name).toLowerCase(), dir: dir, name: name, ms: ms, timeField: typeof r.createdMs === 'number' && isFinite(r.createdMs) ? 'created' : ms !== null ? 'added' : '',
                video: VIDEO.test(name), drawable: DRAWABLE.test(name), heif: HEIF.test(name), trashed: Number(r.trashed) === 1, importer: r.importer || '', pk: r.pk, raw: r._raw || null,
            };
        });
        return out.sort(function (a, b) { return (b.ms === null ? -Infinity : b.ms) - (a.ms === null ? -Infinity : a.ms) || a.i - b.i; });
    }

    // Rader i galleriet: en rubrik per månad och sedan rader med cols bilder. y i bildpunkter från början.
    // monthOf(ms) ger rubriken ('Utan tid' när tiden saknas).
    function layout(items, width, opts) {
        var cols = opts.cols, gap = opts.gap, headH = opts.headH;
        var tile = Math.max(1, Math.floor((width - gap * (cols - 1)) / cols));
        var rows = [], y = 0, month = null, row = null;
        items.forEach(function (it, i) {
            var mo = opts.monthOf(it.ms);
            if (mo !== month) { month = mo; rows.push({ y: y, h: headH, month: mo }); y += headH; row = null; }
            if (!row || row.items.length === cols) { row = { y: y, h: tile, items: [] }; rows.push(row); y += tile + gap; }
            row.items.push(i);
        });
        return { rows: rows, height: y, tile: tile, cols: cols, gap: gap };
    }

    // Raderna som syns mellan top och bottom: [from, to).
    function rowsBetween(rows, top, bottom) {
        var lo = 0, hi = rows.length;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (rows[mid].y + rows[mid].h <= top) lo = mid + 1; else hi = mid; }
        var to = lo;
        while (to < rows.length && rows[to].y < bottom) to++;
        return [lo, to];
    }

    // Blob-adresserna för bilderna, högst max. Den som använts längst sedan tas bort först, men aldrig en som syns.
    function UrlCache(max, revoke) {
        this.max = max;
        this.map = new Map();
        this.revoke = revoke || function () {};
    }
    UrlCache.prototype.get = function (key) {
        var u = this.map.get(key);
        if (u !== undefined) { this.map.delete(key); this.map.set(key, u); }
        return u;
    };
    UrlCache.prototype.set = function (key, url, keep) {
        if (this.map.has(key)) this.revoke(this.map.get(key));
        this.map.delete(key);
        this.map.set(key, url);
        var it = this.map.keys();
        for (var k = it.next(); this.map.size > this.max && !k.done; k = it.next()) {
            if (keep && keep(k.value)) continue;
            this.revoke(this.map.get(k.value));
            this.map.delete(k.value);
        }
    };
    UrlCache.prototype.clear = function () {
        var self = this;
        this.map.forEach(function (u) { self.revoke(u); });
        this.map.clear();
    };

    // ---------- Galleriet i sidan ----------

    // Filens ändelse, för en ruta utan bild (HEIC utan tumnagel, en video utan tumnagel, en fil som saknas).
    function extOf(name) { var m = /\.([^.\/]+)$/.exec(String(name || '')); return m ? m[1].toUpperCase() : '?'; }

    // Ritar bara raderna som syns och en skärm åt varje håll. Bilderna läses när rullningen har stannat (IDLE ms),
    // högst PARALLEL åt gången, och den som syns läses först. opts: { box (rullar), items, url(item) → Promise<url
    // eller null>, open(item), monthOf(ms), cols }.
    var IDLE = 120, PARALLEL = 6, MAX_URLS = 400;
    function Gallery(opts) {
        this.o = opts;
        this.box = opts.box;
        this.space = document.createElement('div');
        this.space.className = 'g-space';
        this.box.textContent = '';
        this.box.appendChild(this.space);
        this.drawn = new Map();
        this.urls = new UrlCache(MAX_URLS, function (u) { URL.revokeObjectURL(u); });
        this.queue = [];
        this.busy = 0;
        this.timer = null;
        this.gone = false;
        this.stats = { loads: 0, failed: 0 };
        var self = this;
        this.onScroll = function () {
            if (self.frame) return;
            self.frame = requestAnimationFrame(function () { self.frame = null; self.paint(false); });
        };
        this.box.addEventListener('scroll', this.onScroll, { passive: true });
        this.space.addEventListener('click', function (e) {
            var t = e.target.closest('.g-tile');
            if (t) self.o.open(self.o.items[Number(t.dataset.i)], t);
        });
        this.relayout();
    }
    Gallery.prototype.relayout = function () {
        var w = this.box.clientWidth;
        if (!w) return;
        this.width = w;
        this.lay = layout(this.o.items, w, { cols: this.o.cols || 4, gap: 2, headH: 34, monthOf: this.o.monthOf });
        this.space.style.height = this.lay.height + 'px';
        this.drawn.forEach(function (el) { el.remove(); });
        this.drawn.clear();
        this.paint(true);
    };
    Gallery.prototype.paint = function (now) {
        if (this.gone) return;
        if (this.box.clientWidth !== this.width) return this.relayout();
        var top = this.box.scrollTop, h = this.box.clientHeight, lay = this.lay, self = this;
        var span = rowsBetween(lay.rows, Math.max(0, top - h), top + 2 * h);
        this.drawn.forEach(function (el, r) { if (r < span[0] || r >= span[1]) { el.remove(); self.drawn.delete(r); } });
        for (var r = span[0]; r < span[1]; r++) if (!this.drawn.has(r)) this.drawRow(r);
        clearTimeout(this.timer);
        this.timer = setTimeout(function () { self.load(); }, now ? 0 : IDLE);
    };
    Gallery.prototype.drawRow = function (r) {
        var row = this.lay.rows[r], el = document.createElement('div'), lay = this.lay, self = this;
        el.className = row.month ? 'g-month' : 'g-row';
        el.style.top = row.y + 'px';
        if (row.month) el.textContent = row.month;
        else {
            el.style.height = row.h + 'px';
            row.items.forEach(function (i, k) {
                var it = self.o.items[i], t = document.createElement('button');
                t.type = 'button';
                t.className = 'g-tile' + (it.video ? ' video' : '') + (it.trashed ? ' trashed' : '');
                t.dataset.i = String(i);
                t.style.cssText = 'left:' + k * (lay.tile + lay.gap) + 'px;width:' + lay.tile + 'px;height:' + lay.tile + 'px';
                t.setAttribute('aria-label', it.name + (it.trashed ? ', i papperskorgen' : ''));
                var u = self.urls.get(it.key);
                if (u) { t.appendChild(self.img(u)); t.classList.add('has'); }
                else if (u === null) { t.classList.add('none'); t.textContent = extOf(it.name); }
                el.appendChild(t);
            });
        }
        this.space.appendChild(el);
        this.drawn.set(r, el);
    };
    Gallery.prototype.img = function (u) {
        var img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.src = u;
        return img;
    };
    // Bilderna som syns och saknar sin bild, uppifrån.
    Gallery.prototype.load = function () {
        var self = this, box = this.box.getBoundingClientRect(), want = [];
        this.space.querySelectorAll('.g-tile:not(.has):not(.none)').forEach(function (t) {
            var r = t.getBoundingClientRect();
            if (r.bottom > box.top - box.height && r.top < box.bottom + box.height) want.push({ t: t, near: r.bottom > box.top && r.top < box.bottom });
        });
        want.sort(function (a, b) { return b.near - a.near; });
        this.queue = want.map(function (w) { return Number(w.t.dataset.i); });
        this.pump();
    };
    Gallery.prototype.pump = function () {
        var self = this;
        while (this.busy < PARALLEL && this.queue.length && !this.gone) {
            var i = this.queue.shift(), it = this.o.items[i];
            if (this.urls.map.has(it.key)) { this.show(i); continue; }
            this.busy++;
            (function (i, it) {
                Promise.resolve().then(function () { return self.o.url(it); }).then(function (u) {
                    if (self.gone) { if (u) URL.revokeObjectURL(u); return; }
                    self.stats.loads++;
                    self.urls.set(it.key, u || null, function (k) { return self.isShown(k); });
                    self.show(i);
                }, function () {
                    self.stats.failed++;
                    if (!self.gone) { self.urls.set(it.key, null); self.show(i); }
                }).then(function () { self.busy--; self.pump(); });
            })(i, it);
        }
    };
    Gallery.prototype.isShown = function (key) {
        var self = this, hit = false;
        this.drawn.forEach(function (el) { if (!hit && el.querySelectorAll) el.querySelectorAll('.g-tile').forEach(function (t) { if (self.o.items[Number(t.dataset.i)].key === key) hit = true; }); });
        return hit;
    };
    Gallery.prototype.show = function (i) {
        var t = this.space.querySelector('.g-tile[data-i="' + i + '"]');
        if (!t) return;
        var u = this.urls.map.get(this.o.items[i].key);
        if (u) { t.textContent = ''; t.appendChild(this.img(u)); t.classList.add('has'); }
        else { t.classList.add('none'); t.textContent = extOf(this.o.items[i].name); }
    };
    // Galleriet står på en bild: rullat så att den syns.
    Gallery.prototype.reveal = function (i) {
        var lay = this.lay;
        for (var r = 0; r < lay.rows.length; r++) {
            if (lay.rows[r].items && lay.rows[r].items.indexOf(i) >= 0) { this.box.scrollTop = Math.max(0, lay.rows[r].y - 40); break; }
        }
    };
    Gallery.prototype.destroy = function () {
        this.gone = true;
        clearTimeout(this.timer);
        if (this.frame) cancelAnimationFrame(this.frame);
        this.box.removeEventListener('scroll', this.onScroll);
        this.urls.clear();
        this.box.textContent = '';
    };

    var api = {
        homeApps: homeApps, appThreads: appThreads, entryKey: entryKey, photoItems: photoItems, layout: layout, rowsBetween: rowsBetween,
        UrlCache: UrlCache, Gallery: Gallery, VIDEO: VIDEO, DRAWABLE: DRAWABLE, MAX_URLS: MAX_URLS,
    };
    if (node) module.exports = api;
    else root.ChatPhone = api;
})(typeof window !== 'undefined' ? window : this);
