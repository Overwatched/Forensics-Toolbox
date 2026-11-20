// Förhandsvisning av vad en query returnerar: kolumnerna läses ur SQL:en och
// exempelvärdena väljs efter kolumnnamnet. Ingen databas läses. Testas i Node.
(function (root) {
    'use strict';

    function stripComments(sql) {
        return String(sql || '').replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    }

    function splitTop(text) {
        var parts = [];
        var depth = 0;
        var quote = '';
        var cur = '';
        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            if (quote) {
                cur += ch;
                if (ch === quote) quote = '';
                continue;
            }
            if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
            if (ch === '(') depth++;
            if (ch === ')') depth--;
            if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
            cur += ch;
        }
        if (cur.trim()) parts.push(cur);
        return parts;
    }

    var PRAGMA_COLUMNS = ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'];

    // Första SELECT-listan på yttersta nivån, som uttryck.
    // Texten med innehållet i strängar utbytt mot x, så att parenteser och ord i en sträng inte räknas.
    function maskStrings(text) {
        return text.replace(/'(?:[^']|'')*'/g, function (m) { return "'" + new Array(m.length - 1).join('x') + "'"; });
    }

    // Kolumnerna i den första SELECT som står utanför parenteser, så att en WITH före huvudfrågan hoppas över.
    function selectItems(text) {
        var masked = maskStrings(text);
        var depth = 0;
        var start = -1;
        var re = /\(|\)|\bSELECT\s+(?:DISTINCT\s+)?/gi;
        var t;
        while ((t = re.exec(masked))) {
            if (t[0] === '(') depth++;
            else if (t[0] === ')') depth--;
            else if (depth === 0) { start = t.index + t[0].length; break; }
        }
        if (start < 0) return [];
        var rest = text.slice(start);
        var restMasked = masked.slice(start);
        depth = 0;
        var end = -1;
        var re2 = /\(|\)|\bFROM\b/gi;
        while ((t = re2.exec(restMasked))) {
            if (t[0] === '(') depth++;
            else if (t[0] === ')') depth--;
            else if (depth === 0) { end = t.index; break; }
        }
        var list = end < 0 ? rest : rest.slice(0, end);
        return splitTop(list).map(function (item) { return item.trim().replace(/;$/, ''); }).filter(Boolean);
    }

    function itemName(s) {
        var alias = /\bAS\s+["'`[]?([\w.]+)["'`\]]?\s*$/i.exec(s);
        if (alias) return alias[1];
        if (s === '*') return '*';
        var last = /([\w]+)["'`\]]?\s*$/.exec(s);
        return last ? last[1] : s;
    }

    function columns(sql) {
        var text = stripComments(sql).trim();
        if (/^PRAGMA\s+table_info/i.test(text)) return PRAGMA_COLUMNS.slice();
        return selectItems(text).map(itemName).filter(Boolean);
    }

    // Första strängen efter THEN i ett CASE-uttryck, t.ex. 'Skärmdump'.
    function caseLiterals(sql) {
        var text = stripComments(sql).trim();
        var out = {};
        selectItems(text).forEach(function (s) {
            var m = /\bCASE\b[\s\S]*?\bTHEN\s+'((?:[^']|'')*)'/i.exec(s);
            if (m) out[itemName(s)] = m[1].replace(/''/g, "'");
        });
        return out;
    }

    function pick(list) {
        return function (i) { return list[i % list.length]; };
    }

    // Sluttiden ligger lika långt efter starttiden som duration-regeln säger (12 + 3i s).
    function clock(i, end) {
        var minutes = 10 + i * 7;
        var seconds = 12 + (end ? 12 + i * 3 : 0);
        minutes += Math.floor(seconds / 60);
        return String(14 + Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0') + ':' +
            String(seconds % 60).padStart(2, '0');
    }

    var RULES = [
        [/^\*$/, function () { return '(alla kolumner)'; }],
        [/^(notnull|pk)$/i, function () { return '0'; }],
        [/^dflt_value$/i, function () { return 'NULL'; }],
        [/^cid$/i, function (i) { return String(i); }],
        [/^(z?_?pk|_id|id)$/i, function (i) { return String(1201 + i); }],
        // Snapchat (cache_controller.db, arroyo.db, primary.docobjects, nse_db.sqlite)
        [/cache_key/i, function (i) { return ['7d1f3a9c2b4e5f60718293a4b5c6d7e8', '0a1b2c3d4e5f60718293a4b5c6d7e8f9', 'c6d7e8f90a1b2c3d4e5f60718293a4b5'][i % 3]; }],
        [/media_context_type/i, function (i) { return ['3', '34', '16'][i % 3]; }],
        [/external_key/i, function (i) { return '1:2b7e1d0c-3f4a-4b5c-9d6e-7f8a9b0c1d2e:' + (4 + i) + ':0:0'; }],
        [/(conversation_?id)/i, function () { return '2b7e1d0c-3f4a-4b5c-9d6e-7f8a9b0c1d2e'; }],
        [/(server_message_id|client_message_id|message_?id)/i, function (i) { return String(4 + i); }],
        [/message_state_type/i, function () { return 'COMMITTED'; }],
        [/(avsandare|sender)/i, function () { return '9e6f7a8b1c2d4e3f8a9b0c1d2e3f4a5b'; }],
        // Snapchat på Android (arroyo.db, main.db, client_notifications.db, memories.db, journal.db)
        [/^(content_type|created_on_device|is_saved|front_facing|has_location|has_overlay_image)$/i, function (i) { return String(i % 2); }],
        [/remote_media_count/i, function () { return '1'; }],
        [/^username$/i, pick(['anna.svensson', 'erik.lind', 'sara.nilsson'])],
        [/displayname$/i, pick(['Anna Svensson', 'Erik Lind', 'Sara Nilsson'])],
        [/json/i, function () { return '{"arroyo_convo_id":"2b7e1d0c-3f4a-4b5c-9d6e-7f8a9b0c1d2e","arroyo_message_id":"4"}'; }],
        [/time_zone/i, function () { return 'Europe/Stockholm'; }],
        [/user_agent/i, function () { return 'Snapchat/14.30.0.54 (AC2003; Android 13#f8fb74d040#33; gzip) V/MUSHROOM'; }],
        [/^(external_id|media_id|memories_entry_id)$/i, function (i) { return '4669844f-2375-6c4f-5de8-1489444859' + (10 + i); }],
        [/^has_deleted$/i, function () { return '0'; }],
        [/^copy_from_snap_id$/i, function () { return ''; }],
        [/^camera_roll_id$/i, function (i) { return i === 1 ? '1000000100' : ''; }],
        // Snapchat på Android (core.db): inställningen Spara till och Memories i Preferences
        [/^varde$/i, pick(['MEMORIES_AND_CAMERA_ROLL', '1', '0'])],
        [/^row_version$/i, function () { return '8'; }],
        [/^nyckel$/i, pick(['MEMORIES~HAS_SEEN_MEMORIES_SAVING_OPTIONS_PROMPT', 'MEMORIES~MY_EYES_ONLY_INVALID_UNLOCK_COUNT', 'MEMORIES~MEMORIES_LAST_ENTER_TIME_STAMP'])],
        // Snapchat Memories på iOS (scdb-27.sqlite3, gallery.encrypteddb)
        [/^(ZSNAPID|ZENTRYID|snap_id)$/i, function (i) { return '7C2E91A4-5B3D-4F60-8A17-2D9E4B6C0F' + (11 + i); }],
        [/^(ZMEDIATYPE|ZCAMERAFRONTFACING)$/, function () { return '0'; }],
        [/^ZHASLOCATION$/, function () { return '1'; }],
        [/^ZSERVLETMEDIAFORMAT$/, function () { return 'image_jpeg'; }],
        [/^(text_eller_ritning|my_eyes_only)$/i, function (i) { return String(i % 2); }],
        [/^kopia_av$/i, function () { return ''; }],
        // Samsungs Rubin och MediaStores ursprung och ordning.
        [/^(tid|slut|forsta|sista|andrad|tagen|rensas)$/i, function (i) { return '2026-11-06 15:0' + i + ':0' + i; }],
        [/^(sekunder)$/i, function (i) { return String(12.5 + i); }],
        [/^aktivitet$/i, function () { return 'com.snap.mushroom.MainActivity'; }],
        [/^zon$/i, function () { return 'Europe/Stockholm'; }],
        [/^(rad|raderat_id|xmp_byte)$/i, function (i) { return String(120 + i); }],
        [/^(hojd_m|hastighet)$/i, function (i) { return String(i * 2); }],
        [/^ms$/i, function (i) { return String(1793974026000 + i * 1000); }],
        [/^installning$/i, function (i) { return ['airplane_mode_on', 'wifi_on', 'location_enabled'][i % 3]; }],
        [/^version$/i, function () { return '1.7.20.59'; }],
        [/^anrop$/i, function () { return 'method@get_registered_context_fences'; }],
        [/^download_uri$/i, function () { return 'https://f-droid.org/F-Droid.apk'; }],
        [/^referer_uri$/i, function () { return 'https://f-droid.org/'; }],
        [/^(is_download|is_trashed)$/i, function (i) { return String(i % 2); }],
        [/^markering$/i, function (i) { return ['före', 'filen', 'efter'][i % 3]; }],
        [/^borttagen_vid$/i, function (i) { return String(620 + i * 14); }],
        [/^xmp_borjan$/i, function () { return '<x:xmpmeta xmlns:x="adobe:ns:meta/">'; }],
        // Samsungs papperskorg (trash.db) och Galleriets local.db.
        [/^(raderad|senaste)$/i, function (i) { return '2026-11-20 11:0' + i + ':0' + i; }],
        [/^namn$/i, function (i) { return '20261120_11000' + i + '.jpg'; }],
        [/^lag_i$/i, function (i) { return '/storage/emulated/0/DCIM/Camera/20261120_11000' + i + '.jpg'; }],
        [/^(raderad_av|agare)$/i, function () { return 'com.sec.android.gallery3d'; }],
        [/^anvandare$/i, function (i) { return i % 2 ? '150' : '0'; }],
        [/^(i_molnet|kategori)$/i, function (i) { return String(i % 2 ? 2 : 0); }],
        [/^summa$/i, function () { return '9f2c1e5a7b3d4c6e8f0a1b2c3d4e5f60'; }],
        [/^(lagda_totalt|kvar_nu|aterstallda_eller_rensade|sparas)$/i, function (i) { return String(3 + i); }],
        [/^atgard$/i, function () { return 'DELETE'; }],
        [/^media$/i, function (i) { return String(1000 + i); }],
        [/^lagring$/i, function () { return 'external_primary'; }],
        [/^hash$/i, function () { return '1a2b3c4d'; }],
        [/^typ$/i, function (i) { return ['image/jpeg', 'bild', 'video'][i % 3]; }],
        // Anteckningar (Notes, sdoc.db).
        [/^titel$/i, function (i) { return ['Inköpslista', 'Resa till Malmö', 'Koder'][i % 3]; }],
        [/^text$/i, function (i) { return ['Inköpslista\n☑ mjölk\n☐ bröd', 'Resa till Malmö\nTåget 07.12', 'Koder\n1234'][i % 3]; }],
        [/^konto$/i, function () { return 'iCloud'; }],
        [/^(last|fast|favorit|raderad|gzip)$/i, function (i) { return String(i % 2); }],
        [/^hur_raderad$/i, function () { return 'i mappen Recently Deleted'; }],
        [/^(tecken|byte)$/i, function (i) { return String(120 + i * 37); }],
        [/^(bilagor|checklista|anteckningar|anteckning)$/i, function (i) { return String(i % 3); }],
        [/^bilagetyper$/i, function () { return 'public.jpeg'; }],
        [/^lankar$/i, function () { return 'https://example.org'; }],
        [/^losenordstips$/i, function () { return 'hundens namn'; }],
        [/^slag$/i, function (i) { return ['vanlig', 'Nyligen raderade'][i % 2]; }],
        [/^identifierare$/i, function () { return 'C3732174-29FB-4408-9A1D-C97AF0B77064'; }],
        [/^fil$/i, function () { return '/data/user/0/com.samsung.android.app.notes/SDocData/1773318769975.sdocx'; }],
        [/^sokvag$/i, function () { return 'uncategorized:///'; }],
        [/^key$/i, pick(['67F4A4FC9E7EA492DEFC059260D154E6.media', 'C025B6FFB844EF85C721AA05B78DA32D.posted_story_snap', '7CF641F2121BC4035AC4E5296671CE44.overlay'])],
        [/^mapp$/i, pick(['memories_media', 'posted_story_snap', 'memories_overlay'])],
        [/^user_?id$/i, function () { return '9e6f7a8b-1c2d-4e3f-8a9b-0c1d2e3f4a5b'; }],
        [/notification_?id/i, function () { return '4d28a744-acc5-4607-a3c1-dbdde70795d3'; }],
        [/^category$/i, function () { return '1'; }],
        // Webbhistorik (Safari, Chrome, Samsung Internet).
        [/^(adress|omdirigerad_till|flik|sida)$/i, pick(['https://www.example.org/nyheter/artikel-12', 'https://www.google.com/search?q=t%C3%A5gtider+g%C3%B6teborg', 'https://example.com/'])],
        [/^(omdirigerad_fran|fran_sida|oppnad_fran|hanvisning|fliken_fran|extern_hanvisning)$/i, function () { return 'https://www.google.com/'; }],
        [/^kedja$/i, function () { return 'https://example.com/fil.pdf → https://cdn.example.com/fil.pdf'; }],
        [/^(sokterm|normaliserad)$/i, pick(['tågtider göteborg', 'väder stockholm'])],
        [/^sokmotor$/i, pick(['Google', 'DuckDuckGo'])],
        [/^grupp$/i, pick(['Flikar', 'Privata flikar', 'Resor'])],
        [/^(besok|besok_totalt|skriven|flikar|ordning|generation|mottagna_byte|fara|avbrott)$/i, function (i) { return String(i % 4); }],
        [/^(besok_id|sida_id|url_id)$/i, function (i) { return String(120 + i); }],
        [/^sekunder_pa_sidan$/i, function (i) { return String(12.5 + i * 7); }],
        [/^sparad_som$/i, function () { return '/storage/emulated/0/Download/fil (1).pdf'; }],
        [/^uuid$/i, function () { return '6A1F2C3D-4B5E-4F60-8A7B-9C0D1E2F3A4B'; }],
        [/^(local_attributes|extra_attributes)$/i, function () { return '(plist, 412 byte)'; }],
        [/^transition$/i, function () { return '805306368'; }],
        [/^etag$/i, function () { return '"5f2a-63b1"'; }],
        [/^andrad_enligt_servern$/i, function () { return 'Tue, 03 Nov 2026 09:12:44 GMT'; }],
        // Meddelanden, samtal och kontakter (sms.db, mmssms.db, bugle_db, CallHistory, calllog.db, AddressBook, contacts2.db).
        [/^riktning$/i, pick(['mottaget', 'skickat', 'utgående'])],
        [/^(tjanst|protokoll)$/i, pick(['iMessage', 'SMS', 'RCS'])],
        [/^(konversation|kontakt)$/i, pick(['Anna Svensson', 'Familjen', '+46701234567'])],
        [/^(motpart|nummer|nummer_eller_adress|fler_deltagare)$/i, pick(['+46701234567', '+46739876543', 'anna@example.org'])],
        [/^(meddelande_id|bilaga_id|samtal_id|kontakt_id|ra_kontakt|chatt_id|trad_id|konversation_id|trad_i_mmssms|lopnummer)$/i, function (i) { return String(41 + i); }],
        [/^(meddelanden|i_nyligen_raderade|deltagare|samtal|besvarade|inkommande|missade|missade_avvisade|kontaktad)$/i, function (i) { return String(2 + i * 3); }],
        [/^(land)$/i, function () { return 'se'; }],
        [/^(ort)$/i, function () { return 'Sverige'; }],
        [/^(langd_s)$/i, function (i) { return String(37 + i * 60); }],
        [/^(amne|utdrag)$/i, function () { return 'Ses vid stationen'; }],
        [/^(arkiverad|ny|blockerad)$/i, function (i) { return String(i % 2); }],
        [/^(status)$/i, function () { return '100'; }],
        [/^(orsak)$/i, function () { return '0'; }],
        [/^sms_rad$/i, function (i) { return 'content://sms/' + (7 + i); }],
        [/^(sim)$/i, function () { return '1'; }],
        [/^(sim_namn)$/i, function () { return 'Telia'; }],
        [/^(epost)$/i, function () { return 'Hem: anna@example.org'; }],
        [/^(etikett)$/i, pick(['Mobil', 'Hem', 'Arbete'])],
        [/^(fodelsedag)$/i, function () { return '1990-04-12'; }],
        [/^(foretag)$/i, function () { return 'Exempel AB'; }],
        [/^(smeknamn)$/i, function () { return 'Annie'; }],
        [/^(konton|kontonamn)$/i, function () { return 'com.google'; }],
        // PowerLog (CurrentPowerlog.PLSQL)
        [/^handelse$/i, pick(['kameran startas', 'kameran stängs'])],
        [/^kamera$/i, function () { return '0'; }],
        [/^upplosning$/i, function () { return '1920×1080'; }],
        [/^max_bilder_per_s$/i, function () { return '30'; }],
        [/^powerlog_tid$/i, function (i) { return String(1717246196 + i * 7) + '.118'; }],
        [/^kalla$/i, function () { return 'PLDisplayAgent_EventPoint_Display (Backlight)'; }],
        [/^vad$/i, pick(['appen på skärmen', 'hemskärmen eller appväxlaren'])],
        [/^roll$/i, function () { return '1'; }],
        [/^niva$/i, function () { return '1.0'; }],
        [/^(system|baseband|kernel)_s$/i, function () { return '-903.427'; }],
        [/^rader$/i, function (i) { return String(47 + i * 13); }],
        [/_hex$/i, function () { return '0a0b…'; }],
        [/(innehall|storlek|_bytes)/i, function (i) { return String(21293 + i * 1000); }],
        [/timezonename/i, function () { return 'Europe/Stockholm'; }],
        [/timezoneoffset/i, function () { return '7200'; }],
        [/exiftimestampstring/i, function (i) { return '2024:06:01 ' + clock(i); }],
        [/(enddate|^end_?time$|^avfard_|^exit_)/i, function (i) { return '2024-06-01 ' + clock(i, true); }],
        [/(accuracy|noggrannhet|osakerhet|uncertainty)/i, function (i) { return String(5 + (i % 4) * 3); }],
        [/(confidence|konfidens|placetype|usertype|referenceframe|^zsource$|^ztype$)/i, function () { return '1'; }],
        [/mapitemidentifier/i, function (i) { return String(4800123456789 + i); }],
        [/(date|time|creation|modif|start|end|last_?used|added|taken|tillagd|^tid_|^ankomst_|^upptackt_|_utc$|_lokal$)/i, function (i) {
            return '2024-06-01 ' + clock(i);
        }],
        [/relative_path/i, function () { return 'DCIM/Camera/'; }],
        [/directory/i, function (i, ctx) { return ctx.ios ? 'DCIM/100APPLE' : '/storage/emulated/0/DCIM/Camera'; }],
        [/(_data|path)/i, function (i, ctx) { return '/storage/emulated/0/DCIM/Camera/' + ctx.file(i); }],
        [/(importedbydisplayname|editorlocalizedname)/i, function () { return 'WhatsApp'; }],
        [/(owner_package|package|bundle|creator|valuestring|app)/i, function (i, ctx) { return ctx.pkg; }],
        [/^(zfullname|zdisplayname)$/i, pick(['Anna Svensson', 'Erik Lind', 'Sara Nilsson'])],
        [/^ztitle$/i, pick(['Semester 2024', 'WhatsApp', 'Skärmdumpar'])],
        [/streamname/i, pick(['/app/usage', '/app/inFocus', '/display/isBacklit', '/device/isLocked'])],
        [/^tabell$/i, function (i, ctx) { return ctx.schema === 'columns' ? 'ZASSET' : pick(['Z_33ASSETS', 'Z_34ASSETS'])(i); }],
        [/^kolumner$/i, function () { return 'Z_33ALBUMS, Z_3ASSETS, Z_FOK_3ASSETS'; }],
        [/^name$/i, function (i, ctx) {
            if (ctx.schema === 'tables') return pick(ctx.ios ? ['ZASSET', 'ZADDITIONALASSETATTRIBUTES', 'ZGENERICALBUM'] : ['files', 'thumbnails', 'log'])(i);
            if (ctx.schema === 'columns') return pick(ctx.ios ? ['Z_PK', 'ZFILENAME', 'ZDATECREATED'] : ['_id', '_data', 'mime_type'])(i);
            return ctx.file(i);
        }],
        [/bucket_display_name/i, function () { return 'Camera'; }],
        [/volume_name/i, function () { return 'external_primary'; }],
        [/(display_name|filename|title)$/i, function (i, ctx) { return ctx.file(i); }],
        [/cameramake/i, function () { return 'Apple'; }],
        [/cameramodel/i, function () { return 'iPhone 15 Pro'; }],
        [/lensmodel/i, function () { return 'iPhone 15 Pro back camera 6.86mm f/1.78'; }],
        [/uniformtypeidentifier/i, function () { return 'public.heic'; }],
        [/adjustmentformatidentifier/i, function () { return 'com.apple.photo'; }],
        [/(guid|syndicationidentifier)/i, function (i) { return '8F3C2A1E-4B7D-4C9A-9E21-0D5F6A7B8C' + String(10 + i); }],
        [/^zidentifier$/i, function (i) { return '+4670123456' + (i % 10); }],
        [/mime/i, function (i, ctx) { return ctx.ios ? 'image/heic' : 'image/jpeg'; }],
        [/media_type/i, function () { return '1'; }],
        [/(width)/i, function () { return '4032'; }],
        [/(height)/i, function () { return '3024'; }],
        [/(lat)/i, function () { return '59.3293'; }],
        [/(lon|lng)/i, function () { return '18.0686'; }],
        [/(bucket|album)/i, function () { return 'Camera'; }],
        [/(duration|seconds|count|size|antal|minuter|datapunkter|^n$)/i, function (i) { return String(12 + i * 3); }],
        [/valueinteger/i, function (i) { return i % 2 ? '0' : '1'; }],
        [/cloudlocalstate/i, function () { return '1'; }],
        [/savedassettype/i, function () { return '3'; }],
        [/(hidden|favorite|trashedstate|manual|isresponse|direction|syndicationstate|kindsubtype|^zkind$)/i, function () { return '0'; }],
        [/^type$/i, function (i, ctx) {
            if (ctx.schema === 'tables') return 'table';
            if (ctx.schema === 'columns') return pick(['INTEGER', 'TEXT', 'TIMESTAMP'])(i);
            return '1';
        }],
    ];

    // eRR.p (Samsung) som tabellen err: en omstart och starten efter den, påhittade i samma form som på en labbtelefon.
    var ERR_ROWS = [
        { rad: '99', tid: '2026-10-03 16:15:08+0200', unix_ms: '1791036908000', utc: '2026-10-03 14:15:08', zon: '+02:00', vad: 'REBOOT', kod: '', orsak: 'device_locked_3days',
            orsak_i_ord: 'låst i tre dygn', krasch: '0', fel_klocka: '0', text: '2026-10-03 16:15:08+0200 | REBOOT | | REASON: device_locked_3days [0]',
            last_fran_utc: '2026-09-30 14:15:08', omstart_utc: '2026-10-03 14:15:08' },
        { rad: '100', tid: '2026-10-03 16:15:59+0200', unix_ms: '1791036959000', utc: '2026-10-03 14:15:59', zon: '+02:00', vad: 'ON', kod: 'RP', orsak: 'NULL',
            orsak_i_ord: 'NULL', krasch: '0', fel_klocka: '0', text: '2026-10-03 16:15:59+0200 | ON | RP | A000XXU1 [1]' },
        { rad: '101', tid: '2026-10-09 08:34:12+0200', unix_ms: '1791527652000', utc: '2026-10-09 06:34:12', zon: '+02:00', vad: 'REBOOT', kod: '', orsak: 'recovery',
            orsak_i_ord: 'till recovery, till exempel en uppdatering', krasch: '0', fel_klocka: '0', text: '2026-10-09 08:34:12+0200 | REBOOT | | REASON: recovery [1]',
            last_fran_utc: '2026-10-06 06:34:12', omstart_utc: '2026-10-09 06:34:12' },
    ];

    function exampleRows(cols, opts) {
        opts = opts || {};
        var ios = /ios/i.test(opts.platform || '');
        var sql = String(opts.sql || '');
        var base = String(opts.filename || '').split(',')[0].trim();
        var literals = sql ? caseLiterals(sql) : {};
        var ctx = {
            ios: ios,
            schema: /^\s*PRAGMA\s+table_info|pragma_table_info/i.test(stripComments(sql)) ? 'columns'
                : /\bsqlite_master\b/i.test(sql) ? 'tables' : '',
            pkg: String(opts.packageName || opts.bundleId || '').split(',')[0].trim() || (ios ? 'net.whatsapp.WhatsApp' : 'com.whatsapp'),
            file: function (i) {
                if (base) return i === 0 ? base : base.replace(/(\.\w+)?$/, '_' + (i + 1) + '$1');
                if (ios) return 'IMG_' + (4101 + i) + '.HEIC';
                return '202406' + String(1 + i).padStart(2, '0') + '_14' + String(10 + i) + '12.jpg';
            },
        };
        var count = opts.rows || 3;
        var rows = [];
        var err = /\bFROM\s+err\b/i.test(stripComments(sql));
        for (var i = 0; i < count; i++) {
            rows.push(cols.map(function (col) {
                if (Object.prototype.hasOwnProperty.call(literals, col)) return literals[col];
                if (err && Object.prototype.hasOwnProperty.call(ERR_ROWS[i % 3], col)) return ERR_ROWS[i % 3][col];
                var name = col.replace(/^(ext|cloud)_/i, '');
                for (var r = 0; r < RULES.length; r++) {
                    if (RULES[r][0].test(name)) return RULES[r][1](i, ctx);
                }
                return '…';
            }));
        }
        return rows;
    }

    var api = { columns: columns, exampleRows: exampleRows };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.QueryPreview = api;
})(typeof window !== 'undefined' ? window : this);
