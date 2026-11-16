// Snapchat som källa i Härkomst. Betafunktion: tolkningarna är kontrollerade mot en iOS-extraktion
// (iOS 18.5, Snapchat 2025) och en Android-labbtelefon (Android 13, Snapchat 14.30) och kan skilja
// sig mellan versioner, därför bär varje händelse databas, tabell, kolumn och query så att den går
// att kontrollera för hand. Här tolkas cacheregistrets nycklar och typkoder, protobufen i
// chattmeddelandena (avsändare, medienyckel), FlatBuffern i kontotabellen (användarnamn), Memories
// (när en snap togs, med vilken kamera, var, och nyckeln till filen på iOS) och Androids filhanterarjournal,
// och det hela blir händelser till tidslinjen. Memories på iOS är kontrollerat mot en labbtelefon
// (iOS 26.4.1, 2026-11-16). Ingen DOM, ingen SQL. Testas i Node.
(function (root) {
    'use strict';

    var PICABOO = 'com.toyopagroup.picaboo';
    var ANDROID = 'com.snapchat.android';
    var MAX_EVENTS = 40;
    var MEMORY_LINK_MS = 5000;    // en sparad snap hör till en fil i galleriet som lades till inom så här lång tid (sett: under en sekund)
    // Två bilder räknas som samma bild när de, förminskade till samma rutnät i gråskala, skiljer sig mindre än så här
    // i medel (av 255). Uppmätt i labbet: samma bild sparad, skickad och tagen 0,4–1,4; andra bilder av samma skärm 16–31.
    // Gränsen står med i texten där den används.
    var SAME_IMAGE_DIFF = 4;

    function appId(platform) { return platform === 'Android' ? ANDROID : PICABOO; }
    function isSnapchatApp(id) { return id === PICABOO || id === ANDROID; }

    // MEDIA_CONTEXT_TYPE i cache_controller.db. Bara koder med belägg får ett namn; övriga
    // visas som "typ N" och tas med i tidslinjen utan tolkning.
    var CONTEXT = {
        3: { label: 'chattmedia', plain: 'En bild eller video ur Snapchat-chatten läggs i appens cache', show: true },
        34: { label: 'inspelning med Snapchats kamera', plain: 'En video spelas in med Snapchats kamera', show: true },
        16: { label: 'story-video', plain: 'En story hämtas i Snapchat', show: true },
        24: { label: 'story, första bildruta', plain: null, show: false },
        7: { label: 'bild från Snapchats CDN', plain: null, show: false },
        13: { label: 'nedladdning från Snapchats CDN', plain: null, show: false },
        1: { label: 'lins', plain: null, show: false },
        12: { label: 'linspaket', plain: null, show: false },
        4: { label: 'Team Snapchat', plain: null, show: false },
        6: { label: 'Team Snapchat', plain: null, show: false },
        25: { label: 'resurs', plain: null, show: false },
        // Sedda på iOS (26.4.1, 2026-11-16) när en snap sparades i Memories: 19 är filen (EXTERNAL_KEY snap-media-<snap-id>,
        // krypterad med nyckeln i scdb-27), 26 en förhandsbild i låg upplösning (snap-rendered-lowres-<snap-id>).
        19: { label: 'Memories, sparad snap', plain: 'En snap sparas i Snapchats Memories', show: true },
        26: { label: 'Memories, förhandsbild', plain: null, show: false },
        // Sedda på Android (Snapchat 14.30): bildcache för appens egna vyer, kreativa verktyg, kartan,
        // och typ 5 utan attribution, som bland annat är media som laddas upp strax före ett skickat meddelande.
        11: { label: 'bildcache (composer)', plain: null, show: false },
        2: { label: 'kreativa verktyg', plain: null, show: false },
        29: { label: 'karta', plain: null, show: false },
        5: { label: 'ej attribuerad', plain: null, show: false },
    };

    // Mapparna i Androids files/file_manager som säger något om vad användaren gjorde. Övriga
    // (tumnaglar, linsmodeller, bitmoji …) räknas bara.
    var JOURNAL = {
        posted_story_snap: { text: 'en story-snap lagras (posted_story_snap)', plain: 'En story-snap lagras av Snapchat på den här telefonen' },
        memories_media: { text: 'media sparas lokalt för Memories (memories_media)', plain: null },
        memories_overlay: { text: 'överlägg med text eller klotter sparas (memories_overlay)', plain: null },
    };

    function contextInfo(n) {
        var c = CONTEXT[Number(n)];
        // Okända typer visas inte i tidslinjen (de är ofta resurser vid appstart), men räknas i noten.
        return c ? Object.assign({ code: Number(n), known: true }, c) : { code: Number(n), known: false, label: 'typ ' + n + ' (okänd)', plain: null, show: false };
    }

    // EXTERNAL_KEY: vad cachefilen hör till.
    function parseExternalKey(ext) {
        var s = String(ext == null ? '' : ext);
        var m = /^(\d+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d+):(\d+):(\d+)$/i.exec(s);
        if (m) return { kind: 'message', conversationId: m[2].toLowerCase(), serverMessageId: Number(m[3]) };
        m = /^([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})~(\d+)$/i.exec(s);
        if (m) return { kind: 'recording', recordingId: m[1].toUpperCase() };
        // iOS 26: en sparad snap i Memories. Filen och förhandsbilden har snappens id i nyckeln.
        m = /^snap-(media|rendered-lowres)-([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})$/i.exec(s);
        if (m) return { kind: 'memory', snapId: m[2].toUpperCase(), part: m[1] === 'media' ? 'media' : 'lowres' };
        // iOS 26: en skickad snap har två id:n, som båda står i meddelandets local_message_references.
        m = /^([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})~([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})$/i.exec(s);
        if (m) return { kind: 'sent', recipient: null, mediaId: m[2].toUpperCase(), refs: [m[1].toLowerCase(), m[2].toLowerCase()] };
        m = /^([A-Za-z0-9._-]{3,})~([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})$/i.exec(s);
        if (m && !/^(firstframe|video|overlay)$/.test(m[1])) {
            // SNAPVIDEOFILTERSTATE-<mottagare> är en hjälppost för samma skickade snap, raderad inom någon sekund.
            var aux = /^snapvideofilterstate-(.+)$/i.exec(m[1]);
            if (aux) return { kind: 'sent', recipient: aux[1].toLowerCase(), mediaId: m[2].toUpperCase(), aux: 'filterstate' };
            return { kind: 'sent', recipient: m[1].toLowerCase(), mediaId: m[2].toUpperCase() };
        }
        m = /^(firstframe|video|overlay)~(.+)$/.exec(s);
        if (m) return { kind: 'story', part: m[1], storyKey: m[2] };
        // Android: chattmedia har nyckeln chat_snap.chat_snap-<snap-id>; riktningen står i arroyo.db.
        m = /^chat_snap\.chat_snap-([A-Za-z0-9_-]+)$/.exec(s);
        if (m) return { kind: 'chat', snapId: m[1] };
        m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(s);
        if (m) return { kind: 'uuid', id: m[1].toLowerCase() };
        if (/^https?:\/\//.test(s)) return { kind: 'url', url: s };
        if (/^lens\./.test(s)) return { kind: 'lens' };
        return { kind: 'other' };
    }

    // ---------- Protobuf, bara så mycket som behövs ----------

    function varint(b, i) {
        var value = 0, shift = 0, c;
        do {
            c = b[i++];
            value += (c & 0x7f) * Math.pow(2, shift);
            shift += 7;
        } while ((c & 0x80) && i < b.length && shift < 64);
        return { value: value, next: i };
    }

    // Fälten på en nivå: [{ field, wire, value | bytes }]. null när bytena inte är protobuf.
    function fields(b) {
        if (!b || !b.length) return [];
        var out = [];
        var i = 0;
        while (i < b.length) {
            var t = varint(b, i);
            i = t.next;
            var f = Math.floor(t.value / 8);
            var w = t.value % 8;
            if (f === 0) return null;
            if (w === 0) { var v = varint(b, i); i = v.next; out.push({ field: f, wire: 0, value: v.value }); }
            else if (w === 1) { if (i + 8 > b.length) return null; out.push({ field: f, wire: 1 }); i += 8; }
            else if (w === 5) { if (i + 4 > b.length) return null; out.push({ field: f, wire: 5 }); i += 4; }
            else if (w === 2) {
                var l = varint(b, i);
                i = l.next;
                if (i + l.value > b.length) return null;
                out.push({ field: f, wire: 2, bytes: b.subarray(i, i + l.value) });
                i += l.value;
            } else return null;
        }
        return out;
    }

    function toBytes(v) {
        if (!v) return null;
        if (v instanceof Uint8Array) return v;
        if (typeof v === 'string') { try { return new TextEncoder().encode(v); } catch (e) { return null; } }
        if (v.buffer) return new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength);
        return null;
    }

    function hex(b) { return Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }

    function uuidText(h) { return h.length === 32 ? h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20) : h; }

    function isPrintable(s) { return /^[\x20-\x7e -￿]+$/.test(s) && !/[�]/.test(s); }

    function decodeText(b) {
        try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return null; }
    }

    // Avsändarens id: fält 2 → fält 1, 16 byte. Samma plats som hex(substr(message_content, 7, 16))
    // i den synliga queryn när blobben börjar 08 xx 12 12 0A 10.
    function senderId(content) {
        var b = toBytes(content);
        var top = fields(b);
        if (!top) return null;
        var f2 = top.find(function (x) { return x.field === 2 && x.wire === 2; });
        if (!f2) return null;
        var inner = fields(f2.bytes);
        if (!inner) return null;
        var id = inner.find(function (x) { return x.field === 1 && x.wire === 2 && x.bytes.length === 16; });
        if (!id) return null;
        var h = hex(id.bytes);
        return /^0+$/.test(h) ? null : h;
    }

    // Finns ett par nyckel (32 byte) + IV (16 byte) någonstans i meddelandet, råa eller som base64?
    function hasMediaKey(content, depth) {
        depth = depth || 0;
        var list = fields(toBytes(content));
        if (!list || depth > 6) return false;
        var k = false, iv = false;
        list.forEach(function (x) {
            if (x.wire !== 2) return;
            var n = x.bytes.length;
            var s = n === 44 || n === 24 ? decodeText(x.bytes) : null;
            if (x.field === 1 && (n === 32 || (s && /^[A-Za-z0-9+/]{43}=$/.test(s)))) k = true;
            if (x.field === 2 && (n === 16 || (s && /^[A-Za-z0-9+/]{22}==$/.test(s)))) iv = true;
        });
        if (k && iv) return true;
        return list.some(function (x) { return x.wire === 2 && x.bytes.length > 2 && hasMediaKey(x.bytes, depth + 1); });
    }

    // Alla läsbara strängar i en protobuf, på alla nivåer.
    function strings(content, depth, out) {
        out = out || [];
        depth = depth || 0;
        var list = fields(toBytes(content));
        if (!list || depth > 6) return out;
        list.forEach(function (x) {
            if (x.wire !== 2 || x.bytes.length < 2) return;
            var s = decodeText(x.bytes);
            if (s && isPrintable(s) && s.length >= 2) { out.push(s); return; }
            strings(x.bytes, depth + 1, out);
        });
        return out;
    }

    // Strängar i en FlatBuffer: 32-bitars längd (little endian), bytena, och en avslutande nolla.
    // snapchatter.p i primary.docobjects är en FlatBuffer, inte protobuf.
    function flatStrings(content) {
        var b = toBytes(content);
        var out = [];
        if (!b) return out;
        for (var i = 0; i + 4 <= b.length; i += 4) {
            var n = b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
            if (n < 2 || n > 80 || i + 4 + n >= b.length || b[i + 4 + n] !== 0) continue;
            var s = decodeText(b.subarray(i + 4, i + 4 + n));
            if (s && isPrintable(s)) out.push(s);
        }
        return out;
    }

    // Användarnamn och visningsnamn ur snapchatter.p (FlatBuffer). Användarnamnet är det första som
    // ser ut som ett Snapchat-användarnamn, visningsnamnet det första med stor bokstav eller mellanslag.
    function friendNames(p) {
        var all = flatStrings(p);
        if (!all.length) all = strings(p);
        // Går kolumnen inte att läsa på något av sätten: läsbara strängar rakt ur bytena.
        if (!all.length) {
            var raw = toBytes(p);
            var text = raw ? decodeText(raw) || Array.prototype.map.call(raw, function (c) { return String.fromCharCode(c); }).join('') : '';
            all = (text.match(/[\x20-\x7e]{3,60}/g) || []).map(function (s) { return s.replace(/^[^A-Za-z0-9]+/, ''); }).filter(function (s) { return s.length >= 3; });
        }
        var username = all.find(function (s) { return /^[a-z0-9][a-z0-9._-]{2,}$/.test(s) && !/^[0-9a-f-]{32,36}$/.test(s); }) || null;
        var displayName = all.find(function (s) { return s !== username && /[A-ZÅÄÖ]|\s/.test(s) && !/^[0-9a-f-]{32,36}$/i.test(s) && s.length <= 60; }) || null;
        return { username: username, displayName: displayName, strings: all };
    }

    function messageInfo(content) {
        return { senderId: senderId(content), hasMediaKey: hasMediaKey(content) };
    }

    // Det egna kontots uuid står i mappnamnet file_manager_3_SCContent_<uuid>.
    function accountId(names) {
        for (var i = 0; i < (names || []).length; i++) {
            var m = /file_manager_\d+_SCContent_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(names[i]);
            if (m) return m[1].toLowerCase();
        }
        return null;
    }

    // Cachenyckeln ur en sökväg i Snapchats file_manager-mapp, annars null.
    function cacheKeyFromPath(name) {
        var m = /com\.snap\.file_manager_\d+_SCContent_[^/]*\/([0-9a-f]{32})(?:_[^/]*)?$/i.exec(String(name || ''));
        return m ? m[1].toLowerCase() : null;
    }

    function isRecordingPath(name) { return /\/recorded_videos\/recorded-[\d.]+\.mp4$/i.test(String(name || '')); }

    function whoText(id, ctx) {
        if (!id) return 'okänd avsändare';
        if (ctx.accountId && id === ctx.accountId.replace(/-/g, '')) return 'det egna kontot';
        var f = ctx.friends && ctx.friends[id];
        if (f && f.username) return '@' + f.username;
        return 'konto ' + uuidText(id).slice(0, 8) + '…';
    }

    function isOwn(id, ctx) { return !!(id && ctx.accountId && id === ctx.accountId.replace(/-/g, '')); }

    function hexId(v) { return v == null ? null : String(v).replace(/-/g, '').toLowerCase() || null; }

    // Nyckeln och IV till en sparad snaps fil på iOS ur ZGALLERYSNAP.ZENCRYPTION, ett arkiv (NSKeyedArchiver,
    // klassen SCMemoriesSnapEncryption) med KEY (32 byte) och IV (16 byte). archive: den tolkade plisten
    // ({ $objects, $top }). Värdena kan stå som data eller som base64-text. null när de saknas.
    function memoryCipher(archive) {
        var objs = archive && archive.$objects;
        if (!Array.isArray(objs)) return null;
        var deref = function (v) { return v && typeof v === 'object' && !(v instanceof Uint8Array) && v.value != null && Object.keys(v).length === 1 ? objs[v.value] : v; };
        var asBytes = function (v) {
            v = deref(v);
            if (v instanceof Uint8Array) return v;
            if (v && typeof v === 'object' && v['NS.data'] instanceof Uint8Array) return v['NS.data'];
            if (typeof v === 'string' && /^[A-Za-z0-9+/]+=*$/.test(v)) { try { return Uint8Array.from(atobText(v), function (c) { return c.charCodeAt(0); }); } catch (e) { return null; } }
            return null;
        };
        for (var i = 0; i < objs.length; i++) {
            var o = objs[i];
            if (!o || typeof o !== 'object' || !('KEY' in o) || !('IV' in o)) continue;
            var key = asBytes(o.KEY), iv = asBytes(o.IV);
            if (key && iv && key.length === 32 && iv.length === 16) return { key: key, iv: iv, encrypted: deref(o.IS_ENCRYPTED) };
        }
        return null;
    }

    function atobText(s) {
        if (typeof atob === 'function') return atob(s);
        return Buffer.from(s, 'base64').toString('latin1');
    }

    // Utfyllnaden sist efter AES-CBC (PKCS#7): n byte med värdet n. Står den inte rätt lämnas bytena som de är.
    function unpad(b) {
        var n = b.length ? b[b.length - 1] : 0;
        if (n < 1 || n > 16 || n > b.length) return b;
        for (var i = b.length - n; i < b.length; i++) if (b[i] !== n) return b;
        return b.subarray(0, b.length - n);
    }

    // En JPEG utan APPn- och COM-segment (EXIF, JFIF, kommentarer): det som är kvar är själva bilden, tabellerna och
    // bilddatan. En bild som exporterats ur Memories till galleriet har samma bytes som filen i memories_media, med EXIF
    // tillagt (Android 16, Snapchat 13/14, 2026-11-16). null när bytena inte är en JPEG med bilddata.
    function jpegCore(b) {
        if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
        var parts = [b.subarray(0, 2)], total = 2, i = 2;
        while (i + 4 <= b.length && b[i] === 0xff) {
            var m = b[i + 1];
            if (m === 0xda) { parts.push(b.subarray(i)); total += b.length - i; break; }
            var n = (b[i + 2] << 8) | b[i + 3];
            if (n < 2 || i + 2 + n > b.length) return null;
            if (!((m >= 0xe0 && m <= 0xef) || m === 0xfe)) { parts.push(b.subarray(i, i + 2 + n)); total += 2 + n; }
            i += 2 + n;
        }
        if (parts.length < 2 || parts[parts.length - 1][1] !== 0xda) return null;
        var out = new Uint8Array(total), at = 0;
        parts.forEach(function (p) { out.set(p, at); at += p.length; });
        return out;
    }

    function sameBytes(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }

    // Hur lika två bilder är: medelskillnaden mellan två lika stora rutnät i gråskala (0–255 per ruta).
    function grayDiff(a, b) {
        if (!a || !b || !a.length || a.length !== b.length) return null;
        var sum = 0;
        for (var i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
        return sum / a.length;
    }

    // Inställningen Spara till (core.db, SnapchatUserProperties _id 24, textVal), med värdena som står i appen.
    // Med kamerarullen lägger Snapchat en kopia av varje sparad snap i DCIM/Snapchat samma sekund (labbet 2026-11-16).
    var SAVE_SETTING = {
        MEMORIES: { label: 'bara Memories', copies: false },
        MEMORIES_AND_CAMERA_ROLL: { label: 'Memories och kamerarullen', copies: true },
        CAMERA_ROLL: { label: 'bara kamerarullen', copies: true },
    };

    // row: { value, version, updatedMs } ur rollen save-setting. row_version 0 är standardvärdet, som aldrig ändrats.
    function saveSetting(row) {
        if (!row || row.value == null || row.value === '') return null;
        var value = String(row.value).toUpperCase();
        var known = SAVE_SETTING[value] || null;
        var version = row.version == null || row.version === '' ? null : Number(row.version);
        return { value: value, known: !!known, label: known ? known.label : 'okänt värde ' + value, copies: known ? known.copies : null,
            version: version, changed: version == null ? null : version > 0, updatedMs: row.updatedMs == null ? null : Number(row.updatedMs) };
    }

    // Varifrån en rad i Memories kommer (Android, labbet 2026-11-16):
    //   cameraRoll: camera_roll_id är satt. Snapchat har lagt in en bild ur kamerarullen; tiden är filens, inte en tagning.
    //               På Android 13 är värdet MediaStores _id, på Android 16 ett uuid.
    //   synced:     create_time = snap_capture_time. Raden är hämtad från servern (efter en ominstallation eller uppdatering).
    //               När snappen sparades står då bara i Memories-posten: memories_entry.create_time stod kvar på millisekunden.
    //   local:      raden skrevs när snappen sparades på telefonen; create_time är då den tiden.
    // savedMs är tiden då snappen sparades, ur raden eller posten, eller null.
    function memoryOrigin(m) {
        if (!m) return null;
        var roll = m.cameraRollId != null && String(m.cameraRollId) !== '';
        var synced = !roll && m.createdMs != null && m.capturedMs != null && Number(m.createdMs) === Number(m.capturedMs);
        var entryMs = m.entryCreatedMs != null && isFinite(m.entryCreatedMs) && m.entryCreatedMs > 0 ? Number(m.entryCreatedMs) : null;
        return { cameraRoll: roll, mediaStoreId: roll && /^\d+$/.test(String(m.cameraRollId)) ? Number(m.cameraRollId) : null,
            featured: String(m.entryId || '').toLowerCase() === 'featured', synced: synced, local: !roll && !synced,
            savedMs: roll ? null : synced ? entryMs : m.createdMs, savedFrom: roll ? null : synced ? (entryMs ? 'entry' : null) : 'snap',
            deleted: Number(m.deleted) === 1, private: Number(m.private) === 1, copyOf: m.copyFrom || null };
    }

    // En fil i galleriet som hör till en snap som sparades på telefonen: kopian Snapchat lägger där när snappen sparas
    // ('auto', samma sekund; date_added har hela sekunder) eller en export ur Memories senare ('export'). null annars.
    var AUTO_COPY_MS = 2000;
    function copyKind(m, addedMs) {
        var o = memoryOrigin(m);
        if (!o || o.savedMs == null || addedMs == null) return null;
        var d = addedMs - o.savedMs;
        return Math.abs(d) <= AUTO_COPY_MS ? 'auto' : d > AUTO_COPY_MS ? 'export' : null;
    }

    // Snapchats egna filer i galleriet på Android: DCIM/Snapchat/Snapchat-<tal>.jpg eller .mp4. När appen avinstalleras
    // töms owner_package_name i MediaStore (labbet 2026-11-16), och då är mappen och namnet det som säger att filen är Snapchats.
    function isGalleryName(relativePath, filename) {
        return /^DCIM\/Snapchat\/?$/i.test(String(relativePath || '')) && /^Snapchat-\d+\.(jpe?g|mp4)$/i.test(String(filename || ''));
    }

    // En video i galleriet som exporterats ur Memories har en annan storlek och tid än snappen, men samma längd:
    // 6,618 s mot 6,609 s i labbet (den automatiska kopian 6,687 s). Kopplingen görs bara när en enda video har
    // längden inom gränsen. file: { durationMs }. -> { row, by: 'duration', diffMs } eller null.
    var SAME_DURATION_MS = 150;
    function linkVideoByDuration(memories, file) {
        if (!file || file.durationMs == null || !(file.durationMs > 0)) return null;
        var hits = (memories || []).filter(function (m) {
            return Number(m.mediaType) === 1 && !memoryOrigin(m).cameraRoll && m.duration != null && Math.abs(Number(m.duration) * 1000 - file.durationMs) <= SAME_DURATION_MS;
        });
        return hits.length === 1 ? { row: hits[0], deltaMs: null, by: 'duration', diffMs: Math.round(Math.abs(Number(hits[0].duration) * 1000 - file.durationMs)) } : null;
    }

    // Den sparade snap i Memories som hör till en fil i galleriet: samma sort (bild eller video)
    // och sparad inom MEMORY_LINK_MS från att filen lades till (Snapchat exporterar direkt när
    // användaren sparar). file: { addedMs, createdMs, video }. Närmast i tid vinner. En rad ur
    // kamerarullen är en kopia av en fil i galleriet, inte dess ursprung, och räknas inte.
    function linkMemory(memories, file) {
        if (!file || !(memories || []).length) return null;
        var anchor = file.addedMs != null ? file.addedMs : file.createdMs;
        if (anchor == null) return null;
        var best = null;
        memories.forEach(function (m) {
            var o = memoryOrigin(m);
            // Tiden då snappen sparades: raden, eller Memories-posten när raden är hämtad från servern.
            var saved = o.savedMs != null ? o.savedMs : m.createdMs;
            if (saved == null || o.cameraRoll) return;
            if (file.video != null && (Number(m.mediaType) === 1) !== !!file.video) return;
            var d = Math.abs(saved - anchor);
            if (d > MEMORY_LINK_MS) return;
            if (!best || d < best.deltaMs) best = { row: m, deltaMs: d };
        });
        return best;
    }

    // Var ett meddelande från kontot skapades (Android, labbet 2026-11-16, samma konto inloggat på telefonen och i Snapchat
    // för webben): created_on_device 1 är den här telefonen. 0 med kontot som avsändare är en annan inloggad enhet, men
    // också varje meddelande från tiden före en ominstallation: då nollställdes flaggan på alla. ctx.installMs (när appen
    // installerades) skiljer dem. En snap tagen i Snapchat för webben har länken ...?ref=web_snap_context i meddelandet.
    // -> { ownAccount, device: 'this' | 'web' | 'other' | 'unknown' | null, text, plain }
    function sentFrom(m, senderId, ctx) {
        var flag = m.createdOnDevice == null ? null : Number(m.createdOnDevice) === 1;
        var ownAccount = flag === true || isOwn(senderId, ctx);
        if (!ownAccount) return { ownAccount: false, device: null, text: '', plain: '' };
        if (flag === null) return { ownAccount: true, device: null, text: 'den här telefonen', plain: 'från den här telefonen' };
        if (flag) return { ownAccount: true, device: 'this', text: 'skapat på den här telefonen, created_on_device 1', plain: 'från den här telefonen' };
        var web = strings(m.content).some(function (x) { return /ref=web_snap_context/.test(x); });
        if (web) return { ownAccount: true, device: 'web', text: 'skapat i Snapchat för webben: created_on_device 0 och web_snap_context i meddelandet', plain: 'från kontot i Snapchat för webben, inte från den här telefonen' };
        if (ctx.installMs && m.createdMs != null && m.createdMs < ctx.installMs) return { ownAccount: true, device: 'unknown', text: 'created_on_device 0, men appen installerades om efter meddelandet, så var det skapades går inte att se', plain: 'från kontot (från vilken enhet går inte att se: appen installerades om efteråt)' };
        return { ownAccount: true, device: 'other', text: 'skapat på en annan enhet inloggad på kontot: created_on_device 0', plain: 'från kontot på en annan enhet, inte från den här telefonen' };
    }

    // ctx: { cacheRows, messages, friends: { idHex: { username, displayName } }, notifications,
    //        memories, journal, file, accountId, app, fileKey, sources: { cache, messages, notifications, memories, journal } }
    // Rader har tider som UTC-millisekunder (createdMs, readMs, lastReadMs, deletedMs, ms, capturedMs, timeMs).
    // Meddelanden från Android har dessutom senderId (text), createdOnDevice, remoteMediaCount, isSaved.
    // Returnerar { events, link, memory, notes, hidden }.
    function build(ctx) {
        ctx = ctx || {};
        var events = [];
        var notes = [];
        var hidden = 0;
        var hiddenTypes = {};
        var app = ctx.app || PICABOO;
        var srcCache = ctx.sources && ctx.sources.cache || { db: 'cache_controller.db', table: 'CACHE_FILE_CLAIM' };
        var srcMsg = ctx.sources && ctx.sources.messages || { db: 'arroyo.db', table: 'conversation_message' };
        var srcNotif = ctx.sources && ctx.sources.notifications || { db: 'nse_db.sqlite', table: 'ProcessedNotifications' };
        var srcMem = ctx.sources && ctx.sources.memories || { db: 'memories.db', table: 'memories_snap' };
        var srcJournal = ctx.sources && ctx.sources.journal || { db: 'journal.db', table: 'journal_entry + journal' };
        var fileKey = ctx.fileKey ? String(ctx.fileKey).toLowerCase() : null;
        var link = null;
        var memory = linkMemory(ctx.memories, ctx.file);
        // iOS: en cachefil vars nyckel bär snappens id hör till den snappen i Memories, utan att tiden behöver jämföras.
        var fileRow = fileKey ? (ctx.cacheRows || []).find(function (r) { return String(r.key).toLowerCase() === fileKey; }) : null;
        var fileExt = fileRow ? parseExternalKey(fileRow.external) : null;
        if (fileExt && fileExt.kind === 'memory') {
            var own = (ctx.memories || []).find(function (m) { return String(m.id || '').toUpperCase() === fileExt.snapId; });
            if (own) memory = { row: own, deltaMs: null, by: 'id', part: fileExt.part };
        }
        // Kopplingen kan redan vara gjord på annat sätt (Android: storleken i memories_media eller samma bilddata).
        if (!memory && ctx.memoryId) {
            var given = (ctx.memories || []).find(function (m) { return String(m.id || '').toUpperCase() === String(ctx.memoryId).toUpperCase(); });
            if (given) memory = { row: given, deltaMs: null, by: ctx.memoryBy || 'given' };
        }
        // Memories ord för kolumnerna: Android (memories.db) eller iOS (scdb-27).
        var memCols = Object.assign({ captured: 'snap_capture_time', created: 'create_time', front: 'front_facing', type: 'media_type', position: 'latitude, longitude' }, ctx.memoryColumns || {});
        // Vem chatten är med: avsändarna i konversationen utom det egna kontot (ctx.members: { konversation: [avsändar-id] }).
        var chatWith = function (conversation) {
            var ids = ((ctx.members || {})[String(conversation || '').toLowerCase()] || []).map(hexId).filter(function (id) { return id && !isOwn(id, ctx); });
            return ids.length ? ids.map(function (id) { return whoText(id, ctx); }).join(', ') : null;
        };
        // iOS 26: meddelandet vars local_message_references har båda id:n i en skickad snaps cachenyckel.
        var messageForRefs = function (refs) {
            return (ctx.messages || []).find(function (m) {
                var b = toBytes(m.refs);
                if (!b) return false;
                var text = Array.prototype.map.call(b, function (c) { return String.fromCharCode(c); }).join('').toLowerCase();
                return refs.every(function (r) { return text.indexOf(r) >= 0; });
            }) || null;
        };

        var byMessage = {};
        var snapIds = [];
        (ctx.messages || []).forEach(function (m) {
            if (m.conversation != null && m.serverId != null) byMessage[String(m.conversation).toLowerCase() + ':' + Number(m.serverId)] = m;
            // Android: chattmediets nyckel (chat_snap-<id>) står som sträng i meddelandets protobuf, med ett suffix.
            strings(m.content).forEach(function (str) { if (str.length >= 15 && /^[A-Za-z0-9_-]+$/.test(str)) snapIds.push({ id: str, message: m }); });
        });
        var messageForSnap = function (snapId) {
            var hit = snapIds.find(function (x) { return x.id.indexOf(snapId) === 0; });
            return hit ? hit.message : null;
        };

        (ctx.cacheRows || []).forEach(function (r) {
            var info = contextInfo(r.context);
            var ext = parseExternalKey(r.external);
            var isFile = fileKey && String(r.key).toLowerCase() === fileKey;
            var linkedMessage = ext.kind === 'message' ? byMessage[ext.conversationId + ':' + ext.serverMessageId] || null : ext.kind === 'chat' ? messageForSnap(ext.snapId)
                : ext.kind === 'sent' && ext.refs ? messageForRefs(ext.refs) : null;
            var chat = linkedMessage ? chatWith(linkedMessage.conversation) : null;
            var sentTo = ext.kind === 'sent' ? (ext.recipient ? '@' + ext.recipient : chat || (linkedMessage ? 'konversation ' + String(linkedMessage.conversation).slice(0, 8) + '…' : null)) : null;
            if (isFile) {
                link = { row: r, context: info, external: ext, message: linkedMessage };
            }
            if (!info.show && !isFile) { hidden++; hiddenTypes[info.code] = (hiddenTypes[info.code] || 0) + 1; return; }
            if (r.createdMs == null) return;
            var what = 'Snapchat cachar media: typ ' + info.code + (info.known ? ' (' + info.label + ')' : '');
            if (ext.kind === 'message') what += ', konversation ' + ext.conversationId.slice(0, 8) + '…, meddelande ' + ext.serverMessageId;
            else if (ext.kind === 'chat') what += ', chattsnap ' + ext.snapId.slice(0, 8) + '…' + (linkedMessage ? ', meddelande ' + linkedMessage.serverId : '');
            else if (ext.kind === 'recording') what += ', inspelning ' + ext.recordingId.slice(0, 8) + '…';
            else if (ext.kind === 'sent') what += ', skickad' + (sentTo ? ' till ' + sentTo : '') + (linkedMessage && ext.refs ? ' (meddelande ' + linkedMessage.serverId + ', local_message_references)' : '') + (ext.aux ? ' (' + ext.aux + ')' : '');
            else if (ext.kind === 'story') what += ', ' + ext.part;
            else if (ext.kind === 'memory') what += ', snap ' + ext.snapId.slice(0, 8) + '…';
            var plain = ext.kind === 'sent' && info.code === 3 ? (ext.aux ? null : 'En snap eller bild skickas' + (sentTo ? ' till ' + sentTo : '') + ' från den här telefonen') : info.plain;
            // Tillfälliga poster utan extern nyckel (mellanlagring vid inspelning och hämtning) får ingen egen mening.
            if ((info.code === 34 && ext.kind !== 'recording') || (info.code === 3 && ext.kind === 'other')) plain = null;
            if (isFile) {
                what = 'Den bedömda filen: ' + what;
                plain = info.code === 34 ? 'Den bedömda videon spelas in med Snapchats kamera'
                    : ext.kind === 'sent' ? 'Den bedömda filen skickas' + (sentTo ? ' till ' + sentTo : '') + ' från den här telefonen'
                    : ext.kind === 'memory' ? 'Den bedömda filen sparas i Snapchats Memories'
                    : info.code === 3 ? 'Den bedömda filen läggs i Snapchat-chattens cache'
                        : 'Den bedömda filen läggs i Snapchats cache';
            }
            events.push({
                ms: r.createdMs, kind: 'snap-cache', lane: 'snapchat', bold: !!isFile, isFile: !!isFile, context: info.code, cacheKey: r.key, app: app, sent: ext.kind === 'sent' && !ext.aux,
                sentTo: sentTo, conversation: linkedMessage ? linkedMessage.conversation : null, serverId: linkedMessage ? linkedMessage.serverId : null, snapId: ext.kind === 'memory' ? ext.snapId : null,
                text: what + ', nyckel ' + String(r.key).slice(0, 12) + '…', plain: plain,
                source: Object.assign({}, srcCache, { column: 'CREATION_TIMESTAMP_MILLIS (MEDIA_CONTEXT_TYPE ' + info.code + ', EXTERNAL_KEY)' }),
            });
            if (r.deletedMs) {
                events.push({ ms: r.deletedMs, kind: 'snap-cache-deleted', lane: 'snapchat', context: info.code, cacheKey: r.key, app: app,
                    text: (isFile ? 'Den bedömda filen: ' : '') + 'raderad ur Snapchats cache, nyckel ' + String(r.key).slice(0, 12) + '…', plain: isFile ? 'Den bedömda filen tas bort ur Snapchats cache' : null,
                    source: Object.assign({}, srcCache, { column: 'DELETED_TIMESTAMP_MILLIS' }) });
            }
        });

        var sentAt = events.filter(function (e) { return e.kind === 'snap-cache' && e.sent; }).map(function (e) { return e.ms; });
        (ctx.messages || []).forEach(function (m) {
            var info = messageInfo(m.content);
            // Android har avsändaren i klartext (sender_id) och flaggan created_on_device; iOS bara protobufen.
            var senderId = hexId(m.senderId) || info.senderId;
            var dev = sentFrom(m, senderId, ctx);
            var own = dev.ownAccount;
            var who = whoText(senderId, ctx);
            var isFile = !!(link && link.message === m);
            var conv = String(m.conversation || '').slice(0, 8) + '…';
            var isMedia = info.hasMediaKey || (m.remoteMediaCount != null && Number(m.remoteMediaCount) > 0);
            var kindText = isMedia ? 'snap eller bild' : 'meddelande';
            var saved = m.isSaved != null && Number(m.isSaved) === 1;
            var text = 'Snapchat: ' + kindText + ' ' + m.serverId + ' i konversation ' + conv + ', avsändare ' + who + (dev.text ? ' (' + dev.text + ')' : '') + (saved ? ', sparad i chatten' : '');
            var thing = isMedia ? 'En snap eller bild' : 'Ett meddelande';
            var plain = own ? thing + ' skickas ' + dev.plain + ' i Snapchat'
                : thing + ' skickas till den här telefonen i Snapchat från ' + who;
            if (isFile) { text = 'Den bedömda filen: ' + text; plain = own ? 'Den bedömda filen skickas ' + dev.plain + ' i Snapchat' : 'Den bedömda filen skickas till den här telefonen i Snapchat från ' + who; }
            // En skickad snap ger både en cacherad (med mottagaren) och ett meddelande inom några sekunder: en mening räcker.
            else if (own && m.createdMs != null && sentAt.some(function (t) { return Math.abs(t - m.createdMs) <= 5000; })) plain = null;
            var senderSource = Object.assign({}, srcMsg, { column: m.senderId ? 'creation_timestamp; avsändare ur sender_id, created_on_device' + (dev.device === 'web' ? ', web_snap_context i message_content' : '') : 'creation_timestamp; avsändare ur message_content (protobuf, fält 2 → 1)' });
            if (m.createdMs != null) events.push({ ms: m.createdMs, kind: 'snap-message', lane: 'snapchat', bold: isFile, isFile: isFile, own: own, device: dev.device, senderId: senderId, hasMediaKey: isMedia, saved: saved,
                conversation: m.conversation, serverId: m.serverId, app: app, text: text, plain: plain, source: senderSource });
            if (m.readMs != null) {
                events.push({ ms: m.readMs, kind: 'snap-read', lane: 'snapchat', isFile: isFile, own: own, conversation: m.conversation, serverId: m.serverId, app: app,
                    text: (isFile ? 'Den bedömda filen: ' : 'Snapchat: ') + kindText + ' ' + m.serverId + ' läst' + (own ? ' av mottagaren' : ' på den här telefonen'),
                    plain: own ? 'Mottagaren öppnar den' : 'Den öppnas på den här telefonen',
                    source: Object.assign({}, srcMsg, { column: 'read_timestamp' }) });
            }
        });

        (ctx.notifications || []).forEach(function (n) {
            if (n.ms == null) return;
            var t = String(n.type || '');
            events.push({ ms: n.ms, kind: 'snap-notification', lane: 'snapchat', app: app, notifType: t,
                text: 'Snapchat-notis: ' + t + (n.category != null ? ' (kategori ' + n.category + ')' : ''),
                plain: t === 'snap' ? 'Telefonen får en notis om en ny snap' : t === 'chat' ? 'Telefonen får en notis om ett nytt meddelande i Snapchat' : t === 'addfriend' ? 'Telefonen får en notis om en vänförfrågan i Snapchat' : null,
                source: Object.assign({}, srcNotif, { column: 'timestamp, type' }) });
        });

        // Memories säger när en snap togs, med vilken kamera, och när den sparades, på Android (memories.db) och
        // iOS (scdb-27). Den som hör till den bedömda filen blir fet.
        // Memories följer kontot, och kontot kan vara inloggat på flera enheter: att snappen togs på den här telefonen
        // visar kameraloggen, inte Memories. Därför säger meningarna inte "på den här telefonen".
        (ctx.memories || []).forEach(function (m) {
            var video = Number(m.mediaType) === 1;
            var front = Number(m.front) === 1;
            var cam = front ? 'frontkamera' : 'bakre kamera';
            var isFile = !!(memory && memory.row === m);
            var noun = video ? 'video' : 'bild';
            var o = ctx.memoryColumns ? { local: true } : memoryOrigin(m);
            var tail = (o.private ? ', i My Eyes Only' : '') + (o.deleted ? ', borttagen ur Memories (has_deleted)' : '') + (o.copyOf ? ', kopia av snap ' + String(o.copyOf).slice(0, 8) + '…' : '');
            var common = { kind: 'snap-memory', lane: 'snapchat', app: app, isFile: isFile, bold: isFile, video: video, front: front, memoryId: m.id, latitude: m.latitude, longitude: m.longitude };
            if (o.cameraRoll) {
                // En bild ur kamerarullen som Snapchat lagt i Memories: tiden är filens, och ingen kamera är inblandad.
                if (m.createdMs != null) events.push(Object.assign({}, common, { ms: m.createdMs, captured: false, fromCameraRoll: true,
                    text: 'Snapchat Memories: en ' + noun + ' ur kamerarullen läggs i Memories (camera_roll_id ' + m.cameraRollId + (o.featured ? ', memories_entry_id featured' : '') + ')' + tail,
                    plain: null, source: Object.assign({}, srcMem, { column: memCols.created + ', camera_roll_id' }) }));
                return;
            }
            if (m.capturedMs != null) {
                events.push(Object.assign({}, common, { ms: m.capturedMs, captured: true,
                    text: 'Snapchat Memories: ' + noun + ' tagen med ' + cam + 'n (' + memCols.captured + (video ? (ctx.memoryColumns ? ', start eller slut är inte kontrollerat på iOS' : ', inspelningens slut') : '') + ')' + (m.width && m.height ? ', ' + m.width + '×' + m.height : '') + (video && m.duration ? ', ' + Number(m.duration).toFixed(1).replace('.', ',') + ' s' : '') + (Number(m.hasLocation) === 1 ? ', med position' : '') +
                        (o.synced ? ', raden hämtad från Snapchats server (' + memCols.created + ' = ' + memCols.captured + ')' : '') + tail,
                    plain: (isFile ? 'Den bedömda ' + noun + 'en ' : 'En ' + noun + ' ') + (video ? 'spelas in' : 'tas') + ' med Snapchats ' + cam,
                    source: Object.assign({}, srcMem, { column: memCols.captured + ', ' + memCols.front + ', ' + memCols.type }) }));
            }
            // En rad från servern har ingen egen sparad-tid (create_time är tagningstiden); Memories-postens tid står kvar.
            var savedMs = o.savedMs !== undefined ? o.savedMs : m.createdMs;
            if (savedMs != null) {
                var col = o.savedFrom === 'entry' ? 'memories_entry.create_time' : memCols.created;
                events.push(Object.assign({}, common, { ms: savedMs, captured: false,
                    text: 'Snapchat Memories: ' + noun + 'en sparas i Memories (' + col + ')' + (m.zone ? ', tidszon ' + m.zone : '') + tail,
                    plain: o.copyOf && o.private ? 'Den flyttas till My Eyes Only' : 'Den sparas i Snapchats Memories',
                    source: Object.assign({}, srcMem, { column: col }) }));
            }
        });

        // Android: filhanterarens journal, bara mapparna som säger något om vad användaren gjorde.
        var hiddenJournal = 0;
        (ctx.journal || []).forEach(function (j) {
            if (j.timeMs == null) return;
            var folder = String(j.path || '').replace(/\/+$/, '').split('/').pop();
            var info = JOURNAL[folder];
            if (!info) { hiddenJournal++; return; }
            events.push({ ms: j.timeMs, kind: 'snap-journal', lane: 'snapchat', app: app, folder: folder, journalKey: j.key,
                text: 'Snapchats filhanterare: ' + info.text + ', nyckel ' + String(j.key || '').slice(0, 12) + '…' + (j.size ? ', ' + j.size + ' byte' : ''),
                plain: info.plain, source: Object.assign({}, srcJournal, { column: 'last_update_time, journal.path' }) });
        });
        if (hiddenJournal) notes.push(hiddenJournal + ' poster i Snapchats filhanterare (tumnaglar, modeller, bitmoji …) i fönstret visas inte.');

        events.sort(function (a, b) { return a.ms - b.ms; });
        if (events.length > MAX_EVENTS) {
            // De närmast T behålls, plus allt som rör den bedömda filen.
            var center = ctx.centerMs != null ? ctx.centerMs : events[0].ms;
            var kept = events.filter(function (e) { return e.isFile; });
            events.filter(function (e) { return !e.isFile; }).sort(function (a, b) { return Math.abs(a.ms - center) - Math.abs(b.ms - center); })
                .forEach(function (e) { if (kept.length < MAX_EVENTS) kept.push(e); });
            notes.push((events.length - kept.length) + ' Snapchat-händelser till i fönstret visas inte.');
            events = kept.sort(function (a, b) { return a.ms - b.ms; });
        }
        if (hidden) notes.push(hidden + ' cacheposter för linser, resurser och andra typer (' + Object.keys(hiddenTypes).sort(function (a, b) { return a - b; }).join(', ') + ') i fönstret visas inte.');
        return { events: events, link: link, memory: memory, notes: notes, hidden: hidden };
    }

    var api = {
        PICABOO: PICABOO, ANDROID: ANDROID, appId: appId, isSnapchatApp: isSnapchatApp, JOURNAL: JOURNAL, linkMemory: linkMemory, hexId: hexId,
        SAVE_SETTING: SAVE_SETTING, saveSetting: saveSetting, memoryOrigin: memoryOrigin, copyKind: copyKind, AUTO_COPY_MS: AUTO_COPY_MS,
        linkVideoByDuration: linkVideoByDuration, SAME_DURATION_MS: SAME_DURATION_MS, isGalleryName: isGalleryName, sentFrom: sentFrom,
        memoryCipher: memoryCipher, unpad: unpad, grayDiff: grayDiff, SAME_IMAGE_DIFF: SAME_IMAGE_DIFF, jpegCore: jpegCore, sameBytes: sameBytes,
        CONTEXT: CONTEXT, contextInfo: contextInfo, parseExternalKey: parseExternalKey,
        fields: fields, senderId: senderId, hasMediaKey: hasMediaKey, strings: strings, flatStrings: flatStrings, friendNames: friendNames, messageInfo: messageInfo,
        accountId: accountId, cacheKeyFromPath: cacheKeyFromPath, isRecordingPath: isRecordingPath, uuidText: uuidText, hex: hex, build: build,
        messageForSnapId: function (messages, snapId) { for (var i = 0; i < (messages || []).length; i++) { if (strings(messages[i].content).some(function (str) { return str.indexOf(snapId) === 0; })) return messages[i]; } return null; },
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ProvenanceSnapchat = api;
})(typeof window !== 'undefined' ? window : this);
