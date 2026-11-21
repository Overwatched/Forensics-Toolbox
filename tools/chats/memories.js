// Snapchat Memories på iPhone i Telefonen: snapsen ur scdb-27.sqlite3, positionerna, platsnamnen och nyckeln per snap
// ur gallery.encrypteddb (SQLCipher 3, nyckeln i nyckelringen), och filerna i Snapchats cache (cache_controller.db och
// mappen com.snap.file_manager_3_SCContent_…). Varje fil är krypterad med AES-256-CBC med snapens nyckel och iv.
// En snap i My Eyes Only har nyckeln krypterad (snap_key_iv.encrypted = 1): med Snapchats nyckeltjänst i nyckelringen
// (com.snapchat.keyservice.persistedkey, masterKey och IV) öppnas den med AES-256-CBC (unlock). Ingen lösenkod behövs.
// Kontrollerat på iPhone-labbet 2026-11-19: 23 filer dekrypterades till JPEG, MP4 och WebP. Testas i Node.
(function (root) {
    'use strict';

    var FILES = {
        scdb: /\/gallery_data_object\/\d+\/[^/]+\/scdb-27\.sqlite3$/,
        gallery: /\/gallery_encrypted_db\/\d+\/[^/]+\/gallery\.encrypteddb$/,
        cache: /\/global_scoped\/cachecontroller\/cache_controller\.db$/,
    };
    // Filerna i Snapchats cache heter som CACHE_KEY i cache_controller.db.
    var FILE_MANAGER = /\/com\.snap\.file_manager_3_SCContent_[^/]+\/[^/]+$/;

    var COCOA = 978307200;
    var SQL = {
        snaps: 'SELECT s.ZSNAPID AS id, s.ZCAPTURETIMEUTC AS capture, s.ZCREATETIMEUTC AS created, e.ZDUPLICATETIMEUTC AS duplicated, s.ZMEDIAFORMAT AS format, ' +
            's.ZDURATION AS duration, s.ZWIDTH AS w, s.ZHEIGHT AS h, s.ZHASOVERLAYIMAGE AS overlay, e.ZISPRIVATE AS meo, s.ZTIMEZONENAME AS zone, ' +
            's.ZCAMERAFRONTFACING AS front, s.ZDUPLICATEDFROMSNAPID AS copyOf, e.ZENTRYID AS entry FROM ZGALLERYSNAP s LEFT JOIN ZGALLERYENTRY e ON e.Z_PK = s.ZENTRY',
        keys: 'SELECT snap_id AS id, key AS key, iv AS iv, encrypted AS encrypted FROM snap_key_iv',
        locations: 'SELECT l.snap_id AS id, l.latitude AS lat, l.longitude AS lon, t.address_title AS address FROM snap_location_table l LEFT JOIN snap_address_title t ON t.snap_id = l.snap_id',
        titles: 'SELECT snap_id AS id, address_title AS address FROM snap_address_title',
        claims: 'SELECT CACHE_KEY AS cacheKey, MEDIA_CONTEXT_TYPE AS ctx, EXTERNAL_KEY AS ext FROM CACHE_FILE_CLAIM WHERE EXTERNAL_KEY IS NOT NULL',
    };

    function which(name) {
        var n = '/' + String(name).replace(/\\/g, '/').replace(/^\/+/, '');
        var wal = /-wal$/.test(n);
        var base = wal ? n.slice(0, -4) : n;
        for (var k in FILES) if (FILES[k].test(base)) return { id: k, wal: wal };
        return null;
    }

    // Filerna i zippen: { scdb, gallery, cache } med { entry, wal }.
    function pick(entries) {
        var out = {};
        (entries || []).forEach(function (e) {
            var w = which(e.name);
            if (!w) return;
            var o = out[w.id] || (out[w.id] = { entry: null, wal: null });
            if (w.wal) o.wal = e; else o.entry = e;
        });
        Object.keys(out).forEach(function (k) { if (!out[k].entry) delete out[k]; });
        return out;
    }

    function cocoaMs(v) {
        var n = Number(v);
        return v === null || v === undefined || v === '' || !isFinite(n) || n === 0 ? null : Math.round((n + COCOA) * 1000);
    }

    function bytesOf(v) {
        if (v instanceof Uint8Array) return v;
        if (v && typeof v === 'object' && typeof v.length === 'number') return new Uint8Array(v);
        return null;
    }

    // Filen för en snap ur cachens EXTERNAL_KEY: snap-media-<id> (bilden eller videon), <id>~1 (video) och
    // snap-overlay-<id> (texten och ritningen ovanpå).
    function claimOf(ext, ids) {
        var m = /^snap-(media|overlay)-(.+)$/.exec(ext);
        if (m && ids[m[2]]) return { id: m[2], part: m[1] };
        m = /^(.+)~\d+$/.exec(ext);
        if (m && ids[m[1]]) return { id: m[1], part: 'media' };
        return null;
    }

    // En lista med Memories, nyast först: { id, captureMs, savedMs, kind, durationS, w, h, meo, keyLocked, key, iv,
    // lat, lon, address, media: cacheKey, overlay: cacheKey, zone, front, copyOf }.
    function build(snaps, keys, locations, claims) {
        var byKey = {}, byLoc = {}, ids = {};
        (keys || []).forEach(function (k) { byKey[k.id] = k; });
        (locations || []).forEach(function (l) { byLoc[l.id] = l; });
        var list = (snaps || []).map(function (s) {
            ids[s.id] = true;
            var k = byKey[s.id] || null, l = byLoc[s.id] || null;
            var lat = l ? Number(l.lat) : NaN, lon = l ? Number(l.lon) : NaN;
            var created = cocoaMs(s.created), dup = cocoaMs(s.duplicated);
            return {
                id: String(s.id), captureMs: cocoaMs(s.capture), savedMs: Math.max(created || 0, dup || 0) || null,
                kind: Number(s.format) === 0 ? 'video' : Number(s.format) === 1 ? 'bild' : 'format ' + s.format,
                durationS: Number(s.duration) > 0 ? Number(s.duration) : null, w: Number(s.w) || null, h: Number(s.h) || null,
                meo: Number(s.meo) === 1, overlay: null, hasOverlay: Number(s.overlay) === 1, zone: s.zone || '', front: Number(s.front) === 1, copyOf: s.copyOf || '',
                keyLocked: !!k && Number(k.encrypted) === 1, key: k && Number(k.encrypted) !== 1 ? bytesOf(k.key) : null, iv: k && Number(k.encrypted) !== 1 ? bytesOf(k.iv) : null,
                lockedKey: k && Number(k.encrypted) === 1 ? bytesOf(k.key) : null, lockedIv: k && Number(k.encrypted) === 1 ? bytesOf(k.iv) : null, unlocked: false,
                hasKey: !!k, lat: isFinite(lat) && isFinite(lon) && !(lat === 0 && lon === 0) ? lat : null, lon: isFinite(lat) && isFinite(lon) && !(lat === 0 && lon === 0) ? lon : null,
                address: l && l.address ? String(l.address) : '', media: null,
            };
        });
        var byId = {};
        list.forEach(function (m) { byId[m.id] = m; });
        (claims || []).forEach(function (c) {
            var hit = c.ext ? claimOf(String(c.ext), ids) : null;
            if (!hit) return;
            var m = byId[hit.id];
            if (hit.part === 'overlay') { if (!m.overlay) m.overlay = String(c.cacheKey); }
            else if (!m.media) m.media = String(c.cacheKey);
        });
        return list.sort(function (a, b) { return (b.captureMs || 0) - (a.captureMs || 0); });
    }

    // Filtypen efter innehållet.
    function mime(bytes) {
        if (!bytes || bytes.length < 12) return '';
        if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
        if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
        if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'video/mp4';
        return '';
    }

    // AES-256-CBC med PKCS7, som i Snapchats cache. subtle: crypto.subtle i webbläsaren eller i Node.
    async function decrypt(subtle, data, key, iv) {
        var k = await subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
        return new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv: iv }, k, data));
    }

    // Nycklarna till snapsen i My Eyes Only: snap_key_iv har nyckeln (48 byte) och iv:n (32 byte) krypterade med
    // AES-256-CBC och PKCS7, under nyckeltjänstens masterKey och IV. meo: { key, iv } som byte. Antalet som öppnades.
    async function unlock(subtle, list, meo) {
        if (!meo || !meo.key || !meo.iv) return 0;
        var n = 0;
        for (var i = 0; i < (list || []).length; i++) {
            var m = list[i];
            if (!m.keyLocked || !m.lockedKey || !m.lockedIv) continue;
            try {
                var key = await decrypt(subtle, m.lockedKey, meo.key, meo.iv), iv = await decrypt(subtle, m.lockedIv, meo.key, meo.iv);
                if (key.length !== 32 || iv.length !== 16) continue;
                m.key = key; m.iv = iv; m.keyLocked = false; m.unlocked = true; n++;
            } catch (e) { /* fel nyckel: snappen förblir låst */ }
        }
        return n;
    }

    function counts(list) {
        var c = { all: list.length, meo: 0, locked: 0, unlocked: 0, located: 0, files: 0 };
        list.forEach(function (m) { if (m.meo) c.meo++; if (m.keyLocked) c.locked++; if (m.unlocked) c.unlocked++; if (m.lat !== null) c.located++; if (m.media) c.files++; });
        return c;
    }

    var api = { FILES: FILES, FILE_MANAGER: FILE_MANAGER, SQL: SQL, which: which, pick: pick, build: build, mime: mime, decrypt: decrypt, unlock: unlock, counts: counts, cocoaMs: cocoaMs };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Memories = api;
})(typeof window !== 'undefined' ? window : this);
